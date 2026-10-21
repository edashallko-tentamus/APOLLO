-- Verification for migration 012 (Workflow Designer, WD-1): methods permissions, department groups, methods (SOPs),
-- tests owned by a lab, draft-only editing, analytes, steps with equipment and dependencies (no loops), formulas and
-- the calculation engine, rounding and below-LOQ reporting, the problem list, signed approval by someone who did not
-- work on the version, new versions, duplicates and copies to another lab, ordering only at the test's lab, and
-- specifications on quotes carried to orders.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.can(u text, code text, site text) RETURNS boolean LANGUAGE sql AS $$
  SELECT user_has_permission_at(pg_temp.uid(u), code, pg_temp.site(site)) $$;
CREATE OR REPLACE FUNCTION pg_temp.dept(site text, code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT d.id FROM department d JOIN lab_site s ON s.id = d.site_id WHERE s.site_code = site AND d.department_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.etype(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT e.id FROM equipment_type e JOIN lab_site s ON s.id = e.site_id WHERE s.site_code = site AND e.type_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.tst(n text, site text DEFAULT 'CFL') RETURNS uuid LANGUAGE sql AS $$
  SELECT t.id FROM test t JOIN lab_site s ON s.id = t.site_id WHERE t.test_name = n AND s.site_code = site $$;
CREATE OR REPLACE FUNCTION pg_temp.ver(n text, no int, site text DEFAULT 'CFL') RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM test_version WHERE test_id = pg_temp.tst(n, site) AND version_no = no $$;
CREATE OR REPLACE FUNCTION pg_temp.step(v uuid, k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = k AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.errors(v uuid) RETURNS integer LANGUAGE sql AS $$ SELECT count(*)::int FROM test_version_problems(v) WHERE severity = 'Error' $$;
CREATE OR REPLACE FUNCTION pg_temp.has_problem(v uuid, pat text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM test_version_problems(v) WHERE problem ILIKE '%' || pat || '%') $$;

-- People and their groups
INSERT INTO app_user (username, full_name) VALUES ('wd.ana', 'WD Analyst'), ('wd.ana2', 'WD Analyst Two'), ('wd.sup', 'WD Supervisor'),
 ('wd.qa', 'WD QA'), ('wd.int', 'WD Intake'), ('wd.tps', 'WD TPS Supervisor');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES
 (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('wd.ana')), (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('wd.ana2')), (pg_temp.grp('CFL', 'Lab Supervisor'), pg_temp.uid('wd.sup')),
 (pg_temp.grp('CFL', 'QA'), pg_temp.uid('wd.qa')), (pg_temp.grp('TPS', 'QA'), pg_temp.uid('wd.qa')), (pg_temp.grp('CFL', 'Intake'), pg_temp.uid('wd.int')),
 (pg_temp.grp('TPS', 'Lab Supervisor'), pg_temp.uid('wd.tps'));
SELECT pg_temp.expect_true('Methods permissions: Analysts design; Lab Supervisors and QA design and approve; Intake neither',
  pg_temp.can('wd.ana', 'methods.design', 'CFL') AND NOT pg_temp.can('wd.ana', 'methods.approve', 'CFL')
  AND pg_temp.can('wd.sup', 'methods.design', 'CFL') AND pg_temp.can('wd.sup', 'methods.approve', 'CFL')
  AND pg_temp.can('wd.qa', 'methods.approve', 'CFL') AND NOT pg_temp.can('wd.int', 'methods.design', 'CFL'));
SELECT pg_temp.expect_true('The standard group templates include the new permissions (new labs get them)',
  (SELECT 'methods.design' = ANY(permissions) FROM standard_group_template WHERE group_name = 'Analyst')
  AND (SELECT 'methods.approve' = ANY(permissions) FROM standard_group_template WHERE group_name = 'QA'));

-- Departments, equipment types, a department group
INSERT INTO department (site_id, department_code, department_name) VALUES (pg_temp.site('CFL'), 'WDC', 'WD Chemistry'), (pg_temp.site('TPS'), 'WDC', 'WD Chemistry'),
 (pg_temp.site('CFL'), 'WDM', 'WD Micro');
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'WD Balance'), (pg_temp.site('CFL'), 'WD ICP-MS'), (pg_temp.site('TPS'), 'WD Balance');
SELECT pg_temp.expect_error_like('A department group names its own lab''s department',
  $$INSERT INTO lab_group (site_id, group_name, department_id) VALUES (pg_temp.site('CFL'), 'WD Wrong', pg_temp.dept('TPS', 'WDC'))$$, 'own lab');
INSERT INTO lab_group (site_id, group_name, description, department_id) VALUES (pg_temp.site('CFL'), 'WD Chemistry team', 'Chemistry department', pg_temp.dept('CFL', 'WDC'));
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'WD Chemistry team'), pg_temp.uid('wd.ana'));
SELECT pg_temp.expect_true('Department membership comes from department groups',
  user_in_department(pg_temp.uid('wd.ana'), pg_temp.dept('CFL', 'WDC')) AND NOT user_in_department(pg_temp.uid('wd.ana2'), pg_temp.dept('CFL', 'WDC'))
  AND NOT user_in_department(pg_temp.uid('akiddle'), pg_temp.dept('CFL', 'WDC')));

