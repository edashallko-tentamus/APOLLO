-- LIMS3 schema, migration 023: Alex's notes of 2026-10-13 (vault: "Decision - Media Qualification, Batch Edits and
-- Barcode Labels"; CLAUDE.md "Alex's notes for the next slice"). Built by Claude Code.
--  1. Purchasing: a link to the item's web page (request and inventory item); an optional actual price per receipt;
--     receiving a non-inventory request (Other, Service) can put it into inventory: the item is created at receipt.
--  2. Media qualification: a new Media lot needs qualifying before use. The lab chooses the tests the media is for and the
--     qualification test (e.g. growth promotion) for each; one test sample is made, with the lot's own ID (INV-...), on
--     the lab's internal order. It is batched like any sample but is not counted in the batch size or its QC brackets.
--     When QA approves the batch, the media is released for those tests only (Failed if a result does not conform);
--     the bench refuses the lot for any other test.
--  3. Batches that have not started (no bench work recorded): samples can be added from the backlog and removed (back
--     to the backlog). No signature (Alex): a plain, audited action. QC brackets follow the number of samples; a
--     completed Batching step is reopened so the analyst confirms the new batch.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 023: media qualification, purchasing links, batch edits', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('inventory.qualify', 'Inventory', 'Media qualification', 'Start the qualification of a media lot (the tests it is for and the qualification tests to run)', false, 57);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{inventory.qualify}'), ('Lab Supervisor', '{inventory.qualify}'), ('QA', '{inventory.qualify}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 1. PURCHASING: item link, actual price, receiving into inventory
-------------------------------------------------------------------------------
ALTER TABLE purchase_line ADD COLUMN item_url text CHECK (item_url IS NULL OR item_url ~* '^https?://\S+$');
ALTER TABLE inventory_lot ADD COLUMN item_url text CHECK (item_url IS NULL OR item_url ~* '^https?://\S+$');
ALTER TABLE purchase_receipt ADD COLUMN actual_unit_price numeric(12,2) CHECK (actual_unit_price IS NULL OR actual_unit_price >= 0);

DROP VIEW purchase_line_view;
CREATE VIEW purchase_line_view AS
SELECT l.*, s.site_code, sp.supplier_name, sp.supplier_code, supplier_status_at(l.supplier_id, l.site_id) AS supplier_status,
       l.quantity * l.unit_price AS amount, needs_second_approval(l) AS needs_second,
       ru.full_name AS requested_by_name, au.full_name AS approved_by_name, a2.full_name AS approved2_by_name,
       po.po_code, po.external_po_number, il.lot_code, eq.equipment_code,
       (SELECT max(r.received_at) FROM purchase_receipt r WHERE r.purchase_line_id = l.id) AS last_received_at,
       (SELECT string_agg(DISTINCT r.discrepancy::text, ', ') FROM purchase_receipt r WHERE r.purchase_line_id = l.id AND r.discrepancy <> 'None') AS discrepancies,
       (SELECT sum(r.quantity * r.actual_unit_price) FROM purchase_receipt r WHERE r.purchase_line_id = l.id AND r.actual_unit_price IS NOT NULL) AS actual_amount
  FROM purchase_line l JOIN lab_site s ON s.id = l.site_id LEFT JOIN supplier sp ON sp.id = l.supplier_id
  JOIN app_user ru ON ru.id = l.requested_by LEFT JOIN app_user au ON au.id = l.approved_by LEFT JOIN app_user a2 ON a2.id = l.approved2_by
  LEFT JOIN purchase_order po ON po.id = l.purchase_order_id LEFT JOIN inventory_lot il ON il.id = l.lot_id LEFT JOIN equipment eq ON eq.id = l.equipment_id;

-- A requested inventory item's request line carries its web link (as in 011, plus item_url)
CREATE OR REPLACE FUNCTION inventory_lot_purchase_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.purchasing_internal', true), ''); l purchase_line;
BEGIN
    IF NEW.purchase_line_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO l FROM purchase_line WHERE id = NEW.purchase_line_id;
    PERFORM set_purchasing_internal(true);
    IF TG_OP = 'INSERT' AND l.id IS NULL THEN
        INSERT INTO purchase_line (id, site_id, line_type, description, supplier_id, catalog_number, quantity, unit, lot_id, status, justification, item_url)
        VALUES (NEW.purchase_line_id, NEW.site_id, 'Inventory item', COALESCE(NEW.item_name, NEW.item_description, 'Inventory item'), NEW.supplier_id,
                NEW.catalog_number, COALESCE(NEW.requested_quantity, 1), NEW.unit, NEW.id, 'Requested', NEW.notes, NEW.item_url);
    ELSIF TG_OP = 'UPDATE' AND l.id IS NOT NULL THEN
        -- received on the lot page (not through Purchasing > Receive): count it on the request
        IF NEW.receipt_status = 'Received' AND OLD.receipt_status <> 'Received' AND COALESCE(current_setting('lims.receiving_line', true), '') = '' THEN
            UPDATE purchase_line SET received_quantity = received_quantity + COALESCE(NEW.quantity_received, 0),
                   status = CASE WHEN received_quantity + COALESCE(NEW.quantity_received, 0) >= quantity THEN 'Received' ELSE 'Partly received' END::purchase_line_status
             WHERE id = l.id;
            INSERT INTO purchase_receipt (purchase_line_id, quantity, lot_id, discrepancy, note)
            VALUES (l.id, COALESCE(NEW.quantity_received, 0), NEW.id, 'None', 'Received on the inventory item page');
        ELSIF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' AND l.status IN ('Requested','Awaiting second approval','Approved') THEN
            UPDATE purchase_line SET status = 'Cancelled' WHERE id = l.id;
        ELSIF NEW.receipt_status IN ('Requested') AND (NEW.requested_quantity IS DISTINCT FROM OLD.requested_quantity OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id
              OR NEW.catalog_number IS DISTINCT FROM OLD.catalog_number OR NEW.item_url IS DISTINCT FROM OLD.item_url) AND l.status IN ('Requested','Awaiting second approval') THEN
            UPDATE purchase_line SET quantity = COALESCE(NEW.requested_quantity, quantity), supplier_id = NEW.supplier_id, catalog_number = NEW.catalog_number,
                   item_url = NEW.item_url, status = 'Requested', approved_by = NULL, approved_at = NULL WHERE id = l.id;
        END IF;
    END IF;
    PERFORM set_config('lims.purchasing_internal', was, true);
    RETURN NULL;
END $$;

-- Receive (part of) a line, as in 011, plus:
--  p_actual_price: what was actually paid per unit (optional; the request keeps its estimate)
--  p_inventory: for an Other or Service line, put what arrived into inventory now:
--               {"item_name", "chemical_types": [...], "quantity", "unit"}; the new item opens to be filled out
DROP FUNCTION receive_purchase_line(uuid, numeric, boolean, receipt_discrepancy, text, uuid, text, date, date, uuid, jsonb);
CREATE FUNCTION receive_purchase_line(p_line uuid, p_quantity numeric, p_more_to_come boolean, p_discrepancy receipt_discrepancy, p_note text,
        p_packing_slip uuid, p_manufacturer_lot text, p_expiration date, p_retest date, p_location uuid, p_equipment jsonb,
        p_actual_price numeric DEFAULT NULL, p_inventory jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l purchase_line; lot inventory_lot; v_back uuid; v_eq uuid; v_rc uuid; v_new uuid; v_left numeric; v_types chemical_type[];
        was text := COALESCE(current_setting('lims.equipment_internal', true), '');
BEGIN
    SELECT * INTO l FROM purchase_line WHERE id = p_line FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
    IF l.status NOT IN ('Ordered','Partly received') THEN RAISE EXCEPTION 'Request % is %: only ordered requests can be received', l.line_code, lower(l.status::text); END IF;
    PERFORM require_permission_at('purchasing.receive', l.site_id);
    PERFORM assert_signed('receive a delivery');
    PERFORM ensure_reason('Received' || CASE WHEN p_discrepancy IS NOT NULL AND p_discrepancy <> 'None' THEN ' (' || p_discrepancy::text || ')' ELSE '' END);
    IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'Enter the quantity received'; END IF;
    IF p_actual_price IS NOT NULL AND p_actual_price < 0 THEN RAISE EXCEPTION 'The actual price cannot be negative'; END IF;
    v_left := l.quantity - l.received_quantity - p_quantity;
    IF l.line_type = 'Inventory item' THEN
        IF p_quantity = 0 THEN RAISE EXCEPTION 'Enter the quantity received'; END IF;
        SELECT * INTO lot FROM inventory_lot WHERE id = l.lot_id;
        PERFORM set_config('lims.receiving_line', '1', true);
        PERFORM receive_lot(l.lot_id, p_quantity, NULL, p_manufacturer_lot, p_expiration, p_retest, p_location, NULL);
        IF p_more_to_come AND v_left > 0 THEN
            PERFORM set_purchasing_internal(true);
            INSERT INTO inventory_lot (site_id, chemical_id, item_name, cas_number, physical_form, item_description, chemical_types, supplier_id, manufacturer_id,
                                       catalog_number, receipt_status, requested_quantity, unit, concentration, concentration_unit, storage_condition,
                                       storage_location_id, reorder_of_lot_id, purchase_line_id, notes, item_url)
            VALUES (lot.site_id, lot.chemical_id, lot.item_name, lot.cas_number, lot.physical_form, lot.item_description, lot.chemical_types, lot.supplier_id,
                    lot.manufacturer_id, lot.catalog_number, 'Requested', v_left, lot.unit, lot.concentration, lot.concentration_unit, lot.storage_condition,
                    lot.storage_location_id, lot.reorder_of_lot_id, l.id, 'Back-order of ' || l.line_code, lot.item_url)
            RETURNING id INTO v_back;
            UPDATE inventory_lot SET receipt_status = 'Approved' WHERE id = v_back;
            UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE id = v_back;
            INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
            SELECT v_back, analyte_id, concentration, concentration_unit FROM lot_analyte WHERE lot_id = l.lot_id AND status = 'Active' ON CONFLICT DO NOTHING;
            PERFORM set_purchasing_internal(false);
        END IF;
        PERFORM set_config('lims.receiving_line', '', true);
    ELSIF l.line_type = 'Equipment' THEN
        IF p_equipment IS NULL OR COALESCE(p_equipment->>'owner_group_id', '') = '' THEN RAISE EXCEPTION 'Say what the equipment is and which group is responsible for it'; END IF;
        PERFORM set_config('lims.equipment_internal', '1', true);
        INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, notes, in_service_date, admin_status)
        VALUES (l.site_id, COALESCE(NULLIF(p_equipment->>'equipment_name', ''), l.description), (p_equipment->>'equipment_type_id')::uuid,
                (p_equipment->>'department_id')::uuid, NULLIF(p_equipment->>'manufacturer', ''), NULLIF(p_equipment->>'model', ''),
                NULLIF(p_equipment->>'serial_number', ''), 'Received on ' || l.line_code, NULL, 'In Service')
        RETURNING id INTO v_eq;
        INSERT INTO equipment_owner (equipment_id, group_id) VALUES (v_eq, (p_equipment->>'owner_group_id')::uuid);
        INSERT INTO equipment_tag (equipment_id, reason, source, description) VALUES (v_eq, 'Qualification', 'New equipment', 'New equipment received on ' || l.line_code || ': install and qualify before use');
        PERFORM set_config('lims.equipment_internal', was, true);
    ELSIF p_inventory IS NOT NULL THEN
        -- an Other or Service purchase put into inventory (Alex, 2026-10-13: receiving creates the item to fill out)
        IF p_quantity = 0 THEN RAISE EXCEPTION 'Enter the quantity received'; END IF;
        SELECT COALESCE(array_agg(x::chemical_type), '{Consumable}') INTO v_types FROM jsonb_array_elements_text(COALESCE(p_inventory->'chemical_types', '[]')) x;
        IF cardinality(v_types) = 0 THEN v_types := '{Consumable}'; END IF;
        PERFORM set_purchasing_internal(true);
        PERFORM set_config('lims.receiving_line', '1', true);
        INSERT INTO inventory_lot (site_id, item_name, chemical_types, supplier_id, catalog_number, manufacturer_lot, receipt_status, quantity_received, unit,
                                   container_count, expiration_date, retest_date, storage_location_id, purchase_line_id, item_url, notes)
        VALUES (l.site_id, COALESCE(NULLIF(btrim(p_inventory->>'item_name'), ''), l.description), v_types, l.supplier_id, l.catalog_number, NULLIF(btrim(p_manufacturer_lot), ''),
                'Received', COALESCE(NULLIF(p_inventory->>'quantity', '')::numeric, p_quantity), COALESCE(NULLIF(btrim(p_inventory->>'unit'), ''), NULLIF(btrim(l.unit), ''), 'each'),
                CASE WHEN p_quantity = trunc(p_quantity) THEN p_quantity::integer END, p_expiration, p_retest, p_location, l.id, l.item_url,
                'Received on ' || l.line_code)
        RETURNING id INTO v_new;
        PERFORM set_config('lims.receiving_line', '', true);
        PERFORM set_purchasing_internal(false);
    END IF;
    INSERT INTO purchase_receipt (purchase_line_id, quantity, lot_id, equipment_id, discrepancy, note, packing_slip_id, actual_unit_price)
    VALUES (l.id, p_quantity, COALESCE(v_new, l.lot_id), v_eq, COALESCE(p_discrepancy, 'None'), NULLIF(btrim(p_note), ''), p_packing_slip, p_actual_price) RETURNING id INTO v_rc;
    PERFORM set_purchasing_internal(true);
    UPDATE purchase_line SET received_quantity = received_quantity + p_quantity,
           status = CASE WHEN p_more_to_come AND v_left > 0 THEN 'Partly received' ELSE 'Received' END::purchase_line_status,
           lot_id = COALESCE(v_back, v_new, lot_id), equipment_id = COALESCE(v_eq, equipment_id)
     WHERE id = l.id;
    PERFORM set_purchasing_internal(false);
    RETURN v_rc;
END $$;

-------------------------------------------------------------------------------
-- 2. MEDIA QUALIFICATION
-------------------------------------------------------------------------------
-- 2a. Which lots need qualifying: every new Media lot (lots already in the system when this ran are left as they were).
--     Demo data and rule-test fixtures loaded with lims.media_preapproved = '1' count as already qualified.
ALTER TABLE inventory_lot ADD COLUMN qualification_required boolean NOT NULL DEFAULT false;
CREATE FUNCTION media_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.media_internal', true), '') = '1' OR in_group_sync()
$$;
CREATE FUNCTION inventory_lot_media_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE pre boolean := COALESCE(current_setting('lims.media_preapproved', true), '') = '1';
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.qualification_required := 'Media' = ANY (NEW.chemical_types) AND NOT pre;
        RETURN NEW;
    END IF;
    IF NEW.qualification_required IS DISTINCT FROM OLD.qualification_required AND NOT media_internal() THEN
        RAISE EXCEPTION 'Whether a media lot needs qualifying is set by the system';
    END IF;
    -- a lot that becomes Media later needs qualifying too
    IF 'Media' = ANY (NEW.chemical_types) AND NOT ('Media' = ANY (OLD.chemical_types)) AND NOT pre THEN NEW.qualification_required := true; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a03_media BEFORE INSERT OR UPDATE OF chemical_types, qualification_required ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_media_rule();

-- 2b. The lab's internal "client" for its own samples (media qualification); not a customer. Made the first time a
--     qualification needs it (not here: on a new database the demo clients come after the migrations and keep their codes).
CREATE FUNCTION internal_client() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_client uuid; v_contact uuid;
BEGIN
    SELECT id INTO v_client FROM client WHERE legal_name = 'Internal: media qualification';
    IF v_client IS NOT NULL THEN RETURN v_client; END IF;
    INSERT INTO client (legal_name, display_name, account_status)
    VALUES ('Internal: media qualification', 'Internal: media qualification', 'Active') RETURNING id INTO v_client;
    SELECT id INTO v_contact FROM contact WHERE lower(email) = 'media.qualification@lims3.internal';
    IF v_contact IS NULL THEN
        INSERT INTO contact (first_name, last_name, email, job_title)
        VALUES ('Lab', 'Media QC', 'media.qualification@lims3.internal', 'The lab itself (internal samples)') RETURNING id INTO v_contact;
    END IF;
    INSERT INTO client_contact (client_id, contact_id, roles, portal_visible) VALUES (v_client, v_contact, '{ORDERING}', false) ON CONFLICT DO NOTHING;
    RETURN v_client;
END $$;

-- 2c. A media qualification test sample is a requested test with no quote: it names its media lot instead
ALTER TABLE requested_test ADD COLUMN media_lot_id uuid REFERENCES inventory_lot(id);
ALTER TABLE requested_test ALTER COLUMN quoted_line_id DROP NOT NULL;
ALTER TABLE requested_test ADD CONSTRAINT requested_test_quoted_or_media CHECK (quoted_line_id IS NOT NULL OR media_lot_id IS NOT NULL);

-- as in 004, plus: a media qualification test is not priced and not rushed (its due date follows the test's own TAT)
CREATE OR REPLACE FUNCTION requested_test_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    q quoted_test_configuration; e test_catalog_entry; s sample; o lab_order; rt quote_rush_term;
    v_list numeric; v_active boolean; v_needs boolean;
BEGIN
    SELECT * INTO q FROM quoted_test_configuration WHERE id = NEW.quoted_line_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = NEW.test_id;
    SELECT * INTO s FROM sample WHERE id = NEW.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.test_id <> OLD.test_id OR NEW.quoted_line_id IS DISTINCT FROM OLD.quoted_line_id OR NEW.sample_id <> OLD.sample_id
           OR NEW.test_version_id <> OLD.test_version_id OR NEW.media_lot_id IS DISTINCT FROM OLD.media_lot_id THEN
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

    IF q.id IS NULL THEN
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

-- The views over requested tests keep media qualification tests (they have no quote or project)
DROP VIEW lab_order_view;
DROP VIEW requested_test_view;
CREATE VIEW requested_test_view AS
SELECT rt.*, t.test_code, t.test_name, e.pricing_mode, e.rush_schedule_id AS test_rush_schedule_id, s.sample_code, s.client_sample_id, s.lab_order_id, s.logged_at,
       o.order_code, o.site_id, o.client_id, p.project_code, p.project_name, pv.id AS project_version_id, pv.version_no AS project_version_no, p.id AS project_id,
       rft.tier_name AS rush_tier_name, rfs.schedule_name AS rush_schedule,
       (SELECT count(*) FROM requested_analyte ra WHERE ra.requested_test_id = rt.id) AS analytes_total,
       (SELECT count(*) FROM requested_analyte ra WHERE ra.requested_test_id = rt.id AND ra.included) AS analytes_included,
       CASE WHEN rt.rush_status = 'Pending Approval'
            THEN rt.rush_requested_at + make_interval(secs => (rft.escalation_hours * 3600)::double precision) END AS approval_due_at
  FROM requested_test rt
  JOIN test t ON t.id = rt.test_id
  JOIN test_catalog_entry e ON e.test_id = t.id
  JOIN sample s ON s.id = rt.sample_id
  JOIN lab_order o ON o.id = s.lab_order_id
  LEFT JOIN quoted_test_configuration q ON q.id = rt.quoted_line_id
  LEFT JOIN project_version pv ON pv.id = q.project_version_id
  LEFT JOIN project p ON p.id = pv.project_id
  LEFT JOIN rush_fee_tier rft ON rft.id = rt.rush_tier_id
  LEFT JOIN rush_fee_schedule rfs ON rfs.id = rft.schedule_id;
CREATE VIEW lab_order_view AS
SELECT o.*, COALESCE(c.display_name, c.legal_name) AS client_name, c.account_status, c.is_gmp_client, c.client_code,
       ls.site_code, ls.site_name, ct.first_name || ' ' || ct.last_name AS ordering_contact, ct.email AS ordering_email, ct.contact_code AS ordering_contact_code,
       (SELECT count(*) FROM sample s WHERE s.lab_order_id = o.id AND s.status <> 'Cancelled') AS sample_count,
       (SELECT count(*) FROM sample s WHERE s.lab_order_id = o.id AND s.status = 'Logged') AS logged_count,
       (SELECT max(due_date) FROM sample_view sv WHERE sv.lab_order_id = o.id AND sv.status <> 'Cancelled') AS due_date,
       (SELECT COALESCE(sum(sample_value), 0) FROM sample_view sv WHERE sv.lab_order_id = o.id AND sv.status <> 'Cancelled') AS order_value,
       (SELECT count(*) FROM requested_test_view r WHERE r.lab_order_id = o.id AND r.rush_status = 'Pending Approval') AS rush_pending,
       (SELECT count(*) FROM requested_test_view r WHERE r.lab_order_id = o.id AND r.rush_status IN ('Auto-accepted','Approved') AND r.status <> 'Cancelled') AS rush_active,
       client_can_release_report(o.client_id) AS reports_releasable
  FROM lab_order o
  JOIN client c ON c.id = o.client_id
  JOIN lab_site ls ON ls.id = o.site_id
  JOIN contact ct ON ct.id = o.ordering_contact_id;

-- The qualification test's limits (its version's default specifications) are set by the system, not by a person
CREATE OR REPLACE FUNCTION specification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version uuid; v_site uuid; v_pv uuid; rt requested_test;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.quoted_line_id IS DISTINCT FROM OLD.quoted_line_id OR NEW.requested_test_id IS DISTINCT FROM OLD.requested_test_id
                             OR NEW.analyte_id <> OLD.analyte_id) THEN
        RAISE EXCEPTION 'Remove the specification (Inactive) and add a new one instead';
    END IF;
    NEW.text_value := NULLIF(btrim(NEW.text_value), '');
    NEW.unit := canonical_unit(NEW.unit, enum_range(NULL::unit_dimension), 'Specification unit');
    IF NEW.quoted_line_id IS NOT NULL THEN
        SELECT q.project_version_id, v.id INTO v_pv, v_version FROM quoted_test_configuration q
          LEFT JOIN test_version v ON v.test_id = q.test_id AND v.status = 'Effective' WHERE q.id = NEW.quoted_line_id;
        IF NOT version_is_editable(v_pv) THEN RAISE EXCEPTION 'Specifications are locked once a quote is issued; create a new version of the quote'; END IF;
        IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    ELSE
        SELECT * INTO rt FROM requested_test WHERE id = NEW.requested_test_id;
        v_version := rt.test_version_id;
        IF rt.status = 'Cancelled' THEN RAISE EXCEPTION 'The test is cancelled'; END IF;
        SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = rt.sample_id;
        IF NOT (rt.media_lot_id IS NOT NULL AND media_internal()) THEN
            PERFORM require_permission_at('orders.edit', v_site);
        END IF;
    END IF;
    IF NEW.status = 'Active' AND v_version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version_analyte WHERE test_version_id = v_version AND analyte_id = NEW.analyte_id AND status = 'Active') THEN
        RAISE EXCEPTION '% is not an analyte of this test', (SELECT analyte_name FROM analyte WHERE id = NEW.analyte_id);
    END IF;
    RETURN NEW;
