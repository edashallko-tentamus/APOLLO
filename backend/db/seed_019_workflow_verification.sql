-- Workflow verification (WD-6, migration 024): CFL and TPS require a signed, passing verification before a test version
-- is approved (Alex Kiddle, 2026-10-13: "every test version"). Versions approved before keep their approval.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Workflow verification required before approval (Alex, WD-6)', true);
UPDATE lab_site SET require_workflow_verification = true WHERE site_code IN ('CFL', 'TPS') AND NOT require_workflow_verification;
COMMIT;
