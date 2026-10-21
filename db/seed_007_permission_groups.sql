-- Sandbox demo data for permissions (migration 008): an executive who can see every lab (view only), and a lab-defined
-- group next to the standard ones: CFL's "HPTLC" group (no members yet: add someone on Admin > People and groups and their
-- permissions add up).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO app_user (username, full_name) VALUES ('exec', 'Executive (demo)') ON CONFLICT (username) DO NOTHING;
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Admin', r, s FROM (VALUES ('Promotion', 50), ('Covering another role', 60), ('Correcting an access error', 70), ('New group set up', 80)) AS x(r, s)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Admin' AND lower(c.reason_text) = lower(x.r));
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g, app_user u WHERE g.site_id IS NULL AND g.group_name = 'Executive (all labs, view only)' AND u.username = 'exec'
ON CONFLICT DO NOTHING;

INSERT INTO lab_group (site_id, group_name, description)
SELECT id, 'HPTLC', 'Runs the HPTLC (CAMAG) instruments: approves purchases of plates and standards for them.' FROM lab_site WHERE site_code = 'CFL'
ON CONFLICT DO NOTHING;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN lab_site s ON s.id = g.site_id, unnest('{inventory.edit,inventory.use,inventory.request,inventory.approve}'::text[]) p
 WHERE s.site_code = 'CFL' AND g.group_name = 'HPTLC'
ON CONFLICT DO NOTHING;

COMMIT;
