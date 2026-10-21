-- Sandbox demo data for Equipment (migration 009): each lab's Departments and Equipment types, a CFL register with
-- instruments and small items in different states (calibration in date, due soon, expired; maintenance due soon and
-- overdue), and canned reasons for the Equipment module. Dates are relative to today so the demo stays current.
-- Expired calibrations and overdue maintenance are tagged out automatically by the server when it starts.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data', true);
SELECT script_signature('Sandbox demo data');

INSERT INTO reason_code (module, reason_text, sort_order)
SELECT 'Equipment', r, s FROM (VALUES ('Correcting an entry error', 10), ('Calibration certificate correction', 20), ('Instrument moved', 30),
    ('Change of responsibility', 40), ('Schedule changed (manufacturer''s recommendation)', 50), ('Taken out of service', 60), ('Returned to service', 70)) AS x(r, s)
WHERE NOT EXISTS (SELECT 1 FROM reason_code c WHERE c.module = 'Equipment' AND lower(c.reason_text) = lower(x.r));

-- Each lab's lists
INSERT INTO department (site_id, department_code, department_name)
SELECT s.id, d.c, d.n FROM lab_site s, (VALUES ('CHEM', 'Chemistry'), ('MICRO', 'Microbiology'), ('GEN', 'General lab')) AS d(c, n)
WHERE s.site_code IN ('CFL', 'TPS') ON CONFLICT DO NOTHING;
INSERT INTO equipment_type (site_id, type_name, description)
SELECT s.id, t.n, t.d FROM lab_site s, (VALUES ('HPLC', 'High performance liquid chromatograph'), ('ICP-MS', 'Inductively coupled plasma mass spectrometer'),
    ('HPTLC', 'High performance thin layer chromatography (CAMAG)'), ('Analytical balance', 'Balance, 0.1 mg or better'), ('Pipette', 'Single or multichannel pipette'),
    ('pH meter', NULL), ('Refrigerator', 'Reagent or sample refrigerator'), ('Incubator', NULL), ('Stability chamber', 'Controlled temperature and humidity'),
    ('Thermometer', 'Reference or working thermometer')) AS t(n, d)
WHERE s.site_code IN ('CFL', 'TPS') ON CONFLICT DO NOTHING;

-- CFL equipment
CREATE TEMP TABLE demo_eq (code_hint text, name text, type text, dept text, mfr text, model text, serial text, cal boolean, months integer, alert integer,
                           qual boolean, cal_ago integer, cal_left integer, owner_groups text[], vendor text) ON COMMIT DROP;
INSERT INTO demo_eq VALUES
 ('HPLC1',  'HPLC 1 (cannabinoids)', 'HPLC', 'CHEM', 'Agilent', '1260 Infinity II', 'DEAB912345', true, 12, 30, true, 200, 165, '{Lab Supervisor}', 'Agilent Technologies field service'),
 ('ICP1',   'ICP-MS 1 (heavy metals)', 'ICP-MS', 'CHEM', 'Agilent', '7900', 'JP15400211', true, 12, 30, true, 300, 65, '{Lab Supervisor}', 'Agilent Technologies field service'),
 ('HPTLC1', 'HPTLC system (botanical ID)', 'HPTLC', 'CHEM', 'CAMAG', 'HPTLC PRO', 'CH-2210-0457', true, 12, 30, true, 120, 245, '{HPTLC,Lab Supervisor}', 'CAMAG service'),
 ('BAL1',   'Analytical balance 1', 'Analytical balance', 'CHEM', 'Mettler Toledo', 'XPR205', 'B934110622', true, 6, 30, false, 170, 12, '{Lab Supervisor}', 'Mettler Toledo service'),
 ('PIP1',   'Pipette P1000 #1', 'Pipette', 'CHEM', 'Eppendorf', 'Research plus 100-1000 µL', 'L23816F', true, 6, 14, false, 100, 82, '{Analyst}', 'Precision Pipette Services'),
 ('PIP2',   'Pipette P200 #2', 'Pipette', 'CHEM', 'Eppendorf', 'Research plus 20-200 µL', 'L23817G', true, 6, 14, false, 120, 62, '{Analyst}', 'Precision Pipette Services'),
 ('PIP3',   'Pipette P10 #3', 'Pipette', 'MICRO', 'Eppendorf', 'Research plus 0.5-10 µL', 'K99102A', true, 6, 14, false, 190, -8, '{Analyst}', 'Precision Pipette Services'),
 ('FRIDGE1','Reagent refrigerator 1', 'Refrigerator', 'GEN', 'Thermo Scientific', 'TSX505', 'TSX-1180-77', false, NULL, 30, false, NULL, NULL, '{Lab Supervisor}', NULL),
 ('INC1',   'Incubator 35 °C', 'Incubator', 'MICRO', 'Binder', 'BD 115', 'BD-9001-332', true, 12, 30, true, 90, 274, '{Lab Supervisor}', 'Binder service');

INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, calibration_required,
                       calibration_interval_months, calibration_alert_days, qualification_required, in_service_date)
SELECT s.id, d.name, t.id, dp.id, d.mfr, d.model, d.serial, d.cal, d.months, d.alert, d.qual, CURRENT_DATE - 400
  FROM demo_eq d JOIN lab_site s ON s.site_code = 'CFL'
  JOIN equipment_type t ON t.site_id = s.id AND t.type_name = d.type JOIN department dp ON dp.site_id = s.id AND dp.department_code = d.dept
 WHERE NOT EXISTS (SELECT 1 FROM equipment e WHERE e.serial_number = d.serial)
 ORDER BY array_position('{HPLC1,ICP1,HPTLC1,BAL1,PIP1,PIP2,PIP3,FRIDGE1,INC1}'::text[], d.code_hint);

INSERT INTO equipment_owner (equipment_id, group_id)
SELECT e.id, g.id FROM demo_eq d JOIN equipment e ON e.serial_number = d.serial, unnest(d.owner_groups) gn
  JOIN lab_group g ON g.group_name = gn
 WHERE g.site_id = e.site_id ON CONFLICT DO NOTHING;
-- a named person too (the vault example: a General Manager responsible for the ICP-MS)
INSERT INTO equipment_owner (equipment_id, user_id)
SELECT e.id, u.id FROM equipment e, app_user u WHERE e.serial_number = 'JP15400211' AND u.username = 'akiddle' ON CONFLICT DO NOTHING;

-- Calibration history: one earlier record and the current one for each calibrated item
INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, performed_by_vendor, certificate_number)
SELECT e.id, CURRENT_DATE - d.cal_ago - (d.months * 30), CURRENT_DATE - d.cal_ago - 1, 'Pass', d.vendor, 'CERT-' || d.code_hint || '-A'
  FROM demo_eq d JOIN equipment e ON e.serial_number = d.serial WHERE d.cal AND NOT EXISTS (SELECT 1 FROM calibration c WHERE c.equipment_id = e.id);
INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, performed_by_vendor, certificate_number)
SELECT e.id, CURRENT_DATE - d.cal_ago, CURRENT_DATE + d.cal_left, 'Pass', d.vendor, 'CERT-' || d.code_hint || '-B'
  FROM demo_eq d JOIN equipment e ON e.serial_number = d.serial WHERE d.cal AND (SELECT count(*) FROM calibration c WHERE c.equipment_id = e.id) = 1;

-- Qualification on record for the big instruments
INSERT INTO qualification (equipment_id, qualification_type, performed_date, result, performed_by_vendor, protocol_reference)
SELECT e.id, 'IQ/OQ/PQ', CURRENT_DATE - 395, 'Pass', d.vendor, 'QP-' || d.code_hint || '-001'
  FROM demo_eq d JOIN equipment e ON e.serial_number = d.serial WHERE d.qual AND NOT EXISTS (SELECT 1 FROM qualification q WHERE q.equipment_id = e.id);

-- Maintenance schedules: HPLC preventive maintenance due in 5 days; ICP-MS cones overdue (tagged out when the server starts);
-- the refrigerator's weekly check (warning only, never tags it out)
INSERT INTO maintenance_schedule (equipment_id, task_name, interval_count, interval_unit, next_due_date, alert_days, tag_out_when_due, instructions)
SELECT e.id, x.task, x.n, x.unit, CURRENT_DATE + x.due, x.alert, x.tag, x.instr
  FROM (VALUES ('DEAB912345', 'Preventive maintenance (pump seals, lamp hours)', 6, 'months', 5, 14, true, 'Agilent PM checklist'),
               ('JP15400211', 'Clean sampler and skimmer cones', 1, 'months', -3, 7, true, 'SOP EQ-021'),
               ('TSX-1180-77', 'Weekly temperature check and defrost', 1, 'weeks', 2, 2, false, 'Record min/max; defrost if ice > 5 mm')) AS x(serial, task, n, unit, due, alert, tag, instr)
  JOIN equipment e ON e.serial_number = x.serial
 WHERE NOT EXISTS (SELECT 1 FROM maintenance_schedule m WHERE m.equipment_id = e.id);

-- One past maintenance log entry on the HPLC
INSERT INTO equipment_event (equipment_id, event_type, performed_date, performed_by_vendor, summary)
SELECT e.id, 'Service visit', CURRENT_DATE - 175, 'Agilent Technologies field service', 'Replaced pump seals and the deuterium lamp (1,950 h). Pressure test passed.'
  FROM equipment e WHERE e.serial_number = 'DEAB912345' AND NOT EXISTS (SELECT 1 FROM equipment_event v WHERE v.equipment_id = e.id);

COMMIT;
