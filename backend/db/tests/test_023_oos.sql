-- Verification for migration 027 (R-2): OOS investigations and retests. Uses the out-of-specification WD Metals
-- results left by the earlier rule tests: LOT-A2 (Check and Acknowledge, CFL's default) and LOT-M2 (cGMP since
-- test_022, so Full Phase I). Who opens, signs and concludes; the checklist; cancelling; what holds a release; the
-- lab investigation retest (the invalid result kept, Superseded, the retest not billed); the email on release; the
-- client's answer through the link; the client retest and the determination that bills it. The automatic checks and
-- the report PDF are made by the server (server/oos.js) and exercised by tests/e2e_oos.js.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.testing_internal', '', false);
SELECT set_config('lims.oos_internal', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.smp(csid text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sample WHERE client_sample_id = csid ORDER BY created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rt(csid text, tname text) RETURNS uuid LANGUAGE sql AS $$
  SELECT rt.id FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = pg_temp.smp(csid) AND t.test_name = tname AND rt.status <> 'Cancelled' AND rt.retest_of_id IS NULL $$;
CREATE OR REPLACE FUNCTION pg_temp.pb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = 'WD Lead' $$;
CREATE OR REPLACE FUNCTION pg_temp.oos(csid text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM oos_investigation WHERE sample_id = pg_temp.smp(csid) AND status <> 'Cancelled' ORDER BY opened_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.opdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.osha(d uuid) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(content), 'hex') FROM document_file WHERE id = d $$;
-- answers to every active item of a section ("Yes")
CREATE OR REPLACE FUNCTION pg_temp.answers(proc text, sec text, ans text DEFAULT 'Yes') RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_object_agg(id::text, jsonb_build_object('answer', ans)), '{}') FROM oos_checklist_item WHERE procedure::text = proc AND section = sec AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.conclude(csid text, concl text, cause text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE d uuid := pg_temp.opdf(csid || ' report ' || clock_timestamp());
BEGIN PERFORM conclude_oos(pg_temp.oos(csid), concl, cause, 'Rule test conclusion', pg_temp.answers('Check and Acknowledge', 'Reviewer'), d, pg_temp.osha(d)); END $$;
-- the COA content the server would build (the parts the database checks), retests replacing their originals
CREATE OR REPLACE FUNCTION pg_temp.ocontent(csid text, tests uuid[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_object('coa_code', 'COA-' || s.sample_code,
    'version_no', (SELECT COALESCE(max(v.version_no), 0) + 1 FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = s.id),
    'verify_code', upper(substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4) || '-' || substr(md5(random()::text), 1, 4)),
    'verify_url', 'http://lab.example/verify.html?c=X',
    'pending_count', (SELECT count(*)::int FROM requested_test r WHERE r.sample_id = s.id AND r.status <> 'Cancelled' AND NOT r.id = ANY (tests) AND NOT test_is_replaced(r.id) AND NOT test_is_finalized(r.id)),
    'result_ids', (SELECT COALESCE(jsonb_agg(x.id::text), '[]') FROM (SELECT unnest(test_final_result_ids(q.t)) AS id FROM unnest(tests) AS q(t)) x))
  FROM sample s WHERE s.client_sample_id = csid $$;
CREATE OR REPLACE FUNCTION pg_temp.ofin(csid text, tests uuid[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid := pg_temp.opdf(csid || ' coa ' || clock_timestamp());
BEGIN RETURN finalize_sample(pg_temp.smp(csid), tests, pg_temp.ocontent(csid, tests), d, pg_temp.osha(d), '[]', next_finalization_group()); END $$;

-- The OOS steps as Java's OOS service writes them (their rules moved to the Java backend in migration 069: OosRulesTest)
CREATE OR REPLACE FUNCTION pg_temp.open_oos(p_rt uuid, p_analyte uuid, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE tr test_result; s sample; o lab_order; v_proc oos_procedure; v_id uuid;
BEGIN
  SELECT * INTO tr FROM test_result WHERE requested_test_id = p_rt AND analyte_id = p_analyte AND result_key IS NULL AND status = 'Active' AND stage = 'Final';
  SELECT s2.* INTO s FROM sample s2 JOIN requested_test r ON r.sample_id = s2.id WHERE r.id = p_rt;
  SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
  PERFORM set_config('lims.oos_internal', '1', false);
  v_proc := CASE WHEN sample_is_gmp(s.id) THEN 'Full Phase I (21 CFR 211)' ELSE (SELECT default_oos_procedure FROM lab_site WHERE id = o.site_id) END;
  INSERT INTO oos_investigation (site_id, sample_id, requested_test_id, analyte_id, batch_id, test_result_id, procedure, is_gmp, reported, value_num, unit, spec_text,
                                 opened_reason, opened_by, open_signature_id, due_date)
  VALUES (o.site_id, s.id, p_rt, p_analyte, tr.batch_id, tr.id, v_proc, sample_is_gmp(s.id), tr.reported, tr.value_num, tr.unit,
          COALESCE(tr.spec_text, concat_ws(' and ', '≥ ' || tr.spec_min::text, '≤ ' || tr.spec_max::text) || COALESCE(' ' || tr.spec_unit, '')), p_reason,
          current_app_user(), NULLIF(current_setting('lims.signature_id', true), '')::uuid,
          site_today(o.site_id) + COALESCE((SELECT close_within_days FROM oos_procedure_setting WHERE procedure = v_proc), 30))
  RETURNING id INTO v_id;
  PERFORM set_config('lims.oos_internal', '', false);
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.retest(p_id uuid, p_kind text, p_reps integer, p_response uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o oos_investigation; v_new uuid; ord lab_order;
BEGIN
  SELECT * INTO o FROM oos_investigation WHERE id = p_id;
  PERFORM set_config('lims.oos_internal', '1', false);
  IF p_kind = 'Lab investigation' THEN
    PERFORM set_config('lims.testing_internal', '1', false);
    UPDATE test_result SET status = 'Superseded', invalidated_oos_id = o.id WHERE requested_test_id = o.requested_test_id AND status = 'Active';
    PERFORM set_config('lims.testing_internal', '', false);
  END IF;
  INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, source, special_instructions, retest_of_id, oos_investigation_id, billing_status, retest_replicates)
  SELECT sample_id, test_id, test_version_id, quoted_line_id, CASE WHEN p_kind = 'Client' THEN 'Client OOS Retest' ELSE 'Lab Investigation Retest' END::test_source,
         format('Re-prep from the retained sample (%s), %s', o.oos_code, CASE p_reps WHEN 1 THEN 'single' WHEN 2 THEN 'in duplicate' ELSE 'in triplicate' END),
         id, o.id, CASE WHEN p_kind = 'Client' THEN 'Pending QA determination' ELSE 'Non-billable' END, p_reps
    FROM requested_test WHERE id = o.requested_test_id RETURNING id INTO v_new;
  INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
  SELECT v_new, sp.analyte_id, sp.min_value, sp.max_value, sp.text_value, sp.unit, sp.source FROM specification sp WHERE sp.requested_test_id = o.requested_test_id AND sp.status = 'Active';
  IF p_response IS NOT NULL THEN
    UPDATE oos_client_response SET retest_requested_test_id = v_new, handled_by = current_app_user(), handled_at = clock_timestamp(),
           handled_note = COALESCE(handled_note, 'Retest ordered') WHERE id = p_response AND oos_id = o.id;
  END IF;
  IF p_kind = 'Client' THEN
    UPDATE oos_investigation SET phase2_decision = 'Retest ordered', phase2_by = current_app_user(), phase2_at = clock_timestamp(),
           phase2_note = COALESCE(phase2_note, 'Client re-test ordered') WHERE id = o.id AND phase2_decision IS NULL;
  END IF;
  PERFORM set_config('lims.oos_internal', '', false);
  SELECT lo.* INTO ord FROM lab_order lo JOIN sample s ON s.lab_order_id = lo.id WHERE s.id = o.sample_id;
  IF ord.status IN ('Reported','Approved') THEN
    PERFORM set_config('lims.group_sync', '1', false);
    UPDATE lab_order SET status = 'Received' WHERE id = ord.id;
    PERFORM set_config('lims.group_sync', '', false);
    PERFORM refresh_order_status(ord.id);
  END IF;
  RETURN v_new;
END $$;

-- 1. who may do what
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_true('Analysts and Lab Supervisors open OOS investigations; QA concludes Phase I; Intake does neither',
  user_has_permission_at(pg_temp.uid('wd.ana2'), 'oos.open', (SELECT id FROM lab_site WHERE site_code = 'CFL'))
  AND user_has_permission_at(pg_temp.uid('wd.sup'), 'oos.open', (SELECT id FROM lab_site WHERE site_code = 'CFL'))
  AND user_has_permission_at(pg_temp.uid('wd.qa'), 'oos.approve', (SELECT id FROM lab_site WHERE site_code = 'CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('wd.ana2'), 'oos.approve', (SELECT id FROM lab_site WHERE site_code = 'CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('wd.int'), 'oos.open', (SELECT id FROM lab_site WHERE site_code = 'CFL')));
SELECT pg_temp.expect_true('The OOS checklists are configuration (QA): Phase I has analyst and supervisor items, Check and Acknowledge reviewer items',
  (SELECT count(*) FROM oos_checklist_item WHERE procedure = 'Full Phase I (21 CFR 211)' AND section = 'Analyst') >= 5
  AND (SELECT count(*) FROM oos_checklist_item WHERE procedure = 'Check and Acknowledge' AND section = 'Reviewer') >= 3);
SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.expect_error_like('QA keeps the checklists (oos.configure)', $$UPDATE oos_checklist_item SET item_text = 'x' WHERE section = 'Reviewer'$$, 'oos.configure');
SELECT pg_temp.as_user('wd.int');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.opening): Intake cannot open an OOS investigation (the database permission function stays)
SELECT pg_temp.user_only('wd.sup');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.opening): opening is signed (assert_signed stays in the database)
SELECT pg_temp.as_user('wd.sup');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.opening): nothing to investigate in a result that conforms
SELECT pg_temp.expect_error_like('No investigation can be written directly', $$INSERT INTO oos_investigation (site_id, sample_id, requested_test_id, analyte_id, procedure, is_gmp, opened_by)
  SELECT o.site_id, s.id, pg_temp.rt('LOT-A2', 'WD Metals'), pg_temp.pb(), 'Check and Acknowledge', false, pg_temp.uid('wd.sup') FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = pg_temp.smp('LOT-A2')$$, 'OOS investigation page');

-- 2. Check and Acknowledge (LOT-A2): open, cancel, open again, conclude "Assignable cause found", the lab retest
SELECT pg_temp.open_oos(pg_temp.rt('LOT-A2', 'WD Metals'), pg_temp.pb(), 'Lead above the client limit');
SELECT pg_temp.expect_true('Opened (signed): Check and Acknowledge (CFL''s default for non-GMP work), on the approved result, due in 10 days',
  (SELECT procedure = 'Check and Acknowledge' AND NOT is_gmp AND test_result_id IS NOT NULL AND status = 'Open' AND open_signature_id IS NOT NULL
     AND due_date = site_today(site_id) + 10 AND reported IS NOT NULL FROM oos_investigation WHERE id = pg_temp.oos('LOT-A2')));
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.opening): one open investigation per result
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.expect_error_like('An open investigation holds the result from release', $$SELECT pg_temp.ofin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Metals')])$$, 'is open');
SELECT pg_temp.as_user('wd.ana2');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.cancelling): only QA or whoever opened it cancels an investigation
SELECT pg_temp.as_user('wd.sup');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.cancelling): cancelling needs a reason
SELECT set_config('lims.oos_internal', '1', false);
UPDATE oos_investigation SET status = 'Cancelled', cancelled_reason = 'Opened before the client confirmed their limit; reopened', cancelled_by = current_app_user(),
       cancelled_at = clock_timestamp() WHERE id = pg_temp.oos('LOT-A2');
SELECT set_config('lims.oos_internal', '', false);
SELECT pg_temp.expect_true('Cancelled (kept, with its reason)', EXISTS (SELECT 1 FROM oos_investigation WHERE sample_id = pg_temp.smp('LOT-A2') AND status = 'Cancelled' AND cancelled_reason LIKE 'Opened before%'));
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.expect_error_like('An out-of-specification result needs a concluded investigation before release', $$SELECT pg_temp.ofin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Metals')])$$, 'open the OOS investigation');
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.open_oos(pg_temp.rt('LOT-A2', 'WD Metals'), pg_temp.pb(), 'Lead above the client limit');
SELECT set_config('lims.oos_internal', '1', false);
UPDATE oos_investigation SET auto_checks = '[{"code": "calc", "title": "Result worked out again", "level": "Pass", "detail": "x"}]', auto_checked_at = clock_timestamp()
 WHERE id = pg_temp.oos('LOT-A2');
SELECT set_config('lims.oos_internal', '', false);
SELECT pg_temp.expect_true('The automatic checks are kept on the investigation', (SELECT jsonb_array_length(auto_checks) = 1 AND auto_checked_at IS NOT NULL FROM oos_investigation WHERE id = pg_temp.oos('LOT-A2')));
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.sectionsAndChecks): Check and Acknowledge has no analyst section
SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.expect_error_like('The reviewer has QC Review rights', $$SELECT pg_temp.conclude('LOT-A2', 'OOS confirmed', NULL)$$, 'testing.review');
-- independent of the bench work: whoever performed a step of the batch (given review rights for the check) may not conclude
-- (fixture only: the performer is given QC Review rights for a moment, bypassing the membership rules, then removed)
-- (bench steps only: the QC Review step's performer did no bench work and may conclude; picking them made this flaky.
--  Claude Code, 2026-10-14)
CREATE TEMP TABLE oos_perf AS SELECT r.performed_by AS uid FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id AND ws.step_type <> 'QC Review'
  JOIN oos_investigation x ON x.batch_id = r.batch_id WHERE x.id = pg_temp.oos('LOT-A2') AND r.performed_by IS NOT NULL ORDER BY r.completed_at LIMIT 1;
SET session_replication_role = replica;
INSERT INTO group_member (group_id, user_id) SELECT g.id, p.uid FROM lab_group g JOIN lab_site si ON si.id = g.site_id, oos_perf p WHERE si.site_code = 'CFL' AND g.group_name = 'Lab Supervisor'
   AND NOT EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = g.id AND m.user_id = p.uid AND m.status = 'Active');
SET session_replication_role = origin;
SELECT set_config('lims.user_id', (SELECT uid::text FROM oos_perf), false);
SELECT script_signature('Rule test', false);
SELECT pg_temp.expect_error_like('Whoever did bench work in the batch does not conclude it', $$SELECT pg_temp.conclude('LOT-A2', 'OOS confirmed', NULL)$$, 'performed or witnessed');
SET session_replication_role = replica;
DELETE FROM group_member m USING lab_group g, lab_site si, oos_perf p WHERE m.group_id = g.id AND si.id = g.site_id AND si.site_code = 'CFL' AND g.group_name = 'Lab Supervisor' AND m.user_id = p.uid
   AND m.created_at > now() - interval '1 minute' AND m.user_id NOT IN (SELECT id FROM app_user WHERE username = 'wd.sup');
SET session_replication_role = origin;
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.expect_error_like('Every checklist item is answered', $$SELECT conclude_oos(pg_temp.oos('LOT-A2'), 'OOS confirmed', NULL, 'x', '{}', pg_temp.opdf('a'), pg_temp.osha(pg_temp.opdf('a')))$$, 'Answer every item');
SELECT pg_temp.expect_error_like('A "No" is explained', $$SELECT conclude_oos(pg_temp.oos('LOT-A2'), 'OOS confirmed', NULL, 'x', pg_temp.answers('Check and Acknowledge', 'Reviewer', 'No'), pg_temp.opdf('b'), pg_temp.osha(pg_temp.opdf('b')))$$, 'Explain the "No"');
SELECT pg_temp.expect_error_like('An assignable cause is described', $$SELECT pg_temp.conclude('LOT-A2', 'Assignable cause found', '')$$, 'Describe the assignable cause');
SELECT pg_temp.expect_error_like('The report must be the stored PDF', $$SELECT conclude_oos(pg_temp.oos('LOT-A2'), 'OOS confirmed', NULL, 'x', pg_temp.answers('Check and Acknowledge', 'Reviewer'), pg_temp.opdf('c'), repeat('0', 64))$$, 'stored PDF');
SELECT pg_temp.conclude('LOT-A2', 'Assignable cause found', 'Wrong dilution factor entered for the digest (10 instead of 100)');
SELECT pg_temp.expect_true('Concluded (signed): Assignable cause found, with its report', (SELECT status = 'Closed' AND conclusion = 'Assignable cause found' AND report_document_id IS NOT NULL
  AND conclusion_signature_id IS NOT NULL AND concluded_by = pg_temp.uid('wd.sup') FROM oos_investigation WHERE id = pg_temp.oos('LOT-A2')));
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.sectionsAndChecks): a closed investigation's checks stay as they were
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.expect_error_like('An invalid result is not released: the lab retest replaces it', $$SELECT pg_temp.ofin('LOT-A2', ARRAY[pg_temp.rt('LOT-A2', 'WD Metals')])$$, 'order the lab investigation retest');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.retests): a client retest follows a confirmed OOS only
SELECT pg_temp.retest(pg_temp.oos('LOT-A2'), 'Lab investigation', 2, NULL);
SELECT pg_temp.expect_true('The lab investigation retest is ordered (signed): a re-prep in duplicate, not billed, linked to the test and the investigation, in the backlog with the same specification',
  (SELECT r.source = 'Lab Investigation Retest' AND r.billing_status = 'Non-billable' AND r.price = 0 AND r.retest_replicates = 2 AND r.status = 'In Pool'
     AND r.oos_investigation_id = pg_temp.oos('LOT-A2') AND r.special_instructions LIKE '%in duplicate%'
     AND (SELECT count(*) FROM specification sp WHERE sp.requested_test_id = r.id AND sp.status = 'Active') >= 1
   FROM requested_test r WHERE r.retest_of_id = pg_temp.rt('LOT-A2', 'WD Metals')));
