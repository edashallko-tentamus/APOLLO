-- L-1 Electronic logbooks (Alex, 2026-10-14). Vault: Decision - Electronic Logbooks Are Computational, Decision -
-- Logbooks Wait for the Workflow Designer, Decision - Logbook Values Feed Results Through Scanned Materials, and
-- Decision - Electronic Logbooks L-1 and L-2 (Alex's answers of 2026-10-14):
--  - Logbooks for equipment checks (daily balance checks, pipette checks) and temperatures (refrigerators,
--    incubators, stability chambers), plus the micro logbooks for USP <51>, <61> and <62> (L-2, migration 035).
--  - "I think it should be flagged and a reason is prompted at failure. Flag happens at QC review steps with that
--    equipment." A failed check is not an automatic tag-out: the entry asks for the reason, and every batch step that
--    used that equipment while the check was failing is flagged in QC Review (the reviewer accepts it with a
--    justification, like an incubator load outside its target).
--  - Temperatures are typed in by hand (no probes yet).
--  - "QA should approve the logbooks weekly or daily just depends": each logbook says how often QA approves its
--    entries (Daily or Weekly); entries waiting longer than that are overdue in the QA queue.
-- How it is built:
--  - A logbook (LB-0001) belongs to a lab: what it is about (a piece of equipment, an inventory lot, a sample, or
--    nothing), how often entries are due, how often QA approves them, whether entries are signed (default) or only
--    recorded (Alex, 2026-10-13: signing can be switched off per logbook), and how long an entry stays valid.
--  - Its design (fields, limits, formulas) is versioned: a Draft is approved by QA (signed, not by its author); entries
--    always use the Effective version. Fields: Number, Text, Choice, Pass/Fail, Date/time, Equipment, Lot, Calculated
--    (the workflow designer's calculation engine; a Lot field's published values can be used: {culture_lot.passage}).
--  - Limits per field, or per piece of equipment (a stability chamber's limits come from its condition). An entry
--    outside a limit, or with a Pass/Fail field at Fail, fails: the reason is required.
--  - Entries (LBE-000001) are recorded in a grid, signed once for the rows saved. A correction needs a reason (and a
--    signature when the logbook signs); an approved entry that is corrected goes back to QA.
--  - QA approves entries (signed "Approved by", never their own) or returns one with a note.
--  - Equipment flags: a failed entry on a piece of equipment covers the time from the last passing entry before it
--    to the next passing entry after it; any batch step that used the equipment in that time (recorded equipment,
--    incubator loads) is flagged in QC Review and accepted by the reviewer with a justification before approval.
--  - Stability excursions: a failed entry on a stability chamber lists the studies whose material was in it.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 034: electronic logbooks', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('logbook.record', 'Logbooks', 'Entries', 'Record logbook entries (equipment checks, temperatures, cultures, inocula, controls, sample weights)', false, 100),
 ('logbook.design', 'Logbooks', 'Design', 'Design the lab''s logbooks: fields, limits, the equipment they cover, how often entries are due and reviewed', false, 101),
 ('logbook.review', 'Logbooks', 'QA review', 'Approve logbook designs, and approve or return logbook entries', false, 102);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{logbook.record}'), ('Lab Supervisor', '{logbook.record,logbook.design}'),
 ('Intake', '{logbook.record}'), ('QA', '{logbook.design,logbook.review}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-- canned reasons for the logbooks (Admin > Canned reasons)
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check
    CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Reports','COA comments','Logbooks','Admin'));

CREATE FUNCTION logbook_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.logbook_internal', true), '') = '1'
$$;
CREATE FUNCTION set_logbook_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.logbook_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;
-- A number without its trailing zeros (for messages)
CREATE FUNCTION lb_num(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL THEN '' WHEN p = trunc(p) THEN trunc(p)::text
                ELSE rtrim(rtrim(p::text, '0'), '.') END
$$;

-- A logbook formula names its own fields as {field} and a Lot field's published value as {lot_field.value}; the
-- calculation engine reads {step.field} tokens, so {field} is read as {this.field}
CREATE FUNCTION logbook_formula(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT regexp_replace(COALESCE(p, ''), '\{([a-z][a-z0-9_]*)\}', '{this.\1}', 'g')
$$;

-------------------------------------------------------------------------------
-- 1. LOGBOOKS, THEIR VERSIONED DESIGN, THE EQUIPMENT THEY COVER
-------------------------------------------------------------------------------
CREATE SEQUENCE logbook_seq;
CREATE TABLE logbook (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    logbook_code        text NOT NULL UNIQUE DEFAULT 'LB-' || lpad(nextval('logbook_seq')::text, 4, '0'),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    logbook_name        text NOT NULL CHECK (btrim(logbook_name) <> ''),
    kind                text NOT NULL DEFAULT 'General' CHECK (kind IN ('Equipment check','Temperature','Culture','Inoculum','Control','Sample weights','General')),
    subject             text NOT NULL DEFAULT 'None' CHECK (subject IN ('Equipment','Lot','Sample','None')),
    entry_frequency     text NOT NULL DEFAULT 'As needed' CHECK (entry_frequency IN ('Daily','Weekly','Monthly','As needed')),
    review_frequency    text NOT NULL DEFAULT 'Weekly' CHECK (review_frequency IN ('Daily','Weekly')),
    signing             text NOT NULL DEFAULT 'Signature' CHECK (signing IN ('Signature','Recorded')),
    review_route        text NOT NULL DEFAULT 'Logbook' CHECK (review_route IN ('Logbook','Batch')),
    validity_hours      numeric CHECK (validity_hours > 0),          -- an entry (and a lot it makes) can be used for this long
    creates_lot         boolean NOT NULL DEFAULT false,              -- each entry makes an inventory lot (e.g. an inoculum suspension)
    lot_name            text,                                        -- the name the lot gets (the culture's name is added)
    lot_unit            text NOT NULL DEFAULT 'mL',
    description         text,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX logbook_name_uq ON logbook (site_id, lower(btrim(logbook_name))) WHERE status = 'Active';
CALL make_gxp('logbook');

CREATE TABLE logbook_version (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    logbook_id          uuid NOT NULL REFERENCES logbook(id),
    version_no          integer NOT NULL,
    status              text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Effective','Superseded')),
    change_summary      text,
    approved_by         uuid REFERENCES app_user(id),
    approved_at         timestamptz,
    signature_id        uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (logbook_id, version_no)
);
CREATE UNIQUE INDEX logbook_version_one_draft ON logbook_version (logbook_id) WHERE status = 'Draft';
CREATE UNIQUE INDEX logbook_version_one_effective ON logbook_version (logbook_id) WHERE status = 'Effective';
CALL make_gxp('logbook_version', false);

CREATE TABLE logbook_field (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id          uuid NOT NULL REFERENCES logbook_version(id),
    field_key           text NOT NULL,
    label               text NOT NULL CHECK (btrim(label) <> ''),
    field_type          text NOT NULL DEFAULT 'Number' CHECK (field_type IN ('Number','Text','Choice','Pass/Fail','Date/time','Equipment','Lot','Calculated')),
    unit                text,
    limit_min           numeric,
    limit_max           numeric,
    equipment_limits    boolean NOT NULL DEFAULT false,              -- the limits are set per piece of equipment (a chamber: its condition)
    choices             text[],
    required            boolean NOT NULL DEFAULT true,
    formula             text,                                        -- Calculated: {other_field}, {lot_field.published_value}
    publish             boolean NOT NULL DEFAULT false,              -- a value of the lot: formulas at the bench can use it (L-2)
    help                text,
    sort_order          integer NOT NULL DEFAULT 10,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX logbook_field_key_uq ON logbook_field (version_id, field_key) WHERE status = 'Active';
CALL make_gxp('logbook_field', false);

CREATE TABLE logbook_equipment (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    logbook_id          uuid NOT NULL REFERENCES logbook(id),
    equipment_id        uuid NOT NULL REFERENCES equipment(id),
    limits              jsonb NOT NULL DEFAULT '{}',                 -- {"temperature": {"min": 2, "max": 8}}
    notes               text,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX logbook_equipment_uq ON logbook_equipment (logbook_id, equipment_id) WHERE status = 'Active';
CALL make_gxp('logbook_equipment');

-------------------------------------------------------------------------------
-- 2. ENTRIES AND QA REVIEWS
-------------------------------------------------------------------------------
CREATE TABLE logbook_review (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    logbook_id          uuid NOT NULL REFERENCES logbook(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    entry_count         integer NOT NULL,
    first_entry_at      timestamptz,
    last_entry_at       timestamptz,
    comment             text,
    signature_id        uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('logbook_review', false);

CREATE SEQUENCE logbook_entry_seq;
CREATE TABLE logbook_entry (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_code          text NOT NULL UNIQUE DEFAULT 'LBE-' || lpad(nextval('logbook_entry_seq')::text, 6, '0'),
    logbook_id          uuid NOT NULL REFERENCES logbook(id),
    version_id          uuid NOT NULL REFERENCES logbook_version(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    entry_at            timestamptz NOT NULL DEFAULT clock_timestamp(),   -- when it was observed (or made)
    equipment_id        uuid REFERENCES equipment(id),
    lot_id              uuid REFERENCES inventory_lot(id),
    sample_id           uuid REFERENCES sample(id),
    entry_values        jsonb NOT NULL DEFAULT '{}',                    -- field key -> value (calculated values included)
    result              text CHECK (result IN ('Pass','Fail')),         -- when the logbook has limits or Pass/Fail fields
    problems            text[] NOT NULL DEFAULT '{}',                   -- what was outside its limit
    failure_reason      text,                                           -- required when the entry fails
    valid_until         timestamptz,
    status              text NOT NULL DEFAULT 'Recorded' CHECK (status IN ('Recorded','Approved','Returned','Voided')),
    recorded_signature_id uuid REFERENCES signature_event(id),
    approved_by         uuid REFERENCES app_user(id),
    approved_at         timestamptz,
    review_id           uuid REFERENCES logbook_review(id),
    approved_in_batch_id uuid REFERENCES test_batch(id),               -- reviewed inside a batch (the Batch route, L-2)
    returned_note       text,
    void_reason         text,
    created_lot_id      uuid REFERENCES inventory_lot(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX logbook_entry_logbook_idx ON logbook_entry (logbook_id, entry_at);
CREATE INDEX logbook_entry_equipment_idx ON logbook_entry (equipment_id, entry_at) WHERE equipment_id IS NOT NULL;
CREATE INDEX logbook_entry_lot_idx ON logbook_entry (lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX logbook_entry_sample_idx ON logbook_entry (sample_id) WHERE sample_id IS NOT NULL;
CALL make_gxp('logbook_entry');

-------------------------------------------------------------------------------
-- 3. RULES ON THE DESIGN
-------------------------------------------------------------------------------
CREATE FUNCTION logbook_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.logbook_name := btrim(NEW.logbook_name);
    NEW.lot_name := NULLIF(btrim(NEW.lot_name), '');
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A logbook stays with its lab'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.logbook_code <> OLD.logbook_code THEN RAISE EXCEPTION 'The logbook ID is given by the system'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.subject <> OLD.subject AND EXISTS (SELECT 1 FROM logbook_entry WHERE logbook_id = NEW.id) THEN
        RAISE EXCEPTION 'The logbook has entries: what it is about (%) cannot change', OLD.subject;
    END IF;
    IF NEW.kind = 'Sample weights' AND (NEW.subject <> 'Sample' OR NEW.review_route <> 'Batch') THEN
        RAISE EXCEPTION 'A sample weights logbook is about samples, and its entries are reviewed in the batch that uses them';
    END IF;
    IF NEW.review_route = 'Batch' AND NEW.subject <> 'Sample' THEN
        RAISE EXCEPTION 'Only entries used once (a sample''s weighed aliquot) are reviewed in the batch; other logbooks are reviewed by QA in the logbook';
    END IF;
    IF NEW.creates_lot AND NEW.subject <> 'Lot' THEN RAISE EXCEPTION 'A logbook that makes lots is about lots (each entry makes one)'; END IF;
    IF NEW.creates_lot AND NEW.signing <> 'Signature' THEN RAISE EXCEPTION 'A logbook that makes inventory lots signs its entries (inventory changes are signed)'; END IF;
    IF NEW.creates_lot THEN NEW.lot_unit := canonical_unit(NEW.lot_unit, quantity_dims(), 'Unit of the lots it makes'); END IF;
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('logbook.design', NEW.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook FOR EACH ROW EXECUTE FUNCTION logbook_rules();
-- a new logbook starts with a Draft design (version 1)
CREATE FUNCTION logbook_first_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO logbook_version (logbook_id, version_no, change_summary) VALUES (NEW.id, 1, 'First version');
    RETURN NULL;
END $$;
CREATE TRIGGER z_first_version AFTER INSERT ON logbook FOR EACH ROW EXECUTE FUNCTION logbook_first_version();

CREATE FUNCTION logbook_version_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l logbook;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = NEW.logbook_id;
    IF TG_OP = 'UPDATE' AND (NEW.logbook_id <> OLD.logbook_id OR NEW.version_no <> OLD.version_no) THEN RAISE EXCEPTION 'A logbook version keeps its logbook and number'; END IF;
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.status <> 'Draft' THEN RAISE EXCEPTION 'A new logbook version starts as a Draft'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.status <> OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.approved_at IS DISTINCT FROM OLD.approved_at) THEN
        RAISE EXCEPTION 'A logbook version is approved with Approve (signed by QA)';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is %: start a new version to change the design', OLD.version_no, OLD.status; END IF;
    PERFORM require_permission_at('logbook.design', l.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_version FOR EACH ROW EXECUTE FUNCTION logbook_version_rules();

-- keys the bench formulas already use for a step's own values: a published value cannot take one of these names
CREATE FUNCTION logbook_reserved_keys() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT '{weight,factor,final_volume,duration,reading,result}'::text[]
$$;
CREATE FUNCTION logbook_field_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v logbook_version; l logbook;
BEGIN
    SELECT * INTO v FROM logbook_version WHERE id = NEW.version_id;
    SELECT * INTO l FROM logbook WHERE id = v.logbook_id;
    IF TG_OP = 'UPDATE' AND NEW.version_id <> OLD.version_id THEN RAISE EXCEPTION 'A field stays in its version'; END IF;
    NEW.label := btrim(NEW.label);
    NEW.field_key := COALESCE(NULLIF(btrim(NEW.field_key), ''), field_key(NEW.label));
    IF NEW.field_key = 'this' THEN RAISE EXCEPTION 'Field key "this" is kept for formulas; choose another'; END IF;
    IF NEW.field_key !~ '^[a-z][a-z0-9_]{0,39}$' THEN
        RAISE EXCEPTION 'Field key "%": use lower-case letters, digits and _ (starting with a letter, 40 at most)', NEW.field_key;
    END IF;
    NEW.unit := NULLIF(btrim(NEW.unit), '');
    NEW.formula := NULLIF(btrim(NEW.formula), '');
    IF NEW.field_type <> 'Calculated' THEN NEW.formula := NULL; END IF;
    IF NEW.field_type NOT IN ('Number','Calculated') THEN NEW.limit_min := NULL; NEW.limit_max := NULL; NEW.equipment_limits := false; NEW.publish := false; END IF;
    IF NEW.field_type <> 'Choice' THEN NEW.choices := NULL; END IF;
    IF NEW.field_type = 'Choice' AND COALESCE(cardinality(NEW.choices), 0) = 0 THEN RAISE EXCEPTION '%: a Choice field lists its choices', NEW.label; END IF;
    IF NEW.limit_min IS NOT NULL AND NEW.limit_max IS NOT NULL AND NEW.limit_min > NEW.limit_max THEN
        RAISE EXCEPTION '%: the lower limit (%) is above the upper limit (%)', NEW.label, lb_num(NEW.limit_min), lb_num(NEW.limit_max);
    END IF;
    IF NEW.equipment_limits AND l.subject <> 'Equipment' THEN RAISE EXCEPTION '%: limits per piece of equipment need a logbook about equipment', NEW.label; END IF;
    IF NEW.publish AND l.subject <> 'Lot' THEN RAISE EXCEPTION '%: only a logbook about lots publishes values (the lot''s value, used by formulas at the bench)', NEW.label; END IF;
    IF NEW.publish AND NEW.field_key = ANY (logbook_reserved_keys()) THEN
        RAISE EXCEPTION '%: "%" is already a name the bench formulas use; choose another key to publish it', NEW.label, NEW.field_key;
    END IF;
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    IF v.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is %: start a new version to change the design', v.version_no, v.status; END IF;
    PERFORM require_permission_at('logbook.design', l.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_field FOR EACH ROW EXECUTE FUNCTION logbook_field_rules();

CREATE FUNCTION logbook_equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l logbook; e equipment; k text;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = NEW.logbook_id;
    SELECT * INTO e FROM equipment WHERE id = NEW.equipment_id;
    IF TG_OP = 'UPDATE' AND (NEW.logbook_id <> OLD.logbook_id OR NEW.equipment_id <> OLD.equipment_id) THEN RAISE EXCEPTION 'Remove the equipment and add the right one'; END IF;
    IF l.subject <> 'Equipment' THEN RAISE EXCEPTION '% is not a logbook about equipment', l.logbook_code; END IF;
    IF e.site_id <> l.site_id THEN RAISE EXCEPTION '% belongs to another lab', e.equipment_code; END IF;
    IF TG_OP = 'INSERT' AND e.admin_status = 'Retired' THEN RAISE EXCEPTION '% is retired', e.equipment_code; END IF;
    IF jsonb_typeof(NEW.limits) <> 'object' THEN RAISE EXCEPTION 'Limits are given per field: {"temperature": {"min": 2, "max": 8}}'; END IF;
    FOR k IN SELECT jsonb_object_keys(NEW.limits) LOOP
        IF (NEW.limits->k->>'min') IS NOT NULL AND (NEW.limits->k->>'max') IS NOT NULL AND (NEW.limits->k->>'min')::numeric > (NEW.limits->k->>'max')::numeric THEN
            RAISE EXCEPTION '% (%): the lower limit is above the upper limit', e.equipment_code, k;
        END IF;
    END LOOP;
    IF logbook_internal() OR in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('logbook.design', l.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_equipment FOR EACH ROW EXECUTE FUNCTION logbook_equipment_rules();

-- the version entries are made against
CREATE FUNCTION logbook_effective_version(p_logbook uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM logbook_version WHERE logbook_id = p_logbook AND status = 'Effective'
$$;

-- What stops a design from being approved (Error) and what to look at (Warning)
CREATE FUNCTION logbook_version_problems(p_version uuid) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v logbook_version; l logbook; f record; tok text; k text; ref logbook_field; chk text; own boolean;
BEGIN
    SELECT * INTO v FROM logbook_version WHERE id = p_version;
    SELECT * INTO l FROM logbook WHERE id = v.logbook_id;
    IF NOT EXISTS (SELECT 1 FROM logbook_field WHERE version_id = p_version AND status = 'Active') THEN
        RETURN QUERY SELECT 'Error', 'Add at least one field'; RETURN;
    END IF;
    FOR f IN SELECT * FROM logbook_field WHERE version_id = p_version AND status = 'Active' ORDER BY sort_order, label LOOP
        IF f.field_type = 'Calculated' THEN
            IF f.formula IS NULL THEN RETURN QUERY SELECT 'Error', f.label || ': write its formula'; CONTINUE; END IF;
            chk := formula_check(logbook_formula(f.formula));
            IF chk IS NOT NULL THEN RETURN QUERY SELECT 'Error', f.label || ': ' || replace(chk, 'step token', 'field'); CONTINUE; END IF;
            FOREACH tok IN ARRAY formula_tokens(logbook_formula(f.formula)) LOOP
                own := split_part(tok, '.', 1) = 'this';
                k := CASE WHEN own THEN split_part(tok, '.', 2) ELSE split_part(tok, '.', 1) END;
                tok := CASE WHEN own THEN k ELSE tok END;
                SELECT * INTO ref FROM logbook_field x WHERE x.version_id = p_version AND x.field_key = k AND x.status = 'Active';
                IF ref.id IS NULL THEN RETURN QUERY SELECT 'Error', format('%s: {%s} is not a field of this logbook', f.label, tok);
                ELSIF NOT own AND ref.field_type <> 'Lot' THEN
                    RETURN QUERY SELECT 'Error', format('%s: {%s}: only a Lot field has values of its own ({lot_field.value})', f.label, tok);
                ELSIF own AND ref.field_type NOT IN ('Number','Calculated') THEN
                    RETURN QUERY SELECT 'Error', format('%s: {%s} is a %s field, not a number', f.label, tok, ref.field_type);
                ELSIF own AND (ref.sort_order, ref.label) >= (f.sort_order, f.label) THEN
                    RETURN QUERY SELECT 'Error', format('%s: {%s} comes after it; put the fields it uses first', f.label, tok);
                ELSIF NOT own AND NOT EXISTS (SELECT 1 FROM logbook_field pf JOIN logbook_version pv ON pv.id = pf.version_id JOIN logbook pl ON pl.id = pv.logbook_id
                                                              WHERE pl.site_id = l.site_id AND pf.field_key = split_part(tok, '.', 2) AND pf.publish AND pf.status = 'Active'
                                                                AND pv.status IN ('Effective','Draft') AND pl.status = 'Active') THEN
                    RETURN QUERY SELECT 'Warning', format('%s: no logbook of this lab publishes "%s" yet', f.label, split_part(tok, '.', 2));
                END IF;
            END LOOP;
        END IF;
        IF f.equipment_limits AND f.limit_min IS NULL AND f.limit_max IS NULL AND EXISTS (
               SELECT 1 FROM logbook_equipment le JOIN equipment e ON e.id = le.equipment_id
                WHERE le.logbook_id = l.id AND le.status = 'Active' AND NOT (le.limits ? f.field_key)
                  AND NOT EXISTS (SELECT 1 FROM stability_chamber ch WHERE ch.equipment_id = e.id AND ch.status = 'Active' AND f.field_key IN ('temperature','humidity'))) THEN
            RETURN QUERY SELECT 'Warning', f.label || ': some equipment has no limits for it (Equipment covered), and the field has no default';
        END IF;
    END LOOP;
    IF l.subject = 'Equipment' AND NOT EXISTS (SELECT 1 FROM logbook_equipment WHERE logbook_id = l.id AND status = 'Active') THEN
        RETURN QUERY SELECT 'Warning', 'No equipment is covered yet (Equipment covered): entries need a piece of equipment it covers';
    END IF;
    IF l.creates_lot AND NOT EXISTS (SELECT 1 FROM logbook_field WHERE version_id = p_version AND status = 'Active' AND field_type = 'Lot') THEN
        RETURN QUERY SELECT 'Warning', 'The lots it makes take their organism (or contents) from the first Lot field: add one (e.g. the working culture)';
    END IF;
    IF l.subject = 'Lot' AND NOT l.creates_lot AND EXISTS (SELECT 1 FROM logbook_field WHERE version_id = p_version AND status = 'Active' AND publish)
       AND l.validity_hours IS NULL THEN
        RETURN QUERY SELECT 'Warning', 'Published values have no validity window: an entry stays usable until the lot expires';
    END IF;
END $$;

-- Who worked on a version (they may not approve it)
CREATE FUNCTION logbook_version_authors(p_version uuid) RETURNS TABLE (user_id uuid) LANGUAGE sql STABLE AS $$
    SELECT DISTINCT a.changed_by FROM audit_log a
     WHERE (a.table_name = 'logbook_version' AND a.record_id = p_version)
        OR (a.table_name = 'logbook_field' AND a.record_id IN (SELECT id FROM logbook_field WHERE version_id = p_version))
$$;

CREATE FUNCTION approve_logbook_version(p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v logbook_version; l logbook; n integer; first_problem text;
BEGIN
    SELECT * INTO v FROM logbook_version WHERE id = p_version FOR UPDATE;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Logbook version not found'; END IF;
    IF v.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is already %', v.version_no, v.status; END IF;
    SELECT * INTO l FROM logbook WHERE id = v.logbook_id;
    PERFORM require_permission_at('logbook.review', l.site_id);
    PERFORM assert_signed('approve a logbook design');
    SELECT count(*), min(x.problem) INTO n, first_problem FROM logbook_version_problems(p_version) x WHERE x.severity = 'Error';
    IF n > 0 THEN RAISE EXCEPTION 'Version % has % problem(s) to fix first, e.g.: %', v.version_no, n, first_problem; END IF;
    IF EXISTS (SELECT 1 FROM logbook_version_authors(p_version) a WHERE a.user_id = current_app_user()) THEN
        RAISE EXCEPTION 'You worked on this design, so someone else in QA approves it';
    END IF;
    PERFORM ensure_reason('Logbook design approved');
    PERFORM set_logbook_internal(true);
    UPDATE logbook_version SET status = 'Superseded' WHERE logbook_id = v.logbook_id AND status = 'Effective';
    UPDATE logbook_version SET status = 'Effective', approved_by = current_app_user(), approved_at = clock_timestamp(),
           signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_version;
    PERFORM set_logbook_internal(false);
END $$;

-- A new Draft from the Effective design (its fields copied)
CREATE FUNCTION new_logbook_version(p_logbook uuid, p_summary text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE l logbook; cur uuid; v uuid;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = p_logbook;
    IF l.id IS NULL THEN RAISE EXCEPTION 'Logbook not found'; END IF;
    PERFORM require_permission_at('logbook.design', l.site_id);
    IF EXISTS (SELECT 1 FROM logbook_version WHERE logbook_id = p_logbook AND status = 'Draft') THEN RAISE EXCEPTION '% already has a Draft: change that one', l.logbook_code; END IF;
    cur := logbook_effective_version(p_logbook);
    INSERT INTO logbook_version (logbook_id, version_no, change_summary)
    VALUES (p_logbook, (SELECT COALESCE(max(version_no), 0) + 1 FROM logbook_version WHERE logbook_id = p_logbook), NULLIF(btrim(p_summary), ''))
    RETURNING id INTO v;
    INSERT INTO logbook_field (version_id, field_key, label, field_type, unit, limit_min, limit_max, equipment_limits, choices, required, formula, publish, help, sort_order)
    SELECT v, field_key, label, field_type, unit, limit_min, limit_max, equipment_limits, choices, required, formula, publish, help, sort_order
      FROM logbook_field WHERE version_id = cur AND status = 'Active';
    RETURN v;
END $$;

-- The limits a field applies to an entry: the equipment's own (Equipment covered), a chamber's condition, or the field's
CREATE FUNCTION logbook_limits(p_field uuid, p_equipment uuid, OUT lo numeric, OUT hi numeric) LANGUAGE plpgsql STABLE AS $$
DECLARE f logbook_field; le logbook_equipment; c stability_condition;
BEGIN
    SELECT * INTO f FROM logbook_field WHERE id = p_field;
    lo := f.limit_min; hi := f.limit_max;
    IF NOT f.equipment_limits OR p_equipment IS NULL THEN RETURN; END IF;
    SELECT le2.* INTO le FROM logbook_equipment le2 JOIN logbook_version v ON v.logbook_id = le2.logbook_id
     WHERE v.id = f.version_id AND le2.equipment_id = p_equipment AND le2.status = 'Active';
    IF le.id IS NOT NULL AND le.limits ? f.field_key THEN
        lo := NULLIF(le.limits->f.field_key->>'min', '')::numeric; hi := NULLIF(le.limits->f.field_key->>'max', '')::numeric; RETURN;
    END IF;
    SELECT sc.* INTO c FROM stability_chamber ch JOIN stability_condition sc ON sc.id = ch.condition_id WHERE ch.equipment_id = p_equipment AND ch.status = 'Active';
    IF c.id IS NOT NULL THEN
        IF f.field_key = 'temperature' AND c.temperature_c IS NOT NULL THEN
            lo := c.temperature_c - COALESCE(c.temperature_tol, 0); hi := c.temperature_c + COALESCE(c.temperature_tol, 0);
        ELSIF f.field_key = 'humidity' AND c.humidity_pct IS NOT NULL THEN
            lo := c.humidity_pct - COALESCE(c.humidity_tol, 0); hi := c.humidity_pct + COALESCE(c.humidity_tol, 0);
        END IF;
    END IF;
END $$;

-- A lot's published value (the latest usable entry about it that has the value): approved first
CREATE FUNCTION lot_published_value(p_lot uuid, p_key text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT (e.entry_values->>p_key)::numeric FROM logbook_entry e
     WHERE e.lot_id = p_lot AND e.status <> 'Voided' AND jsonb_typeof(e.entry_values->p_key) = 'number'
     ORDER BY (e.status = 'Approved') DESC, e.entry_at DESC LIMIT 1
$$;

-------------------------------------------------------------------------------
-- 4. RULES ON ENTRIES: checking each value, limits, the result, the reason at failure, signing, corrections
-------------------------------------------------------------------------------
-- Is the entry in use (L-2 replaces this: used by a result at the bench)
CREATE FUNCTION logbook_entry_in_use(p_entry uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;

CREATE FUNCTION logbook_entry_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l logbook; f record; raw jsonb; s text; vals jsonb := '{}'; probs text[] := '{}'; has_check boolean := false; n numeric;
        lo numeric; hi numeric; eq record; lt record; tok text; fv jsonb; miss text; recompute boolean;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = NEW.logbook_id;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.logbook_id <> OLD.logbook_id OR NEW.site_id <> OLD.site_id OR NEW.entry_code <> OLD.entry_code OR NEW.version_id <> OLD.version_id
           OR NEW.equipment_id IS DISTINCT FROM OLD.equipment_id OR (NEW.lot_id IS DISTINCT FROM OLD.lot_id AND NOT logbook_internal())
           OR NEW.sample_id IS DISTINCT FROM OLD.sample_id THEN
            RAISE EXCEPTION 'An entry keeps its logbook and what it is about: void it and record a new one';
        END IF;
        IF NOT logbook_internal() AND (NEW.status <> OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.review_id IS DISTINCT FROM OLD.review_id
                                       OR NEW.approved_in_batch_id IS DISTINCT FROM OLD.approved_in_batch_id OR NEW.created_lot_id IS DISTINCT FROM OLD.created_lot_id
                                       OR NEW.recorded_signature_id IS DISTINCT FROM OLD.recorded_signature_id) THEN
            RAISE EXCEPTION 'Entries are approved, returned and voided with their own actions';
        END IF;
        IF logbook_internal() THEN RETURN NEW; END IF;
        IF OLD.status = 'Voided' THEN RAISE EXCEPTION '% was voided: it cannot be changed', OLD.entry_code; END IF;
        recompute := NEW.entry_values IS DISTINCT FROM OLD.entry_values OR NEW.entry_at <> OLD.entry_at OR NEW.failure_reason IS DISTINCT FROM OLD.failure_reason;
        IF NOT recompute THEN RETURN NEW; END IF;
        PERFORM require_permission_at('logbook.record', NEW.site_id);
        IF l.signing = 'Signature' THEN PERFORM assert_signed('correct ' || OLD.entry_code); END IF;
        -- a corrected entry goes back to QA (L-2 also flags the results that used it)
        IF OLD.status IN ('Approved','Returned') THEN
            NEW.status := 'Recorded'; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.review_id := NULL; NEW.approved_in_batch_id := NULL;
        END IF;
    ELSE
        IF l.id IS NULL THEN RAISE EXCEPTION 'Logbook not found'; END IF;
        IF l.status <> 'Active' THEN RAISE EXCEPTION '% is not in use', l.logbook_code; END IF;
        NEW.site_id := l.site_id;
        NEW.version_id := logbook_effective_version(l.id);
        IF NEW.version_id IS NULL THEN RAISE EXCEPTION '% has no approved design yet: QA approves its design first', l.logbook_code; END IF;
        NEW.status := 'Recorded'; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.review_id := NULL; NEW.approved_in_batch_id := NULL;
        NEW.void_reason := NULL; NEW.returned_note := NULL; NEW.created_lot_id := NULL;
        IF NOT logbook_internal() THEN PERFORM require_permission_at('logbook.record', l.site_id); END IF;
        IF l.signing = 'Signature' THEN
            PERFORM assert_signed('record an entry in ' || l.logbook_code);
            NEW.recorded_signature_id := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
        ELSE NEW.recorded_signature_id := NULL;
        END IF;
        -- what it is about
        IF l.subject = 'Equipment' THEN
            IF NEW.equipment_id IS NULL THEN RAISE EXCEPTION 'Choose the equipment (% covers: see Equipment covered)', l.logbook_code; END IF;
            IF NOT EXISTS (SELECT 1 FROM logbook_equipment WHERE logbook_id = l.id AND equipment_id = NEW.equipment_id AND status = 'Active') THEN
                RAISE EXCEPTION '% does not cover % (a logbook designer adds it under Equipment covered)', l.logbook_code, (SELECT equipment_code || ' ' || equipment_name FROM equipment WHERE id = NEW.equipment_id);
            END IF;
            NEW.lot_id := NULL; NEW.sample_id := NULL;
        ELSIF l.subject = 'Lot' THEN
            IF l.creates_lot THEN NEW.lot_id := NULL;   -- made below, from the entry
            ELSIF NEW.lot_id IS NULL THEN RAISE EXCEPTION 'Choose the lot the entry is about';
            ELSIF (SELECT site_id FROM inventory_lot WHERE id = NEW.lot_id) <> l.site_id THEN RAISE EXCEPTION 'That lot belongs to another lab';
            END IF;
            NEW.equipment_id := NULL; NEW.sample_id := NULL;
        ELSIF l.subject = 'Sample' THEN
            IF NEW.sample_id IS NULL THEN RAISE EXCEPTION 'Choose the sample'; END IF;
            IF NOT EXISTS (SELECT 1 FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id AND o.site_id = l.site_id) THEN
                RAISE EXCEPTION 'That sample is not at this lab';
            END IF;
            NEW.equipment_id := NULL; NEW.lot_id := NULL;
        ELSE
            NEW.equipment_id := NULL; NEW.lot_id := NULL; NEW.sample_id := NULL;
        END IF;
    END IF;
    NEW.entry_at := COALESCE(NEW.entry_at, clock_timestamp());
    IF NEW.entry_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'The entry''s date and time is in the future'; END IF;
    -- each field, in order: checked, converted, calculated; limits judged
    FOR f IN SELECT * FROM logbook_field WHERE version_id = NEW.version_id AND status = 'Active' ORDER BY sort_order, label LOOP
        raw := NEW.entry_values -> f.field_key;
        s := CASE WHEN raw IS NULL OR jsonb_typeof(raw) = 'null' THEN NULL WHEN jsonb_typeof(raw) = 'string' THEN NULLIF(btrim(raw #>> '{}'), '') ELSE raw::text END;
        IF f.field_type = 'Calculated' THEN
            fv := '{}'; miss := NULL; n := NULL;
            FOREACH tok IN ARRAY formula_tokens(logbook_formula(f.formula)) LOOP
                IF split_part(tok, '.', 1) <> 'this' THEN
                    n := lot_published_value(NULLIF(vals->>split_part(tok, '.', 1), '')::uuid, split_part(tok, '.', 2));
                ELSE n := CASE WHEN jsonb_typeof(vals->split_part(tok, '.', 2)) = 'number' THEN (vals->>split_part(tok, '.', 2))::numeric END;
                END IF;
                IF n IS NULL THEN miss := COALESCE(miss || ', ', '') || '{' || replace(tok, 'this.', '') || '}'; ELSE fv := fv || jsonb_build_object(tok, n); END IF;
            END LOOP;
            n := NULL;
            IF miss IS NULL THEN
                BEGIN n := formula_eval(logbook_formula(f.formula), fv); EXCEPTION WHEN others THEN RAISE EXCEPTION '%: %', f.label, SQLERRM; END;
            ELSIF f.required THEN RAISE EXCEPTION '%: cannot be calculated without %', f.label, miss;
            END IF;
            IF n IS NOT NULL THEN vals := vals || jsonb_build_object(f.field_key, trim_scale(round(n, 10))); END IF;
        ELSIF s IS NULL THEN
            IF f.required AND f.field_type <> 'Pass/Fail' THEN RAISE EXCEPTION 'Enter %', f.label; END IF;
            IF f.required AND f.field_type = 'Pass/Fail' THEN RAISE EXCEPTION 'Enter Pass or Fail for %', f.label; END IF;
            CONTINUE;
        ELSIF f.field_type = 'Number' THEN
            IF s !~ '^\s*[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?\s*$' THEN RAISE EXCEPTION '%: "%" is not a number', f.label, s; END IF;
            n := s::numeric; vals := vals || jsonb_build_object(f.field_key, trim_scale(n));
        ELSIF f.field_type = 'Text' THEN vals := vals || jsonb_build_object(f.field_key, s);
        ELSIF f.field_type = 'Choice' THEN
            SELECT c INTO s FROM unnest(f.choices) c WHERE lower(c) = lower(s);
            IF s IS NULL THEN RAISE EXCEPTION '%: choose one of %', f.label, array_to_string(f.choices, ', '); END IF;
            vals := vals || jsonb_build_object(f.field_key, s);
        ELSIF f.field_type = 'Pass/Fail' THEN
            s := CASE WHEN lower(s) IN ('pass','p','yes','y','ok','true') THEN 'Pass' WHEN lower(s) IN ('fail','f','no','n','false') THEN 'Fail' END;
            IF s IS NULL THEN RAISE EXCEPTION '%: enter Pass or Fail', f.label; END IF;
            has_check := true;
            IF s = 'Fail' THEN probs := probs || (f.label || ': Fail'); END IF;
            vals := vals || jsonb_build_object(f.field_key, s);
        ELSIF f.field_type = 'Date/time' THEN
            BEGIN vals := vals || jsonb_build_object(f.field_key, to_char(s::timestamp, 'YYYY-MM-DD HH24:MI'));
            EXCEPTION WHEN others THEN RAISE EXCEPTION '%: "%" is not a date and time (YYYY-MM-DD HH:MM)', f.label, s; END;
        ELSIF f.field_type = 'Equipment' THEN
            SELECT ev.id, ev.equipment_code, ev.availability, ev.calibration_status INTO eq FROM equipment_view ev
             WHERE ev.site_id = NEW.site_id AND (ev.id::text = s OR lower(ev.equipment_code) = lower(s) OR lower(ev.equipment_name) = lower(s)) LIMIT 1;
            IF eq.id IS NULL THEN RAISE EXCEPTION '%: no equipment "%" at this lab', f.label, s; END IF;
            IF TG_OP = 'INSERT' AND eq.availability <> 'Available' THEN RAISE EXCEPTION '%: % is % and cannot be used', f.label, eq.equipment_code, lower(eq.availability); END IF;
            IF TG_OP = 'INSERT' AND eq.calibration_status = 'Deficient' THEN RAISE EXCEPTION '%: % is out of calibration and cannot be used', f.label, eq.equipment_code; END IF;
            vals := vals || jsonb_build_object(f.field_key, eq.id::text);
        ELSIF f.field_type = 'Lot' THEN
            SELECT li.id, li.lot_code, li.status::text AS status, li.expiration_date INTO lt FROM inventory_lot li
             WHERE li.site_id = NEW.site_id AND (li.id::text = s OR lower(li.lot_code) = lower(s)) LIMIT 1;
            IF lt.id IS NULL THEN RAISE EXCEPTION '%: no lot "%" at this lab', f.label, s; END IF;
            IF TG_OP = 'INSERT' AND lt.status <> 'Available' THEN RAISE EXCEPTION '%: lot % is % and cannot be used', f.label, lt.lot_code, lt.status; END IF;
            IF TG_OP = 'INSERT' AND lt.expiration_date < site_today(NEW.site_id) THEN RAISE EXCEPTION '%: lot % expired on %', f.label, lt.lot_code, lt.expiration_date; END IF;
            vals := vals || jsonb_build_object(f.field_key, lt.id::text);
        END IF;
        -- limits
        IF f.field_type IN ('Number','Calculated') AND jsonb_typeof(vals->f.field_key) = 'number' THEN
            SELECT x.lo, x.hi INTO lo, hi FROM logbook_limits(f.id, NEW.equipment_id) x;
            IF lo IS NOT NULL OR hi IS NOT NULL THEN
                has_check := true; n := (vals->>f.field_key)::numeric;
                IF lo IS NOT NULL AND n < lo THEN probs := probs || format('%s %s%s is below %s', f.label, lb_num(round(n, 4)), COALESCE(' ' || f.unit, ''), lb_num(lo)); END IF;
                IF hi IS NOT NULL AND n > hi THEN probs := probs || format('%s %s%s is above %s', f.label, lb_num(round(n, 4)), COALESCE(' ' || f.unit, ''), lb_num(hi)); END IF;
            END IF;
        END IF;
    END LOOP;
    NEW.entry_values := vals;
    NEW.problems := probs;
    NEW.result := CASE WHEN NOT has_check THEN NULL WHEN cardinality(probs) > 0 THEN 'Fail' ELSE 'Pass' END;
    NEW.failure_reason := NULLIF(btrim(NEW.failure_reason), '');
    IF NEW.result = 'Fail' AND NEW.failure_reason IS NULL THEN
        RAISE EXCEPTION '% fails (%): give the reason (what happened and what was done about it)', COALESCE(NEW.entry_code, 'The entry'), array_to_string(probs, '; ');
    END IF;
    IF NEW.result IS DISTINCT FROM 'Fail' THEN NEW.failure_reason := NULL; END IF;
    NEW.valid_until := CASE WHEN l.validity_hours IS NULL THEN NULL ELSE NEW.entry_at + make_interval(secs => (l.validity_hours * 3600)::double precision) END;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON logbook_entry FOR EACH ROW EXECUTE FUNCTION logbook_entry_rules();

-- An entry of a logbook that makes lots makes its inventory lot (e.g. an inoculum suspension), signed with the entry:
-- named after the logbook and the culture's organism (and the culture's lot), holding the organism, usable until the entry's validity ends
CREATE FUNCTION logbook_entry_make_lot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l logbook; src inventory_lot; v_lot uuid; qty numeric; tz text; f logbook_field;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = NEW.logbook_id;
    IF NOT l.creates_lot THEN RETURN NULL; END IF;
    SELECT * INTO f FROM logbook_field WHERE version_id = NEW.version_id AND status = 'Active' AND field_type = 'Lot' ORDER BY sort_order, label LIMIT 1;
    IF f.id IS NOT NULL THEN SELECT * INTO src FROM inventory_lot WHERE id = NULLIF(NEW.entry_values->>f.field_key, '')::uuid; END IF;
    qty := CASE WHEN jsonb_typeof(NEW.entry_values->'volume_made') = 'number' THEN (NEW.entry_values->>'volume_made')::numeric ELSE 1 END;
    tz := (SELECT time_zone FROM lab_site WHERE id = NEW.site_id);
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, quantity_received, unit, expiration_date, received_date, notes)
    VALUES (NEW.site_id, COALESCE(l.lot_name, l.logbook_name)
              || COALESCE(': ' || (SELECT string_agg(a.analyte_name, ', ' ORDER BY a.analyte_name) FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id
                                    WHERE la.lot_id = src.id AND la.status = 'Active'), '')
              || COALESCE(' (from ' || src.lot_code || ')', ''),
            CASE WHEN src.id IS NOT NULL AND 'Microbiological Strain' = ANY (src.chemical_types) THEN '{Microbiological Strain,In-house mixture}'::chemical_type[]
                 ELSE '{In-house mixture}'::chemical_type[] END,
            qty, l.lot_unit,
            COALESCE((NEW.valid_until AT TIME ZONE tz)::date, site_today(NEW.site_id) + 30), site_today(NEW.site_id),
            'Made in logbook entry ' || NEW.entry_code || ' (' || l.logbook_code || ' ' || l.logbook_name || ')')
    RETURNING id INTO v_lot;
    IF src.id IS NOT NULL THEN
        INSERT INTO lot_analyte (lot_id, analyte_id) SELECT v_lot, la.analyte_id FROM lot_analyte la WHERE la.lot_id = src.id AND la.status = 'Active';
    END IF;
    PERFORM set_logbook_internal(true);
    UPDATE logbook_entry SET lot_id = v_lot, created_lot_id = v_lot WHERE id = NEW.id;
    PERFORM set_logbook_internal(false);
    RETURN NULL;
END $$;
CREATE TRIGGER z_make_lot AFTER INSERT ON logbook_entry FOR EACH ROW EXECUTE FUNCTION logbook_entry_make_lot();

-------------------------------------------------------------------------------
-- 5. QA: APPROVE, RETURN; VOID
-------------------------------------------------------------------------------
-- Who recorded an entry or changed its values (they do not approve or review it)
CREATE FUNCTION logbook_entry_authors(p_entry uuid) RETURNS TABLE (user_id uuid) LANGUAGE sql STABLE AS $$
    SELECT created_by FROM logbook_entry WHERE id = p_entry
    UNION SELECT a.changed_by FROM audit_log a WHERE a.table_name = 'logbook_entry' AND a.record_id = p_entry AND a.action = 'UPDATE'
       AND (a.changed_fields ? 'entry_values' OR a.changed_fields ? 'entry_at' OR a.changed_fields ? 'failure_reason')
$$;

CREATE FUNCTION approve_logbook_entries(p_ids uuid[], p_comment text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e record; l record; n integer := 0; v_review uuid;
BEGIN
    IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN RAISE EXCEPTION 'Choose the entries to approve'; END IF;
    PERFORM assert_signed('approve logbook entries');
    FOR e IN SELECT x.*, lb.logbook_code, lb.review_route FROM logbook_entry x JOIN logbook lb ON lb.id = x.logbook_id WHERE x.id = ANY (p_ids) LOOP
        PERFORM require_permission_at('logbook.review', e.site_id);
        IF e.status <> 'Recorded' THEN RAISE EXCEPTION '% is % (only recorded entries are approved)', e.entry_code, lower(e.status); END IF;
        IF e.review_route = 'Batch' THEN RAISE EXCEPTION '% is reviewed in the batch that uses it (%), not in the logbook', e.entry_code, e.logbook_code; END IF;
        IF EXISTS (SELECT 1 FROM logbook_entry_authors(e.id) x WHERE x.user_id = current_app_user()) THEN
            RAISE EXCEPTION 'You recorded or corrected %: someone else in QA approves it', e.entry_code;
        END IF;
    END LOOP;
    IF (SELECT count(*) FROM logbook_entry WHERE id = ANY (p_ids)) <> cardinality(p_ids) THEN RAISE EXCEPTION 'Entry not found'; END IF;
    PERFORM ensure_reason('Logbook entries approved by QA');
    PERFORM set_logbook_internal(true);
    FOR l IN SELECT x.logbook_id, x.site_id, count(*) AS c, min(x.entry_at) AS a, max(x.entry_at) AS b FROM logbook_entry x WHERE x.id = ANY (p_ids) GROUP BY x.logbook_id, x.site_id LOOP
        INSERT INTO logbook_review (logbook_id, site_id, entry_count, first_entry_at, last_entry_at, comment, signature_id)
        VALUES (l.logbook_id, l.site_id, l.c, l.a, l.b, NULLIF(btrim(p_comment), ''), NULLIF(current_setting('lims.signature_id', true), '')::uuid)
        RETURNING id INTO v_review;
        UPDATE logbook_entry SET status = 'Approved', approved_by = current_app_user(), approved_at = clock_timestamp(), review_id = v_review, returned_note = NULL
         WHERE id = ANY (p_ids) AND logbook_id = l.logbook_id;
        n := n + l.c;
    END LOOP;
    PERFORM set_logbook_internal(false);
    RETURN n;
END $$;

CREATE FUNCTION return_logbook_entry(p_id uuid, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e logbook_entry;
BEGIN
    SELECT * INTO e FROM logbook_entry WHERE id = p_id;
    IF e.id IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
    PERFORM require_permission_at('logbook.review', e.site_id);
    IF e.status NOT IN ('Recorded','Approved') THEN RAISE EXCEPTION '% is % and cannot be returned', e.entry_code, lower(e.status); END IF;
    IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Say what needs correcting'; END IF;
    IF EXISTS (SELECT 1 FROM logbook_entry_authors(e.id) x WHERE x.user_id = current_app_user()) THEN RAISE EXCEPTION 'You recorded or corrected %: someone else in QA reviews it', e.entry_code; END IF;
    PERFORM ensure_reason('Logbook entry returned for correction');
    PERFORM set_logbook_internal(true);
    UPDATE logbook_entry SET status = 'Returned', returned_note = btrim(p_note), approved_by = NULL, approved_at = NULL, review_id = NULL WHERE id = p_id;
    PERFORM set_logbook_internal(false);
END $$;

CREATE FUNCTION void_logbook_entry(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e logbook_entry; l logbook; used text;
BEGIN
    SELECT * INTO e FROM logbook_entry WHERE id = p_id;
    IF e.id IS NULL THEN RAISE EXCEPTION 'Entry not found'; END IF;
    SELECT * INTO l FROM logbook WHERE id = e.logbook_id;
    IF NOT (has_permission_at('logbook.record', e.site_id) OR has_permission_at('logbook.review', e.site_id)) THEN
        PERFORM require_permission_at('logbook.record', e.site_id);
    END IF;
    IF e.status = 'Voided' THEN RAISE EXCEPTION '% is already voided', e.entry_code; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the entry is voided (e.g. recorded in the wrong logbook)'; END IF;
    used := logbook_entry_in_use(p_id);
    IF used IS NOT NULL THEN RAISE EXCEPTION '% cannot be voided: %. Correct it instead (the results that used it are flagged)', e.entry_code, used; END IF;
    IF l.signing = 'Signature' THEN PERFORM assert_signed('void ' || e.entry_code); END IF;
    PERFORM ensure_reason('Logbook entry voided');
    PERFORM set_logbook_internal(true);
    UPDATE logbook_entry SET status = 'Voided', void_reason = btrim(p_reason) WHERE id = p_id;
    PERFORM set_logbook_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 6. VIEWS: entries with their review due date, logbooks with their counts, what is due
-------------------------------------------------------------------------------
-- QA approves a Daily logbook's entries by the end of the next day, a Weekly one's by the end of the following week
CREATE FUNCTION logbook_review_due(p_freq text, p_local date) RETURNS date LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE p_freq WHEN 'Daily' THEN p_local + 1 ELSE (date_trunc('week', p_local::timestamp)::date + 13) END
$$;
CREATE VIEW logbook_entry_view AS
SELECT e.*, l.logbook_code, l.logbook_name, l.kind, l.subject, l.review_frequency, l.review_route, l.signing, v.version_no,
       s.site_code, to_char(e.entry_at AT TIME ZONE s.time_zone, 'YYYY-MM-DD HH24:MI') AS entry_local,
       eq.equipment_code, eq.equipment_name, lot.lot_code, lot.item_name AS lot_name, smp.sample_code,
       cu.full_name AS recorded_by_name, mu.full_name AS modified_by_name, au.full_name AS approved_by_name,
       CASE WHEN e.status IN ('Recorded','Returned') AND l.review_route = 'Logbook'
            THEN logbook_review_due(l.review_frequency, (e.entry_at AT TIME ZONE s.time_zone)::date) END AS review_due,
       (e.status IN ('Recorded','Returned') AND l.review_route = 'Logbook'
            AND site_today(e.site_id) > logbook_review_due(l.review_frequency, (e.entry_at AT TIME ZONE s.time_zone)::date)) AS overdue,
       (e.valid_until IS NOT NULL AND e.valid_until < clock_timestamp()) AS expired,
       b.batch_code AS approved_in_batch_code, cl.lot_code AS created_lot_code
  FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id JOIN logbook_version v ON v.id = e.version_id JOIN lab_site s ON s.id = e.site_id
  LEFT JOIN equipment eq ON eq.id = e.equipment_id LEFT JOIN inventory_lot lot ON lot.id = e.lot_id LEFT JOIN sample smp ON smp.id = e.sample_id
  JOIN app_user cu ON cu.id = e.created_by JOIN app_user mu ON mu.id = e.modified_by LEFT JOIN app_user au ON au.id = e.approved_by
  LEFT JOIN test_batch b ON b.id = e.approved_in_batch_id LEFT JOIN inventory_lot cl ON cl.id = e.created_lot_id;

-- What is due now: a Daily, Weekly or Monthly logbook needs an entry this day, week or month (for each piece of
-- equipment it covers that is in service, or once for a logbook about nothing in particular)
CREATE VIEW logbook_due_view AS
WITH lb AS (
    SELECT l.*, s.time_zone, site_today(l.site_id) AS today,
           CASE l.entry_frequency WHEN 'Daily' THEN site_today(l.site_id) WHEN 'Weekly' THEN date_trunc('week', site_today(l.site_id)::timestamp)::date
                ELSE date_trunc('month', site_today(l.site_id)::timestamp)::date END AS period_start
      FROM logbook l JOIN lab_site s ON s.id = l.site_id
     WHERE l.status = 'Active' AND l.entry_frequency IN ('Daily','Weekly','Monthly') AND logbook_effective_version(l.id) IS NOT NULL
)
SELECT lb.id AS logbook_id, lb.logbook_code, lb.logbook_name, lb.site_id, lb.entry_frequency, lb.period_start, e.id AS equipment_id, e.equipment_code, e.equipment_name,
       (SELECT max(x.entry_at) FROM logbook_entry x WHERE x.logbook_id = lb.id AND x.equipment_id = e.id AND x.status <> 'Voided') AS last_entry_at,
       NOT EXISTS (SELECT 1 FROM logbook_entry x WHERE x.logbook_id = lb.id AND x.equipment_id = e.id AND x.status <> 'Voided'
                    AND (x.entry_at AT TIME ZONE lb.time_zone)::date >= lb.period_start) AS due
  FROM lb JOIN logbook_equipment le ON le.logbook_id = lb.id AND le.status = 'Active' JOIN equipment e ON e.id = le.equipment_id AND e.admin_status = 'In Service'
 WHERE lb.subject = 'Equipment'
UNION ALL
SELECT lb.id, lb.logbook_code, lb.logbook_name, lb.site_id, lb.entry_frequency, lb.period_start, NULL, NULL, NULL,
       (SELECT max(x.entry_at) FROM logbook_entry x WHERE x.logbook_id = lb.id AND x.status <> 'Voided'),
       NOT EXISTS (SELECT 1 FROM logbook_entry x WHERE x.logbook_id = lb.id AND x.status <> 'Voided' AND (x.entry_at AT TIME ZONE lb.time_zone)::date >= lb.period_start)
  FROM lb WHERE lb.subject <> 'Equipment';

CREATE VIEW logbook_view AS
SELECT l.*, s.site_code,
       (SELECT v.version_no FROM logbook_version v WHERE v.logbook_id = l.id AND v.status = 'Effective') AS effective_version,
       (SELECT v.version_no FROM logbook_version v WHERE v.logbook_id = l.id AND v.status = 'Draft') AS draft_version,
       (SELECT count(*) FROM logbook_entry_view x WHERE x.logbook_id = l.id AND x.status IN ('Recorded','Returned') AND x.review_route = 'Logbook')::int AS to_review,
       (SELECT count(*) FROM logbook_entry_view x WHERE x.logbook_id = l.id AND x.overdue)::int AS overdue,
       (SELECT count(*) FROM logbook_due_view d WHERE d.logbook_id = l.id AND d.due)::int AS due_now,
       (SELECT max(x.entry_at) FROM logbook_entry x WHERE x.logbook_id = l.id AND x.status <> 'Voided') AS last_entry_at,
       (SELECT count(*) FROM logbook_equipment le WHERE le.logbook_id = l.id AND le.status = 'Active')::int AS equipment_count
  FROM logbook l JOIN lab_site s ON s.id = l.site_id;

-------------------------------------------------------------------------------
-- 7. EQUIPMENT FLAGS IN QC REVIEW (Alex: "Flag happens at QC review steps with that equipment")
-------------------------------------------------------------------------------
-- A failed entry on a piece of equipment, and the time it puts in doubt: from the last passing entry of the same
-- logbook before it (or, with none, from when the logbook's first design was approved) to the next passing entry
-- after it (open while none)
CREATE VIEW equipment_failure_view AS
SELECT e.id AS logbook_entry_id, e.entry_code, e.logbook_id, l.logbook_code, l.logbook_name, l.kind, e.site_id, e.equipment_id, eq.equipment_code, eq.equipment_name,
       e.entry_at, e.problems, e.failure_reason, e.status,
       COALESCE((SELECT max(p.entry_at) FROM logbook_entry p WHERE p.logbook_id = e.logbook_id AND p.equipment_id = e.equipment_id AND p.status <> 'Voided'
                   AND p.result = 'Pass' AND p.entry_at < e.entry_at),
                (SELECT min(v.approved_at) FROM logbook_version v WHERE v.logbook_id = e.logbook_id AND v.approved_at IS NOT NULL AND v.approved_at < e.entry_at),
                e.entry_at) AS window_start,
       (SELECT min(p.entry_at) FROM logbook_entry p WHERE p.logbook_id = e.logbook_id AND p.equipment_id = e.equipment_id AND p.status <> 'Voided'
         AND p.result = 'Pass' AND p.entry_at > e.entry_at) AS window_end
  FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id JOIN equipment eq ON eq.id = e.equipment_id
 WHERE e.result = 'Fail' AND e.status <> 'Voided' AND e.equipment_id IS NOT NULL;

-- The reviewer's acceptance of a flag (kept with what the flag said)
CREATE TABLE equipment_flag_acceptance (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            uuid NOT NULL REFERENCES test_batch(id),
    logbook_entry_id    uuid NOT NULL REFERENCES logbook_entry(id),
    justification       text NOT NULL CHECK (btrim(justification) <> ''),
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX equipment_flag_acceptance_uq ON equipment_flag_acceptance (batch_id, logbook_entry_id) WHERE status = 'Active';
CALL make_gxp('equipment_flag_acceptance', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON equipment_flag_acceptance FOR EACH ROW EXECUTE FUNCTION review_tables_rules();

-- The batch's steps that used a piece of equipment while a logbook entry on it was failing (optionally only the given steps)
CREATE FUNCTION batch_equipment_flags(p_batch uuid, p_steps uuid[] DEFAULT NULL)
RETURNS TABLE (step_run_id uuid, step_id uuid, step_name text, equipment_id uuid, equipment_code text, equipment_name text, logbook_entry_id uuid, entry_code text,
               logbook_code text, logbook_name text, entry_at timestamptz, what text, used_at timestamptz, accepted boolean, justification text,
               accepted_by_name text, accepted_at timestamptz)
LANGUAGE sql STABLE AS $$
    WITH uses AS (
        SELECT r.id AS step_run_id, r.step_id, q.equipment_id, q.created_at AS t1, q.created_at AS t2
          FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id
         WHERE r.batch_id = p_batch AND q.status = 'Active' AND (p_steps IS NULL OR r.step_id = ANY (p_steps))
        UNION ALL
        SELECT r.id, r.step_id, il.equipment_id, il.time_in, COALESCE(il.time_out, clock_timestamp())
          FROM incubation_load il JOIN step_run r ON r.id = il.step_run_id
         WHERE r.batch_id = p_batch AND il.status = 'Active' AND (p_steps IS NULL OR r.step_id = ANY (p_steps))
    ), hits AS (
        SELECT DISTINCT ON (u.step_run_id, w.logbook_entry_id) u.step_run_id, u.step_id, w.*, u.t1
          FROM uses u JOIN equipment_failure_view w ON w.equipment_id = u.equipment_id
         WHERE u.t2 > w.window_start AND u.t1 < COALESCE(w.window_end, 'infinity'::timestamptz)
         ORDER BY u.step_run_id, w.logbook_entry_id, u.t1
    )
    SELECT h.step_run_id, h.step_id, ws.step_name, h.equipment_id, h.equipment_code, h.equipment_name, h.logbook_entry_id, h.entry_code, h.logbook_code, h.logbook_name,
           h.entry_at,
           format('%s failed in %s (%s) on %s: %s; reason: %s%s', h.equipment_code, h.logbook_name, h.entry_code,
                  to_char(h.entry_at AT TIME ZONE s.time_zone, 'YYYY-MM-DD HH24:MI'), array_to_string(h.problems, '; '), h.failure_reason,
                  CASE WHEN h.window_end IS NULL THEN '; no passing entry since' ELSE '' END),
           h.t1, a.id IS NOT NULL, a.justification, au.full_name, a.created_at
      FROM hits h JOIN step_run r ON r.id = h.step_run_id JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id JOIN lab_site s ON s.id = b.site_id
      LEFT JOIN equipment_flag_acceptance a ON a.batch_id = p_batch AND a.logbook_entry_id = h.logbook_entry_id AND a.status = 'Active'
      LEFT JOIN app_user au ON au.id = a.created_by
     ORDER BY h.t1, ws.sort_order
$$;

-- Accept a flag (testing.review, not someone who did the work): while the batch waits for review, or earlier when the
-- flagged step feeds a timepoint ready for review
CREATE FUNCTION accept_equipment_flag(p_batch uuid, p_entry uuid, p_justification text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; f record;
BEGIN
    b := assert_can_review(p_batch);
    SELECT * INTO f FROM batch_equipment_flags(p_batch) x WHERE x.logbook_entry_id = p_entry LIMIT 1;
    IF f.logbook_entry_id IS NULL THEN RAISE EXCEPTION 'That logbook entry does not flag this batch'; END IF;
    IF b.status <> 'Awaiting Review' AND NOT (b.status = 'In Progress' AND EXISTS (
            SELECT 1 FROM batch_timepoints(p_batch) t, batch_equipment_flags(p_batch) y
             WHERE t.ready AND NOT t.released AND y.logbook_entry_id = p_entry AND y.step_id IN (SELECT a.step_id FROM step_ancestors(t.step_id) a))) THEN
        RAISE EXCEPTION 'Batch % is %: equipment flags are accepted in QC Review', b.batch_code, b.status;
    END IF;
    IF COALESCE(btrim(p_justification), '') = '' THEN RAISE EXCEPTION 'Write why the results can still be reported'; END IF;
    PERFORM ensure_reason('Equipment flag accepted by the reviewer');
    PERFORM set_testing_internal(true);
    UPDATE equipment_flag_acceptance SET status = 'Inactive' WHERE batch_id = p_batch AND logbook_entry_id = p_entry AND status = 'Active';
    INSERT INTO equipment_flag_acceptance (batch_id, logbook_entry_id, justification) VALUES (p_batch, p_entry, btrim(p_justification));
    PERFORM set_testing_internal(false);
END $$;

CREATE FUNCTION batch_flag_problems(p_batch uuid, p_steps uuid[] DEFAULT NULL) RETURNS TABLE (problem text) LANGUAGE sql STABLE AS $$
    SELECT DISTINCT ON (x.logbook_entry_id) x.step_name || ': ' || x.what || '; the reviewer accepts it with a justification'
      FROM batch_equipment_flags(p_batch, p_steps) x WHERE NOT x.accepted ORDER BY x.logbook_entry_id
$$;

-- The review problems gain the unaccepted equipment flags (the functions of 022 are kept and called)
ALTER FUNCTION batch_review_problems(uuid) RENAME TO batch_review_problems_l1;
CREATE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
BEGIN
    RETURN QUERY SELECT x.problem FROM batch_review_problems_l1(p_batch) x;
    IF (SELECT status FROM test_batch WHERE id = p_batch) = 'Awaiting Review' THEN
        RETURN QUERY SELECT y.problem FROM batch_flag_problems(p_batch) y;
    END IF;
END $$;
ALTER FUNCTION timepoint_problems(uuid) RENAME TO timepoint_problems_l1;
CREATE FUNCTION timepoint_problems(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE t record; v_batch uuid; n integer;
BEGIN
    SELECT batch_id INTO v_batch FROM step_run WHERE id = p_step_run;
    RETURN QUERY SELECT x.problem FROM timepoint_problems_l1(p_step_run) x;
    GET DIAGNOSTICS n = ROW_COUNT;
    SELECT * INTO t FROM batch_timepoints(v_batch) z WHERE z.step_run_id = p_step_run;
    IF t.step_run_id IS NOT NULL AND t.ready AND NOT t.released THEN
        RETURN QUERY SELECT y.problem FROM batch_flag_problems(v_batch, ARRAY(SELECT a.step_id FROM step_ancestors(t.step_id) a)) y;
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 8. STABILITY EXCURSIONS: a failed entry on a stability chamber, and the studies whose material was in it
-------------------------------------------------------------------------------
CREATE VIEW stability_excursion_view AS
SELECT w.*, st.id AS study_id, st.study_code, ss.id AS storage_id, ss.storage_code, rk.rack_code, sc.condition_name
  FROM equipment_failure_view w JOIN stability_chamber ch ON ch.equipment_id = w.equipment_id
  JOIN stability_condition sc ON sc.id = ch.condition_id
  JOIN stability_rack rk ON rk.chamber_id = ch.id JOIN stability_storage ss ON ss.rack_id = rk.id JOIN stability_study st ON st.id = ss.study_id
  JOIN lab_site s ON s.id = st.site_id
 WHERE LEAST(ss.created_at, COALESCE(st.placement_date::timestamp AT TIME ZONE s.time_zone, ss.created_at)) <= w.entry_at
   AND (ss.status = 'Stored' OR ss.modified_at >= w.entry_at);

-------------------------------------------------------------------------------
-- 9. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_l1;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_lb uuid;
BEGIN
    IF p_table = 'logbook' THEN
        RETURN jsonb_build_object('label', 'Logbook ' || COALESCE(r->>'logbook_code', '') || ' ' || COALESCE(r->>'logbook_name', ''), 'link', '#/logbooks/' || p_id);
    ELSIF p_table IN ('logbook_version', 'logbook_equipment', 'logbook_review') THEN
        v_lb := (r->>'logbook_id')::uuid;
        RETURN jsonb_build_object('label', CASE p_table WHEN 'logbook_version' THEN 'Logbook design v' || COALESCE(r->>'version_no', '') || ' of '
                                                        WHEN 'logbook_review' THEN 'QA approval of ' ELSE 'Equipment covered by ' END
                                           || COALESCE((SELECT logbook_code FROM logbook WHERE id = v_lb), ''), 'link', '#/logbooks/' || v_lb);
    ELSIF p_table = 'logbook_field' THEN
        SELECT logbook_id INTO v_lb FROM logbook_version WHERE id = (r->>'version_id')::uuid;
        RETURN jsonb_build_object('label', 'Logbook field ' || COALESCE(r->>'label', '') || ' (' || COALESCE((SELECT logbook_code FROM logbook WHERE id = v_lb), '') || ')',
                                  'link', '#/logbooks/' || v_lb || '?tab=design');
    ELSIF p_table = 'logbook_entry' THEN
        RETURN jsonb_build_object('label', 'Logbook entry ' || COALESCE(r->>'entry_code', ''), 'link', '#/logbooks/entries/' || p_id);
    ELSIF p_table = 'equipment_flag_acceptance' THEN
        RETURN jsonb_build_object('label', 'Equipment flag accepted in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''),
                                  'link', '#/testing/batches/' || (r->>'batch_id'));
    END IF;
    RETURN audit_record_ref_l1(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
