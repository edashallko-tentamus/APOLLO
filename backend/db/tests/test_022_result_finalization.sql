-- Verification for migration 026 (R-1): Result Finalization and the COA. Uses the results approved by the earlier
-- rule tests (WD-STAB-1 on its own order; LOT-A2 and LOT-M2 with several tests, one out of specification). Who may
-- finalize (Project Manager, QA for GMP work), the second review being someone else's, the content matching the record,
-- the release check (Block, Warning with a reason), versions chained by fingerprint, partial reports, holds, the order
-- Reported, notes, templates and compliance categories. The PDF and the release check themselves are made by the server
-- (server/coa.js) and exercised by tests/e2e_reports.js.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.reports_internal', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false) $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.smp(csid text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sample WHERE client_sample_id = csid ORDER BY created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rt(csid text, tname text) RETURNS uuid LANGUAGE sql AS $$
  SELECT rt.id FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = pg_temp.smp(csid) AND t.test_name = tname AND rt.status <> 'Cancelled' $$;
-- what the server puts in a version's content (the parts the database checks), built here from the record
CREATE OR REPLACE FUNCTION pg_temp.content(csid text, tests uuid[], ver int DEFAULT NULL, pending int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object(
    'coa_code', 'COA-' || s.sample_code,
    'version_no', COALESCE(ver, (SELECT COALESCE(max(v.version_no), 0) + 1 FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = s.id)),
    'verify_code', upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4)),
    'verify_url', 'http://localhost/verify.html',
    'pending_count', COALESCE(pending, (SELECT count(*)::int FROM requested_test r WHERE r.sample_id = s.id AND r.status <> 'Cancelled' AND NOT r.id = ANY (tests) AND NOT test_is_finalized(r.id))),
    'result_ids', (SELECT COALESCE(jsonb_agg(x.id::text), '[]') FROM (SELECT unnest(test_final_result_ids(q.t)) AS id FROM unnest(tests) AS q(t)) x))
  FROM sample s WHERE s.client_sample_id = csid $$;
CREATE OR REPLACE FUNCTION pg_temp.pdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.sha(d uuid) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(content), 'hex') FROM document_file WHERE id = d $$;
CREATE OR REPLACE FUNCTION pg_temp.fin(csid text, tests uuid[], checks jsonb DEFAULT '[]', label text DEFAULT 'x') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid := pg_temp.pdf(csid || ' ' || label || ' ' || clock_timestamp());
BEGIN RETURN finalize_sample(pg_temp.smp(csid), tests, pg_temp.content(csid, tests), d, pg_temp.sha(d), checks, next_finalization_group()); END $$;

-- 1. who finalizes
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_true('Every lab has a Project Manager group holding Result Finalization; QA also finalizes GMP work; analysts do not finalize',
  EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.cfl() AND g.group_name = 'Project Manager' AND p.permission_code = 'reports.finalize')
  AND EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.cfl() AND g.group_name = 'QA' AND p.permission_code = 'reports.finalize_gmp')
  AND NOT EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.cfl() AND g.group_name = 'Project Manager' AND p.permission_code = 'reports.finalize_gmp')
  AND NOT user_has_permission_at(pg_temp.uid('wd.ana2'), 'reports.finalize', pg_temp.cfl()));
INSERT INTO app_user (username, full_name) VALUES ('wd.pm', 'WD Project Manager') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.uid('wd.pm') FROM lab_group g WHERE g.site_id = pg_temp.cfl() AND g.group_name = 'Project Manager' ON CONFLICT DO NOTHING;
-- (migration 028: a COA is issued only by someone with a handwritten signature and title on file; fixture signatures for the test users)
DO $$ DECLARE d uuid; BEGIN
  PERFORM set_config('lims.group_sync', '1', true);
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('signature.png', 'image/png', 8, '', decode('89504e470d0a1a0a', 'hex')) RETURNING id INTO d;
  UPDATE app_user SET signature_document_id = d, title = COALESCE(title, 'Test signer') WHERE NOT is_automated AND signature_document_id IS NULL;
  PERFORM set_config('lims.group_sync', '', true);
END $$;
SELECT pg_temp.expect_true('The queue lists the client tests QC Review approved (not media qualification or verification samples)',
  (SELECT count(*) FROM finalization_queue_view WHERE site_id = pg_temp.cfl()) >= 5
  AND EXISTS (SELECT 1 FROM finalization_queue_view WHERE requested_test_id = pg_temp.rt('WD-STAB-1', 'WD Stability'))
  AND (SELECT has_oos FROM finalization_queue_view WHERE requested_test_id = pg_temp.rt('LOT-A2', 'WD Metals')));

SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.expect_error_like('An analyst cannot finalize (reports.finalize)', $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')])$$, 'reports.finalize');
SELECT pg_temp.user_only('wd.pm');
SELECT pg_temp.expect_error_like('Finalizing is signed', $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')])$$, 'electronic signature');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.uid('wd.ana') FROM lab_group g WHERE g.site_id = pg_temp.cfl() AND g.group_name = 'Project Manager' ON CONFLICT DO NOTHING;
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('The second review is someone else''s: whoever did the bench work cannot finalize it (even holding the permission)',
  $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')])$$, 'someone else finalizes');

-- 2. the content must be the record; the release check
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.expect_error_like('A COA built before the tests changed is refused (the tests still in the lab)',
  $$SELECT finalize_sample(pg_temp.smp('WD-STAB-1'), ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], pg_temp.content('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], NULL, 1), pg_temp.pdf('a'), pg_temp.sha(pg_temp.pdf('a')), '[]', 'FG-T')$$, 'open it again');
SELECT pg_temp.expect_error_like('A COA built without one of the results is refused',
  $$SELECT finalize_sample(pg_temp.smp('WD-STAB-1'), ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], pg_temp.content('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')]) || '{"result_ids": []}', pg_temp.pdf('b'), pg_temp.sha(pg_temp.pdf('b')), '[]', 'FG-T')$$, 'open it again');
SELECT pg_temp.expect_error_like('A COA built as another version is refused',
  $$SELECT finalize_sample(pg_temp.smp('WD-STAB-1'), ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], pg_temp.content('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], 2), pg_temp.pdf('c'), pg_temp.sha(pg_temp.pdf('c')), '[]', 'FG-T')$$, 'another version');
SELECT pg_temp.expect_error_like('The PDF must be the stored file with that fingerprint',
  $$SELECT finalize_sample(pg_temp.smp('WD-STAB-1'), ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], pg_temp.content('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')]), pg_temp.pdf('d'), repeat('0', 64), '[]', 'FG-T')$$, 'not the stored PDF');
SELECT pg_temp.expect_error_like('A Block in the release check stops the release',
  $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], '[{"code": "values", "title": "Values on the PDF match the record", "level": "Block", "detail": "x"}]')$$, 'Values on the PDF');
SELECT pg_temp.expect_error_like('A Warning needs a reason to release',
  $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], '[{"code": "history", "title": "Results against this client''s history", "level": "Warning", "detail": "x"}]')$$, 'give a reason');
SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')], '[{"code": "history", "title": "Results against this client''s history", "level": "Warning", "detail": "x", "ack": "Checked the raw data"}]', 'v1');
SELECT pg_temp.expect_true('Finalized and issued: version 1, final (no test left), signed by the Project Manager, its fingerprint and the reason given for the warning kept',
  (SELECT v.version_no = 1 AND v.is_final AND v.prev_sha256 IS NULL AND v.issued_by = pg_temp.uid('wd.pm') AND v.signature_id IS NOT NULL AND v.release_checks->0->>'ack' = 'Checked the raw data'
     FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = pg_temp.smp('WD-STAB-1'))
  AND (SELECT f.result_ids = test_final_result_ids(f.requested_test_id) FROM result_finalization f WHERE f.requested_test_id = pg_temp.rt('WD-STAB-1', 'WD Stability')));
SELECT pg_temp.expect_true('It leaves the queue; the order is Reported (every sample has its final COA)',
  NOT EXISTS (SELECT 1 FROM finalization_queue_view WHERE requested_test_id = pg_temp.rt('WD-STAB-1', 'WD Stability'))
  AND (SELECT o.status = 'Reported' FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('WD-STAB-1')));
SELECT pg_temp.expect_true('The client is sent the COA from the "COA Issued" template (Outbox), the PDF attached',
  EXISTS (SELECT 1 FROM email_outbox e JOIN coa_version v ON v.id = e.coa_version_id JOIN coa c ON c.id = v.coa_id
           WHERE c.sample_id = pg_temp.smp('WD-STAB-1') AND e.template = 'COA Issued' AND e.subject LIKE 'Certificate of Analysis ' || (SELECT sample_code FROM sample WHERE id = c.sample_id) || '-R1 (version 1):%' AND e.body NOT LIKE '%{{%'));   -- report ID: sample ID-R1 (migration 028)
