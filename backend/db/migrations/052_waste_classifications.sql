-- 052: waste classifications (0.30.0; Alex, 2026-10-20): "Add a waste classification table to admin side and tie it
-- in to the inventory module for each item." Vault: Decision - Waste Classifications W-1.
--  - A controlled list (Admin > Lab setup > Waste classifications): hazard classes, EPA waste codes, the waste stream,
--    the container, how to dispose of it, what to keep it away from. Shared classifications (every lab) are kept by
--    system administrators; each lab adds its own (inventory.lists: Lab Supervisor, QA, General Manager).
--  - Every inventory item has one. A classification can be the default for item types (Media: biohazardous ...):
--    an item saved without one gets its lab's default for its type, else the shared default.
--  - A placeholder ("classify from the SDS") is marked Needs review, so the items still to classify can be listed.
--  - Disposing of an item records the classification it was disposed of under.
-- No new permission (inventory.lists keeps the lab's list, like suppliers, storage locations and warning rules).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 052: waste classifications', true);

CREATE FUNCTION waste_hazard_classes() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['Ignitable','Corrosive','Reactive','Toxic','Oxidizer','Peroxide former','Water-reactive','Heavy metal','Halogenated',
                 'Biohazardous','Sharps','Pharmaceutical','Universal waste','Non-hazardous']
$$;

