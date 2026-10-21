-- LIMS3 schema, migration 006: Inventory slice 3.1 (Alex's inventory feedback, 2026-10-12)
-- * The Chemical list is retired: each inventory item carries its own name and CAS, and is linked to one or
--   more Analytes (with concentrations). Reference Standards and Microbiological Strains must name an analyte.
--   The old chemical link still works for older data and scripts: it fills in the name, CAS and analyte.
-- * Units and Unit conversions are controlled lists (Admin; maintained by QA and administrators). Every
--   calculation uses only these tables.
-- * Each item is Solid or Liquid. In-house mixtures get their concentration per analyte calculated from the
--   component lots and checked against a target +/- tolerance.
-- Existing data is carried over (name, CAS and analyte from the chemical; Solid or Liquid from the unit).

BEGIN;
SET search_path = lims, public;

-- Reference data delivered by a migration is attributed to an inactive "System" user (it cannot log in or act)
INSERT INTO app_user (username, full_name, is_active) VALUES ('system', 'System (data delivered by a migration)', false) ON CONFLICT (username) DO NOTHING;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 006: units, unit conversions and inventory items without the Chemical list', true);

-------------------------------------------------------------------------------
-- 1. UNITS AND UNIT CONVERSIONS
-------------------------------------------------------------------------------
-- 1000.0000000000 -> 1000, 10.5000 -> 10.5 (for display)
CREATE FUNCTION fmt_num(n numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN n IS NULL THEN NULL WHEN position('.' in n::text) > 0 THEN rtrim(rtrim(n::text, '0'), '.') ELSE n::text END
$$;

CREATE TYPE unit_dimension AS ENUM ('Mass','Volume','Count','Mass/Volume','Mass/Mass','Volume/Volume','Parts per','Amount/Volume','Activity','Other');

-- Units and conversions drive calculated concentrations: QA and administrators maintain them
CREATE FUNCTION can_maintain_units() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT user_has_role('{QA}') $$;
CREATE FUNCTION require_units_maintainer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT can_maintain_units() THEN RAISE EXCEPTION 'Only QA and administrators can change the % list', replace(replace(TG_TABLE_NAME, 'unit_of_measure', 'Units'), 'unit_conversion', 'Unit conversion'); END IF;
    RETURN NEW;
END $$;

CREATE TABLE unit_of_measure (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_code       text NOT NULL CHECK (btrim(unit_code) <> ''),
    unit_name       text NOT NULL CHECK (btrim(unit_name) <> ''),
    dimension       unit_dimension NOT NULL,
    sort_order      integer NOT NULL DEFAULT 100,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX unit_code_uq ON unit_of_measure (lower(unit_code));
CALL make_gxp('unit_of_measure');

-- 1 [from unit] = factor x [to unit]. "Applies to" limits a conversion to liquids or solids (ppm).
CREATE TABLE unit_conversion (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    from_unit_id    uuid NOT NULL REFERENCES unit_of_measure(id),
    to_unit_id      uuid NOT NULL REFERENCES unit_of_measure(id),
    factor          numeric(30,15) NOT NULL CHECK (factor > 0),
    applies_to      text NOT NULL DEFAULT 'Any' CHECK (applies_to IN ('Any','Liquid','Solid')),
    assumption      text,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT unit_conversion_not_self CHECK (from_unit_id <> to_unit_id)
);
CREATE UNIQUE INDEX unit_conversion_uq ON unit_conversion (from_unit_id, to_unit_id, applies_to) WHERE status = 'Active';
CALL make_gxp('unit_conversion');

INSERT INTO unit_of_measure (unit_code, unit_name, dimension, sort_order) VALUES
 ('kg','kilogram','Mass',10), ('g','gram','Mass',11), ('mg','milligram','Mass',12), ('µg','microgram','Mass',13), ('ng','nanogram','Mass',14),
 ('lb','pound','Mass',15), ('oz','ounce (mass)','Mass',16),
 ('L','litre','Volume',20), ('mL','millilitre','Volume',21), ('µL','microlitre','Volume',22), ('gal','US gallon','Volume',23),
 ('each','each','Count',30), ('pack','pack','Count',31), ('box','box','Count',32), ('case','case','Count',33), ('kit','kit','Count',34),
 ('vial','vial','Count',35), ('ampoule','ampoule','Count',36), ('bottle','bottle','Count',37), ('plate','plate','Count',38), ('tube','tube','Count',39),
 ('bag','bag','Count',40), ('roll','roll','Count',41), ('sheet','sheet','Count',42), ('cartridge','cartridge','Count',43), ('column','column','Count',44),
 ('test','test (kit determinations)','Count',45),
 ('g/L','grams per litre','Mass/Volume',50), ('mg/L','milligrams per litre','Mass/Volume',51), ('µg/L','micrograms per litre','Mass/Volume',52),
 ('ng/L','nanograms per litre','Mass/Volume',53), ('g/mL','grams per millilitre','Mass/Volume',54), ('mg/mL','milligrams per millilitre','Mass/Volume',55),
 ('µg/mL','micrograms per millilitre','Mass/Volume',56), ('ng/mL','nanograms per millilitre','Mass/Volume',57), ('% w/v','percent weight per volume','Mass/Volume',58),
 ('g/kg','grams per kilogram','Mass/Mass',60), ('mg/kg','milligrams per kilogram','Mass/Mass',61), ('µg/kg','micrograms per kilogram','Mass/Mass',62),
 ('mg/g','milligrams per gram','Mass/Mass',63), ('µg/g','micrograms per gram','Mass/Mass',64), ('ng/g','nanograms per gram','Mass/Mass',65),
 ('% w/w','percent weight per weight','Mass/Mass',66),
 ('mL/L','millilitres per litre','Volume/Volume',70), ('µL/L','microlitres per litre','Volume/Volume',71), ('% v/v','percent volume per volume','Volume/Volume',72),
 ('ppm','parts per million','Parts per',80), ('ppb','parts per billion','Parts per',81), ('ppt','parts per trillion','Parts per',82),
 ('M','molar (mol/L)','Amount/Volume',90), ('mM','millimolar','Amount/Volume',91), ('µM','micromolar','Amount/Volume',92), ('nM','nanomolar','Amount/Volume',93),
 ('N','normal (equivalents per litre)','Amount/Volume',94),
 ('CFU/mL','colony forming units per millilitre','Activity',100), ('CFU/g','colony forming units per gram','Activity',101),
 ('CFU/vial','colony forming units per vial','Activity',102), ('IU/mL','international units per millilitre','Activity',103),
 ('IU/mg','international units per milligram','Activity',104), ('U/mL','enzyme units per millilitre','Activity',105);

INSERT INTO unit_conversion (from_unit_id, to_unit_id, factor, applies_to, assumption)
SELECT f.id, t.id, c.factor, c.applies_to, c.assumption
  FROM (VALUES
   ('kg','g',1000::numeric,'Any',NULL::text), ('mg','g',0.001,'Any',NULL), ('µg','g',0.000001,'Any',NULL), ('ng','g',0.000000001,'Any',NULL),
   ('lb','g',453.59237,'Any',NULL), ('oz','g',28.349523125,'Any',NULL),
   ('L','mL',1000,'Any',NULL), ('µL','mL',0.001,'Any',NULL), ('gal','mL',3785.411784,'Any',NULL),
   ('g/L','mg/L',1000,'Any',NULL), ('µg/L','mg/L',0.001,'Any',NULL), ('ng/L','mg/L',0.000001,'Any',NULL), ('g/mL','mg/L',1000000,'Any',NULL),
   ('mg/mL','mg/L',1000,'Any',NULL), ('µg/mL','mg/L',1,'Any',NULL), ('ng/mL','mg/L',0.001,'Any',NULL), ('% w/v','mg/L',10000,'Any',NULL),
   ('g/kg','mg/kg',1000,'Any',NULL), ('µg/kg','mg/kg',0.001,'Any',NULL), ('mg/g','mg/kg',1000,'Any',NULL), ('µg/g','mg/kg',1,'Any',NULL),
   ('ng/g','mg/kg',0.001,'Any',NULL), ('% w/w','mg/kg',10000,'Any',NULL),
   ('µL/L','mL/L',0.001,'Any',NULL), ('% v/v','mL/L',10,'Any',NULL),
   ('ppm','ppb',1000,'Any',NULL), ('ppb','ppt',1000,'Any',NULL),
   ('ppm','mg/L',1,'Liquid','Dilute water-based solution (density 1 g/mL)'), ('ppb','µg/L',1,'Liquid','Dilute water-based solution (density 1 g/mL)'),
   ('ppt','ng/L',1,'Liquid','Dilute water-based solution (density 1 g/mL)'),
   ('ppm','mg/kg',1,'Solid',NULL), ('ppb','µg/kg',1,'Solid',NULL),
   ('M','mM',1000,'Any',NULL), ('µM','mM',0.001,'Any',NULL), ('nM','mM',0.000001,'Any',NULL)
  ) AS c(f, t, factor, applies_to, assumption)
  JOIN unit_of_measure f ON f.unit_code = c.f JOIN unit_of_measure t ON t.unit_code = c.t;

CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON unit_of_measure FOR EACH ROW EXECUTE FUNCTION require_units_maintainer();
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON unit_conversion FOR EACH ROW EXECUTE FUNCTION require_units_maintainer();

-- A unit in use keeps its code (records store the code); retire it and add a new one instead
CREATE FUNCTION unit_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.unit_code := btrim(NEW.unit_code);
    IF TG_OP = 'UPDATE' AND NEW.unit_code <> OLD.unit_code AND (
         EXISTS (SELECT 1 FROM inventory_lot WHERE unit = OLD.unit_code OR concentration_unit = OLD.unit_code)) THEN
        RAISE EXCEPTION 'Unit "%" is used on inventory and cannot be renamed. Set it Inactive and add the new one instead.', OLD.unit_code;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.dimension <> OLD.dimension AND EXISTS (SELECT 1 FROM unit_conversion WHERE (from_unit_id = NEW.id OR to_unit_id = NEW.id) AND status = 'Active') THEN
        RAISE EXCEPTION 'Unit "%" has conversions; set them Inactive before changing what it measures', OLD.unit_code;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON unit_of_measure FOR EACH ROW EXECUTE FUNCTION unit_rules();

-- Conversions only join units that measure the same thing (ppm, parts per, may convert to mass/volume or mass/mass)
CREATE FUNCTION unit_conversion_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a unit_dimension; b unit_dimension;
BEGIN
    SELECT dimension INTO a FROM unit_of_measure WHERE id = NEW.from_unit_id;
    SELECT dimension INTO b FROM unit_of_measure WHERE id = NEW.to_unit_id;
    IF a <> b AND NOT ((a = 'Parts per' AND b IN ('Mass/Volume','Mass/Mass')) OR (b = 'Parts per' AND a IN ('Mass/Volume','Mass/Mass'))) THEN
        RAISE EXCEPTION 'A % unit cannot be converted to a % unit', a, b;
    END IF;
    IF 'Parts per' IN (a, b) AND a <> b AND NEW.applies_to = 'Any' THEN
        RAISE EXCEPTION 'A ppm-type conversion must say whether it applies to liquids or to solids';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON unit_conversion FOR EACH ROW EXECUTE FUNCTION unit_conversion_rules();

-- How many [to] in one [from], following the conversions table (both directions, up to 4 steps); NULL if it cannot convert.
-- p_form ('Liquid' or 'Solid') decides which ppm-type conversions apply.
CREATE FUNCTION unit_factor(p_from text, p_to text, p_form text DEFAULT NULL) RETURNS numeric LANGUAGE sql STABLE AS $$
    WITH RECURSIVE e(a, b, f) AS (
        SELECT c.from_unit_id, c.to_unit_id, c.factor FROM unit_conversion c WHERE c.status = 'Active' AND (c.applies_to = 'Any' OR c.applies_to = p_form)
        UNION ALL
        SELECT c.to_unit_id, c.from_unit_id, 1 / c.factor FROM unit_conversion c WHERE c.status = 'Active' AND (c.applies_to = 'Any' OR c.applies_to = p_form)),
    walk(node, f, depth, path) AS (
        SELECT u.id, 1::numeric, 0, ARRAY[u.id] FROM unit_of_measure u WHERE lower(u.unit_code) = lower(btrim(p_from))
        UNION ALL
        SELECT e.b, walk.f * e.f, walk.depth + 1, walk.path || e.b FROM walk JOIN e ON e.a = walk.node
         WHERE walk.depth < 4 AND NOT e.b = ANY(walk.path))
    SELECT f FROM walk WHERE node = (SELECT id FROM unit_of_measure WHERE lower(unit_code) = lower(btrim(p_to))) ORDER BY depth LIMIT 1
$$;

-- A unit code from the list, in the list's spelling, of one of the given kinds; refuses anything else
CREATE FUNCTION canonical_unit(p_code text, p_dims unit_dimension[], p_what text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE v text;
BEGIN
    IF p_code IS NULL OR btrim(p_code) = '' THEN RETURN NULL; END IF;
    SELECT unit_code INTO v FROM unit_of_measure WHERE lower(unit_code) = lower(btrim(p_code)) AND status = 'Active' AND dimension = ANY(p_dims);
    IF v IS NULL THEN
        RAISE EXCEPTION '% "%" is not on the Units list (Admin > Units) as a % unit', p_what, p_code, array_to_string(p_dims, ', ');
    END IF;
    RETURN v;
END $$;
CREATE FUNCTION quantity_dims() RETURNS unit_dimension[] LANGUAGE sql IMMUTABLE AS $$ SELECT '{Mass,Volume,Count}'::unit_dimension[] $$;
CREATE FUNCTION concentration_dims() RETURNS unit_dimension[] LANGUAGE sql IMMUTABLE AS $$
    SELECT '{Mass/Volume,Mass/Mass,Volume/Volume,Parts per,Amount/Volume,Activity,Other}'::unit_dimension[] $$;

-- The fixed unit list is replaced by the Units table
ALTER TABLE inventory_lot DROP CONSTRAINT inventory_lot_unit_check;
CREATE OR REPLACE FUNCTION inventory_units() RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(unit_code ORDER BY sort_order, unit_code), '{}') FROM unit_of_measure WHERE status = 'Active' AND dimension = ANY(quantity_dims())
$$;

-------------------------------------------------------------------------------
-- 2. INVENTORY ITEM: own name and CAS, Solid or Liquid; analytes with concentrations
-------------------------------------------------------------------------------
ALTER TABLE inventory_lot ADD COLUMN item_name text;
ALTER TABLE inventory_lot ADD COLUMN cas_number text CHECK (is_valid_cas(cas_number));
ALTER TABLE inventory_lot ADD COLUMN physical_form text CHECK (physical_form IN ('Solid','Liquid'));

CREATE TABLE lot_analyte (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id               uuid NOT NULL REFERENCES inventory_lot(id),
    analyte_id           uuid NOT NULL REFERENCES analyte(id),
    concentration        numeric(24,10) CHECK (concentration >= 0),
    concentration_unit   text,
    target_concentration numeric(24,10) CHECK (target_concentration >= 0),
    tolerance_pct        numeric(7,3) CHECK (tolerance_pct >= 0),
    calculated           boolean NOT NULL DEFAULT false,   -- true: calculated from the mixture's components
    calc_note            text,                             -- how it was calculated, or why it could not be
    status               record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (lot_id, analyte_id)
);
CREATE INDEX lot_analyte_lot_idx ON lot_analyte (lot_id);
CALL make_gxp('lot_analyte');

CREATE FUNCTION lot_analyte_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    PERFORM assert_site_access(l.site_id);
    IF TG_OP = 'UPDATE' AND (NEW.lot_id <> OLD.lot_id OR NEW.analyte_id <> OLD.analyte_id) THEN
        RAISE EXCEPTION 'The lot and analyte of an analyte line cannot be changed; set it Inactive and add another';
    END IF;
    IF lot_is_consumable_only(l.chemical_types) THEN RAISE EXCEPTION 'Consumables have no analytes'; END IF;
    IF (TG_OP = 'INSERT' OR NEW.analyte_id <> OLD.analyte_id) AND (SELECT status FROM analyte WHERE id = NEW.analyte_id) <> 'Active' THEN
        RAISE EXCEPTION 'That analyte is Retired';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.concentration_unit IS DISTINCT FROM OLD.concentration_unit THEN
        NEW.concentration_unit := canonical_unit(NEW.concentration_unit, concentration_dims(), 'Concentration unit');
    END IF;
    IF NEW.concentration IS NOT NULL AND NEW.concentration_unit IS NULL THEN RAISE EXCEPTION 'Give the concentration a unit'; END IF;
    IF NEW.target_concentration IS NOT NULL AND NEW.concentration_unit IS NULL THEN RAISE EXCEPTION 'Give the target concentration a unit'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON lot_analyte FOR EACH ROW EXECUTE FUNCTION lot_analyte_rules();

-- Same rules as migration 005, except: the Chemical list is no longer needed (a lot has its own name and CAS;
-- an old chemical link fills them in), units come from the Units table, and Solid / Liquid defaults from the unit.
CREATE OR REPLACE FUNCTION inventory_lot_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src inventory_lot; v_min_exp date; v_dim unit_dimension;
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

    -- What the lot is: its own name and CAS (an old Chemical-list link fills them in)
    IF NEW.chemical_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.chemical_id IS DISTINCT FROM OLD.chemical_id) THEN
        IF (SELECT status FROM chemical WHERE id = NEW.chemical_id) <> 'Active' THEN RAISE EXCEPTION 'That chemical is Retired on the Chemical list'; END IF;
        SELECT COALESCE(NEW.item_name, ch.chemical_name), COALESCE(NEW.cas_number, ch.cas_number) INTO NEW.item_name, NEW.cas_number
          FROM chemical ch WHERE ch.id = NEW.chemical_id;
    END IF;
    NEW.item_name := NULLIF(btrim(COALESCE(NEW.item_name, NEW.item_description)), '');
    IF NEW.item_name IS NULL THEN
        RAISE EXCEPTION 'Enter the item name (for example "Sodium Standard 1000 ppm" or "Pipette tips, 1000 µL")';
    END IF;
    IF lot_is_consumable_only(NEW.chemical_types) AND (NEW.purity_pct IS NOT NULL OR NEW.concentration IS NOT NULL) THEN
        RAISE EXCEPTION 'Purity and concentration do not apply to consumables';
    END IF;

    -- Units from the Units table; Solid / Liquid defaults from the unit
    IF TG_OP = 'INSERT' OR NEW.unit IS DISTINCT FROM OLD.unit THEN NEW.unit := canonical_unit(NEW.unit, quantity_dims(), 'Unit'); END IF;
    IF TG_OP = 'INSERT' OR NEW.concentration_unit IS DISTINCT FROM OLD.concentration_unit THEN
        NEW.concentration_unit := canonical_unit(NEW.concentration_unit, concentration_dims(), 'Concentration unit');
    END IF;
    IF NEW.concentration IS NOT NULL AND NEW.concentration_unit IS NULL THEN RAISE EXCEPTION 'Give the concentration a unit'; END IF;
    IF NEW.physical_form IS NULL AND NEW.unit IS NOT NULL AND NOT lot_is_consumable_only(NEW.chemical_types) THEN
        SELECT dimension INTO v_dim FROM unit_of_measure WHERE unit_code = NEW.unit;
        NEW.physical_form := CASE v_dim WHEN 'Volume' THEN 'Liquid' WHEN 'Mass' THEN 'Solid' END;
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

-- An old chemical link that names an analyte also links the lot to that analyte (with the lot's concentration)
CREATE FUNCTION inventory_lot_chemical_analyte() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a uuid;
BEGIN
    IF NEW.chemical_id IS NULL OR (TG_OP = 'UPDATE' AND NEW.chemical_id IS NOT DISTINCT FROM OLD.chemical_id) THEN RETURN NULL; END IF;
    SELECT analyte_id INTO a FROM chemical WHERE id = NEW.chemical_id;
    IF a IS NOT NULL AND NOT lot_is_consumable_only(NEW.chemical_types) THEN
        INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
        VALUES (NEW.id, a, NEW.concentration, CASE WHEN NEW.concentration IS NOT NULL THEN NEW.concentration_unit END)
        ON CONFLICT (lot_id, analyte_id) DO NOTHING;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER y_chemical_analyte AFTER INSERT OR UPDATE OF chemical_id ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_chemical_analyte();

-- Reference Standards and Microbiological Strains must name at least one analyte (checked when the whole save is done)
CREATE FUNCTION inventory_lot_analyte_required() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.id;
    IF l.chemical_id IS NULL AND l.chemical_types && '{Reference Standard,Microbiological Strain}'::chemical_type[]
       AND l.status NOT IN ('Cancelled','Disposed')
       AND NOT EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active') THEN
        RAISE EXCEPTION 'Lot % (%): a Reference Standard or Microbiological Strain must be linked to at least one analyte', l.lot_code, l.item_name;
    END IF;
    RETURN NULL;
END $$;

-------------------------------------------------------------------------------
-- 3. CARRY OVER EXISTING DATA (the Chemical list's name, CAS and analyte; Solid or Liquid from the unit).
--    The lot rules are paused for this copy only (it changes no quantities, dates or access); still audited.
-------------------------------------------------------------------------------
ALTER TABLE inventory_lot DISABLE TRIGGER a0_rules;
UPDATE inventory_lot l SET item_name = COALESCE(ch.chemical_name, l.item_description), cas_number = ch.cas_number
  FROM chemical ch WHERE ch.id = l.chemical_id;
UPDATE inventory_lot SET item_name = item_description WHERE item_name IS NULL;
UPDATE inventory_lot l SET physical_form = CASE u.dimension WHEN 'Volume' THEN 'Liquid' WHEN 'Mass' THEN 'Solid' END
  FROM unit_of_measure u WHERE u.unit_code = l.unit AND NOT lot_is_consumable_only(l.chemical_types) AND u.dimension IN ('Volume','Mass');
ALTER TABLE inventory_lot ENABLE TRIGGER a0_rules;
ALTER TABLE lot_analyte DISABLE TRIGGER a0_rules;
INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
SELECT l.id, ch.analyte_id, l.concentration, CASE WHEN l.concentration IS NOT NULL THEN COALESCE(u.unit_code, l.concentration_unit) END
  FROM inventory_lot l JOIN chemical ch ON ch.id = l.chemical_id
  LEFT JOIN unit_of_measure u ON lower(u.unit_code) = lower(l.concentration_unit)
 WHERE ch.analyte_id IS NOT NULL AND NOT lot_is_consumable_only(l.chemical_types)
ON CONFLICT (lot_id, analyte_id) DO NOTHING;
ALTER TABLE lot_analyte ENABLE TRIGGER a0_rules;

CREATE CONSTRAINT TRIGGER z_analyte_required AFTER INSERT OR UPDATE ON inventory_lot DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION inventory_lot_analyte_required();

-------------------------------------------------------------------------------
-- 4. IN-HOUSE MIXTURES: quantity made and concentration calculated from the components
-------------------------------------------------------------------------------
-- Default quantity made: the total of the components that can be expressed in the mixture's unit
-- (for a liquid mixture in mL: every liquid component's volume). p_components = [{"lot_id": uuid, "quantity": n}, ...]
CREATE FUNCTION mixture_default_quantity(p_components jsonb, p_unit text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT sum((x->>'quantity')::numeric * unit_factor(l.unit, p_unit, l.physical_form))
      FROM jsonb_array_elements(COALESCE(p_components, '[]')) x JOIN inventory_lot l ON l.id = (x->>'lot_id')::uuid
     WHERE (x->>'quantity') IS NOT NULL AND unit_factor(l.unit, p_unit, l.physical_form) IS NOT NULL
$$;

-- Concentration of each analyte in a mixture: the analyte mass in every component portion used, divided by the
-- mixture's volume (liquid) or mass (solid). Liquid components: concentration converted to mg/L x volume used.
-- Solid components: concentration converted to mg/kg x mass used. Units and conversions come only from the tables.
-- p_out_units: {"<analyte id>": "unit"} to report in; otherwise the first component's unit (if it converts), else mg/L or mg/kg.
CREATE FUNCTION mixture_concentrations(p_components jsonb, p_quantity numeric, p_unit text, p_form text, p_out_units jsonb DEFAULT '{}')
RETURNS TABLE (analyte_id uuid, analyte_name text, concentration numeric, concentration_unit text, calc_note text) LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb; cl inventory_lot; a record; acc jsonb := '{}'; k text; e jsonb; f numeric; q numeric; m numeric;
        v_total numeric; v_base text; v_out text; v_note text; v_val numeric;
BEGIN
    v_base := CASE WHEN p_form = 'Solid' THEN 'mg/kg' ELSE 'mg/L' END;
    v_total := p_quantity * unit_factor(p_unit, CASE WHEN p_form = 'Solid' THEN 'kg' ELSE 'L' END, p_form);
    FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_components, '[]')) LOOP
        SELECT * INTO cl FROM inventory_lot WHERE id = (c->>'lot_id')::uuid;
        q := (c->>'quantity')::numeric;
        FOR a IN SELECT la.analyte_id, an.analyte_name, la.concentration, la.concentration_unit FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id
                  WHERE la.lot_id = cl.id AND la.status = 'Active' LOOP
            k := a.analyte_id::text;
            e := COALESCE(acc->k, jsonb_build_object('name', a.analyte_name, 'mg', 0, 'unit', a.concentration_unit, 'bad', '[]'::jsonb, 'from', '[]'::jsonb));
            m := NULL;
            IF a.concentration IS NULL THEN
                e := jsonb_set(e, '{bad}', (e->'bad') || to_jsonb(cl.lot_code || ' has no ' || a.analyte_name || ' concentration'));
            ELSIF COALESCE(cl.physical_form, 'Liquid') = 'Liquid' THEN
                f := unit_factor(a.concentration_unit, 'mg/L', 'Liquid');
                IF f IS NULL OR unit_factor(cl.unit, 'L', 'Liquid') IS NULL THEN
                    e := jsonb_set(e, '{bad}', (e->'bad') || to_jsonb(cl.lot_code || ': cannot convert ' || a.concentration_unit || ' x ' || COALESCE(cl.unit, '?') || ' to an amount'));
                ELSE m := a.concentration * f * q * unit_factor(cl.unit, 'L', 'Liquid'); END IF;
            ELSE
                f := unit_factor(a.concentration_unit, 'mg/kg', 'Solid');
                IF f IS NULL OR unit_factor(cl.unit, 'kg', 'Solid') IS NULL THEN
                    e := jsonb_set(e, '{bad}', (e->'bad') || to_jsonb(cl.lot_code || ': cannot convert ' || a.concentration_unit || ' x ' || COALESCE(cl.unit, '?') || ' to an amount'));
                ELSE m := a.concentration * f * q * unit_factor(cl.unit, 'kg', 'Solid'); END IF;
            END IF;
            IF m IS NOT NULL THEN
                e := jsonb_set(e, '{mg}', to_jsonb((e->>'mg')::numeric + m));
                e := jsonb_set(e, '{from}', (e->'from') || to_jsonb(cl.lot_code));
            END IF;
            acc := jsonb_set(acc, ARRAY[k], e);
        END LOOP;
    END LOOP;
    FOR k IN SELECT jsonb_object_keys(acc) LOOP
        e := acc->k;
        analyte_id := k::uuid; analyte_name := e->>'name';
        v_out := COALESCE(NULLIF(p_out_units->>k, ''), e->>'unit');
        IF v_out IS NULL OR unit_factor(v_base, v_out, p_form) IS NULL THEN v_out := v_base; END IF;
        IF jsonb_array_length(e->'bad') > 0 THEN
            concentration := NULL; concentration_unit := v_out;
            calc_note := 'Not calculated: ' || (SELECT string_agg(x, '; ') FROM jsonb_array_elements_text(e->'bad') x);
        ELSIF v_total IS NULL OR v_total = 0 THEN
            concentration := NULL; concentration_unit := v_out;
            calc_note := 'Not calculated: the quantity made (' || COALESCE(p_quantity::text, '?') || ' ' || COALESCE(p_unit, '?') || ') cannot be expressed as a '
                || CASE WHEN p_form = 'Solid' THEN 'mass' ELSE 'volume' END;
        ELSE
            v_val := (e->>'mg')::numeric / v_total * unit_factor(v_base, v_out, p_form);
            concentration := round(v_val, 6); concentration_unit := v_out;
            v_note := 'Calculated: ' || fmt_num(round((e->>'mg')::numeric, 6)) || ' mg of ' || analyte_name || ' from '
                || (SELECT string_agg(x, ', ') FROM jsonb_array_elements_text(e->'from') x) || ' in ' || fmt_num(p_quantity) || ' ' || p_unit;
            IF COALESCE(p_form, 'Liquid') = 'Liquid' AND (e->>'unit' ~* '^pp[mbt]$' OR v_out ~* '^pp[mbt]$') THEN
                v_note := v_note || '. ppm = mg/L assumes a dilute water-based solution (density 1 g/mL)';
            END IF;
            calc_note := v_note;
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

-- Prepare a mixture in one step (replaces make_mixture for the screens):
-- p_targets = [{"analyte_id": uuid, "unit": "ppm", "target": 10, "tolerance_pct": 5}, ...]
CREATE FUNCTION prepare_mixture(p_site uuid, p_name text, p_types chemical_type[], p_form text, p_quantity numeric, p_unit text,
                                p_expiration date, p_condition storage_condition, p_location uuid, p_components jsonb, p_targets jsonb,
                                p_notes text DEFAULT NULL, p_retest date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_min date; c jsonb; r record; v_units jsonb := '{}'; t jsonb;
BEGIN
    IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN RAISE EXCEPTION 'A mixture needs at least one component lot'; END IF;
    IF p_form IS NULL THEN RAISE EXCEPTION 'Say whether the mixture is Solid or Liquid'; END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Enter the quantity made'; END IF;
    SELECT min(l.expiration_date) INTO v_min FROM inventory_lot l WHERE l.id IN (SELECT (x->>'lot_id')::uuid FROM jsonb_array_elements(p_components) x);
    IF p_expiration IS NOT NULL AND v_min IS NOT NULL AND p_expiration > v_min THEN
        RAISE EXCEPTION 'This mixture must expire on or before % (its earliest-expiring component)', v_min;
    END IF;
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, quantity_received, unit, expiration_date, retest_date,
                               storage_condition, storage_location_id, notes, received_date)
    VALUES (p_site, p_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_types || '{In-house mixture}'::chemical_type[]) x), p_form, p_quantity, p_unit,
            COALESCE(p_expiration, v_min), p_retest, p_condition, p_location, p_notes, site_today(p_site))
    RETURNING id INTO v_id;
    FOR c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
        INSERT INTO lot_component (lot_id, component_lot_id, quantity_used) VALUES (v_id, (c->>'lot_id')::uuid, (c->>'quantity')::numeric);
    END LOOP;
    FOR t IN SELECT * FROM jsonb_array_elements(COALESCE(p_targets, '[]')) LOOP
        IF t->>'unit' IS NOT NULL THEN v_units := v_units || jsonb_build_object(t->>'analyte_id', t->>'unit'); END IF;
    END LOOP;
    FOR r IN SELECT * FROM mixture_concentrations(p_components, p_quantity, p_unit, p_form, v_units) LOOP
        t := NULL;
        SELECT x INTO t FROM jsonb_array_elements(COALESCE(p_targets, '[]')) x WHERE x->>'analyte_id' = r.analyte_id::text;
        INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note)
        VALUES (v_id, r.analyte_id, r.concentration, r.concentration_unit, NULLIF(t->>'target', '')::numeric, NULLIF(t->>'tolerance_pct', '')::numeric, true, r.calc_note);
    END LOOP;
    RETURN v_id;
END $$;

-- The older make_mixture (used by earlier scripts) now also records the calculated analyte concentrations
CREATE OR REPLACE FUNCTION make_mixture(p_site uuid, p_chemical uuid, p_description text, p_quantity numeric, p_unit text,
                             p_concentration numeric, p_concentration_unit text, p_expiration date,
                             p_condition storage_condition, p_location uuid, p_components jsonb, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_min date; c jsonb; r record; v_form text;
BEGIN
    IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN RAISE EXCEPTION 'A mixture needs at least one component lot'; END IF;
    SELECT min(l.expiration_date) INTO v_min FROM inventory_lot l
     WHERE l.id IN (SELECT (x->>'lot_id')::uuid FROM jsonb_array_elements(p_components) x);
    IF p_expiration IS NOT NULL AND v_min IS NOT NULL AND p_expiration > v_min THEN
        RAISE EXCEPTION 'This mixture must expire on or before % (its earliest-expiring component)', v_min;
    END IF;
    INSERT INTO inventory_lot (site_id, chemical_id, item_description, chemical_types, quantity_received, unit, concentration, concentration_unit,
                               expiration_date, storage_condition, storage_location_id, notes, received_date)
    VALUES (p_site, p_chemical, p_description, '{In-house mixture}', p_quantity, p_unit, p_concentration, p_concentration_unit,
            COALESCE(p_expiration, v_min), p_condition, p_location, p_notes, site_today(p_site))
    RETURNING id, physical_form INTO v_id, v_form;
    FOR c IN SELECT * FROM jsonb_array_elements(p_components) LOOP
        INSERT INTO lot_component (lot_id, component_lot_id, quantity_used) VALUES (v_id, (c->>'lot_id')::uuid, (c->>'quantity')::numeric);
    END LOOP;
    FOR r IN SELECT * FROM mixture_concentrations(p_components, p_quantity, p_unit, COALESCE(v_form, 'Liquid'), '{}') LOOP
        INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, calculated, calc_note)
        VALUES (v_id, r.analyte_id, r.concentration, r.concentration_unit, true, r.calc_note) ON CONFLICT (lot_id, analyte_id) DO NOTHING;
    END LOOP;
    RETURN v_id;
END $$;

-- Existing mixtures get their calculated concentrations
ALTER TABLE lot_analyte DISABLE TRIGGER a0_rules;
INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, calculated, calc_note)
SELECT m.id, r.analyte_id, r.concentration, r.concentration_unit, true, r.calc_note
  FROM inventory_lot m,
       LATERAL mixture_concentrations((SELECT jsonb_agg(jsonb_build_object('lot_id', lc.component_lot_id, 'quantity', lc.quantity_used)) FROM lot_component lc WHERE lc.lot_id = m.id),
                                      m.quantity_received, m.unit, COALESCE(m.physical_form, 'Liquid'), '{}') r
 WHERE lot_is_mixture(m.chemical_types) AND EXISTS (SELECT 1 FROM lot_component lc WHERE lc.lot_id = m.id)
