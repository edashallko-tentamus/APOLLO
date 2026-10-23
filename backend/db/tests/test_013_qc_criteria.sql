-- Verification for migration 014 (WD-1.2): QC criteria per analyte (each QC criterion lists every analyte of the test,
-- whether it applies, and its own limit), the earlier default + exceptions layout still read, LOQ / LOD hidden on the
-- report, and a Weighing tolerance in %. Runs after test_011 and test_012 (uses the "WD Metals (soil)" Draft).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Draft edited', false);
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.v() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Metals (soil)' AND v.status = 'Draft' $$;
-- the Draft's analytes, in order: a1, a2, ...
CREATE OR REPLACE FUNCTION pg_temp.a(n integer) RETURNS uuid LANGUAGE sql AS $$
  SELECT analyte_id FROM test_version_analyte WHERE test_version_id = pg_temp.v() AND status = 'Active' ORDER BY sort_order, analyte_id OFFSET n - 1 LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.has_problem(sev text, pat text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) WHERE severity = sev AND problem ILIKE '%' || pat || '%') $$;
CREATE OR REPLACE FUNCTION pg_temp.batch(qc jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE workflow_step SET config = jsonb_build_object('max_samples', 20, 'qc', qc) WHERE test_version_id = pg_temp.v() AND step_type = 'Batching' $$;

SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_true('The soil Draft has at least two analytes to set QC limits for', pg_temp.a(2) IS NOT NULL);

-- the earlier layout: one default and exceptions
SELECT pg_temp.batch(jsonb_build_array(jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Recovery %', 'min', 75, 'max', 125, 'overrides', jsonb_build_array(jsonb_build_object('analyte_id', pg_temp.a(2), 'min', 70, 'max', 130)))))));
SELECT pg_temp.expect_true('Earlier layout: an analyte without an exception gets the default (75 to 125)',
  (SELECT min_value = 75 AND max_value = 125 AND source = 'Default' FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Matrix Spike' AND analyte_id = pg_temp.a(1)));
SELECT pg_temp.expect_true('Earlier layout: the exception still applies (70 to 130)',
  (SELECT min_value = 70 AND max_value = 130 AND source = 'Exception' FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Matrix Spike' AND analyte_id = pg_temp.a(2)));
SELECT pg_temp.expect_true('Every analyte of the test gets a row for every QC criterion',
  (SELECT count(*) FROM qc_criteria(pg_temp.v())) = (SELECT count(*) FROM test_version_analyte WHERE test_version_id = pg_temp.v() AND status = 'Active'));

-- per analyte: every analyte listed with its own limit; one does not apply
SELECT pg_temp.batch(jsonb_build_array(jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Recovery %', 'min', 80, 'max', 120, 'analytes', jsonb_build_array(
    jsonb_build_object('analyte_id', pg_temp.a(1), 'applies', true, 'min', 80, 'max', 120),
    jsonb_build_object('analyte_id', pg_temp.a(2), 'applies', false))))),
  jsonb_build_object('qc_type', 'Method Blank', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Blank threshold', 'limit_ref', '½ LOQ', 'analytes', jsonb_build_array(
    jsonb_build_object('analyte_id', pg_temp.a(1), 'applies', true, 'limit_ref', '½ LOQ'),
    jsonb_build_object('analyte_id', pg_temp.a(2), 'applies', true, 'max', 0.004)))))));
SELECT pg_temp.expect_true('Per analyte: the analyte''s own limit is used (source Analyte)',
  (SELECT min_value = 80 AND max_value = 120 AND applies AND source = 'Analyte' FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Matrix Spike' AND analyte_id = pg_temp.a(1)));
SELECT pg_temp.expect_true('Per analyte: an unticked analyte is not judged by that QC',
  (SELECT NOT applies FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Matrix Spike' AND analyte_id = pg_temp.a(2)));
SELECT pg_temp.expect_true('Per analyte: a blank threshold can be a limit of the analyte for one and a number for another',
  (SELECT limit_ref = '½ LOQ' FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Method Blank' AND analyte_id = pg_temp.a(1))
  AND (SELECT max_value = 0.004 AND limit_ref IS NULL FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Method Blank' AND analyte_id = pg_temp.a(2)));
SELECT pg_temp.expect_true('A complete per-analyte table gives no problems for the Batching step',
  NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) p JOIN workflow_step s ON s.step_key = p.step_key AND s.test_version_id = pg_temp.v() WHERE s.step_type = 'Batching'));

-- what stops approval
SELECT pg_temp.batch(jsonb_build_array(jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Recovery %', 'min', 80, 'max', 120, 'analytes', jsonb_build_array(
    jsonb_build_object('analyte_id', pg_temp.a(1), 'applies', true, 'min', 130, 'max', 120)))))));
SELECT pg_temp.expect_true('An analyte that applies needs its minimum and maximum (min not above max)', pg_temp.has_problem('Error', 'Recovery % for % enter a minimum and a maximum'));
SELECT pg_temp.batch(jsonb_build_array(jsonb_build_object('qc_type', 'Method Blank', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Blank threshold', 'max', 0.01, 'analytes', jsonb_build_array(
    jsonb_build_object('analyte_id', pg_temp.a(1), 'applies', true)))))));
