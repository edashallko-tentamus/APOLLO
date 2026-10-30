-- Verification for migration 019 (WD-4): micro at the bench. A screening test (daily positive and negative controls
-- made from strains, plating, incubation, an ND / ND* / D* / D reading, a split-off on a finding, QC Review) is built,
-- approved, ordered on three CFL samples and run in two batches the same day (the second links to the day's controls).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Bench work', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.methods_internal', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.mt() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = 'WD Micro Screen' $$;
CREATE OR REPLACE FUNCTION pg_temp.mv() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.mt() ORDER BY version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.ms(k text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM workflow_step WHERE test_version_id = pg_temp.mv() AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.mb(n int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_batch WHERE test_id = pg_temp.mt() ORDER BY batch_code OFFSET n - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.mr(k text, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = pg_temp.mb(n) AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.me(lbl text, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM batch_entry WHERE batch_id = pg_temp.mb(n) AND label LIKE lbl || '%' AND status = 'Active' LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.sampleentry(cid text, n int DEFAULT 1) RETURNS uuid LANGUAGE sql AS $$
  SELECT e.id FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id JOIN sample s ON s.id = rt.sample_id WHERE e.batch_id = pg_temp.mb(n) AND s.client_sample_id = cid $$;
CREATE OR REPLACE FUNCTION pg_temp.mmiss(k text, n int DEFAULT 1) RETURNS text LANGUAGE sql AS $$ SELECT string_agg(problem, ' | ') FROM step_run_missing(pg_temp.mr(k, n)) $$;
CREATE OR REPLACE FUNCTION pg_temp.sal() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Salmonella' $$;

-- set-up: an incubator, media plates, a strain; the test, approved; a quote; three samples ordered
SELECT pg_temp.as_user('akiddle');
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.cfl(), 'WD Incubator');
DO $$ BEGIN
  PERFORM set_config('lims.media_preapproved', '1', true);   -- fixture media, already qualified (media qualification: test_020)
  INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, calibration_required)
  SELECT pg_temp.cfl(), 'WD Incubator 35', t.id, (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'), false FROM equipment_type t WHERE t.type_name = 'WD Incubator';
  INSERT INTO equipment_owner (equipment_id, group_id) SELECT e.id, g.id FROM equipment e, lab_group g WHERE e.equipment_name = 'WD Incubator 35' AND g.site_id = pg_temp.cfl() AND g.group_name = 'Lab Supervisor';
  INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date) VALUES
   (pg_temp.cfl(), 'WD XLD agar plates', '{Media}', 'WD-XLD', 100, 'each', current_date + 60),
   (pg_temp.cfl(), 'WD Salmonella Typhimurium ATCC 14028', '{"Microbiological Strain"}', 'WD-ST', 10, 'each', current_date + 60);
  INSERT INTO lot_analyte (lot_id, analyte_id) SELECT l.id, pg_temp.sal() FROM inventory_lot l WHERE l.manufacturer_lot = 'WD-ST';
END $$;
SELECT pg_temp.as_user('wd.ana');
INSERT INTO method (site_id, method_name, sop_code) VALUES (pg_temp.cfl(), 'WD Salmonella screen', 'SOP-MIC-9001');
SELECT create_test(pg_temp.cfl(), 'WD Micro Screen', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE method_name = 'WD Salmonella screen'));
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values)
VALUES (pg_temp.mv(), pg_temp.sal(), 1, 'Qualitative', '{ND,ND*,D*,D}', '{D*,D}');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.mv(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 2, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Daily", "material": "Strains", "criteria": [{"limit_type": "Presence"}]},
    {"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Daily", "criteria": [{"limit_type": "Absence"}]}]}'),
 (pg_temp.mv(), 'plate', 'Plate on XLD', 'Plating/Inoculation', 2, '{"expected_media": "XLD agar", "plates_per_entry": 1}'),
 (pg_temp.mv(), 'inc', 'Incubate', 'Incubation', 3, '{"temp_c": 32.5, "temp_tolerance": 2.5, "duration": 21, "window_min": 18, "window_max": 24, "duration_unit": "hours"}'),
 (pg_temp.mv(), 'read', 'Read plates', 'Data Entry', 4, '{"value_label": "Typical colonies", "require_attachment": false}'),
 (pg_temp.mv(), 'ident', 'Identification', 'Split off Test', 5, jsonb_build_object('test_id', (SELECT id FROM test WHERE test_name = 'WD Micro P/A'), 'trigger', 'On finding', 'finding', 'Present', 'finding_steps', '["read"]'::jsonb)),
 (pg_temp.mv(), 'review', 'QC Review', 'QC Review', 6, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES
 (pg_temp.ms('plate'), pg_temp.ms('batch')), (pg_temp.ms('inc'), pg_temp.ms('plate')), (pg_temp.ms('read'), pg_temp.ms('inc')),
 (pg_temp.ms('ident'), pg_temp.ms('read')), (pg_temp.ms('review'), pg_temp.ms('ident'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) SELECT pg_temp.ms('inc'), id, true FROM equipment_type WHERE type_name = 'WD Incubator';
SELECT pg_temp.expect_true('(the micro screen has no errors)', (SELECT count(*) FROM test_version_problems(pg_temp.mv()) WHERE severity = 'Error') = 0);
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.mv());
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 80 WHERE test_id IN (pg_temp.mt(), (SELECT id FROM test WHERE test_name = 'WD Micro P/A'));
INSERT INTO project (client_id, project_name) SELECT client_id, 'WD Micro project' FROM lab_order WHERE order_code = 'LO-000003';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Micro project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, x.id, 3, 80 FROM project_version pv JOIN project p ON p.id = pv.project_id, test x WHERE p.project_name = 'WD Micro project' AND x.test_name IN ('WD Micro Screen', 'WD Micro P/A');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Micro project');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Micro project');
CREATE OR REPLACE FUNCTION pg_temp.mline(tn text) RETURNS uuid LANGUAGE sql AS $$
  SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id JOIN test t ON t.id = q.test_id
   WHERE p.project_name = 'WD Micro project' AND t.test_name = tn $$;
