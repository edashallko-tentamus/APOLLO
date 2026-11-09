-- 031: Alex's notes of 2026-10-14 on quotes, the catalogue and serving sizes (Claude Code, version 0.16.1).
--  1. In-network subcontracting on quotes (the "20-30 rule"): a quote belongs to the lab it was made in; a test of
--     another lab of the network is quoted as subcontracted: the other lab's list price less the in-network discount
--     (default 20 %), plus the quoting lab's markup (default 30 %). Both are lab settings (Admin > Sites and holidays).
--  2. Applying a project to a sample skips another lab's tests instead of failing (they are subcontracted: sending
--     them to the other lab is not built yet).
--  3. Catalogue prices updated by a percentage (all tests or the selected ones): base price, preparation fee and
--     analyte prices, so the list price moves with its parts.
--  4. Serving units on the Units list; a sample's serving as a count ("2 capsules"), its weight or volume ("1.2 g")
--     and the servings per package; the received quantity's unit checked against the Units list.
--  5. Specification limits per serving or per package (e.g. 1 mg per serving, 10 mg per package).
-- The shared tests ("Any lab") are given a home lab by seed_024 (they are created by seed.sql, after the migrations).
-- Vault: Decision - Quote Pricing, Catalogue Updates and Serving Sizes.
BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. IN-NETWORK SUBCONTRACTING ON QUOTES
-------------------------------------------------------------------------------
ALTER TABLE lab_site ADD COLUMN subcontract_discount_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (subcontract_discount_pct >= 0 AND subcontract_discount_pct < 100);
ALTER TABLE lab_site ADD COLUMN subcontract_markup_pct numeric(6,2) NOT NULL DEFAULT 30 CHECK (subcontract_markup_pct >= 0 AND subcontract_markup_pct <= 500);
COMMENT ON COLUMN lab_site.subcontract_discount_pct IS 'In-network subcontracting: the discount off the performing lab''s list price (the 20 of the 20-30 rule)';
COMMENT ON COLUMN lab_site.subcontract_markup_pct IS 'In-network subcontracting: added to that cost for the client (the 30 of the 20-30 rule)';