SELECT pg_temp.expect_true('The invalid results are kept, Superseded, with the investigation; the original test leaves the queue and is replaced',
  NOT EXISTS (SELECT 1 FROM test_result WHERE requested_test_id = pg_temp.rt('LOT-A2', 'WD Metals') AND status = 'Active')
  AND EXISTS (SELECT 1 FROM test_result WHERE requested_test_id = pg_temp.rt('LOT-A2', 'WD Metals') AND status = 'Superseded' AND invalidated_oos_id = pg_temp.oos('LOT-A2'))
  AND NOT EXISTS (SELECT 1 FROM finalization_queue_view WHERE requested_test_id = pg_temp.rt('LOT-A2', 'WD Metals'))
  AND test_is_replaced(pg_temp.rt('LOT-A2', 'WD Metals')));
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.retests): one retest per test
SELECT pg_temp.expect_error_like('A retest''s billing follows QA''s determination', $$UPDATE requested_test SET billing_status = 'Billable' WHERE retest_of_id = pg_temp.rt('LOT-A2', 'WD Metals')$$, 'determination');

-- 3. Full Phase I (LOT-M2, cGMP): analyst, supervisor, QA; release; the client's answer; the client retest
SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.open_oos(pg_temp.rt('LOT-M2', 'WD Metals'), pg_temp.pb(), 'Lead above the client limit');
SELECT pg_temp.expect_true('GMP work follows Full Phase I (30 days)', (SELECT procedure = 'Full Phase I (21 CFR 211)' AND is_gmp AND due_date = site_today(site_id) + 30 FROM oos_investigation WHERE id = pg_temp.oos('LOT-M2')));
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.expect_error_like('QA concludes only after the analyst and supervisor sections', $$SELECT conclude_oos(pg_temp.oos('LOT-M2'), 'OOS confirmed', NULL, 'x', '{}', pg_temp.opdf('d'), pg_temp.osha(pg_temp.opdf('d')))$$, 'analyst and supervisor sections');
SELECT pg_temp.as_user('wd.sup');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.sectionsAndChecks): the supervisor section follows the analyst's
SELECT pg_temp.as_user('wd.ana');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.sectionsAndChecks): the analyst answers every item
SELECT set_config('lims.oos_internal', '1', false);
UPDATE oos_investigation SET analyst_answers = pg_temp.answers('Full Phase I (21 CFR 211)', 'Analyst'), analyst_comment = 'No error found at the bench',
       hypothesis = 'Re-analysis of the same digest planned: not needed', analyst_by = current_app_user(), analyst_at = clock_timestamp(),
       analyst_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, status = 'Analyst signed' WHERE id = pg_temp.oos('LOT-M2');
