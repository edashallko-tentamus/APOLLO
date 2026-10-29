-- Verification for migration 028 (Alex's Report Finalization notes, 2026-10-14). Runs before test_022 (which finalizes
-- the waiting results) and leaves the queue as it found it: claims are released, nothing is finalized. Handwritten
-- signatures (who records them, a COA refused without one), claiming finalization work, per-serving amounts, the serving
-- size on a logged sample, measurement uncertainty, the report ID in the COA email.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.reports_internal', '', false);
SELECT set_config('lims.group_sync', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.rf_cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.rf_smp(csid text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sample WHERE client_sample_id = csid ORDER BY created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.rf_rt(csid text, tname text) RETURNS uuid LANGUAGE sql AS $$
  SELECT rt.id FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = pg_temp.rf_smp(csid) AND t.test_name = tname AND rt.status <> 'Cancelled' $$;
CREATE OR REPLACE FUNCTION pg_temp.rf_png() RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES ('signature.png', 'image/png', 8, '', decode('89504e470d0a1a0a', 'hex')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.rf_pdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
-- finalize as the server would (the parts of the content the database checks)
CREATE OR REPLACE FUNCTION pg_temp.rf_fin(csid text, tests uuid[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid := pg_temp.rf_pdf(csid || ' rf ' || clock_timestamp()); s sample;
BEGIN
  SELECT * INTO s FROM sample WHERE id = pg_temp.rf_smp(csid);
  RETURN finalize_sample(s.id, tests, jsonb_build_object('coa_code', 'COA-' || s.sample_code, 'version_no', 1,
      'verify_code', 'ABCD-EFGH-JKLM', 'verify_url', 'http://localhost/verify.html',
      'pending_count', (SELECT count(*)::int FROM requested_test r WHERE r.sample_id = s.id AND r.status <> 'Cancelled' AND NOT r.id = ANY (tests) AND NOT test_is_finalized(r.id)),
      'result_ids', (SELECT COALESCE(jsonb_agg(x.id::text), '[]') FROM (SELECT unnest(test_final_result_ids(q.t)) AS id FROM unnest(tests) AS q(t)) x)),
    d, (SELECT encode(sha256(content), 'hex') FROM document_file WHERE id = d), '[]', next_finalization_group());
END $$;

-- set-up: three Project Managers (one will have no signature) and an analyst
SELECT pg_temp.as_user('akiddle');
INSERT INTO app_user (username, full_name) VALUES ('rf.pm', 'RF Project Manager'), ('rf.pm2', 'RF Second PM'), ('rf.nosig', 'RF No Signature'), ('rf.ana', 'RF Analyst');
INSERT INTO group_member (group_id, user_id) SELECT g.id, u.id FROM lab_group g, app_user u
 WHERE g.site_id = pg_temp.rf_cfl() AND ((g.group_name = 'Project Manager' AND u.username IN ('rf.pm', 'rf.pm2', 'rf.nosig')) OR (g.group_name = 'Analyst' AND u.username = 'rf.ana'));

-------------------------------------------------------------------------------
-- 1. HANDWRITTEN SIGNATURES
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('rf.ana');
SELECT pg_temp.expect_error_like('Only a lab administrator records someone''s signature', $$SELECT set_user_signature(pg_temp.uid('rf.pm'), pg_temp.rf_png(), 'Project Manager')$$, 'lab administrator');
SELECT pg_temp.user_only('akiddle');
SELECT pg_temp.expect_error_like('Recording a signature is signed', $$SELECT set_user_signature(pg_temp.uid('rf.pm'), pg_temp.rf_png(), 'Project Manager')$$, 'electronic signature');
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error_like('The title is printed under the signature: it is required', $$SELECT set_user_signature(pg_temp.uid('rf.pm'), pg_temp.rf_png(), ' ')$$, 'title');
SELECT pg_temp.expect_error_like('The signature is an image', $$SELECT set_user_signature(pg_temp.uid('rf.pm'), pg_temp.rf_pdf('not an image'), 'Project Manager')$$, 'PNG or JPEG');
SELECT set_user_signature(pg_temp.uid(u), pg_temp.rf_png(), 'Project Manager') FROM unnest(ARRAY['rf.pm', 'rf.pm2']) u;
SELECT pg_temp.expect_true('Recorded (signed, audited): the image, the title, who and when',
  (SELECT signature_document_id IS NOT NULL AND title = 'Project Manager' AND signature_set_by = pg_temp.uid('akiddle') AND signature_set_at IS NOT NULL FROM app_user WHERE username = 'rf.pm')
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'app_user' AND record_id = pg_temp.uid('rf.pm') AND changed_fields ? 'signature_document_id'));
SELECT pg_temp.expect_error_like('Nobody changes a signature or title directly', $$UPDATE app_user SET title = 'Director' WHERE username = 'rf.pm'$$, 'lab administrator');

SELECT pg_temp.as_user('rf.nosig');
SELECT pg_temp.expect_error_like('A COA is not issued by someone without a handwritten signature on file',
  $$SELECT pg_temp.rf_fin('WD-STAB-1', ARRAY[pg_temp.rf_rt('WD-STAB-1', 'WD Stability')])$$, 'no handwritten signature');

-------------------------------------------------------------------------------
-- 2. CLAIMING FINALIZATION WORK
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('rf.ana');
SELECT pg_temp.expect_error_like('Claiming needs Result Finalization rights', $$SELECT claim_finalization(ARRAY[pg_temp.rf_rt('WD-STAB-1', 'WD Stability')])$$, 'reports.finalize');
SELECT pg_temp.as_user('rf.pm');
SELECT claim_finalization(ARRAY[pg_temp.rf_rt('WD-STAB-1', 'WD Stability')], 'Checking a lot number with the lab');
SELECT pg_temp.expect_true('Claimed (FB-...): the test is held by its claimer, no signature needed',
  finalization_holder(pg_temp.rf_rt('WD-STAB-1', 'WD Stability')) = pg_temp.uid('rf.pm')
  AND EXISTS (SELECT 1 FROM finalization_claim WHERE claimed_by = pg_temp.uid('rf.pm') AND status = 'Active' AND claim_code LIKE 'FB-%' AND note LIKE 'Checking%'));
SELECT pg_temp.as_user('rf.nosig');
SELECT pg_temp.expect_error_like('Nobody else claims it', $$SELECT claim_finalization(ARRAY[pg_temp.rf_rt('WD-STAB-1', 'WD Stability')])$$, 'already claimed by RF Project Manager');
SELECT pg_temp.expect_error_like('Nobody else releases it (only the claimer or a lab administrator)',
  $$SELECT release_finalization_claim((SELECT id FROM finalization_claim WHERE claimed_by = pg_temp.uid('rf.pm') AND status = 'Active'))$$, 'only they, or a lab administrator');
SELECT pg_temp.as_user('rf.pm2');
SELECT pg_temp.expect_error_like('Nobody else finalizes it while it is claimed', $$SELECT pg_temp.rf_fin('WD-STAB-1', ARRAY[pg_temp.rf_rt('WD-STAB-1', 'WD Stability')])$$, 'claimed by RF Project Manager');
SELECT pg_temp.expect_error_like('Only work waiting for finalization is claimed', $$SELECT claim_finalization(ARRAY[gen_random_uuid()])$$, 'one lab');
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('A lab administrator releasing someone else''s claim says why',
  $$SELECT release_finalization_claim((SELECT id FROM finalization_claim WHERE claimed_by = pg_temp.uid('rf.pm') AND status = 'Active'))$$, 'Say why');
SELECT set_config('lims.reason', 'RF Project Manager is away today; the client is waiting', false);
SELECT release_finalization_claim((SELECT id FROM finalization_claim WHERE claimed_by = pg_temp.uid('rf.pm') AND status = 'Active'));
SELECT set_config('lims.reason', 'Rule test', false);
SELECT pg_temp.expect_true('Released by the lab administrator (with the reason): nobody holds the test now',
  finalization_holder(pg_temp.rf_rt('WD-STAB-1', 'WD Stability')) IS NULL
  AND EXISTS (SELECT 1 FROM finalization_claim WHERE claimed_by = pg_temp.uid('rf.pm') AND status = 'Released' AND closed_at IS NOT NULL)
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'finalization_claim_test' AND reason LIKE 'RF Project Manager is away%'));
SELECT pg_temp.expect_error_like('A claim is changed only through claim and release', $$UPDATE finalization_claim SET status = 'Active'$$, 'Report Finalization');

-------------------------------------------------------------------------------
-- 3. SERVING SIZE AND THE AMOUNT PER SERVING
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Per serving: 10 mg/kg in a 2.5 g serving = 0.025 mg; 5 ppm in 1 kg = 5 mg; 2 % in 3 g = 0.06 g; 4 µg/g in 500 mg = 2 µg',
  (SELECT value = 0.025 AND unit = 'mg per serving' FROM per_serving(10, 'mg/kg', 2.5, 'g'))
  AND (SELECT value = 5 AND unit = 'mg per serving' FROM per_serving(5, 'ppm', 1, 'kg'))
  AND (SELECT value = 0.06 AND unit = 'g per serving' FROM per_serving(2, '%', 3, 'g'))
  AND (SELECT round(value, 6) = 2 AND unit = 'µg per serving' FROM per_serving(4, 'µg/g', 500, 'mg')));
SELECT pg_temp.expect_true('Units that do not combine give no per-serving amount (a mass result and a serving counted in pieces)',
  (SELECT value IS NULL FROM per_serving(10, 'mg/kg', 2, 'each')) AND (SELECT value IS NULL FROM per_serving(10, 'CFU', 2, 'g')));
SELECT set_config('lims.reason', '', false);
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): Changing a logged sample's serving size needs a reason
SELECT set_config('lims.reason', 'Rule test', false);
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): A serving size has a unit; the serving unit is from the Units list

