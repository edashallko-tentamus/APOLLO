-- Verification for migration 046: sensor entries after a change of limits (Alex's first test, 2026-10-19: an incubator
-- at 34 °C fed into a logbook whose limits were typed as 10 to 30). A regular read never applies a change of limits to
-- past entries, but closes the open excursion; re-judging is asked for (sensors.configure, signed, a reason) and done by
-- the feed: the excursion voided, the hours judged again (approved ones back to QA), the reason in the audit trail.
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
CREATE OR REPLACE FUNCTION pg_temp.rj_as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.sensor_feed', '', false);
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_feed() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'sensor.feed'), false);
  PERFORM set_config('lims.sensor_feed', '1', false);
  PERFORM sensor_feed_sign('Rule test readings');
  PERFORM set_config('lims.signature_id', current_setting('lims.signature_id'), false);
  RETURN 'feed';
END $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_lb() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM logbook WHERE logbook_name = 'Rule sensor rejudge' $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_eq() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE equipment_name = 'WD Balance 1' $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_lnk() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sensor_link WHERE external_id = 'R602' AND status <> 'Retired' $$;
CREATE TEMP TABLE IF NOT EXISTS rjt (k text PRIMARY KEY, t timestamptz);
DELETE FROM rjt;
INSERT INTO rjt VALUES ('A', date_trunc('hour', now()) - interval '11 hours');
CREATE OR REPLACE FUNCTION pg_temp.rj_a(m integer) RETURNS timestamptz LANGUAGE sql AS $$ SELECT t + make_interval(mins => m) FROM rjt WHERE k = 'A' $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_rows() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('guid', 'r' || m, 'at', pg_temp.rj_a(m), 'value', 34 + (m % 3) * 0.1) ORDER BY m)
    FROM generate_series(0, 24 * 60, 5) m WHERE pg_temp.rj_a(m) <= now() - interval '1 minute' $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_hour(m integer) RETURNS logbook_entry LANGUAGE sql AS $$
  SELECT * FROM logbook_entry WHERE sensor_link_id = pg_temp.rj_lnk() AND sensor_kind = 'Hour' AND period_start = pg_temp.rj_a(m) AND status <> 'Voided' $$;
CREATE OR REPLACE FUNCTION pg_temp.rj_ex() RETURNS logbook_entry LANGUAGE sql AS $$
  SELECT * FROM logbook_entry WHERE sensor_link_id = pg_temp.rj_lnk() AND sensor_kind = 'Excursion' ORDER BY period_start LIMIT 1 $$;
SELECT set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);

-- 0. an incubator's logbook with its limits typed wrongly (10 to 30), a sensor reading 34 °C
SELECT pg_temp.rj_as('e.sup');
INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule sensor rejudge', 'Temperature', 'Equipment', 'As needed', 'Daily');
INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, equipment_limits) VALUES
  ((SELECT id FROM logbook_version WHERE logbook_id = pg_temp.rj_lb()), 'temperature', 'Temperature', 'Number', 10, '°C', true);
INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (pg_temp.rj_lb(), pg_temp.rj_eq(), '{"temperature": {"min": 10, "max": 30}}');
SELECT pg_temp.rj_as('e.qa');
SELECT approve_logbook_version((SELECT id FROM logbook_version WHERE logbook_id = pg_temp.rj_lb()));
SELECT pg_temp.rj_as('e.sup');
INSERT INTO sensor_link (site_id, external_id, measures, equipment_id, logbook_id, field_key) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'R602', 'temperature', pg_temp.rj_eq(), pg_temp.rj_lb(), 'temperature');
SELECT pg_temp.rj_as('e.qa');
SELECT approve_sensor_link(pg_temp.rj_lnk(), pg_temp.rj_a(-5));
SELECT pg_temp.rj_feed();
SELECT sensor_add_readings(pg_temp.rj_lnk(), pg_temp.rj_rows());
SELECT pg_temp.expect_true('(the fixture: the link feeds; 11 hours of readings at 34 °C)', (SELECT count(*) > 130 FROM sensor_reading WHERE link_id = pg_temp.rj_lnk()));
CREATE TEMP TABLE IF NOT EXISTS rjx (x jsonb); DELETE FROM rjx;
INSERT INTO rjx SELECT sensor_feed_refresh(pg_temp.rj_lnk());
SELECT pg_temp.expect_true('Against 10 to 30: 12 entries recorded ' || (SELECT x::text FROM rjx), (SELECT (x->>'new')::int = 12 FROM rjx));
SELECT pg_temp.expect_true('... one excursion, still open, judged against 10 to 30', (pg_temp.rj_ex()).period_end IS NULL AND (pg_temp.rj_ex()).sensor_summary @> '{"lo": 10, "hi": 30, "open": true}');
SELECT pg_temp.expect_true('... and 11 failing hours, each judged against those limits',
  (SELECT count(*) FROM logbook_entry WHERE sensor_link_id = pg_temp.rj_lnk() AND sensor_kind = 'Hour' AND result = 'Fail' AND sensor_summary @> '{"lo": 10, "hi": 30}') = 11);
SELECT pg_temp.rj_as('e.qa');
SELECT pg_temp.expect_ok('QA approves three of the hours', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.rj_hour(0)).id, (pg_temp.rj_hour(60)).id, (pg_temp.rj_hour(120)).id])$$);

