-- LIMS3 schema, migration 021: WD-5 (Alex Kiddle's answers after reviewing WD-2 to WD-4, 2026-10-13; vault: "Decision -
-- Analytical Runs, Preliminary Results and Order Statuses"). Built by Claude in the cloud.
--  - Analytical runs: a reading (Data Entry) step can have several analytical runs. "Add analytical run" (signed, with a
--    reason) reads chosen samples again, single, duplicate or triplicate, in a new run; the run's analytical QC (ICV,
--    CCV...) is added to it automatically and judged in that run. Each run has its own raw data file and instrument.
--    Re-analysis is the same thing. A re-read is labelled RA1-, RA2-... (numbered on per sample); a re-prep RP1-, RP2-...
--  - QC Review: the reviewer picks one reading (with a written justification when there is more than one) or reports the
--    average of the readings ticked (a justification when some are left out). Only the runs that hold a reported
--    reading need their analytical QC passed or accepted.
--  - Preliminary results: a QC Review step set to Timepoint (before the final result, e.g. day 7 of USP <51>) is
--    released on its own once every step before it is completed and approved: signed "Reviewed by", its results stored
--    with stage Preliminary. The steps that fed it are locked. The final approval carries them into the final results
--    unchanged (stage Final) and stores the rest.
--  - Split off: "Customer consent required" is a setting of the step. Off: the test is ordered at once from the
--    client's accepted quote (or waits as "To order" when it is not on one). Steps approved before this keep consent.
--  - Order statuses: In Review (no test left at the bench, and a batch waits for QC Review) and Approved (every test has final results)
--    replace Complete. Reported comes with reports.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. ORDER STATUSES (existing Complete orders move to Approved in seed_016, after this commits)
-------------------------------------------------------------------------------
ALTER TYPE lab_order_status ADD VALUE IF NOT EXISTS 'In Review' BEFORE 'Complete';
ALTER TYPE lab_order_status ADD VALUE IF NOT EXISTS 'Approved' BEFORE 'Complete';

-------------------------------------------------------------------------------
-- 2. TABLES
-------------------------------------------------------------------------------
-- Run 1 is the reading step itself; runs 2 and up are added (signed, with a reason)
CREATE TABLE analytical_run (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_run_id     uuid NOT NULL REFERENCES step_run(id),
    run_no          integer NOT NULL CHECK (run_no >= 2),
    reason          text NOT NULL CHECK (btrim(reason) <> ''),
    signature_id    uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (step_run_id, run_no)
);
CALL make_gxp('analytical_run', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON analytical_run FOR EACH ROW EXECUTE FUNCTION reprep_request_rules();
ALTER TABLE reanalysis_request ADD COLUMN analytical_run_id uuid REFERENCES analytical_run(id);
ALTER TABLE entry_equipment ADD COLUMN analytical_run_no integer NOT NULL DEFAULT 1 CHECK (analytical_run_no >= 1);
ALTER TABLE step_attachment ADD COLUMN analytical_run_no integer NOT NULL DEFAULT 1 CHECK (analytical_run_no >= 1);

-- the reviewer's choice: one reading (Pick) or the average of several; per result (the final, or a timepoint's)
ALTER TABLE result_choice ADD COLUMN mode text NOT NULL DEFAULT 'Pick' CHECK (mode IN ('Pick','Average')),
    ADD COLUMN justification text, ADD COLUMN readings jsonb, ADD COLUMN result_key text;
DROP INDEX result_choice_uq;
CREATE UNIQUE INDEX result_choice_uq ON result_choice (batch_id, requested_test_id, analyte_id, COALESCE(result_key, '')) WHERE status = 'Active';

-- QC accepted per analytical run
ALTER TABLE qc_acceptance ADD COLUMN analytical_run integer NOT NULL DEFAULT 1;
DROP INDEX qc_acceptance_uq;
CREATE UNIQUE INDEX qc_acceptance_uq ON qc_acceptance (batch_id, entry_id, COALESCE(analyte_id, '00000000-0000-0000-0000-000000000000'::uuid), limit_type, analytical_run) WHERE status = 'Active';

-- stored results: the final result (result_key empty) or a timepoint's (the Calculation step's key); Preliminary or Final
ALTER TABLE test_result ADD COLUMN result_key text, ADD COLUMN stage text NOT NULL DEFAULT 'Final' CHECK (stage IN ('Preliminary','Final')),
    ADD COLUMN basis text NOT NULL DEFAULT 'Single' CHECK (basis IN ('Single','Picked','Average')), ADD COLUMN justification text, ADD COLUMN averaged jsonb,
    ADD COLUMN released_step_run_id uuid REFERENCES step_run(id), ADD COLUMN carried_from_id uuid REFERENCES test_result(id);
DROP INDEX test_result_uq;
CREATE UNIQUE INDEX test_result_uq ON test_result (requested_test_id, analyte_id, COALESCE(result_key, '')) WHERE status = 'Active';

-- split-off requests that need no consent wait as "To order" when they cannot be ordered at once
ALTER TABLE split_request DROP CONSTRAINT split_request_status_check;
ALTER TABLE split_request ADD CONSTRAINT split_request_status_check CHECK (status IN ('Awaiting consent','Consent given','To order','Declined','Ordered','Cancelled'));

-------------------------------------------------------------------------------
-- 3. ANALYTICAL RUNS
-------------------------------------------------------------------------------
CREATE FUNCTION analytical_runs(p_step_run uuid) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT max(run_no) FROM analytical_run WHERE step_run_id = p_step_run), 1)
$$;
-- the analytical run a reading belongs to (readings not added by a run are run 1)
CREATE FUNCTION reading_run(p_step_run uuid, p_entry uuid, p_run_no integer) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT ar.run_no FROM reanalysis_request x JOIN analytical_run ar ON ar.id = x.analytical_run_id
                      WHERE x.step_run_id = p_step_run AND x.entry_id = p_entry AND p_run_no BETWEEN x.first_run_no AND x.first_run_no + x.runs - 1 LIMIT 1), 1)
$$;
-- an entry's latest reading in analytical run k (NULL: not read in that run)
CREATE FUNCTION entry_run_reading(p_step_run uuid, p_entry uuid, p_k integer) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT max(g) FROM generate_series(1, entry_runs(p_step_run, p_entry)) g WHERE reading_run(p_step_run, p_entry, g) = p_k
$$;
-- RA1-, RA2-... for re-readings of an entry
CREATE FUNCTION reading_label(p_label text, p_run_no integer) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN COALESCE(p_run_no, 1) <= 1 THEN p_label ELSE 'RA' || (p_run_no - 1) || '-' || p_label END
$$;
-- the reading step that analytical runs and QC refer to: the batch's last Data Entry step
CREATE FUNCTION batch_reading_run(p_batch uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
     WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry' ORDER BY ws.sort_order DESC LIMIT 1
$$;

-- equipment and raw data files belong to an analytical run that exists
CREATE FUNCTION analytical_run_no_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.analytical_run_no <> OLD.analytical_run_no THEN RAISE EXCEPTION 'Remove it and add it to the right analytical run'; END IF;
    IF NEW.analytical_run_no > analytical_runs(NEW.step_run_id) THEN RAISE EXCEPTION 'Analytical run % does not exist at this step', NEW.analytical_run_no; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_run BEFORE INSERT OR UPDATE ON entry_equipment FOR EACH ROW EXECUTE FUNCTION analytical_run_no_rules();
CREATE TRIGGER a02_run BEFORE INSERT OR UPDATE ON step_attachment FOR EACH ROW EXECUTE FUNCTION analytical_run_no_rules();

-------------------------------------------------------------------------------
-- 4. TIMEPOINTS (preliminary release)
-------------------------------------------------------------------------------
-- the test's final result: its last Calculation step (as batch_results)
CREATE FUNCTION final_calc_key(p_version uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT ws.step_key FROM workflow_step ws WHERE ws.test_version_id = p_version AND ws.status = 'Active' AND ws.step_type = 'Calculation'
     ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)) DESC, ws.sort_order DESC LIMIT 1
