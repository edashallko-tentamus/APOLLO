-- Vendor approvals (migration 050): the demo Corporate QA person (corp.qa, "Corporate QA (demo)") in the all-labs
-- Corporate QA group, so corporate approvals and proposals can be tried. No password until an administrator sets a
-- temporary one, like the other demo users.
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO app_user (username, full_name) VALUES ('corp.qa', 'Corporate QA (demo)') ON CONFLICT (username) DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g, app_user u WHERE g.site_id IS NULL AND g.group_name = 'Corporate QA (all labs)' AND u.username = 'corp.qa'
ON CONFLICT DO NOTHING;
