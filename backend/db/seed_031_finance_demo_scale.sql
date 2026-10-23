-- Sandbox demo data for migration 038: the fictional finance figures of seed_030 brought to the size of each lab's
-- LIMS invoiced revenue (weekly revenue now comes from the LIMS, so costs and forecasts sized for a much bigger lab
-- would show every month at a large loss). Only the demo figures nobody has changed are rescaled: weekly rows still
-- noted "Demo figures (fictional)" at their first version, and forecasts never edited. A lab with no invoices yet (a
-- fresh database) keeps seed_030's figures. Costs are about 82 % of revenue; the books' revenue is the LIMS revenue
-- within a few percent (for reconciling).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data: finance figures sized to the LIMS revenue', true);
SELECT set_config('lims.group_sync', '1', true);

DO $$
DECLARE s record; avg_m numeric;
BEGIN
    IF EXISTS (SELECT 1 FROM finance_plan WHERE record_version > 1) OR EXISTS (SELECT 1 FROM finance_week WHERE record_version > 1 OR note IS DISTINCT FROM 'Demo figures (fictional)') THEN RETURN; END IF;
    FOR s IN SELECT id, site_code FROM lab_site LOOP
        SELECT avg(m.total) INTO avg_m FROM (
            SELECT date_trunc('month', invoice_date) AS mo, sum(total) AS total FROM revenue_view
             WHERE site_id = s.id AND invoice_date < date_trunc('month', site_today(s.id)) GROUP BY 1) m;
        IF COALESCE(avg_m, 0) <= 0 THEN CONTINUE; END IF;
        UPDATE finance_week w SET
            costs = round(avg_m * 12 / 52 * 0.82 * (0.95 + 0.08 * cos(extract(doy FROM w.week_ending)::numeric / 7)::numeric), -1),
            revenue = round(lims_week_revenue(s.id, w.week_ending) * (1 + 0.03 * sin(extract(doy FROM w.week_ending)::numeric / 9)::numeric), 2)
         WHERE w.site_id = s.id;
        UPDATE finance_plan p SET
            revenue = round(avg_m * CASE WHEN p.plan = 'Budget forecast' THEN 1 + 0.06 * sin(extract(month FROM p.month)::numeric)::numeric
                                         ELSE 0.98 + 0.07 * cos(extract(month FROM p.month)::numeric)::numeric END, -1),
            costs = round(avg_m * 0.82 * CASE WHEN p.plan = 'Budget forecast' THEN 1 + 0.02 * sin(extract(month FROM p.month)::numeric)::numeric
                                              ELSE 0.99 + 0.03 * cos(extract(month FROM p.month)::numeric)::numeric END, -1)
         WHERE p.site_id = s.id;
    END LOOP;
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
