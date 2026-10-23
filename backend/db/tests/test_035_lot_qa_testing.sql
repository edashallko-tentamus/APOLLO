-- Verification for migration 040 (0.22.0): QA testing of inventory before use, for any item. Each lab sets which item
-- types need it (Media on); the choice can be made per item at receipt (waiving it is QA's); a QA test run on a sample
-- carrying the lot's ID releases the lot for every use or for named tests; a failure rejects the lot for every use until
-- a retest passes; mixtures take only lots released for every use.
-- Uses the fixtures of test_020 (WD Growth Promotion, WD Micro Screen, WD-TSA-1 released for WD Micro Screen only) and
-- the users wd.ana (Analyst), wd.sup (Lab Supervisor) and wd.qa (QA).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.media_preapproved', '', false);
SELECT set_config('lims.qa_testing', '', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'PASS');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'FAIL: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.q_tid(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n AND site_id = pg_temp.cfl() $$;
CREATE OR REPLACE FUNCTION pg_temp.q_ver(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_version WHERE test_id = pg_temp.q_tid(n) AND status = 'Effective' $$;
CREATE OR REPLACE FUNCTION pg_temp.q_lot(m text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM inventory_lot WHERE manufacturer_lot = m $$;
CREATE OR REPLACE FUNCTION pg_temp.q_run(b uuid, k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.q_send(m text, use_test text) RETURNS uuid LANGUAGE sql AS $$
  SELECT send_lot_for_qa_testing(pg_temp.q_lot(m), jsonb_build_array(jsonb_build_object('use_test_id', pg_temp.q_tid(use_test), 'qualification_test_id', pg_temp.q_tid('WD Growth Promotion')))) $$;
-- run a WD Growth Promotion batch through to QA's approval; lots listed in p_fail read "No growth" (does not conform)
CREATE OR REPLACE FUNCTION pg_temp.q_run_batch(p_fail text[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b uuid; r record;
BEGIN
  PERFORM pg_temp.as_user('wd.ana');
  b := create_batch(pg_temp.cfl(), pg_temp.q_ver('WD Growth Promotion'));
  PERFORM complete_step(pg_temp.q_run(b, 'batch'));
  INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
  SELECT pg_temp.q_run(b, 'read'), e.id, (SELECT id FROM analyte WHERE analyte_name = 'WD Growth promotion'),
         CASE WHEN l.manufacturer_lot = ANY (p_fail) THEN 'No growth' ELSE 'Growth' END
    FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN inventory_lot l ON l.id = rt.media_lot_id
   WHERE e.batch_id = b AND e.status = 'Active';
  PERFORM complete_step(pg_temp.q_run(b, 'read'));
  PERFORM pg_temp.as_user('wd.sup');
  FOR r IN SELECT * FROM review_step_runs(b) WHERE mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
  PERFORM approve_batch(b);
  RETURN b;
END $$;

-------------------------------------------------------------------------------
-- 1. EACH LAB'S DEFAULTS
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Every lab has a QA testing default for every item type; Media needs it (as before), the others do not',
  (SELECT count(*) FROM qa_testing_default d JOIN lab_site s ON s.id = d.site_id WHERE s.site_code IN ('CFL', 'TPS')) = 2 * cardinality(enum_range(NULL::chemical_type))
  AND (SELECT bool_and(required = (chemical_type = 'Media')) FROM qa_testing_default));
SELECT pg_temp.expect_true('QA holds the new permission inventory.qa_configure (standard group); an analyst does not',
  EXISTS (SELECT 1 FROM standard_group_template WHERE group_name = 'QA' AND 'inventory.qa_configure' = ANY (permissions))
  AND user_has_permission_at((SELECT id FROM app_user WHERE username = 'wd.qa'), 'inventory.qa_configure', pg_temp.cfl())
  AND NOT user_has_permission_at((SELECT id FROM app_user WHERE username = 'wd.ana'), 'inventory.qa_configure', pg_temp.cfl()));
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('An analyst cannot change which item types need QA testing',
  $$UPDATE qa_testing_default SET required = true WHERE site_id = pg_temp.cfl() AND chemical_type = 'Reagent'$$, 'inventory.qa_configure');
SELECT pg_temp.as_user('wd.qa');
SELECT set_config('lims.reason', 'Reagents are tested before use (QA decision)', false);
SELECT pg_temp.expect_ok('QA sets Reagent to need QA testing at CFL (with a reason)',
  $$UPDATE qa_testing_default SET required = true WHERE site_id = pg_temp.cfl() AND chemical_type = 'Reagent'$$);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT pg_temp.expect_true('The change is in the audit trail, with its reason',
  EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'qa_testing_default' AND a.reason = 'Reagents are tested before use (QA decision)'));
SELECT pg_temp.expect_error_like('A default keeps its lab and item type',
  $$UPDATE qa_testing_default SET chemical_type = 'Solvent' WHERE site_id = pg_temp.cfl() AND chemical_type = 'Reagent'$$, 'keeps its lab and item type');

-------------------------------------------------------------------------------
-- 2. NEW LOTS: THE LAB'S DEFAULT, OR THE CHOICE MADE AT RECEIPT
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('wd.ana');
INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date) VALUES
 (pg_temp.cfl(), 'QA Sodium chloride', '{Reagent}', 'QA-NACL-1', 1, 'kg', current_date + 300),
 (pg_temp.cfl(), 'QA Sodium chloride (second lot)', '{Reagent}', 'QA-NACL-2', 1, 'kg', current_date + 300),
 (pg_temp.cfl(), 'QA Acetonitrile', '{Solvent}', 'QA-ACN-1', 4, 'L', current_date + 300);
SELECT pg_temp.expect_true('A new reagent now needs QA testing (the lab''s default); a solvent does not',
  lot_qa_status(pg_temp.q_lot('QA-NACL-1')) = 'Awaiting QA testing' AND lot_qa_status(pg_temp.q_lot('QA-ACN-1')) IS NULL);
SELECT set_config('lims.qa_testing', '1', false);
INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date)
VALUES (pg_temp.cfl(), 'QA Methanol (sent for testing at receipt)', '{Solvent}', 'QA-MEOH-1', 4, 'L', current_date + 300);
SELECT pg_temp.expect_true('Ticking "Send for QA testing" at receipt makes any item need it',
  lot_qa_status(pg_temp.q_lot('QA-MEOH-1')) = 'Awaiting QA testing');
SELECT set_config('lims.qa_testing', '0', false);
SELECT pg_temp.expect_error_like('Receiving an item without the QA testing the lab asks for is QA''s call',
  $$INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date)
    VALUES (pg_temp.cfl(), 'QA Sodium chloride (no testing)', '{Reagent}', 'QA-NACL-X', 1, 'kg', current_date + 300)$$, 'only QA can receive it without QA testing');
SELECT pg_temp.as_user('akiddle');
INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date)
VALUES (pg_temp.cfl(), 'QA Sodium chloride (received without testing)', '{Reagent}', 'QA-NACL-W', 1, 'kg', current_date + 300);
SELECT pg_temp.expect_true('Someone holding inventory.qa_configure can receive it without QA testing', lot_qa_status(pg_temp.q_lot('QA-NACL-W')) IS NULL);
SELECT set_config('lims.qa_testing', '', false);
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('Whether a lot needs QA testing is not edited directly',
  $$UPDATE inventory_lot SET qualification_required = false WHERE manufacturer_lot = 'QA-NACL-1'$$, 'set by the system');
