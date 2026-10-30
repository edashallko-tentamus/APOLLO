-- Verification for migration 041: stability S-2, on the study of test_027 ("Rule test stability": placed 100 days
-- ago at CFL, 25/60 and 40/75; 1 M and 3 M pulled at 25/60, ordered at 40/75; 14 M scheduled; an excursion in the
-- 40/75 chamber from test_029). Amendments (an amended quote: what it may change, accepting it switches the study and
-- its future pulls, a new condition placed later); excursion assessments by QA; the issued cumulative report;
-- cancelling the study with the material's fate; who may do each.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
SELECT set_config('lims.stability_internal', '', false);
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
-- act as a user (signed, or not), at CFL
CREATE OR REPLACE FUNCTION pg_temp.s2as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.s2cfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
CREATE OR REPLACE FUNCTION pg_temp.s2u(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.s2cond(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM stability_condition WHERE condition_name = n AND site_id IS NULL $$;
CREATE OR REPLACE FUNCTION pg_temp.s2proj() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM project WHERE project_name = 'Rule test stability' $$;
CREATE OR REPLACE FUNCTION pg_temp.s2st() RETURNS stability_study LANGUAGE sql AS $$ SELECT * FROM stability_study WHERE project_id = pg_temp.s2proj() $$;
CREATE OR REPLACE FUNCTION pg_temp.s2v(n integer) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM project_version WHERE project_id = pg_temp.s2proj() AND version_no = n $$;
CREATE OR REPLACE FUNCTION pg_temp.s2tp(n integer, l text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM stability_timepoint WHERE project_version_id = pg_temp.s2v(n) AND label = l AND status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.s2line(n integer, code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT q.id FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id WHERE q.project_version_id = pg_temp.s2v(n) AND t.test_code = code AND q.status = 'Active' $$;
CREATE OR REPLACE FUNCTION pg_temp.s2pull(l text, cond text) RETURNS stability_pull LANGUAGE sql AS $$
  SELECT p.* FROM stability_pull p JOIN stability_timepoint t ON t.id = p.timepoint_id WHERE p.study_id = (pg_temp.s2st()).id AND t.label = l
     AND p.condition_id = pg_temp.s2cond(cond) ORDER BY (p.status = 'Cancelled'), p.created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.s2store(cond text) RETURNS stability_storage LANGUAGE sql AS $$
  SELECT * FROM stability_storage WHERE study_id = (pg_temp.s2st()).id AND condition_id = pg_temp.s2cond(cond) $$;
CREATE OR REPLACE FUNCTION pg_temp.s2pdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
CREATE TEMP TABLE IF NOT EXISTS s2k (k text PRIMARY KEY, v text);
DELETE FROM s2k;

-- people: a QA member and an analyst at CFL
SELECT pg_temp.s2as('akiddle');
INSERT INTO app_user (username, full_name) VALUES ('s2.qa', 'S2 QA'), ('s2.ana', 'S2 Analyst') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.s2u('s2.qa') FROM lab_group g WHERE g.site_id = pg_temp.s2cfl() AND g.group_name = 'QA' ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.s2u('s2.ana') FROM lab_group g WHERE g.site_id = pg_temp.s2cfl() AND g.group_name = 'Analyst' ON CONFLICT DO NOTHING;

-- 0. who may do what
SELECT pg_temp.expect_true('Lab Supervisors and General Managers cancel studies; QA assesses excursions; analysts do neither',
  EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.s2cfl() AND g.group_name = 'Lab Supervisor' AND p.permission_code = 'stability.cancel')
  AND EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.s2cfl() AND g.group_name = 'General Manager' AND p.permission_code = 'stability.cancel')
  AND user_has_permission_at(pg_temp.s2u('s2.qa'), 'stability.assess', pg_temp.s2cfl())
  AND NOT user_has_permission_at(pg_temp.s2u('s2.ana'), 'stability.assess', pg_temp.s2cfl())
  AND NOT user_has_permission_at(pg_temp.s2u('s2.ana'), 'stability.cancel', pg_temp.s2cfl()));
SELECT pg_temp.expect_true('The fixture: the study runs (Active) on version 1, with the 1 M and 3 M pulls taken or ordered and 14 M scheduled',
  (pg_temp.s2st()).status = 'Active' AND (pg_temp.s2st()).project_version_id = pg_temp.s2v(1)
  AND (pg_temp.s2pull('3 M', '25 °C / 60% RH')).status = 'Pulled' AND (pg_temp.s2pull('1 M', '40 °C / 75% RH')).status = 'Ordered'
  AND (pg_temp.s2pull('14 M', '40 °C / 75% RH')).status = 'Scheduled');

-- 1. an amendment: a new version of the stability quote while the study runs
SELECT pg_temp.s2as('akiddle');
SELECT pg_temp.expect_ok('A new version of the running study''s quote is an amendment Draft', $$SELECT new_stability_version(pg_temp.s2proj())$$);
SELECT pg_temp.expect_true('It copies the design the study runs to, each timepoint remembering its original',
  (SELECT status::text FROM project_version WHERE id = pg_temp.s2v(2)) = 'Draft'
  AND (SELECT count(*) FROM stability_timepoint WHERE project_version_id = pg_temp.s2v(2) AND status = 'Active') = 4
  AND NOT EXISTS (SELECT 1 FROM stability_timepoint WHERE project_version_id = pg_temp.s2v(2) AND carried_from_id IS NULL)
  AND (SELECT count(*) FROM stability_cell WHERE project_version_id = pg_temp.s2v(2) AND status = 'Active')
      = (SELECT count(*) FROM stability_cell WHERE project_version_id = pg_temp.s2v(1) AND status = 'Active'));
SELECT pg_temp.expect_error_like('A second Draft is refused', $$SELECT new_stability_version(pg_temp.s2proj())$$, 'already a Draft');
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): the interval of a timepoint already pulled stays
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): T0 stays the baseline
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): a test cannot be added at a timepoint already pulled for that condition
UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = pg_temp.s2v(2) AND line_id = pg_temp.s2line(2, 'T-00001') AND timepoint_id = pg_temp.s2tp(2, 'T0');
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): T0 tests cannot change once the study started
-- what the client asked for: extend to 24 months (moisture at both conditions, metals at 25/60), stop moisture at
-- 14 M at 40/75, and add 30/65 with moisture at 24 M
SELECT pg_temp.expect_ok('The amendment adds 24 M, drops 14 M at 40/75 and adds the 30/65 condition',
  $$INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late) VALUES (pg_temp.s2v(2), '24 M', 24, 'Months', 7, 7);
    INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order) VALUES (pg_temp.s2v(2), pg_temp.s2cond('30 °C / 65% RH'), 3);
    INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required) VALUES
      (pg_temp.s2v(2), pg_temp.s2line(2, 'T-00002'), pg_temp.s2tp(2, '24 M'), pg_temp.s2cond('25 °C / 60% RH'), 2),
      (pg_temp.s2v(2), pg_temp.s2line(2, 'T-00002'), pg_temp.s2tp(2, '24 M'), pg_temp.s2cond('40 °C / 75% RH'), 2),
      (pg_temp.s2v(2), pg_temp.s2line(2, 'T-00002'), pg_temp.s2tp(2, '24 M'), pg_temp.s2cond('30 °C / 65% RH'), 2),
      (pg_temp.s2v(2), pg_temp.s2line(2, 'T-00001'), pg_temp.s2tp(2, '24 M'), pg_temp.s2cond('25 °C / 60% RH'), 1);
    UPDATE stability_cell SET status = 'Removed' WHERE project_version_id = pg_temp.s2v(2) AND timepoint_id = pg_temp.s2tp(2, '14 M') AND condition_id = pg_temp.s2cond('40 °C / 75% RH')$$);
