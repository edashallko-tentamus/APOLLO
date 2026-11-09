-- LIMS3 schema, migration 024: WD-6, workflow verification (Alex Kiddle, 2026-10-13: "a test validation check for a
-- completed workflow ... an automated test sample that runs through the entire process and a validation document ...
-- with URS and FRS being satisfied ... objective evidence"). Built by Claude in the cloud. Alex's decisions: built in
-- a new migration (not by changing 021 and 022; numbered 024 after Claude Code's 023), QA signs the protocol and the report, and the gate applies to every
-- test version. Claude's choices (to confirm, flagged for Jake Teller, QA) are marked [choice].
--  - A verification is a protocol (URS and FRS requirements written from the version's design, and checks with inputs
--    chosen in advance and expected results calculated by a second, independent calculation in the server), approved
--    by QA (signed), then executed (signed "Executed by"): an automated sample runs through the whole workflow, entered
--    by automated accounts through the same rules the bench uses, and every check records what the system produced.
--    QA then signs the report. The version's design is fingerprinted: any change after the protocol voids it.
--  - [choice] Three automated accounts sign the run: "Verification analyst", "Verification witness" and "Verification
--    reviewer". They have no password, cannot sign in, are in no group, and get bench (or review) rights only at the
--    verification's lab and only while its run is going on. Their signatures say "Automated verification run".
--  - [choice] The automated sample is ordered under an internal client ("LIMS3 Workflow Verification (internal)") on
--    an order of origin "Workflow Verification", with codes VER-000001-1 (not the lab's sample numbers). Its batches
--    are verification batches: kept out of the backlog, the batch lists, the order lists and the daily QC of real work,
--    take no stock off inventory lots, and take no data except from their run.
--  - [choice] The gate is a lab setting (Require workflow verification), on for CFL and TPS (seed_019). With it on, a
--    version is approved only with a signed, passing verification of exactly its current design. Versions approved
--    before keep their approval.
--  - [choice] Requirements the run could not test (a Hold Point waiting for another test, no usable lot or equipment)
--    are "Not tested", never skipped; QA justifies each one when signing, and the outcome is "Pass with exceptions".
--    A failed check fails the verification, and a failed verification never opens the gate.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

ALTER TYPE lab_order_origin ADD VALUE IF NOT EXISTS 'Workflow Verification';

-------------------------------------------------------------------------------
-- 1. PERMISSION, LAB SETTING, FLAGS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('methods.verify', 'Methods', 'Workflow verification', 'Approve workflow verification protocols and sign their reports (QA)', false, 82);
UPDATE standard_group_template SET permissions = array(SELECT DISTINCT x FROM unnest(permissions || '{methods.verify}'::text[]) x) WHERE group_name = 'QA';
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, 'methods.verify' FROM lab_group g WHERE g.is_standard AND g.site_id IS NOT NULL AND g.group_name = 'QA' ON CONFLICT DO NOTHING;

ALTER TABLE lab_site ADD COLUMN require_workflow_verification boolean NOT NULL DEFAULT false;
ALTER TABLE client ADD COLUMN is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE app_user ADD COLUMN is_automated boolean NOT NULL DEFAULT false;
ALTER TABLE test_batch ADD COLUMN is_verification boolean NOT NULL DEFAULT false;

CREATE FUNCTION verification_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.verification_internal', true), '') = '1'
$$;
CREATE FUNCTION set_verification_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.verification_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;

-------------------------------------------------------------------------------
-- 2. VERIFICATIONS, THEIR REQUIREMENTS AND CHECKS
-------------------------------------------------------------------------------
CREATE SEQUENCE workflow_verification_seq;
CREATE TABLE workflow_verification (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_code      text NOT NULL UNIQUE DEFAULT 'VER-' || lpad(nextval('workflow_verification_seq')::text, 6, '0'),
    test_version_id        uuid NOT NULL REFERENCES test_version(id),
    site_id                uuid NOT NULL REFERENCES lab_site(id),
    status                 text NOT NULL DEFAULT 'Protocol draft'
                           CHECK (status IN ('Protocol draft','Protocol approved','Running','Executed','Report signed','Cancelled')),
    config_hash            text NOT NULL,          -- the fingerprint of the version's design the protocol was written for
    definition             jsonb NOT NULL,         -- that design, as it was
    generator              text NOT NULL,          -- the protocol writer and independent calculation used (name and version)
    plan                   jsonb NOT NULL DEFAULT '{}'::jsonb,   -- the run's samples and every value it will enter (decided in the protocol)
    prepared_signature_id  uuid REFERENCES signature_event(id),
    protocol_approved_by   uuid REFERENCES app_user(id),
    protocol_approved_at   timestamptz,
    protocol_signature_id  uuid REFERENCES signature_event(id),
    executed_by            uuid REFERENCES app_user(id),
    executed_at            timestamptz,
    execution_signature_id uuid REFERENCES signature_event(id),
    finished_at            timestamptz,
    lab_order_id           uuid REFERENCES lab_order(id),
    outcome                text CHECK (outcome IN ('Pass','Pass with exceptions','Fail')),
    run_log                jsonb,                  -- what the run did, step by step (who, what, when)
    report_conclusion      text,
    report_signed_by       uuid REFERENCES app_user(id),
    report_signed_at       timestamptz,
    report_signature_id    uuid REFERENCES signature_event(id),
    cancelled_reason       text,
    record_version         integer NOT NULL DEFAULT 1,
    created_at             timestamptz NOT NULL DEFAULT now(),
    created_by             uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at            timestamptz NOT NULL DEFAULT now(),
    modified_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX workflow_verification_version_idx ON workflow_verification (test_version_id);
CALL make_gxp('workflow_verification', false);

CREATE TABLE verification_requirement (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id   uuid NOT NULL REFERENCES workflow_verification(id),
    req_code          text NOT NULL,               -- URS-01, FRS-01
    kind              text NOT NULL CHECK (kind IN ('URS','FRS')),
    statement         text NOT NULL CHECK (btrim(statement) <> ''),
    source            text,                        -- where in the design it comes from
    traces            text[] NOT NULL DEFAULT '{}',  -- an FRS: the URS it serves
    sort_order        integer NOT NULL DEFAULT 0,
    result            text CHECK (result IN ('Pass','Fail','Not tested')),
    result_note       text,
    qa_justification  text,                        -- QA, when signing: why a Not tested requirement is acceptable
    record_version    integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at       timestamptz NOT NULL DEFAULT now(),
    modified_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (verification_id, req_code)
);
CALL make_gxp('verification_requirement', false);

CREATE TABLE verification_check (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id   uuid NOT NULL REFERENCES workflow_verification(id),
    check_code        text NOT NULL,               -- VC-01
    case_label        text NOT NULL,               -- the sample case (Typical, Below LOQ, Above specification) or Process
    title             text NOT NULL CHECK (btrim(title) <> ''),
    procedure_text    text,                        -- what the run does for this check
    requirement_codes text[] NOT NULL DEFAULT '{}',
    sample_key        text,                        -- the protocol's sample (S1, S2...) the check is about
    inputs            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- decided in the protocol, before the run
    expected          jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {"text": ..., values...}, decided in the protocol
    actual            jsonb,                       -- what the system produced
    result            text CHECK (result IN ('Pass','Fail','Not tested')),
    note              text,
    batch_id          uuid REFERENCES test_batch(id),
    evidence_ref      text,                        -- where the evidence is (the batch, step or page shown)
    executed_at       timestamptz,
    sort_order        integer NOT NULL DEFAULT 0,
    record_version    integer NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at       timestamptz NOT NULL DEFAULT now(),
    modified_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (verification_id, check_code)
);
CALL make_gxp('verification_check', false);

-- Only the verification functions write these tables; a check's result is written once, during the run
CREATE FUNCTION verification_tables_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT verification_internal() THEN
        RAISE EXCEPTION 'Workflow verifications change only through their protocol, run and report';
    END IF;
    IF TG_TABLE_NAME = 'verification_check' AND TG_OP = 'UPDATE' THEN
        IF to_jsonb(OLD)->>'result' IS NOT NULL AND (to_jsonb(NEW)->'result' IS DISTINCT FROM to_jsonb(OLD)->'result' OR to_jsonb(NEW)->'actual' IS DISTINCT FROM to_jsonb(OLD)->'actual') THEN
            RAISE EXCEPTION 'A verification check''s result is recorded once and never changed';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON workflow_verification FOR EACH ROW EXECUTE FUNCTION verification_tables_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON verification_requirement FOR EACH ROW EXECUTE FUNCTION verification_tables_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON verification_check FOR EACH ROW EXECUTE FUNCTION verification_tables_rules();

-- The verification whose run is going on in this transaction (NULL when none)
CREATE FUNCTION verification_running() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT w.id FROM workflow_verification w
     WHERE w.id = CASE WHEN COALESCE(current_setting('lims.verification_id', true), '') ~ '^[0-9a-f-]{36}$'
                       THEN current_setting('lims.verification_id', true)::uuid END
       AND w.status = 'Running'
$$;

-------------------------------------------------------------------------------
-- 3. THE AUTOMATED ACCOUNTS
-------------------------------------------------------------------------------
-- No password, no administrator rights, never in a group; the flag is set only by a migration
CREATE FUNCTION app_user_automated_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.is_automated IS DISTINCT FROM OLD.is_automated AND NOT in_group_sync() THEN
        RAISE EXCEPTION 'Whether an account is automated is fixed when it is created';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.is_automated AND NOT in_group_sync() THEN
        RAISE EXCEPTION 'Automated accounts are created only by the system';
    END IF;
    IF NEW.is_automated AND (NEW.password_hash IS NOT NULL OR NEW.is_admin OR NEW.must_change_password) THEN
        RAISE EXCEPTION '% is an automated verification account: it has no password and cannot sign in', NEW.full_name;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_automated BEFORE INSERT OR UPDATE ON app_user FOR EACH ROW EXECUTE FUNCTION app_user_automated_rules();

INSERT INTO app_user (username, full_name, is_active, is_automated) VALUES
 ('verify.analyst',  'Verification analyst (automated)', true, true),
 ('verify.witness',  'Verification witness (automated)', true, true),
 ('verify.reviewer', 'Verification reviewer (automated)', true, true)
ON CONFLICT (username) DO NOTHING;

-- Automated accounts are never members of a group (not even through the job role or lab access sync)
CREATE OR REPLACE FUNCTION group_member_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g lab_group;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.group_id <> OLD.group_id OR NEW.user_id <> OLD.user_id) THEN
        RAISE EXCEPTION 'End the membership (Inactive) and add a new one instead';
    END IF;
    SELECT * INTO g FROM lab_group WHERE id = NEW.group_id;
    IF NEW.status = 'Active' AND (SELECT is_automated FROM app_user WHERE id = NEW.user_id) THEN
        RAISE EXCEPTION '% is an automated verification account and cannot be in a group', (SELECT full_name FROM app_user WHERE id = NEW.user_id);
    END IF;
    IF NEW.status = 'Active' AND g.status <> 'Active' THEN RAISE EXCEPTION 'Group "%" is Inactive', g.group_name; END IF;
    IF NEW.status = 'Active' AND NOT (SELECT is_active FROM app_user WHERE id = NEW.user_id) THEN
        RAISE EXCEPTION 'This user is deactivated and cannot be added to a group';
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF g.site_id IS NULL AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator can change who is in an all-labs group'; END IF;
    IF g.site_id IS NOT NULL THEN PERFORM require_permission_at('admin.users', g.site_id); END IF;
    IF NEW.user_id = current_app_user() AND NEW.status = 'Active' AND (TG_OP = 'INSERT' OR OLD.status <> 'Active') AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'You cannot add yourself to a group; another administrator must do it';
    END IF;
    PERFORM assert_signed('change who is in a group');
    RETURN NEW;
END $$;

-- ... nor do they have lab access (they get it only during a run, below)
CREATE FUNCTION user_site_access_automated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Active' AND (SELECT is_automated FROM app_user WHERE id = NEW.user_id) THEN
        RAISE EXCEPTION '% is an automated verification account: it works only during a verification run, at that verification''s lab',
            (SELECT full_name FROM app_user WHERE id = NEW.user_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_automated BEFORE INSERT OR UPDATE ON user_site_access FOR EACH ROW EXECUTE FUNCTION user_site_access_automated();

-- What an automated account may do: bench work (analyst, witness) or review (reviewer), only at the lab of the
-- verification whose run is going on, and only during that run. The analyst also holds review rights, so the run can
-- show that someone who did the bench work is refused as its reviewer for that reason (not for lack of rights).
CREATE FUNCTION automated_grant(p_user uuid, p_code text, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM app_user u JOIN workflow_verification w ON w.id = verification_running()
                    WHERE u.id = p_user AND u.is_automated AND u.is_active
                      AND (p_site IS NULL OR p_site = w.site_id)
                      AND p_code = ANY (CASE u.username WHEN 'verify.reviewer' THEN '{testing.review}'::text[]
                                                        WHEN 'verify.analyst' THEN '{testing.perform,testing.review}'::text[]
                                                        WHEN 'verify.witness' THEN '{testing.perform}'::text[] ELSE '{}'::text[] END))
$$;
CREATE OR REPLACE FUNCTION user_has_permission_at(p_user uuid, p_code text, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                     JOIN group_permission gp ON gp.group_id = g.id JOIN permission p ON p.code = gp.permission_code
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active' AND p.status = 'Active'
                      AND gp.permission_code = p_code
                      AND (g.site_id IS NULL OR p_site IS NULL OR g.site_id = p_site))
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> '' AND automated_grant(p_user, p_code, p_site))
$$;
CREATE OR REPLACE FUNCTION user_can_access_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND g.site_id = p_site)
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> ''
            AND (automated_grant(p_user, 'testing.perform', p_site) OR automated_grant(p_user, 'testing.review', p_site)))
$$;
-- The automated analyst and witness work in every department of the verification's lab, during the run
CREATE OR REPLACE FUNCTION user_in_department(p_user uuid, p_department uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND u.is_active AND g.department_id = p_department)
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> ''
            AND automated_grant(p_user, 'testing.perform', (SELECT site_id FROM department WHERE id = p_department)))
