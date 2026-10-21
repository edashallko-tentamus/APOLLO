-- A control counted 0 (the WD-6 defect found by verifying USP <51>; Alex's fix, agreed 2026-10-15, vault: Decision -
-- Stability Studies S-2 Scope, "Also decided the same day"):
--   "a control is judged on its calculated value when there is one (as Irvine does); when the calculation is
--    undefined because the count is 0 (the log of zero), the control is judged on its count (0 = no growth) and the
--    calculation does not block the step."
-- So: (1) a QC entry whose calculation is undefined only because a count it uses is 0 does not hold its Calculation
-- step open; (2) its Presence / Absence verdict uses the count: 0 is no growth (Absence passes, Presence fails).
-- Samples are unchanged: a sample's undefined result still waits (a client result needs a value).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 042: controls counted 0', true);

-- A calculation that is undefined because a count it uses is 0 (log or root of zero)
CREATE FUNCTION calc_undefined_at_zero(p_waiting text, p_inputs jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(p_waiting LIKE 'The formula takes the log or root of a value that is zero or negative%', false)
       AND EXISTS (SELECT 1 FROM jsonb_each(COALESCE(p_inputs, '{}')) e WHERE e.key LIKE '%.reading' AND jsonb_typeof(e.value) = 'number' AND (e.value)::text::numeric = 0)
$$;

-- (1) the Calculation step: such a control no longer counts as "waiting for data"
ALTER FUNCTION step_run_missing(uuid) RENAME TO step_run_missing_042;
CREATE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v_type text; v_key text; v_batch uuid; n integer; x record;
BEGIN
    SELECT ws.step_type, ws.step_key, r.batch_id INTO v_type, v_key, v_batch
      FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = p_step_run;
    FOR x IN SELECT * FROM step_run_missing_042(p_step_run) LOOP
        IF v_type = 'Calculation' AND x.problem ~ '^\d+ results? (are|is) still waiting for data$' THEN
            SELECT count(*) INTO n FROM batch_results(v_batch) r JOIN batch_entry be ON be.id = r.entry_id
             WHERE r.step_key = v_key AND r.waiting IS NOT NULL AND (be.entry_type = 'Sample' OR be.qc_class = 'Prep')
               AND NOT (be.entry_type = 'QC' AND calc_undefined_at_zero(r.waiting, r.inputs));
            IF n > 0 THEN problem := n || ' result' || CASE WHEN n > 1 THEN 's are' ELSE ' is' END || ' still waiting for data'; RETURN NEXT; END IF;
        ELSE
            problem := x.problem; RETURN NEXT;
        END IF;
    END LOOP;
END $$;

-- (2) the verdict: a Presence / Absence control whose final result is undefined at a count of 0 is judged on the count
ALTER FUNCTION batch_qc_verdicts(uuid) RENAME TO batch_qc_verdicts_042;
CREATE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text, analytical_run integer, run_no integer)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v record; z record; v_final text;
BEGIN
    SELECT final_calc_key(test_version_id) INTO v_final FROM test_batch WHERE id = p_batch;
    FOR v IN SELECT * FROM batch_qc_verdicts_042(p_batch) LOOP
        entry_id := v.entry_id; label := v.label; qc_type := v.qc_type; limit_type := v.limit_type; analyte_id := v.analyte_id; analyte_name := v.analyte_name;
        measured := v.measured; min_value := v.min_value; max_value := v.max_value; limit_text := v.limit_text; verdict := v.verdict; note := v.note;
        analytical_run := v.analytical_run; run_no := v.run_no;
        IF v.verdict = 'Waiting' AND v.measured IS NULL AND v.limit_type IN ('Absence','Presence') AND v.analyte_id IS NOT NULL THEN
            SELECT r.* INTO z FROM batch_results(p_batch) r
             WHERE r.entry_id = v.entry_id AND r.analyte_id = v.analyte_id AND r.step_key = v_final AND calc_undefined_at_zero(r.waiting, r.inputs)
             ORDER BY r.run_no DESC LIMIT 1;
            IF z.entry_id IS NOT NULL THEN
                measured := 0;
                verdict := CASE WHEN v.limit_type = 'Absence' THEN 'Pass' ELSE 'Fail' END;
                note := 'Judged on its count: 0 (no growth); the calculated result is undefined at zero';
            END IF;
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

COMMIT;
