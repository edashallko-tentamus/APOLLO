-- LIMS3 schema, migration 018: WORKFLOW DESIGNER, WD-3: QC Review
-- Built by Claude 2026-10-13 while Alex was away, on his instruction to make the decisions and list the questions
-- (vault: "Decision - QC Review Build Choices", Proposed).
--  - A batch whose bench steps are all completed waits for QC Review. A reviewer (testing.review: Lab Supervisor and
--    QA) who did not perform or witness any of its steps reviews it.
--  - Every reading is kept; for each sample and analyte the reviewer chooses the reportable one (chosen automatically
--    when there is only one). Failed (or still waiting) QC must be accepted with a written justification.
--  - Approve (signed "Reviewed by"): the chosen results are stored as the test's results, compared with the sample's
--    specification (Conforms / Does not conform / No specification), the QC Review steps are completed and the batch is
--    Approved. Results are locked from then on (a later slice handles OOS and retests).
--  - Return to the analyst (signed, with a reason): a step and the steps after it reopen.
--  - Cancel (signed, with a reason; testing.assign or testing.review): the samples go back to the backlog; re-preps go
--    back to the top. Stock used stays used.
--  - The lab order moves to In Testing when its first test is batched, and to Complete when every test on it has
--    approved results.
--  - Qualitative results (e.g. ND / D for micro) are the reading itself (text), also stored on approval.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PERMISSION
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('testing.review', 'Testing', 'QC Review', 'Review batches: choose reportable results, accept QC with a justification, approve, return or cancel', false, 92);
UPDATE standard_group_template SET permissions = array(SELECT DISTINCT x FROM unnest(permissions || '{testing.review}'::text[]) x) WHERE group_name IN ('Lab Supervisor', 'QA');
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, 'testing.review' FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name IN ('Lab Supervisor', 'QA') ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 2. TABLES
-------------------------------------------------------------------------------
ALTER TABLE test_batch ADD COLUMN reviewed_by uuid REFERENCES app_user(id), ADD COLUMN reviewed_at timestamptz, ADD COLUMN review_signature_id uuid REFERENCES signature_event(id),
    ADD COLUMN returned_by uuid REFERENCES app_user(id), ADD COLUMN returned_at timestamptz, ADD COLUMN returned_reason text,
    ADD COLUMN cancelled_by uuid REFERENCES app_user(id), ADD COLUMN cancelled_at timestamptz, ADD COLUMN cancelled_reason text;

