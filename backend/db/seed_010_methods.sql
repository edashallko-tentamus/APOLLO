-- Sandbox demo data for the Workflow Designer (migration 012): CFL's Chemistry and Microbiology department groups,
-- methods (SOPs), equipment types the workflows name, and eight demo tests built by the demo Analyst and approved by
-- the demo Lab Supervisor:
--   Heavy Metals (Pb, Cd, As, Hg) by ICP-MS with batch QC (method blank, LCS, matrix spike with a mercury exception,
--   MSD, ICV, CCV every 10); USP <62> specified microorganisms (five organisms on parallel branches, identification
--   split off when something is found); USP <60> Burkholderia cepacia complex; USP <61> and USP <62> method
--   suitability; USP <51> antimicrobial effectiveness, Category 2 (initial, day 7, 14 and 28 counts, each timepoint
--   reviewed on its own branch); microbial identification by MALDI-TOF. The combined USP <61>/<62> suitability test is
--   left as a Draft so it can be reviewed and approved on screen.
-- Incubation times and temperatures follow the USP chapters as commonly applied; each lab checks them against its SOPs.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Methods', r, s FROM (VALUES ('Correcting an entry error', 10), ('Method or SOP revised', 20), ('Department or equipment changed', 30), ('Test retired', 40)) AS x(r, s)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Methods' AND lower(c.reason_text) = lower(x.r));

INSERT INTO unit_of_measure (unit_code, unit_name, dimension, sort_order)
SELECT c, n, 'Other', s FROM (VALUES ('%', 'percent (recovery)', 110), ('log', 'log10 (reduction)', 111)) AS x(c, n, s)
WHERE NOT EXISTS (SELECT 1 FROM unit_of_measure u WHERE u.unit_code = x.c);

INSERT INTO analyte (analyte_name, report_name, analyte_class)
SELECT n, r, 'Microbiological' FROM (VALUES
  ('Pseudomonas aeruginosa', 'Pseudomonas aeruginosa'), ('Staphylococcus aureus', 'Staphylococcus aureus'), ('Candida albicans', 'Candida albicans'),
  ('Burkholderia cepacia complex', 'Burkholderia cepacia complex (Bcc)'), ('Aspergillus brasiliensis', 'Aspergillus brasiliensis'),
  ('Bacillus subtilis', 'Bacillus subtilis'), ('Microbial identification', 'Identification')) AS x(n, r)
WHERE NOT EXISTS (SELECT 1 FROM analyte a WHERE lower(a.analyte_name) = lower(x.n));

INSERT INTO equipment_type (site_id, type_name, description)
SELECT s.id, t.n, t.d FROM lab_site s, (VALUES ('Top-loading balance', 'Balance, 0.01 g'), ('Microwave digester', 'Closed-vessel microwave digestion system'),
    ('MALDI-TOF', 'MALDI-TOF mass spectrometer for microbial identification'), ('Biosafety cabinet', 'Class II biological safety cabinet'),
    ('Colony counter', NULL)) AS t(n, d)
WHERE s.site_code IN ('CFL', 'TPS') ON CONFLICT DO NOTHING;

-- Department groups: their members are the people who do each department's steps
INSERT INTO lab_group (site_id, group_name, description, department_id)
SELECT s.id, g.n, g.d, (SELECT id FROM department WHERE site_id = s.id AND department_code = g.c)
  FROM lab_site s, (VALUES ('Chemistry', 'Chemistry department: does the chemistry tests'' steps', 'CHEM'),
                           ('Microbiology', 'Microbiology department: does the microbiology tests'' steps', 'MICRO')) AS g(n, d, c)
 WHERE s.site_code = 'CFL' ON CONFLICT DO NOTHING;
UPDATE lab_group g SET department_id = d.id FROM department d JOIN lab_site s ON s.id = d.site_id     -- a lab-made group of that name already there
 WHERE s.site_code = 'CFL' AND g.site_id = s.id AND g.department_id IS NULL
   AND ((g.group_name = 'Chemistry' AND d.department_code = 'CHEM') OR (g.group_name = 'Microbiology' AND d.department_code = 'MICRO'));
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id, app_user u
 WHERE s.site_code = 'CFL' AND g.group_name IN ('Chemistry', 'Microbiology') AND u.username = 'analyst' ON CONFLICT DO NOTHING;