$$;

-- Signatures: an automated account signs only during a run, and its signature says so (and names the verification);
-- nobody else can sign that way
ALTER TABLE signature_event DROP CONSTRAINT signature_event_method_check;
ALTER TABLE signature_event ADD CONSTRAINT signature_event_method_check CHECK (method IN ('User ID and password','Data load script','Automated verification run'));
ALTER TABLE signature_event ADD COLUMN verification_id uuid REFERENCES workflow_verification(id);
CREATE OR REPLACE FUNCTION signature_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u app_user;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Signatures are permanent and cannot be changed or deleted'; END IF;
    NEW.user_id := current_app_user();     -- nobody can sign for someone else
    SELECT * INTO u FROM app_user WHERE id = NEW.user_id;
    NEW.full_name := u.full_name;
    NEW.signed_at := clock_timestamp();
    NEW.verification_id := NULL;
    IF u.is_automated THEN
        IF verification_running() IS NULL THEN RAISE EXCEPTION '% signs only during a workflow verification run', u.full_name; END IF;
        NEW.method := 'Automated verification run';
        NEW.verification_id := verification_running();
    ELSIF NEW.method = 'Automated verification run' THEN
        RAISE EXCEPTION 'Only the automated verification accounts sign as an automated verification run';
    END IF;
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 4. THE VERSION'S DESIGN AND ITS FINGERPRINT
-------------------------------------------------------------------------------
-- Everything that decides how the workflow behaves (ids of steps and audit columns left out, so a copy with the same
-- design has the same fingerprint)
CREATE FUNCTION test_version_definition(p_version uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'test_id', v.test_id, 'test_name', t.test_name, 'site_id', t.site_id, 'department_id', t.department_id, 'version_no', v.version_no,
        'method_id', v.method_id, 'procedure_text', v.procedure_text,
        'rounding_mode', v.rounding_mode, 'rounding_digits', v.rounding_digits, 'nd_below_lod', v.nd_below_lod,
        'analytes', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'analyte_id', a.analyte_id, 'analyte_name', an.analyte_name, 'sort_order', a.sort_order, 'result_type', a.result_type,
                'reporting_unit', a.reporting_unit, 'loq', a.loq, 'lod', a.lod, 'rounding_mode', a.rounding_mode, 'rounding_digits', a.rounding_digits,
                'hide_on_report', a.hide_on_report, 'hide_loq', a.hide_loq, 'hide_lod', a.hide_lod,
                'default_spec_min', a.default_spec_min, 'default_spec_max', a.default_spec_max, 'default_spec_text', a.default_spec_text,
                'result_values', to_jsonb(a.result_values), 'found_values', to_jsonb(a.found_values)) ORDER BY a.sort_order, an.analyte_name, a.analyte_id)
              FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = v.id AND a.status = 'Active'), '[]'::jsonb),
        'steps', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'step_key', s.step_key, 'step_name', s.step_name, 'step_type', s.step_type, 'sort_order', s.sort_order,
                'department_id', s.department_id, 'instructions', s.instructions, 'config', s.config,
                'equipment', COALESCE((SELECT jsonb_agg(jsonb_build_object('equipment_type_id', e.equipment_type_id, 'type_name', et.type_name, 'is_main', e.is_main)
                                                         ORDER BY e.is_main DESC, et.type_name, e.equipment_type_id)
                                         FROM workflow_step_equipment e JOIN equipment_type et ON et.id = e.equipment_type_id
                                        WHERE e.step_id = s.id AND e.status = 'Active'), '[]'::jsonb),
                'depends_on', COALESCE((SELECT jsonb_agg(jsonb_build_object('step_key', p.step_key, 'type', d.dependency_type) ORDER BY p.step_key)
                                          FROM workflow_step_dependency d JOIN workflow_step p ON p.id = d.depends_on_step_id
                                         WHERE d.step_id = s.id AND d.status = 'Active'), '[]'::jsonb)) ORDER BY s.sort_order, s.step_key)
              FROM workflow_step s WHERE s.test_version_id = v.id AND s.status = 'Active'), '[]'::jsonb))
      FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = p_version