SELECT pg_temp.expect_error_like('Nothing waits once finalized', $$SELECT pg_temp.fin('WD-STAB-1', ARRAY[pg_temp.rt('WD-STAB-1', 'WD Stability')])$$, 'nothing waits');
SELECT pg_temp.expect_error_like('An issued version is kept exactly as issued', $$UPDATE coa_version SET internal_note = 'x' WHERE coa_id = (SELECT id FROM coa WHERE sample_id = pg_temp.smp('WD-STAB-1'))$$, 'kept exactly as issued');
SELECT pg_temp.expect_error_like('... and never deleted', $$DELETE FROM coa_version WHERE coa_id = (SELECT id FROM coa WHERE sample_id = pg_temp.smp('WD-STAB-1'))$$, 'cannot be deleted');
SELECT pg_temp.expect_error_like('COAs are written only by Result Finalization',
  $$INSERT INTO coa (sample_id, coa_code, site_id) VALUES (pg_temp.smp('LOT-A2'), 'COA-X', pg_temp.cfl())$$, 'Result Finalization');
SELECT pg_temp.expect_true('Anyone can check a verification code: the lab, the COA, the version, when, the fingerprint, and nothing about the client',
  (SELECT p.coa_code LIKE 'COA-%' AND p.version_no = 1 AND p.latest_version = 1 AND p.sha256 ~ '^[0-9a-f]{64}$'
     FROM coa_public_check((SELECT lower(verify_code) FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = pg_temp.smp('WD-STAB-1'))) p)
  AND NOT EXISTS (SELECT 1 FROM coa_public_check('NOPE-NOPE-NOPE')));

SELECT set_config('lims.reason', 'Finalized for release', false);
SELECT pg_temp.expect_error_like('A new version with no new result needs a reason', $$SELECT pg_temp.fin('WD-STAB-1', '{}'::uuid[])$$, 'Say why');
SELECT pg_temp.expect_error_like('... and an issued COA to follow', $$SELECT pg_temp.fin('LOT-M2', '{}'::uuid[])$$, 'Choose the tests');
SELECT set_config('lims.reason', 'Client address corrected', false);
SELECT pg_temp.fin('WD-STAB-1', '{}'::uuid[], '[]', 'v2');
SELECT set_config('lims.reason', 'Rule test', false);
SELECT pg_temp.expect_true('A new version without new results (e.g. a corrected detail): version 2, chained to version 1, still final',
  (SELECT v2.prev_sha256 = v1.sha256 AND v2.is_final FROM coa_version v1 JOIN coa_version v2 ON v2.coa_id = v1.coa_id AND v2.version_no = 2
    JOIN coa c ON c.id = v1.coa_id WHERE c.sample_id = pg_temp.smp('WD-STAB-1') AND v1.version_no = 1));

-- 3. a sample with several tests: a version per finalization, chained by fingerprint
SELECT pg_temp.fin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Micro Screen')], '[]', 'a2v1');
SELECT pg_temp.expect_true('A test finalized while others are still in the lab: version 1, not final, listing them as in progress',
  (SELECT NOT v.is_final AND (v.content->>'pending_count')::int >= 4 FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = pg_temp.smp('LOT-A2') AND v.version_no = 1));
SELECT pg_temp.fin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Growth Promotion')], '[]', 'a2v2');
SELECT pg_temp.expect_true('The next finalization adds version 2, which carries version 1''s fingerprint (the chain); version 1''s code now says a later version exists',
  (SELECT v2.prev_sha256 = v1.sha256 AND v2.sha256 <> v1.sha256 FROM coa_version v1 JOIN coa_version v2 ON v2.coa_id = v1.coa_id AND v2.version_no = 2
    JOIN coa c ON c.id = v1.coa_id WHERE c.sample_id = pg_temp.smp('LOT-A2') AND v1.version_no = 1)
  AND (SELECT latest_version = 2 FROM coa_public_check((SELECT verify_code FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = pg_temp.smp('LOT-A2') AND v.version_no = 1))));
