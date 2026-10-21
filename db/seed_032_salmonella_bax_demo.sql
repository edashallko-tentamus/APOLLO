-- Sandbox demo data: Colleen Villanueva's Salmonella demo (Alex, 2026-10-16: "Can you build it please?"), built as in the
-- project doc "Procedure - Salmonella BAX Q7 Demo Build (Colleen)", at CFL. Fictional client, contacts, lots and results.
--  Set-up: product categories and matrices (food, sponge swab, stick swab, dry pet food); the helper analytes; the
--    equipment (MI05, MI07, MI100, BAX Q7, thermal and cooling blocks, stomacher, balance, biosafety cabinet), calibrated;
--    the media, reagents, BAX kit parts, the lysis reagent and the ATCC 14028 strain; the methods MC-12.06 and MC-12.04;
--    the two tests designed by the demo Analyst and approved by the demo Lab Supervisor (Salmonella confirmation, FDA BAM
--    Ch. 5; Salmonella BAX Q7 screen, with the 0.21.0 settings: weights, enrichment and windows per matrix, "Not a
--    result" values, the reflex with "Alert the client"); priced; the client "Prairie Pet Foods (demo)" (no partial
--    reports) with its Positive alerts contacts; an accepted quote with both tests.
--  DEMO-1015 (finished yesterday, times typed for the demo): four samples through the screen (the sponge's Signal error
--    read again in run 2; the dry dog food presumptive positive, the client alerted, the confirmation ordered by the
--    reflex), and the dog food through the confirmation (the BSA plates re-incubated to 48 h and accepted by QA);
--    both batches approved in QC Review by the demo QA Reviewer: the samples wait in Report Finalization.
--  DEMO-1016 (today): four samples logged, the screen waiting in the Microbiology backlog for the live demo.
-- Runs only where CFL's workflow verification gate is off (Alex's data; test databases keep the gate on and skip it),
-- once, and skips itself whole (a notice) if anything fails, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

CREATE OR REPLACE FUNCTION pg_temp.as_user(u text, why text DEFAULT 'Sandbox demo data') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), true);
    PERFORM set_config('lims.reason', why, true);
    PERFORM script_signature('Sandbox demo data');
END $$;
CREATE OR REPLACE FUNCTION pg_temp.run(b uuid, k text) RETURNS uuid LANGUAGE sql AS $$
    SELECT r.id FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b AND ws.step_key = k $$;
CREATE OR REPLACE FUNCTION pg_temp.lot(n text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM inventory_lot WHERE manufacturer_lot = n AND site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL') ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.eq(n text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM equipment WHERE equipment_name LIKE n || '%' AND site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL') ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE lower(analyte_name) = lower(n) LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.etype(n text) RETURNS uuid LANGUAGE sql AS $$
    SELECT id FROM equipment_type WHERE type_name = n AND site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL') LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.cat(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM product_category WHERE category_name = n LIMIT 1 $$;
-- a step of a Draft version, its equipment types and the step before it
CREATE OR REPLACE FUNCTION pg_temp.step(v uuid, k text, nm text, t text, cfg jsonb, prev text, eqs text[] DEFAULT '{}') RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s uuid; e text; first boolean := true;
BEGIN
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config)
    VALUES (v, k, nm, t::step_type, COALESCE((SELECT max(sort_order) FROM workflow_step WHERE test_version_id = v), 0) + 1, cfg) RETURNING id INTO s;
    FOREACH e IN ARRAY eqs LOOP
        INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (s, pg_temp.etype(e), first); first := false;
    END LOOP;
    IF prev IS NOT NULL THEN
        INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) SELECT s, id FROM workflow_step WHERE test_version_id = v AND step_key = prev AND status = 'Active';
    END IF;
    RETURN s;
END $$;
-- a small PDF to attach as raw data (the BAX Q7 run report)
CREATE OR REPLACE FUNCTION pg_temp.pdf(fname text, line1 text, line2 text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE d uuid; b bytea;
BEGIN
    b := convert_to(E'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 160>>stream\nBT /F1 13 Tf 72 720 Td ('
        || line1 || ') Tj 0 -22 Td (' || line2 || E') Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF', 'UTF8');
    INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (fname, 'application/pdf', length(b), encode(sha256(b), 'hex'), b) RETURNING id INTO d;
    RETURN d;
END $$;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); micro uuid; sal uuid; v_conf uuid; v_bax uuid; t_conf uuid; t_bax uuid;
        m_bax uuid; m_conf uuid; cl uuid; dana uuid; sam uuid; desk uuid; p uuid; pv uuid; line_bax uuid; o1 uuid; o2 uuid; s uuid; ids uuid[];
        b1 uuid; b2 uuid; e record; r record; hlp text[] := ARRAY['XLD colonies', 'HEK colonies', 'BSA colonies', 'TSI reaction (XLD pick)', 'LIA reaction (XLD pick)',
        'TSI reaction (HEK pick)', 'LIA reaction (HEK pick)', 'TSI reaction (BSA pick)', 'LIA reaction (BSA pick)', 'API 20E identification'];
        h text; i int; crit jsonb; food uuid; ent_s uuid; ent_p uuid; pc uuid; nc uuid; k int;
