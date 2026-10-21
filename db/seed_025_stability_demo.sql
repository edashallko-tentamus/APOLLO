-- Sandbox demo data for migration 032 (stability studies):
--  - stability chambers at CFL (25 °C / 60% RH, 30 °C / 65% RH, 40 °C / 75% RH and a 5 °C refrigerator) and TPS
--    (25 °C / 60% RH, 40 °C / 75% RH), each with racks A to C of 24 positions;
--  - SQ-00001 (Beta Foods, protein bars): a Draft, half designed;
--  - SQ-00002 (Acme Irvine, fish oil softgels, 3% yearly escalation): accepted, study STB-00001 placed in the chambers
--    about three months ago; the 1-month pulls taken, the 3-month pulls ordered and waiting to be taken;
--  - SQ-00003 (Delta Pharmaceuticals, vitamin D3 gummies): accepted, study STB-00002 awaiting its material, with
--    its T0 order on the intake dashboard; its heavy metals test is CFL's designed ICP-MS test, so once placed its
--    T0 and pulls can be run at the bench and fill the summary report.
-- It skips itself whole if any stability quote already exists, so it never stops the app from starting.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL'); tps uuid := (SELECT id FROM lab_site WHERE site_code = 'TPS');
        r record; v_eq uuid; v_ch uuid; v_p uuid; v_v uuid; k text; tp record; v_study uuid; v_pl date; pl record; v_rows jsonb;
        c2560 uuid; c3065 uuid; c4075 uuid; c5 uuid;
