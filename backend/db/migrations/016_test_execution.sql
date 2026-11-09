-- LIMS3 schema, migration 016: WORKFLOW DESIGNER, WD-2: chemistry execution (batches and the bench)
-- Vault: "Decision - Chemistry Execution Scope and Rules" (Alex Kiddle, 2026-10-13), the build-out deck "Testing, Batching
-- & Workflow" (slides 6 to 15, 20 to 23), "Decision - Workflow Step Types Cascade Under One Definition Object".
--  - The backlog: each lab's tests waiting to be batched (logged samples, a test with a workflow, not in an active batch),
--    re-preps first, then rush, then by due date. Autobatch fills a batch up to the test's maximum and adds its QC
--    (once per batch, or every N samples as opening and closing brackets); matrix spikes are tied to a sample.
--  - A batch runs its test version's workflow: one run per step. Values are recorded per entry (and per analyte and
--    reading), under the person's name, corrections with a reason. Equipment used must be available and in calibration;
--    materials used must be received, available and in date. Raw data files attach to the step.
--  - Results are calculated live by the WD-1 engine (weights, dilution factors, readings, preparation fields, earlier
--    calculations), rounded and reported as the test says, with their inputs. QC is judged per analyte: recoveries
--    (check standards against the standard used, spikes against the amount spiked), RPD of a spike duplicate, blanks.
--  - A step is completed with one signature for the whole batch ("Performed by"), by someone with testing.perform in the
--    step's department, once its data are complete; a step can require (or allow) a witness, who signs too.
--  - Re-analysis (same preparation, 1 to 3 new readings) and re-prep (back to the top of the pool, 1 to 3 preparations)
--    are signed with a reason; every reading is kept; the QC reviewer (WD-3) decides what is reported.
--  - When every step before QC Review is completed the batch waits for QC Review (WD-3).

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('testing.perform', 'Testing', 'Bench work', 'Build batches and do workflow steps (in the step''s department); witness steps', false, 90),
 ('testing.assign',  'Testing', 'Assignment', 'Assign and reassign batches to analysts', false, 91);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{testing.perform}'), ('Lab Supervisor', '{testing.perform,testing.assign}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION testing_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.testing_internal', true), '') = '1' OR in_group_sync()
$$;
CREATE FUNCTION set_testing_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.testing_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;