SELECT pg_temp.expect_true('Nothing stops it being issued; the lab is told the new condition is placed once accepted',
  NOT EXISTS (SELECT 1 FROM stability_quote_problems(pg_temp.s2v(2)) WHERE severity = 'Error')
  AND EXISTS (SELECT 1 FROM stability_quote_problems(pg_temp.s2v(2)) WHERE problem LIKE 'New condition 30 °C / 65% RH%'));
SELECT pg_temp.expect_ok('The amendment is issued (sent to the client)', $$UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.s2v(2)$$);
SELECT pg_temp.expect_error_like('While it is with the client, no other amendment starts', $$SELECT new_stability_version(pg_temp.s2proj())$$, 'already with the client');
SELECT pg_temp.expect_true('Until accepted, the study still runs to version 1 (the study page shows the amendment pending)',
  (pg_temp.s2st()).project_version_id = pg_temp.s2v(1) AND (SELECT amendment_pending_version FROM stability_study_view WHERE id = (pg_temp.s2st()).id) = 2);
INSERT INTO s2k VALUES ('ordered40', (pg_temp.s2pull('1 M', '40 °C / 75% RH')).id), ('pulled25', (pg_temp.s2pull('3 M', '25 °C / 60% RH')).id),
  ('s14_25', (pg_temp.s2pull('14 M', '25 °C / 60% RH')).id), ('s14_40', (pg_temp.s2pull('14 M', '40 °C / 75% RH')).id);