-- Methods and a new test (draft edits: the screens give the reason "Draft edited" when none is typed)
SELECT set_config('lims.reason', 'Draft edited', false);
SELECT pg_temp.as_user('wd.int');
SELECT pg_temp.expect_error_like('Intake cannot create tests', $$SELECT create_test(pg_temp.site('CFL'), 'WD Metals', NULL)$$, 'methods.design');
SELECT pg_temp.expect_error_like('Intake cannot add methods', $$INSERT INTO method (site_id, method_name) VALUES (pg_temp.site('CFL'), 'WD nope')$$, 'methods.design');
SELECT pg_temp.as_user('wd.ana');
INSERT INTO method (site_id, method_name, sop_code) VALUES (pg_temp.site('CFL'), 'WD Elemental impurities by ICP-MS', ' SOP-CHEM-101 ');
SELECT pg_temp.expect_true('A method gets its code; the SOP code is trimmed', (SELECT method_code LIKE 'MTH-%' AND sop_code = 'SOP-CHEM-101' FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS'));
SELECT create_test(pg_temp.site('CFL'), 'WD Metals', pg_temp.dept('CFL', 'WDC'), (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS'));
SELECT pg_temp.expect_true('An analyst creates a test: Draft version 1 with the method, an unpriced catalogue entry, 3 significant figures by default',
  (SELECT status = 'Draft' AND method_id IS NOT NULL AND rounding_mode = 'Significant figures' AND rounding_digits = 3 FROM test_version WHERE id = pg_temp.ver('WD Metals', 1))
  AND EXISTS (SELECT 1 FROM test_catalog_entry WHERE test_id = pg_temp.tst('WD Metals')));
SELECT pg_temp.expect_error_like('An analyst cannot price it (catalog.edit)', $$UPDATE test_catalog_entry SET base_price = 99 WHERE test_id = pg_temp.tst('WD Metals')$$, 'catalog.edit');
SELECT pg_temp.expect_error_like('A test''s department belongs to its lab', $$UPDATE test SET department_id = pg_temp.dept('TPS', 'WDC') WHERE id = pg_temp.tst('WD Metals')$$, 'own lab');
SELECT pg_temp.expect_error_like('A test cannot move to another lab', $$UPDATE test SET site_id = pg_temp.site('TPS') WHERE id = pg_temp.tst('WD Metals')$$, 'copy it');
SELECT pg_temp.expect_error_like('A new version cannot start Effective', $$INSERT INTO test_version (test_id, version_no, status) VALUES (pg_temp.tst('WD Metals'), 2, 'Effective')$$, 'approved');
SELECT pg_temp.expect_error_like('A version cannot be made Effective directly', $$UPDATE test_version SET status = 'Effective' WHERE id = pg_temp.ver('WD Metals', 1)$$, 'approved');

-- Analytes
SELECT pg_temp.as_user('akiddle');
INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('WD Lead', 'Lead', 'Chemical'), ('WD Cadmium', 'Cadmium', 'Chemical'), ('WD Salmonella', 'Salmonella', 'Microbiological');
SELECT pg_temp.as_user('wd.ana');
INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod) VALUES
 (pg_temp.ver('WD Metals', 1), pg_temp.an('WD Lead'), 1, 'Numeric', 'MG/KG', 0.010, 0.005),
 (pg_temp.ver('WD Metals', 1), pg_temp.an('WD Cadmium'), 2, 'Numeric', NULL, 0.010, 0.003);
SELECT pg_temp.expect_true('The reporting unit is matched to the Units list', (SELECT reporting_unit FROM test_version_analyte WHERE analyte_id = pg_temp.an('WD Lead')) = 'mg/kg');
SELECT pg_temp.expect_error_like('A unit not on the Units list is refused',
  $$UPDATE test_version_analyte SET reporting_unit = 'furlongs' WHERE analyte_id = pg_temp.an('WD Lead')$$, 'Units list');
SELECT pg_temp.expect_error('The LOD cannot be above the LOQ', $$UPDATE test_version_analyte SET lod = 0.02 WHERE analyte_id = pg_temp.an('WD Lead')$$);
SELECT pg_temp.expect_error('An analyte appears once per version', $$INSERT INTO test_version_analyte (test_version_id, analyte_id) VALUES (pg_temp.ver('WD Metals', 1), pg_temp.an('WD Lead'))$$);
SELECT pg_temp.expect_true('Problems: Cadmium has no reporting unit; no steps yet',
  pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'Cadmium: a numeric result needs a reporting unit') AND pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'Add the workflow steps'));
UPDATE test_version_analyte SET reporting_unit = 'mg/kg' WHERE analyte_id = pg_temp.an('WD Cadmium');

-- Workflow steps: batch -> weigh -> digest -> dilute -> read -> calc -> review
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.ver('WD Metals', 1), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 20, "qc": [{"qc_type": "Method Blank", "qc_class": "Prep", "frequency": "Once", "count": 1,
    "criteria": [{"limit_type": "Blank threshold", "limit_ref": "½ LOQ"}]}, {"qc_type": "CCV", "qc_class": "Analytical", "frequency": "Every N", "every_n": 10,
    "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}]}'),
 (pg_temp.ver('WD Metals', 1), 'weigh', 'Weigh', 'Weighing', 2, '{"target": 0.5, "tolerance": 0.05, "unit": "g"}'),
 (pg_temp.ver('WD Metals', 1), 'digest', 'Microwave digestion', 'Preparation', 3, '{"fields": [{"label": "Digest final volume (mL)", "type": "Number"}, {"label": "Program", "type": "Text"}]}'),
 (pg_temp.ver('WD Metals', 1), 'dil', 'Dilute', 'Dilution', 4, '{"mode": "Single", "aliquot": 10, "diluent": 40, "fields_per_entry": 3}'),
 (pg_temp.ver('WD Metals', 1), 'read', 'ICP-MS reading', 'Data Entry', 5, '{"value_label": "Concentration in solution", "value_unit": "µg/L", "require_attachment": true}'),
 (pg_temp.ver('WD Metals', 1), 'calc', 'Result', 'Calculation', 6, '{"formula": "{read.reading} * {dil.factor} * {digest.final_volume} / 1000 / {weigh.weight}"}'),
 (pg_temp.ver('WD Metals', 1), 'review', 'QC Review', 'QC Review', 7, '{}');
CREATE OR REPLACE FUNCTION pg_temp.link(v uuid, a text, b text, t dependency_type DEFAULT 'Sequential') RETURNS void LANGUAGE sql AS $$
  INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES (pg_temp.step(v, a), pg_temp.step(v, b), t) $$;
SELECT pg_temp.link(pg_temp.ver('WD Metals', 1), 'weigh', 'batch'), pg_temp.link(pg_temp.ver('WD Metals', 1), 'digest', 'weigh'),
       pg_temp.link(pg_temp.ver('WD Metals', 1), 'dil', 'digest'), pg_temp.link(pg_temp.ver('WD Metals', 1), 'read', 'dil'),
       pg_temp.link(pg_temp.ver('WD Metals', 1), 'calc', 'read'), pg_temp.link(pg_temp.ver('WD Metals', 1), 'review', 'calc');
SELECT pg_temp.expect_error_like('No loops: the first step cannot depend on a later one', $$SELECT pg_temp.link(pg_temp.ver('WD Metals', 1), 'batch', 'calc')$$, 'loop');
SELECT pg_temp.expect_error('A step cannot depend on itself', $$SELECT pg_temp.link(pg_temp.ver('WD Metals', 1), 'calc', 'calc')$$);
SELECT pg_temp.expect_error('Step keys are unique in a version',
  $$INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type) VALUES (pg_temp.ver('WD Metals', 1), 'calc', 'Again', 'Calculation')$$);
SELECT pg_temp.expect_error('Step keys are short lower-case words (used in formulas)',
  $$INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type) VALUES (pg_temp.ver('WD Metals', 1), 'Read 2', 'Again', 'Data Entry')$$);
SELECT pg_temp.expect_true('Problems: equipment missing on Weigh and the reading; the formula names a field Digestion does not offer',
  pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'Choose the equipment type for this weighing step')
  AND pg_temp.has_problem(pg_temp.ver('WD Metals', 1), '{digest.final_volume}: "Microwave digestion" offers {digest.digest_final_volume_ml}'));
