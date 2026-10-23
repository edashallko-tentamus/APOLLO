-- Verification for migration 056 (0.33.0): database accounts. The audit trail is written by SECURITY DEFINER
-- triggers (so the app account needs no right to write it); grant_app_role refuses a superuser, an unknown account
-- and the owner itself, and is not open to everyone; database_account_problems reports a superuser connection.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.dr_definer(f text) RETURNS boolean LANGUAGE sql AS $$
  SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'lims' AND p.proname = f $$;

SELECT pg_temp.expect_true('The audit trigger runs with the owner''s rights', pg_temp.dr_definer('gxp_audit'));
SELECT pg_temp.expect_true('The job role audit writer runs with the owner''s rights', pg_temp.dr_definer('app_user_job_role_rules'));
SELECT pg_temp.expect_true('The signature audit writer runs with the owner''s rights', pg_temp.dr_definer('app_user_signature_rules'));
SELECT pg_temp.expect_true('The audit trigger has a fixed search path',
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gxp_audit' AND proconfig::text LIKE '%search_path=lims, public%'));

-- An audited change still writes its audit entry, with who and why
SELECT pg_temp.as_user('akiddle');
SELECT set_config('lims.reason', 'Rule test: audit after 056', false);
CREATE TEMP TABLE dr_before AS SELECT count(*) AS n FROM audit_log WHERE table_name = 'client';
UPDATE client SET site_address = 'Rule test 054 address' WHERE id = (SELECT id FROM client ORDER BY created_at LIMIT 1);
SELECT pg_temp.expect_true('An audited change still writes its audit entry',
  (SELECT count(*) FROM audit_log WHERE table_name = 'client') = (SELECT n FROM dr_before) + 1);
SELECT pg_temp.expect_true('The audit entry names who and why',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'client' AND reason = 'Rule test: audit after 056'
          AND changed_by = (SELECT id FROM app_user WHERE username = 'akiddle') AND changed_fields ? 'site_address'));
SELECT set_config('lims.reason', 'Rule test', false);

SELECT pg_temp.expect_error_like('grant_app_role refuses an unknown account', $$SELECT grant_app_role('no_such_account_054')$$, 'no database account');
SELECT pg_temp.expect_error_like('grant_app_role refuses the account running it', $$SELECT grant_app_role(current_user)$$, 'superuser');
SELECT pg_temp.expect_true('grant_app_role is not open to everyone',
  NOT has_function_privilege('public', 'grant_app_role(name)', 'EXECUTE'));
SELECT pg_temp.expect_true('A superuser connection is reported',
  EXISTS (SELECT 1 FROM unnest(database_account_problems()) p WHERE p LIKE '%superuser%'));
SELECT pg_temp.expect_true('The audit trail is still append only',
  (SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_log_no_change', 'audit_log_no_truncate') AND NOT tgisinternal) = 2);

-- The lab of an audit entry (audit trail pages show a lab's people their own lab's entries)
SELECT pg_temp.expect_true('An order''s audit entry belongs to its lab',
  NOT EXISTS (SELECT 1 FROM audit_log a JOIN lab_order o ON o.id = a.record_id WHERE a.table_name = 'lab_order' AND audit_row_site(a.new_row) IS DISTINCT FROM o.site_id));
SELECT pg_temp.expect_true('A sample''s audit entry belongs to its order''s lab',
  NOT EXISTS (SELECT 1 FROM audit_log a JOIN sample s ON s.id = a.record_id JOIN lab_order o ON o.id = s.lab_order_id
              WHERE a.table_name = 'sample' AND audit_row_site(a.new_row) IS DISTINCT FROM o.site_id));
SELECT pg_temp.expect_true('A client''s audit entry is shared (no lab)',
  NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'client' AND audit_row_site(a.new_row) IS NOT NULL));
SELECT pg_temp.expect_true('A requested test''s audit entry belongs to its lab',
  NOT EXISTS (SELECT 1 FROM audit_log a JOIN requested_test rt ON rt.id = a.record_id JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
              WHERE a.table_name = 'requested_test' AND audit_row_site(a.new_row) IS DISTINCT FROM o.site_id));

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('akiddle');

SELECT test, outcome AS result FROM results;