-- 2. accepting it switches the study
SELECT pg_temp.expect_ok('The client accepts the amendment',
  $$UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT cc.contact_id FROM client_contact cc JOIN client c ON c.id = cc.client_id
     WHERE c.legal_name = 'Beta Foods LLC' AND 'ORDERING' = ANY(cc.roles) LIMIT 1) WHERE id = pg_temp.s2v(2)$$);
SELECT pg_temp.expect_true('The study runs to version 2 (amendment 1); version 1 is Superseded',
  (pg_temp.s2st()).project_version_id = pg_temp.s2v(2) AND (pg_temp.s2st()).amendment_no = 1
  AND (SELECT status::text FROM project_version WHERE id = pg_temp.s2v(1)) = 'Superseded');
SELECT pg_temp.expect_true('Recorded: 2 pulls added (24 M at 25/60 and 40/75), 1 cancelled (14 M at 40/75), none moved',
  (SELECT pulls_added = 2 AND pulls_cancelled = 1 AND pulls_changed = 0 AND from_version_id = pg_temp.s2v(1) AND to_version_id = pg_temp.s2v(2)
     FROM stability_amendment WHERE study_id = (pg_temp.s2st()).id AND amendment_no = 1));
SELECT pg_temp.expect_true('Pulls already ordered or taken are unchanged but follow their timepoint to version 2',
  (SELECT status = 'Ordered' AND timepoint_id = pg_temp.s2tp(2, '1 M') FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'ordered40'))
  AND (SELECT status = 'Pulled' AND timepoint_id = pg_temp.s2tp(2, '3 M') FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pulled25')));
SELECT pg_temp.expect_true('The dropped 14 M pull at 40/75 is cancelled; the one at 25/60 stays scheduled',
  (SELECT status FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 's14_40')) = 'Cancelled'
  AND (SELECT status = 'Scheduled' AND timepoint_id = pg_temp.s2tp(2, '14 M') FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 's14_25')));
SELECT pg_temp.expect_true('The new 24 M pull is scheduled 24 months after placement, inside its window, with the new design''s material (moisture 2 + metals 1)',
  (SELECT p.nominal_date = stability_interval_date((pg_temp.s2st()).placement_date, 24, 'Months') AND p.units_required = 3 AND p.status = 'Scheduled'
          AND p.scheduled_date BETWEEN p.window_start AND p.window_end
     FROM stability_pull p WHERE p.study_id = (pg_temp.s2st()).id AND p.timepoint_id = pg_temp.s2tp(2, '24 M') AND p.condition_id = pg_temp.s2cond('25 °C / 60% RH')));