-- the lab a quote or project was made in (its tests are in-house; other labs' tests are subcontracted)
ALTER TABLE project ADD COLUMN site_id uuid REFERENCES lab_site(id);
CREATE FUNCTION project_site_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN NEW.site_id := COALESCE(NEW.site_id, current_site());
    ELSIF NEW.site_id IS DISTINCT FROM OLD.site_id AND OLD.site_id IS NOT NULL THEN
        RAISE EXCEPTION 'A quote stays with the lab it was made in';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_project_site BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION project_site_default();

ALTER TABLE quoted_test_configuration ADD COLUMN is_subcontracted boolean NOT NULL DEFAULT false;
ALTER TABLE quoted_test_configuration ADD COLUMN performing_site_id uuid REFERENCES lab_site(id);
ALTER TABLE quoted_test_configuration ADD COLUMN cost_price numeric(12,2);
ALTER TABLE quoted_test_configuration ADD COLUMN sc_discount_pct numeric(5,2);
ALTER TABLE quoted_test_configuration ADD COLUMN sc_markup_pct numeric(6,2);

-- the client's list price of a test quoted from a lab: in-house = the catalogue price; another network lab's test =
-- its price less the discount, plus the markup (each step rounded to the cent)
CREATE FUNCTION subcontract_price(p_raw numeric, p_discount numeric, p_markup numeric, OUT cost numeric, OUT price numeric) LANGUAGE sql IMMUTABLE AS $$
    SELECT round(p_raw * (1 - p_discount / 100), 2), round(round(p_raw * (1 - p_discount / 100), 2) * (1 + p_markup / 100), 2)
$$;

-- runs after a_qtc_rules (which works out the catalogue list price): marks and prices a subcontracted line
CREATE FUNCTION qtc_subcontract() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_quote_site uuid; v_lpa boolean; v_test_site uuid; v_mode text; s lab_site; sc record;
BEGIN
    SELECT p.site_id, p.is_list_price_acceptance INTO v_quote_site, v_lpa
      FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = NEW.project_version_id;
    SELECT t.site_id, e.pricing_mode::text INTO v_test_site, v_mode FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.id = NEW.test_id;
    IF TG_OP = 'INSERT' THEN
        NEW.performing_site_id := v_test_site;
        NEW.is_subcontracted := v_quote_site IS NOT NULL AND v_test_site IS NOT NULL AND v_test_site <> v_quote_site;
        IF NEW.is_subcontracted THEN
            SELECT * INTO s FROM lab_site WHERE id = v_quote_site;
            NEW.sc_discount_pct := s.subcontract_discount_pct; NEW.sc_markup_pct := s.subcontract_markup_pct;
        ELSE
            NEW.sc_discount_pct := NULL; NEW.sc_markup_pct := NULL; NEW.cost_price := NULL;
        END IF;
    ELSE
        -- the line keeps what it was quoted as (and the rates of the day it was added)
        NEW.is_subcontracted := OLD.is_subcontracted; NEW.performing_site_id := OLD.performing_site_id;
        NEW.sc_discount_pct := OLD.sc_discount_pct; NEW.sc_markup_pct := OLD.sc_markup_pct;
        IF v_mode <> 'Analyte Selection' THEN NEW.cost_price := OLD.cost_price; END IF;
    END IF;
    -- a_qtc_rules has just worked out the catalogue price (on insert, or from the analytes): price it for the client
    IF NEW.is_subcontracted AND (TG_OP = 'INSERT' OR v_mode = 'Analyte Selection') THEN
        SELECT * INTO sc FROM subcontract_price(NEW.list_price, NEW.sc_discount_pct, NEW.sc_markup_pct);
        NEW.cost_price := sc.cost; NEW.list_price := sc.price;
        IF v_lpa THEN NEW.final_price := NEW.list_price; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_qtc_subcontract BEFORE INSERT OR UPDATE ON quoted_test_configuration FOR EACH ROW EXECUTE FUNCTION qtc_subcontract();

-- removing or restoring an analyte keeps the discount %: the new list price is the client's (subcontracted) price
CREATE OR REPLACE FUNCTION qas_reprice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_line quoted_test_configuration; v_entry test_catalog_entry; v_new_list numeric;
BEGIN
    SELECT * INTO v_line FROM quoted_test_configuration WHERE id = NEW.line_id;
    SELECT * INTO v_entry FROM test_catalog_entry WHERE test_id = v_line.test_id;
    v_new_list := v_entry.base_price + v_entry.prep_fee
        + COALESCE((SELECT sum(analyte_price) FROM quoted_analyte_selection WHERE line_id = NEW.line_id AND included), 0);
    IF v_line.is_subcontracted THEN v_new_list := (subcontract_price(v_new_list, v_line.sc_discount_pct, v_line.sc_markup_pct)).price; END IF;
    UPDATE quoted_test_configuration
       SET final_price = CASE WHEN v_line.final_price IS NULL OR v_line.list_price = 0 THEN v_line.final_price
                              ELSE round(v_new_list * v_line.final_price / v_line.list_price, 2) END,
           special_instructions = special_instructions
     WHERE id = NEW.line_id;
    RETURN NULL;
END $$;

-- a shared test (made before tests belonged to a lab) may be given its home lab once; a lab's test never moves
CREATE OR REPLACE FUNCTION test_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.test_name := btrim(NEW.test_name);
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN
        IF OLD.site_id IS NOT NULL THEN RAISE EXCEPTION 'A test cannot move to another lab; copy it to that lab instead'; END IF;
        IF NEW.site_id IS NULL THEN RAISE EXCEPTION 'A test keeps its lab'; END IF;
    END IF;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department d WHERE d.id = NEW.department_id AND d.site_id = NEW.site_id) THEN
        RAISE EXCEPTION 'The department must be one of the test''s own lab''s departments';
    END IF;
    IF methods_internal() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NOT NULL THEN
        IF NOT (has_permission_at('methods.design', NEW.site_id) OR has_permission_at('catalog.edit', NEW.site_id)) THEN
            PERFORM require_permission_at('methods.design', NEW.site_id);
        END IF;
    ELSIF NOT (has_permission('methods.design') OR has_permission('catalog.edit')) THEN
        RAISE EXCEPTION 'You do not have permission to change tests (methods.design or catalog.edit). Ask your lab administrator.';
    END IF;
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 2. APPLYING A PROJECT SKIPS ANOTHER LAB'S (SUBCONTRACTED) TESTS
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_project(p_sample uuid, p_project uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; r record; n integer := 0;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    FOR r IN SELECT ol.line_id, ol.test_id FROM orderable_lines(o.client_id) ol
              JOIN quoted_test_configuration q ON q.id = ol.line_id
              JOIN project_version pv ON pv.id = q.project_version_id
              JOIN test t ON t.id = ol.test_id
             WHERE pv.project_id = p_project AND (t.site_id IS NULL OR t.site_id = o.site_id) LOOP
        IF NOT EXISTS (SELECT 1 FROM requested_test WHERE sample_id = p_sample AND test_id = r.test_id AND status <> 'Cancelled') THEN
            PERFORM order_test(p_sample, r.line_id); n := n + 1;
        END IF;
    END LOOP;
    IF n = 0 AND NOT EXISTS (SELECT 1 FROM orderable_lines(o.client_id) ol JOIN quoted_test_configuration q ON q.id = ol.line_id
                              JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = p_project) THEN
        RAISE EXCEPTION 'That project has no accepted, orderable tests for this client';
    END IF;
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 3. CATALOGUE PRICES BY A PERCENTAGE
-------------------------------------------------------------------------------
-- p_tests NULL: every active test. Each part (base, preparation fee, analyte prices) moves by the percentage, rounded
-- to the cent, so the list price follows. The catalogue's own rules apply (catalog.edit, a Reason for Change).
CREATE FUNCTION reprice_catalog(p_tests uuid[], p_pct numeric) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE f numeric; n integer;
BEGIN
    IF p_pct IS NULL OR p_pct = 0 THEN RAISE EXCEPTION 'Give the percentage to change the prices by (e.g. 3 or -5)'; END IF;
    IF p_pct <= -90 OR p_pct > 500 THEN RAISE EXCEPTION 'A price change of % %% is outside what this tool allows (more than -90 %% and up to 500 %%)', p_pct; END IF;
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'A Reason for Change is required to update catalogue prices'; END IF;
    f := 1 + p_pct / 100;
    UPDATE test_catalog_entry e SET base_price = round(e.base_price * f, 2), prep_fee = round(e.prep_fee * f, 2)
      FROM test t WHERE t.id = e.test_id AND t.status = 'Active' AND (p_tests IS NULL OR e.test_id = ANY (p_tests));
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE test_analyte_price ap SET price = round(ap.price * f, 2)
      FROM test_catalog_entry e JOIN test t ON t.id = e.test_id
     WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active' AND t.status = 'Active' AND (p_tests IS NULL OR e.test_id = ANY (p_tests));
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 4. SERVING UNITS AND THE SAMPLE'S SERVING
-------------------------------------------------------------------------------
ALTER TABLE unit_of_measure ADD COLUMN is_serving_unit boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN unit_of_measure.is_serving_unit IS 'Offered as the unit of a serving on samples (capsule, scoop, packet...)';

ALTER TABLE sample ADD COLUMN serving_count numeric(10,3) CHECK (serving_count > 0);
ALTER TABLE sample ADD COLUMN serving_count_unit text;
ALTER TABLE sample ADD COLUMN servings_per_package numeric(12,3) CHECK (servings_per_package > 0);
COMMENT ON COLUMN sample.serving_count IS 'The serving as the label gives it, e.g. 2 (capsules)';
COMMENT ON COLUMN sample.serving_size IS 'The serving''s weight or volume, e.g. 1.2 (g): what per-serving results are worked out from';

CREATE OR REPLACE FUNCTION sample_serving_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.serving_unit IS NOT NULL AND btrim(NEW.serving_unit) = '' THEN NEW.serving_unit := NULL; END IF;
    IF NEW.serving_count_unit IS NOT NULL AND btrim(NEW.serving_count_unit) = '' THEN NEW.serving_count_unit := NULL; END IF;
    IF NEW.quantity_unit IS NOT NULL AND btrim(NEW.quantity_unit) = '' THEN NEW.quantity_unit := NULL; END IF;
    -- the serving's weight or volume (old values in a count unit stay until they are changed)
    IF NEW.serving_unit IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.serving_unit IS DISTINCT FROM OLD.serving_unit) THEN
        NEW.serving_unit := canonical_unit(NEW.serving_unit, '{Mass,Volume}', 'Serving weight or volume unit');
    END IF;
    IF NEW.serving_size IS NOT NULL AND NEW.serving_unit IS NULL THEN RAISE EXCEPTION 'Give the serving''s weight or volume a unit (e.g. g or mL)'; END IF;
    -- the serving as a count of serving units (capsule, scoop...)
    IF NEW.serving_count_unit IS NOT NULL THEN
        SELECT u.unit_code INTO NEW.serving_count_unit FROM unit_of_measure u
         WHERE lower(u.unit_code) = lower(btrim(NEW.serving_count_unit)) AND u.is_serving_unit AND u.status = 'Active';
        IF NEW.serving_count_unit IS NULL THEN RAISE EXCEPTION 'The serving unit must be one of the serving units on the Units list (Admin > Units), e.g. capsule or scoop'; END IF;
    END IF;
    IF NEW.serving_count IS NOT NULL AND NEW.serving_count_unit IS NULL THEN RAISE EXCEPTION 'Say what the serving is counted in (e.g. 2 capsules)'; END IF;
    -- the quantity received is in a unit of the Units list (old free-text values stay until they are changed)
    IF NEW.quantity_unit IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.quantity_unit IS DISTINCT FROM OLD.quantity_unit) THEN
        NEW.quantity_unit := canonical_unit(NEW.quantity_unit, '{Mass,Volume,Count}', 'Quantity unit');
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.logged_at IS NOT NULL AND current_reason() IS NULL
       AND (NEW.serving_size, NEW.serving_unit, NEW.serving_count, NEW.serving_count_unit, NEW.servings_per_package)
           IS DISTINCT FROM (OLD.serving_size, OLD.serving_unit, OLD.serving_count, OLD.serving_count_unit, OLD.servings_per_package) THEN
        RAISE EXCEPTION 'A Reason for Change is required to change the serving of a logged sample';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER a_sample_serving ON sample;