UPDATE workflow_step SET config = jsonb_set(config, '{formula}', '"{read.reading} * {dil.factor} * {digest.digest_final_volume_ml} / 1000 / {weigh.weight}"')
 WHERE id = pg_temp.step(pg_temp.ver('WD Metals', 1), 'calc');
SELECT pg_temp.expect_error_like('Equipment types come from the test''s own lab',
  $$INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (pg_temp.step(pg_temp.ver('WD Metals', 1), 'weigh'), pg_temp.etype('TPS', 'WD Balance'), true)$$, 'own lab');
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES
 (pg_temp.step(pg_temp.ver('WD Metals', 1), 'weigh'), pg_temp.etype('CFL', 'WD Balance'), true),
 (pg_temp.step(pg_temp.ver('WD Metals', 1), 'read'), pg_temp.etype('CFL', 'WD ICP-MS'), false);
SELECT pg_temp.expect_true('Problem: the reading names an instrument but none is the main one', pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'exactly one equipment type as the main'));
UPDATE workflow_step_equipment SET is_main = true WHERE step_id = pg_temp.step(pg_temp.ver('WD Metals', 1), 'read');
-- a formula that uses a later step
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.ver('WD Metals', 1), 'early', 'Too early', 'Calculation', 4, '{"formula": "{calc.result} * 2"}');
SELECT pg_temp.link(pg_temp.ver('WD Metals', 1), 'early', 'weigh'), pg_temp.link(pg_temp.ver('WD Metals', 1), 'review', 'early');
SELECT pg_temp.expect_true('Problem: a formula cannot use a step that comes after it', pg_temp.has_problem(pg_temp.ver('WD Metals', 1), '{calc.result}: "Result" does not come before this step'));
UPDATE workflow_step SET status = 'Inactive' WHERE id = pg_temp.step(pg_temp.ver('WD Metals', 1), 'early');
SELECT pg_temp.expect_true('Removing a step removes its dependencies', NOT EXISTS (SELECT 1 FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id
  WHERE s.test_version_id = pg_temp.ver('WD Metals', 1) AND d.status = 'Active' AND (s.step_key = 'early' OR d.depends_on_step_id = (SELECT id FROM workflow_step WHERE step_key = 'early' AND test_version_id = pg_temp.ver('WD Metals', 1)))));
