-- 058: miscellaneous charges, service lines, ordering any test at list price, invoice payment status and PO
-- corrections (Claude in the cloud, 2026-10-21; version 0.36.0).
-- From Cecilia Colesanti's call with Alex (2026-10-21) and Alex's choices the same afternoon:
--  - Miscellaneous charges (kits, shipping, report fees, surcharges, discounts): Claude's recommendation, accepted:
--    a Charge item in the catalogue, not a hidden test. A charge has no workflow, never reaches a COA, and is billable
--    as soon as it is added (shipping is billed before the kit goes out). Charges go on lab orders, on quotes and
--    projects with a price per client, and straight onto a draft invoice.
--  - Service line > service line type > department on tests; service lines on the client's profile. The test picker
--    on the order drills down through them (Alex: "Would that help with the bandwidth issue?" Yes).
--  - "Something not quoted is automatically list price without warning" (Alex): a test of the ordering lab can be
--    ordered without a quote, at its catalogue list price. An accepted quote line for that test always wins.
--    Reverses the slice-2 decision "All ordering is quoted" (vault: Decision - Ordering Any Test at List Price).
--  - Invoices: paid status (manual until QuickBooks is connected) and correcting the PO number after an invoice is
--    sent (signed, with a reason; the amounts still change only through a credit note).
-- Permissions: none new. Charge items and service lines: catalog.edit. Order charges: orders.edit. Quoted charges:
-- quotes.edit. Charges on a draft invoice, payments and PO corrections: invoicing.issue.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 058: charges, service lines, list-price ordering, invoice payments', true);