SELECT pg_temp.expect_true('The study stays Active with one condition to place (30/65)',
  (pg_temp.s2st()).status = 'Active' AND (SELECT conditions_to_place FROM stability_study_view WHERE id = (pg_temp.s2st()).id) = 1);

-- 3. placing the new condition
SELECT pg_temp.expect_ok('A 30/65 chamber with a rack',
  $$INSERT INTO stability_chamber (equipment_id, condition_id) SELECT e.id, pg_temp.s2cond('30 °C / 65% RH') FROM equipment e
      WHERE e.site_id = pg_temp.s2cfl() AND e.admin_status = 'In Service' AND NOT EXISTS (SELECT 1 FROM stability_chamber c WHERE c.equipment_id = e.id) ORDER BY e.equipment_code LIMIT 1;
    INSERT INTO stability_rack (chamber_id, rack_code) SELECT id, 'S2' FROM stability_chamber WHERE condition_id = pg_temp.s2cond('30 °C / 65% RH') AND site_id = pg_temp.s2cfl()$$);
SELECT pg_temp.expect_error_like('Placing it before the study''s placement date is refused',
  format($$SELECT place_stability_study((pg_temp.s2st()).id, (pg_temp.s2st()).placement_date - 1, '[{"condition_id":"%s","rack_id":"%s","units":4}]', NULL)$$,
    pg_temp.s2cond('30 °C / 65% RH'), (SELECT r.id FROM stability_rack r JOIN stability_chamber c ON c.id = r.chamber_id WHERE c.condition_id = pg_temp.s2cond('30 °C / 65% RH') AND r.rack_code = 'S2')), 'before the study was placed');
SELECT pg_temp.expect_ok('Placed today: 4 units at 30/65 (no T0: the baseline was tested when the study started)',
  format($$SELECT place_stability_study((pg_temp.s2st()).id, site_today(pg_temp.s2cfl()), '[{"condition_id":"%s","rack_id":"%s","position":"C1","units":4}]', NULL)$$,
    pg_temp.s2cond('30 °C / 65% RH'), (SELECT r.id FROM stability_rack r JOIN stability_chamber c ON c.id = r.chamber_id WHERE c.condition_id = pg_temp.s2cond('30 °C / 65% RH') AND r.rack_code = 'S2')));
SELECT pg_temp.expect_true('Its material is labelled -3, placed today, and its 24 M pull counts from today',
  (pg_temp.s2store('30 °C / 65% RH')).storage_code = (pg_temp.s2st()).study_code || '-3' AND (pg_temp.s2store('30 °C / 65% RH')).placed_on = site_today(pg_temp.s2cfl())
  AND (pg_temp.s2pull('24 M', '30 °C / 65% RH')).nominal_date = stability_interval_date(site_today(pg_temp.s2cfl()), 24, 'Months')
  AND (SELECT conditions_to_place FROM stability_study_view WHERE id = (pg_temp.s2st()).id) = 0);
SELECT pg_temp.expect_error_like('Nothing more to place', format($$SELECT place_stability_study((pg_temp.s2st()).id, site_today(pg_temp.s2cfl()), '[]', NULL)$$), 'already placed');
SELECT pg_temp.expect_error_like('Material still pulled from cannot be disposed of',
  $$SELECT dispose_stability_material((pg_temp.s2store('40 °C / 75% RH')).id, 'Destroyed', '')$$, 'still pulled from');

-- 4. the excursion in the 40/75 chamber, assessed by QA
SELECT pg_temp.expect_true('The 40/75 chamber''s excursion is listed for the study, not yet assessed',
  EXISTS (SELECT 1 FROM stability_excursion_status_view WHERE study_id = (pg_temp.s2st()).id AND assessment_id IS NULL)
  AND (SELECT excursions_open FROM stability_study_view WHERE id = (pg_temp.s2st()).id) >= 1);