-------------------------------------------------------------------------------
-- 2. BATCHES, THEIR ENTRIES, RE-PREPS
-------------------------------------------------------------------------------
CREATE TYPE batch_status AS ENUM ('Open','In Progress','Awaiting Review','Approved','Cancelled');
CREATE SEQUENCE test_batch_seq;
CREATE TABLE test_batch (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_code       text NOT NULL UNIQUE DEFAULT 'BAT-' || lpad(nextval('test_batch_seq')::text, 6, '0'),
    site_id          uuid NOT NULL REFERENCES lab_site(id),
    test_id          uuid NOT NULL REFERENCES test(id),
    test_version_id  uuid NOT NULL REFERENCES test_version(id),
    department_id    uuid REFERENCES department(id),
    status           batch_status NOT NULL DEFAULT 'Open',
    assigned_to      uuid NOT NULL REFERENCES app_user(id),
    notes            text,
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX test_batch_site_idx ON test_batch (site_id, status);
CALL make_gxp('test_batch', false);
CREATE FUNCTION test_batch_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.site_id <> OLD.site_id OR NEW.test_version_id <> OLD.test_version_id OR NEW.test_id <> OLD.test_id) THEN
        RAISE EXCEPTION 'A batch cannot change its lab or test';
    END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Batches are made from the backlog (autobatch)'; END IF;
    IF NEW.status <> OLD.status THEN RAISE EXCEPTION 'A batch''s status follows its steps'; END IF;
    IF NEW.assigned_to <> OLD.assigned_to THEN RAISE EXCEPTION 'Use Assign to give the batch to someone else'; END IF;
    PERFORM require_permission_at('testing.perform', NEW.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON test_batch FOR EACH ROW EXECUTE FUNCTION test_batch_rules();

CREATE TABLE reprep_request (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_test_id  uuid NOT NULL REFERENCES requested_test(id),
    origin_entry_id    uuid NOT NULL,                     -- the batch entry it replaces
    replicates         integer NOT NULL CHECK (replicates BETWEEN 1 AND 3),
    reason             text NOT NULL CHECK (btrim(reason) <> ''),
    status             text NOT NULL DEFAULT 'Pooled' CHECK (status IN ('Pooled','Batched','Cancelled')),
    batch_id           uuid REFERENCES test_batch(id),
    signature_id       uuid REFERENCES signature_event(id),
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('reprep_request', false);

CREATE TABLE batch_entry (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id           uuid NOT NULL REFERENCES test_batch(id),
    position           integer NOT NULL,
    entry_type         text NOT NULL CHECK (entry_type IN ('Sample','QC')),
    requested_test_id  uuid REFERENCES requested_test(id),
    qc_type            text REFERENCES qc_type(qc_type),
    qc_class           text CHECK (qc_class IN ('Prep','Analytical')),
    label              text NOT NULL,
    parent_entry_id    uuid REFERENCES batch_entry(id),   -- the sample a matrix spike (duplicate) is made from
    replicate_no       integer NOT NULL DEFAULT 1 CHECK (replicate_no BETWEEN 1 AND 3),
    reprep_request_id  uuid REFERENCES reprep_request(id),
    status             text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Superseded')),
    superseded_reason  text,
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT batch_entry_kind CHECK ((entry_type = 'Sample') = (requested_test_id IS NOT NULL) AND (entry_type = 'QC') = (qc_type IS NOT NULL))
);
CREATE INDEX batch_entry_batch_idx ON batch_entry (batch_id, position);
CREATE INDEX batch_entry_rt_idx ON batch_entry (requested_test_id);
CALL make_gxp('batch_entry', false);
ALTER TABLE reprep_request ADD CONSTRAINT reprep_origin_fk FOREIGN KEY (origin_entry_id) REFERENCES batch_entry(id);

-------------------------------------------------------------------------------
-- 3. STEP RUNS, VALUES, MATERIALS, EQUIPMENT, RAW DATA, RE-ANALYSIS
-------------------------------------------------------------------------------
CREATE TABLE step_run (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id              uuid NOT NULL REFERENCES test_batch(id),
    step_id               uuid NOT NULL REFERENCES workflow_step(id),
    status                text NOT NULL DEFAULT 'Not started' CHECK (status IN ('Not started','In progress','Completed')),
    fields                jsonb NOT NULL DEFAULT '{}'::jsonb,    -- a Preparation step's fields, filled once per batch
    notes                 text,
    performed_by          uuid REFERENCES app_user(id),
    completed_at          timestamptz,
    signature_id          uuid REFERENCES signature_event(id),
    witness_id            uuid REFERENCES app_user(id),
    witness_signature_id  uuid REFERENCES signature_event(id),
    record_version        integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at           timestamptz NOT NULL DEFAULT now(),
    modified_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (batch_id, step_id)
);
CALL make_gxp('step_run', false);

CREATE TABLE entry_value (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id   uuid NOT NULL REFERENCES step_run(id),
    entry_id      uuid NOT NULL REFERENCES batch_entry(id),
    analyte_id    uuid REFERENCES analyte(id),       -- readings are per analyte; weights and dilutions are not
    run_no        integer NOT NULL DEFAULT 1 CHECK (run_no BETWEEN 1 AND 10),
    value_num     numeric,
    value_text    text,
    data          jsonb NOT NULL DEFAULT '{}'::jsonb,  -- a dilution's fields: {"fields": [{"aliquot": 10, "diluent": 40}, ...]}
    status        text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Superseded')),
    record_version integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at   timestamptz NOT NULL DEFAULT now(),
    modified_by   uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX entry_value_uq ON entry_value (step_run_id, entry_id, COALESCE(analyte_id, '00000000-0000-0000-0000-000000000000'::uuid), run_no) WHERE status = 'Active';
CALL make_gxp('entry_value');            -- a correction needs a Reason for Change

CREATE TYPE material_purpose AS ENUM ('Spike','Standard','Reagent','Diluent','Media','Other');
CREATE TABLE entry_material (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id   uuid NOT NULL REFERENCES step_run(id),
    entry_id      uuid REFERENCES batch_entry(id),   -- empty = the whole batch
    lot_id        uuid NOT NULL REFERENCES inventory_lot(id),
    purpose       material_purpose NOT NULL,
    volume        numeric CHECK (volume > 0),        -- a spike's volume added (needed to calculate the amount spiked)
    volume_unit   text,
    status        record_status NOT NULL DEFAULT 'Active',
    record_version integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at   timestamptz NOT NULL DEFAULT now(),
    modified_by   uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('entry_material', false);

CREATE TABLE entry_equipment (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id   uuid NOT NULL REFERENCES step_run(id),
    entry_id      uuid REFERENCES batch_entry(id),   -- empty = used for the whole batch
    equipment_id  uuid NOT NULL REFERENCES equipment(id),
    status        record_status NOT NULL DEFAULT 'Active',
    record_version integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at   timestamptz NOT NULL DEFAULT now(),
    modified_by   uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('entry_equipment', false);

CREATE TABLE step_attachment (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id   uuid NOT NULL REFERENCES step_run(id),
    document_id   uuid NOT NULL REFERENCES document_file(id),
    label         text,
    status        record_status NOT NULL DEFAULT 'Active',
    record_version integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at   timestamptz NOT NULL DEFAULT now(),
    modified_by   uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('step_attachment', false);

CREATE TABLE reanalysis_request (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id   uuid NOT NULL REFERENCES step_run(id),
    entry_id      uuid NOT NULL REFERENCES batch_entry(id),
    runs          integer NOT NULL CHECK (runs BETWEEN 1 AND 3),
    first_run_no  integer NOT NULL,
    reason        text NOT NULL CHECK (btrim(reason) <> ''),
    signature_id  uuid REFERENCES signature_event(id),
    record_version integer NOT NULL DEFAULT 1,
    created_at    timestamptz NOT NULL DEFAULT now(),
    created_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at   timestamptz NOT NULL DEFAULT now(),
    modified_by   uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('reanalysis_request', false);

-- How many readings an entry has at a Data Entry step: 1 plus every re-analysis
CREATE FUNCTION entry_runs(p_step_run uuid, p_entry uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT 1 + COALESCE((SELECT sum(runs)::int FROM reanalysis_request WHERE step_run_id = p_step_run AND entry_id = p_entry), 0)
$$;

-- Who may do bench work on a step: testing.perform at the lab, and in the step's department
CREATE FUNCTION assert_can_perform(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; ws workflow_step;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    PERFORM require_permission_at('testing.perform', b.site_id);
    IF NOT can_perform_step(current_app_user(), ws.id) THEN
        RAISE EXCEPTION '"%" is done by the % department; you are not in a group for it (Admin > Groups)', ws.step_name,
            COALESCE((SELECT department_name FROM department WHERE id = step_department(ws.id)), 'test''s');
    END IF;
    IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is %', b.batch_code, b.status; END IF;
END $$;
-- Bench data can change only while its step is not completed
CREATE FUNCTION assert_step_open(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.status = 'Completed' THEN
        RAISE EXCEPTION 'This step is completed (signed); reopen it (with a reason) to change its data';
    END IF;
END $$;

CREATE FUNCTION entry_value_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; e batch_entry; ws workflow_step;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.step_run_id <> OLD.step_run_id OR NEW.entry_id <> OLD.entry_id OR NEW.analyte_id IS DISTINCT FROM OLD.analyte_id OR NEW.run_no <> OLD.run_no) THEN
        RAISE EXCEPTION 'A recorded value cannot move; correct its value instead';
    END IF;
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO e FROM batch_entry WHERE id = NEW.entry_id;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF e.batch_id <> r.batch_id THEN RAISE EXCEPTION 'The entry is not in this batch'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF e.status <> 'Active' THEN RAISE EXCEPTION '% was superseded (%) and takes no more data', e.label, e.superseded_reason; END IF;
    IF r.status = 'Not started' THEN
        IF EXISTS (SELECT 1 FROM workflow_step_dependency d JOIN step_run p ON p.step_id = d.depends_on_step_id AND p.batch_id = r.batch_id
                    WHERE d.step_id = r.step_id AND d.status = 'Active' AND p.status <> 'Completed') THEN
            RAISE EXCEPTION '"%" cannot start until the steps before it are completed', ws.step_name;
        END IF;
    END IF;
    IF NEW.analyte_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version_analyte a JOIN test_batch b ON b.test_version_id = a.test_version_id
                                                   WHERE b.id = r.batch_id AND a.analyte_id = NEW.analyte_id AND a.status = 'Active') THEN
        RAISE EXCEPTION 'That analyte is not on this test';
    END IF;
    IF ws.step_type = 'Data Entry' AND NEW.run_no > entry_runs(r.id, e.id) THEN
        RAISE EXCEPTION 'Reading % does not exist for %: ask for a re-analysis first', NEW.run_no, e.label;
    END IF;
    IF ws.step_type = 'Weighing' AND NEW.value_num IS NOT NULL AND NEW.value_num <= 0 THEN RAISE EXCEPTION 'A weight must be above zero'; END IF;
    NEW.value_text := NULLIF(btrim(NEW.value_text), '');
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION entry_value_rules();
-- the first value recorded starts the step
CREATE FUNCTION step_started() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM step_run WHERE id = NEW.step_run_id AND status = 'Not started') THEN
        PERFORM set_testing_internal(true);
        UPDATE step_run SET status = 'In progress' WHERE id = NEW.step_run_id;
        UPDATE test_batch SET status = 'In Progress' WHERE id = (SELECT batch_id FROM step_run WHERE id = NEW.step_run_id) AND status = 'Open';
        PERFORM set_testing_internal(false);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_started AFTER INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION step_started();

CREATE FUNCTION step_run_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.batch_id <> OLD.batch_id OR NEW.step_id <> OLD.step_id) THEN RAISE EXCEPTION 'A step run cannot move'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Step runs are made with the batch'; END IF;
    IF NEW.status <> OLD.status OR NEW.signature_id IS DISTINCT FROM OLD.signature_id OR NEW.witness_signature_id IS DISTINCT FROM OLD.witness_signature_id
       OR NEW.performed_by IS DISTINCT FROM OLD.performed_by THEN
        RAISE EXCEPTION 'Complete or reopen the step with its buttons (signed)';
    END IF;
    PERFORM assert_can_perform(NEW.id);
    PERFORM assert_step_open(NEW.id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON step_run FOR EACH ROW EXECUTE FUNCTION step_run_rules();
CREATE FUNCTION step_run_fields_started() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Not started' AND NEW.fields <> OLD.fields THEN
        PERFORM set_testing_internal(true);
        UPDATE step_run SET status = 'In progress' WHERE id = NEW.id;
        UPDATE test_batch SET status = 'In Progress' WHERE id = NEW.batch_id AND status = 'Open';
        PERFORM set_testing_internal(false);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_started AFTER UPDATE OF fields ON step_run FOR EACH ROW EXECUTE FUNCTION step_run_fields_started();

-- Materials: the lot must be this lab's, received, available, in date and not past retest
CREATE FUNCTION entry_material_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; l inventory_lot;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch_entry WHERE id = NEW.entry_id AND batch_id = b.id) THEN RAISE EXCEPTION 'The entry is not in this batch'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF TG_OP = 'UPDATE' AND (NEW.lot_id <> OLD.lot_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN RAISE EXCEPTION 'Remove the material and add the right one'; END IF;
    NEW.volume_unit := canonical_unit(NEW.volume_unit, '{Volume,Mass}', 'Volume unit');
    IF NEW.status = 'Active' AND TG_OP = 'INSERT' THEN
        SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
        IF l.site_id <> b.site_id THEN RAISE EXCEPTION 'Lot % belongs to another lab', l.lot_code; END IF;
        IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Lot % has not been received', l.lot_code; END IF;
        IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be used', l.lot_code, l.status; END IF;
        IF l.expiration_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % expired on % and cannot be used', l.lot_code, l.expiration_date; END IF;
        IF l.retest_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % was due for retest on % and cannot be used', l.lot_code, l.retest_date; END IF;
        IF NEW.purpose = 'Spike' AND NEW.volume IS NULL THEN RAISE EXCEPTION 'Enter the volume of spiking solution added'; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON entry_material FOR EACH ROW EXECUTE FUNCTION entry_material_rules();

-- Equipment: this lab's, of a type the step allows (when it names types), available and in calibration
CREATE FUNCTION entry_equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; ev record;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch_entry WHERE id = NEW.entry_id AND batch_id = b.id) THEN RAISE EXCEPTION 'The entry is not in this batch'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF TG_OP = 'UPDATE' AND (NEW.equipment_id <> OLD.equipment_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id) THEN RAISE EXCEPTION 'Remove the equipment and add the right one'; END IF;
    IF NEW.status = 'Active' AND TG_OP = 'INSERT' THEN
        SELECT * INTO ev FROM equipment_view WHERE id = NEW.equipment_id;
        IF ev.site_id <> b.site_id THEN RAISE EXCEPTION '% belongs to another lab', ev.equipment_code; END IF;
        IF ev.availability <> 'Available' THEN RAISE EXCEPTION '% is % and cannot be used%', ev.equipment_code, lower(ev.availability), COALESCE(' (' || ev.tagged_for || ')', ''); END IF;
        IF ev.calibration_status = 'Deficient' THEN RAISE EXCEPTION '% is out of calibration and cannot be used', ev.equipment_code; END IF;
        IF EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = r.step_id AND status = 'Active')
           AND NOT EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = r.step_id AND status = 'Active' AND equipment_type_id = ev.equipment_type_id) THEN
            RAISE EXCEPTION '% is a %, which this step does not use', ev.equipment_code, ev.type_name;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON entry_equipment FOR EACH ROW EXECUTE FUNCTION entry_equipment_rules();

CREATE FUNCTION step_attachment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(NEW.step_run_id);
    PERFORM assert_step_open(NEW.step_run_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON step_attachment FOR EACH ROW EXECUTE FUNCTION step_attachment_rules();

CREATE FUNCTION batch_entry_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b test_batch; p batch_entry;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = NEW.batch_id;
    IF NEW.parent_entry_id IS NOT NULL THEN
        SELECT * INTO p FROM batch_entry WHERE id = NEW.parent_entry_id;
        IF p.batch_id <> NEW.batch_id OR p.entry_type <> 'Sample' THEN RAISE EXCEPTION 'A spike is made from a sample of the same batch'; END IF;
    END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' THEN RAISE EXCEPTION 'Entries are made by autobatch'; END IF;
    IF (to_jsonb(NEW) - '{parent_entry_id,record_version,modified_at,modified_by}'::text[]) <> (to_jsonb(OLD) - '{parent_entry_id,record_version,modified_at,modified_by}'::text[]) THEN
        RAISE EXCEPTION 'Only the sample a spike is made from can be changed here';
    END IF;
    IF NEW.qc_type NOT IN ('Matrix Spike','Matrix Spike Duplicate') THEN RAISE EXCEPTION 'Only matrix spikes are made from a sample'; END IF;
    PERFORM require_permission_at('testing.perform', b.site_id);
    IF EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b.id AND ws.step_type = 'Batching' AND r.status = 'Completed') THEN
        RAISE EXCEPTION 'Batching is completed; reopen it to change which sample is spiked';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON batch_entry FOR EACH ROW EXECUTE FUNCTION batch_entry_rules();

CREATE FUNCTION reprep_request_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Re-preps are asked for from the batch (signed, with a reason)';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON reprep_request FOR EACH ROW EXECUTE FUNCTION reprep_request_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON reanalysis_request FOR EACH ROW EXECUTE FUNCTION reprep_request_rules();

-------------------------------------------------------------------------------
-- 4. THE BACKLOG (POOL) AND AUTOBATCH
-------------------------------------------------------------------------------
CREATE VIEW test_pool_view AS
SELECT x.*, CASE WHEN x.kind = 'Re-prep' THEN 0 WHEN x.is_rush THEN 1 ELSE 2 END AS priority_rank,
       CASE WHEN x.kind = 'Re-prep' THEN 'Re-prep' WHEN x.is_rush THEN 'Rush' ELSE 'Standard' END AS priority
  FROM (
    SELECT rt.id AS requested_test_id, NULL::uuid AS reprep_request_id, 'New'::text AS kind, 1 AS replicates, NULL::text AS reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id AS sample_id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text AS rush_status,
           rt.rush_status IN ('Auto-accepted','Approved') AS is_rush, s.logged_at, rt.created_at AS pooled_at
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
      JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rt.status = 'In Pool'
       AND EXISTS (SELECT 1 FROM workflow_step ws WHERE ws.test_version_id = rt.test_version_id AND ws.status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id
                        WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled')
    UNION ALL
    SELECT rp.requested_test_id, rp.id, 'Re-prep', rp.replicates, rp.reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text,
           rt.rush_status IN ('Auto-accepted','Approved'), s.logged_at, rp.created_at
      FROM reprep_request rp JOIN requested_test rt ON rt.id = rp.requested_test_id JOIN sample s ON s.id = rt.sample_id
      JOIN lab_order o ON o.id = s.lab_order_id JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rp.status = 'Pooled' AND rt.status <> 'Cancelled'
  ) x;

-- Make a batch for a test version at a lab: from the given pool items, or (autobatch) the pool in priority order up to
-- the Batching step's maximum. Re-preps take one entry per replicate. QC entries follow the Batching step.
CREATE FUNCTION create_batch(p_site uuid, p_version uuid, p_items jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; bs workflow_step; v_max integer := 500; v_batch uuid; it record; pos integer := 0; n integer := 0;
        q jsonb; i integer; k integer; v_every integer; v_first uuid; samples uuid[] := '{}'; e uuid; v_label text; v_ent uuid;
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
    -- the samples, in priority order
    FOR it IN SELECT p.* FROM test_pool_view p
               WHERE p.site_id = p_site AND p.test_version_id = p_version
                 AND (p_items IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j
                        WHERE (j->>'requested_test_id')::uuid = p.requested_test_id AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text))
               ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code LOOP
        EXIT WHEN n + it.replicates > v_max;
        FOR i IN 1..it.replicates LOOP
            n := n + 1; pos := pos + 1;
            INSERT INTO batch_entry (batch_id, position, entry_type, requested_test_id, label, replicate_no, reprep_request_id)
            VALUES (v_batch, pos, 'Sample', it.requested_test_id,
                    COALESCE(it.sample_code, it.client_sample_id) || CASE WHEN it.replicates > 1 THEN ' (prep ' || i || ')' WHEN it.kind = 'Re-prep' THEN ' (re-prep)' ELSE '' END,
                    i, it.reprep_request_id) RETURNING id INTO e;
            samples := samples || e;
        END LOOP;
        IF it.reprep_request_id IS NOT NULL THEN UPDATE reprep_request SET status = 'Batched', batch_id = v_batch WHERE id = it.reprep_request_id; END IF;
    END LOOP;
    IF n = 0 THEN RAISE EXCEPTION 'Nothing in the pool for this test at this lab'; END IF;
    v_first := samples[1];
    -- QC entries: analytical "once" first (e.g. ICV), opening brackets, prep QC, then samples with brackets every N, spikes
    -- after their sample, closing brackets. Positions are the run order.
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
        END IF;   -- Daily controls are shared by the day's batches (WD-4)
    END LOOP;
    -- positions
    PERFORM batch_order(v_batch);
    -- one run per step
    INSERT INTO step_run (batch_id, step_id) SELECT v_batch, id FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    PERFORM set_testing_internal(false);
    RETURN v_batch;
END $$;

-- The run order: once-per-batch analytical QC, the first bracket, prep QC (blanks, LCS), then samples with a bracket
-- after every N and each matrix spike after its sample, then the last bracket
CREATE FUNCTION batch_order(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pos integer := 0; r record; sn integer := 0; v_every integer; v_groups integer; gi integer := 1; e record;
BEGIN
    -- brackets ("every N" QC, labelled CCV-1, CCV-2 ...) go in groups by their number: group 1 opens the run
    SELECT max((regexp_replace(label, '^.*-', ''))::int) INTO v_groups FROM batch_entry
     WHERE batch_id = p_batch AND entry_type = 'QC' AND label ~ '-[0-9]+$' AND status = 'Active';
    SELECT min(GREATEST(COALESCE((q->>'every_n')::int, 10), 1)) INTO v_every
      FROM test_batch b JOIN workflow_step ws ON ws.test_version_id = b.test_version_id AND ws.step_type = 'Batching' AND ws.status = 'Active',
           jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q WHERE b.id = p_batch AND q->>'frequency' = 'Every N';
    FOR r IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND qc_class = 'Analytical' AND NOT (label ~ '-[0-9]+$') ORDER BY position, label LOOP
        pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = r.id;
    END LOOP;
    IF v_groups IS NOT NULL THEN
        FOR r IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND label ~ '-1$' AND status = 'Active' ORDER BY position LOOP
            pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = r.id;
        END LOOP;
        gi := 2;
    END IF;
    FOR r IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND qc_class = 'Prep' AND parent_entry_id IS NULL AND NOT (label ~ '-[0-9]+$') ORDER BY position, label LOOP
        pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = r.id;
    END LOOP;
    FOR r IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'Sample' ORDER BY position LOOP
        pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = r.id;
        sn := sn + 1;
        FOR e IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND parent_entry_id = r.id ORDER BY qc_type, position LOOP
            pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = e.id;
        END LOOP;
        IF v_groups IS NOT NULL AND v_every IS NOT NULL AND sn % v_every = 0 AND gi < v_groups THEN
            FOR e IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND label ~ ('-' || gi || '$') AND status = 'Active' ORDER BY position LOOP
                pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = e.id;
            END LOOP;
            gi := gi + 1;
        END IF;
    END LOOP;
    WHILE v_groups IS NOT NULL AND gi <= v_groups LOOP
        FOR e IN SELECT id FROM batch_entry WHERE batch_id = p_batch AND entry_type = 'QC' AND label ~ ('-' || gi || '$') AND status = 'Active' ORDER BY position LOOP
            pos := pos + 1; UPDATE batch_entry SET position = pos WHERE id = e.id;
        END LOOP;
        gi := gi + 1;
    END LOOP;
END $$;

CREATE FUNCTION assign_batch(p_batch uuid, p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    PERFORM require_permission_at('testing.assign', b.site_id);
    IF NOT user_has_permission_at(p_user, 'testing.perform', b.site_id) THEN RAISE EXCEPTION 'That person cannot do bench work in this lab (testing.perform)'; END IF;
    PERFORM ensure_reason('Batch assigned');
    PERFORM set_testing_internal(true);
    UPDATE test_batch SET assigned_to = p_user WHERE id = p_batch;
    PERFORM set_testing_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 5. RESULTS AND QC VERDICTS (calculated live from the recorded data)
-------------------------------------------------------------------------------
-- A dilution's factor and final volume from what was added: each field (aliquot + diluent) multiplies the factor
CREATE FUNCTION dilution_factor(p_data jsonb) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE f jsonb; v numeric;   -- multiplied exactly (no logarithms), so 10 + 40 is exactly 5
BEGIN
    FOR f IN SELECT x FROM jsonb_array_elements(COALESCE(p_data->'fields', '[]')) x LOOP
        IF jnum_ok(f, 'aliquot', 0) AND (f->>'aliquot')::numeric > 0 THEN
            v := COALESCE(v, 1) * ((f->>'aliquot')::numeric + CASE WHEN jnum_ok(f, 'diluent', 0) THEN (f->>'diluent')::numeric ELSE 0 END) / (f->>'aliquot')::numeric;
        END IF;
    END LOOP;
    RETURN v;
END $$;
CREATE FUNCTION dilution_final_volume(p_data jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT (f->>'aliquot')::numeric + COALESCE((f->>'diluent')::numeric, 0)
      FROM jsonb_array_elements(COALESCE(p_data->'fields', '[]')) WITH ORDINALITY x(f, n) WHERE jnum_ok(f, 'aliquot', 0) AND (f->>'aliquot')::numeric > 0
     ORDER BY n DESC LIMIT 1
$$;

-- An analyte's concentration in a lot (its own analyte line), converted to the unit asked for (NULL if not convertible)
CREATE FUNCTION lot_analyte_conc(p_lot uuid, p_analyte uuid, p_unit text) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT la.concentration * unit_factor(la.concentration_unit, p_unit, 'Liquid')
      FROM lot_analyte la WHERE la.lot_id = p_lot AND la.analyte_id = p_analyte AND la.status = 'Active' AND la.concentration IS NOT NULL
     ORDER BY la.created_at DESC LIMIT 1
$$;

-- Calculated results: every calculation step, for every active entry, analyte and reading. "value" is unrounded;
-- "reported" follows the test's rounding and LOQ/LOD rules; "inputs" shows every token's value; "waiting" says what is missing.
CREATE FUNCTION batch_results(p_batch uuid)
RETURNS TABLE (entry_id uuid, analyte_id uuid, run_no integer, step_key text, is_final boolean, value numeric, reported text, inputs jsonb, waiting text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; e record; a record; cs record; tok text; k text; f text; ref workflow_step; rr step_run; vals jsonb; miss text;
        v numeric; formula text; runs integer; rn integer; calc jsonb := '{}'; final_key text; has_calc boolean; de record;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    has_calc := EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Calculation');
    -- the final calculation: the one no other calculation uses (else the last one)
    SELECT ws.step_key INTO final_key FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
     ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)) DESC, ws.sort_order DESC LIMIT 1;
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' ORDER BY be.position LOOP
        runs := COALESCE((SELECT max(entry_runs(r.id, e.id)) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
                           WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry'), 1);
        FOR a IN SELECT tva.* FROM test_version_analyte tva WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active' ORDER BY tva.sort_order LOOP
            FOR rn IN 1..runs LOOP
                IF NOT has_calc THEN
                    -- no calculation: the result is the reading
                    SELECT ev.value_num, ws.step_key INTO v, k FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
                     WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry' AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = rn AND ev.status = 'Active'
                     ORDER BY ws.sort_order DESC LIMIT 1;
                    entry_id := e.id; analyte_id := a.analyte_id; run_no := rn; step_key := k; is_final := true; value := v;
                    reported := report_value(v, a.id); inputs := '{}'; waiting := CASE WHEN v IS NULL THEN 'Waiting for the reading' END;
                    RETURN NEXT; CONTINUE;
                END IF;
                calc := '{}';
                FOR cs IN SELECT ws.* FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
                           ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)), ws.sort_order LOOP
                    formula := COALESCE((SELECT o->>'formula' FROM jsonb_array_elements(COALESCE(cs.config->'overrides', '[]')) o WHERE o->>'analyte_id' = a.analyte_id::text LIMIT 1),
                                        cs.config->>'formula');
                    vals := '{}'; miss := NULL;
                    FOREACH tok IN ARRAY formula_tokens(formula) LOOP
                        k := split_part(tok, '.', 1); f := split_part(tok, '.', 2);
                        SELECT * INTO ref FROM workflow_step WHERE test_version_id = b.test_version_id AND workflow_step.step_key = k AND status = 'Active';
                        SELECT * INTO rr FROM step_run WHERE batch_id = p_batch AND step_id = ref.id;
                        v := NULL;
                        IF ref.step_type = 'Weighing' THEN
                            SELECT ev.value_num INTO v FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id IS NULL AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1;
                        ELSIF ref.step_type = 'Dilution' THEN
                            SELECT CASE f WHEN 'factor' THEN dilution_factor(ev.data) ELSE dilution_final_volume(ev.data) END INTO v
                              FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id IS NULL AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1;
                        ELSIF ref.step_type = 'Preparation' THEN
                            v := CASE WHEN (rr.fields->>f) ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN (rr.fields->>f)::numeric END;
                        ELSIF ref.step_type = 'Data Entry' THEN
                            SELECT ev.value_num INTO v FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = LEAST(rn, entry_runs(rr.id, e.id)) AND ev.status = 'Active';
                        ELSIF ref.step_type = 'Calculation' THEN
                            v := (calc->>k)::numeric;
                        ELSIF ref.step_type = 'Hold Point' THEN
                            -- the named sibling test's result on the same sample (its latest final result)
                            SELECT r2.value INTO v FROM requested_test rt0 JOIN batch_entry e0 ON e0.requested_test_id = rt0.id
                              JOIN requested_test rt2 ON rt2.sample_id = rt0.sample_id AND rt2.test_id = (ref.config->>'test_id')::uuid AND rt2.status <> 'Cancelled'
                              JOIN batch_entry e2 ON e2.requested_test_id = rt2.id AND e2.status = 'Active'
                              CROSS JOIN LATERAL batch_results(e2.batch_id) r2
                             WHERE e0.id = e.id AND r2.entry_id = e2.id AND r2.is_final AND r2.value IS NOT NULL LIMIT 1;
                        END IF;
                        IF v IS NULL THEN miss := COALESCE(miss || ', ', '') || '{' || tok || '}';
                        ELSE vals := vals || jsonb_build_object(tok, v);
                        END IF;
                    END LOOP;
                    v := NULL;
                    IF miss IS NULL THEN
                        BEGIN v := formula_eval(formula, vals); EXCEPTION WHEN others THEN miss := SQLERRM; END;
                    END IF;
                    IF v IS NOT NULL THEN calc := calc || jsonb_build_object(cs.step_key, v); END IF;
                    entry_id := e.id; analyte_id := a.analyte_id; run_no := rn; step_key := cs.step_key; is_final := (cs.step_key = final_key);
                    value := v; reported := CASE WHEN cs.step_key = final_key THEN report_value(v, a.id) END; inputs := vals;
                    waiting := CASE WHEN miss IS NULL THEN NULL WHEN miss LIKE '{%' THEN 'Waiting for ' || miss ELSE miss END;
                    RETURN NEXT;
                END LOOP;
            END LOOP;
        END LOOP;
    END LOOP;
END $$;

-- QC verdicts per QC entry, criterion and analyte (latest reading): Pass, Fail, Waiting (data still missing) or
-- Not judged (with the reason). Limits come from qc_criteria() (the test version's per-analyte QC table).
CREATE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; q record; e record; res jsonb := '{}'; r record; m numeric; v_final numeric; v_parent numeric; v_exp numeric; v_true numeric;
        v_unit text; de workflow_step; dr step_run; v_weight numeric; v_lim numeric; tva test_version_analyte; v_note text; v_other numeric; mat record; c numeric;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    -- final results (latest reading) per entry and analyte
    FOR r IN SELECT x.entry_id, x.analyte_id, x.value FROM batch_results(p_batch) x WHERE x.is_final
              AND x.run_no = (SELECT max(y.run_no) FROM batch_results(p_batch) y WHERE y.entry_id = x.entry_id AND y.analyte_id = x.analyte_id AND y.is_final) LOOP
        IF r.value IS NOT NULL THEN res := res || jsonb_build_object(r.entry_id || ':' || r.analyte_id, r.value); END IF;
    END LOOP;
    SELECT * INTO de FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Data Entry' ORDER BY sort_order DESC LIMIT 1;
    SELECT * INTO dr FROM step_run WHERE batch_id = p_batch AND step_id = de.id;
    v_unit := de.config->>'value_unit';
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.entry_type = 'QC' ORDER BY be.position LOOP
        FOR q IN SELECT c2.* FROM qc_criteria(b.test_version_id) c2 WHERE c2.qc_type = e.qc_type LOOP
            entry_id := e.id; label := e.label; qc_type := e.qc_type; limit_type := q.limit_type; analyte_id := q.analyte_id; analyte_name := q.analyte_name;
            min_value := q.min_value; max_value := q.max_value; measured := NULL; verdict := NULL; note := NULL;
            limit_text := CASE WHEN q.min_value IS NOT NULL AND q.max_value IS NOT NULL THEN q.min_value || ' to ' || q.max_value
                               WHEN q.max_value IS NOT NULL THEN 'at most ' || q.max_value WHEN q.limit_ref IS NOT NULL THEN 'below ' || q.limit_ref
                               WHEN q.min_value IS NOT NULL THEN 'at least ' || q.min_value ELSE q.limit_type END;
            IF NOT q.applies THEN verdict := 'Not judged'; note := 'This QC does not judge ' || q.analyte_name; RETURN NEXT; CONTINUE; END IF;
            SELECT * INTO tva FROM test_version_analyte WHERE test_version_id = b.test_version_id AND test_version_analyte.analyte_id = q.analyte_id AND status = 'Active';
            v_final := (res->>(e.id || ':' || q.analyte_id))::numeric;
            IF q.limit_type = 'Recovery %' AND e.qc_class = 'Analytical' THEN
                -- a check standard: the reading against the standard's concentration (in the reading's unit)
                SELECT ev.value_num INTO m FROM entry_value ev WHERE ev.step_run_id = dr.id AND ev.entry_id = e.id AND ev.analyte_id = q.analyte_id AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1;
                SELECT lot_analyte_conc(em.lot_id, q.analyte_id, v_unit) INTO v_true FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                 WHERE sr.batch_id = p_batch AND em.entry_id = e.id AND em.purpose = 'Standard' AND em.status = 'Active' ORDER BY em.created_at DESC LIMIT 1;
                IF m IS NULL THEN verdict := 'Waiting'; note := 'No reading yet';
                ELSIF v_true IS NULL OR v_true = 0 THEN verdict := 'Not judged'; note := 'Record the standard used (with this analyte''s concentration in ' || COALESCE(v_unit, 'the reading''s unit') || ')';
                ELSE measured := round(m / v_true * 100, 1); note := 'reading ' || m || ' / standard ' || round(v_true, 6) || ' ' || COALESCE(v_unit, '');
                END IF;
            ELSIF q.limit_type = 'Recovery %' THEN
                -- a spike: the amount spiked (lot concentration x volume) per sample weight, in the analyte's reporting unit
                SELECT ev.value_num INTO v_weight FROM entry_value ev JOIN step_run sr ON sr.id = ev.step_run_id JOIN workflow_step ws ON ws.id = sr.step_id
                 WHERE sr.batch_id = p_batch AND ws.step_type = 'Weighing' AND ev.entry_id = e.id AND ev.analyte_id IS NULL AND ev.status = 'Active' ORDER BY ev.run_no DESC LIMIT 1;
                v_exp := NULL; v_note := NULL;
                FOR mat IN SELECT em.* FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                            WHERE sr.batch_id = p_batch AND em.entry_id = e.id AND em.purpose = 'Spike' AND em.status = 'Active' LOOP
                    c := lot_analyte_conc(mat.lot_id, q.analyte_id, 'mg/L') * mat.volume * unit_factor(COALESCE(mat.volume_unit, 'mL'), 'mL') / 1000;   -- mg added
                    IF c IS NULL THEN v_note := 'The spiking solution''s ' || q.analyte_name || ' concentration cannot be converted to mg/L'; ELSE v_exp := COALESCE(v_exp, 0) + c; END IF;
                END LOOP;
                IF v_exp IS NOT NULL AND v_weight IS NOT NULL AND v_weight > 0 THEN
                    v_exp := v_exp / (v_weight / 1000) * unit_factor('mg/kg', tva.reporting_unit, 'Solid');   -- mg per kg, in the reporting unit
                END IF;
                IF e.qc_type IN ('Matrix Spike','Matrix Spike Duplicate') THEN v_parent := (res->>(e.parent_entry_id || ':' || q.analyte_id))::numeric; ELSE v_parent := 0; END IF;
                IF v_final IS NULL THEN verdict := 'Waiting'; note := 'No result yet';
                ELSIF v_exp IS NULL OR v_weight IS NULL THEN verdict := 'Not judged'; note := COALESCE(v_note, 'Record the spike (lot and volume) and the weight');
                ELSIF v_parent IS NULL THEN verdict := 'Waiting'; note := 'The spiked sample has no result yet';
                ELSIF v_exp = 0 THEN verdict := 'Not judged'; note := 'The amount spiked is zero';
                ELSE measured := round((v_final - v_parent) / v_exp * 100, 1);
                     note := 'found ' || round(v_final, 6) || CASE WHEN v_parent <> 0 THEN ' - sample ' || round(v_parent, 6) ELSE '' END || ' / spiked ' || round(v_exp, 6) || ' ' || COALESCE(tva.reporting_unit, '');
                END IF;
            ELSIF q.limit_type = 'RPD' THEN
                SELECT (res->>(x.id || ':' || q.analyte_id))::numeric INTO v_other FROM batch_entry x
                 WHERE x.batch_id = p_batch AND x.status = 'Active' AND x.qc_type = 'Matrix Spike' AND x.parent_entry_id = e.parent_entry_id LIMIT 1;
                IF e.qc_type <> 'Matrix Spike Duplicate' THEN verdict := 'Not judged'; note := 'RPD is judged on the matrix spike duplicate';
                ELSIF v_final IS NULL OR v_other IS NULL THEN verdict := 'Waiting'; note := 'Needs the spike and its duplicate';
                ELSIF v_final + v_other = 0 THEN measured := 0;
                ELSE measured := round(abs(v_final - v_other) / ((v_final + v_other) / 2) * 100, 1); note := 'duplicate ' || round(v_final, 6) || ' vs spike ' || round(v_other, 6);
                END IF;
            ELSIF q.limit_type = 'Blank threshold' THEN
                v_lim := COALESCE(q.max_value, CASE q.limit_ref WHEN 'LOQ' THEN tva.loq WHEN '½ LOQ' THEN tva.loq / 2 WHEN 'LOD' THEN tva.lod END);
                IF v_final IS NULL THEN verdict := 'Waiting'; note := 'No result yet';
                ELSIF v_lim IS NULL THEN verdict := 'Not judged'; note := 'The analyte has no ' || COALESCE(q.limit_ref, 'limit');
                ELSE measured := round(v_final, 6); max_value := v_lim; verdict := CASE WHEN v_final < v_lim THEN 'Pass' ELSE 'Fail' END;
                     note := 'blank ' || round(v_final, 6) || ' against ' || round(v_lim, 6) || ' ' || COALESCE(tva.reporting_unit, '');
                END IF;
            ELSE
                verdict := 'Not judged'; note := q.limit_type || ' is recorded and judged from a later slice';
            END IF;
            IF verdict IS NULL THEN
                verdict := CASE WHEN measured IS NULL THEN 'Waiting'
                                WHEN (q.min_value IS NOT NULL AND measured < q.min_value) OR (q.max_value IS NOT NULL AND measured > q.max_value) THEN 'Fail' ELSE 'Pass' END;
            END IF;
            RETURN NEXT;
        END LOOP;
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 6. COMPLETING, REOPENING, WITNESSES, RE-ANALYSIS, RE-PREP
-------------------------------------------------------------------------------
-- What is still missing before a step can be completed (empty = ready)
CREATE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE r step_run; ws workflow_step; b test_batch; n integer; e record; a record; fl jsonb; rn integer; needs_eq boolean; ids jsonb;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF EXISTS (SELECT 1 FROM workflow_step_dependency d JOIN step_run p ON p.step_id = d.depends_on_step_id AND p.batch_id = r.batch_id
                WHERE d.step_id = r.step_id AND d.status = 'Active' AND p.status <> 'Completed') THEN
        RETURN QUERY SELECT 'The steps before it are not completed yet'; RETURN;
    END IF;
    needs_eq := EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = ws.id AND status = 'Active')
                AND (ws.step_type IN ('Weighing','Incubation') OR (ws.step_type = 'Data Entry' AND COALESCE(ws.config->>'require_attachment', 'true') <> 'false'));
    CASE ws.step_type
    WHEN 'Batching' THEN
        IF NOT EXISTS (SELECT 1 FROM batch_entry WHERE batch_id = b.id AND entry_type = 'Sample' AND status = 'Active') THEN RETURN QUERY SELECT 'The batch has no samples'; END IF;
        RETURN QUERY SELECT e2.label || ': choose the sample it is made from' FROM batch_entry e2
          WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.qc_type IN ('Matrix Spike','Matrix Spike Duplicate') AND e2.parent_entry_id IS NULL;
    WHEN 'Weighing' THEN
        RETURN QUERY SELECT e2.label || ': no weight' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num IS NOT NULL AND ev.status = 'Active')
          ORDER BY e2.position;
        IF needs_eq THEN
            RETURN QUERY SELECT e2.label || ': record the balance used' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
              AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active' AND (q.entry_id = e2.id OR q.entry_id IS NULL))
              ORDER BY e2.position;
        END IF;
    WHEN 'Preparation' THEN
        FOR fl IN SELECT * FROM jsonb_array_elements(COALESCE(ws.config->'fields', '[]')) LOOP
            IF COALESCE(btrim(r.fields->>field_key(fl->>'label')), '') = '' THEN RETURN QUERY SELECT 'Fill in ' || (fl->>'label'); END IF;
        END LOOP;
        IF needs_eq AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active') THEN RETURN QUERY SELECT 'Record the equipment used'; END IF;
    WHEN 'Dilution' THEN
        RETURN QUERY SELECT e2.label || ': no dilution recorded' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.status = 'Active' AND dilution_factor(ev.data) IS NOT NULL)
          ORDER BY e2.position;
    WHEN 'Data Entry' THEN
        ids := ws.config->'analyte_ids';
        FOR e IN SELECT * FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' ORDER BY e2.position LOOP
            n := 0;
            FOR a IN SELECT tva.analyte_id, an.analyte_name FROM test_version_analyte tva JOIN analyte an ON an.id = tva.analyte_id
                      WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active'
                        AND (ids IS NULL OR jsonb_array_length(ids) = 0 OR ids ? tva.analyte_id::text) LOOP
                FOR rn IN 1..entry_runs(r.id, e.id) LOOP
                    IF NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = rn
                                    AND ev.status = 'Active' AND (ev.value_num IS NOT NULL OR ev.value_text IS NOT NULL)) THEN n := n + 1; END IF;
                END LOOP;
            END LOOP;
            IF n > 0 THEN RETURN QUERY SELECT e.label || ': ' || n || ' reading' || CASE WHEN n > 1 THEN 's' ELSE '' END || ' missing'; END IF;
        END LOOP;
        IF COALESCE(ws.config->>'require_attachment', 'true') <> 'false' AND NOT EXISTS (SELECT 1 FROM step_attachment WHERE step_run_id = r.id AND status = 'Active') THEN
            RETURN QUERY SELECT 'Attach the raw data (the instrument export)';
        END IF;
        IF needs_eq AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active') THEN RETURN QUERY SELECT 'Record the instrument used'; END IF;
        -- a spiked QC (its criteria judge a recovery) needs the spike recorded (lot and volume) somewhere in the batch
        RETURN QUERY SELECT x.label || ': record the spike (lot and volume)' FROM batch_entry x WHERE x.batch_id = b.id AND x.status = 'Active' AND x.qc_class = 'Prep'
          AND EXISTS (SELECT 1 FROM qc_criteria(b.test_version_id) q WHERE q.qc_type = x.qc_type AND q.limit_type = 'Recovery %' AND q.applies)
          AND NOT EXISTS (SELECT 1 FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id WHERE sr.batch_id = b.id AND em.entry_id = x.id AND em.purpose = 'Spike' AND em.status = 'Active')
          ORDER BY x.position;
        RETURN QUERY SELECT x.label || ': record the check standard used' FROM batch_entry x WHERE x.batch_id = b.id AND x.status = 'Active' AND x.qc_class = 'Analytical'
          AND x.qc_type IN ('ICV','CCV') AND NOT EXISTS (SELECT 1 FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                                                         WHERE sr.batch_id = b.id AND em.entry_id = x.id AND em.purpose = 'Standard' AND em.status = 'Active');
    WHEN 'Calculation' THEN
        SELECT count(*) INTO n FROM batch_results(b.id) x JOIN batch_entry be ON be.id = x.entry_id
         WHERE x.step_key = ws.step_key AND x.waiting IS NOT NULL AND (be.entry_type = 'Sample' OR be.qc_class = 'Prep');
        IF n > 0 THEN RETURN QUERY SELECT n || ' result' || CASE WHEN n > 1 THEN 's are' ELSE ' is' END || ' still waiting for data'; END IF;
    WHEN 'Hold Point' THEN
        RETURN QUERY SELECT 'Waits for ' || (SELECT test_name FROM test WHERE id = (ws.config->>'test_id')::uuid) || ' on the same sample (its result is not ready)'
         WHERE EXISTS (SELECT 1 FROM batch_results(b.id) x WHERE x.waiting LIKE '%{' || ws.step_key || '.result}%');
    WHEN 'QC Review' THEN RETURN QUERY SELECT 'QC Review is done by a reviewer (WD-3)';
    ELSE RETURN QUERY SELECT ws.step_type || ' steps are done at the bench from WD-4 (micro)';
    END CASE;
END $$;

-- A witness signs for a step (called by the server after checking the witness's user ID and password)
CREATE FUNCTION sign_witness(p_witness uuid, p_action text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE me text := current_setting('lims.user_id', true); sig text := current_setting('lims.signature_id', true); v uuid;
BEGIN
    IF p_witness::text = me THEN RAISE EXCEPTION 'The witness must be someone else'; END IF;
    PERFORM set_config('lims.user_id', p_witness::text, true);
    v := sign_action('Witnessed by', p_action, 'Testing', NULL);
    PERFORM set_config('lims.user_id', me, true);
    PERFORM set_config('lims.signature_id', sig, true);
    RETURN v;
END $$;

CREATE FUNCTION complete_step(p_step_run uuid, p_witness_signature uuid DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; b test_batch; first_problem text; n integer; w signature_event; mode text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run FOR UPDATE;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF r.status = 'Completed' THEN RAISE EXCEPTION '"%" is already completed', ws.step_name; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_signed('complete a step');
    SELECT count(*), min(problem) INTO n, first_problem FROM step_run_missing(r.id);
    IF n > 0 THEN RAISE EXCEPTION '"%" cannot be completed yet (% thing% to do), e.g.: %', ws.step_name, n, CASE WHEN n > 1 THEN 's' ELSE '' END, first_problem; END IF;
    mode := COALESCE(ws.config->>'witness', 'None');
    IF p_witness_signature IS NOT NULL THEN
        SELECT * INTO w FROM signature_event WHERE id = p_witness_signature;
        IF w.id IS NULL OR w.meaning <> 'Witnessed by' OR w.user_id = current_app_user() OR w.signed_at < clock_timestamp() - interval '30 minutes' THEN
            RAISE EXCEPTION 'The witness signature is not valid for this step';
        END IF;
        IF NOT user_has_permission_at(w.user_id, 'testing.perform', b.site_id) THEN RAISE EXCEPTION 'The witness must be able to do bench work in this lab (testing.perform)'; END IF;
    ELSIF mode = 'Required' THEN
        RAISE EXCEPTION '"%" needs a witness: tick Witnessed and have the witness sign', ws.step_name;
    END IF;
    PERFORM ensure_reason('Step completed');
    PERFORM set_testing_internal(true);
    UPDATE step_run SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(),
           signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, witness_id = w.user_id, witness_signature_id = w.id
     WHERE id = r.id;
    -- every step before QC Review completed: the batch waits for review
    UPDATE test_batch SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM step_run sr JOIN workflow_step s2 ON s2.id = sr.step_id
                                                        WHERE sr.batch_id = b.id AND s2.step_type <> 'QC Review' AND sr.status <> 'Completed')
                                       THEN 'Awaiting Review' ELSE 'In Progress' END::batch_status
     WHERE id = b.id;
    PERFORM set_testing_internal(false);
END $$;

-- Reopen a completed step to correct its data (signed, with a reason); the steps after it must not be completed
CREATE FUNCTION reopen_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; nx text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF r.status <> 'Completed' THEN RAISE EXCEPTION '"%" is not completed', ws.step_name; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_signed('reopen a step');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the step is reopened'; END IF;
    SELECT string_agg(s2.step_name, ', ') INTO nx FROM workflow_step_dependency d JOIN workflow_step s2 ON s2.id = d.step_id
      JOIN step_run p ON p.step_id = d.step_id AND p.batch_id = r.batch_id WHERE d.depends_on_step_id = r.step_id AND d.status = 'Active' AND p.status = 'Completed';
    IF nx IS NOT NULL THEN RAISE EXCEPTION 'Reopen the steps after it first (%)', nx; END IF;
    PERFORM set_testing_internal(true);
    UPDATE step_run SET status = 'In progress' WHERE id = r.id;
    UPDATE test_batch SET status = 'In Progress' WHERE id = r.batch_id AND status = 'Awaiting Review';
    PERFORM set_testing_internal(false);
END $$;

-- Re-analysis: the same preparation read again, 1 to 3 more readings (signed, with a reason). A completed reading step
-- (and the calculations after it) reopens so the new readings can be entered.
CREATE FUNCTION request_reanalysis(p_step_run uuid, p_entries uuid[], p_runs integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; e uuid; n integer := 0;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF ws.step_type <> 'Data Entry' THEN RAISE EXCEPTION 'Re-analysis is asked for at a reading (Data Entry) step'; END IF;
    IF p_runs NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Choose single, duplicate or triplicate'; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_signed('ask for a re-analysis');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the sample is re-analysed'; END IF;
    PERFORM set_testing_internal(true);
    FOREACH e IN ARRAY p_entries LOOP
        IF NOT EXISTS (SELECT 1 FROM batch_entry WHERE id = e AND batch_id = r.batch_id AND status = 'Active') THEN RAISE EXCEPTION 'An entry is not active in this batch'; END IF;
        IF entry_runs(r.id, e) + p_runs > 10 THEN RAISE EXCEPTION 'At most 10 readings per entry'; END IF;
        INSERT INTO reanalysis_request (step_run_id, entry_id, runs, first_run_no, reason, signature_id)
        VALUES (r.id, e, p_runs, entry_runs(r.id, e) + 1, current_reason(), NULLIF(current_setting('lims.signature_id', true), '')::uuid);
        n := n + 1;
    END LOOP;
    UPDATE step_run SET status = 'In progress' WHERE batch_id = r.batch_id AND status = 'Completed'
       AND (id = r.id OR step_id IN (SELECT s2.id FROM workflow_step s2 WHERE s2.test_version_id = ws.test_version_id AND s2.step_type = 'Calculation'
                                      AND ws.id IN (SELECT step_id FROM step_ancestors(s2.id))));
    UPDATE test_batch SET status = 'In Progress' WHERE id = r.batch_id AND status = 'Awaiting Review';
    PERFORM set_testing_internal(false);
    RETURN n;
END $$;

-- Re-prep: the sample goes back to the top of the pool for 1 to 3 new preparations in a new batch (signed, with a
-- reason); its entry here is superseded and keeps its data
CREATE FUNCTION request_reprep(p_entries uuid[], p_replicates integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE e batch_entry; x uuid; n integer := 0; b test_batch;
BEGIN
    IF p_replicates NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Choose single, duplicate or triplicate'; END IF;
    PERFORM assert_signed('ask for a re-prep');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the sample is re-prepared'; END IF;
    FOREACH x IN ARRAY p_entries LOOP
        SELECT * INTO e FROM batch_entry WHERE id = x;
        SELECT * INTO b FROM test_batch WHERE id = e.batch_id;
        IF e.entry_type <> 'Sample' THEN RAISE EXCEPTION '% is a QC sample; QC is made again with the new batch', e.label; END IF;
        IF e.status <> 'Active' THEN RAISE EXCEPTION '% is already superseded', e.label; END IF;
        PERFORM require_permission_at('testing.perform', b.site_id);
        IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is %', b.batch_code, b.status; END IF;
        PERFORM set_testing_internal(true);
        INSERT INTO reprep_request (requested_test_id, origin_entry_id, replicates, reason, signature_id)
        VALUES (e.requested_test_id, e.id, p_replicates, current_reason(), NULLIF(current_setting('lims.signature_id', true), '')::uuid);
        UPDATE batch_entry SET status = 'Superseded', superseded_reason = 'Re-prep: ' || current_reason() WHERE id = e.id;
        PERFORM set_testing_internal(false);
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 7. VIEWS, AUDIT REFERENCES, CANNED REASONS MODULE
-------------------------------------------------------------------------------
CREATE VIEW test_batch_view AS
SELECT b.*, s.site_code, t.test_code, t.test_name, v.version_no, d.department_code, au.full_name AS assigned_name,
       (SELECT count(*) FROM batch_entry e WHERE e.batch_id = b.id AND e.entry_type = 'Sample' AND e.status = 'Active') AS sample_count,
       (SELECT count(*) FROM batch_entry e WHERE e.batch_id = b.id AND e.entry_type = 'QC' AND e.status = 'Active') AS qc_count,
       (SELECT count(*) FROM step_run r WHERE r.batch_id = b.id AND r.status = 'Completed') AS steps_done,
       (SELECT count(*) FROM step_run r WHERE r.batch_id = b.id) AS steps_total,
       (SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
         WHERE r.batch_id = b.id AND r.status <> 'Completed'
           AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency dd JOIN step_run p ON p.step_id = dd.depends_on_step_id AND p.batch_id = b.id
                            WHERE dd.step_id = ws.id AND dd.status = 'Active' AND p.status <> 'Completed')
         ORDER BY ws.sort_order LIMIT 1) AS next_step,
       (SELECT min(rt.due_date) FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = b.id AND e.status = 'Active') AS earliest_due
  FROM test_batch b JOIN lab_site s ON s.id = b.site_id JOIN test t ON t.id = b.test_id JOIN test_version v ON v.id = b.test_version_id
  LEFT JOIN department d ON d.id = b.department_id JOIN app_user au ON au.id = b.assigned_to;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice16;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_batch uuid;
BEGIN
    CASE p_table
    WHEN 'test_batch' THEN RETURN jsonb_build_object('label', 'Batch ' || (r->>'batch_code'), 'link', '#/testing/batches/' || p_id);
    WHEN 'batch_entry' THEN RETURN jsonb_build_object('label', 'Batch entry ' || (r->>'label') || ' in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''),
        'link', '#/testing/batches/' || (r->>'batch_id'));
    WHEN 'step_run' THEN RETURN jsonb_build_object('label', 'Step ' || COALESCE((SELECT step_name FROM workflow_step WHERE id = (r->>'step_id')::uuid), '') || ' of '
        || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''), 'link', '#/testing/batches/' || (r->>'batch_id') || '?step=' || (r->>'step_id'));
    WHEN 'entry_value', 'entry_material', 'entry_equipment', 'step_attachment', 'reanalysis_request' THEN
        SELECT sr.batch_id INTO v_batch FROM step_run sr WHERE sr.id = (r->>'step_run_id')::uuid;
        RETURN jsonb_build_object('label', CASE p_table WHEN 'entry_value' THEN 'Value' WHEN 'entry_material' THEN 'Material used' WHEN 'entry_equipment' THEN 'Equipment used'
                                                        WHEN 'step_attachment' THEN 'Raw data file' ELSE 'Re-analysis' END
            || COALESCE(' for ' || (SELECT label FROM batch_entry WHERE id = (r->>'entry_id')::uuid), '') || ' in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = v_batch), ''),
            'link', '#/testing/batches/' || v_batch);
    WHEN 'reprep_request' THEN RETURN jsonb_build_object('label', 'Re-prep of ' || COALESCE((SELECT label FROM batch_entry WHERE id = (r->>'origin_entry_id')::uuid), ''), 'link', '#/testing');
    ELSE RETURN audit_record_ref_slice16(p_table, p_id, r);
    END CASE;
END $$;
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Admin'));

SELECT set_config('lims.group_sync', '', true);
COMMIT;