-------------------------------------------------------------------------------
-- 4. MEASUREMENT UNCERTAINTY (on a draft version)
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.rf_cfl(), 'RF Uncertainty Test', (SELECT d.id FROM department d WHERE d.site_id = pg_temp.rf_cfl() AND d.department_code = 'WDC'), (SELECT id FROM method WHERE site_id = pg_temp.rf_cfl() LIMIT 1));
SELECT pg_temp.expect_error_like('"Report ±" needs the uncertainty first',
  $$INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, report_uncertainty)
    SELECT v.id, (SELECT id FROM analyte WHERE analyte_name = 'WD Lead'), 1, 'Numeric', 'mg/kg', true FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'RF Uncertainty Test'$$, 'uncertainty before');
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, uncertainty, report_uncertainty)
SELECT v.id, (SELECT id FROM analyte WHERE analyte_name = 'WD Lead'), 1, 'Numeric', 'mg/kg', 0.04, true FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'RF Uncertainty Test';
SELECT pg_temp.expect_true('Stored per analyte: ± 0.04 in the result''s unit (the default kind), reported',
  (SELECT a.uncertainty = 0.04 AND a.uncertainty_kind = 'Unit' AND a.report_uncertainty FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id JOIN test t ON t.id = v.test_id
    WHERE t.test_name = 'RF Uncertainty Test'));
SELECT pg_temp.expect_error_like('The kind is % or Unit', $$UPDATE test_version_analyte a SET uncertainty_kind = 'ppm' FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = a.test_version_id AND t.test_name = 'RF Uncertainty Test'$$, 'uncertainty_kind');

-------------------------------------------------------------------------------
-- 5. THE REPORT ID IN THE COA EMAIL
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('The COA email names the report: the sample ID followed by R and the version (sample ID-R1), with the version',
  (SELECT subject LIKE '%{{sample_code}}-R{{version_no}} (version {{version_no}})%' AND body LIKE '%{{sample_code}}-R{{version_no}}%' FROM email_template WHERE template_code = 'COA Issued'));

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
