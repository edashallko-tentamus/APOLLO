-- Verification for migration 045: the sensor feed (iMonnit) into the logbooks. Who links a sensor (signed) and who
-- approves the link (QA, not whoever linked it); the feed's account (only while it runs, signing as the feed, sensor
-- entries only); readings kept once, never changed; one entry per hour, one per spell outside the limits, one per
-- silence longer than the gap; people give the reason, QA approves only with it; late readings correct the hour (back
-- to QA) and void the silence they fill; QC Review windows exact for sensor entries; the incubator's range over a period.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
SELECT set_config('lims.sensor_feed', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'PASS');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'FAIL: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.sf_as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.sensor_feed', '', false);
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
-- the feed: its account, its flag, its signature
CREATE OR REPLACE FUNCTION pg_temp.sf_feed() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'sensor.feed'), false);
  PERFORM set_config('lims.sensor_feed', '1', false);
  PERFORM sensor_feed_sign('Rule test readings');
  PERFORM set_config('lims.signature_id', current_setting('lims.signature_id'), false);
  RETURN 'feed';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sf_lnk() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sensor_link WHERE external_id = 'R501' AND status <> 'Retired' $$;
CREATE OR REPLACE FUNCTION pg_temp.sf_lbx() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM logbook WHERE logbook_name = 'Rule sensor temperatures' $$;
CREATE OR REPLACE FUNCTION pg_temp.sf_eqx() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE equipment_name = 'WD Balance 2' $$;
-- the anchor: 11 lab hours ago, on the hour
CREATE TEMP TABLE IF NOT EXISTS sft (k text PRIMARY KEY, t timestamptz);
DELETE FROM sft;
INSERT INTO sft VALUES ('A', date_trunc('hour', now()) - interval '11 hours');
CREATE OR REPLACE FUNCTION pg_temp.sf_a(m integer) RETURNS timestamptz LANGUAGE sql AS $$ SELECT t + make_interval(mins => m) FROM sft WHERE k = 'A' $$;
-- readings every 5 minutes from A to now, except the given minutes; 9.1 °C (9.6 at 3:30) from 3:20 to 3:40
CREATE OR REPLACE FUNCTION pg_temp.sf_rows(p_skip int[] DEFAULT '{}', p_only int[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object('guid', 'g' || m, 'at', pg_temp.sf_a(m), 'battery', 90, 'signal', 80,
           'value', CASE WHEN m = 210 THEN 9.6 WHEN m BETWEEN 200 AND 220 THEN 9.1 ELSE 4.5 + (m % 3) * 0.1 END) ORDER BY m), '[]')
    FROM generate_series(0, 24 * 60, 5) m
   WHERE pg_temp.sf_a(m) <= now() - interval '1 minute' AND NOT (m = ANY (p_skip)) AND (p_only IS NULL OR m = ANY (p_only))
$$;
CREATE OR REPLACE FUNCTION pg_temp.sf_ent(kind text, startm integer) RETURNS logbook_entry LANGUAGE sql AS $$
  SELECT * FROM logbook_entry WHERE sensor_link_id = pg_temp.sf_lnk() AND sensor_kind = kind AND period_start = pg_temp.sf_a(startm) AND status <> 'Voided' $$;
SELECT set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);

-- 0. a temperature logbook covering a piece of equipment (2 to 8 °C), approved by QA
SELECT pg_temp.sf_as('e.sup');
INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule sensor temperatures', 'Temperature', 'Equipment', 'As needed', 'Daily');
INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, equipment_limits) VALUES
  ((SELECT id FROM logbook_version WHERE logbook_id = pg_temp.sf_lbx()), 'temperature', 'Temperature', 'Number', 10, '°C', true),
  ((SELECT id FROM logbook_version WHERE logbook_id = pg_temp.sf_lbx()), 'note', 'Note', 'Text', 20, NULL, false);
UPDATE logbook_field SET required = false WHERE field_key = 'note' AND version_id = (SELECT id FROM logbook_version WHERE logbook_id = pg_temp.sf_lbx());
INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (pg_temp.sf_lbx(), pg_temp.sf_eqx(), '{"temperature": {"min": 2, "max": 8}}');
SELECT pg_temp.sf_as('e.qa');
SELECT approve_logbook_version((SELECT id FROM logbook_version WHERE logbook_id = pg_temp.sf_lbx()));
SELECT pg_temp.expect_true('(the logbook is approved)', logbook_effective_version(pg_temp.sf_lbx()) IS NOT NULL);

