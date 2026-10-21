-- Verification for migration 047 (P-1): test packages in the catalogue (since 049: each test priced in the package,
-- the package price their sum, the discount worked out; analytes left out), packages on quotes (one price, shared out; locked
-- tests; a new version keeps them), ordering a package, cancelling one of its tests (option B: only its share comes
-- off, the rest keep theirs; the preview), cancelling a whole package, and dated price changes.
-- Builds its own fixtures (rule tests run without demo data).
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
CREATE OR REPLACE FUNCTION pg_temp.pk_site(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = c $$;
CREATE OR REPLACE FUNCTION pg_temp.pk_test(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.pk_pkg(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test_package WHERE package_name = n AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.pk_as(u text, site text DEFAULT 'CFL') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', pg_temp.pk_site(site)::text, false);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.pk_v(n text) RETURNS uuid LANGUAGE sql AS $$
  SELECT pv.id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_name = n ORDER BY pv.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.pk_rt(cid text, t text) RETURNS requested_test LANGUAGE sql AS $$
  SELECT r.* FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE s.client_sample_id = cid AND r.test_id = pg_temp.pk_test(t) ORDER BY r.created_at DESC LIMIT 1 $$;

SELECT pg_temp.pk_as('akiddle');
SELECT script_signature('Rule test', false);
INSERT INTO lab_site (site_code, site_name, time_zone) SELECT 'TPS', 'Tentamus Pharmaceutical Services', 'America/New_York'
 WHERE NOT EXISTS (SELECT 1 FROM lab_site WHERE site_code = 'TPS');
INSERT INTO app_user (username, full_name) VALUES ('pk.ana', 'PK Analyst') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, (SELECT id FROM app_user WHERE username = 'pk.ana') FROM lab_group g
 WHERE g.site_id = pg_temp.pk_site('CFL') AND g.group_name = 'Analyst' ON CONFLICT DO NOTHING;

-- fixtures: four CFL tests (one priced by analyte) and one TPS test, all with an approved workflow
SELECT create_test(pg_temp.pk_site('CFL'), x) FROM unnest(ARRAY['PK Lead', 'PK Moisture', 'PK Metals panel', 'PK Yeast']) x;
SELECT create_test(pg_temp.pk_site('TPS'), 'PK Partner assay');
UPDATE test_catalog_entry SET base_price = 100 WHERE test_id = pg_temp.pk_test('PK Lead');
UPDATE test_catalog_entry SET base_price = 50 WHERE test_id = pg_temp.pk_test('PK Moisture');
UPDATE test_catalog_entry SET base_price = 40 WHERE test_id = pg_temp.pk_test('PK Yeast');
UPDATE test_catalog_entry SET base_price = 80 WHERE test_id = pg_temp.pk_test('PK Partner assay');
UPDATE test_catalog_entry SET pricing_mode = 'Analyte Selection', base_price = 10 WHERE test_id = pg_temp.pk_test('PK Metals panel');
INSERT INTO analyte (analyte_name, analyte_class) SELECT x, 'Chemical' FROM unnest(ARRAY['PK Arsenic', 'PK Cadmium', 'PK Mercury']) x
 WHERE NOT EXISTS (SELECT 1 FROM analyte a WHERE a.analyte_name = x);
INSERT INTO test_analyte_price (catalog_entry_id, analyte_id, price)
SELECT e.id, a.id, 30 FROM test_catalog_entry e, analyte a WHERE e.test_id = pg_temp.pk_test('PK Metals panel') AND a.analyte_name IN ('PK Arsenic', 'PK Cadmium', 'PK Mercury');
SELECT set_config('lims.methods_internal', '1', false);
UPDATE test_version SET status = 'Effective', effective_from = now() WHERE test_id IN (SELECT id FROM test WHERE test_name LIKE 'PK %');
SELECT set_config('lims.methods_internal', '', false);
INSERT INTO client (legal_name, account_status) VALUES ('PK Packaging Client LLC', 'Active');
INSERT INTO contact (first_name, last_name, email) VALUES ('Pat', 'Package', 'pat@pk-client.example');
INSERT INTO client_contact (client_id, contact_id, roles) SELECT c.id, ct.id, '{PRIMARY,ORDERING}' FROM client c, contact ct
 WHERE c.legal_name = 'PK Packaging Client LLC' AND ct.email = 'pat@pk-client.example';

-------------------------------------------------------------------------------
-- 1. PACKAGES IN THE CATALOGUE
-------------------------------------------------------------------------------
SELECT pg_temp.pk_as('pk.ana');
SELECT pg_temp.expect_error_like('Without catalog.edit nobody makes a package', $$INSERT INTO test_package (site_id, package_name) VALUES (pg_temp.pk_site('CFL'), 'PK Nope')$$, 'catalog.edit');
SELECT pg_temp.pk_as('akiddle');
INSERT INTO test_package (site_id, package_name) VALUES (pg_temp.pk_site('CFL'), 'PK Supplement release');
SELECT pg_temp.expect_true('A package is numbered PKG- and belongs to its lab', (SELECT package_code LIKE 'PKG-%' AND site_id = pg_temp.pk_site('CFL') FROM test_package WHERE package_name = 'PK Supplement release'));
SELECT pg_temp.expect_true('A package with no tests cannot be quoted', EXISTS (SELECT 1 FROM test_package_problems(pg_temp.pk_pkg('PK Supplement release')) WHERE severity = 'Error' AND problem LIKE '%no tests%'));
INSERT INTO test_package_item (package_id, test_id, sort_order) VALUES
 (pg_temp.pk_pkg('PK Supplement release'), pg_temp.pk_test('PK Lead'), 1),
 (pg_temp.pk_pkg('PK Supplement release'), pg_temp.pk_test('PK Moisture'), 2),
 (pg_temp.pk_pkg('PK Supplement release'), pg_temp.pk_test('PK Metals panel'), 3);
SELECT pg_temp.expect_error_like('A package holds its own lab''s tests only', $$INSERT INTO test_package_item (package_id, test_id) VALUES (pg_temp.pk_pkg('PK Supplement release'), pg_temp.pk_test('PK Partner assay'))$$, 'own lab');
SELECT pg_temp.expect_error_like('A test is in a package once', $$INSERT INTO test_package_item (package_id, test_id) VALUES (pg_temp.pk_pkg('PK Supplement release'), pg_temp.pk_test('PK Lead'))$$, 'test_package_item_uq');
SELECT pg_temp.expect_error_like('Only an analyte-priced test has analytes to reprice', $$INSERT INTO test_package_analyte (item_id, analyte_id, included) SELECT i.id, (SELECT id FROM analyte WHERE analyte_name = 'PK Arsenic'), false FROM test_package_item i WHERE i.test_id = pg_temp.pk_test('PK Lead') AND i.package_id = pg_temp.pk_pkg('PK Supplement release')$$, 'analyte-priced');
-- 049: each test is priced in the package (it starts at its catalogue price); the package price is their sum
SELECT pg_temp.expect_true('A test added without a price starts at its catalogue price: Lead $100, Moisture $50, metals panel $100 (all analytes); no discount yet',
  (SELECT array_agg(share ORDER BY sort_order) = ARRAY[100, 50, 100]::numeric[] FROM test_package_lines(pg_temp.pk_pkg('PK Supplement release')))
  AND (SELECT package_price = 250 AND list_value = 250 AND discount = 0 FROM test_package_view WHERE package_name = 'PK Supplement release'));
-- the metals panel in the package: mercury left out
INSERT INTO test_package_analyte (item_id, analyte_id, included)
SELECT i.id, a.id, false FROM test_package_item i, analyte a WHERE i.package_id = pg_temp.pk_pkg('PK Supplement release') AND i.test_id = pg_temp.pk_test('PK Metals panel')
   AND a.analyte_name = 'PK Mercury';
SELECT pg_temp.expect_true('The metals panel in the package: 2 of 3 analytes, catalogue price $70; its package price stays as typed ($100)',
  (SELECT analytes_in = 2 AND analytes_total = 3 AND list_price = 70 AND share = 100 FROM test_package_lines(pg_temp.pk_pkg('PK Supplement release')) WHERE test_name = 'PK Metals panel'));
SELECT pg_temp.expect_true('A test priced above its catalogue price is flagged (analytes left out)',
  EXISTS (SELECT 1 FROM test_package_problems(pg_temp.pk_pkg('PK Supplement release')) WHERE severity = 'Warning' AND problem LIKE 'PK Metals panel is priced at 100%analytes were left out%'));
UPDATE test_package_item SET component_price = CASE test_id WHEN pg_temp.pk_test('PK Lead') THEN 90 WHEN pg_temp.pk_test('PK Moisture') THEN 45 ELSE 54 END WHERE package_id = pg_temp.pk_pkg('PK Supplement release');
SELECT pg_temp.expect_true('Each test priced: the package is their sum ($90 + $45 + $54 = $189), the shares are those prices',
  test_package_price(pg_temp.pk_pkg('PK Supplement release')) = 189
  AND (SELECT array_agg(share ORDER BY sort_order) = ARRAY[90, 45, 54]::numeric[] FROM test_package_lines(pg_temp.pk_pkg('PK Supplement release'))));
SELECT pg_temp.expect_true('The discount is worked out: $220 at catalogue less $189 = $31, 14.1 % off; nothing to fix',
  (SELECT list_value = 220 AND discount = 31 AND discount_pct = 14.1 AND errors = 0 FROM test_package_view WHERE package_name = 'PK Supplement release'));
SELECT pg_temp.expect_error_like('A test''s price in the package cannot be emptied', $$UPDATE test_package_item SET component_price = NULL WHERE package_id = pg_temp.pk_pkg('PK Supplement release') AND test_id = pg_temp.pk_test('PK Lead')$$, 'Give the price of PK Lead');
SELECT pg_temp.expect_error_like('A price in the package is not negative', $$UPDATE test_package_item SET component_price = -1 WHERE package_id = pg_temp.pk_pkg('PK Supplement release') AND test_id = pg_temp.pk_test('PK Lead')$$, 'component_price');
INSERT INTO test_package (site_id, package_name) VALUES (pg_temp.pk_site('CFL'), 'PK Basic pair');
INSERT INTO test_package_item (package_id, test_id, sort_order, component_price) VALUES (pg_temp.pk_pkg('PK Basic pair'), pg_temp.pk_test('PK Lead'), 1, 85.71), (pg_temp.pk_pkg('PK Basic pair'), pg_temp.pk_test('PK Yeast'), 2, 34.29);
SELECT pg_temp.expect_true('Prices typed when the tests are added: Lead $85.71 + Yeast $34.29 = $120',
  test_package_price(pg_temp.pk_pkg('PK Basic pair')) = 120);
SELECT pg_temp.expect_error_like('A package stays with its lab', $$UPDATE test_package SET site_id = pg_temp.pk_site('TPS') WHERE package_name = 'PK Basic pair'$$, 'stays with its lab');

-------------------------------------------------------------------------------
-- 2. ON A QUOTE
-------------------------------------------------------------------------------
DO $$ DECLARE p uuid; BEGIN
  INSERT INTO project (client_id, project_name, kind) VALUES ((SELECT id FROM client WHERE legal_name = 'PK Packaging Client LLC'), 'PK quote', 'Quote') RETURNING id INTO p;
  PERFORM new_project_version(p);
END $$;
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price) VALUES (pg_temp.pk_v('PK quote'), pg_temp.pk_test('PK Lead'), 1, 95);
SELECT pg_temp.expect_ok('The package goes on the quote (the same test can also be quoted on its own)', $$SELECT add_package_to_quote(pg_temp.pk_v('PK quote'), pg_temp.pk_pkg('PK Supplement release'), 2)$$);
SELECT pg_temp.expect_true('On the quote: one package at $189, list $220 per sample, 2 samples; its three tests at their shares, analytes as in the package',
  (SELECT package_price = 189 AND list_price = 220 AND quantity = 2 FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote'))
  AND (SELECT array_agg(final_price ORDER BY final_price DESC) = ARRAY[90, 54, 45]::numeric[] AND bool_and(quantity = 2) FROM quoted_test_configuration WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote'))
  AND (SELECT count(*) = 2 FROM quoted_analyte_selection s JOIN quoted_test_configuration q ON q.id = s.line_id WHERE q.quoted_package_id IS NOT NULL AND q.project_version_id = pg_temp.pk_v('PK quote') AND s.included));
SELECT pg_temp.expect_error_like('A package''s test is not priced on its own', $$UPDATE quoted_test_configuration SET final_price = 10 WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote') AND test_id = pg_temp.pk_test('PK Lead')$$, 'part of package');
SELECT pg_temp.expect_error_like('nor its analytes changed on the quote', $$UPDATE quoted_analyte_selection SET included = true WHERE line_id IN (SELECT id FROM quoted_test_configuration WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote'))$$, 'set in the package');
SELECT pg_temp.expect_error_like('A package is on a quote once', $$SELECT add_package_to_quote(pg_temp.pk_v('PK quote'), pg_temp.pk_pkg('PK Supplement release'), 1)$$, 'already on this quote');
SELECT pg_temp.expect_error_like('A quoted package is changed through its own steps', $$UPDATE quoted_package SET package_price = 1 WHERE project_version_id = pg_temp.pk_v('PK quote')$$, 'through the quote page');
SELECT set_quoted_package((SELECT id FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote')), 180, NULL);
SELECT pg_temp.expect_true('A negotiated package price ($180) is shared out again in the same proportions ($85.71, $51.43, $42.86)',
  (SELECT array_agg(final_price ORDER BY final_price DESC) = ARRAY[85.71, 51.43, 42.86]::numeric[] AND sum(final_price) = 180 FROM quoted_test_configuration WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote')));
SELECT pg_temp.expect_true('The quote''s total counts the package once per sample: $95 + 2 x $180 = $455',
  (SELECT sum(line_total) = 455 FROM quoted_test_configuration WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active'));
-- another lab's quote cannot take it
SELECT pg_temp.pk_as('akiddle', 'TPS');
DO $$ DECLARE p uuid; BEGIN
  INSERT INTO project (client_id, project_name, kind) VALUES ((SELECT id FROM client WHERE legal_name = 'PK Packaging Client LLC'), 'PK TPS quote', 'Quote') RETURNING id INTO p;
  PERFORM new_project_version(p);
END $$;
SELECT pg_temp.pk_as('akiddle');
SELECT pg_temp.expect_error_like('A package is quoted by its own lab', $$SELECT add_package_to_quote(pg_temp.pk_v('PK TPS quote'), pg_temp.pk_pkg('PK Basic pair'), 1)$$, 'belongs to CFL');
SELECT add_package_to_quote(pg_temp.pk_v('PK quote'), pg_temp.pk_pkg('PK Basic pair'), 1);
SELECT remove_quoted_package((SELECT id FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND package_code = (SELECT package_code FROM test_package WHERE package_name = 'PK Basic pair')));
SELECT pg_temp.expect_true('Removing a package removes its tests',
  NOT EXISTS (SELECT 1 FROM quoted_test_configuration q JOIN quoted_package qp ON qp.id = q.quoted_package_id WHERE qp.project_version_id = pg_temp.pk_v('PK quote') AND qp.status = 'Removed' AND q.status = 'Active'));
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.pk_v('PK quote');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'pat@pk-client.example') WHERE id = pg_temp.pk_v('PK quote');
SELECT pg_temp.expect_error_like('Once quoted, packages are locked', $$SELECT set_quoted_package((SELECT id FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active'), 170, NULL)$$, 'locked');
SELECT pg_temp.expect_true('The client can order the package, and Lead on its own; the package''s tests are not orderable one by one',
  (SELECT count(*) = 1 FROM orderable_packages((SELECT id FROM client WHERE legal_name = 'PK Packaging Client LLC')))
  AND (SELECT array_agg(final_price) = ARRAY[95]::numeric[] FROM orderable_lines((SELECT id FROM client WHERE legal_name = 'PK Packaging Client LLC'))));

-------------------------------------------------------------------------------
-- 3. ORDERING AND CANCELLING
-------------------------------------------------------------------------------
INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number)
SELECT c.id, pg_temp.pk_site('CFL'), ct.id, 'PO-PK1' FROM client c, contact ct WHERE c.legal_name = 'PK Packaging Client LLC' AND ct.email = 'pat@pk-client.example';
INSERT INTO sample (lab_order_id, client_sample_id) SELECT id, x FROM lab_order, unnest(ARRAY['PK-S1', 'PK-S2', 'PK-S3']) x WHERE po_number = 'PO-PK1';
SELECT pg_temp.expect_error_like('A package''s test is not ordered on its own',
  $$SELECT order_test((SELECT id FROM sample WHERE client_sample_id = 'PK-S1'), (SELECT id FROM quoted_test_configuration WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote') AND test_id = pg_temp.pk_test('PK Moisture')))$$, 'not on an accepted quote');
SELECT order_package(s.id, (SELECT id FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active')) FROM sample s WHERE s.client_sample_id IN ('PK-S1', 'PK-S2');
SELECT pg_temp.expect_true('Ordering the package orders its three tests at their shares ($180 in all), marked as the package''s',
  (SELECT count(*) = 3 AND sum(price) = 180 AND bool_and(ordered_package_id IS NOT NULL) FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE s.client_sample_id = 'PK-S1'));
SELECT pg_temp.expect_error_like('A package is not ordered twice on a sample', $$SELECT order_package((SELECT id FROM sample WHERE client_sample_id = 'PK-S1'), (SELECT id FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active'))$$, 'already has');
SELECT pg_temp.expect_true('Cancelling Moisture would take off only its share ($42.86); the two tests left stay at $137.14',
  (SELECT share = 42.86 AND still_charged = 137.14 AND remaining_tests = 2 AND package_price = 180 AND test_name = 'PK Moisture'
     FROM package_cancel_preview((pg_temp.pk_rt('PK-S1', 'PK Moisture')).id)));
SELECT set_config('lims.reason', 'Client no longer needs moisture', false);
UPDATE requested_test SET status = 'Cancelled' WHERE id = (pg_temp.pk_rt('PK-S1', 'PK Moisture')).id;
SELECT pg_temp.expect_true('Cancelling a test leaves the package Partly cancelled (option B: never broken)',
  (SELECT status = 'Partly cancelled' FROM ordered_package WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S1')));
SELECT pg_temp.expect_true('The tests left keep their shares: Lead $85.71, metals panel $51.43',
  (pg_temp.pk_rt('PK-S1', 'PK Lead')).price = 85.71 AND (pg_temp.pk_rt('PK-S1', 'PK Metals panel')).price = 51.43);
SELECT pg_temp.expect_true('The invoice line names the package and says cancelled tests are not charged; an intact package''s line does not',
  invoice_line_text((pg_temp.pk_rt('PK-S1', 'PK Lead')).id) LIKE 'Part of package PKG-% PK Supplement release (180.00 per sample; tests cancelled from it are not charged): this test''s share.'
  AND invoice_line_text((pg_temp.pk_rt('PK-S2', 'PK Lead')).id) LIKE 'Part of package PKG-% PK Supplement release (180.00 per sample): this test''s share.');
SELECT pg_temp.expect_true('There is nothing to preview for a test already cancelled', NOT EXISTS (SELECT 1 FROM package_cancel_preview((pg_temp.pk_rt('PK-S1', 'PK Moisture')).id)));
SELECT pg_temp.expect_true('The other sample''s package is untouched', (pg_temp.pk_rt('PK-S2', 'PK Lead')).price = 85.71
  AND (SELECT status = 'Intact' FROM ordered_package WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S2')));
SELECT pg_temp.expect_error_like('A test stays in its package', $$UPDATE requested_test SET ordered_package_id = NULL WHERE id = (pg_temp.pk_rt('PK-S2', 'PK Lead')).id$$, 'stays in or out');
SELECT pg_temp.expect_error_like('An ordered package changes only through its tests', $$UPDATE ordered_package SET status = 'Intact' WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S1')$$, 'through its tests');
SELECT cancel_ordered_package((SELECT id FROM ordered_package WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S2')));
SELECT pg_temp.expect_true('Cancelling the whole package cancels every test and marks it Cancelled',
  (SELECT status = 'Cancelled' FROM ordered_package WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S2'))
  AND NOT EXISTS (SELECT 1 FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE s.client_sample_id = 'PK-S2' AND r.status <> 'Cancelled'));
CREATE TEMP TABLE pk_applied AS SELECT apply_project((SELECT id FROM sample WHERE client_sample_id = 'PK-S3'), (SELECT id FROM project WHERE project_name = 'PK quote')) AS n;
SELECT pg_temp.expect_true('Applying the project orders the package as a package, and Lead on its own is skipped (already in it)',
  (SELECT n = 3 FROM pk_applied)
  AND (SELECT count(*) = 3 AND bool_and(ordered_package_id IS NOT NULL) FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE s.client_sample_id = 'PK-S3'));
SELECT set_config('lims.reason', 'Rule test', false);

-- a new version of the quote keeps the package, its negotiated price and the shares
SELECT new_project_version((SELECT id FROM project WHERE project_name = 'PK quote'));
SELECT pg_temp.expect_true('A new version copies the package at $180 with the same shares; Lead on its own stays a separate line',
  (SELECT package_price = 180 AND status = 'Active' FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active')
  AND (SELECT array_agg(final_price ORDER BY final_price DESC) = ARRAY[85.71, 51.43, 42.86]::numeric[] FROM quoted_test_configuration WHERE quoted_package_id IS NOT NULL AND project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active')
  AND (SELECT count(*) = 1 FROM quoted_test_configuration WHERE quoted_package_id IS NULL AND project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active'));

-------------------------------------------------------------------------------
-- 4. DATED PRICE CHANGES
-------------------------------------------------------------------------------
SELECT pg_temp.expect_error_like('A price change starts today or later', $$INSERT INTO catalog_price_change (site_id, pct, effective_on, reason) VALUES (pg_temp.pk_site('CFL'), 5, site_today(pg_temp.pk_site('CFL')) - 1, 'x')$$, 'today or later');
SELECT pg_temp.expect_error_like('A price change covers its own lab''s tests', $$INSERT INTO catalog_price_change (site_id, tests, pct, effective_on, reason) VALUES (pg_temp.pk_site('CFL'), ARRAY[pg_temp.pk_test('PK Partner assay')], 5, site_today(pg_temp.pk_site('CFL')), 'x')$$, 'own lab');
INSERT INTO catalog_price_change (site_id, tests, pct, effective_on, reason) VALUES (pg_temp.pk_site('CFL'), ARRAY[pg_temp.pk_test('PK Yeast')], 5, site_today(pg_temp.pk_site('CFL')) + 30, 'Next year (rule test)');
SELECT pg_temp.expect_error_like('A change is not applied before its date', $$SELECT apply_catalog_price_change((SELECT id FROM catalog_price_change WHERE reason = 'Next year (rule test)'))$$, 'starts on');
SELECT pg_temp.expect_error_like('A scheduled change is not edited', $$UPDATE catalog_price_change SET pct = 6 WHERE reason = 'Next year (rule test)'$$, 'not edited');
UPDATE catalog_price_change SET status = 'Cancelled' WHERE reason = 'Next year (rule test)';
SELECT pg_temp.expect_true('A scheduled change can be cancelled (who and when)', (SELECT status = 'Cancelled' AND cancelled_by IS NOT NULL FROM catalog_price_change WHERE reason = 'Next year (rule test)'));
INSERT INTO catalog_price_change (site_id, tests, pct, rounding, effective_on, reason)
VALUES (pg_temp.pk_site('CFL'), ARRAY[pg_temp.pk_test('PK Lead'), pg_temp.pk_test('PK Yeast'), pg_temp.pk_test('PK Metals panel')], 10, 'Dollar', site_today(pg_temp.pk_site('CFL')), 'Annual increase (rule test)');
SELECT pg_temp.expect_true('Due today: listed for the hourly job', EXISTS (SELECT 1 FROM catalog_price_change_due d JOIN catalog_price_change c ON c.id = d.id WHERE c.reason = 'Annual increase (rule test)'));
SELECT apply_catalog_price_change((SELECT id FROM catalog_price_change WHERE reason = 'Annual increase (rule test)'));
SELECT pg_temp.expect_true('Applied: Lead $100 to $110, Yeast $40 to $44, the panel''s analytes $30 to $33 (whole dollars); Moisture unchanged',
  (SELECT base_price = 110 FROM test_catalog_entry WHERE test_id = pg_temp.pk_test('PK Lead'))
  AND (SELECT base_price = 44 FROM test_catalog_entry WHERE test_id = pg_temp.pk_test('PK Yeast'))
  AND (SELECT bool_and(ap.price = 33) FROM test_analyte_price ap JOIN test_catalog_entry e ON e.id = ap.catalog_entry_id WHERE e.test_id = pg_temp.pk_test('PK Metals panel'))
  AND (SELECT base_price = 50 FROM test_catalog_entry WHERE test_id = pg_temp.pk_test('PK Moisture'))
  AND (SELECT status = 'Applied' AND applied_tests = 3 FROM catalog_price_change WHERE reason = 'Annual increase (rule test)'));
SELECT pg_temp.expect_true('The tests in the change move in their packages too (whole dollars): Basic pair Lead $94 + Yeast $38 = $132; Supplement release Lead $99, panel $59, Moisture $45 unchanged; the quoted package keeps $180',
  test_package_price(pg_temp.pk_pkg('PK Basic pair')) = 132
  AND (SELECT array_agg(share ORDER BY sort_order) = ARRAY[99, 45, 59]::numeric[] FROM test_package_lines(pg_temp.pk_pkg('PK Supplement release')))
  AND (SELECT applied_packages = 2 FROM catalog_price_change WHERE reason = 'Annual increase (rule test)')
  AND (SELECT package_price = 180 FROM quoted_package WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active'));
SELECT pg_temp.expect_error_like('An applied change does not change', $$UPDATE catalog_price_change SET status = 'Cancelled' WHERE reason = 'Annual increase (rule test)'$$, 'does not change');
SELECT pg_temp.expect_true('The price changes are in the audit trail with their reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'test_catalog_entry' AND reason LIKE 'Price change PC-%: Annual increase (rule test)'));

-------------------------------------------------------------------------------
-- 5. THE AUDIT TRAIL
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Audit links: a package to its page, a quoted package to its quote, an ordered package to its sample',
  (SELECT audit_record_ref('test_package', id, to_jsonb(p)) ->> 'link' = '#/catalog/packages/' || id FROM test_package p WHERE package_name = 'PK Basic pair')
  AND (SELECT audit_record_ref('quoted_package', id, to_jsonb(q)) ->> 'link' = '#/quote/' || project_version_id FROM quoted_package q WHERE project_version_id = pg_temp.pk_v('PK quote') AND status = 'Active')
  AND (SELECT audit_record_ref('ordered_package', id, to_jsonb(o)) ->> 'link' = '#/samples/' || sample_id FROM ordered_package o WHERE sample_id = (SELECT id FROM sample WHERE client_sample_id = 'PK-S1')));

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