SELECT pg_temp.expect_true('A lot waiting for QA testing is not usable for any test, and says what to do',
  lot_qa_problem(pg_temp.q_lot('QA-NACL-1'), pg_temp.q_tid('WD Micro Screen')) LIKE '%waiting for QA testing%Send for QA testing%'
  AND lot_qa_problem(pg_temp.q_lot('QA-ACN-1'), pg_temp.q_tid('WD Micro Screen')) IS NULL);
SELECT pg_temp.expect_error_like('Nor can it go into an in-house mixture',
  $$INSERT INTO lot_component (lot_id, component_lot_id, quantity_used) VALUES (pg_temp.q_lot('QA-ACN-1'), pg_temp.q_lot('QA-NACL-1'), 0.01)$$, 'cannot go into a mixture');

-- QA waives the testing of one lot (signed, with a reason); nobody else can
SELECT pg_temp.expect_error_like('An analyst cannot waive QA testing', $$SELECT waive_lot_qa_testing(pg_temp.q_lot('QA-NACL-2'))$$, 'inventory.qa_configure');
SELECT pg_temp.as_user('wd.qa');
SELECT set_config('lims.reason', 'Supplier COA reviewed: identity and assay meet the specification', false);
SELECT pg_temp.expect_ok('QA waives QA testing for a lot', $$SELECT waive_lot_qa_testing(pg_temp.q_lot('QA-NACL-2'))$$);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT pg_temp.expect_true('The waived lot needs no testing; the change is audited with its reason and signature',
  lot_qa_status(pg_temp.q_lot('QA-NACL-2')) IS NULL
  AND EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'inventory_lot' AND a.record_id = pg_temp.q_lot('QA-NACL-2')
               AND a.reason LIKE 'Supplier COA reviewed%' AND a.signature_id IS NOT NULL));

