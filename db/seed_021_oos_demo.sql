-- Sandbox demo data for migration 027 (R-2, OOS investigations): Acme's Vitamin C stability lots that fail the
-- client's specification (% of initial at least 90 %):
--  - order PO-45240: VC-2401 (dietary supplement, 82.0 %) and VC-2402 (cGMP, 84.0 %), approved in QC Review: both
--    wait in Result Finalization, held until their OOS investigations are concluded (VC-2402 follows Full Phase I);
--  - order PO-45241: VC-2403 (dietary supplement, 88.0 %), its batch waiting in QC Review, where the result is
--    flagged and the investigation can be opened before approval.
-- Skipped whole if the demo records were changed, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

-- One stability batch of the demo test for the samples waiting: day 0, 7 (released) and 14 by the analyst; approved by
-- the Lab Supervisor when p_approve
CREATE FUNCTION pg_temp.vc_batch(p_site uuid, p_ver uuid, p_vals jsonb, p_approve boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b uuid; e record; r record; vc uuid := (SELECT id FROM analyte WHERE analyte_name = 'Vitamin C');
        run_of CONSTANT text := 'SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = $1 AND ws.step_key = $2';
        k text; sr uuid;
BEGIN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Bench work', true);
    b := create_batch(p_site, p_ver);
    EXECUTE run_of INTO sr USING b, 'batch'; PERFORM complete_step(sr);
    FOREACH k IN ARRAY ARRAY['0', '7'] LOOP
        EXECUTE run_of INTO sr USING b, 'read_' || k;
        FOR e IN SELECT be.id, s.client_sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id JOIN sample s ON s.id = rt.sample_id
                  WHERE be.batch_id = b AND be.entry_type = 'Sample' LOOP
            INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (sr, e.id, vc, (p_vals->e.client_sample_id->>k)::numeric);
        END LOOP;
        PERFORM complete_step(sr);
        EXECUTE run_of INTO sr USING b, 'calc_' || k; PERFORM complete_step(sr);
    END LOOP;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Step approved in QC Review', true);
    FOR r IN SELECT * FROM review_step_runs(b) WHERE status = 'Completed' AND mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
    PERFORM set_config('lims.reason', 'Timepoint reviewed: preliminary results released', true);
    EXECUTE run_of INTO sr USING b, 'rv_7'; PERFORM release_timepoint(sr);
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Bench work', true);
    EXECUTE run_of INTO sr USING b, 'read_14';
    FOR e IN SELECT be.id, s.client_sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id JOIN sample s ON s.id = rt.sample_id
              WHERE be.batch_id = b AND be.entry_type = 'Sample' LOOP
        INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES (sr, e.id, vc, (p_vals->e.client_sample_id->>'14')::numeric);
    END LOOP;
    PERFORM complete_step(sr);
    EXECUTE run_of INTO sr USING b, 'calc_14'; PERFORM complete_step(sr);
    IF p_approve THEN
        PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
        PERFORM script_signature('Sandbox demo data');
        PERFORM set_config('lims.reason', 'Step approved in QC Review', true);
        FOR r IN SELECT * FROM review_step_runs(b) WHERE mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
        PERFORM set_config('lims.reason', 'Batch reviewed and approved', true);
        PERFORM approve_batch(b);
    END IF;
    RETURN b;
END $$;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site');
        vc uuid := (SELECT id FROM analyte WHERE analyte_name = 'Vitamin C'); v uuid; v_line uuid; v_order uuid; v_s uuid; s_ids uuid[]; i int; po text;
        lots text[]; cats text[];
BEGIN
    SELECT tv.id INTO v FROM test_version tv JOIN test t ON t.id = tv.test_id WHERE t.test_name = 'Vitamin C stability (demo)' AND tv.status = 'Effective';
    IF cfl IS NULL OR acme IS NULL OR vc IS NULL OR v IS NULL OR EXISTS (SELECT 1 FROM lab_order WHERE po_number IN ('PO-45240', 'PO-45241')) THEN RETURN; END IF;
    -- anything of the test still waiting in the backlog would join the demo batches: leave the demo out then
    IF EXISTS (SELECT 1 FROM test_pool_view WHERE test_version_id = v) THEN RETURN; END IF;
    SELECT line_id INTO v_line FROM orderable_lines(acme) l JOIN test_version tv ON tv.test_id = l.test_id WHERE tv.id = v LIMIT 1;
    IF v_line IS NULL THEN RETURN; END IF;
    FOREACH po IN ARRAY ARRAY['PO-45240', 'PO-45241'] LOOP
        PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
        PERFORM script_signature('Sandbox demo data');
        PERFORM set_config('lims.reason', 'Sandbox demo data', true);
        lots := CASE WHEN po = 'PO-45240' THEN ARRAY['VC-2401', 'VC-2402'] ELSE ARRAY['VC-2403'] END;
        cats := CASE WHEN po = 'PO-45240' THEN ARRAY['Dietary supplement', 'cGMP'] ELSE ARRAY['Dietary supplement'] END;
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status, notes)
        SELECT acme, cfl, ct.id, 'Online', po, 'Submitted', 'Accelerated stability, production lots (40 °C / 75 % RH).' FROM contact ct WHERE ct.email = 'sam.nguyen@example-acme.com'
        RETURNING id INTO v_order;
        s_ids := '{}';
        FOR i IN 1..array_length(lots, 1) LOOP
            INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, lot, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature,
                                compliance_category, retained_quantity, retained_unit)
            VALUES (v_order, lots[i], 'Vitamin C 500 mg tablets, lot ' || lots[i], 'Tablet', lots[i], 60, 'g', 1, 'Acceptable', 21.0, cats[i], 30, 'g') RETURNING id INTO v_s;
            PERFORM order_test(v_s, v_line);
            INSERT INTO specification (requested_test_id, analyte_id, min_value, unit, source) SELECT rt.id, vc, 90, '%', 'Client' FROM requested_test rt WHERE rt.sample_id = v_s;
            s_ids := s_ids || v_s;
        END LOOP;
        PERFORM log_samples(s_ids);
        IF po = 'PO-45240' THEN
            PERFORM pg_temp.vc_batch(cfl, v, '{"VC-2401": {"0": 500, "7": 470, "14": 410}, "VC-2402": {"0": 500, "7": 460, "14": 420}}', true);
        ELSE
            PERFORM pg_temp.vc_batch(cfl, v, '{"VC-2403": {"0": 500, "7": 480, "14": 440}}', false);
        END IF;
    END LOOP;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
EXCEPTION WHEN others THEN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    RAISE NOTICE 'R-2 demo data skipped: %', SQLERRM;
END $$;

COMMIT;
