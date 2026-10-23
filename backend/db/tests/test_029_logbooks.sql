-- Verification for migration 034: electronic logbooks (L-1). Who designs, approves and records; the design checked
-- before QA approves it (not its author), locked once Effective, a new version from it; entries checked field by
-- field, calculated, judged against limits (the field's, the equipment's, a stability chamber's condition), a failed
-- entry needs its reason; signing (or only recording); QA approves (signed, never their own) or returns; corrections
-- need a reason and go back to QA; voiding; overdue reviews and entries due; a lot made by an entry (with its
-- culture's organism) and a value across logbooks; equipment flags in QC Review and the reviewer's acceptance;
-- stability excursions.
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
-- act as a user (signed, or not)
CREATE OR REPLACE FUNCTION pg_temp.lb_as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.lb(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM logbook WHERE logbook_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.lbv(n text) RETURNS uuid LANGUAGE sql AS $$
  SELECT v.id FROM logbook_version v JOIN logbook l ON l.id = v.logbook_id WHERE l.logbook_name = n ORDER BY v.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.lbeq(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM equipment WHERE equipment_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.lbent(c text) RETURNS logbook_entry LANGUAGE sql AS $$ SELECT * FROM logbook_entry WHERE entry_code = c $$;
CREATE TEMP TABLE IF NOT EXISTS lbt (k text PRIMARY KEY, v text);
DELETE FROM lbt;
CREATE OR REPLACE FUNCTION pg_temp.keep(k text, v text) RETURNS void LANGUAGE sql AS $$ INSERT INTO lbt VALUES (k, v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $$;
CREATE OR REPLACE FUNCTION pg_temp.got(k text) RETURNS text LANGUAGE sql AS $$ SELECT v FROM lbt WHERE lbt.k = got.k $$;
SELECT set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);

-- 1. designing a logbook
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_error_like('An analyst cannot design a logbook (logbook.design)',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule balance check', 'Equipment check', 'Equipment')$$, 'logbook.design');
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_ok('A Lab Supervisor designs one (logbook.design)',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule balance check', 'Equipment check', 'Equipment', 'Daily', 'Daily')$$);
SELECT pg_temp.expect_true('It gets an LB- code and a Draft version 1', (SELECT l.logbook_code ~ '^LB-\d{4}$' AND v.status = 'Draft' AND v.version_no = 1
   FROM logbook l JOIN logbook_version v ON v.logbook_id = l.id WHERE l.logbook_name = 'Rule balance check'));
SELECT pg_temp.expect_error_like('A field key is lower-case letters, digits and _',
  $$INSERT INTO logbook_field (version_id, field_key, label, field_type) VALUES (pg_temp.lbv('Rule balance check'), '9x', 'Bad', 'Number')$$, 'lower-case');
SELECT pg_temp.expect_error_like('A Choice field lists its choices',
  $$INSERT INTO logbook_field (version_id, label, field_type) VALUES (pg_temp.lbv('Rule balance check'), 'Grade', 'Choice')$$, 'lists its choices');
SELECT pg_temp.expect_error_like('Only a logbook about lots publishes values',
  $$INSERT INTO logbook_field (version_id, label, field_type, publish) VALUES (pg_temp.lbv('Rule balance check'), 'Reading', 'Number', true)$$, 'publishes values');
SELECT pg_temp.expect_error_like('A lower limit above the upper limit is refused',
  $$INSERT INTO logbook_field (version_id, label, field_type, limit_min, limit_max) VALUES (pg_temp.lbv('Rule balance check'), 'Reading', 'Number', 5, 1)$$, 'above the upper limit');
SELECT pg_temp.expect_ok('Fields: check weight, nominal, reading, and the error calculated with a limit per balance',
  $$INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, limit_max, equipment_limits, formula) VALUES
    (pg_temp.lbv('Rule balance check'), 'check_weight', 'Check weight ID', 'Text', 10, NULL, NULL, false, NULL),
    (pg_temp.lbv('Rule balance check'), 'nominal_g', 'Nominal (g)', 'Number', 20, 'g', NULL, false, NULL),
    (pg_temp.lbv('Rule balance check'), 'reading_g', 'Reading (g)', 'Number', 30, 'g', NULL, false, NULL),
    (pg_temp.lbv('Rule balance check'), 'error_pct', 'Error', 'Calculated', 40, '%', 0.1, true, 'abs({reading_g} - {nominal_g}) / {nominal_g} * 100 + {spare}')$$);
SELECT pg_temp.expect_true('The design is checked: a formula naming no field of the logbook is an Error',
  EXISTS (SELECT 1 FROM logbook_version_problems(pg_temp.lbv('Rule balance check')) x WHERE x.severity = 'Error' AND x.problem LIKE '%{spare} is not a field%'));
SELECT pg_temp.expect_true('... and covering no equipment is a Warning',
  EXISTS (SELECT 1 FROM logbook_version_problems(pg_temp.lbv('Rule balance check')) x WHERE x.severity = 'Warning' AND x.problem LIKE 'No equipment is covered%'));
SELECT pg_temp.lb_as('e.qa');
SELECT pg_temp.expect_error_like('A design with an Error cannot be approved', $$SELECT approve_logbook_version(pg_temp.lbv('Rule balance check'))$$, 'problem(s) to fix');
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_ok('The formula fixed', $$UPDATE logbook_field SET formula = 'abs({reading_g} - {nominal_g}) / {nominal_g} * 100' WHERE version_id = pg_temp.lbv('Rule balance check') AND field_key = 'error_pct'$$);
SELECT pg_temp.expect_error_like('A Lot or Equipment logbook covers equipment of its own lab only',
  $$INSERT INTO logbook_equipment (logbook_id, equipment_id) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('Balance T1'))$$, 'another lab');
SELECT pg_temp.expect_ok('It covers WD Balance 1 (error at most 0.05 %) and WD Balance 2 (the field''s 0.1 %)',
  $$INSERT INTO logbook_equipment (logbook_id, equipment_id, limits) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"error_pct": {"max": 0.05}}'),
    (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 2'), '{}')$$);
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_error_like('No entries before QA approves the design',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100}')$$, 'no approved design');
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_error_like('Only QA approves a design (logbook.review)', $$SELECT approve_logbook_version(pg_temp.lbv('Rule balance check'))$$, 'logbook.review');
SELECT pg_temp.lb_as('e.qa', false);
SELECT pg_temp.expect_error_like('Approving a design is signed', $$SELECT approve_logbook_version(pg_temp.lbv('Rule balance check'))$$, 'electronic signature');
SELECT pg_temp.lb_as('e.qa');
SELECT pg_temp.expect_ok('QA approves it (signed)', $$SELECT approve_logbook_version(pg_temp.lbv('Rule balance check'))$$);
SELECT pg_temp.expect_true('Version 1 is Effective, approved by QA with the signature', (SELECT v.status = 'Effective' AND v.approved_by = (SELECT id FROM app_user WHERE username = 'e.qa') AND v.signature_id IS NOT NULL
   FROM logbook_version v WHERE v.id = pg_temp.lbv('Rule balance check')));
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_error_like('An Effective design is locked', $$UPDATE logbook_field SET limit_max = 0.2 WHERE version_id = pg_temp.lbv('Rule balance check') AND field_key = 'error_pct'$$, 'start a new version');
SELECT pg_temp.expect_ok('A new version copies the design as a Draft', $$SELECT new_logbook_version(pg_temp.lb('Rule balance check'), 'Rule test')$$);
SELECT pg_temp.expect_true('... with its four fields', (SELECT count(*) = 4 FROM logbook_field WHERE version_id = pg_temp.lbv('Rule balance check') AND status = 'Active')
   AND (SELECT status FROM logbook_version WHERE id = pg_temp.lbv('Rule balance check')) = 'Draft');
SELECT pg_temp.expect_ok('Its author changes it', $$UPDATE logbook_field SET limit_max = 0.2 WHERE version_id = pg_temp.lbv('Rule balance check') AND field_key = 'error_pct'$$);
SELECT pg_temp.lb_as('p.qa');
SELECT pg_temp.expect_ok('(p.qa changes the help text of the Draft)', $$UPDATE logbook_field SET help = 'Use the class F1 weight' WHERE version_id = pg_temp.lbv('Rule balance check') AND field_key = 'check_weight'$$);
SELECT pg_temp.expect_error_like('... but nobody approves a design they worked on', $$SELECT approve_logbook_version(pg_temp.lbv('Rule balance check'))$$, 'You worked on this design');

-- 2. entries
SELECT pg_temp.lb_as('e.ana', false);
SELECT pg_temp.expect_error_like('A signing logbook needs the recorder''s signature',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100}')$$, 'electronic signature');
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_error_like('Equipment the logbook does not cover is refused',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('HPLC T1'), '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100}')$$, 'does not cover');
SELECT pg_temp.expect_error_like('A required field must be filled in',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"nominal_g": 100, "reading_g": 100}')$$, 'Enter Check weight ID');
SELECT pg_temp.expect_error_like('A number field takes numbers',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"check_weight": "CW1", "nominal_g": 100, "reading_g": "one hundred"}')$$, 'is not a number');
SELECT pg_temp.expect_error_like('An entry cannot be in the future',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), now() + interval '1 day', '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100}')$$, 'future');
-- the passing check an hour before the batch's weighing, and a failing one just after it
SELECT pg_temp.keep('used', (SELECT q.created_at::text FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id JOIN test_batch b ON b.id = r.batch_id
   WHERE q.equipment_id = pg_temp.lbeq('WD Balance 1') AND q.status = 'Active' AND b.status = 'Awaiting Review' ORDER BY q.created_at LIMIT 1));
SELECT pg_temp.keep('batch', (SELECT b.id::text FROM entry_equipment q JOIN step_run r ON r.id = q.step_run_id JOIN test_batch b ON b.id = r.batch_id
   WHERE q.equipment_id = pg_temp.lbeq('WD Balance 1') AND q.status = 'Active' AND b.status = 'Awaiting Review' ORDER BY q.created_at LIMIT 1));
SELECT pg_temp.expect_true('(a batch waiting for review weighed on WD Balance 1)', pg_temp.got('batch') IS NOT NULL);
SELECT pg_temp.expect_true('No equipment flag on it yet', NOT EXISTS (SELECT 1 FROM batch_equipment_flags(pg_temp.got('batch')::uuid)));
SELECT pg_temp.expect_ok('A passing check is recorded (signed)',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), pg_temp.got('used')::timestamptz - interval '1 hour', '{"check_weight": "CW1", "nominal_g": "100", "reading_g": "100.002"}')$$);
SELECT pg_temp.keep('pass1', (SELECT entry_code FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule balance check') ORDER BY created_at DESC LIMIT 1));
SELECT pg_temp.expect_true('It has an LBE- code, its error calculated (0.002 %), Pass, signed, and the numbers stored as numbers',
  (SELECT entry_code ~ '^LBE-\d{6}$' AND (entry_values->>'error_pct')::numeric = 0.002 AND result = 'Pass' AND recorded_signature_id IS NOT NULL
          AND jsonb_typeof(entry_values->'nominal_g') = 'number' AND status = 'Recorded' FROM pg_temp.lbent(pg_temp.got('pass1'))));
SELECT pg_temp.expect_error_like('A failing entry asks for the reason, naming what is outside its limit',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), pg_temp.got('used')::timestamptz + interval '1 second', '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100.08}')$$, 'Error 0.08 % is above 0.05');
SELECT pg_temp.expect_ok('With the reason, it is recorded as Fail',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, entry_values, failure_reason) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), pg_temp.got('used')::timestamptz + interval '1 second', '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100.08}', 'Draught from the open door; balance recalibrated by the supervisor')$$);
SELECT pg_temp.keep('fail1', (SELECT entry_code FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule balance check') ORDER BY created_at DESC LIMIT 1));
INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 2'), '{"check_weight": "CW2", "nominal_g": 100, "reading_g": 100.08}');
SELECT pg_temp.expect_true('The same reading passes on WD Balance 2 (its limit is the field''s 0.1 %)',
  (SELECT result = 'Pass' FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule balance check') ORDER BY created_at DESC LIMIT 1));

-- 3. equipment flags in QC Review
SELECT pg_temp.expect_true('The batch''s weighing on WD Balance 1, between the last passing check and the failing one, is flagged',
  EXISTS (SELECT 1 FROM batch_equipment_flags(pg_temp.got('batch')::uuid) f WHERE f.entry_code = pg_temp.got('fail1') AND NOT f.accepted AND f.what LIKE '%Draught from the open door%'));
SELECT pg_temp.expect_true('... and stops its approval until the reviewer accepts it',
  EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.got('batch')::uuid) p WHERE p.problem LIKE '%' || pg_temp.got('fail1') || '%the reviewer accepts it%'));
SELECT pg_temp.lb_as('wd.ana');
SELECT pg_temp.expect_error_like('Only a reviewer accepts it (the analyst who weighed cannot)',
  $$SELECT accept_equipment_flag(pg_temp.got('batch')::uuid, (pg_temp.lbent(pg_temp.got('fail1'))).id, 'Fine')$$, 'testing.review');
SELECT pg_temp.lb_as('wd.qa');
SELECT pg_temp.expect_error_like('Accepting needs a justification',
  $$SELECT accept_equipment_flag(pg_temp.got('batch')::uuid, (pg_temp.lbent(pg_temp.got('fail1'))).id, '  ')$$, 'Write why');
SELECT pg_temp.expect_ok('The reviewer accepts it with a justification',
  $$SELECT accept_equipment_flag(pg_temp.got('batch')::uuid, (pg_temp.lbent(pg_temp.got('fail1'))).id, 'Weighed before the draught; the next check passed')$$);
SELECT pg_temp.expect_true('The flag is kept, accepted, and no longer stops the approval',
  EXISTS (SELECT 1 FROM batch_equipment_flags(pg_temp.got('batch')::uuid) f WHERE f.entry_code = pg_temp.got('fail1') AND f.accepted AND f.accepted_by_name IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM batch_review_problems(pg_temp.got('batch')::uuid) p WHERE p.problem LIKE '%' || pg_temp.got('fail1') || '%'));
SELECT pg_temp.expect_error_like('Acceptances are made only by the QC Review step',
  $$INSERT INTO equipment_flag_acceptance (batch_id, logbook_entry_id, justification) VALUES (pg_temp.got('batch')::uuid, (pg_temp.lbent(pg_temp.got('fail1'))).id, 'x')$$, 'QC Review screen');
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_ok('A passing check after the failure closes its window', $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 1'), '{"check_weight": "CW1", "nominal_g": 100, "reading_g": 100.001}')$$);
SELECT pg_temp.expect_true('The failure''s window runs from the passing check before it to the one after it',
  (SELECT window_start = pg_temp.got('used')::timestamptz - interval '1 hour' AND window_end IS NOT NULL FROM equipment_failure_view WHERE entry_code = pg_temp.got('fail1')));

-- 4. QA approval, return, correction, void
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_error_like('An analyst cannot approve entries (logbook.review)', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.lbent(pg_temp.got('pass1'))).id])$$, 'logbook.review');
SELECT pg_temp.expect_error_like('Statuses change only by their actions', $$UPDATE logbook_entry SET status = 'Approved' WHERE entry_code = pg_temp.got('pass1')$$, 'their own actions');
SELECT pg_temp.lb_as('e.qa', false);
SELECT pg_temp.expect_error_like('Approving entries is signed', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.lbent(pg_temp.got('pass1'))).id])$$, 'electronic signature');
SELECT pg_temp.lb_as('e.qa');
SELECT pg_temp.expect_ok('QA approves the passing and the failed entry together (signed)',
  $$SELECT approve_logbook_entries(ARRAY[(pg_temp.lbent(pg_temp.got('pass1'))).id, (pg_temp.lbent(pg_temp.got('fail1'))).id], 'Daily review')$$);
