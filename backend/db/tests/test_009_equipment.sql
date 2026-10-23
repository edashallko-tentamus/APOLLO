-- Verification for migration 009: equipment lists per lab, the register, required owners, permissions and signatures,
-- calibration history and status, expiry changes by a different QA person, manual and automatic tag-outs, tag-in rules
-- (work recorded; release by someone else after repair, calibration or qualification), schedules moving on,
-- transfer to another lab with history, the due list, and audit references.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'PASS: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN cond THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END
$$;
CREATE OR REPLACE FUNCTION pg_temp.user_only(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) || set_config('lims.signature_id', '', false)
$$;
CREATE OR REPLACE FUNCTION pg_temp.site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.grp(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT g.id FROM lab_group g JOIN lab_site s ON s.id = g.site_id WHERE s.site_code = site AND g.group_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.uid(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.eq(serial text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE serial_number = serial $$;
CREATE OR REPLACE FUNCTION pg_temp.typ(site text, name text) RETURNS uuid LANGUAGE sql AS $$
  SELECT t.id FROM equipment_type t JOIN lab_site s ON s.id = t.site_id WHERE s.site_code = site AND t.type_name = name $$;
CREATE OR REPLACE FUNCTION pg_temp.open_tag(serial text, r text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM equipment_tag WHERE equipment_id = pg_temp.eq(serial) AND reason::text = r AND tagged_in_at IS NULL $$;
-- "Today" is the lab's date (site_today), as the rules use; the database clock is UTC, which runs a day ahead of
-- California every evening and made these tests fail between 5 pm and midnight Pacific.
CREATE OR REPLACE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$ SELECT site_today((SELECT id FROM lab_site WHERE site_code = 'CFL')) $$;

-- People: a CFL supervisor, analyst and two QA people, a TPS supervisor
INSERT INTO app_user (username, full_name) VALUES ('e.sup', 'Eq Supervisor'), ('e.ana', 'Eq Analyst'), ('e.qa', 'Eq QA One'), ('e.qa2', 'Eq QA Two'), ('e.tps', 'Eq TPS Supervisor'), ('e.int', 'Eq Intake');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES
 (pg_temp.grp('CFL', 'Lab Supervisor'), pg_temp.uid('e.sup')), (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('e.ana')),
 (pg_temp.grp('CFL', 'QA'), pg_temp.uid('e.qa')), (pg_temp.grp('CFL', 'QA'), pg_temp.uid('e.qa2')), (pg_temp.grp('TPS', 'Lab Supervisor'), pg_temp.uid('e.tps')),
 (pg_temp.grp('CFL', 'Intake'), pg_temp.uid('e.int'));

SELECT pg_temp.expect_true('Standard groups got the equipment permissions (Supervisor and Analyst edit and tag, QA releases)',
  user_has_permission_at(pg_temp.uid('e.sup'), 'equipment.edit', pg_temp.site('CFL')) AND user_has_permission_at(pg_temp.uid('e.ana'), 'equipment.tag', pg_temp.site('CFL'))
  AND user_has_permission_at(pg_temp.uid('e.ana'), 'equipment.edit', pg_temp.site('CFL')) AND NOT user_has_permission_at(pg_temp.uid('e.int'), 'equipment.edit', pg_temp.site('CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('e.ana'), 'equipment.release', pg_temp.site('CFL')) AND user_has_permission_at(pg_temp.uid('e.qa'), 'equipment.release', pg_temp.site('CFL'))
  AND NOT user_has_permission_at(pg_temp.uid('e.qa'), 'equipment.edit', pg_temp.site('CFL')));
SELECT pg_temp.expect_true('New labs get the equipment permissions too (standard group template)',
  (SELECT 'equipment.release' = ANY (permissions) FROM standard_group_template WHERE group_name = 'QA'));

-- Each lab's lists
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_error('An analyst (no equipment.lists) cannot change the Equipment types list',
  $$INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'Balance')$$);
SELECT pg_temp.user_only('e.sup');
SELECT pg_temp.expect_error('Changing the Equipment types list needs a signature',
  $$INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'Balance')$$);
SELECT pg_temp.as_user('e.sup');
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'Balance'), (pg_temp.site('CFL'), 'HPLC'), (pg_temp.site('CFL'), 'Pipette'), (pg_temp.site('CFL'), 'Spectrophotometer');
INSERT INTO department (site_id, department_code, department_name) VALUES (pg_temp.site('CFL'), 'chem', 'Chemistry');
SELECT pg_temp.expect_true('Department codes are stored in capitals', EXISTS (SELECT 1 FROM department WHERE department_code = 'CHEM'));
SELECT pg_temp.expect_error('Type names are unique in a lab (ignoring capitals)', $$INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('CFL'), 'hplc')$$);
SELECT pg_temp.expect_error('A CFL supervisor cannot change TPS''s lists', $$INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('TPS'), 'HPLC')$$);
SELECT pg_temp.as_user('e.tps');
INSERT INTO equipment_type (site_id, type_name) VALUES (pg_temp.site('TPS'), 'HPLC');
INSERT INTO department (site_id, department_code, department_name) VALUES (pg_temp.site('TPS'), 'QC', 'Quality control lab');

-- The register
SELECT pg_temp.as_user('e.int');
SELECT pg_temp.expect_error('Intake (no equipment.edit) cannot add equipment',
  $$INSERT INTO equipment (site_id, equipment_name, equipment_type_id) VALUES (pg_temp.site('CFL'), 'X', pg_temp.typ('CFL', 'HPLC'))$$);
SELECT pg_temp.as_user('e.sup');
SELECT pg_temp.expect_error('A type from another lab''s list is refused',
  $$INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id) VALUES (pg_temp.site('CFL'), 'X', pg_temp.typ('TPS', 'HPLC'), (SELECT id FROM department WHERE department_code = 'CHEM'))$$);