SELECT order_test(s.id, pg_temp.mline('WD Micro Screen')) FROM sample s WHERE s.client_sample_id IN ('LOT-A2', 'LOT-M2', 'LOT-N1') ORDER BY s.client_sample_id;

-- batch 1 (two samples) holds the day's controls; batch 2 (the third sample) links to them
SELECT pg_temp.as_user('wd.ana');
SELECT create_batch(pg_temp.cfl(), pg_temp.mv());
SELECT create_batch(pg_temp.cfl(), pg_temp.mv());
SELECT pg_temp.expect_true('Daily controls: the day''s first batch holds them; the second batch links to them (no data of its own)',
  (SELECT count(*) FROM batch_entry WHERE batch_id = pg_temp.mb(1) AND label LIKE '% (daily)' AND daily_of_entry_id IS NULL) = 2
  AND (SELECT count(*) FROM batch_entry e JOIN batch_entry o ON o.id = e.daily_of_entry_id WHERE e.batch_id = pg_temp.mb(2) AND o.batch_id = pg_temp.mb(1)) = 2
  AND (SELECT label FROM batch_entry WHERE batch_id = pg_temp.mb(2) AND qc_type = 'Positive Control') LIKE 'Positive Control (daily, from BAT-%)');
SELECT complete_step(pg_temp.mr('batch'));
SELECT complete_step(pg_temp.mr('batch', 2));
SELECT pg_temp.expect_error_like('A linked daily control takes no data in the second batch',
  $$INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (pg_temp.mr('plate', 2), pg_temp.me('Positive Control', 2), 1)$$, 'shared control');
