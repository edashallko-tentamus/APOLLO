-- Sandbox demo data for migration 034 (L-1 electronic logbooks), at CFL. Designed by the demo Lab Supervisor, the
-- designs approved by the demo QA Reviewer, entries recorded and signed by the demo Analyst:
--  - LB-0001 Daily balance check: Analytical balance 1 (error at most 0.05 %) and Top-loading balance 1 (0.1 %), the
--    last six days, all passing.
--  - LB-0002 Monthly pipette check (gravimetric): P1000 #1 and P200 #2 passed; P10 #3 failed 12 days ago (it delivers
--    low; sent for service, with its calibration expired it is tagged out anyway).
--  - LB-0003 Temperature log: the reagent refrigerator (2 to 8 °C), the 35 °C incubator (30 to 35 °C) and the four CFL
--    stability chambers (limits from their conditions), the last six days. The refrigerator was at 9.4 °C three days
--    ago (door left open) and Stability chamber 1 at 28.1 °C two days ago (an HVAC fault): the chamber excursion lists
--    STB-00001, whose material is in that chamber. Both recovered by the next reading.
--  - QA approved the entries made before this week; this week's wait in Logbook review.
-- Nothing fails on equipment the demo batches use, so no demo batch is flagged. Skipped whole if CFL has a logbook.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);

CREATE OR REPLACE FUNCTION pg_temp.as_user(p text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = p), true);
    PERFORM script_signature('Sandbox demo data');
END $$;
-- a field of a Draft version
CREATE OR REPLACE FUNCTION pg_temp.fld(v uuid, k text, lbl text, typ text, ord integer, unit text DEFAULT NULL, lo numeric DEFAULT NULL, hi numeric DEFAULT NULL,
                                       eqlim boolean DEFAULT false, req boolean DEFAULT true, f text DEFAULT NULL, ch text[] DEFAULT NULL, pub boolean DEFAULT false)
RETURNS void LANGUAGE sql AS $$
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, limit_min, limit_max, equipment_limits, required, formula, choices, publish)
    VALUES (v, k, lbl, typ, ord, unit, lo, hi, eqlim, req, f, ch, pub)
$$;
-- an entry at a local date and time (never in the future)
CREATE OR REPLACE FUNCTION pg_temp.ent(lb uuid, eq uuid, days_ago integer, at_time time, vals jsonb, reason text DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE tz text := (SELECT s.time_zone FROM logbook l JOIN lab_site s ON s.id = l.site_id WHERE l.id = lb); site uuid := (SELECT site_id FROM logbook WHERE id = lb); v uuid;
BEGIN
    INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, entry_values, failure_reason)
    VALUES (lb, eq, LEAST(((site_today(site) - days_ago) + at_time) AT TIME ZONE tz, clock_timestamp() - interval '2 minutes'), vals, reason)
    RETURNING id INTO v;
    RETURN v;
END $$;

-- canned reasons for logbook corrections, voids and design changes (kept by QA in Admin > Canned reasons)
INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Logbooks', x.r, x.n FROM (VALUES ('Typing error corrected', 10), ('Wrong equipment, lot or sample chosen', 20), ('Reading taken again', 30),
       ('Returned by QA: corrected as asked', 40), ('Recorded in the wrong logbook', 50), ('Design changed before approval', 60)) AS x(r, n)
 WHERE NOT EXISTS (SELECT 1 FROM reason_code WHERE module = 'Logbooks');

DO $$
DECLARE cfl uuid := (SELECT id FROM lab_site WHERE site_code = 'CFL');
        bal uuid; top uuid; lb_bal uuid; lb_pip uuid; lb_tmp uuid; v uuid; d integer; e record; eq uuid; t numeric; rh numeric;
        p1 uuid; p2 uuid; p3 uuid; fridge uuid; inc uuid; monday date;
