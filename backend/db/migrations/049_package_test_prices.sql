-- 049: a package is priced by typing each test's price in it (Claude Code, 2026-10-19; version 0.27.1). Alex, 2026-10-19:
-- "Let's instead of using a %discount approach and instead enter the price for the component test and calculate the
-- discount. This should make it more simpler. You always make a package price by re-pricing the component tests."
--  - Every test in a package has its price in the package (test_package_item.component_price, now required). A test
--    added without one starts at its catalogue price (no discount until a price is typed).
--  - The package price is the sum of those prices. The discount is worked out: the tests at their catalogue prices
--    (the analytes in the package) less the package price, in dollars and as a percentage.
--  - The two pricing modes ("Fixed price", "Sum less discount") and the package price per analyte are gone. An
--    analyte-priced test can still leave analytes out; its catalogue price follows, its package price stays as typed.
--  - Existing packages keep their prices: each test is given the share it had (the same shares quotes were given).
--    A package whose typed shares did not add up to its price keeps its price, shared by the tests' values.
--  - A dated price change with "Packages" ticked changes the package price of each test in the change by the same
--    percentage and rounding (it used to change fixed prices and typed shares).
-- Quotes are unchanged: a package on a quote keeps the price and shares it was given, and its price is still negotiated
-- on the quote as one figure, shared out in proportion.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 049: each test priced in its package (the old share kept)', true);

-------------------------------------------------------------------------------
-- 1. EXISTING PACKAGES: each test keeps the share it had, as its price in the package
-------------------------------------------------------------------------------
-- typed shares that did not add up to the package price (the package had an Error and could not be quoted; found on
-- Alex's data: 10 and 90 typed on a 10 %-off package): the package price is kept and shared by value instead
UPDATE test_package_item i SET component_price = NULL
 WHERE i.status = 'Active' AND i.package_id IN (
       SELECT p.id FROM test_package p
        WHERE EXISTS (SELECT 1 FROM test_package_item x WHERE x.package_id = p.id AND x.status = 'Active')
          AND NOT EXISTS (SELECT 1 FROM test_package_item x WHERE x.package_id = p.id AND x.status = 'Active' AND x.component_price IS NULL)
          AND (SELECT sum(x.component_price) FROM test_package_item x WHERE x.package_id = p.id AND x.status = 'Active') <> test_package_price(p.id));
CREATE TEMP TABLE pk049_share ON COMMIT DROP AS
SELECT l.item_id, l.share FROM test_package p, LATERAL test_package_lines(p.id) l;
UPDATE test_package_item i SET component_price = s.share
  FROM pk049_share s WHERE s.item_id = i.id AND i.component_price IS DISTINCT FROM s.share;
-- lines taken out of a package (Inactive) are not in the shares: they take their catalogue price
UPDATE test_package_item i SET component_price = COALESCE(catalog_list_price(e.id), 0)
  FROM test_catalog_entry e WHERE e.test_id = i.test_id AND i.component_price IS NULL;
UPDATE test_package_item SET component_price = 0 WHERE component_price IS NULL;

DROP VIEW test_package_view;
ALTER TABLE test_package DROP COLUMN pricing_mode, DROP COLUMN fixed_price, DROP COLUMN discount_pct;
ALTER TABLE test_package_analyte DROP COLUMN package_price;
ALTER TABLE test_package_item ALTER COLUMN component_price SET NOT NULL;
COMMENT ON COLUMN test_package_item.component_price IS 'The test''s price in the package (what it is quoted and invoiced at); the package price is their sum';

-------------------------------------------------------------------------------
-- 2. RULES: a test starts at its catalogue price; its price cannot be emptied
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION test_package_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_test uuid; v_mode text;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'test_package' THEN
        v_site := NEW.site_id;
        NEW.package_name := btrim(NEW.package_name);
        IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A package stays with its lab'; END IF;
    ELSIF TG_TABLE_NAME = 'test_package_item' THEN
        SELECT site_id INTO v_site FROM test_package WHERE id = NEW.package_id;
        IF TG_OP = 'UPDATE' AND (NEW.package_id, NEW.test_id) IS DISTINCT FROM (OLD.package_id, OLD.test_id) THEN
            RAISE EXCEPTION 'The test on a package line cannot be changed; remove the line and add the test again';
        END IF;
        IF NEW.status = 'Active' THEN
            IF NOT EXISTS (SELECT 1 FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.id = NEW.test_id AND t.status = 'Active') THEN
                RAISE EXCEPTION 'That test is retired or has no catalogue price, so it cannot be in a package';
            END IF;
            IF (SELECT site_id FROM test WHERE id = NEW.test_id) IS DISTINCT FROM v_site THEN
                RAISE EXCEPTION 'A package holds its own lab''s tests only (% is another lab''s test)', (SELECT test_name FROM test WHERE id = NEW.test_id);
            END IF;
        END IF;
        IF NEW.component_price IS NULL THEN
            IF TG_OP = 'UPDATE' THEN
                RAISE EXCEPTION 'Give the price of % in the package', (SELECT test_name FROM test WHERE id = NEW.test_id);
            END IF;
            NEW.component_price := (SELECT catalog_list_price(e.id) FROM test_catalog_entry e WHERE e.test_id = NEW.test_id);
        END IF;
    ELSE
        SELECT p.site_id, i.test_id INTO v_site, v_test FROM test_package_item i JOIN test_package p ON p.id = i.package_id WHERE i.id = NEW.item_id;
        SELECT e.pricing_mode::text INTO v_mode FROM test_catalog_entry e WHERE e.test_id = v_test;
        IF v_mode <> 'Analyte Selection' THEN RAISE EXCEPTION 'Only an analyte-priced test has analytes to leave out of a package'; END IF;
        IF TG_OP = 'UPDATE' AND (NEW.item_id, NEW.analyte_id) IS DISTINCT FROM (OLD.item_id, OLD.analyte_id) THEN
            RAISE EXCEPTION 'The analyte on a package line cannot be changed';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM test_analyte_price ap JOIN test_catalog_entry e ON e.id = ap.catalog_entry_id
                        WHERE e.test_id = v_test AND ap.analyte_id = NEW.analyte_id AND ap.status = 'Active') THEN
            RAISE EXCEPTION 'That analyte is not priced on the test''s catalogue entry';
        END IF;
    END IF;
    PERFORM require_permission_at('catalog.edit', v_site);
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 3. PRICES: the tests' prices, their sum, the discount
-------------------------------------------------------------------------------
-- Each test of a package (same columns as 047, so callers are unchanged):
--   list_price   the catalogue price of the analytes in it (what the test costs on its own today)
--   value        the same (kept for callers; analytes are no longer repriced inside a package)
--   typed_price  the test's price in the package
CREATE OR REPLACE FUNCTION test_package_values(p_package uuid)
RETURNS TABLE (item_id uuid, test_id uuid, test_code text, test_name text, pricing_mode text, sort_order integer,
               analytes uuid[], analytes_in integer, analytes_total integer, list_price numeric, value numeric, typed_price numeric)