-- an end that is not a QC Review
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES (pg_temp.ver('WD Metals', 1), 'loose', 'Loose end', 'Preparation', 9, '{}');
SELECT pg_temp.link(pg_temp.ver('WD Metals', 1), 'loose', 'read');
SELECT pg_temp.expect_true('Problem: every branch must end in a QC Review', pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'every branch must end in a QC Review'));
UPDATE workflow_step SET status = 'Inactive' WHERE id = pg_temp.step(pg_temp.ver('WD Metals', 1), 'loose');
SELECT pg_temp.expect_true('The version now has no errors', pg_temp.errors(pg_temp.ver('WD Metals', 1)) = 0);
SELECT pg_temp.expect_true('Warning only: not priced yet is not a problem for approval', NOT pg_temp.has_problem(pg_temp.ver('WD Metals', 1), 'Nobody is in a group'));
SELECT pg_temp.expect_true('Steps are done by the department''s people: the analyst in the Chemistry group, not the other analyst',
  can_perform_step(pg_temp.uid('wd.ana'), pg_temp.step(pg_temp.ver('WD Metals', 1), 'weigh')) AND NOT can_perform_step(pg_temp.uid('wd.ana2'), pg_temp.step(pg_temp.ver('WD Metals', 1), 'weigh')));

