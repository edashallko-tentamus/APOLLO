-- 074: the report designer (Edashall Konah, 2026-11-19). COA and invoice templates are designs (blocks and settings)
-- drawn by the server's own renderers, kept in versions (Draft, Effective, Superseded; approval signed, never by the
-- version's author). A template belongs to one lab, or is shared (site_id NULL) and kept by system administrators,
-- who tick, lab by lab, where it may be used. A lab stays on the shared version it accepted until someone there
-- accepts a newer one. The rules are the Java backend's (labsetup/domain/ReportDesign, ReportTemplateService); this
-- migration holds the structures, the permissions and the conversion of the templates already there.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Migration 074: report designer (template versions, shared templates per lab, Report Designer group)', true);

-------------------------------------------------------------------------------
-- 1. TEMPLATES: COA or Invoice, one default per lab and kind
-------------------------------------------------------------------------------
ALTER TABLE report_template ADD COLUMN document_type text NOT NULL DEFAULT 'COA' CHECK (document_type IN ('COA', 'Invoice'));
DROP INDEX report_template_one_default;
CREATE UNIQUE INDEX report_template_one_default ON report_template (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), document_type)
  WHERE is_default AND status = 'Active';

CREATE TABLE report_template_version (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id     uuid NOT NULL REFERENCES report_template(id),
    version_no      integer NOT NULL,
    status          text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Effective', 'Superseded')),
    design          jsonb NOT NULL DEFAULT '{}',
    change_note     text,
    approved_by     uuid REFERENCES app_user(id),
    approved_at     timestamptz,
    signature_id    uuid REFERENCES signature_event(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (template_id, version_no)
);
CREATE UNIQUE INDEX report_template_version_one_draft ON report_template_version (template_id) WHERE status = 'Draft';
CREATE UNIQUE INDEX report_template_version_one_effective ON report_template_version (template_id) WHERE status = 'Effective';
CALL make_gxp('report_template_version', false);   -- a draft is saved often: audited, reason optional

-- a lab template copied from a shared one keeps where it came from
ALTER TABLE report_template ADD COLUMN copied_from_version_id uuid REFERENCES report_template_version(id);

-- a shared template at each lab: may the lab use it, the version the lab accepted, the lab's default
CREATE TABLE report_template_lab (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id         uuid NOT NULL REFERENCES report_template(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    available           boolean NOT NULL DEFAULT false,
    accepted_version_id uuid REFERENCES report_template_version(id),
    is_default          boolean NOT NULL DEFAULT false,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (template_id, site_id)
);
CALL make_gxp('report_template_lab');

-- which template version drew a stored PDF (invoices, corrected copies; a COA keeps it in its content too)
CREATE TABLE document_template_version (
    document_id          uuid PRIMARY KEY REFERENCES document_file(id),
    template_version_id  uuid NOT NULL REFERENCES report_template_version(id),
    created_at           timestamptz NOT NULL DEFAULT now()
);

-------------------------------------------------------------------------------
-- 2. THE TEMPLATES ALREADY THERE: version 1 Effective, their layout and options kept as the design
-------------------------------------------------------------------------------
INSERT INTO report_template (template_name, description, site_id, is_default, document_type)
VALUES ('Standard invoice', 'The invoice and credit note as built (0.19.0)', NULL, true, 'Invoice');

INSERT INTO report_template_version (template_id, version_no, status, design, change_note, approved_by, approved_at)
SELECT id, 1, 'Effective', jsonb_build_object('layout', layout, 'options', options), 'Converted by migration 074',
       (SELECT id FROM app_user WHERE username = 'system'), now()
  FROM report_template;

-- shared templates stay usable where they were: available at every lab, on version 1, the default as before
INSERT INTO report_template_lab (template_id, site_id, available, accepted_version_id, is_default)
SELECT rt.id, s.id, rt.status = 'Active', v.id,
       rt.is_default AND NOT EXISTS (SELECT 1 FROM report_template own WHERE own.site_id = s.id AND own.is_default AND own.status = 'Active' AND own.document_type = rt.document_type)
  FROM report_template rt JOIN report_template_version v ON v.template_id = rt.id CROSS JOIN lab_site s
 WHERE rt.site_id IS NULL;

-- a new lab starts with the shared default templates (COA and invoice) ticked, on their approved version, as its defaults
CREATE FUNCTION lab_site_shared_templates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('lims.reason', COALESCE(NULLIF(current_setting('lims.reason', true), ''), 'New lab: the shared default report templates'), true);
    INSERT INTO report_template_lab (template_id, site_id, available, accepted_version_id, is_default)
    SELECT rt.id, NEW.id, true, v.id, true
      FROM report_template rt JOIN report_template_version v ON v.template_id = rt.id AND v.status = 'Effective'
     WHERE rt.site_id IS NULL AND rt.is_default AND rt.status = 'Active';
    RETURN NEW;
END $$;
CREATE TRIGGER zz_shared_templates AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_shared_templates();

-------------------------------------------------------------------------------
-- 3. LOOKUPS: a lab uses its own templates and the shared ones ticked for it
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION default_report_template(p_site uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT id FROM report_template WHERE status = 'Active' AND is_default AND document_type = 'COA' AND site_id = p_site),
        (SELECT rt.id FROM report_template rt JOIN report_template_lab l ON l.template_id = rt.id AND l.site_id = p_site
          WHERE rt.status = 'Active' AND rt.document_type = 'COA' AND l.available AND l.is_default LIMIT 1))
$$;
CREATE OR REPLACE FUNCTION test_report_template(p_rt uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
        (SELECT t.id FROM report_template t LEFT JOIN report_template_lab l ON l.template_id = t.id AND l.site_id = o.site_id
          WHERE t.id = tv.report_template_id AND (t.site_id = o.site_id OR l.available)),
        default_report_template(o.site_id))
      FROM requested_test rt JOIN test_version tv ON tv.id = rt.test_version_id JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
     WHERE rt.id = p_rt
$$;

-------------------------------------------------------------------------------
-- 4. PERMISSIONS AND THE REPORT DESIGNER GROUP
-------------------------------------------------------------------------------
SELECT set_config('lims.group_sync', '1', true);
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('reports.design', 'Reports', 'Report templates', 'Design the lab''s report templates (COA and invoice): make, copy and change drafts. Shared templates are kept by system administrators', false, 97);
UPDATE permission SET description = 'Approve the lab''s report template versions (COA and invoice), signed; never a version you worked on' WHERE code = 'reports.templates';

INSERT INTO standard_group_template (group_name, description, permissions, sort_order) VALUES
 ('Report Designer', 'Designs the lab''s COA and invoice templates. QA or a General Manager approves them.', '{reports.design}',
  (SELECT COALESCE(max(sort_order), 0) + 1 FROM standard_group_template));
INSERT INTO lab_group (site_id, group_name, description, is_standard)
SELECT s.id, 'Report Designer', 'Designs the lab''s COA and invoice templates. QA or a General Manager approves them.', true
  FROM lab_site s WHERE NOT EXISTS (SELECT 1 FROM lab_group g WHERE g.site_id = s.id AND lower(g.group_name) = 'report designer');

-- design: Report Designer, and the groups that kept templates before (QA, Administrator); approve: QA and General Manager
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Report Designer', '{reports.design}'), ('QA', '{reports.design}'), ('Administrator', '{reports.design}'),
                                 ('General Manager', '{reports.templates}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;
UPDATE standard_group_template SET permissions = array_remove(permissions, 'reports.templates') WHERE group_name = 'Administrator';
UPDATE group_permission gp SET status = 'Inactive' FROM lab_group g
 WHERE g.id = gp.group_id AND g.is_standard AND g.group_name = 'Administrator' AND gp.permission_code = 'reports.templates' AND gp.status = 'Active';
SELECT set_config('lims.group_sync', '', true);
COMMIT;