-- 1. linking a sensor
SELECT pg_temp.sf_as('e.ana');
SELECT pg_temp.expect_error_like('An analyst cannot link a sensor (sensors.configure)',
  $$INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'temperature', pg_temp.sf_eqx(), pg_temp.sf_lbx(), 'temperature')$$, 'sensors.configure');
SELECT pg_temp.sf_as('e.sup', false);
SELECT pg_temp.expect_error_like('Linking a sensor is signed',
  $$INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'temperature', pg_temp.sf_eqx(), pg_temp.sf_lbx(), 'temperature')$$, 'electronic signature');
SELECT pg_temp.sf_as('e.sup');
SELECT pg_temp.expect_error_like('A sensor feeds a number field only',
  $$INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'temperature', pg_temp.sf_eqx(), pg_temp.sf_lbx(), 'note')$$, 'not a number field');
SELECT pg_temp.expect_error_like('... for equipment the logbook covers',
  $$INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'temperature', (SELECT id FROM equipment WHERE equipment_name = 'WD Balance 1'), pg_temp.sf_lbx(), 'temperature')$$, 'does not cover');
SELECT pg_temp.expect_ok('The Lab Supervisor links sensor R501 (temperature) to the logbook and the equipment (signed)',
  $$INSERT INTO sensor_link (site_id, external_id, sensor_name, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'Rule fridge', 'temperature', pg_temp.sf_eqx(), pg_temp.sf_lbx(), 'temperature')$$);
SELECT pg_temp.expect_true('It waits for QA', (SELECT status FROM sensor_link WHERE id = pg_temp.sf_lnk()) = 'Awaiting QA');
SELECT pg_temp.expect_error_like('One link per sensor and value',
  $$INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R501', 'temperature', pg_temp.sf_eqx(), pg_temp.sf_lbx(), 'temperature')$$, 'duplicate key');
SELECT pg_temp.expect_error_like('A link is not edited (retire it and link again)', $$UPDATE sensor_link SET gap_minutes = 60 WHERE id = pg_temp.sf_lnk()$$, 'retire it');
SELECT pg_temp.expect_error_like('The Lab Supervisor cannot approve it (logbook.review)', $$SELECT approve_sensor_link(pg_temp.sf_lnk())$$, 'logbook.review');
SELECT pg_temp.sf_feed();
SELECT pg_temp.expect_true('Before QA approves it, the feed records nothing for it', sensor_add_readings(pg_temp.sf_lnk(), pg_temp.sf_rows()) = 0);
SELECT pg_temp.sf_as('e.qa', false);
SELECT pg_temp.expect_error_like('Approving a link is signed', $$SELECT approve_sensor_link(pg_temp.sf_lnk())$$, 'electronic signature');
SELECT pg_temp.sf_as('e.qa');
SELECT pg_temp.expect_error_like('The feed starts at most 7 days back', $$SELECT approve_sensor_link(pg_temp.sf_lnk(), now() - interval '8 days')$$, 'at most 7 days back');
SELECT pg_temp.expect_ok('QA approves it (signed), feeding from just before the first reading, 11 hours ago', $$SELECT approve_sensor_link(pg_temp.sf_lnk(), pg_temp.sf_a(-5))$$);
SELECT pg_temp.expect_true('... Active, approved by QA with the signature, feeding from then', (SELECT status = 'Active' AND approved_by = (SELECT id FROM app_user WHERE username = 'e.qa') AND approval_signature_id IS NOT NULL
   AND feeds_from = pg_temp.sf_a(-5) FROM sensor_link WHERE id = pg_temp.sf_lnk()));

-- 2. the feed's account
SELECT pg_temp.sf_as('e.sup');
SELECT pg_temp.expect_error_like('Nobody else records readings', $$SELECT sensor_add_readings(pg_temp.sf_lnk(), pg_temp.sf_rows())$$, 'only by the sensor feed');
SELECT pg_temp.expect_error_like('Nobody else signs as the sensor feed',
  $$INSERT INTO signature_event (user_id, full_name, meaning, action, method) VALUES (current_app_user(), '', 'Recorded by', 'x', 'Automated sensor feed')$$, 'Only the sensor feed signs');
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'sensor.feed'), false);
SELECT pg_temp.expect_error_like('The feed''s account signs only while the feed runs', $$SELECT script_signature('x', false)$$, 'only while the sensor feed runs');
SELECT pg_temp.sf_feed();
SELECT pg_temp.expect_error_like('While it runs, the feed records sensor entries only (not a hand entry)',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.sf_lbx(), pg_temp.sf_eqx(), '{"temperature": 5}')$$, 'sensor entries only');
SELECT pg_temp.expect_true('It has no lab group and no password', NOT EXISTS (SELECT 1 FROM group_member m JOIN app_user u ON u.id = m.user_id WHERE u.username = 'sensor.feed')
   AND (SELECT password_hash IS NULL AND is_automated FROM app_user WHERE username = 'sensor.feed'));

