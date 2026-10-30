-- Verification for migration 023 (Alex's notes of 2026-10-13): media qualification (a test sample with the lot's ID,
-- outside the batch rules, released by QA's approval for the chosen tests only), adding and removing samples in a batch
-- that has not started (QC brackets follow), and purchasing (item link, actual price, receiving into inventory).
-- Uses the fixtures of the earlier tests (CFL, the WDC department, wd.ana / wd.sup / wd.int, WD Micro Screen, LO-000003's
-- samples, the purchasing users and suppliers).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.media_preapproved', '', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.m_tid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n AND site_id = pg_temp.cfl() $$;
CREATE OR REPLACE FUNCTION pg_temp.m_ver(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.m_tid(n) ORDER BY version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.m_st(n text, k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.m_ver(n) AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.m_lot(m text) RETURNS inventory_lot LANGUAGE sql AS $$ SELECT * FROM inventory_lot WHERE manufacturer_lot = m $$;
CREATE OR REPLACE FUNCTION pg_temp.m_batch(n text, i int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_id = pg_temp.m_tid(n) ORDER BY batch_code OFFSET i - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.m_run(b uuid, k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.m_entry(b uuid, code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id
   WHERE e.batch_id = b AND (s.sample_code = code OR s.client_sample_id = code) AND e.status = 'Active' LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.m_ccvs(b uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT count(*) FROM batch_entry WHERE batch_id = b AND qc_type = 'CCV' AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.m_ga() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Growth promotion' $$;

-------------------------------------------------------------------------------
-- set-up: a growth promotion test (the qualification test) and a chemistry-style assay with a CCV every 2 samples
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('akiddle');
INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('WD Growth promotion', 'Growth promotion', 'Microbiological');
SELECT pg_temp.as_user('wd.ana');
INSERT INTO method (site_id, method_name, sop_code) VALUES (pg_temp.cfl(), 'WD Media growth promotion', 'SOP-MIC-9100');
SELECT create_test(pg_temp.cfl(), 'WD Growth Promotion', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE method_name = 'WD Media growth promotion'));
SELECT create_test(pg_temp.cfl(), 'WD Bracket Assay', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE method_name = 'WD Media growth promotion'));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values, default_spec_text)
SELECT pg_temp.m_ver(n), pg_temp.m_ga(), 1, 'Qualitative', '{Growth,No growth}', '{No growth}', 'Growth' FROM unnest(ARRAY['WD Growth Promotion', 'WD Bracket Assay']) n;
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.m_ver('WD Growth Promotion'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 2, "qc": []}'),
 (pg_temp.m_ver('WD Growth Promotion'), 'read', 'Read growth', 'Data Entry', 2, '{"value_label": "Growth", "require_attachment": false}'),
 (pg_temp.m_ver('WD Growth Promotion'), 'review', 'QC Review', 'QC Review', 3, '{}'),
 (pg_temp.m_ver('WD Bracket Assay'), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 3, "qc": [{"qc_type": "CCV", "qc_class": "Analytical", "frequency": "Every N", "every_n": 2, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}]}'),
 (pg_temp.m_ver('WD Bracket Assay'), 'read', 'Read', 'Data Entry', 2, '{"value_label": "Growth", "require_attachment": false}'),
 (pg_temp.m_ver('WD Bracket Assay'), 'review', 'QC Review', 'QC Review', 3, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) SELECT pg_temp.m_st(n, 'read'), pg_temp.m_st(n, 'batch') FROM unnest(ARRAY['WD Growth Promotion', 'WD Bracket Assay']) n;
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) SELECT pg_temp.m_st(n, 'review'), pg_temp.m_st(n, 'read') FROM unnest(ARRAY['WD Growth Promotion', 'WD Bracket Assay']) n;
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.m_ver('WD Growth Promotion'));
SELECT approve_test_version(pg_temp.m_ver('WD Bracket Assay'));
SELECT pg_temp.expect_true('(both new tests are approved)', (SELECT count(*) FROM test_version WHERE id IN (pg_temp.m_ver('WD Growth Promotion'), pg_temp.m_ver('WD Bracket Assay')) AND status = 'Effective') = 2);
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 50, standard_tat = 5, tat_unit = 'Calendar Days' WHERE test_id IN (pg_temp.m_tid('WD Growth Promotion'), pg_temp.m_tid('WD Bracket Assay'));
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Media project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Media project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 50 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Media project' AND x.test_name IN ('WD Growth Promotion', 'WD Bracket Assay');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Media project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Media project');
CREATE OR REPLACE FUNCTION pg_temp.m_qline(tn text) RETURNS uuid LANGUAGE sql AS $$
  SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id JOIN test t ON t.id = q.test_id
   WHERE p.project_name = 'WD Media project' AND t.test_name = tn $$;
SELECT order_test(s.id, pg_temp.m_qline(t)) FROM sample s, unnest(ARRAY['WD Growth Promotion', 'WD Bracket Assay']) t WHERE s.client_sample_id IN ('LOT-A2', 'LOT-M2', 'LOT-N1');

-------------------------------------------------------------------------------
-- 1. MEDIA QUALIFICATION
-------------------------------------------------------------------------------
INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date) VALUES
 (pg_temp.cfl(), 'WD TSA plates (new lot)', '{Media}', 'WD-TSA-1', 50, 'each', current_date + 60),
 (pg_temp.cfl(), 'WD TSA plates (second lot)', '{Media}', 'WD-TSA-2', 50, 'each', current_date + 60),
 (pg_temp.cfl(), 'WD Peptone water', '{Reagent}', 'WD-PEP', 5, 'L', current_date + 60);
