-- Verification for migration 003 (runs after the 001 and 002 tests)
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT script_signature('Rule test', false);   -- test definitions are signed (migration 015)
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

-- Since migration 004: sites and matrices are admin-only, and sample matrices come from the Matrix list
UPDATE app_user SET is_admin = true WHERE username = 'akiddle';
INSERT INTO matrix (matrix_name) VALUES ('Powder');

-- Sites and a holiday
INSERT INTO lab_site (site_code, site_name, time_zone, default_oos_procedure) VALUES
 ('CFL', 'CFL', 'America/Los_Angeles', 'Check and Acknowledge'),
 ('TPS', 'Tentamus Pharmaceutical Services', 'America/New_York', 'Full Phase I (21 CFR 211)');
INSERT INTO site_holiday (site_id, holiday_date, description) SELECT id, '2026-11-26', 'Thanksgiving' FROM lab_site WHERE site_code = 'CFL';
SELECT pg_temp.expect_error('Unknown time zone rejected', $$INSERT INTO lab_site (site_code, site_name, time_zone) VALUES ('XX', 'Bad', 'Mars/Olympus')$$);

-- TAT clock (3-business-day test, 2 pm cutoff), the worked examples agreed with Alex
CREATE OR REPLACE FUNCTION pg_temp.due(site text, ts timestamptz, cutoff time, n int, u tat_unit) RETURNS text LANGUAGE sql AS $$
  SELECT tat_day0(s.id, ts, cutoff, u)::text || ' -> ' || tat_due(s.id, tat_day0(s.id, ts, cutoff, u), n, u)::text FROM lab_site s WHERE s.site_code = site
$$;
SELECT pg_temp.expect_true('Mon 10:00 -> Day 0 Mon, due Thu', pg_temp.due('CFL', '2026-10-05 10:00 America/Los_Angeles', '14:00', 3, 'Business Days') = '2026-10-05 -> 2026-10-08');
SELECT pg_temp.expect_true('Mon 15:00 (after cutoff) -> Day 0 Tue, due Fri', pg_temp.due('CFL', '2026-10-05 15:00 America/Los_Angeles', '14:00', 3, 'Business Days') = '2026-10-06 -> 2026-10-09');
SELECT pg_temp.expect_true('Fri 15:00 -> Day 0 Mon, due Thu', pg_temp.due('CFL', '2026-10-09 15:00 America/Los_Angeles', '14:00', 3, 'Business Days') = '2026-10-12 -> 2026-10-15');
SELECT pg_temp.expect_true('Sat 09:00 (business days) -> Day 0 Mon, due Thu', pg_temp.due('CFL', '2026-10-10 09:00 America/Los_Angeles', '14:00', 3, 'Business Days') = '2026-10-12 -> 2026-10-15');
SELECT pg_temp.expect_true('Sat 09:00 (calendar days) -> Day 0 Sat', pg_temp.due('CFL', '2026-10-10 09:00 America/Los_Angeles', '14:00', 5, 'Calendar Days') = '2026-10-10 -> 2026-10-15');
SELECT pg_temp.expect_true('Site holiday skipped (Thanksgiving)', pg_temp.due('CFL', '2026-11-25 10:00 America/Los_Angeles', '14:00', 3, 'Business Days') = '2026-11-25 -> 2026-12-01');
SELECT pg_temp.expect_true('Same moment: before cutoff in CA, after cutoff in FL',
  pg_temp.due('CFL', '2026-10-05 16:30 America/New_York', '14:00', 3, 'Business Days') = '2026-10-05 -> 2026-10-08'
  AND pg_temp.due('TPS', '2026-10-05 16:30 America/New_York', '14:00', 3, 'Business Days') = '2026-10-06 -> 2026-10-09');

-- Effective versions so tests can be ordered; rush schedule on Heavy Metals already set in test 002
SELECT set_config('lims.methods_internal', '1', true);  -- tests made before the Workflow Designer: version 1 Effective without approval (migration 012)
INSERT INTO test_version (test_id, version_no, status, effective_from) SELECT id, 1, 'Effective', now() FROM test WHERE test_name IN ('Heavy Metals (ICP-MS)', 'Moisture');
SELECT set_config('lims.methods_internal', '', true);

-- Lab orders: who may order
SELECT pg_temp.expect_error('Inactive client cannot order',
  $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, s.id, ct.id FROM client c, lab_site s, contact ct
    WHERE c.legal_name = 'Acme Holdings Inc' AND s.site_code = 'CFL' AND ct.email = 'kim@acme.com'$$);
SELECT pg_temp.expect_error('Contact without the Ordering role cannot place the order',
  $$INSERT INTO lab_order (client_id, site_id, ordering_contact_id) SELECT c.id, s.id, ct.id FROM client c, lab_site s, contact ct
    WHERE c.legal_name = 'Acme Irvine Site' AND s.site_code = 'CFL' AND ct.email = 'sam@acme.com'$$);
INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number)
  SELECT c.id, s.id, ct.id, 'Online', 'PO-7781' FROM client c, lab_site s, contact ct
   WHERE c.legal_name = 'Acme Irvine Site' AND s.site_code = 'CFL' AND ct.email = 'maria@consult.com';
INSERT INTO lab_order (client_id, site_id, ordering_contact_id)
  SELECT c.id, s.id, ct.id FROM client c, lab_site s, contact ct WHERE c.legal_name = 'Beta Foods LLC' AND s.site_code = 'TPS' AND ct.email = 'maria@consult.com';
SELECT pg_temp.expect_true('On Hold client can order, but reports are flagged as not releasable',
  (SELECT NOT reports_releasable FROM lab_order_view WHERE client_name = 'Beta Foods LLC'));

-- Samples and tests
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT id, x.cid, 'Vanilla protein powder', 'Powder', 500, 'g', 2 FROM lab_order o, (VALUES ('LOT-A1'), ('LOT-A2')) AS x(cid) WHERE o.po_number = 'PO-7781';
SELECT pg_temp.expect_true('Applying the project orders its quoted tests (2)',
  apply_project((SELECT id FROM sample WHERE client_sample_id = 'LOT-A1'), (SELECT id FROM project WHERE project_name = 'Protein Powder Release Panel')) = 2);
SELECT apply_project((SELECT id FROM sample WHERE client_sample_id = 'LOT-A2'), (SELECT id FROM project WHERE project_name = 'Protein Powder Release Panel'));
SELECT pg_temp.expect_error('Unquoted test cannot be ordered (Beta project line is not Acme''s)',
  $$SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'LOT-A1'), (SELECT l.id FROM quoted_test_configuration l JOIN project_version pv ON pv.id = l.project_version_id JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'Catalog pricing' LIMIT 1))$$);
SELECT pg_temp.expect_true('Requested test pins the effective test version', (SELECT count(*) FROM requested_test rt JOIN test_version tv ON tv.id = rt.test_version_id WHERE tv.status = 'Effective') = 4);
SELECT pg_temp.expect_true('Price comes from the accepted quote (124 for 4 analytes)', (SELECT price FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)') = 124);

-- Analyte trimming at order keeps the quoted discount %
UPDATE requested_analyte SET included = false
 WHERE analyte_id = (SELECT id FROM analyte WHERE analyte_name = 'Lead')
   AND requested_test_id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)');