END $$;

-- 2d. One qualification per lot and use: which test the media is for, which qualification test proves it
CREATE SEQUENCE media_qualification_seq;
CREATE TABLE media_qualification (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_code     text NOT NULL UNIQUE DEFAULT 'MQ-' || lpad(nextval('media_qualification_seq')::text, 6, '0'),
    lot_id                 uuid NOT NULL REFERENCES inventory_lot(id),
    use_test_id            uuid NOT NULL REFERENCES test(id),        -- the test the media is to be used for
    qualification_test_id  uuid NOT NULL REFERENCES test(id),        -- the test run to qualify it (e.g. growth promotion)
    requested_test_id      uuid NOT NULL REFERENCES requested_test(id),
    status                 text NOT NULL DEFAULT 'Testing' CHECK (status IN ('Testing','Passed','Failed','Cancelled')),
    batch_id               uuid REFERENCES test_batch(id),
    decided_at             timestamptz,
    decided_by             uuid REFERENCES app_user(id),
    decision_note          text,
    record_version         integer NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at            timestamptz NOT NULL DEFAULT now(),
    modified_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX media_qualification_one_live ON media_qualification (lot_id, use_test_id) WHERE status IN ('Testing','Passed');
CREATE INDEX media_qualification_rt_idx ON media_qualification (requested_test_id);
CALL make_gxp('media_qualification', false);
CREATE FUNCTION media_qualification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.lot_id <> OLD.lot_id OR NEW.use_test_id <> OLD.use_test_id OR NEW.requested_test_id <> OLD.requested_test_id) THEN
        RAISE EXCEPTION 'A media qualification cannot change its lot or tests';
    END IF;
    IF NOT media_internal() THEN RAISE EXCEPTION 'Media qualifications are started from the lot (Qualify media) and decided by the QC Review'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON media_qualification FOR EACH ROW EXECUTE FUNCTION media_qualification_rules();