ON CONFLICT (lot_id, analyte_id) DO NOTHING;
ALTER TABLE lot_analyte ENABLE TRIGGER a0_rules;

-- Reorder and transfer copy the item's identity, form and analytes
CREATE OR REPLACE FUNCTION reorder_lot(p_lot uuid, p_quantity numeric, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; v_id uuid;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF lot_is_mixture(l.chemical_types) THEN RAISE EXCEPTION 'An in-house mixture is prepared, not ordered; reorder its components'; END IF;
    INSERT INTO inventory_lot (site_id, chemical_id, item_name, cas_number, physical_form, item_description, chemical_types, supplier_id, manufacturer_id, catalog_number,
                               receipt_status, requested_quantity, unit, concentration, concentration_unit, storage_condition, storage_location_id, reorder_of_lot_id, notes)
    VALUES (l.site_id, l.chemical_id, l.item_name, l.cas_number, l.physical_form, l.item_description, l.chemical_types, l.supplier_id, l.manufacturer_id, l.catalog_number,
            'Requested', COALESCE(p_quantity, l.quantity_received), l.unit, l.concentration, l.concentration_unit, l.storage_condition, l.storage_location_id, l.id, p_notes)
    RETURNING id INTO v_id;
    INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
    SELECT v_id, analyte_id, concentration, concentration_unit FROM lot_analyte WHERE lot_id = p_lot AND status = 'Active'
    ON CONFLICT (lot_id, analyte_id) DO NOTHING;
    RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION transfer_lot(p_lot uuid, p_to_site uuid, p_quantity numeric, p_notes text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; v_id uuid;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Enter the quantity to transfer'; END IF;
    INSERT INTO inventory_lot (site_id, chemical_id, item_name, cas_number, physical_form, item_description, chemical_types, supplier_id, manufacturer_id, catalog_number,
                               manufacturer_lot, receipt_status, requested_quantity, quantity_received, unit, concentration, concentration_unit,
                               purity_pct, expiration_date, retest_date, storage_condition, transferred_from_lot_id, notes)
    VALUES (p_to_site, l.chemical_id, l.item_name, l.cas_number, l.physical_form, l.item_description, l.chemical_types, l.supplier_id, l.manufacturer_id, l.catalog_number,
            l.manufacturer_lot, 'In Transit', p_quantity, p_quantity, l.unit, l.concentration, l.concentration_unit,
            l.purity_pct, l.expiration_date, l.retest_date, l.storage_condition, l.id, p_notes)
    RETURNING id INTO v_id;
    INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note)
    SELECT v_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note
      FROM lot_analyte WHERE lot_id = p_lot AND status = 'Active'
    ON CONFLICT (lot_id, analyte_id) DO NOTHING;
    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, related_lot_id, reference, notes)
    VALUES (p_lot, 'Transfer Out', p_quantity, v_id, 'Transfer to ' || (SELECT site_code FROM lab_site WHERE id = p_to_site), p_notes);
    INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at)
    SELECT v_id, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at
      FROM supplier_coa WHERE lot_id = p_lot AND status = 'Active';
    RETURN v_id;
