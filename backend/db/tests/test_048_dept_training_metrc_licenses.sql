-- Verification for migration 055 (0.32.0): a training rule for every department (and for a new one); the METRC ID on
-- a sample (optional, normalised, format checked); client licenses (who may add them, retired ones kept as they were
-- and only with a reason, the expiry state), a lab order naming one of its client's licenses, the audit label.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.lc_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.lc_user(u text) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); SELECT script_signature('Rule test', false); $$;
CREATE OR REPLACE FUNCTION pg_temp.lic(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM client_license WHERE license_number = n $$;
SELECT set_config('lims.site_id', pg_temp.lc_site('CFL')::text, false);
SELECT pg_temp.lc_user('akiddle');

-- 1. a training rule per department
SELECT pg_temp.expect_true('Every active department has its own training rule, made from its lab''s rule',
  NOT EXISTS (SELECT 1 FROM department d WHERE d.status = 'Active'
               AND NOT EXISTS (SELECT 1 FROM training_rule r WHERE r.department_id = d.id AND r.site_id = d.site_id AND r.status = 'Active')));
SELECT pg_temp.expect_true('The lab rule stays, for tests with no department',
  (SELECT count(*) FROM training_rule WHERE department_id IS NULL AND status = 'Active') = (SELECT count(*) FROM lab_site));
INSERT INTO department (site_id, department_code, department_name) VALUES (pg_temp.lc_site('CFL'), 'LC48', 'Licenses test dept');
SELECT pg_temp.expect_true('A new department gets its own rule, with the lab''s count',
  (SELECT r.dept_trained_after = l.dept_trained_after FROM training_rule r JOIN department d ON d.id = r.department_id
     JOIN training_rule l ON l.site_id = d.site_id AND l.department_id IS NULL AND l.status = 'Active'
    WHERE d.department_code = 'LC48' AND r.status = 'Active'));
CREATE TEMP TABLE lc_before AS SELECT dept_trained_after AS v FROM training_rule WHERE site_id = pg_temp.lc_site('CFL') AND department_id IS NULL AND status = 'Active';
UPDATE training_rule SET dept_trained_after = 2 WHERE department_id = (SELECT id FROM department WHERE department_code = 'LC48');
SELECT pg_temp.expect_true('Changing one department''s count leaves the lab rule and other departments as they were',
  (SELECT dept_trained_after = 2 FROM training_rule WHERE department_id = (SELECT id FROM department WHERE department_code = 'LC48'))
  AND (SELECT dept_trained_after FROM training_rule WHERE site_id = pg_temp.lc_site('CFL') AND department_id IS NULL AND status = 'Active') = (SELECT v FROM lc_before)
  AND (training_rule_for(pg_temp.lc_site('CFL'), (SELECT id FROM department WHERE department_code = 'LC48'))).dept_trained_after = 2);

-- fixtures: a client, a second client, an order
INSERT INTO client (legal_name, display_name, account_status) VALUES ('License Test Cannabis LLC', 'LicTest', 'Active'), ('Other Licence Co', 'LicOther', 'Active');
INSERT INTO contact (first_name, last_name, email) VALUES ('Lic', 'Tester', 'lic.tester@example.test');
INSERT INTO client_contact (client_id, contact_id, roles)
  SELECT c.id, ct.id, '{PRIMARY,ORDERING}' FROM client c, contact ct WHERE c.display_name = 'LicTest' AND ct.email = 'lic.tester@example.test';
INSERT INTO lab_order (client_id, site_id, ordering_contact_id)
  SELECT c.id, pg_temp.lc_site('CFL'), ct.id FROM client c, contact ct WHERE c.display_name = 'LicTest' AND ct.email = 'lic.tester@example.test';

-- 2. the METRC ID
INSERT INTO sample (lab_order_id, client_sample_id, matrix, metrc_id)
  SELECT o.id, 'MET-1', (SELECT matrix_name FROM matrix WHERE status = 'Active' ORDER BY matrix_name LIMIT 1), '1A4060300001234000012345'
    FROM lab_order o JOIN client c ON c.id = o.client_id WHERE c.display_name = 'LicTest';
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): the METRC ID in capitals without spaces, a tag of 24 starting 1A, blank is none

-- 3. client licenses
INSERT INTO app_user (username, full_name) VALUES ('lc.ana', 'LC Analyst');
INSERT INTO group_member (group_id, user_id)
  SELECT g.id, (SELECT id FROM app_user WHERE username = 'lc.ana') FROM lab_group g WHERE g.site_id = pg_temp.lc_site('CFL') AND g.group_name = 'Analyst';
SELECT pg_temp.lc_user('lc.ana');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): someone without master.clients cannot add a license (LicenseService)
SELECT pg_temp.lc_user('akiddle');
INSERT INTO client_license (client_id, license_type, license_number, issuing_authority, issued_on, expires_on)
  SELECT id, 'Cannabis distributor', 'C11-0000001', 'California DCC', current_date - 300, current_date + 65 FROM client WHERE display_name = 'LicTest';
INSERT INTO client_license (client_id, license_type, license_number, issued_on, expires_on)
  SELECT id, 'Cannabis manufacturer', 'CDPH-10002', current_date - 400, current_date + 10 FROM client WHERE display_name = 'LicTest';