SELECT pg_temp.expect_true('The second batch only needs its own sample plated', pg_temp.mmiss('plate', 2) NOT LIKE '%Control%' AND pg_temp.mmiss('plate', 2) LIKE '%: record the plates%');

-- plating: plates per entry, the media lot (off its stock), the strain on the positive control
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.values): plates are counted in whole numbers
INSERT INTO entry_value (step_run_id, entry_id, value_num, data)
  SELECT pg_temp.mr('plate'), id, 1, '{"levels": "1:10"}' FROM batch_entry WHERE batch_id = pg_temp.mb(1) AND status = 'Active';
SELECT pg_temp.expect_true('Missing: the media lot for each plated entry', pg_temp.mmiss('plate') LIKE '%: record the media lot%');
SELECT pg_temp.expect_error_like('A strain must be a Microbiological Strain lot',
  $$INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) SELECT pg_temp.mr('plate'), pg_temp.me('Positive Control'), id, 'Strain', 1, 'each' FROM inventory_lot WHERE manufacturer_lot = 'WD-XLD'$$, 'not a Microbiological Strain');
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) SELECT pg_temp.mr('plate'), NULL, id, 'Media', 4, 'each' FROM inventory_lot WHERE manufacturer_lot = 'WD-XLD';
INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) SELECT pg_temp.mr('plate'), pg_temp.me('Positive Control'), id, 'Strain', 1, 'each' FROM inventory_lot WHERE manufacturer_lot = 'WD-ST';
SELECT pg_temp.expect_true('The plates and the strain come off their stock (100 - 4 plates; 10 - 1 vial)',
  lot_on_hand((SELECT id FROM inventory_lot WHERE manufacturer_lot = 'WD-XLD')) = 96 AND lot_on_hand((SELECT id FROM inventory_lot WHERE manufacturer_lot = 'WD-ST')) = 9);
SELECT complete_step(pg_temp.mr('plate'));

-- incubation: loads with time in and out, the incubator gated, the window checked
SELECT pg_temp.expect_true('Missing: an incubator load', pg_temp.mmiss('inc') LIKE 'Put the plates in an incubator%');
SELECT pg_temp.expect_error_like('Time out must be after time in',
  $$INSERT INTO incubation_load (step_run_id, equipment_id, time_in, time_out) SELECT pg_temp.mr('inc'), id, now() - interval '1 hour', now() - interval '2 hours' FROM equipment WHERE equipment_name = 'WD Incubator 35'$$, 'after time in');
SELECT pg_temp.expect_error_like('An incubator of a type the step does not use is refused',
  $$INSERT INTO incubation_load (step_run_id, equipment_id, time_in) SELECT pg_temp.mr('inc'), id, now() - interval '1 hour' FROM equipment WHERE equipment_name = 'WD Balance 1'$$, 'does not use');
INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in)
  SELECT pg_temp.mr('inc'), e.id, ARRAY[pg_temp.me('Positive Control'), pg_temp.me('Negative Control')], clock_timestamp() - interval '30 hours' FROM equipment e WHERE e.equipment_name = 'WD Incubator 35';
SELECT pg_temp.expect_true('Missing: the load''s time out, and the samples not in any load',
  pg_temp.mmiss('inc') LIKE '%take it out (time out)%' AND pg_temp.mmiss('inc') LIKE '%' || (SELECT label FROM batch_entry WHERE id = pg_temp.sampleentry('LOT-A2')) || ': not in any incubator load%');
UPDATE incubation_load SET time_out = clock_timestamp() - interval '1 minute', temperature = 33 WHERE step_run_id = pg_temp.mr('inc');
INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
  SELECT pg_temp.mr('inc'), e.id, ARRAY[pg_temp.sampleentry('LOT-A2'), pg_temp.sampleentry('LOT-M2')], clock_timestamp() - interval '20 hours', clock_timestamp() - interval '1 minute', 32.0
    FROM equipment e WHERE e.equipment_name = 'WD Incubator 35';
