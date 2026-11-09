-- After migration 021 (WD-5): orders recorded as Complete move to the new statuses (Approved, In Review, In Testing),
-- recalculated from their tests. Runs as Alex's account with a data load signature, like the earlier demo seeds; skipped
-- (with a notice) if anything stops it, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Order statuses after WD-5 (Complete replaced by Approved)', true);
SELECT script_signature('Order statuses after WD-5');
DO $$ BEGIN
    PERFORM refresh_order_status(o.id) FROM lab_order o WHERE o.status IN ('Complete','In Testing');
EXCEPTION WHEN others THEN RAISE NOTICE 'Order status refresh skipped: %', SQLERRM;
END $$;
COMMIT;
