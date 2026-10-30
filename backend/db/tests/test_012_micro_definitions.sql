-- Verification for migration 013 (WD-1.1): product categories, each qualitative analyte's result values and "found"
-- values, daily QC and QC made from strains, Weighing targets (none, one, per product category), Dilution amounts per
-- category, and copies keeping the result values. Runs after test_011 (uses its users, lab and departments).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Draft edited', false);
SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.methods_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.cat(n text) RETURNS text LANGUAGE sql AS $$ SELECT id::text FROM product_category WHERE category_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.v() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Micro P/A' AND v.status = 'Draft' $$;
CREATE OR REPLACE FUNCTION pg_temp.has_problem(pat text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) WHERE problem ILIKE '%' || pat || '%') $$;
CREATE OR REPLACE FUNCTION pg_temp.cfg(k text, c jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE workflow_step SET config = c WHERE test_version_id = pg_temp.v() AND step_key = k $$;

SELECT pg_temp.expect_true('Product categories are seeded (Cosmetic, Dietary Supplement, Food, Raw Material)', (SELECT count(*) FROM product_category) >= 4);
SELECT pg_temp.as_user('wd.int');
SELECT pg_temp.expect_error('Product categories need master.matrices', $$INSERT INTO product_category (category_name) VALUES ('Pet food')$$);
SELECT pg_temp.as_user('akiddle');
INSERT INTO matrix (matrix_name, product_category_id) VALUES ('WD Lotion', pg_temp.cat('Cosmetic')::uuid);
SELECT pg_temp.expect_true('A matrix belongs to a product category', (SELECT product_category_id IS NOT NULL FROM matrix WHERE matrix_name = 'WD Lotion'));

-- a small presence/absence test
SELECT pg_temp.as_user('wd.ana');
SELECT create_test(pg_temp.site('CFL'), 'WD Micro P/A', (SELECT d.id FROM department d JOIN lab_site s ON s.id = d.site_id WHERE s.site_code = 'CFL' AND d.department_code = 'WDM'),
  (SELECT id FROM method WHERE method_name = 'WD Elemental impurities by ICP-MS' AND site_id = pg_temp.site('CFL')));
INSERT INTO test_version_analyte (test_version_id, analyte_id, result_type) VALUES (pg_temp.v(), pg_temp.an('WD Salmonella'), 'Qualitative');
SELECT pg_temp.expect_true('A qualitative analyte defaults to Absent / Present, with Present meaning found',
  (SELECT result_values = '{Absent,Present}' AND found_values = '{Present}' FROM test_version_analyte WHERE test_version_id = pg_temp.v()));
UPDATE test_version_analyte SET result_values = '{" ND ",ND*,D*,D,ND}', found_values = '{D*,D}' WHERE test_version_id = pg_temp.v();
-- Moved to the Java backend in migration 066 (JUnit: DesignerRulesTest): result values are trimmed and de-duplicated, keeping their order
INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
 (pg_temp.v(), 'batch', 'Batch', 'Batching', 1, '{"max_samples": 20, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Daily", "material": "Strains", "criteria": [{"limit_type": "Presence"}]}]}'),
 (pg_temp.v(), 'weigh', 'Weigh', 'Weighing', 2, '{"target_mode": "None"}'),
 (pg_temp.v(), 'enrich', 'Enrich', 'Dilution', 3, '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3}'),
 (pg_temp.v(), 'read', 'Read', 'Data Entry', 4, '{"value_label": "Typical colonies", "require_attachment": false}'),
 (pg_temp.v(), 'review', 'QC Review', 'QC Review', 5, '{}');
INSERT INTO workflow_step_dependency (step_id, depends_on_step_id)
SELECT a.id, b.id FROM workflow_step a JOIN workflow_step b ON b.test_version_id = a.test_version_id
 WHERE a.test_version_id = pg_temp.v() AND (a.step_key, b.step_key) IN (('weigh','batch'), ('enrich','weigh'), ('read','enrich'), ('review','read'));
INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main)
SELECT s.id, (SELECT e.id FROM equipment_type e JOIN lab_site l ON l.id = e.site_id WHERE l.site_code = 'CFL' AND e.type_name = 'WD Balance'), true
  FROM workflow_step s WHERE s.test_version_id = pg_temp.v() AND s.step_key = 'weigh';
SELECT pg_temp.expect_true('Daily QC made from strains, no weighing target (the analyst decides): no problems',
  NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) WHERE severity = 'Error'));

-- result values
UPDATE test_version_analyte SET found_values = '{Positive}' WHERE test_version_id = pg_temp.v();
SELECT pg_temp.expect_true('"Found" values must be among the result values', pg_temp.has_problem('must be among its result values'));
UPDATE test_version_analyte SET result_values = '{ND}', found_values = '{}' WHERE test_version_id = pg_temp.v();
SELECT pg_temp.expect_true('A qualitative result needs at least two values', pg_temp.has_problem('at least two result values'));
UPDATE test_version_analyte SET result_values = '{ND,ND*,D*,D}', found_values = '{D*,D}' WHERE test_version_id = pg_temp.v();