SELECT set_config('lims.oos_internal', '', false);
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.sectionsAndChecks): the analyst does not sign the supervisor section
SELECT pg_temp.as_user('wd.sup');
SELECT set_config('lims.oos_internal', '1', false);
UPDATE oos_investigation SET supervisor_answers = pg_temp.answers('Full Phase I (21 CFR 211)', 'Supervisor'), supervisor_comment = 'Method in control',
       supervisor_by = current_app_user(), supervisor_at = clock_timestamp(), supervisor_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid,
       status = 'Supervisor signed' WHERE id = pg_temp.oos('LOT-M2');
SELECT set_config('lims.oos_internal', '', false);
SELECT pg_temp.as_user('wd.ana2');
SELECT pg_temp.expect_error_like('Only QA concludes Phase I (oos.approve)', $$SELECT conclude_oos(pg_temp.oos('LOT-M2'), 'OOS confirmed', NULL, 'x', '{}', pg_temp.opdf('e'), pg_temp.osha(pg_temp.opdf('e')))$$, 'oos.approve');
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('QA concludes independently of the sections'' signers', $$SELECT conclude_oos(pg_temp.oos('LOT-M2'), 'OOS confirmed', NULL, 'x', '{}', pg_temp.opdf('f'), pg_temp.osha(pg_temp.opdf('f')))$$, 'independently');
SELECT pg_temp.as_user('wd.qa');
SELECT conclude_oos(pg_temp.oos('LOT-M2'), 'OOS confirmed', NULL, 'No laboratory error found; the result stands.', '{}', d, pg_temp.osha(d)) FROM (SELECT pg_temp.opdf('m2 report') AS d) x;
SELECT pg_temp.expect_true('Phase I concluded by QA: OOS confirmed, three signatures by three people',
  (SELECT status = 'Closed' AND conclusion = 'OOS confirmed' AND analyst_by = pg_temp.uid('wd.ana') AND supervisor_by = pg_temp.uid('wd.sup') AND concluded_by = pg_temp.uid('wd.qa')
     AND analyst_signature_id IS NOT NULL AND supervisor_signature_id IS NOT NULL AND conclusion_signature_id IS NOT NULL FROM oos_investigation WHERE id = pg_temp.oos('LOT-M2')));
