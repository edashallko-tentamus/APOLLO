-- Verification for migrations 042 and 043. 042: a control counted 0 (the helper that recognizes a calculation that is
-- undefined only because a count is 0). 043: trending: the permissions and who holds them, saved charts (one name per
-- lab, rules, QC Review only for QC charts, frozen limits with their baseline and who froze them, nothing else charted
-- while frozen), signal reviews (one per signal, an outcome and a comment, kept with their signal), the audit links.
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
CREATE OR REPLACE FUNCTION pg_temp.tras(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.trcfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.tru(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.trc(n text) RETURNS trend_chart LANGUAGE sql AS $$ SELECT * FROM trend_chart WHERE chart_name = n AND site_id = pg_temp.trcfl() $$;

-- people at CFL: a Lab Supervisor and an analyst
SELECT pg_temp.tras('akiddle');
SELECT script_signature('Rule test', false);
INSERT INTO app_user (username, full_name) VALUES ('tr.sup', 'TR Supervisor'), ('tr.ana', 'TR Analyst') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.tru('tr.sup') FROM lab_group g WHERE g.site_id = pg_temp.trcfl() AND g.group_name = 'Lab Supervisor' ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.tru('tr.ana') FROM lab_group g WHERE g.site_id = pg_temp.trcfl() AND g.group_name = 'Analyst' ON CONFLICT DO NOTHING;
SELECT set_config('lims.signature_id', '', false);

-- 042: the control counted 0
SELECT pg_temp.expect_true('042: a log of zero with a count of 0 is "undefined at zero"',
  calc_undefined_at_zero('The formula takes the log or root of a value that is zero or negative (log10 of 0)', '{"count.reading": 0, "dilution": 10}'));
SELECT pg_temp.expect_true('042: not when the count is not 0 (a negative value from something else)',
  NOT calc_undefined_at_zero('The formula takes the log or root of a value that is zero or negative', '{"count.reading": 5, "blank": -3}'));
SELECT pg_temp.expect_true('042: not for another reason to wait (a reading still missing)',
  NOT calc_undefined_at_zero('Waiting for count.reading', '{"count.reading": 0}') AND NOT calc_undefined_at_zero(NULL, '{"count.reading": 0}'));

-- 0. permissions
SELECT pg_temp.expect_true('trending.view: Analyst, Lab Supervisor, QA, General Manager and Project Manager; not Accounting',
  user_has_permission_at(pg_temp.tru('tr.ana'), 'trending.view', pg_temp.trcfl()) AND user_has_permission_at(pg_temp.tru('tr.sup'), 'trending.view', pg_temp.trcfl())
  AND (SELECT bool_and('trending.view' = ANY(permissions)) FROM standard_group_template WHERE group_name IN ('Analyst', 'Lab Supervisor', 'QA', 'General Manager', 'Project Manager'))
  AND NOT EXISTS (SELECT 1 FROM standard_group_template WHERE group_name = 'Accounting' AND 'trending.view' = ANY(permissions)));
SELECT pg_temp.expect_true('trending.manage: Lab Supervisor and QA, not the Analyst',
  user_has_permission_at(pg_temp.tru('tr.sup'), 'trending.manage', pg_temp.trcfl()) AND NOT user_has_permission_at(pg_temp.tru('tr.ana'), 'trending.manage', pg_temp.trcfl())
  AND (SELECT 'trending.manage' = ANY(permissions) FROM standard_group_template WHERE group_name = 'QA'));
SELECT pg_temp.expect_ok('Canned reasons can be kept for the Trending module', $$INSERT INTO reason_code (module, reason_text) VALUES ('Trending', 'Rule test reason')$$);

-- 1. saved charts
SELECT pg_temp.tras('tr.ana');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot save a chart, trending.manage (TrendingService)
SELECT pg_temp.tras('tr.sup');
SELECT pg_temp.expect_ok('The Lab Supervisor saves a chart', $$INSERT INTO trend_chart (site_id, chart_name, source, params) VALUES (pg_temp.trcfl(), 'TR fridge', 'logbook', '{"logbook_id":"x","field_key":"temperature"}')$$);
SELECT pg_temp.expect_true('It is numbered TC-, watched, with every rule, made by the supervisor',
  (pg_temp.trc('TR fridge')).chart_code LIKE 'TC-%' AND (pg_temp.trc('TR fridge')).watch AND (pg_temp.trc('TR fridge')).rules = '{R1,R2,R3,R4,R5,LIM}' AND (pg_temp.trc('TR fridge')).created_by = pg_temp.tru('tr.sup'));
SELECT pg_temp.expect_error_like('One active chart per name at a lab', $$INSERT INTO trend_chart (site_id, chart_name, source) VALUES (pg_temp.trcfl(), ' tr FRIDGE ', 'pareto')$$, 'trend_chart_name_uq');
SELECT pg_temp.expect_error_like('Rules are the known ones only', $$INSERT INTO trend_chart (site_id, chart_name, source, rules) VALUES (pg_temp.trcfl(), 'TR bad rule', 'counts', '{R1,R9}')$$, 'check');
SELECT pg_temp.expect_error_like('Sources are the known ones only', $$INSERT INTO trend_chart (site_id, chart_name, source) VALUES (pg_temp.trcfl(), 'TR bad source', 'invoices')$$, 'check');
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): only QC charts are shown in QC Review
SELECT pg_temp.expect_ok('A QC chart can be', $$INSERT INTO trend_chart (site_id, chart_name, source, params, show_in_review) VALUES (pg_temp.trcfl(), 'TR LCS', 'qc', '{"test_id":"x"}', true)$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a chart stays with its lab

-- 2. frozen limits
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): frozen limits need their baseline (at least 2 points)
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): and a sigma
SELECT pg_temp.expect_ok('Limits frozen from a baseline of 25 points', $$UPDATE trend_chart SET frozen_cl = 5, frozen_sigma = 0.5, frozen_n = 25, frozen_from = '2026-01-01', frozen_to = '2026-06-30' WHERE id = (pg_temp.trc('TR fridge')).id$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): who froze them and when (TrendChartRepository stamps them)
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): while frozen, the chart cannot chart something else
SELECT pg_temp.expect_ok('Its name and rules can still change', $$UPDATE trend_chart SET chart_name = 'TR fridge 1', rules = '{R1,LIM}' WHERE id = (pg_temp.trc('TR fridge')).id$$);
SELECT pg_temp.tras('tr.ana');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot unfreeze limits (TrendingService)
SELECT pg_temp.tras('tr.sup');
SELECT pg_temp.expect_ok('The supervisor unfreezes them (limits from the data again)', $$UPDATE trend_chart SET frozen_cl = NULL WHERE id = (pg_temp.trc('TR fridge 1')).id$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): unfreezing clears the whole baseline
SELECT pg_temp.expect_ok('Then it can chart something else', $$UPDATE trend_chart SET params = '{"logbook_id":"x","field_key":"humidity"}' WHERE id = (pg_temp.trc('TR fridge 1')).id$$);

