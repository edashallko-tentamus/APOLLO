-- LIMS3 schema, migration 007 (slice 3.2, 2026-10-12): login, electronic signatures, canned reasons,
-- molar mass, and units on mixture components.
-- * Login: each user has a password (stored only as a salted scrypt hash, made by the server), failed attempts and
--   lockout; every login, failure, lockout and password change is written to an append-only auth_event log.
-- * Electronic signatures (21 CFR Part 11): a signature_event (who, printed name, meaning, what, reason, when, how)
--   is written in the same transaction as the change it signs; every audit entry of that change points to it.
--   In the Inventory module every create and change needs a signature, except recording routine usage.
-- * Canned reasons per module for the Reason for Change box (maintained by QA and administrators).
-- * Molar mass on Analytes (QA, Lab Supervisors and administrators, signed, with its source); an analyte line can be
--   "expressed as" a compound (formula weight, analyte per formula unit). Mixtures then calculate M, mM and µM.
-- * Mixture components can be entered in any unit that converts to the lot's unit; stock is drawn in the lot's unit.

BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. LOGIN
-------------------------------------------------------------------------------
ALTER TABLE app_user ADD COLUMN password_hash text;
ALTER TABLE app_user ADD COLUMN password_changed_at timestamptz;
ALTER TABLE app_user ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN failed_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE app_user ADD COLUMN locked_at timestamptz;
ALTER TABLE app_user ADD COLUMN last_login_at timestamptz;