SELECT pg_temp.expect_true('A new Media lot needs qualifying (a reagent does not); lots made before migration 023 and demo media do not',
  (pg_temp.m_lot('WD-TSA-1')).qualification_required AND NOT (pg_temp.m_lot('WD-PEP')).qualification_required
  AND NOT (pg_temp.m_lot('WD-XLD')).qualification_required AND media_status((pg_temp.m_lot('WD-TSA-1')).id) = 'Awaiting qualification');
SELECT pg_temp.expect_error_like('Whether a lot needs qualifying is set by the system', $$UPDATE inventory_lot SET qualification_required = false WHERE manufacturer_lot = 'WD-TSA-1'$$, 'set by the system');

-- the bench refuses unqualified media (WD Micro Screen's second batch is at plating)
SELECT pg_temp.as_user('wd.ana');
CREATE OR REPLACE FUNCTION pg_temp.m_plate2() RETURNS uuid LANGUAGE sql AS $$ SELECT pg_temp.m_run(pg_temp.m_batch('WD Micro Screen', 2), 'plate') $$;
SELECT pg_temp.expect_error_like('Media that is not qualified cannot be used at the bench (the message says what to do)',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_plate2(), NULL, (pg_temp.m_lot('WD-TSA-1')).id, 'Media', 1, 'each')$$, 'waiting for QA testing');

-- starting a qualification
SELECT pg_temp.as_user('wd.int');
SELECT pg_temp.expect_error_like('Starting a qualification needs inventory.qualify',
  $$SELECT qualify_media((pg_temp.m_lot('WD-TSA-1')).id, jsonb_build_array(jsonb_build_object('use_test_id', pg_temp.m_tid('WD Micro Screen'), 'qualification_test_id', pg_temp.m_tid('WD Growth Promotion'))))$$, 'inventory.qualify');
SELECT pg_temp.as_user('wd.ana');
-- (since 040 any lot can be sent for QA testing: test_035)
SELECT pg_temp.expect_error_like('The qualification test is another test than the one the media is for',
  $$SELECT qualify_media((pg_temp.m_lot('WD-TSA-1')).id, jsonb_build_array(jsonb_build_object('use_test_id', pg_temp.m_tid('WD Micro Screen'), 'qualification_test_id', pg_temp.m_tid('WD Micro Screen'))))$$, 'different test');
SELECT pg_temp.expect_error_like('At least one test is chosen', $$SELECT qualify_media((pg_temp.m_lot('WD-TSA-1')).id, '[]'::jsonb)$$, 'at least one');
SELECT qualify_media((pg_temp.m_lot(m)).id, jsonb_build_array(jsonb_build_object('use_test_id', pg_temp.m_tid('WD Micro Screen'), 'qualification_test_id', pg_temp.m_tid('WD Growth Promotion'))))
  FROM unnest(ARRAY['WD-TSA-1', 'WD-TSA-2']) m;
SELECT pg_temp.expect_true('The test sample takes the lot''s own ID, on the lab''s internal order, logged at once; the test is in the backlog (no price, the test''s own limits)',
  (SELECT s.status = 'Logged' AND s.logged_at IS NOT NULL AND o.client_id = internal_client() AND o.site_id = pg_temp.cfl()
     FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.sample_code = (pg_temp.m_lot('WD-TSA-1')).lot_code)
  AND (SELECT rt.status = 'In Pool' AND rt.price = 0 AND rt.quoted_line_id IS NULL AND rt.media_lot_id = (pg_temp.m_lot('WD-TSA-1')).id AND rt.due_date IS NOT NULL
         FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE s.sample_code = (pg_temp.m_lot('WD-TSA-1')).lot_code)
  AND (SELECT sp.text_value FROM specification sp JOIN requested_test rt ON rt.id = sp.requested_test_id JOIN sample s ON s.id = rt.sample_id
        WHERE s.sample_code = (pg_temp.m_lot('WD-TSA-1')).lot_code AND sp.status = 'Active') = 'Growth'
  AND EXISTS (SELECT 1 FROM test_pool_view p WHERE p.media_lot_id = (pg_temp.m_lot('WD-TSA-1')).id AND p.is_media)
  AND media_status((pg_temp.m_lot('WD-TSA-1')).id) = 'Being qualified');