-- 2e. Start a qualification. p_items = [{"use_test_id": uuid, "qualification_test_id": uuid}, ...]. Makes (once) the lot's
--     test sample, with the lot's ID, on the lab's internal order, and orders each qualification test on it (logged at once).
CREATE FUNCTION qualify_media(p_lot uuid, p_items jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; it jsonb; v_use test; v_q test; v_ver uuid; v_order uuid; v_sample uuid; v_rt uuid; v_contact uuid; v_client uuid; n integer := 0;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); mi text := COALESCE(current_setting('lims.media_internal', true), '');
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Lot not found'; END IF;
    PERFORM assert_site_access(l.site_id);
    PERFORM require_permission_at('inventory.qualify', l.site_id);
    IF NOT 'Media' = ANY (l.chemical_types) THEN RAISE EXCEPTION 'Lot % is not media: only media lots are qualified this way', l.lot_code; END IF;
    IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Receive lot % before qualifying it', l.lot_code; END IF;
    IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be qualified', l.lot_code, l.status; END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Choose at least one test the media is for, and the qualification test for it';
    END IF;
    PERFORM ensure_reason('Media qualification started for ' || l.lot_code);
    PERFORM set_config('lims.group_sync', '1', true);     -- the system makes the internal order and sample (checked above)
    PERFORM set_config('lims.media_internal', '1', true);
    SELECT s.id INTO v_sample FROM sample s WHERE s.sample_code = l.lot_code;
    IF v_sample IS NULL THEN
        v_client := internal_client();   -- (made on first use)
        SELECT cc.contact_id INTO v_contact FROM client_contact cc WHERE cc.client_id = v_client AND 'ORDERING' = ANY (cc.roles) LIMIT 1;
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, notes, status)
        VALUES (v_client, l.site_id, v_contact, 'Media qualification of ' || l.lot_code || ' ' || l.item_name, 'Received') RETURNING id INTO v_order;
        INSERT INTO sample (lab_order_id, sample_code, client_sample_id, description, lot, received_at, logged_at, logged_by, status, number_of_units)
        VALUES (v_order, l.lot_code, l.manufacturer_lot, 'Media qualification: ' || l.item_name, l.manufacturer_lot, clock_timestamp(), clock_timestamp(),
                current_app_user(), 'Logged', 1)
        RETURNING id INTO v_sample;
    END IF;
    FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        SELECT * INTO v_use FROM test WHERE id = (it->>'use_test_id')::uuid;
        SELECT * INTO v_q FROM test WHERE id = (it->>'qualification_test_id')::uuid;
        IF v_use.id IS NULL OR v_q.id IS NULL THEN RAISE EXCEPTION 'Choose the test the media is for and the qualification test for it'; END IF;
        IF v_use.site_id IS DISTINCT FROM l.site_id OR v_q.site_id IS DISTINCT FROM l.site_id THEN
            RAISE EXCEPTION 'Both tests must be tests of the lot''s lab';
        END IF;
        IF v_use.id = v_q.id THEN RAISE EXCEPTION 'The qualification test must be a different test from the one the media is for (for example growth promotion)'; END IF;
        IF EXISTS (SELECT 1 FROM media_qualification WHERE lot_id = l.id AND use_test_id = v_use.id AND status IN ('Testing','Passed')) THEN
            RAISE EXCEPTION 'Lot % is already % for %', l.lot_code,
                (SELECT CASE status WHEN 'Passed' THEN 'qualified' ELSE 'being qualified' END FROM media_qualification WHERE lot_id = l.id AND use_test_id = v_use.id AND status IN ('Testing','Passed')),
                v_use.test_name;
        END IF;
        SELECT id INTO v_ver FROM test_version WHERE test_id = v_q.id AND status = 'Effective';
        IF v_ver IS NULL THEN RAISE EXCEPTION '% has no approved (Effective) version yet', v_q.test_name; END IF;
        SELECT id INTO v_rt FROM requested_test WHERE sample_id = v_sample AND test_id = v_q.id AND status <> 'Cancelled';
        IF v_rt IS NULL THEN
            INSERT INTO requested_test (sample_id, test_id, test_version_id, media_lot_id) VALUES (v_sample, v_q.id, v_ver, l.id) RETURNING id INTO v_rt;
            INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
            SELECT v_rt, a.analyte_id, a.default_spec_min, a.default_spec_max, a.default_spec_text, a.reporting_unit, 'Lab'
              FROM test_version_analyte a WHERE a.test_version_id = v_ver AND a.status = 'Active'
               AND (a.default_spec_min IS NOT NULL OR a.default_spec_max IS NOT NULL OR NULLIF(btrim(a.default_spec_text), '') IS NOT NULL);
        END IF;
        INSERT INTO media_qualification (lot_id, use_test_id, qualification_test_id, requested_test_id) VALUES (l.id, v_use.id, v_q.id, v_rt);
        n := n + 1;
    END LOOP;
    PERFORM set_config('lims.media_internal', mi, true);
    PERFORM set_config('lims.group_sync', gs, true);
    RETURN v_sample;