CREATE TRIGGER a_sample_serving BEFORE INSERT OR UPDATE OF serving_size, serving_unit, serving_count, serving_count_unit, servings_per_package, quantity_unit
    ON sample FOR EACH ROW EXECUTE FUNCTION sample_serving_rules();

-------------------------------------------------------------------------------
-- 5. LIMITS PER SERVING OR PER PACKAGE
-------------------------------------------------------------------------------
ALTER TABLE specification ADD COLUMN basis text NOT NULL DEFAULT 'As reported' CHECK (basis IN ('As reported','Per serving','Per package'));
COMMENT ON COLUMN specification.basis IS 'As reported: against the result; Per serving: the result times the serving weight; Per package: per serving times the servings per package';

-- copied with the limits (to orders, and to a new quote version)
CREATE OR REPLACE FUNCTION requested_test_copy_specs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source, basis, copied_from_spec_id)
    SELECT NEW.id, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.basis, s.id
      FROM specification s
     WHERE s.quoted_line_id = NEW.quoted_line_id AND s.status = 'Active'
       AND EXISTS (SELECT 1 FROM test_version_analyte a WHERE a.test_version_id = NEW.test_version_id AND a.analyte_id = s.analyte_id AND a.status = 'Active');
    RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION new_project_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_new uuid; v_prev uuid; r record; v_line uuid;
