-- Verification for migration 031 (Alex's notes of 2026-10-14): in-network subcontracting on quotes (the 20-30 rule),
-- a quote stays with its lab, a test does not move between labs, catalogue prices by a percentage, serving units and the
-- sample's serving, limits per serving and per package. Builds its own fixtures (rule tests run without demo data).
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
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.sc_site(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = c $$;
CREATE OR REPLACE FUNCTION pg_temp.sc_test(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.sc_line(v uuid, n text) RETURNS quoted_test_configuration LANGUAGE sql AS $$
  SELECT q.* FROM quoted_test_configuration q WHERE q.project_version_id = v AND q.test_id = pg_temp.sc_test(n) AND q.status = 'Active' $$;

SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), false);
SELECT script_signature('Rule test', false);
SELECT set_config('lims.site_id', pg_temp.sc_site('CFL')::text, false);
-- a second network lab, if the earlier tests did not make one
INSERT INTO lab_site (site_code, site_name, time_zone) SELECT 'TPS', 'Tentamus Pharmaceutical Services', 'America/New_York'
 WHERE NOT EXISTS (SELECT 1 FROM lab_site WHERE site_code = 'TPS');

-------------------------------------------------------------------------------
-- 1. THE 20-30 RULE
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('The 20-30 rule: $650 less 20 % is $520 (cost), plus 30 % is $676 (the client''s list price)',
  (SELECT cost = 520 AND price = 676 FROM subcontract_price(650, 20, 30)));
SELECT pg_temp.expect_true('Every lab starts at 20 % off and 30 % on (lab settings)',
  NOT EXISTS (SELECT 1 FROM lab_site WHERE subcontract_discount_pct <> 20 OR subcontract_markup_pct <> 30));
SELECT create_test(pg_temp.sc_site('CFL'), 'SC In-house test');
SELECT create_test(pg_temp.sc_site('TPS'), 'SC Partner test');
SELECT create_test(pg_temp.sc_site('TPS'), 'SC Partner test 2');
UPDATE test_catalog_entry SET base_price = 100 WHERE test_id = pg_temp.sc_test('SC In-house test');
UPDATE test_catalog_entry SET base_price = 650 WHERE test_id = pg_temp.sc_test('SC Partner test');
UPDATE test_catalog_entry SET base_price = 650 WHERE test_id = pg_temp.sc_test('SC Partner test 2');
DO $$ DECLARE p uuid; BEGIN
  INSERT INTO project (client_id, project_name, kind) VALUES ((SELECT id FROM client ORDER BY created_at LIMIT 1), 'SC quote', 'Quote') RETURNING id INTO p;
  PERFORM new_project_version(p);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sc_v() RETURNS uuid LANGUAGE sql AS $$
  SELECT pv.id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'SC quote' ORDER BY pv.version_no DESC LIMIT 1 $$;
SELECT pg_temp.expect_true('A quote belongs to the lab it was made in', (SELECT site_id = pg_temp.sc_site('CFL') FROM project WHERE project_name = 'SC quote'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (pg_temp.sc_v(), pg_temp.sc_test('SC In-house test'), 1), (pg_temp.sc_v(), pg_temp.sc_test('SC Partner test'), 1);
SELECT pg_temp.expect_true('A test of the quoting lab is in-house, at its catalogue price',
  (SELECT NOT is_subcontracted AND list_price = 100 AND cost_price IS NULL AND performing_site_id = pg_temp.sc_site('CFL') FROM pg_temp.sc_line(pg_temp.sc_v(), 'SC In-house test')));
SELECT pg_temp.expect_true('Another network lab''s test is subcontracted: cost $520, the client''s list price $676, rates kept on the line',
  (SELECT is_subcontracted AND cost_price = 520 AND list_price = 676 AND performing_site_id = pg_temp.sc_site('TPS') AND sc_discount_pct = 20 AND sc_markup_pct = 30
     FROM pg_temp.sc_line(pg_temp.sc_v(), 'SC Partner test')));
UPDATE lab_site SET subcontract_markup_pct = 50 WHERE site_code = 'CFL';
UPDATE quoted_test_configuration SET quantity = 2, final_price = 600 WHERE id = (pg_temp.sc_line(pg_temp.sc_v(), 'SC Partner test')).id;
SELECT pg_temp.expect_true('A line keeps the price it was quoted at when the lab''s rates change',
  (SELECT list_price = 676 AND cost_price = 520 AND sc_markup_pct = 30 AND quantity = 2 FROM pg_temp.sc_line(pg_temp.sc_v(), 'SC Partner test')));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (pg_temp.sc_v(), pg_temp.sc_test('SC Partner test 2'), 1);
SELECT pg_temp.expect_true('A new line uses the lab''s new rates: $650 less 20 %, plus 50 % = $780',
  (SELECT list_price = 780 AND sc_markup_pct = 50 FROM pg_temp.sc_line(pg_temp.sc_v(), 'SC Partner test 2')));
UPDATE lab_site SET subcontract_markup_pct = 30 WHERE site_code = 'CFL';
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): a quote stays with its lab (site_id is not written after the insert)
-- Moved to the Java backend in migration 060 (JUnit: MasterDataRulesTest): The rates are percentages a lab can use (a discount under 100 %)
SELECT pg_temp.expect_error_like('A lab''s test never moves to another lab', $$UPDATE test SET site_id = pg_temp.sc_site('TPS') WHERE test_name = 'SC In-house test'$$, 'cannot move');

-------------------------------------------------------------------------------
-- 2. CATALOGUE PRICES BY A PERCENTAGE
-------------------------------------------------------------------------------
UPDATE test_catalog_entry SET pricing_mode = 'Base + Preparation Fee', prep_fee = 20 WHERE test_id = pg_temp.sc_test('SC In-house test');
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('A price update needs a Reason for Change', $$SELECT reprice_catalog(ARRAY[pg_temp.sc_test('SC In-house test')], 10)$$, 'Reason for Change');
SELECT set_config('lims.reason', 'Annual price increase (rule test)', false);
SELECT pg_temp.expect_error_like('A price update needs a percentage', $$SELECT reprice_catalog(NULL, 0)$$, 'percentage');
SELECT pg_temp.expect_error_like('A price update stays within -90 % to 500 %', $$SELECT reprice_catalog(NULL, -95)$$, 'outside');
CREATE TEMP TABLE sc_n AS SELECT reprice_catalog(ARRAY[pg_temp.sc_test('SC In-house test')], 10) AS n;
SELECT pg_temp.expect_true('10 % on the selected test: base $100 to $110 and preparation $20 to $22, so the list price goes from $120 to $132; others unchanged',
  (SELECT n = 1 FROM sc_n)
  AND (SELECT base_price = 110 AND prep_fee = 22 FROM test_catalog_entry WHERE test_id = pg_temp.sc_test('SC In-house test'))
  AND (SELECT list_price = 132 FROM test_catalogue WHERE test_id = pg_temp.sc_test('SC In-house test'))
  AND (SELECT base_price = 650 FROM test_catalog_entry WHERE test_id = pg_temp.sc_test('SC Partner test')));
SELECT pg_temp.expect_true('The change is audited with its reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'test_catalog_entry' AND reason = 'Annual price increase (rule test)'));
CREATE TEMP TABLE sc_n2 AS SELECT reprice_catalog(NULL, 3.5) AS n;
SELECT pg_temp.expect_true('All tests (none selected) move together; cents are rounded',
  (SELECT n >= 3 FROM sc_n2) AND (SELECT base_price = 113.85 FROM test_catalog_entry WHERE test_id = pg_temp.sc_test('SC In-house test')));
SELECT set_config('lims.reason', 'Rule test', false);

-------------------------------------------------------------------------------
-- 3. SERVING UNITS AND THE SAMPLE'S SERVING
-------------------------------------------------------------------------------
INSERT INTO unit_of_measure (unit_code, unit_name, dimension, sort_order, is_serving_unit) VALUES ('sccapsule', 'SC capsule', 'Count', 900, true);
INSERT INTO unit_of_measure (unit_code, unit_name, dimension, sort_order) VALUES ('scbox', 'SC box', 'Count', 901);
CREATE TEMP TABLE sc_s AS
  SELECT rt.sample_id AS id FROM requested_test rt JOIN test_version_analyte a ON a.test_version_id = rt.test_version_id AND a.status = 'Active' AND a.reporting_unit IN ('mg/kg','ppm')
   WHERE rt.status <> 'Cancelled' AND NOT EXISTS (SELECT 1 FROM specification s WHERE s.requested_test_id = rt.id AND s.analyte_id = a.analyte_id AND s.status = 'Active')
   ORDER BY rt.created_at LIMIT 1;
CREATE OR REPLACE FUNCTION pg_temp.sc_smp() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sc_s $$;
SELECT pg_temp.expect_true('(a sample with a test reporting in mg/kg or ppm, for the serving checks)', pg_temp.sc_smp() IS NOT NULL);
SELECT pg_temp.expect_error_like('The serving is counted in a serving unit of the Units list', $$UPDATE sample SET serving_count = 2, serving_count_unit = 'scbox' WHERE id = pg_temp.sc_smp()$$, 'serving units');
SELECT pg_temp.expect_error_like('A serving count has its unit', $$UPDATE sample SET serving_count = 2 WHERE id = pg_temp.sc_smp()$$, 'counted in');
SELECT pg_temp.expect_error_like('The serving''s weight or volume is a mass or a volume (not a count)', $$UPDATE sample SET serving_size = 2, serving_unit = 'each' WHERE id = pg_temp.sc_smp()$$, 'Serving weight or volume unit');
SELECT pg_temp.expect_error_like('The quantity received is in a unit of the Units list', $$UPDATE sample SET quantity_unit = 'blobs' WHERE id = pg_temp.sc_smp()$$, 'Quantity unit');
UPDATE sample SET serving_count = 2, serving_count_unit = 'SCCAPSULE', serving_size = 1.2, serving_unit = 'g', servings_per_package = 30 WHERE id = pg_temp.sc_smp();
SELECT pg_temp.expect_true('2 capsules weighing 1.2 g, 30 servings per package: stored with the list''s spelling',
  (SELECT serving_count = 2 AND serving_count_unit = 'sccapsule' AND serving_size = 1.2 AND serving_unit = 'g' AND servings_per_package = 30 FROM sample WHERE id = pg_temp.sc_smp()));
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('Changing a logged sample''s serving needs a reason', $$UPDATE sample SET servings_per_package = 60 WHERE id = pg_temp.sc_smp() AND logged_at IS NOT NULL$$, 'Reason for Change');
SELECT set_config('lims.reason', 'Rule test', false);

-------------------------------------------------------------------------------
-- 4. LIMITS PER SERVING AND PER PACKAGE
-------------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS sc_pick AS
  SELECT rt.id AS rt, a.analyte_id, a.reporting_unit AS unit FROM requested_test rt JOIN test_version_analyte a ON a.test_version_id = rt.test_version_id AND a.status = 'Active' AND a.reporting_unit IN ('mg/kg','ppm')
   WHERE rt.sample_id = pg_temp.sc_smp() AND rt.status <> 'Cancelled' AND NOT EXISTS (SELECT 1 FROM specification s WHERE s.requested_test_id = rt.id AND s.analyte_id = a.analyte_id AND s.status = 'Active')
   ORDER BY rt.created_at LIMIT 1;
SELECT pg_temp.expect_true('3 significant figures: 0.012345 is 0.0123 and 1234.5 is 1230', sig3(0.012345) = 0.0123 AND sig3(1234.5) = 1230);
INSERT INTO specification (requested_test_id, analyte_id, max_value, unit, source, basis) SELECT rt, analyte_id, 1, 'mg', 'Client', 'Per serving' FROM sc_pick;
SELECT pg_temp.expect_true('Per serving: 500 mg/kg in a 1.2 g serving is 0.6 mg, within "1 mg per serving"; 1000 mg/kg is 1.2 mg, outside',
  (SELECT conformance = 'Conforms' AND spec_unit = 'mg per serving' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '500', sc_pick.unit, NULL))
  AND (SELECT conformance = 'Does not conform' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '1000', sc_pick.unit, NULL)));
SELECT pg_temp.expect_true('A "<" result is below a per-serving maximum',
  (SELECT conformance = 'Conforms' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '< 5', sc_pick.unit, NULL)));
