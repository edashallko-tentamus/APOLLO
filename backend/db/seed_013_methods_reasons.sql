-- Canned reasons for migration 015 (test workflow changes are signed with a reason): one that fits building a Draft,
-- so the reason is a single pick while a version is being developed. QA can change the list (Admin > Canned reasons).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT script_signature('Sandbox demo data');
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Methods', r, s FROM (VALUES ('Draft being developed (before approval)', 5), ('Step or setting added to the workflow', 25)) AS x(r, s)
 WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Methods' AND lower(c.reason_text) = lower(x.r));
COMMIT;
