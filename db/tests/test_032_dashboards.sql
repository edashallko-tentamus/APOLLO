-- Verification for migration 037: dashboards (D-1). Who sees which dashboard; each group's widgets on Home (set by lab
-- administrators), filtered by the permissions a widget needs; each person's own layout; turnaround segments and on
-- time with the client's On Hold days not counted; work in progress by stage, never what is invoiced; revenue from
-- issued invoices less credit notes; an inventory item's department (low stock against demand); the finance figures
-- (system administrators and the all-labs Finance group only).
-- Fixture: the earlier rule tests' work (Acme Irvine Site at CFL: LO-000003 reported, invoiced and credited by test_031).
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
CREATE OR REPLACE FUNCTION pg_temp.dbg(name text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_group WHERE site_id = pg_temp.dbcfl() AND group_name = name $$;

-- people: a GM, a member of the all-labs Finance group, an analyst (wd.ana2), the Accounting user from test_031
SELECT pg_temp.db_as('akiddle');
INSERT INTO app_user (username, full_name) VALUES ('db.gm', 'DB General Manager'), ('db.fin', 'DB Finance') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.dbg('General Manager'), pg_temp.dbu('db.gm')) ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.dbu('db.fin') FROM lab_group g WHERE g.site_id IS NULL AND g.group_name = 'Finance (all labs)' ON CONFLICT DO NOTHING;

-- 1. who sees which dashboard
SELECT pg_temp.expect_true('General Managers get the GM dashboard; the executive dashboard is for the Executive and Finance groups, never GMs',
  user_has_permission_at(pg_temp.dbu('db.gm'), 'dashboard.gm', pg_temp.dbcfl())
  AND NOT user_has_permission_at(pg_temp.dbu('db.gm'), 'dashboard.executive', pg_temp.dbcfl())
  AND EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id IS NULL AND g.group_name LIKE 'Executive%' AND p.permission_code = 'dashboard.executive')
  AND user_has_permission_at(pg_temp.dbu('db.fin'), 'dashboard.executive', pg_temp.dbtps())
  AND user_has_permission_at(pg_temp.dbu('db.fin'), 'finance.enter', pg_temp.dbcfl())
  AND NOT user_has_permission_at(pg_temp.dbu('db.fin'), 'invoicing.issue', pg_temp.dbcfl()));
SELECT pg_temp.expect_error_like('An all-labs group still takes only view-type permissions',
  $$INSERT INTO group_permission (group_id, permission_code) SELECT g.id, 'invoicing.issue' FROM lab_group g WHERE g.site_id IS NULL AND g.group_name = 'Finance (all labs)'$$, 'view only');

-- 2. Home: each group's widgets, filtered by the permissions a widget needs
SELECT pg_temp.expect_true('Every standard group at every lab has its widgets',
  NOT EXISTS (SELECT 1 FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name IN ('Analyst','QA','General Manager','Accounting')
               AND NOT EXISTS (SELECT 1 FROM group_widget w WHERE w.group_id = g.id AND w.status = 'Active')));
SELECT pg_temp.expect_true('A GM gets the revenue widgets on Home; an analyst gets the lab''s, and no revenue (it needs a permission they lack)',
  EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('db.gm')) WHERE code = 'revenue')
  AND EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('wd.ana2')) WHERE code = 'backlog')
  AND NOT EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('wd.ana2')) WHERE code IN ('revenue','wip','projection')));
SELECT pg_temp.expect_true('The GM and executive widgets never appear on Home', NOT EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('db.gm')) WHERE code IN ('network','finance')));
SELECT pg_temp.db_as('wd.ana2', false);
SELECT pg_temp.expect_error_like('Only a lab administrator (admin.groups) sets a group''s widgets',
  $$INSERT INTO group_widget (group_id, widget_code) VALUES (pg_temp.dbg('Analyst'), 'revenue')$$, 'permission');
SELECT pg_temp.db_as('akiddle', false);
SELECT pg_temp.expect_ok('A lab administrator gives the Analyst group a widget', $$INSERT INTO group_widget (group_id, widget_code) VALUES (pg_temp.dbg('Analyst'), 'quotes')$$);
SELECT pg_temp.expect_true('The change is in the audit trail with its reason',
  EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'group_widget' AND a.new_row->>'widget_code' = 'quotes' AND a.reason = 'Rule test'));
