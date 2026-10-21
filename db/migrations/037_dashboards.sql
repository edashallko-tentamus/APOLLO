-- D-1 Dashboards and the executive dashboard (Alex, 2026-10-15). Vault: Decision - Dashboards and the Executive
-- Dashboard D-1 (his answers), Decision - Dashboards D-1 Build Choices.
--  - Home is the dashboard: widgets come from the person's groups (lab administrators choose each group's widgets);
--    a person in several groups gets all of them and arranges and resizes their own. Every number opens the list behind it.
--  - Turnaround in three segments: Login TAT (received to logged in), Lab TAT (logged in to QC Review approval), QA TAT
--    (QC Review approval to the COA issued). On time = COA issued by the due date; time while the client's account is
--    On Hold does not count (Alex: only the hold stops the clock; time on an OOS investigation counts).
--  - Revenue counts when the invoice is issued (I-1). Everything else is work in progress (WIP): Not Started,
--    Incomplete, Finalized, Pending Invoice. WIP that will finish next month is not in the month's projection; its value
--    is shown beside it as the month-end boost.
--  - Low stock against demand: an inventory item names its department; a test belongs to a department; the samples of
--    that department waiting in the backlog are at risk from its low stock. Use history refines it (lots of the same
--    item used for a test at the bench).
--  - A GM dashboard for the GM's labs; an executive dashboard (Executive group and system administrators, never GMs)
--    with the labs side by side and the weekly finance update (Revenue, Costs, EBITDA) against the Budget Forecast and
--    the Monthly Forecast, typed by system administrators and a new all-labs Finance group.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 037: dashboards', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS AND THE ALL-LABS FINANCE GROUP
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('dashboard.gm', 'Dashboards', 'GM dashboard', 'See the General Manager dashboard for the labs where this is held: revenue, work in progress, projection, samples, turnaround', false, 120),
 ('dashboard.executive', 'Dashboards', 'Executive dashboard', 'See the executive dashboard: every lab side by side and the weekly finance update against the forecasts', true, 121),
 ('finance.enter', 'Dashboards', 'Finance figures', 'Type the weekly finance update (revenue, costs) and the budget and monthly forecasts for every lab', true, 122);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('General Manager', '{dashboard.gm}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;
-- the Executive group sees the executive dashboard
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, 'dashboard.executive' FROM lab_group g WHERE g.site_id IS NULL AND g.group_name = 'Executive (all labs, view only)' ON CONFLICT DO NOTHING;
-- the Finance group: all labs, types the finance figures and sees the executive dashboard
INSERT INTO lab_group (site_id, group_name, description, is_standard)
VALUES (NULL, 'Finance (all labs)', 'Finance: types the weekly finance update and the forecasts for every lab, sees the executive dashboard and can look at every lab (view only). Changes nothing else.', true);
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g, unnest('{finance.enter,dashboard.executive,data.view_all}'::text[]) p WHERE g.site_id IS NULL AND g.group_name = 'Finance (all labs)';

-------------------------------------------------------------------------------
-- 1. WIDGETS: THE CATALOGUE, EACH GROUP'S WIDGETS, EACH PERSON'S LAYOUT
-------------------------------------------------------------------------------
CREATE TABLE dashboard_widget (
    code            text PRIMARY KEY,
    title           text NOT NULL,
    category        text NOT NULL,
    description     text NOT NULL,
    needs_any       text[] NOT NULL DEFAULT '{}',   -- shown only to people holding one of these (empty = anyone in the lab)
    default_w       integer NOT NULL DEFAULT 4 CHECK (default_w BETWEEN 2 AND 12),
    default_h       integer NOT NULL DEFAULT 2 CHECK (default_h BETWEEN 1 AND 6),
    boards          text[] NOT NULL DEFAULT '{home}', -- home, gm, executive
    sort_order      integer NOT NULL DEFAULT 100
);
INSERT INTO dashboard_widget (code, title, category, description, needs_any, default_w, default_h, boards, sort_order) VALUES
 ('my_work', 'My work', 'Lab', 'What is waiting for you: batches assigned to you, sample tests you claimed for finalization, your draft invoices', '{}', 4, 2, '{home}', 10),
 ('intake', 'Intake', 'Intake', 'Samples logged today and this week; samples expected but not received', '{}', 4, 2, '{home}', 20),
 ('rush', 'Rush', 'Intake', 'Rush waiting for approval, rush tests in the lab, rush tests overdue', '{}', 4, 2, '{home,gm}', 30),
 ('backlog', 'Backlog by department', 'Lab', 'Tests waiting to be batched, by department and how long they have waited', '{}', 6, 2, '{home}', 40),
 ('batches', 'Batches', 'Lab', 'Batches open, in progress and waiting for QC Review', '{}', 4, 2, '{home}', 50),
 ('overdue', 'Overdue and due today', 'Lab', 'Tests not yet reported past their due date, and due today', '{}', 4, 2, '{home,gm}', 60),
 ('tat', 'Turnaround (last 30 days)', 'Turnaround', 'Login TAT (received to logged in), Lab TAT (logged in to QC Review approval), QA TAT (approval to COA issued); median and average', '{}', 6, 2, '{home,gm,executive}', 70),
 ('on_time', 'On time', 'Turnaround', 'COAs issued by the due date, this month and last month; time while the client is On Hold does not count', '{}', 4, 2, '{home,gm,executive}', 80),
 ('signing', 'Waiting to be signed', 'Quality', 'What waits for a signature, by task: QC Review, Report Finalization, OOS, logbook entries for QA, equipment to release, purchase requests to approve', '{}', 6, 3, '{home}', 90),
 ('supplies', 'Lab supplies', 'Supplies', 'Equipment due or tagged out; lots expiring or low; purchase requests waiting', '{}', 4, 2, '{home}', 100),
 ('low_stock_risk', 'Low stock against demand', 'Supplies', 'Low or expiring stock of a department, and the samples of that department waiting in the backlog that need it', '{}', 6, 2, '{home}', 110),
 ('quotes', 'Quotes', 'Commercial', 'Open quotes and their value; quote win rate over the last 90 days', '{quotes.edit,invoicing.view,dashboard.gm}', 4, 2, '{home,gm}', 120),
 ('stability', 'Stability', 'Stability', 'Pulls due this week, studies awaiting material, chamber excursions', '{}', 4, 2, '{home}', 130),
 ('billing', 'Billing', 'Revenue', 'Work ready to invoice, draft invoices, late rushes to check', '{invoicing.view,invoicing.issue}', 4, 2, '{home}', 140),
 ('revenue', 'Revenue (invoiced)', 'Revenue', 'Invoiced revenue this month and this year (revenue counts when the invoice is issued)', '{invoicing.view,invoicing.issue,dashboard.gm}', 4, 2, '{home,gm,executive}', 150),
 ('wip', 'Work in progress', 'Revenue', 'The value of work not yet invoiced: Not Started, Incomplete, Finalized, Pending Invoice', '{invoicing.view,invoicing.issue,dashboard.gm}', 6, 2, '{home,gm,executive}', 160),
 ('projection', 'This month''s projection', 'Revenue', 'Revenue so far plus the work due to finish this month; the month-end boost is work due next month', '{invoicing.view,invoicing.issue,dashboard.gm}', 4, 2, '{home,gm,executive}', 170),
 ('samples', 'Samples received', 'Revenue', 'Samples logged this month, last month, this quarter and this year, with the average sample value', '{}', 6, 2, '{home,gm,executive}', 180),
 ('network', 'Labs side by side', 'Network', 'Each lab''s revenue, samples and on-time rate against last month, the quarter, the half year and the year', '{dashboard.gm,dashboard.executive}', 12, 2, '{gm,executive}', 190),
 ('finance', 'Finance update', 'Network', 'Weekly revenue, costs and EBITDA by month against the Budget Forecast and the Monthly Forecast, with the LIMS invoiced revenue', '{dashboard.executive}', 12, 6, '{executive}', 200);

-- Each group's widgets on Home (lab administrators: admin.groups)
CREATE TABLE group_widget (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id        uuid NOT NULL REFERENCES lab_group(id),
    widget_code     text NOT NULL REFERENCES dashboard_widget(code),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (group_id, widget_code)
);
CALL make_gxp('group_widget');
CREATE FUNCTION group_widget_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g lab_group;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.widget_code <> OLD.widget_code) THEN RAISE EXCEPTION 'Switch the widget off (Inactive) instead'; END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
    IF g.site_id IS NULL THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator sets an all-labs group''s widgets'; END IF;
    ELSE PERFORM require_permission_at('admin.groups', g.site_id); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON group_widget FOR EACH ROW EXECUTE FUNCTION group_widget_rules();