BEGIN
    IF cfl IS NULL OR (SELECT require_workflow_verification FROM lab_site WHERE id = cfl) THEN RETURN; END IF;
    IF EXISTS (SELECT 1 FROM test WHERE site_id = cfl AND test_name = 'Salmonella BAX Q7 real-time PCR screen') OR EXISTS (SELECT 1 FROM client WHERE legal_name = 'Prairie Pet Foods (demo)') THEN RETURN; END IF;
    micro := (SELECT id FROM department WHERE site_id = cfl AND department_code = 'MICRO');
    sal := pg_temp.an('Salmonella');
    IF micro IS NULL OR sal IS NULL THEN RAISE NOTICE 'Salmonella demo skipped: no Microbiology department or Salmonella analyte at CFL'; RETURN; END IF;

    ------------------------------------------------------------------ 1. matrices, analytes, equipment
    INSERT INTO product_category (category_name, description, sort_order)
    SELECT x.n, x.d, x.o FROM (VALUES ('Environmental sponge', 'Environmental sponge swabs (90 mL BPW)', 60), ('Environmental stick swab', 'Environmental stick swabs (10 mL BPW)', 61),
                                      ('Dry pet food', 'Dry pet food, 375 g test portion (MC-12.06 7.4)', 62)) AS x(n, d, o)
     WHERE NOT EXISTS (SELECT 1 FROM product_category c WHERE lower(c.category_name) = lower(x.n));
    food := pg_temp.cat('Food');
    IF food IS NULL THEN INSERT INTO product_category (category_name, sort_order) VALUES ('Food', 30); food := pg_temp.cat('Food'); END IF;
    INSERT INTO matrix (matrix_name, description, product_category_id)
    SELECT x.n, x.d, x.c FROM (VALUES ('Food (ready-to-eat)', 'Food, 25 g test portion', food),
        ('Environmental sponge swab', 'Sponge swab in neutralizing buffer', pg_temp.cat('Environmental sponge')),
        ('Environmental stick swab', 'Stick swab', pg_temp.cat('Environmental stick swab')),
        ('Dry pet food (kibble)', 'Dry pet food', pg_temp.cat('Dry pet food'))) AS x(n, d, c)
     WHERE NOT EXISTS (SELECT 1 FROM matrix m WHERE lower(m.matrix_name) = lower(x.n));
    UPDATE matrix SET product_category_id = food WHERE matrix_name = 'Food (ready-to-eat)' AND product_category_id IS NULL;

    INSERT INTO analyte (analyte_name, report_name, analyte_class)
    SELECT x, x, 'Microbiological' FROM unnest(hlp) x WHERE NOT EXISTS (SELECT 1 FROM analyte a WHERE lower(a.analyte_name) = lower(x));

    INSERT INTO equipment_type (site_id, type_name, description)
    SELECT cfl, x.n, x.d FROM (VALUES ('BAX System Q7', 'Hygiena BAX System Q7 real-time PCR cycler/detector'), ('Thermal block', 'Heating block for lysis (37 °C / 95 °C)'),
        ('Cooling block', 'PCR cooling block, 2 to 8 °C'), ('Water bath', 'Circulating water bath'), ('Homogenizer', 'Stomacher or blender'),
        ('Incubator', NULL), ('Top-loading balance', 'Balance, 0.01 g'), ('Biosafety cabinet', 'Class II biological safety cabinet')) AS x(n, d)
    ON CONFLICT DO NOTHING;
    INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, calibration_required,
                           calibration_interval_months, calibration_alert_days, qualification_required, in_service_date)
    SELECT cfl, x.n, pg_temp.etype(x.t), micro, x.mf, x.md, x.sn, x.cal, 12, 30, false, current_date - 300
      FROM (VALUES ('MI05 Incubator 35 °C (enrichments, plates, slants)', 'Incubator', 'Thermo Scientific', 'Heratherm IGS180', 'MI05-41877', true),
                   ('MI07 Incubator 37 °C (BHI regrowth)', 'Incubator', 'Thermo Scientific', 'Heratherm IGS60', 'MI07-41902', true),
                   ('MI100 Water bath 42 °C (RV)', 'Water bath', 'Thermo Scientific', 'Precision GP 10', 'MI100-3381', true),
                   ('Q7-01 BAX System Q7', 'BAX System Q7', 'Hygiena', 'BAX System Q7', 'Q7-260117', true),
                   ('ATB-01 Automated thermal block', 'Thermal block', 'Hygiena', 'Automated Thermal Block', 'ATB-1093', true),
                   ('CB-01 PCR cooling block', 'Cooling block', 'Hygiena', 'Cooling block', 'CB-2210', false),
                   ('STOM-01 Stomacher', 'Homogenizer', 'Seward', 'Stomacher 400 Circulator', 'ST400-7781', false),
                   ('BAL-M2 Top-loading balance (6 kg)', 'Top-loading balance', 'Ohaus', 'Scout STX6201', 'B-M2-60022', true),
                   ('BSC-M1 Biosafety cabinet', 'Biosafety cabinet', 'Labconco', 'Logic+ A2', 'BSC-M1-1180', true)) AS x(n, t, mf, md, sn, cal)
     WHERE NOT EXISTS (SELECT 1 FROM equipment q WHERE q.serial_number = x.sn);
    INSERT INTO equipment_owner (equipment_id, group_id)
    SELECT q.id, g.id FROM equipment q, lab_group g WHERE q.serial_number IN ('MI05-41877', 'MI07-41902', 'MI100-3381', 'Q7-260117', 'ATB-1093', 'CB-2210', 'ST400-7781', 'B-M2-60022', 'BSC-M1-1180')
       AND g.site_id = cfl AND g.group_name = 'Microbiology' ON CONFLICT DO NOTHING;
    INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, performed_by_vendor, certificate_number)
    SELECT q.id, current_date - 90, current_date + 274, 'Pass', 'Precision Calibration Services', 'CERT-' || q.serial_number
      FROM equipment q WHERE q.serial_number IN ('MI05-41877', 'MI07-41902', 'MI100-3381', 'Q7-260117', 'ATB-1093', 'B-M2-60022', 'BSC-M1-1180')
       AND NOT EXISTS (SELECT 1 FROM calibration c WHERE c.equipment_id = q.id);

    ------------------------------------------------------------------ 2. lots (fictional lot numbers)
    INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes, department_id)
    SELECT cfl, x.n, x.t::chemical_type[], x.l, x.q, x.u, current_date + x.d, 'Salmonella BAX demo', micro
      FROM (VALUES ('Buffered peptone water (BPW)', '{Media}', 'BPW-2610A', 20, 'L', 120), ('Brain heart infusion broth (BHI)', '{Media}', 'BHI-2610A', 500, 'mL', 90),
                   ('Rappaport-Vassiliadis (RV) medium, 10 mL tubes', '{Media}', 'RV-2610A', 50, 'each', 60), ('Hektoen enteric (HEK) agar plates', '{Media}', 'HEK-2610A', 50, 'each', 45),
                   ('XLD agar plates', '{Media}', 'XLD-2610A', 50, 'each', 45), ('Bismuth sulfite agar (BSA) plates', '{Media}', 'BSA-2610A', 50, 'each', 30),
                   ('Triple sugar iron (TSI) agar slants', '{Media}', 'TSI-2610A', 100, 'each', 90), ('Lysine iron agar (LIA) slants', '{Media}', 'LIA-2610A', 100, 'each', 90),
                   ('MacConkey agar plates', '{Media}', 'MAC-2610A', 50, 'each', 45), ('0.85% NaCl, 5 mL tubes', '{Reagent}', 'NACL-2610A', 50, 'each', 180),
                   ('API 20E strips', '{Reagent}', 'API-2610A', 25, 'each', 200), ('TDA reagent', '{Reagent}', 'TDA-2610A', 1, 'each', 300),
                   ('James reagent', '{Reagent}', 'JAM-2610A', 1, 'each', 300), ('VP 1 reagent', '{Reagent}', 'VP1-2610A', 1, 'each', 300), ('VP 2 reagent', '{Reagent}', 'VP2-2610A', 1, 'each', 300),
                   ('BAX Salmonella RT PCR tablets (KIT2006)', '{Reagent}', 'KIT2006-6612', 96, 'each', 240), ('BAX lysis buffer (KIT2006)', '{Reagent}', 'KIT2006-6612-LB', 12, 'mL', 240),
                   ('BAX protease (KIT2006)', '{Reagent}', 'KIT2006-6612-PR', 150, 'µL', 240),
                   ('BAX lysis reagent (150 µL protease in 12 mL lysis buffer)', '{Reagent}', 'LR-261015', 12, 'mL', 13),
                   ('Salmonella enterica ser. Typhimurium ATCC 14028', '{"Microbiological Strain"}', 'ST14028-0926', 10, 'each', 365)) AS x(n, t, l, q, u, d)
     WHERE NOT EXISTS (SELECT 1 FROM inventory_lot z WHERE z.manufacturer_lot = x.l AND z.site_id = cfl);
    INSERT INTO lot_analyte (lot_id, analyte_id) SELECT pg_temp.lot('ST14028-0926'), sal
     WHERE NOT EXISTS (SELECT 1 FROM lot_analyte la WHERE la.lot_id = pg_temp.lot('ST14028-0926'));

    ------------------------------------------------------------------ 3. the methods and the two tests (the demo Analyst designs, the demo Lab Supervisor approves)
    PERFORM pg_temp.as_user('analyst', 'Draft being developed (before approval)');
    INSERT INTO method (site_id, method_name, sop_code, description) VALUES
     (cfl, 'Hygiena Real-Time Salmonella Assay (BAX Q7)', 'MC-12.06 rev 1', 'AOAC RI 081201. Enrichment by matrix, BHI regrowth, lysis, BAX Q7 real-time PCR.') RETURNING id INTO m_bax;
    INSERT INTO method (site_id, method_name, sop_code, description) VALUES
     (cfl, 'Salmonella Confirmation (FDA BAM Ch. 5)', 'MC-12.04 rev 1', 'RV, HEK/XLD/BSA, TSI/LIA, API 20E. Form MCF-034 retired in LIMS3.') RETURNING id INTO m_conf;

    -- the confirmation (built first: the screen's reflex names it)
    t_conf := create_test(cfl, 'Salmonella confirmation (FDA BAM Ch. 5)', micro, m_conf);
    v_conf := (SELECT id FROM test_version WHERE test_id = t_conf);
    UPDATE test_version SET procedure_text = 'MC-12.04 section 7: 0.1 mL enrichment into 10 mL RV, 42 °C 24 h; streak HEK, XLD and BSA, 35 °C 24 h (BSA to 48 h when no typical colonies); pick 2 or more colonies per agar to TSI and LIA (and MacConkey for purity), 35 °C 24 h; API 20E on a pure culture. Salmonella identified by API 20E is reported Positive.',
           change_summary = 'First version (replaces form MCF-034)' WHERE id = v_conf;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values) VALUES (v_conf, sal, 1, 'Qualitative', '{Negative,Positive}', '{Positive}');
    i := 1;
    FOREACH h IN ARRAY hlp LOOP i := i + 1;
        INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, hide_on_report) VALUES (v_conf, pg_temp.an(h), i, 'Text', true);
    END LOOP;
    crit := jsonb_build_array(jsonb_build_object('limit_type', 'Presence', 'analytes',
              (SELECT jsonb_agg(jsonb_build_object('analyte_id', tva.analyte_id, 'applies', tva.analyte_id = sal)) FROM test_version_analyte tva WHERE tva.test_version_id = v_conf)));
    PERFORM pg_temp.step(v_conf, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 20, 'qc', jsonb_build_array(jsonb_build_object('qc_type', 'Positive Control', 'qc_class', 'Prep',
        'frequency', 'Once', 'count', 1, 'material', 'Strains', 'criteria', crit))), NULL);
    PERFORM pg_temp.step(v_conf, 'rv', 'Transfer to RV broth', 'Plating/Inoculation', '{"expected_media": "RV medium (0.1 mL enrichment into 10 mL)", "plates_per_entry": 1, "procedure_ref": "MC-12.04 7.1.1"}', 'batch');
    PERFORM pg_temp.step(v_conf, 'inc_rv', 'Incubate RV (water bath)', 'Incubation', '{"temp_c": 42, "temp_tolerance": 0.2, "duration": 24, "duration_unit": "hours", "window_min": 22, "window_max": 26}', 'rv', '{Water bath}');
    PERFORM pg_temp.step(v_conf, 'streak', 'Streak HEK, XLD and BSA', 'Plating/Inoculation', '{"expected_media": "HEK, XLD and BSA agar", "plates_per_entry": 3, "procedure_ref": "MC-12.04 7.1.3"}', 'inc_rv');
    PERFORM pg_temp.step(v_conf, 'inc_plates', 'Incubate selective agars', 'Incubation', '{"temp_c": 35, "temp_tolerance": 2, "duration": 24, "duration_unit": "hours", "window_min": 22, "window_max": 26}', 'streak', '{Incubator}');
    PERFORM pg_temp.step(v_conf, 'read_plates', 'Read selective agars', 'Data Entry', jsonb_build_object('value_label', 'Typical, Atypical or None', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('XLD colonies'), pg_temp.an('HEK colonies'), pg_temp.an('BSA colonies'))), 'inc_plates');
    PERFORM pg_temp.step(v_conf, 'pick', 'Pick to TSI, LIA and MacConkey', 'Plating/Inoculation', '{"expected_media": "TSI and LIA slants, MacConkey (purity)", "plates_per_entry": 13, "procedure_ref": "MC-12.04 7.3.1"}', 'read_plates');
    PERFORM pg_temp.step(v_conf, 'inc_tsi', 'Incubate TSI, LIA and MacConkey', 'Incubation', '{"temp_c": 35, "temp_tolerance": 2, "duration": 24, "duration_unit": "hours", "window_min": 22, "window_max": 26}', 'pick', '{Incubator}');
    PERFORM pg_temp.step(v_conf, 'read_tsi', 'Read TSI and LIA', 'Data Entry', jsonb_build_object('value_label', 'Slant/butt and H2S/gas, e.g. K/A +/+', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('TSI reaction (XLD pick)'), pg_temp.an('LIA reaction (XLD pick)'), pg_temp.an('TSI reaction (HEK pick)'), pg_temp.an('LIA reaction (HEK pick)'),
                                         pg_temp.an('TSI reaction (BSA pick)'), pg_temp.an('LIA reaction (BSA pick)'))), 'inc_tsi');
    PERFORM pg_temp.step(v_conf, 'api', 'Inoculate API 20E', 'Preparation', '{"procedure_ref": "MC-12.04 7.3.3.1: isolated colony from MacConkey, 0.85% NaCl suspension, API 20E per the manufacturer"}', 'read_tsi', '{Biosafety cabinet}');
    PERFORM pg_temp.step(v_conf, 'inc_api', 'Incubate API 20E', 'Incubation', '{"temp_c": 36, "temp_tolerance": 2, "duration": 21, "duration_unit": "hours", "window_min": 18, "window_max": 24}', 'api', '{Incubator}');
    PERFORM pg_temp.step(v_conf, 'read_api', 'Read API 20E and confirm', 'Data Entry', jsonb_build_object('value_label', 'API profile and ID; Salmonella Positive or Negative', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('API 20E identification'), sal)), 'inc_api');
    PERFORM pg_temp.step(v_conf, 'review', 'QC Review', 'QC Review', '{}', 'read_api');

    -- the screen
    t_bax := create_test(cfl, 'Salmonella BAX Q7 real-time PCR screen', micro, m_bax);
    v_bax := (SELECT id FROM test_version WHERE test_id = t_bax);
    UPDATE test_version SET procedure_text = 'MC-12.06: test portion by matrix (food 25 g + 225 mL BPW; dry pet food 375 g + 3375 mL BPW; sponge 90 mL; stick swab 10 mL BPW); 35 °C 20 to 24 h (dry pet food 22 to 26 h); 10 µL into 500 µL BHI, 37 °C 3 h; lysis 37 °C 20 min, 95 °C 10 min, 2 to 8 °C 5 min; hydrate PCR tablets; BAX Q7. Indeterminate or Signal error: re-run from 8.3, then from 8.2. Presumptive positives are notified to the customer at once and confirmed per MC-12.04.',
           change_summary = 'First version' WHERE id = v_bax;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, result_values, found_values, invalid_values)
    VALUES (v_bax, sal, 1, 'Qualitative', '{Negative,"Presumptive positive",Indeterminate,"Signal error"}', '{"Presumptive positive"}', '{Indeterminate,"Signal error"}');
    PERFORM pg_temp.step(v_bax, 'batch', 'Batch (one rack per shift)', 'Batching', '{"max_samples": 94, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "material": "Strains", "criteria": [{"limit_type": "Presence"}]},
        {"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Absence"}]}]}', NULL);
    PERFORM pg_temp.step(v_bax, 'weigh', 'Weigh test portion', 'Weighing', jsonb_build_object('target_mode', 'By product category', 'unit', 'g', 'qc_not_weighed', true, 'by_category', jsonb_build_array(
        jsonb_build_object('category_id', food, 'min', 24.5, 'max', 25.5), jsonb_build_object('category_id', pg_temp.cat('Dry pet food'), 'min', 367.5, 'max', 382.5),
        jsonb_build_object('category_id', pg_temp.cat('Environmental sponge'), 'not_weighed', true), jsonb_build_object('category_id', pg_temp.cat('Environmental stick swab'), 'not_weighed', true))), 'batch', '{Top-loading balance}');
    PERFORM pg_temp.step(v_bax, 'enrich', 'Add BPW (1 in 10)', 'Dilution', jsonb_build_object('mode', 'Single', 'aliquot', 25, 'diluent', 225, 'fields_per_entry', 1, 'expected_diluent', 'Buffered peptone water (BPW)',
        'by_category', jsonb_build_array(jsonb_build_object('category_id', food, 'aliquot', 25, 'diluent', 225), jsonb_build_object('category_id', pg_temp.cat('Dry pet food'), 'aliquot', 375, 'diluent', 3375),
                                         jsonb_build_object('category_id', pg_temp.cat('Environmental sponge'), 'aliquot', 1, 'diluent', 90), jsonb_build_object('category_id', pg_temp.cat('Environmental stick swab'), 'aliquot', 1, 'diluent', 10))), 'weigh', '{Homogenizer}');
    PERFORM pg_temp.step(v_bax, 'inc_enrich', 'Incubate enrichment', 'Incubation', jsonb_build_object('temp_c', 35, 'temp_tolerance', 1, 'duration', 22, 'duration_unit', 'hours', 'window_min', 20, 'window_max', 24,
        'by_category', jsonb_build_array(jsonb_build_object('category_id', pg_temp.cat('Dry pet food'), 'window_min', 22, 'window_max', 26))), 'enrich', '{Incubator}');
    PERFORM pg_temp.step(v_bax, 'bhi', 'Regrow in BHI', 'Preparation', '{"procedure_ref": "MC-12.06 8.1.5: 10 µL enrichment into 500 µL pre-warmed BHI"}', 'inc_enrich', '{Biosafety cabinet}');
    PERFORM pg_temp.step(v_bax, 'inc_bhi', 'Incubate BHI', 'Incubation', '{"temp_c": 37, "temp_tolerance": 2, "duration": 3, "duration_unit": "hours", "window_min": 3, "window_max": 3.5}', 'bhi', '{Incubator}');
    PERFORM pg_temp.step(v_bax, 'lysis', 'Lysis', 'Preparation', '{"procedure_ref": "MC-12.06 8.2: 200 µL lysis reagent + 5 µL BHI culture; 37 °C 20 min, 95 °C 10 min, 2 to 8 °C at least 5 min (ATB Gram-negative program)"}', 'inc_bhi', '{Thermal block,Cooling block}');
    PERFORM pg_temp.step(v_bax, 'hydrate', 'Hydrate PCR tablets', 'Preparation', '{"procedure_ref": "MC-12.06 8.3: 30 µL lysate per PCR tube; load after 10 to 30 min in the cooling block", "fields": [{"label": "Time into cooling block", "type": "Time"}, {"label": "Time loaded into Q7", "type": "Time"}]}', 'lysis', '{Cooling block}');
    PERFORM pg_temp.step(v_bax, 'bax', 'BAX Q7 run', 'Data Entry', '{"value_label": "BAX result", "require_attachment": true}', 'hydrate', '{BAX System Q7}');
    PERFORM pg_temp.step(v_bax, 'split', 'Reflex to confirmation', 'Split off Test', jsonb_build_object('test_id', t_conf, 'trigger', 'On finding', 'finding', 'Present', 'finding_steps', '["bax"]'::jsonb,
        'consent_required', false, 'notify_client', true), 'bax');
    PERFORM pg_temp.step(v_bax, 'review', 'QC Review', 'QC Review', '{}', 'split');

    IF EXISTS (SELECT 1 FROM test_version_problems(v_conf) WHERE severity = 'Error') OR EXISTS (SELECT 1 FROM test_version_problems(v_bax) WHERE severity = 'Error') THEN
        RAISE EXCEPTION 'design errors: %', (SELECT string_agg(x.step_key || ': ' || x.problem, '; ') FROM (SELECT * FROM test_version_problems(v_conf) UNION ALL SELECT * FROM test_version_problems(v_bax)) x WHERE x.severity = 'Error');
    END IF;
    PERFORM pg_temp.as_user('labsup', 'Approved for the Salmonella demo');
    PERFORM approve_test_version(v_conf);
    PERFORM approve_test_version(v_bax);

    ------------------------------------------------------------------ 4. price, client, quote
    PERFORM pg_temp.as_user('akiddle', 'Sandbox demo data');
    UPDATE test_catalog_entry SET base_price = 45, standard_tat = 2, tat_unit = 'Business Days', description = 'Salmonella screen by Hygiena BAX Q7 real-time PCR (AOAC RI 081201), with reflex to culture confirmation' WHERE test_id = t_bax;
    UPDATE test_catalog_entry SET base_price = 95, standard_tat = 5, tat_unit = 'Business Days', description = 'Cultural confirmation of a presumptive Salmonella (FDA BAM Ch. 5): RV, HEK/XLD/BSA, TSI/LIA, API 20E' WHERE test_id = t_conf;
    INSERT INTO client (legal_name, display_name, account_status, is_gmp_client, billing_address, default_report_delivery)
    VALUES ('Prairie Pet Foods (demo)', 'Prairie Pet Foods', 'Active', false, '1200 Mill Rd, Grand Prairie TX', 'Email') RETURNING id INTO cl;
    UPDATE client SET allow_partial_reports = false WHERE id = cl;
    INSERT INTO contact (first_name, last_name, email, phone, job_title, portal_access) VALUES ('Dana', 'Ortiz', 'dana.ortiz@example-prairiepet.com', '555-0141', 'QA Manager', true) RETURNING id INTO dana;
    INSERT INTO contact (first_name, last_name, email, phone, job_title, portal_access) VALUES ('Sam', 'Whitfield', 'sam.whitfield@example-prairiepet.com', '555-0142', 'Plant Manager', false) RETURNING id INTO sam;
    INSERT INTO contact (first_name, last_name, email, phone, job_title, portal_access) VALUES ('Orders', 'Desk', 'orders@example-prairiepet.com', '555-0140', 'Purchasing', false) RETURNING id INTO desk;
    INSERT INTO client_contact (client_id, contact_id, roles) VALUES (cl, dana, '{PRIMARY,REPORT,QUALITY,ALERT}'), (cl, sam, '{QUALITY,ALERT}'), (cl, desk, '{ORDERING,BILLING}');
    PERFORM set_config('lims.site_id', cfl::text, true);
    INSERT INTO project (client_id, project_name, kind, owner_id, quote_contact_id)
    VALUES (cl, 'Salmonella screening with reflex confirmation (food, environmental, pet food)', 'Quote', (SELECT id FROM app_user WHERE username = 'akiddle'), dana) RETURNING id INTO p;
    pv := new_project_version(p);
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (pv, t_bax, 200), (pv, t_conf, 20);
    UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = pv;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 90 WHERE id = pv;
    UPDATE project_version SET quoted_by = (SELECT id FROM app_user WHERE username = 'akiddle') WHERE id = pv;
    UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = dana, client_response_note = 'Standing order for the 2026 environmental program' WHERE id = pv;
    line_bax := (SELECT id FROM quoted_test_configuration WHERE project_version_id = pv AND test_id = t_bax);

    ------------------------------------------------------------------ 5. DEMO-1015: yesterday's samples, run through
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status, notes)
    VALUES (cl, cfl, desk, 'Online', 'DEMO-1015', 'Submitted', 'Weekly environmental and finished product program') RETURNING id INTO o1;
    ids := '{}';
    FOR r IN SELECT * FROM (VALUES ('Granola bar 2610-A', 'Granola bar, lot 2610-A', 'Food (ready-to-eat)', 1, 'Food'), ('Sponge, Line 3 drain', 'Environmental sponge, Line 3 floor drain', 'Environmental sponge swab', 2, 'Animal food and pet food'),
                                   ('Stick swab, filler nozzle', 'Environmental stick swab, filler nozzle', 'Environmental stick swab', 3, 'Animal food and pet food'), ('Dry dog food 26-288', 'Dry dog food, lot 26-288', 'Dry pet food (kibble)', 4, 'Animal food and pet food')) AS x(cid, d, m, o, cc) ORDER BY o LOOP
        INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, condition, receipt_temperature, compliance_category) VALUES (o1, r.cid, r.d, r.m, 'Acceptable', 4.0, r.cc) RETURNING id INTO s;
        PERFORM order_test(s, line_bax); ids := ids || s;
    END LOOP;
    PERFORM log_samples(ids);

    -- the screen batch, by the demo Analyst
    PERFORM pg_temp.as_user('analyst', 'Bench work');
    b1 := create_batch(cfl, v_bax);
    SELECT e2.id INTO ent_s FROM batch_entry e2 JOIN requested_test rt ON rt.id = e2.requested_test_id JOIN sample sm ON sm.id = rt.sample_id WHERE e2.batch_id = b1 AND sm.client_sample_id = 'Sponge, Line 3 drain';
    SELECT e2.id INTO ent_p FROM batch_entry e2 JOIN requested_test rt ON rt.id = e2.requested_test_id JOIN sample sm ON sm.id = rt.sample_id WHERE e2.batch_id = b1 AND sm.client_sample_id = 'Dry dog food 26-288';
    pc := (SELECT id FROM batch_entry WHERE batch_id = b1 AND qc_type = 'Positive Control' AND status = 'Active');
    nc := (SELECT id FROM batch_entry WHERE batch_id = b1 AND qc_type = 'Negative Control' AND status = 'Active');
    PERFORM complete_step(pg_temp.run(b1, 'batch'));
    INSERT INTO entry_value (step_run_id, entry_id, value_num)
    SELECT pg_temp.run(b1, 'weigh'), e2.id, CASE sm.client_sample_id WHEN 'Granola bar 2610-A' THEN 25.12 ELSE 375.40 END
      FROM batch_entry e2 JOIN requested_test rt ON rt.id = e2.requested_test_id JOIN sample sm ON sm.id = rt.sample_id WHERE e2.batch_id = b1 AND sm.client_sample_id IN ('Granola bar 2610-A', 'Dry dog food 26-288');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b1, 'weigh'), pg_temp.eq('BAL-M2'));
    PERFORM complete_step(pg_temp.run(b1, 'weigh'));
    INSERT INTO entry_value (step_run_id, entry_id, data)
    SELECT pg_temp.run(b1, 'enrich'), e2.id, jsonb_build_object('fields', jsonb_build_array(CASE
             WHEN sm.client_sample_id LIKE 'Dry dog%' THEN '{"aliquot": 375, "diluent": 3375}'::jsonb WHEN sm.client_sample_id LIKE 'Sponge%' THEN '{"aliquot": 1, "diluent": 90}'::jsonb
             WHEN sm.client_sample_id LIKE 'Stick%' THEN '{"aliquot": 1, "diluent": 10}'::jsonb ELSE '{"aliquot": 25, "diluent": 225}'::jsonb END))
      FROM batch_entry e2 LEFT JOIN requested_test rt ON rt.id = e2.requested_test_id LEFT JOIN sample sm ON sm.id = rt.sample_id WHERE e2.batch_id = b1 AND e2.status = 'Active';
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b1, 'enrich'), NULL, pg_temp.lot('BPW-2610A'), 'Diluent', 4.1, 'L'),
     (pg_temp.run(b1, 'enrich'), pc, pg_temp.lot('ST14028-0926'), 'Strain', 1, 'each');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b1, 'enrich'), pg_temp.eq('STOM-01'));
    PERFORM complete_step(pg_temp.run(b1, 'enrich'));
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature) VALUES
     (pg_temp.run(b1, 'inc_enrich'), pg_temp.eq('MI05'), (SELECT array_agg(id) FROM batch_entry WHERE batch_id = b1 AND status = 'Active' AND id <> ent_p),
      date_trunc('minute', now()) - interval '29 hours', date_trunc('minute', now()) - interval '7 hours', 35.2),
     (pg_temp.run(b1, 'inc_enrich'), pg_temp.eq('MI05'), ARRAY[ent_p], date_trunc('minute', now()) - interval '31 hours', date_trunc('minute', now()) - interval '6 hours 50 minutes', 35.2);
    PERFORM complete_step(pg_temp.run(b1, 'inc_enrich'));
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.run(b1, 'bhi'), NULL, pg_temp.lot('BHI-2610A'), 'Media', 3, 'mL');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b1, 'bhi'), pg_temp.eq('BSC-M1'));
    PERFORM complete_step(pg_temp.run(b1, 'bhi'));
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature) VALUES
     (pg_temp.run(b1, 'inc_bhi'), pg_temp.eq('MI07'), NULL, date_trunc('minute', now()) - interval '6 hours 40 minutes', date_trunc('minute', now()) - interval '3 hours 35 minutes', 37.1);
    PERFORM complete_step(pg_temp.run(b1, 'inc_bhi'));
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.run(b1, 'lysis'), NULL, pg_temp.lot('LR-261015'), 'Reagent', 1.2, 'mL');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b1, 'lysis'), pg_temp.eq('ATB-01')), (pg_temp.run(b1, 'lysis'), pg_temp.eq('CB-01'));
    PERFORM complete_step(pg_temp.run(b1, 'lysis'));
    UPDATE step_run SET fields = '{"time_into_cooling_block": "07:05", "time_loaded_into_q7": "07:22"}' WHERE id = pg_temp.run(b1, 'hydrate');
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (pg_temp.run(b1, 'hydrate'), NULL, pg_temp.lot('KIT2006-6612'), 'Reagent', 6, 'each');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b1, 'hydrate'), pg_temp.eq('CB-01'));
    PERFORM complete_step(pg_temp.run(b1, 'hydrate'));
    -- the BAX run: the sponge's Signal error, the dog food's presumptive positive
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
    SELECT pg_temp.run(b1, 'bax'), e2.id, sal, CASE WHEN e2.id = ent_s THEN 'Signal error' WHEN e2.id IN (ent_p, pc) THEN 'Presumptive positive' ELSE 'Negative' END
      FROM batch_entry e2 WHERE e2.batch_id = b1 AND e2.status = 'Active';
    INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no)
    VALUES (pg_temp.run(b1, 'bax'), pg_temp.pdf('BAX Q7 run report, rack 1.pdf', 'BAX System Q7 run report - Salmonella RT, rack 1', 'Q7-01, operator: Analyst (demo)'), 'Q7 run report (run 1)', 1);
    INSERT INTO entry_equipment (step_run_id, equipment_id, analytical_run_no) VALUES (pg_temp.run(b1, 'bax'), pg_temp.eq('Q7-01'), 1);
    PERFORM complete_step(pg_temp.run(b1, 'bax'));
    PERFORM set_config('lims.reason', 'Signal error on the BAX Q7: re-run from 8.3 per MC-12.06 8.5.2', true);
    PERFORM add_analytical_run(pg_temp.run(b1, 'bax'), ARRAY[ent_s], 1);
    PERFORM set_config('lims.reason', 'Bench work', true);
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_text) VALUES (pg_temp.run(b1, 'bax'), ent_s, sal, 2, 'Negative');
    INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no)
    VALUES (pg_temp.run(b1, 'bax'), pg_temp.pdf('BAX Q7 run report, re-run.pdf', 'BAX System Q7 run report - Salmonella RT, re-run', 'Sponge, Line 3 drain: Negative'), 'Q7 run report (run 2)', 2);
    INSERT INTO entry_equipment (step_run_id, equipment_id, analytical_run_no) VALUES (pg_temp.run(b1, 'bax'), pg_temp.eq('Q7-01'), 2);
    PERFORM complete_step(pg_temp.run(b1, 'bax'));
    PERFORM complete_step(pg_temp.run(b1, 'split'));   -- the reflex orders the confirmation and alerts Dana and Sam

    -- QC Review by the demo QA Reviewer
    PERFORM pg_temp.as_user('qa.reviewer', 'Step approved in QC Review');
    FOR r IN SELECT * FROM review_step_runs(b1) WHERE mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
    PERFORM set_config('lims.reason', 'Batch reviewed and approved', true);
    PERFORM approve_batch(b1);

    -- the confirmation batch (the dog food and its positive control)
    PERFORM pg_temp.as_user('analyst', 'Bench work');
    b2 := create_batch(cfl, v_conf);
    ent_p := (SELECT id FROM batch_entry WHERE batch_id = b2 AND entry_type = 'Sample' AND status = 'Active');
    pc := (SELECT id FROM batch_entry WHERE batch_id = b2 AND qc_type = 'Positive Control' AND status = 'Active');
    PERFORM complete_step(pg_temp.run(b2, 'batch'));
    INSERT INTO entry_value (step_run_id, entry_id, value_num) SELECT pg_temp.run(b2, 'rv'), id, 1 FROM batch_entry WHERE batch_id = b2 AND status = 'Active';
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b2, 'rv'), NULL, pg_temp.lot('RV-2610A'), 'Media', 2, 'each'), (pg_temp.run(b2, 'rv'), pc, pg_temp.lot('ST14028-0926'), 'Strain', 1, 'each');
    PERFORM complete_step(pg_temp.run(b2, 'rv'));
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
    VALUES (pg_temp.run(b2, 'inc_rv'), pg_temp.eq('MI100'), NULL, date_trunc('minute', now()) - interval '3 hours 20 minutes' - interval '96 hours', date_trunc('minute', now()) - interval '3 hours 20 minutes' - interval '72 hours', 42.1);
    PERFORM complete_step(pg_temp.run(b2, 'inc_rv'));
    INSERT INTO entry_value (step_run_id, entry_id, value_num) SELECT pg_temp.run(b2, 'streak'), id, 3 FROM batch_entry WHERE batch_id = b2 AND status = 'Active';
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b2, 'streak'), NULL, pg_temp.lot('HEK-2610A'), 'Media', 2, 'each'), (pg_temp.run(b2, 'streak'), NULL, pg_temp.lot('XLD-2610A'), 'Media', 2, 'each'),
     (pg_temp.run(b2, 'streak'), NULL, pg_temp.lot('BSA-2610A'), 'Media', 2, 'each');
    PERFORM complete_step(pg_temp.run(b2, 'streak'));
    -- HEK and XLD read at 24 h; BSA re-incubated to 48 h (no typical colonies at 24 h, MC-12.04 7.2.2): a load outside the window, explained
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature, note) VALUES
     (pg_temp.run(b2, 'inc_plates'), pg_temp.eq('MI05'), NULL, date_trunc('minute', now()) - interval '72 hours', date_trunc('minute', now()) - interval '48 hours', 35.0, NULL),
     (pg_temp.run(b2, 'inc_plates'), pg_temp.eq('MI05'), ARRAY[ent_p], date_trunc('minute', now()) - interval '72 hours', date_trunc('minute', now()) - interval '24 hours 10 minutes', 35.0,
      'BSA plate only: no typical colonies at 24 h; re-incubated to 48 h per MC-12.04 7.2.2');
    PERFORM complete_step(pg_temp.run(b2, 'inc_plates'));
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
    SELECT pg_temp.run(b2, 'read_plates'), e2.id, pg_temp.an(x.a), x.v FROM batch_entry e2,
           (VALUES ('XLD colonies', 'Typical'), ('HEK colonies', 'Typical'), ('BSA colonies', 'Atypical (48 h)')) AS x(a, v) WHERE e2.batch_id = b2 AND e2.status = 'Active';
    PERFORM complete_step(pg_temp.run(b2, 'read_plates'));
    INSERT INTO entry_value (step_run_id, entry_id, value_num) SELECT pg_temp.run(b2, 'pick'), id, 13 FROM batch_entry WHERE batch_id = b2 AND status = 'Active';
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b2, 'pick'), NULL, pg_temp.lot('TSI-2610A'), 'Media', 12, 'each'), (pg_temp.run(b2, 'pick'), NULL, pg_temp.lot('LIA-2610A'), 'Media', 12, 'each'),
     (pg_temp.run(b2, 'pick'), NULL, pg_temp.lot('MAC-2610A'), 'Media', 2, 'each');
    PERFORM complete_step(pg_temp.run(b2, 'pick'));
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
    VALUES (pg_temp.run(b2, 'inc_tsi'), pg_temp.eq('MI05'), NULL, date_trunc('minute', now()) - interval '23 hours 50 minutes', date_trunc('minute', now()) - interval '23 hours 50 minutes' + interval '23 hours', 35.1);
    -- (time out 50 minutes ago)
    PERFORM complete_step(pg_temp.run(b2, 'inc_tsi'));
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
    SELECT pg_temp.run(b2, 'read_tsi'), e2.id, pg_temp.an(x.a), x.v FROM batch_entry e2,
           (VALUES ('TSI reaction (XLD pick)', 'K/A +/+'), ('LIA reaction (XLD pick)', 'K/K +/-'), ('TSI reaction (HEK pick)', 'K/A +/+'), ('LIA reaction (HEK pick)', 'K/K +/-'),
                   ('TSI reaction (BSA pick)', 'K/A +/-'), ('LIA reaction (BSA pick)', 'K/K +/-')) AS x(a, v) WHERE e2.batch_id = b2 AND e2.status = 'Active';
    PERFORM complete_step(pg_temp.run(b2, 'read_tsi'));
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b2, 'api'), NULL, pg_temp.lot('API-2610A'), 'Reagent', 2, 'each'), (pg_temp.run(b2, 'api'), NULL, pg_temp.lot('NACL-2610A'), 'Reagent', 2, 'each');
    INSERT INTO entry_equipment (step_run_id, equipment_id) VALUES (pg_temp.run(b2, 'api'), pg_temp.eq('BSC-M1'));
    PERFORM complete_step(pg_temp.run(b2, 'api'));
    INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
    VALUES (pg_temp.run(b2, 'inc_api'), pg_temp.eq('MI05'), NULL, date_trunc('minute', now()) - interval '21 hours 30 minutes', date_trunc('minute', now()) - interval '30 minutes', 35.4);
    PERFORM complete_step(pg_temp.run(b2, 'inc_api'));
    INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES
     (pg_temp.run(b2, 'read_api'), NULL, pg_temp.lot('TDA-2610A'), 'Reagent', 0.02, 'each'), (pg_temp.run(b2, 'read_api'), NULL, pg_temp.lot('JAM-2610A'), 'Reagent', 0.02, 'each'),
     (pg_temp.run(b2, 'read_api'), NULL, pg_temp.lot('VP1-2610A'), 'Reagent', 0.02, 'each'), (pg_temp.run(b2, 'read_api'), NULL, pg_temp.lot('VP2-2610A'), 'Reagent', 0.02, 'each');
    INSERT INTO entry_value (step_run_id, entry_id, analyte_id, value_text)
    SELECT pg_temp.run(b2, 'read_api'), e2.id, x.a, x.v FROM batch_entry e2,
           (VALUES (pg_temp.an('API 20E identification'), '6704752: Salmonella spp. (very good identification)'), (sal, 'Positive')) AS x(a, v) WHERE e2.batch_id = b2 AND e2.status = 'Active';
    PERFORM complete_step(pg_temp.run(b2, 'read_api'));
    PERFORM pg_temp.as_user('qa.reviewer', 'Step approved in QC Review');
    FOR r IN SELECT * FROM review_step_runs(b2) WHERE mark_id IS NULL LOOP PERFORM approve_review_step(r.step_run_id); END LOOP;
    PERFORM set_config('lims.reason', 'Incubator load accepted by the reviewer', true);
    FOR r IN SELECT l.id FROM incubation_load_view l WHERE l.batch_id = b2 AND l.status = 'Active' AND l.check_text IS NOT NULL LOOP
        PERFORM accept_load(b2, r.id, 'BSA re-incubated to 48 h as MC-12.04 7.2.2 requires when no typical colonies grow at 24 h; HEK and XLD read at 24 h.');
    END LOOP;
    PERFORM set_config('lims.reason', 'Batch reviewed and approved', true);
    PERFORM approve_batch(b2);

    ------------------------------------------------------------------ 6. DEMO-1016: today's samples, waiting in the backlog
    PERFORM pg_temp.as_user('akiddle', 'Sandbox demo data');
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, po_number, status, notes)
    VALUES (cl, cfl, desk, 'Online', 'DEMO-1016', 'Submitted', 'Weekly environmental and finished product program') RETURNING id INTO o2;
    ids := '{}';
    FOR r IN SELECT * FROM (VALUES ('Trail mix 2610-B', 'Trail mix, lot 2610-B', 'Food (ready-to-eat)', 1, 'Food'), ('Sponge, Line 1 floor drain', 'Environmental sponge, Line 1 floor drain', 'Environmental sponge swab', 2, 'Animal food and pet food'),
                                   ('Stick swab, conveyor 4', 'Environmental stick swab, conveyor 4', 'Environmental stick swab', 3, 'Animal food and pet food'), ('Dry cat food 26-301', 'Dry cat food, lot 26-301', 'Dry pet food (kibble)', 4, 'Animal food and pet food')) AS x(cid, d, m, o, cc) ORDER BY o LOOP
        INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, condition, receipt_temperature, compliance_category) VALUES (o2, r.cid, r.d, r.m, 'Acceptable', 3.8, r.cc) RETURNING id INTO s;
        PERFORM order_test(s, line_bax); ids := ids || s;
    END LOOP;
    PERFORM log_samples(ids);
    RAISE NOTICE 'Salmonella demo built: tests, client, quote, DEMO-1015 (in Report Finalization), DEMO-1016 (in the backlog)';
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Salmonella demo data skipped: %', SQLERRM;
END $$;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);

COMMIT;