END $$;

-- 2f. QA's approval of the batch decides: Passed (released for its test) unless a result does not conform
CREATE FUNCTION media_qualification_decide() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q media_qualification; bad text; mi text := COALESCE(current_setting('lims.media_internal', true), '');
BEGIN
    IF NEW.status <> 'Approved' OR OLD.status = 'Approved' THEN RETURN NULL; END IF;
    PERFORM set_config('lims.media_internal', '1', true);
    FOR q IN SELECT mq.* FROM media_qualification mq
              WHERE mq.status = 'Testing' AND mq.requested_test_id IN (SELECT e.requested_test_id FROM batch_entry e WHERE e.batch_id = NEW.id AND e.status = 'Active') LOOP
        SELECT string_agg(a.analyte_name || ' ' || COALESCE(tr.reported, tr.value_text, ''), ', ' ORDER BY a.analyte_name) INTO bad
          FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id
         WHERE tr.requested_test_id = q.requested_test_id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.conformance = 'Does not conform';
        UPDATE media_qualification SET status = CASE WHEN bad IS NULL THEN 'Passed' ELSE 'Failed' END, batch_id = NEW.id,
               decided_at = clock_timestamp(), decided_by = NEW.reviewed_by,
               decision_note = CASE WHEN bad IS NULL THEN 'Released for use: QC Review of ' || NEW.batch_code || ' approved'
                                    ELSE 'Not released: ' || bad || ' did not conform (QC Review of ' || NEW.batch_code || ')' END
         WHERE id = q.id;
    END LOOP;
    PERFORM set_config('lims.media_internal', mi, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_media_decide AFTER UPDATE OF status ON test_batch FOR EACH ROW EXECUTE FUNCTION media_qualification_decide();

-- What a lot's qualification says, in a word (null = no qualification needed)
CREATE FUNCTION media_status(p_lot uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN NOT l.qualification_required THEN NULL
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.status = 'Passed') THEN 'Qualified'
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.status = 'Testing') THEN 'Being qualified'
                WHEN EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.status = 'Failed') THEN 'Failed qualification'
                ELSE 'Awaiting qualification' END
      FROM inventory_lot l WHERE l.id = p_lot
