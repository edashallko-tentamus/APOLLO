-- LIMS3 schema, migration 005: INVENTORY (slice 3)
-- Chemicals, suppliers and manufacturers, storage locations, inventory lots (one object for every kind of
-- material, with Chemical Type), stock movements, in-house mixtures, reorder / approve / order / receive,
-- transfers between labs, Supplier COAs (with an AI-proposal record), threshold warnings, and sample storage
-- with retained quantity. Vault decisions: see docs/ontology_vault/08 Decisions (2026-10-12, Inventory).
-- Rules live here: lab access, who may maintain lists and approve reorders, storage condition checks,
-- use eligibility, mixture expiry, and append-only stock movements.

BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. JOB ROLE (interim, until the Roles and Permissions module): decides who maintains the
--    Chemical list and approves reorders. Set by administrators; every change is audited with a reason.
-------------------------------------------------------------------------------
CREATE TYPE user_job_role AS ENUM ('Analyst','Intake','Lab Supervisor','QA','General Manager','Account Manager');
ALTER TABLE app_user ADD COLUMN job_role user_job_role NOT NULL DEFAULT 'Analyst';

CREATE FUNCTION user_has_role(p_roles user_job_role[]) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin OR job_role = ANY(p_roles) FROM app_user WHERE id = current_app_user()), false)
$$;
-- Chemicals, suppliers, storage locations and warning thresholds: Lab Supervisors, QA, General Managers, administrators
CREATE FUNCTION can_maintain_inventory_lists() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_has_role('{Lab Supervisor,QA,General Manager}')
$$;
-- Approving a reorder (until the Purchasing module exists): Lab Supervisors (and administrators)
CREATE FUNCTION can_approve_reorder() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_has_role('{Lab Supervisor}')
$$;
CREATE FUNCTION require_inventory_maintainer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT can_maintain_inventory_lists() THEN
        RAISE EXCEPTION 'Only Lab Supervisors, QA, General Managers and administrators can change the % list', replace(TG_TABLE_NAME, '_', ' ');
    END IF;
    RETURN NEW;
END $$;

-- Job role changes: administrators only, reason required, written to the audit trail
CREATE FUNCTION app_user_job_role_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.job_role IS DISTINCT FROM OLD.job_role THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only an administrator can change a job role'; END IF;
        IF current_reason() IS NULL THEN RAISE EXCEPTION 'A Reason for Change is required to change a job role'; END IF;
        INSERT INTO audit_log (table_name, record_id, action, record_version, changed_by, reason, changed_fields, new_row)
        VALUES ('app_user', NEW.id, 'UPDATE', 1 + (SELECT count(*) FROM audit_log WHERE table_name = 'app_user' AND record_id = NEW.id),
                current_app_user(), current_reason(),
                jsonb_build_object('job_role', jsonb_build_object('old', OLD.job_role, 'new', NEW.job_role)),
                jsonb_build_object('id', NEW.id, 'username', NEW.username, 'full_name', NEW.full_name, 'job_role', NEW.job_role));
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_job_role BEFORE UPDATE OF job_role ON app_user FOR EACH ROW EXECUTE FUNCTION app_user_job_role_rules();

-------------------------------------------------------------------------------
-- 2. CONTROLLED LISTS: units, storage conditions, chemical types
-------------------------------------------------------------------------------
CREATE TYPE chemical_type AS ENUM ('Consumable','In-house mixture','Solvent','Reagent','Media','Reference Standard','Microbiological Strain');
CREATE TYPE storage_condition AS ENUM ('Ambient (15-25 °C)','Refrigerated (2-8 °C)','Frozen (-20 °C)','Ultra-low (-80 °C)',
    'Desiccator','Flammables cabinet','Corrosives cabinet');
CREATE TYPE location_type AS ENUM ('Building','Room','Refrigerator','Freezer','Cabinet','Shelf','Incubator','Other');
CREATE TYPE supplier_type AS ENUM ('Supplier','Manufacturer','Supplier and Manufacturer');
CREATE TYPE receipt_status AS ENUM ('Requested','Approved','Ordered','In Transit','Received');
CREATE TYPE lot_status AS ENUM ('Available','On Hold','Depleted','Disposed','Cancelled');
CREATE TYPE inventory_txn_type AS ENUM ('Receipt','Usage','Adjustment','Transfer Out','Disposal');
CREATE TYPE threshold_subject AS ENUM ('Lot Quantity','Lot Expiry','Sample Retain');
CREATE TYPE threshold_type AS ENUM ('Percentage of Base','Absolute Max-Min','Target ± Tolerance %','Days Until/Since');

