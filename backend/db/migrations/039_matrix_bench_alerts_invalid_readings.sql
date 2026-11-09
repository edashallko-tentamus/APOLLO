-- 039: the matrix drives the bench, presumptive positive alerts, readings that are not results (Alex, 2026-10-15;
-- Claude in the cloud, version 0.21.0). For Colleen Villanueva's Salmonella BAX Q7 demo (MC-12.06, MC-12.04, MCF-034).
-- Vault: Decision - Matrix-Driven Bench, Presumptive Alerts and Invalid Readings.
--  F1. The sample's matrix (its product category) drives the bench:
--      - Weighing "a range per product category": each sample is checked against its own category's range (flagged at
--        the bench, as before); a category can be "Not weighed" (swabs), and Prep QC can be "not weighed" (controls);
--        the step no longer waits for a weight from them.
--      - Dilution amounts per category: the bench fills each sample's own amounts and flags a different amount.
--      - Incubation: an acceptable window per product category (e.g. dry pet food 22 to 26 h, others 20 to 24 h). A load
--        holding several categories is judged against the window they all share.
--  F2. Presumptive positive alert: a Split off Test step set to "Alert the client" emails the client's Positive alerts
--      contacts (else Receives Report, else the ordering contact) as soon as the step is completed on a finding. The
--      Outbox keeps who was told and when (and by whose step); the sample page shows it.
--  F3. Readings that are not results: per analyte, values such as Indeterminate or Signal error. They are never a
--      candidate for the reported result; the batch cannot be approved until the sample (or control) has a valid
--      reading in a new analytical run.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 039: matrix-driven bench, presumptive alerts, readings that are not results', true);

-------------------------------------------------------------------------------
-- 1. F1: THE SAMPLE'S PRODUCT CATEGORY AT THE BENCH
-------------------------------------------------------------------------------
-- A sample's product category: its matrix's (Admin > Matrices)
CREATE FUNCTION sample_product_category(p_sample uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT m.product_category_id FROM sample s JOIN matrix m ON lower(m.matrix_name) = lower(s.matrix) WHERE s.id = p_sample LIMIT 1
$$;
-- A batch entry's: a client sample's (QC entries have none)
CREATE FUNCTION entry_product_category(p_entry uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT sample_product_category(rt.sample_id) FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
     WHERE e.id = p_entry AND e.entry_type = 'Sample'
$$;
-- A step's setting for a product category (its by_category row), or NULL
CREATE FUNCTION category_setting(p_cfg jsonb, p_category uuid) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT o FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cfg->'by_category') = 'array' THEN p_cfg->'by_category' ELSE '[]'::jsonb END) o
     WHERE p_category IS NOT NULL AND o->>'category_id' = p_category::text LIMIT 1
