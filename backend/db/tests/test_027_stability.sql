-- Verification for migration 032: stability studies. The preset conditions and who keeps conditions, chambers and
-- racks; the stability quote (SQ- codes, the design locked once issued, refused while it has an Error, lines never
-- orderable by hand, a line's quantity = its cells); acceptance creating the study and its T0 order; placement in
-- racks (the chamber's condition, the material check, the T0 sample logged, the pulls scheduled inside their
-- window off non-working days); pull orders on their date; recording a pull (units out of storage, the window, the
-- turnaround from the scheduled date); the price escalation by study year; the records changed only by their steps.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
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
CREATE OR REPLACE FUNCTION pg_temp.t26as(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.t26site(c text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = c $$;
CREATE OR REPLACE FUNCTION pg_temp.t26cond(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM stability_condition WHERE condition_name = n AND site_id IS NULL $$;
CREATE OR REPLACE FUNCTION pg_temp.t26v() RETURNS uuid LANGUAGE sql AS $$
  SELECT pv.id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_name = 'Rule test stability' ORDER BY pv.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.t26tp(l text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM stability_timepoint WHERE project_version_id = pg_temp.t26v() AND label = l AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.t26line(code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT q.id FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id WHERE q.project_version_id = pg_temp.t26v() AND t.test_code = code AND q.status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.t26study() RETURNS stability_study LANGUAGE sql AS $$ SELECT * FROM stability_study WHERE project_id = (SELECT id FROM project WHERE project_name = 'Rule test stability') $$;

SELECT pg_temp.t26as('akiddle');
SELECT set_config('lims.site_id', pg_temp.t26site('CFL')::text, false);

-- 1. conditions, chambers, racks
SELECT pg_temp.expect_true('The ICH conditions are preset for every lab (25/60, 30/65, 30/75, 40/75, 5 °C, -20 °C)',
  (SELECT count(*) FROM stability_condition WHERE site_id IS NULL) = 6 AND pg_temp.t26cond('40 °C / 75% RH') IS NOT NULL);
SELECT pg_temp.t26as('p.qa');
SELECT pg_temp.expect_error_like('A condition for every lab needs a system administrator',
  $$INSERT INTO stability_condition (site_id, condition_name, condition_type, temperature_c) VALUES (NULL, '35 °C', 'Other', 35)$$, 'system administrator');
SELECT pg_temp.expect_ok('QA adds a condition for their lab', $$INSERT INTO stability_condition (site_id, condition_name, condition_type, temperature_c, humidity_pct) VALUES (pg_temp.t26site('CFL'), '35 °C / 50% RH', 'Other', 35, 50)$$);
SELECT pg_temp.expect_ok('QA sets up chambers and racks',
  $$INSERT INTO stability_chamber (equipment_id, condition_id) SELECT id, pg_temp.t26cond('25 °C / 60% RH') FROM equipment WHERE equipment_name = 'HPLC T1';
    INSERT INTO stability_chamber (equipment_id, condition_id) SELECT id, pg_temp.t26cond('40 °C / 75% RH') FROM equipment WHERE equipment_name = 'Viscometer 2';
    INSERT INTO stability_rack (chamber_id, rack_code, positions) SELECT c.id, 'R1', 20 FROM stability_chamber c JOIN equipment e ON e.id = c.equipment_id WHERE e.equipment_name IN ('HPLC T1','Viscometer 2');
    INSERT INTO stability_rack (chamber_id, rack_code) SELECT c.id, 'R2' FROM stability_chamber c JOIN equipment e ON e.id = c.equipment_id WHERE e.equipment_name = 'Viscometer 2'$$);
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): retired equipment is not a chamber
SELECT pg_temp.expect_true('A chamber takes its lab from its equipment', (SELECT bool_and(site_id = pg_temp.t26site('CFL')) FROM stability_chamber));
SELECT pg_temp.expect_error_like('Rack codes are unique in a chamber',
  $$INSERT INTO stability_rack (chamber_id, rack_code) SELECT c.id, 'r1' FROM stability_chamber c JOIN equipment e ON e.id = c.equipment_id WHERE e.equipment_name = 'Viscometer 2'$$, 'stability_rack_code_uq');
SELECT pg_temp.t26as('p.exec');
SELECT pg_temp.expect_error_like('Without stability.configure, no racks',
  $$INSERT INTO stability_rack (chamber_id, rack_code) SELECT c.id, 'R9' FROM stability_chamber c JOIN equipment e ON e.id = c.equipment_id WHERE e.equipment_name = 'Viscometer 2'$$, 'permission');
SELECT pg_temp.t26as('akiddle');

-- 2. the stability quote
INSERT INTO project (client_id, project_name, kind, site_id) SELECT id, 'Rule test stability', 'Stability', pg_temp.t26site('CFL') FROM client WHERE legal_name = 'Beta Foods LLC';
SELECT pg_temp.expect_true('A stability quote gets an SQ- code', (SELECT project_code ~ '^SQ-\d{5}$' FROM project WHERE project_name = 'Rule test stability'));
SELECT new_project_version(id) FROM project WHERE project_name = 'Rule test stability';
INSERT INTO stability_plan (project_version_id, site_id, product, lot, unit_name, escalation_pct, reserve_pct)
VALUES (pg_temp.t26v(), pg_temp.t26site('CFL'), 'Fish oil softgels', 'FO-2610', 'bottles', 3, 10);
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): the study is stored and tested by the quote's lab
INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
VALUES (pg_temp.t26v(), pg_temp.t26cond('25 °C / 60% RH'), 1), (pg_temp.t26v(), pg_temp.t26cond('40 °C / 75% RH'), 2);
INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late)
VALUES (pg_temp.t26v(), 'T0', 0, 'Months', 0, 0), (pg_temp.t26v(), '1 M', 1, 'Months', 7, 7), (pg_temp.t26v(), '3 M', 3, 'Months', 7, 7), (pg_temp.t26v(), '14 M', 14, 'Months', 7, 7);
INSERT INTO quoted_test_configuration (project_version_id, test_id) SELECT pg_temp.t26v(), id FROM test WHERE test_code IN ('T-00001','T-00002');
UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id = pg_temp.t26v();
SELECT pg_temp.expect_error_like('Issuing is refused while the design has an Error (tests in no cell)',
  $$UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.t26v()$$, 'not at any timepoint');
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): T0 has no storage condition
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): a pull is for one of the study's conditions
-- the matrix: moisture at T0 and every pull at both conditions; metals at T0 and 14 M at 25/60
INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required)
SELECT pg_temp.t26v(), pg_temp.t26line('T-00002'), t.id, CASE WHEN t.interval_value = 0 THEN NULL ELSE c.condition_id END, 2
  FROM stability_timepoint t, (SELECT condition_id FROM stability_version_condition WHERE project_version_id = pg_temp.t26v()) c
 WHERE t.project_version_id = pg_temp.t26v() AND (t.interval_value > 0 OR c.condition_id = pg_temp.t26cond('25 °C / 60% RH'));
INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required)
VALUES (pg_temp.t26v(), pg_temp.t26line('T-00001'), pg_temp.t26tp('T0'), NULL, 1), (pg_temp.t26v(), pg_temp.t26line('T-00001'), pg_temp.t26tp('14 M'), pg_temp.t26cond('25 °C / 60% RH'), 1);
SELECT pg_temp.expect_true('A line''s quantity is the number of times the study performs it (moisture 7, metals 2)',
  (SELECT quantity FROM quoted_test_configuration WHERE id = pg_temp.t26line('T-00002')) = 7 AND (SELECT quantity FROM quoted_test_configuration WHERE id = pg_temp.t26line('T-00001')) = 2);
SELECT pg_temp.expect_true('The design has no Error now (warnings only)', NOT EXISTS (SELECT 1 FROM stability_quote_problems(pg_temp.t26v()) WHERE severity = 'Error'));
SELECT pg_temp.expect_ok('The quote is issued', $$UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.t26v()$$);
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): the design is locked once issued (StabilityService refuses a version that is not Draft or Submitted)
SELECT pg_temp.expect_true('A stability quote''s tests are never orderable by hand',
  NOT EXISTS (SELECT 1 FROM orderable_lines((SELECT id FROM client WHERE legal_name = 'Beta Foods LLC')) WHERE line_id IN (pg_temp.t26line('T-00001'), pg_temp.t26line('T-00002'))));