UPDATE specification s SET basis = 'Per package', max_value = 20 FROM sc_pick WHERE s.requested_test_id = sc_pick.rt AND s.analyte_id = sc_pick.analyte_id AND s.status = 'Active';
SELECT pg_temp.expect_true('Per package: 0.6 mg x 30 servings = 18 mg, within "20 mg per package"; 1.2 mg x 30 = 36 mg, outside',
  (SELECT conformance = 'Conforms' AND spec_unit = 'mg per package' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '500', sc_pick.unit, NULL))
  AND (SELECT conformance = 'Does not conform' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '1000', sc_pick.unit, NULL)));
UPDATE sample SET servings_per_package = NULL WHERE id = pg_temp.sc_smp();
SELECT pg_temp.expect_true('Without servings per package a per-package limit is not compared',
  (SELECT conformance = 'Not compared' FROM sc_pick, spec_conformance(sc_pick.rt, sc_pick.analyte_id, NULL, NULL, '500', sc_pick.unit, NULL)));
SELECT pg_temp.expect_error_like('The basis is As reported, Per serving or Per package', $$UPDATE specification SET basis = 'Per scoop' WHERE requested_test_id = (SELECT rt FROM sc_pick)$$, 'basis');
UPDATE specification s SET status = 'Inactive' FROM sc_pick WHERE s.requested_test_id = sc_pick.rt AND s.analyte_id = sc_pick.analyte_id AND s.status = 'Active';
UPDATE sample SET serving_count = NULL, serving_count_unit = NULL, serving_size = NULL, serving_unit = NULL WHERE id = pg_temp.sc_smp();

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