-------------------------------------------------------------------------------
-- 3. SENT FOR QA TESTING, RELEASED FOR EVERY USE
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_ok('A reagent is sent for QA testing, to be released for every use', $$SELECT pg_temp.q_send('QA-NACL-1', NULL)$$);
SELECT pg_temp.expect_true('Its test sample carries the lot''s ID and waits in the backlog; the lot is In QA testing',
  lot_qa_status(pg_temp.q_lot('QA-NACL-1')) = 'In QA testing'
  AND EXISTS (SELECT 1 FROM test_pool_view p WHERE p.media_lot_id = pg_temp.q_lot('QA-NACL-1') AND p.sample_code = (SELECT lot_code FROM inventory_lot WHERE id = pg_temp.q_lot('QA-NACL-1')))
  AND (SELECT use_test_id IS NULL FROM media_qualification WHERE lot_id = pg_temp.q_lot('QA-NACL-1')));
SELECT pg_temp.expect_error_like('It is not sent twice for the same release',
  $$SELECT pg_temp.q_send('QA-NACL-1', NULL)$$, 'already in QA testing for every use');
SELECT pg_temp.expect_true('While it is tested it is still refused (outside its own QA batch)',
  lot_qa_problem(pg_temp.q_lot('QA-NACL-1'), pg_temp.q_tid('WD Micro Screen')) LIKE '%still in QA testing%');
SELECT pg_temp.expect_ok('A lot the lab does not test by default can still be sent (the solvent)', $$SELECT pg_temp.q_send('QA-ACN-1', 'WD Micro Screen')$$);
SELECT pg_temp.expect_true('Sending it makes it need QA testing', lot_qa_status(pg_temp.q_lot('QA-ACN-1')) = 'In QA testing');
SELECT pg_temp.q_send('QA-MEOH-1', NULL);
SELECT pg_temp.q_run_batch(ARRAY['QA-MEOH-1']);
SELECT pg_temp.expect_true('QA''s approval releases the reagent for every use; the solvent for its named test; the methanol is Rejected (with the reason)',
  lot_qa_status(pg_temp.q_lot('QA-NACL-1')) = 'Released for every use'
  AND (SELECT decision_note FROM media_qualification WHERE lot_id = pg_temp.q_lot('QA-NACL-1')) LIKE 'Released for every use%'
  AND lot_qa_status(pg_temp.q_lot('QA-ACN-1')) = 'Released for named tests'
  AND lot_qa_status(pg_temp.q_lot('QA-MEOH-1')) = 'Rejected'
  AND (SELECT decision_note FROM media_qualification WHERE lot_id = pg_temp.q_lot('QA-MEOH-1')) LIKE 'Rejected: %No growth did not conform%');