SELECT pg_temp.expect_true('An analyst still does not see the quotes widget (it needs quotes.edit, invoicing.view or dashboard.gm)',
  NOT EXISTS (SELECT 1 FROM my_home_widgets(pg_temp.dbcfl(), pg_temp.dbu('wd.ana2')) WHERE code = 'quotes')
  OR user_has_permission_at(pg_temp.dbu('wd.ana2'), 'quotes.edit', pg_temp.dbcfl()));

-- 3. each person's layout
SELECT pg_temp.db_as('wd.ana2', false);
SELECT pg_temp.expect_ok('A person saves their own arrangement', $$INSERT INTO user_dashboard_layout (user_id, board, layout) VALUES (pg_temp.dbu('wd.ana2'), 'home', '[{"code":"backlog","w":8,"h":3}]')$$);
SELECT pg_temp.expect_error_like('Nobody arranges someone else''s dashboard', $$INSERT INTO user_dashboard_layout (user_id, board, layout) VALUES (pg_temp.dbu('db.gm'), 'home', '[]')$$, 'only their own');
SELECT pg_temp.expect_error_like('Widget sizes are 2 to 12 columns and 1 to 6 rows', $$UPDATE user_dashboard_layout SET layout = '[{"code":"backlog","w":14,"h":3}]' WHERE user_id = pg_temp.dbu('wd.ana2')$$, '2 to 12 columns');

