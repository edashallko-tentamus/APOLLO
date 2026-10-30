-- Verification for migration 044 (0.24.1): QA approval of trend charts (who may approve, signed, never by whoever made
-- or changed the chart, a change sends it back to QA, QA review cannot be edited away except by QA, a chart in QC Review
-- is always QA reviewed), and an approved QC chart's frozen limits carried into a Draft version of its test.
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
CREATE OR REPLACE FUNCTION pg_temp.qas(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
  PERFORM set_config('lims.signature_id', '', false);
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.qcfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.qu(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.qc(n text) RETURNS trend_chart LANGUAGE sql AS $$ SELECT * FROM trend_chart WHERE chart_name = n AND site_id = pg_temp.qcfl() $$;

-- people at CFL: a Lab Supervisor (makes charts), a second Lab Supervisor, a QA reviewer
SELECT pg_temp.qas('akiddle');
SELECT script_signature('Rule test', false);
INSERT INTO app_user (username, full_name) VALUES ('tq.sup', 'TQ Supervisor'), ('tq.sup2', 'TQ Supervisor 2'), ('tq.qa', 'TQ QA') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.qu(u) FROM lab_group g, unnest(ARRAY['tq.sup','tq.sup2']) u WHERE g.site_id = pg_temp.qcfl() AND g.group_name = 'Lab Supervisor' ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.qu('tq.qa') FROM lab_group g WHERE g.site_id = pg_temp.qcfl() AND g.group_name = 'QA' ON CONFLICT DO NOTHING;
SELECT set_config('lims.signature_id', '', false);

-- a QC check to chart: a CFL test whose effective version has a numeric criterion on a QC type, and one of its analytes
CREATE TEMP TABLE IF NOT EXISTS tq_qc (test_id uuid, qc_type text, limit_type text, analyte_id uuid);
DELETE FROM tq_qc;
INSERT INTO tq_qc
SELECT t.id, q->>'qc_type', cr->>'limit_type', tva.analyte_id
  FROM test t JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
  JOIN workflow_step ws ON ws.test_version_id = tv.id AND ws.step_type = 'Batching' AND ws.status = 'Active'
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ws.config->'qc', '[]')) q CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q->'criteria', '[]')) cr
  JOIN qc_limit_type lt ON lt.limit_type = cr->>'limit_type' AND lt.shape = 'Range'
  JOIN test_version_analyte tva ON tva.test_version_id = tv.id AND tva.status = 'Active'
 WHERE t.site_id = pg_temp.qcfl() AND NOT EXISTS (SELECT 1 FROM test_version d WHERE d.test_id = t.id AND d.status = 'Draft')
 ORDER BY t.test_code, tva.sort_order LIMIT 1;
SELECT pg_temp.expect_true('(fixture: a CFL test with a numeric QC criterion and no Draft version)', (SELECT count(*) FROM tq_qc) = 1);

-- 0. the permission
SELECT pg_temp.expect_true('trending.approve: QA, not the Lab Supervisor',
  user_has_permission_at(pg_temp.qu('tq.qa'), 'trending.approve', pg_temp.qcfl()) AND NOT user_has_permission_at(pg_temp.qu('tq.sup'), 'trending.approve', pg_temp.qcfl())
  AND (SELECT 'trending.approve' = ANY(permissions) FROM standard_group_template WHERE group_name = 'QA'));

