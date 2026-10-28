-- 059: KPIs for the GM and executive dashboards: the Lab Score, the top tests and clients, departments, people
-- (Claude in the cloud, 2026-10-28; version 0.37.0).
-- Alex (2026-10-28): "KPIs about department and individual staff for granularity"; a Lab Score from turnaround and
-- revenue against the budget and the monthly forecast; the top 20 tests (by how often they are ordered) with their
-- monthly and yearly revenue, the revenue percentage and the top 3 clients ordering each; the top 20 clients with
-- CM, PM, CY, PY revenue and the revenue percentage; the top 10 departments across all labs for executives. Lab level
-- on the GM dashboard, all labs on the executive dashboard; "Executives don't need to see the granular lab department
-- side": the department and people widgets are the GM's (and the Lab Supervisor's, for people).
-- Alex's answers: tests ranked by orders with a flag when a month swings outside 2 standard deviations; Lab Score
-- weights 60 % on time, 10 % revenue vs budget, 30 % revenue vs monthly forecast; PY shown both to the same date and
-- for the full year; people's figures (work and quality) seen by General Managers and Lab Supervisors, each person
-- sees their own. Vault: Decision - KPIs, Lab Score, Departments and People K-1 (build choices Proposed).
-- The figures are worked out by the server (routes_dashboard.js) from these views; nothing here is stored.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 059: KPIs, Lab Score, departments and people on the dashboards', true);

-------------------------------------------------------------------------------
-- 1. PERMISSION: PEOPLE'S FIGURES
-------------------------------------------------------------------------------
SELECT set_config('lims.group_sync', '1', true);
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('dashboard.staff', 'Dashboards', 'People', 'See each person''s work and quality figures at the lab (steps signed, batches, returns from QC Review, on time, reviews, COAs finalized). Everyone sees their own', false, 123);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('General Manager', '{dashboard.staff}'), ('Lab Supervisor', '{dashboard.staff}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 2. THE WIDGETS
-------------------------------------------------------------------------------
INSERT INTO dashboard_widget (code, title, category, description, needs_any, default_w, default_h, boards, sort_order) VALUES
 ('lab_score', 'Lab Score', 'KPIs', 'A score out of 100 this month and last month: samples on time (60 %), revenue against the budget forecast (10 %) and against the monthly forecast (30 %)', '{}', 12, 3, '{gm,executive}', 200),
 ('top_tests', 'Top 20 tests', 'KPIs', 'The 20 tests ordered most in the last 12 months, with this month''s and this year''s revenue, the share of revenue, the top 3 clients ordering each, and a flag when last month''s orders were outside 2 standard deviations of the 12 months before', '{}', 12, 5, '{gm,executive}', 210),
 ('top_clients', 'Top 20 clients', 'KPIs', 'The 20 clients with the most revenue this year: this month, last month, this year, last year to the same date and the whole of last year, and the share of revenue', '{}', 12, 5, '{gm,executive}', 220),
 ('departments', 'Departments', 'KPIs', 'GM: each department of the lab (revenue, tests reported, on time, backlog, turnaround, returns). Executive: the top 10 departments across all labs by revenue this year, with their share of the lab and of the group', '{}', 12, 4, '{gm,executive}', 230),
 ('staff', 'People', 'KPIs', 'Each person''s work and quality figures this month and last month: steps signed, batches, returns from QC Review, on time, reviews, COAs finalized', '{dashboard.staff}', 12, 4, '{gm,home}', 240),
 ('my_numbers', 'My numbers', 'KPIs', 'Your own work and quality figures this month and last month', '{}', 6, 2, '{home}', 250);

INSERT INTO standard_group_widget (group_name, widget_code) VALUES
 ('Lab Supervisor', 'staff'), ('Lab Supervisor', 'my_numbers'), ('Analyst', 'my_numbers'), ('QA', 'my_numbers'), ('Project Manager', 'my_numbers')
ON CONFLICT DO NOTHING;
INSERT INTO group_widget (group_id, widget_code)
SELECT lg.id, s.widget_code FROM lab_group lg JOIN standard_group_widget s ON s.group_name = lg.group_name
 WHERE lg.is_standard AND lg.site_id IS NOT NULL AND s.widget_code IN ('staff', 'my_numbers')
ON CONFLICT DO NOTHING;
SELECT set_config('lims.group_sync', '', true);

-------------------------------------------------------------------------------
-- 3. REVENUE BY LINE: every issued invoice and credit note line, with its client, test, department and lab
-------------------------------------------------------------------------------
-- An invoice's total is the sum of its active lines (credit note lines are negative), so these lines add up to
-- revenue_view. A charge line (kit, shipping...) has no test and no department.
CREATE VIEW revenue_line_view AS
SELECT il.id AS invoice_line_id, i.id AS invoice_id, i.site_id, i.client_id, i.invoice_date, i.kind, il.amount,
       il.requested_test_id, rt.test_id, t.test_name, t.test_code, t.department_id, il.order_charge_id
  FROM invoice_line il JOIN invoice i ON i.id = il.invoice_id
  LEFT JOIN requested_test rt ON rt.id = il.requested_test_id LEFT JOIN test t ON t.id = rt.test_id
 WHERE i.status = 'Issued' AND il.status = 'Active';

-------------------------------------------------------------------------------
-- 4. ORDERS BY TEST: every client test ordered (internal clients and lot QA testing left out), by the day ordered
-------------------------------------------------------------------------------
CREATE VIEW test_order_view AS
SELECT rt.id AS requested_test_id, o.site_id, o.client_id, rt.test_id, t.test_name, t.test_code, t.department_id,
       (rt.created_at AT TIME ZONE si.time_zone)::date AS ordered_on
  FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
  JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id JOIN test t ON t.id = rt.test_id
 WHERE NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled';

COMMIT;