$$;
-- Whether a Weighing step weighs this entry: not a client sample whose category is "Not weighed", not a Prep QC when
-- the step says controls are not weighed
CREATE FUNCTION entry_is_weighed(p_cfg jsonb, p_entry uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN e.entry_type = 'Sample'
                THEN NOT (COALESCE(p_cfg->>'target_mode', '') = 'By product category'
                          AND COALESCE(category_setting(p_cfg, entry_product_category(e.id))->>'not_weighed', 'false') = 'true')
                ELSE COALESCE(p_cfg->>'qc_not_weighed', 'false') <> 'true' END
      FROM batch_entry e WHERE e.id = p_entry
$$;

-- What stops a step being completed: as before (033), less the weights of entries the step does not weigh
ALTER FUNCTION step_run_missing(uuid) RENAME TO step_run_missing_033;
CREATE FUNCTION step_run_missing(p_step_run uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE r step_run; ws workflow_step; skip text[] := '{}';
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF ws.step_type = 'Weighing' THEN
        SELECT COALESCE(array_agg(e.label), '{}') INTO skip FROM batch_entry e
         WHERE e.batch_id = r.batch_id AND e.status = 'Active' AND NOT entry_is_weighed(ws.config, e.id);
    END IF;
    RETURN QUERY SELECT m.problem FROM step_run_missing_033(p_step_run) m
     WHERE cardinality(skip) = 0 OR NOT EXISTS (SELECT 1 FROM unnest(skip) k
                                                 WHERE m.problem = k || ': no weight' OR m.problem = k || ': record the balance used'
                                                    OR (starts_with(m.problem, k || ': ') AND m.problem ~ ' of [0-9]+ weights$'));
END $$;

-- The window an incubator load is judged against: the step's, or with windows per product category the window every
-- client sample in the load shares (the latest shortest, the earliest longest). A load of controls only uses the step's.
CREATE FUNCTION incubation_window(p_cfg jsonb, p_batch uuid, p_entries uuid[]) RETURNS TABLE (window_min numeric, window_max numeric) LANGUAGE sql STABLE AS $$
    WITH d AS (SELECT CASE WHEN jnum_ok(p_cfg, 'window_min', NULL) THEN (p_cfg->>'window_min')::numeric END AS dmin,
                      CASE WHEN jnum_ok(p_cfg, 'window_max', NULL) THEN (p_cfg->>'window_max')::numeric END AS dmax),
         w AS (SELECT CASE WHEN jnum_ok(cs, 'window_min', NULL) THEN (cs->>'window_min')::numeric ELSE d.dmin END AS mn,
                      CASE WHEN jnum_ok(cs, 'window_max', NULL) THEN (cs->>'window_max')::numeric ELSE d.dmax END AS mx
                 FROM batch_entry e CROSS JOIN d CROSS JOIN LATERAL (SELECT category_setting(p_cfg, entry_product_category(e.id)) AS cs) z
                WHERE e.batch_id = p_batch AND e.status = 'Active' AND e.entry_type = 'Sample' AND e.daily_of_entry_id IS NULL
                  AND (p_entries IS NULL OR e.id = ANY (p_entries)))
    SELECT CASE WHEN EXISTS (SELECT 1 FROM w) AND jsonb_typeof(p_cfg->'by_category') = 'array' THEN (SELECT max(mn) FROM w) ELSE (SELECT dmin FROM d) END,
           CASE WHEN EXISTS (SELECT 1 FROM w) AND jsonb_typeof(p_cfg->'by_category') = 'array' THEN (SELECT min(mx) FROM w) ELSE (SELECT dmax FROM d) END
$$;
-- The load view as in 019, with the window from incubation_window (the same as before when no window per category)
CREATE OR REPLACE VIEW incubation_load_view AS
SELECT x.*, NULLIF(concat_ws('; ',
         CASE WHEN x.duration IS NOT NULL AND ((x.window_min IS NOT NULL AND x.duration < x.window_min) OR (x.window_max IS NOT NULL AND x.duration > x.window_max))
              THEN 'incubated ' || round(x.duration, 1) || ' ' || x.duration_unit || ', outside ' || COALESCE(x.window_min::text, '') || ' to ' || COALESCE(x.window_max::text, '') || ' ' || x.duration_unit END,
         CASE WHEN x.temperature IS NOT NULL AND x.temp_c IS NOT NULL AND abs(x.temperature - x.temp_c) > COALESCE(x.temp_tolerance, 0)
              THEN 'temperature ' || x.temperature || ' °C, target ' || x.temp_c || ' ± ' || COALESCE(x.temp_tolerance, 0) || ' °C' END), '') AS check_text
  FROM (SELECT l.*, e.equipment_code, e.equipment_name, r.batch_id, COALESCE(ws.config->>'duration_unit', 'hours') AS duration_unit,
               w.window_min, w.window_max,
               CASE WHEN jnum_ok(ws.config, 'temp_c', NULL) THEN (ws.config->>'temp_c')::numeric END AS temp_c,
               CASE WHEN jnum_ok(ws.config, 'temp_tolerance', NULL) THEN (ws.config->>'temp_tolerance')::numeric END AS temp_tolerance,
               CASE WHEN l.time_out IS NULL THEN NULL
                    ELSE round((extract(epoch FROM l.time_out - l.time_in) / CASE WHEN ws.config->>'duration_unit' = 'days' THEN 86400 ELSE 3600 END)::numeric, 4) END AS duration
          FROM incubation_load l JOIN equipment e ON e.id = l.equipment_id JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
          CROSS JOIN LATERAL incubation_window(ws.config, r.batch_id, l.entry_ids) w) x;

-------------------------------------------------------------------------------
-- 2. F3: READINGS THAT ARE NOT RESULTS
-------------------------------------------------------------------------------
ALTER TABLE test_version_analyte ADD COLUMN invalid_values text[] NOT NULL DEFAULT '{}';
COMMENT ON COLUMN test_version_analyte.invalid_values IS 'Result values that are not results (e.g. Indeterminate, Signal error): the sample is read again in a new analytical run';
-- tidy the list; a new version's (or a copy's) analytes keep the source's list
CREATE FUNCTION tva_invalid_values_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE src uuid;
BEGIN
    NEW.invalid_values := ARRAY(SELECT btrim(x) FROM unnest(COALESCE(NEW.invalid_values, '{}')) WITH ORDINALITY u(x, n) WHERE btrim(x) <> '' GROUP BY btrim(x) ORDER BY min(n));
    IF TG_OP = 'INSERT' AND cardinality(NEW.invalid_values) = 0 THEN
        SELECT copied_from_version_id INTO src FROM test_version WHERE id = NEW.test_version_id;
        IF src IS NOT NULL THEN
            SELECT COALESCE(a.invalid_values, '{}') INTO NEW.invalid_values FROM test_version_analyte a
             WHERE a.test_version_id = src AND a.analyte_id = NEW.analyte_id AND a.status = 'Active' LIMIT 1;
            NEW.invalid_values := COALESCE(NEW.invalid_values, '{}');
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_invalid_values BEFORE INSERT OR UPDATE OF invalid_values ON test_version_analyte FOR EACH ROW EXECUTE FUNCTION tva_invalid_values_rules();

-- The design's fingerprint (024) includes the lists, only when a test has one (earlier fingerprints do not change)
ALTER FUNCTION test_version_definition(uuid) RENAME TO test_version_definition_024;
CREATE FUNCTION test_version_definition(p_version uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT test_version_definition_024(p_version) || COALESCE((
        SELECT jsonb_build_object('invalid_values', jsonb_object_agg(a.analyte_id::text, to_jsonb(a.invalid_values)))
          FROM test_version_analyte a WHERE a.test_version_id = p_version AND a.status = 'Active' AND cardinality(a.invalid_values) > 0
        HAVING count(*) > 0), '{}'::jsonb)
$$;

-- Every reading of the batch that is not a result (client samples and QC), with whether a later reading of the same
-- entry and analyte is a valid one
CREATE FUNCTION batch_invalid_readings(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, entry_type text, requested_test_id uuid, sample_label text, analyte_id uuid, analyte_name text,
               run_no integer, analytical_run integer, value_text text, step_run_id uuid, replaced boolean)
LANGUAGE sql STABLE AS $$
    SELECT e.id, reading_label(e.label, ev.run_no), e.entry_type::text, e.requested_test_id, COALESCE(s.sample_code, s.client_sample_id), ev.analyte_id, an.analyte_name,
           ev.run_no, reading_run(r.id, e.id, ev.run_no), ev.value_text, r.id,
           EXISTS (SELECT 1 FROM entry_value v2 WHERE v2.step_run_id = r.id AND v2.entry_id = e.id AND v2.analyte_id = ev.analyte_id AND v2.status = 'Active'
                     AND v2.run_no > ev.run_no AND (v2.value_num IS NOT NULL OR (v2.value_text IS NOT NULL AND NOT (v2.value_text = ANY (tva.invalid_values)))))
      FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN workflow_step ws ON ws.id = r.step_id AND ws.step_type = 'Data Entry'
      JOIN test_batch b ON b.id = r.batch_id JOIN batch_entry e ON e.id = ev.entry_id AND e.status = 'Active'
      JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = ev.analyte_id AND tva.status = 'Active'
      JOIN analyte an ON an.id = ev.analyte_id
      LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
     WHERE r.batch_id = p_batch AND ev.status = 'Active' AND ev.value_text IS NOT NULL AND ev.value_text = ANY (tva.invalid_values)
     ORDER BY e.position, ev.run_no
$$;

-- The review items (021): a reading that is not a result is never a candidate, so it cannot be chosen or averaged, and a
-- single valid reading beside it is chosen by itself
CREATE OR REPLACE FUNCTION batch_review_items(p_batch uuid, p_key text DEFAULT NULL)
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
    FOR it IN SELECT DISTINCT e.requested_test_id, tva.analyte_id, an.analyte_name, tva.id AS tva_id, tva.reporting_unit, tva.found_values, tva.invalid_values, tva.sort_order,
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
         WHERE e.requested_test_id = it.requested_test_id AND e.status = 'Active' AND r.analyte_id = it.analyte_id AND (r.value IS NOT NULL OR r.value_text IS NOT NULL)
           AND NOT (r.value_text IS NOT NULL AND r.value_text = ANY (it.invalid_values));   -- 039: a reading that is not a result is never a candidate
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

-- Choosing a reading that is not a result: refused with the reason (before the check of 021)
ALTER FUNCTION choose_result(uuid, uuid, uuid, uuid, integer, text, text) RENAME TO choose_result_021;
CREATE FUNCTION choose_result(p_batch uuid, p_rt uuid, p_analyte uuid, p_entry uuid, p_run integer, p_justification text DEFAULT NULL, p_key text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    SELECT x.value_text INTO v FROM batch_invalid_readings(p_batch) x WHERE x.entry_id = p_entry AND x.analyte_id = p_analyte AND x.run_no = p_run LIMIT 1;
    IF v IS NOT NULL THEN
        RAISE EXCEPTION '"%" is not a result and cannot be reported: read the sample again in a new analytical run', v;
    END IF;
    PERFORM choose_result_021(p_batch, p_rt, p_analyte, p_entry, p_run, p_justification, p_key);
END $$;

-- QC verdicts (022): a control whose reading is not a result is "Invalid", not passed or failed
ALTER FUNCTION batch_qc_verdicts(uuid) RENAME TO batch_qc_verdicts_022;
CREATE FUNCTION batch_qc_verdicts(p_batch uuid)
RETURNS TABLE (entry_id uuid, label text, qc_type text, limit_type text, analyte_id uuid, analyte_name text, measured numeric,
               min_value numeric, max_value numeric, limit_text text, verdict text, note text, analytical_run integer, run_no integer)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v record; t text;
BEGIN
    FOR v IN SELECT * FROM batch_qc_verdicts_022(p_batch) LOOP
        entry_id := v.entry_id; label := v.label; qc_type := v.qc_type; limit_type := v.limit_type; analyte_id := v.analyte_id; analyte_name := v.analyte_name;
        measured := v.measured; min_value := v.min_value; max_value := v.max_value; limit_text := v.limit_text; verdict := v.verdict; note := v.note;
        analytical_run := v.analytical_run; run_no := v.run_no;
        t := NULL;
        IF v.analyte_id IS NOT NULL AND v.run_no IS NOT NULL THEN
            SELECT ev.value_text INTO t FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id JOIN workflow_step ws ON ws.id = r.step_id AND ws.step_type = 'Data Entry'
              JOIN test_batch b ON b.id = r.batch_id
              JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = ev.analyte_id AND tva.status = 'Active'
             WHERE ev.entry_id = v.entry_id AND ev.analyte_id = v.analyte_id AND ev.run_no = v.run_no AND ev.status = 'Active'
               AND ev.value_text IS NOT NULL AND ev.value_text = ANY (tva.invalid_values) LIMIT 1;
        END IF;
        IF t IS NOT NULL THEN
            verdict := 'Invalid'; note := 'reading ' || t || ' is not a result: read the control again in a new analytical run';
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

-- What stops approval: as before, with "no result" explained when the only readings are not results, and the controls
-- whose reading is not a result until a later run reads them validly (passing, or a failure the reviewer accepts)
ALTER FUNCTION batch_review_problems(uuid) RENAME TO batch_review_problems_l3;
CREATE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE x record; m text; used integer[]; b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    FOR x IN SELECT * FROM batch_review_problems_l3(p_batch) LOOP
        SELECT i.sample_label || ' ' || i.analyte_name || ': ' || string_agg(DISTINCT '"' || i.value_text || '"', ', ')
               || ' is not a result: read it again in a new analytical run (the reading step, right-click)'
          INTO m FROM batch_invalid_readings(p_batch) i
         WHERE i.entry_type = 'Sample' AND x.problem = i.sample_label || ' ' || i.analyte_name || ': no result'
         GROUP BY i.sample_label, i.analyte_name;
        problem := COALESCE(m, x.problem); RETURN NEXT;
    END LOOP;
    IF b.status <> 'Awaiting Review' THEN RETURN; END IF;
    used := batch_used_runs(p_batch);
    -- a control read as "not a result" in a run that counts, never read again validly
    RETURN QUERY SELECT v.label || ' ' || COALESCE(v.analyte_name, '') || ' ' || v.limit_type || CASE WHEN v.analytical_run > 1 THEN ' (run ' || v.analytical_run || ')' ELSE '' END
                        || ': ' || v.note
      FROM batch_qc_verdicts(p_batch) v
     WHERE v.verdict = 'Invalid' AND qc_verdict_counts(v.entry_id, v.analytical_run, used)
       AND NOT EXISTS (SELECT 1 FROM batch_qc_verdicts(p_batch) w WHERE w.entry_id = v.entry_id AND w.analyte_id IS NOT DISTINCT FROM v.analyte_id
                         AND w.limit_type = v.limit_type AND w.run_no > v.run_no AND w.verdict <> 'Invalid');
    -- its later reading then decides: a fail or wait there needs the reviewer's acceptance, even in a run that would
    -- not otherwise count
    RETURN QUERY SELECT w.label || ' ' || COALESCE(w.analyte_name, '') || ' ' || w.limit_type || ' (run ' || w.analytical_run || ', read again)'
                        || ': ' || lower(w.verdict) || ', accept it with a justification or return the batch'
      FROM batch_qc_verdicts(p_batch) w
     WHERE w.verdict IN ('Fail','Waiting') AND NOT qc_verdict_counts(w.entry_id, w.analytical_run, used)
       AND EXISTS (SELECT 1 FROM batch_qc_verdicts(p_batch) v WHERE v.entry_id = w.entry_id AND v.analyte_id IS NOT DISTINCT FROM w.analyte_id
                     AND v.limit_type = w.limit_type AND v.run_no < w.run_no AND v.verdict = 'Invalid' AND qc_verdict_counts(v.entry_id, v.analytical_run, used))
       AND NOT EXISTS (SELECT 1 FROM batch_qc_verdicts(p_batch) w2 WHERE w2.entry_id = w.entry_id AND w2.analyte_id IS NOT DISTINCT FROM w.analyte_id
                         AND w2.limit_type = w.limit_type AND w2.run_no > w.run_no AND w2.verdict <> 'Invalid')
       AND NOT EXISTS (SELECT 1 FROM qc_acceptance q WHERE q.batch_id = p_batch AND q.entry_id = w.entry_id AND q.analyte_id IS NOT DISTINCT FROM w.analyte_id
                         AND q.limit_type = w.limit_type AND q.analytical_run = w.analytical_run AND q.status = 'Active');
END $$;

-------------------------------------------------------------------------------
-- 3. THE DESIGNER'S CHECKS FOR THE NEW SETTINGS
-------------------------------------------------------------------------------
ALTER FUNCTION test_version_problems(uuid) RENAME TO test_version_problems_014;
CREATE FUNCTION test_version_problems(p_version uuid) RETURNS TABLE (severity text, step_key text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE x record; s record; o jsonb;
BEGIN
    FOR x IN SELECT * FROM test_version_problems_014(p_version) LOOP
        -- a category that is not weighed needs no range
        CONTINUE WHEN x.problem LIKE '%: enter the lowest and highest weight' AND EXISTS (
            SELECT 1 FROM workflow_step ws, jsonb_array_elements(COALESCE(ws.config->'by_category', '[]')) c JOIN product_category pc ON pc.id::text = c->>'category_id'
             WHERE ws.test_version_id = p_version AND ws.step_key = x.step_key AND ws.status = 'Active' AND ws.step_type = 'Weighing'
               AND COALESCE(c->>'not_weighed', 'false') = 'true' AND x.problem = pc.category_name || ': enter the lowest and highest weight');
        severity := x.severity; step_key := x.step_key; problem := x.problem; RETURN NEXT;
    END LOOP;
    -- readings that are not results: qualitative only, among the result values, never a "found" value
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: only a qualitative result has readings that are not results (tab 2)', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type <> 'Qualitative' AND cardinality(a.invalid_values) > 0;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: the values that are not results must be among its result values (tab 2)', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type = 'Qualitative' AND NOT (a.invalid_values <@ a.result_values);
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: a value cannot both mean "found" and be "not a result" (tab 2)', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.invalid_values && a.found_values;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: at least one result value must be a result (not every value can be "not a result")', an.analyte_name)
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type = 'Qualitative' AND cardinality(a.invalid_values) > 0 AND a.result_values <@ a.invalid_values;
    FOR s IN SELECT * FROM workflow_step ws WHERE ws.test_version_id = p_version AND ws.status = 'Active' ORDER BY ws.sort_order LOOP
        IF s.step_type = 'Incubation' AND jsonb_typeof(s.config->'by_category') = 'array' THEN
            FOR o IN SELECT * FROM jsonb_array_elements(s.config->'by_category') LOOP
                IF NOT EXISTS (SELECT 1 FROM product_category WHERE id::text = o->>'category_id' AND status = 'Active') THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'A window names a product category that is not on the list';
                ELSIF NOT jnum_ok(o, 'window_min', 0) OR NOT jnum_ok(o, 'window_max', 0) OR (o->>'window_min')::numeric > (o->>'window_max')::numeric THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('%s: enter the shortest and longest acceptable time', (SELECT category_name FROM product_category WHERE id::text = o->>'category_id'));
                END IF;
            END LOOP;
            IF (SELECT count(*) <> count(DISTINCT x2->>'category_id') FROM jsonb_array_elements(s.config->'by_category') x2) THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'A product category appears twice in the windows';
            END IF;
        END IF;
        IF s.step_type = 'Weighing' AND COALESCE(s.config->>'target_mode', '') = 'By product category'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(s.config->'by_category', '[]')) c WHERE COALESCE(c->>'not_weighed', 'false') <> 'true') THEN
            RETURN QUERY SELECT 'Warning', s.step_key, 'Every product category listed is "Not weighed": samples of other categories are weighed with no range';
        END IF;
        IF s.step_type = 'Split off Test' AND COALESCE(s.config->>'notify_client', 'false') = 'true' AND COALESCE(s.config->>'trigger', 'On finding') <> 'On finding' THEN
            RETURN QUERY SELECT 'Warning', s.step_key, 'The client is alerted only on a finding: set "When" to On finding, or the alert is never sent';
        END IF;
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 4. F2: PRESUMPTIVE POSITIVE ALERTS
-------------------------------------------------------------------------------
INSERT INTO contact_role (role_code, role_name, description, one_per_client, sort_order) VALUES
 ('ALERT', 'Positive alerts', 'Alerted at once when a screen finds something (e.g. a presumptive Salmonella positive), before it is confirmed. Any number per client.', false, 7)
ON CONFLICT (role_code) DO NOTHING;

INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
('Presumptive Result', 'Presumptive positive alert (a screen found something)',
 'Presumptive result: {{finding}} in {{client_sample_id}} (order {{order_code}})',
 E'Dear {{first_name}},\n\nThis is an early alert from {{site_name}}. The screening test {{test_name}} gave a presumptive result on your sample {{client_sample_id}} ({{sample_code}}):\n\n{{finding}}\n\nA presumptive result is a screening result. It is not confirmed. {{next_step}}\n\nRecorded at {{found_at}} ({{site_name}} time). You will receive the Certificate of Analysis when testing is complete. Please reply to this email or call us with any questions.\n\n{{site_name}}',
 'first_name, finding, client_sample_id, sample_code, test_name, order_code, next_step, confirm_test, found_at, staff_name, site_name');

ALTER TABLE email_outbox ADD COLUMN split_request_id uuid REFERENCES split_request(id);

-- Who is alerted: the client's Positive alerts contacts, else its Receives Report contacts, else the order's contact
CREATE FUNCTION alert_recipients(p_order uuid) RETURNS TABLE (email text, first_name text, last_name text) LANGUAGE sql STABLE AS $$
    WITH o AS (SELECT * FROM lab_order WHERE id = p_order),
         r AS (SELECT CASE WHEN EXISTS (SELECT 1 FROM client_contact cc JOIN contact c ON c.id = cc.contact_id, o WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND c.status = 'Active' AND 'ALERT' = ANY (cc.roles)) THEN 'ALERT'
                           WHEN EXISTS (SELECT 1 FROM client_contact cc JOIN contact c ON c.id = cc.contact_id, o WHERE cc.client_id = o.client_id AND cc.status = 'Active' AND c.status = 'Active' AND 'REPORT' = ANY (cc.roles)) THEN 'REPORT' END AS role)
    SELECT DISTINCT c.email, c.first_name, c.last_name FROM client_contact cc JOIN contact c ON c.id = cc.contact_id, o, r
     WHERE r.role IS NOT NULL AND cc.client_id = o.client_id AND cc.status = 'Active' AND c.status = 'Active' AND r.role = ANY (cc.roles)
    UNION
    SELECT c.email, c.first_name, c.last_name FROM contact c, o, r WHERE r.role IS NULL AND c.id = o.ordering_contact_id
$$;

-- After a Split off Test step set to alert is completed (and its requests made, trigger z_split): one email per
-- recipient for each request raised on a finding, once
CREATE FUNCTION send_split_alerts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ws workflow_step; b test_batch; q record; o lab_order; si lab_site; ct record; t email_template; vars jsonb; nxt text; u text;
BEGIN
    IF NEW.status <> 'Completed' OR OLD.status = 'Completed' THEN RETURN NULL; END IF;
    SELECT * INTO ws FROM workflow_step WHERE id = NEW.step_id;
    IF ws.step_type <> 'Split off Test' OR COALESCE(ws.config->>'notify_client', 'false') <> 'true' OR COALESCE(ws.config->>'trigger', 'On finding') <> 'On finding' THEN RETURN NULL; END IF;
    SELECT * INTO b FROM test_batch WHERE id = NEW.batch_id;
    IF b.is_verification THEN RETURN NULL; END IF;
    SELECT * INTO t FROM email_template WHERE template_code = 'Presumptive Result';
    IF t.id IS NULL OR NOT t.is_active THEN RETURN NULL; END IF;
    SELECT full_name INTO u FROM app_user WHERE id = current_app_user();
    FOR q IN SELECT sr.*, sm.sample_code, sm.client_sample_id, sm.lab_order_id, ot.test_name AS origin_test, tt.test_name AS confirm_test
               FROM split_request sr JOIN sample sm ON sm.id = sr.sample_id JOIN requested_test ort ON ort.id = sr.origin_requested_test_id
               JOIN test ot ON ot.id = ort.test_id JOIN test tt ON tt.id = sr.test_id
              WHERE sr.step_run_id = NEW.id AND sr.status <> 'Cancelled' AND sr.finding IS NOT NULL AND sr.finding <> 'Always split off'
                AND ort.media_lot_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM email_outbox eo WHERE eo.split_request_id = sr.id) LOOP
        SELECT * INTO o FROM lab_order WHERE id = q.lab_order_id;
        SELECT * INTO si FROM lab_site WHERE id = o.site_id;
        nxt := CASE q.status WHEN 'Ordered' THEN 'Confirmation (' || q.confirm_test || ') has been started; we will tell you the outcome.'
                             WHEN 'Awaiting consent' THEN 'Please reply to tell us whether you would like it confirmed (' || q.confirm_test || ').'
                             ELSE 'We will contact you about confirming it (' || q.confirm_test || ').' END;
        FOR ct IN SELECT * FROM alert_recipients(o.id) LOOP
            vars := jsonb_build_object('first_name', ct.first_name, 'finding', q.finding, 'client_sample_id', COALESCE(q.client_sample_id, q.sample_code), 'sample_code', q.sample_code,
                                       'test_name', q.origin_test, 'order_code', o.order_code, 'next_step', nxt, 'confirm_test', q.confirm_test,
                                       'found_at', to_char(clock_timestamp() AT TIME ZONE si.time_zone, 'YYYY-MM-DD HH24:MI'), 'staff_name', COALESCE(u, ''), 'site_name', si.site_name);
            INSERT INTO email_outbox (template, to_address, to_name, subject, body, lab_order_id, site_id, split_request_id)
            VALUES ('Presumptive Result', ct.email, ct.first_name || ' ' || ct.last_name, fill_template(t.subject, vars), fill_template(t.body, vars), o.id, o.site_id, q.id);
        END LOOP;
    END LOOP;
    RETURN NULL;
END $$;
CREATE TRIGGER z_split_alert AFTER UPDATE OF status ON step_run FOR EACH ROW EXECUTE FUNCTION send_split_alerts();

-- What the sample and batch pages show: who was alerted and when
CREATE FUNCTION split_alerts(p_split uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(jsonb_agg(jsonb_build_object('email_id', eo.id, 'to_name', eo.to_name, 'to_address', eo.to_address, 'queued_at', eo.created_at,
                                                 'by', u.full_name, 'delivery_status', eo.delivery_status) ORDER BY eo.created_at, eo.to_name), '[]'::jsonb)
      FROM email_outbox eo JOIN app_user u ON u.id = eo.created_by WHERE eo.split_request_id = p_split
$$;

COMMIT;