$$;
-- what a timepoint review releases: the Calculation steps before it (not the test's final result)
CREATE FUNCTION timepoint_keys(p_step uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT COALESCE(array_agg(ws.step_key ORDER BY ws.sort_order), '{}') FROM step_ancestors(p_step) a JOIN workflow_step ws ON ws.id = a.step_id
     WHERE ws.step_type = 'Calculation' AND ws.status = 'Active' AND ws.step_key IS DISTINCT FROM final_calc_key(ws.test_version_id)
$$;
-- a batch's timepoint reviews: QC Review steps set to Timepoint that come before the final result
CREATE FUNCTION batch_timepoints(p_batch uuid)
RETURNS TABLE (step_run_id uuid, step_id uuid, step_key text, step_name text, keys text[], released boolean, ready boolean, released_by uuid, released_at timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT r.id, ws.id, ws.step_key, ws.step_name, timepoint_keys(ws.id), r.status = 'Completed',
           NOT EXISTS (SELECT 1 FROM step_ancestors(ws.id) a JOIN step_run p ON p.step_id = a.step_id AND p.batch_id = r.batch_id WHERE p.status <> 'Completed'),
           CASE WHEN r.status = 'Completed' THEN r.performed_by END, CASE WHEN r.status = 'Completed' THEN r.completed_at END
      FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id JOIN test_batch b ON b.id = r.batch_id
     WHERE r.batch_id = p_batch AND ws.step_type = 'QC Review' AND COALESCE(ws.config->>'scope', 'Batch') = 'Timepoint'
       AND NOT EXISTS (SELECT 1 FROM step_ancestors(ws.id) a JOIN workflow_step x ON x.id = a.step_id WHERE x.step_key = final_calc_key(b.test_version_id))
       AND cardinality(timepoint_keys(ws.id)) > 0
     ORDER BY ws.sort_order, ws.step_name
$$;
-- the released timepoint a step fed (NULL: none): such a step can no longer change
CREATE FUNCTION step_feeds_release(p_step_run uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT t.step_name FROM step_run r CROSS JOIN LATERAL batch_timepoints(r.batch_id) t
     WHERE r.id = p_step_run AND t.released AND (r.step_id IN (SELECT a.step_id FROM step_ancestors(t.step_id) a) OR r.id = t.step_run_id) LIMIT 1
$$;
CREATE FUNCTION assert_not_released(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text := step_feeds_release(p_step_run);
BEGIN
    IF t IS NOT NULL THEN
        RAISE EXCEPTION 'This step fed results already released as preliminary (%), so it cannot change. Corrections to released results come with the OOS and retest slice', t;
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 5. ADDING AN ANALYTICAL RUN (re-analysis)
-------------------------------------------------------------------------------
CREATE FUNCTION add_analytical_run(p_step_run uuid, p_entries uuid[], p_replicates integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; e record; v_run uuid; k integer; n integer := 0; reps integer; sig uuid;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF ws.step_type IS DISTINCT FROM 'Data Entry' THEN RAISE EXCEPTION 'Analytical runs (re-analysis) are added at a reading (Data Entry) step'; END IF;
    IF p_replicates IS NULL OR p_replicates NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Choose single, duplicate or triplicate'; END IF;
    IF COALESCE(cardinality(p_entries), 0) = 0 THEN RAISE EXCEPTION 'Choose the samples to read again in the new run'; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_signed('add an analytical run');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the samples are read again (re-analysis)'; END IF;
    PERFORM assert_not_released(r.id);
    IF EXISTS (SELECT 1 FROM unnest(p_entries) x WHERE NOT EXISTS (SELECT 1 FROM batch_entry be WHERE be.id = x AND be.batch_id = r.batch_id AND be.status = 'Active' AND be.daily_of_entry_id IS NULL)) THEN
        RAISE EXCEPTION 'An entry is not active in this batch';
    END IF;
    sig := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
    PERFORM set_testing_internal(true);
    k := analytical_runs(r.id) + 1;
    INSERT INTO analytical_run (step_run_id, run_no, reason, signature_id) VALUES (r.id, k, current_reason(), sig) RETURNING id INTO v_run;
    -- the chosen entries, plus the run's own analytical QC (ICV, CCV...) read once
    FOR e IN SELECT be.* FROM batch_entry be WHERE be.batch_id = r.batch_id AND be.status = 'Active' AND be.daily_of_entry_id IS NULL
               AND (be.id = ANY (p_entries) OR be.qc_class = 'Analytical') ORDER BY be.position LOOP
        reps := CASE WHEN e.id = ANY (p_entries) THEN p_replicates ELSE 1 END;
        IF entry_runs(r.id, e.id) + reps > 10 THEN RAISE EXCEPTION 'At most 10 readings per entry (% has %)', e.label, entry_runs(r.id, e.id); END IF;
        INSERT INTO reanalysis_request (step_run_id, entry_id, runs, first_run_no, reason, signature_id, analytical_run_id)
        VALUES (r.id, e.id, reps, entry_runs(r.id, e.id) + 1, current_reason(), sig, v_run);
        n := n + 1;
    END LOOP;
    -- a completed reading step (and the calculations after it) reopens for the new run's readings
    UPDATE step_run SET status = 'In progress' WHERE batch_id = r.batch_id AND status = 'Completed'
       AND (id = r.id OR step_id IN (SELECT s2.id FROM workflow_step s2 WHERE s2.test_version_id = ws.test_version_id AND s2.step_type = 'Calculation'
                                      AND ws.id IN (SELECT step_id FROM step_ancestors(s2.id))));
    UPDATE test_batch SET status = 'In Progress' WHERE id = r.batch_id AND status = 'Awaiting Review';
    PERFORM set_testing_internal(false);
    RETURN k;
END $$;

-- Re-analysis (WD-2) is now an analytical run of the chosen samples
CREATE OR REPLACE FUNCTION request_reanalysis(p_step_run uuid, p_entries uuid[], p_runs integer) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
    PERFORM add_analytical_run(p_step_run, p_entries, p_runs);
    RETURN cardinality(p_entries);
END $$;

-- Reopen: as in 016, but never a step that fed released preliminary results, nor a review step
CREATE OR REPLACE FUNCTION reopen_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; ws workflow_step; nx text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF r.status <> 'Completed' THEN RAISE EXCEPTION '"%" is not completed', ws.step_name; END IF;
    IF ws.step_type = 'QC Review' THEN RAISE EXCEPTION 'A QC Review is not reopened at the bench'; END IF;
    PERFORM assert_can_perform(r.id);
    PERFORM assert_signed('reopen a step');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the step is reopened'; END IF;
    PERFORM assert_not_released(r.id);
    SELECT string_agg(s2.step_name, ', ') INTO nx FROM workflow_step_dependency d JOIN workflow_step s2 ON s2.id = d.step_id
      JOIN step_run p ON p.step_id = d.step_id AND p.batch_id = r.batch_id WHERE d.depends_on_step_id = r.step_id AND d.status = 'Active' AND p.status = 'Completed';
    IF nx IS NOT NULL THEN RAISE EXCEPTION 'Reopen the steps after it first (%)', nx; END IF;
    PERFORM set_testing_internal(true);
    UPDATE step_run SET status = 'In progress' WHERE id = r.id;
    UPDATE test_batch SET status = 'In Progress' WHERE id = r.batch_id AND status = 'Awaiting Review';
    PERFORM set_testing_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 6. QC VERDICTS PER ANALYTICAL RUN
-------------------------------------------------------------------------------
-- As in 019, judged in each analytical run: run 1 on the entries' first readings, each later run on the readings it
-- holds (its analytical QC always; a prep QC only if it was read again). A spike is judged against its sample's reading
-- in the same run (the sample's run 1 reading when it was not read again).
DROP FUNCTION batch_qc_verdicts(uuid);
CREATE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text, analytical_run integer, run_no integer)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; q record; e record; res jsonb := '{}'; rtx jsonb := '{}'; ob text; r record; m numeric; v_final numeric; v_parent numeric; v_exp numeric; v_true numeric;
        v_unit text; de workflow_step; dr step_run; v_weight numeric; v_lim numeric; tva test_version_analyte; v_note text; v_other numeric; mat record; c numeric;
        k integer; kmax integer; rn integer; prn integer; ox uuid; orn integer;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    -- every final result, per entry, analyte and reading
    FOR r IN SELECT x.entry_id, x.analyte_id, x.run_no, x.value, x.value_text FROM batch_results(p_batch) x WHERE x.is_final LOOP
        IF r.value IS NOT NULL THEN res := res || jsonb_build_object(r.entry_id || ':' || r.analyte_id || ':' || r.run_no, r.value); END IF;
        IF r.value_text IS NOT NULL THEN rtx := rtx || jsonb_build_object(r.entry_id || ':' || r.analyte_id || ':' || r.run_no, r.value_text); END IF;
    END LOOP;
    SELECT * INTO de FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Data Entry' ORDER BY sort_order DESC LIMIT 1;
    SELECT * INTO dr FROM step_run WHERE batch_id = p_batch AND step_id = de.id;
    v_unit := de.config->>'value_unit';
    kmax := CASE WHEN dr.id IS NULL THEN 1 ELSE analytical_runs(dr.id) END;
    FOR k IN 1..kmax LOOP
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.entry_type = 'QC' ORDER BY be.position LOOP
        IF e.daily_of_entry_id IS NOT NULL THEN
            CONTINUE WHEN k > 1;
            -- the day's shared control: its verdicts come from the batch that holds it
            SELECT tb.batch_code INTO ob FROM test_batch tb JOIN batch_entry x ON x.batch_id = tb.id WHERE x.id = e.daily_of_entry_id;
            FOR q IN SELECT * FROM batch_qc_verdicts((SELECT batch_id FROM batch_entry WHERE id = e.daily_of_entry_id)) z WHERE z.entry_id = e.daily_of_entry_id AND z.analytical_run = 1 LOOP
                entry_id := e.id; label := e.label; qc_type := e.qc_type; limit_type := q.limit_type; analyte_id := q.analyte_id; analyte_name := q.analyte_name;
                measured := q.measured; min_value := q.min_value; max_value := q.max_value; limit_text := q.limit_text; verdict := q.verdict;
                note := 'Daily control in ' || ob || COALESCE(': ' || q.note, ''); analytical_run := 1; run_no := q.run_no;
                RETURN NEXT;
            END LOOP;
            CONTINUE;
        END IF;
        rn := CASE WHEN dr.id IS NULL THEN 1 ELSE entry_run_reading(dr.id, e.id, k) END;
        CONTINUE WHEN rn IS NULL AND k > 1;    -- not read in this run
        rn := COALESCE(rn, 1);
        -- the spiked sample's reading in this run (else its run 1 reading)
        prn := NULL;
        IF e.parent_entry_id IS NOT NULL THEN
            prn := COALESCE(CASE WHEN dr.id IS NOT NULL THEN COALESCE(entry_run_reading(dr.id, e.parent_entry_id, k), entry_run_reading(dr.id, e.parent_entry_id, 1)) END, 1);
        END IF;
        FOR q IN SELECT c2.* FROM qc_criteria(b.test_version_id) c2 WHERE c2.qc_type = e.qc_type LOOP
            entry_id := e.id; label := reading_label(e.label, rn); qc_type := e.qc_type; limit_type := q.limit_type; analyte_id := q.analyte_id; analyte_name := q.analyte_name;
            min_value := q.min_value; max_value := q.max_value; measured := NULL; verdict := NULL; note := NULL; analytical_run := k; run_no := rn;
            limit_text := CASE WHEN q.min_value IS NOT NULL AND q.max_value IS NOT NULL THEN q.min_value || ' to ' || q.max_value
                               WHEN q.max_value IS NOT NULL THEN 'at most ' || q.max_value WHEN q.limit_ref IS NOT NULL THEN 'below ' || q.limit_ref
                               WHEN q.min_value IS NOT NULL THEN 'at least ' || q.min_value ELSE q.limit_type END;
            IF NOT q.applies THEN verdict := 'Not judged'; note := 'This QC does not judge ' || q.analyte_name; RETURN NEXT; CONTINUE; END IF;
            SELECT * INTO tva FROM test_version_analyte WHERE test_version_id = b.test_version_id AND test_version_analyte.analyte_id = q.analyte_id AND status = 'Active';
            v_final := (res->>(e.id || ':' || q.analyte_id || ':' || rn))::numeric;
            IF q.limit_type = 'Recovery %' AND e.qc_class = 'Analytical' THEN
                -- a check standard: the reading against the standard's concentration (in the reading's unit)
                SELECT ev.value_num INTO m FROM entry_value ev WHERE ev.step_run_id = dr.id AND ev.entry_id = e.id AND ev.analyte_id = q.analyte_id AND ev.run_no = rn AND ev.status = 'Active';
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
                IF e.qc_type IN ('Matrix Spike','Matrix Spike Duplicate') THEN v_parent := (res->>(e.parent_entry_id || ':' || q.analyte_id || ':' || prn))::numeric; ELSE v_parent := 0; END IF;
                IF v_final IS NULL THEN verdict := 'Waiting'; note := 'No result yet';
                ELSIF v_exp IS NULL OR v_weight IS NULL THEN verdict := 'Not judged'; note := COALESCE(v_note, 'Record the spike (lot and volume) and the weight');
                ELSIF v_parent IS NULL THEN verdict := 'Waiting'; note := 'The spiked sample has no result yet';
                ELSIF v_exp = 0 THEN verdict := 'Not judged'; note := 'The amount spiked is zero';
                ELSE measured := round((v_final - v_parent) / v_exp * 100, 1);
                     note := 'found ' || round(v_final, 6) || CASE WHEN v_parent <> 0 THEN ' - sample ' || round(v_parent, 6) ELSE '' END || ' / spiked ' || round(v_exp, 6) || ' ' || COALESCE(tva.reporting_unit, '');
                END IF;
            ELSIF q.limit_type = 'RPD' THEN
                SELECT x.id INTO ox FROM batch_entry x WHERE x.batch_id = p_batch AND x.status = 'Active' AND x.qc_type = 'Matrix Spike' AND x.parent_entry_id = e.parent_entry_id LIMIT 1;
                orn := COALESCE(CASE WHEN dr.id IS NOT NULL AND ox IS NOT NULL THEN COALESCE(entry_run_reading(dr.id, ox, k), entry_run_reading(dr.id, ox, 1)) END, 1);
                v_other := (res->>(ox || ':' || q.analyte_id || ':' || orn))::numeric;
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
                DECLARE t text := rtx->>(e.id || ':' || q.analyte_id || ':' || rn); found boolean;
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
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 7. THE REVIEW: pick one reading (justified) or the average; per result key
-------------------------------------------------------------------------------
DROP FUNCTION batch_review_items(uuid);
CREATE FUNCTION batch_review_items(p_batch uuid, p_key text DEFAULT NULL)
RETURNS TABLE (requested_test_id uuid, analyte_id uuid, analyte_name text, sample_label text, candidates jsonb, chosen_entry_id uuid, chosen_run_no integer,
               auto_chosen boolean, value numeric, value_text text, reported text, unit text, spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text,
               mode text, justification text, readings jsonb, result_key text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; it record; c jsonb; ch result_choice; pick record; sc record; res jsonb; dr uuid; avgv numeric; ok boolean; key_unit text;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    dr := batch_reading_run(p_batch);
    IF p_key IS NOT NULL THEN
        SELECT ws.config->>'result_unit' INTO key_unit FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.step_key = p_key AND ws.status = 'Active';
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('entry_id', x.entry_id, 'analyte_id', x.analyte_id, 'run_no', x.run_no, 'value', x.value, 'value_text', x.value_text,
              'reported', COALESCE(x.reported, CASE WHEN x.value IS NOT NULL THEN report_value(x.value, tva.id) END),
              'run', CASE WHEN dr IS NULL THEN 1 ELSE reading_run(dr, x.entry_id, x.run_no) END)), '[]')
      INTO res FROM batch_results(p_batch) x JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = x.analyte_id AND tva.status = 'Active'
     WHERE (p_key IS NULL AND x.is_final) OR x.step_key = p_key;
    FOR it IN SELECT DISTINCT e.requested_test_id, tva.analyte_id, an.analyte_name, tva.id AS tva_id, tva.reporting_unit, tva.found_values, tva.sort_order,
                     COALESCE(s.sample_code, s.client_sample_id) AS sample_label, min(e.position) OVER (PARTITION BY e.requested_test_id) AS pos
                FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id
                JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.status = 'Active' JOIN analyte an ON an.id = tva.analyte_id
               WHERE e.batch_id = p_batch AND e.status = 'Active' AND e.entry_type = 'Sample'
                 AND (NOT EXISTS (SELECT 1 FROM requested_analyte ra WHERE ra.requested_test_id = e.requested_test_id)
                      OR EXISTS (SELECT 1 FROM requested_analyte ra WHERE ra.requested_test_id = e.requested_test_id AND ra.analyte_id = tva.analyte_id AND ra.included))
               ORDER BY pos, sort_order LOOP
        SELECT COALESCE(jsonb_agg(jsonb_build_object('entry_id', r.entry_id, 'label', reading_label(e.label, r.run_no), 'replicate_no', e.replicate_no, 'run_no', r.run_no, 'run', r.run,
                                                     'value', r.value, 'reported', r.reported, 'value_text', r.value_text) ORDER BY r.run, e.position, r.run_no), '[]')
          INTO c FROM jsonb_to_recordset(res) r(entry_id uuid, analyte_id uuid, run_no integer, run integer, value numeric, reported text, value_text text) JOIN batch_entry e ON e.id = r.entry_id
         WHERE e.requested_test_id = it.requested_test_id AND e.status = 'Active' AND r.analyte_id = it.analyte_id AND (r.value IS NOT NULL OR r.value_text IS NOT NULL);
        SELECT * INTO ch FROM result_choice rc WHERE rc.batch_id = p_batch AND rc.requested_test_id = it.requested_test_id AND rc.analyte_id = it.analyte_id
                                                 AND rc.result_key IS NOT DISTINCT FROM p_key AND rc.status = 'Active';
        requested_test_id := it.requested_test_id; analyte_id := it.analyte_id; analyte_name := it.analyte_name; sample_label := it.sample_label; candidates := c;
        auto_chosen := false; chosen_entry_id := NULL; chosen_run_no := NULL; mode := 'Pick'; justification := NULL; readings := NULL; result_key := p_key;
        value := NULL; value_text := NULL; reported := NULL; unit := COALESCE(key_unit, it.reporting_unit);
        IF ch.id IS NOT NULL AND ch.mode = 'Average' THEN
            -- every averaged reading must still be a numeric candidate
            SELECT count(*) = jsonb_array_length(ch.readings), avg((x->>'value')::numeric) INTO ok, avgv FROM jsonb_array_elements(c) x
             WHERE x->>'value' IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(ch.readings) y WHERE y->>'entry_id' = x->>'entry_id' AND (y->>'run_no')::int = (x->>'run_no')::int);
            IF ok THEN
                chosen_entry_id := (ch.readings->0->>'entry_id')::uuid; chosen_run_no := (ch.readings->0->>'run_no')::int; mode := 'Average';
                justification := ch.justification; readings := ch.readings; value := avgv; reported := report_value(avgv, it.tva_id);
            END IF;
        ELSIF ch.id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(c) x WHERE (x->>'entry_id')::uuid = ch.entry_id AND (x->>'run_no')::int = ch.run_no) THEN
            chosen_entry_id := ch.entry_id; chosen_run_no := ch.run_no; justification := ch.justification;
        ELSIF jsonb_array_length(c) = 1 THEN
            chosen_entry_id := (c->0->>'entry_id')::uuid; chosen_run_no := (c->0->>'run_no')::int; auto_chosen := true;
        END IF;
        IF chosen_entry_id IS NOT NULL AND mode = 'Pick' THEN
            SELECT * INTO pick FROM jsonb_to_recordset(res) r(entry_id uuid, analyte_id uuid, run_no integer, value numeric, reported text, value_text text)
             WHERE r.entry_id = chosen_entry_id AND r.analyte_id = it.analyte_id AND r.run_no = chosen_run_no;
            value := pick.value; value_text := pick.value_text; reported := pick.reported;
        END IF;
        spec_min := NULL; spec_max := NULL; spec_text := NULL; spec_unit := NULL; conformance := NULL;
        IF chosen_entry_id IS NOT NULL AND p_key IS NULL THEN
            SELECT * INTO sc FROM spec_conformance(it.requested_test_id, it.analyte_id, value, value_text, reported, it.reporting_unit, it.found_values);
            spec_min := sc.spec_min; spec_max := sc.spec_max; spec_text := sc.spec_text; spec_unit := sc.spec_unit; conformance := sc.conformance;
        ELSIF chosen_entry_id IS NOT NULL THEN
            conformance := 'Not compared';   -- a timepoint's result: the specification applies to the final result
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

-- The analytical runs that hold a reported reading (their analytical QC must pass or be accepted)
CREATE FUNCTION batch_used_runs(p_batch uuid) RETURNS integer[] LANGUAGE plpgsql STABLE AS $$
DECLARE dr uuid := batch_reading_run(p_batch); i record; y jsonb; v integer[] := '{}';
BEGIN
    IF dr IS NULL THEN RETURN '{1}'; END IF;
    FOR i IN SELECT * FROM batch_review_items(p_batch) WHERE chosen_entry_id IS NOT NULL LOOP
        IF i.mode = 'Average' THEN
            FOR y IN SELECT * FROM jsonb_array_elements(i.readings) LOOP v := v || reading_run(dr, (y->>'entry_id')::uuid, (y->>'run_no')::int); END LOOP;
        ELSE v := v || reading_run(dr, i.chosen_entry_id, i.chosen_run_no);
        END IF;
    END LOOP;
    RETURN CASE WHEN cardinality(v) = 0 THEN '{1}' ELSE ARRAY(SELECT DISTINCT x FROM unnest(v) x ORDER BY x) END;
END $$;

-- A QC verdict that counts for approval: run 1 of a prep QC (it judges the preparation), daily controls, and any
-- verdict of a run that holds a reported reading
CREATE FUNCTION qc_verdict_counts(p_entry uuid, p_run integer, p_used integer[]) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT p_run = ANY (p_used) OR (p_run = 1 AND COALESCE((SELECT qc_class FROM batch_entry WHERE id = p_entry), '') <> 'Analytical')
$$;

-- What a reviewer may choose now: the final result while the batch waits for review; a timepoint's result while that
-- timepoint is ready and not yet released
CREATE FUNCTION assert_can_choose(p_batch uuid, p_key text) RETURNS test_batch LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    b := assert_can_review(p_batch);
    IF p_key IS NULL THEN
        IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
        RETURN b;
    END IF;
    IF b.status NOT IN ('In Progress','Awaiting Review') THEN RAISE EXCEPTION 'Batch % is %', b.batch_code, b.status; END IF;
    IF EXISTS (SELECT 1 FROM batch_timepoints(p_batch) t WHERE t.released AND p_key = ANY (t.keys)) THEN
        RAISE EXCEPTION 'That timepoint''s results are already released';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM batch_timepoints(p_batch) t WHERE t.ready AND NOT t.released AND p_key = ANY (t.keys)) THEN
        RAISE EXCEPTION 'That timepoint is not ready for review (the steps before it are not completed)';
    END IF;
    RETURN b;
END $$;

DROP FUNCTION choose_result(uuid, uuid, uuid, uuid, integer);
CREATE FUNCTION choose_result(p_batch uuid, p_rt uuid, p_analyte uuid, p_entry uuid, p_run integer, p_justification text DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; n integer;
BEGIN
    b := assert_can_choose(p_batch, p_key);
    SELECT jsonb_array_length(i.candidates) INTO n FROM batch_review_items(p_batch, p_key) i WHERE i.requested_test_id = p_rt AND i.analyte_id = p_analyte;
    IF NOT EXISTS (SELECT 1 FROM batch_review_items(p_batch, p_key) i, jsonb_array_elements(i.candidates) x
                    WHERE i.requested_test_id = p_rt AND i.analyte_id = p_analyte AND (x->>'entry_id')::uuid = p_entry AND (x->>'run_no')::int = p_run) THEN
        RAISE EXCEPTION 'That reading is not a result of this sample in this batch';
    END IF;
    IF n > 1 AND COALESCE(btrim(p_justification), '') = '' THEN
        RAISE EXCEPTION 'Write why this reading is the one reported (the sample has % readings)', n;
    END IF;
    PERFORM ensure_reason('Reportable reading chosen');
    PERFORM set_testing_internal(true);
    UPDATE result_choice SET status = 'Inactive' WHERE batch_id = p_batch AND requested_test_id = p_rt AND analyte_id = p_analyte AND result_key IS NOT DISTINCT FROM p_key AND status = 'Active';
    INSERT INTO result_choice (batch_id, requested_test_id, analyte_id, entry_id, run_no, mode, justification, result_key)
    VALUES (p_batch, p_rt, p_analyte, p_entry, p_run, 'Pick', NULLIF(btrim(p_justification), ''), p_key);
    PERFORM set_testing_internal(false);
END $$;

-- Report the average of the readings ticked (at least two numbers); leaving readings out needs a justification
CREATE FUNCTION average_results(p_batch uuid, p_rt uuid, p_analyte uuid, p_readings jsonb, p_justification text DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; c jsonb; n_num integer; n_ok integer; rd jsonb;
BEGIN
    b := assert_can_choose(p_batch, p_key);
    SELECT i.candidates INTO c FROM batch_review_items(p_batch, p_key) i WHERE i.requested_test_id = p_rt AND i.analyte_id = p_analyte;
    IF c IS NULL THEN RAISE EXCEPTION 'That sample and analyte are not in this batch'; END IF;
    SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object('entry_id', y->>'entry_id', 'run_no', (y->>'run_no')::int)), '[]') INTO rd FROM jsonb_array_elements(COALESCE(p_readings, '[]')) y;
    IF jsonb_array_length(rd) < 2 THEN RAISE EXCEPTION 'Tick at least two readings to average'; END IF;
    SELECT count(*) FILTER (WHERE x->>'value' IS NOT NULL) INTO n_num FROM jsonb_array_elements(c) x;
    SELECT count(*) INTO n_ok FROM jsonb_array_elements(rd) y
     WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(c) x WHERE x->>'entry_id' = y->>'entry_id' AND (x->>'run_no')::int = (y->>'run_no')::int AND x->>'value' IS NOT NULL);
    IF n_ok <> jsonb_array_length(rd) THEN RAISE EXCEPTION 'Only numeric readings of this sample in this batch can be averaged'; END IF;
    IF n_ok < n_num AND COALESCE(btrim(p_justification), '') = '' THEN
        RAISE EXCEPTION 'Write why % of the % readings are left out of the average', n_num - n_ok, n_num;
    END IF;
    PERFORM ensure_reason('Average of readings reported');
    PERFORM set_testing_internal(true);
    UPDATE result_choice SET status = 'Inactive' WHERE batch_id = p_batch AND requested_test_id = p_rt AND analyte_id = p_analyte AND result_key IS NOT DISTINCT FROM p_key AND status = 'Active';
    INSERT INTO result_choice (batch_id, requested_test_id, analyte_id, entry_id, run_no, mode, justification, readings, result_key)
    VALUES (p_batch, p_rt, p_analyte, (rd->0->>'entry_id')::uuid, (rd->0->>'run_no')::int, 'Average', NULLIF(btrim(p_justification), ''), rd, p_key);
    PERFORM set_testing_internal(false);
