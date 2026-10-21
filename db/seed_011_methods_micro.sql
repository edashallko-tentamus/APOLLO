-- Sandbox demo data for migration 013 (WD-1.1): product categories on the demo matrices, and version 2 of the demo
-- USP <62> and USP <60> tests using the new settings, modelled on Irvine practice (context only, see the vault note
-- "Context - AAL Irvine Micro SOP Review"): results ND / ND* / D* / D (D* and D mean found), daily controls with the
-- positive control made from strains of the test's organisms, and sample weight and enrichment volume per product
-- category (always 1 in 10). Built by the demo Analyst, approved by the demo Lab Supervisor.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

UPDATE matrix m SET product_category_id = pc.id
  FROM (VALUES ('Powder', 'Dietary Supplement'), ('Capsule', 'Dietary Supplement'), ('Tablet', 'Dietary Supplement'), ('Softgel', 'Dietary Supplement'),
               ('Gummy', 'Dietary Supplement'), ('Tincture', 'Dietary Supplement'), ('Bar', 'Food'), ('Snack', 'Food'), ('Liquid', 'Food'),
               ('Raw Material', 'Raw Material'), ('Plant Material', 'Raw Material'), ('Cream or Lotion', 'Cosmetic')) AS x(mat, cat)
  JOIN product_category pc ON pc.category_name = x.cat
 WHERE lower(m.matrix_name) = lower(x.mat) AND m.product_category_id IS NULL;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); t uuid; v uuid; tn text;
        cos text := (SELECT id::text FROM product_category WHERE category_name = 'Cosmetic');
        ds text := (SELECT id::text FROM product_category WHERE category_name = 'Dietary Supplement');
        fd text := (SELECT id::text FROM product_category WHERE category_name = 'Food');
        weights jsonb; amounts jsonb;
BEGIN
    weights := jsonb_build_array(jsonb_build_object('category_id', cos, 'min', 1.00, 'max', 1.10), jsonb_build_object('category_id', ds, 'min', 10.00, 'max', 11.00),
                                 jsonb_build_object('category_id', fd, 'min', 25.00, 'max', 27.50));
    amounts := jsonb_build_array(jsonb_build_object('category_id', cos, 'aliquot', 1, 'diluent', 9), jsonb_build_object('category_id', ds, 'aliquot', 10, 'diluent', 90),
                                 jsonb_build_object('category_id', fd, 'aliquot', 25, 'diluent', 225));
    FOREACH tn IN ARRAY ARRAY['USP <62> Specified Microorganisms', 'USP <60> Burkholderia cepacia Complex'] LOOP
        SELECT id INTO t FROM test WHERE site_id = cfl AND test_name = tn;
        IF t IS NULL OR EXISTS (SELECT 1 FROM test_version WHERE test_id = t AND version_no > 1) THEN CONTINUE; END IF;
        PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
        PERFORM script_signature('Sandbox demo data');
        v := new_test_version(t);
        UPDATE test_version SET change_summary = 'Results ND / ND* / D* / D; daily controls, positive control from strains; weight and enrichment per product category' WHERE id = v;
        UPDATE test_version_analyte SET result_values = '{ND,ND*,D*,D}', found_values = '{D*,D}' WHERE test_version_id = v AND result_type = 'Qualitative';
        UPDATE workflow_step SET config = jsonb_build_object('max_samples', 20, 'qc', '[
            {"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Daily", "material": "Strains", "criteria": [{"limit_type": "Presence"}]},
            {"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Daily", "criteria": [{"limit_type": "Absence"}]}]'::jsonb)
         WHERE test_version_id = v AND step_key = 'batch';
        UPDATE workflow_step SET config = jsonb_build_object('target_mode', 'By product category', 'unit', 'g', 'by_category', weights) WHERE test_version_id = v AND step_key = 'weigh';
        UPDATE workflow_step SET config = config || jsonb_build_object('by_category', amounts) WHERE test_version_id = v AND step_key IN ('tsb', 'sdb');
        PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
        PERFORM script_signature('Sandbox demo data');
        PERFORM approve_test_version(v);
    END LOOP;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
END $$;

COMMIT;
