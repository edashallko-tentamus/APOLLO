-- Verification for migration 002 (runs after test_001_core.sql data exists)
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT script_signature('Rule test', false);   -- test definitions are signed (migration 015)
SELECT set_config('lims.reason', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;

-- Analytes for a metals panel
INSERT INTO analyte (analyte_name, report_name, analyte_class) VALUES ('Arsenic','Arsenic','Chemical'),('Cadmium','Cadmium','Chemical'),('Mercury','Mercury','Chemical'),('Chromium','Chromium','Chemical');

-- Rush schedule
INSERT INTO rush_fee_schedule (schedule_name) VALUES ('Chemistry Rush');
INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, surcharge_type, surcharge_value, requires_approval, sort_order)
  SELECT id, 'Same Day', 0, 'Percent', 150, true, 1 FROM rush_fee_schedule;
INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, surcharge_type, surcharge_value, sort_order)
  SELECT id, '48 Hour', 2, 'Percent', 50, 2 FROM rush_fee_schedule;
INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, surcharge_type, surcharge_value, sort_order)
  SELECT id, '5 Day', 5, 'Flat', 25, 3 FROM rush_fee_schedule;

-- Catalogue: one test per pricing mode
INSERT INTO test (test_name) VALUES ('Heavy Metals (ICP-MS)'), ('Moisture'), ('Total Aerobic Plate Count');
INSERT INTO test_catalog_entry (test_id, pricing_mode, base_price, prep_fee, standard_tat, rush_schedule_id)
  SELECT t.id, 'Analyte Selection', 50, 25, 7, (SELECT id FROM rush_fee_schedule) FROM test t WHERE t.test_name='Heavy Metals (ICP-MS)';
INSERT INTO test_catalog_entry (test_id, pricing_mode, base_price, prep_fee)
  SELECT id, 'Base + Preparation Fee', 30, 10 FROM test WHERE test_name='Moisture';
INSERT INTO test_catalog_entry (test_id, pricing_mode, base_price)
  SELECT id, 'Base Price Only', 60 FROM test WHERE test_name='Total Aerobic Plate Count';
INSERT INTO test_analyte_price (catalog_entry_id, analyte_id, price)
  SELECT e.id, a.id, 20 FROM test_catalog_entry e JOIN test t ON t.id=e.test_id, analyte a
   WHERE t.test_name='Heavy Metals (ICP-MS)' AND a.analyte_name IN ('Lead','Arsenic','Cadmium','Mercury','Chromium');

SELECT pg_temp.expect_true('Analyte mode list = 50 + 25 + 5 x 20 = 175', (SELECT list_price FROM test_catalogue WHERE test_name='Heavy Metals (ICP-MS)') = 175);
SELECT pg_temp.expect_true('Base + prep list = 40', (SELECT list_price FROM test_catalogue WHERE test_name='Moisture') = 40);
SELECT pg_temp.expect_true('Base only list = 60', (SELECT list_price FROM test_catalogue WHERE test_name='Total Aerobic Plate Count') = 60);
-- Moved to the Java backend in migration 061 (JUnit: PricingRulesTest): Base Price Only cannot carry a prep fee
SELECT pg_temp.expect_true('Schedule default: Same Day requires approval',
  rush_requires_approval((SELECT id FROM test_catalog_entry WHERE pricing_mode='Analyte Selection'), (SELECT id FROM rush_fee_tier WHERE tier_name='Same Day')));
INSERT INTO test_rush_approval (catalog_entry_id, tier_id, requires_approval)
  SELECT (SELECT id FROM test_catalog_entry WHERE pricing_mode='Analyte Selection'), id, false FROM rush_fee_tier WHERE tier_name='Same Day';
SELECT pg_temp.expect_true('Per-test override turns approval off',
  NOT rush_requires_approval((SELECT id FROM test_catalog_entry WHERE pricing_mode='Analyte Selection'), (SELECT id FROM rush_fee_tier WHERE tier_name='Same Day')));