SELECT pg_temp.as_user('wd.pm');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.retests): a client retest waits until the client has been told (on release)
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.ofin('LOT-M2', ARRAY[pg_temp.rt('LOT-M2', 'WD Metals')]);
SELECT pg_temp.expect_true('The confirmed OOS is released on the COA, and the client is emailed (on release) with the Phase II re-testing options, a link for their answer and the signed Phase I report',
  (SELECT x.client_notified_at IS NOT NULL AND x.client_token IS NOT NULL FROM oos_investigation x WHERE x.id = pg_temp.oos('LOT-M2'))
  AND EXISTS (SELECT 1 FROM email_outbox e WHERE e.template = 'OOS Result' AND e.body LIKE '%Phase II re-testing%' AND e.body LIKE '%oos-response.html?t=' || (SELECT client_token FROM oos_investigation WHERE id = pg_temp.oos('LOT-M2')) || '&a=duplicate%'
              AND e.body NOT LIKE '%{{%' AND e.document_id = (SELECT report_document_id FROM oos_investigation WHERE id = pg_temp.oos('LOT-M2'))));
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('A wrong link is refused', $$SELECT record_oos_client_response('nope', 'Retest', NULL, NULL)$$, 'not valid');
SELECT pg_temp.user_only('system');
SELECT record_oos_client_response((SELECT client_token FROM oos_investigation WHERE id = pg_temp.oos('LOT-M2')), 'Retest in duplicate', 'Please retest in duplicate, standard turnaround', 'Kim Diaz');
SELECT pg_temp.expect_true('The client''s answer through the link is recorded on the investigation, waiting for the lab',
  EXISTS (SELECT 1 FROM oos_client_response WHERE oos_id = pg_temp.oos('LOT-M2') AND choice = 'Retest in duplicate' AND contact_name = 'Kim Diaz' AND handled_at IS NULL));