BEGIN
    IF cfl IS NULL OR tps IS NULL OR EXISTS (SELECT 1 FROM project WHERE kind = 'Stability') OR EXISTS (SELECT 1 FROM stability_chamber)
       OR NOT EXISTS (SELECT 1 FROM test WHERE test_code = 'T-00002') THEN RETURN; END IF;
    SELECT id INTO c2560 FROM stability_condition WHERE condition_name = '25 °C / 60% RH' AND site_id IS NULL;
    SELECT id INTO c3065 FROM stability_condition WHERE condition_name = '30 °C / 65% RH' AND site_id IS NULL;
    SELECT id INTO c4075 FROM stability_condition WHERE condition_name = '40 °C / 75% RH' AND site_id IS NULL;
    SELECT id INTO c5 FROM stability_condition WHERE condition_name = '5 °C' AND site_id IS NULL;

    -- chambers (equipment of type "Stability chamber"), each with racks A to C
    FOR r IN SELECT * FROM (VALUES
        ('CFL', 'Stability chamber 1 (25 °C / 60% RH)', 'Caron', '6030-1', 'CA-6030-1172', c2560),
        ('CFL', 'Stability chamber 2 (30 °C / 65% RH)', 'Caron', '6030-1', 'CA-6030-1173', c3065),
        ('CFL', 'Stability chamber 3 (40 °C / 75% RH)', 'Caron', '6030-1', 'CA-6030-1174', c4075),
        ('CFL', 'Stability refrigerator (5 °C)', 'Thermo Scientific', 'TSX505', 'TSX-1180-91', c5),
        ('TPS', 'Stability chamber T1 (25 °C / 60% RH)', 'Binder', 'KBF 720', 'BI-KBF-20871', c2560),
        ('TPS', 'Stability chamber T2 (40 °C / 75% RH)', 'Binder', 'KBF 720', 'BI-KBF-20872', c4075)) AS x(site, name, mfr, model, serial, cond) LOOP
        INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, calibration_required,
                               calibration_interval_months, qualification_required, in_service_date)
        SELECT s.id, r.name, t.id, d.id, r.mfr, r.model, r.serial, false, NULL, false, CURRENT_DATE - 500
          FROM lab_site s JOIN equipment_type t ON t.site_id = s.id AND t.type_name = 'Stability chamber'
          JOIN department d ON d.site_id = s.id AND d.department_code = 'GEN' WHERE s.site_code = r.site
        RETURNING id INTO v_eq;
        IF v_eq IS NULL THEN CONTINUE; END IF;
        INSERT INTO equipment_owner (equipment_id, group_id) SELECT v_eq, g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id
         WHERE s.site_code = r.site AND g.group_name = 'Lab Supervisor';
        INSERT INTO stability_chamber (equipment_id, condition_id) VALUES (v_eq, r.cond) RETURNING id INTO v_ch;
        INSERT INTO stability_rack (chamber_id, rack_code, description, positions)
        SELECT v_ch, k2, 'Shelf rack ' || k2, 24 FROM unnest(ARRAY['A','B','C']) k2;
    END LOOP;

    -- three stability quotes; each design: lab, product, conditions, timepoints (window from the lab: 7 days), tests, matrix
    FOR r IN SELECT * FROM (VALUES
        (1, 'Beta Foods LLC', 'Protein bar shelf life (12 months)', 'Chocolate protein bar', 'PB-2611', 'bars', 0::numeric, ARRAY['25 °C / 60% RH'], ARRAY['T-00002','T-00003']),
        (2, 'Acme Nutrition Irvine Site', 'Fish oil softgels, ICH real time and accelerated', 'Omega-3 fish oil softgels 1000 mg', 'FO-2607', 'bottles', 3::numeric, ARRAY['25 °C / 60% RH','40 °C / 75% RH'], ARRAY['T-00002','T-00004','T-00005','T-00001']),
        (3, 'Delta Pharmaceuticals Inc', 'Vitamin D3 gummies, 24 months', 'Vitamin D3 gummies 2000 IU', 'VD-2610', 'jars', 2::numeric, ARRAY['25 °C / 60% RH','30 °C / 65% RH','40 °C / 75% RH'], ARRAY['T-00002','T-00003','T-00004','T-00008'])
      ) AS x(n, client, ref, product, lot, units, esc, conds, tests) ORDER BY n LOOP
        INSERT INTO project (client_id, project_name, kind, quote_contact_id, site_id)
        SELECT c.id, r.ref, 'Stability', (SELECT cc.contact_id FROM client_contact cc WHERE cc.client_id = c.id AND 'PRIMARY' = ANY(cc.roles) LIMIT 1), cfl
          FROM client c WHERE c.legal_name = r.client RETURNING id INTO v_p;
        v_v := new_project_version(v_p);
        INSERT INTO stability_plan (project_version_id, site_id, product, lot, unit_name, escalation_pct, planned_placement, protocol_ref)
        VALUES (v_v, cfl, r.product, r.lot, r.units, r.esc, CASE WHEN r.n = 1 THEN CURRENT_DATE + 21 END, CASE WHEN r.n > 1 THEN 'Client protocol STP-' || (100 + r.n) END);
        INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
        SELECT v_v, sc.id, i FROM unnest(r.conds) WITH ORDINALITY u(cn, i) JOIN stability_condition sc ON sc.condition_name = u.cn AND sc.site_id IS NULL;
        INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late)
        SELECT v_v, lbl, iv, 'Months', CASE WHEN iv = 0 THEN 0 ELSE 7 END, CASE WHEN iv = 0 THEN 0 ELSE 7 END
          FROM (VALUES ('T0', 0), ('1 M', 1), ('3 M', 3), ('6 M', 6), ('12 M', 12), ('24 M', 24)) AS t(lbl, iv)
         WHERE r.n <> 1 OR iv <= 12;
        INSERT INTO quoted_test_configuration (project_version_id, test_id) SELECT v_v, t.id FROM test t WHERE t.test_code = ANY(r.tests);
        UPDATE quoted_test_configuration SET final_price = round(list_price * 0.9, 2) WHERE project_version_id = v_v;   -- a 10% study discount
        IF r.n = 1 THEN CONTINUE; END IF;   -- SQ-00001 stays a Draft without its matrix
        -- the matrix: moisture and micro at every timepoint and condition; water activity at 3, 6, 12, 24 M; metals at T0 and 24 M (real time)
        FOR tp IN SELECT * FROM stability_timepoint WHERE project_version_id = v_v LOOP
            INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required)
            SELECT v_v, q.id, tp.id, vc.condition_id, CASE WHEN t.test_code IN ('T-00004','T-00005') THEN 2 ELSE 1 END
              FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              CROSS JOIN (SELECT condition_id, sort_order FROM stability_version_condition WHERE project_version_id = v_v
                          UNION ALL SELECT NULL, 0) vc
             WHERE q.project_version_id = v_v
               AND ((tp.interval_value = 0) = (vc.condition_id IS NULL))
               AND (vc.condition_id IS NULL OR vc.condition_id <> c4075 OR tp.interval_value <= 6)      -- accelerated runs to 6 months
               AND (t.test_code IN ('T-00002','T-00004','T-00005')
                    OR (t.test_code = 'T-00003' AND tp.interval_value IN (0, 3, 6, 12, 24))
                    OR (t.test_code IN ('T-00001','T-00008') AND (tp.interval_value IN (0, 12) OR (tp.interval_value = 24 AND vc.condition_id = c2560)) AND (vc.condition_id IS NULL OR vc.condition_id = c2560)));
        END LOOP;
        UPDATE project_version SET status = 'Quoted', valid_until = CURRENT_DATE + 30 WHERE id = v_v;
        UPDATE project_version SET quoted_at = now() - CASE WHEN r.n = 2 THEN interval '110 days' ELSE interval '12 days' END WHERE id = v_v;
        -- accepted: STB-00001 three months and a bit ago; STB-00002 last week
        UPDATE project_version SET status = 'Accepted', accepted_at = now() - CASE WHEN r.n = 2 THEN interval '100 days' ELSE interval '6 days' END,
               accepted_by_contact_id = (SELECT p.quote_contact_id FROM project p WHERE p.id = v_p), decided_via = 'Lab',
               client_response_note = CASE WHEN r.n = 2 THEN 'PO 88120' ELSE 'Signed protocol received' END
         WHERE id = v_v;
        IF r.n = 2 THEN
            SELECT id INTO v_study FROM stability_study WHERE project_id = v_p;
            v_pl := CURRENT_DATE - 95;
            SELECT jsonb_agg(jsonb_build_object('condition_id', vc.condition_id, 'rack_id', rk.id, 'position', CASE WHEN vc.sort_order = 1 THEN 'Shelf 2 / A1-A6' ELSE 'Shelf 1 / B1-B3' END,
                                                'units', CASE WHEN vc.sort_order = 1 THEN 60 ELSE 30 END))
              INTO v_rows FROM stability_version_condition vc JOIN stability_chamber ch ON ch.condition_id = vc.condition_id AND ch.site_id = cfl
              JOIN stability_rack rk ON rk.chamber_id = ch.id AND rk.rack_code = 'A' WHERE vc.project_version_id = v_v;
            PERFORM place_stability_study(v_study, v_pl, v_rows, 6);
            -- the 1-month pulls were taken on their day
            FOR pl IN SELECT p.id, p.scheduled_date, p.units_required FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id
                       WHERE p.study_id = v_study AND t.label = '1 M' LOOP
                PERFORM record_stability_pull(pl.id, (pl.scheduled_date::timestamp + interval '9 hours') AT TIME ZONE 'America/Los_Angeles', pl.units_required, '');
            END LOOP;
        END IF;
    END LOOP;
END $$;
COMMIT;
