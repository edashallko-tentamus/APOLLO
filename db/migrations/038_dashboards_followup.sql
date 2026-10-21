-- D-1.1: Alex's notes on the dashboards (2026-10-15 evening; built by Claude Code). Vault: Decision - Dashboards and the
-- Executive Dashboard D-1 (section "D-1.1, Alex's notes").
--  - On time, two levels:
--      tests:   the main figure is each test's QC Review approval against its due date; the release (the first issued COA
--               carrying the test) against the due date is shown smaller, under it;
--      samples: a sample is on time when its complete COA (every test reported) is issued by the sample's due date
--               (the latest of its tests'). The executive dashboard uses the sample level.
--    Days the client was On Hold are added to the due date for both (they are not a delay).
--  - Weekly revenue comes from the LIMS (invoices issued that week, by invoice date) and cannot be typed. Finance types
--    the costs; the revenue from the books stays as an optional figure (finance_week.revenue, now "Revenue (books)").
--    EBITDA = LIMS revenue less costs.
--  - New widgets: On time (samples) (Home, GM, executive) and Lab finance (GM dashboard: revenue, costs and EBITDA by
--    month for the GM's lab against the forecasts).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 038: dashboards follow-up', true);

-------------------------------------------------------------------------------
-- 1. ON TIME: TESTS AT QC REVIEW APPROVAL, AND SAMPLES
-------------------------------------------------------------------------------
-- Every client test approved in QC Review (final results): the approval date against the due date, without the
-- client's On Hold days (counted from Day 0 to the approval)
CREATE VIEW test_qc_tat_view AS
SELECT x.*, (x.approved_on <= x.due_date + x.hold_days) AS on_time,
       GREATEST(x.approved_on - (x.due_date + x.hold_days), 0) AS days_late
  FROM (
    SELECT rt.id AS requested_test_id, o.site_id, o.client_id, o.id AS lab_order_id, o.order_code, s.id AS sample_id, s.sample_code, t.test_name,
           rt.due_date, rt.day0, ap.approved_at, (ap.approved_at AT TIME ZONE si.time_zone)::date AS approved_on,
           client_hold_days(o.client_id, rt.day0, (ap.approved_at AT TIME ZONE si.time_zone)::date) AS hold_days
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
      JOIN lab_site si ON si.id = o.site_id JOIN test t ON t.id = rt.test_id
      CROSS JOIN LATERAL (SELECT max(tr.approved_at) AS approved_at FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.stage = 'Final' AND tr.status = 'Active') ap
     WHERE NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled' AND ap.approved_at IS NOT NULL AND rt.due_date IS NOT NULL
  ) x;

-- Every client sample whose tests are all reported: completed when the last of them was first issued on a COA (so a
-- partial COA counts only once the rest follows); due on the latest due date of its tests; without the client's On Hold days
CREATE VIEW sample_tat_view AS
SELECT x.*, (x.completed_on <= x.due_date + x.hold_days) AS on_time,
       GREATEST(x.completed_on - (x.due_date + x.hold_days), 0) AS days_late
  FROM (
    SELECT y.*, (y.completed_at AT TIME ZONE y.time_zone)::date AS completed_on,
           client_hold_days(y.client_id, y.day0, (y.completed_at AT TIME ZONE y.time_zone)::date) AS hold_days
      FROM (
        SELECT s.id AS sample_id, s.sample_code, s.client_sample_id, o.site_id, o.client_id, o.id AS lab_order_id, o.order_code, si.time_zone,
               min(rt.day0) AS day0, max(rt.due_date) AS due_date, count(*) AS tests,
               max(test_reported_at(rt.id)) AS completed_at, bool_and(test_reported_at(rt.id) IS NOT NULL) AS all_reported
          FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id
          JOIN requested_test rt ON rt.sample_id = s.id
         WHERE NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id)
         GROUP BY s.id, s.sample_code, s.client_sample_id, o.site_id, o.client_id, o.id, o.order_code, si.time_zone
      ) y WHERE y.all_reported AND y.due_date IS NOT NULL
  ) x;

-------------------------------------------------------------------------------
-- 2. WEEKLY REVENUE FROM THE LIMS; THE BOOKS' FIGURE OPTIONAL
-------------------------------------------------------------------------------
ALTER TABLE finance_week ALTER COLUMN revenue DROP NOT NULL, ALTER COLUMN revenue DROP DEFAULT;
COMMENT ON COLUMN finance_week.revenue IS 'Revenue from the books (optional, typed by finance for reconciliation). The weekly revenue used is lims_week_revenue().';
-- Invoices issued less credit notes, by invoice date, in the seven days ending on the week's last day
CREATE FUNCTION lims_week_revenue(p_site uuid, p_week_ending date) RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT COALESCE(sum(total), 0) FROM revenue_view WHERE site_id = p_site AND invoice_date > p_week_ending - 7 AND invoice_date <= p_week_ending
$$;

-------------------------------------------------------------------------------
-- 3. WIDGETS
-------------------------------------------------------------------------------
UPDATE dashboard_widget SET title = 'On time (tests)',
       description = 'Tests approved in QC Review by their due date (and, smaller, released on a COA by their due date), this month, last month and this year; days the client was On Hold do not count'
 WHERE code = 'on_time';
INSERT INTO dashboard_widget (code, title, category, description, needs_any, default_w, default_h, boards, sort_order) VALUES
 ('on_time_samples', 'On time (samples)', 'Turnaround', 'Samples whose complete COA was issued by the sample''s due date (the latest of its tests), this month, last month and this year; days the client was On Hold do not count', '{}', 4, 2, '{home,gm,executive}', 85),
 ('lab_finance', 'Lab finance', 'Revenue', 'Revenue (LIMS invoiced), costs and EBITDA by month for the lab, against the Budget Forecast and the Monthly Forecast', '{dashboard.gm,dashboard.executive}', 12, 5, '{gm}', 195);
-- the standard groups that see the test level see the sample level too
INSERT INTO standard_group_widget (group_name, widget_code)
SELECT group_name, 'on_time_samples' FROM standard_group_widget WHERE widget_code = 'on_time' ON CONFLICT DO NOTHING;
INSERT INTO group_widget (group_id, widget_code)
SELECT gw.group_id, 'on_time_samples' FROM group_widget gw WHERE gw.widget_code = 'on_time' AND gw.status = 'Active' ON CONFLICT DO NOTHING;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