SELECT pg_temp.expect_true('An unassessed excursion stops the report being issued',
  EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Block' AND problem LIKE '%not assessed by QA%'));
INSERT INTO s2k SELECT 'exc', logbook_entry_id FROM stability_excursion_status_view WHERE study_id = (pg_temp.s2st()).id ORDER BY entry_at LIMIT 1;
SELECT pg_temp.s2as('s2.ana');
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): an analyst cannot assess it (StabilityService asks stability.assess)
SELECT pg_temp.s2as('s2.qa', false);
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): QA signs the assessment (SignatureService)
SELECT pg_temp.s2as('s2.qa');
-- Moved to the Java backend in migration 070 (JUnit: StabilityRulesTest): and justifies it
-- QA's assessment as Java records it since migration 070 (ExcursionRepository.record): a fixture for the checks below
CREATE OR REPLACE FUNCTION pg_temp.s2assess(p_study uuid, p_entry uuid, p_decision text, p_justification text) RETURNS uuid LANGUAGE plpgsql AS $f$
DECLARE v uuid;
BEGIN
    PERFORM set_config('lims.stability_internal', '1', true);
    UPDATE stability_excursion_assessment SET status = 'Inactive' WHERE study_id = p_study AND logbook_entry_id = p_entry AND status = 'Active';
    INSERT INTO stability_excursion_assessment (study_id, logbook_entry_id, storage_id, decision, justification, excursion_text, affected_pull_ids, signature_id)
    SELECT x.study_id, x.logbook_entry_id, x.storage_id, p_decision, btrim(p_justification),
           x.equipment_code || ' ' || x.equipment_name || ', ' || to_char(x.entry_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id), 'Mon DD, YYYY HH24:MI') || ': '
             || array_to_string(x.problems, '; ') || COALESCE(' (' || x.failure_reason || ')', ''),
           COALESCE((SELECT array_agg(p.id ORDER BY p.scheduled_date) FROM stability_pull p WHERE p.storage_id = x.storage_id AND p.status <> 'Cancelled'
                      AND (p.pulled_at IS NULL OR p.pulled_at >= x.window_start)), '{}'),
           NULLIF(current_setting('lims.signature_id', true), '')::uuid
      FROM (SELECT * FROM stability_excursion_view WHERE study_id = p_study AND logbook_entry_id = p_entry LIMIT 1) x JOIN stability_study st ON st.id = x.study_id
    RETURNING id INTO v;
    PERFORM set_config('lims.stability_internal', '', true);
    RETURN v;
END $f$;
SELECT pg_temp.expect_ok('QA: impact, the results of the exposed material are flagged',
  $$SELECT pg_temp.s2assess((pg_temp.s2st()).id, (SELECT v::uuid FROM s2k WHERE k = 'exc'), 'Impact: results flagged', '44 °C for at least a day: the 40/75 moisture results after it are flagged for the client')$$);
SELECT pg_temp.expect_true('The assessment records the reading, the signature and the pulls of the exposed material (those still to come included)',
  (SELECT decision = 'Impact: results flagged' AND signature_id IS NOT NULL AND excursion_text LIKE '%Door seal failed%'
          AND (SELECT v::uuid FROM s2k WHERE k = 'ordered40') = ANY (affected_pull_ids)
          AND (pg_temp.s2pull('24 M', '40 °C / 75% RH')).id = ANY (affected_pull_ids)
     FROM stability_excursion_assessment WHERE study_id = (pg_temp.s2st()).id AND status = 'Active'));
SELECT pg_temp.expect_ok('A later assessment replaces it', $$SELECT pg_temp.s2assess((pg_temp.s2st()).id, (SELECT v::uuid FROM s2k WHERE k = 'exc'), 'Client to decide', 'Client asked to review the 40/75 data')$$);
SELECT pg_temp.expect_true('One current assessment; the earlier one is kept, inactive',
  (SELECT count(*) FROM stability_excursion_assessment WHERE study_id = (pg_temp.s2st()).id AND status = 'Active') = 1
  AND (SELECT count(*) FROM stability_excursion_assessment WHERE study_id = (pg_temp.s2st()).id AND status = 'Inactive') = 1
  AND (SELECT decision FROM stability_excursion_status_view WHERE study_id = (pg_temp.s2st()).id AND logbook_entry_id = (SELECT v::uuid FROM s2k WHERE k = 'exc')) = 'Client to decide');