-- Helpers for building the demo workflows
CREATE FUNCTION pg_temp.an(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM analyte WHERE analyte_name = n $$;
CREATE FUNCTION pg_temp.ana(v uuid, n text, typ result_type, unit text, loq numeric DEFAULT NULL, lod numeric DEFAULT NULL,
                            smin numeric DEFAULT NULL, smax numeric DEFAULT NULL, stext text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod, default_spec_min, default_spec_max, default_spec_text)
    VALUES (v, pg_temp.an(n), (SELECT count(*) + 1 FROM test_version_analyte WHERE test_version_id = v), typ, unit, loq, lod, smin, smax, stext)
$$;
-- a step: deps = steps it follows; par = steps it branches off in parallel; eq = equipment types (first = main)
CREATE FUNCTION pg_temp.st(v uuid, k text, nm text, ty step_type, cfg jsonb, deps text[] DEFAULT '{}', eq text[] DEFAULT '{}', par text[] DEFAULT '{}', instr text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid; v_site uuid := (SELECT t.site_id FROM test t JOIN test_version x ON x.test_id = t.id WHERE x.id = v); d text; i integer := 0;
BEGIN
    INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, config, instructions)
    VALUES (v, k, nm, ty, (SELECT count(*) + 1 FROM workflow_step WHERE test_version_id = v), cfg, instr) RETURNING id INTO v_id;
    FOREACH d IN ARRAY eq LOOP
        i := i + 1;
        INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main) VALUES (v_id, (SELECT id FROM equipment_type WHERE site_id = v_site AND type_name = d), i = 1);
    END LOOP;
    FOREACH d IN ARRAY deps LOOP
        INSERT INTO workflow_step_dependency (step_id, depends_on_step_id) VALUES (v_id, (SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = d AND status = 'Active'));
    END LOOP;
    FOREACH d IN ARRAY par LOOP
        INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type) VALUES (v_id, (SELECT id FROM workflow_step WHERE test_version_id = v AND step_key = d AND status = 'Active'), 'Parallel');
    END LOOP;
    RETURN v_id;
END $$;
CREATE FUNCTION pg_temp.inc(t numeric, tol numeric, dur numeric, unit text, wmin numeric, wmax numeric) RETURNS jsonb LANGUAGE sql AS $$
    SELECT jsonb_build_object('temp_c', t, 'temp_tolerance', tol, 'duration', dur, 'duration_unit', unit, 'window_min', wmin, 'window_max', wmax)
$$;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL');
        chem uuid; micro uuid; m_icp uuid; m_62 uuid; m_60 uuid; m_suit uuid; m_51 uuid; m_id uuid;
        t_icp uuid; t_id uuid; t_62 uuid; t_60 uuid; t_61s uuid; t_62s uuid; t_comb uuid; t_51 uuid; v uuid; tp text; prev text;
        ctrl jsonb := '[{"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Absence"}]},
                        {"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Presence"}]}]';
