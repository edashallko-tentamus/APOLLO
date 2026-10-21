-- Trending (migration 043, T-1): canned reasons for the Trending pages, and demo saved charts at each lab that has the
-- demo logbooks and tests (looked up by code and name; nothing is made where they are missing, and nothing at all if
-- the lab already has saved charts). Each lab's QA can change the reasons in Admin > Canned reasons.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Demo trend charts and canned reasons for trending', true);
SELECT script_signature('Demo trend charts and canned reasons for trending');

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT x.m, x.r, x.o FROM (VALUES
 ('Trending', 'New baseline after a method or equipment change', 10),
 ('Trending', 'Baseline period was not stable', 20),
 ('Trending', 'Chart definition corrected', 30),
 ('Trending', 'Chart no longer needed', 40),
 ('Trending', 'Equipment or test retired', 50)
) x(m, r, o)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = x.m AND lower(c.reason_text) = lower(x.r));

DO $$
DECLARE s record; v_lb uuid; v_test uuid; v_an uuid;
BEGIN
    FOR s IN SELECT ls.id FROM lab_site ls WHERE NOT EXISTS (SELECT 1 FROM trend_chart tc WHERE tc.site_id = ls.id)
               AND EXISTS (SELECT 1 FROM logbook l WHERE l.site_id = ls.id AND l.logbook_code = 'LB-0003') LOOP
        -- storage temperatures: one chart per fridge, incubator and chamber
        SELECT id INTO v_lb FROM logbook WHERE site_id = s.id AND logbook_code = 'LB-0003';
        INSERT INTO trend_chart (site_id, chart_name, description, source, params)
        VALUES (s.id, 'Storage and incubation temperatures', 'Every fridge, incubator and stability chamber on the temperature log, one chart each, against its logbook limits.',
                'logbook', jsonb_build_object('logbook_id', v_lb, 'field_key', 'temperature', 'equipment_id', '*'));
        -- balance checks: the error of the daily check weight
        SELECT l.id INTO v_lb FROM logbook l WHERE l.site_id = s.id AND l.logbook_code = 'LB-0001';
        IF v_lb IS NOT NULL AND EXISTS (SELECT 1 FROM logbook_version v JOIN logbook_field f ON f.version_id = v.id WHERE v.logbook_id = v_lb AND f.field_key = 'error_pct') THEN
            INSERT INTO trend_chart (site_id, chart_name, description, source, params)
            VALUES (s.id, 'Daily balance check error', 'The error of the daily check weight on each balance: drift shows before the check fails.',
                    'logbook', jsonb_build_object('logbook_id', v_lb, 'field_key', 'error_pct', 'equipment_id', '*'));
        END IF;
        -- USP <51> inoculum: the standardized count
        SELECT l.id INTO v_lb FROM logbook l WHERE l.site_id = s.id AND l.logbook_code = 'LB-0006';
        IF v_lb IS NOT NULL AND EXISTS (SELECT 1 FROM logbook_version v JOIN logbook_field f ON f.version_id = v.id WHERE v.logbook_id = v_lb AND f.field_key = 'cfu_per_ml') THEN
            INSERT INTO trend_chart (site_id, chart_name, description, source, params)
            VALUES (s.id, 'USP <51> inoculum count', 'CFU/mL of each standardized inoculum (about 1 x 10^8 expected).',
                    'logbook', jsonb_build_object('logbook_id', v_lb, 'field_key', 'cfu_per_ml'));
        END IF;
        -- Vitamin C assay results
        SELECT t.id INTO v_test FROM test t WHERE t.site_id = s.id AND t.test_name = 'Vitamin C stability (demo)';
        SELECT a.id INTO v_an FROM analyte a WHERE a.analyte_name = 'Vitamin C' LIMIT 1;
        IF v_test IS NOT NULL AND v_an IS NOT NULL THEN
            INSERT INTO trend_chart (site_id, chart_name, description, source, params)
            VALUES (s.id, 'Vitamin C assay results', 'Final Vitamin C results against the usual specification.',
                    'results', jsonb_build_object('test_id', v_test, 'analyte_id', v_an));
        END IF;
        -- ICP-MS: LCS recovery per element, shown in QC Review of the test's batches
        SELECT t.id INTO v_test FROM test t WHERE t.site_id = s.id AND t.test_name = 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS';
        IF v_test IS NOT NULL THEN
            INSERT INTO trend_chart (site_id, chart_name, description, source, params, show_in_review)
            VALUES (s.id, 'ICP-MS LCS recovery', 'Laboratory Control Sample recovery for each element, from approved batches. Shown in QC Review with the batch''s points ringed.',
                    'qc', jsonb_build_object('test_id', v_test, 'analyte_id', '*', 'qc_type', 'Laboratory Control Sample', 'limit_type', 'Recovery %'), true);
        END IF;
        -- events over time and what they are made of
        INSERT INTO trend_chart (site_id, chart_name, description, source, params) VALUES
          (s.id, 'OOS investigations per month', 'Investigations opened each month (c chart: a month above the upper limit is more than chance).', 'counts', '{"metric":"oos_opened","period":"Month"}'),
          (s.id, 'Failed equipment checks per month', 'Logbook entries on equipment that failed, each month.', 'counts', '{"metric":"equipment_failures","period":"Month"}');
        INSERT INTO trend_chart (site_id, chart_name, description, source, params, watch) VALUES
          (s.id, 'Failed equipment checks by equipment', 'Which equipment the failed checks come from (Pareto).', 'pareto', '{"metric":"failures_by_equipment"}', false);
    END LOOP;
END $$;
COMMIT;