LANGUAGE sql STABLE AS $$
    WITH x AS (
        SELECT i.id AS item_id, t.id AS test_id, t.test_code, t.test_name, e.pricing_mode::text AS pricing_mode, i.sort_order, e.id AS entry_id,
               i.component_price,
               CASE WHEN e.pricing_mode = 'Analyte Selection' THEN ARRAY(SELECT ap.analyte_id FROM test_analyte_price ap
                    LEFT JOIN test_package_analyte pa ON pa.item_id = i.id AND pa.analyte_id = ap.analyte_id
                    WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active' AND COALESCE(pa.included, true)) END AS analytes,
               CASE WHEN e.pricing_mode = 'Analyte Selection' THEN (SELECT count(*) FROM test_analyte_price ap WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active')::int END AS analytes_total
          FROM test_package_item i JOIN test t ON t.id = i.test_id JOIN test_catalog_entry e ON e.test_id = t.id
         WHERE i.package_id = p_package AND i.status = 'Active'),
    y AS (SELECT x.*, catalog_list_price(x.entry_id, x.analytes) AS lp FROM x)
    SELECT y.item_id, y.test_id, y.test_code, y.test_name, y.pricing_mode, y.sort_order, y.analytes,
           cardinality(y.analytes), y.analytes_total, y.lp, y.lp, y.component_price
      FROM y
$$;

-- the share of each test is its price in the package
CREATE OR REPLACE FUNCTION test_package_lines(p_package uuid)
RETURNS TABLE (item_id uuid, test_id uuid, test_code text, test_name text, pricing_mode text, sort_order integer,
               analytes uuid[], analytes_in integer, analytes_total integer, list_price numeric, value numeric,
               typed_price numeric, share numeric)
LANGUAGE sql STABLE AS $$
    SELECT v.item_id, v.test_id, v.test_code, v.test_name, v.pricing_mode, v.sort_order, v.analytes, v.analytes_in, v.analytes_total,
           v.list_price, v.value, v.typed_price, v.typed_price
      FROM test_package_values(p_package) v
$$;

-- The package price (per sample): the sum of its tests' prices
CREATE OR REPLACE FUNCTION test_package_price(p_package uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(component_price), 0) FROM test_package_item WHERE package_id = p_package AND status = 'Active'
$$;

-- What stops a package from being quoted (Error) or deserves a look (Warning)
CREATE OR REPLACE FUNCTION test_package_problems(p_package uuid) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v_n integer; v_price numeric; v_list numeric; r record;
BEGIN
    SELECT count(*), sum(list_price) INTO v_n, v_list FROM test_package_lines(p_package);
    v_price := test_package_price(p_package);
    IF v_n = 0 THEN severity := 'Error'; problem := 'The package has no tests'; RETURN NEXT; END IF;
    IF v_n = 1 THEN severity := 'Warning'; problem := 'The package has one test only'; RETURN NEXT; END IF;
    IF v_list IS NOT NULL AND v_price > v_list THEN
        severity := 'Warning'; problem := format('The package (%s) costs more than its tests on their own (%s)', v_price, v_list); RETURN NEXT;
    END IF;
    FOR r IN SELECT * FROM test_package_lines(p_package) WHERE typed_price > list_price ORDER BY sort_order, test_name LOOP
        severity := 'Warning'; problem := format('%s is priced at %s in the package, more than its catalogue price (%s)%s', r.test_name, r.typed_price, r.list_price,
            CASE WHEN r.analytes_in < r.analytes_total THEN ': analytes were left out, so lower its price' ELSE '' END); RETURN NEXT;
    END LOOP;
    FOR r IN SELECT * FROM test_package_lines(p_package) WHERE pricing_mode = 'Analyte Selection' AND analytes_in = 0 LOOP
        severity := 'Error'; problem := r.test_name || ': every analyte is left out'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT t.test_name FROM test_package_item i JOIN test t ON t.id = i.test_id
              WHERE i.package_id = p_package AND i.status = 'Active' AND (t.status <> 'Active' OR NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective')) LOOP
        severity := 'Warning'; problem := r.test_name || ' has no approved workflow yet: the package can be quoted, not ordered'; RETURN NEXT;
    END LOOP;
END $$;

CREATE VIEW test_package_view AS
SELECT x.*, GREATEST(COALESCE(x.list_value, 0) - x.package_price, 0) AS discount,
       CASE WHEN COALESCE(x.list_value, 0) > 0 AND x.package_price < x.list_value THEN round((1 - x.package_price / x.list_value) * 100, 1) ELSE 0 END AS discount_pct
  FROM (SELECT p.id, p.package_code, p.package_name, p.description, p.site_id, ls.site_code,
               p.show_in_public_catalogue, p.status::text AS status,
               (SELECT count(*) FROM test_package_item i WHERE i.package_id = p.id AND i.status = 'Active')::int AS test_count,
               (SELECT sum(list_price) FROM test_package_lines(p.id)) AS list_value,
               test_package_price(p.id) AS package_price,
               (SELECT string_agg(test_name, ', ' ORDER BY sort_order, test_name) FROM test_package_lines(p.id)) AS tests,
               (SELECT count(*) FROM test_package_problems(p.id) x WHERE x.severity = 'Error')::int AS errors,
               p.modified_at
          FROM test_package p JOIN lab_site ls ON ls.id = p.site_id) x;

-------------------------------------------------------------------------------
-- 4. DATED PRICE CHANGES: a test's price in each package moves with its catalogue price
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_catalog_price_change(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE c catalog_price_change; f numeric; d integer; n integer; m integer := 0;
BEGIN
    SELECT * INTO c FROM catalog_price_change WHERE id = p_id FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Price change not found'; END IF;
    IF c.status <> 'Scheduled' THEN RAISE EXCEPTION 'Price change % is %', c.change_code, lower(c.status); END IF;
    IF c.effective_on > site_today(c.site_id) THEN RAISE EXCEPTION 'Price change % starts on %', c.change_code, c.effective_on; END IF;
    f := 1 + c.pct / 100; d := CASE WHEN c.rounding = 'Dollar' THEN 0 ELSE 2 END;
    PERFORM set_config('lims.reason', 'Price change ' || c.change_code || ': ' || c.reason, true);
    UPDATE test_catalog_entry e SET base_price = round(e.base_price * f, d), prep_fee = round(e.prep_fee * f, d)
      FROM test t WHERE t.id = e.test_id AND t.status = 'Active' AND t.site_id = c.site_id AND (c.tests IS NULL OR e.test_id = ANY (c.tests));
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE test_analyte_price ap SET price = round(ap.price * f, d)
      FROM test_catalog_entry e JOIN test t ON t.id = e.test_id
     WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active' AND t.status = 'Active' AND t.site_id = c.site_id AND (c.tests IS NULL OR e.test_id = ANY (c.tests));
    IF c.include_packages THEN
        -- each test in the change is repriced in every active package of the lab (applied_packages = packages touched)
        WITH u AS (
            UPDATE test_package_item i SET component_price = round(i.component_price * f, d)
              FROM test_package p WHERE p.id = i.package_id AND i.status = 'Active' AND p.status = 'Active' AND p.site_id = c.site_id
               AND (c.tests IS NULL OR i.test_id = ANY (c.tests))
            RETURNING i.package_id)
        SELECT count(DISTINCT package_id) INTO m FROM u;
    END IF;
    UPDATE catalog_price_change SET status = 'Applied', applied_at = clock_timestamp(), applied_tests = n, applied_packages = m, last_error = NULL WHERE id = p_id;
    RETURN n;
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
