-- Sandbox demo data for migration 035 (L-2: logbook values feed results), at CFL: the micro logbooks for USP <51>, <61>
-- and <62> (Alex, 2026-10-14), designed by the demo Lab Supervisor and approved by the demo QA Reviewer:
--  - Four more reference strains for USP <61> (P. aeruginosa ATCC 9027, B. subtilis ATCC 6633, C. albicans ATCC 10231,
--    A. brasiliensis ATCC 16404) join the demo inventory's S. aureus and E. coli.
--  - LB-0004 Reference cultures (working cultures and their passage from the ATCC culture, at most 5; published on the
--    culture's lot): each of the six at passage 1 to 3, approved.
--  - LB-0005 USP <61>/<62> challenge inoculum (not more than 100 CFU): each entry makes a lot (usable 24 h), reads its
--    culture's passage, publishes CFU per mL and CFU added. One for each of the five USP <61> organisms, made 90 minutes
--    ago (35 to 51 CFU added) and approved; E. coli made 80 minutes ago (60 CFU), waiting for QA.
--  - LB-0006 USP <51> inoculum standardization (about 1 x 10^8 CFU/mL): S. aureus at 1.0 x 10^8, approved.
--  - LB-0007 Daily positive and negative controls (USP <61>/<62>), the last three days.
--  - LB-0008 Sample weights (pre-analytical): aliquots of the two USP <62> samples waiting in the Microbiology backlog,
--    weighed by the demo Intake Tech on Top-loading balance 1 (scan them at the Weigh step).
--  - Version 2 of USP <61> Method Suitability (the inoculum count from the scanned challenge inoculum,
--    {inoc.cfu_added}) and of USP <51> (the initial count calculated from the scanned inoculum, {inoc.cfu_per_ml}),
--    built by the demo Analyst and left as Drafts: CFL requires a workflow verification before a version is approved.
-- Skipped whole if CFL already has a culture or inoculum logbook, or the demo records are missing.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);

CREATE OR REPLACE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = p), true);
    PERFORM script_signature('Sandbox demo data');
END $$;
CREATE OR REPLACE FUNCTION pg_temp.fld27(v uuid, k text, lbl text, typ text, ord integer, unit text DEFAULT NULL, lo numeric DEFAULT NULL, hi numeric DEFAULT NULL,
                                       req boolean DEFAULT true, f text DEFAULT NULL, ch text[] DEFAULT NULL, pub boolean DEFAULT false, hlp text DEFAULT NULL)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, limit_min, limit_max, required, formula, choices, publish, help)
    VALUES (v, k, lbl, typ, ord, unit, lo, hi, req, f, ch, pub, hlp)
$$;

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); tz text;
        sa uuid; ec uuid; tsa uuid; inc uuid; top uuid; s3 uuid; s4 uuid;
        lb_cul uuid; lb_ch uuid; lb_51 uuid; lb_ctl uuid; lb_w uuid; v uuid; d integer; e_sa uuid; e_ec uuid; e_51 uuid; t uuid; tv uuid;
        v_name text; v_mlot text; v_an text; v_lot uuid; cul record; n integer := 0;