END $$;

-------------------------------------------------------------------------------
-- 5. WARNING RULES APPLIED TO ONE LOT (Conforms / Alert / Deficient), as shown on the lot page
-------------------------------------------------------------------------------
CREATE FUNCTION lot_rule_results(p_lot uuid) RETURNS TABLE (rule_name text, detail text, result text) LANGUAGE plpgsql STABLE AS $$
DECLARE l inventory_lot; oh numeric; t date; r threshold_rule; a record; d int;
BEGIN
    SELECT * INTO l FROM inventory_lot WHERE id = p_lot;
    oh := lot_on_hand(p_lot); t := site_today(l.site_id);
    FOR r IN SELECT * FROM threshold_rule x WHERE x.status = 'Active' AND (x.site_id IS NULL OR x.site_id = l.site_id)
               AND x.subject IN ('Lot Quantity','Lot Expiry') AND (x.chemical_id IS NULL OR x.chemical_id = l.chemical_id) ORDER BY x.subject DESC, x.rule_name LOOP
        rule_name := r.rule_name;
        IF r.subject = 'Lot Quantity' THEN
            detail := 'Quantity on hand: ' || r.rule_type || CASE WHEN r.rule_type = 'Percentage of Base' THEN ', alert below ' || fmt_num(r.value) || '% of the amount received'
                       ELSE ', alert below ' || fmt_num(r.value) || ' ' || COALESCE(l.unit, '') END || '; deficient at 0 or below';
            result := CASE WHEN l.receipt_status <> 'Received' THEN 'Not received'
                           WHEN oh <= 0 THEN 'Deficient'
                           WHEN r.rule_type = 'Percentage of Base' AND l.quantity_received > 0 AND oh < l.quantity_received * r.value / 100 THEN 'Alert'
                           WHEN r.rule_type = 'Absolute Max-Min' AND oh < r.value THEN 'Alert'
                           ELSE 'Conforms' END;
        ELSE
            detail := 'Expiration: Days Until/Since, alert ' || round(r.value)::int || ' days before; deficient once expired';
            d := l.expiration_date - t;
            result := CASE WHEN l.expiration_date IS NULL THEN 'No expiry date' WHEN d < 0 THEN 'Deficient' WHEN d <= r.value THEN 'Alert' ELSE 'Conforms' END;
        END IF;
        RETURN NEXT;
    END LOOP;
    FOR a IN SELECT la.*, an.analyte_name FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id
              WHERE la.lot_id = p_lot AND la.status = 'Active' AND la.target_concentration IS NOT NULL LOOP
        rule_name := 'Prepared concentration: ' || a.analyte_name;
        detail := 'Target ± Tolerance %: ' || fmt_num(a.target_concentration) || ' ' || a.concentration_unit || ' ± ' || fmt_num(COALESCE(a.tolerance_pct, 0)) || '%';
        result := CASE WHEN a.concentration IS NULL THEN 'Not calculated'
                       WHEN abs(a.concentration - a.target_concentration) <= a.target_concentration * COALESCE(a.tolerance_pct, 0) / 100 THEN 'Conforms'
                       ELSE 'Alert' END;
        RETURN NEXT;
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 6. VIEW (recreated: own name and CAS, analytes, form, % remaining, who prepared and last changed)
-------------------------------------------------------------------------------
DROP VIEW inventory_lot_view;
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
            AND below_threshold('Lot Quantity', x.site_id, x.chemical_id, x.on_hand, x.quantity_received)) AS low_stock,
       CASE WHEN x.receipt_status = 'Received' AND x.quantity_received > 0 THEN round(100 * x.on_hand / x.quantity_received, 1) END AS pct_remaining