SELECT pg_temp.expect_true('A blank threshold for an analyte needs a maximum or a limit (LOQ, ½ LOQ, LOD)', pg_temp.has_problem('Error', 'Blank threshold for % enter a maximum, or LOQ'));
SELECT pg_temp.batch((SELECT jsonb_build_array(jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Recovery %', 'min', 80, 'max', 120, 'analytes', jsonb_agg(jsonb_build_object('analyte_id', analyte_id, 'applies', false))))))
  FROM test_version_analyte WHERE test_version_id = pg_temp.v() AND status = 'Active'));
SELECT pg_temp.expect_true('A criterion that applies to no analyte stops approval', pg_temp.has_problem('Error', 'applies to no analyte'));
SELECT pg_temp.batch(jsonb_build_array(jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(
  jsonb_build_object('limit_type', 'Recovery %', 'min', 80, 'max', 120, 'analytes', jsonb_build_array(
    jsonb_build_object('analyte_id', pg_temp.a(1), 'applies', true, 'min', 80, 'max', 120),
    jsonb_build_object('analyte_id', (SELECT id FROM analyte WHERE analyte_name = 'Sodium'), 'applies', true, 'min', 1, 'max', 2)))))));
SELECT pg_temp.expect_true('A limit for an analyte no longer on the test is only a warning, and is ignored',
  pg_temp.has_problem('Warning', 'no longer on the test') AND NOT pg_temp.has_problem('Error', 'Matrix Spike')
  AND NOT EXISTS (SELECT 1 FROM qc_criteria(pg_temp.v()) WHERE analyte_name = 'Sodium'));
SELECT pg_temp.expect_true('An analyte added after the table was set uses the criterion''s default until set',
  (SELECT min_value = 80 AND max_value = 120 AND applies AND source = 'Default' FROM qc_criteria(pg_temp.v()) WHERE qc_type = 'Matrix Spike' AND analyte_id = pg_temp.a(2)));
SELECT pg_temp.expect_true('Qualitative criteria take no numbers per analyte (Presence)', (SELECT shape FROM qc_limit_type WHERE limit_type = 'Presence') = 'Qualitative');

-- Weighing tolerance in %
UPDATE workflow_step SET config = '{"target_mode": "Single", "target": 0.5, "tolerance": 10, "tolerance_unit": "%", "unit": "g"}' WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing';
SELECT pg_temp.expect_true('A weighing tolerance can be in % (0.5 g ± 10%)',
  NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) p JOIN workflow_step s ON s.step_key = p.step_key AND s.test_version_id = pg_temp.v() WHERE s.step_type = 'Weighing'));
UPDATE workflow_step SET config = '{"target_mode": "Single", "target": 0.5, "tolerance": 150, "tolerance_unit": "%", "unit": "g"}' WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing';
SELECT pg_temp.expect_true('A tolerance in % cannot be more than 100', pg_temp.has_problem('Error', 'cannot be more than 100'));
UPDATE workflow_step SET config = '{"target_mode": "Single", "target": 0.5, "tolerance": 0.05, "tolerance_unit": "mL", "unit": "g"}' WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing';
SELECT pg_temp.expect_true('The tolerance is in % or in the weighing unit', pg_temp.has_problem('Error', 'in % or in g'));
UPDATE workflow_step SET config = '{"target_mode": "Single", "target": 0.5, "tolerance": 0.05, "unit": "g"}' WHERE test_version_id = pg_temp.v() AND step_type = 'Weighing';
SELECT pg_temp.expect_true('Without a tolerance unit the tolerance is in the weighing unit, as before', NOT pg_temp.has_problem('Error', 'tolerance is in'));

-- LOQ and LOD hidden on the report, carried by copies
UPDATE test_version_analyte SET hide_lod = true WHERE test_version_id = pg_temp.v() AND analyte_id = pg_temp.a(1);
UPDATE test_version_analyte SET hide_loq = true WHERE test_version_id = pg_temp.v() AND analyte_id = pg_temp.a(2);
SELECT pg_temp.expect_true('LOQ and LOD can each be hidden on the report', (SELECT count(*) FROM test_version_analyte WHERE test_version_id = pg_temp.v() AND (hide_loq OR hide_lod)) = 2);
SELECT copy_test((SELECT id FROM test WHERE test_name = 'WD Metals (soil)'), (SELECT site_id FROM test WHERE test_name = 'WD Metals (soil)'), 'WD Metals (soil) copy');
SELECT pg_temp.expect_true('A duplicate keeps which limits are hidden',
  (SELECT count(*) FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Metals (soil) copy' AND (a.hide_loq OR a.hide_lod)) = 2);
SELECT pg_temp.expect_true('A duplicate keeps the per-analyte QC table',
  (SELECT count(*) FROM test_version v JOIN test t ON t.id = v.test_id, qc_criteria(v.id) q WHERE t.test_name = 'WD Metals (soil) copy' AND q.source = 'Analyte') >= 1);

SELECT pg_temp.as_user('akiddle');
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