-- The reviewer's choice of the reportable reading, per sample (requested test) and analyte
CREATE TABLE result_choice (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id           uuid NOT NULL REFERENCES test_batch(id),
    requested_test_id  uuid NOT NULL REFERENCES requested_test(id),
    analyte_id         uuid NOT NULL REFERENCES analyte(id),
    entry_id           uuid NOT NULL REFERENCES batch_entry(id),
    run_no             integer NOT NULL,
    status             record_status NOT NULL DEFAULT 'Active',
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX result_choice_uq ON result_choice (batch_id, requested_test_id, analyte_id) WHERE status = 'Active';
CALL make_gxp('result_choice', false);

-- A failed (or waiting) QC verdict accepted by the reviewer, with the justification
CREATE TABLE qc_acceptance (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id       uuid NOT NULL REFERENCES test_batch(id),
    entry_id       uuid NOT NULL REFERENCES batch_entry(id),
    analyte_id     uuid REFERENCES analyte(id),
    limit_type     text NOT NULL,
    verdict        text NOT NULL,          -- the verdict when it was accepted (Fail or Waiting)
    measured       numeric,
    justification  text NOT NULL CHECK (btrim(justification) <> ''),
    status         record_status NOT NULL DEFAULT 'Active',
    record_version integer NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now(),
    created_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at    timestamptz NOT NULL DEFAULT now(),
    modified_by    uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX qc_acceptance_uq ON qc_acceptance (batch_id, entry_id, COALESCE(analyte_id, '00000000-0000-0000-0000-000000000000'::uuid), limit_type) WHERE status = 'Active';
CALL make_gxp('qc_acceptance', false);

-- Approved results: one per requested test and analyte (the stored result of record)
CREATE TABLE test_result (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_test_id  uuid NOT NULL REFERENCES requested_test(id),
    analyte_id         uuid NOT NULL REFERENCES analyte(id),
    batch_id           uuid NOT NULL REFERENCES test_batch(id),
    entry_id           uuid NOT NULL REFERENCES batch_entry(id),
    run_no             integer NOT NULL,
    value_num          numeric,                 -- unrounded
    value_text         text,                    -- a qualitative result (e.g. ND, D)
    reported           text,                    -- as reported (rounding, LOQ, LOD)
    unit               text,
    spec_min           numeric,
    spec_max           numeric,
    spec_text          text,
    spec_unit          text,
    conformance        text NOT NULL CHECK (conformance IN ('Conforms','Does not conform','No specification','Not compared')),
    approved_by        uuid NOT NULL REFERENCES app_user(id),
    approved_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    signature_id       uuid REFERENCES signature_event(id),
    status             text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Superseded')),
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX test_result_uq ON test_result (requested_test_id, analyte_id) WHERE status = 'Active';
CALL make_gxp('test_result');
CREATE FUNCTION review_tables_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF testing_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Use the QC Review screen (choices, acceptances and results are recorded by the review)';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON result_choice FOR EACH ROW EXECUTE FUNCTION review_tables_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON qc_acceptance FOR EACH ROW EXECUTE FUNCTION review_tables_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON test_result FOR EACH ROW EXECUTE FUNCTION review_tables_rules();

-------------------------------------------------------------------------------
-- 3. RESULTS: qualitative readings are results too (batch_results gains value_text)
-------------------------------------------------------------------------------
DROP FUNCTION batch_results(uuid);
CREATE FUNCTION batch_results(p_batch uuid)
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
    FOR e IN SELECT * FROM batch_entry be WHERE be.batch_id = p_batch AND be.status = 'Active' ORDER BY be.position LOOP
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
                            v := (SELECT (ev.data->>'duration')::numeric FROM entry_value ev WHERE ev.step_run_id = rr.id AND ev.analyte_id IS NULL AND ev.status = 'Active'
                                   AND (ev.entry_id = e.id OR ev.entry_id IS NULL) AND jnum_ok(ev.data, 'duration', 0) ORDER BY (ev.entry_id IS NULL), ev.run_no DESC LIMIT 1);
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

-------------------------------------------------------------------------------
-- 4. THE REVIEW
-------------------------------------------------------------------------------
-- What a sample's result is compared with: its specification (on the ordered test)
CREATE FUNCTION spec_conformance(p_rt uuid, p_analyte uuid, p_value numeric, p_text text, p_reported text, p_unit text, p_found text[])
RETURNS TABLE (spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE sp specification; x numeric; below boolean := false; f numeric;
BEGIN
    SELECT * INTO sp FROM specification s WHERE s.requested_test_id = p_rt AND s.analyte_id = p_analyte AND s.status = 'Active' LIMIT 1;
    IF sp.id IS NULL THEN spec_min := NULL; spec_max := NULL; spec_text := NULL; spec_unit := NULL; conformance := 'No specification'; RETURN NEXT; RETURN; END IF;
    spec_min := sp.min_value; spec_max := sp.max_value; spec_text := sp.text_value; spec_unit := sp.unit;
    IF sp.min_value IS NULL AND sp.max_value IS NULL THEN
        -- a text limit (e.g. "Absent in 10 g"): a found result does not conform
        conformance := CASE WHEN p_text IS NULL THEN 'Not compared' WHEN p_text = ANY (COALESCE(p_found, '{}')) THEN 'Does not conform' ELSE 'Conforms' END;
        RETURN NEXT; RETURN;
    END IF;
    -- compare the reported (rounded) value; "< LOQ" and "ND" are below any positive limit
    IF p_reported ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN x := p_reported::numeric;
    ELSIF p_reported LIKE '<%' OR p_reported = 'ND' THEN below := true; x := COALESCE(NULLIF(regexp_replace(p_reported, '[^0-9.]', '', 'g'), '')::numeric, 0);
    ELSE x := p_value; END IF;
    IF x IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    f := CASE WHEN sp.unit IS NULL OR p_unit IS NULL OR sp.unit = p_unit THEN 1 ELSE unit_factor(p_unit, sp.unit, NULL) END;
    IF f IS NULL THEN conformance := 'Not compared'; RETURN NEXT; RETURN; END IF;
    x := x * f;
    conformance := CASE WHEN (sp.max_value IS NOT NULL AND x > sp.max_value AND NOT below) OR (sp.min_value IS NOT NULL AND (x < sp.min_value OR below)) THEN 'Does not conform' ELSE 'Conforms' END;
    RETURN NEXT;
END $$;

-- The review's items: for each sample (requested test) and analyte of the batch, the candidate readings and the choice
CREATE FUNCTION batch_review_items(p_batch uuid)
RETURNS TABLE (requested_test_id uuid, analyte_id uuid, analyte_name text, sample_label text, candidates jsonb, chosen_entry_id uuid, chosen_run_no integer,
               auto_chosen boolean, value numeric, value_text text, reported text, unit text, spec_min numeric, spec_max numeric, spec_text text, spec_unit text, conformance text)
LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch; it record; c jsonb; ch result_choice; pick record; sc record; res jsonb;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('entry_id', x.entry_id, 'analyte_id', x.analyte_id, 'run_no', x.run_no, 'value', x.value, 'reported', x.reported, 'value_text', x.value_text)), '[]')
      INTO res FROM batch_results(p_batch) x WHERE x.is_final;
    FOR it IN SELECT DISTINCT e.requested_test_id, tva.analyte_id, an.analyte_name, tva.id AS tva_id, tva.reporting_unit, tva.found_values, tva.sort_order,
                     COALESCE(s.sample_code, s.client_sample_id) AS sample_label, min(e.position) OVER (PARTITION BY e.requested_test_id) AS pos
                FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id
                JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.status = 'Active' JOIN analyte an ON an.id = tva.analyte_id
               WHERE e.batch_id = p_batch AND e.status = 'Active' AND e.entry_type = 'Sample'
                 AND (NOT EXISTS (SELECT 1 FROM requested_analyte ra WHERE ra.requested_test_id = e.requested_test_id)
                      OR EXISTS (SELECT 1 FROM requested_analyte ra WHERE ra.requested_test_id = e.requested_test_id AND ra.analyte_id = tva.analyte_id AND ra.included))
               ORDER BY pos, sort_order LOOP
        SELECT COALESCE(jsonb_agg(jsonb_build_object('entry_id', r.entry_id, 'label', e.label, 'replicate_no', e.replicate_no, 'run_no', r.run_no,
                                                     'value', r.value, 'reported', r.reported, 'value_text', r.value_text) ORDER BY e.position, r.run_no), '[]')
          INTO c FROM jsonb_to_recordset(res) r(entry_id uuid, analyte_id uuid, run_no integer, value numeric, reported text, value_text text) JOIN batch_entry e ON e.id = r.entry_id
         WHERE e.requested_test_id = it.requested_test_id AND e.status = 'Active' AND r.analyte_id = it.analyte_id AND (r.value IS NOT NULL OR r.value_text IS NOT NULL);
        SELECT * INTO ch FROM result_choice rc WHERE rc.batch_id = p_batch AND rc.requested_test_id = it.requested_test_id AND rc.analyte_id = it.analyte_id AND rc.status = 'Active';
        requested_test_id := it.requested_test_id; analyte_id := it.analyte_id; analyte_name := it.analyte_name; sample_label := it.sample_label; candidates := c;
        auto_chosen := false; chosen_entry_id := NULL; chosen_run_no := NULL;
        IF ch.id IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(c) x WHERE (x->>'entry_id')::uuid = ch.entry_id AND (x->>'run_no')::int = ch.run_no) THEN
            chosen_entry_id := ch.entry_id; chosen_run_no := ch.run_no;
        ELSIF jsonb_array_length(c) = 1 THEN
            chosen_entry_id := (c->0->>'entry_id')::uuid; chosen_run_no := (c->0->>'run_no')::int; auto_chosen := true;
        END IF;
        SELECT * INTO pick FROM jsonb_to_recordset(res) r(entry_id uuid, analyte_id uuid, run_no integer, value numeric, reported text, value_text text) WHERE r.entry_id = chosen_entry_id AND r.analyte_id = it.analyte_id AND r.run_no = chosen_run_no;
        value := pick.value; value_text := pick.value_text; reported := pick.reported; unit := it.reporting_unit;
        spec_min := NULL; spec_max := NULL; spec_text := NULL; spec_unit := NULL; conformance := NULL;
        IF chosen_entry_id IS NOT NULL THEN
            SELECT * INTO sc FROM spec_conformance(it.requested_test_id, it.analyte_id, pick.value, pick.value_text, pick.reported, it.reporting_unit, it.found_values);
            spec_min := sc.spec_min; spec_max := sc.spec_max; spec_text := sc.spec_text; spec_unit := sc.spec_unit; conformance := sc.conformance;
        END IF;
        RETURN NEXT;
    END LOOP;
END $$;

-- Who may review: testing.review at the lab, and not someone who performed or witnessed a step of the batch
CREATE FUNCTION assert_can_review(p_batch uuid) RETURNS test_batch LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    PERFORM require_permission_at('testing.review', b.site_id);
    IF EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b.id AND ws.step_type <> 'QC Review'
                AND current_app_user() IN (r.performed_by, r.witness_id)) THEN
        RAISE EXCEPTION 'You performed or witnessed a step of %; someone else must review it', b.batch_code;
    END IF;
    RETURN b;