SELECT pg_temp.expect_error_like('Nobody writes an assessment directly',
  $$UPDATE stability_excursion_assessment SET decision = 'No impact' WHERE study_id = (pg_temp.s2st()).id$$, 'only through');

-- 5. the issued cumulative report
SELECT pg_temp.s2as('akiddle');
SELECT pg_temp.expect_true('With no finalized result there is nothing to report yet',
  EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Block' AND problem LIKE 'No results are finalized yet%'));
-- fixture, written directly with triggers off: the 1 M moisture result at 25/60 approved in QC Review and finalized
SET session_replication_role = replica;
DO $$
DECLARE rt uuid := (SELECT r.id FROM requested_test r WHERE r.stability_pull_id = (pg_temp.s2pull('1 M', '25 °C / 60% RH')).id ORDER BY r.created_at LIMIT 1);
        tr uuid; sig uuid := script_signature('Rule test fixture', false);
BEGIN
  INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, reported, unit, conformance, approved_by, stage)
  VALUES (rt, (SELECT id FROM analyte ORDER BY analyte_name LIMIT 1), (SELECT id FROM test_batch LIMIT 1), (SELECT id FROM batch_entry LIMIT 1), 1, 4.21, '4.2', '%', 'Conforms', pg_temp.s2u('s2.qa'), 'Final')
  RETURNING id INTO tr;
  INSERT INTO result_finalization (requested_test_id, result_ids, group_code, finalized_by, signature_id) VALUES (rt, ARRAY[tr], 'FB-S2', current_app_user(), sig);
  INSERT INTO s2k VALUES ('rt1m', rt);
END $$;
SET session_replication_role = origin;
SELECT pg_temp.s2as('akiddle');
SELECT pg_temp.expect_true('Now an interim report can be issued by someone independent (other tests pending)',
  NOT EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Block')
  AND EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Warning' AND problem LIKE '%not finalized yet%')
  AND EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Info' AND problem LIKE '%interim report (version 1)%')
  AND cardinality(stability_finalized_results((pg_temp.s2st()).id)) = 1 AND NOT stability_report_is_final((pg_temp.s2st()).id));
INSERT INTO s2k SELECT 'pdf', pg_temp.s2pdf('S2 report one');
SELECT pg_temp.s2as('s2.qa');
SELECT pg_temp.expect_error_like('Independence, as for a COA: QA, who approved the 1 M result, cannot issue the report',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', stability_report_fingerprint((pg_temp.s2st()).id), 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), (SELECT sha256 FROM document_file WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')))$$, 'someone else issues it');
SELECT pg_temp.expect_true('The page shows QA that block before signing (the viewer is passed in, no session needed)',
  EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id, pg_temp.s2u('s2.qa')) WHERE severity = 'Block' AND problem LIKE '%someone else issues it%'));