-- QC frequency and material
SELECT pg_temp.cfg('batch', '{"max_samples": 20, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Weekly"}]}');
SELECT pg_temp.expect_true('QC frequency is once per batch, every N samples or daily', pg_temp.has_problem('once per batch, every N samples, or daily'));
SELECT pg_temp.cfg('batch', '{"max_samples": 20, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Daily", "material": "Gold"}]}');
SELECT pg_temp.expect_true('An unknown material requirement is a problem', pg_temp.has_problem('is not a material requirement'));
SELECT pg_temp.cfg('batch', '{"max_samples": 20, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Daily", "material": "Strains"}]}');
CREATE OR REPLACE FUNCTION pg_temp.soil() RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Metals (soil)' AND v.status = 'Draft' $$;
UPDATE workflow_step SET config = jsonb_set(config, '{qc,0,material}', '"Strains"') WHERE test_version_id = pg_temp.soil() AND step_key = 'batch';
SELECT pg_temp.expect_true('A chemistry test cannot ask for strains (it has no microbiological analytes)',
  EXISTS (SELECT 1 FROM test_version_problems(pg_temp.soil()) WHERE problem LIKE '%made from strains%no microbiological analytes%'));
UPDATE workflow_step SET config = config #- '{qc,0,material}' WHERE test_version_id = pg_temp.soil() AND step_key = 'batch';

-- Weighing targets
SELECT pg_temp.cfg('weigh', '{"target_mode": "Single"}');
SELECT pg_temp.expect_true('One target needs the target weight', pg_temp.has_problem('Enter the target weight'));
SELECT pg_temp.cfg('weigh', jsonb_build_object('target_mode', 'By product category', 'by_category', jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.cat('Cosmetic'), 'min', 1.00, 'max', 1.10), jsonb_build_object('category_id', pg_temp.cat('Dietary Supplement'), 'min', 10.00, 'max', 11.00))));
SELECT pg_temp.expect_true('A weight range per product category is accepted', NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) WHERE step_key = 'weigh'));
SELECT pg_temp.cfg('weigh', jsonb_build_object('target_mode', 'By product category', 'by_category', jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.cat('Cosmetic'), 'min', 2, 'max', 1), jsonb_build_object('category_id', pg_temp.cat('Cosmetic'), 'min', 1, 'max', 2))));
SELECT pg_temp.expect_true('Per category: lowest not above highest, and each category once', pg_temp.has_problem('Cosmetic: enter the lowest and highest weight') AND pg_temp.has_problem('appears twice'));
SELECT pg_temp.cfg('weigh', '{"target_mode": "By product category", "by_category": [{"category_id": "00000000-0000-0000-0000-000000000000", "min": 1, "max": 2}]}');
SELECT pg_temp.expect_true('A category not on the list is a problem', pg_temp.has_problem('not on the list'));
SELECT pg_temp.cfg('weigh', '{"target_mode": "By product category", "by_category": []}');
SELECT pg_temp.expect_true('Per category needs at least one range', pg_temp.has_problem('at least one product category'));
SELECT pg_temp.cfg('weigh', '{"target_mode": "None"}');

-- Dilution amounts per category
SELECT pg_temp.cfg('enrich', jsonb_build_object('mode', 'Single', 'fields_per_entry', 3, 'by_category', jsonb_build_array(
  jsonb_build_object('category_id', pg_temp.cat('Cosmetic'), 'aliquot', 1, 'diluent', 9), jsonb_build_object('category_id', pg_temp.cat('Food'), 'aliquot', 25, 'diluent', 225))));
SELECT pg_temp.expect_true('Amounts per category stand in for the default amounts', NOT EXISTS (SELECT 1 FROM test_version_problems(pg_temp.v()) WHERE step_key = 'enrich'));
SELECT pg_temp.cfg('enrich', jsonb_build_object('mode', 'Single', 'aliquot', 10, 'diluent', 90, 'by_category', jsonb_build_array(jsonb_build_object('category_id', pg_temp.cat('Food'), 'aliquot', 0, 'diluent', 225))));
SELECT pg_temp.expect_true('Each category needs the amounts added', pg_temp.has_problem('Food: enter the amounts added'));
SELECT pg_temp.cfg('enrich', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3}');

-- copies keep the values; approval works
SELECT copy_test((SELECT id FROM test WHERE test_name = 'WD Micro P/A'), pg_temp.site('CFL'), 'WD Micro P/A copy');
SELECT pg_temp.expect_true('A duplicate keeps the result values and "found" values',
  (SELECT a.result_values = '{ND,ND*,D*,D}' AND a.found_values = '{D*,D}' FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Micro P/A copy'));
SELECT pg_temp.as_user('wd.sup');
SELECT approve_test_version(pg_temp.v());
SELECT pg_temp.expect_true('The micro test is approved with its new settings', (SELECT v.status FROM test_version v JOIN test t ON t.id = v.test_id WHERE t.test_name = 'WD Micro P/A') = 'Effective');

SELECT pg_temp.as_user('akiddle');
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