CREATE SEQUENCE waste_classification_seq;
CREATE TABLE waste_classification (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    waste_code            text NOT NULL UNIQUE DEFAULT 'WC-' || lpad(nextval('waste_classification_seq')::text, 3, '0'),
    site_id               uuid REFERENCES lab_site(id),          -- NULL: every lab
    waste_name            text NOT NULL CHECK (btrim(waste_name) <> ''),
    hazard_classes        text[] NOT NULL DEFAULT '{}',
    epa_codes             text,                                   -- e.g. D001, F003 (RCRA); state codes as the lab uses them
    waste_stream          text,                                   -- the accumulation container's stream, e.g. "Non-halogenated solvents"
    container             text,                                   -- e.g. "5 gal HDPE carboy, red label"
    disposal_instructions text,
    segregation           text,                                   -- what it must be kept away from
    default_for           chemical_type[] NOT NULL DEFAULT '{}',  -- item types that get it when none is chosen
    needs_review          boolean NOT NULL DEFAULT false,         -- a placeholder: classify the item from its SDS
    sort_order            integer NOT NULL DEFAULT 0,
    status                record_status NOT NULL DEFAULT 'Active',
    record_version        integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at           timestamptz NOT NULL DEFAULT now(),
    modified_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX waste_classification_name ON waste_classification (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(waste_name)) WHERE status = 'Active';
CALL make_gxp('waste_classification');

CREATE FUNCTION waste_classification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad text; t chemical_type; other text;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A waste classification stays with its lab'; END IF;
    IF NOT in_group_sync() THEN
        IF NEW.site_id IS NULL THEN
            IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Waste classifications for every lab are kept by a system administrator; add one for your lab instead'; END IF;
        ELSE
            PERFORM require_permission_at('inventory.lists', NEW.site_id);
        END IF;
    END IF;
    NEW.hazard_classes := ARRAY(SELECT DISTINCT btrim(x) FROM unnest(NEW.hazard_classes) x WHERE btrim(x) <> '' ORDER BY 1);
    SELECT string_agg(x, ', ') INTO bad FROM unnest(NEW.hazard_classes) x WHERE NOT x = ANY(waste_hazard_classes());
    IF bad IS NOT NULL THEN RAISE EXCEPTION 'Unknown hazard class: % (use: %)', bad, array_to_string(waste_hazard_classes(), ', '); END IF;
    IF 'Non-hazardous' = ANY(NEW.hazard_classes) AND cardinality(NEW.hazard_classes) > 1 THEN
        RAISE EXCEPTION 'A waste is Non-hazardous or has hazard classes, not both';
    END IF;
    IF cardinality(NEW.hazard_classes) = 0 AND NOT NEW.needs_review THEN
        RAISE EXCEPTION 'Give the hazard classes of %, Non-hazardous, or mark it Needs review', NEW.waste_name;
    END IF;
    NEW.default_for := ARRAY(SELECT DISTINCT x FROM unnest(NEW.default_for) x ORDER BY 1);
    IF NEW.status = 'Active' THEN
        FOREACH t IN ARRAY NEW.default_for LOOP
            SELECT waste_name INTO other FROM waste_classification w
             WHERE w.status = 'Active' AND w.id <> NEW.id AND w.site_id IS NOT DISTINCT FROM NEW.site_id AND t = ANY(w.default_for) LIMIT 1;
            IF other IS NOT NULL THEN RAISE EXCEPTION '% is already the default for % (one default per item type)', other, t; END IF;
        END LOOP;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON waste_classification FOR EACH ROW EXECUTE FUNCTION waste_classification_rules();

-- The default for an item: the lab's own default for one of its types, else the shared one (the first type that has one)
CREATE FUNCTION waste_default_for(p_site uuid, p_types chemical_type[]) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT w.id FROM waste_classification w, unnest(p_types) WITH ORDINALITY t(ty, n)
     WHERE w.status = 'Active' AND (w.site_id = p_site OR w.site_id IS NULL) AND t.ty = ANY(w.default_for)
     ORDER BY (w.site_id IS NULL), t.n, w.sort_order LIMIT 1
$$;

-- Starter list for every lab (kept by system administrators; each lab adds and changes its own). Hazard classes and
-- codes are the usual US ones (RCRA); the lab's EHS contact confirms them.
INSERT INTO waste_classification (waste_name, hazard_classes, epa_codes, waste_stream, container, disposal_instructions, segregation, default_for, needs_review, sort_order) VALUES
 ('Laboratory chemical: classify from the SDS', '{}', NULL, NULL, NULL,
  'Not classified yet: read the Safety Data Sheet (section 13) and choose the classification that fits before the item is used up or discarded.', NULL,
  '{Reagent,"Reference Standard","In-house mixture"}', true, 1),
 ('Non-halogenated flammable solvents', '{Ignitable}', 'D001; F003, F005 when spent', 'Non-halogenated solvents', 'Safety can or HDPE carboy, flammable label',
  'Collect in the solvent waste container in the fume hood; keep closed; hazardous waste pickup.', 'Keep away from oxidizers and acids; never with halogenated solvents.', '{Solvent}', false, 2),
 ('Halogenated solvents', '{Halogenated,Toxic}', 'F001, F002', 'Halogenated solvents', 'Glass or HDPE bottle, halogenated waste label',
  'Collect separately from other solvents; hazardous waste pickup.', 'Keep away from non-halogenated solvents, bases and reactive metals.', '{}', false, 3),
 ('Corrosive acids', '{Corrosive}', 'D002', 'Acids', 'HDPE bottle, acid waste label',
  'Collect in the acid waste container; never pour down the drain unless the lab''s neutralization procedure allows it.', 'Keep away from bases, cyanides, sulfides and solvents.', '{}', false, 4),
 ('Corrosive bases', '{Corrosive}', 'D002', 'Bases', 'HDPE bottle, base waste label',
  'Collect in the base waste container; hazardous waste pickup.', 'Keep away from acids.', '{}', false, 5),
 ('Heavy metal solutions and standards', '{"Heavy metal",Toxic}', 'D004 to D011 as applicable', 'Heavy metals (aqueous)', 'HDPE bottle, heavy metal label',
  'Collect ICP-MS waste and metal standards together; hazardous waste pickup.', 'Keep away from cyanides and strong reducers.', '{}', false, 6),
 ('Oxidizers', '{Oxidizer}', 'D001', 'Oxidizers', 'Original container or glass, oxidizer label',
  'Keep in the original container; hazardous waste pickup.', 'Keep away from solvents, organics and reducing agents.', '{}', false, 7),
 ('Biohazardous: media, cultures and strains', '{Biohazardous}', NULL, 'Biohazardous (autoclave)', 'Autoclave bag in a rigid, labelled container',
  'Autoclave before disposal (validated cycle), then dispose of as regulated medical waste or as the lab''s permit allows.', 'Keep sharps in a sharps container.', '{Media,"Microbiological Strain"}', false, 8),
 ('Sharps', '{Sharps}', NULL, 'Sharps', 'Puncture-resistant sharps container',
  'Close the container at the fill line; regulated medical waste pickup.', NULL, '{}', false, 9),
 ('Pharmaceutical waste', '{Pharmaceutical}', 'As listed (P or U codes)', 'Pharmaceutical', 'Pharmaceutical waste container',
  'Do not sewer; pharmaceutical waste pickup.', NULL, '{}', false, 10),
 ('Universal waste: batteries and lamps', '{"Universal waste"}', NULL, 'Universal waste', 'Labelled universal waste box',
  'Tape battery terminals; universal waste recycler.', NULL, '{}', false, 11),
 ('Non-hazardous solid waste', '{Non-hazardous}', NULL, 'General trash', 'Lab trash',
  'Ordinary trash once free of chemical or biological contamination.', NULL, '{Consumable}', false, 12);

-------------------------------------------------------------------------------
-- EVERY INVENTORY ITEM HAS ONE
-------------------------------------------------------------------------------
ALTER TABLE inventory_lot ADD COLUMN waste_classification_id uuid REFERENCES waste_classification(id);
CREATE FUNCTION inventory_lot_waste_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE w waste_classification;
BEGIN
    IF NEW.waste_classification_id IS NOT NULL THEN
        SELECT * INTO w FROM waste_classification WHERE id = NEW.waste_classification_id;
        -- a transferred lot arrives with its sender's lab classification: the receiving lab's default instead
        IF TG_OP = 'INSERT' AND w.site_id IS NOT NULL AND w.site_id <> NEW.site_id THEN NEW.waste_classification_id := NULL; w := NULL;
        ELSIF (TG_OP = 'INSERT' OR OLD.waste_classification_id IS DISTINCT FROM NEW.waste_classification_id) THEN
            IF w.status <> 'Active' THEN RAISE EXCEPTION 'Waste classification % is retired', w.waste_name; END IF;
            IF w.site_id IS NOT NULL AND w.site_id <> NEW.site_id THEN RAISE EXCEPTION 'Waste classification % belongs to another lab', w.waste_name; END IF;
        END IF;
    END IF;
    IF NEW.waste_classification_id IS NULL AND (TG_OP = 'INSERT' OR OLD.waste_classification_id IS NOT NULL OR OLD.chemical_types IS DISTINCT FROM NEW.chemical_types) THEN
        NEW.waste_classification_id := waste_default_for(NEW.site_id, NEW.chemical_types);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a04_waste BEFORE INSERT OR UPDATE OF waste_classification_id, chemical_types, site_id ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_waste_rule();

-- Disposing of an item records what it was disposed of as
ALTER TABLE inventory_transaction ADD COLUMN waste_classification_id uuid REFERENCES waste_classification(id);
CREATE FUNCTION inventory_transaction_waste() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.txn_type::text = 'Disposal' AND NEW.waste_classification_id IS NULL THEN
        SELECT waste_classification_id INTO NEW.waste_classification_id FROM inventory_lot WHERE id = NEW.lot_id;
    END IF;
    IF NEW.txn_type::text <> 'Disposal' THEN NEW.waste_classification_id := NULL; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a04_waste BEFORE INSERT ON inventory_transaction FOR EACH ROW EXECUTE FUNCTION inventory_transaction_waste();

CREATE VIEW waste_classification_view AS
SELECT w.*, s.site_code,
       (SELECT count(*) FROM inventory_lot l WHERE l.waste_classification_id = w.id AND l.status::text NOT IN ('Disposed','Cancelled'))::int AS items_in_use,
       NOT ('Non-hazardous' = ANY(w.hazard_classes)) AND cardinality(w.hazard_classes) > 0 AS is_hazardous
  FROM waste_classification w LEFT JOIN lab_site s ON s.id = w.site_id;

-------------------------------------------------------------------------------
-- AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_052;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'waste_classification' THEN
        RETURN jsonb_build_object('label', 'Waste classification ' || COALESCE(r->>'waste_code', '') || ' ' || COALESCE(r->>'waste_name', ''), 'link', '#/admin/waste');
    END IF;
    RETURN audit_record_ref_052(p_table, p_id, r);
END $$;

COMMIT;
