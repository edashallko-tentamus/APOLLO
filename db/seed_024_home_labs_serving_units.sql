-- 0.16.1 (migration 031), Alex 2026-10-14:
--  - "Any lab" is gone from quoting: the shared tests made before tests belonged to a lab (Heavy Metals Panel,
--    Moisture, Water Activity, Total Aerobic Plate Count, Yeast and Mold, Salmonella, pH) get a home lab, CFL, where
--    they have always been ordered. Another lab then quotes them as subcontracted (the 20-30 rule). A test whose name
--    CFL already uses stays shared (none on the demo data or Alex's).
--  - Serving units on the Units list (Claude's first list, for QA to adjust in Admin > Units).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Shared tests given a home lab; serving units added (0.16.1)', true);
SELECT script_signature('Data load script');

UPDATE test t SET site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL')
 WHERE t.site_id IS NULL AND EXISTS (SELECT 1 FROM lab_site WHERE site_code = 'CFL')
   AND NOT EXISTS (SELECT 1 FROM test o JOIN lab_site s ON s.id = o.site_id AND s.site_code = 'CFL' WHERE lower(o.test_name) = lower(t.test_name));

-- serving units (a count of something the client takes); existing count units that are also servings are marked
INSERT INTO unit_of_measure (unit_code, unit_name, dimension, sort_order, is_serving_unit)
SELECT c, n, 'Count', o, true FROM (VALUES
 ('capsule', 'capsule', 300), ('softgel', 'softgel (soft capsule)', 301), ('tablet', 'tablet', 302), ('caplet', 'caplet', 303),
 ('chewable', 'chewable tablet', 304), ('gummy', 'gummy', 305), ('lozenge', 'lozenge', 306), ('scoop', 'scoop', 307),
 ('packet', 'packet', 308), ('sachet', 'sachet', 309), ('stick', 'stick pack', 310), ('pouch', 'pouch', 311),
 ('tsp', 'teaspoon', 312), ('tbsp', 'tablespoon', 313), ('dropper', 'dropperful (full dropper)', 314), ('drop', 'drop', 315),
 ('spray', 'spray (pump)', 316), ('piece', 'piece', 317), ('bar', 'bar', 318), ('cup', 'cup', 319), ('can', 'can', 320),
 ('shot', 'shot (liquid single serve)', 321), ('serving', 'serving (as the label states)', 322)) AS x(c, n, o)
WHERE NOT EXISTS (SELECT 1 FROM unit_of_measure u WHERE lower(u.unit_code) = lower(x.c));
UPDATE unit_of_measure SET is_serving_unit = true WHERE unit_code IN ('vial', 'ampoule', 'bottle', 'pack') AND NOT is_serving_unit;

COMMIT;