$$;
CREATE FUNCTION test_version_config_hash(p_version uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT md5((test_version_definition(p_version) - 'version_no')::text)
$$;

-------------------------------------------------------------------------------
-- 5. VERIFICATION BATCHES: OUT OF THE LAB'S WORK, NO STOCK, NO DATA OUTSIDE THEIR RUN
-------------------------------------------------------------------------------
ALTER TABLE test_batch ADD COLUMN verification_id uuid REFERENCES workflow_verification(id);
ALTER TABLE test_batch ADD CONSTRAINT test_batch_verification CHECK (is_verification = (verification_id IS NOT NULL));

-- The backlog (as in 023): a verification's samples are in it only during that verification's run
CREATE OR REPLACE VIEW test_pool_view AS
SELECT x.*, CASE WHEN x.kind = 'Re-prep' THEN 0 WHEN x.is_rush THEN 1 ELSE 2 END AS priority_rank,
       CASE WHEN x.kind = 'Re-prep' THEN 'Re-prep' WHEN x.is_rush THEN 'Rush' ELSE 'Standard' END AS priority
  FROM (
    SELECT rt.id AS requested_test_id, NULL::uuid AS reprep_request_id, 'New'::text AS kind, 1 AS replicates, NULL::text AS reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id AS sample_id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text AS rush_status,
           rt.rush_status IN ('Auto-accepted','Approved') AS is_rush, s.logged_at, rt.created_at AS pooled_at,
           rt.media_lot_id IS NOT NULL AS is_media, rt.media_lot_id
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id
      JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rt.status = 'In Pool'
       AND (o.origin::text <> 'Workflow Verification' OR o.id = (SELECT w.lab_order_id FROM workflow_verification w WHERE w.id = verification_running()))
       AND EXISTS (SELECT 1 FROM workflow_step ws WHERE ws.test_version_id = rt.test_version_id AND ws.status = 'Active')
       AND NOT EXISTS (SELECT 1 FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id
                        WHERE e.requested_test_id = rt.id AND b.status <> 'Cancelled' AND e.removed_at IS NULL)
    UNION ALL
    SELECT rp.requested_test_id, rp.id, 'Re-prep', rp.replicates, rp.reason,
           rt.test_id, rt.test_version_id, v.version_no, t.test_code, t.test_name, t.department_id, o.site_id,
           s.id, s.sample_code, s.client_sample_id, s.matrix, rt.due_date, rt.rush_status::text,
           rt.rush_status IN ('Auto-accepted','Approved'), s.logged_at, rp.created_at,
           rt.media_lot_id IS NOT NULL, rt.media_lot_id
      FROM reprep_request rp JOIN requested_test rt ON rt.id = rp.requested_test_id JOIN sample s ON s.id = rt.sample_id
      JOIN lab_order o ON o.id = s.lab_order_id JOIN test t ON t.id = rt.test_id JOIN test_version v ON v.id = rt.test_version_id
     WHERE rp.status = 'Pooled' AND rt.status <> 'Cancelled'
       AND (o.origin::text <> 'Workflow Verification' OR o.id = (SELECT w.lab_order_id FROM workflow_verification w WHERE w.id = verification_running()))
  ) x;

-- Bench work and review in a verification batch: only its automated run
CREATE OR REPLACE FUNCTION assert_can_perform(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; ws workflow_step;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    SELECT * INTO b FROM test_batch WHERE id = r.batch_id;
    SELECT * INTO ws FROM workflow_step WHERE id = r.step_id;
    IF b.is_verification AND verification_running() IS NULL THEN
        RAISE EXCEPTION 'Batch % belongs to a workflow verification: only its automated run records work in it', b.batch_code;
    END IF;
    PERFORM require_permission_at('testing.perform', b.site_id);
    IF NOT can_perform_step(current_app_user(), ws.id) THEN
        RAISE EXCEPTION '"%" is done by the % department; you are not in a group for it (Admin > Groups)', ws.step_name,
            COALESCE((SELECT department_name FROM department WHERE id = step_department(ws.id)), 'test''s');
    END IF;
    IF b.status IN ('Approved','Cancelled') THEN RAISE EXCEPTION 'Batch % is %', b.batch_code, b.status; END IF;
END $$;
CREATE OR REPLACE FUNCTION assert_can_review(p_batch uuid) RETURNS test_batch LANGUAGE plpgsql AS $$
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    IF b.is_verification AND verification_running() IS NULL THEN
        RAISE EXCEPTION 'Batch % belongs to a workflow verification: only its automated run reviews it', b.batch_code;
    END IF;
    PERFORM require_permission_at('testing.review', b.site_id);
    IF EXISTS (SELECT 1 FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = b.id AND ws.step_type <> 'QC Review'
                AND current_app_user() IN (r.performed_by, r.witness_id)) THEN
        RAISE EXCEPTION 'You performed or witnessed a step of %; someone else must review it', b.batch_code;
    END IF;
    RETURN b;
END $$;

-- Materials recorded in a verification batch are traced to their lot but take nothing off its stock
CREATE OR REPLACE FUNCTION entry_material_stock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE l inventory_lot; b test_batch; e batch_entry; ws workflow_step; q numeric; t uuid; ref text;
BEGIN
    IF testing_internal() THEN RETURN NULL; END IF;
    SELECT * INTO l FROM inventory_lot WHERE id = NEW.lot_id;
    SELECT tb.* INTO b FROM test_batch tb JOIN step_run r ON r.batch_id = tb.id WHERE r.id = NEW.step_run_id;
    IF b.is_verification THEN RETURN NULL; END IF;
    SELECT w.* INTO ws FROM workflow_step w JOIN step_run r ON r.step_id = w.id WHERE r.id = NEW.step_run_id;
    SELECT * INTO e FROM batch_entry WHERE id = NEW.entry_id;
    ref := b.batch_code || ' ' || ws.step_name || ': ' || COALESCE(e.label, 'whole batch');
    IF TG_OP = 'INSERT' AND NEW.status = 'Active' THEN
        q := round(NEW.volume * unit_factor(NEW.volume_unit, l.unit, l.physical_form::text), 4);
        IF q IS NULL OR q = 0 THEN RAISE EXCEPTION 'The amount used is too small to record in the lot''s unit (%)', l.unit; END IF;
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes)
        VALUES (NEW.lot_id, 'Usage', -q, ref, NEW.purpose || ', ' || trim(trailing '.' from trim(trailing '0' from NEW.volume::text)) || ' ' || NEW.volume_unit) RETURNING id INTO t;
        PERFORM set_testing_internal(true);
        UPDATE entry_material SET usage_txn_id = t WHERE id = NEW.id;
        PERFORM set_testing_internal(false);
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'Active' AND NEW.status <> 'Active' AND NEW.usage_txn_id IS NOT NULL AND NEW.return_txn_id IS NULL THEN
        PERFORM set_testing_internal(true);
        INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes, corrects_txn_id)
        SELECT lot_id, 'Usage', -quantity_change, ref, 'Returned: removed from the bench record', id FROM inventory_transaction WHERE id = NEW.usage_txn_id RETURNING id INTO t;
        UPDATE entry_material SET return_txn_id = t WHERE id = NEW.id;
        PERFORM set_testing_internal(false);
    END IF;
    RETURN NULL;