-- 4. turnaround and on time (the client's On Hold days do not count)
SELECT pg_temp.expect_true('Reported tests have their three segments (login, lab, QA) and an on-time verdict',
  (SELECT count(*) FROM test_tat_view WHERE order_code = 'LO-000003') >= 3
  AND NOT EXISTS (SELECT 1 FROM test_tat_view WHERE order_code = 'LO-000003' AND (lab_days < 0 OR qa_days < 0 OR on_time IS NULL)));
-- fixture, triggers off: one test due 3 days before it was reported; the client On Hold for the 4 days before that
SET session_replication_role = replica;
DO $$
DECLARE v record;
BEGIN
  SELECT * INTO v FROM test_tat_view WHERE order_code = 'LO-000003' ORDER BY requested_test_id LIMIT 1;
  UPDATE requested_test SET due_date = v.reported_on - 3, day0 = v.reported_on - 10 WHERE id = v.requested_test_id;
  CREATE TEMP TABLE IF NOT EXISTS dbk (k text PRIMARY KEY, v text); DELETE FROM dbk;
  INSERT INTO dbk VALUES ('rt', v.requested_test_id), ('client', v.client_id), ('on', v.reported_on);
END $$;
SET session_replication_role = origin;
SELECT pg_temp.expect_true('Reported 3 days after its due date: late by 3 days, less any day the client was On Hold',
  (SELECT NOT on_time AND days_late = 3 - hold_days AND hold_days < 3 FROM test_tat_view WHERE requested_test_id = (SELECT v::uuid FROM dbk WHERE k = 'rt')));
SET session_replication_role = replica;
INSERT INTO audit_log (table_name, record_id, action, record_version, changed_at, changed_by, reason, changed_fields, new_row)
SELECT 'client', (SELECT v::uuid FROM dbk WHERE k = 'client'), 'UPDATE', 90, ((SELECT v::date FROM dbk WHERE k = 'on') - 5)::timestamp AT TIME ZONE 'America/Los_Angeles' + interval '10 hours',
       pg_temp.dbu('akiddle'), 'Rule test hold', '{"account_status":{"old":"Active","new":"On Hold"}}'::jsonb, '{"account_status":"On Hold"}'::jsonb
UNION ALL
SELECT 'client', (SELECT v::uuid FROM dbk WHERE k = 'client'), 'UPDATE', 91, ((SELECT v::date FROM dbk WHERE k = 'on') - 1)::timestamp AT TIME ZONE 'America/Los_Angeles' + interval '10 hours',
       pg_temp.dbu('akiddle'), 'Rule test hold', '{"account_status":{"old":"On Hold","new":"Active"}}'::jsonb, '{"account_status":"Active"}'::jsonb;
SET session_replication_role = origin;
SELECT pg_temp.expect_true('The client was On Hold 5 days of that time: they do not count, so the test was on time',
  (SELECT on_time AND hold_days >= 5 AND days_late = 0 FROM test_tat_view WHERE requested_test_id = (SELECT v::uuid FROM dbk WHERE k = 'rt')));
SELECT pg_temp.expect_true('client_hold_days counts the calendar days of the hold inside a period',
  client_hold_days((SELECT v::uuid FROM dbk WHERE k = 'client'), (SELECT v::date FROM dbk WHERE k = 'on') - 20, (SELECT v::date FROM dbk WHERE k = 'on') - 3) = 3);

-- 5. work in progress and revenue
SELECT pg_temp.expect_true('Work in progress has the four stages; what is invoiced is never in it',
  NOT EXISTS (SELECT 1 FROM wip_view WHERE wip_state NOT IN ('Not Started','Incomplete','Finalized','Pending Invoice'))
  AND NOT EXISTS (SELECT 1 FROM wip_view w JOIN invoice_line l ON l.id = test_invoice_line(w.requested_test_id) JOIN invoice i ON i.id = l.invoice_id WHERE i.status = 'Issued')
  AND EXISTS (SELECT 1 FROM wip_view WHERE wip_state = 'Pending Invoice')
  AND EXISTS (SELECT 1 FROM wip_view WHERE wip_state = 'Not Started'));
SELECT pg_temp.expect_true('Work reported but not invoiced is Pending Invoice; work on a draft invoice too',
  NOT EXISTS (SELECT 1 FROM invoice_ready_view r JOIN wip_view w ON w.requested_test_id = r.requested_test_id WHERE w.wip_state <> 'Pending Invoice'));
SELECT pg_temp.expect_true('Revenue is issued invoices less issued credit notes, by the invoice date',
  (SELECT sum(total) FROM revenue_view WHERE site_id = pg_temp.dbcfl()) = (SELECT sum(total) FROM invoice WHERE status = 'Issued' AND site_id = pg_temp.dbcfl())
  AND EXISTS (SELECT 1 FROM revenue_view WHERE kind = 'Credit note' AND total < 0));

-- 6. an inventory item's department
SELECT pg_temp.db_as('akiddle');
SELECT pg_temp.expect_error_like('An item''s department must be one of its lab''s departments',
  $$UPDATE inventory_lot SET department_id = (SELECT id FROM department WHERE site_id = pg_temp.dbtps() LIMIT 1) WHERE id = (SELECT id FROM inventory_lot WHERE site_id = pg_temp.dbcfl() LIMIT 1)$$, 'lab''s departments');

-- 7. the finance figures
SELECT pg_temp.db_as('db.gm', false);
SELECT pg_temp.expect_error_like('A GM does not type the finance figures', $$INSERT INTO finance_week (site_id, week_ending, revenue, costs) VALUES (pg_temp.dbcfl(), current_date - 3, 1000, 800)$$, 'finance.enter');
SELECT pg_temp.db_as('db.fin', false);
SELECT pg_temp.expect_ok('The Finance group types a week for any lab', $$INSERT INTO finance_week (site_id, week_ending, revenue, costs) VALUES (pg_temp.dbtps(), current_date - 3, 52000, 41000)$$);
SELECT pg_temp.expect_ok('and a forecast', $$INSERT INTO finance_plan (site_id, month, plan, revenue, costs) VALUES (pg_temp.dbcfl(), date_trunc('month', current_date)::date, 'Budget forecast', 230000, 185000)$$);
SELECT pg_temp.expect_error_like('Not a week far in the future', $$INSERT INTO finance_week (site_id, week_ending, revenue, costs) VALUES (pg_temp.dbcfl(), current_date + 30, 1, 1)$$, 'more than a week');
SELECT pg_temp.expect_error_like('Not negative', $$INSERT INTO finance_week (site_id, week_ending, revenue, costs) VALUES (pg_temp.dbcfl(), current_date - 10, -1, 1)$$, 'not negative');
SELECT pg_temp.expect_error_like('A forecast month is the first of the month', $$INSERT INTO finance_plan (site_id, month, plan, revenue, costs) VALUES (pg_temp.dbcfl(), date_trunc('month', current_date)::date + 3, 'Monthly forecast', 1, 1)$$, 'check');
SELECT pg_temp.expect_true('The figures are in the audit trail', EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'finance_week' AND changed_by = pg_temp.dbu('db.fin')));

SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.site_id', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