-- The calculation engine
SELECT pg_temp.expect_true('Formula check: well formed', formula_check('max({a.b}, 2) * log10(100) / (1 + {c.d})') IS NULL);
SELECT pg_temp.expect_true('Formula check: problems found',
  formula_check('{a.b} +') LIKE '%ends with an operator%' AND formula_check('(2 * 3') LIKE '%not closed%' AND formula_check('foo(2)') LIKE '%not a step token or a known function%'
  AND formula_check('2 3') LIKE '%out of place%' AND formula_check('1, 2') LIKE '%comma%' AND formula_check('') IS NOT NULL);
SELECT pg_temp.expect_true('Formula evaluation: 25 µg/L x 5 x 50 mL / 1000 / 0.5 g = 12.5 mg/kg',
  formula_eval('{read.reading} * {dil.factor} * {digest.v} / 1000 / {weigh.weight}', '{"read.reading": 25, "dil.factor": 5, "digest.v": 50, "weigh.weight": 0.5}') = 12.5);
SELECT pg_temp.expect_true('Functions: log10, max, power and minus signs', formula_eval('log10(1000) + max(2, {a.b}) - power(2, 3) * -1', '{"a.b": 5}') = 16);
SELECT pg_temp.expect_error_like('Missing values are named', $$SELECT formula_eval('{a.b} * 2', '{}')$$, 'No numeric value for {a.b}');
SELECT pg_temp.expect_error_like('Division by zero is explained', $$SELECT formula_eval('1 / {a.b}', '{"a.b": 0}')$$, 'divides by zero');
SELECT pg_temp.expect_error_like('Text cannot be smuggled into a formula', $$SELECT formula_eval('1; DROP TABLE test', '{}')$$, 'out of place');
SELECT pg_temp.expect_true('Rounding: 3 significant figures, half up, trailing zeros kept',
  round_result(0.0012345, 'Significant figures', 3)::text = '0.00123' AND round_result(2.5, 'Significant figures', 3)::text = '2.50'
  AND round_result(1234.5, 'Significant figures', 3)::text = '1230' AND round_result(0.125, 'Decimal places', 2)::text = '0.13' AND round_result(0.0015, 'Significant figures', 1)::text = '0.002');
SELECT pg_temp.expect_true('Reported values: rounded, below the LOQ as "< LOQ"',
  report_value(12.3456, (SELECT id FROM test_version_analyte WHERE analyte_id = pg_temp.an('WD Lead'))) = '12.3'
  AND report_value(0.007, (SELECT id FROM test_version_analyte WHERE analyte_id = pg_temp.an('WD Lead'))) = '< 0.010');
UPDATE test_version SET nd_below_lod = true WHERE id = pg_temp.ver('WD Metals', 1);
UPDATE test_version_analyte SET rounding_mode = 'Decimal places', rounding_digits = 3 WHERE analyte_id = pg_temp.an('WD Cadmium');
SELECT pg_temp.expect_true('ND below the LOD when chosen; an analyte''s own rounding wins',
  report_value(0.004, (SELECT id FROM test_version_analyte WHERE analyte_id = pg_temp.an('WD Lead'))) = 'ND'
  AND report_value(1.23456, (SELECT id FROM test_version_analyte WHERE analyte_id = pg_temp.an('WD Cadmium'))) = '1.235');