END $$;

-- create_batch (as in 023): a batch made during a verification run is a verification batch, and daily QC is shared
-- only among batches of the same verification (a verification never uses, or lends, the lab's daily controls)
CREATE OR REPLACE FUNCTION create_batch(p_site uuid, p_version uuid, p_items jsonb DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; bs workflow_step; v_max integer := 500; v_batch uuid; it record; pos integer := 0; n integer := 0; n_all integer := 0; v_full boolean := false;
        q jsonb; i integer; k integer; v_orig batch_entry; v_obatch text; v_every integer; v_first uuid; samples uuid[] := '{}'; e uuid; v_label text; v_ent uuid;
        v_ver boolean; v_vid uuid;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Test version not found'; END IF;
    PERFORM require_permission_at('testing.perform', p_site);
    v_vid := (SELECT w.id FROM workflow_verification w WHERE w.id = verification_running() AND w.test_version_id = p_version);
    v_ver := v_vid IS NOT NULL;
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'Batching';
    IF bs.id IS NOT NULL THEN
        IF NOT can_perform_step(current_app_user(), bs.id) THEN
            RAISE EXCEPTION 'Batching % is done by the % department; you are not in a group for it', t.test_name,
                COALESCE((SELECT department_name FROM department WHERE id = step_department(bs.id)), 'test''s');
        END IF;
        v_max := COALESCE((bs.config->>'max_samples')::int, 500);
    END IF;
    PERFORM set_testing_internal(true);
    INSERT INTO test_batch (site_id, test_id, test_version_id, department_id, assigned_to, is_verification, verification_id)
    VALUES (p_site, t.id, v.id, t.department_id, current_app_user(), v_ver, v_vid) RETURNING id INTO v_batch;
    FOR it IN SELECT p.* FROM test_pool_view p
               WHERE p.site_id = p_site AND p.test_version_id = p_version
                 AND (p_items IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) j
                        WHERE (j->>'requested_test_id')::uuid = p.requested_test_id AND (j->>'reprep_request_id') IS NOT DISTINCT FROM p.reprep_request_id::text))
               ORDER BY p.priority_rank, p.due_date NULLS LAST, p.logged_at, p.sample_code LOOP
        IF NOT it.is_media THEN   -- client samples stop at the first that does not fit (as before); media samples still join
            IF v_full OR n + it.replicates > v_max THEN v_full := true; CONTINUE; END IF;
        END IF;
        FOR i IN 1..it.replicates LOOP
            IF NOT it.is_media THEN n := n + 1; END IF;
            n_all := n_all + 1; pos := pos + 1;
            INSERT INTO batch_entry (batch_id, position, entry_type, requested_test_id, label, replicate_no, reprep_request_id)
            VALUES (v_batch, pos, 'Sample', it.requested_test_id,
                    CASE WHEN it.kind = 'Re-prep'
                         THEN 'RP' || ((SELECT count(*) FROM batch_entry x WHERE x.requested_test_id = it.requested_test_id AND x.reprep_request_id IS NOT NULL) + 1) || '-'
                         ELSE '' END || COALESCE(it.sample_code, it.client_sample_id),
                    i, it.reprep_request_id) RETURNING id INTO e;
            IF NOT it.is_media THEN samples := samples || e; END IF;
            IF v_first IS NULL AND it.is_media THEN v_ent := COALESCE(v_ent, e); END IF;
        END LOOP;
        IF it.reprep_request_id IS NOT NULL THEN UPDATE reprep_request SET status = 'Batched', batch_id = v_batch WHERE id = it.reprep_request_id; END IF;
    END LOOP;
    IF n_all = 0 THEN RAISE EXCEPTION 'Nothing in the pool for this test at this lab'; END IF;
    v_first := COALESCE(samples[1], v_ent);
    FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(bs.config->'qc', '[]')) LOOP
        IF q->>'frequency' = 'Once' THEN
            FOR i IN 1..COALESCE((q->>'count')::int, 1) LOOP
                pos := pos + 1;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label, parent_entry_id)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', q->>'qc_class',
                        q->>'qc_type' || CASE WHEN COALESCE((q->>'count')::int, 1) > 1 THEN ' ' || i ELSE '' END,
                        CASE WHEN q->>'qc_type' IN ('Matrix Spike','Matrix Spike Duplicate') THEN v_first END);
            END LOOP;
        ELSIF q->>'frequency' = 'Every N' THEN
            v_every := GREATEST(COALESCE((q->>'every_n')::int, 10), 1);
            k := ceil(n::numeric / v_every)::int + 1;
            FOR i IN 1..k LOOP
                pos := pos + 1;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', q->>'qc_class', q->>'qc_type' || '-' || i);
            END LOOP;
        ELSIF q->>'frequency' = 'Daily' THEN
            SELECT x.* INTO v_orig FROM batch_entry x JOIN test_batch ob ON ob.id = x.batch_id JOIN lab_site ls ON ls.id = ob.site_id
             WHERE ob.site_id = p_site AND ob.test_id = t.id AND ob.id <> v_batch AND ob.status <> 'Cancelled' AND x.status = 'Active'
               AND ob.verification_id IS NOT DISTINCT FROM v_vid
               AND x.qc_type = q->>'qc_type' AND x.daily_of_entry_id IS NULL AND x.label LIKE '%(daily)'
               AND (ob.created_at AT TIME ZONE ls.time_zone)::date = site_today(p_site)
             ORDER BY ob.created_at LIMIT 1;
            pos := pos + 1;
            IF v_orig.id IS NULL THEN
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', COALESCE(q->>'qc_class', 'Prep'), q->>'qc_type' || ' (daily)');
            ELSE
                SELECT batch_code INTO v_obatch FROM test_batch WHERE id = v_orig.batch_id;
                INSERT INTO batch_entry (batch_id, position, entry_type, qc_type, qc_class, label, daily_of_entry_id)
                VALUES (v_batch, pos, 'QC', q->>'qc_type', v_orig.qc_class, q->>'qc_type' || ' (daily, from ' || v_obatch || ')', v_orig.id);
            END IF;
        END IF;
    END LOOP;
    PERFORM batch_order(v_batch);
    INSERT INTO step_run (batch_id, step_id) SELECT v_batch, id FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    PERFORM set_testing_internal(false);
    RETURN v_batch;
