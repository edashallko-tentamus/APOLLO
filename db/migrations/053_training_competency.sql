-- 053: training and competency (0.31.0; Alex, 2026-10-20). Vault: Decision - Training and Competency C-1.
-- Alex's decisions:
--  1. Someone without a current qualification for a test cannot do its bench steps; each lab switches this on when its
--     records are ready (lab_site.require_training, system administrators).
--  2. Competency is shown either by training samples run through the real workflow and compared with known values, or by
--     a record of training done outside the LIMS with its evidence. The trainer evaluates it; QA approves (signed).
--  3. Rules, configurable per lab and per department: after N different tests qualified in a department (Alex: 4) a
--     person is "department trained"; that can let them do any test of the department and/or evaluate other people's
--     training there (Alex: both, configurable). A rolling counter of how often each person does each test is kept,
--     and a training report per person lists what they trained on and their last competency sample.
--  4. Initial competency (before doing a test) and continuing competency (kept up: a competency sample every N months,
--     and optionally at least N runs in M months) are kept apart.
-- Existing staff: a lab switching training on grants "legacy" qualifications (QA signs) to whoever did a test there in
-- the last 12 months, so nobody is locked out on day one.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 053: training and competency', true);

-------------------------------------------------------------------------------
-- 1. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('training.view', 'Training', 'Training records', 'See everyone''s training at the lab: qualifications, counters, competency due and the training reports (everyone sees their own)', false, 130),
 ('training.record', 'Training', 'Competency', 'Start training samples and training records for people, and evaluate their competency (never your own)', false, 131),
 ('training.approve', 'Training', 'Competency', 'Approve or reject competency evaluations (signed), grant legacy qualifications when the lab starts, withdraw qualifications', false, 132),
 ('training.configure', 'Training', 'Rules', 'Set the lab''s training rules per department: when someone is department trained and what that allows, continuing competency', false, 133);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{training.view,training.record,training.approve,training.configure}'),
  ('Lab Supervisor', '{training.view,training.record,training.configure}'), ('General Manager', '{training.view}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-- the lab's switch (system administrators, Sites page): off until the lab's records are ready
ALTER TABLE lab_site ADD COLUMN require_training boolean NOT NULL DEFAULT false;

CREATE FUNCTION training_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.training_internal', true), '') = '1'
$$;

-------------------------------------------------------------------------------
-- 2. RULES PER LAB AND DEPARTMENT
-------------------------------------------------------------------------------
CREATE TABLE training_rule (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id               uuid NOT NULL REFERENCES lab_site(id),
    department_id         uuid REFERENCES department(id),     -- NULL: the lab's rule for departments without their own
    dept_trained_after    integer CHECK (dept_trained_after BETWEEN 1 AND 50),   -- NULL: no department-trained status
    unlock_any_test       boolean NOT NULL DEFAULT true,       -- department trained: may do any test of the department
    unlock_can_train      boolean NOT NULL DEFAULT true,       -- department trained: may evaluate others there
    continuing_months     integer CHECK (continuing_months BETWEEN 1 AND 60),    -- a continuing competency sample every N months (NULL: none)
    due_soon_days         integer NOT NULL DEFAULT 30 CHECK (due_soon_days BETWEEN 0 AND 180),
    min_runs              integer CHECK (min_runs BETWEEN 1 AND 500),           -- and at least N runs ...
    min_runs_months       integer CHECK (min_runs_months BETWEEN 1 AND 60),      -- ... in the last M months (both or neither)
    allow_training_samples boolean NOT NULL DEFAULT true,
    allow_records         boolean NOT NULL DEFAULT true,
    status                record_status NOT NULL DEFAULT 'Active',
    record_version        integer NOT NULL DEFAULT 1,
    created_at            timestamptz NOT NULL DEFAULT now(),
    created_by            uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at           timestamptz NOT NULL DEFAULT now(),
    modified_by           uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT training_rule_runs CHECK ((min_runs IS NULL) = (min_runs_months IS NULL)),
    CONSTRAINT training_rule_routes CHECK (allow_training_samples OR allow_records)
);
CREATE UNIQUE INDEX training_rule_one ON training_rule (site_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'Active';
CALL make_gxp('training_rule');
CREATE FUNCTION training_rule_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d department;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.site_id <> OLD.site_id OR NEW.department_id IS DISTINCT FROM OLD.department_id) THEN RAISE EXCEPTION 'A training rule stays with its lab and department'; END IF;
    IF NEW.department_id IS NOT NULL THEN
        SELECT * INTO d FROM department WHERE id = NEW.department_id;
        IF d.site_id <> NEW.site_id THEN RAISE EXCEPTION 'The department belongs to another lab'; END IF;
    END IF;
    IF NOT in_group_sync() THEN PERFORM require_permission_at('training.configure', NEW.site_id); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON training_rule FOR EACH ROW EXECUTE FUNCTION training_rule_rules();
-- every lab starts with its lab-wide rule (Alex: 4 tests; both unlocks; continuing competency yearly); new labs too
INSERT INTO training_rule (site_id, dept_trained_after, continuing_months) SELECT id, 4, 12 FROM lab_site;
CREATE FUNCTION lab_site_training_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO training_rule (site_id, dept_trained_after, continuing_months) VALUES (NEW.id, 4, 12);
    PERFORM set_config('lims.group_sync', '', true);
    RETURN NEW;
END $$;
CREATE TRIGGER zz_training_rule AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_training_rule();

-- the rule for a department: its own, else the lab's
CREATE FUNCTION training_rule_for(p_site uuid, p_dept uuid) RETURNS training_rule LANGUAGE sql STABLE AS $$
    SELECT r.* FROM training_rule r WHERE r.site_id = p_site AND r.status = 'Active' AND (r.department_id = p_dept OR r.department_id IS NULL)
     ORDER BY (r.department_id IS NULL) LIMIT 1
$$;

-------------------------------------------------------------------------------
-- 3. QUALIFICATIONS, AND HOW OFTEN EACH PERSON DOES EACH TEST
-------------------------------------------------------------------------------
CREATE SEQUENCE analyst_qualification_seq;
CREATE TABLE analyst_qualification (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    qualification_code  text NOT NULL UNIQUE DEFAULT 'AQ-' || lpad(nextval('analyst_qualification_seq')::text, 5, '0'),
    user_id             uuid NOT NULL REFERENCES app_user(id),
    test_id             uuid NOT NULL REFERENCES test(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    source              text NOT NULL CHECK (source IN ('Initial competency','Legacy')),
    granted_at          timestamptz NOT NULL DEFAULT now(),
    attempt_id          uuid,                                   -- the initial competency that granted it (FK below)
    last_competency_at  timestamptz NOT NULL DEFAULT now(),     -- initial, or the latest continuing competency approved
    conditions          text,                                   -- a conditional pass: what it is conditional on
    approved_by         uuid REFERENCES app_user(id),
    signature_id        uuid REFERENCES signature_event(id),
    status              record_status NOT NULL DEFAULT 'Active',
    withdrawn_reason    text,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX analyst_qualification_one ON analyst_qualification (user_id, test_id) WHERE status = 'Active';
CREATE INDEX analyst_qualification_user ON analyst_qualification (user_id);
CALL make_gxp('analyst_qualification', false);
CREATE FUNCTION analyst_qualification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT training_internal() THEN RAISE EXCEPTION 'Qualifications are granted by approving a competency (or as legacy when the lab starts), and withdrawn by QA'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON analyst_qualification FOR EACH ROW EXECUTE FUNCTION analyst_qualification_rules();

-- How often a person did a test at a lab: distinct batches where they signed a bench step (QC Review excluded;
-- verification batches excluded), and the last time
CREATE FUNCTION training_runs(p_user uuid, p_test uuid, p_site uuid, p_months integer) RETURNS TABLE (runs integer, last_at timestamptz) LANGUAGE sql STABLE AS $$
    SELECT count(DISTINCT b.id)::int, max(r.completed_at)
      FROM step_run r JOIN test_batch b ON b.id = r.batch_id JOIN workflow_step ws ON ws.id = r.step_id
     WHERE r.performed_by = p_user AND b.test_id = p_test AND b.site_id = p_site AND r.completed_at IS NOT NULL
       AND ws.step_type::text <> 'QC Review' AND NOT b.is_verification AND b.status::text <> 'Cancelled'
       AND (p_months IS NULL OR r.completed_at > now() - make_interval(months => p_months))
$$;

-- A qualification's state: Current, Due soon (continuing competency), Lapsed (continuing competency overdue, or too
-- few runs), Withdrawn. The reason goes with it.
CREATE FUNCTION qualification_state(p_id uuid) RETURNS TABLE (state text, due_on date, runs integer, last_run timestamptz, why text) LANGUAGE plpgsql STABLE AS $$
DECLARE q analyst_qualification; t test; r training_rule; v_due date; v_runs integer; v_last timestamptz; v_all integer; v_today date;
BEGIN
    SELECT * INTO q FROM analyst_qualification WHERE id = p_id;
    IF q.id IS NULL THEN RETURN; END IF;
    SELECT * INTO t FROM test WHERE id = q.test_id;
    r := training_rule_for(q.site_id, t.department_id);
    v_today := site_today(q.site_id);
    SELECT x.runs, x.last_at INTO v_all, v_last FROM training_runs(q.user_id, q.test_id, q.site_id, NULL) x;
    SELECT x.runs INTO v_runs FROM training_runs(q.user_id, q.test_id, q.site_id, COALESCE(r.min_runs_months, 12)) x;
    IF r.continuing_months IS NOT NULL THEN v_due := ((q.last_competency_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = q.site_id))::date + make_interval(months => r.continuing_months))::date; END IF;
    IF q.status <> 'Active' THEN RETURN QUERY SELECT 'Withdrawn'::text, v_due, v_runs, v_last, COALESCE(q.withdrawn_reason, ''); RETURN; END IF;
    IF v_due IS NOT NULL AND v_due < v_today THEN
        RETURN QUERY SELECT 'Lapsed'::text, v_due, v_runs, v_last, 'Continuing competency was due ' || to_char(v_due, 'Mon DD, YYYY'); RETURN;
    END IF;
    IF r.min_runs IS NOT NULL AND v_runs < r.min_runs AND q.granted_at < now() - make_interval(months => r.min_runs_months) THEN
        RETURN QUERY SELECT 'Lapsed'::text, v_due, v_runs, v_last, format('Done %s time(s) in the last %s months (at least %s needed)', v_runs, r.min_runs_months, r.min_runs); RETURN;
    END IF;
    IF v_due IS NOT NULL AND v_due <= v_today + r.due_soon_days THEN
        RETURN QUERY SELECT 'Due soon'::text, v_due, v_runs, v_last, 'Continuing competency due ' || to_char(v_due, 'Mon DD, YYYY'); RETURN;
    END IF;
    RETURN QUERY SELECT 'Current'::text, v_due, v_runs, v_last, ''::text;
END $$;
CREATE FUNCTION qualification_current(p_user uuid, p_test uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM analyst_qualification q, qualification_state(q.id) s
                    WHERE q.user_id = p_user AND q.test_id = p_test AND q.status = 'Active' AND s.state IN ('Current','Due soon'))
$$;
-- Department trained: at least N different tests of the department with a current qualification (the department's rule)
CREATE FUNCTION department_trained(p_user uuid, p_site uuid, p_dept uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT r.dept_trained_after IS NOT NULL AND (
           SELECT count(DISTINCT q.test_id) FROM analyst_qualification q JOIN test t ON t.id = q.test_id
            WHERE q.user_id = p_user AND q.site_id = p_site AND t.department_id = p_dept AND q.status = 'Active' AND qualification_current(p_user, q.test_id)
           ) >= r.dept_trained_after
      FROM training_rule_for(p_site, p_dept) r
$$;
-- May this person evaluate training on this test: training.record, or department trained where the rule lets them train
CREATE FUNCTION can_evaluate_training(p_user uuid, p_test uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT user_has_permission_at(p_user, 'training.record', t.site_id)
        OR (t.department_id IS NOT NULL AND (training_rule_for(t.site_id, t.department_id)).unlock_can_train AND department_trained(p_user, t.site_id, t.department_id))
      FROM test t WHERE t.id = p_test
$$;

-------------------------------------------------------------------------------
-- 4. COMPETENCY ATTEMPTS: INITIAL AND CONTINUING, BY TRAINING SAMPLES OR BY RECORD
-------------------------------------------------------------------------------
CREATE SEQUENCE competency_attempt_seq;
CREATE TABLE competency_attempt (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_code        text NOT NULL UNIQUE DEFAULT 'TA-' || lpad(nextval('competency_attempt_seq')::text, 5, '0'),
    user_id             uuid NOT NULL REFERENCES app_user(id),       -- the trainee
    test_id             uuid NOT NULL REFERENCES test(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    kind                text NOT NULL CHECK (kind IN ('Initial','Continuing')),
    route               text NOT NULL CHECK (route IN ('Training samples','Record')),
    qualification_id    uuid REFERENCES analyst_qualification(id),   -- continuing: the qualification it keeps up
    known_values        jsonb NOT NULL DEFAULT '[]',                 -- training samples: [{analyte_id, value, tolerance_pct | min, max, text}]
    lab_order_id        uuid REFERENCES lab_order(id),               -- training samples: the internal order
    description         text,                                        -- record: what was done (SOP read, observed runs ...)
    trained_on          date,                                        -- record: when
    status              text NOT NULL DEFAULT 'In progress' CHECK (status IN ('In progress','Evaluated','Approved','Rejected','Withdrawn')),
    evaluation          text CHECK (evaluation IN ('Pass','Conditional pass','Fail')),
    evaluation_note     text,
    evaluated_by        uuid REFERENCES app_user(id),
    evaluated_at        timestamptz,
    evaluation_signature_id uuid REFERENCES signature_event(id),
    decision_note       text,
    decided_by          uuid REFERENCES app_user(id),
    decided_at          timestamptz,
    decision_signature_id uuid REFERENCES signature_event(id),
    withdrawn_reason    text,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX competency_attempt_user ON competency_attempt (user_id);
CALL make_gxp('competency_attempt', false);
ALTER TABLE analyst_qualification ADD CONSTRAINT analyst_qualification_attempt FOREIGN KEY (attempt_id) REFERENCES competency_attempt(id);
CREATE FUNCTION competency_attempt_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT training_internal() THEN RAISE EXCEPTION 'A competency attempt changes only through its steps (start, evaluate, approve, withdraw)'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON competency_attempt FOR EACH ROW EXECUTE FUNCTION competency_attempt_rules();

-- the evidence of a record (certificates, signed training forms, observation sheets); never changed
CREATE TABLE competency_evidence (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id      uuid NOT NULL REFERENCES competency_attempt(id),
    document_id     uuid NOT NULL REFERENCES document_file(id),
    title           text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('competency_evidence', false);
CREATE FUNCTION competency_evidence_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a competency_attempt;
BEGIN
    IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Evidence is never changed: attach another document'; END IF;
    SELECT * INTO a FROM competency_attempt WHERE id = NEW.attempt_id;
    IF a.status <> 'In progress' THEN RAISE EXCEPTION 'Evidence is attached while the attempt is in progress'; END IF;
    IF NOT (user_has_permission_at(current_app_user(), 'training.record', a.site_id) OR a.user_id = current_app_user() OR can_evaluate_training(current_app_user(), a.test_id)) THEN
        RAISE EXCEPTION 'Only the trainee or a trainer attaches evidence';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_rules BEFORE INSERT OR UPDATE ON competency_evidence FOR EACH ROW EXECUTE FUNCTION competency_evidence_rules();

-- the training samples' tests point to their attempt (no quote: the lab's own work, not billed; the client is internal)
ALTER TABLE requested_test ADD COLUMN competency_attempt_id uuid REFERENCES competency_attempt(id);
ALTER TABLE requested_test DROP CONSTRAINT requested_test_quoted_or_media;
ALTER TABLE requested_test ADD CONSTRAINT requested_test_quoted_or_media CHECK (quoted_line_id IS NOT NULL OR media_lot_id IS NOT NULL OR serving_order OR competency_attempt_id IS NOT NULL);

CREATE FUNCTION training_client() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_client uuid; v_contact uuid;
BEGIN
    SELECT id INTO v_client FROM client WHERE is_internal AND legal_name = 'Internal: training and competency';
    IF v_client IS NOT NULL THEN RETURN v_client; END IF;
    INSERT INTO client (legal_name, display_name, account_status, is_internal)
    VALUES ('Internal: training and competency', 'Internal: training and competency', 'Active', true) RETURNING id INTO v_client;
    SELECT id INTO v_contact FROM contact WHERE lower(email) = 'training@lims3.internal';
    IF v_contact IS NULL THEN
        INSERT INTO contact (first_name, last_name, email, job_title) VALUES ('Lab', 'Training', 'training@lims3.internal', 'The lab itself (training samples)') RETURNING id INTO v_contact;
    END IF;
    INSERT INTO client_contact (client_id, contact_id, roles, portal_visible) VALUES (v_client, v_contact, '{ORDERING}', false) ON CONFLICT DO NOTHING;
    RETURN v_client;
END $$;

-- Start a competency attempt. Training samples: an internal order with p_samples samples (TRN-<attempt> 1, 2 ...), each
-- with the test and the known values as its specification (so QC Review says whether each result is within them).
-- Record: what was done and when; evidence is attached to it.
CREATE FUNCTION start_competency_attempt(p_user uuid, p_test uuid, p_kind text, p_route text, p_samples integer, p_known jsonb,
    p_description text, p_trained_on date) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t test; r training_rule; v_id uuid; v_q uuid; v_ver uuid; v_order uuid; v_contact uuid; v_client uuid; v_sample uuid; v_rt uuid; k jsonb;
        v_code text; v_was text := COALESCE(current_setting('lims.group_sync', true), ''); v_val numeric; v_tol numeric;
BEGIN
    SELECT * INTO t FROM test WHERE id = p_test;
    IF t.id IS NULL OR t.site_id IS NULL THEN RAISE EXCEPTION 'Choose a test of this lab'; END IF;
    PERFORM assert_site_access(t.site_id);
    IF NOT can_evaluate_training(current_app_user(), p_test) THEN RAISE EXCEPTION 'You may not start training on % (training.record, or department trained where the rule lets you train)', t.test_name; END IF;
    IF p_user = current_app_user() THEN RAISE EXCEPTION 'A trainer does not start their own training: ask another trainer'; END IF;
    IF NOT EXISTS (SELECT 1 FROM app_user WHERE id = p_user AND is_active AND NOT is_automated) THEN RAISE EXCEPTION 'Choose the person being trained'; END IF;
    IF NOT user_can_access_site(p_user, t.site_id) THEN RAISE EXCEPTION 'The person being trained does not work at this lab'; END IF;
    r := training_rule_for(t.site_id, t.department_id);
    IF p_route = 'Training samples' AND NOT r.allow_training_samples THEN RAISE EXCEPTION 'This department''s rule does not use training samples'; END IF;
    IF p_route = 'Record' AND NOT r.allow_records THEN RAISE EXCEPTION 'This department''s rule does not accept training records'; END IF;
    IF p_kind = 'Continuing' THEN
        SELECT id INTO v_q FROM analyst_qualification WHERE user_id = p_user AND test_id = p_test AND status = 'Active';
        IF v_q IS NULL THEN RAISE EXCEPTION 'Continuing competency keeps up a qualification: the person has none for % (start an initial competency)', t.test_name; END IF;
    ELSIF p_kind = 'Initial' THEN
        IF EXISTS (SELECT 1 FROM analyst_qualification WHERE user_id = p_user AND test_id = p_test AND status = 'Active') THEN
            RAISE EXCEPTION 'The person is already qualified for % (record continuing competency instead)', t.test_name;
        END IF;
    ELSE RAISE EXCEPTION 'Initial or Continuing';
    END IF;
    IF EXISTS (SELECT 1 FROM competency_attempt WHERE user_id = p_user AND test_id = p_test AND status IN ('In progress','Evaluated')) THEN
        RAISE EXCEPTION 'The person already has an open competency attempt for %', t.test_name;
    END IF;
    IF p_route = 'Record' THEN
        IF NULLIF(btrim(p_description), '') IS NULL THEN RAISE EXCEPTION 'Describe the training (what was read, observed and done)'; END IF;
        IF p_trained_on IS NULL OR p_trained_on > site_today(t.site_id) THEN RAISE EXCEPTION 'Give the date of the training (not in the future)'; END IF;
    ELSIF p_route = 'Training samples' THEN
        IF p_samples IS NULL OR p_samples NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Training samples: 1 to 10'; END IF;
        IF jsonb_typeof(p_known) <> 'array' OR jsonb_array_length(p_known) = 0 THEN RAISE EXCEPTION 'Give the known value of at least one analyte'; END IF;
        SELECT id INTO v_ver FROM test_version WHERE test_id = p_test AND status = 'Effective';
        IF v_ver IS NULL THEN RAISE EXCEPTION '% has no approved (Effective) version', t.test_name; END IF;
    ELSE RAISE EXCEPTION 'Training samples or Record';
    END IF;
    PERFORM set_config('lims.training_internal', '1', true);
    INSERT INTO competency_attempt (user_id, test_id, site_id, kind, route, qualification_id, known_values, description, trained_on)
    VALUES (p_user, p_test, t.site_id, p_kind, p_route, v_q, CASE WHEN p_route = 'Training samples' THEN p_known ELSE '[]'::jsonb END,
            NULLIF(btrim(p_description), ''), p_trained_on) RETURNING id, attempt_code INTO v_id, v_code;
    IF p_route = 'Training samples' THEN
        PERFORM set_config('lims.group_sync', '1', true);    -- the system makes the internal order and samples (checked above)
        v_client := training_client();
        SELECT cc.contact_id INTO v_contact FROM client_contact cc WHERE cc.client_id = v_client AND 'ORDERING' = ANY (cc.roles) LIMIT 1;
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, notes, status)
        VALUES (v_client, t.site_id, v_contact, 'Training samples ' || v_code || ': ' || t.test_name || ' for ' || (SELECT full_name FROM app_user WHERE id = p_user), 'Received')
        RETURNING id INTO v_order;
        FOR i IN 1..p_samples LOOP
            INSERT INTO sample (lab_order_id, sample_code, client_sample_id, description, received_at, logged_at, logged_by, status, number_of_units)
            VALUES (v_order, 'TRN-' || substr(v_code, 4) || '-' || i, v_code || ' sample ' || i, 'Training sample for ' || (SELECT full_name FROM app_user WHERE id = p_user),
                    clock_timestamp(), clock_timestamp(), current_app_user(), 'Logged', 1) RETURNING id INTO v_sample;
            INSERT INTO requested_test (sample_id, test_id, test_version_id, competency_attempt_id) VALUES (v_sample, p_test, v_ver, v_id) RETURNING id INTO v_rt;
            FOR k IN SELECT * FROM jsonb_array_elements(p_known) LOOP
                v_val := NULLIF(k->>'value', '')::numeric; v_tol := NULLIF(k->>'tolerance_pct', '')::numeric;
                IF NOT EXISTS (SELECT 1 FROM test_version_analyte WHERE test_version_id = v_ver AND analyte_id = (k->>'analyte_id')::uuid AND status = 'Active') THEN
                    RAISE EXCEPTION 'A known value names an analyte that is not on %', t.test_name;
                END IF;
                INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source)
                VALUES (v_rt, (k->>'analyte_id')::uuid,
                        COALESCE(NULLIF(k->>'min', '')::numeric, CASE WHEN v_val IS NOT NULL AND v_tol IS NOT NULL THEN v_val * (1 - v_tol / 100) END),
                        COALESCE(NULLIF(k->>'max', '')::numeric, CASE WHEN v_val IS NOT NULL AND v_tol IS NOT NULL THEN v_val * (1 + v_tol / 100) END),
                        NULLIF(k->>'text', ''),
                        (SELECT reporting_unit FROM test_version_analyte WHERE test_version_id = v_ver AND analyte_id = (k->>'analyte_id')::uuid AND status = 'Active' LIMIT 1), 'Lab');
            END LOOP;
        END LOOP;
        PERFORM set_config('lims.group_sync', v_was, true);
        UPDATE competency_attempt SET lab_order_id = v_order WHERE id = v_id;
    END IF;
    PERFORM set_config('lims.training_internal', '', true);
    RETURN v_id;
END $$;

-- The training samples' results: each test's final results and whether each conforms to the known values
CREATE FUNCTION competency_results(p_attempt uuid) RETURNS TABLE (sample_code text, requested_test_id uuid, analyte text, reported text, unit text, spec text, conformance text, final boolean)
LANGUAGE sql STABLE AS $$
    SELECT s.sample_code, rt.id, COALESCE(a.report_name, a.analyte_name), tr.reported, tr.unit,
           concat_ws(' to ', tr.spec_min::text, tr.spec_max::text), tr.conformance, tr.id IS NOT NULL
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
      LEFT JOIN test_result tr ON tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL
      LEFT JOIN analyte a ON a.id = tr.analyte_id
     WHERE rt.competency_attempt_id = p_attempt AND rt.status <> 'Cancelled'
     ORDER BY s.sample_code, a.analyte_name
$$;

-- The trainer evaluates (signed "Evaluated by"): never the trainee; training samples need their final results
CREATE FUNCTION evaluate_competency_attempt(p_id uuid, p_evaluation text, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a competency_attempt; v_waiting integer;
BEGIN
    SELECT * INTO a FROM competency_attempt WHERE id = p_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Attempt not found'; END IF;
    IF a.status <> 'In progress' THEN RAISE EXCEPTION '% is %: it is evaluated once', a.attempt_code, a.status; END IF;
    IF a.user_id = current_app_user() THEN RAISE EXCEPTION 'Nobody evaluates their own competency'; END IF;
    IF NOT can_evaluate_training(current_app_user(), a.test_id) THEN RAISE EXCEPTION 'You may not evaluate training on this test (training.record, or department trained where the rule lets you train)'; END IF;
    PERFORM assert_signed('evaluate a competency attempt');
    IF p_evaluation NOT IN ('Pass','Conditional pass','Fail') THEN RAISE EXCEPTION 'Pass, Conditional pass or Fail'; END IF;
    IF p_evaluation <> 'Pass' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why (a conditional pass says what it is conditional on)'; END IF;
    IF a.route = 'Training samples' THEN
        SELECT count(*) INTO v_waiting FROM requested_test rt WHERE rt.competency_attempt_id = a.id AND rt.status <> 'Cancelled'
           AND NOT EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final');
        IF v_waiting > 0 THEN RAISE EXCEPTION '% training sample test(s) have no approved final result yet (QC Review)', v_waiting; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM competency_evidence WHERE attempt_id = a.id) THEN
        RAISE EXCEPTION 'Attach the evidence of the training first';
    END IF;
    PERFORM set_config('lims.training_internal', '1', true);
    UPDATE competency_attempt SET status = 'Evaluated', evaluation = p_evaluation, evaluation_note = NULLIF(btrim(p_note), ''), evaluated_by = current_app_user(),
           evaluated_at = clock_timestamp(), evaluation_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = a.id;
    PERFORM set_config('lims.training_internal', '', true);
END $$;

-- QA decides (signed): never the trainee or the evaluator. Approving a pass grants the qualification (initial) or
-- keeps it up (continuing); approving a fail closes the attempt (a new attempt can be started)
CREATE FUNCTION decide_competency_attempt(p_id uuid, p_decision text, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a competency_attempt; v_q uuid;
BEGIN
    SELECT * INTO a FROM competency_attempt WHERE id = p_id FOR UPDATE;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Attempt not found'; END IF;
    IF a.status <> 'Evaluated' THEN RAISE EXCEPTION '% is %: QA decides once it is evaluated', a.attempt_code, a.status; END IF;
    PERFORM require_permission_at('training.approve', a.site_id);
    IF current_app_user() IN (a.user_id, a.evaluated_by) THEN RAISE EXCEPTION 'QA''s approval is by someone other than the trainee and the evaluator'; END IF;
    PERFORM assert_signed('approve a competency evaluation');
    IF p_decision NOT IN ('Approved','Rejected') THEN RAISE EXCEPTION 'Approved or Rejected'; END IF;
    IF p_decision = 'Rejected' AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why the evaluation is rejected'; END IF;
    PERFORM set_config('lims.training_internal', '1', true);
    UPDATE competency_attempt SET status = p_decision, decision_note = NULLIF(btrim(p_note), ''), decided_by = current_app_user(), decided_at = clock_timestamp(),
           decision_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = a.id;
    IF p_decision = 'Approved' AND a.evaluation IN ('Pass','Conditional pass') THEN
        IF a.kind = 'Initial' THEN
            INSERT INTO analyst_qualification (user_id, test_id, site_id, source, attempt_id, conditions, approved_by, signature_id)
            VALUES (a.user_id, a.test_id, a.site_id, 'Initial competency', a.id, CASE WHEN a.evaluation = 'Conditional pass' THEN a.evaluation_note END,
                    current_app_user(), NULLIF(current_setting('lims.signature_id', true), '')::uuid) RETURNING id INTO v_q;
        ELSE
            UPDATE analyst_qualification SET last_competency_at = clock_timestamp(),
                   conditions = CASE WHEN a.evaluation = 'Conditional pass' THEN a.evaluation_note ELSE NULL END
             WHERE id = a.qualification_id AND status = 'Active' RETURNING id INTO v_q;
        END IF;
    END IF;
    PERFORM set_config('lims.training_internal', '', true);
    RETURN v_q;
END $$;

CREATE FUNCTION withdraw_competency_attempt(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE a competency_attempt;
BEGIN
    SELECT * INTO a FROM competency_attempt WHERE id = p_id FOR UPDATE;
    IF a.id IS NULL OR a.status NOT IN ('In progress','Evaluated') THEN RAISE EXCEPTION 'Only an open attempt is withdrawn'; END IF;
    IF NOT (can_evaluate_training(current_app_user(), a.test_id) OR user_has_permission_at(current_app_user(), 'training.approve', a.site_id)) THEN RAISE EXCEPTION 'A trainer or QA withdraws an attempt'; END IF;
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Give the reason'; END IF;
    PERFORM set_config('lims.training_internal', '1', true);
    UPDATE competency_attempt SET status = 'Withdrawn', withdrawn_reason = btrim(p_reason) WHERE id = a.id;
    PERFORM set_config('lims.training_internal', '', true);
    PERFORM set_config('lims.group_sync', '1', true);
    UPDATE requested_test SET status = 'Cancelled' WHERE competency_attempt_id = a.id AND status <> 'Cancelled'
       AND NOT EXISTS (SELECT 1 FROM batch_entry e WHERE e.requested_test_id = requested_test.id AND e.status::text <> 'Superseded');
    PERFORM set_config('lims.group_sync', '', true);
END $$;

-- QA withdraws a qualification (signed, with the reason)
CREATE FUNCTION withdraw_qualification(p_id uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE q analyst_qualification;
BEGIN
    SELECT * INTO q FROM analyst_qualification WHERE id = p_id FOR UPDATE;
    IF q.id IS NULL OR q.status <> 'Active' THEN RAISE EXCEPTION 'Qualification not found'; END IF;
    PERFORM require_permission_at('training.approve', q.site_id);
    PERFORM assert_signed('withdraw a qualification');
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Give the reason'; END IF;
    PERFORM set_config('lims.training_internal', '1', true);
    UPDATE analyst_qualification SET status = 'Inactive', withdrawn_reason = btrim(p_reason) WHERE id = q.id;
    PERFORM set_config('lims.training_internal', '', true);
END $$;

-- Legacy qualifications when a lab starts (QA, signed): whoever signed a bench step of a test there in the last
-- 12 months and holds no qualification for it. Their last run counts as their last competency.
CREATE FUNCTION grant_legacy_qualifications(p_site uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    PERFORM require_permission_at('training.approve', p_site);
    PERFORM assert_signed('grant legacy qualifications');
    PERFORM set_config('lims.training_internal', '1', true);
    INSERT INTO analyst_qualification (user_id, test_id, site_id, source, granted_at, last_competency_at, approved_by, signature_id)
    SELECT x.user_id, x.test_id, p_site, 'Legacy', clock_timestamp(), x.last_at, current_app_user(), NULLIF(current_setting('lims.signature_id', true), '')::uuid
      FROM (SELECT r.performed_by AS user_id, b.test_id, max(r.completed_at) AS last_at
              FROM step_run r JOIN test_batch b ON b.id = r.batch_id JOIN workflow_step ws ON ws.id = r.step_id JOIN app_user u ON u.id = r.performed_by
             WHERE b.site_id = p_site AND r.completed_at > now() - interval '12 months' AND ws.step_type::text <> 'QC Review'
               AND NOT b.is_verification AND b.status::text <> 'Cancelled' AND NOT u.is_automated AND u.is_active
             GROUP BY r.performed_by, b.test_id) x
     WHERE NOT EXISTS (SELECT 1 FROM analyst_qualification q WHERE q.user_id = x.user_id AND q.test_id = x.test_id AND q.status = 'Active');
    GET DIAGNOSTICS n = ROW_COUNT;
    PERFORM set_config('lims.training_internal', '', true);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 5. THE BENCH GATE: SIGNING A BENCH STEP NEEDS A CURRENT QUALIFICATION (WHERE THE LAB REQUIRES TRAINING)
-------------------------------------------------------------------------------
-- NULL when the person may do the test's bench work in this batch, else why not
CREATE FUNCTION training_gate_problem(p_user uuid, p_batch uuid) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE b test_batch; t test; r training_rule; u app_user;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.id IS NULL OR b.is_verification THEN RETURN NULL; END IF;
    IF NOT (SELECT require_training FROM lab_site WHERE id = b.site_id) THEN RETURN NULL; END IF;
    SELECT * INTO u FROM app_user WHERE id = p_user;
    IF u.is_automated THEN RETURN NULL; END IF;
    SELECT * INTO t FROM test WHERE id = b.test_id;
    IF qualification_current(p_user, t.id) THEN RETURN NULL; END IF;
    r := training_rule_for(b.site_id, t.department_id);
    IF t.department_id IS NOT NULL AND r.unlock_any_test AND department_trained(p_user, b.site_id, t.department_id) THEN RETURN NULL; END IF;
    -- the trainee's own training batch: every sample in it is one of their open training samples for this test
    IF EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id WHERE e.batch_id = b.id AND e.status::text <> 'Superseded')
       AND NOT EXISTS (SELECT 1 FROM batch_entry e JOIN requested_test rt ON rt.id = e.requested_test_id
                        LEFT JOIN competency_attempt a ON a.id = rt.competency_attempt_id
                        WHERE e.batch_id = b.id AND e.status::text <> 'Superseded'
                          AND (a.id IS NULL OR a.user_id <> p_user OR a.status <> 'In progress')) THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM analyst_qualification q WHERE q.user_id = p_user AND q.test_id = t.id AND q.status = 'Active') THEN
        RETURN (SELECT format('%s''s qualification for %s has lapsed (%s): record continuing competency before doing its bench work', u.full_name, t.test_name, s.why)
                  FROM analyst_qualification q, qualification_state(q.id) s WHERE q.user_id = p_user AND q.test_id = t.id AND q.status = 'Active' LIMIT 1);
    END IF;
    RETURN format('%s is not qualified for %s: this lab requires training before bench work (Training and competency). A training batch holding only their own training samples is allowed.', u.full_name, t.test_name);
END $$;

CREATE FUNCTION step_run_training_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_type text; v_problem text;
BEGIN
    IF NEW.completed_at IS NULL OR OLD.completed_at IS NOT NULL OR NEW.performed_by IS NULL THEN RETURN NEW; END IF;
    SELECT step_type::text INTO v_type FROM workflow_step WHERE id = NEW.step_id;
    IF v_type = 'QC Review' THEN RETURN NEW; END IF;
    v_problem := training_gate_problem(NEW.performed_by, NEW.batch_id);
    IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_training BEFORE UPDATE OF completed_at ON step_run FOR EACH ROW EXECUTE FUNCTION step_run_training_gate();

-------------------------------------------------------------------------------
-- 6. VIEWS: WHO IS QUALIFIED FOR WHAT, AND THE ATTEMPTS
-------------------------------------------------------------------------------
CREATE VIEW analyst_qualification_view AS
SELECT q.*, u.full_name, u.username, t.test_code, t.test_name, t.department_id, d.department_name, s.state, s.due_on, s.runs AS runs_12m, s.last_run, s.why,
       (SELECT x.runs FROM training_runs(q.user_id, q.test_id, q.site_id, NULL) x) AS runs_total,
       ap.full_name AS approved_by_name, ca.attempt_code
  FROM analyst_qualification q JOIN app_user u ON u.id = q.user_id JOIN test t ON t.id = q.test_id LEFT JOIN department d ON d.id = t.department_id
  LEFT JOIN app_user ap ON ap.id = q.approved_by LEFT JOIN competency_attempt ca ON ca.id = q.attempt_id
  CROSS JOIN LATERAL qualification_state(q.id) s;

CREATE VIEW competency_attempt_view AS
SELECT a.*, u.full_name, t.test_code, t.test_name, t.department_id, d.department_name, o.order_code,
       ev.full_name AS evaluated_by_name, de.full_name AS decided_by_name, cr.full_name AS started_by_name,
       (SELECT count(*) FROM requested_test rt WHERE rt.competency_attempt_id = a.id AND rt.status <> 'Cancelled')::int AS sample_tests,
       (SELECT count(*) FROM requested_test rt WHERE rt.competency_attempt_id = a.id AND rt.status <> 'Cancelled'
          AND EXISTS (SELECT 1 FROM test_result tr WHERE tr.requested_test_id = rt.id AND tr.status = 'Active' AND tr.stage = 'Final'))::int AS sample_tests_done,
       (SELECT count(*) FROM competency_evidence ce WHERE ce.attempt_id = a.id)::int AS evidence_count
  FROM competency_attempt a JOIN app_user u ON u.id = a.user_id JOIN test t ON t.id = a.test_id LEFT JOIN department d ON d.id = t.department_id
  LEFT JOIN lab_order o ON o.id = a.lab_order_id LEFT JOIN app_user ev ON ev.id = a.evaluated_by LEFT JOIN app_user de ON de.id = a.decided_by
  JOIN app_user cr ON cr.id = a.created_by;

-------------------------------------------------------------------------------
-- 7. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_053;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'training_rule' THEN
        RETURN jsonb_build_object('label', 'Training rule ' || COALESCE((SELECT department_name FROM department WHERE id = (r->>'department_id')::uuid), 'for the lab'), 'link', '#/training?tab=rules');
    ELSIF p_table = 'analyst_qualification' THEN
        RETURN jsonb_build_object('label', 'Qualification ' || COALESCE(r->>'qualification_code', '') || ': ' || COALESCE((SELECT full_name FROM app_user WHERE id = (r->>'user_id')::uuid), '')
                                  || ', ' || COALESCE((SELECT test_name FROM test WHERE id = (r->>'test_id')::uuid), ''), 'link', '#/training/people/' || COALESCE(r->>'user_id', ''));
    ELSIF p_table = 'competency_attempt' THEN
        RETURN jsonb_build_object('label', 'Competency ' || COALESCE(r->>'attempt_code', '') || ' (' || COALESCE(r->>'kind', '') || '): ' || COALESCE((SELECT full_name FROM app_user WHERE id = (r->>'user_id')::uuid), '')
                                  || ', ' || COALESCE((SELECT test_name FROM test WHERE id = (r->>'test_id')::uuid), ''), 'link', '#/training/attempts/' || COALESCE(r->>'id', ''));
    ELSIF p_table = 'competency_evidence' THEN
        RETURN jsonb_build_object('label', 'Training evidence ' || COALESCE(r->>'title', ''), 'link', '#/training/attempts/' || COALESCE(r->>'attempt_id', ''));
    END IF;
    RETURN audit_record_ref_053(p_table, p_id, r);
END $$;

COMMIT;