CREATE TABLE auth_event (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     uuid REFERENCES app_user(id),
    username    text,
    event       text NOT NULL CHECK (event IN ('Logged in','Login failed','Account locked','Logged out','Session timed out',
                    'Password set','Password changed','Temporary password set','Account unlocked','User created','Signature failed')),
    detail      text,
    by_user     uuid REFERENCES app_user(id),
    at          timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER auth_event_no_change BEFORE UPDATE OR DELETE ON auth_event FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER auth_event_no_truncate BEFORE TRUNCATE ON auth_event FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

-------------------------------------------------------------------------------
-- 2. ELECTRONIC SIGNATURES
-------------------------------------------------------------------------------
CREATE TABLE signature_event (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES app_user(id),
    full_name   text NOT NULL,             -- printed name at the time of signing
    meaning     text NOT NULL,             -- e.g. Created by, Changed by, Approved by, Prepared by, Uploaded by
    action      text NOT NULL,             -- what was signed, in words
    module      text,
    reason      text,                      -- the Reason for Change, when the signature is for a change
    method      text NOT NULL CHECK (method IN ('User ID and password','Data load script')),
    signed_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX signature_event_user_idx ON signature_event (user_id, signed_at);
CREATE FUNCTION signature_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Signatures are permanent and cannot be changed or deleted'; END IF;
    NEW.user_id := current_app_user();     -- nobody can sign for someone else
    NEW.full_name := (SELECT full_name FROM app_user WHERE id = NEW.user_id);
    NEW.signed_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER a_rules BEFORE INSERT OR UPDATE OR DELETE ON signature_event FOR EACH ROW EXECUTE FUNCTION signature_event_rules();
CREATE TRIGGER a_no_truncate BEFORE TRUNCATE ON signature_event FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

-- Called by the server after it has checked the user ID and password: records the signature and binds it to this transaction
CREATE FUNCTION sign_action(p_meaning text, p_action text, p_module text, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    INSERT INTO signature_event (user_id, full_name, meaning, action, module, reason, method)
    VALUES (current_app_user(), '', p_meaning, p_action, p_module, NULLIF(btrim(p_reason), ''), 'User ID and password') RETURNING id INTO v;
    PERFORM set_config('lims.signature_id', v::text, true);
    RETURN v;
END $$;
-- For data load scripts (Sandbox demo data, rule tests); recorded as such, never used by the screens
CREATE FUNCTION script_signature(p_meaning text, p_local boolean DEFAULT true) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    INSERT INTO signature_event (user_id, full_name, meaning, action, module, method)
    VALUES (current_app_user(), '', p_meaning, p_meaning, 'Script', 'Data load script') RETURNING id INTO v;
    PERFORM set_config('lims.signature_id', v::text, p_local);
    RETURN v;
END $$;

-- The change being made must carry a signature by the person making it (made for this action)
CREATE FUNCTION assert_signed(p_what text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s signature_event; v text := NULLIF(current_setting('lims.signature_id', true), '');
BEGIN
    IF v IS NOT NULL THEN SELECT * INTO s FROM signature_event WHERE id = v::uuid; END IF;
    IF s.id IS NULL OR s.user_id <> current_app_user() OR s.signed_at < clock_timestamp() - interval '30 minutes' THEN
        RAISE EXCEPTION 'An electronic signature (your user ID and password) is required to %', p_what;
    END IF;
END $$;

-- Every audit entry records the signature that authorised it (if any)
ALTER TABLE audit_log ADD COLUMN signature_id uuid REFERENCES signature_event(id);
CREATE OR REPLACE FUNCTION gxp_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
    n jsonb := to_jsonb(NEW);
    diff jsonb;
BEGIN
    SELECT COALESCE(jsonb_object_agg(k, jsonb_build_object('old', o->k, 'new', n->k)), '{}'::jsonb)
      INTO diff
      FROM jsonb_object_keys(n) AS k
     WHERE (o->k) IS DISTINCT FROM (n->k)
       AND k NOT IN ('record_version','modified_at','modified_by','created_at','created_by');
    INSERT INTO audit_log (table_name, record_id, action, record_version, changed_by, reason, changed_fields, new_row, signature_id)
    VALUES (TG_TABLE_NAME, NEW.id,
            CASE TG_OP WHEN 'INSERT' THEN 'CREATE' ELSE 'UPDATE' END,
            NEW.record_version, current_app_user(), current_reason(), diff, n,
            NULLIF(current_setting('lims.signature_id', true), '')::uuid);
    RETURN NULL;
END $$;

-- Inventory module: every create and change is signed, except routine usage
CREATE FUNCTION require_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'inventory_transaction' THEN
        IF to_jsonb(NEW)->>'txn_type' = 'Usage' THEN RETURN NEW; END IF; -- routine usage: attributed and audited, not signed
    END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'create ' ELSE 'change ' END || replace(replace(TG_TABLE_NAME, 'inventory_lot', 'an inventory item'), '_', ' '));
    RETURN NEW;
END $$;
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON inventory_lot FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON lot_analyte FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON lot_component FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON inventory_transaction FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON supplier_coa FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON supplier FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON storage_location FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON threshold_rule FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON unit_of_measure FOR EACH ROW EXECUTE FUNCTION require_signature();
CREATE TRIGGER a00_signature BEFORE INSERT OR UPDATE ON unit_conversion FOR EACH ROW EXECUTE FUNCTION require_signature();
-- Sample storage (an Inventory tab): changing where a sample is kept or how much is retained is signed
CREATE FUNCTION sample_storage_signature() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.storage_location_id, NEW.storage_condition, NEW.retained_quantity, NEW.retained_unit)
       IS DISTINCT FROM (OLD.storage_location_id, OLD.storage_condition, OLD.retained_quantity, OLD.retained_unit) THEN
        PERFORM assert_signed('change where a sample is stored or how much is retained');
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_storage_signature BEFORE UPDATE OF storage_location_id, storage_condition, retained_quantity, retained_unit ON sample
    FOR EACH ROW EXECUTE FUNCTION sample_storage_signature();

-------------------------------------------------------------------------------
-- 3. CANNED REASONS PER MODULE (QA and administrators)
-------------------------------------------------------------------------------
CREATE TABLE reason_code (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    module          text NOT NULL CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Admin')),
    reason_text     text NOT NULL CHECK (btrim(reason_text) <> ''),
    sort_order      integer NOT NULL DEFAULT 100,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX reason_code_uq ON reason_code (module, lower(reason_text));
CALL make_gxp('reason_code');
CREATE FUNCTION require_qa_or_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT user_has_role('{QA}') THEN RAISE EXCEPTION 'Only QA and administrators can change the canned reasons'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_maintainer BEFORE INSERT OR UPDATE ON reason_code FOR EACH ROW EXECUTE FUNCTION require_qa_or_admin();

-------------------------------------------------------------------------------
-- 4. MOLAR MASS (Analytes) AND "EXPRESSED AS" (an item's analyte line)
-------------------------------------------------------------------------------
ALTER TABLE analyte ADD COLUMN molar_mass numeric(14,6) CHECK (molar_mass > 0);   -- g/mol
ALTER TABLE analyte ADD COLUMN molar_mass_source text;
CREATE FUNCTION analyte_molar_mass_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.molar_mass IS NULL AND NEW.molar_mass_source IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.molar_mass, NEW.molar_mass_source) IS NOT DISTINCT FROM (OLD.molar_mass, OLD.molar_mass_source) THEN RETURN NEW; END IF;
    IF NOT user_has_role('{QA,Lab Supervisor}') THEN
        RAISE EXCEPTION 'Only QA, Lab Supervisors and administrators can change a molar mass';
    END IF;
    IF NEW.molar_mass IS NOT NULL AND COALESCE(btrim(NEW.molar_mass_source), '') = '' THEN
        RAISE EXCEPTION 'Give the source of the molar mass (for example "IUPAC standard atomic weights 2021")';
    END IF;
    PERFORM assert_signed('change a molar mass');
    RETURN NEW;
END $$;
CREATE TRIGGER a_molar_mass BEFORE INSERT OR UPDATE OF molar_mass, molar_mass_source ON analyte FOR EACH ROW EXECUTE FUNCTION analyte_molar_mass_rules();

ALTER TABLE lot_analyte ADD COLUMN expressed_as text;                                        -- the compound the concentration is stated for
ALTER TABLE lot_analyte ADD COLUMN formula_weight numeric(14,6) CHECK (formula_weight > 0);  -- g/mol of that compound
ALTER TABLE lot_analyte ADD COLUMN analyte_per_unit numeric(10,4) CHECK (analyte_per_unit > 0); -- e.g. 1 Na per NaCl, 2 Cl per CaCl2

-------------------------------------------------------------------------------
-- 5. MIXTURE COMPONENTS IN ANY UNIT THAT CONVERTS TO THE LOT'S UNIT; MOLAR CONCENTRATIONS
-------------------------------------------------------------------------------
ALTER TABLE lot_component ADD COLUMN entered_quantity numeric(14,6);
ALTER TABLE lot_component ADD COLUMN entered_unit text;

-- [{"lot_id", "quantity", "unit"}] -> the same with quantity in the lot's own unit (entered_quantity / entered_unit kept)
CREATE FUNCTION mixture_components_in_lot_units(p_components jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb; l inventory_lot; f numeric; u text; out jsonb := '[]';
BEGIN
    FOR c IN SELECT * FROM jsonb_array_elements(COALESCE(p_components, '[]')) LOOP
        SELECT * INTO l FROM inventory_lot WHERE id = (c->>'lot_id')::uuid;
        u := NULLIF(btrim(c->>'unit'), '');
        IF u IS NULL OR l.unit IS NULL OR lower(u) = lower(l.unit) THEN f := 1; u := COALESCE(l.unit, u);
        ELSE
            f := unit_factor(u, l.unit, l.physical_form);
            IF f IS NULL THEN RAISE EXCEPTION 'Lot %: % cannot be converted to % (the unit it is kept in)', l.lot_code, u, l.unit; END IF;
        END IF;
        out := out || jsonb_build_object('lot_id', l.id, 'quantity', (c->>'quantity')::numeric * f,
                                         'entered_quantity', (c->>'quantity')::numeric, 'entered_unit', u);
    END LOOP;
    RETURN out;
END $$;

CREATE OR REPLACE FUNCTION mixture_default_quantity(p_components jsonb, p_unit text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT sum((x->>'quantity')::numeric * unit_factor(l.unit, p_unit, l.physical_form))
      FROM jsonb_array_elements(mixture_components_in_lot_units(p_components)) x JOIN inventory_lot l ON l.id = (x->>'lot_id')::uuid
     WHERE (x->>'quantity') IS NOT NULL AND unit_factor(l.unit, p_unit, l.physical_form) IS NOT NULL
$$;

-- As in migration 006, plus: components in any convertible unit; molar concentrations (M, mM, µM, nM) use the analyte's
-- molar mass; a line "expressed as" a compound converts with the compound's formula weight and analyte per formula unit.
CREATE OR REPLACE FUNCTION mixture_concentrations(p_components jsonb, p_quantity numeric, p_unit text, p_form text, p_out_units jsonb DEFAULT '{}')
RETURNS TABLE (analyte_id uuid, analyte_name text, concentration numeric, concentration_unit text, calc_note text) LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb; cl inventory_lot; a record; acc jsonb := '{}'; k text; e jsonb; f numeric; q numeric; m numeric; why text;
        v_total numeric; v_base text; v_out text; v_note text; v_val numeric; comps jsonb; fm numeric; per numeric;
BEGIN
    comps := mixture_components_in_lot_units(p_components);
    v_base := CASE WHEN p_form = 'Solid' THEN 'mg/kg' ELSE 'mg/L' END;
    v_total := p_quantity * unit_factor(p_unit, CASE WHEN p_form = 'Solid' THEN 'kg' ELSE 'L' END, p_form);
    FOR c IN SELECT * FROM jsonb_array_elements(comps) LOOP
        SELECT * INTO cl FROM inventory_lot WHERE id = (c->>'lot_id')::uuid;
        q := (c->>'quantity')::numeric;
        FOR a IN SELECT la.analyte_id AS aid, an.analyte_name AS aname, an.molar_mass, la.concentration AS conc, la.concentration_unit AS cu,
                        la.expressed_as, la.formula_weight, la.analyte_per_unit, uom.dimension
                   FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id LEFT JOIN unit_of_measure uom ON uom.unit_code = la.concentration_unit
                  WHERE la.lot_id = cl.id AND la.status = 'Active' LOOP
            k := a.aid::text;
            e := COALESCE(acc->k, jsonb_build_object('name', a.aname, 'mg', 0, 'unit', a.cu, 'bad', '[]'::jsonb, 'from', '[]'::jsonb));
            m := NULL; why := NULL; per := COALESCE(a.analyte_per_unit, 1);
            IF a.conc IS NULL THEN
                why := cl.lot_code || ' has no ' || a.aname || ' concentration';
            ELSIF a.dimension = 'Amount/Volume' THEN          -- molar: mol/L x analyte molar mass
                fm := unit_factor(a.cu, 'M', 'Liquid');
                IF fm IS NULL THEN why := cl.lot_code || ': ' || a.cu || ' cannot be converted to an amount (normality depends on the reaction)';
                ELSIF a.molar_mass IS NULL THEN why := a.aname || ' has no molar mass on the Analytes list';
                ELSIF unit_factor(cl.unit, 'L', 'Liquid') IS NULL THEN why := cl.lot_code || ': ' || cl.unit || ' is not a volume';
                ELSE m := a.conc * fm * per * a.molar_mass * 1000 * q * unit_factor(cl.unit, 'L', 'Liquid'); END IF;
            ELSIF COALESCE(cl.physical_form, 'Liquid') = 'Liquid' THEN
                f := unit_factor(a.cu, 'mg/L', 'Liquid');
                IF f IS NULL OR unit_factor(cl.unit, 'L', 'Liquid') IS NULL THEN
                    why := cl.lot_code || ': cannot convert ' || a.cu || ' x ' || COALESCE(cl.unit, '?') || ' to an amount';
                ELSIF a.expressed_as IS NOT NULL AND (a.formula_weight IS NULL OR a.molar_mass IS NULL) THEN
                    why := cl.lot_code || ': ' || a.aname || ' is expressed as ' || a.expressed_as || ' but the formula weight or the molar mass of ' || a.aname || ' is missing';
                ELSE m := a.conc * f * q * unit_factor(cl.unit, 'L', 'Liquid')
                          * CASE WHEN a.expressed_as IS NOT NULL THEN per * a.molar_mass / a.formula_weight ELSE 1 END; END IF;
            ELSE
                f := unit_factor(a.cu, 'mg/kg', 'Solid');
                IF f IS NULL OR unit_factor(cl.unit, 'kg', 'Solid') IS NULL THEN
                    why := cl.lot_code || ': cannot convert ' || a.cu || ' x ' || COALESCE(cl.unit, '?') || ' to an amount';
                ELSIF a.expressed_as IS NOT NULL AND (a.formula_weight IS NULL OR a.molar_mass IS NULL) THEN
                    why := cl.lot_code || ': ' || a.aname || ' is expressed as ' || a.expressed_as || ' but the formula weight or the molar mass of ' || a.aname || ' is missing';
                ELSE m := a.conc * f * q * unit_factor(cl.unit, 'kg', 'Solid')
                          * CASE WHEN a.expressed_as IS NOT NULL THEN per * a.molar_mass / a.formula_weight ELSE 1 END; END IF;
            END IF;
            IF why IS NOT NULL THEN e := jsonb_set(e, '{bad}', (e->'bad') || to_jsonb(why)); END IF;
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

-- As in migration 006; components may be entered in any convertible unit (stock is drawn in the lot's unit)
CREATE OR REPLACE FUNCTION prepare_mixture(p_site uuid, p_name text, p_types chemical_type[], p_form text, p_quantity numeric, p_unit text,
                                p_expiration date, p_condition storage_condition, p_location uuid, p_components jsonb, p_targets jsonb,
                                p_notes text DEFAULT NULL, p_retest date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_min date; c jsonb; r record; v_units jsonb := '{}'; t jsonb; comps jsonb;
BEGIN
    IF p_components IS NULL OR jsonb_array_length(p_components) = 0 THEN RAISE EXCEPTION 'A mixture needs at least one component lot'; END IF;
    IF p_form IS NULL THEN RAISE EXCEPTION 'Say whether the mixture is Solid or Liquid'; END IF;
    IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Enter the quantity made'; END IF;
    comps := mixture_components_in_lot_units(p_components);
    SELECT min(l.expiration_date) INTO v_min FROM inventory_lot l WHERE l.id IN (SELECT (x->>'lot_id')::uuid FROM jsonb_array_elements(comps) x);
    IF p_expiration IS NOT NULL AND v_min IS NOT NULL AND p_expiration > v_min THEN
        RAISE EXCEPTION 'This mixture must expire on or before % (its earliest-expiring component)', v_min;
    END IF;
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, physical_form, quantity_received, unit, expiration_date, retest_date,
                               storage_condition, storage_location_id, notes, received_date)
    VALUES (p_site, p_name, (SELECT array_agg(DISTINCT x) FROM unnest(p_types || '{In-house mixture}'::chemical_type[]) x), p_form, p_quantity, p_unit,
            COALESCE(p_expiration, v_min), p_retest, p_condition, p_location, p_notes, site_today(p_site))
    RETURNING id INTO v_id;
    FOR c IN SELECT * FROM jsonb_array_elements(comps) LOOP
        INSERT INTO lot_component (lot_id, component_lot_id, quantity_used, entered_quantity, entered_unit)
        VALUES (v_id, (c->>'lot_id')::uuid, (c->>'quantity')::numeric, (c->>'entered_quantity')::numeric, c->>'entered_unit');
    END LOOP;
    FOR t IN SELECT * FROM jsonb_array_elements(COALESCE(p_targets, '[]')) LOOP
        IF t->>'unit' IS NOT NULL THEN v_units := v_units || jsonb_build_object(t->>'analyte_id', t->>'unit'); END IF;
    END LOOP;
    FOR r IN SELECT * FROM mixture_concentrations(comps, p_quantity, p_unit, p_form, v_units) LOOP
        t := NULL;
        SELECT x INTO t FROM jsonb_array_elements(COALESCE(p_targets, '[]')) x WHERE x->>'analyte_id' = r.analyte_id::text;
        INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note)
        VALUES (v_id, r.analyte_id, r.concentration, r.concentration_unit, NULLIF(t->>'target', '')::numeric, NULLIF(t->>'tolerance_pct', '')::numeric, true, r.calc_note);
    END LOOP;
    RETURN v_id;
END $$;

-- Units that can be used in place of a given unit (they convert to it)
CREATE FUNCTION convertible_units(p_unit text, p_form text DEFAULT NULL) RETURNS SETOF text LANGUAGE sql STABLE AS $$
    SELECT u.unit_code FROM unit_of_measure u
     WHERE u.status = 'Active' AND (lower(u.unit_code) = lower(p_unit) OR unit_factor(u.unit_code, p_unit, p_form) IS NOT NULL)
     ORDER BY u.sort_order, u.unit_code
$$;

-------------------------------------------------------------------------------
-- 6. AUDIT REFERENCES for canned reasons
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice31;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'reason_code' THEN
        RETURN jsonb_build_object('label', 'Canned reason (' || (r->>'module') || '): ' || (r->>'reason_text'), 'link', '#/admin/reasons');
    END IF;
    RETURN audit_record_ref_slice31(p_table, p_id, r);
END $$;

COMMIT;