-- the standard groups' widgets (each lab can change them)
CREATE TABLE standard_group_widget (group_name text NOT NULL, widget_code text NOT NULL REFERENCES dashboard_widget(code), PRIMARY KEY (group_name, widget_code));
INSERT INTO standard_group_widget (group_name, widget_code)
SELECT g, w FROM (VALUES
 ('Analyst', '{my_work,backlog,batches,overdue,low_stock_risk,supplies}'),
 ('Lab Supervisor', '{my_work,backlog,batches,overdue,rush,tat,on_time,signing,supplies,low_stock_risk,stability}'),
 ('Intake', '{intake,rush,overdue,samples}'),
 ('QA', '{signing,tat,on_time,overdue}'),
 ('Project Manager', '{my_work,overdue,signing,tat,on_time,stability,wip}'),
 ('Account Manager', '{intake,quotes,samples,on_time}'),
 ('Accounting', '{billing,revenue,wip,projection,samples}'),
 ('General Manager', '{revenue,projection,wip,samples,on_time,tat,overdue,rush,quotes,signing,supplies}'),
 ('Administrator', '{intake,overdue,signing,supplies,tat,on_time}')) AS x(g, ws), unnest(x.ws::text[]) w;
INSERT INTO group_widget (group_id, widget_code)
SELECT lg.id, s.widget_code FROM lab_group lg JOIN standard_group_widget s ON s.group_name = lg.group_name WHERE lg.is_standard AND lg.site_id IS NOT NULL
ON CONFLICT DO NOTHING;
-- a new lab's standard groups get them too (after create_standard_groups)
CREATE FUNCTION lab_site_group_widgets() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO group_widget (group_id, widget_code)
    SELECT lg.id, s.widget_code FROM lab_group lg JOIN standard_group_widget s ON s.group_name = lg.group_name WHERE lg.site_id = NEW.id AND lg.is_standard
    ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER zz_group_widgets AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_group_widgets();