END $$;

-- A verification batch's samples never change (023's batch edits)
CREATE OR REPLACE FUNCTION assert_batch_editable(p_batch uuid) RETURNS test_batch LANGUAGE plpgsql AS $$
DECLARE b test_batch; bs workflow_step;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL THEN RAISE EXCEPTION 'Batch not found'; END IF;
    IF b.is_verification THEN RAISE EXCEPTION 'Batch % belongs to a workflow verification: its samples never change', b.batch_code; END IF;
    PERFORM require_permission_at('testing.perform', b.site_id);
    SELECT * INTO bs FROM workflow_step WHERE test_version_id = b.test_version_id AND status = 'Active' AND step_type = 'Batching';
    IF bs.id IS NOT NULL AND NOT can_perform_step(current_app_user(), bs.id) THEN
        RAISE EXCEPTION 'Batching % is done by the % department; you are not in a group for it', (SELECT test_name FROM test WHERE id = b.test_id),
            COALESCE((SELECT department_name FROM department WHERE id = step_department(bs.id)), 'test''s');
    END IF;
    IF b.status NOT IN ('Open','In Progress') THEN RAISE EXCEPTION 'Batch % is %: its samples can no longer change', b.batch_code, lower(b.status::text); END IF;
    IF batch_started(p_batch) THEN
        RAISE EXCEPTION 'Batch % has started (bench work is recorded), so samples can no longer be added or removed. Re-prep a sample, or cancel the batch.', b.batch_code;
    END IF;
    RETURN b;
END $$;

