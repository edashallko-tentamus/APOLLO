-- 048: a dilution for each analytical run, and the analyst's pick of the reported reading (Claude Code, 2026-10-19;
-- version 0.27.0). Alex, 2026-10-19: "Can you show me how the picking dilutions between runs works?" It did not
-- exist: a sample had one dilution, shared by every analytical run, so a sample diluted further and read again in run 2
-- had its run 1 reading calculated with the new, larger factor too. Then: "the analyst should pick the dilution, not
-- the reviewer. They are the ones who know why the dilution was run", "make the picking a permission so we can turn
-- it off for a lab that doesn't want it".
--  - A further dilution is recorded with the analytical run that reads it (add_analytical_run_diluted, signed with
--    the run): the samples' dilution for that run is their previous dilution with one more aliquot + diluent (the
--    factors multiply). Each reading is calculated with its own run's dilution (the latest at or before that run).
--  - The analyst picks the reading reported for a sample (all its analytes, or one), with a note (testing.pick_run:
--    standard groups Analyst and Lab Supervisor; a lab that does not want it takes the permission off its groups).
--    The pick is used in QC Review unless the reviewer chooses otherwise (the reviewer's choice, with its
--    justification, always wins); the stored result keeps "Picked by the analyst (name): note".
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 048: run dilutions and the analyst''s pick', true);

INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('testing.pick_run', 'Testing', 'Bench', 'Pick the reading (analytical run, dilution) reported for a sample, with a note, before QC Review', false, 44);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{testing.pick_run}'), ('Lab Supervisor', '{testing.pick_run}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 1. A DILUTION PER ANALYTICAL RUN
-------------------------------------------------------------------------------
-- A dilution recorded for run 2 or later belongs to an analytical run of the batch's reading step that exists
CREATE FUNCTION entry_value_dilution_run() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t text; b uuid;
BEGIN
    IF NEW.run_no <= 1 OR NEW.analyte_id IS NOT NULL THEN RETURN NEW; END IF;
    SELECT ws.step_type, r.batch_id INTO t, b FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.id = NEW.step_run_id;
    IF t = 'Dilution' AND NEW.run_no > analytical_runs(batch_reading_run(b)) THEN
        RAISE EXCEPTION 'Analytical run % does not exist: a further dilution is recorded with the run that reads it', NEW.run_no;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a03_dilution_run BEFORE INSERT OR UPDATE ON entry_value FOR EACH ROW EXECUTE FUNCTION entry_value_dilution_run();

-- The dilution a reading was made on: the entry's latest dilution at or before the reading's analytical run
CREATE FUNCTION entry_dilution_data(p_dilution_run uuid, p_entry uuid, p_analytical_run integer) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT ev.data FROM entry_value ev WHERE ev.step_run_id = p_dilution_run AND ev.entry_id = p_entry AND ev.analyte_id IS NULL AND ev.status = 'Active'
       AND ev.run_no <= GREATEST(COALESCE(p_analytical_run, 1), 1) ORDER BY ev.run_no DESC LIMIT 1
$$;