-------------------------------------------------------------------------------
-- 1. SERVICE LINES (shared by every lab), ON TESTS AND CLIENTS
-------------------------------------------------------------------------------
CREATE TABLE service_line (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_name       text NOT NULL CHECK (btrim(line_name) <> ''),
    sort_order      integer NOT NULL DEFAULT 0,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX service_line_name ON service_line (lower(line_name));
CALL make_gxp('service_line');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON service_line FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');

CREATE TABLE service_line_type (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    service_line_id uuid NOT NULL REFERENCES service_line(id),
    type_name       text NOT NULL CHECK (btrim(type_name) <> ''),
    sort_order      integer NOT NULL DEFAULT 0,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX service_line_type_name ON service_line_type (service_line_id, lower(type_name));
CALL make_gxp('service_line_type');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON service_line_type FOR EACH ROW EXECUTE FUNCTION require_list_permission('catalog.edit');
CREATE FUNCTION service_line_type_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.service_line_id <> OLD.service_line_id THEN
        RAISE EXCEPTION 'A service line type stays under its service line: retire it and add it under the other one';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_rules BEFORE INSERT OR UPDATE ON service_line_type FOR EACH ROW EXECUTE FUNCTION service_line_type_rules();

-- A test's service line type (the type names its service line); its department is the test's own (012)
ALTER TABLE test ADD COLUMN service_line_type_id uuid REFERENCES service_line_type(id);

-- The client's service lines: the tests and packages the client sees first when ordering
CREATE TABLE client_service_line (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid NOT NULL REFERENCES client(id),
    service_line_id uuid NOT NULL REFERENCES service_line(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX client_service_line_one ON client_service_line (client_id, service_line_id);
CALL make_gxp('client_service_line');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON client_service_line FOR EACH ROW EXECUTE FUNCTION require_list_permission('master.clients');

-- Starter list (CIL's service lines as Cecilia named them, plus the network's; labs change them freely)
SELECT set_config('lims.group_sync', '1', true);
INSERT INTO service_line (line_name, sort_order) VALUES ('Cannabis', 10), ('Dietary supplements', 20), ('Food', 30), ('Environmental', 40), ('Pharmaceutical', 50);
INSERT INTO service_line_type (service_line_id, type_name, sort_order)
SELECT sl.id, x.t, x.o FROM service_line sl JOIN (VALUES
    ('Cannabis', 'Compliance', 10), ('Cannabis', 'Research and development', 20),
    ('Dietary supplements', 'Release testing', 10), ('Dietary supplements', 'Stability', 20),
    ('Food', 'Nutrition', 10), ('Food', 'Microbiology', 20), ('Food', 'Contaminants', 30),
    ('Environmental', 'Drinking water', 10), ('Environmental', 'Wastewater', 20), ('Environmental', 'Real estate', 30),
    ('Pharmaceutical', 'Release testing', 10), ('Pharmaceutical', 'Stability', 20)) x(l, t, o) ON x.l = sl.line_name;
SELECT set_config('lims.group_sync', '', true);

-------------------------------------------------------------------------------
-- 2. ORDERING ANY TEST AT LIST PRICE
-------------------------------------------------------------------------------
-- A requested test ordered from the catalogue without a quote: list price, the rush schedule's surcharge in full
ALTER TABLE requested_test ADD COLUMN catalogue_order boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN requested_test.catalogue_order IS 'Ordered from the test catalogue without a quote: billed at its list price (058)';
ALTER TABLE requested_test DROP CONSTRAINT requested_test_quoted_or_media;
ALTER TABLE requested_test ADD CONSTRAINT requested_test_quoted_or_media
    CHECK (quoted_line_id IS NOT NULL OR media_lot_id IS NOT NULL OR serving_order OR competency_attempt_id IS NOT NULL OR catalogue_order);

-- As in 033, plus the catalogue branch (list price; rush at the schedule's surcharge, no discount)
CREATE OR REPLACE FUNCTION requested_test_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    q quoted_test_configuration; e test_catalog_entry; s sample; o lab_order; rt quote_rush_term; tr rush_fee_tier;
    v_list numeric; v_active boolean; v_needs boolean;
BEGIN
    SELECT * INTO q FROM quoted_test_configuration WHERE id = NEW.quoted_line_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = NEW.test_id;
    SELECT * INTO s FROM sample WHERE id = NEW.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.test_id <> OLD.test_id OR NEW.quoted_line_id IS DISTINCT FROM OLD.quoted_line_id OR NEW.sample_id <> OLD.sample_id
           OR NEW.test_version_id <> OLD.test_version_id OR NEW.media_lot_id IS DISTINCT FROM OLD.media_lot_id
           OR NEW.catalogue_order <> OLD.catalogue_order THEN
            RAISE EXCEPTION 'Test, sample, quote line and test version are fixed on a requested test';
        END IF;
        IF OLD.status = 'Cancelled' AND NEW.status <> 'Cancelled' THEN
            RAISE EXCEPTION 'A cancelled test cannot be reinstated; order it again';
        END IF;
        IF OLD.clock_start IS NOT NULL AND current_reason() IS NULL
           AND (NEW.status, NEW.rush_tier_id, NEW.special_instructions) IS DISTINCT FROM (OLD.status, OLD.rush_tier_id, OLD.special_instructions) THEN
            RAISE EXCEPTION 'A Reason for Change is required to change a test on a logged sample';
        END IF;
    END IF;
    IF NEW.tat_override IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.tat_override END) AND current_reason() IS NULL THEN
        RAISE EXCEPTION 'A Reason for Change is required to override the turnaround (TAT)';
    END IF;

    IF q.id IS NULL AND NEW.catalogue_order THEN
        -- 058: ordered from the catalogue at its list price
        IF TG_OP = 'INSERT' OR (NEW.rush_tier_id IS DISTINCT FROM OLD.rush_tier_id AND COALESCE(current_setting('lims.rush_explicit', true), '') <> '1') THEN
            IF NEW.rush_tier_id IS NULL THEN
                NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
            ELSE
                SELECT * INTO tr FROM rush_fee_tier WHERE id = NEW.rush_tier_id AND status = 'Active';
                IF tr.id IS NULL OR e.rush_schedule_id IS DISTINCT FROM tr.schedule_id THEN
                    RAISE EXCEPTION 'That rush tier is not on this test''s rush schedule';
                END IF;
                v_needs := rush_requires_approval(e.id, NEW.rush_tier_id);
                NEW.rush_status := CASE WHEN v_needs THEN 'Pending Approval' ELSE 'Auto-accepted' END::rush_status;
                NEW.rush_requested_at := clock_timestamp();
            END IF;
        END IF;
        IF e.pricing_mode = 'Analyte Selection' AND TG_OP = 'UPDATE' THEN
            v_list := e.base_price + e.prep_fee
                    + COALESCE((SELECT sum(analyte_price) FROM requested_analyte WHERE requested_test_id = NEW.id AND included), 0);
        ELSE
            v_list := catalog_list_price(e.id);
        END IF;
        NEW.list_price := COALESCE(v_list, 0);
        NEW.price := CASE WHEN NEW.status = 'Cancelled' THEN 0 ELSE NEW.list_price END;
        v_active := NEW.rush_tier_id IS NOT NULL AND NEW.rush_status IN ('Auto-accepted','Approved') AND NEW.status <> 'Cancelled';
        IF v_active THEN
            SELECT * INTO tr FROM rush_fee_tier WHERE id = NEW.rush_tier_id;
            NEW.rush_fee := round(CASE WHEN tr.surcharge_type = 'Flat' THEN tr.surcharge_value ELSE NEW.price * tr.surcharge_value / 100 END, 2);
            NEW.tat_days := tr.rush_tat; NEW.tat_unit := tr.tat_unit;
        ELSE
            NEW.rush_fee := 0;
            NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
        END IF;
    ELSIF q.id IS NULL AND NEW.serving_order THEN
        -- 033: a serving weight or density test the per-serving calculation needs, not on the client's quote: its catalogue price
        IF NEW.rush_tier_id IS NOT NULL THEN RAISE EXCEPTION 'A serving calculation test ordered at its catalogue price is not rushed'; END IF;
        NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
        NEW.list_price := catalog_list_price(e.id); NEW.price := CASE WHEN NEW.status = 'Cancelled' THEN 0 ELSE NEW.list_price END; NEW.rush_fee := 0;
        NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
    ELSIF q.id IS NULL THEN
        -- media qualification (no quote): the lab's own work
        IF NEW.rush_tier_id IS NOT NULL THEN RAISE EXCEPTION 'A media qualification test is not rushed'; END IF;
        NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
        NEW.list_price := 0; NEW.price := 0; NEW.rush_fee := 0;
        NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
    ELSE
        IF TG_OP = 'INSERT' OR (NEW.rush_tier_id IS DISTINCT FROM OLD.rush_tier_id AND COALESCE(current_setting('lims.rush_explicit', true), '') <> '1') THEN
            IF NEW.rush_tier_id IS NULL THEN
                NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
            ELSE
                SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
                IF rt.id IS NULL OR e.rush_schedule_id IS DISTINCT FROM (SELECT schedule_id FROM rush_fee_tier WHERE id = NEW.rush_tier_id) THEN
                    RAISE EXCEPTION 'That rush tier is not available for this test on the client''s quote';
                END IF;
                v_needs := rush_requires_approval(e.id, NEW.rush_tier_id);
                NEW.rush_status := CASE WHEN v_needs THEN 'Pending Approval' ELSE 'Auto-accepted' END::rush_status;
                NEW.rush_requested_at := clock_timestamp();
            END IF;
        END IF;
        IF e.pricing_mode = 'Analyte Selection' AND TG_OP = 'UPDATE' THEN
            v_list := e.base_price + e.prep_fee
                    + COALESCE((SELECT sum(analyte_price) FROM requested_analyte WHERE requested_test_id = NEW.id AND included), 0);
        ELSE
            v_list := q.list_price;
        END IF;
        NEW.list_price := v_list;
        NEW.price := CASE WHEN q.list_price = 0 THEN q.final_price ELSE round(v_list * q.final_price / q.list_price, 2) END;
        IF NEW.status = 'Cancelled' THEN NEW.price := 0; END IF;
        v_active := NEW.rush_tier_id IS NOT NULL AND NEW.rush_status IN ('Auto-accepted','Approved') AND NEW.status <> 'Cancelled';
        IF v_active THEN
            SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
            NEW.rush_fee := round(CASE WHEN rt.surcharge_type = 'Flat' THEN rt.surcharge_value
                                       ELSE NEW.price * rt.surcharge_value / 100 END * (1 - rt.discount_pct / 100), 2);
            NEW.tat_days := rt.rush_tat; NEW.tat_unit := rt.tat_unit;
        ELSE
            NEW.rush_fee := 0;
            NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
        END IF;
    END IF;
    IF NEW.tat_override IS NOT NULL THEN NEW.tat_days := NEW.tat_override; END IF;

    IF s.logged_at IS NOT NULL AND NEW.clock_start IS NULL THEN
        NEW.clock_start := GREATEST(s.logged_at, COALESCE(NEW.created_at, clock_timestamp()));
        IF NEW.status = 'Ordered' THEN NEW.status := 'In Pool'; END IF;
    END IF;
    IF NEW.clock_start IS NOT NULL AND NEW.tat_unit IS NOT NULL THEN
        NEW.day0 := tat_day0(o.site_id, NEW.clock_start, e.cutoff_time, NEW.tat_unit);
        NEW.due_date := tat_due(o.site_id, NEW.day0, NEW.tat_days, NEW.tat_unit);
    END IF;
    RETURN NEW;
END $$;

-- Why a test cannot be ordered from this lab's catalogue (NULL: it can)
CREATE FUNCTION catalogue_order_problem(p_site uuid, p_test uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN t.id IS NULL THEN 'Test not found'
        WHEN t.status::text <> 'Active' THEN t.test_name || ' is retired'
        WHEN t.site_id IS DISTINCT FROM p_site THEN t.test_name || ' belongs to another lab: order it at that lab'
        WHEN e.id IS NULL OR e.base_price IS NULL THEN t.test_name || ' has no price in the catalogue yet'
        WHEN NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective') THEN t.test_name || ' has no approved workflow yet, so it cannot be ordered'
    END
      FROM (SELECT p_test AS id) x LEFT JOIN test t ON t.id = x.id LEFT JOIN test_catalog_entry e ON e.test_id = t.id
$$;

-- Order a test of the lab's catalogue on a sample. The client's accepted quote line for the test wins (its price and
-- rush terms); otherwise the test is ordered at its list price. Returns the requested test.
CREATE FUNCTION order_catalogue_test(p_sample uuid, p_test uuid, p_rush_tier uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; v_line uuid; v_ver uuid; v_id uuid; v_prob text; e test_catalog_entry;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sample not found'; END IF;
    IF s.status = 'Cancelled' THEN RAISE EXCEPTION 'The sample is cancelled'; END IF;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    IF NOT COALESCE(client_can_order(o.client_id), false) THEN RAISE EXCEPTION 'This client is Inactive and cannot order'; END IF;
    v_prob := catalogue_order_problem(o.site_id, p_test);
    IF v_prob IS NOT NULL THEN RAISE EXCEPTION '%', v_prob; END IF;
    -- the quote wins: the most recently accepted orderable line for this test
    SELECT ol.line_id INTO v_line FROM orderable_lines(o.client_id) ol JOIN quoted_test_configuration q ON q.id = ol.line_id
      JOIN project_version pv ON pv.id = q.project_version_id
     WHERE ol.test_id = p_test ORDER BY pv.accepted_at DESC NULLS LAST, ol.final_price LIMIT 1;
    IF v_line IS NOT NULL THEN RETURN order_test(p_sample, v_line, p_rush_tier); END IF;
    SELECT id INTO v_ver FROM test_version WHERE test_id = p_test AND status = 'Effective';
    INSERT INTO requested_test (sample_id, test_id, test_version_id, catalogue_order, rush_tier_id)
    VALUES (p_sample, p_test, v_ver, true, p_rush_tier) RETURNING id INTO v_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = p_test;
    IF e.pricing_mode = 'Analyte Selection' THEN
        INSERT INTO requested_analyte (requested_test_id, analyte_id, analyte_price, included)
        SELECT v_id, ap.analyte_id, ap.price, true FROM test_analyte_price ap WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active';
        UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = v_id;
    END IF;
    RETURN v_id;
END $$;

-------------------------------------------------------------------------------
-- 3. MISCELLANEOUS CHARGES
-------------------------------------------------------------------------------
-- The catalogue of charges: per lab, or every lab (site NULL). A Discount is taken off (its amount is negative).
CREATE SEQUENCE charge_item_seq;
CREATE TABLE charge_item (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    charge_code     text NOT NULL UNIQUE DEFAULT 'CHG-' || lpad(nextval('charge_item_seq')::text, 3, '0'),
    charge_name     text NOT NULL CHECK (btrim(charge_name) <> ''),
    kind            text NOT NULL DEFAULT 'Other' CHECK (kind IN ('Kit','Shipping','Report fee','Surcharge','Discount','Other')),
    description     text,
    price           numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),   -- the default price; a Discount is taken off
    site_id         uuid REFERENCES lab_site(id),
    service_line_id uuid REFERENCES service_line(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('charge_item');
CREATE FUNCTION charge_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Charges for every lab are kept by system administrators; choose your lab'; END IF;
    ELSE
        PERFORM require_permission_at('catalog.edit', NEW.site_id);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A charge stays with its lab'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON charge_item FOR EACH ROW EXECUTE FUNCTION charge_item_rules();
CREATE FUNCTION charge_sign(p_kind text) RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN p_kind = 'Discount' THEN -1 ELSE 1 END $$;

-- A charge on a quote or project version: the client's price (locked with the version, like its tests)
CREATE TABLE quoted_charge (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    charge_item_id      uuid NOT NULL REFERENCES charge_item(id),
    quantity            integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    list_price          numeric(12,2) NOT NULL DEFAULT 0,          -- the item's price when added (never typed)
    unit_price          numeric(12,2) NOT NULL CHECK (unit_price >= 0),
    note                text,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX quoted_charge_one ON quoted_charge (project_version_id, charge_item_id) WHERE status = 'Active';
CALL make_gxp('quoted_charge', false);
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON quoted_charge FOR EACH ROW EXECUTE FUNCTION require_list_permission('quotes.edit');
CREATE FUNCTION quoted_charge_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ci charge_item;
BEGIN
    IF NOT version_is_editable(NEW.project_version_id) AND COALESCE(current_setting('lims.copying_version', true), '') <> '1' THEN
        RAISE EXCEPTION 'Charges are locked once a version is quoted; create a new version';
    END IF;
    SELECT * INTO ci FROM charge_item WHERE id = NEW.charge_item_id;
    IF TG_OP = 'INSERT' THEN
        IF ci.status <> 'Active' THEN RAISE EXCEPTION 'That charge is retired'; END IF;
        NEW.list_price := ci.price;
        IF NEW.unit_price IS NULL THEN NEW.unit_price := ci.price; END IF;
    ELSIF NEW.charge_item_id <> OLD.charge_item_id OR NEW.project_version_id <> OLD.project_version_id THEN
        RAISE EXCEPTION 'Take the charge off and add the other one';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_rules BEFORE INSERT OR UPDATE ON quoted_charge FOR EACH ROW EXECUTE FUNCTION quoted_charge_rules();
-- A new version of a quote carries the charges of the version before it (new_project_version copies its tests)
CREATE FUNCTION project_version_copy_charges() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev uuid;
BEGIN
    SELECT id INTO prev FROM project_version WHERE project_id = NEW.project_id AND id <> NEW.id ORDER BY version_no DESC LIMIT 1;
    IF prev IS NULL THEN RETURN NULL; END IF;
    PERFORM set_config('lims.copying_version', '1', true);
    INSERT INTO quoted_charge (project_version_id, charge_item_id, quantity, list_price, unit_price, note)
    SELECT NEW.id, qc.charge_item_id, qc.quantity, qc.list_price, qc.unit_price, qc.note FROM quoted_charge qc
      JOIN charge_item ci ON ci.id = qc.charge_item_id AND ci.status = 'Active'
     WHERE qc.project_version_id = prev AND qc.status = 'Active';
    PERFORM set_config('lims.copying_version', '', true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_copy_charges AFTER INSERT ON project_version FOR EACH ROW EXECUTE FUNCTION project_version_copy_charges();

-- The client's price for a charge: the most recently accepted, unexpired quote of theirs (or a parent's when shared)
CREATE FUNCTION client_charge_price(p_client uuid, p_item uuid) RETURNS TABLE (quoted_charge_id uuid, unit_price numeric, project_code text)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE anc AS (
        SELECT parent_client_id AS id FROM client WHERE id = p_client AND parent_client_id IS NOT NULL
        UNION SELECT c.parent_client_id FROM client c JOIN anc ON c.id = anc.id WHERE c.parent_client_id IS NOT NULL)
    SELECT qc.id, qc.unit_price, p.project_code FROM quoted_charge qc
      JOIN project_version pv ON pv.id = qc.project_version_id AND pv.status = 'Accepted' AND (pv.valid_until IS NULL OR pv.valid_until >= current_date)
      JOIN project p ON p.id = pv.project_id AND p.status = 'Active'
     WHERE qc.charge_item_id = p_item AND qc.status = 'Active'
       AND (p.client_id = p_client OR (p.available_to_child_clients AND p.client_id IN (SELECT id FROM anc)))
     ORDER BY pv.accepted_at DESC NULLS LAST LIMIT 1
$$;

-- A charge on a lab order (optionally on one of its samples): billable as soon as it is added
CREATE SEQUENCE order_charge_seq;
CREATE TABLE order_charge (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    charge_no           text NOT NULL UNIQUE DEFAULT 'OC-' || lpad(nextval('order_charge_seq')::text, 6, '0'),
    lab_order_id        uuid NOT NULL REFERENCES lab_order(id),
    sample_id           uuid REFERENCES sample(id),
    charge_item_id      uuid NOT NULL REFERENCES charge_item(id),
    quantity            integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    list_price          numeric(12,2) NOT NULL DEFAULT 0,          -- the item's price (signed: a discount is negative)
    unit_price          numeric(12,2),                             -- the client's price (signed); from the quote or the item
    quoted_charge_id    uuid REFERENCES quoted_charge(id),
    source              text NOT NULL DEFAULT 'Order' CHECK (source IN ('Order','Invoice')),
    note                text,                                      -- printed on the invoice line
    status              text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Cancelled')),
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX order_charge_order ON order_charge (lab_order_id);
CALL make_gxp('order_charge');

-- invoice lines: a test's or a charge's (058)
ALTER TABLE invoice_line ALTER COLUMN requested_test_id DROP NOT NULL;
ALTER TABLE invoice_line ALTER COLUMN sample_code DROP NOT NULL;
ALTER TABLE invoice_line ADD COLUMN order_charge_id uuid REFERENCES order_charge(id);
ALTER TABLE invoice_line ADD CONSTRAINT invoice_line_test_or_charge CHECK ((requested_test_id IS NULL) <> (order_charge_id IS NULL));
CREATE INDEX invoice_line_charge ON invoice_line (order_charge_id);

-- A charge's billing now, and a charge credited for good (as for tests, 036)
CREATE FUNCTION charge_invoice_line(p_charge uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT l.id FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
     WHERE l.order_charge_id = p_charge AND l.kind = 'Charge' AND l.status = 'Active' AND i.status IN ('Draft','Issued')
       AND NOT EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id WHERE c.credits_line_id = l.id AND ci.status = 'Issued')
     ORDER BY l.created_at DESC LIMIT 1
$$;
CREATE FUNCTION charge_billing_closed(p_charge uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id JOIN invoice_line l ON l.id = c.credits_line_id
                    WHERE l.order_charge_id = p_charge AND ci.status = 'Issued' AND NOT c.rebill)
$$;

CREATE FUNCTION order_charge_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o lab_order; ci charge_item; cp record; s sample;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = NEW.lab_order_id;
    IF NOT in_group_sync() THEN
        PERFORM require_permission_at(CASE WHEN NEW.source = 'Invoice' THEN 'invoicing.issue' ELSE 'orders.edit' END, o.site_id);
    END IF;
    SELECT * INTO ci FROM charge_item WHERE id = NEW.charge_item_id;
    IF NEW.sample_id IS NOT NULL THEN
        SELECT * INTO s FROM sample WHERE id = NEW.sample_id;
        IF s.lab_order_id IS DISTINCT FROM NEW.lab_order_id THEN RAISE EXCEPTION 'That sample is on another order'; END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF ci.status <> 'Active' THEN RAISE EXCEPTION 'That charge is retired'; END IF;
        IF ci.site_id IS NOT NULL AND ci.site_id <> o.site_id THEN RAISE EXCEPTION 'That charge belongs to another lab'; END IF;
        NEW.list_price := charge_sign(ci.kind) * ci.price;
        IF NEW.unit_price IS NULL THEN
            SELECT * INTO cp FROM client_charge_price(o.client_id, ci.id);
            IF cp.quoted_charge_id IS NOT NULL THEN
                NEW.unit_price := charge_sign(ci.kind) * cp.unit_price; NEW.quoted_charge_id := cp.quoted_charge_id;
            ELSE
                NEW.unit_price := NEW.list_price;
            END IF;
        ELSE
            NEW.unit_price := charge_sign(ci.kind) * abs(NEW.unit_price);   -- typed as a positive amount; a discount is taken off
            IF NEW.source = 'Order' AND abs(NEW.unit_price) <> abs(NEW.list_price) AND current_reason() IS NULL THEN
                RAISE EXCEPTION 'Say why this charge is not at its price';
            END IF;
        END IF;
    ELSE
        IF (NEW.lab_order_id, NEW.charge_item_id, NEW.source) IS DISTINCT FROM (OLD.lab_order_id, OLD.charge_item_id, OLD.source) THEN
            RAISE EXCEPTION 'A charge''s order and item are fixed: cancel it and add the right one';
        END IF;
        IF OLD.status = 'Cancelled' THEN RAISE EXCEPTION 'A cancelled charge is kept as it was'; END IF;
        IF charge_invoice_line(OLD.id) IS NOT NULL AND (NEW.quantity, NEW.unit_price, NEW.status) IS DISTINCT FROM (OLD.quantity, OLD.unit_price, OLD.status) THEN
            RAISE EXCEPTION 'Charge % is on an invoice: change it there (draft) or with a credit note', OLD.charge_no;
        END IF;
        IF NEW.unit_price IS DISTINCT FROM OLD.unit_price THEN NEW.unit_price := charge_sign(ci.kind) * abs(NEW.unit_price); END IF;
        IF (NEW.quantity, NEW.unit_price, NEW.status) IS DISTINCT FROM (OLD.quantity, OLD.unit_price, OLD.status) AND current_reason() IS NULL THEN
            RAISE EXCEPTION 'A Reason for Change is required to change or cancel a charge';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON order_charge FOR EACH ROW EXECUTE FUNCTION order_charge_rules();

-- Charges ready to invoice: active, not internal, not on an invoice, not credited for good
CREATE VIEW charge_ready_view AS
SELECT oc.id AS order_charge_id, oc.charge_no, oc.lab_order_id, o.order_code, o.po_number, o.site_id, si.site_code, o.client_id,
       COALESCE(c.display_name, c.legal_name) AS client_name, oc.sample_id, s.sample_code, s.client_sample_id,
       ci.charge_code, ci.charge_name, ci.kind, oc.quantity, oc.list_price, oc.unit_price, oc.quantity * oc.unit_price AS amount,
       oc.note, oc.source, (SELECT p.project_code FROM quoted_charge qc JOIN project_version pv ON pv.id = qc.project_version_id JOIN project p ON p.id = pv.project_id
                             WHERE qc.id = oc.quoted_charge_id) AS project_code, oc.created_at
  FROM order_charge oc JOIN lab_order o ON o.id = oc.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id
  JOIN charge_item ci ON ci.id = oc.charge_item_id LEFT JOIN sample s ON s.id = oc.sample_id
 WHERE oc.status = 'Active' AND NOT c.is_internal AND charge_invoice_line(oc.id) IS NULL AND NOT charge_billing_closed(oc.id);

-- The line a charge makes
CREATE FUNCTION invoice_add_charge_line(p_invoice uuid, p_charge uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b record; v uuid; n integer;
BEGIN
    SELECT * INTO b FROM charge_ready_view WHERE order_charge_id = p_charge;
    IF b.order_charge_id IS NULL THEN RAISE EXCEPTION 'That charge is not ready to invoice (cancelled, or on an invoice already)'; END IF;
    SELECT COALESCE(max(line_no), 0) + 1 INTO n FROM invoice_line WHERE invoice_id = p_invoice;
    INSERT INTO invoice_line (invoice_id, line_no, order_charge_id, sample_code, client_sample_id, test_code, test_name, completed_on,
                              list_price, quoted_price, price, line_note, amount)
    VALUES (p_invoice, n, p_charge, b.sample_code, b.client_sample_id, b.charge_code,
            b.charge_name || CASE WHEN b.quantity > 1 THEN ' × ' || b.quantity ELSE '' END, (b.created_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = b.site_id))::date,
            b.list_price * b.quantity, b.unit_price * b.quantity, b.unit_price * b.quantity, NULLIF(btrim(COALESCE(b.note, '')), ''), b.unit_price * b.quantity)
    RETURNING id INTO v;
    RETURN v;
END $$;

-- The claimer's own draft for an order (made if needed)
CREATE FUNCTION invoice_draft_for(p_order uuid, p_note text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o lab_order; inv uuid;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    SELECT id INTO inv FROM invoice WHERE lab_order_id = o.id AND status = 'Draft' AND kind = 'Invoice' AND claimed_by = current_app_user()
     ORDER BY created_at LIMIT 1;
    IF inv IS NULL THEN
        INSERT INTO invoice (site_id, client_id, lab_order_id, claimed_by, po_number, internal_note)
        VALUES (o.site_id, o.client_id, o.id, current_app_user(), o.po_number, NULLIF(btrim(p_note), '')) RETURNING id INTO inv;
    END IF;
    RETURN inv;
END $$;

-- Claim charges ready to invoice onto the claimer's draft for each order (as claim_invoice_work does for tests)
CREATE FUNCTION claim_invoice_charges(p_charges uuid[], p_note text DEFAULT NULL) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE v uuid; b record; inv uuid; out uuid[] := '{}'; o record;
BEGIN
    IF COALESCE(cardinality(p_charges), 0) = 0 THEN RETURN out; END IF;
    PERFORM 1 FROM order_charge WHERE id = ANY (p_charges) ORDER BY id FOR UPDATE;
    FOREACH v IN ARRAY p_charges LOOP
        SELECT * INTO b FROM charge_ready_view WHERE order_charge_id = v;
        IF b.order_charge_id IS NULL THEN
            RAISE EXCEPTION 'Charge % is not ready to invoice (cancelled, or on an invoice already)', (SELECT charge_no FROM order_charge WHERE id = v);
        END IF;
        PERFORM require_permission_at('invoicing.issue', b.site_id);
    END LOOP;
    PERFORM ensure_reason('Work claimed for invoicing');
    PERFORM set_invoice_internal(true);
    FOR o IN SELECT DISTINCT r.lab_order_id FROM charge_ready_view r WHERE r.order_charge_id = ANY (p_charges) LOOP
        inv := invoice_draft_for(o.lab_order_id, p_note);
        FOR v IN SELECT r.order_charge_id FROM charge_ready_view r WHERE r.order_charge_id = ANY (p_charges) AND r.lab_order_id = o.lab_order_id
                  ORDER BY r.sample_code NULLS FIRST, r.charge_name LOOP
            PERFORM invoice_add_charge_line(inv, v);
        END LOOP;
        PERFORM invoice_totals(inv);
        IF NOT (inv = ANY (out)) THEN out := out || inv; END IF;
    END LOOP;
    PERFORM set_invoice_internal(false);
    RETURN out;
END $$;

-- Add a charge (or a discount) straight onto one's own draft: it is recorded on the order as well
CREATE FUNCTION add_invoice_charge(p_invoice uuid, p_item uuid, p_quantity integer, p_price numeric, p_note text, p_sample uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i invoice := invoice_own_draft(p_invoice); v_charge uuid;
BEGIN
    PERFORM ensure_reason('Charge added at invoicing');
    INSERT INTO order_charge (lab_order_id, sample_id, charge_item_id, quantity, unit_price, source, note)
    VALUES (i.lab_order_id, p_sample, p_item, COALESCE(p_quantity, 1), p_price, 'Invoice', NULLIF(btrim(COALESCE(p_note, '')), '')) RETURNING id INTO v_charge;
    PERFORM set_invoice_internal(true);
    PERFORM invoice_add_charge_line(i.id, v_charge);
    PERFORM invoice_totals(i.id);
    PERFORM set_invoice_internal(false);
    RETURN v_charge;
END $$;

-- Crediting an issued invoice: as in 036, the credit lines also carry the charge they credit
CREATE OR REPLACE FUNCTION credit_invoice(p_invoice uuid, p_lines uuid[], p_rebill boolean, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i invoice; cn uuid; l invoice_line; n integer := 0;
BEGIN
    PERFORM assert_signed('issue a credit note');
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.status <> 'Issued' OR i.kind <> 'Invoice' THEN RAISE EXCEPTION 'Only an issued invoice is credited'; END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why the invoice is credited (printed on the credit note)'; END IF;
    PERFORM ensure_reason('Credit note issued');
    PERFORM set_invoice_internal(true);
    INSERT INTO invoice (kind, site_id, client_id, lab_order_id, credit_of_id, po_number, reason)
    VALUES ('Credit note', i.site_id, i.client_id, i.lab_order_id, i.id, i.po_number, btrim(p_reason)) RETURNING id INTO cn;
    FOR l IN SELECT * FROM invoice_line x WHERE x.invoice_id = i.id AND x.status = 'Active' AND x.kind = 'Charge'
               AND (p_lines IS NULL OR x.id = ANY (p_lines)) ORDER BY x.line_no LOOP
        IF EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id WHERE c.credits_line_id = l.id AND ci.status = 'Issued') THEN
            IF p_lines IS NULL THEN CONTINUE; END IF;
            RAISE EXCEPTION 'Line % (% %) is credited already', l.line_no, COALESCE(l.sample_code, ''), l.test_name;
        END IF;
        n := n + 1;
        INSERT INTO invoice_line (invoice_id, line_no, kind, requested_test_id, order_charge_id, credits_line_id, rebill, sample_code, client_sample_id, test_code, test_name,
                                  completed_on, due_date, late_days, list_price, quoted_price, price, price_note, rush_ordered, rush_ordered_fee, rush_tier_id,
                                  rush_billed, rush_fee, rush_note, retest_of_id, line_note, amount)
        VALUES (cn, n, 'Credit', l.requested_test_id, l.order_charge_id, l.id, COALESCE(p_rebill, false), l.sample_code, l.client_sample_id, l.test_code, l.test_name,
                l.completed_on, l.due_date, l.late_days, l.list_price, l.quoted_price, l.price, l.price_note, l.rush_ordered, l.rush_ordered_fee, l.rush_tier_id,
                l.rush_billed, l.rush_fee, l.rush_note, l.retest_of_id, l.line_note, -l.amount);
    END LOOP;
    IF n = 0 THEN RAISE EXCEPTION 'Choose the lines of % to credit', i.invoice_number; END IF;
    PERFORM invoice_stamp_issue(cn, site_today(i.site_id), false);
    PERFORM set_invoice_internal(false);
    RETURN cn;
END $$;

-- Issuing (as in 036): a charge line, like a test line, must not be billed on another invoice meanwhile
CREATE OR REPLACE FUNCTION issue_invoices(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v uuid; i invoice; n integer := 0;
BEGIN
    IF COALESCE(cardinality(p_ids), 0) = 0 THEN RAISE EXCEPTION 'Choose the draft invoices to issue'; END IF;
    PERFORM assert_signed('issue invoices');
    FOREACH v IN ARRAY p_ids LOOP
        i := invoice_own_draft(v);
        IF NOT EXISTS (SELECT 1 FROM invoice_line WHERE invoice_id = i.id AND status = 'Active') THEN RAISE EXCEPTION '% has no lines', i.draft_code; END IF;
        IF EXISTS (SELECT 1 FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active'
                     AND (test_invoice_line(l.requested_test_id) <> l.id OR charge_invoice_line(l.order_charge_id) <> l.id)) THEN
            RAISE EXCEPTION '% holds work billed on another invoice', i.draft_code;
        END IF;
    END LOOP;
    PERFORM ensure_reason('Invoice issued');
    PERFORM set_invoice_internal(true);
    FOREACH v IN ARRAY p_ids LOOP
        PERFORM invoice_stamp_issue(v, site_today((SELECT site_id FROM invoice WHERE id = v)), false);
        n := n + 1;
    END LOOP;
    PERFORM set_invoice_internal(false);
    RETURN n;
END $$;

-- QuickBooks (as in 036): a discount line goes as a negative amount on an invoice (credit memo lines stay positive)
CREATE OR REPLACE FUNCTION qbo_payload(p_invoice uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'DocNumber', i.invoice_number,
        'TxnDate', to_char(i.invoice_date, 'YYYY-MM-DD'),
        'DueDate', CASE WHEN i.kind = 'Invoice' THEN to_char(i.due_date, 'YYYY-MM-DD') END,
        'CustomerRef', jsonb_build_object('value', ac.external_id, 'name', i.bill_to_name),
        'SalesTermRef', CASE WHEN i.kind = 'Invoice' THEN jsonb_build_object('name', 'Net ' || i.payment_terms_days) END,
        'BillAddr', CASE WHEN i.bill_to_address IS NOT NULL THEN jsonb_build_object('Line1', i.bill_to_address) END,
        'BillEmail', (SELECT jsonb_build_object('Address', string_agg(DISTINCT ct.email, ', ')) FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
                       WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)),
        'CustomerMemo', jsonb_build_object('value', concat_ws(' · ', 'Order ' || o.order_code, 'PO ' || i.po_number,
                            CASE WHEN i.kind = 'Credit note' THEN 'Credits ' || (SELECT x.invoice_number FROM invoice x WHERE x.id = i.credit_of_id) || ': ' || i.reason END)),
        'PrivateNote', 'LIMS3 ' || i.invoice_number,
        'Line', (SELECT jsonb_agg(jsonb_build_object(
                    'LineNum', l.line_no, 'DetailType', 'SalesItemLineDetail',
                    'Amount', CASE WHEN i.kind = 'Credit note' THEN -l.amount ELSE l.amount END,
                    'Description', concat_ws(' · ', l.sample_code || COALESCE(' (' || l.client_sample_id || ')', ''), l.test_name,
                                             CASE WHEN l.rush_fee > 0 THEN 'rush ' || l.rush_billed END, l.line_note),
                    'SalesItemLineDetail', jsonb_build_object('ItemRef', jsonb_build_object('name', cn.item_name), 'Qty', 1,
                                                              'UnitPrice', CASE WHEN i.kind = 'Credit note' THEN -l.amount ELSE l.amount END,
                                                              'ServiceDate', to_char(l.completed_on, 'YYYY-MM-DD'))) ORDER BY l.line_no)
                   FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active')))
      FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id LEFT JOIN accounting_connection cn ON cn.site_id = i.site_id
      LEFT JOIN accounting_customer ac ON ac.site_id = i.site_id AND ac.client_id = i.client_id
     WHERE i.id = p_invoice
$$;

-------------------------------------------------------------------------------
-- 4. INVOICES: PAYMENT STATUS AND PO CORRECTIONS
-------------------------------------------------------------------------------
ALTER TABLE invoice ADD COLUMN paid_on date;
ALTER TABLE invoice ADD COLUMN paid_note text;
ALTER TABLE invoice ADD COLUMN paid_recorded_by uuid REFERENCES app_user(id);
ALTER TABLE invoice ADD COLUMN paid_recorded_at timestamptz;

-- As in 036, plus: after issue, the payment fields and (through a correction) the PO number may change
CREATE OR REPLACE FUNCTION invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[] := ARRAY['document_id','sha256','sent_at','record_version','modified_at','modified_by'];
BEGIN
    IF NOT invoice_internal() THEN RAISE EXCEPTION 'Invoices change only through Billing (claim, check, issue, credit)'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Issued' THEN
        IF COALESCE(current_setting('lims.invoice_after_issue', true), '') = 'payment' THEN
            allowed := allowed || ARRAY['paid_on','paid_note','paid_recorded_by','paid_recorded_at'];
        ELSIF COALESCE(current_setting('lims.invoice_after_issue', true), '') = 'po' THEN
            allowed := allowed || ARRAY['po_number'];
        END IF;
        IF (to_jsonb(NEW) - allowed) IS DISTINCT FROM (to_jsonb(OLD) - allowed)
           OR (OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
            RAISE EXCEPTION '% is issued and is never changed: correct it with a credit note', OLD.invoice_number;
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Discarded' THEN RAISE EXCEPTION 'A discarded draft is kept as it was'; END IF;
    RETURN NEW;
END $$;

-- Record that an issued invoice was paid (or clear it), with a reason: manual until QuickBooks reports payments
CREATE FUNCTION record_invoice_payment(p_invoice uuid, p_paid_on date, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i invoice;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL OR i.status <> 'Issued' THEN RAISE EXCEPTION 'Only an issued invoice is paid'; END IF;
    IF i.kind <> 'Invoice' THEN RAISE EXCEPTION 'A credit note is not paid'; END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    IF p_paid_on IS NOT NULL AND p_paid_on > site_today(i.site_id) THEN RAISE EXCEPTION 'The payment date cannot be in the future'; END IF;
    IF p_paid_on IS NOT NULL AND p_paid_on < i.invoice_date THEN RAISE EXCEPTION 'The payment date cannot be before the invoice date'; END IF;
    PERFORM ensure_reason(CASE WHEN p_paid_on IS NULL THEN 'Payment record cleared' ELSE 'Payment recorded' END);
    PERFORM set_invoice_internal(true);
    PERFORM set_config('lims.invoice_after_issue', 'payment', true);
    UPDATE invoice SET paid_on = p_paid_on, paid_note = NULLIF(btrim(COALESCE(p_note, '')), ''),
           paid_recorded_by = current_app_user(), paid_recorded_at = clock_timestamp() WHERE id = i.id;
    PERFORM set_config('lims.invoice_after_issue', '', true);
    PERFORM set_invoice_internal(false);
END $$;

-- Payment status as people read it
CREATE FUNCTION invoice_payment_status(p_invoice uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN i.kind <> 'Invoice' OR i.status <> 'Issued' THEN NULL
                WHEN i.paid_on IS NOT NULL THEN 'Paid'
                WHEN i.total <= COALESCE((SELECT sum(-c.total) FROM invoice c WHERE c.credit_of_id = i.id AND c.status = 'Issued'), 0) THEN 'Credited'
                WHEN i.due_date < site_today(i.site_id) THEN 'Overdue'
                ELSE 'Unpaid' END
      FROM invoice i WHERE i.id = p_invoice
$$;

-- A correction of an issued invoice that changes no amount (the PO number): signed, with a reason; a corrected copy
-- of the PDF is attached and sent; the original PDF is kept unchanged
CREATE SEQUENCE invoice_correction_seq;
CREATE TABLE invoice_correction (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    correction_no   integer NOT NULL DEFAULT nextval('invoice_correction_seq'),
    invoice_id      uuid NOT NULL REFERENCES invoice(id),
    field           text NOT NULL CHECK (field IN ('PO number')),
    old_value       text,
    new_value       text,
    reason          text NOT NULL,
    signature_id    uuid REFERENCES signature_event(id),
    txid            bigint NOT NULL DEFAULT txid_current(),
    document_id     uuid REFERENCES document_file(id),   -- the corrected copy
    sha256          text,
    push_payload    jsonb,                               -- what QuickBooks is sent to update the invoice
    push_status     text NOT NULL DEFAULT 'Waiting for connection' CHECK (push_status IN ('Waiting for connection','Queued','Sent','Failed')),
    sent_at         timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('invoice_correction', false);
CREATE FUNCTION invoice_correction_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT invoice_internal() THEN RAISE EXCEPTION 'Invoice corrections are made through Billing'; END IF;
    IF TG_OP = 'UPDATE' AND ((to_jsonb(NEW) - ARRAY['document_id','sha256','sent_at','push_status','record_version','modified_at','modified_by'])
                              IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['document_id','sha256','sent_at','push_status','record_version','modified_at','modified_by'])
                             OR (OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id)) THEN
        RAISE EXCEPTION 'A correction is never changed';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON invoice_correction FOR EACH ROW EXECUTE FUNCTION invoice_correction_rules();

CREATE FUNCTION correct_invoice_po(p_invoice uuid, p_po text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i invoice; v uuid;
BEGIN
    PERFORM assert_signed('correct an invoice');
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL OR i.status <> 'Issued' THEN RAISE EXCEPTION 'Only an issued invoice is corrected (change a draft directly)'; END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    IF NULLIF(btrim(COALESCE(p_po, '')), '') IS NOT DISTINCT FROM i.po_number THEN RAISE EXCEPTION 'That is the PO number already on %', i.invoice_number; END IF;
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the PO number is corrected'; END IF;
    PERFORM set_invoice_internal(true);
    PERFORM set_config('lims.invoice_after_issue', 'po', true);
    UPDATE invoice SET po_number = NULLIF(btrim(p_po), '') WHERE id = i.id;
    PERFORM set_config('lims.invoice_after_issue', '', true);
    INSERT INTO invoice_correction (invoice_id, field, old_value, new_value, reason, signature_id, push_payload, push_status)
    VALUES (i.id, 'PO number', i.po_number, NULLIF(btrim(p_po), ''), current_reason(), NULLIF(current_setting('lims.signature_id', true), '')::uuid,
            qbo_payload(i.id), CASE WHEN (SELECT status FROM accounting_connection WHERE site_id = i.site_id) = 'Connected' THEN 'Queued' ELSE 'Waiting for connection' END)
    RETURNING id INTO v;
    PERFORM set_invoice_internal(false);
    RETURN v;
END $$;

-- The corrected copy, attached once in the correcting transaction, then emailed (not for catch-up invoices)
CREATE FUNCTION record_invoice_correction_document(p_correction uuid, p_doc uuid, p_sha text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE k invoice_correction; i invoice; d document_file; o lab_order; si lab_site; u app_user; ct record; n integer := 0; v uuid;
BEGIN
    SELECT * INTO k FROM invoice_correction WHERE id = p_correction;
    IF k.id IS NULL OR k.txid <> txid_current() OR k.created_by <> current_app_user() THEN RAISE EXCEPTION 'The corrected copy is attached when the correction is made'; END IF;
    IF k.document_id IS NOT NULL THEN RAISE EXCEPTION 'The corrected copy is attached already'; END IF;
    SELECT * INTO d FROM document_file WHERE id = p_doc;
    IF d.id IS NULL OR d.sha256 <> p_sha OR d.mime_type <> 'application/pdf' THEN RAISE EXCEPTION 'The corrected PDF was not stored'; END IF;
    SELECT * INTO i FROM invoice WHERE id = k.invoice_id;
    PERFORM set_invoice_internal(true);
    UPDATE invoice_correction SET document_id = p_doc, sha256 = p_sha WHERE id = k.id;
    IF NOT i.catchup THEN
        SELECT * INTO o FROM lab_order WHERE id = i.lab_order_id;
        SELECT * INTO si FROM lab_site WHERE id = i.site_id;
        SELECT * INTO u FROM app_user WHERE id = current_app_user();
        FOR ct IN SELECT DISTINCT c2.email, c2.first_name, c2.last_name FROM client_contact cc JOIN contact c2 ON c2.id = cc.contact_id
                   WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND c2.status = 'Active' AND 'BILLING' = ANY (cc.roles)
                  UNION SELECT c3.email, c3.first_name, c3.last_name FROM contact c3 WHERE c3.id = o.ordering_contact_id
                    AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)) LOOP
            v := queue_email('Invoice Corrected', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
                'first_name', ct.first_name, 'invoice_number', i.invoice_number, 'order_code', o.order_code,
                'old_po', COALESCE(k.old_value, 'none'), 'new_po', COALESCE(k.new_value, 'none'), 'total', fmt_money(i.total),
                'staff_name', u.full_name, 'site_name', si.site_name), o.id, NULL, p_doc);
            n := n + 1;
        END LOOP;
        UPDATE invoice_correction SET sent_at = clock_timestamp() WHERE id = k.id;
    END IF;
    PERFORM set_invoice_internal(false);
    RETURN n;
END $$;

SELECT set_config('lims.group_sync', '1', true);
INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
('Invoice Corrected', 'Corrected invoice sent to a client (PO number changed)',
 'Corrected invoice {{invoice_number}} from {{site_name}} ({{order_code}})',
 E'Dear {{first_name}},\n\nPlease find attached a corrected copy of invoice {{invoice_number}} (order {{order_code}}). The PO number has changed from {{old_po}} to {{new_po}}; nothing else on the invoice has changed.\n\nAmount due: {{total}}\n\nIf you have any questions, simply reply to this email.\n\nKind regards,\n{{staff_name}}\n{{site_name}}',
 '{{first_name}}, {{invoice_number}}, {{order_code}}, {{old_po}}, {{new_po}}, {{total}}, {{staff_name}}, {{site_name}}');
SELECT set_config('lims.group_sync', '', true);

-------------------------------------------------------------------------------
-- 5. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_058;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table IN ('service_line', 'service_line_type') THEN
        RETURN jsonb_build_object('label', CASE WHEN p_table = 'service_line' THEN 'Service line ' || COALESCE(r->>'line_name', '') ELSE 'Service line type ' || COALESCE(r->>'type_name', '') END,
                                  'link', '#/catalog?tab=lines');
    ELSIF p_table = 'client_service_line' THEN
        RETURN jsonb_build_object('label', 'Client service line', 'link', '#/clients/' || COALESCE(r->>'client_id', ''));
    ELSIF p_table = 'charge_item' THEN
        RETURN jsonb_build_object('label', 'Charge ' || COALESCE(r->>'charge_code', '') || ' ' || COALESCE(r->>'charge_name', ''), 'link', '#/catalog?tab=charges');
    ELSIF p_table = 'quoted_charge' THEN
        RETURN jsonb_build_object('label', 'Charge on a quote', 'link', '#/quote/' || COALESCE(r->>'project_version_id', ''));
    ELSIF p_table = 'order_charge' THEN
        RETURN jsonb_build_object('label', 'Charge ' || COALESCE(r->>'charge_no', ''), 'link', '#/orders/' || COALESCE(r->>'lab_order_id', ''));
    ELSIF p_table = 'invoice_correction' THEN
        RETURN jsonb_build_object('label', 'Invoice correction (' || COALESCE(r->>'field', '') || ')', 'link', '#/billing/invoices/' || COALESCE(r->>'invoice_id', ''));
    END IF;
    RETURN audit_record_ref_058(p_table, p_id, r);
END $$;

COMMIT;
