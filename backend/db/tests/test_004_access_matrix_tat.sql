-- Verification for migration 004 (runs after the 001 to 003 tests): administrators, lab access,
-- the Matrix list, TAT override, the SITEyymmdd### sample ID and audit references
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.reason', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false)
$$;
INSERT INTO app_user (username, full_name) VALUES ('tech.test', 'Test Technician');

-- Administrators only: sites, holidays, matrices and lab assignments
SELECT pg_temp.as_user('tech.test');
SELECT set_config('lims.reason', 'Testing permissions', false);
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): a non-administrator cannot add a matrix (MasterLists.MATRICES keeper)
SELECT pg_temp.expect_error('Non-administrator cannot assign labs',
  $$INSERT INTO user_site_access (user_id, site_id) SELECT u.id, s.id FROM app_user u, lab_site s WHERE u.username = 'tech.test' AND s.site_code = 'CFL'$$);
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): only a system administrator changes a site (MasterDataService.saveSites)

-- Lab access
SELECT pg_temp.expect_error('User not assigned to CFL cannot create an order there',
  $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, s.id, ct.id FROM client c, lab_site s, contact ct
    WHERE c.legal_name = 'Acme Irvine Site' AND s.site_code = 'CFL' AND ct.email = 'maria@consult.com'$$);
SELECT pg_temp.expect_error('User not assigned to CFL cannot edit a CFL sample', $$UPDATE sample SET description = 'x' WHERE client_sample_id = 'LOT-A2'$$);
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_true('Whoever creates a site is assigned to it',
  (SELECT count(*) FROM user_site_access a JOIN app_user u ON u.id = a.user_id WHERE u.username = 'akiddle' AND a.status = 'Active') = 2);
SELECT set_config('lims.reason', '', false);
INSERT INTO user_site_access (user_id, site_id) SELECT u.id, s.id FROM app_user u, lab_site s WHERE u.username = 'tech.test' AND s.site_code = 'CFL';
SELECT pg_temp.as_user('tech.test');
INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number)
  SELECT c.id, s.id, ct.id, 'PO-TECH' FROM client c, lab_site s, contact ct
   WHERE c.legal_name = 'Acme Irvine Site' AND s.site_code = 'CFL' AND ct.email = 'maria@consult.com';
SELECT pg_temp.expect_true('Assigned user can create an order in their lab', EXISTS (SELECT 1 FROM lab_order WHERE po_number = 'PO-TECH'));
SELECT pg_temp.expect_error('Assigned to CFL only: still cannot create a TPS order',
  $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, s.id, ct.id FROM client c, lab_site s, contact ct
    WHERE c.legal_name = 'Beta Foods LLC' AND s.site_code = 'TPS' AND ct.email = 'maria@consult.com'$$);
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.expect_error('Changing a lab assignment needs a reason',
  $$UPDATE user_site_access SET status = 'Inactive' WHERE user_id = (SELECT id FROM app_user WHERE username = 'tech.test')$$);
SELECT set_config('lims.reason', 'Moved to the TPS team', false);
UPDATE user_site_access SET status = 'Inactive' WHERE user_id = (SELECT id FROM app_user WHERE username = 'tech.test');
SELECT pg_temp.expect_true('Lab assignment change is audited with the reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'user_site_access' AND action = 'UPDATE' AND reason = 'Moved to the TPS team'));
SELECT pg_temp.as_user('tech.test');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Unassigned user can no longer change the CFL order', $$UPDATE lab_order SET po_number = 'PO-X' WHERE po_number = 'PO-TECH'$$);
SELECT pg_temp.as_user('akiddle');

-- Controlled Matrix list
INSERT INTO matrix (matrix_name) VALUES ('Capsule');
SELECT pg_temp.expect_error('Duplicate matrix name (any capitals) rejected', $$INSERT INTO matrix (matrix_name) VALUES ('capsule')$$);
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): Sample matrix must be on the Matrix list, stored with the list's spelling
INSERT INTO sample (lab_order_id, client_sample_id, matrix) SELECT id, 'LOT-M2', 'Capsule' FROM lab_order WHERE po_number = 'PO-7781';
SELECT set_config('lims.reason', 'No longer tested at CFL', false);
UPDATE matrix SET status = 'Inactive' WHERE matrix_name = 'Capsule';
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): Inactive matrix cannot be used on a new sample
UPDATE sample SET description = 'Fish oil capsules' WHERE client_sample_id = 'LOT-M2';
SELECT pg_temp.expect_true('Existing sample keeps an Inactive matrix and can still be edited',
  (SELECT matrix = 'Capsule' AND description = 'Fish oil capsules' FROM sample WHERE client_sample_id = 'LOT-M2'));
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): Matrix in use cannot be renamed
SELECT set_config('lims.reason', '', false);