-- 3. the readings and the entries: 3:20-3:40 above 8 °C; silent 6:05-6:45 (50 minutes) and 8:05-8:10 (15 minutes, under the gap)
SELECT pg_temp.expect_true('Readings received (every 5 minutes, none twice)', sensor_add_readings(pg_temp.sf_lnk(), pg_temp.sf_rows('{365,370,375,380,385,390,395,400,405,485,490}')) > 100);
SELECT pg_temp.expect_true('The same readings again add nothing', sensor_add_readings(pg_temp.sf_lnk(), pg_temp.sf_rows('{365,370,375,380,385,390,395,400,405,485,490}')) = 0);
SELECT pg_temp.expect_error_like('A reading is never changed', $$UPDATE sensor_reading SET value = 5 WHERE link_id = pg_temp.sf_lnk()$$, 'append-only');
SELECT pg_temp.expect_error_like('... nor deleted', $$DELETE FROM sensor_reading WHERE link_id = pg_temp.sf_lnk()$$, 'append-only');
SELECT pg_temp.expect_true('The refresh records 13 entries (11 hours, one excursion, one silence)', (sensor_feed_refresh(pg_temp.sf_lnk())->>'new')::int = 13);
SELECT pg_temp.expect_true('Hourly entries: 12 readings each, the minimum, maximum and average (hour 0: 4.5 to 4.7, average 4.6)',
  (SELECT count(*) FROM logbook_entry WHERE sensor_link_id = pg_temp.sf_lnk() AND sensor_kind = 'Hour') = 11
  AND (pg_temp.sf_ent('Hour', 0)).sensor_summary @> '{"n": 12, "min": 4.5, "max": 4.7, "mean": 4.6}' AND (pg_temp.sf_ent('Hour', 0)).result = 'Pass'
  AND (pg_temp.sf_ent('Hour', 0)).entry_values = '{"temperature": 4.6}' AND (pg_temp.sf_ent('Hour', 0)).entry_at = pg_temp.sf_a(60));
SELECT pg_temp.expect_true('The silent hours: 3 readings at 6:00, 10 at 8:00 (they pass)', (pg_temp.sf_ent('Hour', 360)).sensor_summary->>'n' = '3' AND (pg_temp.sf_ent('Hour', 480)).sensor_summary->>'n' = '10'
  AND (pg_temp.sf_ent('Hour', 480)).result = 'Pass');
SELECT pg_temp.expect_true('The excursion: 3:20 to 3:45 (the first reading back inside), 5 readings, peak 9.6, fails, waiting for a person''s reason',
  (pg_temp.sf_ent('Excursion', 200)).period_end = pg_temp.sf_a(225) AND (pg_temp.sf_ent('Excursion', 200)).sensor_summary @> '{"n": 5, "peak": 9.6, "open": false}'
  AND (pg_temp.sf_ent('Excursion', 200)).result = 'Fail' AND (pg_temp.sf_ent('Excursion', 200)).failure_reason IS NULL
  AND (pg_temp.sf_ent('Excursion', 200)).problems[1] LIKE 'Temperature outside 2 to 8 °C from %: peak 9.6 °C, 5 readings');