SELECT pg_temp.expect_true('Removing Lead: list 135, price 108 (20% kept)',
  (SELECT list_price = 135 AND price = 108 FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'));
SELECT pg_temp.expect_error('Unquoted analyte cannot be added on the order (Chromium was removed on the quote)',
  $$INSERT INTO requested_analyte (requested_test_id, analyte_id, analyte_price) SELECT id, (SELECT id FROM analyte WHERE analyte_name = 'Chromium'), 20 FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'$$);

-- Rush
SELECT pg_temp.expect_error('Rush not available for a test without a rush schedule (Moisture)',
  $$UPDATE requested_test SET rush_tier_id = (SELECT id FROM rush_fee_tier WHERE tier_name = '48 Hour') WHERE id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Moisture')$$);
UPDATE requested_test SET rush_tier_id = (SELECT id FROM rush_fee_tier WHERE tier_name = '48 Hour')
 WHERE id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A2' AND test_name = 'Heavy Metals (ICP-MS)');
SELECT pg_temp.expect_true('48 Hour rush is auto-accepted, fee = 50% of 124 = 62',
  (SELECT rush_status = 'Auto-accepted' AND rush_fee = 62 AND tat_days = 2 FROM requested_test_view WHERE client_sample_id = 'LOT-A2' AND test_name = 'Heavy Metals (ICP-MS)'));
SELECT set_config('lims.reason', 'Same Day needs approval for metals', false);
UPDATE test_rush_approval SET requires_approval = true;
SELECT set_config('lims.reason', '', false);
UPDATE requested_test SET rush_tier_id = (SELECT id FROM rush_fee_tier WHERE tier_name = 'Same Day')
 WHERE id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)');
SELECT pg_temp.expect_true('Same Day needs approval: pending, no fee, standard TAT meanwhile',
  (SELECT rush_status = 'Pending Approval' AND rush_fee = 0 AND tat_days = 7 AND approval_due_at IS NOT NULL FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'));

-- Logging starts the clock
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'LOT-A1'));
SELECT pg_temp.expect_true('Sample code is SITEyymmdd001', (SELECT sample_code ~ '^CFL[0-9]{6}001$' FROM sample WHERE client_sample_id = 'LOT-A1'));
SELECT pg_temp.expect_true('Order is Submitted, not Received, while a sample is still expected', (SELECT status = 'Submitted' FROM lab_order WHERE po_number = 'PO-7781'));
SELECT pg_temp.expect_true('Logged tests are In Pool with Day 0 and due dates',
  (SELECT bool_and(status = 'In Pool' AND day0 IS NOT NULL AND due_date >= day0) FROM requested_test_view WHERE client_sample_id = 'LOT-A1'));
SELECT pg_temp.expect_true('Due date follows the agreed TAT rule',
  (SELECT bool_and(due_date = tat_due(site_id, tat_day0(site_id, logged_at, (SELECT cutoff_time FROM test_catalog_entry e WHERE e.test_id = r.test_id), tat_unit), tat_days, tat_unit))
     FROM requested_test_view r WHERE client_sample_id = 'LOT-A1'));
SELECT log_samples(ARRAY(SELECT id FROM sample WHERE client_sample_id = 'LOT-A2'));
SELECT pg_temp.expect_true('Second sample the same day is 002; order now Received',
  (SELECT sample_code ~ '^CFL[0-9]{6}002$' FROM sample WHERE client_sample_id = 'LOT-A2') AND (SELECT status = 'Received' FROM lab_order WHERE po_number = 'PO-7781'));
SELECT pg_temp.expect_error('Logged sample cannot be edited without a reason', $$UPDATE sample SET description = 'Chocolate' WHERE client_sample_id = 'LOT-A1'$$);
SELECT set_config('lims.reason', 'Client corrected the description', false);
UPDATE sample SET description = 'Chocolate protein powder' WHERE client_sample_id = 'LOT-A1';
SELECT pg_temp.expect_true('Logged sample edited with a reason', (SELECT description = 'Chocolate protein powder' FROM sample WHERE client_sample_id = 'LOT-A1'));

-- Intake decisions
SELECT pg_temp.expect_error('Declining a rush requires a reason',
  $$INSERT INTO rush_decision (requested_test_id, decision, requested_tier_id) SELECT id, 'Not Accepted', rush_tier_id FROM requested_test_view WHERE client_sample_id = 'LOT-A2' AND test_name = 'Heavy Metals (ICP-MS)'$$);
SELECT set_config('lims.reason', 'Rush approved by intake', false);
INSERT INTO rush_decision (requested_test_id, decision, requested_tier_id)
  SELECT id, 'Approved', rush_tier_id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)';
SELECT pg_temp.expect_true('Approved Same Day: fee 150% of 108 = 162, due on Day 0',
  (SELECT rush_status = 'Approved' AND rush_fee = 162 AND due_date = day0 FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'));
SELECT set_config('lims.reason', 'ICP-MS down for maintenance today', false);
INSERT INTO rush_decision (requested_test_id, decision, requested_tier_id, replacement_tier_id, reason)
  SELECT id, 'Not Accepted', rush_tier_id, (SELECT id FROM rush_fee_tier WHERE tier_name = '5 Day'), 'ICP-MS down for maintenance today'
    FROM requested_test_view WHERE client_sample_id = 'LOT-A2' AND test_name = 'Heavy Metals (ICP-MS)';
SELECT pg_temp.expect_true('Declined 48 Hour replaced by 5 Day (free on this quote)',
  (SELECT rush_tier_name = '5 Day' AND rush_status = 'Approved' AND rush_fee = 0 AND tat_days = 5 FROM requested_test_view WHERE client_sample_id = 'LOT-A2' AND test_name = 'Heavy Metals (ICP-MS)'));
SELECT pg_temp.expect_true('Automatic email to the ordering contact names the staff member and reason',
  (SELECT to_address = 'maria@consult.com' AND body LIKE '%Processed by Alex Kiddle%' AND body LIKE '%ICP-MS down%' AND body LIKE '%5 Day rush%' FROM email_outbox WHERE template = 'Rush Not Accepted'));
SELECT pg_temp.expect_error('Replacement must be slower than the requested tier',
  $$INSERT INTO rush_decision (requested_test_id, decision, requested_tier_id, replacement_tier_id, reason) SELECT id, 'Not Accepted', rush_tier_id, (SELECT id FROM rush_fee_tier WHERE tier_name = 'Same Day'), 'x' FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Heavy Metals (ICP-MS)'$$);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Changing a logged test needs a reason',
  $$UPDATE requested_test SET status = 'Cancelled' WHERE id = (SELECT id FROM requested_test_view WHERE client_sample_id = 'LOT-A1' AND test_name = 'Moisture')$$);
SELECT pg_temp.expect_error('Samples cannot be deleted', $$DELETE FROM sample WHERE client_sample_id = 'LOT-A1'$$);
SELECT pg_temp.expect_true('Order value includes prices and rush fees', (SELECT order_value FROM lab_order_view WHERE po_number = 'PO-7781') =
  (SELECT sum(price + rush_fee) FROM requested_test WHERE status <> 'Cancelled'));

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