BEGIN
    SELECT id INTO v_prev FROM project_version WHERE project_id = p_project ORDER BY version_no DESC LIMIT 1;
    INSERT INTO project_version (project_id, version_no) VALUES (p_project, 0) RETURNING id INTO v_new;
    IF v_prev IS NOT NULL THEN
        FOR r IN SELECT l.* FROM quoted_test_configuration l JOIN test t ON t.id = l.test_id
                  WHERE l.project_version_id = v_prev AND l.status = 'Active' AND t.status = 'Active' LOOP
            INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, special_instructions)
            VALUES (v_new, r.test_id, r.quantity, r.special_instructions) RETURNING id INTO v_line;
            UPDATE quoted_analyte_selection s SET included = false
             WHERE s.line_id = v_line AND EXISTS (SELECT 1 FROM quoted_analyte_selection o
                                                   WHERE o.line_id = r.id AND o.analyte_id = s.analyte_id AND NOT o.included);
            -- keep the previous discount % against the refreshed list price
            UPDATE quoted_test_configuration q
               SET final_price = CASE WHEN r.final_price IS NULL OR r.list_price = 0 THEN r.final_price
                                      ELSE round(q.list_price * r.final_price / r.list_price, 2) END
             WHERE q.id = v_line;
            INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value, text_value, unit, source, basis, copied_from_spec_id)
            SELECT v_line, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.basis, s.id
              FROM specification s WHERE s.quoted_line_id = r.id AND s.status = 'Active';
        END LOOP;
        UPDATE quote_rush_term n SET discount_pct = o.discount_pct
          FROM quote_rush_term o WHERE n.project_version_id = v_new AND o.project_version_id = v_prev AND o.tier_id = n.tier_id;
    END IF;
    RETURN v_new;