BEGIN
    IF EXISTS (SELECT 1 FROM test WHERE site_id = cfl AND test_name = 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS') THEN RETURN; END IF;
    SELECT id INTO chem FROM department WHERE site_id = cfl AND department_code = 'CHEM';
    SELECT id INTO micro FROM department WHERE site_id = cfl AND department_code = 'MICRO';

    -- built by the demo analyst
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'analyst'), true);
    PERFORM script_signature('Sandbox demo data');
    INSERT INTO method (site_id, method_name, sop_code, description) VALUES
     (cfl, 'Elemental impurities by ICP-MS (USP <233>)', 'SOP-CHEM-0233', 'Closed-vessel microwave digestion, ICP-MS with internal standards') RETURNING id INTO m_icp;
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'USP <62> Tests for specified microorganisms', 'SOP-MIC-0062') RETURNING id INTO m_62;
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'USP <60> Burkholderia cepacia complex', 'SOP-MIC-0060') RETURNING id INTO m_60;
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'USP <61>/<62> Method suitability', 'SOP-MIC-0061S') RETURNING id INTO m_suit;
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'USP <51> Antimicrobial effectiveness testing', 'SOP-MIC-0051') RETURNING id INTO m_51;
    INSERT INTO method (site_id, method_name, sop_code) VALUES (cfl, 'Microbial identification by MALDI-TOF', 'SOP-MIC-0100') RETURNING id INTO m_id;

    ---------------------------------------------------------------- Heavy metals by ICP-MS
    t_icp := create_test(cfl, 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS', chem, m_icp);
    v := (SELECT id FROM test_version WHERE test_id = t_icp);
    UPDATE test_version SET procedure_text = 'Weigh 0.5 g into a microwave vessel, digest with HNO3/HCl, make up to 50 mL, dilute 1 + 4 and read on the ICP-MS against a 5-point calibration with internal standards.',
           change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Lead', 'Numeric', 'mg/kg', 0.010, 0.003, NULL, 0.5);
    PERFORM pg_temp.ana(v, 'Cadmium', 'Numeric', 'mg/kg', 0.010, 0.003, NULL, 0.5);
    PERFORM pg_temp.ana(v, 'Arsenic', 'Numeric', 'mg/kg', 0.010, 0.003, NULL, 1.5);
    PERFORM pg_temp.ana(v, 'Mercury', 'Numeric', 'mg/kg', 0.005, 0.002, NULL, 3.0);
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 20, 'qc', jsonb_build_array(
        '{"qc_type": "Method Blank", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Blank threshold", "limit_ref": "½ LOQ"}]}'::jsonb,
        '{"qc_type": "Laboratory Control Sample", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 80, "max": 120}]}'::jsonb,
        jsonb_build_object('qc_type', 'Matrix Spike', 'qc_class', 'Prep', 'frequency', 'Once', 'count', 1, 'criteria', jsonb_build_array(jsonb_build_object(
            'limit_type', 'Recovery %', 'min', 75, 'max', 125, 'overrides', jsonb_build_array(jsonb_build_object('analyte_id', pg_temp.an('Mercury'), 'min', 70, 'max', 130))))),
        '{"qc_type": "Matrix Spike Duplicate", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "RPD", "max": 20}]}'::jsonb,
        '{"qc_type": "ICV", "qc_class": "Analytical", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}'::jsonb,
        '{"qc_type": "CCV", "qc_class": "Analytical", "frequency": "Every N", "every_n": 10, "criteria": [{"limit_type": "Recovery %", "min": 90, "max": 110}]}'::jsonb)));
    PERFORM pg_temp.st(v, 'weigh', 'Weigh', 'Weighing', '{"target": 0.5, "tolerance": 0.05, "unit": "g"}', '{batch}', '{Analytical balance}');
    PERFORM pg_temp.st(v, 'digest', 'Microwave digestion', 'Preparation', '{"procedure_ref": "SOP-CHEM-0233 section 7", "fields": [
        {"label": "Digest final volume (mL)", "type": "Number"}, {"label": "Program", "type": "Text"}, {"label": "Maximum temperature (°C)", "type": "Number"}]}', '{weigh}', '{Microwave digester}');
    PERFORM pg_temp.st(v, 'dil', 'Dilute for ICP-MS', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 40, "fields_per_entry": 3, "expected_diluent": "2% nitric acid"}', '{digest}');
    PERFORM pg_temp.st(v, 'read', 'ICP-MS reading', 'Data Entry', '{"value_label": "Concentration in solution", "value_unit": "µg/L", "require_attachment": true}', '{dil}', '{ICP-MS}');
    PERFORM pg_temp.st(v, 'calc', 'Result in the sample', 'Calculation',
        '{"formula": "{read.reading} * {dil.factor} * {digest.digest_final_volume_ml} / 1000 / {weigh.weight}", "result_unit": "mg/kg",
          "note": "µg/L x dilution factor x digest volume (mL) / 1000 / sample weight (g) = mg/kg"}', '{read}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{calc}');

    ---------------------------------------------------------------- Microbial identification (split off by the micro screens)
    t_id := create_test(cfl, 'Microbial Identification (MALDI-TOF)', micro, m_id);
    v := (SELECT id FROM test_version WHERE test_id = t_id);
    UPDATE test_version SET procedure_text = 'Subculture the isolate for purity, spot a fresh colony on the target with HCCA matrix, acquire spectra and match against the library (score 2.00 or more for species).',
           change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Microbial identification', 'Text', NULL);
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', '{"max_samples": 48, "qc": [{"qc_type": "Positive Control", "qc_class": "Analytical", "frequency": "Once", "count": 1,
        "criteria": [{"limit_type": "Identified"}]}]}');
    PERFORM pg_temp.st(v, 'sub', 'Purity subculture', 'Plating/Inoculation', '{"expected_media": "Tryptic soy agar", "plates_per_entry": 1}', '{batch}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'inc', 'Incubate subculture', 'Incubation', pg_temp.inc(32.5, 2.5, 21, 'hours', 18, 24), '{sub}', '{Incubator}');
    PERFORM pg_temp.st(v, 'spot', 'Spot on target', 'Preparation', '{"procedure_ref": "SOP-MIC-0100 section 6", "fields": [{"label": "Target ID", "type": "Text"}]}', '{inc}');
    PERFORM pg_temp.st(v, 'read', 'MALDI-TOF identification', 'Data Entry', '{"value_label": "Identification and score", "require_attachment": true}', '{spot}', '{MALDI-TOF}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{read}');

    ---------------------------------------------------------------- USP <62> specified microorganisms
    t_62 := create_test(cfl, 'USP <62> Specified Microorganisms', micro, m_62);
    v := (SELECT id FROM test_version WHERE test_id = t_62);
    UPDATE test_version SET procedure_text = 'Enrich 10 g in 90 mL (TSB; SDB for Candida), subculture to the selective media for each organism, read for typical colonies. Suspect colonies go for identification.',
           change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Salmonella', 'Qualitative', NULL, smin => NULL, smax => NULL, stext => 'Absent in 10 g');
    PERFORM pg_temp.ana(v, 'E. coli', 'Qualitative', NULL, stext => 'Absent in 1 g');
    PERFORM pg_temp.ana(v, 'Pseudomonas aeruginosa', 'Qualitative', NULL, stext => 'Absent in 1 g');
    PERFORM pg_temp.ana(v, 'Staphylococcus aureus', 'Qualitative', NULL, stext => 'Absent in 1 g');
    PERFORM pg_temp.ana(v, 'Candida albicans', 'Qualitative', NULL, stext => 'Absent in 1 g');
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 20, 'qc', ctrl));
    PERFORM pg_temp.st(v, 'weigh', 'Weigh 10 g', 'Weighing', '{"target": 10, "tolerance": 0.5, "unit": "g"}', '{batch}', '{Top-loading balance}');
    PERFORM pg_temp.st(v, 'tsb', 'Enrich in TSB', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Tryptic soy broth"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inc_tsb', 'Incubate TSB', 'Incubation', pg_temp.inc(32.5, 2.5, 21, 'hours', 18, 24), '{tsb}', '{Incubator}');
    -- Salmonella
    PERFORM pg_temp.st(v, 'rv', 'Subculture to RVS broth', 'Preparation', '{"procedure_ref": "0.1 mL into 10 mL Rappaport Vassiliadis Salmonella enrichment broth"}', '{inc_tsb}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'inc_rv', 'Incubate RVS', 'Incubation', pg_temp.inc(32.5, 2.5, 21, 'hours', 18, 24), '{rv}', '{Incubator}');
    PERFORM pg_temp.st(v, 'xld', 'Streak XLD agar', 'Plating/Inoculation', '{"expected_media": "XLD agar", "plates_per_entry": 1}', '{inc_rv}');
    PERFORM pg_temp.st(v, 'inc_xld', 'Incubate XLD', 'Incubation', pg_temp.inc(32.5, 2.5, 33, 'hours', 18, 48), '{xld}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_sal', 'Read Salmonella', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (red, with or without black centres)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Salmonella'))), '{inc_xld}');
    -- E. coli
    PERFORM pg_temp.st(v, 'macb', 'Subculture to MacConkey broth', 'Preparation', '{"procedure_ref": "1 mL into 100 mL MacConkey broth"}', '{inc_tsb}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'inc_macb', 'Incubate MacConkey broth', 'Incubation', pg_temp.inc(43, 1, 36, 'hours', 24, 48), '{macb}', '{Incubator}');
    PERFORM pg_temp.st(v, 'mac', 'Streak MacConkey agar', 'Plating/Inoculation', '{"expected_media": "MacConkey agar", "plates_per_entry": 1}', '{inc_macb}');
    PERFORM pg_temp.st(v, 'inc_mac', 'Incubate MacConkey agar', 'Incubation', pg_temp.inc(32.5, 2.5, 45, 'hours', 18, 72), '{mac}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_ec', 'Read E. coli', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (brick-red, may have a zone of precipitated bile)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('E. coli'))), '{inc_mac}');
    -- Staphylococcus aureus
    PERFORM pg_temp.st(v, 'msa', 'Streak mannitol salt agar', 'Plating/Inoculation', '{"expected_media": "Mannitol salt agar", "plates_per_entry": 1}', '{inc_tsb}');
    PERFORM pg_temp.st(v, 'inc_msa', 'Incubate MSA', 'Incubation', pg_temp.inc(32.5, 2.5, 45, 'hours', 18, 72), '{msa}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_sa', 'Read S. aureus', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (yellow or white, with a yellow zone)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Staphylococcus aureus'))), '{inc_msa}');
    -- Pseudomonas aeruginosa
    PERFORM pg_temp.st(v, 'cet', 'Streak cetrimide agar', 'Plating/Inoculation', '{"expected_media": "Cetrimide agar", "plates_per_entry": 1}', '{inc_tsb}');
    PERFORM pg_temp.st(v, 'inc_cet', 'Incubate cetrimide', 'Incubation', pg_temp.inc(32.5, 2.5, 45, 'hours', 18, 72), '{cet}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_pa', 'Read P. aeruginosa', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (greenish, fluorescent)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Pseudomonas aeruginosa'))), '{inc_cet}');
    -- Candida albicans (its own enrichment)
    PERFORM pg_temp.st(v, 'sdb', 'Enrich in SDB', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Sabouraud dextrose broth"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inc_sdb', 'Incubate SDB', 'Incubation', pg_temp.inc(32.5, 2.5, 4, 'days', 3, 5), '{sdb}', '{Incubator}');
    PERFORM pg_temp.st(v, 'sda', 'Streak Sabouraud dextrose agar', 'Plating/Inoculation', '{"expected_media": "Sabouraud dextrose agar", "plates_per_entry": 1}', '{inc_sdb}');
    PERFORM pg_temp.st(v, 'inc_sda', 'Incubate SDA', 'Incubation', pg_temp.inc(32.5, 2.5, 36, 'hours', 24, 48), '{sda}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_ca', 'Read C. albicans', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (white, convex)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Candida albicans'))), '{inc_sda}');
    PERFORM pg_temp.st(v, 'ident', 'Identify suspect colonies', 'Split off Test', jsonb_build_object('test_id', t_id, 'trigger', 'On finding', 'finding', 'Present',
        'finding_steps', '["read_sal","read_ec","read_sa","read_pa","read_ca"]'::jsonb), '{read_sal,read_ec,read_sa,read_pa,read_ca}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{ident}');

    ---------------------------------------------------------------- USP <60> Burkholderia cepacia complex
    t_60 := create_test(cfl, 'USP <60> Burkholderia cepacia Complex', micro, m_60);
    v := (SELECT id FROM test_version WHERE test_id = t_60);
    UPDATE test_version SET procedure_text = 'Enrich 10 g in 90 mL TSB, subculture to BCSA, read for typical colonies. Suspect colonies go for identification.', change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Burkholderia cepacia complex', 'Qualitative', NULL, stext => 'Absent in 1 g');
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 20, 'qc', ctrl));
    PERFORM pg_temp.st(v, 'weigh', 'Weigh 10 g', 'Weighing', '{"target": 10, "tolerance": 0.5, "unit": "g"}', '{batch}', '{Top-loading balance}');
    PERFORM pg_temp.st(v, 'tsb', 'Enrich in TSB', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Tryptic soy broth"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inc_tsb', 'Incubate TSB', 'Incubation', pg_temp.inc(32.5, 2.5, 60, 'hours', 48, 72), '{tsb}', '{Incubator}');
    PERFORM pg_temp.st(v, 'bcsa', 'Streak BCSA', 'Plating/Inoculation', '{"expected_media": "Burkholderia cepacia selective agar (BCSA)", "plates_per_entry": 1}', '{inc_tsb}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'inc_bcsa', 'Incubate BCSA', 'Incubation', pg_temp.inc(32.5, 2.5, 60, 'hours', 48, 72), '{bcsa}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read', 'Read Bcc', 'Data Entry', jsonb_build_object('value_label', 'Typical colonies (greenish-brown with yellow halo, or white with pink-red zone)', 'require_attachment', false), '{inc_bcsa}');
    PERFORM pg_temp.st(v, 'ident', 'Identify suspect colonies', 'Split off Test', jsonb_build_object('test_id', t_id, 'trigger', 'On finding', 'finding', 'Present', 'finding_steps', '["read"]'::jsonb), '{read}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{ident}');

    ---------------------------------------------------------------- USP <61> method suitability (counting)
    t_61s := create_test(cfl, 'USP <61> Method Suitability (TAMC/TYMC)', micro, m_suit);
    v := (SELECT id FROM test_version WHERE test_id = t_61s);
    UPDATE test_version SET procedure_text = 'Inoculate the prepared sample with not more than 100 CFU of each test organism; recovery must be within a factor of 2 of the inoculum count (50 to 200%).',
           change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Staphylococcus aureus', 'Numeric', '%', smin => 50, smax => 200);
    PERFORM pg_temp.ana(v, 'Pseudomonas aeruginosa', 'Numeric', '%', smin => 50, smax => 200);
    PERFORM pg_temp.ana(v, 'Bacillus subtilis', 'Numeric', '%', smin => 50, smax => 200);
    PERFORM pg_temp.ana(v, 'Candida albicans', 'Numeric', '%', smin => 50, smax => 200);
    PERFORM pg_temp.ana(v, 'Aspergillus brasiliensis', 'Numeric', '%', smin => 50, smax => 200);
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 5, 'qc', ctrl));
    PERFORM pg_temp.st(v, 'weigh', 'Weigh 10 g', 'Weighing', '{"target": 10, "tolerance": 0.5, "unit": "g"}', '{batch}', '{Top-loading balance}');
    PERFORM pg_temp.st(v, 'dil', 'Prepare 1 in 10', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Buffered sodium chloride-peptone solution pH 7.0"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inoc', 'Inoculate test organisms', 'Preparation', '{"procedure_ref": "Not more than 100 CFU of each organism", "fields": [{"label": "Inoculum count (CFU)", "type": "Number"}]}', '{dil}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'plate_b', 'Plate bacteria (TSA)', 'Plating/Inoculation', '{"expected_media": "Tryptic soy agar", "plates_per_entry": 2}', '{inoc}');
    PERFORM pg_temp.st(v, 'inc_b', 'Incubate TSA', 'Incubation', pg_temp.inc(32.5, 2.5, 3, 'days', 2, 3), '{plate_b}', '{Incubator}');
    PERFORM pg_temp.st(v, 'count_b', 'Count bacteria', 'Data Entry', jsonb_build_object('value_label', 'CFU per plate', 'value_unit', 'CFU/mL', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Staphylococcus aureus'), pg_temp.an('Pseudomonas aeruginosa'), pg_temp.an('Bacillus subtilis'))), '{inc_b}', '{Colony counter}');
    PERFORM pg_temp.st(v, 'plate_f', 'Plate yeast and mould (SDA)', 'Plating/Inoculation', '{"expected_media": "Sabouraud dextrose agar", "plates_per_entry": 2}', '{inoc}');
    PERFORM pg_temp.st(v, 'inc_f', 'Incubate SDA', 'Incubation', pg_temp.inc(22.5, 2.5, 5, 'days', 3, 5), '{plate_f}', '{Incubator}');
    PERFORM pg_temp.st(v, 'count_f', 'Count yeast and mould', 'Data Entry', jsonb_build_object('value_label', 'CFU per plate', 'value_unit', 'CFU/mL', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('Candida albicans'), pg_temp.an('Aspergillus brasiliensis'))), '{inc_f}', '{Colony counter}');
    PERFORM pg_temp.st(v, 'calc', 'Recovery', 'Calculation', jsonb_build_object('formula', '{count_b.reading} / {inoc.inoculum_count_cfu} * 100', 'result_unit', '%',
        'overrides', jsonb_build_array(jsonb_build_object('analyte_id', pg_temp.an('Candida albicans'), 'formula', '{count_f.reading} / {inoc.inoculum_count_cfu} * 100'),
                                       jsonb_build_object('analyte_id', pg_temp.an('Aspergillus brasiliensis'), 'formula', '{count_f.reading} / {inoc.inoculum_count_cfu} * 100'))),
        '{count_b,count_f}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{calc}');

    ---------------------------------------------------------------- USP <62> method suitability (detection)
    t_62s := create_test(cfl, 'USP <62> Method Suitability', micro, m_suit);
    v := (SELECT id FROM test_version WHERE test_id = t_62s);
    UPDATE test_version SET procedure_text = 'Inoculate the enrichment with not more than 100 CFU of each specified organism; each must be detected on its selective medium.', change_summary = 'First version' WHERE id = v;
    PERFORM pg_temp.ana(v, 'Salmonella', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.ana(v, 'E. coli', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.ana(v, 'Pseudomonas aeruginosa', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.ana(v, 'Staphylococcus aureus', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.ana(v, 'Candida albicans', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', jsonb_build_object('max_samples', 5, 'qc', ctrl));
    PERFORM pg_temp.st(v, 'weigh', 'Weigh 10 g', 'Weighing', '{"target": 10, "tolerance": 0.5, "unit": "g"}', '{batch}', '{Top-loading balance}');
    PERFORM pg_temp.st(v, 'tsb', 'Enrich in TSB', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Tryptic soy broth"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inoc', 'Inoculate specified organisms', 'Preparation', '{"procedure_ref": "Not more than 100 CFU of each organism", "fields": [{"label": "Inoculum count (CFU)", "type": "Number"}]}', '{tsb}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'inc', 'Incubate enrichment', 'Incubation', pg_temp.inc(32.5, 2.5, 21, 'hours', 18, 24), '{inoc}', '{Incubator}');
    PERFORM pg_temp.st(v, 'plate', 'Subculture to selective media', 'Plating/Inoculation', '{"expected_media": "XLD, MacConkey, mannitol salt, cetrimide and Sabouraud dextrose agar", "plates_per_entry": 1}', '{inc}');
    PERFORM pg_temp.st(v, 'inc_sel', 'Incubate selective media', 'Incubation', pg_temp.inc(32.5, 2.5, 45, 'hours', 18, 72), '{plate}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read', 'Read each organism', 'Data Entry', '{"value_label": "Detected (typical colonies)", "require_attachment": false}', '{inc_sel}');
    PERFORM pg_temp.st(v, 'review', 'QC Review', 'QC Review', '{}', '{read}');

    ---------------------------------------------------------------- USP <51> antimicrobial effectiveness, Category 2
    t_51 := create_test(cfl, 'USP <51> Antimicrobial Effectiveness (Category 2)', micro, m_51);
    v := (SELECT id FROM test_version WHERE test_id = t_51);
    UPDATE test_version SET procedure_text = 'Inoculate separate containers with each organism (1e5 to 1e6 CFU/mL), hold at 22.5 °C, count at day 7, 14 and 28. Category 2: bacteria not less than 2.0 log reduction from the initial count at 14 days and no increase from 14 to 28 days; yeasts and moulds no increase from the initial count at 14 and 28 days.',
           change_summary = 'First version', rounding_mode = 'Decimal places', rounding_digits = 1 WHERE id = v;
    PERFORM pg_temp.ana(v, 'Staphylococcus aureus', 'Numeric', 'log', stext => 'Not less than 2.0 log reduction at 14 days; no increase from 14 to 28 days');
    PERFORM pg_temp.ana(v, 'Pseudomonas aeruginosa', 'Numeric', 'log', stext => 'Not less than 2.0 log reduction at 14 days; no increase from 14 to 28 days');
    PERFORM pg_temp.ana(v, 'E. coli', 'Numeric', 'log', stext => 'Not less than 2.0 log reduction at 14 days; no increase from 14 to 28 days');
    PERFORM pg_temp.ana(v, 'Candida albicans', 'Numeric', 'log', stext => 'No increase from the initial count at 14 and 28 days');
    PERFORM pg_temp.ana(v, 'Aspergillus brasiliensis', 'Numeric', 'log', stext => 'No increase from the initial count at 14 and 28 days');
    PERFORM pg_temp.st(v, 'batch', 'Batch', 'Batching', '{"max_samples": 4, "qc": [{"qc_type": "Positive Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Presence"}]},
        {"qc_type": "Negative Control", "qc_class": "Prep", "frequency": "Once", "count": 1, "criteria": [{"limit_type": "Absence"}]}]}');
    PERFORM pg_temp.st(v, 'weigh', 'Portion into containers', 'Weighing', '{"target": 20, "tolerance": 1, "unit": "g"}', '{batch}', '{Top-loading balance}');
    PERFORM pg_temp.st(v, 'inoc', 'Inoculate each container', 'Preparation', '{"procedure_ref": "1e5 to 1e6 CFU/mL, inoculum not more than 1% of the product volume",
        "fields": [{"label": "Inoculum volume (mL)", "type": "Number"}, {"label": "Inoculated at", "type": "Time"}]}', '{weigh}', '{Biosafety cabinet}');
    PERFORM pg_temp.st(v, 'dil_0', 'Initial: serial dilution', 'Dilution', '{"mode": "Serial", "initial_amount": 1, "initial_diluent": 9, "transfer_aliquot": 1, "transfer_diluent": 9, "depth": 5, "fields_per_entry": 6, "expected_diluent": "Neutralizing broth"}', '{inoc}');
    PERFORM pg_temp.st(v, 'plate_0', 'Initial: plate', 'Plating/Inoculation', '{"expected_media": "TSA (bacteria), SDA (yeast and mould)", "plates_per_entry": 2}', '{dil_0}');
    PERFORM pg_temp.st(v, 'inc_0', 'Initial: incubate plates', 'Incubation', pg_temp.inc(32.5, 2.5, 3, 'days', 3, 5), '{plate_0}', '{Incubator}');
    PERFORM pg_temp.st(v, 'count_0', 'Initial: count', 'Data Entry', '{"value_label": "CFU per plate", "require_attachment": false}', '{inc_0}', '{Colony counter}');
    PERFORM pg_temp.st(v, 'calc_0', 'Initial: log count', 'Calculation', '{"formula": "log10({count_0.reading} * {dil_0.factor})", "result_unit": "log"}', '{count_0}');
    prev := 'inoc';
    FOREACH tp IN ARRAY ARRAY['7', '14', '28'] LOOP
        PERFORM pg_temp.st(v, 'hold_' || tp, 'Day ' || tp || ': hold product', 'Incubation',
            pg_temp.inc(22.5, 2.5, tp::numeric, 'days', tp::numeric - 0.5, tp::numeric + 0.5), ARRAY[prev], '{Incubator}');
        PERFORM pg_temp.st(v, 'dil_' || tp, 'Day ' || tp || ': serial dilution', 'Dilution', '{"mode": "Serial", "initial_amount": 1, "initial_diluent": 9, "transfer_aliquot": 1, "transfer_diluent": 9, "depth": 4, "fields_per_entry": 6, "expected_diluent": "Neutralizing broth"}', ARRAY['hold_' || tp]);
        PERFORM pg_temp.st(v, 'plate_' || tp, 'Day ' || tp || ': plate', 'Plating/Inoculation', '{"expected_media": "TSA (bacteria), SDA (yeast and mould)", "plates_per_entry": 2}', ARRAY['dil_' || tp]);
        PERFORM pg_temp.st(v, 'inc_' || tp, 'Day ' || tp || ': incubate plates', 'Incubation', pg_temp.inc(32.5, 2.5, 3, 'days', 3, 5), ARRAY['plate_' || tp], '{Incubator}');
        PERFORM pg_temp.st(v, 'count_' || tp, 'Day ' || tp || ': count', 'Data Entry', '{"value_label": "CFU per plate", "require_attachment": false}', ARRAY['inc_' || tp], '{Colony counter}');
        PERFORM pg_temp.st(v, 'calc_' || tp, 'Day ' || tp || ': log reduction', 'Calculation',
            jsonb_build_object('formula', '{calc_0.result} - log10({count_' || tp || '.reading} * {dil_' || tp || '.factor})', 'result_unit', 'log'), ARRAY['count_' || tp, 'calc_0']);
        IF tp = '28' THEN
            PERFORM pg_temp.st(v, 'review_28', 'Day 28: QC Review', 'QC Review', '{"scope": "Timepoint"}', ARRAY['calc_28']);
        ELSE
            PERFORM pg_temp.st(v, 'review_' || tp, 'Day ' || tp || ': QC Review', 'QC Review', '{"scope": "Timepoint"}', '{}', '{}', ARRAY['calc_' || tp]);
        END IF;
        prev := 'count_' || tp;
    END LOOP;

    ---------------------------------------------------------------- Combined USP <61>/<62> suitability: duplicated from <61> and extended (left as a Draft)
    t_comb := copy_test(t_61s, cfl, 'USP <61>/<62> Method Suitability (combined)');
    v := (SELECT id FROM test_version WHERE test_id = t_comb);
    UPDATE test_version SET change_summary = 'Duplicated from USP <61> Method Suitability; <62> detection branch added for E. coli and Salmonella',
           procedure_text = 'USP <61> recovery for the five counting organisms and USP <62> detection for E. coli and Salmonella in one run. S. aureus, P. aeruginosa and C. albicans are reported once, as their <61> recovery.' WHERE id = v;
    PERFORM pg_temp.ana(v, 'E. coli', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.ana(v, 'Salmonella', 'Qualitative', NULL, stext => 'Present');
    PERFORM pg_temp.st(v, 'tsb', 'Enrich in TSB (USP <62>)', 'Dilution', '{"mode": "Single", "aliquot": 10, "diluent": 90, "fields_per_entry": 3, "expected_diluent": "Tryptic soy broth"}', '{weigh}');
    PERFORM pg_temp.st(v, 'inc_tsb', 'Incubate enrichment', 'Incubation', pg_temp.inc(32.5, 2.5, 21, 'hours', 18, 24), '{tsb}', '{Incubator}');
    PERFORM pg_temp.st(v, 'sel', 'Subculture to XLD and MacConkey', 'Plating/Inoculation', '{"expected_media": "XLD agar, MacConkey agar", "plates_per_entry": 1}', '{inc_tsb}');
    PERFORM pg_temp.st(v, 'inc_sel', 'Incubate selective media', 'Incubation', pg_temp.inc(32.5, 2.5, 45, 'hours', 18, 72), '{sel}', '{Incubator}');
    PERFORM pg_temp.st(v, 'read_62', 'Read E. coli and Salmonella', 'Data Entry', jsonb_build_object('value_label', 'Detected (typical colonies)', 'require_attachment', false,
        'analyte_ids', jsonb_build_array(pg_temp.an('E. coli'), pg_temp.an('Salmonella'))), '{inc_sel}');
    PERFORM pg_temp.st(v, 'review_62', 'QC Review (<62> detection)', 'QC Review', '{}', '{read_62}');

    -- approved by the demo Lab Supervisor (who did not work on them); the combined test stays a Draft
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'labsup'), true);
    PERFORM script_signature('Sandbox demo data');
    PERFORM approve_test_version(v2.id) FROM test_version v2 WHERE v2.test_id IN (t_icp, t_id, t_62, t_60, t_61s, t_62s, t_51) AND v2.status = 'Draft';

    -- catalogue pricing (catalogue editors)
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
    PERFORM script_signature('Sandbox demo data');
    UPDATE test_catalog_entry e SET description = x.d, base_price = x.p, standard_tat = x.tat, tat_unit = x.u::tat_unit,
           rush_schedule_id = (SELECT id FROM rush_fee_schedule WHERE schedule_name = x.r)
      FROM (VALUES (t_icp, 'Lead, cadmium, arsenic and mercury by ICP-MS (USP <232>/<233>)', 180, 7, 'Business Days', 'Chemistry Rush'),
                   (t_id, 'Identification of an isolate by MALDI-TOF', 95, 3, 'Business Days', 'Micro Rush'),
                   (t_62, 'Absence of specified microorganisms (USP <62>)', 225, 7, 'Calendar Days', 'Micro Rush'),
                   (t_60, 'Absence of Burkholderia cepacia complex (USP <60>)', 150, 7, 'Calendar Days', 'Micro Rush'),
                   (t_61s, 'Method suitability for microbial enumeration (USP <61>)', 350, 10, 'Calendar Days', NULL),
                   (t_62s, 'Method suitability for specified microorganisms (USP <62>)', 400, 10, 'Calendar Days', NULL),
                   (t_comb, 'Method suitability for USP <61> and <62> together', 650, 10, 'Calendar Days', NULL),
                   (t_51, 'Antimicrobial effectiveness testing, Category 2 products (USP <51>)', 900, 35, 'Calendar Days', NULL)) AS x(t, d, p, tat, u, r)
     WHERE e.test_id = x.t;
END $$;

-- A draft quote for Acme Irvine with the new tests and the client's own limits (the rest stay unspecified)
DO $$
DECLARE v_pv uuid; t_icp uuid := (SELECT t.id FROM test t JOIN lab_site s ON s.id = t.site_id WHERE s.site_code = 'CFL' AND t.test_name = 'Heavy Metals (Pb, Cd, As, Hg) by ICP-MS');
        t_62 uuid := (SELECT t.id FROM test t JOIN lab_site s ON s.id = t.site_id WHERE s.site_code = 'CFL' AND t.test_name = 'USP <62> Specified Microorganisms');
BEGIN
    IF EXISTS (SELECT 1 FROM project WHERE project_name = 'Supplement release: metals and micro') THEN RETURN; END IF;
    INSERT INTO project (client_id, project_name, purpose)
    SELECT id, 'Supplement release: metals and micro', 'Release testing with the client''s own limits' FROM client WHERE legal_name = 'Acme Nutrition Irvine Site';
    v_pv := new_project_version((SELECT id FROM project WHERE project_name = 'Supplement release: metals and micro'));
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v_pv, t_icp, 6), (v_pv, t_62, 6);
    UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = v_pv;
    INSERT INTO specification (quoted_line_id, analyte_id, max_value, unit, source)
    SELECT q.id, (SELECT id FROM analyte WHERE analyte_name = 'Lead'), 0.5, 'mg/kg', 'Client' FROM quoted_test_configuration q WHERE q.project_version_id = v_pv AND q.test_id = t_icp;
    INSERT INTO specification (quoted_line_id, analyte_id, text_value, source)
    SELECT q.id, (SELECT id FROM analyte WHERE analyte_name = 'Salmonella'), 'Absent in 10 g', 'Client' FROM quoted_test_configuration q WHERE q.project_version_id = v_pv AND q.test_id = t_62;
END $$;

COMMIT;