-- 1. the limits corrected: a regular read closes the excursion and changes nothing else
SELECT pg_temp.rj_as('e.sup');
SELECT pg_temp.expect_ok('The Lab Supervisor corrects the limits to 33 to 37', $$UPDATE logbook_equipment SET limits = '{"temperature": {"min": 33, "max": 37}}' WHERE logbook_id = pg_temp.rj_lb() AND equipment_id = pg_temp.rj_eq()$$);
SELECT pg_temp.rj_feed();
SELECT pg_temp.expect_true('A regular read: the open excursion ends at the first reading inside 33 to 37; nothing voided, no hour changed',
  sensor_feed_refresh(pg_temp.rj_lnk()) = '{"new": 0, "updated": 1, "voided": 0}' AND (pg_temp.rj_ex()).period_end = pg_temp.rj_a(5) AND (pg_temp.rj_ex()).status <> 'Voided');
SELECT pg_temp.expect_true('... the hours keep the judgement they were recorded with (Fail against 10 to 30; the approved ones stay approved)',
  (pg_temp.rj_hour(240)).result = 'Fail' AND (pg_temp.rj_hour(240)).sensor_summary @> '{"lo": 10, "hi": 30}' AND (pg_temp.rj_hour(60)).status = 'Approved');
SELECT pg_temp.expect_true('QC Review: the excursion no longer flags without an end', (SELECT window_end FROM equipment_failure_view WHERE logbook_entry_id = (pg_temp.rj_ex()).id) = pg_temp.rj_a(5));

-- 2. asking for the entries to be judged again
SELECT pg_temp.rj_as('e.ana');
SELECT pg_temp.expect_error_like('An analyst cannot ask for it (sensors.configure)', $$SELECT request_sensor_rejudge(pg_temp.rj_lnk(), pg_temp.rj_a(-5), 'x')$$, 'sensors.configure');
SELECT pg_temp.rj_as('e.sup', false);
SELECT pg_temp.expect_error_like('Asking is signed', $$SELECT request_sensor_rejudge(pg_temp.rj_lnk(), pg_temp.rj_a(-5), 'x')$$, 'electronic signature');
SELECT pg_temp.rj_as('e.sup');
SELECT pg_temp.expect_error_like('... with a reason', $$SELECT request_sensor_rejudge(pg_temp.rj_lnk(), pg_temp.rj_a(-5), ' ')$$, 'Say why');
SELECT pg_temp.expect_error_like('... from a date not in the future', $$SELECT request_sensor_rejudge(pg_temp.rj_lnk(), now() + interval '1 hour', 'x')$$, 'from when');
SELECT pg_temp.expect_error_like('A link is still changed only through its actions', $$UPDATE sensor_link SET rejudge_from = now() WHERE id = pg_temp.rj_lnk()$$, 'retire it');
SELECT pg_temp.expect_ok('The Lab Supervisor asks (signed): the limits were typed as 10 to 30', $$SELECT request_sensor_rejudge(pg_temp.rj_lnk(), pg_temp.rj_a(-60), 'Limits typed as 10 to 30; corrected to 33 to 37')$$);
SELECT pg_temp.expect_true('... from the start of the feed at the earliest; the request waits for the feed', (SELECT rejudge_from = feeds_from AND rejudge_by = (SELECT id FROM app_user WHERE username = 'e.sup') FROM sensor_link WHERE id = pg_temp.rj_lnk()));

-- 3. the feed judges them again
SELECT pg_temp.rj_feed();
SELECT pg_temp.expect_true('The next read judges them again: the excursion voided, the 11 hours changed', sensor_feed_refresh(pg_temp.rj_lnk()) = '{"new": 0, "updated": 11, "voided": 1, "rejudged": true}');
SELECT pg_temp.expect_true('The excursion is voided, saying why and who asked', (pg_temp.rj_ex()).status = 'Voided'
  AND (pg_temp.rj_ex()).void_reason LIKE 'Re-judged against the corrected limits: Limits typed as 10 to 30; corrected to 33 to 37 (asked by %)');
SELECT pg_temp.expect_true('Every hour now passes against 33 to 37, no longer pointing to an excursion', (SELECT bool_and(result = 'Pass' AND failure_reason IS NULL AND sensor_summary @> '{"lo": 33, "hi": 37, "excursions": []}')
  FROM logbook_entry WHERE sensor_link_id = pg_temp.rj_lnk() AND sensor_kind = 'Hour' AND status <> 'Voided'));
SELECT pg_temp.expect_true('The approved hours go back to QA', (pg_temp.rj_hour(0)).status = 'Recorded' AND (pg_temp.rj_hour(60)).status = 'Recorded');
SELECT pg_temp.expect_true('The audit trail of each hour says it was re-judged and why', EXISTS (SELECT 1 FROM audit_log a WHERE a.record_id = (pg_temp.rj_hour(240)).id AND a.action = 'UPDATE'
  AND a.reason LIKE 'Re-judged against the corrected limits: Limits typed as 10 to 30%'));
SELECT pg_temp.expect_true('The request is cleared', (SELECT rejudge_from IS NULL AND rejudge_reason IS NULL FROM sensor_link WHERE id = pg_temp.rj_lnk()));
SELECT pg_temp.expect_true('Reading again changes nothing', sensor_feed_refresh(pg_temp.rj_lnk()) = '{"new": 0, "updated": 0, "voided": 0}');
SELECT pg_temp.expect_true('Nothing of this sensor flags QC Review any more', NOT EXISTS (SELECT 1 FROM equipment_failure_view w JOIN logbook_entry e ON e.id = w.logbook_entry_id WHERE e.sensor_link_id = pg_temp.rj_lnk()));

SELECT set_config('lims.sensor_feed', '', false);
SELECT format('%-104s %s', test, outcome) AS result FROM results;