-- 3. signal reviews
SELECT pg_temp.tras('tr.ana');
-- Moved to the Java backend in migration 072 (JUnit: PermissionChecksTest): an analyst cannot review a signal (TrendingService.reviewSignal)
SELECT pg_temp.tras('tr.sup');
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a review needs a comment
SELECT pg_temp.expect_error_like('and one of the outcomes', $$INSERT INTO trend_signal_review (chart_id, point_key, rule, outcome, comment) VALUES ((pg_temp.trc('TR fridge 1')).id, 'entry-1', 'R1', 'Ignored', 'x')$$, 'check');
SELECT pg_temp.expect_ok('The supervisor reviews the signal', $$INSERT INTO trend_signal_review (chart_id, point_key, point_label, rule, outcome, comment)
  VALUES ((pg_temp.trc('TR fridge 1')).id, 'entry-1', 'LBE-000001', 'R1', 'Action taken', 'Door left open during the restock')$$);
SELECT pg_temp.expect_true('Recorded with who and when', (SELECT reviewed_by = pg_temp.tru('tr.sup') AND reviewed_at IS NOT NULL FROM trend_signal_review WHERE point_key = 'entry-1'));
SELECT pg_temp.expect_error_like('One active review per signal', $$INSERT INTO trend_signal_review (chart_id, point_key, rule, outcome, comment) VALUES ((pg_temp.trc('TR fridge 1')).id, 'entry-1', 'R1', 'Expected (known cause)', 'x')$$, 'trend_signal_review_uq');
SELECT pg_temp.expect_ok('Another rule at the same point is its own signal', $$INSERT INTO trend_signal_review (chart_id, point_key, rule, outcome, comment) VALUES ((pg_temp.trc('TR fridge 1')).id, 'entry-1', 'LIM', 'Linked to an OOS or deviation', 'DEV-12')$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a review stays with its signal (Java never moves one)
SELECT pg_temp.expect_ok('A review is replaced by retiring it first', $$UPDATE trend_signal_review SET status = 'Inactive' WHERE point_key = 'entry-1' AND rule = 'R1';
  INSERT INTO trend_signal_review (chart_id, point_key, rule, outcome, comment) VALUES ((pg_temp.trc('TR fridge 1')).id, 'entry-1', 'R1', 'Investigated: no action', 'Re-checked: probe reading was right')$$);

-- 4. the audit trail
SELECT pg_temp.expect_true('The audit trail links charts and reviews to the chart page',
  (SELECT audit_record_ref('trend_chart', id, to_jsonb(c)) ->> 'href' = '#/trending/charts/' || id FROM trend_chart c WHERE id = (pg_temp.trc('TR fridge 1')).id)
  AND (SELECT audit_record_ref('trend_signal_review', id, to_jsonb(r)) ->> 'label' LIKE 'Signal review on TC-%: LBE-000001' FROM trend_signal_review r WHERE point_key = 'entry-1' AND rule = 'R1' AND status = 'Inactive')
  AND EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'trend_chart' AND record_id = (pg_temp.trc('TR fridge 1')).id AND action = 'UPDATE'));

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
