-- LIMS3 schema, migration 019: WORKFLOW DESIGNER, WD-4: micro steps at the bench, daily controls, split-off requests
-- Built by Claude 2026-10-13 while Alex was away, on his instruction to make the decisions and list the questions
-- (vault: "Decision - Micro Bench Build Choices", Proposed). Irvine practice from "Context - AAL Irvine Micro SOP Review".
--  - Daily QC: one set per test per lab per day. The day's first batch holds the controls and records their data;
--    later batches that day get linked entries that show the same verdicts (and need no data of their own).
--  - Plating/Inoculation: the plates per entry (whole numbers; 0 = not plated) and the levels plated, and the media lot
--    (Media, amount used comes off its stock) for every plated entry.
--  - Incubation: loads. Each load has its incubator (available, in calibration, of a type the step names), the entries
--    it holds (all, or the selected rows), time in, time out and the temperature read. Outside the duration window or
--    the temperature target, the load needs a note explaining it before the step can be completed (not refused).
--  - Qualitative readings use the analyte's own values (ND / ND* / D* / D). Positive and negative controls are judged:
--    Presence (a "found" value or a count above 0), Absence (the opposite), Identified (an identification recorded).
--  - A positive control "made from strains" needs a Microbiological Strain lot recorded (purpose Strain).
--  - Split off Test: completing the step raises a split-off request for each sample with a finding (or every sample
--    when the step says Always). The customer's consent is recorded (Irvine sends identification out with consent);
--    the test is then ordered on the sample as usual and the request shows Ordered.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

ALTER TYPE material_purpose ADD VALUE IF NOT EXISTS 'Strain';
ALTER TABLE batch_entry ADD COLUMN daily_of_entry_id uuid REFERENCES batch_entry(id);

-------------------------------------------------------------------------------
-- INCUBATION LOADS
-------------------------------------------------------------------------------
CREATE TABLE incubation_load (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id    uuid NOT NULL REFERENCES step_run(id),
    equipment_id   uuid NOT NULL REFERENCES equipment(id),
    entry_ids      uuid[],                      -- the entries in this load; empty = the whole batch
    time_in        timestamptz NOT NULL,
    time_out       timestamptz,
    temperature    numeric,                     -- °C read at time out (or in)
    note           text,                        -- why a load outside its window or temperature is acceptable
    status         record_status NOT NULL DEFAULT 'Active',
    record_version integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at    timestamptz NOT NULL DEFAULT now(),
    modified_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('incubation_load', false);
CREATE FUNCTION incubation_load_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; ws workflow_step; ev record;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF TG_OP = 'UPDATE' AND NEW.step_run_id <> OLD.step_run_id THEN RAISE EXCEPTION 'A load cannot move to another step'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    IF ws.step_type <> 'Incubation' THEN RAISE EXCEPTION 'Incubator loads belong to an Incubation step'; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF TG_OP = 'INSERT' OR NEW.equipment_id <> OLD.equipment_id THEN
        SELECT * INTO ev FROM equipment_view WHERE id = NEW.equipment_id;
        IF ev.site_id <> b.site_id THEN RAISE EXCEPTION '% belongs to another lab', ev.equipment_code; END IF;
        IF ev.availability <> 'Available' THEN RAISE EXCEPTION '% is % and cannot be used%', ev.equipment_code, lower(ev.availability), COALESCE(' (' || ev.tagged_for || ')', ''); END IF;
        IF ev.calibration_status = 'Deficient' THEN RAISE EXCEPTION '% is out of calibration and cannot be used', ev.equipment_code; END IF;
        IF EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = ws.id AND status = 'Active')
           AND NOT EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = ws.id AND status = 'Active' AND equipment_type_id = ev.equipment_type_id) THEN
            RAISE EXCEPTION '% is a %, which this step does not use', ev.equipment_code, ev.type_name;
        END IF;
    END IF;
    IF NEW.entry_ids IS NOT NULL AND cardinality(NEW.entry_ids) = 0 THEN NEW.entry_ids := NULL; END IF;
    IF NEW.entry_ids IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(NEW.entry_ids) x WHERE NOT EXISTS (SELECT 1 FROM batch_entry e WHERE e.id = x AND e.batch_id = b.id)) THEN
        RAISE EXCEPTION 'An entry of the load is not in this batch';
    END IF;
    IF NEW.time_out IS NOT NULL AND NEW.time_out <= NEW.time_in THEN RAISE EXCEPTION 'Time out must be after time in'; END IF;
    IF NEW.time_in > clock_timestamp() + interval '5 minutes' OR NEW.time_out > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'A time cannot be in the future'; END IF;
    NEW.note := NULLIF(btrim(NEW.note), '');
    IF TG_OP = 'UPDATE' AND current_reason() IS NULL AND (NEW.time_in <> OLD.time_in OR (OLD.time_out IS NOT NULL AND NEW.time_out IS DISTINCT FROM OLD.time_out)
       OR (OLD.temperature IS NOT NULL AND NEW.temperature IS DISTINCT FROM OLD.temperature) OR NEW.equipment_id <> OLD.equipment_id
       OR NEW.entry_ids IS DISTINCT FROM OLD.entry_ids OR NEW.status <> OLD.status) THEN
        RAISE EXCEPTION 'Changing a recorded load is a correction: give the reason';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON incubation_load FOR EACH ROW EXECUTE FUNCTION incubation_load_rules();