-- Approval
SELECT pg_temp.as_user('wd.qa');
UPDATE test_version SET procedure_text = 'Weigh 0.5 g, digest, dilute to 50 mL, read on ICP-MS' WHERE id = pg_temp.ver('WD Metals', 1);
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('The analyst who built it cannot approve (no methods.approve)', $$SELECT approve_test_version(pg_temp.ver('WD Metals', 1))$$, 'methods.approve');
SELECT pg_temp.as_user('wd.qa');
SELECT pg_temp.expect_error_like('QA changed the version, so QA cannot approve it', $$SELECT approve_test_version(pg_temp.ver('WD Metals', 1))$$, 'someone else must approve');
SELECT pg_temp.user_only('wd.sup');
SELECT pg_temp.expect_error_like('Approval needs a signature', $$SELECT approve_test_version(pg_temp.ver('WD Metals', 1))$$, 'signature');
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.ver('WD Metals', 1));
SELECT pg_temp.expect_true('The Lab Supervisor approves: Effective, with the approver, time and signature',
  (SELECT status = 'Effective' AND approved_by = pg_temp.uid('wd.sup') AND approval_signature_id IS NOT NULL AND effective_from IS NOT NULL FROM test_version WHERE id = pg_temp.ver('WD Metals', 1)));
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error_like('An Effective version cannot be changed', $$UPDATE test_version SET procedure_text = 'x' WHERE id = pg_temp.ver('WD Metals', 1)$$, 'Start a new version');
SELECT pg_temp.expect_error_like('Nor its steps', $$UPDATE workflow_step SET step_name = 'x' WHERE id = pg_temp.step(pg_temp.ver('WD Metals', 1), 'weigh')$$, 'Start a new version');
SELECT pg_temp.expect_error_like('Nor its analytes', $$UPDATE test_version_analyte SET loq = 1 WHERE analyte_id = pg_temp.an('WD Lead')$$, 'Start a new version');

-- New version
SELECT new_test_version(pg_temp.tst('WD Metals'));
SELECT pg_temp.expect_true('A new version is a Draft copy: same analytes, steps, equipment and dependencies',
  (SELECT status = 'Draft' AND copied_from_version_id = pg_temp.ver('WD Metals', 1) AND procedure_text LIKE 'Weigh 0.5 g%' FROM test_version WHERE id = pg_temp.ver('WD Metals', 2))
  AND (SELECT count(*) FROM test_version_analyte WHERE test_version_id = pg_temp.ver('WD Metals', 2) AND status = 'Active') = 2
  AND (SELECT count(*) FROM workflow_step WHERE test_version_id = pg_temp.ver('WD Metals', 2) AND status = 'Active') = 7
  AND (SELECT count(*) FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id WHERE s.test_version_id = pg_temp.ver('WD Metals', 2) AND d.status = 'Active') = 6
  AND pg_temp.errors(pg_temp.ver('WD Metals', 2)) = 0);
SELECT pg_temp.expect_error_like('Only one Draft at a time', $$SELECT new_test_version(pg_temp.tst('WD Metals'))$$, 'already a Draft');
UPDATE test_version SET change_summary = 'Hold time added', procedure_text = 'Weigh 0.5 g, digest 20 min, dilute to 50 mL, read on ICP-MS' WHERE id = pg_temp.ver('WD Metals', 2);
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.ver('WD Metals', 2));
SELECT pg_temp.expect_true('Approving version 2 supersedes version 1', (SELECT string_agg(version_no || ':' || status, ',' ORDER BY version_no) FROM test_version WHERE test_id = pg_temp.tst('WD Metals')) = '1:Superseded,2:Effective');

