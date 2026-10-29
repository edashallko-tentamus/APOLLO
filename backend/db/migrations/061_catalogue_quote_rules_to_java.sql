-- 061: the catalogue, pricing and quoting rules move to the Java backend (Edashall Konah, 2026-10-29; the database keeps
-- structures only). Java now checks them before every write: pricing/domain (CatalogueEntry, RushFeeSchedule,
-- PriceAdjustment), quotes/domain (QuoteVersion, QuoteLine, QuoteTerms, Project, SubcontractPrice), packages/domain
-- (TestPackage, QuotedPackage, PriceChange) and charges/domain (Charge, OrderCharge), with JUnit tests in PricingRulesTest,
-- QuoteRulesTest, PackageRulesTest and ChargeRulesTest. Java also adds packages to quotes, reprices them, reprices the
-- catalogue and applies a price change starting today with its own code. What stays here:
--   * keys and references, NOT NULL, the unique indexes, the codes (PRJ-, Q-, SQ-, PKG-, PC-, CHG-, OC-), the GxP backstop,
--     the permission triggers and the CHECKs that only list allowed values (kind, status, rounding, source);
--   * project_version_lifecycle and the accepted_has_acceptor CHECK: kept, still guard the Node backend's quote sending
--     (Draft to Quoted) and the client's answer through the public link (record_quote_response, send_quote);
--   * the derived values other database code and the data loads rely on: the version number and its copy of charges,
--     the list price snapshot of a quote line and its 20-30 subcontract price (qtc_rules, now only that,
--     qtc_subcontract, z_qtc_after_insert), the discount kept when analytes change (qas_reprice), who issued and decided a
--     version, the project code and its lab, a package line's default price, a quoted charge's list price;
--   * catalog_list_price, rush_requires_approval, version_is_editable, subcontract_price, orderable_lines,
--     orderable_packages, apply_project, new_project_version, the test_package_* read functions: still called by views,
--     orders, invoicing, stability and seeds;
--   * reprice_catalog, add_package_to_quote, set_quoted_package, remove_quoted_package, quoted_package_allocate: still
--     called by the Node routes (the fallback when Java is off) and by test_041's order fixtures; Java no longer calls them;
--   * apply_catalog_price_change: still run by the Node hourly job;
--   * order_charge_rules and its CHECKs: kept, Invoicing's database functions still add charges through it (Java checks first).
-- Sandbox only: other writers of these tables (data load scripts, stability and order functions) are no longer checked.

-- quote lines: locked once quoted, a priced active test only, the test never changes (the list price stays derived here)
CREATE OR REPLACE FUNCTION qtc_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entry test_catalog_entry; v_lp_accept boolean;
BEGIN
    SELECT p.is_list_price_acceptance INTO v_lp_accept
      FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = NEW.project_version_id;
    SELECT * INTO v_entry FROM test_catalog_entry WHERE test_id = NEW.test_id;
    IF TG_OP = 'INSERT' THEN
        NEW.list_price := COALESCE(catalog_list_price(v_entry.id), 0);
    ELSIF v_entry.pricing_mode = 'Analyte Selection' THEN
        NEW.list_price := v_entry.base_price + v_entry.prep_fee
            + COALESCE((SELECT sum(analyte_price) FROM quoted_analyte_selection WHERE line_id = NEW.id AND included), 0);
    ELSE
        NEW.list_price := OLD.list_price;
    END IF;
    IF v_lp_accept THEN NEW.final_price := NEW.list_price; END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a00_package ON quoted_test_configuration;
DROP FUNCTION IF EXISTS qtc_package_lock();
ALTER TABLE quoted_test_configuration DROP CONSTRAINT IF EXISTS quoted_test_configuration_quantity_check;
ALTER TABLE quoted_test_configuration DROP CONSTRAINT IF EXISTS quoted_test_configuration_final_price_check;

-- analyte choices and rush terms: locked once quoted, fixed prices, a package's analytes set in the package, the discount range
DROP TRIGGER IF EXISTS a_qas_lock ON quoted_analyte_selection;
DROP FUNCTION IF EXISTS qas_lock();
DROP TRIGGER IF EXISTS a00_package ON quoted_analyte_selection;
DROP FUNCTION IF EXISTS qas_package_lock();
DROP TRIGGER IF EXISTS a_qrt_rules ON quote_rush_term;
DROP FUNCTION IF EXISTS qrt_rules();
ALTER TABLE quote_rush_term DROP CONSTRAINT IF EXISTS quote_rush_term_discount_pct_check;

-- projects and quotes: a project never becomes a quote, the quote's contact, a quote stays with its lab, the name
CREATE OR REPLACE FUNCTION project_code_assign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_code IS NULL THEN
        NEW.project_code := CASE WHEN NEW.kind = 'Quote' THEN 'Q-' || lpad(nextval('quote_code_seq')::text, 5, '0')
                                 WHEN NEW.kind = 'Stability' THEN 'SQ-' || lpad(nextval('stability_quote_code_seq')::text, 5, '0')
                                 ELSE 'PRJ-' || lpad(nextval('project_code_seq')::text, 5, '0') END;
    END IF;
    RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION project_site_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN NEW.site_id := COALESCE(NEW.site_id, current_site()); END IF;
    RETURN NEW;
END $$;
ALTER TABLE project DROP CONSTRAINT IF EXISTS project_project_name_check;
ALTER TABLE project DROP CONSTRAINT IF EXISTS portal_projects_name_requester;

