-- LIMS3 schema, migration 011: PURCHASING (Phase 1)
-- Vault: "Decision - Purchasing Slice Scope and Rules" (Alex Kiddle, 2026-10-13), "Decision - Vendor Qualification
-- Blocks Purchasing", "Decision - Purchase Status Lives on Inventory Lot".
--  - Every purchase is a request line (inventory item, equipment, service or other) that goes through one approval
--    queue: Requested -> (Awaiting second approval) -> Approved -> Ordered -> Partly received -> Received.
--    Inventory requests are still Inventory Lots (Requested on the lot); each has its line and the two move together.
--  - Each lab may set an amount above which a second approval (purchasing.approve_over, General Manager) is needed.
--    Nobody approves their own request; the second approver is a different person from the first.
--  - Ordering groups approved lines of one supplier into a purchase order and records the finance system's PO number
--    (the LIMS does not replace finance).
--  - Receiving is per line, partial receipts allowed (the rest stays open as a back-order), with a discrepancy
--    (damaged, temperature excursion, short shipped, wrong item) and the packing slip. Receiving equipment creates
--    its record in the register, tagged out for qualification.
--  - Suppliers are qualified (QA, signed), for all labs or for one lab. Risk classes are a static table (shared, plus
--    each lab's own) that sets the re-qualification interval. Requesting, approving or ordering from a supplier
--    that is not approved, or whose approval has expired, is refused.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PERMISSIONS, THE ACCOUNTING GROUP, AND THE INVENTORY REQUEST/APPROVE PERMISSIONS THEY REPLACE
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('purchasing.request',     'Purchasing', 'Requests',          'Ask for something to be bought (inventory items, equipment, services)', false, 70),
 ('purchasing.approve',     'Purchasing', 'Approval',          'Approve or reject purchase requests (never your own)', false, 71),
 ('purchasing.approve_over','Purchasing', 'Second approval',   'Give the second approval to requests above the lab''s amount', false, 72),
 ('purchasing.order',       'Purchasing', 'Orders',            'Group approved requests into purchase orders and record the PO number', false, 73),
 ('purchasing.receive',     'Purchasing', 'Receiving',         'Receive deliveries, record problems and packing slips', false, 74),
 ('purchasing.suppliers',   'Purchasing', 'Suppliers',         'Add and change suppliers and manufacturers', false, 75),
 ('purchasing.qualify',     'Purchasing', 'Supplier qualification', 'Approve, suspend or re-qualify suppliers; this lab''s risk classes', false, 76);
UPDATE permission SET status = 'Inactive', description = description || ' (replaced by purchasing.request)' WHERE code = 'inventory.request';
UPDATE permission SET status = 'Inactive', description = description || ' (replaced by purchasing.approve)' WHERE code = 'inventory.approve';

CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES
 ('Administrator',   '{purchasing.request,purchasing.receive}'),
 ('QA',              '{purchasing.request,purchasing.receive,purchasing.suppliers,purchasing.qualify}'),
 ('Lab Supervisor',  '{purchasing.request,purchasing.receive,purchasing.approve,purchasing.order}'),
 ('General Manager', '{purchasing.request,purchasing.receive,purchasing.approve,purchasing.approve_over,purchasing.order,purchasing.suppliers}'),
 ('Analyst',         '{purchasing.request,purchasing.receive}'),
 ('Intake',          '{purchasing.request,purchasing.receive}'),
 ('Account Manager', '{purchasing.request,purchasing.receive}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x WHERE x NOT IN ('inventory.request','inventory.approve'))
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO standard_group_template VALUES
 ('Accounting', 'Places orders with suppliers and records purchase order numbers; can request and receive.',
  '{purchasing.request,purchasing.receive,purchasing.order}', 8);
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;
-- any group (standard or lab-made) that held the inventory permissions gets their replacements
INSERT INTO group_permission (group_id, permission_code)
SELECT gp.group_id, replace(gp.permission_code, 'inventory.', 'purchasing.') FROM group_permission gp
 WHERE gp.permission_code IN ('inventory.request','inventory.approve') AND gp.status = 'Active' ON CONFLICT DO NOTHING;
-- the Accounting group in every existing lab
SELECT create_standard_groups(id) FROM lab_site;

ALTER TYPE tag_source ADD VALUE IF NOT EXISTS 'New equipment';

CREATE FUNCTION purchasing_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.purchasing_internal', true), '') = '1' OR in_group_sync()
$$;
-- Purchasing steps move inventory lots on; the lot's audit entry needs a reason: the step itself, unless one was given
CREATE FUNCTION ensure_reason(p_reason text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF current_reason() IS NULL THEN PERFORM set_config('lims.reason', p_reason, true); END IF;
END $$;
CREATE FUNCTION set_purchasing_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.purchasing_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;

-- Suppliers: kept by purchasing.suppliers (QA, General Managers) instead of inventory.lists; more supplier details
DROP TRIGGER a_maintainer ON supplier;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON supplier FOR EACH ROW EXECUTE FUNCTION require_list_permission('purchasing.suppliers');
ALTER TABLE supplier ADD COLUMN account_number text, ADD COLUMN contact_name text, ADD COLUMN address text;

-------------------------------------------------------------------------------
-- 2. SUPPLIER RISK CLASSES (static table: shared, plus each lab's own) AND QUALIFICATIONS
-------------------------------------------------------------------------------
CREATE TABLE supplier_risk_class (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id          uuid REFERENCES lab_site(id),       -- empty = shared by all labs
    class_name       text NOT NULL CHECK (btrim(class_name) <> ''),
    requal_months    integer NOT NULL CHECK (requal_months > 0),
    description      text,
    sort_order       integer NOT NULL DEFAULT 0,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX supplier_risk_class_uq ON supplier_risk_class (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(class_name));
CALL make_gxp('supplier_risk_class');
CREATE FUNCTION supplier_risk_class_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A risk class cannot move between labs'; END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'The shared risk classes are kept by system administrators; add a class for your own lab instead';
    END IF;
    IF NEW.site_id IS NOT NULL THEN PERFORM require_permission_at('purchasing.qualify', NEW.site_id); END IF;
    PERFORM assert_signed('change the supplier risk classes');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON supplier_risk_class FOR EACH ROW EXECUTE FUNCTION supplier_risk_class_rules();
INSERT INTO supplier_risk_class (site_id, class_name, requal_months, description, sort_order) VALUES
 (NULL, 'Class I',   36, 'Low risk: catalogue consumables, general supplies', 1),
 (NULL, 'Class II',  24, 'Medium risk: reagents, solvents, media, calibration services', 2),
 (NULL, 'Class III', 12, 'High risk: reference standards, strains, critical services', 3);

CREATE TYPE vendor_approval_status AS ENUM ('Approved','Not Approved','Suspended');
CREATE SEQUENCE vendor_qualification_seq;
CREATE TABLE vendor_qualification (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_code text NOT NULL UNIQUE DEFAULT 'VQ-' || lpad(nextval('vendor_qualification_seq')::text, 5, '0'),
    supplier_id       uuid NOT NULL REFERENCES supplier(id),
    site_id           uuid REFERENCES lab_site(id),      -- empty = all Tentamus labs; a lab = that lab only
    risk_class_id     uuid NOT NULL REFERENCES supplier_risk_class(id),
    approval_status   vendor_approval_status NOT NULL,
    accreditations    text,
    approval_date     date NOT NULL,
    expiration_date   date,
    justification     text,
    is_legacy         boolean NOT NULL DEFAULT false,    -- recorded at go-live for suppliers already in use
    signature_id      uuid REFERENCES signature_event(id),
    status            record_status NOT NULL DEFAULT 'Active',
    record_version    integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at       timestamptz NOT NULL DEFAULT now(),
    modified_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT vendor_qualification_dates CHECK (expiration_date IS NULL OR expiration_date >= approval_date)
);
CREATE INDEX vendor_qualification_supplier_idx ON vendor_qualification (supplier_id);
CALL make_gxp('vendor_qualification');
CREATE FUNCTION vendor_qualification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE rc supplier_risk_class;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF (to_jsonb(NEW) - '{status,record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{status,record_version,modified_at,modified_by}'::text[]) THEN
            RAISE EXCEPTION 'A qualification cannot be changed; record a new qualification (or withdraw this one as entered in error)';
        END IF;
    ELSE
        SELECT * INTO rc FROM supplier_risk_class WHERE id = NEW.risk_class_id;
        IF rc.status <> 'Active' THEN RAISE EXCEPTION 'Risk class % is Inactive', rc.class_name; END IF;
        IF rc.site_id IS NOT NULL AND rc.site_id IS DISTINCT FROM NEW.site_id THEN
            RAISE EXCEPTION 'Risk class % belongs to one lab: use it only for that lab''s own qualifications', rc.class_name;
        END IF;
        IF NEW.approval_status = 'Approved' AND NEW.expiration_date IS NULL THEN
            NEW.expiration_date := (NEW.approval_date + make_interval(months => rc.requal_months))::date;
        END IF;
        IF NEW.approval_date > site_today(COALESCE(NEW.site_id, current_site())) + 1 THEN RAISE EXCEPTION 'The approval date cannot be in the future'; END IF;
        NEW.signature_id := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    -- QA of the lab (for a lab's own qualification), or QA of the lab being worked in (for all labs)
    PERFORM require_permission_at('purchasing.qualify', COALESCE(NEW.site_id, current_site()));
    IF NEW.site_id IS NULL AND current_site() IS NULL AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'Choose your lab first: qualifying a supplier for all labs needs the qualify permission in a lab';
    END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'qualify a supplier' ELSE 'withdraw a supplier qualification' END);
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON vendor_qualification FOR EACH ROW EXECUTE FUNCTION vendor_qualification_rules();

-- The qualification that applies to a supplier at a lab: the lab's own latest one if it has any, else the latest for all labs
CREATE FUNCTION current_vendor_qualification(p_supplier uuid, p_site uuid) RETURNS vendor_qualification LANGUAGE sql STABLE AS $$
    SELECT * FROM vendor_qualification WHERE supplier_id = p_supplier AND status = 'Active' AND (site_id = p_site OR site_id IS NULL)
     ORDER BY (site_id IS NOT NULL) DESC, approval_date DESC, created_at DESC LIMIT 1
$$;
CREATE FUNCTION supplier_status_at(p_supplier uuid, p_site uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE q vendor_qualification;
BEGIN
    q := current_vendor_qualification(p_supplier, p_site);
    IF q.id IS NULL THEN RETURN 'Not qualified'; END IF;
    IF q.approval_status <> 'Approved' THEN RETURN q.approval_status::text; END IF;
    IF q.expiration_date < site_today(p_site) THEN RETURN 'Expired'; END IF;
    RETURN 'Approved';
END $$;
CREATE FUNCTION assert_supplier_approved(p_supplier uuid, p_site uuid, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
    IF p_supplier IS NULL THEN RETURN; END IF;
    st := supplier_status_at(p_supplier, p_site);
    IF st <> 'Approved' THEN
        RAISE EXCEPTION 'Cannot % from %: the supplier is % for this lab. Ask QA to qualify it first.', p_what,
            (SELECT supplier_name FROM supplier WHERE id = p_supplier), lower(st);
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 3. EACH LAB'S PURCHASING SETTINGS
-------------------------------------------------------------------------------
CREATE TABLE purchasing_setting (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id               uuid NOT NULL UNIQUE REFERENCES lab_site(id),
    second_approval_over  numeric(12,2) CHECK (second_approval_over IS NULL OR second_approval_over >= 0),
    currency              text NOT NULL DEFAULT 'USD',
    record_version        integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at           timestamptz NOT NULL DEFAULT now(),
    modified_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('purchasing_setting');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON purchasing_setting FOR EACH ROW EXECUTE FUNCTION lab_record_permission('admin.lab');
CREATE OR REPLACE FUNCTION lab_record_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_code text := TG_ARGV[0];
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    v_site := CASE TG_TABLE_NAME
        WHEN 'lab_order' THEN (to_jsonb(NEW)->>'site_id')::uuid
        WHEN 'site_holiday' THEN (to_jsonb(NEW)->>'site_id')::uuid
        WHEN 'purchasing_setting' THEN (to_jsonb(NEW)->>'site_id')::uuid
        WHEN 'sample' THEN (SELECT site_id FROM lab_order WHERE id = (to_jsonb(NEW)->>'lab_order_id')::uuid)
        WHEN 'requested_test' THEN (SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = (to_jsonb(NEW)->>'sample_id')::uuid)
        WHEN 'requested_analyte' THEN (SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
                                        WHERE rt.id = (to_jsonb(NEW)->>'requested_test_id')::uuid)
        WHEN 'rush_decision' THEN (SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
                                    WHERE rt.id = (to_jsonb(NEW)->>'requested_test_id')::uuid)
    END;
    IF TG_TABLE_NAME = 'sample' AND TG_OP = 'UPDATE'
       AND (to_jsonb(NEW) - '{storage_location_id,storage_condition,retained_quantity,retained_unit,record_version,modified_at,modified_by}'::text[])
         = (to_jsonb(OLD) - '{storage_location_id,storage_condition,retained_quantity,retained_unit,record_version,modified_at,modified_by}'::text[]) THEN
        v_code := 'inventory.edit';
    END IF;
    PERFORM require_permission_at(v_code, v_site);
    RETURN NEW;
END $$;
INSERT INTO purchasing_setting (site_id) SELECT id FROM lab_site ON CONFLICT DO NOTHING;
CREATE FUNCTION lab_site_purchasing_setting() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO purchasing_setting (site_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_purchasing_setting AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_purchasing_setting();

-------------------------------------------------------------------------------
-- 4. PURCHASE ORDERS AND REQUEST LINES
-------------------------------------------------------------------------------
CREATE TABLE purchase_order (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    po_code             text NOT NULL UNIQUE,
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    supplier_id         uuid NOT NULL REFERENCES supplier(id),
    external_po_number  text,              -- the finance system's PO number
    confirmation_number text,              -- the supplier's order confirmation
    ordered_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    notes               text,
    signature_id        uuid REFERENCES signature_event(id),
    status              record_status NOT NULL DEFAULT 'Active',   -- Inactive = cancelled
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('purchase_order');
CREATE SEQUENCE purchase_order_seq;
CREATE FUNCTION purchase_order_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NOT purchasing_internal() THEN RAISE EXCEPTION 'Place orders from approved requests (Purchasing > Requests)'; END IF;
        RETURN NEW;
    END IF;
    IF (to_jsonb(NEW) - '{external_po_number,confirmation_number,notes,record_version,modified_at,modified_by}'::text[])
       <> (to_jsonb(OLD) - '{external_po_number,confirmation_number,notes,record_version,modified_at,modified_by}'::text[]) THEN
        RAISE EXCEPTION 'Only the PO number, the supplier''s confirmation and the notes of an order can be changed';
    END IF;
    PERFORM require_permission_at('purchasing.order', NEW.site_id);
    PERFORM assert_signed('change a purchase order');
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON purchase_order FOR EACH ROW EXECUTE FUNCTION purchase_order_rules();

CREATE TYPE purchase_line_type AS ENUM ('Inventory item','Equipment','Service','Other');
CREATE TYPE purchase_line_status AS ENUM ('Requested','Awaiting second approval','Approved','Rejected','Ordered','Partly received','Received','Cancelled');
CREATE SEQUENCE purchase_line_seq;
CREATE TABLE purchase_line (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_code           text NOT NULL UNIQUE DEFAULT 'PR-' || lpad(nextval('purchase_line_seq')::text, 6, '0'),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    line_type           purchase_line_type NOT NULL,
    description         text NOT NULL CHECK (btrim(description) <> ''),
    supplier_id         uuid REFERENCES supplier(id),
    catalog_number      text,
    quantity            numeric NOT NULL CHECK (quantity > 0),
    unit                text,
    unit_price          numeric(12,2) CHECK (unit_price IS NULL OR unit_price >= 0),
    needed_by           date,
    justification       text,
    lot_id              uuid REFERENCES inventory_lot(id),      -- inventory items: the pending lot (back-orders move it on)
    equipment_id        uuid REFERENCES equipment(id),          -- equipment: created when received
    status              purchase_line_status NOT NULL DEFAULT 'Requested',
    requested_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    requested_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    approved_by         uuid REFERENCES app_user(id),
    approved_at         timestamptz,
    approved2_by        uuid REFERENCES app_user(id),
    approved2_at        timestamptz,
    rejected_reason     text,
    purchase_order_id   uuid REFERENCES purchase_order(id),
    received_quantity   numeric NOT NULL DEFAULT 0,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX purchase_line_site_idx ON purchase_line (site_id, status);
CALL make_gxp('purchase_line', false);   -- status steps are signed actions; edits to a request ask for a reason on screen
ALTER TABLE inventory_lot ADD COLUMN purchase_line_id uuid REFERENCES purchase_line(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION line_amount(l purchase_line) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$ SELECT l.quantity * l.unit_price $$;
CREATE FUNCTION needs_second_approval(l purchase_line) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(l.quantity * l.unit_price > (SELECT second_approval_over FROM purchasing_setting WHERE site_id = l.site_id), false)
$$;

CREATE FUNCTION purchase_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.description := btrim(NEW.description);
    IF TG_OP = 'UPDATE' AND (NEW.site_id <> OLD.site_id OR NEW.line_type <> OLD.line_type OR NEW.requested_by <> OLD.requested_by) THEN
        RAISE EXCEPTION 'A request''s lab, type and requester cannot be changed';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('Received','Rejected','Cancelled') AND NEW IS DISTINCT FROM OLD
       AND (to_jsonb(NEW) - '{record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{record_version,modified_at,modified_by}'::text[]) THEN
        RAISE EXCEPTION 'Request % is % and cannot be changed', OLD.line_code, lower(OLD.status::text);
    END IF;
    -- no purchase from a supplier that is not approved (requesting, approving or ordering)
    IF NEW.status IN ('Requested','Awaiting second approval','Approved','Ordered') AND NOT in_group_sync()
       AND (TG_OP = 'INSERT' OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.status IS DISTINCT FROM OLD.status) THEN
        PERFORM assert_supplier_approved(NEW.supplier_id, NEW.site_id, CASE WHEN NEW.status = 'Ordered' THEN 'order' WHEN NEW.status = 'Requested' THEN 'request' ELSE 'approve a purchase' END);
    END IF;
    IF purchasing_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'Requested' THEN RAISE EXCEPTION 'A new purchase starts as Requested'; END IF;
        IF NEW.line_type = 'Inventory item' THEN RAISE EXCEPTION 'Request inventory items from the Inventory page (new item as a request, or Reorder)'; END IF;
        NEW.requested_by := current_app_user(); NEW.requested_at := clock_timestamp();
        PERFORM require_permission_at('purchasing.request', NEW.site_id);
        PERFORM assert_signed('request a purchase');
        RETURN NEW;
    END IF;
    -- people may change a request's details while it waits for approval, or cancel it before it is received
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (NEW.status = 'Cancelled' AND OLD.status IN ('Requested','Awaiting second approval','Approved')) THEN
        RAISE EXCEPTION 'Use Approve, Reject, Order or Receive to move a request on';
    END IF;
    IF NEW.status <> 'Cancelled' AND OLD.status NOT IN ('Requested','Awaiting second approval') THEN
        RAISE EXCEPTION 'Request % is already %: its details can no longer be changed (cancel it and request again)', OLD.line_code, lower(OLD.status::text);
    END IF;
    IF current_app_user() <> OLD.requested_by AND NOT has_permission_at('purchasing.approve', OLD.site_id) THEN
        RAISE EXCEPTION 'Only the requester or an approver can change or cancel request %', OLD.line_code;
    END IF;
    IF NEW.status <> 'Cancelled' AND OLD.status = 'Awaiting second approval' THEN   -- changed after a first approval: approve again
        NEW.status := 'Requested'; NEW.approved_by := NULL; NEW.approved_at := NULL;
    END IF;
    PERFORM assert_signed(CASE WHEN NEW.status = 'Cancelled' THEN 'cancel a purchase request' ELSE 'change a purchase request' END);
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON purchase_line FOR EACH ROW EXECUTE FUNCTION purchase_line_rules();

-- A request's inventory lot follows it (cancelled together), and changes made on the request flow to the lot
CREATE FUNCTION purchase_line_to_lot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.purchasing_internal', true), '');
BEGIN
    IF NEW.lot_id IS NULL OR TG_OP <> 'UPDATE' THEN RETURN NULL; END IF;
    PERFORM set_purchasing_internal(true);
    PERFORM ensure_reason('Purchase request ' || NEW.line_code || ' ' || lower(NEW.status::text));
    IF NEW.status IN ('Cancelled','Rejected') AND OLD.status NOT IN ('Cancelled','Rejected') THEN
        UPDATE inventory_lot SET status = 'Cancelled' WHERE id = NEW.lot_id AND receipt_status <> 'Received' AND status <> 'Cancelled';
    ELSIF NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.catalog_number IS DISTINCT FROM OLD.catalog_number THEN
        UPDATE inventory_lot SET requested_quantity = NEW.quantity, supplier_id = NEW.supplier_id, catalog_number = NEW.catalog_number
         WHERE id = NEW.lot_id AND receipt_status IN ('Requested','Approved');
    END IF;
    PERFORM set_config('lims.purchasing_internal', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_to_lot AFTER UPDATE ON purchase_line FOR EACH ROW EXECUTE FUNCTION purchase_line_to_lot();

-------------------------------------------------------------------------------
-- 5. INVENTORY LOTS AND THEIR REQUESTS MOVE TOGETHER
-------------------------------------------------------------------------------
-- Every requested lot gets its request line (the line is made when the save completes, with the same id)
CREATE FUNCTION inventory_lot_purchase_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.receipt_status = 'Requested' AND NEW.purchase_line_id IS NULL THEN
        NEW.purchase_line_id := gen_random_uuid();
    END IF;
    -- approval and ordering happen in Purchasing (the approval queue and purchase orders), which then moves the lot
    IF TG_OP = 'UPDATE' AND NEW.receipt_status IS DISTINCT FROM OLD.receipt_status AND NEW.receipt_status IN ('Approved','Ordered')
       AND NOT purchasing_internal() THEN
        RAISE EXCEPTION 'Approve and order purchases in Purchasing (the approval queue, then a purchase order)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_purchasing BEFORE INSERT OR UPDATE ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_purchase_link();

CREATE FUNCTION inventory_lot_purchase_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.purchasing_internal', true), ''); l purchase_line;
BEGIN
    IF NEW.purchase_line_id IS NULL THEN RETURN NULL; END IF;
    SELECT * INTO l FROM purchase_line WHERE id = NEW.purchase_line_id;
    PERFORM set_purchasing_internal(true);
    IF TG_OP = 'INSERT' AND l.id IS NULL THEN
        INSERT INTO purchase_line (id, site_id, line_type, description, supplier_id, catalog_number, quantity, unit, lot_id, status, justification)
        VALUES (NEW.purchase_line_id, NEW.site_id, 'Inventory item', COALESCE(NEW.item_name, NEW.item_description, 'Inventory item'), NEW.supplier_id,
                NEW.catalog_number, COALESCE(NEW.requested_quantity, 1), NEW.unit, NEW.id, 'Requested', NEW.notes);
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
              OR NEW.catalog_number IS DISTINCT FROM OLD.catalog_number) AND l.status IN ('Requested','Awaiting second approval') THEN
            UPDATE purchase_line SET quantity = COALESCE(NEW.requested_quantity, quantity), supplier_id = NEW.supplier_id, catalog_number = NEW.catalog_number,
                   status = 'Requested', approved_by = NULL, approved_at = NULL WHERE id = l.id;
        END IF;
    END IF;
    PERFORM set_config('lims.purchasing_internal', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_purchase_sync AFTER INSERT OR UPDATE ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_purchase_sync();

-- Lots are approved through Purchasing now (the old "Lab Supervisor approves on the lot" step)
CREATE OR REPLACE FUNCTION can_approve_reorder() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT purchasing_internal() $$;

-- Requests need purchasing.request (the inventory.request permission it replaces is Inactive)
CREATE OR REPLACE FUNCTION inventory_permission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_lot uuid; l inventory_lot; v_code text := 'inventory.edit';
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'inventory_lot' THEN
        IF TG_OP = 'INSERT' AND NEW.transferred_from_lot_id IS NOT NULL THEN
            v_site := (SELECT site_id FROM inventory_lot WHERE id = NEW.transferred_from_lot_id);
        ELSE
            v_site := NEW.site_id;
        END IF;
        IF TG_OP = 'INSERT' AND NEW.receipt_status = 'Requested' THEN v_code := 'purchasing.request'; END IF;
        IF TG_OP = 'UPDATE' AND purchasing_internal() THEN RETURN NEW; END IF;   -- moved on by Purchasing (approve, order, cancel, back-order)
        IF TG_OP = 'INSERT' AND purchasing_internal() AND NEW.purchase_line_id IS NOT NULL THEN RETURN NEW; END IF;   -- a back-order
        IF TG_OP = 'UPDATE' AND NEW.status = 'Disposed' AND OLD.status <> 'Disposed' THEN v_code := 'inventory.adjust'; END IF;
        IF TG_OP = 'UPDATE' AND NEW.receipt_status IN ('Requested') AND OLD.receipt_status = 'Requested' AND current_app_user() = OLD.created_by THEN
            v_code := 'purchasing.request';   -- the requester may change or cancel their own request
        END IF;
    ELSE
        v_lot := (to_jsonb(NEW)->>'lot_id')::uuid;
        SELECT * INTO l FROM inventory_lot WHERE id = v_lot;
        v_site := l.site_id;
        IF TG_TABLE_NAME IN ('supplier_coa','lot_analyte') AND l.receipt_status = 'In Transit' AND l.transferred_from_lot_id IS NOT NULL
           AND NOT has_permission_at('inventory.edit', l.site_id) THEN
            v_site := (SELECT site_id FROM inventory_lot WHERE id = l.transferred_from_lot_id);
        END IF;
        IF TG_TABLE_NAME = 'lot_analyte' AND TG_OP = 'INSERT' AND l.receipt_status = 'Requested' AND current_app_user() = l.created_by THEN
            v_code := 'purchasing.request';
        END IF;
        IF TG_TABLE_NAME = 'inventory_transaction' THEN
            v_code := CASE to_jsonb(NEW)->>'txn_type' WHEN 'Usage' THEN 'inventory.use' WHEN 'Adjustment' THEN 'inventory.adjust' WHEN 'Disposal' THEN 'inventory.adjust'
                           WHEN 'Receipt' THEN 'inventory.edit' ELSE 'inventory.edit' END;
            IF to_jsonb(NEW)->>'txn_type' = 'Receipt' AND COALESCE(current_setting('lims.receiving_line', true), '') = '1' THEN RETURN NEW; END IF;
        END IF;
    END IF;
    IF v_code = 'inventory.edit' AND TG_TABLE_NAME = 'inventory_lot' AND TG_OP = 'UPDATE' AND COALESCE(current_setting('lims.receiving_line', true), '') = '1' THEN
        RETURN NEW;   -- received through Purchasing > Receive (purchasing.receive was checked there)
    END IF;
    PERFORM require_permission_at(v_code, v_site);
    RETURN NEW;
END $$;

-- Suppliers already in use get a one-time legacy approval (all labs, Class II, 12 months) so ordering does not stop at
-- go-live; QA re-qualifies each one within the year (Alex, 2026-10-13)
INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, approval_date, expiration_date, justification, is_legacy)
SELECT s.id, NULL, (SELECT id FROM supplier_risk_class WHERE site_id IS NULL AND class_name = 'Class II'), 'Approved', current_date, (current_date + interval '12 months')::date,
       'Legacy approval at go-live of the Purchasing module: supplier already in use. Re-qualify within 12 months.', true
  FROM supplier s;

-- Existing open purchase lots (made before this migration) get their request lines
DO $$
DECLARE l record;
BEGIN
    PERFORM set_purchasing_internal(true);
    PERFORM set_config('lims.reason', 'Purchasing module: request line created for an existing purchase', true);
    -- Linking an existing lot to its line changes an inventory item, which needs lab access, inventory.edit and a
    -- signature; the System user has none of these (by design). So each lot is converted as the person who raised that
    -- request, signed as a data load script (like the seed files), and the System user is restored afterwards.
    -- Only databases that already hold open purchase lots reach this (found on Alex's Sandbox data, 2026-10-13).
    FOR l IN SELECT * FROM inventory_lot WHERE receipt_status IN ('Requested','Approved','Ordered') AND purchase_line_id IS NULL AND status <> 'Cancelled' LOOP
        PERFORM set_config('lims.user_id', l.created_by::text, true);
        PERFORM set_config('lims.site_id', l.site_id::text, true);
        PERFORM script_signature('Purchasing module go-live: request line for an existing purchase');
        INSERT INTO purchase_line (site_id, line_type, description, supplier_id, catalog_number, quantity, unit, lot_id, status, requested_by, requested_at, approved_by, approved_at)
        VALUES (l.site_id, 'Inventory item', COALESCE(l.item_name, l.item_description, 'Inventory item'), l.supplier_id, l.catalog_number,
                COALESCE(l.requested_quantity, 1), l.unit, l.id, l.receipt_status::text::purchase_line_status, l.created_by, l.created_at, l.approved_by, l.approved_at)
        RETURNING id INTO l.purchase_line_id;
        UPDATE inventory_lot SET purchase_line_id = l.purchase_line_id WHERE id = l.id;
    END LOOP;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
    PERFORM set_config('lims.site_id', '', true);
    PERFORM set_config('lims.signature_id', '', true);
    PERFORM set_purchasing_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 6. RECEIPTS (partial deliveries, problems, packing slips)
-------------------------------------------------------------------------------
CREATE TYPE receipt_discrepancy AS ENUM ('None','Damaged','Temperature excursion','Short shipped','Wrong item','Other');
CREATE SEQUENCE purchase_receipt_seq;
CREATE TABLE purchase_receipt (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_code      text NOT NULL UNIQUE DEFAULT 'RC-' || lpad(nextval('purchase_receipt_seq')::text, 6, '0'),
    purchase_line_id  uuid NOT NULL REFERENCES purchase_line(id),
    quantity          numeric NOT NULL CHECK (quantity >= 0),
    received_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    lot_id            uuid REFERENCES inventory_lot(id),
    equipment_id      uuid REFERENCES equipment(id),
    discrepancy       receipt_discrepancy NOT NULL DEFAULT 'None',
    note              text,
    packing_slip_id   uuid REFERENCES document_file(id),
    signature_id      uuid REFERENCES signature_event(id),
    record_version    integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at       timestamptz NOT NULL DEFAULT now(),
    modified_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT purchase_receipt_note CHECK (discrepancy = 'None' OR btrim(COALESCE(note, '')) <> '')
);
CALL make_gxp('purchase_receipt', false);
CREATE FUNCTION purchase_receipt_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'A receipt cannot be changed; record an adjustment on the item instead'; END IF;
    NEW.signature_id := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON purchase_receipt FOR EACH ROW EXECUTE FUNCTION purchase_receipt_rules();

-------------------------------------------------------------------------------
-- 7. ACTIONS: approve, reject, order, receive
-------------------------------------------------------------------------------
CREATE FUNCTION approve_purchase_lines(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE l purchase_line; n integer := 0; v_me uuid := current_app_user();
BEGIN
    PERFORM assert_signed('approve purchase requests');
    PERFORM ensure_reason('Purchase request approved');
    FOR l IN SELECT * FROM purchase_line WHERE id = ANY (p_ids) ORDER BY line_code FOR UPDATE LOOP
        IF l.requested_by = v_me THEN RAISE EXCEPTION 'You requested % yourself, so someone else must approve it', l.line_code; END IF;
        PERFORM set_purchasing_internal(true);
        IF l.status = 'Requested' THEN
            PERFORM require_permission_at('purchasing.approve', l.site_id);
            UPDATE purchase_line SET approved_by = v_me, approved_at = clock_timestamp(),
                   status = CASE WHEN needs_second_approval(l) THEN 'Awaiting second approval' ELSE 'Approved' END::purchase_line_status
             WHERE id = l.id RETURNING * INTO l;
        ELSIF l.status = 'Awaiting second approval' THEN
            PERFORM require_permission_at('purchasing.approve_over', l.site_id);
            IF l.approved_by = v_me THEN RAISE EXCEPTION 'You gave % its first approval; the second approval must be someone else', l.line_code; END IF;
            UPDATE purchase_line SET approved2_by = v_me, approved2_at = clock_timestamp(), status = 'Approved' WHERE id = l.id RETURNING * INTO l;
        ELSE
            RAISE EXCEPTION 'Request % is % and cannot be approved', l.line_code, lower(l.status::text);
        END IF;
        IF l.status = 'Approved' AND l.lot_id IS NOT NULL THEN
            UPDATE inventory_lot SET receipt_status = 'Approved' WHERE id = l.lot_id AND receipt_status = 'Requested';
        END IF;
        PERFORM set_purchasing_internal(false);
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

CREATE FUNCTION reject_purchase_lines(p_ids uuid[], p_reason text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE l purchase_line; n integer := 0;
BEGIN
    IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Say why the request is rejected'; END IF;
    PERFORM assert_signed('reject purchase requests');
    PERFORM ensure_reason('Purchase request rejected: ' || p_reason);
    FOR l IN SELECT * FROM purchase_line WHERE id = ANY (p_ids) FOR UPDATE LOOP
        IF l.status NOT IN ('Requested','Awaiting second approval') THEN RAISE EXCEPTION 'Request % is % and cannot be rejected', l.line_code, lower(l.status::text); END IF;
        PERFORM require_permission_at('purchasing.approve', l.site_id);
        PERFORM set_purchasing_internal(true);
        UPDATE purchase_line SET status = 'Rejected', rejected_reason = p_reason WHERE id = l.id;
        PERFORM set_purchasing_internal(false);
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

-- One purchase order per supplier: the approved lines given, all for that supplier at one lab
CREATE FUNCTION create_purchase_order(p_line_ids uuid[], p_external_po text, p_confirmation text, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_site uuid; v_sup uuid; v_po uuid; l purchase_line; n int;
BEGIN
    SELECT count(DISTINCT site_id), min(site_id::text)::uuid INTO n, v_site FROM purchase_line WHERE id = ANY (p_line_ids);
    IF n <> 1 THEN RAISE EXCEPTION 'Pick approved requests of one lab'; END IF;
    SELECT count(DISTINCT supplier_id), min(supplier_id::text)::uuid INTO n, v_sup FROM purchase_line WHERE id = ANY (p_line_ids);
    IF v_sup IS NULL OR n <> 1 OR EXISTS (SELECT 1 FROM purchase_line WHERE id = ANY (p_line_ids) AND supplier_id IS NULL) THEN
        RAISE EXCEPTION 'An order goes to one supplier: pick requests of the same supplier (give a supplier to any request without one)';
    END IF;
    PERFORM require_permission_at('purchasing.order', v_site);
    PERFORM assert_signed('place a purchase order');
    PERFORM ensure_reason('Ordered');
    PERFORM assert_supplier_approved(v_sup, v_site, 'order');
    PERFORM set_purchasing_internal(true);   -- (also lets the order itself be created)
    INSERT INTO purchase_order (po_code, site_id, supplier_id, external_po_number, confirmation_number, notes, signature_id)
    VALUES ('PO-' || (SELECT site_code FROM lab_site WHERE id = v_site) || '-' || lpad(nextval('purchase_order_seq')::text, 5, '0'), v_site, v_sup,
            NULLIF(btrim(p_external_po), ''), NULLIF(btrim(p_confirmation), ''), p_notes, NULLIF(current_setting('lims.signature_id', true), '')::uuid)
    RETURNING id INTO v_po;
    FOR l IN SELECT * FROM purchase_line WHERE id = ANY (p_line_ids) FOR UPDATE LOOP
        IF l.status <> 'Approved' THEN RAISE EXCEPTION 'Request % is %: only approved requests can be ordered', l.line_code, lower(l.status::text); END IF;
        UPDATE purchase_line SET status = 'Ordered', purchase_order_id = v_po WHERE id = l.id;
        IF l.lot_id IS NOT NULL THEN UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE id = l.lot_id AND receipt_status = 'Approved'; END IF;
    END LOOP;
    PERFORM set_purchasing_internal(false);
    RETURN v_po;
END $$;

-- Receive (part of) a line. Inventory: completes its pending lot; with more to come, a back-order lot stays Ordered.
-- Equipment: p_equipment = {equipment_name, equipment_type_id, department_id, serial_number, model, manufacturer, owner_group_id}
-- creates it in the register, tagged out for Qualification. Services and other lines: the receipt only.
CREATE FUNCTION receive_purchase_line(p_line uuid, p_quantity numeric, p_more_to_come boolean, p_discrepancy receipt_discrepancy, p_note text,
        p_packing_slip uuid, p_manufacturer_lot text, p_expiration date, p_retest date, p_location uuid, p_equipment jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l purchase_line; lot inventory_lot; v_back uuid; v_eq uuid; v_rc uuid; v_left numeric; was text := COALESCE(current_setting('lims.equipment_internal', true), '');
BEGIN
    SELECT * INTO l FROM purchase_line WHERE id = p_line FOR UPDATE;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
    IF l.status NOT IN ('Ordered','Partly received') THEN RAISE EXCEPTION 'Request % is %: only ordered requests can be received', l.line_code, lower(l.status::text); END IF;
    PERFORM require_permission_at('purchasing.receive', l.site_id);
    PERFORM assert_signed('receive a delivery');
    PERFORM ensure_reason('Received' || CASE WHEN p_discrepancy IS NOT NULL AND p_discrepancy <> 'None' THEN ' (' || p_discrepancy::text || ')' ELSE '' END);
    IF p_quantity IS NULL OR p_quantity < 0 THEN RAISE EXCEPTION 'Enter the quantity received'; END IF;
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
                                       storage_location_id, reorder_of_lot_id, purchase_line_id, notes)
            VALUES (lot.site_id, lot.chemical_id, lot.item_name, lot.cas_number, lot.physical_form, lot.item_description, lot.chemical_types, lot.supplier_id,
                    lot.manufacturer_id, lot.catalog_number, 'Requested', v_left, lot.unit, lot.concentration, lot.concentration_unit, lot.storage_condition,
                    lot.storage_location_id, lot.reorder_of_lot_id, l.id, 'Back-order of ' || l.line_code)
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
    END IF;
    INSERT INTO purchase_receipt (purchase_line_id, quantity, lot_id, equipment_id, discrepancy, note, packing_slip_id)
    VALUES (l.id, p_quantity, l.lot_id, v_eq, COALESCE(p_discrepancy, 'None'), NULLIF(btrim(p_note), ''), p_packing_slip) RETURNING id INTO v_rc;
    PERFORM set_purchasing_internal(true);
    UPDATE purchase_line SET received_quantity = received_quantity + p_quantity,
           status = CASE WHEN p_more_to_come AND v_left > 0 THEN 'Partly received' ELSE 'Received' END::purchase_line_status,
           lot_id = COALESCE(v_back, lot_id), equipment_id = COALESCE(v_eq, equipment_id)
     WHERE id = l.id;
    PERFORM set_purchasing_internal(false);
    RETURN v_rc;
END $$;

-------------------------------------------------------------------------------
-- 8. VIEWS
-------------------------------------------------------------------------------
CREATE VIEW supplier_status_view AS
SELECT s.id AS supplier_id, ls.id AS site_id, s.supplier_code, s.supplier_name, s.supplier_type, s.status AS supplier_record_status,
       supplier_status_at(s.id, ls.id) AS approval_status,
       (current_vendor_qualification(s.id, ls.id)).expiration_date AS approved_until,
       (current_vendor_qualification(s.id, ls.id)).site_id IS NOT NULL AS lab_specific,
       (SELECT class_name FROM supplier_risk_class WHERE id = (current_vendor_qualification(s.id, ls.id)).risk_class_id) AS risk_class
  FROM supplier s CROSS JOIN lab_site ls;

CREATE VIEW purchase_line_view AS
SELECT l.*, s.site_code, sp.supplier_name, sp.supplier_code, supplier_status_at(l.supplier_id, l.site_id) AS supplier_status,
       l.quantity * l.unit_price AS amount, needs_second_approval(l) AS needs_second,
       ru.full_name AS requested_by_name, au.full_name AS approved_by_name, a2.full_name AS approved2_by_name,
       po.po_code, po.external_po_number, il.lot_code, eq.equipment_code,
       (SELECT max(r.received_at) FROM purchase_receipt r WHERE r.purchase_line_id = l.id) AS last_received_at,
       (SELECT string_agg(DISTINCT r.discrepancy::text, ', ') FROM purchase_receipt r WHERE r.purchase_line_id = l.id AND r.discrepancy <> 'None') AS discrepancies
  FROM purchase_line l JOIN lab_site s ON s.id = l.site_id LEFT JOIN supplier sp ON sp.id = l.supplier_id
  JOIN app_user ru ON ru.id = l.requested_by LEFT JOIN app_user au ON au.id = l.approved_by LEFT JOIN app_user a2 ON a2.id = l.approved2_by
  LEFT JOIN purchase_order po ON po.id = l.purchase_order_id LEFT JOIN inventory_lot il ON il.id = l.lot_id LEFT JOIN equipment eq ON eq.id = l.equipment_id;

-------------------------------------------------------------------------------
-- 9. AUDIT REFERENCES, CANNED REASONS MODULE
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice9;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    CASE p_table
    WHEN 'purchase_line' THEN RETURN jsonb_build_object('label', 'Request ' || (r->>'line_code') || ' ' || (r->>'description'), 'link', '#/purchasing/requests/' || p_id);
    WHEN 'purchase_order' THEN RETURN jsonb_build_object('label', 'Purchase order ' || (r->>'po_code'), 'link', '#/purchasing/orders/' || p_id);
    WHEN 'purchase_receipt' THEN RETURN jsonb_build_object('label', 'Receipt ' || (r->>'receipt_code') || ' for ' || COALESCE((SELECT line_code FROM purchase_line WHERE id = (r->>'purchase_line_id')::uuid), ''),
        'link', '#/purchasing/requests/' || (r->>'purchase_line_id'));
    WHEN 'vendor_qualification' THEN RETURN jsonb_build_object('label', 'Qualification ' || (r->>'qualification_code') || ' of ' || COALESCE((SELECT supplier_name FROM supplier WHERE id = (r->>'supplier_id')::uuid), ''),
        'link', '#/purchasing/suppliers/' || (r->>'supplier_id'));
    WHEN 'supplier_risk_class' THEN RETURN jsonb_build_object('label', 'Risk class ' || (r->>'class_name'), 'link', '#/purchasing/risk-classes');
    WHEN 'purchasing_setting' THEN RETURN jsonb_build_object('label', 'Purchasing settings', 'link', '#/purchasing/settings');
    ELSE RETURN audit_record_ref_slice9(p_table, p_id, r);
    END CASE;
END $$;
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Admin'));

SELECT set_config('lims.group_sync', '', true);
COMMIT;