CREATE FUNCTION incubation_load_started() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM step_run WHERE id = NEW.step_run_id AND status = 'Not started') THEN
        PERFORM set_testing_internal(true);
        UPDATE step_run SET status = 'In progress' WHERE id = NEW.step_run_id;
        UPDATE test_batch SET status = 'In Progress' WHERE id = (SELECT batch_id FROM step_run WHERE id = NEW.step_run_id) AND status = 'Open';
        PERFORM set_testing_internal(false);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_started AFTER INSERT ON incubation_load FOR EACH ROW EXECUTE FUNCTION incubation_load_started();

-- A load's duration (in the step's unit) and whether it is outside the window or the temperature target
CREATE VIEW incubation_load_view AS
SELECT x.*, NULLIF(concat_ws('; ',
         CASE WHEN x.duration IS NOT NULL AND ((x.window_min IS NOT NULL AND x.duration < x.window_min) OR (x.window_max IS NOT NULL AND x.duration > x.window_max))
              THEN 'incubated ' || round(x.duration, 1) || ' ' || x.duration_unit || ', outside ' || COALESCE(x.window_min::text, '') || ' to ' || COALESCE(x.window_max::text, '') || ' ' || x.duration_unit END,
         CASE WHEN x.temperature IS NOT NULL AND x.temp_c IS NOT NULL AND abs(x.temperature - x.temp_c) > COALESCE(x.temp_tolerance, 0)
              THEN 'temperature ' || x.temperature || ' °C, target ' || x.temp_c || ' ± ' || COALESCE(x.temp_tolerance, 0) || ' °C' END), '') AS check_text
  FROM (SELECT l.*, e.equipment_code, e.equipment_name, r.batch_id, COALESCE(ws.config->>'duration_unit', 'hours') AS duration_unit,
               CASE WHEN jnum_ok(ws.config, 'window_min', NULL) THEN (ws.config->>'window_min')::numeric END AS window_min,
               CASE WHEN jnum_ok(ws.config, 'window_max', NULL) THEN (ws.config->>'window_max')::numeric END AS window_max,
               CASE WHEN jnum_ok(ws.config, 'temp_c', NULL) THEN (ws.config->>'temp_c')::numeric END AS temp_c,
               CASE WHEN jnum_ok(ws.config, 'temp_tolerance', NULL) THEN (ws.config->>'temp_tolerance')::numeric END AS temp_tolerance,
               CASE WHEN l.time_out IS NULL THEN NULL
                    ELSE round((extract(epoch FROM l.time_out - l.time_in) / CASE WHEN ws.config->>'duration_unit' = 'days' THEN 86400 ELSE 3600 END)::numeric, 4) END AS duration
          FROM incubation_load l JOIN equipment e ON e.id = l.equipment_id JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id) x;