SELECT pg_temp.expect_error('Equipment must belong to a department',
  $$INSERT INTO equipment (site_id, equipment_name, equipment_type_id) VALUES (pg_temp.site('CFL'), 'No dept', pg_temp.typ('CFL', 'HPLC'))$$);
SELECT pg_temp.expect_error('Equipment needs at least one owner (checked when the save completes)',
  $$INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, serial_number) VALUES (pg_temp.site('CFL'), 'No owner', pg_temp.typ('CFL', 'Balance'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'NO-OWNER'); SET CONSTRAINTS ALL IMMEDIATE$$);
SET CONSTRAINTS ALL DEFERRED;
INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, serial_number, calibration_required, calibration_interval_months, calibration_alert_days)
VALUES (pg_temp.site('CFL'), 'Balance T1', pg_temp.typ('CFL', 'Balance'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'Mettler', 'BAL-T1', true, 6, 30),
       (pg_temp.site('CFL'), 'HPLC T1', pg_temp.typ('CFL', 'HPLC'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'Agilent', 'HPLC-T1', true, 12, 30),
       (pg_temp.site('CFL'), 'Pipette T1', pg_temp.typ('CFL', 'Pipette'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'Eppendorf', 'PIP-T1', true, 6, 14),
       (pg_temp.site('CFL'), 'Spectro T1', pg_temp.typ('CFL', 'Spectrophotometer'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'Shimadzu', 'UV-T1', false, NULL, 30);
INSERT INTO equipment_owner (equipment_id, group_id) SELECT id, pg_temp.grp('CFL', 'Lab Supervisor') FROM equipment WHERE serial_number IN ('BAL-T1','HPLC-T1','UV-T1');
INSERT INTO equipment_owner (equipment_id, group_id) VALUES (pg_temp.eq('PIP-T1'), pg_temp.grp('CFL', 'Analyst'));
INSERT INTO equipment_owner (equipment_id, user_id) VALUES (pg_temp.eq('HPLC-T1'), pg_temp.uid('e.sup'));
SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_true('Equipment gets a system ID (EQ-00001)', (SELECT equipment_code ~ '^EQ-\d{5}$' FROM equipment WHERE serial_number = 'BAL-T1'));
SELECT pg_temp.expect_error('An owner group must be a group of the equipment''s lab',
  $$INSERT INTO equipment_owner (equipment_id, group_id) VALUES (pg_temp.eq('BAL-T1'), pg_temp.grp('TPS', 'Lab Supervisor'))$$);
SELECT pg_temp.expect_error('A named owner must be in a group at that lab',
  $$INSERT INTO equipment_owner (equipment_id, user_id) VALUES (pg_temp.eq('BAL-T1'), pg_temp.uid('e.tps'))$$);
SELECT pg_temp.expect_error('Removing the last owner is refused',
  $$SELECT set_config('lims.reason', 'Change of responsibility', false); UPDATE equipment_owner SET status = 'Inactive' WHERE equipment_id = pg_temp.eq('BAL-T1'); SET CONSTRAINTS ALL IMMEDIATE$$);
SELECT set_config('lims.reason', '', false);
SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_error('Same manufacturer and serial number twice is refused',
  $$INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, serial_number) VALUES (pg_temp.site('CFL'), 'Dup', pg_temp.typ('CFL', 'Balance'), (SELECT id FROM department WHERE department_code = 'CHEM'), 'mettler', 'bal-t1')$$);
SELECT pg_temp.expect_true('Owners are found named or through their groups',
  is_equipment_owner(pg_temp.uid('e.sup'), pg_temp.eq('BAL-T1')) AND is_equipment_owner(pg_temp.uid('e.ana'), pg_temp.eq('PIP-T1')) AND NOT is_equipment_owner(pg_temp.uid('e.ana'), pg_temp.eq('BAL-T1')));
SELECT pg_temp.expect_error('Equipment cannot be moved to another lab by editing it',
  $$UPDATE equipment SET site_id = pg_temp.site('TPS') WHERE serial_number = 'UV-T1'$$);

-- Calibration history and status
SELECT pg_temp.expect_true('No calibration yet: Deficient', calibration_status(pg_temp.eq('BAL-T1')) = 'Deficient');
SELECT pg_temp.expect_true('Calibration not required: Not required', calibration_status(pg_temp.eq('UV-T1')) = 'Not required');
SELECT pg_temp.as_user('e.ana');
INSERT INTO calibration (equipment_id, performed_date, result, certificate_number) VALUES (pg_temp.eq('BAL-T1'), site_today(pg_temp.site('CFL')) - 10, 'Pass', 'C-1');
SELECT pg_temp.expect_true('Expiry defaults from the 6-month interval; performer defaults to the person recording it',
  (SELECT expiration_date = (performed_date + interval '6 months' - interval '1 day')::date AND performed_by_user_id = pg_temp.uid('e.ana') FROM calibration WHERE certificate_number = 'C-1'));
SELECT pg_temp.expect_true('In-date passing calibration: Conforms', calibration_status(pg_temp.eq('BAL-T1')) = 'Conforms');
SELECT pg_temp.expect_error('A calibration dated in the future is refused',
  $$INSERT INTO calibration (equipment_id, performed_date, result) VALUES (pg_temp.eq('BAL-T1'), site_today(pg_temp.site('CFL')) + 1, 'Pass')$$);
SELECT pg_temp.expect_error('Expiry before the calibration date is refused',
  $$INSERT INTO calibration (equipment_id, performed_date, expiration_date, result) VALUES (pg_temp.eq('BAL-T1'), pg_temp.today() - 5, pg_temp.today() - 6, 'Pass')$$);
SELECT pg_temp.expect_error('No interval and no expiry date: refused',
  $$INSERT INTO calibration (equipment_id, performed_date, result) VALUES (pg_temp.eq('UV-T1'), pg_temp.today(), 'Pass')$$);
SELECT set_config('lims.reason', 'Certificate correction', false);
SELECT pg_temp.expect_error('The analyst cannot change a calibration''s expiry (needs equipment.release)',
  $$UPDATE calibration SET expiration_date = expiration_date + 30 WHERE certificate_number = 'C-1'$$);
UPDATE calibration SET notes = 'Certificate filed in binder 3' WHERE certificate_number = 'C-1';
SELECT pg_temp.expect_true('Notes on a calibration can be added by the calibrator (signed, reason)', (SELECT notes IS NOT NULL FROM calibration WHERE certificate_number = 'C-1'));
SELECT pg_temp.as_user('e.qa');
UPDATE calibration SET expiration_date = site_today(pg_temp.site('CFL')) + 20 WHERE certificate_number = 'C-1';
SELECT pg_temp.expect_true('QA (not the performer) changes the expiry; within 30 days: Alert', calibration_status(pg_temp.eq('BAL-T1')) = 'Alert');
SELECT pg_temp.as_user('akiddle');
INSERT INTO group_member (group_id, user_id) VALUES (pg_temp.grp('CFL', 'Analyst'), pg_temp.uid('e.qa2'));   -- QA Two also works the bench
SELECT pg_temp.as_user('e.qa2');
INSERT INTO calibration (equipment_id, performed_date, expiration_date, result, performed_by_vendor, certificate_number)
VALUES (pg_temp.eq('HPLC-T1'), pg_temp.today() - 400, pg_temp.today() - 35, 'Pass', 'Agilent service', 'C-H1');
SELECT pg_temp.expect_error('QA cannot change a calibration they recorded themselves (someone else must)',
  $$UPDATE calibration SET expiration_date = pg_temp.today() + 300 WHERE certificate_number = 'C-H1'$$);
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_true('Expired calibration: Deficient; history kept (current = latest)',
  calibration_status(pg_temp.eq('HPLC-T1')) = 'Deficient' AND (current_calibration(pg_temp.eq('HPLC-T1'))).certificate_number = 'C-H1');

-- Automatic tag-out: expired or missing calibration
SELECT pg_temp.user_only('system');
CREATE TEMP TABLE auto_c AS SELECT equipment_auto_tag(pg_temp.site('CFL')) AS n;
SELECT pg_temp.expect_true('Automatic tag-out tags the expired HPLC and the never-calibrated pipette, nothing else', (SELECT n FROM auto_c) = 2
  AND pg_temp.open_tag('HPLC-T1', 'Calibration') IS NOT NULL AND pg_temp.open_tag('PIP-T1', 'Calibration') IS NOT NULL AND pg_temp.open_tag('BAL-T1', 'Calibration') IS NULL);
SELECT pg_temp.expect_true('Running it again does not tag twice', equipment_auto_tag(pg_temp.site('CFL')) = 0);
SELECT pg_temp.expect_true('Tagged-out equipment shows as Tagged out (derived, never typed)',
  (SELECT availability FROM equipment_view WHERE serial_number = 'HPLC-T1') = 'Tagged out' AND (SELECT availability FROM equipment_view WHERE serial_number = 'BAL-T1') = 'Available');
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_error('Only the system makes automatic tag-outs',
  $$INSERT INTO equipment_tag (equipment_id, reason, source) VALUES (pg_temp.eq('UV-T1'), 'Calibration', 'Calibration due')$$);

-- Releasing after calibration: the passing calibration under the tag, then QA (not the calibrator) releases
SELECT pg_temp.as_user('e.qa2');
SELECT pg_temp.expect_error('Release refused until the work is recorded',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('HPLC-T1', 'Calibration')$$);
SELECT pg_temp.as_user('e.ana');
INSERT INTO calibration (equipment_id, tag_id, performed_date, result, certificate_number) VALUES (pg_temp.eq('HPLC-T1'), pg_temp.open_tag('HPLC-T1', 'Calibration'), pg_temp.today() - 1, 'Pass', 'C-H2');
SELECT pg_temp.expect_error('The analyst who calibrated cannot release it (no permission, and it is their work)',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('HPLC-T1', 'Calibration')$$);
SELECT pg_temp.as_user('e.qa2');
UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('HPLC-T1', 'Calibration');
SELECT pg_temp.expect_true('QA releases it: signed "Released by", available again, Conforms',
  (SELECT tag_in_meaning = 'Released by' AND tagged_in_by = pg_temp.uid('e.qa2') AND tag_in_signature_id IS NOT NULL FROM equipment_tag WHERE equipment_id = pg_temp.eq('HPLC-T1') AND reason = 'Calibration')
  AND (SELECT availability FROM equipment_view WHERE serial_number = 'HPLC-T1') = 'Available' AND calibration_status(pg_temp.eq('HPLC-T1')) = 'Conforms');
SELECT pg_temp.expect_error('A closed tag cannot be changed',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE equipment_id = pg_temp.eq('HPLC-T1') AND reason = 'Calibration'$$);
SELECT pg_temp.expect_error('Tags are never deleted', $$DELETE FROM equipment_tag WHERE equipment_id = pg_temp.eq('HPLC-T1')$$);

-- Repair: tagged out and repaired by QA One; QA One cannot release; QA Two can
SELECT pg_temp.user_only('e.ana');
SELECT pg_temp.expect_error('A manual tag-out needs a signature', $$INSERT INTO equipment_tag (equipment_id, reason) VALUES (pg_temp.eq('BAL-T1'), 'Repair')$$);
SELECT pg_temp.as_user('e.ana');
INSERT INTO equipment_tag (equipment_id, reason, description) VALUES (pg_temp.eq('BAL-T1'), 'Repair', 'Drifting, will not tare');
SELECT pg_temp.expect_error('The same reason cannot be tagged twice at once',
  $$INSERT INTO equipment_tag (equipment_id, reason) VALUES (pg_temp.eq('BAL-T1'), 'Repair')$$);
SELECT pg_temp.expect_error('A tag''s reason cannot be edited',
  $$UPDATE equipment_tag SET reason = 'Maintenance' WHERE id = pg_temp.open_tag('BAL-T1', 'Repair')$$);
SELECT pg_temp.as_user('e.qa');
SELECT pg_temp.expect_error('QA cannot record maintenance work (no equipment.tag)',
  $$INSERT INTO equipment_event (equipment_id, tag_id, event_type, performed_date, summary) VALUES (pg_temp.eq('BAL-T1'), pg_temp.open_tag('BAL-T1', 'Repair'), 'Repair', pg_temp.today(), 'x')$$);
SELECT pg_temp.as_user('e.ana');
INSERT INTO equipment_event (equipment_id, tag_id, event_type, performed_date, summary) VALUES (pg_temp.eq('BAL-T1'), pg_temp.open_tag('BAL-T1', 'Repair'), 'Repair', pg_temp.today(), 'Load cell cleaned, levelled, check weights within tolerance');
SELECT pg_temp.expect_error('The analyst who tagged it out and repaired it cannot release it',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('BAL-T1', 'Repair')$$);
SELECT pg_temp.as_user('e.qa');
UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('BAL-T1', 'Repair');
SELECT pg_temp.expect_true('QA (who did not do the work) releases after repair',
  (SELECT tag_in_meaning FROM equipment_tag WHERE equipment_id = pg_temp.eq('BAL-T1') AND reason = 'Repair') = 'Released by');

-- Segregation applies to QA too: QA Two (also on the bench) tags the HPLC out and repairs it; QA One releases it
SELECT pg_temp.as_user('e.qa2');
INSERT INTO equipment_tag (equipment_id, reason, description) VALUES (pg_temp.eq('HPLC-T1'), 'Repair', 'Leak at the injector');
INSERT INTO equipment_event (equipment_id, tag_id, event_type, performed_date, summary) VALUES (pg_temp.eq('HPLC-T1'), pg_temp.open_tag('HPLC-T1', 'Repair'), 'Repair', pg_temp.today(), 'Rotor seal replaced');
SELECT pg_temp.expect_error('QA who tagged it out and did the repair cannot release it (holds the permission, but it is their work)',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('HPLC-T1', 'Repair')$$);
SELECT pg_temp.as_user('e.qa');
UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('HPLC-T1', 'Repair');

-- Maintenance: the analyst tags out, records the work and returns it to service (no QA release)
SELECT pg_temp.as_user('e.ana');
INSERT INTO equipment_tag (equipment_id, reason) VALUES (pg_temp.eq('UV-T1'), 'Maintenance');
SELECT pg_temp.expect_error('Tag-in needs the work recorded first', $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('UV-T1', 'Maintenance')$$);
INSERT INTO equipment_event (equipment_id, tag_id, event_type, performed_date, summary) VALUES (pg_temp.eq('UV-T1'), pg_temp.open_tag('UV-T1', 'Maintenance'), 'Maintenance', pg_temp.today(), 'Lamp replaced');
UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('UV-T1', 'Maintenance');
SELECT pg_temp.expect_true('After maintenance the same person returns it to service ("Returned to service by")',
  (SELECT tag_in_meaning FROM equipment_tag WHERE equipment_id = pg_temp.eq('UV-T1')) = 'Returned to service by');

-- Schedules: due today with "tag out when due"; doing the work moves the next due date on
SELECT pg_temp.as_user('e.sup');
INSERT INTO maintenance_schedule (equipment_id, task_name, interval_count, interval_unit, next_due_date) VALUES (pg_temp.eq('UV-T1'), 'Wavelength check', 3, 'months', site_today(pg_temp.site('CFL')));
SELECT pg_temp.as_user('e.qa');
SELECT pg_temp.expect_error('QA cannot change maintenance schedules (no equipment.edit)',
  $$INSERT INTO maintenance_schedule (equipment_id, task_name, interval_count, interval_unit, next_due_date) VALUES (pg_temp.eq('UV-T1'), 'x', 1, 'weeks', pg_temp.today())$$);
SELECT pg_temp.user_only('system');
CREATE TEMP TABLE auto_n AS SELECT equipment_auto_tag(pg_temp.site('CFL')) AS n;
SELECT pg_temp.expect_true('Maintenance due today: tagged out automatically', (SELECT n FROM auto_n) = 1
  AND (SELECT source::text FROM equipment_tag WHERE id = pg_temp.open_tag('UV-T1', 'Maintenance')) = 'Maintenance due');
SELECT pg_temp.expect_true('The due list shows the open tag (not the schedule twice)',
  (SELECT count(*) FROM equipment_due_view WHERE equipment_code = (SELECT equipment_code FROM equipment WHERE serial_number = 'UV-T1')) = 1);
SELECT pg_temp.as_user('e.ana');
INSERT INTO equipment_event (equipment_id, tag_id, schedule_id, event_type, performed_date, summary)
VALUES (pg_temp.eq('UV-T1'), pg_temp.open_tag('UV-T1', 'Maintenance'), (SELECT id FROM maintenance_schedule WHERE task_name = 'Wavelength check'), 'Maintenance', site_today(pg_temp.site('CFL')), 'Holmium filter within 0.5 nm');
SELECT pg_temp.expect_true('Recording the scheduled work moves the next due date on by 3 months',
  (SELECT next_due_date = (site_today(pg_temp.site('CFL')) + interval '3 months')::date FROM maintenance_schedule WHERE task_name = 'Wavelength check'));
UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('UV-T1', 'Maintenance');

-- Due list
SELECT pg_temp.expect_true('The due list has the never-calibrated pipette (tagged out) and the balance due soon',
  EXISTS (SELECT 1 FROM equipment_due_view WHERE equipment_name = 'Pipette T1' AND kind = 'Tagged out')
  AND EXISTS (SELECT 1 FROM equipment_due_view WHERE equipment_name = 'Balance T1' AND kind = 'Calibration' AND urgency = 'Due soon'));

-- Transfer to another lab: history goes with it, it arrives tagged out for qualification
SELECT pg_temp.as_user('e.int');
SELECT pg_temp.expect_error('Intake (no equipment.edit) cannot transfer equipment',
  $$SELECT transfer_equipment(pg_temp.eq('BAL-T1'), pg_temp.site('TPS'), pg_temp.grp('TPS', 'Lab Supervisor'), (SELECT id FROM department WHERE department_code = 'QC'))$$);
SELECT pg_temp.as_user('e.sup');
SELECT pg_temp.expect_error('The receiving lab''s owner must be a group of that lab',
  $$SELECT transfer_equipment(pg_temp.eq('BAL-T1'), pg_temp.site('TPS'), pg_temp.grp('CFL', 'Lab Supervisor'), (SELECT id FROM department WHERE department_code = 'QC'))$$);
SELECT pg_temp.expect_error('The receiving lab''s department must be one of that lab''s',
  $$SELECT transfer_equipment(pg_temp.eq('BAL-T1'), pg_temp.site('TPS'), pg_temp.grp('TPS', 'Lab Supervisor'), (SELECT id FROM department WHERE department_code = 'CHEM'))$$);
SELECT transfer_equipment(pg_temp.eq('BAL-T1'), pg_temp.site('TPS'), pg_temp.grp('TPS', 'Lab Supervisor'), (SELECT id FROM department WHERE department_code = 'QC'), 'Moving to St. Petersburg');
SET CONSTRAINTS ALL IMMEDIATE; SET CONSTRAINTS ALL DEFERRED;
SELECT pg_temp.expect_true('Transferred: now at TPS, TPS group owns it, CFL group no longer does, history kept',
  (SELECT site_id FROM equipment WHERE serial_number = 'BAL-T1') = pg_temp.site('TPS')
  AND (SELECT owners FROM equipment_view WHERE serial_number = 'BAL-T1') = 'Lab Supervisor'
  AND (SELECT count(*) FROM calibration WHERE equipment_id = pg_temp.eq('BAL-T1')) = 1
  AND (SELECT department_code FROM equipment_view WHERE serial_number = 'BAL-T1') = 'QC'
  AND EXISTS (SELECT 1 FROM equipment_transfer WHERE equipment_id = pg_temp.eq('BAL-T1')));
SELECT pg_temp.expect_true('It arrives tagged out for Qualification, and TPS''s list gained the Balance type',
  pg_temp.open_tag('BAL-T1', 'Qualification') IS NOT NULL AND pg_temp.typ('TPS', 'Balance') IS NOT NULL
  AND (SELECT equipment_type_id FROM equipment WHERE serial_number = 'BAL-T1') = pg_temp.typ('TPS', 'Balance'));
SELECT pg_temp.expect_error('CFL can no longer change it', $$UPDATE equipment SET notes = 'x' WHERE serial_number = 'BAL-T1'$$);
SELECT pg_temp.as_user('e.tps');
INSERT INTO qualification (equipment_id, tag_id, qualification_type, performed_date, result) VALUES (pg_temp.eq('BAL-T1'), pg_temp.open_tag('BAL-T1', 'Qualification'), 'IQ/OQ', pg_temp.today(), 'Pass');
SELECT pg_temp.expect_error('The TPS supervisor who qualified it cannot release it',
  $$UPDATE equipment_tag SET tagged_in_at = now() WHERE id = pg_temp.open_tag('BAL-T1', 'Qualification')$$);

-- Retired equipment
SELECT pg_temp.as_user('e.sup');
SELECT set_config('lims.reason', 'Taken out of service', false);
UPDATE equipment SET admin_status = 'Retired' WHERE serial_number = 'UV-T1';
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.as_user('e.ana');
SELECT pg_temp.expect_error('Retired equipment cannot be tagged out', $$INSERT INTO equipment_tag (equipment_id, reason) VALUES (pg_temp.eq('UV-T1'), 'Repair')$$);
SELECT pg_temp.expect_true('Retired shows as Retired', (SELECT availability FROM equipment_view WHERE serial_number = 'UV-T1') = 'Retired');

-- Audit
SELECT pg_temp.expect_true('Every tag-out and tag-in is audited with its signature',
  (SELECT count(*) FROM audit_log WHERE table_name = 'equipment_tag' AND record_id = (SELECT id FROM equipment_tag WHERE equipment_id = pg_temp.eq('HPLC-T1') AND reason = 'Calibration') AND signature_id IS NOT NULL) >= 1);
SELECT pg_temp.expect_true('Audit entries name the equipment and link to its page',
  (SELECT r->>'link' LIKE '#/equipment/%' AND r->>'label' LIKE '%Balance T1: CAL-%' FROM calibration c, audit_record_ref('calibration', c.id, to_jsonb(c)) r WHERE c.certificate_number = 'C-1'));

SELECT set_config('lims.signature_id', '', false);
SELECT pg_temp.user_only('akiddle');
SELECT rpad(left(test, 74), 76) || outcome AS result FROM results;
SELECT 1 AS done;