$$;

-- 2g. At the bench: a media lot that needs qualifying is used only for the tests it passed (or in its own qualification)
CREATE FUNCTION entry_material_media_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; b test_batch; st text;
BEGIN
    IF NEW.status <> 'Active' OR (TG_OP = 'UPDATE' AND OLD.status = 'Active') OR testing_internal() THEN RETURN NEW; END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    IF NOT COALESCE(l.qualification_required, false) THEN RETURN NEW; END IF;
    SELECT b2.* INTO b FROM step_run r JOIN test_batch b2 ON b2.id = r.batch_id WHERE r.id = NEW.step_run_id;
    IF EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = b.id AND rt.media_lot_id = l.id) THEN RETURN NEW; END IF;
    IF EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = l.id AND q.use_test_id = b.test_id AND q.status = 'Passed') THEN RETURN NEW; END IF;
    SELECT status INTO st FROM media_qualification q WHERE q.lot_id = l.id AND q.use_test_id = b.test_id ORDER BY q.created_at DESC LIMIT 1;
    RAISE EXCEPTION 'Lot % (%) is media that is not qualified for %: %', l.lot_code, l.item_name, (SELECT test_name FROM test WHERE id = b.test_id),
        CASE st WHEN 'Testing' THEN 'its qualification is still being tested; it can be used once QA approves it'
                WHEN 'Failed' THEN 'it failed its qualification for this test'
                ELSE 'qualify it for this test first (on the lot''s page: Qualify media)' END;