SELECT pg_temp.expect_true('Both Approved by QA, under one review record with its signature',
  (SELECT bool_and(e.status = 'Approved' AND e.approved_by = (SELECT id FROM app_user WHERE username = 'e.qa')) AND count(DISTINCT e.review_id) = 1
     FROM logbook_entry e WHERE e.entry_code IN (pg_temp.got('pass1'), pg_temp.got('fail1')))
  AND (SELECT r.entry_count = 2 AND r.signature_id IS NOT NULL FROM logbook_review r WHERE r.id = (pg_temp.lbent(pg_temp.got('pass1'))).review_id));
SELECT pg_temp.expect_error_like('An approved entry is not approved again', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.lbent(pg_temp.got('pass1'))).id])$$, 'approved');
SELECT pg_temp.lb_as('p.qa');
SELECT pg_temp.expect_ok('(p.qa, Lab Supervisor and QA, records an entry)',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule balance check'), pg_temp.lbeq('WD Balance 2'), '{"check_weight": "CW2", "nominal_g": 200, "reading_g": 200.01}')$$);
SELECT pg_temp.keep('own', (SELECT entry_code FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule balance check') ORDER BY created_at DESC LIMIT 1));
SELECT pg_temp.expect_error_like('Nobody approves their own entry', $$SELECT approve_logbook_entries(ARRAY[(pg_temp.lbent(pg_temp.got('own'))).id])$$, 'someone else in QA');
SELECT pg_temp.lb_as('e.qa');
SELECT pg_temp.expect_error_like('Returning an entry says what needs correcting', $$SELECT return_logbook_entry((pg_temp.lbent(pg_temp.got('own'))).id, '')$$, 'what needs correcting');
SELECT pg_temp.expect_ok('QA returns it with a note', $$SELECT return_logbook_entry((pg_temp.lbent(pg_temp.got('own'))).id, 'Wrong check weight: CW2 is 100 g')$$);
SELECT pg_temp.expect_true('It is Returned, with the note', (SELECT status = 'Returned' AND returned_note LIKE 'Wrong check weight%' FROM pg_temp.lbent(pg_temp.got('own'))));
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_ok('The correction (reason and signature) puts it back for QA', $$UPDATE logbook_entry SET entry_values = '{"check_weight": "CW3", "nominal_g": 200, "reading_g": 200.01}' WHERE entry_code = pg_temp.got('own')$$);
SELECT pg_temp.expect_true('... Recorded again, the corrected value kept, the audit trail holds the old one',
  (SELECT status = 'Recorded' AND entry_values->>'check_weight' = 'CW3' FROM pg_temp.lbent(pg_temp.got('own')))
  AND EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'logbook_entry' AND a.record_id = (pg_temp.lbent(pg_temp.got('own'))).id AND a.changed_fields ? 'entry_values'));
SELECT set_config('lims.reason', '', false);
SELECT pg_temp.expect_error_like('A correction needs a reason', $$UPDATE logbook_entry SET entry_values = '{"check_weight": "CW4", "nominal_g": 200, "reading_g": 200.01}' WHERE entry_code = pg_temp.got('own')$$, 'Reason for Change');
SELECT set_config('lims.reason', 'Rule test', false);
SELECT pg_temp.expect_ok('Correcting an approved entry ...', $$UPDATE logbook_entry SET entry_values = entry_values || '{"check_weight": "CW1-B"}' WHERE entry_code = pg_temp.got('pass1')$$);
SELECT pg_temp.expect_true('... sends it back to QA (Recorded, approval cleared)', (SELECT status = 'Recorded' AND approved_by IS NULL AND review_id IS NULL FROM pg_temp.lbent(pg_temp.got('pass1'))));
SELECT pg_temp.expect_error_like('Voiding needs a reason', $$SELECT void_logbook_entry((pg_temp.lbent(pg_temp.got('own'))).id, '')$$, 'why the entry is voided');
SELECT pg_temp.expect_ok('An entry made in error is voided (signed, with the reason)', $$SELECT void_logbook_entry((pg_temp.lbent(pg_temp.got('own'))).id, 'Recorded in the wrong logbook')$$);
SELECT pg_temp.expect_error_like('A voided entry cannot be changed', $$UPDATE logbook_entry SET entry_values = entry_values || '{"check_weight": "X"}' WHERE entry_code = pg_temp.got('own')$$, 'was voided');

-- 5. a logbook that only records (no signature), daily review overdue, entries due
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_ok('A logbook about nothing in particular, entries recorded without a signature, reviewed daily',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency, review_frequency, signing) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule room log', 'General', 'None', 'Daily', 'Daily', 'Recorded');
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, choices) VALUES (pg_temp.lbv('Rule room log'), 'state', 'Room state', 'Choice', 10, '{Clean,Needs cleaning}'),
      (pg_temp.lbv('Rule room log'), 'cleaned', 'Cleaned', 'Pass/Fail', 20, NULL)$$);