-- Today's date in the lab's own time zone (receipt dates and expiry checks follow the lab's calendar)
CREATE FUNCTION site_today(p_site uuid) RETURNS date LANGUAGE sql STABLE AS $$
    SELECT (now() AT TIME ZONE COALESCE((SELECT time_zone FROM lab_site WHERE id = p_site), 'UTC'))::date
$$;

CREATE FUNCTION inventory_units() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['g','mg','µg','kg','mL','L','µL','each','pack','box','vial','bottle','plate','tube','ampoule']
$$;

-------------------------------------------------------------------------------
-- 3. CHEMICAL (controlled name and CAS; one Chemical can be received as different Chemical Types)
-------------------------------------------------------------------------------
CREATE SEQUENCE chemical_code_seq;
CREATE TABLE chemical (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chemical_code   text NOT NULL UNIQUE DEFAULT 'CHEM-' || lpad(nextval('chemical_code_seq')::text, 5, '0'),
    chemical_name   text NOT NULL CHECK (btrim(chemical_name) <> ''),
    cas_number      text CHECK (is_valid_cas(cas_number)),
    analyte_id      uuid REFERENCES analyte(id),       -- optional: the analyte a standard of this chemical certifies
    synonyms        text[] NOT NULL DEFAULT '{}',
    hazard_notes    text,
    status          master_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX chemical_name_uq ON chemical (lower(chemical_name));
CREATE UNIQUE INDEX chemical_cas_uq ON chemical (cas_number) WHERE cas_number IS NOT NULL;
CALL make_gxp('chemical');
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON chemical FOR EACH ROW EXECUTE FUNCTION require_inventory_maintainer();

-------------------------------------------------------------------------------
-- 4. SUPPLIER / MANUFACTURER (shared by all labs; qualification comes with Purchasing)
-------------------------------------------------------------------------------
CREATE SEQUENCE supplier_code_seq;
CREATE TABLE supplier (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    supplier_code   text NOT NULL UNIQUE DEFAULT 'SUP-' || lpad(nextval('supplier_code_seq')::text, 4, '0'),
    supplier_name   text NOT NULL CHECK (btrim(supplier_name) <> ''),
    supplier_type   supplier_type NOT NULL DEFAULT 'Supplier and Manufacturer',
    website         text,
    email           text CHECK (email IS NULL OR email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    phone           text,
    notes           text,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX supplier_name_uq ON supplier (lower(supplier_name));
CALL make_gxp('supplier');
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON supplier FOR EACH ROW EXECUTE FUNCTION require_inventory_maintainer();

-------------------------------------------------------------------------------
-- 5. STORAGE LOCATION (per lab, nested: building > room > fridge > shelf), with the conditions it provides
-------------------------------------------------------------------------------
CREATE TABLE storage_location (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id              uuid NOT NULL REFERENCES lab_site(id),
    location_code        text NOT NULL CHECK (btrim(location_code) <> ''),
    location_name        text NOT NULL CHECK (btrim(location_name) <> ''),
    location_type        location_type NOT NULL DEFAULT 'Other',
    parent_location_id   uuid REFERENCES storage_location(id),
    supported_conditions storage_condition[] NOT NULL DEFAULT '{}',
    holds_samples        boolean NOT NULL DEFAULT false,
    status               record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX storage_location_code_uq ON storage_location (site_id, upper(location_code));
CALL make_gxp('storage_location');
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON storage_location FOR EACH ROW EXECUTE FUNCTION require_inventory_maintainer();

CREATE FUNCTION storage_location_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p storage_location; cur uuid; n int := 0;
BEGIN
    PERFORM assert_site_access(NEW.site_id);
    NEW.location_code := upper(btrim(NEW.location_code));
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A storage location cannot move to another lab'; END IF;
    IF NEW.parent_location_id IS NOT NULL THEN
        SELECT * INTO p FROM storage_location WHERE id = NEW.parent_location_id;
        IF p.site_id <> NEW.site_id THEN RAISE EXCEPTION 'A storage location must be inside a location in the same lab'; END IF;
        cur := NEW.parent_location_id;
        WHILE cur IS NOT NULL LOOP
            IF cur = NEW.id THEN RAISE EXCEPTION 'A storage location cannot be inside itself'; END IF;
            SELECT parent_location_id INTO cur FROM storage_location WHERE id = cur;
            n := n + 1; IF n > 50 THEN EXIT; END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON storage_location FOR EACH ROW EXECUTE FUNCTION storage_location_rules();

-- "Main building > Chemistry lab > Fridge 1"
CREATE FUNCTION location_path(p_id uuid) RETURNS text LANGUAGE sql STABLE AS $$
    WITH RECURSIVE up(id, parent, name, depth) AS (
        SELECT id, parent_location_id, location_name, 0 FROM storage_location WHERE id = p_id
        UNION ALL SELECT l.id, l.parent_location_id, l.location_name, up.depth + 1 FROM storage_location l JOIN up ON l.id = up.parent WHERE up.depth < 50)
    SELECT string_agg(name, ' > ' ORDER BY depth DESC) FROM up
$$;

-- A stored item's condition must be one the location provides (a location with no conditions listed is not checked)
CREATE FUNCTION assert_storage_ok(p_location uuid, p_site uuid, p_condition storage_condition, p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l storage_location;
BEGIN
    IF p_location IS NULL THEN RETURN; END IF;
    SELECT * INTO l FROM storage_location WHERE id = p_location;
    IF l.site_id <> p_site THEN RAISE EXCEPTION 'Storage location % is in another lab', l.location_code; END IF;
    IF l.status <> 'Active' THEN RAISE EXCEPTION 'Storage location % is Inactive', l.location_code; END IF;
    IF p_condition IS NOT NULL AND cardinality(l.supported_conditions) > 0 AND NOT p_condition = ANY(l.supported_conditions) THEN
        RAISE EXCEPTION '% needs "%" but % (%) provides only: %', p_what, p_condition, l.location_name, l.location_code,
            array_to_string(l.supported_conditions, ', ');
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 6. INVENTORY LOT: one record for every received or prepared lot of any material
-------------------------------------------------------------------------------
CREATE SEQUENCE inventory_lot_seq;
CREATE TABLE inventory_lot (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_code            text NOT NULL UNIQUE DEFAULT 'INV-' || lpad(nextval('inventory_lot_seq')::text, 6, '0'), -- the lab's own ID (the Resource ID for mixtures)
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    chemical_id         uuid REFERENCES chemical(id),
    item_description    text,                     -- required for consumables that are not on the Chemical list (e.g. pipette tips)
    chemical_types      chemical_type[] NOT NULL CHECK (cardinality(chemical_types) > 0),
    supplier_id         uuid REFERENCES supplier(id),
    manufacturer_id     uuid REFERENCES supplier(id),
    catalog_number      text,
    manufacturer_lot    text,
    receipt_status      receipt_status NOT NULL DEFAULT 'Received',
    status              lot_status NOT NULL DEFAULT 'Available',
    requested_quantity  numeric(14,4) CHECK (requested_quantity > 0),
    quantity_received   numeric(14,4) CHECK (quantity_received >= 0),
    unit                text CHECK (unit IS NULL OR unit = ANY(inventory_units())),
    container_count     integer CHECK (container_count > 0),
    concentration       numeric(14,6) CHECK (concentration >= 0),
    concentration_unit  text,
    purity_pct          numeric(7,4) CHECK (purity_pct > 0 AND purity_pct <= 100),
    received_date       date,
    opened_date         date,
    expiration_date     date,
    retest_date         date,
    storage_condition   storage_condition,
    storage_location_id uuid REFERENCES storage_location(id),
    transferred_from_lot_id uuid REFERENCES inventory_lot(id),
    reorder_of_lot_id   uuid REFERENCES inventory_lot(id),
    approved_by         uuid REFERENCES app_user(id),
    approved_at         timestamptz,
    notes               text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX inventory_lot_site_idx ON inventory_lot (site_id);
CALL make_gxp('inventory_lot');

CREATE FUNCTION lot_is_mixture(t chemical_type[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT 'In-house mixture' = ANY(t) $$;
CREATE FUNCTION lot_is_consumable_only(t chemical_type[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT t = '{Consumable}'::chemical_type[] $$;

CREATE FUNCTION inventory_lot_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src inventory_lot; v_min_exp date; v_order int;
BEGIN
    -- Lab access. A transfer creates the receiving lab's lot "In Transit" on behalf of the sending lab.
    IF TG_OP = 'INSERT' AND NEW.transferred_from_lot_id IS NOT NULL THEN
        SELECT * INTO src FROM inventory_lot WHERE id = NEW.transferred_from_lot_id;
        PERFORM assert_site_access(src.site_id);
        IF NEW.receipt_status <> 'In Transit' THEN RAISE EXCEPTION 'A transferred lot starts In Transit until the receiving lab receives it'; END IF;
        IF NEW.site_id = src.site_id THEN RAISE EXCEPTION 'A transfer must go to a different lab'; END IF;
    ELSE
        PERFORM assert_site_access(NEW.site_id);
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN
        RAISE EXCEPTION 'A lot cannot move to another lab; use Transfer, which logs it as a new lot at the receiving lab';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.transferred_from_lot_id IS DISTINCT FROM OLD.transferred_from_lot_id OR NEW.reorder_of_lot_id IS DISTINCT FROM OLD.reorder_of_lot_id) THEN
        RAISE EXCEPTION 'The transfer and reorder links on a lot cannot be changed';
    END IF;

    -- What the lot is
    IF NEW.chemical_id IS NULL AND NOT lot_is_consumable_only(NEW.chemical_types) AND NOT lot_is_mixture(NEW.chemical_types) THEN
        RAISE EXCEPTION 'Pick a chemical from the Chemical list (only consumables and in-house mixtures can be logged without one)';
    END IF;
    IF NEW.chemical_id IS NULL AND COALESCE(btrim(NEW.item_description), '') = '' THEN
        RAISE EXCEPTION 'Describe the item (for example "Pipette tips, 1000 µL" or "ICP calibration mix, 1 ppm")';
    END IF;
    IF lot_is_consumable_only(NEW.chemical_types) AND (NEW.purity_pct IS NOT NULL OR NEW.concentration IS NOT NULL) THEN
        RAISE EXCEPTION 'Purity and concentration do not apply to consumables';
    END IF;
    IF NEW.chemical_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.chemical_id IS DISTINCT FROM OLD.chemical_id)
       AND (SELECT status FROM chemical WHERE id = NEW.chemical_id) <> 'Active' THEN
        RAISE EXCEPTION 'That chemical is Retired on the Chemical list';
    END IF;

    -- Purchase / receipt flow: Requested -> Approved (Lab Supervisor) -> Ordered -> Received; transfers: In Transit -> Received
    IF TG_OP = 'UPDATE' AND NEW.receipt_status IS DISTINCT FROM OLD.receipt_status THEN
        IF OLD.receipt_status = 'Received' THEN RAISE EXCEPTION 'A received lot cannot go back to %', NEW.receipt_status; END IF;
        IF NOT ((OLD.receipt_status = 'Requested' AND NEW.receipt_status = 'Approved')
             OR (OLD.receipt_status = 'Approved' AND NEW.receipt_status = 'Ordered')
             OR (OLD.receipt_status IN ('Ordered','In Transit') AND NEW.receipt_status = 'Received')) THEN
            RAISE EXCEPTION 'A lot cannot go from % to %', OLD.receipt_status, NEW.receipt_status;
        END IF;
        IF NEW.receipt_status = 'Approved' THEN
            IF NOT can_approve_reorder() THEN RAISE EXCEPTION 'Only a Lab Supervisor can approve a reorder'; END IF;
            NEW.approved_by := current_app_user(); NEW.approved_at := clock_timestamp();
        END IF;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.receipt_status IN ('Approved','Ordered') THEN
        RAISE EXCEPTION 'A new purchase starts as Requested and is approved by a Lab Supervisor';
    END IF;
    IF NEW.receipt_status <> 'Received' AND NEW.status NOT IN ('Available','Cancelled') THEN
        RAISE EXCEPTION 'A lot that has not been received can only be cancelled';
    END IF;
    IF NEW.receipt_status = 'Received' AND NEW.status = 'Cancelled' THEN
        RAISE EXCEPTION 'A received lot cannot be cancelled; dispose of it instead';
    END IF;
    IF NEW.status = 'Disposed' AND TG_OP = 'UPDATE' AND OLD.status <> 'Disposed' AND COALESCE(current_setting('lims.disposing', true), '') <> '1' THEN
        RAISE EXCEPTION 'Use Dispose to dispose of a lot, so the remaining quantity is written off';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('Disposed','Cancelled') AND NEW.status <> OLD.status THEN
        RAISE EXCEPTION 'A % lot cannot be reopened', lower(OLD.status::text);
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.receipt_status = 'Received'
       AND (NEW.quantity_received IS DISTINCT FROM OLD.quantity_received OR NEW.unit IS DISTINCT FROM OLD.unit) THEN
        RAISE EXCEPTION 'The quantity received and its unit cannot be changed after receipt; record an Adjustment instead';
    END IF;
    -- A received lot needs its physical details
    IF NEW.receipt_status = 'Received' THEN
        IF NEW.quantity_received IS NULL OR NEW.unit IS NULL THEN RAISE EXCEPTION 'Enter the quantity received and its unit'; END IF;
        IF NEW.manufacturer_lot IS NULL AND NOT lot_is_mixture(NEW.chemical_types) AND NOT lot_is_consumable_only(NEW.chemical_types) THEN
            RAISE EXCEPTION 'Enter the manufacturer''s lot number';
        END IF;
        NEW.received_date := COALESCE(NEW.received_date, site_today(NEW.site_id));
    END IF;
    IF lot_is_mixture(NEW.chemical_types) AND NEW.manufacturer_lot IS NOT NULL THEN
        RAISE EXCEPTION 'An in-house mixture has no manufacturer lot; its lab ID (%) is its Resource ID', NEW.lot_code;
    END IF;

    -- A mixture cannot outlive its earliest-expiring component
    IF lot_is_mixture(NEW.chemical_types) AND TG_OP = 'UPDATE' THEN
        SELECT min(c.expiration_date) INTO v_min_exp FROM lot_component lc JOIN inventory_lot c ON c.id = lc.component_lot_id WHERE lc.lot_id = NEW.id;
        IF v_min_exp IS NOT NULL AND (NEW.expiration_date IS NULL OR NEW.expiration_date > v_min_exp) THEN
            RAISE EXCEPTION 'This mixture must expire on or before % (its earliest-expiring component)', v_min_exp;
        END IF;
    END IF;

    PERFORM assert_storage_ok(NEW.storage_location_id, NEW.site_id, NEW.storage_condition, 'Lot ' || NEW.lot_code);
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_rules();

-------------------------------------------------------------------------------
-- 7. STOCK MOVEMENTS (append-only; quantity on hand is their sum and may go negative)
-------------------------------------------------------------------------------
CREATE TABLE inventory_transaction (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id          uuid NOT NULL REFERENCES inventory_lot(id),
    txn_type        inventory_txn_type NOT NULL,
    quantity_change numeric(14,4) NOT NULL CHECK (quantity_change <> 0),
    txn_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    related_lot_id  uuid REFERENCES inventory_lot(id),   -- mixture made, or the receiving lab's lot for a transfer
    reference       text,                                -- e.g. a batch, sample ID or work instruction
    notes           text,
    reason          text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX inventory_txn_lot_idx ON inventory_transaction (lot_id);
CALL make_gxp('inventory_transaction');

CREATE FUNCTION inventory_txn_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Stock movements cannot be edited; record an Adjustment to correct one';
    END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    PERFORM assert_site_access(l.site_id);
    IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Lot % has not been received yet', l.lot_code; END IF;
    IF l.status IN ('Disposed','Cancelled') THEN RAISE EXCEPTION 'Lot % is %', l.lot_code, lower(l.status::text); END IF;
    NEW.reason := COALESCE(NEW.reason, current_reason());
    CASE NEW.txn_type
    WHEN 'Receipt' THEN IF NEW.quantity_change < 0 THEN RAISE EXCEPTION 'A receipt adds stock'; END IF;
    WHEN 'Usage', 'Transfer Out', 'Disposal' THEN
        IF NEW.quantity_change > 0 THEN NEW.quantity_change := -NEW.quantity_change; END IF;
        IF NEW.txn_type = 'Usage' THEN
            IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be used', l.lot_code, l.status; END IF;
            IF l.expiration_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % expired on % and cannot be used', l.lot_code, l.expiration_date; END IF;
            IF l.retest_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % was due for retest on % and cannot be used until it is re-qualified', l.lot_code, l.retest_date; END IF;
        END IF;
    WHEN 'Adjustment' THEN
        IF NEW.reason IS NULL THEN RAISE EXCEPTION 'An adjustment needs a reason (for example a stock count)'; END IF;
    END CASE;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON inventory_transaction FOR EACH ROW EXECUTE FUNCTION inventory_txn_rules();

CREATE FUNCTION lot_on_hand(p_lot uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(quantity_change), 0) FROM inventory_transaction WHERE lot_id = p_lot
$$;

-- Receiving writes the receipt movement (direct logging, the Receive action, or a transfer arriving)
CREATE FUNCTION inventory_lot_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.receipt_status = 'Received' AND (TG_OP = 'INSERT' OR OLD.receipt_status <> 'Received') AND NEW.quantity_received > 0 THEN
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference)
        VALUES (NEW.id, 'Receipt', NEW.quantity_received,
                CASE WHEN NEW.transferred_from_lot_id IS NOT NULL THEN 'Transfer from ' || (SELECT lot_code FROM inventory_lot WHERE id = NEW.transferred_from_lot_id)
                     WHEN lot_is_mixture(NEW.chemical_types) THEN 'Prepared in house' END);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_receipt AFTER INSERT OR UPDATE OF receipt_status ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_receipt();

-------------------------------------------------------------------------------
-- 8. IN-HOUSE MIXTURES: component lots used (each use is a Usage movement on the component)
-------------------------------------------------------------------------------
CREATE TABLE lot_component (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id            uuid NOT NULL REFERENCES inventory_lot(id),
    component_lot_id  uuid NOT NULL REFERENCES inventory_lot(id),
    quantity_used     numeric(14,4) NOT NULL CHECK (quantity_used > 0),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (lot_id, component_lot_id)
);
CALL make_gxp('lot_component');

CREATE FUNCTION lot_component_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m inventory_lot; c inventory_lot;
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Mixture components cannot be edited; they are part of how the lot was made'; END IF;
    SELECT * INTO m FROM inventory_lot WHERE id = NEW.lot_id;
    SELECT * INTO c FROM inventory_lot WHERE id = NEW.component_lot_id;
    IF NOT lot_is_mixture(m.chemical_types) THEN RAISE EXCEPTION 'Components can only be added to an in-house mixture'; END IF;
    IF NEW.lot_id = NEW.component_lot_id THEN RAISE EXCEPTION 'A mixture cannot be a component of itself'; END IF;
    IF c.site_id <> m.site_id THEN RAISE EXCEPTION 'Component lot % is in another lab', c.lot_code; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON lot_component FOR EACH ROW EXECUTE FUNCTION lot_component_rules();

CREATE FUNCTION lot_component_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, related_lot_id, reference)
    VALUES (NEW.component_lot_id, 'Usage', NEW.quantity_used, NEW.lot_id, 'Used to prepare ' || (SELECT lot_code FROM inventory_lot WHERE id = NEW.lot_id));
    RETURN NULL;
END $$;
CREATE TRIGGER z_usage AFTER INSERT ON lot_component FOR EACH ROW EXECUTE FUNCTION lot_component_usage();

-- Make a mixture in one step: p_components = [{"lot_id": uuid, "quantity": n}, ...].
-- Expiry: the date given, but never later than the earliest-expiring component (defaults to it).
CREATE FUNCTION make_mixture(p_site uuid, p_chemical uuid, p_description text, p_quantity numeric, p_unit text,
                             p_concentration numeric, p_concentration_unit text, p_expiration date,
                             p_condition storage_condition, p_location uuid, p_components jsonb, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_min date; v_exp date; c jsonb;
BEGIN
    IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN RAISE EXCEPTION 'A mixture needs at least one component lot'; END IF;
    SELECT min(l.expiration_date) INTO v_min FROM inventory_lot l
     WHERE l.id IN (SELECT (x->>'lot_id')::uuid FROM jsonb_array_elements(p_components) x);
    IF p_expiration IS NOT NULL AND v_min IS NOT NULL AND p_expiration > v_min THEN
        RAISE EXCEPTION 'This mixture must expire on or before % (its earliest-expiring component)', v_min;
    END IF;
    v_exp := COALESCE(p_expiration, v_min);
    INSERT INTO inventory_lot (site_id, chemical_id, item_description, chemical_types, quantity_received, unit, concentration, concentration_unit,
                               expiration_date, storage_condition, storage_location_id, notes, received_date)
    VALUES (p_site, p_chemical, p_description, '{In-house mixture}', p_quantity, p_unit, p_concentration, p_concentration_unit,
            v_exp, p_condition, p_location, p_notes, site_today(p_site))
    RETURNING id INTO v_id;
    FOR c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
        INSERT INTO lot_component (lot_id, component_lot_id, quantity_used) VALUES (v_id, (c->>'lot_id')::uuid, (c->>'quantity')::numeric);
    END LOOP;
    RETURN v_id;
END $$;

-------------------------------------------------------------------------------
-- 9. ACTIONS: reorder, receive, transfer, dispose
-------------------------------------------------------------------------------
-- Reorder (available on any lot): a new Requested lot like this one; a Lab Supervisor approves it
CREATE FUNCTION reorder_lot(p_lot uuid, p_quantity numeric, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; v_id uuid;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF lot_is_mixture(l.chemical_types) THEN RAISE EXCEPTION 'An in-house mixture is prepared, not ordered; reorder its components'; END IF;
    INSERT INTO inventory_lot (site_id, chemical_id, item_description, chemical_types, supplier_id, manufacturer_id, catalog_number,
                               receipt_status, requested_quantity, unit, storage_condition, reorder_of_lot_id, notes)
    VALUES (l.site_id, l.chemical_id, l.item_description, l.chemical_types, l.supplier_id, l.manufacturer_id, l.catalog_number,
            'Requested', COALESCE(p_quantity, l.quantity_received), l.unit, l.storage_condition, l.id, p_notes)
    RETURNING id INTO v_id;
    RETURN v_id;
END $$;

-- Receive an Ordered purchase or an In Transit transfer: fills in what arrived (one lot, never a second one)
CREATE FUNCTION receive_lot(p_lot uuid, p_quantity numeric, p_unit text, p_manufacturer_lot text, p_expiration date,
                            p_retest date, p_location uuid, p_received date DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l inventory_lot;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF l.receipt_status NOT IN ('Ordered','In Transit') THEN
        RAISE EXCEPTION 'Only an Ordered purchase or an In Transit transfer can be received (this lot is %)', l.receipt_status;
    END IF;
    UPDATE inventory_lot SET quantity_received = COALESCE(p_quantity, quantity_received, requested_quantity), unit = COALESCE(p_unit, unit),
           manufacturer_lot = COALESCE(NULLIF(btrim(p_manufacturer_lot), ''), manufacturer_lot),
           expiration_date = COALESCE(p_expiration, expiration_date), retest_date = COALESCE(p_retest, retest_date),
           storage_location_id = COALESCE(p_location, storage_location_id), received_date = COALESCE(p_received, site_today(l.site_id)),
           receipt_status = 'Received'
     WHERE id = p_lot;
END $$;

-- Transfer to another lab: the sending lab writes the quantity off; the receiving lab gets a new lot
-- (same material, manufacturer lot, expiry and COA) In Transit, and receives it like any new lot.
CREATE FUNCTION transfer_lot(p_lot uuid, p_to_site uuid, p_quantity numeric, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; v_id uuid;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Enter the quantity to transfer'; END IF;
    INSERT INTO inventory_lot (site_id, chemical_id, item_description, chemical_types, supplier_id, manufacturer_id, catalog_number,
                               manufacturer_lot, receipt_status, requested_quantity, quantity_received, unit, concentration, concentration_unit,
                               purity_pct, expiration_date, retest_date, storage_condition, transferred_from_lot_id, notes)
    VALUES (p_to_site, l.chemical_id, l.item_description, l.chemical_types, l.supplier_id, l.manufacturer_id, l.catalog_number,
            l.manufacturer_lot, 'In Transit', p_quantity, p_quantity, l.unit, l.concentration, l.concentration_unit,
            l.purity_pct, l.expiration_date, l.retest_date, l.storage_condition, l.id, p_notes)
    RETURNING id INTO v_id;
    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, related_lot_id, reference, notes)
    VALUES (p_lot, 'Transfer Out', p_quantity, v_id, 'Transfer to ' || (SELECT site_code FROM lab_site WHERE id = p_to_site), p_notes);
    -- the Supplier COA travels with the material
    INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at)
    SELECT v_id, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at
      FROM supplier_coa WHERE lot_id = p_lot AND status = 'Active';
    RETURN v_id;
END $$;

-- Dispose: write off whatever is left and close the lot
CREATE FUNCTION dispose_lot(p_lot uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_left numeric;
BEGIN
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'A reason is required to dispose of a lot'; END IF;
    v_left := lot_on_hand(p_lot);
    IF v_left <> 0 THEN
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference)
        VALUES (p_lot, CASE WHEN v_left > 0 THEN 'Disposal' ELSE 'Adjustment' END::inventory_txn_type,
                CASE WHEN v_left > 0 THEN v_left ELSE -v_left END, 'Written off at disposal');
    END IF;
    PERFORM set_config('lims.disposing', '1', true);
    UPDATE inventory_lot SET status = 'Disposed' WHERE id = p_lot;
    PERFORM set_config('lims.disposing', '', true);
END $$;

-------------------------------------------------------------------------------
-- 10. SUPPLIER COA: the uploaded document (kept unchanged, identified by its SHA-256 fingerprint)
--     and what was read from it: by a person, or proposed by AI and confirmed by a person
-------------------------------------------------------------------------------
CREATE TABLE document_file (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name    text NOT NULL,
    mime_type    text NOT NULL,
    size_bytes   integer NOT NULL,
    sha256       text NOT NULL,
    content      bytea NOT NULL,
    uploaded_by  uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    uploaded_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION document_file_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Uploaded documents are kept exactly as uploaded and cannot be changed or deleted'; END IF;
    NEW.sha256 := encode(sha256(NEW.content), 'hex');
    NEW.size_bytes := length(NEW.content);
    NEW.uploaded_by := current_app_user();
    IF NEW.size_bytes > 20 * 1024 * 1024 THEN RAISE EXCEPTION 'The file is larger than 20 MB'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_rules BEFORE INSERT OR UPDATE OR DELETE ON document_file FOR EACH ROW EXECUTE FUNCTION document_file_rules();
CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON document_file FOR EACH STATEMENT EXECUTE FUNCTION gxp_no_delete();

CREATE TABLE supplier_coa (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id             uuid NOT NULL REFERENCES inventory_lot(id),
    document_id        uuid NOT NULL REFERENCES document_file(id),
    file_name          text NOT NULL,
    sha256             text NOT NULL,
    extraction_method  text NOT NULL DEFAULT 'Manual' CHECK (extraction_method IN ('Manual','AI proposed, person confirmed')),
    ai_model           text,
    ai_proposed        jsonb,          -- exactly what the AI proposed, kept for the audit trail
    values_confirmed   jsonb,          -- what the person confirmed and saved to the lot
    confirmed_by       uuid REFERENCES app_user(id),
    confirmed_at       timestamptz,
    status             record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('supplier_coa', false);
CREATE FUNCTION supplier_coa_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_site_access((SELECT site_id FROM inventory_lot WHERE id = NEW.lot_id));
    IF TG_OP = 'INSERT' THEN
        SELECT file_name, sha256 INTO NEW.file_name, NEW.sha256 FROM document_file WHERE id = NEW.document_id;
    ELSIF NEW.document_id <> OLD.document_id OR NEW.sha256 <> OLD.sha256 OR NEW.ai_proposed IS DISTINCT FROM OLD.ai_proposed THEN
        RAISE EXCEPTION 'The document and the AI proposal on a COA record cannot be changed; upload the COA again';
    END IF;
    IF NEW.values_confirmed IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.values_confirmed END) AND NEW.values_confirmed IS NOT NULL THEN
        NEW.confirmed_by := current_app_user(); NEW.confirmed_at := clock_timestamp();
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON supplier_coa FOR EACH ROW EXECUTE FUNCTION supplier_coa_rules();

-------------------------------------------------------------------------------
-- 11. WARNING THRESHOLDS (generic Threshold Rule types; warnings never block work)
-------------------------------------------------------------------------------
CREATE TABLE threshold_rule (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name       text NOT NULL CHECK (btrim(rule_name) <> ''),
    subject         threshold_subject NOT NULL,
    rule_type       threshold_type NOT NULL,
    value           numeric(14,4) NOT NULL CHECK (value >= 0),
    site_id         uuid REFERENCES lab_site(id),       -- empty = every lab
    chemical_id     uuid REFERENCES chemical(id),       -- Lot Quantity only: empty = every chemical
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT threshold_rule_type_fits CHECK (
        (subject IN ('Lot Quantity','Sample Retain') AND rule_type IN ('Percentage of Base','Absolute Max-Min'))
     OR (subject = 'Lot Expiry' AND rule_type = 'Days Until/Since')),
    CONSTRAINT threshold_rule_chemical_fits CHECK (chemical_id IS NULL OR subject = 'Lot Quantity'),
    CONSTRAINT threshold_rule_pct CHECK (rule_type <> 'Percentage of Base' OR value <= 100)
);
CALL make_gxp('threshold_rule');
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON threshold_rule FOR EACH ROW EXECUTE FUNCTION require_inventory_maintainer();

-- Is a quantity below a warning threshold? (Percentage of Base: below value% of the base; Absolute: below value)
CREATE FUNCTION below_threshold(p_subject threshold_subject, p_site uuid, p_chemical uuid, p_qty numeric, p_base numeric) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM threshold_rule r
        WHERE r.status = 'Active' AND r.subject = p_subject AND (r.site_id IS NULL OR r.site_id = p_site)
          AND (r.chemical_id IS NULL OR r.chemical_id = p_chemical)
          AND ((r.rule_type = 'Percentage of Base' AND p_base > 0 AND p_qty < p_base * r.value / 100)
            OR (r.rule_type = 'Absolute Max-Min' AND p_qty < r.value)))
$$;
CREATE FUNCTION expiry_warning_days(p_site uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT max(value)::int FROM threshold_rule WHERE status = 'Active' AND subject = 'Lot Expiry' AND (site_id IS NULL OR site_id = p_site)
$$;

-------------------------------------------------------------------------------
-- 12. SAMPLE STORAGE AND RETAINED QUANTITY
-------------------------------------------------------------------------------
ALTER TABLE sample ADD COLUMN storage_location_id uuid REFERENCES storage_location(id);
ALTER TABLE sample ADD COLUMN storage_condition storage_condition;
ALTER TABLE sample ADD COLUMN retained_quantity numeric(12,3) CHECK (retained_quantity >= 0);
ALTER TABLE sample ADD COLUMN retained_unit text;

CREATE FUNCTION sample_storage_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF NEW.storage_location_id IS NULL AND NEW.retained_quantity IS NULL THEN RETURN NEW; END IF;
    SELECT site_id INTO v_site FROM lab_order WHERE id = NEW.lab_order_id;
    IF NEW.storage_location_id IS NOT NULL THEN
        IF NOT (SELECT holds_samples FROM storage_location WHERE id = NEW.storage_location_id) THEN
            RAISE EXCEPTION 'That storage location is not set up to hold samples';
        END IF;
        PERFORM assert_storage_ok(NEW.storage_location_id, v_site, NEW.storage_condition, 'Sample ' || COALESCE(NEW.sample_code, NEW.client_sample_id, ''));
    END IF;
    IF NEW.retained_quantity IS NOT NULL THEN
        NEW.retained_unit := COALESCE(NULLIF(btrim(NEW.retained_unit), ''), NEW.quantity_unit);
        IF NEW.quantity_received IS NOT NULL AND NEW.retained_unit IS NOT DISTINCT FROM NEW.quantity_unit AND NEW.retained_quantity > NEW.quantity_received THEN
            RAISE EXCEPTION 'Retained quantity (% %) cannot be more than was received (% %)', NEW.retained_quantity, NEW.retained_unit, NEW.quantity_received, NEW.quantity_unit;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_storage BEFORE INSERT OR UPDATE OF storage_location_id, storage_condition, retained_quantity, retained_unit, quantity_received
    ON sample FOR EACH ROW EXECUTE FUNCTION sample_storage_check();

-------------------------------------------------------------------------------
-- 13. VIEWS
-------------------------------------------------------------------------------
CREATE VIEW inventory_lot_view AS
SELECT x.*,
       CASE WHEN x.receipt_status <> 'Received' THEN 'Not received yet (' || x.receipt_status || ')'
            WHEN x.status <> 'Available' THEN x.status::text
            WHEN x.expiration_date < x.today THEN 'Expired'
            WHEN x.retest_date < x.today THEN 'Retest due'
            ELSE NULL END AS not_usable_because,
       (x.receipt_status = 'Received' AND x.status = 'Available' AND COALESCE(x.expiration_date >= x.today, true)
            AND COALESCE(x.retest_date >= x.today, true)) AS use_eligible,
       CASE WHEN x.expiration_date < x.today THEN 'Expired'
            WHEN x.retest_date < x.today THEN 'Retest due'
            WHEN x.expiration_date <= x.today + COALESCE(expiry_warning_days(x.site_id), -1) THEN 'Expiring soon'
            WHEN x.expiration_date IS NULL THEN 'No expiry'
            ELSE 'OK' END AS expiry_status,
       x.on_hand < 0 AS negative_stock,
       (x.receipt_status = 'Received' AND x.status = 'Available'
            AND below_threshold('Lot Quantity', x.site_id, x.chemical_id, x.on_hand, x.quantity_received)) AS low_stock
FROM (
    SELECT l.*, ls.site_code, COALESCE(ch.chemical_name, l.item_description) AS material, ch.chemical_code, ch.cas_number,
           sp.supplier_name, mf.supplier_name AS manufacturer_name, sl.location_code, location_path(l.storage_location_id) AS location_path,
           lot_on_hand(l.id) AS on_hand, (l.expiration_date - site_today(l.site_id)) AS days_to_expiry, site_today(l.site_id) AS today,
           tf.lot_code AS transferred_from_code, tfs.site_code AS transferred_from_site, ro.lot_code AS reorder_of_code,
           ap.full_name AS approved_by_name,
           EXISTS (SELECT 1 FROM supplier_coa c WHERE c.lot_id = l.id AND c.status = 'Active') AS coa_on_file,
           (SELECT count(*) FROM lot_component lc WHERE lc.lot_id = l.id) AS component_count,
           array_to_string(l.chemical_types, ', ') AS chemical_types_text
      FROM inventory_lot l
      JOIN lab_site ls ON ls.id = l.site_id
      LEFT JOIN chemical ch ON ch.id = l.chemical_id
      LEFT JOIN supplier sp ON sp.id = l.supplier_id
      LEFT JOIN supplier mf ON mf.id = l.manufacturer_id
      LEFT JOIN storage_location sl ON sl.id = l.storage_location_id
      LEFT JOIN inventory_lot tf ON tf.id = l.transferred_from_lot_id
      LEFT JOIN lab_site tfs ON tfs.id = tf.site_id
      LEFT JOIN inventory_lot ro ON ro.id = l.reorder_of_lot_id
      LEFT JOIN app_user ap ON ap.id = l.approved_by
) x;

CREATE VIEW sample_storage_view AS
SELECT s.id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.status, s.logged_at, s.quantity_received, s.quantity_unit,
       s.storage_location_id, s.storage_condition, s.retained_quantity, s.retained_unit, s.lab_order_id, s.record_version,
       o.order_code, o.site_id, COALESCE(c.display_name, c.legal_name) AS client_name,
       sl.location_code, location_path(s.storage_location_id) AS location_path,
       (s.retained_quantity IS NOT NULL AND below_threshold('Sample Retain', o.site_id, NULL, s.retained_quantity,
            CASE WHEN s.retained_unit IS NOT DISTINCT FROM s.quantity_unit THEN s.quantity_received END)) AS retain_low,
       (s.retained_quantity = 0) AS retain_used_up
  FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
  LEFT JOIN storage_location sl ON sl.id = s.storage_location_id;

-------------------------------------------------------------------------------
-- 14. AUDIT TRAIL REFERENCES for the new records (the previous function handles everything else)
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice2;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE lbl text; lnk text;
BEGIN
    CASE p_table
    WHEN 'chemical' THEN lbl := (r->>'chemical_code') || ' ' || (r->>'chemical_name'); lnk := '#/inventory/chemicals?find=' || (r->>'chemical_code');
    WHEN 'supplier' THEN lbl := (r->>'supplier_code') || ' ' || (r->>'supplier_name'); lnk := '#/inventory/suppliers?find=' || (r->>'supplier_code');
    WHEN 'storage_location' THEN lbl := 'Location ' || (r->>'location_code') || ' ' || (r->>'location_name'); lnk := '#/inventory/locations?find=' || (r->>'location_code');
    WHEN 'inventory_lot' THEN lbl := 'Lot ' || (r->>'lot_code'); lnk := '#/inventory/lots/' || p_id;
    WHEN 'inventory_transaction' THEN
        SELECT 'Lot ' || l.lot_code || ' ' || lower(r->>'txn_type') || ' ' || (r->>'quantity_change') || ' ' || COALESCE(l.unit, ''), '#/inventory/lots/' || l.id
          INTO lbl, lnk FROM inventory_lot l WHERE l.id = (r->>'lot_id')::uuid;
    WHEN 'lot_component' THEN
        SELECT 'Lot ' || m.lot_code || ' component ' || c.lot_code, '#/inventory/lots/' || m.id INTO lbl, lnk
          FROM inventory_lot m, inventory_lot c WHERE m.id = (r->>'lot_id')::uuid AND c.id = (r->>'component_lot_id')::uuid;
    WHEN 'supplier_coa' THEN
        SELECT 'Supplier COA ' || (r->>'file_name') || ' on ' || l.lot_code, '#/inventory/lots/' || l.id INTO lbl, lnk
          FROM inventory_lot l WHERE l.id = (r->>'lot_id')::uuid;
    WHEN 'threshold_rule' THEN lbl := 'Warning rule ' || (r->>'rule_name'); lnk := '#/inventory/thresholds';
    WHEN 'app_user' THEN lbl := 'User ' || (r->>'full_name'); lnk := '#/admin/users';
    ELSE RETURN audit_record_ref_slice2(p_table, p_id, r);
    END CASE;
    RETURN jsonb_build_object('label', COALESCE(lbl, replace(p_table, '_', ' ')), 'link', lnk);
END $$;

COMMIT;