-- create_batch: Daily QC is one set per test per lab per day, shared by the day's batches
CREATE OR REPLACE FUNCTION create_batch(p_site uuid, p_version uuid, p_items jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; bs workflow_step; v_max integer := 500; v_batch uuid; it record; pos integer := 0; n integer := 0;
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
        ELSIF q->>'frequency' = 'Daily' THEN
            -- one set per test per lab per day: the day's first batch holds it, later batches link to it (WD-4)
            SELECT e.* INTO v_orig FROM batch_entry e JOIN test_batch ob ON ob.id = e.batch_id JOIN lab_site ls ON ls.id = ob.site_id
             WHERE ob.site_id = p_site AND ob.test_id = t.id AND ob.id <> v_batch AND ob.status <> 'Cancelled' AND e.status = 'Active'
               AND e.qc_type = q->>'qc_type' AND e.daily_of_entry_id IS NULL AND e.label LIKE '%(daily)'
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
    -- positions
    PERFORM batch_order(v_batch);
    -- one run per step
    INSERT INTO step_run (batch_id, step_id) SELECT v_batch, id FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    PERFORM set_testing_internal(false);
    RETURN v_batch;
END $$;

-- entry_value_rules: no data on a linked daily control; plates are whole numbers
CREATE OR REPLACE FUNCTION entry_value_rules() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF e.daily_of_entry_id IS NOT NULL THEN RAISE EXCEPTION '% is the day''s shared control: its data is recorded in the batch that holds it', e.label; END IF;
    IF ws.step_type = 'Plating/Inoculation' AND NEW.value_num IS NOT NULL AND (NEW.value_num < 0 OR NEW.value_num <> trunc(NEW.value_num)) THEN
        RAISE EXCEPTION 'Plates are counted in whole numbers';
    END IF;
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

-- entry_material_rules: a strain must be a Microbiological Strain lot (of one of the test's organisms, when the lot names its organism)
CREATE OR REPLACE FUNCTION entry_material_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; l inventory_lot;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = NEW.step_run_id;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    IF NEW.entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batch_entry WHERE id = NEW.entry_id AND batch_id = b.id) THEN RAISE EXCEPTION 'The entry is not in this batch'; END IF;
    IF testing_internal() THEN RETURN NEW; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_step_open(r.id);
    IF TG_OP = 'UPDATE' AND (NEW.lot_id <> OLD.lot_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.volume IS DISTINCT FROM OLD.volume
                             OR NEW.volume_unit IS DISTINCT FROM OLD.volume_unit OR NEW.status = 'Active' AND OLD.status <> 'Active') THEN
        RAISE EXCEPTION 'Remove the material and add the right one';
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.volume_unit := canonical_unit(NEW.volume_unit, '{Volume,Mass,Count}', 'Unit of the amount used');
        SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
        IF l.site_id <> b.site_id THEN RAISE EXCEPTION 'Lot % belongs to another lab', l.lot_code; END IF;
        IF l.receipt_status <> 'Received' THEN RAISE EXCEPTION 'Lot % has not been received', l.lot_code; END IF;
        IF l.status <> 'Available' THEN RAISE EXCEPTION 'Lot % is % and cannot be used', l.lot_code, l.status; END IF;
        IF l.expiration_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % expired on % and cannot be used', l.lot_code, l.expiration_date; END IF;
        IF l.retest_date < site_today(l.site_id) THEN RAISE EXCEPTION 'Lot % was due for retest on % and cannot be used', l.lot_code, l.retest_date; END IF;
        IF NEW.purpose::text = 'Strain' AND NOT ('Microbiological Strain' = ANY (l.chemical_types)) THEN
            RAISE EXCEPTION 'Lot % is not a Microbiological Strain', l.lot_code;
        END IF;
        IF NEW.purpose::text = 'Strain' AND EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active')
           AND NOT EXISTS (SELECT 1 FROM lot_analyte la JOIN test_version_analyte tva ON tva.analyte_id = la.analyte_id AND tva.status = 'Active'
                            WHERE la.lot_id = l.id AND la.status = 'Active' AND tva.test_version_id = b.test_version_id) THEN
            RAISE EXCEPTION 'Strain % is not one of this test''s organisms', l.lot_code;
        END IF;
        IF NEW.volume IS NULL OR NEW.volume_unit IS NULL THEN
            RAISE EXCEPTION 'Enter the amount of % used (and its unit): it is taken off the lot''s stock', l.lot_code;
        END IF;
        IF unit_factor(NEW.volume_unit, l.unit, l.physical_form::text) IS NULL THEN
            RAISE EXCEPTION 'Lot % is counted in %; % cannot be converted to it', l.lot_code, l.unit, NEW.volume_unit;
        END IF;
        NEW.usage_txn_id := NULL; NEW.return_txn_id := NULL;
    END IF;
    RETURN NEW;
END $$;

-- batch_results: linked daily controls are calculated in their own batch; incubation duration comes from the loads
CREATE OR REPLACE FUNCTION batch_results(p_batch uuid)
RETURNS TABLE (entry_id uuid, analyte_id uuid, run_no integer, step_key text, is_final boolean, value numeric, reported text, inputs jsonb, waiting text, value_text text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; e record; a record; cs record; tok text; k text; f text; ref workflow_step; rr step_run; vals jsonb; miss text;
        v numeric; formula text; runs integer; rn integer; calc jsonb := '{}'; final_key text; has_calc boolean; vt text;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    has_calc := EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Calculation');
    SELECT ws.step_key INTO final_key FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
     ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)) DESC, ws.sort_order DESC LIMIT 1;
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.daily_of_entry_id IS NULL ORDER BY be.position LOOP
        runs := COALESCE((SELECT max(entry_runs(r.id, e.id)) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
                           WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry'), 1);
        FOR a IN SELECT tva.* FROM test_version_analyte tva WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active' ORDER BY tva.sort_order LOOP
            FOR rn IN 1..runs LOOP
                IF NOT has_calc OR a.result_type <> 'Numeric' THEN
                    -- no calculation (or a qualitative / text result): the result is the reading
                    SELECT ev.value_num, ev.value_text, ws.step_key INTO v, vt, k FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
                     WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry' AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = rn AND ev.status = 'Active'
                     ORDER BY ws.sort_order DESC LIMIT 1;
                    entry_id := e.id; analyte_id := a.analyte_id; run_no := rn; step_key := k; is_final := true;
                    value := CASE WHEN a.result_type = 'Numeric' THEN v END; value_text := CASE WHEN a.result_type <> 'Numeric' THEN vt END;
                    reported := CASE WHEN a.result_type = 'Numeric' THEN report_value(v, a.id) ELSE vt END; inputs := '{}';
                    waiting := CASE WHEN (a.result_type = 'Numeric' AND v IS NULL) OR (a.result_type <> 'Numeric' AND vt IS NULL) THEN 'Waiting for the reading' END;
                    RETURN NEXT; CONTINUE;
                END IF;
                calc := '{}'; value_text := NULL;
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
                        ELSIF ref.step_type = 'Incubation' THEN
                            v := (SELECT l.duration FROM incubation_load_view l WHERE l.step_run_id = rr.id AND l.status = 'Active' AND l.duration IS NOT NULL
                                   AND (l.entry_ids IS NULL OR e.id = ANY (l.entry_ids)) ORDER BY l.time_in DESC LIMIT 1);
                        ELSIF ref.step_type = 'Data Entry' THEN
                            SELECT ev.value_num INTO v FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = LEAST(rn, entry_runs(rr.id, e.id)) AND ev.status = 'Active';
                        ELSIF ref.step_type = 'Calculation' THEN
                            v := (calc->>k)::numeric;
                        ELSIF ref.step_type = 'Hold Point' THEN
                            -- the named sibling test's result on the same sample: its approved result, else its live result
                            SELECT tr.value_num INTO v FROM batch_entry e0 JOIN requested_test rt0 ON rt0.id = e0.requested_test_id
                              JOIN requested_test rt2 ON rt2.sample_id = rt0.sample_id AND rt2.test_id = (ref.config->>'test_id')::uuid AND rt2.status <> 'Cancelled'
                              JOIN test_result tr ON tr.requested_test_id = rt2.id AND tr.status = 'Active' AND tr.analyte_id = a.analyte_id
                             WHERE e0.id = e.id LIMIT 1;
                            IF v IS NULL THEN
                                SELECT r2.value INTO v FROM requested_test rt0 JOIN batch_entry e0 ON e0.requested_test_id = rt0.id
                                  JOIN requested_test rt2 ON rt2.sample_id = rt0.sample_id AND rt2.test_id = (ref.config->>'test_id')::uuid AND rt2.status <> 'Cancelled'
                                  JOIN batch_entry e2 ON e2.requested_test_id = rt2.id AND e2.status = 'Active'
                                  JOIN test_batch b2 ON b2.id = e2.batch_id AND b2.status <> 'Cancelled'
                                  CROSS JOIN LATERAL batch_results(e2.batch_id) r2
                                 WHERE e0.id = e.id AND r2.entry_id = e2.id AND r2.is_final AND r2.value IS NOT NULL LIMIT 1;
                            END IF;
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

-- batch_qc_verdicts: Presence, Absence and Identified (micro controls); linked daily controls show their own batch's verdict
CREATE OR REPLACE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; q record; e record; res jsonb := '{}'; rtx jsonb := '{}'; o record; ob text; r record; m numeric; v_final numeric; v_parent numeric; v_exp numeric; v_true numeric;
        v_unit text; de workflow_step; dr step_run; v_weight numeric; v_lim numeric; tva test_version_analyte; v_note text; v_other numeric; mat record; c numeric;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    -- final results (latest reading) per entry and analyte
    FOR r IN SELECT x.entry_id, x.analyte_id, x.value FROM batch_results(p_batch) x WHERE x.is_final
              AND x.run_no = (SELECT max(y.run_no) FROM batch_results(p_batch) y WHERE y.entry_id = x.entry_id AND y.analyte_id = x.analyte_id AND y.is_final) LOOP
        IF r.value IS NOT NULL THEN res := res || jsonb_build_object(r.entry_id || ':' || r.analyte_id, r.value); END IF;
    END LOOP;
    -- qualitative results (latest reading), for presence / absence / identification
    FOR r IN SELECT x.entry_id, x.analyte_id, x.value_text FROM batch_results(p_batch) x WHERE x.is_final AND x.value_text IS NOT NULL
              AND x.run_no = (SELECT max(y.run_no) FROM batch_results(p_batch) y WHERE y.entry_id = x.entry_id AND y.analyte_id = x.analyte_id AND y.is_final AND y.value_text IS NOT NULL) LOOP
        rtx := rtx || jsonb_build_object(r.entry_id || ':' || r.analyte_id, r.value_text);
    END LOOP;
    SELECT * INTO de FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Data Entry' ORDER BY sort_order DESC LIMIT 1;
    SELECT * INTO dr FROM step_run WHERE batch_id = p_batch AND step_id = de.id;
    v_unit := de.config->>'value_unit';
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.entry_type = 'QC' ORDER BY be.position LOOP
        IF e.daily_of_entry_id IS NOT NULL THEN
            -- the day's shared control: its verdicts come from the batch that holds it
            SELECT tb.batch_code INTO ob FROM test_batch tb JOIN batch_entry x ON x.batch_id = tb.id WHERE x.id = e.daily_of_entry_id;
            FOR q IN SELECT * FROM batch_qc_verdicts((SELECT batch_id FROM batch_entry WHERE id = e.daily_of_entry_id)) z WHERE z.entry_id = e.daily_of_entry_id LOOP
                entry_id := e.id; label := e.label; qc_type := e.qc_type; limit_type := q.limit_type; analyte_id := q.analyte_id; analyte_name := q.analyte_name;
                measured := q.measured; min_value := q.min_value; max_value := q.max_value; limit_text := q.limit_text; verdict := q.verdict;
                note := 'Daily control in ' || ob || COALESCE(': ' || q.note, '');
                RETURN NEXT;
            END LOOP;
            CONTINUE;
        END IF;
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
            ELSIF q.limit_type IN ('Presence','Absence','Identified') THEN
                -- micro controls: a positive control must grow (a "found" value, or a count above 0), a negative must not
                DECLARE t text := rtx->>(e.id || ':' || q.analyte_id); found boolean;
                BEGIN
                    found := CASE WHEN t IS NOT NULL THEN t = ANY (COALESCE(tva.found_values, '{Present}')) WHEN v_final IS NOT NULL THEN v_final > 0 END;
                    IF t IS NULL AND v_final IS NULL THEN verdict := 'Waiting'; note := 'No reading yet';
                    ELSIF q.limit_type = 'Identified' THEN verdict := CASE WHEN COALESCE(t, '') <> '' THEN 'Pass' ELSE 'Fail' END; note := 'identified as ' || COALESCE(t, '(nothing)');
                    ELSIF q.limit_type = 'Presence' THEN verdict := CASE WHEN found THEN 'Pass' ELSE 'Fail' END; note := 'reading ' || COALESCE(t, v_final::text) || CASE WHEN found THEN ' (growth)' ELSE ' (no growth)' END;
                    ELSE verdict := CASE WHEN found THEN 'Fail' ELSE 'Pass' END; note := 'reading ' || COALESCE(t, v_final::text) || CASE WHEN found THEN ' (growth)' ELSE ' (no growth)' END;
                    END IF;
                END;
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

-- step_run_missing: Plating/Inoculation, Incubation and Split off Test at the bench; strains; linked daily controls skipped
CREATE OR REPLACE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
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
          WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND e2.qc_type IN ('Matrix Spike','Matrix Spike Duplicate') AND e2.parent_entry_id IS NULL;
    WHEN 'Weighing' THEN
        RETURN QUERY SELECT e2.label || ': no weight' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num IS NOT NULL AND ev.status = 'Active')
          ORDER BY e2.position;
        IF needs_eq THEN
            RETURN QUERY SELECT e2.label || ': record the balance used' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
              AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active' AND (q.entry_id = e2.id OR q.entry_id IS NULL))
              ORDER BY e2.position;
        END IF;
    WHEN 'Preparation' THEN
        FOR fl IN SELECT * FROM jsonb_array_elements(COALESCE(ws.config->'fields', '[]')) LOOP
            IF COALESCE(btrim(r.fields->>field_key(fl->>'label')), '') = '' THEN RETURN QUERY SELECT 'Fill in ' || (fl->>'label'); END IF;
        END LOOP;
        IF needs_eq AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active') THEN RETURN QUERY SELECT 'Record the equipment used'; END IF;
    WHEN 'Dilution' THEN
        RETURN QUERY SELECT e2.label || ': no dilution recorded' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.status = 'Active' AND dilution_factor(ev.data) IS NOT NULL)
          ORDER BY e2.position;
    WHEN 'Data Entry' THEN
        ids := ws.config->'analyte_ids';
        FOR e IN SELECT * FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL ORDER BY e2.position LOOP
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
        RETURN QUERY SELECT x.label || ': record the spike (lot and volume)' FROM batch_entry x WHERE x.batch_id = b.id AND x.status = 'Active' AND x.daily_of_entry_id IS NULL AND x.qc_class = 'Prep'
          AND EXISTS (SELECT 1 FROM qc_criteria(b.test_version_id) q WHERE q.qc_type = x.qc_type AND q.limit_type = 'Recovery %' AND q.applies)
          AND NOT EXISTS (SELECT 1 FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id WHERE sr.batch_id = b.id AND em.entry_id = x.id AND em.purpose = 'Spike' AND em.status = 'Active')
          ORDER BY x.position;
        -- a positive control made from strains needs the strain lot recorded
        RETURN QUERY SELECT x.label || ': record the strain used' FROM batch_entry x JOIN workflow_step bs ON bs.test_version_id = b.test_version_id AND bs.step_type = 'Batching' AND bs.status = 'Active'
          WHERE x.batch_id = b.id AND x.status = 'Active' AND x.daily_of_entry_id IS NULL AND x.entry_type = 'QC'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(bs.config->'qc', '[]')) q WHERE q->>'qc_type' = x.qc_type AND q->>'material' = 'Strains')
            AND NOT EXISTS (SELECT 1 FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id WHERE sr.batch_id = b.id AND em.entry_id = x.id AND em.purpose::text = 'Strain' AND em.status = 'Active');
        RETURN QUERY SELECT x.label || ': record the check standard used' FROM batch_entry x WHERE x.batch_id = b.id AND x.status = 'Active' AND x.qc_class = 'Analytical'
          AND x.qc_type IN ('ICV','CCV') AND NOT EXISTS (SELECT 1 FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                                                         WHERE sr.batch_id = b.id AND em.entry_id = x.id AND em.purpose = 'Standard' AND em.status = 'Active');
    WHEN 'Calculation' THEN
        SELECT count(*) INTO n FROM batch_results(b.id) x JOIN batch_entry be ON be.id = x.entry_id
         WHERE x.step_key = ws.step_key AND x.waiting IS NOT NULL AND (be.entry_type = 'Sample' OR be.qc_class = 'Prep');
        IF n > 0 THEN RETURN QUERY SELECT n || ' result' || CASE WHEN n > 1 THEN 's are' ELSE ' is' END || ' still waiting for data'; END IF;
    WHEN 'Plating/Inoculation' THEN
        RETURN QUERY SELECT e2.label || ': record the plates' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num IS NOT NULL AND ev.status = 'Active')
          ORDER BY e2.position;
        RETURN QUERY SELECT e2.label || ': record the media lot' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e2.id AND ev.analyte_id IS NULL AND ev.value_num > 0 AND ev.status = 'Active')
          AND NOT EXISTS (SELECT 1 FROM entry_material em WHERE em.step_run_id = r.id AND em.status = 'Active' AND em.purpose = 'Media' AND (em.entry_id = e2.id OR em.entry_id IS NULL))
          ORDER BY e2.position;
    WHEN 'Incubation' THEN
        IF NOT EXISTS (SELECT 1 FROM incubation_load WHERE step_run_id = r.id AND status = 'Active') THEN RETURN QUERY SELECT 'Put the plates in an incubator (add a load)'; RETURN; END IF;
        RETURN QUERY SELECT 'Load in ' || l.equipment_code || ': take it out (time out)' FROM incubation_load_view l WHERE l.step_run_id = r.id AND l.status = 'Active' AND l.time_out IS NULL;
        RETURN QUERY SELECT 'Load in ' || l.equipment_code || ': ' || l.check_text || '; explain it in the load''s note' FROM incubation_load_view l
          WHERE l.step_run_id = r.id AND l.status = 'Active' AND l.time_out IS NOT NULL AND l.check_text IS NOT NULL AND COALESCE(btrim(l.note), '') = '';
        RETURN QUERY SELECT e2.label || ': not in any incubator load' FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL AND (e2.entry_type = 'Sample' OR e2.qc_class = 'Prep')
          AND NOT EXISTS (SELECT 1 FROM incubation_load l WHERE l.step_run_id = r.id AND l.status = 'Active' AND (l.entry_ids IS NULL OR e2.id = ANY (l.entry_ids)))
          ORDER BY e2.position;
    WHEN 'Split off Test' THEN
        NULL;   -- nothing to record: completing it raises the split-off requests for the samples with a finding
    WHEN 'Hold Point' THEN
        RETURN QUERY SELECT 'Waits for ' || (SELECT test_name FROM test WHERE id = (ws.config->>'test_id')::uuid) || ' on the same sample (its result is not ready)'
         WHERE EXISTS (SELECT 1 FROM batch_results(b.id) x WHERE x.waiting LIKE '%{' || ws.step_key || '.result}%');
    WHEN 'QC Review' THEN RETURN QUERY SELECT 'QC Review is done by a reviewer (WD-3)';
    ELSE NULL;
    END CASE;