END $$;

-- 3 significant figures (how the COA prints amounts per serving)
CREATE FUNCTION sig3(p numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL OR p = 0 THEN p ELSE round(p, (2 - floor(log(abs(p))))::int) END
$$;

-- The comparison with the specification. Per serving / per package limits: the reported value times the sample's
-- serving weight (and the servings per package), rounded to 3 significant figures as printed, in the limit's unit.
CREATE OR REPLACE FUNCTION spec_conformance(p_rt uuid, p_analyte uuid, p_value numeric, p_text text, p_reported text, p_unit text, p_found text[])
RETURNS TABLE (spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE sp specification; x numeric; below boolean := false; f numeric; u text := p_unit; smp sample; ps record;
BEGIN
    SELECT * INTO sp FROM specification s WHERE s.requested_test_id = p_rt AND s.analyte_id = p_analyte AND s.status = 'Active' LIMIT 1;
    IF sp.id IS NULL THEN spec_min := NULL; spec_max := NULL; spec_text := NULL; spec_unit := NULL; conformance := 'No specification'; RETURN NEXT; RETURN; END IF;
    spec_min := sp.min_value; spec_max := sp.max_value; spec_text := sp.text_value; spec_unit := sp.unit;
    IF sp.basis <> 'As reported' THEN spec_unit := COALESCE(sp.unit, '') || CASE sp.basis WHEN 'Per serving' THEN ' per serving' ELSE ' per package' END; END IF;
    IF sp.min_value IS NULL AND sp.max_value IS NULL THEN
        -- a text limit (e.g. "Absent in 10 g"): a found result does not conform
        conformance := CASE WHEN p_text IS NULL THEN 'Not compared' WHEN p_text = ANY (COALESCE(p_found, '{}')) THEN 'Does not conform' ELSE 'Conforms' END;
        RETURN NEXT; RETURN;
    END IF;
    -- compare the reported (rounded) value; "< LOQ" and "ND" are below any positive limit
    IF p_reported ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN x := p_reported::numeric;
    ELSIF p_reported LIKE '<%' OR p_reported = 'ND' THEN below := true; x := COALESCE(NULLIF(regexp_replace(p_reported, '[^0-9.]', '', 'g'), '')::numeric, 0);
    ELSE x := p_value; END IF;
    IF x IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    IF sp.basis <> 'As reported' THEN
        SELECT s.* INTO smp FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE rt.id = p_rt;
        SELECT * INTO ps FROM per_serving(x, p_unit, smp.serving_size, smp.serving_unit);
        IF ps.value IS NULL OR (sp.basis = 'Per package' AND smp.servings_per_package IS NULL) THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
        x := sig3(ps.value * CASE WHEN sp.basis = 'Per package' THEN smp.servings_per_package ELSE 1 END);
        u := regexp_replace(ps.unit, ' per serving$', '');
    END IF;
    f := CASE WHEN sp.unit IS NULL OR u IS NULL OR sp.unit = u THEN 1 ELSE unit_factor(u, sp.unit, NULL) END;
    IF f IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    x := x * f;
    conformance := CASE WHEN (sp.max_value IS NOT NULL AND x > sp.max_value AND NOT below) OR (sp.min_value IS NOT NULL AND (x < sp.min_value OR below)) THEN 'Does not conform' ELSE 'Conforms' END;
    RETURN NEXT;
END $$;

COMMIT;