-- A person's arrangement of a dashboard (order and sizes). A personal preference, not a record: no audit trail.
CREATE TABLE user_dashboard_layout (
    user_id     uuid NOT NULL REFERENCES app_user(id),
    board       text NOT NULL CHECK (board IN ('home','gm','executive')),
    layout      jsonb NOT NULL DEFAULT '[]',     -- [{code, w, h}] in order
    hidden      text[] NOT NULL DEFAULT '{}',    -- widgets the person put away
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, board)
);
CREATE FUNCTION user_dashboard_layout_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.user_id <> current_app_user() THEN RAISE EXCEPTION 'Each person arranges only their own dashboard'; END IF;
    IF jsonb_typeof(NEW.layout) <> 'array' THEN RAISE EXCEPTION 'A layout is a list of widgets'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.layout) x WHERE NOT ((x->>'w')::int BETWEEN 2 AND 12 AND (x->>'h')::int BETWEEN 1 AND 6)) THEN
        RAISE EXCEPTION 'A widget is 2 to 12 columns wide and 1 to 6 rows high';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON user_dashboard_layout FOR EACH ROW EXECUTE FUNCTION user_dashboard_layout_rules();

-- The widgets a person gets on Home at a lab: their groups' widgets (a system administrator with none gets the
-- Administrator set), filtered by the permissions each widget needs
CREATE FUNCTION my_home_widgets(p_site uuid, p_user uuid) RETURNS SETOF dashboard_widget LANGUAGE sql STABLE AS $$
    WITH mine AS (
        SELECT DISTINCT gw.widget_code FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN group_widget gw ON gw.group_id = g.id
         WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND gw.status = 'Active' AND (g.site_id = p_site OR g.site_id IS NULL)
        UNION
        SELECT s.widget_code FROM standard_group_widget s WHERE s.group_name = 'Administrator' AND COALESCE((SELECT is_admin FROM app_user WHERE id = p_user), false)
    )
    SELECT w.* FROM dashboard_widget w JOIN mine ON mine.widget_code = w.code
     WHERE 'home' = ANY (w.boards)
       AND (cardinality(w.needs_any) = 0 OR EXISTS (SELECT 1 FROM unnest(w.needs_any) n WHERE user_has_permission_at(p_user, n, p_site)))
     ORDER BY w.sort_order
