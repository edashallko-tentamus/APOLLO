-- P-1 Test packages and dated price changes (Alex, 2026-10-19: "Build the packages capability please").
-- Alex's decisions (vault: Decision - Test Packages and Dated Price Changes P-1):
--  - packages live in the Test Catalogue and are quoted without being rebuilt;
--  - a package is priced either at a fixed price or as the sum of its tests less a discount; analyte-priced tests can
--    have their analytes repriced (or left out) inside the package;
--  - one price for the package on the quote; each test carries its share (the component price), so tests are invoiced
--    as their reports are issued;
--  - cancelling a test takes off only that test's share; the package stays and the other tests keep their shares
--    (option B, Alex 2026-10-19, replacing option A's "break"), and the person cancelling sees the amount first;
--  - price increases: one test, a selection or the whole catalogue, by a percentage, rounded, from an effective date;
--    open quotes keep their prices.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 047: test packages and dated price changes', true);

-------------------------------------------------------------------------------
-- 1. PACKAGES IN THE CATALOGUE
-------------------------------------------------------------------------------
CREATE SEQUENCE test_package_seq;
CREATE TABLE test_package (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_code            text NOT NULL UNIQUE DEFAULT 'PKG-' || lpad(nextval('test_package_seq')::text, 4, '0'),
    site_id                 uuid NOT NULL REFERENCES lab_site(id),
    package_name            text NOT NULL CHECK (btrim(package_name) <> ''),
    description             text,
    pricing_mode            text NOT NULL DEFAULT 'Sum less discount' CHECK (pricing_mode IN ('Fixed price','Sum less discount')),
    fixed_price             numeric(12,2) CHECK (fixed_price >= 0),
    discount_pct            numeric(6,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    show_in_public_catalogue boolean NOT NULL DEFAULT false,
    status                  master_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX test_package_name_uq ON test_package (site_id, lower(btrim(package_name))) WHERE status = 'Active';
CALL make_gxp('test_package');

CREATE TABLE test_package_item (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    package_id          uuid NOT NULL REFERENCES test_package(id),
    test_id             uuid NOT NULL REFERENCES test(id),
    sort_order          integer NOT NULL DEFAULT 0,
    component_price     numeric(12,2) CHECK (component_price >= 0),   -- typed share of the package price (else worked out)
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX test_package_item_uq ON test_package_item (package_id, test_id) WHERE status = 'Active';
CALL make_gxp('test_package_item');

-- analyte-priced tests in a package: only the exceptions are stored (left out, or a package price for the analyte);
-- every other analyte of the test's catalogue entry is in, at its catalogue price
CREATE TABLE test_package_analyte (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id             uuid NOT NULL REFERENCES test_package_item(id),
    analyte_id          uuid NOT NULL REFERENCES analyte(id),
    included            boolean NOT NULL DEFAULT true,
    package_price       numeric(12,2) CHECK (package_price >= 0),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (item_id, analyte_id)
);
CALL make_gxp('test_package_analyte');

CREATE FUNCTION package_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.package_internal', true), '') = '1'
$$;

-- catalog.edit at the package's lab; a package stays with its lab; its tests are its lab's, active and priced
CREATE FUNCTION test_package_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_test uuid; v_mode text;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'test_package' THEN
        v_site := NEW.site_id;
        NEW.package_name := btrim(NEW.package_name);
        IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A package stays with its lab'; END IF;
        IF NEW.pricing_mode = 'Fixed price' AND NEW.fixed_price IS NULL THEN RAISE EXCEPTION 'Give the fixed price of the package'; END IF;
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
    ELSE
        SELECT p.site_id, i.test_id INTO v_site, v_test FROM test_package_item i JOIN test_package p ON p.id = i.package_id WHERE i.id = NEW.item_id;
        SELECT e.pricing_mode::text INTO v_mode FROM test_catalog_entry e WHERE e.test_id = v_test;
        IF v_mode <> 'Analyte Selection' THEN RAISE EXCEPTION 'Only an analyte-priced test has analytes to reprice in a package'; END IF;
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
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_package FOR EACH ROW EXECUTE FUNCTION test_package_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_package_item FOR EACH ROW EXECUTE FUNCTION test_package_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_package_analyte FOR EACH ROW EXECUTE FUNCTION test_package_rules();

-- Each test of a package with its prices:
--   list_price  the catalogue price of the analytes in it (what the test costs on its own today)
--   value       the same with the package's analyte prices (equal to list_price unless analytes are repriced)
--   share       the test's part of the package price: typed (all lines must be typed, adding up to the package
--               price), else in proportion to value, the last line taking the cents left over
CREATE FUNCTION test_package_values(p_package uuid)
RETURNS TABLE (item_id uuid, test_id uuid, test_code text, test_name text, pricing_mode text, sort_order integer,
               analytes uuid[], analytes_in integer, analytes_total integer, list_price numeric, value numeric, typed_price numeric)
LANGUAGE sql STABLE AS $$
    WITH x AS (
        SELECT i.id AS item_id, t.id AS test_id, t.test_code, t.test_name, e.pricing_mode::text AS pricing_mode, i.sort_order, e.id AS entry_id,
               e.base_price, e.prep_fee, i.component_price,
               CASE WHEN e.pricing_mode = 'Analyte Selection' THEN ARRAY(SELECT ap.analyte_id FROM test_analyte_price ap
                    LEFT JOIN test_package_analyte pa ON pa.item_id = i.id AND pa.analyte_id = ap.analyte_id
                    WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active' AND COALESCE(pa.included, true)) END AS analytes,
               CASE WHEN e.pricing_mode = 'Analyte Selection' THEN (SELECT count(*) FROM test_analyte_price ap WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active')::int END AS analytes_total
          FROM test_package_item i JOIN test t ON t.id = i.test_id JOIN test_catalog_entry e ON e.test_id = t.id
         WHERE i.package_id = p_package AND i.status = 'Active')
    SELECT x.item_id, x.test_id, x.test_code, x.test_name, x.pricing_mode, x.sort_order, x.analytes,
           cardinality(x.analytes), x.analytes_total, catalog_list_price(x.entry_id, x.analytes),
           CASE WHEN x.pricing_mode = 'Analyte Selection'
                THEN x.base_price + x.prep_fee + COALESCE((SELECT sum(COALESCE(pa.package_price, ap.price)) FROM test_analyte_price ap
                     LEFT JOIN test_package_analyte pa ON pa.item_id = x.item_id AND pa.analyte_id = ap.analyte_id
                     WHERE ap.catalog_entry_id = x.entry_id AND ap.status = 'Active' AND ap.analyte_id = ANY (x.analytes)), 0)
                ELSE catalog_list_price(x.entry_id) END,
           x.component_price
      FROM x
$$;

CREATE FUNCTION test_package_lines(p_package uuid)
RETURNS TABLE (item_id uuid, test_id uuid, test_code text, test_name text, pricing_mode text, sort_order integer,
               analytes uuid[], analytes_in integer, analytes_total integer, list_price numeric, value numeric,
               typed_price numeric, share numeric)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE p test_package; v_price numeric; v_sum numeric; v_typed boolean; v_left numeric; v_n integer; i integer := 0; r record;
BEGIN
    SELECT * INTO p FROM test_package WHERE id = p_package;
    SELECT sum(v.value), count(*), bool_and(v.typed_price IS NOT NULL) INTO v_sum, v_n, v_typed FROM test_package_values(p_package) v;
    v_price := CASE WHEN p.pricing_mode = 'Fixed price' THEN p.fixed_price ELSE round(COALESCE(v_sum, 0) * (1 - p.discount_pct / 100), 2) END;
    v_left := v_price;
    FOR r IN SELECT * FROM test_package_values(p_package) v ORDER BY v.sort_order, v.test_name LOOP
        i := i + 1;
        item_id := r.item_id; test_id := r.test_id; test_code := r.test_code; test_name := r.test_name; pricing_mode := r.pricing_mode;
        sort_order := r.sort_order; analytes := r.analytes; analytes_in := r.analytes_in; analytes_total := r.analytes_total;
        list_price := r.list_price; value := r.value; typed_price := r.typed_price;
        IF v_typed THEN share := r.typed_price;
        ELSIF i = v_n THEN share := v_left;
        ELSE share := CASE WHEN COALESCE(v_sum, 0) = 0 THEN round(v_price / v_n, 2) ELSE round(v_price * r.value / v_sum, 2) END;
        END IF;
        v_left := v_left - share;
        RETURN NEXT;
    END LOOP;
END $$;

-- The package price (per sample)
CREATE FUNCTION test_package_price(p_package uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p.pricing_mode = 'Fixed price' THEN p.fixed_price
                ELSE round(COALESCE((SELECT sum(v.value) FROM test_package_values(p.id) v), 0) * (1 - p.discount_pct / 100), 2) END
      FROM test_package p WHERE p.id = p_package
$$;

-- What stops a package from being quoted (Error) or deserves a look (Warning)
CREATE FUNCTION test_package_problems(p_package uuid) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE p test_package; v_n integer; v_typed integer; v_sum numeric; v_price numeric; v_list numeric; r record;
BEGIN
    SELECT * INTO p FROM test_package WHERE id = p_package;
    SELECT count(*), count(typed_price), sum(typed_price), sum(list_price) INTO v_n, v_typed, v_sum, v_list FROM test_package_lines(p_package);
    v_price := test_package_price(p_package);
    IF v_n = 0 THEN severity := 'Error'; problem := 'The package has no tests'; RETURN NEXT; END IF;
    IF v_n = 1 THEN severity := 'Warning'; problem := 'The package has one test only'; RETURN NEXT; END IF;
    IF v_typed > 0 AND v_typed < v_n THEN severity := 'Error'; problem := 'Type a price for every test, or for none (then the package price is shared out by value)'; RETURN NEXT; END IF;
    IF v_typed = v_n AND v_n > 0 AND v_sum <> v_price THEN
        severity := 'Error'; problem := format('The typed test prices add up to %s, not the package price %s', v_sum, v_price); RETURN NEXT;
    END IF;
    IF v_list IS NOT NULL AND v_price > v_list THEN
        severity := 'Warning'; problem := format('The package (%s) costs more than its tests on their own (%s)', v_price, v_list); RETURN NEXT;
    END IF;
    FOR r IN SELECT * FROM test_package_lines(p_package) WHERE pricing_mode = 'Analyte Selection' AND analytes_in = 0 LOOP
        severity := 'Error'; problem := r.test_name || ': every analyte is left out'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT t.test_name FROM test_package_item i JOIN test t ON t.id = i.test_id
              WHERE i.package_id = p_package AND i.status = 'Active' AND (t.status <> 'Active' OR NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective')) LOOP
        severity := 'Warning'; problem := r.test_name || ' has no approved workflow yet: the package can be quoted, not ordered'; RETURN NEXT;
    END LOOP;
END $$;

CREATE VIEW test_package_view AS
SELECT p.id, p.package_code, p.package_name, p.description, p.site_id, ls.site_code, p.pricing_mode, p.fixed_price, p.discount_pct,
       p.show_in_public_catalogue, p.status::text AS status,
       (SELECT count(*) FROM test_package_item i WHERE i.package_id = p.id AND i.status = 'Active')::int AS test_count,
       (SELECT sum(list_price) FROM test_package_lines(p.id)) AS list_value,
       test_package_price(p.id) AS package_price,
       (SELECT string_agg(test_name, ', ' ORDER BY sort_order, test_name) FROM test_package_lines(p.id)) AS tests,
       (SELECT count(*) FROM test_package_problems(p.id) x WHERE x.severity = 'Error')::int AS errors,
       p.modified_at
  FROM test_package p JOIN lab_site ls ON ls.id = p.site_id;

-------------------------------------------------------------------------------
-- 2. PACKAGES ON QUOTES
-------------------------------------------------------------------------------
CREATE TABLE quoted_package (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    package_id          uuid NOT NULL REFERENCES test_package(id),
    package_code        text NOT NULL,          -- as quoted
    package_name        text NOT NULL,
    quantity            integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    list_price          numeric(12,2) NOT NULL DEFAULT 0,   -- the tests' catalogue prices, per sample
    package_price       numeric(12,2) NOT NULL CHECK (package_price >= 0),   -- per sample
    status              line_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX quoted_package_uq ON quoted_package (project_version_id, package_id) WHERE status = 'Active';
CALL make_gxp('quoted_package', false);

ALTER TABLE quoted_test_configuration ADD COLUMN quoted_package_id uuid REFERENCES quoted_package(id);
DROP INDEX qtc_one_per_test;
CREATE UNIQUE INDEX qtc_one_per_test ON quoted_test_configuration (project_version_id, test_id) WHERE status = 'Active' AND quoted_package_id IS NULL;
CREATE UNIQUE INDEX qtc_one_per_package_test ON quoted_test_configuration (quoted_package_id, test_id) WHERE status = 'Active' AND quoted_package_id IS NOT NULL;

-- a package's tests on a quote are changed only through the package (its price, quantity, removal)
CREATE FUNCTION qtc_package_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF package_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.quoted_package_id IS NOT NULL THEN RAISE EXCEPTION 'Add a package to a quote as a package'; END IF;
    IF TG_OP = 'UPDATE' AND (OLD.quoted_package_id IS NOT NULL OR NEW.quoted_package_id IS NOT NULL) THEN
        IF NEW.quoted_package_id IS DISTINCT FROM OLD.quoted_package_id THEN RAISE EXCEPTION 'A quoted test stays in or out of its package'; END IF;
        RAISE EXCEPTION 'This test is part of package %: change the package''s price or quantity, or remove the package',
            (SELECT package_code FROM quoted_package WHERE id = OLD.quoted_package_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_package BEFORE INSERT OR UPDATE ON quoted_test_configuration FOR EACH ROW EXECUTE FUNCTION qtc_package_lock();

CREATE FUNCTION qas_package_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF package_internal() THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM quoted_test_configuration q WHERE q.id = NEW.line_id AND q.quoted_package_id IS NOT NULL) THEN
        RAISE EXCEPTION 'The analytes of a test in a package are set in the package (Test catalogue)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_package BEFORE UPDATE ON quoted_analyte_selection FOR EACH ROW EXECUTE FUNCTION qas_package_lock();

CREATE FUNCTION quoted_package_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT package_internal() THEN RAISE EXCEPTION 'A package on a quote is added, priced and removed through the quote page'; END IF;
    IF NOT version_is_editable(NEW.project_version_id) THEN RAISE EXCEPTION 'Packages are locked once a version is quoted; create a new version'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.project_version_id, NEW.package_id) IS DISTINCT FROM (OLD.project_version_id, OLD.package_id) THEN
        RAISE EXCEPTION 'A quoted package stays with its quote and package';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_rules BEFORE INSERT OR UPDATE ON quoted_package FOR EACH ROW EXECUTE FUNCTION quoted_package_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON quoted_package FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');

-- share a new package price out over its tests, in proportion to their current prices (the last takes the cents left)
CREATE FUNCTION quoted_package_allocate(p_qp uuid, p_price numeric) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_sum numeric; v_n integer; v_left numeric := p_price; i integer := 0; r record; v_share numeric;
BEGIN
    SELECT sum(COALESCE(final_price, 0)), count(*) INTO v_sum, v_n FROM quoted_test_configuration WHERE quoted_package_id = p_qp AND status = 'Active';
    FOR r IN SELECT q.id, COALESCE(q.final_price, 0) AS fp, t.test_name FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.quoted_package_id = p_qp AND q.status = 'Active' ORDER BY q.created_at, t.test_name LOOP
        i := i + 1;
        v_share := CASE WHEN i = v_n THEN v_left WHEN COALESCE(v_sum, 0) = 0 THEN round(p_price / v_n, 2) ELSE round(p_price * r.fp / v_sum, 2) END;
        IF v_share < 0 THEN v_share := 0; END IF;
        UPDATE quoted_test_configuration SET final_price = v_share WHERE id = r.id;
        v_left := v_left - v_share;
    END LOOP;
END $$;

-- Add a catalogue package to a quote version: its tests become lines of the package, each at its share
CREATE FUNCTION add_package_to_quote(p_version uuid, p_package uuid, p_quantity integer DEFAULT 1) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE p test_package; v_proj project; v_qp uuid; v_line uuid; r record;
BEGIN
    SELECT * INTO p FROM test_package WHERE id = p_package;
    IF p.id IS NULL OR p.status <> 'Active' THEN RAISE EXCEPTION 'That package is retired or does not exist'; END IF;
    SELECT pr.* INTO v_proj FROM project_version pv JOIN project pr ON pr.id = pv.project_id WHERE pv.id = p_version;
    IF v_proj.id IS NULL THEN RAISE EXCEPTION 'Quote version not found'; END IF;
    IF NOT version_is_editable(p_version) THEN RAISE EXCEPTION 'Packages are locked once a version is quoted; create a new version'; END IF;
    IF v_proj.kind = 'Stability' THEN RAISE EXCEPTION 'A stability quote is priced by its study design, not by packages'; END IF;
    IF v_proj.is_list_price_acceptance THEN RAISE EXCEPTION 'A list-price acceptance has no packages (each test is at its list price)'; END IF;
    IF v_proj.site_id IS DISTINCT FROM p.site_id THEN
        RAISE EXCEPTION 'Package % belongs to %; this quote is made at %', p.package_code, (SELECT site_code FROM lab_site WHERE id = p.site_id),
            COALESCE((SELECT site_code FROM lab_site WHERE id = v_proj.site_id), 'no lab');
    END IF;
    IF EXISTS (SELECT 1 FROM test_package_problems(p_package) x WHERE x.severity = 'Error') THEN
        RAISE EXCEPTION 'Package % cannot be quoted yet: %', p.package_code, (SELECT string_agg(problem, '; ') FROM test_package_problems(p_package) x WHERE x.severity = 'Error');
    END IF;
    IF EXISTS (SELECT 1 FROM quoted_package WHERE project_version_id = p_version AND package_id = p_package AND status = 'Active') THEN
        RAISE EXCEPTION 'Package % is already on this quote; change its quantity instead', p.package_code;
    END IF;
    PERFORM set_config('lims.package_internal', '1', true);
    INSERT INTO quoted_package (project_version_id, package_id, package_code, package_name, quantity, package_price)
    VALUES (p_version, p_package, p.package_code, p.package_name, GREATEST(COALESCE(p_quantity, 1), 1), test_package_price(p_package)) RETURNING id INTO v_qp;
    FOR r IN SELECT * FROM test_package_lines(p_package) ORDER BY sort_order, test_name LOOP
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, quoted_package_id)
        VALUES (p_version, r.test_id, GREATEST(COALESCE(p_quantity, 1), 1), v_qp) RETURNING id INTO v_line;
        IF r.pricing_mode = 'Analyte Selection' THEN
            UPDATE quoted_analyte_selection SET included = false WHERE line_id = v_line AND NOT (analyte_id = ANY (r.analytes));
        END IF;
        UPDATE quoted_test_configuration SET final_price = r.share WHERE id = v_line;
    END LOOP;
    UPDATE quoted_package qp SET list_price = (SELECT COALESCE(sum(list_price), 0) FROM quoted_test_configuration q WHERE q.quoted_package_id = v_qp AND q.status = 'Active')
     WHERE qp.id = v_qp;
    PERFORM set_config('lims.package_internal', '', true);
    RETURN v_qp;
END $$;

-- Change a quoted package's price (shared out again) or quantity
CREATE FUNCTION set_quoted_package(p_qp uuid, p_price numeric, p_quantity integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE qp quoted_package;
BEGIN
    SELECT * INTO qp FROM quoted_package WHERE id = p_qp;
    IF qp.id IS NULL OR qp.status <> 'Active' THEN RAISE EXCEPTION 'Package not found on the quote'; END IF;
    IF p_price IS NOT NULL AND p_price < 0 THEN RAISE EXCEPTION 'The package price cannot be negative'; END IF;
    IF p_quantity IS NOT NULL AND p_quantity < 1 THEN RAISE EXCEPTION 'The quantity is at least 1'; END IF;
    PERFORM set_config('lims.package_internal', '1', true);
    UPDATE quoted_package SET package_price = COALESCE(p_price, package_price), quantity = COALESCE(p_quantity, quantity) WHERE id = p_qp;
    IF p_quantity IS NOT NULL THEN UPDATE quoted_test_configuration SET quantity = p_quantity WHERE quoted_package_id = p_qp AND status = 'Active'; END IF;
    IF p_price IS NOT NULL AND p_price <> qp.package_price THEN PERFORM quoted_package_allocate(p_qp, p_price); END IF;
    PERFORM set_config('lims.package_internal', '', true);
END $$;

CREATE FUNCTION remove_quoted_package(p_qp uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM quoted_package WHERE id = p_qp AND status = 'Active') THEN RAISE EXCEPTION 'Package not found on the quote'; END IF;
    PERFORM set_config('lims.package_internal', '1', true);
    UPDATE quoted_test_configuration SET status = 'Removed' WHERE quoted_package_id = p_qp AND status = 'Active';
    UPDATE quoted_package SET status = 'Removed' WHERE id = p_qp;
    PERFORM set_config('lims.package_internal', '', true);
END $$;

-- A new version copies its packages too (the negotiated package price and each test's share are kept; list prices
-- are refreshed from the catalogue). Copied from 031 with the package lines left to the package copy.
CREATE OR REPLACE FUNCTION new_project_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_new uuid; v_prev uuid; r record; v_line uuid; qp record; v_qp uuid;
BEGIN
    SELECT id INTO v_prev FROM project_version WHERE project_id = p_project ORDER BY version_no DESC LIMIT 1;
    INSERT INTO project_version (project_id, version_no) VALUES (p_project, 0) RETURNING id INTO v_new;
    IF v_prev IS NOT NULL THEN
        FOR r IN SELECT l.* FROM quoted_test_configuration l JOIN test t ON t.id = l.test_id
                  WHERE l.project_version_id = v_prev AND l.status = 'Active' AND t.status = 'Active' AND l.quoted_package_id IS NULL LOOP
            INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, special_instructions)
            VALUES (v_new, r.test_id, r.quantity, r.special_instructions) RETURNING id INTO v_line;
            UPDATE quoted_analyte_selection s SET included = false
             WHERE s.line_id = v_line AND EXISTS (SELECT 1 FROM quoted_analyte_selection o
                                                   WHERE o.line_id = r.id AND o.analyte_id = s.analyte_id AND NOT o.included);
            UPDATE quoted_test_configuration q
               SET final_price = CASE WHEN r.final_price IS NULL OR r.list_price = 0 THEN r.final_price
                                      ELSE round(q.list_price * r.final_price / r.list_price, 2) END
             WHERE q.id = v_line;
            INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value, text_value, unit, source, basis, copied_from_spec_id)
            SELECT v_line, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.basis, s.id
              FROM specification s WHERE s.quoted_line_id = r.id AND s.status = 'Active';
        END LOOP;
        PERFORM set_config('lims.package_internal', '1', true);
        FOR qp IN SELECT x.* FROM quoted_package x JOIN test_package p ON p.id = x.package_id
                   WHERE x.project_version_id = v_prev AND x.status = 'Active' AND p.status = 'Active' LOOP
            INSERT INTO quoted_package (project_version_id, package_id, package_code, package_name, quantity, package_price)
            VALUES (v_new, qp.package_id, qp.package_code, qp.package_name, qp.quantity, qp.package_price) RETURNING id INTO v_qp;
            FOR r IN SELECT l.* FROM quoted_test_configuration l JOIN test t ON t.id = l.test_id
                      WHERE l.quoted_package_id = qp.id AND l.status = 'Active' AND t.status = 'Active' ORDER BY l.created_at LOOP
                INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, special_instructions, quoted_package_id)
                VALUES (v_new, r.test_id, r.quantity, r.special_instructions, v_qp) RETURNING id INTO v_line;
                UPDATE quoted_analyte_selection s SET included = false
                 WHERE s.line_id = v_line AND EXISTS (SELECT 1 FROM quoted_analyte_selection o
                                                       WHERE o.line_id = r.id AND o.analyte_id = s.analyte_id AND NOT o.included);
                UPDATE quoted_test_configuration q SET final_price = r.final_price WHERE q.id = v_line;
                INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value, text_value, unit, source, basis, copied_from_spec_id)
                SELECT v_line, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.basis, s.id
                  FROM specification s WHERE s.quoted_line_id = r.id AND s.status = 'Active';
            END LOOP;
            -- a test retired since: its share leaves the package price
            UPDATE quoted_package x SET package_price = (SELECT COALESCE(sum(final_price), 0) FROM quoted_test_configuration q WHERE q.quoted_package_id = v_qp AND q.status = 'Active'),
                   list_price = (SELECT COALESCE(sum(list_price), 0) FROM quoted_test_configuration q WHERE q.quoted_package_id = v_qp AND q.status = 'Active')
             WHERE x.id = v_qp;
        END LOOP;
        PERFORM set_config('lims.package_internal', '', true);
        UPDATE quote_rush_term n SET discount_pct = o.discount_pct
          FROM quote_rush_term o WHERE n.project_version_id = v_new AND o.project_version_id = v_prev AND o.tier_id = n.tier_id;
    END IF;
    RETURN v_new;
END $$;

-------------------------------------------------------------------------------
-- 3. ORDERING A PACKAGE, AND CANCELLING PART OF IT
-------------------------------------------------------------------------------
-- A package's tests are not ordered one by one: orderable_lines leaves them out, except while order_package runs.
-- Copied from 032 with that one condition.
CREATE OR REPLACE FUNCTION orderable_lines(p_client uuid)
RETURNS TABLE (line_id uuid, project_code text, project_name text, test_id uuid,
               test_name text, final_price numeric, via_parent boolean)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE anc AS (
        SELECT parent_client_id AS id FROM client WHERE id = p_client AND parent_client_id IS NOT NULL
        UNION
        SELECT c.parent_client_id FROM client c JOIN anc ON c.id = anc.id WHERE c.parent_client_id IS NOT NULL
    )
    SELECT l.id, p.project_code, p.project_name, t.id, t.test_name, l.final_price, p.client_id <> p_client
      FROM project p
      JOIN project_version pv ON pv.project_id = p.id AND pv.status = 'Accepted'
                             AND (pv.valid_until IS NULL OR pv.valid_until >= current_date)
      JOIN quoted_test_configuration l ON l.project_version_id = pv.id AND l.status = 'Active'
      JOIN test t ON t.id = l.test_id AND t.status = 'Active'
     WHERE p.status = 'Active' AND p.kind <> 'Stability'
       AND (l.quoted_package_id IS NULL OR l.quoted_package_id::text = COALESCE(current_setting('lims.ordering_package_qp', true), ''))
       AND (p.client_id = p_client OR (p.available_to_child_clients AND p.client_id IN (SELECT id FROM anc)))
$$;

-- The packages a client can order: on an accepted, unexpired quote of theirs (or a parent's, when shared)
CREATE FUNCTION orderable_packages(p_client uuid)
RETURNS TABLE (quoted_package_id uuid, package_id uuid, package_code text, package_name text, project_id uuid, project_code text, project_name text,
               project_version_id uuid, version_no integer, site_id uuid, package_price numeric, list_price numeric, test_count integer, tests text, via_parent boolean)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE anc AS (
        SELECT parent_client_id AS id FROM client WHERE id = p_client AND parent_client_id IS NOT NULL
        UNION
        SELECT c.parent_client_id FROM client c JOIN anc ON c.id = anc.id WHERE c.parent_client_id IS NOT NULL
    )
    SELECT qp.id, qp.package_id, qp.package_code, qp.package_name, p.id, p.project_code, p.project_name, pv.id, pv.version_no, p.site_id,
           qp.package_price, qp.list_price,
           (SELECT count(*) FROM quoted_test_configuration q WHERE q.quoted_package_id = qp.id AND q.status = 'Active')::int,
           (SELECT string_agg(t.test_name, ', ' ORDER BY q.created_at) FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id WHERE q.quoted_package_id = qp.id AND q.status = 'Active'),
           p.client_id <> p_client
      FROM project p
      JOIN project_version pv ON pv.project_id = p.id AND pv.status = 'Accepted' AND (pv.valid_until IS NULL OR pv.valid_until >= current_date)
      JOIN quoted_package qp ON qp.project_version_id = pv.id AND qp.status = 'Active'
     WHERE p.status = 'Active' AND p.kind <> 'Stability'
       AND (p.client_id = p_client OR (p.available_to_child_clients AND p.client_id IN (SELECT id FROM anc)))
$$;

CREATE SEQUENCE ordered_package_seq;
-- Alex (2026-10-19, option B): a package is never "broken". Each of its tests is billed at its share of the package
-- price, so cancelling one takes off only that test's share; the other tests keep their shares (and the discount).
-- The status only says how much of it is left: Intact, Partly cancelled or Cancelled.
CREATE TABLE ordered_package (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_package_code  text NOT NULL UNIQUE DEFAULT 'OP-' || lpad(nextval('ordered_package_seq')::text, 6, '0'),
    sample_id           uuid NOT NULL REFERENCES sample(id),
    quoted_package_id   uuid NOT NULL REFERENCES quoted_package(id),
    package_id          uuid NOT NULL REFERENCES test_package(id),
    status              text NOT NULL DEFAULT 'Intact' CHECK (status IN ('Intact','Partly cancelled','Cancelled')),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX ordered_package_sample_idx ON ordered_package (sample_id);
CALL make_gxp('ordered_package', false);
CREATE FUNCTION ordered_package_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT package_internal() THEN RAISE EXCEPTION 'A package on an order is ordered or cancelled through its tests'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.sample_id, NEW.quoted_package_id, NEW.package_id) IS DISTINCT FROM (OLD.sample_id, OLD.quoted_package_id, OLD.package_id) THEN
        RAISE EXCEPTION 'An ordered package stays with its sample and quote';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_rules BEFORE INSERT OR UPDATE ON ordered_package FOR EACH ROW EXECUTE FUNCTION ordered_package_rules();

ALTER TABLE requested_test ADD COLUMN ordered_package_id uuid REFERENCES ordered_package(id);
CREATE INDEX requested_test_package_idx ON requested_test (ordered_package_id) WHERE ordered_package_id IS NOT NULL;

-- Runs after requested_test_derive: a package's test is marked as such when it is ordered (its price is its share of
-- the package price, from the quoted line), and stays in its package
CREATE FUNCTION requested_test_package() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q quoted_test_configuration; op ordered_package; v_qp text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO q FROM quoted_test_configuration WHERE id = NEW.quoted_line_id;
        IF q.quoted_package_id IS NOT NULL THEN
            v_qp := COALESCE(current_setting('lims.ordering_package', true), '');
            IF v_qp = '' AND (NEW.retest_of_id IS NOT NULL OR NEW.source <> 'Quote') THEN RETURN NEW; END IF;   -- a retest of a package's test: on its own
            IF v_qp = '' THEN RAISE EXCEPTION 'This test is part of a package: order the package'; END IF;
            SELECT * INTO op FROM ordered_package WHERE id = v_qp::uuid;
            IF op.quoted_package_id IS DISTINCT FROM q.quoted_package_id OR op.sample_id IS DISTINCT FROM NEW.sample_id THEN
                RAISE EXCEPTION 'This test belongs to another package';
            END IF;
            NEW.ordered_package_id := op.id;
        ELSIF NEW.ordered_package_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only a package''s own tests belong to it';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.ordered_package_id IS DISTINCT FROM OLD.ordered_package_id THEN RAISE EXCEPTION 'A test stays in or out of its package'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_requested_test_package BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_package();

-- A test of a package cancelled (or brought back): the package's status follows. No other test's price changes.
CREATE FUNCTION requested_test_package_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_all integer; v_cancelled integer;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE status = 'Cancelled') INTO v_all, v_cancelled FROM requested_test WHERE ordered_package_id = NEW.ordered_package_id;
    PERFORM set_config('lims.package_internal', '1', true);
    UPDATE ordered_package SET status = CASE WHEN v_cancelled = 0 THEN 'Intact' WHEN v_cancelled < v_all THEN 'Partly cancelled' ELSE 'Cancelled' END
     WHERE id = NEW.ordered_package_id
       AND status IS DISTINCT FROM CASE WHEN v_cancelled = 0 THEN 'Intact' WHEN v_cancelled < v_all THEN 'Partly cancelled' ELSE 'Cancelled' END;
    PERFORM set_config('lims.package_internal', '', true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_package_status AFTER UPDATE OF status ON requested_test FOR EACH ROW
    WHEN (NEW.status IS DISTINCT FROM OLD.status AND (NEW.status = 'Cancelled' OR OLD.status = 'Cancelled') AND NEW.ordered_package_id IS NOT NULL)
    EXECUTE FUNCTION requested_test_package_status();

-- Order a quoted package on a sample: every test of it, at its share of the package price
CREATE FUNCTION order_package(p_sample uuid, p_qp uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; qp quoted_package; v_op uuid; r record; v_rt uuid; v_dupe text;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sample not found'; END IF;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    IF NOT EXISTS (SELECT 1 FROM orderable_packages(o.client_id) x WHERE x.quoted_package_id = p_qp) THEN
        RAISE EXCEPTION 'This package is not on an accepted quote for this client';
    END IF;
    SELECT * INTO qp FROM quoted_package WHERE id = p_qp;
    IF (SELECT site_id FROM test_package WHERE id = qp.package_id) <> o.site_id THEN
        RAISE EXCEPTION 'Package % is another lab''s; order it at that lab', qp.package_code;
    END IF;
    SELECT string_agg(t.test_name, ', ') INTO v_dupe FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
     WHERE q.quoted_package_id = p_qp AND q.status = 'Active'
       AND EXISTS (SELECT 1 FROM requested_test rq WHERE rq.sample_id = p_sample AND rq.test_id = q.test_id AND rq.status <> 'Cancelled');
    IF v_dupe IS NOT NULL THEN
        RAISE EXCEPTION 'The sample already has % ordered: cancel it first, or order the package''s other tests one by one from a quote', v_dupe;
    END IF;
    PERFORM set_config('lims.package_internal', '1', true);
    INSERT INTO ordered_package (sample_id, quoted_package_id, package_id) VALUES (p_sample, p_qp, qp.package_id) RETURNING id INTO v_op;
    PERFORM set_config('lims.package_internal', '', true);
    PERFORM set_config('lims.ordering_package', v_op::text, true);
    PERFORM set_config('lims.ordering_package_qp', p_qp::text, true);
    FOR r IN SELECT q.id FROM quoted_test_configuration q WHERE q.quoted_package_id = p_qp AND q.status = 'Active' ORDER BY q.created_at LOOP
        v_rt := order_test(p_sample, r.id);
    END LOOP;
    PERFORM set_config('lims.ordering_package', '', true);
    PERFORM set_config('lims.ordering_package_qp', '', true);
    RETURN v_op;
END $$;

-- Cancel the whole package on a sample (every test still open)
CREATE FUNCTION cancel_ordered_package(p_op uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE op ordered_package; n integer;
BEGIN
    SELECT * INTO op FROM ordered_package WHERE id = p_op;
    IF op.id IS NULL THEN RAISE EXCEPTION 'Package not found on the sample'; END IF;
    IF op.status = 'Cancelled' THEN RAISE EXCEPTION 'The package is already cancelled'; END IF;
    UPDATE requested_test SET status = 'Cancelled' WHERE ordered_package_id = p_op AND status <> 'Cancelled';
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-- What cancelling a test of a package takes off (shown before the person confirms): its share; the rest stay as they are
CREATE FUNCTION package_cancel_preview(p_rt uuid)
RETURNS TABLE (package_code text, package_name text, sample_code text, test_name text, package_price numeric, share numeric,
               still_charged numeric, remaining_tests integer)
LANGUAGE sql STABLE AS $$
    SELECT qp.package_code, qp.package_name, COALESCE(sm.sample_code, sm.client_sample_id), t.test_name, qp.package_price, r0.price,
           (SELECT COALESCE(sum(r.price), 0) FROM requested_test r WHERE r.ordered_package_id = r0.ordered_package_id AND r.status <> 'Cancelled' AND r.id <> r0.id),
           (SELECT count(*) FROM requested_test r WHERE r.ordered_package_id = r0.ordered_package_id AND r.status <> 'Cancelled' AND r.id <> r0.id)::int
      FROM requested_test r0 JOIN ordered_package op ON op.id = r0.ordered_package_id JOIN quoted_package qp ON qp.id = op.quoted_package_id
      JOIN sample sm ON sm.id = r0.sample_id JOIN test t ON t.id = r0.test_id
     WHERE r0.id = p_rt AND r0.status <> 'Cancelled'
$$;

-- Applying a project orders its packages too (as packages, first); copied from 031 with the package loop
CREATE OR REPLACE FUNCTION apply_project(p_sample uuid, p_project uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; r record; n integer := 0;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    -- the project's packages first (a test in a package is ordered in it, not on its own)
    FOR r IN SELECT x.quoted_package_id, x.test_count FROM orderable_packages(o.client_id) x WHERE x.project_id = p_project AND x.site_id = o.site_id LOOP
        IF NOT EXISTS (SELECT 1 FROM quoted_test_configuration q JOIN requested_test rt ON rt.test_id = q.test_id AND rt.sample_id = p_sample AND rt.status <> 'Cancelled'
                        WHERE q.quoted_package_id = r.quoted_package_id AND q.status = 'Active') THEN
            PERFORM order_package(p_sample, r.quoted_package_id); n := n + r.test_count;
        END IF;
    END LOOP;
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
                              JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = p_project)
             AND NOT EXISTS (SELECT 1 FROM orderable_packages(o.client_id) x WHERE x.project_id = p_project) THEN
        RAISE EXCEPTION 'That project has no accepted, orderable tests for this client';
    END IF;
    RETURN n;
END $$;

-- The invoice line says which package a test was part of, and its share (copied from 036)
CREATE OR REPLACE FUNCTION invoice_line_text(p_rt uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT concat_ws(' ',
        CASE WHEN r.retest_of_id IS NOT NULL THEN
            'Retest of ' || (SELECT s0.sample_code || ' ' || t0.test_name FROM requested_test r0 JOIN sample s0 ON s0.id = r0.sample_id JOIN test t0 ON t0.id = r0.test_id WHERE r0.id = r.retest_of_id)
            || COALESCE(' (' || (SELECT x.oos_code FROM oos_investigation x WHERE x.id = r.oos_investigation_id) || ')', '')
            || CASE WHEN r.source = 'Lab Investigation Retest' THEN ', ordered by the lab'
                    WHEN r.source = 'Client OOS Retest' THEN ', ordered by the client' ELSE '' END
            || CASE WHEN r.billing_status = 'Non-billable' THEN ': not charged.' ELSE '.' END END,
        CASE WHEN EXISTS (SELECT 1 FROM requested_test r2 WHERE r2.retest_of_id = r.id AND r2.status <> 'Cancelled') AND test_reported_at(r.id) IS NULL
             THEN 'Retested; the result was reported from the retest.' END,
        CASE WHEN r.stability_pull_id IS NOT NULL THEN COALESCE((SELECT 'Stability study ' || st.study_code || ', ' || tp.label || ' pull.' FROM stability_pull p
             JOIN stability_study st ON st.id = p.study_id JOIN stability_timepoint tp ON tp.id = p.timepoint_id WHERE p.id = r.stability_pull_id), 'Stability pull.') END,
        CASE WHEN r.ordered_package_id IS NOT NULL THEN
             (SELECT 'Part of package ' || qp.package_code || ' ' || qp.package_name || ' (' || to_char(qp.package_price, 'FM999999990.00') || ' per sample'
                     || CASE WHEN op.status = 'Partly cancelled' THEN '; tests cancelled from it are not charged' ELSE '' END || '): this test''s share.'
                FROM ordered_package op JOIN quoted_package qp ON qp.id = op.quoted_package_id WHERE op.id = r.ordered_package_id) END)
      FROM requested_test r WHERE r.id = p_rt
$$;

-------------------------------------------------------------------------------
-- 4. DATED PRICE CHANGES
-------------------------------------------------------------------------------
CREATE SEQUENCE catalog_price_change_seq;
CREATE TABLE catalog_price_change (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    change_code         text NOT NULL UNIQUE DEFAULT 'PC-' || lpad(nextval('catalog_price_change_seq')::text, 4, '0'),
    site_id             uuid NOT NULL REFERENCES lab_site(id),          -- the lab it was scheduled in (its calendar decides "today")
    tests               uuid[],                                          -- NULL: every active test
    pct                 numeric(7,2) NOT NULL CHECK (pct > -90 AND pct <= 500 AND pct <> 0),
    rounding            text NOT NULL DEFAULT 'Cent' CHECK (rounding IN ('Cent','Dollar')),
    include_packages    boolean NOT NULL DEFAULT true,                   -- fixed-price packages whose tests are all in it
    effective_on        date NOT NULL,
    status              text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Applied','Cancelled')),
    reason              text NOT NULL CHECK (btrim(reason) <> ''),
    applied_at          timestamptz,
    applied_tests       integer,
    applied_packages    integer,
    last_error          text,
    cancelled_at        timestamptz,
    cancelled_by        uuid REFERENCES app_user(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('catalog_price_change');
CREATE FUNCTION catalog_price_change_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- the hourly job records why a change could not be applied (only that)
    IF TG_OP = 'UPDATE' AND NEW.last_error IS DISTINCT FROM OLD.last_error
       AND (to_jsonb(NEW) - '{last_error,record_version,modified_at,modified_by}'::text[]) = (to_jsonb(OLD) - '{last_error,record_version,modified_at,modified_by}'::text[]) THEN
        RETURN NEW;
    END IF;
    PERFORM require_permission_at('catalog.edit', NEW.site_id);
    IF TG_OP = 'INSERT' THEN
        IF NEW.effective_on < site_today(NEW.site_id) THEN RAISE EXCEPTION 'A price change starts today or later'; END IF;
        IF NEW.tests IS NOT NULL AND cardinality(NEW.tests) = 0 THEN RAISE EXCEPTION 'Choose the tests, or every test'; END IF;
        IF NEW.tests IS NOT NULL AND EXISTS (SELECT 1 FROM test t WHERE t.id = ANY (NEW.tests) AND t.site_id IS DISTINCT FROM NEW.site_id) THEN
            RAISE EXCEPTION 'A price change covers its own lab''s tests only';
        END IF;
        NEW.status := 'Scheduled';
        RETURN NEW;
    END IF;
    IF (NEW.tests, NEW.pct, NEW.rounding, NEW.include_packages, NEW.site_id) IS DISTINCT FROM (OLD.tests, OLD.pct, OLD.rounding, OLD.include_packages, OLD.site_id) THEN
        RAISE EXCEPTION 'A scheduled price change is not edited: cancel it and schedule another';
    END IF;
    IF OLD.status <> 'Scheduled' AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'An % price change does not change', lower(OLD.status); END IF;
    IF NEW.status = 'Cancelled' AND OLD.status = 'Scheduled' THEN NEW.cancelled_at := clock_timestamp(); NEW.cancelled_by := current_app_user(); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON catalog_price_change FOR EACH ROW EXECUTE FUNCTION catalog_price_change_rules();

-- Apply a scheduled change on or after its date: each part of a test's price (base, preparation fee, analyte prices)
-- moves by the percentage, rounded to the cent or the dollar; fixed-price packages of those tests too. Quotes already
-- made keep their prices. Runs as the person who scheduled it (their catalog.edit), with its reason.
CREATE FUNCTION apply_catalog_price_change(p_id uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE c catalog_price_change; f numeric; d integer; n integer; m integer := 0; pk record;
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
        UPDATE test_package p SET fixed_price = round(p.fixed_price * f, d)
         WHERE p.status = 'Active' AND p.pricing_mode = 'Fixed price' AND p.site_id = c.site_id
           AND (c.tests IS NULL OR NOT EXISTS (SELECT 1 FROM test_package_item i WHERE i.package_id = p.id AND i.status = 'Active' AND NOT (i.test_id = ANY (c.tests))));
        GET DIAGNOSTICS m = ROW_COUNT;
        -- typed test prices in those packages move the same way (they must still add up: the last one takes the cents)
        UPDATE test_package_item i SET component_price = round(i.component_price * f, d)
          FROM test_package p WHERE p.id = i.package_id AND i.component_price IS NOT NULL AND i.status = 'Active' AND p.status = 'Active' AND p.site_id = c.site_id
           AND (p.pricing_mode = 'Sum less discount' OR c.tests IS NULL OR NOT EXISTS (SELECT 1 FROM test_package_item i2 WHERE i2.package_id = p.id AND i2.status = 'Active' AND NOT (i2.test_id = ANY (c.tests))))
           AND (c.tests IS NULL OR i.test_id = ANY (c.tests));
        -- typed prices that must add up to the package price: the last test takes the cents rounding left over
        FOR pk IN SELECT p.id FROM test_package p WHERE p.status = 'Active' AND p.site_id = c.site_id
                     AND NOT EXISTS (SELECT 1 FROM test_package_item i WHERE i.package_id = p.id AND i.status = 'Active' AND i.component_price IS NULL)
                     AND EXISTS (SELECT 1 FROM test_package_item i WHERE i.package_id = p.id AND i.status = 'Active') LOOP
            UPDATE test_package_item i SET component_price = i.component_price + (test_package_price(pk.id) - (SELECT sum(component_price) FROM test_package_item WHERE package_id = pk.id AND status = 'Active'))
             WHERE i.id = (SELECT i2.id FROM test_package_item i2 JOIN test t ON t.id = i2.test_id WHERE i2.package_id = pk.id AND i2.status = 'Active' ORDER BY i2.sort_order DESC, t.test_name DESC LIMIT 1)
               AND test_package_price(pk.id) <> (SELECT sum(component_price) FROM test_package_item WHERE package_id = pk.id AND status = 'Active');
        END LOOP;
    END IF;
    UPDATE catalog_price_change SET status = 'Applied', applied_at = clock_timestamp(), applied_tests = n, applied_packages = m, last_error = NULL WHERE id = p_id;
    RETURN n;
END $$;

-- The scheduled changes due today or before, oldest first (the server applies them every hour as their schedulers)
CREATE VIEW catalog_price_change_due AS
SELECT c.id, c.change_code, c.site_id, c.created_by FROM catalog_price_change c
 WHERE c.status = 'Scheduled' AND c.effective_on <= site_today(c.site_id) ORDER BY c.effective_on, c.created_at;

-- the catalogue list gains its lab, so a price change can be scheduled for the lab's own tests (columns added at the end)
CREATE OR REPLACE VIEW test_catalogue AS
SELECT t.id AS test_id, e.id AS catalog_entry_id, t.test_code, t.test_name, t.status AS test_status,
       e.description, e.pricing_mode, e.base_price,
       CASE WHEN e.pricing_mode = 'Base Price Only' THEN 0 ELSE e.prep_fee END AS prep_fee,
       catalog_list_price(e.id) AS list_price,
       (SELECT count(*) FROM test_analyte_price ap WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active') AS analyte_count,
       e.standard_tat, e.tat_unit, e.cutoff_time, s.schedule_name AS rush_schedule, e.show_in_public_catalogue,
       t.site_id, ls.site_code
  FROM test t
  JOIN test_catalog_entry e ON e.test_id = t.id
  LEFT JOIN lab_site ls ON ls.id = t.site_id
  LEFT JOIN rush_fee_schedule s ON s.id = e.rush_schedule_id;

-------------------------------------------------------------------------------
-- 5. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_047;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
    IF p_table = 'test_package' THEN
        RETURN jsonb_build_object('label', 'Package ' || COALESCE(r->>'package_code', '') || ' ' || COALESCE(r->>'package_name', ''), 'link', '#/catalog/packages/' || p_id);
    ELSIF p_table = 'test_package_item' THEN
        RETURN jsonb_build_object('label', 'Package ' || COALESCE((SELECT package_code FROM test_package WHERE id = (r->>'package_id')::uuid), '') || ': '
            || COALESCE((SELECT test_name FROM test WHERE id = (r->>'test_id')::uuid), ''), 'link', '#/catalog/packages/' || COALESCE(r->>'package_id', ''));
    ELSIF p_table = 'test_package_analyte' THEN
        SELECT package_id INTO v FROM test_package_item WHERE id = (r->>'item_id')::uuid;
        RETURN jsonb_build_object('label', 'Package ' || COALESCE((SELECT package_code FROM test_package WHERE id = v), '') || ': '
            || COALESCE((SELECT analyte_name FROM analyte WHERE id = (r->>'analyte_id')::uuid), ''), 'link', '#/catalog/packages/' || COALESCE(v::text, ''));
    ELSIF p_table = 'quoted_package' THEN
        RETURN jsonb_build_object('label', 'Quoted package ' || COALESCE(r->>'package_code', '') || ' ' || COALESCE(r->>'package_name', ''), 'link', '#/quote/' || COALESCE(r->>'project_version_id', ''));
    ELSIF p_table = 'ordered_package' THEN
        RETURN jsonb_build_object('label', 'Ordered package ' || COALESCE(r->>'order_package_code', '') || ' (' || COALESCE(r->>'status', '') || ')', 'link', '#/samples/' || COALESCE(r->>'sample_id', ''));
    ELSIF p_table = 'catalog_price_change' THEN
        RETURN jsonb_build_object('label', 'Price change ' || COALESCE(r->>'change_code', '') || ' (' || COALESCE(r->>'pct', '') || ' % from ' || COALESCE(r->>'effective_on', '') || ')', 'link', '#/catalog?tab=prices');
    END IF;
    RETURN audit_record_ref_047(p_table, p_id, r);
END $$;

COMMIT;
