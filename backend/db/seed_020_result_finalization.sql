-- Sandbox demo data for migration 026 (R-1, Result Finalization and the COA):
--  - canned COA comments and Reports reasons (Canned reasons, kept by QA);
--  - a demo Project Manager (projmgr) in CFL's Project Manager group;
--  - a second Acme stability order (PO-45231): three lots of Vitamin C tablets with a client specification
--    (% of initial at least 90 %), a sample submission form attached, tested through day 14 by the demo analyst and
--    approved in QC Review by the demo Lab Supervisor, so all three wait in Result Finalization.
-- The test data part skips itself whole if the demo records were changed, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT m, r, o FROM (VALUES
 ('COA comments', 'Results relate only to the sample as received.', 10),
 ('COA comments', 'Sample received outside the temperature requirement; results may be affected.', 20),
 ('COA comments', 'Result reported on an as-received basis.', 30),
 ('COA comments', 'Result reported on a dry-weight basis.', 40),
 ('COA comments', 'Sample quantity was limited; testing was performed on the amount available.', 50),
 ('COA comments', 'Specification provided by the client.', 60),
 ('Reports', 'Finalized for release', 10),
 ('Reports', 'Note corrected', 20)) AS x(m, r, o)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = x.m AND lower(c.reason_text) = lower(x.r));

INSERT INTO app_user (username, full_name) VALUES ('projmgr', 'Project Manager (demo)') ON CONFLICT (username) DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id, app_user u
 WHERE s.site_code = 'CFL' AND g.group_name = 'Project Manager' AND u.username = 'projmgr'
ON CONFLICT DO NOTHING;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site');
        vc uuid := (SELECT id FROM analyte WHERE analyte_name = 'Vitamin C'); v uuid; v_line uuid; v_order uuid; v_batch uuid; s_ids uuid[] := '{}'; v_s uuid;
        e record; r record; d uuid; lots text[] := ARRAY['VC-2301', 'VC-2302', 'VC-2303']; day0 numeric[] := ARRAY[501, 497, 503];
        day7 numeric[] := ARRAY[494, 490, 497]; day14 numeric[] := ARRAY[488, 481, 492]; i int;
BEGIN
    SELECT tv.id INTO v FROM test_version tv JOIN test t ON t.id = tv.test_id WHERE t.test_name = 'Vitamin C stability (demo)' AND tv.status = 'Effective';
    IF cfl IS NULL OR acme IS NULL OR vc IS NULL OR v IS NULL OR EXISTS (SELECT 1 FROM lab_order WHERE po_number = 'PO-45231') THEN RETURN; END IF;
    SELECT line_id INTO v_line FROM orderable_lines(acme) l JOIN test_version tv ON tv.test_id = l.test_id WHERE tv.id = v LIMIT 1;
    IF v_line IS NULL THEN RETURN; END IF;

    -- the order, three samples (dietary supplement), the client's specification, the submission form
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status, notes)
    SELECT acme, cfl, ct.id, 'Online', 'PO-45231', 'Submitted', 'Accelerated stability, three production lots. Please report % of initial.' FROM contact ct WHERE ct.email = 'sam.nguyen@example-acme.com'
    RETURNING id INTO v_order;
    FOR i IN 1..3 LOOP
        INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, lot, quantity_received, quantity_unit, number_of_units, condition, receipt_temperature, compliance_category)
        VALUES (v_order, lots[i], 'Vitamin C 500 mg tablets, lot ' || lots[i], 'Tablet', lots[i], 60, 'g', 1, 'Acceptable', 21.0, 'Dietary supplement') RETURNING id INTO v_s;
        PERFORM order_test(v_s, v_line);
        INSERT INTO specification (requested_test_id, analyte_id, min_value, unit, source)
        SELECT rt.id, vc, 90, '%', 'Client' FROM requested_test rt WHERE rt.sample_id = v_s;
        s_ids := s_ids || v_s;
    END LOOP;
    PERFORM log_samples(s_ids);
    INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
    SELECT 'PO-45231 sample submission form.pdf', 'application/pdf', length(b), encode(sha256(b), 'hex'), b
      FROM (SELECT convert_to(E'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 120>>stream\nBT /F1 14 Tf 72 720 Td (Sample submission form - Acme Nutrition, PO-45231) Tj 0 -24 Td (3 lots of Vitamin C tablets, dietary supplement) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'UTF8') AS b) x
    RETURNING id INTO d;
    INSERT INTO sample_attachment (lab_order_id, document_id, kind, label) VALUES (v_order, d, 'Sample submission form', 'Submission form (scanned)');

    -- day 0 and day 7 by the demo analyst
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Bench work', true);
    v_batch := create_batch(cfl, v);
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'batch'));
    FOR e IN SELECT be.id, s.client_sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id JOIN sample s ON s.id = rt.sample_id
              WHERE be.batch_id = v_batch AND be.entry_type = 'Sample' ORDER BY be.position LOOP
        i := array_position(lots, e.client_sample_id);
        INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES
          ((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_0'), e.id, vc, day0[i]);
    END LOOP;
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_0'));
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'calc_0'));
    FOR e IN SELECT be.id, s.client_sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id JOIN sample s ON s.id = rt.sample_id
              WHERE be.batch_id = v_batch AND be.entry_type = 'Sample' LOOP
        i := array_position(lots, e.client_sample_id);
        INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES
          ((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_7'), e.id, vc, day7[i]);
    END LOOP;
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_7'));
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'calc_7'));

    -- the day 7 timepoint reviewed and released by the demo Lab Supervisor
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Step approved in QC Review', true);
    FOR r IN SELECT * FROM review_step_runs(v_batch) WHERE status = 'Completed' AND mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
    PERFORM set_config('lims.reason', 'Timepoint reviewed: preliminary results released', true);
    PERFORM release_timepoint((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'rv_7'));

    -- day 14 by the analyst
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Bench work', true);
    FOR e IN SELECT be.id, s.client_sample_id FROM batch_entry be JOIN requested_test rt ON rt.id = be.requested_test_id JOIN sample s ON s.id = rt.sample_id
              WHERE be.batch_id = v_batch AND be.entry_type = 'Sample' LOOP
        i := array_position(lots, e.client_sample_id);
        INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_num) VALUES
          ((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_14'), e.id, vc, day14[i]);
    END LOOP;
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'read_14'));
    PERFORM complete_step((SELECT r2.id FROM step_run r2 JOIN workflow_step ws ON ws.id = r2.step_id WHERE r2.batch_id = v_batch AND ws.step_key = 'calc_14'));

    -- QC Review: every step approved, then the batch (signed "Reviewed by")
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM set_config('lims.reason', 'Step approved in QC Review', true);
    FOR r IN SELECT * FROM review_step_runs(v_batch) WHERE mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
    PERFORM set_config('lims.reason', 'Batch reviewed and approved', true);
    PERFORM approve_batch(v_batch);
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
EXCEPTION WHEN others THEN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    RAISE NOTICE 'R-1 demo data skipped: %', SQLERRM;
END $$;

COMMIT;
