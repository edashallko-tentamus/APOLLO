-- Alex's answers on the quick design items (2026-10-14):
--  1. Accreditation: a placeholder per lab (body, certificate number, statement), printed on the COA once filled in.
--  2. Report templates: many templates, chosen per test in the Workflow Designer, defaulting to today's COA. They are
--     kept in Admin > Lab setup > Report templates. Each template names a layout the server knows how to draw (only
--     "Standard COA" today) and the options that layout honours; more layouts come later.
--  3. Lab media: each lab's logo, small logo and accreditation mark uploaded on the lab's page (placeholders until
--     then); the COA prints the logo and mark when they exist.
--  4. The product name is one setting (LIMS3 until the name is chosen).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 030: report templates, lab media, accreditation placeholders', true);

-------------------------------------------------------------------------------
-- 0. PERMISSION
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('reports.templates', 'Reports', 'Report templates', 'Keep the lab''s report templates (which layout and options each template uses)', false, 96);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{reports.templates}'), ('Administrator', '{reports.templates}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-------------------------------------------------------------------------------
-- 1. ACCREDITATION PLACEHOLDERS AND THE PRODUCT NAME
-------------------------------------------------------------------------------
ALTER TABLE lab_site ADD COLUMN accreditation_body text;
ALTER TABLE lab_site ADD COLUMN accreditation_certificate text;
ALTER TABLE lab_site ADD COLUMN accreditation_statement text;   -- printed on the COA when set, e.g. "Accredited to ISO/IEC 17025:2017 by ..."