SELECT pg_temp.expect_true('Hour 3 fails (rose to 9.6) and points to the excursion', (pg_temp.sf_ent('Hour', 180)).result = 'Fail'
  AND (pg_temp.sf_ent('Hour', 180)).failure_reason = 'See the excursion ' || (pg_temp.sf_ent('Excursion', 200)).entry_code AND (pg_temp.sf_ent('Hour', 180)).problems[1] LIKE 'Temperature rose to 9.6 °C (above 8)');
SELECT pg_temp.expect_true('The 50-minute silence is a no-data entry (6:00 to 6:50); the 15-minute one is not',
  (pg_temp.sf_ent('No data', 360)).period_end = pg_temp.sf_a(410) AND (pg_temp.sf_ent('No data', 360)).sensor_summary->>'minutes' = '50'
  AND (pg_temp.sf_ent('No data', 360)).result = 'Fail' AND (SELECT count(*) FROM logbook_entry WHERE sensor_link_id = pg_temp.sf_lnk() AND sensor_kind = 'No data') = 1);
SELECT pg_temp.expect_true('Recorded by the sensor feed, signed "Automated sensor feed"', (SELECT bool_and(e.source = 'Sensor feed' AND s.method = 'Automated sensor feed' AND u.username = 'sensor.feed')
   FROM logbook_entry e JOIN signature_event s ON s.id = e.recorded_signature_id JOIN app_user u ON u.id = e.created_by WHERE e.sensor_link_id = pg_temp.sf_lnk()));
SELECT pg_temp.expect_true('Reading again changes nothing', sensor_feed_refresh(pg_temp.sf_lnk()) = '{"new": 0, "updated": 0, "voided": 0}');
SELECT pg_temp.expect_true('QC Review: the excursion and the silence each cover exactly their period; the hours flag nothing',
  (SELECT count(*) FROM equipment_failure_view w WHERE w.logbook_entry_id IN ((pg_temp.sf_ent('Excursion', 200)).id, (pg_temp.sf_ent('No data', 360)).id)) = 2
  AND (SELECT window_start = pg_temp.sf_a(200) AND window_end = pg_temp.sf_a(225) FROM equipment_failure_view WHERE logbook_entry_id = (pg_temp.sf_ent('Excursion', 200)).id)
  AND NOT EXISTS (SELECT 1 FROM equipment_failure_view w JOIN logbook_entry e ON e.id = w.logbook_entry_id WHERE e.sensor_kind = 'Hour'));
SELECT pg_temp.expect_true('The equipment''s range over 3:00-4:00: 12 readings, 4.5 to 9.6', (SELECT n = 12 AND lo = 4.5 AND hi = 9.6 FROM sensor_range(pg_temp.sf_eqx(), 'temperature', pg_temp.sf_a(180), pg_temp.sf_a(235))));

-- 4. people: the reason, never the readings; QA approves with the reason only
SELECT pg_temp.sf_as('e.ana');
SELECT pg_temp.expect_error_like('Nobody records a sensor entry by hand',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, sensor_link_id, sensor_kind, period_start, sensor_summary) VALUES (pg_temp.sf_lbx(), pg_temp.sf_eqx(), pg_temp.sf_lnk(), 'Hour', now(), '{}')$$, 'only by the sensor feed');
SELECT pg_temp.expect_error_like('A sensor entry''s readings are not changed by hand', $$UPDATE logbook_entry SET entry_values = '{"temperature": 5}' WHERE id = (pg_temp.sf_ent('Excursion', 200)).id$$, 'comes from a sensor');
SELECT pg_temp.expect_error_like('An hour takes its reason from its excursion', $$UPDATE logbook_entry SET failure_reason = 'x' WHERE id = (pg_temp.sf_ent('Hour', 180)).id$$, 'give the reason on its excursion');
SELECT pg_temp.sf_as('e.qa');
SELECT pg_temp.expect_error_like('QA cannot approve the excursion before its reason is given', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.sf_ent('Excursion', 200)).id])$$, 'needs its reason');
SELECT pg_temp.sf_as('e.ana', false);
SELECT pg_temp.expect_error_like('Giving the reason is signed (a signing logbook)', $$UPDATE logbook_entry SET failure_reason = 'Door left open' WHERE id = (pg_temp.sf_ent('Excursion', 200)).id$$, 'electronic signature');
SELECT pg_temp.sf_as('e.ana');
SELECT pg_temp.expect_error_like('An empty reason is refused', $$UPDATE logbook_entry SET failure_reason = ' ' WHERE id = (pg_temp.sf_ent('Excursion', 200)).id$$, 'Give the reason');
SELECT pg_temp.expect_ok('The analyst gives the reason (signed)', $$UPDATE logbook_entry SET failure_reason = 'Door left open during the restock; closed, product checked' WHERE id = (pg_temp.sf_ent('Excursion', 200)).id$$);
SELECT pg_temp.expect_true('... kept, with the readings unchanged', (pg_temp.sf_ent('Excursion', 200)).failure_reason LIKE 'Door left open%' AND (pg_temp.sf_ent('Excursion', 200)).entry_values = '{"temperature": 9.6}'
  AND (pg_temp.sf_ent('Excursion', 200)).result = 'Fail');
