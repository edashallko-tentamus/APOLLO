-- Canned reasons for the stability pages (migration 041, S-2): placement, amendments, cancellation, disposal and
-- issued reports. Each lab's QA can change them in Admin > Canned reasons.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Canned reasons for stability studies', true);
SELECT script_signature('Canned reasons for stability studies');
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT x.m, x.r, x.o FROM (VALUES
 ('Stability', 'Material received from the client', 10),
 ('Stability', 'Amendment requested by the client', 20),
 ('Stability', 'Study cancelled by the client', 30),
 ('Stability', 'Product discontinued', 40),
 ('Stability', 'Material no longer needed for the study', 50),
 ('Stability', 'Pull results finalized', 60),
 ('Stability', 'Report reissued after a correction', 70)
) x(m, r, o)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = x.m AND lower(c.reason_text) = lower(x.r));
COMMIT;
