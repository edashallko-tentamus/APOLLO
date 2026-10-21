-- Sandbox demo data for 0.34.0 (migration 057): a receipt with a temperature now names the thermometer, from the
-- equipment register, available and in calibration. Each lab that has no thermometer gets one fictional receiving
-- thermometer (General lab, owned by the Lab Supervisor group) with a calibration in date, so receiving keeps working.
-- Skipped for a lab that already has a thermometer.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true);
SELECT set_config('lims.reason', 'Sandbox demo data: receiving thermometer', true);
SELECT script_signature('Sandbox demo data');

CREATE TEMP TABLE demo_th ON COMMIT DROP AS
SELECT s.id AS site_id, s.site_code, t.id AS type_id, d.id AS dept_id, 'DEMO-THERM-' || s.site_code AS serial
  FROM lab_site s JOIN equipment_type t ON t.site_id = s.id AND t.type_name = 'Thermometer'
  JOIN department d ON d.site_id = s.id AND d.department_code = 'GEN'
 WHERE s.site_code IN ('CFL', 'TPS')
   AND NOT EXISTS (SELECT 1 FROM equipment e WHERE e.site_id = s.id AND (e.equipment_type_id = t.id OR e.equipment_name ILIKE '%thermometer%'));

INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, calibration_required,
                       calibration_interval_months, calibration_alert_days, qualification_required, in_service_date)
SELECT site_id, 'Receiving thermometer (demo)', type_id, dept_id, 'ThermoWorks', 'Thermapen ONE', serial, true, 12, 30, false, CURRENT_DATE - 200 FROM demo_th;
INSERT INTO equipment_owner (equipment_id, group_id)
SELECT e.id, g.id FROM demo_th x JOIN equipment e ON e.serial_number = x.serial JOIN lab_group g ON g.site_id = x.site_id AND g.group_name = 'Lab Supervisor'
ON CONFLICT DO NOTHING;
INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, performed_by_vendor, certificate_number)
SELECT e.id, CURRENT_DATE - 100, CURRENT_DATE + 265, 'Pass', 'ThermoWorks calibration lab', 'CERT-THERM-' || x.site_code
  FROM demo_th x JOIN equipment e ON e.serial_number = x.serial;
COMMIT;
