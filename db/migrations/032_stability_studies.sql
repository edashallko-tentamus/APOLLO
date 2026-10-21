-- S-1 Stability studies (Alex, 2026-10-14). Vault: Decision - Stability Studies Are Quoted Whole and Pulled as Lab
-- Orders (approved 2026-10-12), and Decision - Stability Studies S-1 (Alex's answers of 2026-10-14):
--  - "The stability study needs to start as a quote, then submitted, approved quote converts into a study that
--    triggers the samples to be logged in."
--  - Chambers (as Equipment) hold racks, and the stored material is identified by its rack and position.
--  - The ICH conditions are a preset list each lab can extend.
--  - Pull window 7 days by default, configurable (lab setting, and per timepoint): a QA decision for Jake Teller.
--  - The cumulative report: one table per test, timepoints as columns, against the specification.
-- How it is built:
--  - A stability quote is a project of kind 'Stability' (SQ-00001): its versions, prices, the client's link, the
--    Outbox email and the quote list are the quote machinery of 029. Its tests are quote lines (one per test, priced
--    per test performed); the study design hangs off the version: the plan (lab, product, lot, escalation), the
--    conditions, the timepoints (T0 plus pulls, with days early and late) and the matrix cells (a test at a
--    timepoint, for a condition; T0 has no condition). A line's quantity is the number of its cells.
--  - Stability lines are never orderable by hand (orderable_lines leaves them out): only the study orders them.
--  - Accepting the version (by the lab, or by the client through the link) creates the study (STB-00001) and its T0
--    lab order (origin Stability Baseline) with the baseline sample Expected and its T0 tests: intake logs it in.
--  - "Place in chambers" receives the material for each condition into a rack (and position) of a chamber set to
--    that condition, checks it is enough for every pull plus the reserve, logs the T0 sample if intake has not, and
--    schedules the pulls (non-working days move inside the window). On a pull's date its lab order (origin Stability
--    Pull) is made with the pull sample Expected; "Record pull" takes the units out of storage and logs the sample.
--    The pull's turnaround counts from its scheduled date. Each pull is priced at the price for the study year it
--    falls in (the version's annual escalation, compounded on the anniversaries of acceptance).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 032: stability studies', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS, LAB SETTINGS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('stability.configure', 'Stability', 'Conditions, chambers and racks', 'Keep the lab''s stability conditions, chambers and racks', false, 98),
 ('stability.manage', 'Stability', 'Studies', 'Place stability material in chambers, make pull orders and record pulls', false, 99);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{stability.configure}'), ('Administrator', '{stability.configure}'),
 ('Lab Supervisor', '{stability.configure,stability.manage}'), ('Analyst', '{stability.manage}'), ('Intake', '{stability.manage}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

-- The pull window (days early and late) a new timepoint starts with, and the material reserve: per lab (Sites grid)
ALTER TABLE lab_site ADD COLUMN stability_pull_window_days integer NOT NULL DEFAULT 7 CHECK (stability_pull_window_days BETWEEN 0 AND 90);
ALTER TABLE lab_site ADD COLUMN stability_reserve_pct numeric(5,2) NOT NULL DEFAULT 10 CHECK (stability_reserve_pct BETWEEN 0 AND 200);

CREATE FUNCTION stability_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.stability_internal', true), '') = '1' OR in_group_sync()
$$;
-- The study's own steps (creating the study and its T0 order, making pull orders) reach the study's lab whoever
-- triggers them: the client through the link (as the system user), the hourly job, or a sales person of another lab.
CREATE OR REPLACE FUNCTION user_can_access_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND g.site_id = p_site)
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> ''
            AND (automated_grant(p_user, 'testing.perform', p_site) OR automated_grant(p_user, 'testing.review', p_site)))
        OR COALESCE(current_setting('lims.stability_internal', true), '') = '1'
$$;

-------------------------------------------------------------------------------
-- 1. CONDITIONS (a preset list for every lab; each lab adds its own)
-------------------------------------------------------------------------------
CREATE TABLE stability_condition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid REFERENCES lab_site(id),            -- NULL: every lab
    condition_name      text NOT NULL CHECK (btrim(condition_name) <> ''),
    condition_type      text NOT NULL DEFAULT 'Long term' CHECK (condition_type IN ('Long term','Intermediate','Accelerated','Refrigerated','Frozen','Photostability','Other')),
    temperature_c       numeric(5,1),
    temperature_tol     numeric(4,1),
    humidity_pct        numeric(5,1) CHECK (humidity_pct BETWEEN 0 AND 100),
    humidity_tol        numeric(4,1),
    description         text,
    sort_order          integer NOT NULL DEFAULT 100,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_condition_name_uq ON stability_condition (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(condition_name)));
CALL make_gxp('stability_condition');