SELECT pg_temp.lb_as('e.qa');
SELECT approve_logbook_version(pg_temp.lbv('Rule room log'));
SELECT pg_temp.expect_true('It is due today (no entry yet)', EXISTS (SELECT 1 FROM logbook_due_view WHERE logbook_id = pg_temp.lb('Rule room log') AND due));
SELECT pg_temp.lb_as('e.ana', false);
SELECT pg_temp.expect_ok('Recorded without a signature; a choice is matched whatever its case',
  $$INSERT INTO logbook_entry (logbook_id, entry_at, entry_values) VALUES (pg_temp.lb('Rule room log'), now() - interval '10 days', '{"state": "clean", "cleaned": "pass"}')$$);
SELECT pg_temp.expect_true('The choice is stored as listed, Pass, not signed',
  (SELECT entry_values->>'state' = 'Clean' AND entry_values->>'cleaned' = 'Pass' AND result = 'Pass' AND recorded_signature_id IS NULL
     FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule room log') ORDER BY created_at DESC LIMIT 1));
SELECT pg_temp.expect_error_like('A Choice outside the list is refused',
  $$INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule room log'), '{"state": "Dusty", "cleaned": "Pass"}')$$, 'choose one of');
SELECT pg_temp.expect_error_like('A Pass/Fail field at Fail fails the entry and asks for the reason',
  $$INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule room log'), '{"state": "Needs cleaning", "cleaned": "Fail"}')$$, 'Cleaned: Fail');
SELECT pg_temp.expect_true('A daily-review entry 10 days old is overdue for QA', (SELECT overdue FROM logbook_entry_view WHERE logbook_id = pg_temp.lb('Rule room log') ORDER BY created_at LIMIT 1));
SELECT pg_temp.expect_true('Still due today (the old entry does not count for today)', EXISTS (SELECT 1 FROM logbook_due_view WHERE logbook_id = pg_temp.lb('Rule room log') AND due));
SELECT pg_temp.lb_as('e.ana', false);
INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule room log'), '{"state": "Clean", "cleaned": "Pass"}');
SELECT pg_temp.expect_true('Not due once today''s entry is in', NOT EXISTS (SELECT 1 FROM logbook_due_view WHERE logbook_id = pg_temp.lb('Rule room log') AND due));

-- 6. a chamber's limits come from its condition; an excursion lists the studies stored in it
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_ok('A temperature log covering the stability chamber on Viscometer 2 (40 °C / 75% RH) and HPLC T1 (25 °C / 60% RH)',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject, entry_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule temperatures', 'Temperature', 'Equipment', 'Daily');
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, unit, equipment_limits, required) VALUES
      (pg_temp.lbv('Rule temperatures'), 'temperature', 'Temperature', 'Number', 10, '°C', true, true), (pg_temp.lbv('Rule temperatures'), 'humidity', 'Humidity', 'Number', 20, '% RH', true, false);
    INSERT INTO logbook_equipment (logbook_id, equipment_id) VALUES (pg_temp.lb('Rule temperatures'), pg_temp.lbeq('Viscometer 2')), (pg_temp.lb('Rule temperatures'), pg_temp.lbeq('HPLC T1'))$$);
SELECT pg_temp.expect_true('The limits for a chamber come from its condition (40 ± 2 °C, 75 ± 5 % RH)',
  (SELECT lo = 38 AND hi = 42 FROM logbook_limits((SELECT id FROM logbook_field WHERE version_id = pg_temp.lbv('Rule temperatures') AND field_key = 'temperature'), pg_temp.lbeq('Viscometer 2')))
  AND (SELECT lo = 70 AND hi = 80 FROM logbook_limits((SELECT id FROM logbook_field WHERE version_id = pg_temp.lbv('Rule temperatures') AND field_key = 'humidity'), pg_temp.lbeq('Viscometer 2'))));
SELECT pg_temp.lb_as('e.qa');
SELECT approve_logbook_version(pg_temp.lbv('Rule temperatures'));
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_ok('A reading of 44 °C in the 40 °C chamber is an excursion (with its reason)',
  $$INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values, failure_reason) VALUES (pg_temp.lb('Rule temperatures'), pg_temp.lbeq('Viscometer 2'), '{"temperature": 44, "humidity": 74}', 'Door seal failed')$$);
SELECT pg_temp.expect_true('It lists the study stored in that chamber (STB-00001-2)',
  EXISTS (SELECT 1 FROM stability_excursion_view x WHERE x.equipment_id = pg_temp.lbeq('Viscometer 2') AND x.storage_code LIKE 'STB-%-2'));
INSERT INTO logbook_entry (logbook_id, equipment_id, entry_values) VALUES (pg_temp.lb('Rule temperatures'), pg_temp.lbeq('HPLC T1'), '{"temperature": 25.4}');
SELECT pg_temp.expect_true('A reading inside the limits of the 25 °C chamber passes',
  (SELECT result = 'Pass' FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule temperatures') ORDER BY created_at DESC LIMIT 1));

-- 7. a logbook that makes lots, and a value across logbooks (a culture's passage)
SELECT pg_temp.lb_as('e.sup');
SELECT pg_temp.expect_error_like('A logbook that makes lots is about lots', $$INSERT INTO logbook (site_id, logbook_name, kind, subject, creates_lot) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule bad', 'Inoculum', 'None', true)$$, 'about lots');
SELECT pg_temp.expect_error_like('... and signs its entries', $$INSERT INTO logbook (site_id, logbook_name, kind, subject, creates_lot, signing) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule bad', 'Inoculum', 'Lot', true, 'Recorded')$$, 'signs its entries');
SELECT pg_temp.expect_ok('A culture logbook publishes each culture''s passage',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject, review_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule cultures', 'Culture', 'Lot', 'Weekly');
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, limit_max, publish) VALUES (pg_temp.lbv('Rule cultures'), 'passage', 'Passage', 'Number', 10, 5, true)$$);
SELECT pg_temp.expect_error_like('A published value cannot take a name the bench formulas use', $$INSERT INTO logbook_field (version_id, field_key, label, field_type, publish) VALUES (pg_temp.lbv('Rule cultures'), 'weight', 'Weight', 'Number', true)$$, 'bench formulas use');
SELECT pg_temp.expect_ok('An inoculum logbook makes a lot per entry (valid 24 h), and reads the culture''s passage',
  $$INSERT INTO logbook (site_id, logbook_name, kind, subject, creates_lot, lot_name, validity_hours, review_frequency) VALUES ((SELECT id FROM lab_site WHERE site_code = 'CFL'), 'Rule inocula', 'Inoculum', 'Lot', true, 'Challenge inoculum', 24, 'Daily');
    INSERT INTO logbook_field (version_id, field_key, label, field_type, sort_order, limit_max, formula, publish, unit) VALUES
      (pg_temp.lbv('Rule inocula'), 'culture_lot', 'Working culture', 'Lot', 10, NULL, NULL, false, NULL),
      (pg_temp.lbv('Rule inocula'), 'culture_passage', 'Passage of the culture', 'Calculated', 20, 5, '{culture_lot.passage}', false, NULL),
      (pg_temp.lbv('Rule inocula'), 'count_1', 'Count 1', 'Number', 30, NULL, NULL, false, 'CFU'),
      (pg_temp.lbv('Rule inocula'), 'count_2', 'Count 2', 'Number', 40, NULL, NULL, false, 'CFU'),
      (pg_temp.lbv('Rule inocula'), 'cfu_per_ml', 'CFU per mL', 'Calculated', 50, NULL, '({count_1} + {count_2}) / 2 / 0.1', true, 'CFU/mL'),
      (pg_temp.lbv('Rule inocula'), 'volume_made', 'Volume made', 'Number', 60, NULL, NULL, false, 'mL')$$);
UPDATE logbook_field SET formula = '{count_2} + {volume_made}' WHERE version_id = pg_temp.lbv('Rule inocula') AND field_key = 'cfu_per_ml';
SELECT pg_temp.expect_true('A formula naming a field that comes after it is an Error',
  EXISTS (SELECT 1 FROM logbook_version_problems(pg_temp.lbv('Rule inocula')) p WHERE p.problem LIKE '%{volume_made} comes after it%'));
UPDATE logbook_field SET formula = '({count_1} + {count_2}) / 2 / 0.1' WHERE version_id = pg_temp.lbv('Rule inocula') AND field_key = 'cfu_per_ml';
SELECT pg_temp.expect_true('The inoculum design has no Error', NOT EXISTS (SELECT 1 FROM logbook_version_problems(pg_temp.lbv('Rule inocula')) p WHERE p.severity = 'Error'));
SELECT pg_temp.lb_as('e.qa');
SELECT approve_logbook_version(pg_temp.lbv('Rule cultures')), approve_logbook_version(pg_temp.lbv('Rule inocula'));
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_ok('The Salmonella working culture is at passage 3', $$INSERT INTO logbook_entry (logbook_id, lot_id, entry_values) VALUES (pg_temp.lb('Rule cultures'), (SELECT id FROM inventory_lot WHERE item_name LIKE 'WD Salmonella%'), '{"passage": 3}')$$);
SELECT pg_temp.expect_ok('An inoculum is made from it (signed)', $$INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule inocula'), jsonb_build_object('culture_lot', (SELECT lot_code FROM inventory_lot WHERE item_name LIKE 'WD Salmonella%'), 'count_1', 52, 'count_2', 48, 'volume_made', 10))$$);
SELECT pg_temp.keep('inoc', (SELECT entry_code FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule inocula') ORDER BY created_at DESC LIMIT 1));
SELECT pg_temp.expect_true('It read the culture''s passage (3) and calculated 500 CFU/mL', (SELECT (entry_values->>'culture_passage')::numeric = 3 AND (entry_values->>'cfu_per_ml')::numeric = 500 FROM pg_temp.lbent(pg_temp.got('inoc'))));
SELECT pg_temp.expect_true('It made its lot: "Challenge inoculum: WD Salmonella ...", 10 mL, a strain with Salmonella, usable until its validity ends',
  (SELECT l.item_name LIKE 'Challenge inoculum: WD Salmonella%' AND l.quantity_received = 10 AND l.unit = 'mL' AND 'Microbiological Strain' = ANY (l.chemical_types)
          AND l.status = 'Available' AND EXISTS (SELECT 1 FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id WHERE la.lot_id = l.id AND a.analyte_name = 'WD Salmonella')
          AND e.lot_id = l.id AND e.created_lot_id = l.id AND e.valid_until = e.entry_at + interval '24 hours'
     FROM pg_temp.lbent(pg_temp.got('inoc')) e JOIN inventory_lot l ON l.id = e.lot_id));
SELECT pg_temp.expect_ok('The culture goes to passage 6', $$INSERT INTO logbook_entry (logbook_id, lot_id, entry_values, failure_reason) VALUES (pg_temp.lb('Rule cultures'), (SELECT id FROM inventory_lot WHERE item_name LIKE 'WD Salmonella%'), '{"passage": 6}', 'Rule test: too many passages')$$);
SELECT pg_temp.lb_as('e.qa');
SELECT approve_logbook_entries(ARRAY(SELECT id FROM logbook_entry WHERE logbook_id = pg_temp.lb('Rule cultures') AND entry_values->>'passage' = '6'));
SELECT pg_temp.lb_as('e.ana');
SELECT pg_temp.expect_error_like('An inoculum from a culture past 5 passages fails (its approved passage is read)',
  $$INSERT INTO logbook_entry (logbook_id, entry_values) VALUES (pg_temp.lb('Rule inocula'), jsonb_build_object('culture_lot', (SELECT lot_code FROM inventory_lot WHERE item_name LIKE 'WD Salmonella%'), 'count_1', 52, 'count_2', 48, 'volume_made', 10))$$, 'Passage of the culture 6 is above 5');

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
