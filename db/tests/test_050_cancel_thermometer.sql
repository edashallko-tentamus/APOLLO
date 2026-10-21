-- Verification for migration 057 (0.34.0): cancelling tests and samples (refused with results or in a batch, a sample
-- takes its tests with it, a reason on a logged sample), a license's state on the lab's date, and the thermometer at
-- receipt (needed with a temperature; this lab's, available, in calibration).
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.k_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.k_reason(r text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('lims.reason', r, false) $$;
-- an order of two samples with one quoted test each (test_041's client, as test_044 does)
CREATE OR REPLACE FUNCTION pg_temp.k_order(po text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o uuid; c uuid; ct uuid; ln uuid; s uuid;
BEGIN
  SELECT id INTO c FROM client WHERE legal_name = 'PK Packaging Client LLC';
  SELECT cc.contact_id INTO ct FROM client_contact cc WHERE cc.client_id = c AND 'ORDERING' = ANY(cc.roles) AND cc.status = 'Active' LIMIT 1;
  SELECT ol.line_id INTO ln FROM orderable_lines(c) ol JOIN test t ON t.id = ol.test_id WHERE t.site_id = pg_temp.k_site('CFL') LIMIT 1;
  INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number) VALUES (c, pg_temp.k_site('CFL'), ct, po) RETURNING id INTO o;
  FOR i IN 1..2 LOOP
    INSERT INTO sample (lab_order_id, client_sample_id, matrix, number_of_units) VALUES (o, po || '-' || i, 'Powder', 1) RETURNING id INTO s;
    PERFORM order_test(s, ln);
  END LOOP;
  RETURN o;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.k_s(po text, i int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sample WHERE client_sample_id = po || '-' || i $$;
CREATE OR REPLACE FUNCTION pg_temp.k_rt(po text, i int) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM requested_test WHERE sample_id = pg_temp.k_s(po, i) ORDER BY created_at LIMIT 1 $$;
SELECT set_config('lims.site_id', pg_temp.k_site('CFL')::text, false);
SELECT pg_temp.as_user('akiddle');

-------------------------------------------------------------------------------
-- 1. CANCELLING
-------------------------------------------------------------------------------
CREATE TEMP TABLE k_o AS SELECT pg_temp.k_order('K-ONE') AS id;
UPDATE requested_test SET status = 'Cancelled' WHERE id = pg_temp.k_rt('K-ONE', 1);
SELECT pg_temp.expect_true('A test that is not yet in a batch is cancelled (kept, Cancelled)',
  (SELECT status::text = 'Cancelled' FROM requested_test WHERE id = pg_temp.k_rt('K-ONE', 1)));
SELECT pg_temp.expect_error_like('A cancelled test is not reinstated',
  $$UPDATE requested_test SET status = 'Ordered' WHERE id = pg_temp.k_rt('K-ONE', 1)$$, 'cannot be reinstated');
UPDATE sample SET status = 'Cancelled' WHERE id = pg_temp.k_s('K-ONE', 2);
SELECT pg_temp.expect_true('Cancelling a sample (not yet received) cancels its tests',
  (SELECT status::text = 'Cancelled' FROM sample WHERE id = pg_temp.k_s('K-ONE', 2))
  AND NOT EXISTS (SELECT 1 FROM requested_test WHERE sample_id = pg_temp.k_s('K-ONE', 2) AND status <> 'Cancelled'));
-- a logged sample
CREATE TEMP TABLE k_o2 AS SELECT pg_temp.k_order('K-TWO') AS id;
UPDATE lab_order SET status = 'Submitted' WHERE id = (SELECT id FROM k_o2);
SELECT log_samples(ARRAY[pg_temp.k_s('K-TWO', 1), pg_temp.k_s('K-TWO', 2)]);
SELECT pg_temp.expect_error_like('A logged sample is cancelled only with a reason',
  $$UPDATE sample SET status = 'Cancelled' WHERE id = pg_temp.k_s('K-TWO', 1)$$, 'Reason for Change');
SELECT pg_temp.k_reason('Client withdrew the sample');
UPDATE sample SET status = 'Cancelled' WHERE id = pg_temp.k_s('K-TWO', 1);
SELECT pg_temp.expect_true('With a reason, a logged sample with no results is cancelled, its test too (audited with the reason)',
  (SELECT status::text = 'Cancelled' FROM sample WHERE id = pg_temp.k_s('K-TWO', 1))
  AND (SELECT status::text = 'Cancelled' FROM requested_test WHERE id = pg_temp.k_rt('K-TWO', 1))
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'sample' AND record_id = pg_temp.k_s('K-TWO', 1) AND reason = 'Client withdrew the sample'));
-- a test in a batch, and a test with results (from the earlier tests' batches)
CREATE TEMP TABLE k_bat AS SELECT e.requested_test_id AS rt, rt.sample_id AS s, b.batch_code FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id JOIN requested_test rt ON rt.id = e.requested_test_id
  WHERE e.status = 'Active' AND b.status::text NOT IN ('Cancelled', 'Approved') AND rt.status <> 'Cancelled'
    AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active') LIMIT 1;
CREATE TEMP TABLE k_res AS SELECT tr.requested_test_id AS rt, rt.sample_id AS s FROM test_result tr JOIN requested_test rt ON rt.id = tr.requested_test_id
  WHERE tr.status = 'Active' AND rt.status <> 'Cancelled' LIMIT 1;
SELECT pg_temp.expect_true('(fixtures: a test in an open batch and a test with results exist)', EXISTS (SELECT 1 FROM k_bat) AND EXISTS (SELECT 1 FROM k_res));
SELECT pg_temp.expect_error_like('A test in a batch is not cancelled: take it out of the batch first (or cancel the batch)',
  $$UPDATE requested_test SET status = 'Cancelled' WHERE id = (SELECT rt FROM k_bat)$$, 'take it out of the batch');
SELECT pg_temp.expect_error_like('A test with results is not cancelled',
  $$UPDATE requested_test SET status = 'Cancelled' WHERE id = (SELECT rt FROM k_res)$$, 'has results');
SELECT pg_temp.expect_error_like('Nor is a sample holding one, saying which test',
  $$UPDATE sample SET status = 'Cancelled' WHERE id = (SELECT s FROM k_res)$$, 'cannot be cancelled: ');
SELECT pg_temp.expect_true('requested_test_cancel_problem says why, or nothing',
  requested_test_cancel_problem((SELECT rt FROM k_bat)) LIKE '%is in batch ' || (SELECT batch_code FROM k_bat) || '%'
  AND requested_test_cancel_problem(pg_temp.k_rt('K-TWO', 2)) IS NULL);
SELECT pg_temp.k_reason('');

-- 2. A LICENSE'S STATE ON THE LAB'S DATE

SELECT pg_temp.expect_true('A license''s state is worked out on the date given (the lab''s): expiring in 12 days, expired yesterday, retired',
  license_state_on(DATE '2026-11-01', 'Active', DATE '2026-10-20') = 'Expiring soon' AND license_state_on(DATE '2026-10-19', 'Active', DATE '2026-10-20') = 'Expired'
  AND license_state_on(DATE '2027-10-19', 'Active', DATE '2026-10-20') = 'Current' AND license_state_on(NULL, 'Retired', DATE '2026-10-20') = 'Retired');

-------------------------------------------------------------------------------
-- 3. THE THERMOMETER AT RECEIPT
-------------------------------------------------------------------------------
-- fixtures: CFL thermometers (one needing no calibration, one whose calibration expired) and a TPS one
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.k_site('CFL'), 'K Thermometer'), (pg_temp.k_site('TPS'), 'K Thermometer');
INSERT INTO department (site_id, department_code, department_name) SELECT pg_temp.k_site('TPS'), 'KTH', 'K receiving'
  WHERE NOT EXISTS (SELECT 1 FROM department WHERE site_id = pg_temp.k_site('TPS') AND status = 'Active');
INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, calibration_required, calibration_interval_months, in_service_date)
SELECT s.id, x.n, t.id, (SELECT id FROM department WHERE site_id = s.id AND status = 'Active' ORDER BY department_code LIMIT 1), x.cal, CASE WHEN x.cal THEN 12 END, current_date - 400
  FROM (VALUES ('CFL', 'K thermometer OK', false), ('CFL', 'K thermometer expired', true), ('TPS', 'K thermometer TPS', false)) AS x(site, n, cal)
  JOIN lab_site s ON s.site_code = x.site JOIN equipment_type t ON t.site_id = s.id AND t.type_name = 'K Thermometer';
INSERT INTO equipment_owner (equipment_id, group_id)
SELECT e.id, g.id FROM equipment e JOIN lab_group g ON g.site_id = e.site_id AND g.group_name = 'Intake' WHERE e.equipment_name LIKE 'K thermometer%';
INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, certificate_number)
SELECT id, current_date - 400, current_date - 35, 'Pass', 'K-CERT-1' FROM equipment WHERE equipment_name = 'K thermometer expired';
CREATE OR REPLACE FUNCTION pg_temp.k_th(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE equipment_name = n $$;
CREATE TEMP TABLE k_o3 AS SELECT pg_temp.k_order('K-THREE') AS id;
UPDATE lab_order SET status = 'Submitted' WHERE id = (SELECT id FROM k_o3);
SELECT pg_temp.as_user('cu.in');   -- test_044's receiver (handwritten signature and title on file)
SELECT pg_temp.expect_error_like('A temperature names its thermometer',
  $$SELECT receive_samples((SELECT id FROM k_o3), ARRAY[pg_temp.k_s('K-THREE', 1)], now(), 'FedEx', NULL, 4.1, 'Acceptable', 'Intact', NULL)$$, 'which thermometer');
SELECT pg_temp.expect_error_like('A thermometer out of calibration is refused',
  $$SELECT receive_samples((SELECT id FROM k_o3), ARRAY[pg_temp.k_s('K-THREE', 1)], now(), 'FedEx', NULL, 4.1, 'Acceptable', 'Intact', NULL, pg_temp.k_th('K thermometer expired'))$$, 'out of calibration');
SELECT pg_temp.expect_error_like('Another lab''s thermometer is refused',
  $$SELECT receive_samples((SELECT id FROM k_o3), ARRAY[pg_temp.k_s('K-THREE', 1)], now(), 'FedEx', NULL, 4.1, 'Acceptable', 'Intact', NULL, pg_temp.k_th('K thermometer TPS'))$$, 'another lab');
CREATE TEMP TABLE k_ev AS SELECT receive_samples((SELECT id FROM k_o3), ARRAY[pg_temp.k_s('K-THREE', 1)], now(), 'FedEx', NULL, 4.1, 'Acceptable', 'Intact', NULL, pg_temp.k_th('K thermometer OK')) AS id;
SELECT pg_temp.expect_true('With this lab''s thermometer the receipt is signed and names it (in the view too)',
  (SELECT thermometer_id = pg_temp.k_th('K thermometer OK') FROM custody_event WHERE id = (SELECT id FROM k_ev))
  AND (SELECT thermometer_name = 'K thermometer OK' AND thermometer_code LIKE 'EQ-%' FROM custody_event_view WHERE id = (SELECT id FROM k_ev)));
SELECT receive_samples((SELECT id FROM k_o3), ARRAY[pg_temp.k_s('K-THREE', 2)], now(), 'Client in person', NULL, NULL, 'Acceptable', 'None', NULL);
SELECT pg_temp.expect_true('No temperature, no thermometer needed',
  (SELECT status::text = 'Logged' FROM sample WHERE id = pg_temp.k_s('K-THREE', 2)));
SELECT pg_temp.expect_error_like('The thermometer on a receipt is never changed',
  $$UPDATE custody_event SET thermometer_id = NULL WHERE id = (SELECT id FROM k_ev)$$, 'never changed');
SELECT pg_temp.as_user('akiddle');
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