END $$;

DROP FUNCTION accept_qc(uuid, uuid, uuid, text, text);
CREATE FUNCTION accept_qc(p_batch uuid, p_entry uuid, p_analyte uuid, p_limit_type text, p_justification text, p_run integer DEFAULT 1) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; v record;
BEGIN
    b := assert_can_review(p_batch);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    IF COALESCE(btrim(p_justification), '') = '' THEN RAISE EXCEPTION 'Write why the QC result is acceptable'; END IF;
    SELECT * INTO v FROM batch_qc_verdicts(p_batch) x WHERE x.entry_id = p_entry AND x.analyte_id IS NOT DISTINCT FROM p_analyte AND x.limit_type = p_limit_type AND x.analytical_run = COALESCE(p_run, 1);
    IF v.verdict IS NULL THEN RAISE EXCEPTION 'That QC check is not in this batch'; END IF;
    IF v.verdict NOT IN ('Fail','Waiting') THEN RAISE EXCEPTION 'Only a failed or waiting QC check needs accepting (this one is %)', v.verdict; END IF;
    PERFORM ensure_reason('QC accepted by the reviewer');
    PERFORM set_testing_internal(true);
    UPDATE qc_acceptance SET status = 'Inactive' WHERE batch_id = p_batch AND entry_id = p_entry AND analyte_id IS NOT DISTINCT FROM p_analyte AND limit_type = p_limit_type
       AND analytical_run = COALESCE(p_run, 1) AND status = 'Active';
    INSERT INTO qc_acceptance (batch_id, entry_id, analyte_id, limit_type, verdict, measured, justification, analytical_run)
    VALUES (p_batch, p_entry, p_analyte, p_limit_type, v.verdict, v.measured, btrim(p_justification), COALESCE(p_run, 1));
    PERFORM set_testing_internal(false);
