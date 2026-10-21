-- Sandbox demo data for migration 036 (I-1 invoicing):
--  - a demo Accounting user (billing, "Accounting (demo)") in the Accounting group at CFL and TPS;
--  - canned reasons for invoicing;
--  - the catch-up (Alex, 2026-10-15: "Do the backdating on the week the work was completed - that mimics how we
--    currently invoice on a weekly basis"): completed work (COA issued) from before this week is invoiced, one invoice
--    per lab order per week, dated the Friday of that week; not emailed, not pushed to QuickBooks. This week's work
--    waits in Billing > Ready to invoice. A fresh database has no completed work yet, so it makes nothing there.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO app_user (username, full_name) VALUES ('billing', 'Accounting (demo)') ON CONFLICT (username) DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id, app_user u
 WHERE s.site_code IN ('CFL', 'TPS') AND g.group_name = 'Accounting' AND g.status = 'Active' AND u.username = 'billing'
ON CONFLICT DO NOTHING;

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT x.m, x.r, x.o FROM (VALUES
 ('Invoicing', 'Discount corrected to the accepted quote', 10),
 ('Invoicing', 'Rush reported late: billed at the tier met', 20),
 ('Invoicing', 'Price agreed with the client', 30),
 ('Invoicing', 'Billing error corrected', 40),
 ('Invoicing', 'Goodwill credit', 50),
 ('Invoicing', 'Work billed on the wrong order', 60)) AS x(m, r, o)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = x.m AND lower(c.reason_text) = lower(x.r));

-- the catch-up, as the system (a data load), once
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT script_signature('Catch-up invoices (data load)');
SELECT invoice_catch_up() WHERE NOT EXISTS (SELECT 1 FROM invoice WHERE catchup);
SELECT set_config('lims.group_sync', '', true);
COMMIT;