SELECT pg_temp.expect_true('Released for every use: usable for any test and in a mixture; released for a named test: only that test',
  lot_qa_problem(pg_temp.q_lot('QA-NACL-1'), pg_temp.q_tid('WD Micro Screen')) IS NULL
  AND lot_qa_problem(pg_temp.q_lot('QA-NACL-1'), pg_temp.q_tid('WD Bracket Assay')) IS NULL
  AND lot_qa_problem(pg_temp.q_lot('QA-NACL-1'), NULL) IS NULL
  AND lot_qa_problem(pg_temp.q_lot('QA-ACN-1'), pg_temp.q_tid('WD Micro Screen')) IS NULL
  AND lot_qa_problem(pg_temp.q_lot('QA-ACN-1'), pg_temp.q_tid('WD Bracket Assay')) LIKE '%released only for WD Micro Screen%');
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('Media released only for a named test (test_020''s WD-TSA-1) cannot go into a mixture',
  $$INSERT INTO lot_component (lot_id, component_lot_id, quantity_used) VALUES (pg_temp.q_lot('QA-ACN-1'), pg_temp.q_lot('WD-TSA-1'), 1)$$, 'not for every use');

-------------------------------------------------------------------------------
-- 4. REJECTED: BLOCKED FOR EVERY USE UNTIL A RETEST PASSES
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('A rejected lot is refused for every use, and the message says how to move on',
  lot_qa_problem(pg_temp.q_lot('QA-MEOH-1'), pg_temp.q_tid('WD Micro Screen')) LIKE '%rejected in QA testing%retest passes%dispose%'
  AND lot_qa_problem(pg_temp.q_lot('QA-MEOH-1'), NULL) LIKE '%rejected%');
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.expect_error_like('A rejected lot cannot be waived (the result decides)', $$SELECT waive_lot_qa_testing(pg_temp.q_lot('QA-MEOH-1'))$$, 'its result decides');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_ok('It is sent for a retest', $$SELECT pg_temp.q_send('QA-MEOH-1', NULL)$$);
SELECT pg_temp.expect_true('The retest is a new test on the same lot sample, linked to the failed one; the lot stays rejected while it runs',
  lot_qa_status(pg_temp.q_lot('QA-MEOH-1')) = 'Rejected, retest under way'
  AND (SELECT count(*) FROM requested_test rt JOIN sample s ON s.id = rt.sample_id WHERE s.sample_code = (SELECT lot_code FROM inventory_lot WHERE id = pg_temp.q_lot('QA-MEOH-1'))) = 2
  AND EXISTS (SELECT 1 FROM requested_test rt WHERE rt.media_lot_id = pg_temp.q_lot('QA-MEOH-1') AND rt.retest_of_id IS NOT NULL)
  AND EXISTS (SELECT 1 FROM media_qualification q WHERE q.lot_id = pg_temp.q_lot('QA-MEOH-1') AND q.status = 'Testing' AND q.retest_of_id IS NOT NULL)
  AND lot_qa_problem(pg_temp.q_lot('QA-MEOH-1'), pg_temp.q_tid('WD Micro Screen')) LIKE '%rejected%');
SELECT pg_temp.q_run_batch(ARRAY[]::text[]);
SELECT pg_temp.expect_true('The retest passes: the lot is released for every use, its history kept (Failed, then Passed)',
  lot_qa_status(pg_temp.q_lot('QA-MEOH-1')) = 'Released for every use'
  AND lot_qa_problem(pg_temp.q_lot('QA-MEOH-1'), pg_temp.q_tid('WD Micro Screen')) IS NULL
  AND (SELECT string_agg(status, ',' ORDER BY created_at) FROM media_qualification WHERE lot_id = pg_temp.q_lot('QA-MEOH-1')) = 'Failed,Passed');
SELECT pg_temp.expect_true('The audit trail names the lot''s QA testing record',
  (SELECT audit_record_ref('media_qualification', q.id, to_jsonb(q))->>'label' FROM media_qualification q WHERE q.lot_id = pg_temp.q_lot('QA-NACL-1')) LIKE 'QA testing MQ-% of INV-%');

SELECT set_config('lims.qa_testing', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