-- A new analytical run whose samples are diluted further first: one more aliquot + diluent on their dilution, for this
-- run (and later ones), recorded in the run's own signed transaction. Only at the batch's (last) reading step.
CREATE FUNCTION add_analytical_run_diluted(p_step_run uuid, p_entries uuid[], p_replicates integer, p_aliquot numeric, p_diluent numeric) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE k integer; v_batch uuid; d record; x uuid; base jsonb; n integer := 0; lbl text;
BEGIN
    IF p_aliquot IS NULL THEN RETURN add_analytical_run(p_step_run, p_entries, p_replicates); END IF;
    IF p_aliquot <= 0 OR COALESCE(p_diluent, 0) < 0 THEN RAISE EXCEPTION 'A further dilution needs an aliquot above zero and a diluent of zero or more'; END IF;
    SELECT batch_id INTO v_batch FROM step_run WHERE id = p_step_run;
    IF p_step_run IS DISTINCT FROM batch_reading_run(v_batch) THEN RAISE EXCEPTION 'A further dilution goes with a run of the batch''s last reading step'; END IF;
    IF NOT EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_type = 'Dilution') THEN
        RAISE EXCEPTION 'This test has no Dilution step: add the run without a further dilution';
    END IF;
    k := add_analytical_run(p_step_run, p_entries, p_replicates);
    PERFORM set_testing_internal(true);
    FOR d IN SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = v_batch AND ws.step_type = 'Dilution' LOOP
        FOREACH x IN ARRAY p_entries LOOP
            base := entry_dilution_data(d.id, x, k - 1);
            IF base IS NULL OR dilution_factor(base) IS NULL THEN
                lbl := (SELECT label FROM batch_entry WHERE id = x);
                RAISE EXCEPTION '% has no dilution recorded to dilute further', lbl;
            END IF;
            INSERT INTO entry_value (step_run_id, entry_id, run_no, data)
            VALUES (d.id, x, k, jsonb_build_object('fields', COALESCE(base->'fields', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('aliquot', p_aliquot, 'diluent', COALESCE(p_diluent, 0))),
                                                   'for_run', k));
            n := n + 1;
        END LOOP;
    END LOOP;
    PERFORM set_testing_internal(false);
    RETURN k;
END $$;