SELECT pg_temp.sf_as('e.qa');
SELECT pg_temp.expect_ok('QA approves the excursion, hour 3 and hour 6 (signed)', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.sf_ent('Excursion', 200)).id, (pg_temp.sf_ent('Hour', 180)).id, (pg_temp.sf_ent('Hour', 360)).id])$$);

-- 5. late readings: the gateway sends 6:05-6:45
SELECT pg_temp.sf_feed();
SELECT pg_temp.expect_true('The late readings arrive (9)', sensor_add_readings(pg_temp.sf_lnk(), pg_temp.sf_rows(p_only => '{365,370,375,380,385,390,395,400,405}')) = 9);
SELECT pg_temp.expect_true('The refresh corrects hour 6 and voids the silence they fill', sensor_feed_refresh(pg_temp.sf_lnk()) = '{"new": 0, "updated": 1, "voided": 1}');
SELECT pg_temp.expect_true('Hour 6 now has 12 readings and goes back to QA (it was approved)', (pg_temp.sf_ent('Hour', 360)).sensor_summary->>'n' = '12' AND (pg_temp.sf_ent('Hour', 360)).status = 'Recorded');
SELECT pg_temp.expect_true('... the correction''s reason: late readings from the sensor', EXISTS (SELECT 1 FROM audit_log a WHERE a.record_id = (pg_temp.sf_ent('Hour', 360)).id AND a.action = 'UPDATE' AND a.reason = 'Late readings from the sensor'));
SELECT pg_temp.expect_true('The no-data entry is voided (filled by late readings)', (SELECT status = 'Voided' AND void_reason LIKE 'Late readings%' FROM logbook_entry WHERE sensor_link_id = pg_temp.sf_lnk() AND sensor_kind = 'No data'));
SELECT pg_temp.expect_true('The approved excursion is untouched', (pg_temp.sf_ent('Excursion', 200)).status = 'Approved');

-- 6. retiring the link
SELECT pg_temp.sf_as('e.sup');
SELECT pg_temp.expect_error_like('Retiring a link needs a reason', $$SELECT retire_sensor_link(pg_temp.sf_lnk(), '')$$, 'Say why');
SELECT pg_temp.expect_ok('The Lab Supervisor retires it (signed, with a reason)', $$SELECT retire_sensor_link((SELECT id FROM sensor_link WHERE external_id = 'R501'), 'Sensor moved to the new fridge')$$);
SELECT pg_temp.sf_feed();
SELECT pg_temp.expect_true('A retired link records nothing', sensor_add_readings((SELECT id FROM sensor_link WHERE external_id = 'R501'), pg_temp.sf_rows()) = 0
  AND sensor_feed_refresh((SELECT id FROM sensor_link WHERE external_id = 'R501')) = '{"skipped": true}');
SELECT pg_temp.sf_as('e.sup', false);
SELECT pg_temp.expect_error_like('Only a system administrator sets the connection', $$UPDATE sensor_connection SET enabled = true WHERE site_id = (SELECT id FROM lab_site WHERE site_code = 'CFL')$$, 'system administrator');
SELECT pg_temp.expect_true('Every lab has a connection, switched off', (SELECT count(*) = (SELECT count(*) FROM lab_site) AND bool_and(NOT enabled) FROM sensor_connection));

SELECT set_config('lims.sensor_feed', '', false);
SELECT format('%-104s %s', test, outcome) AS result FROM results;
