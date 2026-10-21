-- Sandbox demo data for migration 029 (standalone quotes):
--  - three tests in the TPS (St. Petersburg) catalogue, priced, so a quote can mix labs (their workflows are Drafts:
--    they can be quoted, and ordered once a workflow is approved at TPS);
--  - four quotes prepared by the demo Account Manager and one by Alex: Draft, Quoted (waiting for the client), Accepted,
--    Rejected (with the reason).
-- Skipped whole if the demo records were changed, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE tps uuid := (SELECT id FROM lab_site WHERE site_code = 'TPS'); am uuid := (SELECT id FROM app_user WHERE username = 'acctmgr');
        ak uuid := (SELECT id FROM app_user WHERE username = 'akiddle');
        acme uuid := (SELECT id FROM client WHERE legal_name = 'Acme Nutrition Irvine Site'); beta uuid := (SELECT id FROM client WHERE legal_name = 'Beta Foods LLC');
        delta uuid := (SELECT id FROM client WHERE legal_name = 'Delta Pharmaceuticals Inc');
        t_assay uuid; t_diss uuid; t_rs uuid; p uuid; v uuid; dept uuid;
        tid uuid; n text;
BEGIN
    IF tps IS NULL OR am IS NULL OR acme IS NULL OR beta IS NULL OR delta IS NULL OR EXISTS (SELECT 1 FROM project WHERE kind = 'Quote')
       OR EXISTS (SELECT 1 FROM test WHERE test_name IN ('Assay by HPLC (TPS)', 'Dissolution, USP <711> (TPS)', 'Residual Solvents, USP <467> (TPS)')) THEN RETURN; END IF;
    SELECT id INTO dept FROM department WHERE site_id = tps AND department_code = 'CHEM';
    -- TPS catalogue
    t_assay := create_test(tps, 'Assay by HPLC (TPS)', dept);
    t_diss  := create_test(tps, 'Dissolution, USP <711> (TPS)', dept);
    t_rs    := create_test(tps, 'Residual Solvents, USP <467> (TPS)', dept);
    UPDATE test_catalog_entry SET base_price = 425, standard_tat = 10, description = 'Assay of the active ingredient by HPLC against a reference standard' WHERE test_id = t_assay;
    UPDATE test_catalog_entry SET base_price = 650, standard_tat = 10, description = 'Dissolution testing, 6 units, apparatus 1 or 2' WHERE test_id = t_diss;
    UPDATE test_catalog_entry SET base_price = 540, standard_tat = 15, description = 'Class 1, 2 and 3 residual solvents by headspace GC' WHERE test_id = t_rs;

    -- Q-00001: Acme, mixed labs, issued and waiting for the client (prepared by the Account Manager)
    INSERT INTO project (client_id, project_name, kind, owner_id, quote_contact_id)
    VALUES (acme, 'Collagen peptide powder, 3 lots', 'Quote', am, (SELECT id FROM contact WHERE email = 'sam.nguyen@example-acme.com')) RETURNING id INTO p;
    v := new_project_version(p);
    FOR tid, n IN SELECT t.id, t.test_name FROM test t WHERE t.test_name IN ('Heavy Metals (Pb, Cd, As, Hg) by ICP-MS', 'Yeast and Mold', 'Assay by HPLC (TPS)') LOOP
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v, tid, 3);
    END LOOP;
    UPDATE quoted_test_configuration SET final_price = round(list_price * 0.9, 2) WHERE project_version_id = v;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = v;
    UPDATE project_version SET quoted_by = (SELECT owner_id FROM project WHERE id = p) WHERE id = v;

    -- Q-00002: Beta Foods, a Draft being built
    INSERT INTO project (client_id, project_name, kind, owner_id, quote_contact_id)
    VALUES (beta, 'Salsa verde shelf-life, micro panel', 'Quote', am, (SELECT id FROM contact WHERE email = 'jordan.reyes@example-beta.com')) RETURNING id INTO p;
    v := new_project_version(p);
    FOR tid IN SELECT t.id FROM test t WHERE t.test_name IN ('Total Aerobic Plate Count', 'Yeast and Mold', 'pH', 'Water Activity') LOOP
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v, tid, 6);
    END LOOP;

    -- Q-00003: Delta, TPS release testing, accepted by the client
    INSERT INTO project (client_id, project_name, kind, owner_id, quote_contact_id)
    VALUES (delta, 'Metformin 500 mg tablets, release testing', 'Quote', am, (SELECT id FROM contact WHERE email = 'priya.shah@example-delta.com')) RETURNING id INTO p;
    v := new_project_version(p);
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price) VALUES (v, t_assay, 2, 400), (v, t_diss, 2, 600), (v, t_rs, 2, 540);
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = v;
    UPDATE project_version SET quoted_by = (SELECT owner_id FROM project WHERE id = p) WHERE id = v;
    UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'priya.shah@example-delta.com'),
           client_response_note = 'PO 88213 received' WHERE id = v;

    -- Q-00004: Beta Foods, rejected (price), prepared by Alex
    INSERT INTO project (client_id, project_name, kind, owner_id, quote_contact_id)
    VALUES (beta, 'Allergen screen, one-off', 'Quote', ak, (SELECT id FROM contact WHERE email = 'jordan.reyes@example-beta.com')) RETURNING id INTO p;
    v := new_project_version(p);
    FOR tid IN SELECT t.id FROM test t WHERE t.test_name IN ('Salmonella (Presence/Absence)', 'Moisture') LOOP
        INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (v, tid, 1);
    END LOOP;
    UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = v;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = v;
    UPDATE project_version SET quoted_by = (SELECT owner_id FROM project WHERE id = p) WHERE id = v;
    UPDATE project_version SET status = 'Rejected', rejected_reason = 'Price: went with a local lab' WHERE id = v;
EXCEPTION WHEN others THEN
    RAISE NOTICE 'Quote demo data skipped: %', SQLERRM;
END $$;

COMMIT;