-- TAT override
CREATE TEMP TABLE t_before AS SELECT id, tat_days, tat_unit, price, rush_fee, due_date FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Moisture';
SELECT pg_temp.expect_error('TAT override needs a reason', $$UPDATE requested_test SET tat_override = 1 WHERE id = (SELECT id FROM t_before)$$);
SELECT set_config('lims.reason', 'Client agreed to a longer turnaround', false);
UPDATE requested_test SET tat_override = (SELECT tat_days + 3 FROM t_before) WHERE id = (SELECT id FROM t_before);
SELECT pg_temp.expect_true('Override replaces the TAT and moves the due date; price unchanged',
  (SELECT r.tat_days = b.tat_days + 3 AND r.tat_unit = b.tat_unit AND r.due_date = tat_due(r.site_id, r.day0, b.tat_days + 3, r.tat_unit)
          AND r.due_date > b.due_date AND r.price = b.price AND r.rush_fee = b.rush_fee FROM requested_test_view r, t_before b WHERE r.id = b.id));
SELECT pg_temp.expect_true('Override is in the audit trail with its reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'requested_test' AND changed_fields ? 'tat_override' AND reason = 'Client agreed to a longer turnaround'));
-- Moved to the Java backend in migration 063 (JUnit: OrderRulesTest): Negative TAT override rejected
UPDATE requested_test SET tat_override = NULL WHERE id = (SELECT id FROM t_before);
SELECT pg_temp.expect_true('Clearing the override restores the calculated TAT and due date',
  (SELECT r.tat_days = b.tat_days AND r.due_date = b.due_date FROM requested_test_view r, t_before b WHERE r.id = b.id));
UPDATE requested_test SET tat_override = 2 WHERE id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)');
SELECT pg_temp.expect_true('Override also applies to a rushed test; rush fee unchanged (162)',
  (SELECT tat_days = 2 AND rush_fee = 162 AND rush_status = 'Approved' FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'));
SELECT set_config('lims.reason', '', false);

-- Sample IDs: SITEyymmdd### and past 999 the number simply grows
INSERT INTO sample (lab_order_id, client_sample_id, matrix) SELECT id, 'LOT-N1', 'Powder' FROM lab_order WHERE po_number = 'PO-7781';
SELECT apply_project((SELECT id FROM sample WHERE client_sample_id = 'LOT-M2'), (SELECT id FROM project WHERE project_name = 'Protein Powder Release Panel'));
SELECT apply_project((SELECT id FROM sample WHERE client_sample_id = 'LOT-N1'), (SELECT id FROM project WHERE project_name = 'Protein Powder Release Panel'));
UPDATE site_day_counter SET last_no = 998 WHERE site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL');
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'LOT-M2'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'LOT-N1'));
SELECT pg_temp.expect_true('999th sample of the day is CFLyymmdd999', (SELECT sample_code ~ '^CFL[0-9]{6}999$' FROM sample WHERE client_sample_id = 'LOT-M2'));
SELECT pg_temp.expect_true('1000th sample continues as CFLyymmdd1000', (SELECT sample_code ~ '^CFL[0-9]{6}1000$' FROM sample WHERE client_sample_id = 'LOT-N1'));

-- Audit references for the per-page audit trail
SELECT pg_temp.expect_true('Audit entry for a sample: label is the sample ID, link opens the sample',
  (SELECT r->>'label' = s.sample_code AND r->>'link' = '#/samples/' || s.id FROM sample s, audit_record_ref('sample', s.id, to_jsonb(s)) r WHERE s.client_sample_id = 'LOT-A1'));
SELECT pg_temp.expect_true('Audit entry for a test names the test and sample, links to the sample',
  (SELECT r->>'label' LIKE 'Moisture on CFL%' AND r->>'link' = '#/samples/' || rt.sample_id
     FROM requested_test_view rt, audit_record_ref('requested_test', rt.id, to_jsonb(rt)) r WHERE rt.client_sample_id = 'LOT-A1' AND rt.test_name = 'Moisture'));

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