SELECT pg_temp.expect_error_like('A lot is qualified once per test it is for',
  $$SELECT qualify_media((pg_temp.m_lot('WD-TSA-1')).id, jsonb_build_array(jsonb_build_object('use_test_id', pg_temp.m_tid('WD Micro Screen'), 'qualification_test_id', pg_temp.m_tid('WD Growth Promotion'))))$$, 'already in QA testing');
SELECT pg_temp.expect_error_like('Qualifications are not written directly', $$UPDATE media_qualification SET status = 'Passed'$$, 'decided by the QC Review');
SELECT pg_temp.expect_error_like('While it is being tested the bench still refuses the lot',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_plate2(), NULL, (pg_temp.m_lot('WD-TSA-1')).id, 'Media', 1, 'each')$$, 'still in QA testing');

-- the batch: media samples join but are outside the batch size (2 client samples) and its brackets
SELECT create_batch(pg_temp.cfl(), pg_temp.m_ver('WD Growth Promotion'));
CREATE OR REPLACE FUNCTION pg_temp.m_gb() RETURNS uuid LANGUAGE sql AS $$ SELECT pg_temp.m_batch('WD Growth Promotion') $$;
SELECT pg_temp.expect_true('Autobatch: the two media samples join beside the batch''s maximum of 2 client samples (4 samples in all; the third client sample waits)',
  (SELECT count(*) FROM batch_entry WHERE batch_id = pg_temp.m_gb() AND entry_type = 'Sample' AND status = 'Active') = 4
  AND batch_client_sample_count(pg_temp.m_gb()) = 2
  AND pg_temp.m_entry(pg_temp.m_gb(), (pg_temp.m_lot('WD-TSA-1')).lot_code) IS NOT NULL AND pg_temp.m_entry(pg_temp.m_gb(), (pg_temp.m_lot('WD-TSA-2')).lot_code) IS NOT NULL
  AND (SELECT count(*) FROM test_pool_view WHERE test_version_id = pg_temp.m_ver('WD Growth Promotion')) = 1);
SELECT complete_step(pg_temp.m_run(pg_temp.m_gb(), 'batch'));
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_run(pg_temp.m_gb(), 'read'), pg_temp.m_entry(pg_temp.m_gb(), (pg_temp.m_lot('WD-TSA-1')).lot_code), (pg_temp.m_lot('WD-TSA-1')).id, 'Media', 1, 'each');
SELECT pg_temp.expect_true('In its own qualification batch the media can be used', EXISTS (SELECT 1 FROM entry_material WHERE lot_id = (pg_temp.m_lot('WD-TSA-1')).id AND status = 'Active'));
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
SELECT pg_temp.m_run(pg_temp.m_gb(), 'read'), e.id, pg_temp.m_ga(), CASE WHEN s.sample_code = (pg_temp.m_lot('WD-TSA-2')).lot_code THEN 'No growth' ELSE 'Growth' END
  FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE e.batch_id = pg_temp.m_gb() AND e.status = 'Active';
SELECT complete_step(pg_temp.m_run(pg_temp.m_gb(), 'read'));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.m_gb()) s;
SELECT approve_batch(pg_temp.m_gb());
SELECT pg_temp.expect_true('QA''s approval decides: the lot that grew is released (Passed); the one that did not is Failed, with the reason',
  (SELECT status = 'Passed' AND decided_by = (SELECT id FROM app_user WHERE username = 'wd.sup') AND batch_id = pg_temp.m_gb() FROM media_qualification WHERE lot_id = (pg_temp.m_lot('WD-TSA-1')).id)
  AND (SELECT status = 'Failed' AND decision_note LIKE '%No growth did not conform%' FROM media_qualification WHERE lot_id = (pg_temp.m_lot('WD-TSA-2')).id)
  AND media_status((pg_temp.m_lot('WD-TSA-1')).id) = 'Qualified' AND media_status((pg_temp.m_lot('WD-TSA-2')).id) = 'Failed qualification');
SELECT pg_temp.as_user('wd.ana');
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_plate2(), NULL, (pg_temp.m_lot('WD-TSA-1')).id, 'Media', 1, 'each');
SELECT pg_temp.expect_true('Released: the qualified lot is used for the test it was qualified for', EXISTS (SELECT 1 FROM entry_material WHERE step_run_id = pg_temp.m_plate2() AND lot_id = (pg_temp.m_lot('WD-TSA-1')).id AND status = 'Active'));
SELECT pg_temp.expect_error_like('A lot that failed is refused, saying so',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_plate2(), NULL, (pg_temp.m_lot('WD-TSA-2')).id, 'Media', 1, 'each')$$, 'rejected in QA testing');

