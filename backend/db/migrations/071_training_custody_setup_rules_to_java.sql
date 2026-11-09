-- 071: the training and competency, lab setup, workflow verification sign-off and handwritten signature rules move to
-- the Java backend (Edashall Konah, 2026-10-29; the database keeps structures only). Java checks them before every write
-- (training/domain: TrainingRule, CompetencyAttempt, Qualification, KnownValue, saved through training/repo
-- TrainingRepository and training/service TrainingService; labsetup/domain: ReportTemplate, LabImage; verification/domain:
-- WorkflowVerification; admin/domain: HandwrittenSignature), with JUnit tests in TrainingRulesTest, LabSetupRulesTest,
-- VerificationRulesTest and HandwrittenSignatureTest.
--
-- Dropped here (Java is now their only checker):
--   * start_competency_attempt, evaluate_competency_attempt, decide_competency_attempt, withdraw_competency_attempt,
--     withdraw_qualification, grant_legacy_qualifications and training_client (only the training routes called them);
--   * competency_attempt_rules, analyst_qualification_rules (changed only through those steps) and competency_evidence_rules
--     (attached while in progress, by the trainee or a trainer; never changed);
--   * the rule part of training_rule_rules (stays with its lab and department; the department of its lab) and the
--     training_rule range, runs-and-months and routes checks;
--   * the rule part of report_template_rules (stays with its lab, known options, the default is never retired) and the
--     template name check; site_media_rules (PNG, JPEG or SVG up to 2 MB, never replaced); the rule part of
--     system_setting_rules (a setting keeps its name) and the setting value check;
--   * approve_verification_protocol, sign_verification_report and cancel_verification (the Java sign-off routes);
--   * set_user_signature (Admin > People and groups, the Java route).
--
-- Kept:
--   * every permission check, as every permission trigger is until the permissions wave: training_rule_rules,
--     report_template_rules and system_setting_rules are replaced below with their permission checks only;
--   * training_internal (requested_test_cancel_rule still honours it), training_rule_for, training_runs,
--     qualification_state, qualification_current, department_trained, can_evaluate_training, competency_results and the
--     views: read by the screens, the training report PDF (Node) and the bench gate;
--   * training_gate_problem and step_run_training_gate (a02_training on step_run): the bench (Java testing) and Node's
--     workflow verification run complete steps; the gate must hold for every writer until the bench wave moves it;
--   * lab_site_training_rule (zz_training_rule on lab_site) and department_training_rule (on department): labs and
--     departments are made by the master data and equipment routes and the data load, which do not make the rules;
--   * the value lists (kind, route, status, evaluation, source, layout, kind of image), as enum types are kept;
--   * verification_tables_rules and set_verification_internal: Node writes the protocol, the run and the evidence;
--     Java's sign-offs set the same switch;
--   * app_user_signature_rules (a01_signature_image): it writes the change to the audit trail (Java sets lims.group_sync);
--   * custody: custody_document_rules, custody_event_rules, make_custody_document, lab_order_custody (z_custody),
--     receive_samples and record_custody_pdf: Receive and sign and the chain of custody PDF stay in Node, and every
--     order submitted by any feature makes its chain of custody; waste classifications moved in 062.
-- Sandbox only: direct writes to the dropped rules' tables (data load scripts, rule-test fixtures) are no longer checked.

-- training: the steps of a competency attempt and the qualifications
DROP FUNCTION IF EXISTS start_competency_attempt(uuid, uuid, text, text, integer, jsonb, text, date);
DROP FUNCTION IF EXISTS evaluate_competency_attempt(uuid, text, text);
DROP FUNCTION IF EXISTS decide_competency_attempt(uuid, text, text);
DROP FUNCTION IF EXISTS withdraw_competency_attempt(uuid, text);
DROP FUNCTION IF EXISTS withdraw_qualification(uuid, text);
DROP FUNCTION IF EXISTS grant_legacy_qualifications(uuid);
DROP FUNCTION IF EXISTS training_client();
DROP TRIGGER IF EXISTS a0_rules ON competency_attempt;
DROP FUNCTION IF EXISTS competency_attempt_rules();
DROP TRIGGER IF EXISTS a0_rules ON analyst_qualification;
DROP FUNCTION IF EXISTS analyst_qualification_rules();
DROP TRIGGER IF EXISTS a0_rules ON competency_evidence;
DROP FUNCTION IF EXISTS competency_evidence_rules();

-- training_rule: the permission check only
CREATE OR REPLACE FUNCTION training_rule_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() THEN PERFORM require_permission_at('training.configure', NEW.site_id); END IF;
    RETURN NEW;
END $$;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_dept_trained_after_check;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_continuing_months_check;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_due_soon_days_check;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_min_runs_check;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_min_runs_months_check;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_runs;
ALTER TABLE training_rule DROP CONSTRAINT IF EXISTS training_rule_routes;

-- lab setup: report templates and system settings keep their permission checks; lab images lose their rules
CREATE OR REPLACE FUNCTION report_template_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.site_id IS NULL) THEN
        IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Templates for every lab are kept by a system administrator; make one for your lab instead'; END IF;
    ELSE
        PERFORM require_permission_at('reports.templates', NEW.site_id);
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE report_template DROP CONSTRAINT IF EXISTS report_template_template_name_check;
CREATE OR REPLACE FUNCTION system_setting_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator changes system settings'; END IF;
    RETURN NEW;
END $$;
ALTER TABLE system_setting DROP CONSTRAINT IF EXISTS system_setting_setting_value_check;
DROP TRIGGER IF EXISTS a02_rules ON site_media;
DROP FUNCTION IF EXISTS site_media_rules();

-- workflow verification: the sign-offs
DROP FUNCTION IF EXISTS approve_verification_protocol(uuid);
DROP FUNCTION IF EXISTS sign_verification_report(uuid, text, jsonb);
DROP FUNCTION IF EXISTS cancel_verification(uuid);

-- handwritten signatures
DROP FUNCTION IF EXISTS set_user_signature(uuid, uuid, text);

