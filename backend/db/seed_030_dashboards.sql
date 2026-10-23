-- Sandbox demo data for migration 037 (D-1 dashboards):
--  - a demo General Manager (gm, "General Manager (demo)") in CFL's General Manager group, and a demo Finance user
--    (finance, "Finance (demo)") in the all-labs Finance group;
--  - departments on inventory items that have none: media and strains to Microbiology, other chemicals to Chemistry
--    (consumables are left without one), so Low stock against demand has something to work with;
--  - fictional finance figures for the year so far, for CFL and TPS: the Budget Forecast and the Monthly Forecast for
--    every month, and a weekly update for every week ending on a Friday before this week. Clearly demo numbers, not
--    real ones. Skipped if any finance figure exists.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO app_user (username, full_name) VALUES ('gm', 'General Manager (demo)'), ('finance', 'Finance (demo)') ON CONFLICT (username) DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id, app_user u
 WHERE s.site_code = 'CFL' AND g.group_name = 'General Manager' AND g.status = 'Active' AND u.username = 'gm'
ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g, app_user u WHERE g.site_id IS NULL AND g.group_name = 'Finance (all labs)' AND u.username = 'finance'
ON CONFLICT DO NOTHING;

-- departments on inventory items
UPDATE inventory_lot l SET department_id = d.id
  FROM department d
 WHERE d.site_id = l.site_id AND d.status = 'Active' AND l.department_id IS NULL AND l.status NOT IN ('Disposed','Cancelled')
   AND d.department_code = CASE WHEN l.chemical_types && ARRAY['Media','Microbiological Strain']::chemical_type[] THEN 'MICRO'
                                WHEN l.chemical_types && ARRAY['Solvent','Reagent','Reference Standard','In-house mixture']::chemical_type[] THEN 'CHEM' END;

-- fictional finance figures (once)
DO $$
DECLARE s record; m date; w date; base_rev numeric; base_cost numeric; k integer := 0; yr date := date_trunc('year', current_date)::date;
BEGIN
    IF EXISTS (SELECT 1 FROM finance_week) OR EXISTS (SELECT 1 FROM finance_plan) THEN RETURN; END IF;
    FOR s IN SELECT id, site_code FROM lab_site WHERE site_code IN ('CFL','TPS') LOOP
        base_rev := CASE WHEN s.site_code = 'CFL' THEN 230000 ELSE 165000 END;
        base_cost := CASE WHEN s.site_code = 'CFL' THEN 186000 ELSE 139000 END;
        FOR m IN SELECT generate_series(yr, yr + interval '11 months', interval '1 month')::date LOOP
            k := k + 1;
            INSERT INTO finance_plan (site_id, month, plan, revenue, costs) VALUES
             (s.id, m, 'Budget forecast', round(base_rev * (1 + 0.04 * sin(extract(month FROM m)::numeric)::numeric), -2), round(base_cost * (1 + 0.02 * sin(extract(month FROM m)::numeric)::numeric), -2)),
             (s.id, m, 'Monthly forecast', round(base_rev * (0.97 + 0.05 * cos(extract(month FROM m)::numeric)::numeric), -2), round(base_cost * (0.99 + 0.03 * cos(extract(month FROM m)::numeric)::numeric), -2));
        END LOOP;
        FOR w IN SELECT d::date FROM generate_series(yr, date_trunc('week', current_date)::date - 1, interval '1 day') d WHERE extract(isodow FROM d) = 5 LOOP
            INSERT INTO finance_week (site_id, week_ending, revenue, costs, note) VALUES
             (s.id, w, round(base_rev * 12 / 52 * (0.92 + 0.12 * sin(extract(doy FROM w)::numeric / 9)::numeric + 0.05 * cos(extract(doy FROM w)::numeric / 3)::numeric), -1),
                       round(base_cost * 12 / 52 * (0.96 + 0.06 * cos(extract(doy FROM w)::numeric / 7)::numeric), -1), 'Demo figures (fictional)');
        END LOOP;
    END LOOP;
END $$;
COMMIT;