SELECT pg_temp.expect_error_like('An out-of-specification result is held for the OOS process (R-2), not finalized',
  $$SELECT pg_temp.fin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Metals')])$$, 'does not conform');
SELECT pg_temp.expect_true('The order is not Reported while tests are still in the lab',
  (SELECT o.status <> 'Reported' FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('LOT-A2')));

-- 4. partial reports, GMP work, holds
SELECT pg_temp.as_user('akiddle');
UPDATE client SET allow_partial_reports = false WHERE id = (SELECT o.client_id FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('LOT-M2'));
SELECT pg_temp.as_user('wd.pm');
CREATE TEMP TABLE held AS SELECT pg_temp.fin('LOT-M2', ARRAY[pg_temp.rt('LOT-M2', 'WD Micro Screen')], '[]', 'm2') AS v;
SELECT pg_temp.expect_true('A client who takes no partial reports: the test is finalized and held for the final COA (no version yet)',
  (SELECT v IS NULL FROM held)
  AND EXISTS (SELECT 1 FROM result_finalization WHERE requested_test_id = pg_temp.rt('LOT-M2', 'WD Micro Screen') AND coa_version_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM coa WHERE sample_id = pg_temp.smp('LOT-M2')));
SELECT pg_temp.as_user('akiddle');
UPDATE client SET allow_partial_reports = true WHERE id = (SELECT o.client_id FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('LOT-M2'));
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): a compliance category must be on the list, stored with the list's spelling
UPDATE sample SET compliance_category = 'cGMP' WHERE id = pg_temp.smp('LOT-M2');
SELECT pg_temp.expect_true('cGMP makes the sample GMP work', sample_is_gmp(pg_temp.smp('LOT-M2')));
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.expect_error_like('GMP work is finalized by the quality team, not a Project Manager',
  $$SELECT pg_temp.fin('LOT-M2', ARRAY[pg_temp.rt('LOT-M2', 'WD Growth Promotion')])$$, 'quality team');
SELECT pg_temp.as_user('akiddle');
UPDATE client SET account_status = 'On Hold' WHERE id = (SELECT o.client_id FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('LOT-M2'));
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.expect_error_like('A client On Hold: no report is released', $$SELECT pg_temp.fin('LOT-M2', ARRAY[pg_temp.rt('LOT-M2', 'WD Growth Promotion')])$$, 'On Hold');
SELECT pg_temp.as_user('akiddle');
UPDATE client SET account_status = 'Active' WHERE id = (SELECT o.client_id FROM lab_order o JOIN sample s ON s.lab_order_id = o.id WHERE s.id = pg_temp.smp('LOT-M2'));
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.fin('LOT-M2', ARRAY[pg_temp.rt('LOT-M2', 'WD Growth Promotion')], '[]', 'm2qa');
SELECT pg_temp.expect_true('QA finalizes the GMP sample (partial reports allowed again): version 1, signed by QA',
  (SELECT v.version_no = 1 AND v.issued_by = pg_temp.uid('wd.qa') AND v.signature_id IS NOT NULL
     FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = pg_temp.smp('LOT-M2')));

-- 5. notes, templates
SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.expect_error_like('Notes need reports.notes', $$INSERT INTO coa_note (sample_id, kind, note_text) VALUES (pg_temp.smp('LOT-A2'), 'COA', 'x')$$, 'reports.notes');
SELECT pg_temp.as_user('wd.sup');
INSERT INTO coa_note (sample_id, requested_test_id, analyte_id, kind, note_text)
  SELECT pg_temp.smp('LOT-A2'), pg_temp.rt('LOT-A2', 'WD Micro Screen'), tr.analyte_id, 'COA', 'Tested on 25 g.' FROM test_result tr WHERE tr.requested_test_id = pg_temp.rt('LOT-A2', 'WD Micro Screen') LIMIT 1;
SELECT pg_temp.expect_true('A Lab Supervisor adds a COA note on one result', EXISTS (SELECT 1 FROM coa_note WHERE sample_id = pg_temp.smp('LOT-A2') AND analyte_id IS NOT NULL AND kind = 'COA'));
-- Moved to the Java backend in migration 069 (JUnit: ReportsRulesTest.notesAndAttachments): canned notes come from the COA comments list
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): email templates are kept by outbox.templates (IntakeService.saveTemplates)
SELECT pg_temp.as_user('akiddle');
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): The system's templates are added by migrations only; a template's code cannot change
SELECT pg_temp.expect_true('Templates fill in their {{names}}', fill_template('Dear {{first_name}}, {{x}}', '{"first_name": "Sam"}') = 'Dear Sam, {{x}}');

SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