SELECT pg_temp.as_user('wd.pm');
SELECT pg_temp.retest(pg_temp.oos('LOT-M2'), 'Client', 2, (SELECT id FROM oos_client_response WHERE oos_id = pg_temp.oos('LOT-M2') LIMIT 1));
SELECT pg_temp.expect_true('The client retest is ordered from the answer: billed by QA''s later determination, the answer handled and linked',
  (SELECT r.source = 'Client OOS Retest' AND r.billing_status = 'Pending QA determination' AND r.price > 0 AND r.retest_replicates = 2
     FROM requested_test r WHERE r.retest_of_id = pg_temp.rt('LOT-M2', 'WD Metals'))
  AND (SELECT handled_at IS NOT NULL AND retest_requested_test_id IS NOT NULL FROM oos_client_response WHERE oos_id = pg_temp.oos('LOT-M2') LIMIT 1));
SELECT pg_temp.expect_true('The original (released) result stays finalized; the retest replaces it on the COA and is still in the lab',
  test_is_finalized(pg_temp.rt('LOT-M2', 'WD Metals')) AND test_is_replaced(pg_temp.rt('LOT-M2', 'WD Metals'))
  AND (pg_temp.ocontent('LOT-M2', '{}')->>'pending_count')::int >= 1);
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.determinationPhase2AndAnswers): an answer is handled once
SELECT pg_temp.as_user('wd.qa');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.determinationPhase2AndAnswers): QA determines the cause only after the retest's result is approved
SELECT pg_temp.as_user('wd.sup');
-- Moved to the Java backend in migration 069 (JUnit: OosRulesTest.determinationPhase2AndAnswers): the determination is QA's (oos.approve; the database permission function stays)
SELECT pg_temp.expect_true('The OOS email is a template in the Outbox (Phase II re-testing wording)',
  (SELECT body LIKE '%Phase II re-testing%' AND body LIKE '%{{link_retest_duplicate}}%' FROM email_template WHERE template_code = 'OOS Result'));

SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