-- Duplicate in the lab, copy to another lab
SELECT pg_temp.as_user('wd.ana');
SELECT pg_temp.expect_error('A duplicate needs its own name in the lab', $$SELECT copy_test(pg_temp.tst('WD Metals'), pg_temp.site('CFL'), 'wd metals')$$);
SELECT copy_test(pg_temp.tst('WD Metals'), pg_temp.site('CFL'), 'WD Metals (soil)');
SELECT pg_temp.expect_true('Duplicate: a new Draft test in the same lab, same method, department, steps, equipment and catalogue terms',
  (SELECT t.copied_from_test_id = pg_temp.tst('WD Metals') AND t.department_id = pg_temp.dept('CFL', 'WDC') FROM test t WHERE t.id = pg_temp.tst('WD Metals (soil)'))
  AND (SELECT status = 'Draft' AND method_id = (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS') FROM test_version WHERE id = pg_temp.ver('WD Metals (soil)', 1))
  AND (SELECT count(*) FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = pg_temp.ver('WD Metals (soil)', 1) AND e.status = 'Active') = 2
  AND EXISTS (SELECT 1 FROM test_catalog_entry WHERE test_id = pg_temp.tst('WD Metals (soil)'))
  AND pg_temp.errors(pg_temp.ver('WD Metals (soil)', 1)) = 0);
SELECT pg_temp.expect_error_like('An analyst at CFL cannot copy into TPS', $$SELECT copy_test(pg_temp.tst('WD Metals'), pg_temp.site('TPS'), 'WD Metals')$$, 'methods.design');
SELECT pg_temp.as_user('wd.qa');
SELECT copy_test(pg_temp.tst('WD Metals'), pg_temp.site('TPS'), 'WD Metals');
SELECT pg_temp.expect_true('Copy to TPS: same name allowed in another lab; department by code, balance by name; the method copied to TPS',
  (SELECT department_id = pg_temp.dept('TPS', 'WDC') FROM test WHERE id = pg_temp.tst('WD Metals', 'TPS'))
  AND (SELECT m.site_id = pg_temp.site('TPS') FROM test_version v JOIN method m ON m.id = v.method_id WHERE v.id = pg_temp.ver('WD Metals', 1, 'TPS'))
  AND (SELECT count(*) FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = pg_temp.ver('WD Metals', 1, 'TPS') AND e.status = 'Active') = 1);
SELECT pg_temp.expect_true('TPS has no ICP-MS type yet: its copy shows the problem to fix', pg_temp.has_problem(pg_temp.ver('WD Metals', 1, 'TPS'), 'Choose the equipment type for this data entry step'));

-- Split off on a finding; a manual observation needs no instrument
SELECT pg_temp.as_user('wd.ana');
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.ver('WD Metals (soil)', 1), 'look', 'Visual check', 'Data Entry', 8, '{"value_label": "Colour", "require_attachment": false}'),
 (pg_temp.ver('WD Metals (soil)', 1), 'spin', 'Confirm', 'Split off Test', 9, jsonb_build_object('test_id', pg_temp.tst('WD Metals'), 'trigger', 'On finding', 'finding', 'Present', 'finding_steps', '["calc"]'::jsonb));
SELECT pg_temp.link(pg_temp.ver('WD Metals (soil)', 1), 'look', 'dil'), pg_temp.link(pg_temp.ver('WD Metals (soil)', 1), 'spin', 'look'), pg_temp.link(pg_temp.ver('WD Metals (soil)', 1), 'review', 'spin');
SELECT pg_temp.expect_true('Split off: the finding must come from a Data Entry step before it; a manual observation needs no instrument',
  pg_temp.has_problem(pg_temp.ver('WD Metals (soil)', 1), '"calc" is not a Data Entry step that comes before this one')
  AND NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.ver('WD Metals (soil)', 1)) WHERE step_key = 'look'));
UPDATE workflow_step SET config = jsonb_set(config, '{finding_steps}', '["look"]') WHERE id = pg_temp.step(pg_temp.ver('WD Metals (soil)', 1), 'spin');
SELECT pg_temp.expect_true('Fixed: no problems', pg_temp.errors(pg_temp.ver('WD Metals (soil)', 1)) = 0);

-- Ordering only at the test's lab, specifications from the quote to the order
SELECT pg_temp.as_user('akiddle');
UPDATE test_catalog_entry SET base_price = 120 WHERE test_id = pg_temp.tst('WD Metals');
INSERT INTO project (client_id, project_name) SELECT id, 'WD Metals project' FROM client WHERE legal_name = 'Acme Irvine Site';
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Metals project'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
  SELECT pv.id, pg_temp.tst('WD Metals'), 1, 120 FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'WD Metals project';
CREATE OR REPLACE FUNCTION pg_temp.wdline() RETURNS uuid LANGUAGE sql AS $$
  SELECT q.id FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id
   WHERE p.project_name = 'WD Metals project' AND q.status = 'Active' ORDER BY pv.version_no DESC LIMIT 1 $$;
