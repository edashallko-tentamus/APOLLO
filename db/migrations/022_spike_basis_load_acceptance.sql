-- LIMS3 schema, migration 022: WD-5.1 (Alex Kiddle, 2026-10-13, answering the questions after WD-5; vault: "Decision -
-- Analytical Runs, Preliminary Results and Order Statuses", WD-5.1 section). Built by Claude in the cloud.
--  - Spike recovery: a matrix spike (and its duplicate) is judged against the reviewer's chosen result of the spiked
--    sample (the reading picked, or the average). Until the reviewer chooses, the sample's reading in the same run.
--  - Incubator loads outside their window or temperature: the analyst still explains each in the load's note, and the
--    reviewer now accepts each one with a justification before the batch (or the timepoint it feeds) is approved.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

-- The reviewer's acceptance of a load outside its window or temperature (kept with what was out at the time)
CREATE TABLE load_acceptance (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid NOT NULL REFERENCES test_batch(id),
    load_id         uuid NOT NULL REFERENCES incubation_load(id),
    check_text      text NOT NULL,              -- what was outside the target when it was accepted
    justification   text NOT NULL CHECK (btrim(justification) <> ''),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX load_acceptance_uq ON load_acceptance (load_id) WHERE status = 'Active';
CALL make_gxp('load_acceptance', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON load_acceptance FOR EACH ROW EXECUTE FUNCTION review_tables_rules();

-- Loads of a batch (optionally only of the given steps) outside their target and not accepted as they are now
CREATE FUNCTION batch_load_problems(p_batch uuid, p_steps uuid[] DEFAULT NULL) RETURNS TABLE (problem text, load_id uuid) LANGUAGE sql STABLE AS $$
    SELECT 'Incubator load in ' || l.equipment_code || ' (' || ws.step_name || '): ' || l.check_text || '; the reviewer accepts it with a justification', l.id
      FROM incubation_load_view l JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
     WHERE l.batch_id = p_batch AND l.status = 'Active' AND l.check_text IS NOT NULL AND (p_steps IS NULL OR r.step_id = ANY (p_steps))
       AND NOT EXISTS (SELECT 1 FROM load_acceptance a WHERE a.load_id = l.id AND a.status = 'Active' AND a.check_text = l.check_text)
     ORDER BY l.time_in
$$;

-- Accept a load (testing.review, not someone who did the work): while the batch waits for review, or earlier when the
-- load feeds a timepoint ready for review
CREATE FUNCTION accept_load(p_batch uuid, p_load uuid, p_justification text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; l record;
BEGIN
    b := assert_can_review(p_batch);
    SELECT lv.*, r.step_id INTO l FROM incubation_load_view lv JOIN step_run r ON r.id = lv.step_run_id WHERE lv.id = p_load AND lv.batch_id = p_batch AND lv.status = 'Active';
    IF l.id IS NULL THEN RAISE EXCEPTION 'That load is not in this batch'; END IF;
    IF l.check_text IS NULL THEN RAISE EXCEPTION 'That load is within its window and temperature: nothing to accept'; END IF;
    IF b.status <> 'Awaiting Review' AND NOT (b.status = 'In Progress' AND EXISTS (SELECT 1 FROM batch_timepoints(p_batch) t WHERE t.ready AND NOT t.released
                                                                                 AND l.step_id IN (SELECT a.step_id FROM step_ancestors(t.step_id) a))) THEN
        RAISE EXCEPTION 'Batch % is %: loads are accepted in QC Review', b.batch_code, b.status;
    END IF;
    IF COALESCE(btrim(p_justification), '') = '' THEN RAISE EXCEPTION 'Write why the load is acceptable'; END IF;
    PERFORM ensure_reason('Incubator load accepted by the reviewer');
    PERFORM set_testing_internal(true);
    UPDATE load_acceptance SET status = 'Inactive' WHERE load_id = p_load AND status = 'Active';
    INSERT INTO load_acceptance (batch_id, load_id, check_text, justification) VALUES (p_batch, p_load, l.check_text, btrim(p_justification));
    PERFORM set_testing_internal(false);
END $$;

-- batch_qc_verdicts (as in 021): a matrix spike is judged against the reviewer's chosen result of its sample
CREATE OR REPLACE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text, analytical_run integer, run_no integer)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; q record; e record; res jsonb := '{}'; rtx jsonb := '{}'; ob text; r record; m numeric; v_final numeric; v_parent numeric; v_exp numeric; v_true numeric;
        v_unit text; de workflow_step; dr step_run; v_weight numeric; v_lim numeric; tva test_version_analyte; v_note text; v_other numeric; mat record; c numeric;
        k integer; kmax integer; rn integer; prn integer; ox uuid; orn integer; chosen jsonb := '{}'; v_prt uuid; v_pnote text;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    -- every final result, per entry, analyte and reading
    FOR r IN SELECT x.entry_id, x.analyte_id, x.run_no, x.value, x.value_text FROM batch_results(p_batch) x WHERE x.is_final LOOP
        IF r.value IS NOT NULL THEN res := res || jsonb_build_object(r.entry_id || ':' || r.analyte_id || ':' || r.run_no, r.value); END IF;
        IF r.value_text IS NOT NULL THEN rtx := rtx || jsonb_build_object(r.entry_id || ':' || r.analyte_id || ':' || r.run_no, r.value_text); END IF;
    END LOOP;
    -- the reviewer's chosen result of each sample (WD-5.1: a spike is judged against it)
    IF EXISTS (SELECT 1 FROM batch_entry x WHERE x.batch_id = p_batch AND x.status = 'Active' AND x.qc_type IN ('Matrix Spike','Matrix Spike Duplicate')) THEN
        SELECT COALESCE(jsonb_object_agg(i.requested_test_id || ':' || i.analyte_id, jsonb_build_object('v', i.value, 'n', jsonb_array_length(i.candidates), 'auto', i.auto_chosen)), '{}')
          INTO chosen FROM batch_review_items(p_batch) i WHERE i.chosen_entry_id IS NOT NULL AND i.value IS NOT NULL;
    END IF;
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
                v_pnote := '';
                IF e.qc_type IN ('Matrix Spike','Matrix Spike Duplicate') THEN
                    -- the spiked sample's result: the reviewer's chosen reading (or average); until then its reading in the same run
                    SELECT requested_test_id INTO v_prt FROM batch_entry WHERE id = e.parent_entry_id;
                    IF chosen ? (v_prt || ':' || q.analyte_id) THEN
                        v_parent := (chosen->(v_prt || ':' || q.analyte_id)->>'v')::numeric;
                        IF (chosen->(v_prt || ':' || q.analyte_id)->>'n')::int > 1 THEN v_pnote := ' (the reviewer''s chosen result)'; END IF;
                    ELSE
                        v_parent := (res->>(e.parent_entry_id || ':' || q.analyte_id || ':' || prn))::numeric;
                        IF EXISTS (SELECT 1 FROM batch_entry x WHERE x.requested_test_id = v_prt AND x.batch_id = p_batch AND x.status = 'Active' AND entry_runs(dr.id, x.id) > 1) THEN
                            v_pnote := ' (same run, until the reviewer chooses the sample''s result)';
                        END IF;
                    END IF;
                ELSE v_parent := 0; END IF;
                IF v_final IS NULL THEN verdict := 'Waiting'; note := 'No result yet';
                ELSIF v_exp IS NULL OR v_weight IS NULL THEN verdict := 'Not judged'; note := COALESCE(v_note, 'Record the spike (lot and volume) and the weight');
                ELSIF v_parent IS NULL THEN verdict := 'Waiting'; note := 'The spiked sample has no result yet';
                ELSIF v_exp = 0 THEN verdict := 'Not judged'; note := 'The amount spiked is zero';
                ELSE measured := round((v_final - v_parent) / v_exp * 100, 1);
                     note := 'found ' || round(v_final, 6) || CASE WHEN v_parent <> 0 THEN ' - sample ' || round(v_parent, 6) || v_pnote ELSE '' END || ' / spiked ' || round(v_exp, 6) || ' ' || COALESCE(tva.reporting_unit, '');
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

-- batch_review_problems (as in 021) and timepoint_problems: plus incubator loads not yet accepted by the reviewer
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
    -- incubator loads outside their window or temperature: the reviewer accepts each (WD-5.1)
    RETURN QUERY SELECT x.problem FROM batch_load_problems(p_batch) x;
    used := batch_used_runs(p_batch);
    RETURN QUERY SELECT v.label || ' ' || COALESCE(v.analyte_name, '') || ' ' || v.limit_type || CASE WHEN v.analytical_run > 1 THEN ' (run ' || v.analytical_run || ')' ELSE '' END
                        || ': ' || lower(v.verdict) || ', accept it with a justification or return the batch'
      FROM batch_qc_verdicts(p_batch) v
     WHERE v.verdict IN ('Fail','Waiting') AND qc_verdict_counts(v.entry_id, v.analytical_run, used)
       AND NOT EXISTS (SELECT 1 FROM qc_acceptance q WHERE q.batch_id = p_batch AND q.entry_id = v.entry_id AND q.analyte_id IS NOT DISTINCT FROM v.analyte_id
                         AND q.limit_type = v.limit_type AND q.analytical_run = v.analytical_run AND q.status = 'Active');
END $$;

CREATE OR REPLACE FUNCTION timepoint_problems(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
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
    RETURN QUERY SELECT y.problem FROM batch_load_problems(v_batch, ARRAY(SELECT a.step_id FROM step_ancestors(t.step_id) a)) y;
    FOR x IN SELECT * FROM batch_timepoints(v_batch) z WHERE z.released LOOP done := done || x.keys; END LOOP;
    FOREACH k IN ARRAY t.keys LOOP
        CONTINUE WHEN k = ANY (done);
        RETURN QUERY SELECT i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
          FROM batch_review_items(v_batch, k) i WHERE i.chosen_entry_id IS NULL;
    END LOOP;
END $$;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_wd51;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'load_acceptance' THEN
        RETURN jsonb_build_object('label', 'Incubator load accepted in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''),
                                  'link', '#/testing/batches/' || (r->>'batch_id'));
    END IF;
    RETURN audit_record_ref_wd51(p_table, p_id, r);
END $$;

COMMIT;