DROP VIEW test_batch_view;
CREATE VIEW test_batch_view AS
SELECT b.*, s.site_code, t.test_code, t.test_name, v.version_no, d.department_code, au.full_name AS assigned_name,
       ru.full_name AS reviewed_by_name, tu.full_name AS returned_by_name, cu.full_name AS cancelled_by_name,
       (SELECT count(*) FROM batch_entry e WHERE e.batch_id = b.id AND e.entry_type = 'Sample' AND e.status = 'Active') AS sample_count,
       (SELECT count(*) FROM batch_entry e WHERE e.batch_id = b.id AND e.entry_type = 'QC' AND e.status = 'Active') AS qc_count,
       (SELECT count(*) FROM step_run r WHERE r.batch_id = b.id AND r.status = 'Completed') AS steps_done,
       (SELECT count(*) FROM step_run r WHERE r.batch_id = b.id) AS steps_total,
       (SELECT ws.step_name FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
         WHERE r.batch_id = b.id AND r.status <> 'Completed'
           AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency dd JOIN step_run p ON p.step_id = dd.depends_on_step_id AND p.batch_id = b.id
                            WHERE dd.step_id = ws.id AND dd.status = 'Active' AND p.status <> 'Completed')
         ORDER BY ws.sort_order LIMIT 1) AS next_step,
       (SELECT min(rt.due_date) FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = b.id AND e.status = 'Active') AS earliest_due,
       (SELECT w.verification_code FROM workflow_verification w WHERE w.id = b.verification_id) AS verification_code
  FROM test_batch b JOIN lab_site s ON s.id = b.site_id JOIN test t ON t.id = b.test_id JOIN test_version v ON v.id = b.test_version_id
  LEFT JOIN department d ON d.id = b.department_id JOIN app_user au ON au.id = b.assigned_to
  LEFT JOIN app_user ru ON ru.id = b.reviewed_by LEFT JOIN app_user tu ON tu.id = b.returned_by LEFT JOIN app_user cu ON cu.id = b.cancelled_by;

-------------------------------------------------------------------------------
-- 6. PROTOCOL, RUN AND REPORT
-------------------------------------------------------------------------------
-- A new protocol for a draft version (methods.design). The server writes the requirements and checks from the design
-- whose fingerprint it read (p_hash); if the design changed meanwhile the protocol is refused. Earlier verifications of
-- the version that were not signed off are cancelled (superseded).
CREATE FUNCTION create_verification(p_version uuid, p_hash text, p_generator text, p_plan jsonb, p_requirements jsonb, p_checks jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; w uuid; r jsonb; c jsonb; n integer := 0; code text;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Test version not found'; END IF;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    PERFORM require_methods_permission('methods.design', t.site_id);
    PERFORM assert_signed('write a verification protocol');
    IF v.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is %: only a draft version is verified before its approval', v.version_no, v.status; END IF;
    IF p_hash IS DISTINCT FROM test_version_config_hash(p_version) THEN
        RAISE EXCEPTION 'The version changed while the protocol was being written; try again';
    END IF;
    IF EXISTS (SELECT 1 FROM test_version_problems(p_version) WHERE severity = 'Error') THEN
        RAISE EXCEPTION 'Fix the version''s problems (Review and approve) before writing its verification protocol';
    END IF;
    IF jsonb_array_length(COALESCE(p_requirements, '[]')) = 0 OR jsonb_array_length(COALESCE(p_checks, '[]')) = 0 THEN
        RAISE EXCEPTION 'A protocol needs requirements and checks';
    END IF;
    PERFORM ensure_reason('Workflow verification protocol written');
    PERFORM set_verification_internal(true);
    FOR w IN SELECT id FROM workflow_verification WHERE test_version_id = p_version AND status IN ('Protocol draft','Protocol approved','Executed') LOOP
        UPDATE workflow_verification SET status = 'Cancelled', cancelled_reason = 'Superseded by a new protocol' WHERE id = w;
    END LOOP;
    INSERT INTO workflow_verification (test_version_id, site_id, config_hash, definition, generator, plan, prepared_signature_id)
    VALUES (p_version, t.site_id, p_hash, test_version_definition(p_version), p_generator, COALESCE(p_plan, '{}'),
            NULLIF(current_setting('lims.signature_id', true), '')::uuid) RETURNING id INTO w;
    FOR r IN SELECT * FROM jsonb_array_elements(p_requirements) LOOP
        n := n + 1;
        INSERT INTO verification_requirement (verification_id, req_code, kind, statement, source, traces, sort_order)
        VALUES (w, r->>'req_code', r->>'kind', r->>'statement', r->>'source',
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(r->'traces', '[]'))), n);
    END LOOP;
    n := 0;
    FOR c IN SELECT * FROM jsonb_array_elements(p_checks) LOOP
        n := n + 1;
        FOREACH code IN ARRAY ARRAY(SELECT jsonb_array_elements_text(COALESCE(c->'requirement_codes', '[]'))) LOOP
            IF NOT EXISTS (SELECT 1 FROM verification_requirement WHERE verification_id = w AND req_code = code) THEN
                RAISE EXCEPTION 'Check % traces to %, which is not a requirement of the protocol', c->>'check_code', code;
            END IF;
        END LOOP;
        INSERT INTO verification_check (verification_id, check_code, case_label, title, procedure_text, requirement_codes, sample_key, inputs, expected, sort_order)
        VALUES (w, c->>'check_code', c->>'case_label', c->>'title', c->>'procedure_text',
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(c->'requirement_codes', '[]'))), c->>'sample_key',
                COALESCE(c->'inputs', '{}'), COALESCE(c->'expected', '{}'), n);
    END LOOP;
    PERFORM set_verification_internal(false);
    RETURN w;
END $$;

-- The fingerprint still matches (the version has not changed since the protocol was written)
CREATE FUNCTION assert_verification_current(w workflow_verification) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF w.config_hash IS DISTINCT FROM test_version_config_hash(w.test_version_id) THEN
        RAISE EXCEPTION 'The version changed after % was written: write a new verification protocol', w.verification_code;
    END IF;
END $$;