END $$;

-- What still stops approval (empty = ready)
CREATE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.status <> 'Awaiting Review' THEN RETURN QUERY SELECT 'The batch is ' || b.status || ', not waiting for review'; RETURN; END IF;
    RETURN QUERY SELECT i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
      FROM batch_review_items(p_batch) i WHERE i.chosen_entry_id IS NULL;
    RETURN QUERY SELECT v.label || ' ' || COALESCE(v.analyte_name, '') || ' ' || v.limit_type || ': ' || lower(v.verdict) || ', accept it with a justification or return the batch'
      FROM batch_qc_verdicts(p_batch) v
     WHERE v.verdict IN ('Fail','Waiting')
       AND NOT EXISTS (SELECT 1 FROM qc_acceptance q WHERE q.batch_id = p_batch AND q.entry_id = v.entry_id AND q.analyte_id IS NOT DISTINCT FROM v.analyte_id
                         AND q.limit_type = v.limit_type AND q.status = 'Active');
END $$;

CREATE FUNCTION choose_result(p_batch uuid, p_rt uuid, p_analyte uuid, p_entry uuid, p_run integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    b := assert_can_review(p_batch);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    IF NOT EXISTS (SELECT 1 FROM batch_review_items(p_batch) i, jsonb_array_elements(i.candidates) x
                    WHERE i.requested_test_id = p_rt AND i.analyte_id = p_analyte AND (x->>'entry_id')::uuid = p_entry AND (x->>'run_no')::int = p_run) THEN
        RAISE EXCEPTION 'That reading is not a result of this sample in this batch';
    END IF;
    PERFORM ensure_reason('Reportable reading chosen');
    PERFORM set_testing_internal(true);
    UPDATE result_choice SET status = 'Inactive' WHERE batch_id = p_batch AND requested_test_id = p_rt AND analyte_id = p_analyte AND status = 'Active';
    INSERT INTO result_choice (batch_id, requested_test_id, analyte_id, entry_id, run_no) VALUES (p_batch, p_rt, p_analyte, p_entry, p_run);
    PERFORM set_testing_internal(false);
END $$;

CREATE FUNCTION accept_qc(p_batch uuid, p_entry uuid, p_analyte uuid, p_limit_type text, p_justification text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; v record;
BEGIN
    b := assert_can_review(p_batch);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    IF COALESCE(btrim(p_justification), '') = '' THEN RAISE EXCEPTION 'Write why the QC result is acceptable'; END IF;
    SELECT * INTO v FROM batch_qc_verdicts(p_batch) x WHERE x.entry_id = p_entry AND x.analyte_id IS NOT DISTINCT FROM p_analyte AND x.limit_type = p_limit_type;
    IF v.verdict IS NULL THEN RAISE EXCEPTION 'That QC check is not in this batch'; END IF;
    IF v.verdict NOT IN ('Fail','Waiting') THEN RAISE EXCEPTION 'Only a failed or waiting QC check needs accepting (this one is %)', v.verdict; END IF;
    PERFORM ensure_reason('QC accepted by the reviewer');
    PERFORM set_testing_internal(true);
    UPDATE qc_acceptance SET status = 'Inactive' WHERE batch_id = p_batch AND entry_id = p_entry AND analyte_id IS NOT DISTINCT FROM p_analyte AND limit_type = p_limit_type AND status = 'Active';
    INSERT INTO qc_acceptance (batch_id, entry_id, analyte_id, limit_type, verdict, measured, justification) VALUES (p_batch, p_entry, p_analyte, p_limit_type, v.verdict, v.measured, btrim(p_justification));
    PERFORM set_testing_internal(false);
END $$;

-- The lab order's status follows its tests: In Testing once one is batched, Complete when all have approved results
CREATE FUNCTION refresh_order_status(p_order uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE o lab_order; n_tests integer; n_done integer; n_batched integer; s lab_order_status; fallback lab_order_status; gs text;
BEGIN
    SELECT * INTO o FROM lab_order WHERE id = p_order;
    IF o.id IS NULL OR o.status IN ('Draft','Reported') THEN RETURN; END IF;
    fallback := CASE WHEN EXISTS (SELECT 1 FROM sample sm WHERE sm.lab_order_id = o.id AND sm.status = 'Expected') THEN 'Submitted' ELSE 'Received' END;
    SELECT count(*), count(*) FILTER (WHERE EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active')
                                            AND NOT EXISTS (SELECT 1 FROM reprep_request rp WHERE rp.requested_test_id = rt.id AND rp.status = 'Pooled')),
           count(*) FILTER (WHERE EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled'))
      INTO n_tests, n_done, n_batched
      FROM requested_test rt JOIN sample sm ON sm.id = rt.sample_id WHERE sm.lab_order_id = o.id AND rt.status <> 'Cancelled' AND sm.status <> 'Cancelled';
    s := CASE WHEN n_tests > 0 AND n_done = n_tests THEN 'Complete' WHEN n_batched > 0 THEN 'In Testing' ELSE fallback END;
    IF s = o.status OR (s = fallback AND o.status NOT IN ('In Testing','Complete')) THEN RETURN; END IF;
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);   -- a system status change, not someone's edit
    PERFORM ensure_reason('Order status follows its tests');
    UPDATE lab_order SET status = s WHERE id = o.id;
    PERFORM set_config('lims.group_sync', gs, true);
END $$;
CREATE FUNCTION refresh_batch_orders(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE x uuid;
BEGIN
    FOR x IN SELECT DISTINCT sm.lab_order_id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample sm ON sm.id = rt.sample_id WHERE e.batch_id = p_batch LOOP
        PERFORM refresh_order_status(x);
    END LOOP;
END $$;
-- a new batch moves its orders to In Testing
CREATE FUNCTION test_batch_orders() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM refresh_batch_orders(NEW.batch_id);
    RETURN NULL;
END $$;
CREATE TRIGGER z_orders AFTER INSERT ON step_run FOR EACH ROW EXECUTE FUNCTION test_batch_orders();

-- Approve: store the chosen results, complete the QC Review steps, the batch is Approved
CREATE FUNCTION approve_batch(p_batch uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE b test_batch; n integer; first_problem text; i record; sig uuid;
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
        UPDATE test_result SET status = 'Superseded' WHERE requested_test_id = i.requested_test_id AND analyte_id = i.analyte_id AND status = 'Active';
        INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit,
                                 spec_min, spec_max, spec_text, spec_unit, conformance, approved_by, signature_id)
        VALUES (i.requested_test_id, i.analyte_id, p_batch, i.chosen_entry_id, i.chosen_run_no, i.value, i.value_text, i.reported, i.unit,
                i.spec_min, i.spec_max, i.spec_text, i.spec_unit, COALESCE(i.conformance, 'Not compared'), current_app_user(), sig);
        n := n + 1;
    END LOOP;
    UPDATE step_run r SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(), signature_id = sig
      FROM workflow_step ws WHERE ws.id = r.step_id AND r.batch_id = p_batch AND ws.step_type = 'QC Review';
    UPDATE test_batch SET status = 'Approved', reviewed_by = current_app_user(), reviewed_at = clock_timestamp(), review_signature_id = sig WHERE id = p_batch;
    PERFORM set_testing_internal(false);
    PERFORM refresh_batch_orders(p_batch);
    RETURN n;
END $$;

-- Return to the analyst: the chosen step and every step after it reopen (signed, with a reason)
CREATE FUNCTION return_batch(p_batch uuid, p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch; r step_run;
BEGIN
    b := assert_can_review(p_batch);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    PERFORM assert_signed('return a batch');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say what the analyst needs to fix'; END IF;
    SELECT * INTO r FROM step_run WHERE id = p_step_run AND batch_id = p_batch;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Choose a step of this batch'; END IF;
    PERFORM set_testing_internal(true);
    UPDATE step_run x SET status = 'In progress'
     WHERE x.batch_id = p_batch AND x.status = 'Completed'
       AND (x.id = r.id OR x.step_id IN (SELECT ws.id FROM workflow_step ws WHERE r.step_id IN (SELECT step_id FROM step_ancestors(ws.id))));
    UPDATE test_batch SET status = 'In Progress', returned_by = current_app_user(), returned_at = clock_timestamp(), returned_reason = current_reason() WHERE id = p_batch;
    PERFORM set_testing_internal(false);
END $$;

-- Cancel: the batch stops; its samples go back to the backlog (signed, with a reason)
CREATE FUNCTION cancel_batch(p_batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    IF NOT (has_permission_at('testing.assign', b.site_id) OR has_permission_at('testing.review', b.site_id)) THEN
        RAISE EXCEPTION 'Cancelling a batch needs testing.assign or testing.review in this lab';
    END IF;
    IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is already %', b.batch_code, lower(b.status::text); END IF;
    PERFORM assert_signed('cancel a batch');
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the batch is cancelled'; END IF;
    PERFORM set_testing_internal(true);
    UPDATE reprep_request SET status = 'Pooled', batch_id = NULL WHERE batch_id = p_batch AND status = 'Batched';
    UPDATE test_batch SET status = 'Cancelled', cancelled_by = current_app_user(), cancelled_at = clock_timestamp(), cancelled_reason = current_reason() WHERE id = p_batch;
    PERFORM set_testing_internal(false);
    PERFORM refresh_batch_orders(p_batch);
END $$;

-------------------------------------------------------------------------------
-- 5. VIEWS AND AUDIT REFERENCES
-------------------------------------------------------------------------------
-- the batch list and page show who reviewed, returned or cancelled
DROP VIEW test_batch_view;
CREATE VIEW test_batch_view AS
SELECT b.*, s.site_code, t.test_code, t.test_name, v.version_no, d.department_code, au.full_name AS assigned_name,
       ru.full_name AS reviewed_by_name, tu.full_name AS returned_by_name, cu.full_name AS cancelled_by_name,
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
  LEFT JOIN department d ON d.id = b.department_id JOIN app_user au ON au.id = b.assigned_to
  LEFT JOIN app_user ru ON ru.id = b.reviewed_by LEFT JOIN app_user tu ON tu.id = b.returned_by LEFT JOIN app_user cu ON cu.id = b.cancelled_by;

CREATE VIEW test_result_view AS
SELECT tr.*, a.analyte_name, a.report_name, rt.sample_id, rt.test_id, t.test_code, t.test_name, b.batch_code, u.full_name AS approved_by_name, s.sample_code, s.client_sample_id
  FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id JOIN requested_test rt ON rt.id = tr.requested_test_id JOIN test t ON t.id = rt.test_id
  JOIN test_batch b ON b.id = tr.batch_id JOIN app_user u ON u.id = tr.approved_by JOIN sample s ON s.id = rt.sample_id;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice18;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    CASE p_table
    WHEN 'result_choice', 'qc_acceptance', 'test_result' THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'result_choice' THEN 'Reportable reading' WHEN 'qc_acceptance' THEN 'QC accepted' ELSE 'Result' END
            || ' in ' || COALESCE((SELECT batch_code FROM test_batch WHERE id = (r->>'batch_id')::uuid), ''), 'link', '#/testing/batches/' || (r->>'batch_id') || '?step=review');
    ELSE RETURN audit_record_ref_slice18(p_table, p_id, r);
    END CASE;
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