CREATE TABLE system_setting (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    setting_key     text NOT NULL UNIQUE,
    setting_value   text NOT NULL CHECK (btrim(setting_value) <> ''),
    description     text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('system_setting');
CREATE FUNCTION system_setting_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator changes system settings'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.setting_key <> OLD.setting_key THEN RAISE EXCEPTION 'A setting keeps its name'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON system_setting FOR EACH ROW EXECUTE FUNCTION system_setting_rules();
INSERT INTO system_setting (setting_key, setting_value, description) VALUES
 ('product_name', 'LIMS3', 'The system''s name, shown in the header, the browser tab and the sign-in page');

-------------------------------------------------------------------------------
-- 2. REPORT TEMPLATES
-------------------------------------------------------------------------------
CREATE SEQUENCE report_template_seq;
CREATE TABLE report_template (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code   text NOT NULL UNIQUE DEFAULT 'RT-' || lpad(nextval('report_template_seq')::text, 3, '0'),
    template_name   text NOT NULL CHECK (btrim(template_name) <> ''),
    description     text,
    layout          text NOT NULL DEFAULT 'Standard COA' CHECK (layout IN ('Standard COA')),   -- the layouts the server can draw
    site_id         uuid REFERENCES lab_site(id),        -- NULL: every lab
    is_default      boolean NOT NULL DEFAULT false,      -- the default of its lab (or of every lab, when site_id is NULL)
    options         jsonb NOT NULL DEFAULT '{}',         -- what the layout shows: show_method, show_test_version, show_tested_dates, show_loq, title
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX report_template_one_default ON report_template (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_default AND status = 'Active';
CALL make_gxp('report_template');
CREATE FUNCTION report_template_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.site_id IS NULL) THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Templates for every lab are kept by a system administrator; make one for your lab instead'; END IF;
    ELSE
        PERFORM require_permission_at('reports.templates', NEW.site_id);
        IF TG_OP = 'UPDATE' AND OLD.site_id IS DISTINCT FROM NEW.site_id THEN RAISE EXCEPTION 'A template stays with its lab'; END IF;
    END IF;
    IF jsonb_typeof(NEW.options) <> 'object' THEN RAISE EXCEPTION 'Template options must be a set of named settings'; END IF;
    FOR k IN SELECT jsonb_object_keys(NEW.options) LOOP
        IF k NOT IN ('show_method','show_test_version','show_tested_dates','show_loq','title') THEN RAISE EXCEPTION 'Unknown template option "%"', k; END IF;
    END LOOP;
    IF NEW.status <> 'Active' AND NEW.is_default THEN RAISE EXCEPTION 'The default template cannot be retired: make another one the default first'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON report_template FOR EACH ROW EXECUTE FUNCTION report_template_rules();
INSERT INTO report_template (template_code, template_name, description, layout, site_id, is_default, options) VALUES
 ('RT-001', 'Standard Certificate of Analysis', 'The COA built in R-1: lab and client headers, one results table per test, notes, the decision rule, the signature and the verification code.',
  'Standard COA', NULL, true, '{"show_method": true, "show_test_version": true, "show_tested_dates": true, "show_loq": true, "title": "CERTIFICATE OF ANALYSIS"}');
SELECT setval('report_template_seq', 1);

-- The template a test version reports with (NULL: its lab's default); carried to new versions
ALTER TABLE test_version ADD COLUMN report_template_id uuid REFERENCES report_template(id);
CREATE FUNCTION test_version_carry_030() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.copied_from_version_id IS NOT NULL AND NEW.report_template_id IS NULL THEN
        SELECT report_template_id INTO NEW.report_template_id FROM test_version WHERE id = NEW.copied_from_version_id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_carry_030 BEFORE INSERT ON test_version FOR EACH ROW EXECUTE FUNCTION test_version_carry_030();
CREATE FUNCTION test_version_template_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r report_template; v_site uuid;
BEGIN
    IF NEW.report_template_id IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO r FROM report_template WHERE id = NEW.report_template_id;
    SELECT site_id INTO v_site FROM test WHERE id = NEW.test_id;
    IF r.status <> 'Active' AND (TG_OP = 'INSERT' OR OLD.report_template_id IS DISTINCT FROM NEW.report_template_id) THEN RAISE EXCEPTION 'Report template % is retired', r.template_name; END IF;
    IF r.site_id IS NOT NULL AND r.site_id IS DISTINCT FROM v_site THEN RAISE EXCEPTION 'Report template % belongs to another lab', r.template_name; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_report_template BEFORE INSERT OR UPDATE OF report_template_id ON test_version FOR EACH ROW EXECUTE FUNCTION test_version_template_rule();

-- The lab's default template (its own, else the all-labs default)
CREATE FUNCTION default_report_template(p_site uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT id FROM report_template WHERE status = 'Active' AND is_default AND (site_id = p_site OR site_id IS NULL)
     ORDER BY (site_id IS NULL) LIMIT 1
$$;
-- The template a requested test reports with: its version's, else its lab's default. A COA whose tests use different
-- templates is one PDF in parts, one part per template, each test in its own template's part (Alex, 2026-10-14).
CREATE FUNCTION test_report_template(p_rt uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(tv.report_template_id, default_report_template(o.site_id))
      FROM requested_test rt JOIN test_version tv ON tv.id = rt.test_version_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
     WHERE rt.id = p_rt
$$;

-- Which templates drew each COA version (from its content's parts), kept with the version
ALTER TABLE coa_version ADD COLUMN report_template_ids uuid[];
CREATE FUNCTION coa_version_template() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF jsonb_typeof(NEW.content->'sections') = 'array' THEN
        NEW.report_template_ids := ARRAY(SELECT (x->'template'->>'id')::uuid FROM jsonb_array_elements(NEW.content->'sections') x
                                          WHERE (x->'template'->>'id') ~ '^[0-9a-f-]{36}$');
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a03_template BEFORE INSERT ON coa_version FOR EACH ROW EXECUTE FUNCTION coa_version_template();

-------------------------------------------------------------------------------
-- 3. LAB MEDIA (logos, accreditation marks)
-------------------------------------------------------------------------------
CREATE TABLE site_media (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    kind            text NOT NULL CHECK (kind IN ('Logo','Small logo','Accreditation mark','Other')),
    title           text,
    document_id     uuid NOT NULL REFERENCES document_file(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX site_media_one_per_kind ON site_media (site_id, kind) WHERE status = 'Active' AND kind <> 'Other';
CALL make_gxp('site_media');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON site_media FOR EACH ROW EXECUTE FUNCTION lab_record_permission('admin.lab');
CREATE FUNCTION site_media_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d document_file;
BEGIN
    SELECT * INTO d FROM document_file WHERE id = NEW.document_id;
    IF d.mime_type NOT IN ('image/png','image/jpeg','image/svg+xml') THEN RAISE EXCEPTION 'Upload a PNG, JPEG or SVG image'; END IF;
    IF d.size_bytes > 2 * 1024 * 1024 THEN RAISE EXCEPTION 'The image is larger than 2 MB'; END IF;
    IF TG_OP = 'UPDATE' AND (NEW.document_id, NEW.site_id, NEW.kind) IS DISTINCT FROM (OLD.document_id, OLD.site_id, OLD.kind) THEN
        RAISE EXCEPTION 'An uploaded image is never replaced: retire it and upload a new one';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_rules BEFORE INSERT OR UPDATE ON site_media FOR EACH ROW EXECUTE FUNCTION site_media_rules();

-------------------------------------------------------------------------------
-- 4. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_030;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'report_template' THEN
        RETURN jsonb_build_object('label', 'Report template ' || COALESCE(r->>'template_code', '') || ' ' || COALESCE(r->>'template_name', ''), 'href', '#/admin/report-templates');
    ELSIF p_table = 'site_media' THEN
        RETURN jsonb_build_object('label', COALESCE(r->>'kind', 'Image') || ' of ' || COALESCE((SELECT site_code FROM lab_site WHERE id = (r->>'site_id')::uuid), 'a lab'),
                                  'href', '#/admin/sites/' || COALESCE(r->>'site_id', ''));
    END IF;
    RETURN audit_record_ref_030(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