FROM (
    SELECT l.*, ls.site_code, COALESCE(l.item_name, ch.chemical_name, l.item_description) AS material, ch.chemical_code,
           COALESCE(l.cas_number, ch.cas_number,
                    (SELECT min(an.cas_number) FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id WHERE la.lot_id = l.id AND la.status = 'Active'
                      HAVING count(*) = 1)) AS cas_display,
           sp.supplier_name, mf.supplier_name AS manufacturer_name, sl.location_code, sl.location_name, location_path(l.storage_location_id) AS location_path,
           lot_on_hand(l.id) AS on_hand, (l.expiration_date - site_today(l.site_id)) AS days_to_expiry, site_today(l.site_id) AS today,
           tf.lot_code AS transferred_from_code, tfs.site_code AS transferred_from_site, ro.lot_code AS reorder_of_code,
           ap.full_name AS approved_by_name, cr.full_name AS created_by_name, md.full_name AS modified_by_name,
           EXISTS (SELECT 1 FROM supplier_coa c WHERE c.lot_id = l.id AND c.status = 'Active') AS coa_on_file,
           (SELECT count(*) FROM lot_component lc WHERE lc.lot_id = l.id) AS component_count,
           array_to_string(l.chemical_types, ', ') AS chemical_types_text,
           (SELECT count(*) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active') AS analyte_count,
           (SELECT string_agg(an.analyte_name || COALESCE(' ' || fmt_num(la.concentration) || ' ' || la.concentration_unit, ''), '; ' ORDER BY an.analyte_name)
              FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id WHERE la.lot_id = l.id AND la.status = 'Active') AS analytes_text,
           CASE WHEN l.concentration IS NOT NULL THEN fmt_num(l.concentration) || ' ' || COALESCE(l.concentration_unit, '')
                ELSE (SELECT CASE WHEN count(*) = 1 THEN max(fmt_num(la.concentration) || ' ' || la.concentration_unit)
                                  WHEN count(*) > 1 THEN count(*) || ' analytes' END
                        FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active' AND la.concentration IS NOT NULL) END AS conc_display,
           CASE WHEN lot_is_mixture(l.chemical_types) THEN l.received_date END AS date_made
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
      LEFT JOIN app_user cr ON cr.id = l.created_by
      LEFT JOIN app_user md ON md.id = l.modified_by
) x;

-------------------------------------------------------------------------------
-- 7. AUDIT TRAIL REFERENCES for the new records; storage locations now have their own page
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice3;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE lbl text; lnk text;
BEGIN
    CASE p_table
    WHEN 'unit_of_measure' THEN lbl := 'Unit ' || (r->>'unit_code'); lnk := '#/admin/units?find=' || (r->>'unit_code');
    WHEN 'unit_conversion' THEN
        SELECT 'Conversion ' || f.unit_code || ' to ' || t.unit_code INTO lbl FROM unit_of_measure f, unit_of_measure t
         WHERE f.id = (r->>'from_unit_id')::uuid AND t.id = (r->>'to_unit_id')::uuid;
        lnk := '#/admin/conversions';
    WHEN 'lot_analyte' THEN
        SELECT 'Lot ' || l.lot_code || ' analyte ' || a.analyte_name, '#/inventory/lots/' || l.id INTO lbl, lnk
          FROM inventory_lot l, analyte a WHERE l.id = (r->>'lot_id')::uuid AND a.id = (r->>'analyte_id')::uuid;
    WHEN 'storage_location' THEN lbl := 'Location ' || (r->>'location_code') || ' ' || (r->>'location_name'); lnk := '#/inventory/locations/' || p_id;
    WHEN 'chemical' THEN lbl := 'Chemical list (retired) ' || (r->>'chemical_code') || ' ' || (r->>'chemical_name'); lnk := NULL;
    ELSE RETURN audit_record_ref_slice3(p_table, p_id, r);
    END CASE;
    RETURN jsonb_build_object('label', COALESCE(lbl, replace(p_table, '_', ' ')), 'link', lnk);
END $$;

COMMIT;