END $$;
CREATE TRIGGER a02_media BEFORE INSERT OR UPDATE OF status ON entry_material FOR EACH ROW EXECUTE FUNCTION entry_material_media_rule();

-------------------------------------------------------------------------------
-- 3. BATCHES: media samples outside the batch rules; adding and removing samples before the batch starts
-------------------------------------------------------------------------------
ALTER TABLE batch_entry ADD COLUMN removed_at timestamptz;
ALTER TABLE batch_entry ADD COLUMN removed_by uuid REFERENCES app_user(id);

-- The backlog: as in 016, plus whether the item is a media qualification sample; a test removed from a batch is back
DROP VIEW test_pool_view;
CREATE VIEW test_pool_view AS
SELECT x.*, CASE WHEN x.kind = 'Re-prep' THEN 0 WHEN x.is_rush THEN 1 ELSE 2 END AS priority_rank,
       CASE WHEN x.kind = 'Re-prep' THEN 'Re-prep' WHEN x.is_rush THEN 'Rush' ELSE 'Standard' END AS priority
  FROM (
    SELECT rt.id AS requested_test_id, NULL::uuid AS reprep_request_id, 'New'::text AS kind, 1 AS replicates, NULL::text AS reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id AS sample_id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text AS rush_status,
           rt.rush_status IN ('Auto-accepted','Approved') AS is_rush, s.logged_at, rt.created_at AS pooled_at,
           rt.media_lot_id IS NOT NULL AS is_media, rt.media_lot_id
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
      JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rt.status = 'In Pool'
       AND EXISTS (SELECT 1 FROM workflow_step ws WHERE ws.test_version_id = rt.test_version_id AND ws.status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id
                        WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled' AND e.removed_at IS NULL)
    UNION ALL
    SELECT rp.requested_test_id, rp.id, 'Re-prep', rp.replicates, rp.reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text,
           rt.rush_status IN ('Auto-accepted','Approved'), s.logged_at, rp.created_at,
           rt.media_lot_id IS NOT NULL, rt.media_lot_id
      FROM reprep_request rp JOIN requested_test rt ON rt.id = rp.requested_test_id JOIN sample s ON s.id = rt.sample_id
      JOIN lab_order o ON o.id = s.lab_order_id JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rp.status = 'Pooled' AND rt.status <> 'Cancelled'
  ) x;

-- The client samples of a batch (media qualification samples are outside the batch size and QC brackets: Alex, 2026-10-13)
CREATE FUNCTION batch_client_sample_count(p_batch uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT count(*)::int FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
     WHERE e.batch_id = p_batch AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL
$$;

-- create_batch: as in 021, except media qualification samples do not count toward the maximum or the brackets, and a
-- matrix spike is made from a client sample
CREATE OR REPLACE FUNCTION create_batch(p_site uuid, p_version uuid, p_items jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; bs workflow_step; v_max integer := 500; v_batch uuid; it record; pos integer := 0; n integer := 0; n_all integer := 0; v_full boolean := false;
        q jsonb; i integer; k integer; v_orig batch_entry; v_obatch text; v_every integer; v_first uuid; samples uuid[] := '{}'; e uuid; v_label text; v_ent uuid;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Test version not found'; END IF;
    PERFORM require_permission_at('testing.perform', p_site);
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'Batching';
    IF bs.id IS NOT NULL THEN
        IF NOT can_perform_step(current_app_user(), bs.id) THEN
            RAISE EXCEPTION 'Batching % is done by the % department; you are not in a group for it', t.test_name,
                COALESCE((SELECT department_name FROM department WHERE id = step_department(bs.id)), 'test''s');
        END IF;
        v_max := COALESCE((bs.config->>'max_samples')::int, 500);
    END IF;
    PERFORM set_testing_internal(true);
    INSERT INTO test_batch (site_id, test_id, test_version_id, department_id, assigned_to)
    VALUES (p_site, t.id, v.id, t.department_id, current_app_user()) RETURNING id INTO v_batch;
    FOR it IN SELECT p.* FROM test_pool_view p
               WHERE p.site_id = p_site AND p.test_version_id = p_version
                 AND (p_items IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j
                        WHERE (j->>'requested_test_id')::uuid = p.requested_test_id AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text))
               ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code LOOP
        IF NOT it.is_media THEN   -- client samples stop at the first that does not fit (as before); media samples still join
            IF v_full OR n + it.replicates > v_max THEN v_full := true; CONTINUE; END IF;
        END IF;
        FOR i IN 1..it.replicates LOOP
            IF NOT it.is_media THEN n := n + 1; END IF;
            n_all := n_all + 1; pos := pos + 1;
            INSERT INTO batch_entry (batch_id, position, entry_type, requested_test_id, label, replicate_no, reprep_request_id)
            VALUES (v_batch, pos, 'Sample', it.requested_test_id,
                    CASE WHEN it.kind = 'Re-prep'
                         THEN 'RP' || ((SELECT count(*) FROM batch_entry x WHERE x.requested_test_id = it.requested_test_id AND x.reprep_request_id IS NOT NULL) + 1) || '-'
                         ELSE '' END || COALESCE(it.sample_code, it.client_sample_id),
                    i, it.reprep_request_id) RETURNING id INTO e;
            IF NOT it.is_media THEN samples := samples || e; END IF;
            IF v_first IS NULL AND it.is_media THEN v_ent := COALESCE(v_ent, e); END IF;
        END LOOP;
        IF it.reprep_request_id IS NOT NULL THEN UPDATE reprep_request SET status = 'Batched', batch_id = v_batch WHERE id = it.reprep_request_id; END IF;
    END LOOP;
    IF n_all = 0 THEN RAISE EXCEPTION 'Nothing in the pool for this test at this lab'; END IF;
    v_first := COALESCE(samples[1], v_ent);
    FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(bs.config->'qc', '[]')) LOOP
        IF q->>'frequency' = 'Once' THEN
            FOR i IN 1..COALESCE((q->>'count')::int, 1) LOOP
                pos := pos + 1;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label, parent_entry_id)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', q->>'qc_class',
                        q->>'qc_type' || CASE WHEN COALESCE((q->>'count')::int, 1) > 1 THEN ' ' || i ELSE '' END,
                        CASE WHEN q->>'qc_type' IN ('Matrix Spike','Matrix Spike Duplicate') THEN v_first END);
            END LOOP;
        ELSIF q->>'frequency' = 'Every N' THEN
            v_every := GREATEST(COALESCE((q->>'every_n')::int, 10), 1);
            k := ceil(n::numeric / v_every)::int + 1;
            FOR i IN 1..k LOOP
                pos := pos + 1;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', q->>'qc_class', q->>'qc_type' || '-' || i);
            END LOOP;
        ELSIF q->>'frequency' = 'Daily' THEN
            SELECT x.* INTO v_orig FROM batch_entry x JOIN test_batch ob ON ob.id = x.batch_id JOIN lab_site ls ON ls.id = ob.site_id
             WHERE ob.site_id = p_site AND ob.test_id = t.id AND ob.id <> v_batch AND ob.status <> 'Cancelled' AND x.status = 'Active'
               AND x.qc_type = q->>'qc_type' AND x.daily_of_entry_id IS NULL AND x.label LIKE '%(daily)'
               AND (ob.created_at AT TIME ZONE ls.time_zone)::date = site_today(p_site)
             ORDER BY ob.created_at LIMIT 1;
            pos := pos + 1;
            IF v_orig.id IS NULL THEN
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', COALESCE(q->>'qc_class', 'Prep'), q->>'qc_type' || ' (daily)');
            ELSE
                SELECT batch_code INTO v_obatch FROM test_batch WHERE id = v_orig.batch_id;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label, daily_of_entry_id)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', v_orig.qc_class, q->>'qc_type' || ' (daily, from ' || v_obatch || ')', v_orig.id);
            END IF;
        END IF;
    END LOOP;
    PERFORM batch_order(v_batch);
    INSERT INTO step_run (batch_id, step_id) SELECT v_batch, id FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    PERFORM set_testing_internal(false);
    RETURN v_batch;