-- The live results (035's), each reading calculated with its own analytical run's dilution
CREATE OR REPLACE FUNCTION batch_results(p_batch uuid)
RETURNS TABLE (entry_id uuid, analyte_id uuid, run_no integer, step_key text, is_final boolean, value numeric, reported text, inputs jsonb, waiting text, value_text text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; e record; a record; cs record; tok text; k text; f text; ref workflow_step; rr step_run; vals jsonb; miss text; lbw text;
        v numeric; formula text; runs integer; rn integer; calc jsonb := '{}'; final_key text; has_calc boolean; vt text; dr uuid; dd jsonb;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    dr := batch_reading_run(p_batch);
    has_calc := EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Calculation');
    SELECT ws.step_key INTO final_key FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.status = 'Active' AND ws.step_type = 'Calculation'
     ORDER BY (SELECT count(*) FROM step_ancestors(ws.id)) DESC, ws.sort_order DESC LIMIT 1;
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' AND be.daily_of_entry_id IS NULL ORDER BY be.position LOOP
        runs := COALESCE((SELECT max(entry_runs(r.id, e.id)) FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
                           WHERE r.batch_id = p_batch AND ws.step_type = 'Data Entry'), 1);
        FOR a IN SELECT tva.* FROM test_version_analyte tva WHERE tva.test_version_id = b.test_version_id AND tva.status = 'Active' ORDER BY tva.sort_order LOOP
            FOR rn IN 1..runs LOOP
                IF NOT has_calc OR a.result_type <> 'Numeric' THEN
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
                        IF ref.id IS NOT NULL AND NOT (f = ANY (step_base_token_fields(ref.id))) THEN
                            SELECT mv.value, mv.waiting INTO v, lbw FROM material_value(rr.id, e.id, a.analyte_id, f) mv;
                            IF v IS NULL THEN miss := COALESCE(miss || ', ', '') || COALESCE(lbw, '{' || tok || '}');
                            ELSE vals := vals || jsonb_build_object(tok, v);
                            END IF;
                            CONTINUE;
                        END IF;
                        IF ref.step_type = 'Weighing' THEN
                            v := entry_weight(rr.id, e.id);
                        ELSIF ref.step_type = 'Dilution' THEN
                            -- 048: the dilution of this reading's analytical run
                            dd := entry_dilution_data(rr.id, e.id, CASE WHEN dr IS NULL THEN 1 ELSE reading_run(dr, e.id, LEAST(rn, entry_runs(dr, e.id))) END);
                            v := CASE WHEN dd IS NULL THEN NULL WHEN f = 'factor' THEN dilution_factor(dd) ELSE dilution_final_volume(dd) END;
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

-------------------------------------------------------------------------------
-- 2. THE ANALYST'S PICK
-------------------------------------------------------------------------------
CREATE TABLE analyst_pick (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id            uuid NOT NULL REFERENCES test_batch(id),
    requested_test_id   uuid NOT NULL REFERENCES requested_test(id),
    analyte_id          uuid REFERENCES analyte(id),          -- NULL: every analyte of the sample's test
    entry_id            uuid NOT NULL REFERENCES batch_entry(id),
    run_no              integer NOT NULL CHECK (run_no >= 1),  -- the reading (RA1- is reading 2...)
    note                text NOT NULL CHECK (btrim(note) <> ''),
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX analyst_pick_uq ON analyst_pick (batch_id, requested_test_id, COALESCE(analyte_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'Active';
CALL make_gxp('analyst_pick');
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON analyst_pick FOR EACH ROW EXECUTE FUNCTION review_tables_rules();

-- Pick (or change) the reading reported for a sample: testing.pick_run, someone who may do the reading step, while the
-- batch is at the bench; a reading that exists and is a result; a note
CREATE FUNCTION set_analyst_pick(p_entry uuid, p_run integer, p_analyte uuid, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e batch_entry; b test_batch; dr uuid; inv text;
BEGIN
    SELECT * INTO e FROM batch_entry WHERE id = p_entry;
    IF e.id IS NULL OR e.status <> 'Active' THEN RAISE EXCEPTION 'Entry not found'; END IF;
    IF e.entry_type <> 'Sample' OR e.requested_test_id IS NULL THEN RAISE EXCEPTION '% is QC: its readings are judged, not picked', e.label; END IF;
    SELECT * INTO b FROM test_batch WHERE id = e.batch_id;
    PERFORM require_permission_at('testing.pick_run', b.site_id);
    IF b.status <> 'In Progress' THEN RAISE EXCEPTION 'Batch % is %: the reviewer chooses in QC Review', b.batch_code, b.status; END IF;
    dr := batch_reading_run(b.id);
    IF dr IS NULL THEN RAISE EXCEPTION 'This test has no reading step'; END IF;
    PERFORM assert_can_perform(dr);
    IF p_run IS NULL OR p_run < 1 OR p_run > entry_runs(dr, e.id) THEN RAISE EXCEPTION 'Reading % does not exist for %', p_run, e.label; END IF;
    IF p_analyte IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version_analyte WHERE test_version_id = b.test_version_id AND analyte_id = p_analyte AND status = 'Active') THEN
        RAISE EXCEPTION 'That analyte is not on this test';
    END IF;
    SELECT x.value_text INTO inv FROM batch_invalid_readings(b.id) x WHERE x.entry_id = e.id AND x.run_no = p_run AND (p_analyte IS NULL OR x.analyte_id = p_analyte) LIMIT 1;
    IF inv IS NOT NULL THEN RAISE EXCEPTION '"%" is not a result and cannot be reported', inv; END IF;
    IF COALESCE(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'Say why this reading is the one reported (e.g. run 1 was over the calibration range)'; END IF;
    PERFORM ensure_reason('Reading picked by the analyst');
    PERFORM set_testing_internal(true);
    UPDATE analyst_pick SET status = 'Inactive' WHERE batch_id = b.id AND requested_test_id = e.requested_test_id AND analyte_id IS NOT DISTINCT FROM p_analyte AND status = 'Active';
    INSERT INTO analyst_pick (batch_id, requested_test_id, analyte_id, entry_id, run_no, note) VALUES (b.id, e.requested_test_id, p_analyte, e.id, p_run, btrim(p_note));
    PERFORM set_testing_internal(false);
END $$;
CREATE FUNCTION clear_analyst_pick(p_pick uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p analyst_pick; b test_batch;
BEGIN
    SELECT * INTO p FROM analyst_pick WHERE id = p_pick;
    IF p.id IS NULL OR p.status <> 'Active' THEN RAISE EXCEPTION 'Pick not found'; END IF;
    SELECT * INTO b FROM test_batch WHERE id = p.batch_id;
    PERFORM require_permission_at('testing.pick_run', b.site_id);
    IF b.status <> 'In Progress' THEN RAISE EXCEPTION 'Batch % is %: the reviewer chooses in QC Review', b.batch_code, b.status; END IF;
    PERFORM assert_can_perform(batch_reading_run(b.id));
    PERFORM ensure_reason('Analyst''s pick taken off');
    PERFORM set_testing_internal(true);
    UPDATE analyst_pick SET status = 'Inactive' WHERE id = p_pick;
    PERFORM set_testing_internal(false);
END $$;

-- The review items (039's): where the reviewer has not chosen, the analyst's pick (for the analyte, else for every
-- analyte of the sample) is the reading reported, with the analyst's note; the reviewer's choice always wins
ALTER FUNCTION batch_review_items(uuid, text) RENAME TO batch_review_items_039;
CREATE FUNCTION batch_review_items(p_batch uuid, p_key text DEFAULT NULL)
RETURNS TABLE (requested_test_id uuid, analyte_id uuid, analyte_name text, sample_label text, candidates jsonb, chosen_entry_id uuid, chosen_run_no integer,
               auto_chosen boolean, value numeric, value_text text, reported text, unit text, spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text,
               mode text, justification text, readings jsonb, result_key text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE x record; pk record; c jsonb; t record; sc record;
BEGIN
    FOR x IN SELECT * FROM batch_review_items_039(p_batch, p_key) LOOP
        requested_test_id := x.requested_test_id; analyte_id := x.analyte_id; analyte_name := x.analyte_name; sample_label := x.sample_label; candidates := x.candidates;
        chosen_entry_id := x.chosen_entry_id; chosen_run_no := x.chosen_run_no; auto_chosen := x.auto_chosen; value := x.value; value_text := x.value_text; reported := x.reported;
        unit := x.unit; spec_min := x.spec_min; spec_max := x.spec_max; spec_text := x.spec_text; spec_unit := x.spec_unit; conformance := x.conformance;
        mode := x.mode; justification := x.justification; readings := x.readings; result_key := x.result_key;
        IF p_key IS NULL AND (x.chosen_entry_id IS NULL OR x.auto_chosen)
           AND NOT EXISTS (SELECT 1 FROM result_choice rc WHERE rc.batch_id = p_batch AND rc.requested_test_id = x.requested_test_id AND rc.analyte_id = x.analyte_id
                             AND rc.result_key IS NULL AND rc.status = 'Active') THEN
            SELECT ap.*, u.full_name INTO pk FROM analyst_pick ap JOIN app_user u ON u.id = ap.created_by
             WHERE ap.batch_id = p_batch AND ap.requested_test_id = x.requested_test_id AND ap.status = 'Active' AND (ap.analyte_id = x.analyte_id OR ap.analyte_id IS NULL)
             ORDER BY (ap.analyte_id IS NULL) LIMIT 1;
            IF pk.id IS NOT NULL THEN
                SELECT y INTO c FROM jsonb_array_elements(x.candidates) y WHERE (y->>'entry_id')::uuid = pk.entry_id AND (y->>'run_no')::int = pk.run_no LIMIT 1;
                IF c IS NOT NULL THEN
                    chosen_entry_id := pk.entry_id; chosen_run_no := pk.run_no; auto_chosen := false; mode := 'Pick'; readings := NULL;
                    value := NULLIF(c->>'value', '')::numeric; value_text := c->>'value_text'; reported := c->>'reported';
                    justification := format('Picked by the analyst (%s): %s', pk.full_name, pk.note);
                    SELECT tva.reporting_unit, tva.found_values INTO t FROM test_batch b JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id
                     WHERE b.id = p_batch AND tva.analyte_id = x.analyte_id AND tva.status = 'Active';
                    SELECT * INTO sc FROM spec_conformance(x.requested_test_id, x.analyte_id, value, value_text, reported, t.reporting_unit, t.found_values);
                    spec_min := sc.spec_min; spec_max := sc.spec_max; spec_text := sc.spec_text; spec_unit := sc.spec_unit; conformance := sc.conformance;
                END IF;
            END IF;
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_048;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'analyst_pick' THEN
        RETURN jsonb_build_object('label', 'Analyst''s pick in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''),
                                  'link', '#/testing/batches/' || COALESCE(r->>'batch_id', ''));
    END IF;
    RETURN audit_record_ref_048(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