$$;

-------------------------------------------------------------------------------
-- 2. TURNAROUND: THE THREE SEGMENTS, ON TIME WITHOUT THE CLIENT'S HOLD
-------------------------------------------------------------------------------
-- The client's On Hold periods, from its audit trail (every status change is recorded there)
CREATE FUNCTION client_hold_periods(p_client uuid) RETURNS TABLE (hold_from timestamptz, hold_to timestamptz) LANGUAGE sql STABLE AS $$
    WITH ch AS (
        SELECT a.changed_at AS at, COALESCE(a.changed_fields->'account_status'->>'new', a.new_row->>'account_status') AS st
          FROM audit_log a WHERE a.table_name = 'client' AND a.record_id = p_client
           AND (a.action = 'CREATE' OR a.changed_fields ? 'account_status')
    ), seq AS (SELECT at, st, lead(at) OVER (ORDER BY at) AS nxt FROM ch)
    SELECT at, COALESCE(nxt, 'infinity'::timestamptz) FROM seq WHERE st = 'On Hold'
$$;
-- Calendar days of a period during which the client was On Hold
CREATE FUNCTION client_hold_days(p_client uuid, p_from date, p_to date) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT COALESCE(count(DISTINCT d)::integer, 0)
      FROM client_hold_periods(p_client) h, generate_series(p_from, p_to, interval '1 day') d
     WHERE p_from IS NOT NULL AND p_to IS NOT NULL AND d::date >= h.hold_from::date AND d::date < COALESCE(h.hold_to::date + 1, 'infinity'::date)
$$;