END $$;

-- Has bench work started? (anything recorded at a step after Batching)
CREATE FUNCTION batch_started(p_batch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (
        SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
         WHERE r.batch_id = p_batch AND ws.step_type <> 'Batching'
           AND (r.status <> 'Not started' OR r.fields <> '{}'::jsonb
                OR EXISTS (SELECT 1 FROM entry_value v WHERE v.step_run_id = r.id)
                OR EXISTS (SELECT 1 FROM entry_material m WHERE m.step_run_id = r.id AND m.status = 'Active')
                OR EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active')
                OR EXISTS (SELECT 1 FROM step_attachment a WHERE a.step_run_id = r.id AND a.status = 'Active')))
$$;

-- Who may change a batch's samples, and when: as for making it (testing.perform, the Batching step's department),
-- while it is open and nothing has been recorded at the bench
CREATE FUNCTION assert_batch_editable(p_batch uuid) RETURNS test_batch LANGUAGE plpgsql AS $$
DECLARE b test_batch; bs workflow_step;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    PERFORM require_permission_at('testing.perform', b.site_id);
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Batching';
    IF bs.id IS NOT NULL AND NOT can_perform_step(current_app_user(), bs.id) THEN
        RAISE EXCEPTION 'Batching % is done by the % department; you are not in a group for it', (SELECT test_name FROM test WHERE id = b.test_id),
            COALESCE((SELECT department_name FROM department WHERE id = step_department(bs.id)), 'test''s');
    END IF;
    IF b.status NOT IN ('Open','In Progress') THEN RAISE EXCEPTION 'Batch % is %: its samples can no longer change', b.batch_code, lower(b.status::text); END IF;
    IF batch_started(p_batch) THEN
        RAISE EXCEPTION 'Batch % has started (bench work is recorded), so samples can no longer be added or removed. Re-prep a sample, or cancel the batch.', b.batch_code;
    END IF;
    RETURN b;
END $$;

-- QC brackets ("every N") follow the number of client samples; a completed Batching step is opened again
CREATE FUNCTION batch_samples_changed(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; bs workflow_step; q jsonb; n integer; k integer; cur integer; v_every integer; i integer; e record;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Batching';
    n := batch_client_sample_count(p_batch);
    FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(bs.config->'qc', '[]')) LOOP
        CONTINUE WHEN q->>'frequency' IS DISTINCT FROM 'Every N';
        v_every := GREATEST(COALESCE((q->>'every_n')::int, 10), 1);
        k := ceil(n::numeric / v_every)::int + 1;
        SELECT count(*) INTO cur FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND status = 'Active' AND qc_type = q->>'qc_type' AND label ~ '-[0-9]+$';
        FOR i IN cur + 1 .. k LOOP
            INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label)
            VALUES (p_batch, 10000 + i, 'QC', q->>'qc_type', q->>'qc_class', q->>'qc_type' || '-' || i);
        END LOOP;
        FOR e IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND status = 'Active' AND qc_type = q->>'qc_type' AND label ~ '-[0-9]+$'
                  ORDER BY (regexp_replace(label, '^.*-', ''))::int DESC LIMIT GREATEST(cur - k, 0) LOOP
            UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Removed from the batch (fewer samples)', removed_at = clock_timestamp(), removed_by = current_app_user()
             WHERE id = e.id;
        END LOOP;
    END LOOP;
    PERFORM batch_order(p_batch);
    -- the batch as confirmed at Batching has changed: Batching is completed (signed) again
    UPDATE step_run r SET status = 'In progress' FROM workflow_step ws
     WHERE ws.id = r.step_id AND r.batch_id = p_batch AND ws.step_type = 'Batching' AND r.status = 'Completed';
    PERFORM refresh_batch_orders(p_batch);
END $$;