BEGIN
    SELECT time_zone INTO tz FROM lab_site WHERE id = cfl;
    SELECT id INTO sa FROM inventory_lot WHERE site_id = cfl AND item_name = 'Staphylococcus aureus ATCC 6538' AND status = 'Available' ORDER BY created_at LIMIT 1;
    SELECT id INTO ec FROM inventory_lot WHERE site_id = cfl AND item_name = 'Escherichia coli ATCC 8739' AND status = 'Available' ORDER BY created_at LIMIT 1;
    SELECT id INTO tsa FROM inventory_lot WHERE site_id = cfl AND item_name = 'Tryptic soy agar plates' AND status = 'Available' ORDER BY created_at LIMIT 1;
    SELECT id INTO inc FROM equipment WHERE site_id = cfl AND equipment_name = 'Incubator 35 °C';
    SELECT id INTO top FROM equipment WHERE site_id = cfl AND equipment_name = 'Top-loading balance 1';
    SELECT s.id INTO s3 FROM sample s WHERE s.client_sample_id = 'MV-2201' AND EXISTS (SELECT 1 FROM requested_test rt JOIN test x ON x.id = rt.test_id WHERE rt.sample_id = s.id AND x.test_name = 'USP <62> Specified Microorganisms');
    SELECT s.id INTO s4 FROM sample s WHERE s.client_sample_id = 'TUR-2202' AND EXISTS (SELECT 1 FROM requested_test rt JOIN test x ON x.id = rt.test_id WHERE rt.sample_id = s.id AND x.test_name = 'USP <62> Specified Microorganisms');
    IF cfl IS NULL OR sa IS NULL OR ec IS NULL OR inc IS NULL OR top IS NULL
       OR EXISTS (SELECT 1 FROM logbook WHERE site_id = cfl AND kind IN ('Culture','Inoculum'))
       OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'labsup') OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'qa.reviewer') THEN
        RAISE NOTICE 'seed_028: skipped (CFL already has micro logbooks, or the demo records are missing)';
        RETURN;
    END IF;

    ---------------------------------------------------------------- the other USP <61> reference strains (S. aureus and E. coli are already in the inventory)
    PERFORM pg_temp.as_user('labsup');
    FOR v_name, v_mlot, v_an IN SELECT * FROM (VALUES ('Pseudomonas aeruginosa ATCC 9027', 'MB-PA-2609', 'Pseudomonas aeruginosa'), ('Bacillus subtilis ATCC 6633', 'MB-BS-2609', 'Bacillus subtilis'),
            ('Candida albicans ATCC 10231', 'MB-CA-2609', 'Candida albicans'), ('Aspergillus brasiliensis ATCC 16404', 'MB-AB-2609', 'Aspergillus brasiliensis')) x(n, l, a) LOOP
        IF NOT EXISTS (SELECT 1 FROM inventory_lot WHERE site_id = cfl AND item_name = v_name) AND EXISTS (SELECT 1 FROM analyte WHERE analyte_name = v_an) THEN
            INSERT INTO inventory_lot (site_id, item_name, chemical_types, manufacturer_lot, quantity_received, unit, expiration_date, notes)
            VALUES (cfl, v_name, '{"Microbiological Strain"}', v_mlot, 20, 'each', site_today(cfl) + 180, 'Working culture vials') RETURNING id INTO v_lot;
            INSERT INTO lot_analyte (lot_id, analyte_id) SELECT v_lot, id FROM analyte WHERE analyte_name = v_an;
        END IF;
    END LOOP;

    ---------------------------------------------------------------- the designs
    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, description)
    VALUES (cfl, 'Reference cultures (USP <51>, <61>, <62>)', 'Culture', 'Lot', 'As needed', 'Weekly',
            'Each working culture: its reference strain and its passage from the ATCC culture (not more than 5, as USP <51> and <61> ask). The passage is published on the culture''s lot, so the inoculum logbooks check it.')
    RETURNING id INTO lb_cul;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_cul);
    PERFORM pg_temp.fld27(v, 'reference', 'Reference strain (ATCC)', 'Text', 10);
    PERFORM pg_temp.fld27(v, 'passage', 'Passage from the reference culture', 'Number', 20, NULL, 1, 5, pub => true);
    PERFORM pg_temp.fld27(v, 'purity', 'Purity and typical colonies', 'Pass/Fail', 30);
    PERFORM pg_temp.fld27(v, 'medium_lot', 'Medium used', 'Lot', 40, req => false);

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, creates_lot, lot_name, lot_unit, validity_hours, description)
    VALUES (cfl, 'USP <61>/<62> challenge inoculum (not more than 100 CFU)', 'Inoculum', 'Lot', 'As needed', 'Daily', true, 'Challenge inoculum', 'mL', 24,
            'Each suspension is counted and labelled (its lot is made with the entry; usable 24 hours at 2 to 8 °C). Scanned at the suitability test''s Inoculate step: the test reads the CFU added from here.')
    RETURNING id INTO lb_ch;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_ch);
    PERFORM pg_temp.fld27(v, 'culture_lot', 'Working culture', 'Lot', 10);
    PERFORM pg_temp.fld27(v, 'culture_passage', 'Passage of the culture', 'Calculated', 20, NULL, NULL, 5, f => '{culture_lot.passage}');
    PERFORM pg_temp.fld27(v, 'volume_plated', 'Volume plated', 'Number', 30, 'mL');
    PERFORM pg_temp.fld27(v, 'count_1', 'Count, plate 1', 'Number', 40, 'CFU');
    PERFORM pg_temp.fld27(v, 'count_2', 'Count, plate 2', 'Number', 50, 'CFU');
    PERFORM pg_temp.fld27(v, 'cfu_per_ml', 'CFU per mL', 'Calculated', 60, 'CFU/mL', f => '({count_1} + {count_2}) / 2 / {volume_plated}', pub => true);
    PERFORM pg_temp.fld27(v, 'inoculum_ml', 'Volume added to each portion', 'Number', 70, 'mL');
    PERFORM pg_temp.fld27(v, 'cfu_added', 'CFU added', 'Calculated', 80, 'CFU', NULL, 100, f => '{cfu_per_ml} * {inoculum_ml}', pub => true);
    PERFORM pg_temp.fld27(v, 'volume_made', 'Volume made', 'Number', 90, 'mL');

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, creates_lot, lot_name, lot_unit, validity_hours, description)
    VALUES (cfl, 'USP <51> inoculum standardization (about 1 x 10^8 CFU/mL)', 'Inoculum', 'Lot', 'As needed', 'Daily', true, 'USP <51> inoculum', 'mL', 24,
            'Each organism''s suspension adjusted to about 1 x 10^8 CFU/mL and counted (its lot is made with the entry). Scanned at the USP <51> Inoculate step: the initial count in the product is calculated from it.')
    RETURNING id INTO lb_51;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_51);
    PERFORM pg_temp.fld27(v, 'culture_lot', 'Working culture', 'Lot', 10);
    PERFORM pg_temp.fld27(v, 'culture_passage', 'Passage of the culture', 'Calculated', 20, NULL, NULL, 5, f => '{culture_lot.passage}');
    PERFORM pg_temp.fld27(v, 'dilution', 'Dilution plated', 'Number', 30, NULL, hlp => 'As a fraction: 0.000001 for 10^-6');
    PERFORM pg_temp.fld27(v, 'volume_plated', 'Volume plated', 'Number', 40, 'mL');
    PERFORM pg_temp.fld27(v, 'count_1', 'Count, plate 1', 'Number', 50, 'CFU');
    PERFORM pg_temp.fld27(v, 'count_2', 'Count, plate 2', 'Number', 60, 'CFU');
    PERFORM pg_temp.fld27(v, 'cfu_per_ml', 'CFU per mL', 'Calculated', 70, 'CFU/mL', 10000000, 1000000000, f => '({count_1} + {count_2}) / 2 / {dilution} / {volume_plated}', pub => true);
    PERFORM pg_temp.fld27(v, 'volume_made', 'Volume made', 'Number', 80, 'mL');

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, description)
    VALUES (cfl, 'Daily positive and negative controls (USP <61>/<62>)', 'Control', 'None', 'Daily', 'Weekly',
            'Each working day: one positive control per organism in use on its medium, and the negative control (diluent, no growth).')
    RETURNING id INTO lb_ctl;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_ctl);
    PERFORM pg_temp.fld27(v, 'organism', 'Organism', 'Choice', 10, ch => '{S. aureus ATCC 6538,E. coli ATCC 8739,P. aeruginosa ATCC 9027,C. albicans ATCC 10231,A. brasiliensis ATCC 16404,B. subtilis ATCC 6633,S. Typhimurium ATCC 14028}');
    PERFORM pg_temp.fld27(v, 'medium_lot', 'Medium', 'Lot', 20, req => false);
    PERFORM pg_temp.fld27(v, 'positive_growth', 'Positive control: typical growth', 'Pass/Fail', 30);
    PERFORM pg_temp.fld27(v, 'positive_count', 'Positive control count', 'Number', 40, 'CFU', req => false);
    PERFORM pg_temp.fld27(v, 'negative_ok', 'Negative control: no growth', 'Pass/Fail', 50);
    PERFORM pg_temp.fld27(v, 'incubator', 'Incubator', 'Equipment', 60, req => false);

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, review_route, description)
    VALUES (cfl, 'Sample weights (pre-analytical)', 'Sample weights', 'Sample', 'As needed', 'Weekly', 'Batch',
            'Intake weighs test aliquots and labels each with its entry code (the aliquot''s barcode). Scanning it at a test''s Weigh step fills in the weight and the balance. Reviewed in the batch that uses it, by someone who did not weigh it.')
    RETURNING id INTO lb_w;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_w);
    PERFORM pg_temp.fld27(v, 'balance', 'Balance', 'Equipment', 10, hlp => 'In calibration and available');
    PERFORM pg_temp.fld27(v, 'weight', 'Weight', 'Number', 20, 'g');
    PERFORM pg_temp.fld27(v, 'container', 'Container', 'Text', 30, req => false);

    PERFORM pg_temp.as_user('qa.reviewer');
    PERFORM approve_logbook_version(id) FROM logbook_version WHERE logbook_id IN (lb_cul, lb_ch, lb_51, lb_ctl, lb_w);

    ---------------------------------------------------------------- entries
    PERFORM pg_temp.as_user('analyst');
    FOR cul IN SELECT l.id, l.item_name, substring(l.item_name FROM 'ATCC [0-9]+') AS atcc, row_number() OVER (ORDER BY l.item_name) AS k FROM inventory_lot l
                WHERE l.site_id = cfl AND l.status = 'Available' AND 'Microbiological Strain' = ANY (l.chemical_types) AND l.item_name ~ 'ATCC [0-9]+$'
                  AND l.item_name IN ('Staphylococcus aureus ATCC 6538', 'Escherichia coli ATCC 8739', 'Pseudomonas aeruginosa ATCC 9027', 'Bacillus subtilis ATCC 6633',
                                      'Candida albicans ATCC 10231', 'Aspergillus brasiliensis ATCC 16404') LOOP
        INSERT INTO logbook_entry (logbook_id, lot_id, entry_at, entry_values) VALUES
         (lb_cul, cul.id, clock_timestamp() - interval '5 days', jsonb_strip_nulls(jsonb_build_object('reference', cul.atcc, 'passage', 1 + cul.k % 3, 'purity', 'Pass', 'medium_lot', tsa)));
    END LOOP;
    PERFORM pg_temp.as_user('qa.reviewer');
    PERFORM approve_logbook_entries(ARRAY(SELECT id FROM logbook_entry WHERE logbook_id = lb_cul), 'Working cultures checked');
    PERFORM pg_temp.as_user('analyst');
    INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (lb_ch, clock_timestamp() - interval '90 minutes',
        jsonb_build_object('culture_lot', sa, 'volume_plated', 0.1, 'count_1', 48, 'count_2', 54, 'inoculum_ml', 0.1, 'volume_made', 10)) RETURNING id INTO e_sa;
    -- the other four USP <61> organisms (approved with S. aureus below)
    FOR cul IN SELECT l.id, row_number() OVER (ORDER BY l.item_name) AS k FROM inventory_lot l WHERE l.site_id = cfl AND l.status = 'Available'
                  AND l.item_name IN ('Pseudomonas aeruginosa ATCC 9027', 'Bacillus subtilis ATCC 6633', 'Candida albicans ATCC 10231', 'Aspergillus brasiliensis ATCC 16404') LOOP
        INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (lb_ch, clock_timestamp() - interval '88 minutes',
            jsonb_build_object('culture_lot', cul.id, 'volume_plated', 0.1, 'count_1', 34 + cul.k * 3, 'count_2', 38 + cul.k * 2, 'inoculum_ml', 0.1, 'volume_made', 10));
    END LOOP;
    INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (lb_ch, clock_timestamp() - interval '80 minutes',
        jsonb_build_object('culture_lot', ec, 'volume_plated', 0.1, 'count_1', 62, 'count_2', 58, 'inoculum_ml', 0.1, 'volume_made', 10)) RETURNING id INTO e_ec;
    INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (lb_51, clock_timestamp() - interval '70 minutes',
        jsonb_build_object('culture_lot', sa, 'dilution', 0.000001, 'volume_plated', 1, 'count_1', 105, 'count_2', 95, 'volume_made', 20)) RETURNING id INTO e_51;
    -- the other USP <51> organisms (approved with S. aureus below), so the test's every organism has its inoculum
    FOR cul IN SELECT l.id, row_number() OVER (ORDER BY l.item_name) AS k FROM inventory_lot l WHERE l.site_id = cfl AND l.status = 'Available'
                  AND l.item_name IN ('Escherichia coli ATCC 8739', 'Pseudomonas aeruginosa ATCC 9027', 'Candida albicans ATCC 10231', 'Aspergillus brasiliensis ATCC 16404') LOOP
        INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (lb_51, clock_timestamp() - interval '68 minutes',
            jsonb_build_object('culture_lot', cul.id, 'dilution', 0.000001, 'volume_plated', 1, 'count_1', 80 + cul.k * 12, 'count_2', 90 + cul.k * 9, 'volume_made', 20));
    END LOOP;
    FOR d IN REVERSE 3..1 LOOP
        INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES
         (lb_ctl, ((site_today(cfl) - d) + time '09:15') AT TIME ZONE tz, jsonb_strip_nulls(jsonb_build_object('organism', 'S. aureus ATCC 6538', 'medium_lot', tsa, 'positive_growth', 'Pass', 'positive_count', 41 + d, 'negative_ok', 'Pass', 'incubator', inc))),
         (lb_ctl, ((site_today(cfl) - d) + time '09:20') AT TIME ZONE tz, jsonb_strip_nulls(jsonb_build_object('organism', 'E. coli ATCC 8739', 'medium_lot', tsa, 'positive_growth', 'Pass', 'positive_count', 52 - d, 'negative_ok', 'Pass', 'incubator', inc)));
    END LOOP;
    PERFORM pg_temp.as_user('qa.reviewer');
    PERFORM approve_logbook_entries(ARRAY(SELECT id FROM logbook_entry WHERE (logbook_id = lb_ch AND id <> e_ec) OR logbook_id = lb_51), 'Inocula counted and labelled as required');
    IF s3 IS NOT NULL AND s4 IS NOT NULL AND EXISTS (SELECT 1 FROM app_user WHERE username = 'intake') THEN
        PERFORM pg_temp.as_user('intake');
        INSERT INTO logbook_entry (logbook_id, sample_id, entry_at, entry_values) VALUES
         (lb_w, s3, clock_timestamp() - interval '3 hours', jsonb_build_object('balance', top, 'weight', 10.04, 'container', 'Sterile bag 1')),
         (lb_w, s4, clock_timestamp() - interval '3 hours' + interval '4 minutes', jsonb_build_object('balance', top, 'weight', 10.07, 'container', 'Sterile bag 2'));
    END IF;

    ---------------------------------------------------------------- version 2 of USP <61> suitability and USP <51>, left as Drafts (CFL requires a verification)
    PERFORM pg_temp.as_user('analyst');
    SELECT id INTO t FROM test WHERE site_id = cfl AND test_name = 'USP <61> Method Suitability (TAMC/TYMC)';
    IF t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version WHERE test_id = t AND status = 'Draft') THEN
        tv := new_test_version(t);
        UPDATE test_version SET change_summary = 'The inoculum count comes from the challenge inoculum logbook: scan each organism''s inoculum lot at Inoculate ({inoc.cfu_added})' WHERE id = tv;
        UPDATE workflow_step SET config = jsonb_build_object('procedure_ref', 'Not more than 100 CFU of each organism: scan each organism''s challenge inoculum lot (LB, USP <61>/<62> challenge inoculum)', 'fields', '[]'::jsonb)
         WHERE test_version_id = tv AND step_key = 'inoc';
        UPDATE workflow_step SET config = config || jsonb_build_object('formula', '{count_b.reading} / {inoc.cfu_added} * 100',
               'overrides', jsonb_build_array(jsonb_build_object('analyte_id', (SELECT id FROM analyte WHERE analyte_name = 'Candida albicans'), 'formula', '{count_f.reading} / {inoc.cfu_added} * 100'),
                                              jsonb_build_object('analyte_id', (SELECT id FROM analyte WHERE analyte_name = 'Aspergillus brasiliensis'), 'formula', '{count_f.reading} / {inoc.cfu_added} * 100')),
               'note', 'CFU recovered / CFU added (from the scanned challenge inoculum''s logbook entry) x 100')
         WHERE test_version_id = tv AND step_key = 'calc';
    END IF;
    SELECT id INTO t FROM test WHERE site_id = cfl AND test_name = 'USP <51> Antimicrobial Effectiveness (Category 2)';
    IF t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version WHERE test_id = t AND status = 'Draft') THEN
        tv := new_test_version(t);
        UPDATE test_version SET change_summary = 'The initial count is calculated from the scanned USP <51> inoculum (logbook): CFU/mL x volume added / product amount' WHERE id = tv;
        UPDATE workflow_step SET config = config || jsonb_build_object('procedure_ref', '1e5 to 1e6 CFU/mL, inoculum not more than 1% of the product volume; scan each organism''s USP <51> inoculum lot')
         WHERE test_version_id = tv AND step_key = 'inoc';
        UPDATE workflow_step SET step_name = 'Initial: calculated count (from the inoculum)',
               config = config || jsonb_build_object('formula', 'log10({inoc.cfu_per_ml} * {inoc.inoculum_volume_ml} / {weigh.weight})', 'note', 'log10(inoculum CFU/mL x volume added / product amount)')
         WHERE test_version_id = tv AND step_key = 'calc_0';
    END IF;
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
END $$;

COMMIT;