-- QA approves the protocol (signed "Approved by"), never one they wrote
CREATE FUNCTION approve_verification_protocol(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w workflow_verification;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    PERFORM require_methods_permission('methods.verify', w.site_id);
    PERFORM assert_signed('approve a verification protocol');
    IF w.status <> 'Protocol draft' THEN RAISE EXCEPTION '% is %, not a protocol waiting for approval', w.verification_code, w.status; END IF;
    IF w.created_by = current_app_user() THEN RAISE EXCEPTION 'You wrote this protocol, so someone else (QA) must approve it'; END IF;
    PERFORM assert_verification_current(w);
    PERFORM ensure_reason('Verification protocol approved');
    PERFORM set_verification_internal(true);
    UPDATE workflow_verification SET status = 'Protocol approved', protocol_approved_by = current_app_user(), protocol_approved_at = clock_timestamp(),
           protocol_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_id;
    PERFORM set_verification_internal(false);
END $$;

-- The run starts (signed "Executed by", methods.design): the verification is Running for the rest of this transaction,
-- and its order is made: one sample per protocol sample (p_samples: [{key, description, matrix, specs: [{analyte_id,
-- min, max, text, unit}]}]), each with the test (this draft version), logged with the verification's own codes
CREATE FUNCTION start_verification_run(p_id uuid, p_samples jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE w workflow_verification; v test_version; t test; cl uuid; ct uuid; pj uuid; pv uuid; ln uuid; o uuid; s uuid; rt uuid; x jsonb; sp jsonb;
        out jsonb := '[]'; i integer := 0; was_sync text := COALESCE(current_setting('lims.group_sync', true), ''); v_code text;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    PERFORM require_methods_permission('methods.design', w.site_id);
    PERFORM assert_signed('execute a verification');
    IF w.status <> 'Protocol approved' THEN RAISE EXCEPTION '% is %: QA approves the protocol before it is executed', w.verification_code, w.status; END IF;
    PERFORM assert_verification_current(w);
    SELECT * INTO v FROM test_version WHERE id = w.test_version_id;
    IF v.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is already %', v.version_no, v.status; END IF;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    IF jsonb_array_length(COALESCE(p_samples, '[]')) = 0 THEN RAISE EXCEPTION 'The run needs at least one sample'; END IF;
    PERFORM ensure_reason('Workflow verification executed');
    PERFORM set_verification_internal(true);
    UPDATE workflow_verification SET status = 'Running', executed_by = current_app_user(), executed_at = clock_timestamp(),
           execution_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_id;
    PERFORM set_config('lims.verification_id', p_id::text, true);
    -- the internal client, its contact and a zero-price quote for the test (system records, made as needed)
    PERFORM set_config('lims.group_sync', '1', true);
    SELECT id INTO cl FROM client WHERE is_internal AND legal_name = 'LIMS3 Workflow Verification (internal)';
    IF cl IS NULL THEN
        INSERT INTO client (legal_name, display_name, account_status, is_internal, default_report_delivery)
        VALUES ('LIMS3 Workflow Verification (internal)', 'Workflow Verification (internal)', 'Active', true, 'Email') RETURNING id INTO cl;
    END IF;
    SELECT c.contact_id INTO ct FROM client_contact c WHERE c.client_id = cl AND c.status = 'Active' LIMIT 1;
    IF ct IS NULL THEN
        SELECT id INTO ct FROM contact WHERE email = 'workflow.verification@lims3.invalid';
        IF ct IS NULL THEN
            INSERT INTO contact (first_name, last_name, email, job_title, portal_access)
            VALUES ('Workflow', 'Verification', 'workflow.verification@lims3.invalid', 'Automated verification (internal)', false) RETURNING id INTO ct;
        END IF;
        INSERT INTO client_contact (client_id, contact_id, roles) VALUES (cl, ct, '{PRIMARY,ORDERING,REPORT}');
    END IF;
    INSERT INTO project (client_id, project_name, purpose) VALUES (cl, w.verification_code || ' ' || t.test_name || ' v' || v.version_no, 'Workflow verification (internal, automated)')
    RETURNING id INTO pj;
    pv := new_project_version(pj);
    INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity) VALUES (pv, t.id, jsonb_array_length(p_samples)) RETURNING id INTO ln;
    UPDATE quoted_test_configuration SET final_price = 0 WHERE id = ln;
    UPDATE project_version SET status = 'Quoted', valid_until = current_date + 1 WHERE id = pv;
    UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = ct WHERE id = pv;
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, origin, po_number, notes, status)
    VALUES (cl, w.site_id, ct, 'Online', 'Workflow Verification', w.verification_code, 'Automated workflow verification of ' || t.test_name || ' v' || v.version_no, 'Submitted')
    RETURNING id INTO o;
    FOR x IN SELECT * FROM jsonb_array_elements(p_samples) LOOP
        i := i + 1;
        v_code := w.verification_code || '-' || i;
        INSERT INTO sample (lab_order_id, client_sample_id, description, matrix, quantity_received, quantity_unit, number_of_units, condition)
        VALUES (o, x->>'key', COALESCE(x->>'description', 'Automated verification sample'), NULLIF(x->>'matrix', ''), 100, 'g', 1, 'Acceptable') RETURNING id INTO s;
        -- the draft version is pinned here on purpose: this is the version under verification
        INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id) VALUES (s, t.id, v.id, ln) RETURNING id INTO rt;
        FOR sp IN SELECT * FROM jsonb_array_elements(COALESCE(x->'specs', '[]')) LOOP
            INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
            VALUES (rt, (sp->>'analyte_id')::uuid, (sp->>'min')::numeric, (sp->>'max')::numeric, NULLIF(sp->>'text', ''), NULLIF(sp->>'unit', ''), 'Lab');
        END LOOP;
        UPDATE sample SET logged_at = clock_timestamp(), logged_by = current_app_user(), status = 'Logged', received_at = clock_timestamp(), sample_code = v_code WHERE id = s;
        UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = rt;
        out := out || jsonb_build_object('key', x->>'key', 'sample_id', s, 'requested_test_id', rt, 'sample_code', v_code);
    END LOOP;
    UPDATE workflow_verification SET lab_order_id = o WHERE id = p_id;
    PERFORM set_config('lims.group_sync', was_sync, true);
    PERFORM set_verification_internal(false);
    RETURN jsonb_build_object('lab_order_id', o, 'samples', out);
END $$;