SELECT pg_temp.expect_true('A load outside its window (30 h, 18 to 24) needs a note before the step completes; the in-window load does not',
  pg_temp.mmiss('inc') LIKE '%incubated 30.0 hours, outside 18 to 24 hours; explain it%' AND (SELECT count(*) FROM step_run_missing(pg_temp.mr('inc'))) = 1);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('Changing a recorded time is a correction with a reason',
  $$UPDATE incubation_load SET time_in = time_in + interval '1 hour' WHERE step_run_id = pg_temp.mr('inc') AND entry_ids @> ARRAY[pg_temp.sampleentry('LOT-A2')]$$, 'correction');
SELECT set_config('lims.reason', 'Bench work', false);
UPDATE incubation_load SET note = 'Controls left over the weekend shift change; controls still valid per SOP 5.2' WHERE step_run_id = pg_temp.mr('inc') AND entry_ids @> ARRAY[pg_temp.me('Positive Control')];
SELECT complete_step(pg_temp.mr('inc'));
SELECT pg_temp.expect_true('Incubation completed once the out-of-window load is explained', (SELECT status = 'Completed' FROM step_run WHERE id = pg_temp.mr('inc')));

-- reading: ND for one sample, D* (found) for the other; the controls
INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text) VALUES
 (pg_temp.mr('read'), pg_temp.sampleentry('LOT-A2'), pg_temp.sal(), 'ND'),
 (pg_temp.mr('read'), pg_temp.sampleentry('LOT-M2'), pg_temp.sal(), 'D*'),
 (pg_temp.mr('read'), pg_temp.me('Positive Control'), pg_temp.sal(), 'D'),
 (pg_temp.mr('read'), pg_temp.me('Negative Control'), pg_temp.sal(), 'ND');
SELECT pg_temp.expect_true('Qualitative results are the reading itself', (SELECT value_text = 'D*' AND reported = 'D*' FROM batch_results(pg_temp.mb(1)) WHERE entry_id = pg_temp.sampleentry('LOT-M2') AND is_final));
SELECT pg_temp.expect_true('Micro controls judged: the positive grows (Presence: Pass), the negative does not (Absence: Pass)',
  (SELECT verdict FROM batch_qc_verdicts(pg_temp.mb(1)) WHERE label LIKE 'Positive Control%') = 'Pass'
  AND (SELECT verdict FROM batch_qc_verdicts(pg_temp.mb(1)) WHERE label LIKE 'Negative Control%') = 'Pass');
SELECT pg_temp.expect_true('The second batch shows the day''s control verdicts from the first', (SELECT verdict = 'Pass' AND note LIKE 'Daily control in BAT-%' FROM batch_qc_verdicts(pg_temp.mb(2)) WHERE label LIKE 'Positive Control%'));
UPDATE entry_value SET value_text = 'ND' WHERE entry_id = pg_temp.me('Positive Control') AND step_run_id = pg_temp.mr('read');
SELECT pg_temp.expect_true('A positive control that does not grow fails', (SELECT verdict FROM batch_qc_verdicts(pg_temp.mb(1)) WHERE label LIKE 'Positive Control%') = 'Fail');
UPDATE entry_value SET value_text = 'D' WHERE entry_id = pg_temp.me('Positive Control') AND step_run_id = pg_temp.mr('read');
SELECT complete_step(pg_temp.mr('read'));

