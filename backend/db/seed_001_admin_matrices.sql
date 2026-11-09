-- Sandbox setup for migration 004: Alex Kiddle is the administrator, and the controlled Matrix list.
-- Runs before seed_002 on a new database (its samples need the list). Fictional demo data.
BEGIN;
SET search_path = lims, public;
UPDATE app_user SET is_admin = true WHERE username = 'akiddle';
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);

INSERT INTO matrix (matrix_name, description)
SELECT m.n, m.d FROM (VALUES
  ('Powder', 'Dry powders, e.g. protein or supplement powders'),
  ('Capsule', 'Hard or soft capsules'),
  ('Tablet', 'Tablets and caplets'),
  ('Softgel', 'Softgel capsules'),
  ('Gummy', 'Gummies and chewables'),
  ('Liquid', 'Liquids, syrups and beverages'),
  ('Oil', 'Oils and oil-based products'),
  ('Tincture', 'Tinctures and extracts in solvent'),
  ('Bar', 'Nutrition and snack bars'),
  ('Snack', 'Snack foods and mixes'),
  ('Raw Material', 'Ingredients and raw materials'),
  ('Plant Material', 'Botanicals, herbs and plant parts'),
  ('Cream or Lotion', 'Topical creams, lotions and ointments'),
  ('Water', 'Water samples'),
  ('Environmental Swab', 'Environmental monitoring swabs')
) AS m(n, d)
WHERE NOT EXISTS (SELECT 1 FROM matrix x WHERE lower(x.matrix_name) = lower(m.n));

-- Matrices already typed on samples stay valid and selectable (an administrator can set any that are wrong to Inactive)
INSERT INTO matrix (matrix_name, description)
SELECT DISTINCT ON (lower(btrim(s.matrix))) btrim(s.matrix), 'Added from existing samples'
  FROM sample s
 WHERE s.matrix IS NOT NULL AND btrim(s.matrix) <> ''
   AND NOT EXISTS (SELECT 1 FROM matrix x WHERE lower(x.matrix_name) = lower(btrim(s.matrix)));

COMMIT;
