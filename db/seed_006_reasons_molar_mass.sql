-- Sandbox starter data for slice 3.2: canned reasons per module (QA edits them under Admin > Canned reasons) and
-- molar masses for the analytes already on the list (IUPAC standard atomic weights, abridged). Signed as a data load script.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT m, r, s FROM (VALUES
  ('General', 'Typing error corrected', 10), ('General', 'Data entry error corrected', 20), ('General', 'Information received from the client', 30),
  ('General', 'Correction after review', 40),
  ('Inventory', 'Stock count reconciliation', 10), ('Inventory', 'Spill or breakage', 20), ('Inventory', 'Expired: removed from use', 30),
  ('Inventory', 'Contaminated or compromised', 40), ('Inventory', 'Received quantity differs from the packing slip', 50),
  ('Inventory', 'Values entered from the Supplier COA', 60), ('Inventory', 'Storage location changed', 70), ('Inventory', 'Reorder no longer needed', 80),
  ('Inventory', 'Monthly inventory update', 90),
  ('Orders', 'Client requested the change', 10), ('Orders', 'Sample logged against the wrong order', 20), ('Orders', 'Rush requested by the client', 30),
  ('Orders', 'Turnaround agreed with the client', 40), ('Orders', 'Test cancelled at the client''s request', 50),
  ('Clients', 'Client updated their details', 10), ('Clients', 'Account placed on hold by Accounts', 20), ('Clients', 'Hold released by Accounts', 30),
  ('Quotes', 'Pricing correction', 10), ('Quotes', 'Price negotiated with the client', 20),
  ('Catalog', 'Annual price update', 10), ('Catalog', 'Method change', 20), ('Catalog', 'Turnaround change', 30),
  ('Admin', 'New starter', 10), ('Admin', 'Leaver: access removed', 20), ('Admin', 'Role change', 30), ('Admin', 'Periodic access review', 40)
) AS x(m, r, s)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = x.m AND lower(c.reason_text) = lower(x.r));

UPDATE analyte a SET molar_mass = v.mm, molar_mass_source = 'IUPAC standard atomic weights (abridged, 2021)'
  FROM (VALUES ('Lead', 207.2), ('Arsenic', 74.922), ('Cadmium', 112.41), ('Mercury', 200.59), ('Chromium', 51.996), ('Nickel', 58.693),
               ('Copper', 63.546), ('Zinc', 65.38), ('Antimony', 121.76), ('Selenium', 78.971), ('Sodium', 22.990), ('Boron', 10.81), ('Iron', 55.845)) AS v(n, mm)
 WHERE lower(a.analyte_name) = lower(v.n) AND a.molar_mass IS NULL;

COMMIT;