-- split-off on the finding, the customer's consent, the order
SELECT complete_step(pg_temp.mr('ident'));
SELECT pg_temp.expect_true('Completing the split-off step raises a request for the sample with a finding (D*), not for ND',
  (SELECT count(*) FROM split_request WHERE batch_id = pg_temp.mb(1)) = 1
  AND (SELECT status = 'Awaiting consent' AND finding = 'WD Salmonella D*' FROM split_request WHERE entry_id = pg_temp.sampleentry('LOT-M2')));
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.splits): split-off requests are raised by the step and decided at the bench routes, not written (deciding needs orders.edit: the database permission check stays)
SELECT pg_temp.as_user('wd.int');
-- Moved to the Java backend in migration 067 (JUnit: BenchRulesTest.splits): a declined request needs a note
-- the customer's consent (Java's SplitRequest.decide since migration 067), written here as Java writes it
UPDATE split_request SET status = 'Consent given', decision_note = 'Sam Nguyen agreed by email', decided_by = current_app_user(), decided_at = clock_timestamp() WHERE batch_id = pg_temp.mb(1);
SELECT pg_temp.as_user('akiddle');
SELECT order_test((SELECT sample_id FROM split_request WHERE batch_id = pg_temp.mb(1)), pg_temp.mline('WD Micro P/A'));
SELECT pg_temp.expect_true('Consent recorded by intake; ordering the test closes the request (Ordered, linked to the new test, which is in the backlog)',
  (SELECT status = 'Ordered' AND decided_by = pg_temp.uid('wd.int') AND ordered_requested_test_id IS NOT NULL FROM split_request WHERE batch_id = pg_temp.mb(1))
  AND EXISTS (SELECT 1 FROM test_pool_view p JOIN split_request s ON s.ordered_requested_test_id = p.requested_test_id WHERE s.batch_id = pg_temp.mb(1)));

-- review and approval: the qualitative results are stored
SELECT pg_temp.expect_true('(the micro batch waits for review)', (SELECT status = 'Awaiting Review' FROM test_batch WHERE id = pg_temp.mb(1)));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_review_step(s.step_run_id) FROM review_step_runs(pg_temp.mb(1)) s;   -- each step approved first (migration 020)
-- WD-5.1: the load outside its window (explained in its note) is also accepted by the reviewer
SELECT pg_temp.expect_true('WD-5.1: a load outside its window stops approval until the reviewer accepts it',
  (SELECT string_agg(problem, ' | ') FROM batch_review_problems(pg_temp.mb(1))) LIKE '%Incubator load in %incubated 30.0 hours%the reviewer accepts it%');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('WD-5.1: only a reviewer accepts a load', $$SELECT accept_load(pg_temp.mb(1), (SELECT id FROM incubation_load_view WHERE batch_id = pg_temp.mb(1) AND check_text IS NOT NULL), 'ok')$$, 'testing.review');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('WD-5.1: accepting a load needs a justification', $$SELECT accept_load(pg_temp.mb(1), (SELECT id FROM incubation_load_view WHERE batch_id = pg_temp.mb(1) AND check_text IS NOT NULL), ' ')$$, 'Write why');
SELECT pg_temp.expect_error_like('WD-5.1: a load within its window needs no acceptance', $$SELECT accept_load(pg_temp.mb(1), (SELECT id FROM incubation_load_view WHERE batch_id = pg_temp.mb(1) AND check_text IS NULL LIMIT 1), 'ok')$$, 'nothing to accept');
SELECT accept_load(pg_temp.mb(1), (SELECT id FROM incubation_load_view WHERE batch_id = pg_temp.mb(1) AND check_text IS NOT NULL), 'Controls only; 6 hours over is within the strain''s stability (SOP 5.2)');
SELECT pg_temp.expect_true('WD-5.1: accepted (with what was out at the time); nothing left to resolve',
  (SELECT check_text LIKE 'incubated 30.0 hours%' AND justification LIKE 'Controls only%' AND created_by = pg_temp.uid('wd.sup') FROM load_acceptance WHERE batch_id = pg_temp.mb(1) AND status = 'Active')
  AND NOT EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.mb(1))));
SELECT approve_batch(pg_temp.mb(1));
SELECT pg_temp.expect_true('Approved: the qualitative results are stored as reported (ND, D*)',
  (SELECT string_agg(r.value_text, ',' ORDER BY r.value_text) FROM test_result r WHERE r.batch_id = pg_temp.mb(1)) = 'D*,ND');

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
