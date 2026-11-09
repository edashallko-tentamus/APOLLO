-- Verification for migration 038 (D-1.1, Alex's notes on the dashboards): on time at QC Review approval and at the
-- sample level (the client's On Hold days not counted), the week's revenue from the LIMS, the books' revenue optional,
-- the new widgets (On time (samples) where On time (tests) is; Lab finance on the GM dashboard only).
-- Fixture: the earlier rule tests' work (LO-000003 at CFL, reported, invoiced and credited; test_032's hold).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.db_as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.dbu(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.dbcfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.dbtps() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'TPS' $$;

-- 1. tests: on time at QC Review approval
SELECT pg_temp.expect_true('Tests approved in QC Review are listed with their approval date and an on-time verdict',
  (SELECT count(*) FROM test_qc_tat_view WHERE order_code = 'LO-000003') >= 3
  AND NOT EXISTS (SELECT 1 FROM test_qc_tat_view WHERE approved_on IS NULL OR on_time IS NULL));
SELECT pg_temp.expect_true('On time at approval = approved on or before the due date, the client''s On Hold days added to it',
  NOT EXISTS (SELECT 1 FROM test_qc_tat_view WHERE on_time <> (approved_on <= due_date + hold_days) OR days_late <> GREATEST(approved_on - (due_date + hold_days), 0)));

SELECT pg_temp.expect_true('Every test released on a COA is also in the approval measure',
  NOT EXISTS (SELECT 1 FROM test_tat_view r WHERE NOT EXISTS (SELECT 1 FROM test_qc_tat_view q WHERE q.requested_test_id = r.requested_test_id))
  OR NOT EXISTS (SELECT 1 FROM test_qc_tat_view));

-- 2. samples: the complete COA against the latest due date
-- fixture, triggers off: one sample with a reported test gets its other tests cancelled, so all of its tests are reported
SET session_replication_role = replica;
DO $$
DECLARE v uuid;
BEGIN
  SELECT rt.sample_id INTO v FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
   WHERE test_reported_at(rt.id) IS NOT NULL AND NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.due_date IS NOT NULL ORDER BY s.sample_code LIMIT 1;
  UPDATE requested_test SET status = 'Cancelled' WHERE sample_id = v AND test_reported_at(id) IS NULL;
  CREATE TEMP TABLE IF NOT EXISTS dbk2 (k text PRIMARY KEY, v text); DELETE FROM dbk2;
  INSERT INTO dbk2 VALUES ('sample', v);
END $$;
SET session_replication_role = origin;
SELECT pg_temp.expect_true('A sample whose tests are all reported is in the sample measure, completed when the last was first released',
  (SELECT completed_at = (SELECT max(test_reported_at(rt.id)) FROM requested_test rt WHERE rt.sample_id = v.sample_id AND rt.status <> 'Cancelled')
     FROM sample_tat_view v WHERE v.sample_id = (SELECT v::uuid FROM dbk2 WHERE k = 'sample')));SELECT pg_temp.expect_true('A sample is listed only when every test on it is reported; due = the latest of its tests'' due dates; completed = the last release',
  NOT EXISTS (SELECT 1 FROM sample_tat_view v WHERE EXISTS (SELECT 1 FROM requested_test rt WHERE rt.sample_id = v.sample_id AND rt.status <> 'Cancelled' AND rt.media_lot_id IS NULL
                                                             AND NOT test_is_replaced(rt.id) AND test_reported_at(rt.id) IS NULL))
  AND NOT EXISTS (SELECT 1 FROM sample_tat_view v WHERE v.due_date <> (SELECT max(rt.due_date) FROM requested_test rt WHERE rt.sample_id = v.sample_id AND rt.status <> 'Cancelled' AND rt.media_lot_id IS NULL AND NOT test_is_replaced(rt.id))));
SELECT pg_temp.expect_true('On time for a sample = completed on or before its due date, the client''s On Hold days added',
  EXISTS (SELECT 1 FROM sample_tat_view)
  AND NOT EXISTS (SELECT 1 FROM sample_tat_view WHERE on_time <> (completed_on <= due_date + hold_days)));
SELECT pg_temp.expect_true('A sample whose tests are not all reported is not in the sample measure',
  NOT EXISTS (SELECT 1 FROM sample_tat_view v JOIN requested_test rt ON rt.sample_id = v.sample_id WHERE rt.status <> 'Cancelled' AND rt.media_lot_id IS NULL AND NOT test_is_replaced(rt.id) AND test_reported_at(rt.id) IS NULL));

-- 3. the week's revenue from the LIMS; the books' figure optional
SELECT pg_temp.expect_true('The week''s LIMS revenue is the invoices issued (less credit notes) in the seven days ending that day',
  lims_week_revenue(pg_temp.dbcfl(), (SELECT max(invoice_date) FROM revenue_view WHERE site_id = pg_temp.dbcfl()))
  = (SELECT sum(total) FROM revenue_view WHERE site_id = pg_temp.dbcfl() AND invoice_date > (SELECT max(invoice_date) FROM revenue_view WHERE site_id = pg_temp.dbcfl()) - 7));
SELECT pg_temp.expect_true('A week with no invoices has no LIMS revenue (0, not empty)', lims_week_revenue(pg_temp.dbcfl(), '2020-01-03') = 0);
SELECT pg_temp.db_as('db.fin', false);
SELECT pg_temp.expect_ok('Finance types a week''s costs without the books'' revenue', $$INSERT INTO finance_week (site_id, week_ending, costs) VALUES (pg_temp.dbcfl(), current_date - 17, 900)$$);
SELECT pg_temp.expect_true('...stored with no books'' revenue', (SELECT revenue IS NULL FROM finance_week WHERE site_id = pg_temp.dbcfl() AND week_ending = current_date - 17));
-- Moved to the Java backend in migration 070 (JUnit: DashboardRulesTest): the books' revenue, when typed, is still not negative
SELECT pg_temp.db_as('db.gm', false);
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): a GM still does not type the finance figures (DashboardService.saveWeeks)

-- 4. the widgets
SELECT pg_temp.expect_true('On time (tests) and On time (samples) are on Home, the GM and the executive dashboards; Lab finance on the GM dashboard only',
  (SELECT title = 'On time (tests)' AND boards @> '{home,gm,executive}' FROM dashboard_widget WHERE code = 'on_time')
  AND (SELECT boards @> '{home,gm,executive}' FROM dashboard_widget WHERE code = 'on_time_samples')
  AND (SELECT boards = '{gm}' FROM dashboard_widget WHERE code = 'lab_finance'));
SELECT pg_temp.expect_true('Every group that sees on time for tests sees it for samples too, and new labs'' standard groups get both',
  NOT EXISTS (SELECT 1 FROM group_widget a WHERE a.widget_code = 'on_time' AND a.status = 'Active'
               AND NOT EXISTS (SELECT 1 FROM group_widget b WHERE b.group_id = a.group_id AND b.widget_code = 'on_time_samples' AND b.status = 'Active'))
  AND NOT EXISTS (SELECT 1 FROM standard_group_widget a WHERE a.widget_code = 'on_time'
               AND NOT EXISTS (SELECT 1 FROM standard_group_widget b WHERE b.group_name = a.group_name AND b.widget_code = 'on_time_samples')));
SELECT pg_temp.expect_true('A GM gets On time (samples) on Home; Lab finance never appears on Home',
  EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('db.gm')) WHERE code = 'on_time_samples')
  AND NOT EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('db.gm')) WHERE code = 'lab_finance'));

SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.site_id', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
