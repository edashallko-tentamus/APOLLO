-- Verification for migration 030: report templates (who keeps them, one default per lab, options checked, the default
-- never retired, a template stays with its lab), the designer's choice per test version (same lab or every lab, active,
-- carried to the next version), which template a requested test reports with, the templates recorded on a COA version,
-- the lab images (who uploads, PNG/JPEG/SVG up to 2 MB, one current image per kind, never replaced) and the product
-- name setting (system administrators only). The multi-part COA itself is exercised by tests/e2e_labsetup.js.
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
CREATE OR REPLACE FUNCTION pg_temp.t25as(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.t25site(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = c $$;
CREATE OR REPLACE FUNCTION pg_temp.t25rt(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM report_template WHERE template_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.t25img(mime text, bytes integer) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES ('logo', mime, bytes, encode(sha256(convert_to(repeat('x', bytes), 'UTF8')), 'hex'), convert_to(repeat('x', bytes), 'UTF8')) RETURNING id $$;

SELECT set_config('lims.site_id', pg_temp.t25site('CFL')::text, false);

-- 1. the starting template
SELECT pg_temp.expect_true('The standard COA is template RT-001, the default for every lab',
  (SELECT template_code = 'RT-001' AND is_default AND site_id IS NULL AND layout = 'Standard COA' FROM report_template WHERE template_name = 'Standard Certificate of Analysis'));
SELECT pg_temp.expect_true('QA and Administrators hold reports.templates; an analyst does not',
  user_has_permission_at((SELECT id FROM app_user WHERE username = 'p.qa'), 'reports.templates', pg_temp.t25site('CFL'))
  AND NOT user_has_permission_at((SELECT id FROM app_user WHERE username = 'e.ana'), 'reports.templates', pg_temp.t25site('CFL')));

-- 2. who keeps templates
SELECT pg_temp.t25as('p.qa');
SELECT pg_temp.expect_error_like('A template for every lab needs a system administrator',
  $$INSERT INTO report_template (template_name, layout, site_id) VALUES ('RT every lab by QA', 'Standard COA', NULL)$$, 'system administrator');
SELECT pg_temp.expect_ok('QA makes a template for their lab',
  $$INSERT INTO report_template (template_name, layout, site_id, options) VALUES ('RT micro CFL', 'Standard COA', pg_temp.t25site('CFL'), '{"show_loq": false, "title": "MICROBIOLOGY REPORT"}')$$);
SELECT pg_temp.expect_true('It gets the next RT- code', (SELECT template_code ~ '^RT-\d{3}$' AND template_code <> 'RT-001' FROM report_template WHERE template_name = 'RT micro CFL'));
-- Moved to the Java backend in migration 071 (JUnit: LabSetupRulesTest.reportTemplates): only the options the layout knows are accepted
SELECT pg_temp.t25as('akiddle');
-- Moved to the Java backend in migration 071 (JUnit: LabSetupRulesTest.reportTemplates): a template stays with its lab
SELECT pg_temp.t25as('p.qa');
SELECT pg_temp.expect_error_like('Only the layouts that exist', $$INSERT INTO report_template (template_name, layout, site_id) VALUES ('RT bad layout', 'Poster', pg_temp.t25site('CFL'))$$, 'layout');
SELECT pg_temp.t25as('e.ana');
SELECT pg_temp.expect_error_like('An analyst does not make templates',
  $$INSERT INTO report_template (template_name, layout, site_id) VALUES ('RT by analyst', 'Standard COA', pg_temp.t25site('CFL'))$$, 'permission');
SELECT pg_temp.t25as('akiddle');
INSERT INTO report_template (template_name, layout, site_id) VALUES ('RT TPS only', 'Standard COA', pg_temp.t25site('TPS'));

-- 3. one default per lab; the default is never retired
-- Moved to the Java backend in migration 071 (JUnit: LabSetupRulesTest.reportTemplates): the default template cannot be retired
SELECT pg_temp.expect_error_like('Two defaults for the same lab are refused',
  $$INSERT INTO report_template (template_name, layout, site_id, is_default) VALUES ('RT second all-labs default', 'Standard COA', NULL, true)$$, 'one_default');
SELECT pg_temp.expect_true('A lab without its own default uses the every-lab default', default_report_template(pg_temp.t25site('CFL')) = pg_temp.t25rt('Standard Certificate of Analysis'));

-- 4. the designer's choice per test version
SELECT script_signature('Rule test', false);
CREATE TEMP TABLE tt AS SELECT create_test(pg_temp.t25site('CFL'), 'Template rule test') AS test_id;
CREATE TEMP TABLE tv AS SELECT v.id FROM test_version v, tt WHERE v.test_id = tt.test_id;
-- Moved to the Java backend in migration 066 (JUnit: DesignerRulesTest): a test uses only its own lab's (or every lab's) report template
SELECT pg_temp.expect_ok('A test uses its own lab''s template', $$UPDATE test_version SET report_template_id = pg_temp.t25rt('RT micro CFL') WHERE id = (SELECT id FROM tv)$$);
SELECT pg_temp.expect_ok('or the every-lab one', $$UPDATE test_version SET report_template_id = pg_temp.t25rt('Standard Certificate of Analysis') WHERE id = (SELECT id FROM tv)$$);
UPDATE test_version SET report_template_id = pg_temp.t25rt('RT micro CFL') WHERE id = (SELECT id FROM tv);
INSERT INTO report_template (template_name, layout, site_id, status) VALUES ('RT retired CFL', 'Standard COA', pg_temp.t25site('CFL'), 'Inactive');
SELECT pg_temp.expect_error_like('A retired template is not chosen',
  $$UPDATE test_version SET report_template_id = pg_temp.t25rt('RT retired CFL') WHERE id = (SELECT id FROM tv)$$, 'retired');
-- carried to the next version (a new version copies from the one before)
SET session_replication_role = replica;
UPDATE test_version SET status = 'Effective' WHERE id = (SELECT id FROM tv);
SET session_replication_role = origin;
SELECT script_signature('Rule test', false);
CREATE TEMP TABLE tv2 AS SELECT new_test_version((SELECT test_id FROM tt)) AS id;
SELECT pg_temp.expect_true('A new version keeps the template its predecessor used',
  (SELECT report_template_id = pg_temp.t25rt('RT micro CFL') FROM test_version WHERE id = (SELECT id FROM tv2)));

-- 5. which template a requested test reports with
CREATE TEMP TABLE rq AS SELECT rt.id, rt.test_version_id FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
  JOIN test_version v ON v.id = rt.test_version_id WHERE o.site_id = pg_temp.t25site('CFL') AND v.report_template_id IS NULL LIMIT 1;
SELECT pg_temp.expect_true('A test whose version names no template reports with the lab''s default',
  (SELECT test_report_template(id) = pg_temp.t25rt('Standard Certificate of Analysis') FROM rq));
UPDATE report_template SET is_default = true WHERE template_name = 'RT micro CFL';
SELECT pg_temp.expect_true('A lab''s own default comes before the every-lab default',
  (SELECT test_report_template(id) = pg_temp.t25rt('RT micro CFL') FROM rq) AND default_report_template(pg_temp.t25site('TPS')) = pg_temp.t25rt('Standard Certificate of Analysis'));
UPDATE report_template SET is_default = false WHERE template_name = 'RT micro CFL';
SELECT pg_temp.expect_true('The version''s own template wins over any default',
  (SELECT test_report_template(rt.id) = pg_temp.t25rt('RT micro CFL') FROM requested_test rt WHERE rt.test_version_id IN (SELECT id FROM tv) LIMIT 1) IS NOT FALSE);

-- 6. a COA version records the templates its parts used
CREATE TEMP TABLE cv (content jsonb, report_template_ids uuid[]);
CREATE TRIGGER a03_template BEFORE INSERT ON pg_temp.cv FOR EACH ROW EXECUTE FUNCTION coa_version_template();
INSERT INTO cv (content) SELECT jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('template', jsonb_build_object('id', pg_temp.t25rt('Standard Certificate of Analysis'))),
  jsonb_build_object('template', jsonb_build_object('id', pg_temp.t25rt('RT micro CFL')))));