END $$;

-- What still stops the final approval: as in 020, plus the results of timepoints not released, and QC per run
CREATE OR REPLACE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; t record; k text; used integer[]; done text[] := '{}';
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.status <> 'Awaiting Review' THEN RETURN QUERY SELECT 'The batch is ' || b.status || ', not waiting for review'; RETURN; END IF;
    RETURN QUERY SELECT 'Step "' || s.step_name || '": not approved yet (open it and click Approve step)'
      FROM review_step_runs(p_batch) s WHERE s.mark_id IS NULL;
    RETURN QUERY SELECT i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
      FROM batch_review_items(p_batch) i WHERE i.chosen_entry_id IS NULL;
    -- timepoint results not released before are stored with the final approval: they need their readings chosen too
    FOR t IN SELECT * FROM batch_timepoints(p_batch) x WHERE x.released LOOP done := done || t.keys; END LOOP;
    FOR t IN SELECT * FROM batch_timepoints(p_batch) x WHERE NOT x.released LOOP
        FOREACH k IN ARRAY t.keys LOOP
            CONTINUE WHEN k = ANY (done);
            done := done || k;
            RETURN QUERY SELECT t.step_name || ': ' || i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
              FROM batch_review_items(p_batch, k) i WHERE i.chosen_entry_id IS NULL;
        END LOOP;
    END LOOP;
    used := batch_used_runs(p_batch);
    RETURN QUERY SELECT v.label || ' ' || COALESCE(v.analyte_name, '') || ' ' || v.limit_type || CASE WHEN v.analytical_run > 1 THEN ' (run ' || v.analytical_run || ')' ELSE '' END
                        || ': ' || lower(v.verdict) || ', accept it with a justification or return the batch'
      FROM batch_qc_verdicts(p_batch) v
     WHERE v.verdict IN ('Fail','Waiting') AND qc_verdict_counts(v.entry_id, v.analytical_run, used)
       AND NOT EXISTS (SELECT 1 FROM qc_acceptance q WHERE q.batch_id = p_batch AND q.entry_id = v.entry_id AND q.analyte_id IS NOT DISTINCT FROM v.analyte_id
                         AND q.limit_type = v.limit_type AND q.analytical_run = v.analytical_run AND q.status = 'Active');
