-- Sandbox lab assignments: every demo user works in every lab, except the demo intake tech (CFL only),
-- so switching "Working as" shows the restriction. Change it under Admin > Users and lab access.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);

INSERT INTO user_site_access (user_id, site_id)
SELECT u.id, s.id FROM app_user u, lab_site s
 WHERE u.is_active AND NOT u.is_automated AND s.status = 'Active' AND (u.username <> 'intake' OR s.site_code = 'CFL')
ON CONFLICT (user_id, site_id) DO NOTHING;

COMMIT;