SELECT pg_temp.s2as('s2.ana');
SELECT pg_temp.expect_error_like('Issuing needs reports.finalize',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', stability_report_fingerprint((pg_temp.s2st()).id), 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), (SELECT sha256 FROM document_file WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')))$$, 'permission');
SELECT pg_temp.s2as('akiddle', false);
SELECT pg_temp.expect_error_like('and a signature',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', stability_report_fingerprint((pg_temp.s2st()).id), 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), (SELECT sha256 FROM document_file WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')))$$, 'electronic signature');
SELECT pg_temp.s2as('akiddle');
SELECT pg_temp.expect_error_like('A report prepared from other data is refused',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', 'stale', 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), (SELECT sha256 FROM document_file WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')))$$, 'changed while');
SELECT pg_temp.expect_error_like('The PDF must be the one stored',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', stability_report_fingerprint((pg_temp.s2st()).id), 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), 'abc')$$, 'not the one stored');
SELECT pg_temp.expect_ok('Report 1 is issued (signed)',
  $$SELECT issue_stability_report((pg_temp.s2st()).id, jsonb_build_object('fingerprint', stability_report_fingerprint((pg_temp.s2st()).id), 'is_final', false, 'report_code', (pg_temp.s2st()).study_code || '-SR1'),
     (SELECT v::uuid FROM s2k WHERE k = 'pdf'), (SELECT sha256 FROM document_file WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')))$$);
SELECT pg_temp.expect_true('SR1: interim, with the signer''s signature and title, and emailed to the client with the PDF',
  (SELECT report_code = (pg_temp.s2st()).study_code || '-SR1' AND NOT is_final AND signature_id IS NOT NULL AND signature_image_id IS NOT NULL AND signer_title IS NOT NULL
     FROM stability_report WHERE study_id = (pg_temp.s2st()).id AND version_no = 1)
  AND EXISTS (SELECT 1 FROM email_outbox WHERE template = 'Stability Report Issued' AND document_id = (SELECT v::uuid FROM s2k WHERE k = 'pdf')
                AND site_id = pg_temp.s2cfl() AND subject LIKE '%' || (pg_temp.s2st()).study_code || '-SR1%'));
SELECT pg_temp.expect_true('Nothing new since: a second report is refused until something changes',
  EXISTS (SELECT 1 FROM stability_report_problems((pg_temp.s2st()).id) WHERE severity = 'Block' AND problem LIKE 'Nothing new since%'));
SELECT pg_temp.expect_error_like('An issued report never changes',
  $$UPDATE stability_report SET is_final = true WHERE study_id = (pg_temp.s2st()).id$$, 'never changes');
SELECT pg_temp.expect_error_like('Reports are written only by Issue report',
  $$INSERT INTO stability_report (report_code, study_id, version_no, content, fingerprint, document_id, sha256, signature_id)
    SELECT 'X', (pg_temp.s2st()).id, 9, '{}', 'x', (SELECT v::uuid FROM s2k WHERE k = 'pdf'), 'x', id FROM signature_event LIMIT 1$$, 'only through Issue report');

-- 6. cancelling the study
SELECT pg_temp.s2as('s2.ana');
SELECT pg_temp.expect_error_like('An analyst cannot cancel a study', $$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Client stopped the project', '[]')$$, 'permission');
SELECT pg_temp.s2as('akiddle', false);
SELECT pg_temp.expect_error_like('Cancelling is signed', $$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Client stopped the project', '[]')$$, 'electronic signature');
SELECT pg_temp.s2as('akiddle');
SELECT pg_temp.expect_error_like('with a reason', $$SELECT cancel_stability_study((pg_temp.s2st()).id, ' ', '[]')$$, 'Say why');
SELECT pg_temp.expect_error_like('and the fate of every condition''s material',
  format($$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Client stopped the project', '[{"storage_id":"%s","disposition":"Destroyed"}]')$$, (pg_temp.s2store('25 °C / 60% RH')).id), 'say what happens to the material');
SELECT pg_temp.expect_error_like('A fate must be one of the three',
  format($$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Client stopped the project', '[{"storage_id":"%s","disposition":"Destroyed"},{"storage_id":"%s","disposition":"Lost"},{"storage_id":"%s","disposition":"Retained"}]')$$,
    (pg_temp.s2store('25 °C / 60% RH')).id, (pg_temp.s2store('40 °C / 75% RH')).id, (pg_temp.s2store('30 °C / 65% RH')).id), 'choose Destroyed');
SELECT pg_temp.expect_ok('Cancelled: 25/60 destroyed, 40/75 returned to the client, 30/65 kept as retain',
  format($$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Client stopped the project',
    '[{"storage_id":"%s","disposition":"Destroyed"},{"storage_id":"%s","disposition":"Returned","note":"Courier to Beta Foods"},{"storage_id":"%s","disposition":"Retained"}]')$$,
    (pg_temp.s2store('25 °C / 60% RH')).id, (pg_temp.s2store('40 °C / 75% RH')).id, (pg_temp.s2store('30 °C / 65% RH')).id));
SELECT pg_temp.expect_true('The study is Cancelled with who, when and why; no pull is left scheduled or ordered',
  (pg_temp.s2st()).status = 'Cancelled' AND (pg_temp.s2st()).cancelled_by = pg_temp.s2u('akiddle') AND (pg_temp.s2st()).cancel_reason = 'Client stopped the project'
  AND NOT EXISTS (SELECT 1 FROM stability_pull WHERE study_id = (pg_temp.s2st()).id AND status IN ('Scheduled','Ordered')));
SELECT pg_temp.expect_true('An open pull order (not yet pulled) is cancelled with its sample and tests; pulls taken stay in testing',
  (SELECT status FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'ordered40')) = 'Cancelled'
  AND (SELECT s.status::text FROM sample s JOIN stability_pull p ON p.sample_id = s.id WHERE p.id = (SELECT v::uuid FROM s2k WHERE k = 'ordered40')) = 'Cancelled'
  AND NOT EXISTS (SELECT 1 FROM requested_test WHERE stability_pull_id = (SELECT v::uuid FROM s2k WHERE k = 'ordered40') AND status <> 'Cancelled')
  AND (SELECT status FROM stability_pull WHERE id = (SELECT v::uuid FROM s2k WHERE k = 'pulled25')) = 'Pulled'
  AND EXISTS (SELECT 1 FROM requested_test WHERE stability_pull_id = (SELECT v::uuid FROM s2k WHERE k = 'pulled25') AND status <> 'Cancelled'));
SELECT pg_temp.expect_true('Each material''s fate is recorded and its rack is free',
  (pg_temp.s2store('25 °C / 60% RH')).status = 'Destroyed' AND (pg_temp.s2store('40 °C / 75% RH')).status = 'Returned'
  AND (pg_temp.s2store('40 °C / 75% RH')).disposition_note = 'Courier to Beta Foods' AND (pg_temp.s2store('30 °C / 65% RH')).status = 'Retained'
  AND (pg_temp.s2store('30 °C / 65% RH')).disposed_by = pg_temp.s2u('akiddle')
  AND NOT EXISTS (SELECT 1 FROM stability_storage WHERE study_id = (pg_temp.s2st()).id AND status = 'Stored'));
SELECT pg_temp.expect_error_like('A cancelled study cannot be amended', $$SELECT new_stability_version(pg_temp.s2proj())$$, 'was cancelled');
SELECT pg_temp.expect_error_like('or cancelled again', $$SELECT cancel_stability_study((pg_temp.s2st()).id, 'Again', '[]')$$, 'already cancelled');
SELECT pg_temp.expect_true('The cancelled study takes no new pull orders', create_due_stability_pulls(pg_temp.s2cfl()) >= 0
  AND NOT EXISTS (SELECT 1 FROM stability_pull WHERE study_id = (pg_temp.s2st()).id AND status = 'Ordered'));
SELECT pg_temp.expect_true('The audit trail links amendments, assessments and reports to the study page',
  (SELECT audit_record_ref('stability_report', id, to_jsonb(r)) ->> 'href' = '#/stability/studies/' || (pg_temp.s2st()).id FROM stability_report r WHERE study_id = (pg_temp.s2st()).id LIMIT 1)
  AND (SELECT audit_record_ref('stability_excursion_assessment', id, to_jsonb(a)) ->> 'label' LIKE 'Excursion assessment for STB-%' FROM stability_excursion_assessment a WHERE study_id = (pg_temp.s2st()).id LIMIT 1)
  AND (SELECT audit_record_ref('stability_amendment', id, to_jsonb(a)) ->> 'label' LIKE 'Amendment 1 of STB-%' FROM stability_amendment a WHERE study_id = (pg_temp.s2st()).id LIMIT 1));

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