-- 3. acceptance creates the study and its T0 order
UPDATE project_version SET status = 'Accepted', accepted_at = now() - interval '120 days', accepted_by_contact_id = (SELECT cc.contact_id FROM client_contact cc JOIN client c ON c.id = cc.client_id
  WHERE c.legal_name = 'Beta Foods LLC' AND 'ORDERING' = ANY(cc.roles) LIMIT 1) WHERE id = pg_temp.t26v();
SELECT pg_temp.expect_true('Accepting the quote creates the study (STB-), awaiting its material',
  ((pg_temp.t26study()).study_code ~ '^STB-\d{5}$') AND (pg_temp.t26study()).status = 'Awaiting material' AND (pg_temp.t26study()).escalation_pct = 3);
SELECT pg_temp.expect_true('and its T0 order (Stability Baseline) with the baseline sample Expected and the two T0 tests',
  (SELECT o.origin::text = 'Stability Baseline' AND o.status::text = 'Submitted' FROM lab_order o WHERE o.id = (pg_temp.t26study()).t0_order_id)
  AND (SELECT status::text FROM sample WHERE id = (pg_temp.t26study()).t0_sample_id) = 'Expected'
  AND (SELECT count(*) FROM requested_test WHERE sample_id = (pg_temp.t26study()).t0_sample_id AND stability_study_id = (pg_temp.t26study()).id) = 2);
SELECT pg_temp.expect_error_like('Nobody changes a study record directly', $$UPDATE stability_study SET status = 'Active' WHERE id = (pg_temp.t26study()).id$$, 'only through');
SELECT pg_temp.expect_error_like('Nobody orders the study''s tests by hand',
  $$INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id) SELECT (pg_temp.t26study()).t0_sample_id, q.test_id,
     (SELECT id FROM test_version WHERE test_id = q.test_id AND status = 'Effective'), q.id FROM quoted_test_configuration q WHERE q.id = pg_temp.t26line('T-00002')$$, 'ordered by its study');

-- 4. placement
CREATE TEMP TABLE t26r AS SELECT r.id, r.rack_code, e.equipment_name FROM stability_rack r JOIN stability_chamber c ON c.id = r.chamber_id JOIN equipment e ON e.id = c.equipment_id;
SELECT pg_temp.t26as('p.exec');
SELECT pg_temp.expect_error_like('Without stability.manage, no placement', $$SELECT place_stability_study((pg_temp.t26study()).id, current_date, '[]', 2)$$, 'permission');
SELECT pg_temp.t26as('akiddle');
SELECT pg_temp.expect_error_like('Each condition goes into a chamber set to it',
  format($$SELECT place_stability_study((pg_temp.t26study()).id, site_today(pg_temp.t26site('CFL')) - 100,
    '[{"condition_id":"%s","rack_id":"%s","units":20},{"condition_id":"%s","rack_id":"%s","units":3}]', 3)$$,
    pg_temp.t26cond('25 °C / 60% RH'), (SELECT id FROM t26r WHERE equipment_name = 'Viscometer 2' AND rack_code = 'R1'),
    pg_temp.t26cond('40 °C / 75% RH'), (SELECT id FROM t26r WHERE equipment_name = 'Viscometer 2' AND rack_code = 'R2')), 'chamber set to');
SELECT pg_temp.expect_ok('Placed 100 days ago: 20 bottles at 25/60, 3 at 40/75 (short), 3 for T0',
  format($$SELECT place_stability_study((pg_temp.t26study()).id, site_today(pg_temp.t26site('CFL')) - 100,
    '[{"condition_id":"%s","rack_id":"%s","position":"Shelf 1 / A1","units":20},{"condition_id":"%s","rack_id":"%s","position":"B2","units":3}]', 3)$$,
    pg_temp.t26cond('25 °C / 60% RH'), (SELECT id FROM t26r WHERE equipment_name = 'HPLC T1'),
    pg_temp.t26cond('40 °C / 75% RH'), (SELECT id FROM t26r WHERE equipment_name = 'Viscometer 2' AND rack_code = 'R2')));