INSERT INTO client_license (client_id, license_type, license_number, issued_on, expires_on)
  SELECT id, 'Cannabis microbusiness', 'C12-0000003', current_date - 800, current_date - 5 FROM client WHERE display_name = 'LicTest';
INSERT INTO client_license (client_id, license_type, license_number)
  SELECT id, 'FDA registration', 'FEI-3000000' FROM client WHERE display_name = 'LicTest';
INSERT INTO client_license (client_id, license_type, license_number) SELECT id, 'Other', 'OTH-1' FROM client WHERE display_name = 'LicOther';
SELECT pg_temp.expect_true('Licenses get codes LIC- (trimming the type moved to the Java backend in migration 059)',
  (SELECT license_code ~ '^LIC-[0-9]{5}$' AND license_type = 'Cannabis distributor' FROM client_license WHERE license_number = 'C11-0000001'));
SELECT pg_temp.expect_true('Licenses are additive: the client has all four',
  (SELECT count(*) = 4 FROM client_license_view WHERE client_name = 'LicTest'));
SELECT pg_temp.expect_true('The expiry state: Current, Expiring soon (within 30 days), Expired, no expiry Current',
  (SELECT state = 'Current' AND days_left = 65 FROM client_license_view WHERE license_number = 'C11-0000001')
  AND (SELECT state = 'Expiring soon' FROM client_license_view WHERE license_number = 'CDPH-10002')
  AND (SELECT state = 'Expired' AND days_left = -5 FROM client_license_view WHERE license_number = 'C12-0000003')
  AND (SELECT state = 'Current' AND days_left IS NULL FROM client_license_view WHERE license_number = 'FEI-3000000'));
SELECT pg_temp.expect_error_like('The same license twice is refused',
  $$INSERT INTO client_license (client_id, license_type, license_number, expires_on) SELECT id, 'cannabis distributor', 'C11-0000001', current_date + 65 FROM client WHERE display_name = 'LicTest'$$, 'client_license_uq');
-- Moved to the Java backend in migration 059 (JUnit: ClientRulesTest): expiry before issue.
-- Moved to the Java backend in migration 059 (JUnit: ClientRulesTest): a license stays with its client.
-- Moved to the Java backend in migration 059 (JUnit: ClientRulesTest): retiring needs a reason.
UPDATE client_license SET status = 'Retired', retired_reason = 'Replaced by a renewal' WHERE license_number = 'C12-0000003';
SELECT pg_temp.expect_true('A retired license is kept, shown as Retired',
  (SELECT state = 'Retired' AND retired_reason = 'Replaced by a renewal' FROM client_license_view WHERE license_number = 'C12-0000003'));
-- Moved to the Java backend in migration 059 (JUnit: ClientRulesTest): a retired license is kept as it was.

-- 4. the lab order names a license
UPDATE lab_order SET client_license_id = pg_temp.lic('C11-0000001') WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest');
SELECT pg_temp.expect_true('An order names one of its client''s licenses',
  (SELECT client_license_id = pg_temp.lic('C11-0000001') FROM lab_order WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest')));
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): Another client's license is refused; a retired license cannot be chosen
UPDATE lab_order SET client_license_id = pg_temp.lic('CDPH-10002') WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest');
SELECT pg_temp.expect_true('A license expiring soon (or expired) can be chosen: it is flagged, not refused',
  (SELECT client_license_id = pg_temp.lic('CDPH-10002') FROM lab_order WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest')));
UPDATE client_license SET status = 'Retired', retired_reason = 'Entered in error' WHERE license_number = 'CDPH-10002';
UPDATE lab_order SET po_number = 'LIC-PO' WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest');
SELECT pg_temp.expect_true('An order keeps a license retired after it was chosen, and can still be changed',
  (SELECT client_license_id = pg_temp.lic('CDPH-10002') AND po_number = 'LIC-PO' FROM lab_order WHERE client_id = (SELECT id FROM client WHERE display_name = 'LicTest')));

-- 5. audit
SELECT pg_temp.expect_true('License changes are audited, with the reason, and labelled with a link to the client',
  (SELECT count(*) >= 2 FROM audit_log WHERE table_name = 'client_license' AND record_id = pg_temp.lic('C12-0000003'))
  AND (SELECT x->>'label' LIKE 'License LIC-%Cannabis microbusiness C12-0000003' AND x->>'link' = '#/clients/' || (SELECT id FROM client WHERE display_name = 'LicTest')::text
         FROM (SELECT audit_record_ref(a.table_name, a.record_id, a.new_row) AS x FROM audit_log a WHERE a.table_name = 'client_license' AND a.record_id = pg_temp.lic('C12-0000003') ORDER BY a.id DESC LIMIT 1) q));
SELECT pg_temp.expect_true('Other tables still get their labels through the router (a sample)',
  (SELECT audit_record_ref(a.table_name, a.record_id, a.new_row) ->> 'link' LIKE '#/samples/%' FROM audit_log a WHERE a.table_name = 'sample' ORDER BY a.id DESC LIMIT 1));
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