-------------------------------------------------------------------------------
-- 2. ADDING AND REMOVING SAMPLES BEFORE A BATCH STARTS (no signature: Alex)
-------------------------------------------------------------------------------
SELECT create_batch(pg_temp.cfl(), pg_temp.m_ver('WD Bracket Assay'),
  (SELECT jsonb_agg(jsonb_build_object('requested_test_id', p.requested_test_id, 'reprep_request_id', NULL)) FROM test_pool_view p
    WHERE p.test_version_id = pg_temp.m_ver('WD Bracket Assay') AND p.client_sample_id IN ('LOT-A2', 'LOT-M2')));
CREATE OR REPLACE FUNCTION pg_temp.m_bb() RETURNS uuid LANGUAGE sql AS $$ SELECT pg_temp.m_batch('WD Bracket Assay') $$;
SELECT pg_temp.expect_true('(a batch of two samples has two CCV brackets, every 2 samples)', batch_client_sample_count(pg_temp.m_bb()) = 2 AND pg_temp.m_ccvs(pg_temp.m_bb()) = 2);
SELECT complete_step(pg_temp.m_run(pg_temp.m_bb(), 'batch'));
SELECT pg_temp.expect_error_like('Media is released only for the tests it was qualified for: the qualified lot is refused for another test',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.m_run(pg_temp.m_bb(), 'read'), NULL, (pg_temp.m_lot('WD-TSA-1')).id, 'Media', 1, 'each')$$, 'released only for WD Micro Screen');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): adding samples needs bench rights (testing.perform; the database permission check stays)
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): only samples waiting for the same test version join a batch
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): added without a signature: the brackets follow the samples, a completed Batching step opens again, the run order is set again
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): nothing left to add is refused
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): QC entries are not removed by hand
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): removed: back in the backlog, the brackets follow, the entry kept (superseded, removed_at and removed_by)
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): the last sample is not removed (cancel the batch instead)
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.batchEdits): once bench work is recorded the batch's samples no longer change (added or removed)

-------------------------------------------------------------------------------
-- 3. PURCHASING: web link, actual price, receiving into inventory
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.m_line(d text) RETURNS purchase_line LANGUAGE sql AS $$ SELECT * FROM purchase_line WHERE description = d ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.m_sup(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM supplier WHERE supplier_name = n $$;
SELECT pg_temp.as_user('pu.ana');
SELECT pg_temp.expect_error_like('A web link must be a web address', $$INSERT INTO purchase_line (site_id, line_type, description, supplier_id, quantity, unit, item_url) VALUES (pg_temp.cfl(), 'Other', 'Bad link', pg_temp.m_sup('Pur Instruments Inc'), 1, 'case', 'not a link')$$, 'item_url');
INSERT INTO purchase_line (site_id, line_type, description, supplier_id, catalog_number, quantity, unit, unit_price, item_url)
VALUES (pg_temp.cfl(), 'Other', 'WD Sample bags, 1 L, sterile', pg_temp.m_sup('Pur Instruments Inc'), 'SB-1000', 3, 'case', 85, 'https://example.com/sb-1000');
SELECT pg_temp.as_user('pu.sup'); SELECT approve_purchase_lines(ARRAY[(pg_temp.m_line('WD Sample bags, 1 L, sterile')).id]);
SELECT pg_temp.as_user('pu.acc'); SELECT create_purchase_order(ARRAY[(pg_temp.m_line('WD Sample bags, 1 L, sterile')).id], 'FIN-2026-0099', NULL);
SELECT pg_temp.as_user('pu.ana');
-- Moved to the Java backend in migration 065 (JUnit: PurchasingRulesTest.receiving): the actual price cannot be negative; received into
-- inventory (the item created with the supplier, catalog number and web link, linked to the request; the receipt keeps the actual price);
-- receiving without "into inventory" records the receipt only.
INSERT INTO inventory_lot (site_id, item_name, physical_form, chemical_types, supplier_id, receipt_status, requested_quantity, unit, item_url)
VALUES (pg_temp.cfl(), 'WD Methanol HPLC', 'Liquid', '{Solvent}', pg_temp.m_sup('Pur Instruments Inc'), 'Requested', 4, 'L', 'https://example.com/meoh');
SELECT pg_temp.expect_true('An inventory request carries its web link to its purchase request', (pg_temp.m_line('WD Methanol HPLC')).item_url = 'https://example.com/meoh');

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
