-- The sensor feed (migration 045): the pretend sensor connection switched on at CFL in test databases only, so the
-- browser test can link and read sensors. A test database is told apart by CFL's workflow verification gate, which
-- fresh databases have on (seed_019) and Alex's data has off (his choice): on his data the connection stays off for a
-- system administrator to decide. The pretend service serves made-up readings; nothing reaches a logbook until
-- someone links a sensor and QA approves the link.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.reason', 'Test database: the pretend sensor connection switched on', true);
DO $$
BEGIN
    IF NOT COALESCE((SELECT require_workflow_verification FROM lab_site WHERE site_code = 'CFL'), false) THEN
        RAISE NOTICE 'seed_035: CFL''s verification gate is off (not a fresh test database): the sensor connection stays off';
        RETURN;
    END IF;
    PERFORM set_config('lims.group_sync', '1', true);
    UPDATE sensor_connection SET enabled = true, mode = 'Pretend (sandbox)' WHERE site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL');
    PERFORM set_config('lims.group_sync', '', true);
END $$;
COMMIT;