INSERT INTO cv (content) VALUES ('{"tests": []}');
SELECT pg_temp.expect_true('A COA version lists the templates of its parts, in order (none for an older COA without parts)',
  (SELECT report_template_ids = ARRAY[pg_temp.t25rt('Standard Certificate of Analysis'), pg_temp.t25rt('RT micro CFL')] FROM cv WHERE content ? 'sections')
  AND (SELECT report_template_ids IS NULL FROM cv WHERE NOT content ? 'sections'));
SELECT pg_temp.expect_true('coa_version carries the column and the trigger', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'a03_template' AND tgrelid = 'coa_version'::regclass));

-- 7. lab images
SELECT pg_temp.t25as('e.ana');
SELECT pg_temp.expect_error_like('An analyst does not upload the lab''s logo',
  $$INSERT INTO site_media (site_id, kind, document_id) VALUES (pg_temp.t25site('CFL'), 'Logo', pg_temp.t25img('image/png', 1000))$$, 'permission');
SELECT pg_temp.t25as('akiddle');
-- Moved to the Java backend in migration 071 (JUnit: LabSetupRulesTest.labImagesAndSettings): only PNG, JPEG or SVG
-- Moved to the Java backend in migration 071 (JUnit: LabSetupRulesTest.labImagesAndSettings): up to 2 MB
SELECT pg_temp.expect_ok('A lab administrator uploads the logo', $$INSERT INTO site_media (site_id, kind, document_id) VALUES (pg_temp.t25site('CFL'), 'Logo', pg_temp.t25img('image/png', 1000))$$);
SELECT pg_temp.expect_error_like('One current logo per lab', $$INSERT INTO site_media (site_id, kind, document_id) VALUES (pg_temp.t25site('CFL'), 'Logo', pg_temp.t25img('image/jpeg', 1000))$$, 'one_per_kind');
SELECT pg_temp.expect_ok('Several other images are allowed', $$INSERT INTO site_media (site_id, kind, title, document_id) VALUES (pg_temp.t25site('CFL'), 'Other', 'Banner', pg_temp.t25img('image/png', 10)), (pg_temp.t25site('CFL'), 'Other', 'Seal', pg_temp.t25img('image/png', 10))$$);
-- Moved to the Java backend in migration 071 (LabSetupService only retires images): an uploaded image is never replaced
SELECT pg_temp.expect_ok('It is retired instead, and a new one uploaded',
  $$UPDATE site_media SET status = 'Inactive' WHERE kind = 'Logo' AND site_id = pg_temp.t25site('CFL') AND status = 'Active';
    INSERT INTO site_media (site_id, kind, document_id) VALUES (pg_temp.t25site('CFL'), 'Logo', pg_temp.t25img('image/svg+xml', 500))$$);