END $$;

-------------------------------------------------------------------------------
-- 8. STEP APPROVALS FOR A TIMEPOINT; RELEASING PRELIMINARY RESULTS
-------------------------------------------------------------------------------
-- A step may be approved in review once the batch waits for review, or earlier when it feeds a timepoint ready for review
CREATE OR REPLACE FUNCTION approve_review_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; t text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    b := assert_can_review(r.batch_id);
    SELECT ws.step_type::text INTO t FROM workflow_step ws WHERE ws.id = r.step_id;
    IF t = 'QC Review' THEN RAISE EXCEPTION 'The QC Review is approved with the batch (Approve batch)'; END IF;
    IF b.status <> 'Awaiting Review' AND NOT (b.status = 'In Progress' AND EXISTS (SELECT 1 FROM batch_timepoints(b.id) x WHERE x.ready AND NOT x.released
                                                                                AND r.step_id IN (SELECT a.step_id FROM step_ancestors(x.step_id) a))) THEN
        RAISE EXCEPTION 'Batch % is %: steps are approved once every bench step is completed (or, for a timepoint review, the steps before it)', b.batch_code, b.status;
    END IF;
    IF r.status <> 'Completed' THEN RAISE EXCEPTION 'Only a completed step can be approved'; END IF;
    IF EXISTS (SELECT 1 FROM review_step_mark WHERE step_run_id = p_step_run AND status = 'Active') THEN RETURN; END IF;
    PERFORM ensure_reason('Step approved in QC Review');
    PERFORM set_testing_internal(true);
    INSERT INTO review_step_mark (batch_id, step_run_id) VALUES (r.batch_id, p_step_run);
    PERFORM set_testing_internal(false);
