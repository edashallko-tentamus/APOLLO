-- Sandbox demo data for migration 023 (media qualification): a growth promotion test at CFL (the five USP <61>/<62>
-- organisms must grow on the new medium), built by the demo Analyst and approved by the demo Lab Supervisor, and a new
-- lot of tryptic soy agar plates waiting to be qualified (open it in Inventory and use Qualify media). The demo media
-- lots received before this keep working as already qualified. Skipped whole if the test is already there.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); micro uuid; m uuid; t uuid; v uuid; s_batch uuid; s_read uuid; s_review uuid; i integer := 0; a text;
BEGIN
    SELECT id INTO micro FROM department WHERE site_id = cfl AND department_code = 'MICRO';
    IF cfl IS NULL OR micro IS NULL OR EXISTS (SELECT 1 FROM test WHERE site_id = cfl AND test_name = 'Media Growth Promotion (USP <61>/<62>)') THEN RETURN; END IF;
    IF (SELECT count(*) FROM analyte WHERE analyte_name IN ('Staphylococcus aureus', 'Pseudomonas aeruginosa', 'Bacillus subtilis', 'Candida albicans', 'Aspergillus brasiliensis')) < 5 THEN RETURN; END IF;

    -- built by the demo analyst
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO method (site_id, method_name, sop_code, description)
    VALUES (cfl, 'Growth promotion of culture media (USP <61>/<62>)', 'SOP-MIC-0061G', 'Each new lot of medium is inoculated with not more than 100 CFU of each organism; growth must be clearly visible within the medium''s incubation time') RETURNING id INTO m;
    t := create_test(cfl, 'Media Growth Promotion (USP <61>/<62>)', micro, m);
    v := (SELECT id FROM test_version WHERE test_id = t);
    UPDATE test_version SET procedure_text = 'Inoculate plates of the new lot with not more than 100 CFU of each organism; incubate as for the test the medium is used in. Record Growth or No growth for each organism. A sterility check (uninoculated plates) is part of the lab''s SOP.',
           change_summary = 'First version' WHERE id = v;
    FOREACH a IN ARRAY ARRAY['Staphylococcus aureus', 'Pseudomonas aeruginosa', 'Bacillus subtilis', 'Candida albicans', 'Aspergillus brasiliensis'] LOOP
        i := i + 1;
        INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values, default_spec_text)
        VALUES (v, (SELECT id FROM analyte WHERE analyte_name = a), i, 'Qualitative', '{Growth,No growth}', '{No growth}', 'Growth');
    END LOOP;
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
     (v, 'batch', 'Batch', 'Batching', 1, '{"max_samples": 10, "qc": []}') RETURNING id INTO s_batch;
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
     (v, 'read', 'Read growth', 'Data Entry', 2, '{"value_label": "Growth or No growth for each organism", "require_attachment": false}') RETURNING id INTO s_read;
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config) VALUES
     (v, 'review', 'QC Review', 'QC Review', 3, '{}') RETURNING id INTO s_review;
    INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES (s_read, s_batch), (s_review, s_read);

    -- approved by the demo Lab Supervisor; five calendar days to report
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM approve_test_version(v);
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    PERFORM script_signature('Sandbox demo data');
    UPDATE test_catalog_entry SET description = 'Growth promotion of a new lot of culture medium (internal: media qualification)', standard_tat = 5, tat_unit = 'Calendar Days'
     WHERE test_id = t;

    -- a new lot of plates, received today: it needs qualifying before use
    PERFORM set_config('lims.media_preapproved', '', true);
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, container_count, expiration_date, storage_condition, notes)
    VALUES (cfl, 'Tryptic soy agar plates', '{Media}', 'HAR-TSA-2610', 40, 'each', 4, current_date + 60, 'Refrigerated (2-8 °C)', 'Ready-to-use, 4 sleeves of 10. New lot: qualify before use.');
END $$;

COMMIT;