-- Project and quote
INSERT INTO project (client_id, project_name) SELECT id, 'Protein Powder Release Panel' FROM client WHERE legal_name='Acme Irvine Site';
SELECT new_project_version((SELECT id FROM project WHERE project_name='Protein Powder Release Panel'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, list_price)
  SELECT pv.id, t.id, 10, 9999 FROM project_version pv, test t WHERE t.test_name IN ('Heavy Metals (ICP-MS)','Moisture');
SELECT pg_temp.expect_true('List price snapshot ignores typed value', (SELECT list_price FROM quote_line_review WHERE test_name='Moisture') = 40);
SELECT pg_temp.expect_true('Analyte selections created (5 included)', (SELECT analytes_included FROM quote_line_review WHERE test_name='Heavy Metals (ICP-MS)') = 5);
SELECT pg_temp.expect_true('Rush terms created for the schedule (3 tiers)', (SELECT count(*) FROM quote_rush_term) = 3);

UPDATE quoted_test_configuration SET final_price = 140 WHERE test_id = (SELECT id FROM test WHERE test_name='Heavy Metals (ICP-MS)');
SELECT pg_temp.expect_true('Discount $35 / 20%', (SELECT discount_amount = 35 AND discount_pct = 20 FROM quote_line_review WHERE test_name='Heavy Metals (ICP-MS)'));
UPDATE quoted_analyte_selection SET included = false WHERE analyte_id IN (SELECT id FROM analyte WHERE analyte_name IN ('Mercury','Chromium'));
SELECT pg_temp.expect_true('Removing 2 analytes: list 135, final keeps 20% = 108',
  (SELECT list_price = 135 AND final_price = 108 AND discount_pct = 20 FROM quote_line_review WHERE test_name='Heavy Metals (ICP-MS)'));
UPDATE quoted_analyte_selection SET included = true WHERE analyte_id = (SELECT id FROM analyte WHERE analyte_name='Mercury');
SELECT pg_temp.expect_true('Restoring one analyte: list 155, final 124', (SELECT list_price = 155 AND final_price = 124 FROM quote_line_review WHERE test_name='Heavy Metals (ICP-MS)'));
UPDATE quote_rush_term SET discount_pct = 100 WHERE tier_name = '5 Day';
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): rush surcharges are not editable on a quote (Java writes only the discount)
SELECT pg_temp.expect_error('Cannot quote with a missing final price', $$UPDATE project_version SET status='Quoted'$$);
UPDATE quoted_test_configuration SET final_price = 45 WHERE test_id = (SELECT id FROM test WHERE test_name='Moisture');
SELECT pg_temp.expect_true('Pricing review flags final above list', EXISTS (SELECT 1 FROM quote_line_review WHERE test_name='Moisture' AND issue='Final price above list price'));
UPDATE project_version SET status='Quoted', valid_until = current_date + 30;
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): lines locked after quoting
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): analyte selections locked after quoting
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): rush terms locked after quoting
SELECT pg_temp.expect_error('Acceptance by a non-client contact rejected',
  $$UPDATE project_version SET status='Accepted', accepted_by_contact_id=(SELECT id FROM contact WHERE email='maria@consult.com' AND false)$$);
UPDATE project_version SET status='Accepted', accepted_by_contact_id=(SELECT id FROM contact WHERE email='sam@acme.com');
SELECT pg_temp.expect_true('Accepted project is orderable (2 tests)', (SELECT count(*) FROM orderable_lines((SELECT id FROM client WHERE legal_name='Acme Irvine Site'))) = 2);
SELECT pg_temp.expect_true('Other client cannot order it', (SELECT count(*) FROM orderable_lines((SELECT id FROM client WHERE legal_name='Beta Foods LLC'))) = 0);

-- Re-quote copies lines, exclusions, discount % and rush discounts
SELECT new_project_version((SELECT id FROM project WHERE project_name='Protein Powder Release Panel'));
SELECT pg_temp.expect_true('v2 copies trimmed analytes and keeps 20%',
  (SELECT list_price = 155 AND final_price = 124 AND analytes_included = 4 FROM quote_line_review WHERE test_name='Heavy Metals (ICP-MS)' AND version_no = 2));
SELECT pg_temp.expect_true('v2 copies rush discount', (SELECT discount_pct FROM quote_rush_term qrt JOIN project_version pv ON pv.id=qrt.project_version_id WHERE pv.version_no=2 AND tier_name='5 Day') = 100);
UPDATE project_version SET status='Quoted' WHERE version_no=2;
UPDATE project_version SET status='Accepted', accepted_by_contact_id=(SELECT id FROM contact WHERE email='sam@acme.com') WHERE version_no=2;
SELECT pg_temp.expect_true('v1 superseded, v2 accepted', (SELECT string_agg(version_no||':'||status, ',' ORDER BY version_no) FROM project_version) = '1:Superseded,2:Accepted');

-- List-price acceptance
INSERT INTO project (client_id, project_name, is_list_price_acceptance) SELECT id, 'Catalog pricing', true FROM client WHERE legal_name='Beta Foods LLC';
SELECT new_project_version((SELECT id FROM project WHERE project_name='Catalog pricing'));
INSERT INTO quoted_test_configuration (project_version_id, test_id, final_price)
  SELECT pv.id, t.id, 1 FROM project_version pv JOIN project p ON p.id=pv.project_id, test t WHERE p.project_name='Catalog pricing' AND t.test_name='Total Aerobic Plate Count';
SELECT pg_temp.expect_true('List-price acceptance forces final = list', (SELECT final_price = 60 AND discount_amount = 0 FROM quote_line_review WHERE project_code=(SELECT project_code FROM project WHERE project_name='Catalog pricing')));
SELECT pg_temp.expect_true('Changes are audited', (SELECT count(*) FROM audit_log WHERE table_name='quoted_analyte_selection' AND action='UPDATE') >= 3);

SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