-- Add backlog items to a batch that has not started. p_items = [{"requested_test_id": uuid, "reprep_request_id": uuid|null}, ...]
CREATE FUNCTION add_batch_items(p_batch uuid, p_items jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE b test_batch; bs workflow_step; v_max integer := 500; n integer; it record; i integer; pos integer; added integer := 0;
BEGIN
    b := assert_batch_editable(p_batch);
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Choose the samples to add'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j JOIN test_pool_view p ON p.requested_test_id = (j->>'requested_test_id')::uuid
                AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text WHERE p.test_version_id <> b.test_version_id OR p.site_id <> b.site_id) THEN
        RAISE EXCEPTION 'Only samples waiting for the same test version (%) at this lab can join batch %',
            (SELECT test_name || ' v' || version_no FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = b.test_version_id), b.batch_code;
    END IF;
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Batching';
    v_max := COALESCE((bs.config->>'max_samples')::int, 500);
    n := batch_client_sample_count(p_batch);
    SELECT COALESCE(max(position), 0) INTO pos FROM batch_entry WHERE batch_id = p_batch;
    PERFORM ensure_reason('Sample added to the batch');
    PERFORM set_testing_internal(true);
    FOR it IN SELECT p.* FROM test_pool_view p
               WHERE p.site_id = b.site_id AND p.test_version_id = b.test_version_id
                 AND EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j
                        WHERE (j->>'requested_test_id')::uuid = p.requested_test_id AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text)
               ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code LOOP
        IF NOT it.is_media AND n + it.replicates > v_max THEN
            RAISE EXCEPTION 'Batch % is full: up to % samples per batch for this test (it has %)', b.batch_code, v_max, n;
        END IF;
        FOR i IN 1..it.replicates LOOP
            IF NOT it.is_media THEN n := n + 1; END IF;
            pos := pos + 1;
            INSERT INTO batch_entry (batch_id, position, entry_type, requested_test_id, label, replicate_no, reprep_request_id)
            VALUES (p_batch, pos, 'Sample', it.requested_test_id,
                    CASE WHEN it.kind = 'Re-prep'
                         THEN 'RP' || ((SELECT count(*) FROM batch_entry x WHERE x.requested_test_id = it.requested_test_id AND x.reprep_request_id IS NOT NULL) + 1) || '-'
                         ELSE '' END || COALESCE(it.sample_code, it.client_sample_id),
                    i, it.reprep_request_id);
        END LOOP;
        IF it.reprep_request_id IS NOT NULL THEN UPDATE reprep_request SET status = 'Batched', batch_id = p_batch WHERE id = it.reprep_request_id; END IF;
        added := added + 1;
    END LOOP;
    IF added = 0 THEN RAISE EXCEPTION 'Those samples are no longer waiting in the backlog (another batch may have taken them)'; END IF;
    -- a matrix spike with no client sample yet (a batch of media samples only) is made from the first one added
    UPDATE batch_entry x SET parent_entry_id = (SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
                                                 WHERE e.batch_id = p_batch AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL ORDER BY e.position LIMIT 1)
     WHERE x.batch_id = p_batch AND x.status = 'Active' AND x.qc_type IN ('Matrix Spike','Matrix Spike Duplicate')
       AND (x.parent_entry_id IS NULL OR x.parent_entry_id IN (SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE rt.media_lot_id IS NOT NULL))
       AND EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = p_batch AND e.entry_type = 'Sample' AND e.status = 'Active' AND rt.media_lot_id IS NULL);
    PERFORM batch_samples_changed(p_batch);
    PERFORM set_testing_internal(false);
    RETURN added;
END $$;

-- Remove a sample (all its preparations in the batch) from a batch that has not started: back to the backlog
CREATE FUNCTION remove_batch_entry(p_entry uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e batch_entry; b test_batch; n integer; v_new_parent uuid;
BEGIN
    SELECT * INTO e FROM batch_entry WHERE id = p_entry;
    IF e.id IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
    b := assert_batch_editable(e.batch_id);
    IF e.entry_type <> 'Sample' THEN RAISE EXCEPTION 'Only samples are removed; the QC entries follow the number of samples'; END IF;
    IF e.status <> 'Active' THEN RAISE EXCEPTION '% is not in the batch any more', e.label; END IF;
    IF NOT EXISTS (SELECT 1 FROM batch_entry x WHERE x.batch_id = e.batch_id AND x.entry_type = 'Sample' AND x.status = 'Active'
                    AND NOT (x.requested_test_id = e.requested_test_id AND x.reprep_request_id IS NOT DISTINCT FROM e.reprep_request_id)) THEN
        RAISE EXCEPTION '% is the batch''s only sample: cancel the batch instead', e.label;
    END IF;
    PERFORM ensure_reason('Sample removed from the batch');
    PERFORM set_testing_internal(true);
    UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Removed from the batch', removed_at = clock_timestamp(), removed_by = current_app_user()
     WHERE batch_id = e.batch_id AND entry_type = 'Sample' AND status = 'Active' AND requested_test_id = e.requested_test_id
       AND reprep_request_id IS NOT DISTINCT FROM e.reprep_request_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF e.reprep_request_id IS NOT NULL THEN UPDATE reprep_request SET status = 'Pooled', batch_id = NULL WHERE id = e.reprep_request_id; END IF;
    -- spikes made from it move to the first client sample left
    SELECT x.id INTO v_new_parent FROM batch_entry x JOIN requested_test rt ON rt.id = x.requested_test_id
     WHERE x.batch_id = e.batch_id AND x.entry_type = 'Sample' AND x.status = 'Active' ORDER BY rt.media_lot_id IS NOT NULL, x.position LIMIT 1;
    UPDATE batch_entry x SET parent_entry_id = v_new_parent
     WHERE x.batch_id = e.batch_id AND x.status = 'Active' AND x.parent_entry_id IN (SELECT id FROM batch_entry WHERE removed_at IS NOT NULL AND batch_id = e.batch_id);
    PERFORM batch_samples_changed(e.batch_id);
    PERFORM set_testing_internal(false);
    RETURN n;
END $$;

-- Order status (as in 021): a test removed from a batch is not "in testing" because of that batch
CREATE OR REPLACE FUNCTION refresh_order_status(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o lab_order; n_tests integer; n_done integer; n_batched integer; n_review integer; s lab_order_status; fallback lab_order_status; gs text;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.id IS NULL OR o.status IN ('Draft','Reported') THEN RETURN; END IF;
    fallback := CASE WHEN EXISTS (SELECT 1 FROM sample sm WHERE sm.lab_order_id = o.id AND sm.status = 'Expected') THEN 'Submitted' ELSE 'Received' END;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final')
                                  AND NOT EXISTS (SELECT 1 FROM reprep_request rp WHERE rp.requested_test_id = rt.id AND rp.status = 'Pooled')),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled' AND e.removed_at IS NULL)),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND e.status = 'Active' AND b.status = 'Awaiting Review')
                                  AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final'))
      INTO n_tests, n_done, n_batched, n_review
      FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id WHERE sm.lab_order_id = o.id AND rt.status <> 'Cancelled' AND sm.status <> 'Cancelled';
    s := CASE WHEN n_tests > 0 AND n_done = n_tests THEN 'Approved' WHEN n_review > 0 AND n_done + n_review >= n_tests THEN 'In Review' WHEN n_batched > 0 THEN 'In Testing' ELSE fallback END;
    IF s = o.status OR (s = fallback AND o.status NOT IN ('In Testing','In Review','Approved','Complete')) THEN RETURN; END IF;
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);
    PERFORM ensure_reason('Order status follows its tests');
    UPDATE lab_order SET status = s WHERE id = o.id;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;

-------------------------------------------------------------------------------
-- 4. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice23;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'media_qualification' THEN
        RETURN jsonb_build_object('label', 'Media qualification ' || (r->>'qualification_code') || ' of ' || COALESCE((SELECT lot_code FROM inventory_lot WHERE id = (r->>'lot_id')::uuid), ''),
            'link', '#/inventory/lots/' || (r->>'lot_id'));
    END IF;
    RETURN audit_record_ref_slice23(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