END $$;

-------------------------------------------------------------------------------
-- SPLIT-OFF REQUESTS
-------------------------------------------------------------------------------
CREATE TABLE split_request (
    id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id                uuid NOT NULL REFERENCES step_run(id),
    batch_id                   uuid NOT NULL REFERENCES test_batch(id),
    entry_id                   uuid NOT NULL REFERENCES batch_entry(id),
    sample_id                  uuid NOT NULL REFERENCES sample(id),
    origin_requested_test_id   uuid NOT NULL REFERENCES requested_test(id),
    test_id                    uuid NOT NULL REFERENCES test(id),       -- the test to order (e.g. identification)
    finding                    text,
    status                     text NOT NULL DEFAULT 'Awaiting consent' CHECK (status IN ('Awaiting consent','Consent given','Declined','Ordered','Cancelled')),
    decision_note              text,
    decided_by                 uuid REFERENCES app_user(id),
    decided_at                 timestamptz,
    ordered_requested_test_id  uuid REFERENCES requested_test(id),
    record_version             integer NOT NULL DEFAULT 1,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    created_by                 uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at                timestamptz NOT NULL DEFAULT now(),
    modified_by                uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX split_request_uq ON split_request (step_run_id, entry_id) WHERE status <> 'Cancelled';
CALL make_gxp('split_request', false);
CREATE FUNCTION split_request_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Split-off requests are raised by the Split off step and decided with Consent given or Declined';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON split_request FOR EACH ROW EXECUTE FUNCTION split_request_rules();

-- Completing a Split off Test step raises the requests: every sample with a "found" reading in the finding steps
-- (trigger On finding), or every sample (trigger Always)
CREATE FUNCTION make_split_requests() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws workflow_step; e record; f text; rt2 uuid; trig text; prev text := COALESCE(current_setting('lims.testing_internal', true), '');
BEGIN
    IF NEW.status <> 'Completed' OR OLD.status = 'Completed' THEN RETURN NULL; END IF;
    SELECT * INTO ws FROM workflow_step WHERE id = NEW.step_id;
    IF ws.step_type <> 'Split off Test' OR (ws.config->>'test_id') IS NULL THEN RETURN NULL; END IF;
    trig := COALESCE(ws.config->>'trigger', 'On finding');
    PERFORM set_testing_internal(true);
    FOR e IN SELECT be.*, rt.sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id
              WHERE be.batch_id = NEW.batch_id AND be.status = 'Active' AND be.entry_type = 'Sample' ORDER BY be.position LOOP
        SELECT string_agg(an.analyte_name || ' ' || ev.value_text, ', ' ORDER BY an.analyte_name) INTO f
          FROM entry_value ev JOIN step_run sr ON sr.id = ev.step_run_id JOIN workflow_step fs ON fs.id = sr.step_id
          JOIN test_batch b ON b.id = sr.batch_id JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = ev.analyte_id AND tva.status = 'Active'
          JOIN analyte an ON an.id = ev.analyte_id
         WHERE sr.batch_id = NEW.batch_id AND ev.entry_id = e.id AND ev.status = 'Active'
           AND COALESCE(ws.config->'finding_steps', '[]') ? fs.step_key
           AND ev.value_text = ANY (COALESCE(tva.found_values, '{Present}'));
        IF trig = 'On finding' AND f IS NULL THEN CONTINUE; END IF;
        IF EXISTS (SELECT 1 FROM split_request WHERE step_run_id = NEW.id AND entry_id = e.id AND status <> 'Cancelled') THEN CONTINUE; END IF;
        SELECT id INTO rt2 FROM requested_test WHERE sample_id = e.sample_id AND test_id = (ws.config->>'test_id')::uuid AND status <> 'Cancelled' LIMIT 1;
        INSERT INTO split_request (step_run_id, batch_id, entry_id, sample_id, origin_requested_test_id, test_id, finding, status, ordered_requested_test_id)
        VALUES (NEW.id, NEW.batch_id, e.id, e.sample_id, e.requested_test_id, (ws.config->>'test_id')::uuid, COALESCE(f, 'Always split off'),
                CASE WHEN rt2 IS NULL THEN 'Awaiting consent' ELSE 'Ordered' END, rt2);
    END LOOP;
    PERFORM set_config('lims.testing_internal', prev, true);   -- runs inside complete_step: leave its setting as it was
    RETURN NULL;
END $$;
CREATE TRIGGER z_split AFTER UPDATE OF status ON step_run FOR EACH ROW EXECUTE FUNCTION make_split_requests();

-- The customer's decision (recorded by the people who handle orders)
CREATE FUNCTION decide_split_request(p_id uuid, p_decision text, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s split_request; v_site uuid;
BEGIN
    SELECT * INTO s FROM split_request WHERE id = p_id;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Split-off request not found'; END IF;
    SELECT o.site_id INTO v_site FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id WHERE sm.id = s.sample_id;
    PERFORM require_permission_at('orders.edit', v_site);
    IF p_decision NOT IN ('Consent given','Declined') THEN RAISE EXCEPTION 'Record Consent given or Declined'; END IF;
    IF s.status NOT IN ('Awaiting consent','Consent given','Declined') THEN RAISE EXCEPTION 'This request is already %', lower(s.status); END IF;
    IF p_decision = 'Declined' AND COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Note who declined and how (e.g. email from the client)'; END IF;
    PERFORM ensure_reason('Customer decision on a split-off test');
    PERFORM set_testing_internal(true);
    UPDATE split_request SET status = p_decision, decision_note = NULLIF(btrim(p_note), ''), decided_by = current_app_user(), decided_at = clock_timestamp() WHERE id = p_id;
    PERFORM set_testing_internal(false);
END $$;

-- Ordering the test on the sample closes the request
CREATE FUNCTION split_request_ordered() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text := COALESCE(current_setting('lims.testing_internal', true), '');
BEGIN
    IF EXISTS (SELECT 1 FROM split_request WHERE sample_id = NEW.sample_id AND test_id = NEW.test_id AND status IN ('Awaiting consent','Consent given')) THEN
        PERFORM set_testing_internal(true);
        UPDATE split_request SET status = 'Ordered', ordered_requested_test_id = NEW.id WHERE sample_id = NEW.sample_id AND test_id = NEW.test_id AND status IN ('Awaiting consent','Consent given');
        PERFORM set_config('lims.testing_internal', prev, true);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_split_ordered AFTER INSERT ON requested_test FOR EACH ROW EXECUTE FUNCTION split_request_ordered();

CREATE VIEW split_request_view AS
SELECT s.*, sm.sample_code, sm.client_sample_id, o.id AS lab_order_id, o.order_code, o.site_id, t.test_code, t.test_name, b.batch_code,
       ot.test_name AS origin_test_name, u.full_name AS decided_by_name, COALESCE(c.display_name, c.legal_name) AS client_name
  FROM split_request s JOIN sample sm ON sm.id = s.sample_id JOIN lab_order o ON o.id = sm.lab_order_id JOIN client c ON c.id = o.client_id
  JOIN test t ON t.id = s.test_id JOIN test_batch b ON b.id = s.batch_id JOIN requested_test ort ON ort.id = s.origin_requested_test_id
  JOIN test ot ON ot.id = ort.test_id LEFT JOIN app_user u ON u.id = s.decided_by;

-------------------------------------------------------------------------------
-- AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice19;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_batch uuid;
BEGIN
    CASE p_table
    WHEN 'incubation_load' THEN
        SELECT sr.batch_id INTO v_batch FROM step_run sr WHERE sr.id = (r->>'step_run_id')::uuid;
        RETURN jsonb_build_object('label', 'Incubator load in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = v_batch), ''), 'link', '#/testing/batches/' || v_batch);
    WHEN 'split_request' THEN
        RETURN jsonb_build_object('label', 'Split-off request for ' || COALESCE((SELECT COALESCE(sample_code, client_sample_id) FROM sample WHERE id = (r->>'sample_id')::uuid), ''),
            'link', '#/samples/' || (r->>'sample_id'));
    ELSE RETURN audit_record_ref_slice19(p_table, p_id, r);
    END CASE;
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
