-- Sandbox demo data: Edashall Konah (ekonah) is a second system administrator beside Alex Kiddle (akiddle), set up
-- the same way: General Manager and Administrator groups at every active lab. On a new database the first-time setup
-- then offers both accounts. Skipped when ekonah already exists.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data: second system administrator', true);

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app_user WHERE username = 'ekonah') THEN
        RAISE NOTICE 'seed_040: ekonah already exists, skipped';
        RETURN;
    END IF;
    INSERT INTO app_user (username, full_name) VALUES ('ekonah', 'Edashall Konah');
    UPDATE app_user SET is_admin = true, job_role = 'General Manager' WHERE username = 'ekonah';
    -- the lab access trigger puts a system administrator in each lab's Administrator and job role groups
    INSERT INTO user_site_access (user_id, site_id)
    SELECT u.id, s.id FROM app_user u, lab_site s WHERE u.username = 'ekonah' AND s.status = 'Active'
    ON CONFLICT (user_id, site_id) DO NOTHING;
END $$;

COMMIT;