SELECT pg_temp.expect_true('The study is Active; the T0 sample is logged with 3 units',
  (pg_temp.t26study()).status = 'Active' AND (SELECT status::text = 'Logged' AND number_of_units = 3 FROM sample WHERE id = (pg_temp.t26study()).t0_sample_id));
SELECT pg_temp.expect_true('Material check: 40/75 needs 3 pulls x 2 + 10% = 7 bottles, 3 placed: 4 short; 25/60 is enough',
  (SELECT shortfall = 4 AND units_required = 7 FROM stability_storage s WHERE s.study_id = (pg_temp.t26study()).id AND s.condition_id = pg_temp.t26cond('40 °C / 75% RH'))
  AND (SELECT shortfall = 0 FROM stability_storage s WHERE s.study_id = (pg_temp.t26study()).id AND s.condition_id = pg_temp.t26cond('25 °C / 60% RH')));
SELECT pg_temp.expect_true('The stored material is labelled STB-...-1, -2 and sits in its rack and position',
  (SELECT string_agg(storage_code || '@' || COALESCE(position, ''), ',' ORDER BY storage_code) FROM stability_storage WHERE study_id = (pg_temp.t26study()).id)
   = (pg_temp.t26study()).study_code || '-1@Shelf 1 / A1,' || (pg_temp.t26study()).study_code || '-2@B2');
SELECT pg_temp.expect_true('Pulls are scheduled for each condition and timepoint in the matrix (3 at 25/60, 3 at 40/75)',
  (SELECT count(*) FROM stability_pull WHERE study_id = (pg_temp.t26study()).id) = 6);
SELECT pg_temp.expect_true('Each pull: nominal = placement + interval, window ± 7 days, scheduled on a working day inside the window',
  (SELECT bool_and(nominal_date = stability_interval_date((pg_temp.t26study()).placement_date, t.interval_value, t.interval_unit)
                   AND window_start = nominal_date - 7 AND window_end = nominal_date + 7 AND scheduled_date BETWEEN window_start AND window_end
                   AND is_working_day(pg_temp.t26site('CFL'), scheduled_date))
     FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id WHERE p.study_id = (pg_temp.t26study()).id));
SELECT pg_temp.expect_true('A Saturday moves to Monday (inside the window), or back to Friday when the window does not reach',
  stability_adjust_date(pg_temp.t26site('CFL'), date '2027-01-09', 7, 7) = date '2027-01-11' AND stability_adjust_date(pg_temp.t26site('CFL'), date '2027-01-09', 2, 1) = date '2027-01-08');

-- 5. pull orders on their date
SELECT pg_temp.expect_true('The pulls already due (1 M and 3 M, both conditions) got their orders at placement; the 14 M pull waits',
  (SELECT count(*) FROM stability_pull WHERE study_id = (pg_temp.t26study()).id AND status = 'Ordered') = 4
  AND (SELECT bool_and(p.status = 'Scheduled') FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id WHERE p.study_id = (pg_temp.t26study()).id AND t.label = '14 M'));
SELECT pg_temp.expect_true('A pull order is origin Stability Pull, its sample Expected with the cells'' tests',
  (SELECT bool_and(o.origin::text = 'Stability Pull' AND sa.status::text = 'Expected'
                   AND (SELECT count(*) FROM requested_test rt WHERE rt.sample_id = sa.id AND rt.stability_pull_id = p.id) = 1)
     FROM stability_pull p JOIN lab_order o ON o.id = p.lab_order_id JOIN sample sa ON sa.id = p.sample_id WHERE p.study_id = (pg_temp.t26study()).id AND p.status = 'Ordered'));
SELECT pg_temp.expect_true('Running it again makes nothing new', create_due_stability_pulls(pg_temp.t26site('CFL')) = 0);

-- 6. recording a pull
CREATE TEMP TABLE t26p AS SELECT p.id, t.label, sc.condition_name, p.window_start, p.window_end, p.scheduled_date, p.sample_id FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id
  JOIN stability_condition sc ON sc.id = p.condition_id WHERE p.study_id = (pg_temp.t26study()).id;