-------------------------------------------------------------------------------
-- 2. CHAMBERS (equipment) AND THEIR RACKS
-------------------------------------------------------------------------------
CREATE TABLE stability_chamber (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id        uuid NOT NULL UNIQUE REFERENCES equipment(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),   -- the equipment's lab (set by the database)
    condition_id        uuid NOT NULL REFERENCES stability_condition(id),
    notes               text,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('stability_chamber');

CREATE TABLE stability_rack (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chamber_id          uuid NOT NULL REFERENCES stability_chamber(id),
    rack_code           text NOT NULL CHECK (btrim(rack_code) <> ''),
    description         text,
    positions           integer CHECK (positions > 0),           -- optional capacity (number of positions)
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_rack_code_uq ON stability_rack (chamber_id, lower(btrim(rack_code))) WHERE status = 'Active';
CALL make_gxp('stability_rack');

-------------------------------------------------------------------------------
-- 3. THE STABILITY QUOTE: a project of kind 'Stability' and its design per version
-------------------------------------------------------------------------------
ALTER TABLE project DROP CONSTRAINT project_kind_check;
ALTER TABLE project ADD CONSTRAINT project_kind_check CHECK (kind IN ('Project','Quote','Stability'));
CREATE SEQUENCE stability_quote_code_seq;
CREATE OR REPLACE FUNCTION project_code_assign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_code IS NULL THEN
        NEW.project_code := CASE WHEN NEW.kind = 'Quote' THEN 'Q-' || lpad(nextval('quote_code_seq')::text, 5, '0')
                                 WHEN NEW.kind = 'Stability' THEN 'SQ-' || lpad(nextval('stability_quote_code_seq')::text, 5, '0')
                                 ELSE 'PRJ-' || lpad(nextval('project_code_seq')::text, 5, '0') END;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'A project cannot become a quote, or a quote a project'; END IF;
    IF NEW.quote_contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = NEW.client_id AND cc.contact_id = NEW.quote_contact_id AND cc.status = 'Active') THEN
        RAISE EXCEPTION 'The quote''s contact must be an active contact of the client';
    END IF;
    RETURN NEW;
END $$;

-- Stability lines are ordered only by their study (T0 and each pull), never by hand
CREATE OR REPLACE FUNCTION orderable_lines(p_client uuid)
RETURNS TABLE (line_id uuid, project_code text, project_name text, test_id uuid,
               test_name text, final_price numeric, via_parent boolean)
LANGUAGE sql STABLE AS $$
    WITH RECURSIVE anc AS (
        SELECT parent_client_id AS id FROM client WHERE id = p_client AND parent_client_id IS NOT NULL
        UNION
        SELECT c.parent_client_id FROM client c JOIN anc ON c.id = anc.id WHERE c.parent_client_id IS NOT NULL
    )
    SELECT l.id, p.project_code, p.project_name, t.id, t.test_name, l.final_price, p.client_id <> p_client
      FROM project p
      JOIN project_version pv ON pv.project_id = p.id AND pv.status = 'Accepted'
                             AND (pv.valid_until IS NULL OR pv.valid_until >= current_date)
      JOIN quoted_test_configuration l ON l.project_version_id = pv.id AND l.status = 'Active'
      JOIN test t ON t.id = l.test_id AND t.status = 'Active'
     WHERE p.status = 'Active' AND p.kind <> 'Stability'
       AND (p.client_id = p_client OR (p.available_to_child_clients AND p.client_id IN (SELECT id FROM anc)))
$$;

CREATE TABLE stability_plan (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL UNIQUE REFERENCES project_version(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),   -- the lab that stores and tests
    product             text,
    lot                 text,
    protocol_ref        text,                                    -- the client's protocol number
    unit_name           text NOT NULL DEFAULT 'units',           -- bottles, blisters, sachets...
    planned_placement   date,                                    -- for the dates shown on the quotation
    escalation_pct      numeric(5,2) NOT NULL DEFAULT 0 CHECK (escalation_pct BETWEEN 0 AND 50),
    reserve_pct         numeric(5,2) CHECK (reserve_pct BETWEEN 0 AND 200),   -- NULL: the lab's reserve
    notes               text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('stability_plan', false);

CREATE TABLE stability_version_condition (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    condition_id        uuid NOT NULL REFERENCES stability_condition(id),
    sort_order          integer NOT NULL DEFAULT 1,
    status              line_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_version_condition_uq ON stability_version_condition (project_version_id, condition_id) WHERE status = 'Active';
CALL make_gxp('stability_version_condition', false);

CREATE TABLE stability_timepoint (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    label               text NOT NULL CHECK (btrim(label) <> ''),
    interval_value      integer NOT NULL CHECK (interval_value >= 0),
    interval_unit       text NOT NULL DEFAULT 'Months' CHECK (interval_unit IN ('Months','Weeks','Days')),
    days_early          integer NOT NULL DEFAULT 7 CHECK (days_early BETWEEN 0 AND 90),
    days_late           integer NOT NULL DEFAULT 7 CHECK (days_late BETWEEN 0 AND 90),
    status              line_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_timepoint_label_uq ON stability_timepoint (project_version_id, lower(btrim(label))) WHERE status = 'Active';
CREATE UNIQUE INDEX stability_timepoint_when_uq ON stability_timepoint (project_version_id, (CASE WHEN interval_value = 0 THEN 'T0' ELSE interval_value || interval_unit END)) WHERE status = 'Active';
CALL make_gxp('stability_timepoint', false);

CREATE TABLE stability_cell (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    line_id             uuid NOT NULL REFERENCES quoted_test_configuration(id),
    timepoint_id        uuid NOT NULL REFERENCES stability_timepoint(id),
    condition_id        uuid REFERENCES stability_condition(id),  -- NULL only at T0 (baseline, tested at placement)
    units_required      integer NOT NULL DEFAULT 1 CHECK (units_required > 0),
    status              line_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_cell_uq ON stability_cell (line_id, timepoint_id, COALESCE(condition_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE status = 'Active';
CALL make_gxp('stability_cell', false);

-- Who changes the design: quotes.edit, while the version is still a Draft (as for the quote's lines)
CREATE FUNCTION stability_design_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version uuid := (to_jsonb(NEW)->>'project_version_id')::uuid; v_kind text; v_site uuid; tp stability_timepoint; l quoted_test_configuration; v_test_site uuid;
BEGIN
    IF stability_internal() THEN RETURN NEW; END IF;
    SELECT p.kind INTO v_kind FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = v_version;
    IF v_kind IS DISTINCT FROM 'Stability' THEN RAISE EXCEPTION 'Only a stability quote has a study design'; END IF;
    IF TG_OP = 'UPDATE' AND v_version <> (to_jsonb(OLD)->>'project_version_id')::uuid THEN RAISE EXCEPTION 'A study design stays with its quote version'; END IF;
    IF NOT version_is_editable(v_version) THEN RAISE EXCEPTION 'The study design is locked once the quote is issued: start a new version to change it'; END IF;
    IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    SELECT site_id INTO v_site FROM stability_plan WHERE project_version_id = v_version;
    IF TG_TABLE_NAME = 'stability_plan' THEN
        -- the study's lab is the quote's lab (031): a quote made before 031 takes the plan's lab
        SELECT p.site_id INTO v_site FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = v_version;
        IF v_site IS NULL THEN
            UPDATE project SET site_id = NEW.site_id WHERE id = (SELECT project_id FROM project_version WHERE id = v_version);
        ELSIF NEW.site_id IS DISTINCT FROM v_site THEN
            RAISE EXCEPTION 'The study is stored and tested by the lab the quote was made in';
        END IF;
    ELSIF TG_TABLE_NAME = 'stability_version_condition' THEN
        IF NOT EXISTS (SELECT 1 FROM stability_condition c WHERE c.id = NEW.condition_id AND (c.status = 'Active' OR TG_OP = 'UPDATE') AND (c.site_id IS NULL OR c.site_id = v_site)) THEN
            RAISE EXCEPTION 'Choose an active condition of the study''s lab';
        END IF;
    ELSIF TG_TABLE_NAME = 'stability_cell' THEN
        IF NEW.status = 'Active' THEN
            SELECT * INTO tp FROM stability_timepoint WHERE id = NEW.timepoint_id;
            SELECT * INTO l FROM quoted_test_configuration WHERE id = NEW.line_id;
            IF tp.project_version_id <> NEW.project_version_id OR l.project_version_id <> NEW.project_version_id OR tp.status <> 'Active' OR l.status <> 'Active' THEN
                RAISE EXCEPTION 'The test and the timepoint must belong to this version of the quote';
            END IF;
            IF tp.interval_value = 0 AND NEW.condition_id IS NOT NULL THEN RAISE EXCEPTION 'T0 is the baseline, tested at placement: it has no storage condition'; END IF;
            IF tp.interval_value > 0 AND (NEW.condition_id IS NULL OR NOT EXISTS (SELECT 1 FROM stability_version_condition vc
                    WHERE vc.project_version_id = NEW.project_version_id AND vc.condition_id = NEW.condition_id AND vc.status = 'Active')) THEN
                RAISE EXCEPTION 'Each pull is for one of the study''s conditions';
            END IF;
            SELECT site_id INTO v_test_site FROM test WHERE id = l.test_id;
            IF v_test_site IS NOT NULL AND v_test_site IS DISTINCT FROM v_site THEN
                RAISE EXCEPTION '% belongs to % and can only be tested there', (SELECT test_name FROM test WHERE id = l.test_id), (SELECT site_code FROM lab_site WHERE id = v_test_site);
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_plan FOR EACH ROW EXECUTE FUNCTION stability_design_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_version_condition FOR EACH ROW EXECUTE FUNCTION stability_design_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_timepoint FOR EACH ROW EXECUTE FUNCTION stability_design_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_cell FOR EACH ROW EXECUTE FUNCTION stability_design_rules();

-- A test line's quantity is the number of times the study performs it (so the quote total is the study total)
CREATE FUNCTION stability_line_quantity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE gs text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    UPDATE quoted_test_configuration q SET quantity = GREATEST(1, (SELECT count(*) FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active'))
     WHERE q.id IN (NEW.line_id, CASE WHEN TG_OP = 'UPDATE' THEN OLD.line_id END)
       AND q.quantity <> GREATEST(1, (SELECT count(*) FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active'));
    PERFORM set_config('lims.group_sync', gs, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_line_quantity AFTER INSERT OR UPDATE ON stability_cell FOR EACH ROW EXECUTE FUNCTION stability_line_quantity();

-- What still stops a stability quote being issued (Error) or deserves a look (Warning)
CREATE FUNCTION stability_quote_problems(p_version uuid) RETURNS TABLE (severity text, problem text) LANGUAGE plpgsql STABLE AS $$
DECLARE pl stability_plan; p project; r record;
BEGIN
    SELECT * INTO pl FROM stability_plan WHERE project_version_id = p_version;
    SELECT pr.* INTO p FROM project pr JOIN project_version pv ON pv.project_id = pr.id WHERE pv.id = p_version;
    IF pl.id IS NULL THEN severity := 'Error'; problem := 'Choose the lab that stores and tests the study'; RETURN NEXT; RETURN; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_version_condition WHERE project_version_id = p_version AND status = 'Active') THEN
        severity := 'Error'; problem := 'Choose at least one storage condition'; RETURN NEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_timepoint WHERE project_version_id = p_version AND status = 'Active' AND interval_value = 0) THEN
        severity := 'Error'; problem := 'Add the T0 baseline timepoint (interval 0)'; RETURN NEXT; END IF;
    IF NOT EXISTS (SELECT 1 FROM stability_timepoint WHERE project_version_id = p_version AND status = 'Active' AND interval_value > 0) THEN
        severity := 'Error'; problem := 'Add at least one pull timepoint after T0'; RETURN NEXT; END IF;
    FOR r IN SELECT t.test_name FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.project_version_id = p_version AND q.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_cell c WHERE c.line_id = q.id AND c.status = 'Active') LOOP
        severity := 'Error'; problem := r.test_name || ' is not at any timepoint: tick it in the matrix or remove it'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = p_version AND vc.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_cell c WHERE c.project_version_id = p_version AND c.condition_id = vc.condition_id AND c.status = 'Active') LOOP
        severity := 'Error'; problem := r.condition_name || ' has no pulls: tick its tests in the matrix or remove the condition'; RETURN NEXT;
    END LOOP;
    FOR r IN SELECT t.test_name FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.project_version_id = p_version AND q.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = q.test_id AND v.status = 'Effective') LOOP
        severity := 'Error'; problem := r.test_name || ' has no approved workflow yet, so the study could not order it'; RETURN NEXT;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id WHERE cc.client_id = p.client_id AND cc.status = 'Active'
                    AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles)) THEN
        severity := 'Error'; problem := 'The client has no contact with the Ordering role: the study''s orders need one'; RETURN NEXT;
    END IF;
    FOR r IN SELECT sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = p_version AND vc.status = 'Active'
                AND NOT EXISTS (SELECT 1 FROM stability_chamber ch JOIN stability_rack rk ON rk.chamber_id = ch.id AND rk.status = 'Active'
                                 WHERE ch.condition_id = vc.condition_id AND ch.site_id = pl.site_id AND ch.status = 'Active') LOOP
        severity := 'Warning'; problem := r.condition_name || ': the lab has no chamber with a rack at this condition yet'; RETURN NEXT;
    END LOOP;
    IF pl.planned_placement IS NULL THEN severity := 'Warning'; problem := 'No planned placement date: the quotation shows intervals, not dates'; RETURN NEXT; END IF;
END $$;

-- Issuing a stability quote: refused while the design has an Error
CREATE FUNCTION stability_quote_issue() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e text;
BEGIN
    IF NEW.status = 'Quoted' AND OLD.status IS DISTINCT FROM 'Quoted' AND (SELECT kind FROM project WHERE id = NEW.project_id) = 'Stability' THEN
        SELECT string_agg(problem, '; ') INTO e FROM stability_quote_problems(NEW.id) WHERE severity = 'Error';
        IF e IS NOT NULL THEN RAISE EXCEPTION 'The stability quote cannot be issued yet: %', e; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER d_stability_issue BEFORE UPDATE ON project_version FOR EACH ROW EXECUTE FUNCTION stability_quote_issue();

-- A new version of a stability quote (the client asked for a change): the quote lines as for any quote, plus the design
CREATE FUNCTION new_stability_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_prev uuid; v_new uuid; m_cond jsonb := '{}'; r record; v_tp uuid; v_line uuid;
BEGIN
    IF (SELECT kind FROM project WHERE id = p_project) IS DISTINCT FROM 'Stability' THEN RAISE EXCEPTION 'Not a stability quote'; END IF;
    IF EXISTS (SELECT 1 FROM project_version WHERE project_id = p_project AND status IN ('Draft','Submitted for Quote')) THEN
        RAISE EXCEPTION 'There is already a Draft of this quote: change that one';
    END IF;
    IF EXISTS (SELECT 1 FROM stability_study WHERE project_id = p_project) THEN
        RAISE EXCEPTION 'The study has started: amendments to a running study come in a later slice';
    END IF;
    SELECT id INTO v_prev FROM project_version WHERE project_id = p_project ORDER BY version_no DESC LIMIT 1;
    v_new := new_project_version(p_project);
    INSERT INTO stability_plan (project_version_id, site_id, product, lot, protocol_ref, unit_name, planned_placement, escalation_pct, reserve_pct, notes)
    SELECT v_new, site_id, product, lot, protocol_ref, unit_name, planned_placement, escalation_pct, reserve_pct, notes FROM stability_plan WHERE project_version_id = v_prev;
    INSERT INTO stability_version_condition (project_version_id, condition_id, sort_order)
    SELECT v_new, condition_id, sort_order FROM stability_version_condition WHERE project_version_id = v_prev AND status = 'Active';
    FOR r IN SELECT * FROM stability_timepoint WHERE project_version_id = v_prev AND status = 'Active' LOOP
        INSERT INTO stability_timepoint (project_version_id, label, interval_value, interval_unit, days_early, days_late)
        VALUES (v_new, r.label, r.interval_value, r.interval_unit, r.days_early, r.days_late) RETURNING id INTO v_tp;
        INSERT INTO stability_cell (project_version_id, line_id, timepoint_id, condition_id, units_required)
        SELECT v_new, nl.id, v_tp, c.condition_id, c.units_required
          FROM stability_cell c JOIN quoted_test_configuration ol ON ol.id = c.line_id
          JOIN quoted_test_configuration nl ON nl.project_version_id = v_new AND nl.test_id = ol.test_id AND nl.status = 'Active'
         WHERE c.timepoint_id = r.id AND c.status = 'Active'
           AND (c.condition_id IS NULL OR EXISTS (SELECT 1 FROM stability_version_condition vc WHERE vc.project_version_id = v_new AND vc.condition_id = c.condition_id AND vc.status = 'Active'));
    END LOOP;
    RETURN v_new;
END $$;

-------------------------------------------------------------------------------
-- 4. THE STUDY, ITS STORED MATERIAL AND ITS PULLS
-------------------------------------------------------------------------------
CREATE SEQUENCE stability_study_seq;
CREATE TABLE stability_study (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_code          text NOT NULL UNIQUE DEFAULT 'STB-' || lpad(nextval('stability_study_seq')::text, 5, '0'),
    project_id          uuid NOT NULL UNIQUE REFERENCES project(id),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),   -- the accepted version it runs to
    client_id           uuid NOT NULL REFERENCES client(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    contact_id          uuid NOT NULL REFERENCES contact(id),          -- ordering contact of the study's orders
    product             text,
    lot                 text,
    status              text NOT NULL DEFAULT 'Awaiting material' CHECK (status IN ('Awaiting material','Active','Completed','Cancelled')),
    accepted_at         timestamptz NOT NULL,
    escalation_pct      numeric(5,2) NOT NULL DEFAULT 0,
    reserve_pct         numeric(5,2) NOT NULL DEFAULT 10,
    placement_date      date,
    placed_at           timestamptz,
    placed_by           uuid REFERENCES app_user(id),
    t0_order_id         uuid REFERENCES lab_order(id),
    t0_sample_id        uuid REFERENCES sample(id),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('stability_study');

CREATE TABLE stability_storage (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    storage_code        text NOT NULL UNIQUE,                   -- STB-00001-1: the label on the stored material
    study_id            uuid NOT NULL REFERENCES stability_study(id),
    condition_id        uuid NOT NULL REFERENCES stability_condition(id),
    rack_id             uuid NOT NULL REFERENCES stability_rack(id),
    position            text,                                   -- shelf / slot within the rack
    units_received      integer NOT NULL CHECK (units_received > 0),
    units_required      integer NOT NULL DEFAULT 0,             -- every pull of the design, plus the reserve
    shortfall           integer NOT NULL DEFAULT 0,             -- units missing at placement (flagged)
    status              text NOT NULL DEFAULT 'Stored' CHECK (status IN ('Stored','Used up','Returned','Destroyed')),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_storage_one_per_condition ON stability_storage (study_id, condition_id);
CREATE UNIQUE INDEX stability_storage_position_uq ON stability_storage (rack_id, lower(btrim(position))) WHERE status = 'Stored' AND position IS NOT NULL AND btrim(position) <> '';
CALL make_gxp('stability_storage');

CREATE TABLE stability_pull (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    study_id            uuid NOT NULL REFERENCES stability_study(id),
    storage_id          uuid NOT NULL REFERENCES stability_storage(id),
    condition_id        uuid NOT NULL REFERENCES stability_condition(id),
    timepoint_id        uuid NOT NULL REFERENCES stability_timepoint(id),
    nominal_date        date NOT NULL,                          -- placement + interval
    scheduled_date      date NOT NULL,                          -- moved off non-working days, inside the window
    window_start        date NOT NULL,
    window_end          date NOT NULL,
    units_required      integer NOT NULL,
    status              text NOT NULL DEFAULT 'Scheduled' CHECK (status IN ('Scheduled','Ordered','Pulled','Cancelled')),
    lab_order_id        uuid REFERENCES lab_order(id),
    sample_id           uuid REFERENCES sample(id),
    pulled_at           timestamptz,
    pulled_by           uuid REFERENCES app_user(id),
    units_pulled        integer CHECK (units_pulled > 0),
    within_window       boolean,
    pull_note           text,                                   -- why a pull was outside its window
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX stability_pull_uq ON stability_pull (study_id, condition_id, timepoint_id);
CREATE INDEX stability_pull_due_idx ON stability_pull (status, scheduled_date);
CALL make_gxp('stability_pull');

ALTER TABLE requested_test ADD COLUMN stability_study_id uuid REFERENCES stability_study(id);
ALTER TABLE requested_test ADD COLUMN stability_cell_id uuid REFERENCES stability_cell(id);
ALTER TABLE requested_test ADD COLUMN stability_pull_id uuid REFERENCES stability_pull(id);

-- Records of a study are written by its own steps (below); people change them only through those steps
CREATE FUNCTION stability_record_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF stability_internal() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Stability study records change only through the study''s steps (place in chambers, record pull)';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_study FOR EACH ROW EXECUTE FUNCTION stability_record_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_storage FOR EACH ROW EXECUTE FUNCTION stability_record_rules();
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON stability_pull FOR EACH ROW EXECUTE FUNCTION stability_record_rules();

-- Conditions, chambers and racks: stability.configure in the lab (every-lab conditions: system administrators)
CREATE FUNCTION stability_setup_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid; eq equipment; c stability_condition;
BEGIN
    IF TG_TABLE_NAME = 'stability_chamber' THEN
        SELECT * INTO eq FROM equipment WHERE id = NEW.equipment_id;
        NEW.site_id := eq.site_id;
        IF TG_OP = 'INSERT' AND eq.admin_status = 'Retired' THEN RAISE EXCEPTION '% is retired and cannot be a stability chamber', eq.equipment_code; END IF;
        IF TG_OP = 'UPDATE' AND NEW.equipment_id <> OLD.equipment_id THEN RAISE EXCEPTION 'A chamber stays the same piece of equipment'; END IF;
        SELECT * INTO c FROM stability_condition WHERE id = NEW.condition_id;
        IF c.site_id IS NOT NULL AND c.site_id <> NEW.site_id THEN RAISE EXCEPTION 'That condition belongs to another lab'; END IF;
        IF TG_OP = 'UPDATE' AND (NEW.condition_id <> OLD.condition_id OR NEW.status <> OLD.status)
           AND EXISTS (SELECT 1 FROM stability_storage s JOIN stability_rack r ON r.id = s.rack_id WHERE r.chamber_id = NEW.id AND s.status = 'Stored') THEN
            RAISE EXCEPTION 'Study material is stored in this chamber: move it before changing the chamber''s condition or retiring it';
        END IF;
        v_site := NEW.site_id;
    ELSIF TG_TABLE_NAME = 'stability_rack' THEN
        SELECT site_id INTO v_site FROM stability_chamber WHERE id = NEW.chamber_id;
        IF TG_OP = 'UPDATE' AND NEW.chamber_id <> OLD.chamber_id
           AND EXISTS (SELECT 1 FROM stability_storage s WHERE s.rack_id = NEW.id AND s.status = 'Stored') THEN
            RAISE EXCEPTION 'Study material is stored in this rack: it stays in its chamber';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW.status = 'Inactive' AND EXISTS (SELECT 1 FROM stability_storage s WHERE s.rack_id = NEW.id AND s.status = 'Stored') THEN
            RAISE EXCEPTION 'Study material is stored in this rack: move it before retiring the rack';
        END IF;
    ELSE -- stability_condition
        IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A condition stays with its lab'; END IF;
        IF TG_OP = 'UPDATE' AND (NEW.temperature_c, NEW.humidity_pct, NEW.condition_type) IS DISTINCT FROM (OLD.temperature_c, OLD.humidity_pct, OLD.condition_type)
           AND EXISTS (SELECT 1 FROM stability_version_condition WHERE condition_id = NEW.id) THEN
            RAISE EXCEPTION 'This condition is on a stability quote: its temperature, humidity and type are fixed (retire it and add a new one)';
        END IF;
        IF in_group_sync() THEN RETURN NEW; END IF;
        IF NEW.site_id IS NULL OR (TG_OP = 'UPDATE' AND OLD.site_id IS NULL) THEN
            IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Conditions for every lab are kept by a system administrator; add one for your lab instead'; END IF;
            RETURN NEW;
        END IF;
        v_site := NEW.site_id;
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('stability.configure', v_site);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON stability_condition FOR EACH ROW EXECUTE FUNCTION stability_setup_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON stability_chamber FOR EACH ROW EXECUTE FUNCTION stability_setup_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON stability_rack FOR EACH ROW EXECUTE FUNCTION stability_setup_rules();

-------------------------------------------------------------------------------
-- 5. DATES, PRICES AND THE TURNAROUND OF A PULL
-------------------------------------------------------------------------------
CREATE FUNCTION stability_interval_date(p_base date, p_value integer, p_unit text) RETURNS date LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_base + CASE p_unit WHEN 'Months' THEN make_interval(months => p_value) WHEN 'Weeks' THEN make_interval(weeks => p_value) ELSE make_interval(days => p_value) END)::date
$$;
-- A date on a non-working day moves to the next working day if the window allows, otherwise to the previous one
CREATE FUNCTION stability_adjust_date(p_site uuid, p_date date, p_early integer, p_late integer) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE d date;
BEGIN
    IF is_working_day(p_site, p_date) THEN RETURN p_date; END IF;
    d := next_working_day(p_site, p_date);
    IF d <= p_date + p_late THEN RETURN d; END IF;
    d := p_date - 1;
    WHILE d >= p_date - p_early LOOP
        IF is_working_day(p_site, d) THEN RETURN d; END IF;
        d := d - 1;
    END LOOP;
    RETURN p_date;   -- no working day inside the window: keep the date (the pull is done on that day)
END $$;
-- The study year a date falls in (1 = the first year after acceptance) and the price factor for it
CREATE FUNCTION stability_year(p_accepted date, p_date date) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
    SELECT GREATEST(1, extract(year FROM age(p_date, p_accepted))::integer + 1)
$$;
CREATE FUNCTION stability_price_factor(p_pct numeric, p_year integer) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT power(1 + COALESCE(p_pct, 0) / 100, GREATEST(p_year, 1) - 1)
$$;

-- On a study's tests: the price for the study year, and a pull's turnaround counted from its scheduled date
CREATE FUNCTION requested_test_stability() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st stability_study; pl stability_pull; v_site uuid; v_tz text; e test_catalog_entry; v_ref date;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.stability_study_id, NEW.stability_cell_id, NEW.stability_pull_id) IS DISTINCT FROM (OLD.stability_study_id, OLD.stability_cell_id, OLD.stability_pull_id) THEN
        RAISE EXCEPTION 'A study''s test stays with its study, timepoint and pull';
    END IF;
    IF NEW.stability_study_id IS NULL THEN
        IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id
                                         WHERE q.id = NEW.quoted_line_id AND p.kind = 'Stability') THEN
            RAISE EXCEPTION 'A stability quote''s tests are ordered by its study (T0 and each pull), not by hand';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO st FROM stability_study WHERE id = NEW.stability_study_id;
    SELECT * INTO pl FROM stability_pull WHERE id = NEW.stability_pull_id;
    v_ref := COALESCE(pl.scheduled_date, st.placement_date, (st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date);
    IF NEW.status <> 'Cancelled' THEN
        NEW.price := round(NEW.price * stability_price_factor(st.escalation_pct, stability_year((st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date, v_ref)), 2);
    END IF;
    IF pl.id IS NOT NULL AND NEW.clock_start IS NOT NULL AND NEW.tat_unit IS NOT NULL THEN
        SELECT time_zone INTO v_tz FROM lab_site WHERE id = st.site_id;
        SELECT * INTO e FROM test_catalog_entry WHERE test_id = NEW.test_id;
        NEW.clock_start := (pl.scheduled_date::timestamp AT TIME ZONE v_tz);
        NEW.day0 := tat_day0(st.site_id, NEW.clock_start, e.cutoff_time, NEW.tat_unit);
        NEW.due_date := tat_due(st.site_id, NEW.day0, NEW.tat_days, NEW.tat_unit);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER ab_requested_test_stability BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_stability();

-------------------------------------------------------------------------------
-- 6. THE STUDY'S STEPS
-------------------------------------------------------------------------------
-- Order the cells' tests on a sample (T0, or one pull)
CREATE FUNCTION stability_order_tests(p_study uuid, p_sample uuid, p_timepoint uuid, p_condition uuid, p_pull uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE r record; v_ver uuid; v_rt uuid; n integer := 0;
BEGIN
    FOR r IN SELECT c.id AS cell_id, q.id AS line_id, q.test_id FROM stability_cell c JOIN quoted_test_configuration q ON q.id = c.line_id
              WHERE c.timepoint_id = p_timepoint AND c.status = 'Active' AND c.condition_id IS NOT DISTINCT FROM p_condition
              ORDER BY (SELECT test_name FROM test WHERE id = q.test_id) LOOP
        SELECT id INTO v_ver FROM test_version WHERE test_id = r.test_id AND status = 'Effective';
        IF v_ver IS NULL THEN RAISE EXCEPTION '% has no Effective version: approve its workflow before the study can order it', (SELECT test_name FROM test WHERE id = r.test_id); END IF;
        INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, stability_study_id, stability_cell_id, stability_pull_id)
        VALUES (p_sample, r.test_id, v_ver, r.line_id, p_study, r.cell_id, p_pull) RETURNING id INTO v_rt;
        -- an analyte-priced test carries the quoted analytes, as order_test does
        IF (SELECT pricing_mode FROM test_catalog_entry WHERE test_id = r.test_id) = 'Analyte Selection' THEN
            INSERT INTO requested_analyte (requested_test_id, analyte_id, analyte_price, included)
            SELECT v_rt, qs.analyte_id, qs.analyte_price, true FROM quoted_analyte_selection qs WHERE qs.line_id = r.line_id AND qs.included;
            UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = v_rt;
        END IF;
        n := n + 1;
    END LOOP;
    RETURN n;
END $$;

-- Accepting the version creates the study and its T0 order (the baseline sample Expected: intake logs it in)
CREATE FUNCTION create_stability_study(p_version uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v project_version; p project; pl stability_plan; v_contact uuid; v_study uuid; v_order uuid; v_sample uuid; v_code text; t0 uuid;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO v FROM project_version WHERE id = p_version;
    SELECT * INTO p FROM project WHERE id = v.project_id;
    SELECT * INTO pl FROM stability_plan WHERE project_version_id = p_version;
    IF EXISTS (SELECT 1 FROM stability_study WHERE project_id = p.id) THEN RETURN (SELECT id FROM stability_study WHERE project_id = p.id); END IF;
    -- the orders' contact: who accepted, if they order; else the quote's contact; else any ordering contact of the client
    SELECT cc.contact_id INTO v_contact FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
     WHERE cc.client_id = p.client_id AND cc.status = 'Active' AND ct.status = 'Active' AND 'ORDERING' = ANY(cc.roles)
     ORDER BY (cc.contact_id = v.accepted_by_contact_id) DESC, (cc.contact_id = p.quote_contact_id) DESC, ct.last_name LIMIT 1;
    IF v_contact IS NULL THEN RAISE EXCEPTION 'The client has no contact with the Ordering role: add one before the study can start'; END IF;
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    INSERT INTO stability_study (project_id, project_version_id, client_id, site_id, contact_id, product, lot, accepted_at, escalation_pct, reserve_pct)
    VALUES (p.id, v.id, p.client_id, pl.site_id, v_contact, pl.product, pl.lot, COALESCE(v.accepted_at, clock_timestamp()), pl.escalation_pct,
            COALESCE(pl.reserve_pct, (SELECT stability_reserve_pct FROM lab_site WHERE id = pl.site_id)))
    RETURNING id, study_code INTO v_study, v_code;
    INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, origin, po_number, notes, status)
    VALUES (p.client_id, pl.site_id, v_contact, 'Online', 'Stability Baseline', NULL,
            'Stability study ' || v_code || ': T0 baseline, tested when the material is placed in the chambers.', 'Submitted')
    RETURNING id INTO v_order;
    INSERT INTO sample (lab_order_id, client_sample_id, description, product, lot)
    VALUES (v_order, v_code || ' T0', COALESCE(pl.product, p.project_name) || ' (stability baseline)', pl.product, pl.lot) RETURNING id INTO v_sample;
    SELECT id INTO t0 FROM stability_timepoint WHERE project_version_id = v.id AND status = 'Active' AND interval_value = 0;
    PERFORM stability_order_tests(v_study, v_sample, t0, NULL, NULL);
    UPDATE stability_study SET t0_order_id = v_order, t0_sample_id = v_sample WHERE id = v_study;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    RETURN v_study;
END $$;
CREATE FUNCTION project_version_stability_study() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Accepted' AND OLD.status <> 'Accepted' AND (SELECT kind FROM project WHERE id = NEW.project_id) = 'Stability' THEN
        PERFORM create_stability_study(NEW.id);
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_stability_study AFTER UPDATE ON project_version FOR EACH ROW EXECUTE FUNCTION project_version_stability_study();

-- Place the material in the chambers: one row per condition {condition_id, rack_id, position, units}; T0 units.
-- Logs the T0 sample if intake has not, checks the material is enough, and schedules the pulls.
-- (the acceptance date in the lab's time zone, not the server's: Claude Code, 2026-10-14, found on PGlite in the evening)
CREATE FUNCTION place_stability_study(p_study uuid, p_date date, p_rows jsonb, p_t0_units integer) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE st stability_study; r record; x jsonb; rk stability_rack; ch stability_chamber; v_storage uuid; v_req integer; v_n integer := 0; v_i integer := 0;
        tp record; v_nom date; gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO st FROM stability_study WHERE id = p_study FOR UPDATE;
    IF st.id IS NULL THEN RAISE EXCEPTION 'Study not found'; END IF;
    PERFORM require_permission_at('stability.manage', st.site_id);
    IF st.status <> 'Awaiting material' THEN RAISE EXCEPTION 'The study is % : its material is already placed', st.status; END IF;
    IF p_date IS NULL OR p_date > site_today(st.site_id) THEN RAISE EXCEPTION 'The placement date is today or earlier'; END IF;
    IF p_date < (st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date THEN RAISE EXCEPTION 'The placement date cannot be before the quote was accepted (%)', (st.accepted_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date; END IF;
    IF COALESCE(p_t0_units, 0) <= 0 THEN RAISE EXCEPTION 'How many units go to the T0 baseline testing?'; END IF;
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    FOR r IN SELECT vc.condition_id, sc.condition_name FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
              WHERE vc.project_version_id = st.project_version_id AND vc.status = 'Active' ORDER BY vc.sort_order, sc.sort_order, sc.condition_name LOOP
        v_i := v_i + 1;
        SELECT e INTO x FROM jsonb_array_elements(COALESCE(p_rows, '[]')) e WHERE (e->>'condition_id')::uuid = r.condition_id;
        IF x IS NULL OR COALESCE((x->>'units')::integer, 0) <= 0 THEN RAISE EXCEPTION '%: how many units are placed?', r.condition_name; END IF;
        SELECT * INTO rk FROM stability_rack WHERE id = (x->>'rack_id')::uuid;
        SELECT * INTO ch FROM stability_chamber WHERE id = rk.chamber_id;
        IF rk.id IS NULL OR rk.status <> 'Active' OR ch.status <> 'Active' THEN RAISE EXCEPTION '%: choose an active rack', r.condition_name; END IF;
        IF ch.site_id <> st.site_id THEN RAISE EXCEPTION '%: the rack is in another lab', r.condition_name; END IF;
        IF ch.condition_id <> r.condition_id THEN
            RAISE EXCEPTION '%: rack % is in a chamber set to %', r.condition_name, rk.rack_code, (SELECT condition_name FROM stability_condition WHERE id = ch.condition_id);
        END IF;
        IF EXISTS (SELECT 1 FROM equipment e WHERE e.id = ch.equipment_id AND e.admin_status <> 'In Service') THEN
            RAISE EXCEPTION '%: the chamber is not in service', r.condition_name;
        END IF;
        SELECT COALESCE(sum(c.units_required), 0) INTO v_req FROM stability_cell c WHERE c.project_version_id = st.project_version_id AND c.condition_id = r.condition_id AND c.status = 'Active';
        v_req := ceil(v_req * (1 + st.reserve_pct / 100))::integer;
        INSERT INTO stability_storage (storage_code, study_id, condition_id, rack_id, position, units_received, units_required, shortfall)
        VALUES (st.study_code || '-' || v_i, st.id, r.condition_id, rk.id, NULLIF(btrim(x->>'position'), ''), (x->>'units')::integer, v_req, GREATEST(0, v_req - (x->>'units')::integer))
        RETURNING id INTO v_storage;
        FOR tp IN SELECT t.*, (SELECT sum(c.units_required) FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = r.condition_id AND c.status = 'Active') AS units
                    FROM stability_timepoint t WHERE t.project_version_id = st.project_version_id AND t.status = 'Active' AND t.interval_value > 0
                     AND EXISTS (SELECT 1 FROM stability_cell c WHERE c.timepoint_id = t.id AND c.condition_id = r.condition_id AND c.status = 'Active') LOOP
            v_nom := stability_interval_date(p_date, tp.interval_value, tp.interval_unit);
            INSERT INTO stability_pull (study_id, storage_id, condition_id, timepoint_id, nominal_date, scheduled_date, window_start, window_end, units_required)
            VALUES (st.id, v_storage, r.condition_id, tp.id, v_nom, stability_adjust_date(st.site_id, v_nom, tp.days_early, tp.days_late),
                    v_nom - tp.days_early, v_nom + tp.days_late, tp.units);
            v_n := v_n + 1;
        END LOOP;
    END LOOP;
    -- the T0 sample: received at placement; logged now unless intake already logged it
    UPDATE sample SET number_of_units = p_t0_units, received_at = COALESCE(received_at, (p_date::timestamp AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id)))
     WHERE id = st.t0_sample_id;
    IF (SELECT status FROM sample WHERE id = st.t0_sample_id) = 'Expected' THEN PERFORM log_samples(ARRAY[st.t0_sample_id]); END IF;
    UPDATE stability_study SET status = 'Active', placement_date = p_date, placed_at = clock_timestamp(), placed_by = current_app_user() WHERE id = st.id;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    PERFORM create_due_stability_pulls(st.site_id);
    RETURN v_n;
END $$;

-- On (or after) a pull's scheduled date, its lab order is made with the pull sample Expected. Run by the server
-- every hour (as the system user), when the stability pages are opened, and right after placement.
CREATE FUNCTION create_due_stability_pulls(p_site uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE pl record; v_order uuid; v_sample uuid; n integer := 0;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    FOR pl IN SELECT p.*, s.study_code, s.client_id, s.site_id, s.contact_id, s.product, s.lot, sc.condition_name, t.label, t.project_version_id
                FROM stability_pull p JOIN stability_study s ON s.id = p.study_id JOIN stability_condition sc ON sc.id = p.condition_id
                JOIN stability_timepoint t ON t.id = p.timepoint_id
               WHERE p.status = 'Scheduled' AND s.status = 'Active' AND (p_site IS NULL OR s.site_id = p_site)
                 AND p.scheduled_date <= site_today(s.site_id)
               ORDER BY p.scheduled_date, s.study_code FOR UPDATE OF p LOOP
        INSERT INTO lab_order (client_id, site_id, ordering_contact_id, submission_channel, origin, notes, status)
        VALUES (pl.client_id, pl.site_id, pl.contact_id, 'Online', 'Stability Pull',
                'Stability study ' || pl.study_code || ': ' || pl.label || ' pull at ' || pl.condition_name || ', scheduled ' || to_char(pl.scheduled_date, 'Mon DD, YYYY')
                || ' (window ' || to_char(pl.window_start, 'Mon DD') || ' to ' || to_char(pl.window_end, 'Mon DD, YYYY') || ').', 'Submitted')
        RETURNING id INTO v_order;
        INSERT INTO sample (lab_order_id, client_sample_id, description, product, lot)
        VALUES (v_order, pl.study_code || ' ' || pl.label || ' ' || pl.condition_name, COALESCE(pl.product, 'Stability material') || ' (' || pl.label || ', ' || pl.condition_name || ')', pl.product, pl.lot)
        RETURNING id INTO v_sample;
        PERFORM stability_order_tests(pl.study_id, v_sample, pl.timepoint_id, pl.condition_id, pl.id);
        UPDATE stability_pull SET status = 'Ordered', lab_order_id = v_order, sample_id = v_sample WHERE id = pl.id;
        n := n + 1;
    END LOOP;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    RETURN n;
END $$;

-- The units taken out of storage now; the pull sample is logged in. Outside the window needs a note.
CREATE FUNCTION record_stability_pull(p_pull uuid, p_at timestamptz, p_units integer, p_note text) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE pl stability_pull; st stability_study; v_left integer; v_day date; v_in boolean;
        gs text := COALESCE(current_setting('lims.group_sync', true), ''); si text := COALESCE(current_setting('lims.stability_internal', true), '');
BEGIN
    SELECT * INTO pl FROM stability_pull WHERE id = p_pull FOR UPDATE;
    IF pl.id IS NULL THEN RAISE EXCEPTION 'Pull not found'; END IF;
    SELECT * INTO st FROM stability_study WHERE id = pl.study_id;
    PERFORM require_permission_at('stability.manage', st.site_id);
    IF pl.status = 'Scheduled' THEN RAISE EXCEPTION 'This pull is not due until % (its order is made on that day)', pl.scheduled_date; END IF;
    IF pl.status <> 'Ordered' THEN RAISE EXCEPTION 'This pull is already %', lower(pl.status); END IF;
    IF COALESCE(p_units, 0) <= 0 THEN RAISE EXCEPTION 'How many units were taken out?'; END IF;
    p_at := COALESCE(p_at, clock_timestamp());
    IF p_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'The pull cannot be recorded in the future'; END IF;
    SELECT s.units_received - COALESCE((SELECT sum(units_pulled) FROM stability_pull x WHERE x.storage_id = s.id AND x.status = 'Pulled'), 0)
      INTO v_left FROM stability_storage s WHERE s.id = pl.storage_id;
    IF p_units > v_left THEN RAISE EXCEPTION 'Only % units of this condition are left in storage', v_left; END IF;
    v_day := (p_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id))::date;
    v_in := v_day BETWEEN pl.window_start AND pl.window_end;
    IF NOT v_in AND COALESCE(btrim(p_note), '') = '' THEN
        RAISE EXCEPTION 'The pull is outside its window (% to %): say why in the note', pl.window_start, pl.window_end;
    END IF;
    PERFORM set_config('lims.group_sync', '1', true); PERFORM set_config('lims.stability_internal', '1', true);
    UPDATE stability_pull SET status = 'Pulled', pulled_at = p_at, pulled_by = current_app_user(), units_pulled = p_units, within_window = v_in,
           pull_note = NULLIF(btrim(p_note), '') WHERE id = pl.id;
    UPDATE sample SET number_of_units = p_units, received_at = p_at WHERE id = pl.sample_id;
    IF (SELECT status FROM sample WHERE id = pl.sample_id) = 'Expected' THEN PERFORM log_samples(ARRAY[pl.sample_id]); END IF;
    UPDATE stability_storage SET status = 'Used up' WHERE id = pl.storage_id AND p_units = v_left;
    IF NOT EXISTS (SELECT 1 FROM stability_pull WHERE study_id = st.id AND status IN ('Scheduled','Ordered')) THEN
        UPDATE stability_study SET status = 'Completed' WHERE id = st.id;
    END IF;
    PERFORM set_config('lims.group_sync', gs, true); PERFORM set_config('lims.stability_internal', si, true);
    RETURN v_left - p_units;
END $$;

-------------------------------------------------------------------------------
-- 7. VIEWS
-------------------------------------------------------------------------------
CREATE VIEW stability_storage_view AS
SELECT s.*, sc.condition_name, rk.rack_code, ch.id AS chamber_id, e.equipment_code, e.equipment_name, e.id AS equipment_id,
       s.units_received - COALESCE((SELECT sum(units_pulled) FROM stability_pull x WHERE x.storage_id = s.id AND x.status = 'Pulled'), 0) AS units_left,
       COALESCE((SELECT sum(units_required) FROM stability_pull x WHERE x.storage_id = s.id AND x.status IN ('Scheduled','Ordered')), 0) AS units_still_needed
  FROM stability_storage s JOIN stability_condition sc ON sc.id = s.condition_id JOIN stability_rack rk ON rk.id = s.rack_id
  JOIN stability_chamber ch ON ch.id = rk.chamber_id JOIN equipment e ON e.id = ch.equipment_id;

CREATE VIEW stability_pull_view AS
SELECT p.*, s.study_code, s.site_id, s.client_id, COALESCE(cl.display_name, cl.legal_name) AS client_name, s.product,
       sc.condition_name, t.label AS timepoint_label, t.interval_value, t.interval_unit, st.storage_code, st.position, rk.rack_code, e.equipment_code, e.equipment_name, e.id AS equipment_id,
       o.order_code, sa.sample_code, sa.client_sample_id, u.full_name AS pulled_by_name,
       (p.status IN ('Scheduled','Ordered') AND p.window_end < site_today(s.site_id)) AS overdue
  FROM stability_pull p JOIN stability_study s ON s.id = p.study_id JOIN client cl ON cl.id = s.client_id
  JOIN stability_condition sc ON sc.id = p.condition_id JOIN stability_timepoint t ON t.id = p.timepoint_id
  JOIN stability_storage st ON st.id = p.storage_id JOIN stability_rack rk ON rk.id = st.rack_id JOIN stability_chamber ch ON ch.id = rk.chamber_id
  JOIN equipment e ON e.id = ch.equipment_id
  LEFT JOIN lab_order o ON o.id = p.lab_order_id LEFT JOIN sample sa ON sa.id = p.sample_id LEFT JOIN app_user u ON u.id = p.pulled_by;

CREATE VIEW stability_study_view AS
SELECT s.*, p.project_code, pv.version_no, COALESCE(cl.display_name, cl.legal_name) AS client_name, ls.site_code,
       NULLIF(btrim(COALESCE(ct.first_name, '') || ' ' || COALESCE(ct.last_name, '')), '') AS contact_name,
       o.order_code AS t0_order_code, sa.sample_code AS t0_sample_code, sa.status::text AS t0_sample_status, u.full_name AS placed_by_name,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id)::int AS pulls_total,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id AND x.status = 'Pulled')::int AS pulls_done,
       (SELECT min(x.scheduled_date) FROM stability_pull x WHERE x.study_id = s.id AND x.status IN ('Scheduled','Ordered')) AS next_pull,
       (SELECT count(*) FROM stability_pull x WHERE x.study_id = s.id AND x.status = 'Ordered')::int AS pulls_to_take,
       (SELECT COALESCE(sum(x.shortfall), 0) FROM stability_storage x WHERE x.study_id = s.id)::int AS shortfall,
       (SELECT string_agg(sc.condition_name, ', ' ORDER BY vc.sort_order, sc.sort_order) FROM stability_version_condition vc JOIN stability_condition sc ON sc.id = vc.condition_id
         WHERE vc.project_version_id = s.project_version_id AND vc.status = 'Active') AS conditions
  FROM stability_study s JOIN project p ON p.id = s.project_id JOIN project_version pv ON pv.id = s.project_version_id
  JOIN client cl ON cl.id = s.client_id JOIN lab_site ls ON ls.id = s.site_id JOIN contact ct ON ct.id = s.contact_id
  LEFT JOIN lab_order o ON o.id = s.t0_order_id LEFT JOIN sample sa ON sa.id = s.t0_sample_id LEFT JOIN app_user u ON u.id = s.placed_by;

-------------------------------------------------------------------------------
-- 8. THE PRESET CONDITIONS (ICH Q1A(R2) storage conditions; every lab)
-------------------------------------------------------------------------------
INSERT INTO stability_condition (site_id, condition_name, condition_type, temperature_c, temperature_tol, humidity_pct, humidity_tol, description, sort_order) VALUES
 (NULL, '25 °C / 60% RH', 'Long term', 25, 2, 60, 5, 'ICH long term (climatic zones I and II)', 10),
 (NULL, '30 °C / 65% RH', 'Intermediate', 30, 2, 65, 5, 'ICH intermediate', 20),
 (NULL, '30 °C / 75% RH', 'Long term', 30, 2, 75, 5, 'ICH long term (climatic zone IVb)', 30),
 (NULL, '40 °C / 75% RH', 'Accelerated', 40, 2, 75, 5, 'ICH accelerated', 40),
 (NULL, '5 °C', 'Refrigerated', 5, 3, NULL, NULL, 'Refrigerated, 5 ± 3 °C', 50),
 (NULL, '-20 °C', 'Frozen', -20, 5, NULL, NULL, 'Frozen, -20 ± 5 °C', 60);

-------------------------------------------------------------------------------
-- 9. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_032;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_proj uuid;
BEGIN
    IF p_table IN ('stability_condition','stability_chamber','stability_rack') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'stability_condition' THEN 'Stability condition ' || COALESCE(r->>'condition_name', '')
                                                       WHEN 'stability_chamber' THEN 'Stability chamber ' || COALESCE((SELECT equipment_code FROM equipment WHERE id = (r->>'equipment_id')::uuid), '')
                                                       ELSE 'Rack ' || COALESCE(r->>'rack_code', '') END, 'href', '#/stability/setup');
    ELSIF p_table IN ('stability_study','stability_storage','stability_pull') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'stability_study' THEN 'Stability study ' || COALESCE(r->>'study_code', '')
                                                       WHEN 'stability_storage' THEN 'Stored material ' || COALESCE(r->>'storage_code', '')
                                                       ELSE 'Stability pull ' || COALESCE((SELECT study_code FROM stability_study WHERE id = (r->>'study_id')::uuid), '') END,
                                  'href', '#/stability/studies/' || COALESCE(CASE p_table WHEN 'stability_study' THEN r->>'id' ELSE r->>'study_id' END, ''));
    ELSIF p_table IN ('stability_plan','stability_version_condition','stability_timepoint','stability_cell') THEN
        SELECT project_id INTO v_proj FROM project_version WHERE id = (r->>'project_version_id')::uuid;
        RETURN jsonb_build_object('label', 'Stability quote ' || COALESCE((SELECT project_code FROM project WHERE id = v_proj), ''), 'href', '#/stability/quotes/' || COALESCE(v_proj::text, ''));
    ELSIF p_table = 'project' AND r->>'kind' = 'Stability' THEN
        RETURN jsonb_build_object('label', 'Stability quote ' || COALESCE(r->>'project_code', ''), 'href', '#/stability/quotes/' || p_id);
    END IF;
    RETURN audit_record_ref_032(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
