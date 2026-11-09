-- Verification for migration 073 (was 059 on main; K-1, 0.37.0): the people permission and who holds it, the new widgets and their
-- boards, the revenue by line adding up to the invoices, client orders by test leaving internal work out.
-- Fixture: the earlier rule tests' work (invoices and credit notes from test_031 and test_051).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.kcfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;

-- 1. the permission
SELECT pg_temp.expect_true('dashboard.staff is on the controlled permission list (Dashboards > People), lab-level',
  EXISTS (SELECT 1 FROM permission WHERE code = 'dashboard.staff' AND module = 'Dashboards' AND NOT cross_lab));
SELECT pg_temp.expect_true('Every lab''s standard General Manager and Lab Supervisor groups hold it',
  NOT EXISTS (SELECT 1 FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name IN ('General Manager', 'Lab Supervisor')
    AND NOT EXISTS (SELECT 1 FROM group_permission gp WHERE gp.group_id = g.id AND gp.permission_code = 'dashboard.staff')));
SELECT pg_temp.expect_true('The standard Analyst, QA and Intake groups do not',
  NOT EXISTS (SELECT 1 FROM lab_group g JOIN group_permission gp ON gp.group_id = g.id
    WHERE g.is_standard AND g.group_name IN ('Analyst', 'QA', 'Intake') AND gp.permission_code = 'dashboard.staff'));
SELECT pg_temp.expect_true('A new lab''s groups will get it (the standard group templates carry it)',
  (SELECT bool_and('dashboard.staff' = ANY (permissions)) FROM standard_group_template WHERE group_name IN ('General Manager', 'Lab Supervisor')));

-- 2. the widgets and their boards
SELECT pg_temp.expect_true('Lab Score, Top 20 tests, Top 20 clients and Departments are on the GM and the executive dashboards',
  (SELECT count(*) FROM dashboard_widget WHERE code IN ('lab_score', 'top_tests', 'top_clients', 'departments') AND boards @> '{gm,executive}') = 4);
SELECT pg_temp.expect_true('People is on the GM dashboard and Home, never on the executive dashboard, and needs dashboard.staff',
  EXISTS (SELECT 1 FROM dashboard_widget WHERE code = 'staff' AND boards @> '{gm,home}' AND NOT 'executive' = ANY (boards) AND needs_any = '{dashboard.staff}'));
SELECT pg_temp.expect_true('My numbers is a Home widget anyone may have',
  EXISTS (SELECT 1 FROM dashboard_widget WHERE code = 'my_numbers' AND boards = '{home}' AND needs_any = '{}'));
SELECT pg_temp.expect_true('The Lab Supervisor groups have People and My numbers on Home; Analysts have My numbers',
  NOT EXISTS (SELECT 1 FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name = 'Lab Supervisor'
      AND (SELECT count(*) FROM group_widget gw WHERE gw.group_id = g.id AND gw.widget_code IN ('staff', 'my_numbers') AND gw.status = 'Active') <> 2)
  AND NOT EXISTS (SELECT 1 FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name = 'Analyst'
      AND NOT EXISTS (SELECT 1 FROM group_widget gw WHERE gw.group_id = g.id AND gw.widget_code = 'my_numbers')));
SELECT pg_temp.expect_true('People shows on Home only for someone holding dashboard.staff at the lab (an analyst in the Lab Supervisor group still needs it)',
  NOT EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
     CROSS JOIN LATERAL (SELECT 1 FROM my_home_widgets(pg_temp.kcfl(), u.id) w WHERE w.code = 'staff') x
    WHERE m.status = 'Active' AND g.site_id = pg_temp.kcfl() AND NOT user_has_permission_at(u.id, 'dashboard.staff', pg_temp.kcfl())));

-- 3. revenue by line
SELECT pg_temp.expect_true('There are issued invoices and a credit note to check against',
  (SELECT count(*) FROM revenue_view) >= 2 AND EXISTS (SELECT 1 FROM revenue_view WHERE kind = 'Credit note'));
SELECT pg_temp.expect_true('Each issued invoice''s lines add up to its total (credit notes negative)',
  NOT EXISTS (SELECT 1 FROM revenue_view r WHERE r.total <> COALESCE((SELECT sum(l.amount) FROM revenue_line_view l WHERE l.invoice_id = r.invoice_id), 0)));
SELECT pg_temp.expect_true('Revenue by line has no line of a draft or discarded invoice, nor a removed line',
  NOT EXISTS (SELECT 1 FROM revenue_line_view l JOIN invoice i ON i.id = l.invoice_id JOIN invoice_line il ON il.id = l.invoice_line_id
    WHERE i.status <> 'Issued' OR il.status <> 'Active'));
SELECT pg_temp.expect_true('A test line carries its test and the test''s department; a charge line carries neither',
  NOT EXISTS (SELECT 1 FROM revenue_line_view l WHERE (l.requested_test_id IS NOT NULL) <> (l.test_id IS NOT NULL))
  AND NOT EXISTS (SELECT 1 FROM revenue_line_view l JOIN test t ON t.id = l.test_id WHERE l.department_id IS DISTINCT FROM t.department_id)
  AND NOT EXISTS (SELECT 1 FROM revenue_line_view l WHERE l.order_charge_id IS NOT NULL AND l.test_id IS NOT NULL));

-- 4. orders by test
SELECT pg_temp.expect_true('Client orders by test exist and leave out internal clients, lot QA testing and cancelled tests',
  (SELECT count(*) FROM test_order_view) > 0
  AND NOT EXISTS (SELECT 1 FROM test_order_view o JOIN requested_test rt ON rt.id = o.requested_test_id JOIN client c ON c.id = o.client_id
    WHERE c.is_internal OR rt.media_lot_id IS NOT NULL OR rt.status = 'Cancelled'));
SELECT pg_temp.expect_true('Every ordered test is dated in its lab''s time zone',
  NOT EXISTS (SELECT 1 FROM test_order_view o JOIN requested_test rt ON rt.id = o.requested_test_id JOIN lab_site si ON si.id = o.site_id
    WHERE o.ordered_on <> (rt.created_at AT TIME ZONE si.time_zone)::date));

SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