END $$;

CREATE OR REPLACE FUNCTION withdraw_review_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    b := assert_can_review(r.batch_id);
    IF b.status NOT IN ('Awaiting Review','In Progress') THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    IF step_feeds_release(p_step_run) IS NOT NULL THEN RAISE EXCEPTION 'This step fed released preliminary results; its approval stands'; END IF;
    PERFORM ensure_reason('Step approval undone in QC Review');
    PERFORM set_testing_internal(true);
    UPDATE review_step_mark SET status = 'Inactive', withdrawn_note = 'Undone by the reviewer' WHERE step_run_id = p_step_run AND status = 'Active';
    PERFORM set_testing_internal(false);
END $$;

-- What stops a timepoint's release (empty = ready)
CREATE FUNCTION timepoint_problems(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE t record; k text; done text[] := '{}'; x record; v_batch uuid;
BEGIN
    SELECT batch_id INTO v_batch FROM step_run WHERE id = p_step_run;
    SELECT * INTO t FROM batch_timepoints(v_batch) z WHERE z.step_run_id = p_step_run;
    IF t.step_run_id IS NULL THEN RETURN QUERY SELECT 'Not a timepoint review'; RETURN; END IF;
    IF t.released THEN RETURN QUERY SELECT 'Already released'; RETURN; END IF;
    IF NOT t.ready THEN RETURN QUERY SELECT 'The steps before it are not completed yet'; RETURN; END IF;
    RETURN QUERY SELECT 'Step "' || ws.step_name || '": not approved yet (open it and click Approve step)'
      FROM step_ancestors(t.step_id) a JOIN workflow_step ws ON ws.id = a.step_id JOIN step_run p ON p.step_id = ws.id AND p.batch_id = v_batch
     WHERE ws.step_type <> 'QC Review' AND NOT EXISTS (SELECT 1 FROM review_step_mark m WHERE m.step_run_id = p.id AND m.status = 'Active')
     ORDER BY ws.sort_order;
    FOR x IN SELECT * FROM batch_timepoints(v_batch) z WHERE z.released LOOP done := done || x.keys; END LOOP;
    FOREACH k IN ARRAY t.keys LOOP
        CONTINUE WHEN k = ANY (done);
        RETURN QUERY SELECT i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
          FROM batch_review_items(v_batch, k) i WHERE i.chosen_entry_id IS NULL;
    END LOOP;
END $$;

-- Release a timepoint (signed "Reviewed by"): its results are stored as Preliminary; the steps before it are locked
CREATE FUNCTION release_timepoint(p_step_run uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; t record; n integer; first_problem text; k text; i record; sig uuid; done text[] := '{}'; x record;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    b := assert_can_review(r.batch_id);
    IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is %', b.batch_code, b.status; END IF;
    SELECT * INTO t FROM batch_timepoints(r.batch_id) z WHERE z.step_run_id = p_step_run;
    IF t.step_run_id IS NULL THEN RAISE EXCEPTION 'Only a timepoint review (a QC Review set to Timepoint, before the final result) releases preliminary results'; END IF;
    IF t.released THEN RAISE EXCEPTION '"%" is already released', t.step_name; END IF;
    PERFORM assert_signed('release preliminary results');
    SELECT count(*), min(problem) INTO n, first_problem FROM timepoint_problems(p_step_run);
    IF n > 0 THEN RAISE EXCEPTION '"%" cannot be released yet (% thing% to resolve), e.g.: %', t.step_name, n, CASE WHEN n > 1 THEN 's' ELSE '' END, first_problem; END IF;
    sig := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
    PERFORM ensure_reason('Timepoint reviewed: preliminary results released');
    PERFORM set_testing_internal(true);
    FOR x IN SELECT * FROM batch_timepoints(r.batch_id) z WHERE z.released LOOP done := done || x.keys; END LOOP;
    n := 0;
    FOREACH k IN ARRAY t.keys LOOP
        CONTINUE WHEN k = ANY (done);
        FOR i IN SELECT * FROM batch_review_items(r.batch_id, k) LOOP
            INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit, conformance, approved_by, signature_id,
                                     result_key, stage, basis, justification, averaged, released_step_run_id)
            VALUES (i.requested_test_id, i.analyte_id, r.batch_id, i.chosen_entry_id, i.chosen_run_no, i.value, i.value_text, i.reported, i.unit, 'Not compared', current_app_user(), sig,
                    k, 'Preliminary', CASE WHEN i.mode = 'Average' THEN 'Average' WHEN jsonb_array_length(i.candidates) > 1 THEN 'Picked' ELSE 'Single' END, i.justification, i.readings, p_step_run);
            n := n + 1;
        END LOOP;
    END LOOP;
    UPDATE step_run SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(), signature_id = sig WHERE id = p_step_run;
    PERFORM set_testing_internal(false);
    PERFORM refresh_batch_orders(r.batch_id);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 9. APPROVAL, RETURN, CANCEL
-------------------------------------------------------------------------------
-- Approve: the final results and every timepoint's (released ones carried over unchanged) are stored as Final
CREATE OR REPLACE FUNCTION approve_batch(p_batch uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE b test_batch; n integer; first_problem text; i record; sig uuid; t record; k text; done text[] := '{}'; pre test_result; v_new uuid;
BEGIN
    b := assert_can_review(p_batch);
    PERFORM assert_signed('approve a batch');
    SELECT count(*), min(problem) INTO n, first_problem FROM batch_review_problems(p_batch);
    IF n > 0 THEN RAISE EXCEPTION '% cannot be approved yet (% thing% to resolve), e.g.: %', b.batch_code, n, CASE WHEN n > 1 THEN 's' ELSE '' END, first_problem; END IF;
    sig := NULLIF(current_setting('lims.signature_id', true), '')::uuid;
    PERFORM ensure_reason('Batch reviewed and approved');
    PERFORM set_testing_internal(true);
    n := 0;
    FOR i IN SELECT * FROM batch_review_items(p_batch) LOOP
        UPDATE test_result SET status = 'Superseded' WHERE requested_test_id = i.requested_test_id AND analyte_id = i.analyte_id AND result_key IS NULL AND status = 'Active';
        INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit,
                                 spec_min, spec_max, spec_text, spec_unit, conformance, approved_by, signature_id, stage, basis, justification, averaged)
        VALUES (i.requested_test_id, i.analyte_id, p_batch, i.chosen_entry_id, i.chosen_run_no, i.value, i.value_text, i.reported, i.unit,
                i.spec_min, i.spec_max, i.spec_text, i.spec_unit, COALESCE(i.conformance, 'Not compared'), current_app_user(), sig, 'Final',
                CASE WHEN i.mode = 'Average' THEN 'Average' WHEN jsonb_array_length(i.candidates) > 1 THEN 'Picked' ELSE 'Single' END, i.justification, i.readings);
        n := n + 1;
    END LOOP;
    -- timepoint results: a released (preliminary) result is carried into the final unchanged; the rest are stored now
    FOR t IN SELECT * FROM batch_timepoints(p_batch) LOOP
        FOREACH k IN ARRAY t.keys LOOP
            CONTINUE WHEN k = ANY (done);
            done := done || k;
            FOR i IN SELECT * FROM batch_review_items(p_batch, k) LOOP
                SELECT * INTO pre FROM test_result WHERE requested_test_id = i.requested_test_id AND analyte_id = i.analyte_id AND result_key = k AND status = 'Active';
                IF pre.id IS NOT NULL AND pre.stage = 'Preliminary' THEN
                    UPDATE test_result SET status = 'Superseded' WHERE id = pre.id;
                    INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit, conformance, approved_by, signature_id,
                                             result_key, stage, basis, justification, averaged, released_step_run_id, carried_from_id)
                    VALUES (pre.requested_test_id, pre.analyte_id, p_batch, pre.entry_id, pre.run_no, pre.value_num, pre.value_text, pre.reported, pre.unit, pre.conformance,
                            current_app_user(), sig, k, 'Final', pre.basis, pre.justification, pre.averaged, pre.released_step_run_id, pre.id);
                ELSE
                    UPDATE test_result SET status = 'Superseded' WHERE requested_test_id = i.requested_test_id AND analyte_id = i.analyte_id AND result_key = k AND status = 'Active';
                    INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit, conformance, approved_by, signature_id,
                                             result_key, stage, basis, justification, averaged)
                    VALUES (i.requested_test_id, i.analyte_id, p_batch, i.chosen_entry_id, i.chosen_run_no, i.value, i.value_text, i.reported, i.unit, 'Not compared', current_app_user(), sig,
                            k, 'Final', CASE WHEN i.mode = 'Average' THEN 'Average' WHEN jsonb_array_length(i.candidates) > 1 THEN 'Picked' ELSE 'Single' END, i.justification, i.readings);
                END IF;
                n := n + 1;
            END LOOP;
        END LOOP;
    END LOOP;
    UPDATE step_run r SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(), signature_id = sig
      FROM workflow_step ws WHERE ws.id = r.step_id AND r.batch_id = p_batch AND ws.step_type = 'QC Review' AND r.status <> 'Completed';
    UPDATE test_batch SET status = 'Approved', reviewed_by = current_app_user(), reviewed_at = clock_timestamp(), review_signature_id = sig WHERE id = p_batch;
    PERFORM set_testing_internal(false);
    PERFORM refresh_batch_orders(p_batch);
    RETURN n;