-- During the run: what the system produced for a check, and whether it matches what the protocol expected
CREATE FUNCTION record_verification_check(p_id uuid, p_code text, p_actual jsonb, p_result text, p_note text, p_batch uuid, p_evidence text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c verification_check;
BEGIN
    IF verification_running() IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'Checks are recorded only during their verification''s run'; END IF;
    SELECT * INTO c FROM verification_check WHERE verification_id = p_id AND check_code = p_code;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Check % is not in the protocol', p_code; END IF;
    IF c.result IS NOT NULL THEN RAISE EXCEPTION 'Check % is already recorded', p_code; END IF;
    IF p_result NOT IN ('Pass','Fail','Not tested') THEN RAISE EXCEPTION 'A check passes, fails or is not tested'; END IF;
    PERFORM set_verification_internal(true);
    UPDATE verification_check SET actual = COALESCE(p_actual, '{}'), result = p_result, note = NULLIF(btrim(p_note), ''), batch_id = p_batch,
           evidence_ref = p_evidence, executed_at = clock_timestamp() WHERE id = c.id;
    PERFORM set_verification_internal(false);
END $$;

-- The run ends: checks never reached are Not tested; each requirement takes the result of its checks (a failed check
-- fails it; with no failure, an untested check leaves it Not tested); the outcome follows
CREATE FUNCTION finish_verification_run(p_id uuid, p_run_log jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE w workflow_verification; rq record; nf integer; nn integer; np integer; v_out text;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF verification_running() IS DISTINCT FROM p_id THEN RAISE EXCEPTION 'The run of % is not going on', w.verification_code; END IF;
    PERFORM set_verification_internal(true);
    UPDATE verification_check SET result = 'Not tested', note = COALESCE(note, 'The run did not reach this check'), executed_at = clock_timestamp(), actual = COALESCE(actual, '{}')
     WHERE verification_id = p_id AND result IS NULL;
    FOR rq IN SELECT * FROM verification_requirement WHERE verification_id = p_id LOOP
        SELECT count(*) FILTER (WHERE c.result = 'Fail'), count(*) FILTER (WHERE c.result = 'Not tested'), count(*) FILTER (WHERE c.result = 'Pass')
          INTO nf, nn, np FROM verification_check c WHERE c.verification_id = p_id AND rq.req_code = ANY (c.requirement_codes);
        UPDATE verification_requirement SET
               result = CASE WHEN nf > 0 THEN 'Fail' WHEN nn > 0 OR np = 0 THEN 'Not tested' ELSE 'Pass' END,
               result_note = CASE WHEN nf > 0 THEN nf || ' check' || CASE WHEN nf > 1 THEN 's' ELSE '' END || ' failed'
                                  WHEN np + nn = 0 THEN 'No check traces to it'
                                  WHEN nn > 0 THEN nn || ' check' || CASE WHEN nn > 1 THEN 's' ELSE '' END || ' not tested'
                                  ELSE np || ' check' || CASE WHEN np > 1 THEN 's' ELSE '' END || ' passed' END
         WHERE id = rq.id;
    END LOOP;
    v_out := CASE WHEN EXISTS (SELECT 1 FROM verification_requirement WHERE verification_id = p_id AND result = 'Fail') THEN 'Fail'
                  WHEN EXISTS (SELECT 1 FROM verification_requirement WHERE verification_id = p_id AND result = 'Not tested') THEN 'Pass with exceptions'
                  ELSE 'Pass' END;
    UPDATE workflow_verification SET status = 'Executed', outcome = v_out, finished_at = clock_timestamp(), run_log = p_run_log WHERE id = p_id;
    PERFORM set_verification_internal(false);
    PERFORM set_config('lims.verification_id', '', true);
    RETURN v_out;
END $$;

-- QA signs the report ("Approved by"), never one they executed; every requirement not tested needs QA's justification
CREATE FUNCTION sign_verification_report(p_id uuid, p_conclusion text, p_justifications jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE w workflow_verification; rq record; j text;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    PERFORM require_methods_permission('methods.verify', w.site_id);
    PERFORM assert_signed('sign a verification report');
    IF w.status <> 'Executed' THEN RAISE EXCEPTION '% is %: the report is signed after the run', w.verification_code, w.status; END IF;
    IF w.executed_by = current_app_user() THEN RAISE EXCEPTION 'You executed this verification, so someone else (QA) must sign its report'; END IF;
    IF COALESCE(btrim(p_conclusion), '') = '' THEN RAISE EXCEPTION 'Write the report''s conclusion'; END IF;
    PERFORM set_verification_internal(true);
    FOR rq IN SELECT * FROM verification_requirement WHERE verification_id = p_id AND result = 'Not tested' ORDER BY sort_order LOOP
        j := btrim(COALESCE(p_justifications->>rq.req_code, ''));
        IF j = '' THEN RAISE EXCEPTION '% was not tested: write why that is acceptable', rq.req_code; END IF;
        UPDATE verification_requirement SET qa_justification = j WHERE id = rq.id;
    END LOOP;
    PERFORM ensure_reason('Verification report signed');
    UPDATE workflow_verification SET status = 'Report signed', report_conclusion = btrim(p_conclusion), report_signed_by = current_app_user(),
           report_signed_at = clock_timestamp(), report_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_id;
    PERFORM set_verification_internal(false);
    RETURN w.outcome;
END $$;

-- Cancel a verification that is not signed off (with a reason)
CREATE FUNCTION cancel_verification(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE w workflow_verification;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    IF NOT (has_permission_at('methods.design', w.site_id) OR has_permission_at('methods.verify', w.site_id)) THEN
        PERFORM require_methods_permission('methods.design', w.site_id);
    END IF;
    IF w.status IN ('Report signed','Cancelled','Running') THEN RAISE EXCEPTION '% is % and cannot be cancelled', w.verification_code, w.status; END IF;
    IF current_reason() IS NULL THEN RAISE EXCEPTION 'Say why the verification is cancelled'; END IF;
    PERFORM set_verification_internal(true);
    UPDATE workflow_verification SET status = 'Cancelled', cancelled_reason = current_reason() WHERE id = p_id;
    PERFORM set_verification_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 7. THE GATE: APPROVING A VERSION
-------------------------------------------------------------------------------
-- The verification that lets a version be approved (NULL when none): signed, passing, of the version's current design
CREATE FUNCTION version_verification(p_version uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT w.id FROM workflow_verification w
     WHERE w.test_version_id = p_version AND w.status = 'Report signed' AND w.outcome IN ('Pass','Pass with exceptions')
       AND w.config_hash = test_version_config_hash(p_version)
     ORDER BY w.report_signed_at DESC LIMIT 1
$$;
CREATE OR REPLACE FUNCTION approve_test_version(p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v test_version; t test; n integer; first_problem text;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version FOR UPDATE;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Test version not found'; END IF;
    IF v.status <> 'Draft' THEN RAISE EXCEPTION 'Version % is already %', v.version_no, v.status; END IF;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    PERFORM require_methods_permission('methods.approve', t.site_id);
    PERFORM assert_signed('approve a test version');
    SELECT count(*), min(problem) INTO n, first_problem FROM test_version_problems(p_version) WHERE severity = 'Error';
    IF n > 0 THEN RAISE EXCEPTION 'Version % has % problem(s) to fix before it can be approved (see Review and approve), e.g.: %', v.version_no, n, first_problem; END IF;
    IF EXISTS (SELECT 1 FROM test_version_authors(p_version) a WHERE a.user_id = current_app_user()) THEN
        RAISE EXCEPTION 'You worked on this version, so someone else must approve it';
    END IF;
    IF (SELECT require_workflow_verification FROM lab_site WHERE id = t.site_id) AND version_verification(p_version) IS NULL THEN
        RAISE EXCEPTION 'Version % needs a passing workflow verification before it can be approved: write the protocol, have QA approve it, execute it and have QA sign the report (Review and approve > Workflow verification)', v.version_no;
    END IF;
    PERFORM ensure_reason('Test version approved');
    PERFORM set_methods_internal(true);
    UPDATE test_version SET status = 'Superseded' WHERE test_id = v.test_id AND status = 'Effective';
    UPDATE test_version SET status = 'Effective', effective_from = now(), approved_by = current_app_user(), approved_at = now(),
           approval_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid
     WHERE id = p_version;
    PERFORM set_methods_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 8. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice23b;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'workflow_verification' THEN
        RETURN jsonb_build_object('label', 'Workflow verification ' || COALESCE(r->>'verification_code', ''), 'link', '#/verification/' || p_id);
    ELSIF p_table IN ('verification_requirement', 'verification_check') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'verification_check' THEN 'Verification check ' ELSE 'Verification requirement ' END
                                           || COALESCE((SELECT verification_code FROM workflow_verification WHERE id = (r->>'verification_id')::uuid), '') || ' '
                                           || COALESCE(r->>'check_code', r->>'req_code', ''),
                                  'link', '#/verification/' || (r->>'verification_id'));
    END IF;
    RETURN audit_record_ref_slice23b(p_table, p_id, r);
END $$;

COMMIT;