-- Every reported (COA issued) client test: its three segments (days) and whether it was on time
CREATE VIEW test_tat_view AS
SELECT x.*, (x.reported_on <= x.due_date + x.hold_days) AS on_time,
       GREATEST(x.reported_on - (x.due_date + x.hold_days), 0) AS days_late
  FROM (
    SELECT rt.id AS requested_test_id, o.site_id, o.client_id, o.id AS lab_order_id, o.order_code, s.id AS sample_id, s.sample_code, t.test_name, t.department_id,
           rt.rush_fee > 0 AS is_rush, rt.due_date, rt.day0,
           s.received_at, s.logged_at, ap.approved_at, rp.reported_at,
           (rp.reported_at AT TIME ZONE si.time_zone)::date AS reported_on,
           CASE WHEN s.received_at IS NOT NULL AND s.logged_at >= s.received_at THEN extract(epoch FROM s.logged_at - s.received_at) / 86400.0 END AS login_days,
           CASE WHEN ap.approved_at IS NOT NULL AND s.logged_at IS NOT NULL THEN extract(epoch FROM ap.approved_at - s.logged_at) / 86400.0 END AS lab_days,
           CASE WHEN ap.approved_at IS NOT NULL THEN GREATEST(extract(epoch FROM rp.reported_at - ap.approved_at) / 86400.0, 0) END AS qa_days,
           client_hold_days(o.client_id, rt.day0, (rp.reported_at AT TIME ZONE si.time_zone)::date) AS hold_days
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
      JOIN lab_site si ON si.id = o.site_id JOIN test t ON t.id = rt.test_id
      CROSS JOIN LATERAL (SELECT test_reported_at(rt.id) AS reported_at) rp
      LEFT JOIN LATERAL (SELECT max(tr.approved_at) AS approved_at FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.stage = 'Final') ap ON true
     WHERE NOT c.is_internal AND rt.media_lot_id IS NULL AND rt.status <> 'Cancelled' AND rp.reported_at IS NOT NULL
  ) x;

-------------------------------------------------------------------------------
-- 3. WORK IN PROGRESS AND REVENUE
-------------------------------------------------------------------------------
-- Every client test not yet invoiced: its value (as ordered) and where it stands. Pending Invoice = its COA is issued
-- (or it is on a draft invoice); Finalized = approved in QC Review, report not issued; Incomplete = in a batch;
-- Not Started = waiting to be batched (or not yet logged).
CREATE VIEW wip_view AS
SELECT b.requested_test_id, b.site_id, b.client_id, b.client_name, b.lab_order_id, b.order_code, b.sample_id, b.sample_code, b.test_name, b.due_date,
       b.price + b.rush_fee AS value,
       CASE WHEN b.completed_at IS NOT NULL THEN 'Pending Invoice'
            WHEN EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = b.requested_test_id AND tr.status = 'Active' AND tr.stage = 'Final') THEN 'Finalized'
            WHEN EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch tb ON tb.id = e.batch_id WHERE e.requested_test_id = b.requested_test_id
                          AND tb.status <> 'Cancelled' AND e.status <> 'Superseded') THEN 'Incomplete'
            ELSE 'Not Started' END AS wip_state
  FROM billable_test_view b
 WHERE NOT b.is_internal AND b.media_lot_id IS NULL AND b.test_status <> 'Cancelled'
   AND b.billing_status IS DISTINCT FROM 'Non-billable'
   AND NOT EXISTS (SELECT 1 FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id WHERE l.id = test_invoice_line(b.requested_test_id) AND i.status = 'Issued')
   AND NOT test_billing_closed(b.requested_test_id)
   AND NOT EXISTS (SELECT 1 FROM lab_order lo WHERE lo.id = b.lab_order_id AND lo.status = 'Draft');

-- Revenue: issued invoices less issued credit notes, by the invoice date
CREATE VIEW revenue_view AS
SELECT i.id AS invoice_id, i.site_id, i.client_id, i.invoice_date, i.total, i.kind, i.catchup FROM invoice i WHERE i.status = 'Issued';

-------------------------------------------------------------------------------
-- 4. LOW STOCK AGAINST DEMAND: AN INVENTORY ITEM NAMES ITS DEPARTMENT
-------------------------------------------------------------------------------
ALTER TABLE inventory_lot ADD COLUMN department_id uuid REFERENCES department(id);
CREATE FUNCTION inventory_lot_department_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department d WHERE d.id = NEW.department_id AND d.site_id = NEW.site_id) THEN
        RAISE EXCEPTION 'The department must be one of the lab''s departments';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a03_department BEFORE INSERT OR UPDATE OF department_id, site_id ON inventory_lot FOR EACH ROW EXECUTE FUNCTION inventory_lot_department_rule();