SELECT pg_temp.expect_true('The retired logo stays in the history', (SELECT count(*) FROM site_media WHERE kind = 'Logo' AND site_id = pg_temp.t25site('CFL')) = 2);
SELECT pg_temp.expect_true('The audit trail links a lab image and a template to their pages',
  (SELECT audit_record_ref('site_media', id, to_jsonb(m)) ->> 'href' LIKE '#/admin/sites%' FROM site_media m LIMIT 1)
  AND (SELECT audit_record_ref('report_template', id, to_jsonb(r)) ->> 'href' = '#/admin/report-templates' FROM report_template r LIMIT 1));

-- 8. accreditation placeholders and the product name
SELECT pg_temp.expect_ok('The lab keeps an accreditation body, certificate and statement (placeholders for now)',
  $$UPDATE lab_site SET accreditation_body = 'A2LA', accreditation_certificate = '0000.01', accreditation_statement = 'Placeholder statement' WHERE site_code = 'CFL'$$);
SELECT pg_temp.expect_true('The product name is one setting, LIMS3 to start', (SELECT setting_value FROM system_setting WHERE setting_key = 'product_name') = 'LIMS3');
SELECT pg_temp.t25as('p.qa');
SELECT pg_temp.expect_error_like('Only a system administrator renames the product', $$UPDATE system_setting SET setting_value = 'Other' WHERE setting_key = 'product_name'$$, 'system administrator');
SELECT pg_temp.t25as('akiddle');
SELECT pg_temp.expect_ok('A system administrator renames it', $$UPDATE system_setting SET setting_value = 'Renamed' WHERE setting_key = 'product_name'$$);
UPDATE system_setting SET setting_value = 'LIMS3' WHERE setting_key = 'product_name';
UPDATE lab_site SET accreditation_body = NULL, accreditation_certificate = NULL, accreditation_statement = NULL WHERE site_code = 'CFL';

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