END $$;

-- Return: as in 018, never from a step that fed released preliminary results
CREATE OR REPLACE FUNCTION return_batch(p_batch uuid, p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; r step_run;
BEGIN
    b := assert_can_review(p_batch);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    PERFORM assert_signed('return a batch');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say what the analyst needs to fix'; END IF;
    SELECT * INTO r FROM step_run WHERE id = p_step_run AND batch_id = p_batch;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Choose a step of this batch'; END IF;
    PERFORM assert_not_released(r.id);
    PERFORM set_testing_internal(true);
    UPDATE step_run x SET status = 'In progress'
     WHERE x.batch_id = p_batch AND x.status = 'Completed'
       AND (x.id = r.id OR x.step_id IN (SELECT ws.id FROM workflow_step ws WHERE r.step_id IN (SELECT step_id FROM step_ancestors(ws.id))));
    UPDATE test_batch SET status = 'In Progress', returned_by = current_app_user(), returned_at = clock_timestamp(), returned_reason = current_reason() WHERE id = p_batch;
    PERFORM set_testing_internal(false);
END $$;

-- Cancel: as in 018, but not once preliminary results were released
CREATE OR REPLACE FUNCTION cancel_batch(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    IF NOT (has_permission_at('testing.assign', b.site_id) OR has_permission_at('testing.review', b.site_id)) THEN
        RAISE EXCEPTION 'Cancelling a batch needs testing.assign or testing.review in this lab';
    END IF;
    IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is already %', b.batch_code, lower(b.status::text); END IF;
    IF EXISTS (SELECT 1 FROM test_result WHERE batch_id = p_batch AND stage = 'Preliminary' AND status = 'Active') THEN
        RAISE EXCEPTION 'Batch % has released preliminary results and cannot be cancelled (the OOS and retest slice will handle this)', b.batch_code;
    END IF;
    PERFORM assert_signed('cancel a batch');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the batch is cancelled'; END IF;
    PERFORM set_testing_internal(true);
    UPDATE reprep_request SET status = 'Pooled', batch_id = NULL WHERE batch_id = p_batch AND status = 'Batched';
    UPDATE test_batch SET status = 'Cancelled', cancelled_by = current_app_user(), cancelled_at = clock_timestamp(), cancelled_reason = current_reason() WHERE id = p_batch;
    PERFORM set_testing_internal(false);
    PERFORM refresh_batch_orders(p_batch);
END $$;

-------------------------------------------------------------------------------
-- 10. ORDER STATUS: In Testing, In Review, Approved (Reported comes with reports)
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_order_status(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o lab_order; n_tests integer; n_done integer; n_batched integer; n_review integer; s lab_order_status; fallback lab_order_status; gs text;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.id IS NULL OR o.status IN ('Draft','Reported') THEN RETURN; END IF;
    fallback := CASE WHEN EXISTS (SELECT 1 FROM sample sm WHERE sm.lab_order_id = o.id AND sm.status = 'Expected') THEN 'Submitted' ELSE 'Received' END;
    SELECT count(*),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final')
                                  AND NOT EXISTS (SELECT 1 FROM reprep_request rp WHERE rp.requested_test_id = rt.id AND rp.status = 'Pooled')),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled')),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND e.status = 'Active' AND b.status = 'Awaiting Review')
                                  AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.result_key IS NULL AND tr.stage = 'Final'))
      INTO n_tests, n_done, n_batched, n_review
      FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id WHERE sm.lab_order_id = o.id AND rt.status <> 'Cancelled' AND sm.status <> 'Cancelled';
    -- In Review: no test is left at the bench (each is approved or in a batch waiting for review), and one waits for review
    s := CASE WHEN n_tests > 0 AND n_done = n_tests THEN 'Approved' WHEN n_review > 0 AND n_done + n_review >= n_tests THEN 'In Review' WHEN n_batched > 0 THEN 'In Testing' ELSE fallback END;
    IF s = o.status OR (s = fallback AND o.status NOT IN ('In Testing','In Review','Approved','Complete')) THEN RETURN; END IF;
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);   -- a system status change, not someone's edit
    PERFORM ensure_reason('Order status follows its tests');
    UPDATE lab_order SET status = s WHERE id = o.id;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;
-- a batch that reaches review (or goes back to the bench) moves its orders
CREATE FUNCTION test_batch_status_orders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_batch_orders(NEW.id);
    RETURN NULL;
END $$;
CREATE TRIGGER z_order_status AFTER UPDATE OF status ON test_batch FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION test_batch_status_orders();

-------------------------------------------------------------------------------
-- 11. SPLIT OFF: customer consent is a setting of the step
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION make_split_requests() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws workflow_step; e record; f text; rt2 uuid; trig text; prev text := COALESCE(current_setting('lims.testing_internal', true), '');
        consent boolean; v_id uuid; v_line uuid; gs text;