-- the catalogue: no negative prices or TAT, no preparation fee on Base Price Only, named schedules and tiers
ALTER TABLE test_catalog_entry DROP CONSTRAINT IF EXISTS base_only_has_no_prep_fee;
ALTER TABLE test_catalog_entry DROP CONSTRAINT IF EXISTS test_catalog_entry_base_price_check;
ALTER TABLE test_catalog_entry DROP CONSTRAINT IF EXISTS test_catalog_entry_prep_fee_check;
ALTER TABLE test_catalog_entry DROP CONSTRAINT IF EXISTS test_catalog_entry_standard_tat_check;
ALTER TABLE test_analyte_price DROP CONSTRAINT IF EXISTS test_analyte_price_price_check;
ALTER TABLE rush_fee_schedule DROP CONSTRAINT IF EXISTS rush_fee_schedule_schedule_name_check;
ALTER TABLE rush_fee_tier DROP CONSTRAINT IF EXISTS rush_fee_tier_tier_name_check;
ALTER TABLE rush_fee_tier DROP CONSTRAINT IF EXISTS rush_fee_tier_rush_tat_check;
ALTER TABLE rush_fee_tier DROP CONSTRAINT IF EXISTS rush_fee_tier_surcharge_value_check;
ALTER TABLE rush_fee_tier DROP CONSTRAINT IF EXISTS rush_fee_tier_escalation_hours_check;

-- packages: its own lab's priced tests, a price never emptied, analytes only on analyte-priced tests, a quoted package
-- changed through the quote page and locked once quoted (the permission check and the default price stay)
CREATE OR REPLACE FUNCTION test_package_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'test_package' THEN
        v_site := NEW.site_id;
    ELSIF TG_TABLE_NAME = 'test_package_item' THEN
        SELECT site_id INTO v_site FROM test_package WHERE id = NEW.package_id;
        IF NEW.component_price IS NULL AND TG_OP = 'INSERT' THEN
            NEW.component_price := (SELECT catalog_list_price(e.id) FROM test_catalog_entry e WHERE e.test_id = NEW.test_id);
        END IF;
    ELSE
        SELECT p.site_id INTO v_site FROM test_package_item i JOIN test_package p ON p.id = i.package_id WHERE i.id = NEW.item_id;
    END IF;
    PERFORM require_permission_at('catalog.edit', v_site);
    RETURN NEW;
END $$;
ALTER TABLE test_package DROP CONSTRAINT IF EXISTS test_package_package_name_check;
ALTER TABLE test_package_item DROP CONSTRAINT IF EXISTS test_package_item_component_price_check;
DROP TRIGGER IF EXISTS a00_rules ON quoted_package;
DROP FUNCTION IF EXISTS quoted_package_rules();
ALTER TABLE quoted_package DROP CONSTRAINT IF EXISTS quoted_package_quantity_check;
ALTER TABLE quoted_package DROP CONSTRAINT IF EXISTS quoted_package_package_price_check;

-- dated price changes: today or later, its own lab's tests, never edited, only a scheduled one is cancelled (and who
-- and when), the percentage and the reason; the permission check and the hourly job's error note stay
CREATE OR REPLACE FUNCTION catalog_price_change_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.last_error IS DISTINCT FROM OLD.last_error
       AND (to_jsonb(NEW) - '{last_error,record_version,modified_at,modified_by}'::text[]) = (to_jsonb(OLD) - '{last_error,record_version,modified_at,modified_by}'::text[]) THEN
        RETURN NEW;
    END IF;
    PERFORM require_permission_at('catalog.edit', NEW.site_id);
    RETURN NEW;
END $$;
ALTER TABLE catalog_price_change DROP CONSTRAINT IF EXISTS catalog_price_change_pct_check;
ALTER TABLE catalog_price_change DROP CONSTRAINT IF EXISTS catalog_price_change_reason_check;

-- service lines and charges: names, prices never negative, a type stays under its line, a charge with its lab, quoted
-- charges locked once quoted, a retired charge is not added, its item never swapped (the quoted list price stays derived)
DROP TRIGGER IF EXISTS a02_rules ON service_line_type;
DROP FUNCTION IF EXISTS service_line_type_rules();
ALTER TABLE service_line DROP CONSTRAINT IF EXISTS service_line_line_name_check;
ALTER TABLE service_line_type DROP CONSTRAINT IF EXISTS service_line_type_type_name_check;
CREATE OR REPLACE FUNCTION charge_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Charges for every lab are kept by system administrators; choose your lab'; END IF;
    ELSE
        PERFORM require_permission_at('catalog.edit', NEW.site_id);
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE charge_item DROP CONSTRAINT IF EXISTS charge_item_charge_name_check;
ALTER TABLE charge_item DROP CONSTRAINT IF EXISTS charge_item_price_check;
CREATE OR REPLACE FUNCTION quoted_charge_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ci charge_item;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO ci FROM charge_item WHERE id = NEW.charge_item_id;
        NEW.list_price := ci.price;
        IF NEW.unit_price IS NULL THEN NEW.unit_price := ci.price; END IF;
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE quoted_charge DROP CONSTRAINT IF EXISTS quoted_charge_quantity_check;
ALTER TABLE quoted_charge DROP CONSTRAINT IF EXISTS quoted_charge_unit_price_check;
