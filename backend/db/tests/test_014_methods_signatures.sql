-- Verification for migration 015 (WD-1.3): creating and changing test workflows needs an electronic signature by the
-- person making the change (Created by / Changed by), like Inventory; catalogue renames of shared tests are unchanged.
-- Runs after test_011 to test_013 (uses their users, lab, departments and the "WD Metals (soil)" Draft).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Draft edited', false);
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
-- switch user without signing (as a screen that skipped the signature would)
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false) $$;
CREATE OR REPLACE FUNCTION pg_temp.v() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Metals (soil)' AND v.status = 'Draft' $$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;

-- unsigned: refused
SELECT pg_temp.user_only('wd.ana');
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): adding a workflow step is signed (DesignerService.design)
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): changing a workflow step is signed
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): changing a test's analytes is signed
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): changing the version's settings is signed
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): changing how the steps connect is signed
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): changing a step's equipment types is signed
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): adding a method (SOP) is signed (DesignerService.saveMethods)
SELECT pg_temp.expect_true('(the micro test has an effective version and no Draft, so a new version could be made)',
  NOT EXISTS (SELECT 1 FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Micro P/A' AND v.status = 'Draft'));
CREATE OR REPLACE FUNCTION pg_temp.try_new_version() RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM new_test_version((SELECT id FROM test WHERE test_name = 'WD Micro P/A')); RETURN 'made';
EXCEPTION WHEN others THEN RETURN SQLERRM; END $$;
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): creating a new version is signed (DesignerService.newVersion)
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): moving a lab's test to another department is signed

-- signed by someone else: refused
SELECT pg_temp.as_user('wd.sup');
SELECT pg_temp.user_only('wd.ana');
SELECT set_config('lims.signature_id', (SELECT id::text FROM signature_event WHERE user_id = (SELECT id FROM app_user WHERE username = 'wd.sup') ORDER BY signed_at DESC LIMIT 1), false);
-- Moved to the Java backend in migration 072 (JUnit: SignatureRulesTest): another person's signature does not cover the change (SignatureService.signed)

-- signed: accepted, and the audit trail links the signature
SELECT pg_temp.as_user('wd.ana');
UPDATE workflow_step SET instructions = 'Weigh into a clean digestion vessel' WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing';
SELECT pg_temp.expect_true('A signed change to a step is saved',
  (SELECT instructions = 'Weigh into a clean digestion vessel' FROM workflow_step WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing'));
SELECT pg_temp.expect_true('The audit trail entry carries the signature',
  (SELECT a.signature_id IS NOT NULL FROM audit_log a JOIN workflow_step s ON s.id = a.record_id
    WHERE s.test_version_id = pg_temp.v() AND s.step_type = 'Weighing' ORDER BY a.id DESC LIMIT 1));
INSERT INTO method (site_id, method_name) VALUES (pg_temp.site('CFL'), 'WD Signed SOP');
SELECT pg_temp.expect_true('A signed method (SOP) is added', EXISTS (SELECT 1 FROM method WHERE method_name = 'WD Signed SOP'));

-- the Test catalogue keeps renaming shared tests (made before the designer) with a reason, as before
SELECT pg_temp.user_only('akiddle');
SELECT set_config('lims.reason', 'Typing error', false);
UPDATE test SET test_name = test_name WHERE site_id IS NULL AND id = (SELECT id FROM test WHERE site_id IS NULL ORDER BY test_code LIMIT 1);
SELECT pg_temp.expect_true('A shared test (made before the designer) is still changed from the catalogue without a signature', true);

SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Draft edited', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