-- Usable lots that are low or expiring soon, with their department and the tests that used the same item at the bench
-- (the last 180 days): use history refines the department link
CREATE VIEW low_stock_demand_view AS
SELECT l.id AS lot_id, l.lot_code, l.site_id, l.item_name, il.department_id, d.department_name, l.on_hand, l.unit, l.pct_remaining, l.low_stock,
       l.expiry_status, l.expiration_date, l.days_to_expiry,
       ARRAY(SELECT DISTINCT tb.test_id FROM entry_material em JOIN batch_entry e ON e.id = em.entry_id JOIN test_batch tb ON tb.id = e.batch_id
              JOIN inventory_lot l2 ON l2.id = em.lot_id
             WHERE l2.site_id = l.site_id AND lower(COALESCE(l2.item_name, '')) = lower(COALESCE(l.item_name, '')) AND em.created_at > now() - interval '180 days') AS used_by_tests
  FROM inventory_lot_view l JOIN inventory_lot il ON il.id = l.id LEFT JOIN department d ON d.id = il.department_id
 WHERE l.receipt_status = 'Received' AND l.status = 'Available' AND (l.low_stock OR l.expiry_status IN ('Expiring','Expired') OR l.negative_stock);

-------------------------------------------------------------------------------
-- 5. FINANCE: THE WEEKLY UPDATE AND THE FORECASTS (system administrators and the Finance group)
-------------------------------------------------------------------------------
CREATE TABLE finance_week (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    week_ending     date NOT NULL,
    revenue         numeric(14,2) NOT NULL DEFAULT 0,
    costs           numeric(14,2) NOT NULL DEFAULT 0,
    note            text,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (site_id, week_ending)
);
CALL make_gxp('finance_week', false);
CREATE TABLE finance_plan (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    month           date NOT NULL CHECK (extract(day FROM month) = 1),
    plan            text NOT NULL CHECK (plan IN ('Budget forecast','Monthly forecast')),
    revenue         numeric(14,2) NOT NULL DEFAULT 0,
    costs           numeric(14,2) NOT NULL DEFAULT 0,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (site_id, month, plan)
);
CALL make_gxp('finance_plan', false);
CREATE FUNCTION finance_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT has_permission_at('finance.enter', NEW.site_id) THEN
        RAISE EXCEPTION 'Only system administrators and the Finance group type the finance figures (finance.enter)';
    END IF;
    IF TG_TABLE_NAME = 'finance_week' THEN
        IF (to_jsonb(NEW)->>'week_ending')::date > (now() AT TIME ZONE 'UTC')::date + 7 THEN RAISE EXCEPTION 'A week cannot end more than a week from now'; END IF;
    END IF;
    IF NEW.revenue < 0 OR NEW.costs < 0 THEN RAISE EXCEPTION 'Revenue and costs are not negative'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON finance_week FOR EACH ROW EXECUTE FUNCTION finance_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON finance_plan FOR EACH ROW EXECUTE FUNCTION finance_rules();

-------------------------------------------------------------------------------
-- 6. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_037;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'group_widget' THEN
        RETURN jsonb_build_object('label', 'Dashboard widget ' || COALESCE(r->>'widget_code', '') || ' for ' || COALESCE((SELECT group_name FROM lab_group WHERE id = (r->>'group_id')::uuid), 'a group'),
                                  'link', '#/admin/dashboard-widgets');
    ELSIF p_table IN ('finance_week', 'finance_plan') THEN
        RETURN jsonb_build_object('label', CASE WHEN p_table = 'finance_week' THEN 'Finance week ending ' || COALESCE(r->>'week_ending', '') ELSE COALESCE(r->>'plan', 'Plan') || ' ' || COALESCE(r->>'month', '') END
                                  || ' (' || COALESCE((SELECT site_code FROM lab_site WHERE id = (r->>'site_id')::uuid), '') || ')', 'link', '#/dashboard/finance');
    END IF;
    RETURN audit_record_ref_037(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