BEGIN
    IF cfl IS NULL OR EXISTS (SELECT 1 FROM logbook WHERE site_id = cfl)
       OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'labsup') OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'qa.reviewer')
       OR NOT EXISTS (SELECT 1 FROM app_user WHERE username = 'analyst') THEN
        RAISE NOTICE 'seed_027: skipped (CFL already has logbooks, or the demo people are missing)';
        RETURN;
    END IF;
    SELECT id INTO bal FROM equipment WHERE site_id = cfl AND equipment_name = 'Analytical balance 1';
    SELECT id INTO top FROM equipment WHERE site_id = cfl AND equipment_name = 'Top-loading balance 1';
    SELECT id INTO p1 FROM equipment WHERE site_id = cfl AND equipment_name = 'Pipette P1000 #1';
    SELECT id INTO p2 FROM equipment WHERE site_id = cfl AND equipment_name = 'Pipette P200 #2';
    SELECT id INTO p3 FROM equipment WHERE site_id = cfl AND equipment_name = 'Pipette P10 #3';
    SELECT id INTO fridge FROM equipment WHERE site_id = cfl AND equipment_name = 'Reagent refrigerator 1';
    SELECT id INTO inc FROM equipment WHERE site_id = cfl AND equipment_name = 'Incubator 35 °C';

    ---------------------------------------------------------------- the designs (Lab Supervisor), approved by QA
    PERFORM pg_temp.as_user('labsup');
    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, description)
    VALUES (cfl, 'Daily balance check', 'Equipment check', 'Equipment', 'Daily', 'Weekly',
            'Each balance in use is checked every working day with its check weight before weighing. Error = |reading - nominal| / nominal.')
    RETURNING id INTO lb_bal;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_bal);
    PERFORM pg_temp.fld(v, 'check_weight', 'Check weight ID', 'Text', 10);
    PERFORM pg_temp.fld(v, 'nominal_g', 'Nominal', 'Number', 20, 'g');
    PERFORM pg_temp.fld(v, 'reading_g', 'Reading', 'Number', 30, 'g');
    PERFORM pg_temp.fld(v, 'error_pct', 'Error', 'Calculated', 40, '%', NULL, 0.1, true, true, 'abs({reading_g} - {nominal_g}) / {nominal_g} * 100');
    IF bal IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_bal, bal, '{"error_pct": {"max": 0.05}}'); END IF;
    IF top IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id) VALUES (lb_bal, top); END IF;

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, description)
    VALUES (cfl, 'Monthly pipette check (gravimetric)', 'Equipment check', 'Equipment', 'Monthly', 'Weekly',
            'Three weighings of water at the set volume; volume = mass x Z (1.0032 µL/mg at about 21.5 °C). Limits per pipette (ISO 8655 for its size).')
    RETURNING id INTO lb_pip;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_pip);
    PERFORM pg_temp.fld(v, 'set_volume_ul', 'Volume set', 'Number', 10, 'µL');
    PERFORM pg_temp.fld(v, 'w1', 'Weighing 1', 'Number', 20, 'mg');
    PERFORM pg_temp.fld(v, 'w2', 'Weighing 2', 'Number', 30, 'mg');
    PERFORM pg_temp.fld(v, 'w3', 'Weighing 3', 'Number', 40, 'mg');
    PERFORM pg_temp.fld(v, 'mean_mg', 'Mean mass', 'Calculated', 50, 'mg', f => '({w1} + {w2} + {w3}) / 3');
    PERFORM pg_temp.fld(v, 'mean_ul', 'Mean volume', 'Calculated', 60, 'µL', f => '{mean_mg} * 1.0032');
    PERFORM pg_temp.fld(v, 'accuracy_pct', 'Accuracy', 'Calculated', 70, '%', -1, 1, true, true, '({mean_ul} - {set_volume_ul}) / {set_volume_ul} * 100');
    PERFORM pg_temp.fld(v, 'cv_pct', 'Precision (CV)', 'Calculated', 80, '%', NULL, 0.5, true, true,
                        'sqrt((({w1} - {mean_mg}) ^ 2 + ({w2} - {mean_mg}) ^ 2 + ({w3} - {mean_mg}) ^ 2) / 2) / {mean_mg} * 100');
    IF p1 IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_pip, p1, '{"accuracy_pct": {"min": -0.8, "max": 0.8}, "cv_pct": {"max": 0.3}}'); END IF;
    IF p2 IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_pip, p2, '{"accuracy_pct": {"min": -0.8, "max": 0.8}, "cv_pct": {"max": 0.3}}'); END IF;
    IF p3 IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_pip, p3, '{"accuracy_pct": {"min": -1.2, "max": 1.2}, "cv_pct": {"max": 0.8}}'); END IF;

    INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, description)
    VALUES (cfl, 'Temperature log', 'Temperature', 'Equipment', 'Daily', 'Weekly',
            'Read and recorded every working day (by hand: no probes yet). Limits per unit; a stability chamber''s come from its condition.')
    RETURNING id INTO lb_tmp;
    v := (SELECT id FROM logbook_version WHERE logbook_id = lb_tmp);
    PERFORM pg_temp.fld(v, 'temperature', 'Temperature', 'Number', 10, '°C', NULL, NULL, true);
    PERFORM pg_temp.fld(v, 'humidity', 'Humidity', 'Number', 20, '% RH', NULL, NULL, true, false);
    PERFORM pg_temp.fld(v, 'thermometer', 'Thermometer or display', 'Text', 30, req => false);
    IF fridge IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_tmp, fridge, '{"temperature": {"min": 2, "max": 8}}'); END IF;
    IF inc IS NOT NULL THEN INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (lb_tmp, inc, '{"temperature": {"min": 30, "max": 35}}'); END IF;
    INSERT INTO logbook_equipment (logbook_id, equipment_id)
    SELECT lb_tmp, ch.equipment_id FROM stability_chamber ch JOIN equipment q ON q.id = ch.equipment_id
     WHERE ch.site_id = cfl AND ch.status = 'Active' AND q.admin_status <> 'Retired' ORDER BY q.equipment_name;

    PERFORM pg_temp.as_user('qa.reviewer');
    PERFORM approve_logbook_version(id) FROM logbook_version WHERE logbook_id IN (lb_bal, lb_pip, lb_tmp);

    ---------------------------------------------------------------- entries (the demo Analyst)
    PERFORM pg_temp.as_user('analyst');
    FOR d IN REVERSE 6..0 LOOP
        IF bal IS NOT NULL THEN
            PERFORM pg_temp.ent(lb_bal, bal, d, '08:10', jsonb_build_object('check_weight', 'CW-100-01', 'nominal_g', 100, 'reading_g', 100.0000 + (d % 3 - 1) * 0.0012));
        END IF;
        IF top IS NOT NULL THEN
            PERFORM pg_temp.ent(lb_bal, top, d, '08:14', jsonb_build_object('check_weight', 'CW-200-02', 'nominal_g', 200, 'reading_g', 200.00 + (d % 2) * 0.02));
        END IF;
        FOR e IN SELECT le.equipment_id, x.equipment_name, sc.temperature_c, sc.humidity_pct FROM logbook_equipment le JOIN equipment x ON x.id = le.equipment_id
                  LEFT JOIN stability_chamber ch ON ch.equipment_id = x.id AND ch.status = 'Active' LEFT JOIN stability_condition sc ON sc.id = ch.condition_id
                 WHERE le.logbook_id = lb_tmp ORDER BY x.equipment_name LOOP
            t := CASE WHEN e.equipment_id = fridge THEN 4.6 + (d % 3) * 0.3 WHEN e.equipment_id = inc THEN 32.4 + (d % 2) * 0.3
                      ELSE e.temperature_c + ((d % 3) - 1) * 0.4 END;
            rh := CASE WHEN e.humidity_pct IS NOT NULL THEN e.humidity_pct + ((d % 2) * 2 - 1) END;
            PERFORM pg_temp.ent(lb_tmp, e.equipment_id, d, '08:30', jsonb_strip_nulls(jsonb_build_object('temperature', t, 'humidity', rh, 'thermometer', 'Display')));
            -- the excursions: the refrigerator three days ago, Stability chamber 1 two days ago (each back in range by the next reading)
            IF d = 3 AND e.equipment_id = fridge THEN
                PERFORM pg_temp.ent(lb_tmp, fridge, d, '14:05', '{"temperature": 9.4, "thermometer": "Min/max thermometer TH-07"}',
                    'Door left ajar during a delivery; closed at 14:05, 8.1 °C at 14:35. Contents (reagents only) assessed by the Lab Supervisor: no impact.');
            ELSIF d = 2 AND e.equipment_name LIKE 'Stability chamber 1 %' THEN
                PERFORM pg_temp.ent(lb_tmp, e.equipment_id, d, '15:20', jsonb_build_object('temperature', 28.1, 'humidity', 58, 'thermometer', 'Display'),
                    'HVAC fault in the stability room from about 13:00; facilities reset it at 15:30 and the chamber was back at 25.3 °C by 17:00. Stored studies to be assessed (excursion).');
            END IF;
        END LOOP;
    END LOOP;
    IF p1 IS NOT NULL THEN PERFORM pg_temp.ent(lb_pip, p1, 20, '10:00', '{"set_volume_ul": 1000, "w1": 997.1, "w2": 996.4, "w3": 997.8}'); END IF;
    IF p2 IS NOT NULL THEN PERFORM pg_temp.ent(lb_pip, p2, 20, '10:20', '{"set_volume_ul": 200, "w1": 199.2, "w2": 199.6, "w3": 199.1}'); END IF;
    IF p3 IS NOT NULL THEN
        PERFORM pg_temp.ent(lb_pip, p3, 12, '10:40', '{"set_volume_ul": 10, "w1": 9.62, "w2": 9.66, "w3": 9.59}',
            'Delivers about 3.5 % low. Taken out of use and sent to Precision Pipette Services; its calibration has expired as well, so it is tagged out.');
    END IF;

    ---------------------------------------------------------------- QA approved last week's entries; this week's wait in Logbook review
    PERFORM pg_temp.as_user('qa.reviewer');
    monday := date_trunc('week', site_today(cfl)::timestamp)::date;
    PERFORM approve_logbook_entries(ARRAY(SELECT x.id FROM logbook_entry x JOIN lab_site s ON s.id = x.site_id
                                           WHERE x.logbook_id IN (lb_bal, lb_pip, lb_tmp) AND (x.entry_at AT TIME ZONE s.time_zone)::date < monday),
                                    'Weekly review of the logbooks')
     WHERE EXISTS (SELECT 1 FROM logbook_entry x JOIN lab_site s ON s.id = x.site_id WHERE x.logbook_id IN (lb_bal, lb_pip, lb_tmp) AND (x.entry_at AT TIME ZONE s.time_zone)::date < monday);
    PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
END $$;

COMMIT;