-- 1. QA status follows what the chart is
SELECT pg_temp.qas('tq.sup');
SELECT pg_temp.expect_ok('A chart without QA review', $$INSERT INTO trend_chart (site_id, chart_name, source, params) VALUES (pg_temp.qcfl(), 'TQ plain', 'counts', '{"metric":"oos_opened"}')$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a chart without QA review needs no QA approval
SELECT pg_temp.expect_ok('A QA reviewable QC chart', format($$INSERT INTO trend_chart (site_id, chart_name, source, params, qa_review, qa_status) VALUES (pg_temp.qcfl(), 'TQ QC chart', 'qc', %L::jsonb, true, 'Awaiting QA')$$,
  (SELECT jsonb_build_object('test_id', test_id, 'qc_type', qc_type, 'limit_type', limit_type, 'analyte_id', analyte_id) FROM tq_qc)));
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a QA reviewable chart waits for QA
SELECT pg_temp.expect_ok('A QC chart shown in QC Review', format($$INSERT INTO trend_chart (site_id, chart_name, source, params, show_in_review, qa_review, qa_status) VALUES (pg_temp.qcfl(), 'TQ in review', 'qc', %L::jsonb, true, true, 'Awaiting QA')$$,
  (SELECT jsonb_build_object('test_id', test_id) FROM tq_qc)));
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a chart in QC Review is QA reviewed all the same, and waits for QA
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): nobody sets a chart Approved by editing it (only QA's signed approval)
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest; TrendingService asks trending.approve): a Lab Supervisor cannot take a chart off QA review
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a chart in QC Review cannot be taken off QA review

-- 2. QA's approval
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a Lab Supervisor cannot approve a chart (trending.approve), approval
-- is signed, Approved with who, when and the signature, not twice, and a chart without QA review has nothing to approve
SELECT pg_temp.qas('tq.qa');

-- 3. a change sends it back to QA; whoever changed it cannot approve it
SELECT pg_temp.qas('tq.sup');
SELECT pg_temp.expect_ok('The supervisor changes the chart''s rules', $$UPDATE trend_chart SET rules = '{R1,R2}' WHERE id = (pg_temp.qc('TQ QC chart')).id$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): a change sends it back to Awaiting QA, the earlier approval cleared
SELECT pg_temp.qas('tq.sup2');
SELECT pg_temp.expect_ok('Another supervisor freezes its limits from a baseline', $$UPDATE trend_chart SET frozen_cl = 100, frozen_sigma = 4, frozen_n = 20 WHERE id = (pg_temp.qc('TQ QC chart')).id$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): frozen limits wait for QA too
SELECT pg_temp.expect_true('The limits cannot go to the test before QA approves them',
  (SELECT problem FROM trend_limits_for_test((pg_temp.qc('TQ QC chart')).id)) LIKE 'QA approves%');
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): whoever froze the limits cannot approve the chart
SELECT pg_temp.qas('tq.qa');
-- (fixture: QA's approval, which Java records since migration 070)
UPDATE trend_chart SET qa_status = 'Approved', qa_approved_by = pg_temp.qu('tq.qa'), qa_approved_at = clock_timestamp() WHERE id = (pg_temp.qc('TQ QC chart')).id;
SELECT pg_temp.expect_true('Its limits for the test: centre line ± 3 sigma (88 to 112), no problem',
  (SELECT problem IS NULL AND lcl = 88 AND ucl = 112 FROM trend_limits_for_test((pg_temp.qc('TQ QC chart')).id)));

-- 4. the limits into the test: only into a Draft version, signed, by someone with methods.design
SELECT pg_temp.qas('tq.sup');
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): the limits go only into a Draft version of the chart's test, not the
-- effective one; the chart keeps the version, who and when, and stays approved
SELECT script_signature('Changed by', false);
CREATE TEMP TABLE IF NOT EXISTS tq_v (id uuid); DELETE FROM tq_v;
SELECT pg_temp.expect_ok('A Draft version of the test (signed)', $$INSERT INTO tq_v SELECT new_test_version((SELECT test_id FROM tq_qc))$$);
SELECT pg_temp.expect_true('A chart charting each analyte cannot carry limits to a test',
  (SELECT problem FROM trend_limits_for_test((pg_temp.qc('TQ in review')).id)) IS NOT NULL);

-- 5. QA can take a chart off QA review
SELECT pg_temp.qas('tq.qa');
SELECT pg_temp.expect_ok('QA takes a chart off QA review', $$UPDATE trend_chart SET qa_review = false WHERE id = (pg_temp.qc('TQ QC chart')).id$$);
-- Moved to the Java backend in migration 070 (JUnit: TrendChartRulesTest): off QA review, no QA approval is needed any more

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