BEGIN
    IF NEW.status <> 'Completed' OR OLD.status = 'Completed' THEN RETURN NULL; END IF;
    SELECT * INTO ws FROM workflow_step WHERE id = NEW.step_id;
    IF ws.step_type <> 'Split off Test' OR (ws.config->>'test_id') IS NULL THEN RETURN NULL; END IF;
    trig := COALESCE(ws.config->>'trigger', 'On finding');
    -- steps designed before the setting existed keep asking for consent
    consent := COALESCE((ws.config->>'consent_required')::boolean, true);
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
        INSERT INTO split_request (step_run_id, batch_id, entry_id, sample_id, origin_requested_test_id, test_id, finding, status, ordered_requested_test_id, decision_note)
        VALUES (NEW.id, NEW.batch_id, e.id, e.sample_id, e.requested_test_id, (ws.config->>'test_id')::uuid, COALESCE(f, 'Always split off'),
                CASE WHEN rt2 IS NOT NULL THEN 'Ordered' WHEN consent THEN 'Awaiting consent' ELSE 'To order' END, rt2,
                CASE WHEN rt2 IS NULL AND NOT consent THEN 'Customer consent not needed (workflow setting)' END)
        RETURNING id INTO v_id;
        IF rt2 IS NULL AND NOT consent THEN
            -- ordered at once from the client's accepted quote (a system action set by the approved workflow)
            v_line := NULL;
            SELECT ol.line_id INTO v_line FROM sample sm JOIN lab_order o ON o.id = sm.lab_order_id CROSS JOIN LATERAL orderable_lines(o.client_id) ol
             WHERE sm.id = e.sample_id AND ol.test_id = (ws.config->>'test_id')::uuid LIMIT 1;
            IF v_line IS NULL THEN
                UPDATE split_request SET decision_note = decision_note || '. The test is not on an accepted quote for this client: quote it, then order it on the sample page' WHERE id = v_id;
            ELSE
                BEGIN
                    gs := COALESCE(current_setting('lims.group_sync', true), '');
                    PERFORM set_config('lims.group_sync', '1', true);
                    PERFORM order_test(e.sample_id, v_line);
                    PERFORM set_config('lims.group_sync', gs, true);
                EXCEPTION WHEN others THEN
                    UPDATE split_request SET decision_note = decision_note || '. Not ordered automatically: ' || SQLERRM WHERE id = v_id;
                END;
            END IF;
        END IF;
    END LOOP;
    PERFORM set_config('lims.testing_internal', prev, true);   -- runs inside complete_step: leave its setting as it was
    RETURN NULL;
END $$;

-- Ordering the test on the sample closes the request (also one waiting "To order")
CREATE OR REPLACE FUNCTION split_request_ordered() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text := COALESCE(current_setting('lims.testing_internal', true), '');
BEGIN
    IF EXISTS (SELECT 1 FROM split_request WHERE sample_id = NEW.sample_id AND test_id = NEW.test_id AND status IN ('Awaiting consent','Consent given','To order')) THEN
        PERFORM set_testing_internal(true);
        UPDATE split_request SET status = 'Ordered', ordered_requested_test_id = NEW.id
         WHERE sample_id = NEW.sample_id AND test_id = NEW.test_id AND status IN ('Awaiting consent','Consent given','To order');
        PERFORM set_config('lims.testing_internal', prev, true);
    END IF;
    RETURN NULL;
END $$;

-- create_batch: re-preps are labelled RP1-, RP2-... (Alex, WD-5)
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
                    CASE WHEN it.kind = 'Re-prep'
                         -- RP1-, RP2-...: re-preps of the same test are numbered on, never reused (Alex, WD-5)
                         THEN 'RP' || ((SELECT count(*) FROM batch_entry x WHERE x.requested_test_id = it.requested_test_id AND x.reprep_request_id IS NOT NULL) + 1) || '-'
                         ELSE '' END || COALESCE(it.sample_code, it.client_sample_id),
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

-- batch_results: a Hold Point uses the other test's final result (not a preliminary one)
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
                              JOIN test_result tr ON tr.requested_test_id = rt2.id AND tr.status = 'Active' AND tr.analyte_id = a.analyte_id AND tr.result_key IS NULL AND tr.stage = 'Final'
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

-- step_run_missing: readings, raw data and instrument per analytical run
CREATE OR REPLACE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE r step_run; ws workflow_step; b test_batch; n integer; e record; a record; fl jsonb; rn integer; needs_eq boolean; ids jsonb; k integer; kmax integer;
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
        kmax := analytical_runs(r.id);
        FOR e IN SELECT * FROM batch_entry e2 WHERE e2.batch_id = b.id AND e2.status = 'Active' AND e2.daily_of_entry_id IS NULL ORDER BY e2.position LOOP
            FOR k IN 1..kmax LOOP
                n := 0;
                FOR a IN SELECT tva.analyte_id, an.analyte_name FROM test_version_analyte tva JOIN analyte an ON an.id = tva.analyte_id
                          WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active'
                            AND (ids IS NULL OR jsonb_array_length(ids) = 0 OR ids ? tva.analyte_id::text) LOOP
                    FOR rn IN 1..entry_runs(r.id, e.id) LOOP
                        CONTINUE WHEN reading_run(r.id, e.id, rn) <> k;
                        IF NOT EXISTS (SELECT 1 FROM entry_value ev WHERE ev.step_run_id = r.id AND ev.entry_id = e.id AND ev.analyte_id = a.analyte_id AND ev.run_no = rn
                                        AND ev.status = 'Active' AND (ev.value_num IS NOT NULL OR ev.value_text IS NOT NULL)) THEN n := n + 1; END IF;
                    END LOOP;
                END LOOP;
                IF n > 0 THEN RETURN QUERY SELECT CASE WHEN kmax > 1 THEN 'Run ' || k || ': ' ELSE '' END || e.label || ': ' || n || ' reading' || CASE WHEN n > 1 THEN 's' ELSE '' END || ' missing'; END IF;
            END LOOP;
        END LOOP;
        -- each analytical run has its own raw data file and instrument (WD-5)
        FOR k IN 1..kmax LOOP
            IF COALESCE(ws.config->>'require_attachment', 'true') <> 'false' AND NOT EXISTS (SELECT 1 FROM step_attachment WHERE step_run_id = r.id AND status = 'Active' AND analytical_run_no = k) THEN
                RETURN QUERY SELECT 'Attach the raw data (the instrument export)' || CASE WHEN kmax > 1 THEN ' of run ' || k ELSE '' END;
            END IF;
            IF needs_eq AND NOT EXISTS (SELECT 1 FROM entry_equipment q WHERE q.step_run_id = r.id AND q.status = 'Active' AND q.analytical_run_no = k) THEN
                RETURN QUERY SELECT 'Record the instrument used' || CASE WHEN kmax > 1 THEN ' for run ' || k ELSE '' END;
            END IF;
        END LOOP;
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
-- 12. VIEWS AND AUDIT REFERENCES
-------------------------------------------------------------------------------
DROP VIEW test_result_view;
CREATE VIEW test_result_view AS
SELECT tr.*, a.analyte_name, a.report_name, rt.sample_id, rt.test_id, t.test_code, t.test_name, b.batch_code, u.full_name AS approved_by_name, s.sample_code, s.client_sample_id,
       (SELECT ws.step_name FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.step_key = tr.result_key AND ws.status = 'Active' LIMIT 1) AS result_name,
       (SELECT ws.step_name FROM step_run sr JOIN workflow_step ws ON ws.id = sr.step_id WHERE sr.id = tr.released_step_run_id) AS released_by_step
  FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN test t ON t.id = rt.test_id
  JOIN test_batch b ON b.id = tr.batch_id JOIN app_user u ON u.id = tr.approved_by JOIN sample s ON s.id = rt.sample_id;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_wd5;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_batch uuid;
BEGIN
    IF p_table = 'analytical_run' THEN
        SELECT sr.batch_id INTO v_batch FROM step_run sr WHERE sr.id = (r->>'step_run_id')::uuid;
        RETURN jsonb_build_object('label', 'Analytical run ' || (r->>'run_no') || ' in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = v_batch), ''),
                                  'link', '#/testing/batches/' || v_batch);
    END IF;
    RETURN audit_record_ref_wd5(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