INSERT INTO specification (quoted_line_id, analyte_id, max_value, unit, source) VALUES (pg_temp.wdline(), pg_temp.an('WD Lead'), 0.5, 'mg/kg', 'Client');
SELECT pg_temp.expect_error_like('A specification is for an analyte of the test', $$INSERT INTO specification (quoted_line_id, analyte_id, max_value) VALUES (pg_temp.wdline(), pg_temp.an('WD Salmonella'), 1)$$, 'not an analyte of this test');
SELECT pg_temp.expect_error('A specification needs a limit', $$INSERT INTO specification (quoted_line_id, analyte_id) VALUES (pg_temp.wdline(), pg_temp.an('WD Cadmium'))$$);
SELECT pg_temp.expect_error('Minimum not above maximum', $$INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value) VALUES (pg_temp.wdline(), pg_temp.an('WD Cadmium'), 2, 1)$$);
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Metals project');
SELECT pg_temp.expect_error_like('Specifications lock when the quote is issued', $$INSERT INTO specification (quoted_line_id, analyte_id, max_value) VALUES (pg_temp.wdline(), pg_temp.an('WD Cadmium'), 0.3)$$, 'locked');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'sam@acme.com') WHERE project_id = (SELECT id FROM project WHERE project_name = 'WD Metals project');
SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'LOT-A1'), pg_temp.wdline());
SELECT pg_temp.expect_true('Ordered on a CFL sample: version 2 pinned, the Lead limit carried from the quote; Cadmium unspecified',
  (SELECT rt.test_version_id = pg_temp.ver('WD Metals', 2) FROM requested_test rt WHERE rt.test_id = pg_temp.tst('WD Metals'))
  AND (SELECT count(*) FROM specification s JOIN requested_test rt ON rt.id = s.requested_test_id WHERE rt.test_id = pg_temp.tst('WD Metals')) = 1
  AND (SELECT s.max_value = 0.5 AND s.source = 'Client' AND s.copied_from_spec_id IS NOT NULL FROM specification s JOIN requested_test rt ON rt.id = s.requested_test_id WHERE rt.test_id = pg_temp.tst('WD Metals')));
INSERT INTO specification (requested_test_id, analyte_id, max_value, unit, source)
  SELECT rt.id, pg_temp.an('WD Cadmium'), 0.3, 'mg/kg', 'Lab' FROM requested_test rt WHERE rt.test_id = pg_temp.tst('WD Metals');
SELECT pg_temp.expect_true('A limit can be set on the ordered test itself', (SELECT count(*) FROM specification s JOIN requested_test rt ON rt.id = s.requested_test_id WHERE rt.test_id = pg_temp.tst('WD Metals') AND s.status = 'Active') = 2);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error('Changing a specification needs a reason', $$UPDATE specification SET max_value = 0.4 WHERE requested_test_id IS NOT NULL AND analyte_id = pg_temp.an('WD Cadmium')$$);
INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units)
  SELECT o.id, 'WD-TPS-1', 'Tablet', 'Powder', 50, 'g', 1 FROM lab_order o JOIN lab_site s ON s.id = o.site_id WHERE s.site_code = 'TPS' LIMIT 1;
SELECT pg_temp.expect_error_like('A CFL test cannot be ordered at TPS',
  $$INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id) VALUES ((SELECT id FROM sample WHERE client_sample_id = 'WD-TPS-1'), pg_temp.tst('WD Metals'), pg_temp.ver('WD Metals', 2), pg_temp.wdline())$$, 'can only be ordered there');
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'WD Metals project'));
SELECT pg_temp.expect_true('A new quote version keeps the line''s specifications',
  (SELECT count(*) FROM specification WHERE quoted_line_id = pg_temp.wdline() AND status = 'Active' AND max_value = 0.5) = 1
  AND (SELECT pv.version_no FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id WHERE q.id = pg_temp.wdline()) = 2);

-- Audit references
SELECT pg_temp.expect_true('Audit entries name the version, step and specification, with links',
  (SELECT audit_record_ref('workflow_step', s.id, to_jsonb(s))->>'link' LIKE '#/methods/versions/%?tab=workflow' FROM workflow_step s WHERE s.id = pg_temp.step(pg_temp.ver('WD Metals', 2), 'calc'))
  AND (SELECT audit_record_ref('test_version', v.id, to_jsonb(v))->>'label' LIKE 'Test T-% version 2' FROM test_version v WHERE v.id = pg_temp.ver('WD Metals', 2)));

SELECT pg_temp.as_user('akiddle');
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