SELECT pg_temp.expect_error_like('A pull not yet due cannot be recorded', $$SELECT record_stability_pull((SELECT id FROM t26p WHERE label = '14 M' AND condition_name = '25 °C / 60% RH'), now(), 1, '')$$, 'not due');
SELECT pg_temp.expect_error_like('Outside its window a pull needs a note',
  $$SELECT record_stability_pull((SELECT id FROM t26p WHERE label = '1 M' AND condition_name = '25 °C / 60% RH'), now(), 2, '')$$, 'outside its window');
SELECT pg_temp.expect_error_like('More than is left in storage is refused',
  $$SELECT record_stability_pull((SELECT id FROM t26p WHERE label = '1 M' AND condition_name = '40 °C / 75% RH'), now(), 4, 'late')$$, 'Only 3 units');
SELECT pg_temp.expect_ok('Recorded inside its window (at the scheduled date)',
  $$SELECT record_stability_pull((SELECT id FROM t26p WHERE label = '1 M' AND condition_name = '25 °C / 60% RH'),
     ((SELECT scheduled_date FROM t26p WHERE label = '1 M' AND condition_name = '25 °C / 60% RH')::timestamp + interval '10 hours') AT TIME ZONE 'America/Los_Angeles', 2, '')$$);
SELECT pg_temp.expect_ok('Recorded late, with a note', $$SELECT record_stability_pull((SELECT id FROM t26p WHERE label = '3 M' AND condition_name = '25 °C / 60% RH'), now(), 2, 'Chamber access delayed')$$);
SELECT pg_temp.expect_true('Pulled: in or out of the window recorded, the units out of storage (20 - 4 = 16 left), the sample logged',
  (SELECT within_window FROM stability_pull WHERE id = (SELECT id FROM t26p WHERE label = '1 M' AND condition_name = '25 °C / 60% RH'))
  AND NOT (SELECT within_window FROM stability_pull WHERE id = (SELECT id FROM t26p WHERE label = '3 M' AND condition_name = '25 °C / 60% RH'))
  AND (SELECT units_left FROM stability_storage_view WHERE study_id = (pg_temp.t26study()).id AND condition_name = '25 °C / 60% RH') = 16
  AND (SELECT status::text FROM sample WHERE id = (SELECT sample_id FROM t26p WHERE label = '1 M' AND condition_name = '25 °C / 60% RH')) = 'Logged');
SELECT pg_temp.expect_true('A pull''s turnaround counts from its scheduled date, not from when it was logged',
  (SELECT bool_and(rt.day0 <= p.scheduled_date + 3 AND rt.day0 >= p.scheduled_date) FROM requested_test rt JOIN stability_pull p ON p.id = rt.stability_pull_id
    WHERE p.id = (SELECT id FROM t26p WHERE label = '3 M' AND condition_name = '25 °C / 60% RH')));

-- 7. price escalation by study year
SELECT pg_temp.expect_true('Study years count from acceptance; 3% a year compounds (year 3 = 1.0609)',
  stability_year(date '2026-10-14', date '2027-10-13') = 1 AND stability_year(date '2026-10-14', date '2027-10-14') = 2
  AND stability_price_factor(3, 3) = 1.0609);
SELECT pg_temp.expect_true('Year-one pulls are priced at the quoted price',
  (SELECT bool_and(rt.price = q.final_price) FROM requested_test rt JOIN quoted_test_configuration q ON q.id = rt.quoted_line_id
    WHERE rt.stability_study_id = (pg_temp.t26study()).id AND rt.status <> 'Cancelled'));

-- 8. setup that would strand material is refused; the audit trail links
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): a chamber holding study material keeps its condition
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): a condition on a quote keeps its temperature
SELECT pg_temp.expect_true('The audit trail links the study and the quote to their pages',
  (SELECT audit_record_ref('stability_study', id, to_jsonb(s)) ->> 'href' LIKE '#/stability/studies/%' FROM stability_study s WHERE id = (pg_temp.t26study()).id)
  AND (SELECT audit_record_ref('project', id, to_jsonb(p)) ->> 'href' LIKE '#/stability/quotes/%' FROM project p WHERE project_name = 'Rule test stability'));
-- (amending a running study came in S-2, migration 041: test_036)

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
