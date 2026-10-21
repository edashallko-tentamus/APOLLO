-- LIMS3 schema, migration 012: WORKFLOW DESIGNER, part 1 (WD-1): test definitions
-- Vault: "Decision - Workflow Designer Slice Scope and Rules" (Alex Kiddle, 2026-10-13), "Decision - Workflow Step Types
-- Cascade Under One Definition Object", "Decision - Method Is Separate From Test and Test Procedure",
-- "Decision - Requested Test Pins Test Version".
--  - A test belongs to a lab (tests made before this slice stay shared) and to a department. It can be duplicated as a
--    template, or copied to another lab, which gets its own draft to approve.
--  - A test version holds the method (SOP), rounding (default 3 significant figures, round half up), below-LOQ
--    reporting, the analytes (result type, reporting unit, LOQ, LOD, per-analyte rounding), and the workflow: steps of
--    11 types with their settings, connected by dependencies (a graph: parallel branches allowed, no loops).
--  - Steps are done by a department: the step's own, else the test's. A group can be marked as a department group in
--    Admin > Groups; its members are that department's people.
--  - Formulas use {step.field} tokens from steps that come before them (or a Hold Point's sibling result); the database
--    checks and evaluates them (the calculation engine later slices and the logbooks build on).
--  - A version becomes Effective only by approval: signed, by someone with methods.approve who did not work on it,
--    and only when the database finds no problems. The previous Effective version is superseded.
--  - Specifications per quoted test and per requested test (Lab, Client or Client portal). None = unspecified: the
--    client gets results as they are.

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);

-------------------------------------------------------------------------------
-- 1. PERMISSIONS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('methods.design',  'Methods', 'Workflow Designer', 'Create and change draft tests, methods (SOPs) and workflows; duplicate tests and copy them to another lab', false, 80),
 ('methods.approve', 'Methods', 'Test approval',     'Approve a test version so it becomes effective (never a version you worked on)', false, 81);

CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES
 ('QA',             '{methods.design,methods.approve}'),
 ('Lab Supervisor', '{methods.design,methods.approve}'),
 ('Analyst',        '{methods.design}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

CREATE FUNCTION methods_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.methods_internal', true), '') = '1' OR in_group_sync()
$$;
CREATE FUNCTION set_methods_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.methods_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;
-- a lab's records need the permission at that lab; shared (older) tests need it in the lab being worked in
CREATE FUNCTION require_methods_permission(p_code text, p_site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_site IS NOT NULL THEN PERFORM require_permission_at(p_code, p_site);
    ELSIF NOT has_permission(p_code) THEN
        RAISE EXCEPTION 'You do not have permission to do this: % (%). Ask your lab administrator to add you to a group that has it.',
            (SELECT lower(description) FROM permission WHERE code = p_code), p_code;
    END IF;
END $$;

-------------------------------------------------------------------------------
-- 2. DEPARTMENT GROUPS (Admin > Groups: a group can stand for one of the lab's departments)
-------------------------------------------------------------------------------
ALTER TABLE lab_group ADD COLUMN department_id uuid REFERENCES department(id);
CREATE OR REPLACE FUNCTION lab_group_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.group_name := btrim(NEW.group_name);
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A group cannot move to another lab'; END IF;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department d WHERE d.id = NEW.department_id AND d.site_id IS NOT DISTINCT FROM NEW.site_id) THEN
        RAISE EXCEPTION 'A department group must name one of its own lab''s departments';
    END IF;
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NULL AND NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator can change an all-labs group'; END IF;
    IF NEW.site_id IS NOT NULL THEN PERFORM require_permission_at('admin.groups', NEW.site_id); END IF;
    PERFORM assert_signed(CASE TG_OP WHEN 'INSERT' THEN 'create a group' ELSE 'change a group' END);
    RETURN NEW;
END $$;

-- People in a department: active members of an active group that stands for it (system administrators are not
-- members by default: doing the work is about training, not rights)
CREATE FUNCTION user_in_department(p_user uuid, p_department uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND u.is_active AND g.department_id = p_department)
$$;
CREATE FUNCTION department_has_people(p_department uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id JOIN app_user u ON u.id = m.user_id
                    WHERE m.status = 'Active' AND g.status = 'Active' AND u.is_active AND g.department_id = p_department)
$$;

-------------------------------------------------------------------------------
-- 3. METHODS (the lab's method name and SOP code; one method can back several tests)
-------------------------------------------------------------------------------
CREATE SEQUENCE method_code_seq;
CREATE TABLE method (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    method_code      text NOT NULL UNIQUE DEFAULT 'MTH-' || lpad(nextval('method_code_seq')::text, 5, '0'),
    site_id          uuid NOT NULL REFERENCES lab_site(id),
    method_name      text NOT NULL CHECK (btrim(method_name) <> ''),
    sop_code         text,
    sop_link         text,
    sop_document_id  uuid REFERENCES document_file(id),
    description      text,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX method_name_uq ON method (site_id, lower(method_name));
CALL make_gxp('method');
CREATE FUNCTION method_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A method cannot move to another lab (copy the test instead)'; END IF;
    NEW.method_name := btrim(NEW.method_name); NEW.sop_code := NULLIF(btrim(NEW.sop_code), ''); NEW.sop_link := NULLIF(btrim(NEW.sop_link), '');
    IF in_group_sync() THEN RETURN NEW; END IF;
    PERFORM require_permission_at('methods.design', NEW.site_id);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON method FOR EACH ROW EXECUTE FUNCTION method_rules();

-------------------------------------------------------------------------------
-- 4. TESTS: LAB, DEPARTMENT; TEST VERSIONS: METHOD, PROCEDURE, ROUNDING, BELOW-LOQ REPORTING, APPROVAL
-------------------------------------------------------------------------------
ALTER TABLE test ADD COLUMN site_id uuid REFERENCES lab_site(id),          -- empty = shared (tests made before the designer)
                 ADD COLUMN department_id uuid REFERENCES department(id),
                 ADD COLUMN copied_from_test_id uuid REFERENCES test(id);
DROP INDEX test_name_uq;
CREATE UNIQUE INDEX test_name_uq ON test (COALESCE(site_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(test_name));

DROP TRIGGER a01_permission ON test;
CREATE FUNCTION test_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.test_name := btrim(NEW.test_name);
    IF TG_OP = 'UPDATE' AND NEW.site_id IS DISTINCT FROM OLD.site_id THEN RAISE EXCEPTION 'A test cannot move to another lab; copy it to that lab instead'; END IF;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department d WHERE d.id = NEW.department_id AND d.site_id = NEW.site_id) THEN
        RAISE EXCEPTION 'The department must be one of the test''s own lab''s departments';
    END IF;
    IF methods_internal() THEN RETURN NEW; END IF;
    IF NEW.site_id IS NOT NULL THEN
        IF NOT (has_permission_at('methods.design', NEW.site_id) OR has_permission_at('catalog.edit', NEW.site_id)) THEN
            PERFORM require_permission_at('methods.design', NEW.site_id);
        END IF;
    ELSIF NOT (has_permission('methods.design') OR has_permission('catalog.edit')) THEN
        RAISE EXCEPTION 'You do not have permission to change tests (methods.design or catalog.edit). Ask your lab administrator.';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test FOR EACH ROW EXECUTE FUNCTION test_rules();

-- Catalogue terms: catalog.edit, except the entry a new or copied test gets from the designer
CREATE FUNCTION catalog_permission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF methods_internal() THEN RETURN NEW; END IF;
    IF NOT has_permission('catalog.edit') THEN
        RAISE EXCEPTION 'You do not have permission to change %: % (catalog.edit). Ask your lab administrator.', replace(TG_TABLE_NAME, '_', ' '),
            (SELECT lower(description) FROM permission WHERE code = 'catalog.edit');
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER a01_permission ON test_catalog_entry;
DROP TRIGGER a01_permission ON test_analyte_price;
DROP TRIGGER a01_permission ON test_rush_approval;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_catalog_entry FOR EACH ROW EXECUTE FUNCTION catalog_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_analyte_price FOR EACH ROW EXECUTE FUNCTION catalog_permission();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_rush_approval FOR EACH ROW EXECUTE FUNCTION catalog_permission();

CREATE TYPE rounding_mode AS ENUM ('Significant figures','Decimal places');
ALTER TABLE test_version
    ADD COLUMN method_id              uuid REFERENCES method(id),
    ADD COLUMN procedure_text         text,
    ADD COLUMN change_summary         text,
    ADD COLUMN rounding_mode          rounding_mode NOT NULL DEFAULT 'Significant figures',
    ADD COLUMN rounding_digits        integer NOT NULL DEFAULT 3 CHECK (rounding_digits BETWEEN 0 AND 10),
    ADD COLUMN nd_below_lod           boolean NOT NULL DEFAULT false,      -- report "ND" below the LOD (otherwise "< LOQ")
    ADD COLUMN approved_by            uuid REFERENCES app_user(id),
    ADD COLUMN approved_at            timestamptz,
    ADD COLUMN approval_signature_id  uuid REFERENCES signature_event(id),
    ADD COLUMN copied_from_version_id uuid REFERENCES test_version(id),
    ADD CONSTRAINT test_version_sig_figs CHECK (rounding_mode = 'Decimal places' OR rounding_digits >= 1);

DROP TRIGGER a01_permission ON test_version;
CREATE FUNCTION test_version_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t test;
BEGIN
    SELECT * INTO t FROM test WHERE id = NEW.test_id;
    IF NEW.method_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM method m WHERE m.id = NEW.method_id AND m.site_id IS NOT DISTINCT FROM t.site_id) THEN
        RAISE EXCEPTION 'The method must belong to the test''s own lab';
    END IF;
    IF methods_internal() THEN RETURN NEW; END IF;
    IF NOT (has_permission_at('methods.design', t.site_id) OR has_permission_at('catalog.edit', t.site_id)) THEN
        PERFORM require_methods_permission('methods.design', t.site_id);
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'Draft' THEN RAISE EXCEPTION 'A new test version starts as a Draft; it becomes Effective only when it is approved'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.test_id <> OLD.test_id OR NEW.version_no <> OLD.version_no THEN RAISE EXCEPTION 'A version cannot move to another test or be renumbered'; END IF;
    IF OLD.status <> 'Draft' THEN
        RAISE EXCEPTION 'Version % is % and cannot be changed. Start a new version to make changes.', OLD.version_no, OLD.status;
    END IF;
    IF NEW.status <> OLD.status OR NEW.approved_by IS DISTINCT FROM OLD.approved_by OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
        RAISE EXCEPTION 'A version becomes Effective only when it is approved (signed, by someone who did not work on it)';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON test_version FOR EACH ROW EXECUTE FUNCTION test_version_rules();

-- The parts of a version (analytes, steps, their equipment and dependencies) change only while it is a Draft
CREATE FUNCTION assert_version_editable(p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v test_version; t test;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Test version not found'; END IF;
    IF methods_internal() THEN RETURN; END IF;
    IF v.status <> 'Draft' THEN
        RAISE EXCEPTION 'Version % is % and cannot be changed. Start a new version to make changes.', v.version_no, v.status;
    END IF;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    PERFORM require_methods_permission('methods.design', t.site_id);
END $$;

-------------------------------------------------------------------------------
-- 5. ANALYTES OF A TEST VERSION
-------------------------------------------------------------------------------
CREATE TYPE result_type AS ENUM ('Numeric','Qualitative','Count','Text');
CREATE TABLE test_version_analyte (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id  uuid NOT NULL REFERENCES test_version(id),
    analyte_id       uuid NOT NULL REFERENCES analyte(id),
    sort_order       integer NOT NULL DEFAULT 0,
    result_type      result_type NOT NULL DEFAULT 'Numeric',
    reporting_unit   text,
    loq              numeric CHECK (loq >= 0),
    lod              numeric CHECK (lod >= 0),
    rounding_mode    rounding_mode,                 -- empty = the version's rounding
    rounding_digits  integer CHECK (rounding_digits BETWEEN 0 AND 10),
    hide_on_report   boolean NOT NULL DEFAULT false,
    default_spec_min numeric,                       -- the lab's usual limit: offered when setting a specification, never applied by itself
    default_spec_max numeric,
    default_spec_text text,
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT tva_lod_le_loq CHECK (lod IS NULL OR loq IS NULL OR lod <= loq),
    CONSTRAINT tva_rounding_pair CHECK ((rounding_mode IS NULL) = (rounding_digits IS NULL)),
    CONSTRAINT tva_sig_figs CHECK (rounding_mode IS DISTINCT FROM 'Significant figures' OR rounding_digits >= 1),
    CONSTRAINT tva_spec_order CHECK (default_spec_min IS NULL OR default_spec_max IS NULL OR default_spec_min <= default_spec_max)
);
CREATE UNIQUE INDEX tva_uq ON test_version_analyte (test_version_id, analyte_id) WHERE status = 'Active';
CALL make_gxp('test_version_analyte', false);
CREATE FUNCTION tva_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.test_version_id <> OLD.test_version_id OR NEW.analyte_id <> OLD.analyte_id) THEN
        RAISE EXCEPTION 'Remove the analyte (Inactive) and add the other one instead';
    END IF;
    PERFORM assert_version_editable(NEW.test_version_id);
    IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM analyte WHERE id = NEW.analyte_id AND status = 'Active') THEN
        RAISE EXCEPTION 'That analyte is retired; pick an active one';
    END IF;
    NEW.reporting_unit := canonical_unit(NEW.reporting_unit, enum_range(NULL::unit_dimension), 'Reporting unit');
    IF NEW.result_type IN ('Qualitative','Text') THEN NEW.loq := NULL; NEW.lod := NULL; NEW.rounding_mode := NULL; NEW.rounding_digits := NULL; END IF;
    NEW.default_spec_text := NULLIF(btrim(NEW.default_spec_text), '');
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON test_version_analyte FOR EACH ROW EXECUTE FUNCTION tva_rules();

-------------------------------------------------------------------------------
-- 6. WORKFLOW STEPS, THEIR EQUIPMENT AND DEPENDENCIES
-------------------------------------------------------------------------------
CREATE TYPE step_type AS ENUM ('Batching','Weighing','Preparation','Plating/Inoculation','Incubation','Dilution',
                               'Split off Test','Hold Point','Calculation','Data Entry','QC Review');
CREATE TABLE workflow_step (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_version_id  uuid NOT NULL REFERENCES test_version(id),
    step_key         text NOT NULL CHECK (step_key ~ '^[a-z][a-z0-9_]{0,29}$'),   -- used in formulas: {weigh.weight}
    step_name        text NOT NULL CHECK (btrim(step_name) <> ''),
    step_type        step_type NOT NULL,
    sort_order       integer NOT NULL DEFAULT 0,
    department_id    uuid REFERENCES department(id),   -- who does it; empty = the test's department
    instructions     text,
    config           jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
    status           record_status NOT NULL DEFAULT 'Active',
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX workflow_step_key_uq ON workflow_step (test_version_id, step_key) WHERE status = 'Active';
CREATE INDEX workflow_step_version_idx ON workflow_step (test_version_id);
CALL make_gxp('workflow_step', false);

CREATE TABLE workflow_step_equipment (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id            uuid NOT NULL REFERENCES workflow_step(id),
    equipment_type_id  uuid NOT NULL REFERENCES equipment_type(id),
    is_main            boolean NOT NULL DEFAULT false,     -- the main instrument; the others are alternatives
    status             record_status NOT NULL DEFAULT 'Active',
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX workflow_step_equipment_uq ON workflow_step_equipment (step_id, equipment_type_id) WHERE status = 'Active';
CALL make_gxp('workflow_step_equipment', false);

CREATE TYPE dependency_type AS ENUM ('Sequential','Parallel');
CREATE TABLE workflow_step_dependency (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id             uuid NOT NULL REFERENCES workflow_step(id),
    depends_on_step_id  uuid NOT NULL REFERENCES workflow_step(id),
    dependency_type     dependency_type NOT NULL DEFAULT 'Sequential',   -- Parallel: a branch (e.g. a timepoint's QC Review) that never holds up the rest
    status              record_status NOT NULL DEFAULT 'Active',
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT step_not_own_dependency CHECK (step_id <> depends_on_step_id)
);
CREATE UNIQUE INDEX workflow_step_dependency_uq ON workflow_step_dependency (step_id, depends_on_step_id) WHERE status = 'Active';
CALL make_gxp('workflow_step_dependency', false);

CREATE FUNCTION workflow_step_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE t test;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.test_version_id <> OLD.test_version_id THEN RAISE EXCEPTION 'A step cannot move to another version'; END IF;
    PERFORM assert_version_editable(NEW.test_version_id);
    NEW.step_name := btrim(NEW.step_name);
    SELECT t2.* INTO t FROM test t2 JOIN test_version v ON v.test_id = t2.id WHERE v.id = NEW.test_version_id;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM department d WHERE d.id = NEW.department_id AND d.site_id IS NOT DISTINCT FROM t.site_id) THEN
        RAISE EXCEPTION 'The step''s department must be one of the test''s own lab''s departments';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON workflow_step FOR EACH ROW EXECUTE FUNCTION workflow_step_rules();
-- removing a step removes its equipment and dependencies too
CREATE FUNCTION workflow_step_cascade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE workflow_step_dependency SET status = 'Inactive' WHERE status = 'Active' AND (step_id = NEW.id OR depends_on_step_id = NEW.id);
    UPDATE workflow_step_equipment SET status = 'Inactive' WHERE status = 'Active' AND step_id = NEW.id;
    RETURN NULL;
END $$;
CREATE TRIGGER z_cascade AFTER UPDATE OF status ON workflow_step FOR EACH ROW WHEN (NEW.status = 'Inactive' AND OLD.status = 'Active')
    EXECUTE FUNCTION workflow_step_cascade();

CREATE FUNCTION workflow_step_equipment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s workflow_step; v_site uuid;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.step_id <> OLD.step_id OR NEW.equipment_type_id <> OLD.equipment_type_id) THEN
        RAISE EXCEPTION 'Remove the equipment type (Inactive) and add the other one instead';
    END IF;
    SELECT * INTO s FROM workflow_step WHERE id = NEW.step_id;
    PERFORM assert_version_editable(s.test_version_id);
    SELECT t.site_id INTO v_site FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = s.test_version_id;
    IF NOT EXISTS (SELECT 1 FROM equipment_type e WHERE e.id = NEW.equipment_type_id AND e.site_id IS NOT DISTINCT FROM v_site) THEN
        RAISE EXCEPTION 'The equipment type must be one of the test''s own lab''s equipment types';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON workflow_step_equipment FOR EACH ROW EXECUTE FUNCTION workflow_step_equipment_rules();

CREATE FUNCTION workflow_step_dependency_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a workflow_step; b workflow_step;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.step_id <> OLD.step_id OR NEW.depends_on_step_id <> OLD.depends_on_step_id) THEN
        RAISE EXCEPTION 'Remove the dependency (Inactive) and add the other one instead';
    END IF;
    SELECT * INTO a FROM workflow_step WHERE id = NEW.step_id;
    SELECT * INTO b FROM workflow_step WHERE id = NEW.depends_on_step_id;
    IF a.test_version_id <> b.test_version_id THEN RAISE EXCEPTION 'A step can only depend on a step of the same test version'; END IF;
    PERFORM assert_version_editable(a.test_version_id);
    IF NEW.status = 'Active' AND (a.status <> 'Active' OR b.status <> 'Active') THEN RAISE EXCEPTION 'Both steps must be active'; END IF;
    -- no loops: the step it depends on must not (directly or indirectly) depend on this step
    IF NEW.status = 'Active' AND EXISTS (
        WITH RECURSIVE up(id) AS (
            SELECT d.depends_on_step_id FROM workflow_step_dependency d WHERE d.step_id = NEW.depends_on_step_id AND d.status = 'Active' AND d.id <> NEW.id
            UNION SELECT d.depends_on_step_id FROM workflow_step_dependency d JOIN up ON d.step_id = up.id WHERE d.status = 'Active' AND d.id <> NEW.id)
        SELECT 1 FROM up WHERE id = NEW.step_id) THEN
        RAISE EXCEPTION 'That would make a loop: "%" already comes after "%"', b.step_name, a.step_name;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON workflow_step_dependency FOR EACH ROW EXECUTE FUNCTION workflow_step_dependency_rules();

-- Steps that come before a step (all its ancestors through active dependencies)
CREATE FUNCTION step_ancestors(p_step uuid) RETURNS TABLE (step_id uuid) LANGUAGE sql STABLE AS $$
    WITH RECURSIVE up(id) AS (
        SELECT d.depends_on_step_id FROM workflow_step_dependency d WHERE d.step_id = p_step AND d.status = 'Active'
        UNION SELECT d.depends_on_step_id FROM workflow_step_dependency d JOIN up ON d.step_id = up.id WHERE d.status = 'Active')
    SELECT id FROM up
$$;

-- Who may do a step: people in the step's department (else the test's department)
CREATE FUNCTION step_department(p_step uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT COALESCE(s.department_id, t.department_id) FROM workflow_step s JOIN test_version v ON v.id = s.test_version_id JOIN test t ON t.id = v.test_id
     WHERE s.id = p_step
$$;
CREATE FUNCTION can_perform_step(p_user uuid, p_step uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN step_department(p_step) IS NULL THEN false ELSE user_in_department(p_user, step_department(p_step)) END
$$;

-------------------------------------------------------------------------------
-- 7. FORMULAS, ROUNDING AND REPORTED VALUES (the calculation engine)
-------------------------------------------------------------------------------
-- A formula: numbers, {step.field} tokens, + - * / ^ ( ) and the functions log10 ln exp sqrt abs min max power.
CREATE FUNCTION formula_lex(p_formula text) RETURNS TABLE (n integer, tok text) LANGUAGE sql IMMUTABLE AS $$
    SELECT row_number() OVER ()::integer, m[1]
      FROM regexp_matches(COALESCE(p_formula, ''),
           '(\{[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\}|[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|[^\s])', 'g') AS m
$$;
CREATE FUNCTION formula_tokens(p_formula text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
    SELECT COALESCE(array_agg(DISTINCT substr(tok, 2, length(tok) - 2)), '{}') FROM formula_lex(p_formula) WHERE tok LIKE '{%'
$$;
-- NULL when the formula is well formed, else what is wrong with it
CREATE FUNCTION formula_check(p_formula text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r record; expect_operand boolean := true; stack text[] := '{}'; prev text := '';
        funcs text[] := '{log10,ln,exp,sqrt,abs,min,max,power}';
BEGIN
    IF p_formula IS NULL OR btrim(p_formula) = '' THEN RETURN 'The formula is empty'; END IF;
    FOR r IN SELECT * FROM formula_lex(p_formula) ORDER BY n LOOP
        IF expect_operand THEN
            IF r.tok ~ '^[0-9.]' OR r.tok LIKE '{%' THEN expect_operand := false;
            ELSIF r.tok = '(' THEN stack := stack || CASE WHEN prev = '__func' THEN 'f' ELSE 'p' END;
            ELSIF r.tok = '-' OR r.tok = '+' THEN NULL;   -- sign
            ELSIF r.tok ~ '^[A-Za-z_]' THEN
                IF NOT lower(r.tok) = ANY(funcs) THEN RETURN format('"%s" is not a step token or a known function (use {step.field}, or %s)', r.tok, array_to_string(funcs, ', ')); END IF;
                prev := '__func'; CONTINUE;
            ELSE RETURN format('"%s" is out of place', r.tok);
            END IF;
            IF prev = '__func' AND r.tok <> '(' THEN RETURN 'A function name must be followed by ('; END IF;
        ELSE
            IF r.tok IN ('+','-','*','/','^') THEN expect_operand := true;
            ELSIF r.tok = ')' THEN
                IF cardinality(stack) = 0 THEN RETURN 'There is a ) without its ('; END IF;
                stack := stack[1:cardinality(stack) - 1];
            ELSIF r.tok = ',' THEN
                IF cardinality(stack) = 0 OR stack[cardinality(stack)] <> 'f' THEN RETURN 'A comma can only separate a function''s values'; END IF;
                expect_operand := true;
            ELSE RETURN format('"%s" is out of place (an operator is missing before it)', r.tok);
            END IF;
        END IF;
        prev := r.tok;
    END LOOP;
    IF expect_operand THEN RETURN 'The formula ends with an operator or is missing a value'; END IF;
    IF cardinality(stack) > 0 THEN RETURN 'A ( is not closed'; END IF;
    RETURN NULL;
END $$;
-- Evaluate a checked formula with the given token values ({"weigh.weight": 0.5012, ...})
CREATE FUNCTION formula_eval(p_formula text, p_values jsonb) RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE r record; sql text := ''; v text; prob text := formula_check(p_formula); out numeric;
BEGIN
    IF prob IS NOT NULL THEN RAISE EXCEPTION 'The formula cannot be used: %', prob; END IF;
    FOR r IN SELECT * FROM formula_lex(p_formula) ORDER BY n LOOP
        IF r.tok LIKE '{%' THEN
            v := p_values ->> substr(r.tok, 2, length(r.tok) - 2);
            IF v IS NULL OR v !~ '^\s*-?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*$' THEN RAISE EXCEPTION 'No numeric value for %', r.tok; END IF;
            sql := sql || '(' || v || '::numeric)';
        ELSIF r.tok ~ '^[0-9.]' THEN sql := sql || r.tok || '::numeric';
        ELSIF r.tok ~ '^[A-Za-z_]' THEN
            sql := sql || CASE lower(r.tok) WHEN 'log10' THEN 'log' WHEN 'min' THEN 'least' WHEN 'max' THEN 'greatest' ELSE lower(r.tok) END;
        ELSE sql := sql || ' ' || r.tok || ' ';
        END IF;
    END LOOP;
    BEGIN
        EXECUTE 'SELECT (' || sql || ')::numeric' INTO out;
    EXCEPTION WHEN division_by_zero THEN RAISE EXCEPTION 'The formula divides by zero with these values';
              WHEN invalid_argument_for_logarithm OR invalid_argument_for_power_function THEN RAISE EXCEPTION 'The formula takes the log or root of a value that is zero or negative';
    END;
    RETURN out;
END $$;

-- Round half up (away from zero), to significant figures or decimal places; the numeric keeps its trailing zeros
CREATE FUNCTION round_result(p_value numeric, p_mode rounding_mode, p_digits integer) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p_value IS NULL THEN NULL
                WHEN p_mode = 'Decimal places' THEN round(p_value, p_digits)
                WHEN p_value = 0 THEN round(0::numeric, greatest(p_digits - 1, 0))
                ELSE round(p_value, p_digits - 1 - floor(log(abs(p_value)))::integer) END
$$;
-- The value as reported for an analyte of a test version: rounded, "< LOQ" below the LOQ, "ND" below the LOD if chosen
CREATE FUNCTION report_value(p_value numeric, p_tva uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_value IS NULL THEN NULL
                WHEN v.nd_below_lod AND a.lod IS NOT NULL AND p_value < a.lod THEN 'ND'
                WHEN a.loq IS NOT NULL AND p_value < a.loq THEN '< ' || a.loq::text
                ELSE round_result(p_value, COALESCE(a.rounding_mode, v.rounding_mode), COALESCE(a.rounding_digits, v.rounding_digits))::text END
      FROM test_version_analyte a JOIN test_version v ON v.id = a.test_version_id WHERE a.id = p_tva
$$;

-- A Preparation field's label as a formula key: "Digest final volume (mL)" -> digest_final_volume_ml
CREATE FUNCTION field_key(p_label text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT trim(both '_' FROM regexp_replace(lower(COALESCE(p_label, '')), '[^a-z0-9]+', '_', 'g'))
$$;
-- What each step type offers to formulas ({step.field}); Preparation steps offer their own fields
CREATE FUNCTION step_token_fields(p_step uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
    SELECT CASE s.step_type
        WHEN 'Weighing' THEN '{weight}'::text[]
        WHEN 'Dilution' THEN '{factor,final_volume}'::text[]
        WHEN 'Incubation' THEN '{duration}'::text[]
        WHEN 'Data Entry' THEN '{reading}'::text[]
        WHEN 'Calculation' THEN '{result}'::text[]
        WHEN 'Hold Point' THEN '{result}'::text[]
        WHEN 'Preparation' THEN COALESCE((SELECT array_agg(field_key(f->>'label')) FROM jsonb_array_elements(COALESCE(s.config->'fields', '[]')) f
                                           WHERE (f->>'type') = 'Number' AND COALESCE(f->>'label', '') <> ''), '{}')
        ELSE '{}'::text[] END
      FROM workflow_step s WHERE s.id = p_step
$$;

-------------------------------------------------------------------------------
-- 8. VALIDATION: what stops a version from being approved (Error) and what to look at (Warning)
-------------------------------------------------------------------------------
CREATE FUNCTION jnum_ok(p jsonb, k text, p_min numeric DEFAULT NULL, p_required boolean DEFAULT true) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p IS NULL OR NOT (p ? k) OR p->k = 'null'::jsonb OR (p->>k) = '' THEN NOT p_required
                WHEN jsonb_typeof(p->k) = 'number' OR (p->>k) ~ '^\s*-?[0-9]*\.?[0-9]+\s*$' THEN p_min IS NULL OR (p->>k)::numeric >= p_min
                ELSE false END
$$;

CREATE TABLE qc_limit_type (limit_type text PRIMARY KEY, shape text NOT NULL CHECK (shape IN ('Range','Max','Qualitative')), sort_order integer NOT NULL);
INSERT INTO qc_limit_type VALUES
 ('Recovery %','Range',1), ('RSD','Range',2), ('Stdev','Range',3), ('Area Counts','Range',4), ('Tailing Factor','Range',5), ('Retention time','Range',6),
 ('Signal-to-noise','Range',7), ('Resolution','Range',8), ('RPD','Max',9), ('Blank threshold','Max',10),
 ('Absence','Qualitative',11), ('Presence','Qualitative',12), ('Identified','Qualitative',13);
CREATE TABLE qc_type (qc_type text PRIMARY KEY, default_class text NOT NULL CHECK (default_class IN ('Prep','Analytical')), sort_order integer NOT NULL);
INSERT INTO qc_type VALUES
 ('Method Blank','Prep',1), ('Laboratory Control Sample','Prep',2), ('Matrix Spike','Prep',3), ('Matrix Spike Duplicate','Prep',4),
 ('Reference Sample','Prep',5), ('Positive Control','Prep',6), ('Negative Control','Prep',7), ('Suitability Control Sample','Prep',8),
 ('ICV','Analytical',9), ('CCV','Analytical',10), ('Instrument Blank','Analytical',11), ('Tailing Factor Control','Analytical',12);

CREATE FUNCTION test_version_problems(p_version uuid) RETURNS TABLE (severity text, step_key text, problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE v test_version; t test; s record; q jsonb; c jsonb; o jsonb; f jsonb; tok text; ref workflow_step; n integer; m integer;
        anc uuid[]; tv_analytes uuid[]; lt text; tgt test; dep uuid;
BEGIN
    SELECT * INTO v FROM test_version WHERE id = p_version;
    SELECT * INTO t FROM test WHERE id = v.test_id;
    SELECT array_agg(analyte_id) INTO tv_analytes FROM test_version_analyte WHERE test_version_id = p_version AND status = 'Active';
    -- the test and version
    IF t.department_id IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Choose the department that does this test (tab 1)'; END IF;
    IF v.method_id IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Choose the method (SOP) this version follows (tab 1)';
    ELSIF EXISTS (SELECT 1 FROM method WHERE id = v.method_id AND status <> 'Active') THEN RETURN QUERY SELECT 'Error', NULL::text, 'The method is Inactive; choose an active one (tab 1)';
    END IF;
    IF t.department_id IS NOT NULL AND NOT department_has_people(t.department_id) THEN
        RETURN QUERY SELECT 'Warning', NULL::text, format('Nobody is in a group for the %s department yet, so nobody could do its steps (Admin > Groups: mark a group as that department)',
            (SELECT department_name FROM department WHERE id = t.department_id));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM test_catalog_entry WHERE test_id = t.id) THEN
        RETURN QUERY SELECT 'Warning', NULL::text, 'Not priced yet: it can be approved, but cannot be quoted or ordered until the catalogue has its price';
    END IF;
    -- analytes
    IF tv_analytes IS NULL THEN RETURN QUERY SELECT 'Error', NULL::text, 'Add at least one analyte (tab 2)'; END IF;
    RETURN QUERY SELECT 'Error', NULL::text, format('%s: a %s result needs a reporting unit (tab 2)', an.analyte_name, lower(a.result_type::text))
      FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id
     WHERE a.test_version_id = p_version AND a.status = 'Active' AND a.result_type IN ('Numeric','Count') AND a.reporting_unit IS NULL;
    -- steps
    SELECT count(*) INTO n FROM workflow_step WHERE test_version_id = p_version AND status = 'Active';
    IF n = 0 THEN RETURN QUERY SELECT 'Error', NULL::text, 'Add the workflow steps (tab 3)'; RETURN; END IF;
    SELECT count(*) INTO m FROM workflow_step s0 WHERE s0.test_version_id = p_version AND s0.status = 'Active'
       AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency d WHERE d.step_id = s0.id AND d.status = 'Active');
    IF m <> 1 THEN
        RETURN QUERY SELECT 'Error', NULL::text, format('The workflow must have exactly one first step; %s steps come after nothing. Connect each step to the one before it.', m);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'QC Review') THEN
        RETURN QUERY SELECT 'Error', NULL::text, 'The workflow needs a QC Review step (where the results are reviewed and approved)';
    END IF;
    IF (SELECT count(*) FROM workflow_step WHERE test_version_id = p_version AND status = 'Active' AND step_type = 'Batching') > 1 THEN
        RETURN QUERY SELECT 'Error', NULL::text, 'Only one Batching step is allowed';
    END IF;

    FOR s IN SELECT ws.* FROM workflow_step ws WHERE ws.test_version_id = p_version AND ws.status = 'Active' ORDER BY ws.sort_order, ws.step_key LOOP
        c := s.config;
        SELECT array_agg(a.step_id) INTO anc FROM step_ancestors(s.id) a;
        -- shape of the graph
        IF s.step_type = 'Batching' AND anc IS NOT NULL THEN RETURN QUERY SELECT 'Error', s.step_key, 'Batching must be the first step'; END IF;
        IF s.step_type <> 'QC Review' AND NOT EXISTS (SELECT 1 FROM workflow_step_dependency d JOIN workflow_step x ON x.id = d.step_id
                                                       WHERE d.depends_on_step_id = s.id AND d.status = 'Active' AND x.status = 'Active') THEN
            RETURN QUERY SELECT 'Error', s.step_key, 'Nothing comes after this step: every branch must end in a QC Review';
        END IF;
        dep := COALESCE(s.department_id, t.department_id);
        IF s.department_id IS NOT NULL AND s.department_id IS DISTINCT FROM t.department_id AND NOT department_has_people(s.department_id) THEN
            RETURN QUERY SELECT 'Warning', s.step_key, format('Nobody is in a group for the %s department, so nobody could do this step', (SELECT department_name FROM department WHERE id = s.department_id));
        END IF;
        -- equipment
        -- (a Data Entry step that is a manual observation, with no instrument export to attach, needs no instrument)
        IF s.step_type IN ('Weighing','Incubation') OR (s.step_type = 'Data Entry' AND COALESCE(c->>'require_attachment', 'true') <> 'false')
           OR EXISTS (SELECT 1 FROM workflow_step_equipment WHERE step_id = s.id AND status = 'Active') THEN
            SELECT count(*), count(*) FILTER (WHERE is_main) INTO n, m FROM workflow_step_equipment WHERE step_id = s.id AND status = 'Active';
            IF n = 0 THEN RETURN QUERY SELECT 'Error', s.step_key, format('Choose the equipment type for this %s step', lower(s.step_type::text));
            ELSIF m <> 1 THEN RETURN QUERY SELECT 'Error', s.step_key, 'Mark exactly one equipment type as the main instrument (the others are alternatives)';
            END IF;
        END IF;
        -- settings per step type
        CASE s.step_type
        WHEN 'Batching' THEN
            IF NOT jnum_ok(c, 'max_samples', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the maximum number of samples per batch (1 or more)'; END IF;
            FOR q IN SELECT * FROM jsonb_array_elements(COALESCE(c->'qc', '[]')) LOOP
                IF NOT EXISTS (SELECT 1 FROM qc_type WHERE qc_type = q->>'qc_type') THEN RETURN QUERY SELECT 'Error', s.step_key, format('"%s" is not a QC type', q->>'qc_type'); CONTINUE; END IF;
                IF COALESCE(q->>'qc_class', '') NOT IN ('Prep','Analytical') THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: choose Prep or Analytical QC', q->>'qc_type'); END IF;
                IF COALESCE(q->>'frequency', '') = 'Every N' THEN
                    IF NOT jnum_ok(q, 'every_n', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: every how many samples?', q->>'qc_type'); END IF;
                ELSIF COALESCE(q->>'frequency', '') = 'Once' THEN
                    IF NOT jnum_ok(q, 'count', 1, false) THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: how many per batch?', q->>'qc_type'); END IF;
                ELSE RETURN QUERY SELECT 'Error', s.step_key, format('%s: choose how often (Once per batch, or Every N samples)', q->>'qc_type');
                END IF;
                FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(q->'criteria', '[]')) LOOP
                    SELECT shape INTO lt FROM qc_limit_type WHERE limit_type = o->>'limit_type';
                    IF lt IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s: "%s" is not a limit type', q->>'qc_type', o->>'limit_type'); CONTINUE; END IF;
                    IF lt = 'Range' AND (NOT jnum_ok(o, 'min') OR NOT jnum_ok(o, 'max') OR (o->>'min')::numeric > (o->>'max')::numeric) THEN
                        RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: enter a minimum and a maximum (min not above max)', q->>'qc_type', o->>'limit_type');
                    ELSIF lt = 'Max' AND NOT jnum_ok(o, 'max') AND COALESCE(o->>'limit_ref', '') NOT IN ('LOQ','½ LOQ','LOD') THEN
                        RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: enter a maximum, or LOQ, ½ LOQ or LOD', q->>'qc_type', o->>'limit_type');
                    END IF;
                    FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(o->'overrides', '[]')) LOOP
                        IF tv_analytes IS NULL OR NOT ((f->>'analyte_id')::uuid = ANY(tv_analytes)) THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('%s %s: an analyte exception names an analyte that is not on this test', q->>'qc_type', o->>'limit_type');
                        ELSIF lt = 'Range' AND (NOT jnum_ok(f, 'min') OR NOT jnum_ok(f, 'max') OR (f->>'min')::numeric > (f->>'max')::numeric) THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('%s %s exception for %s: enter a minimum and a maximum', q->>'qc_type', o->>'limit_type', (SELECT analyte_name FROM analyte WHERE id = (f->>'analyte_id')::uuid));
                        END IF;
                    END LOOP;
                END LOOP;
            END LOOP;
        WHEN 'Weighing' THEN
            IF NOT jnum_ok(c, 'target', 0, false) OR NOT jnum_ok(c, 'tolerance', 0, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'The target weight and tolerance must be numbers'; END IF;
        WHEN 'Preparation' THEN
            FOR f IN SELECT * FROM jsonb_array_elements(COALESCE(c->'fields', '[]')) LOOP
                IF field_key(f->>'label') = '' THEN RETURN QUERY SELECT 'Error', s.step_key, 'Every field needs a label';
                ELSIF COALESCE(f->>'type', '') NOT IN ('Number','Text','Time','Date') THEN RETURN QUERY SELECT 'Error', s.step_key, format('Field "%s": choose Number, Text, Time or Date', f->>'label');
                END IF;
            END LOOP;
            IF (SELECT count(*) <> count(DISTINCT field_key(f2->>'label')) FROM jsonb_array_elements(COALESCE(c->'fields', '[]')) f2) THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Two fields have the same label';
            END IF;
        WHEN 'Plating/Inoculation' THEN
            IF NOT jnum_ok(c, 'plates_per_entry', 1) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the plates per entry (1 or more)'; END IF;
        WHEN 'Incubation' THEN
            IF NOT jnum_ok(c, 'temp_c') THEN RETURN QUERY SELECT 'Error', s.step_key, 'Enter the target temperature (°C)'; END IF;
            IF NOT jnum_ok(c, 'temp_tolerance', 0, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'The temperature tolerance must be a number'; END IF;
            IF NOT jnum_ok(c, 'duration', 0) OR COALESCE(c->>'duration_unit', '') NOT IN ('hours','days') THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Enter the target duration in hours or days';
            ELSIF NOT jnum_ok(c, 'window_min', 0) OR NOT jnum_ok(c, 'window_max', 0)
                  OR (c->>'window_min')::numeric > (c->>'duration')::numeric OR (c->>'window_max')::numeric < (c->>'duration')::numeric THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Enter the acceptable window (shortest and longest), around the target duration';
            END IF;
        WHEN 'Dilution' THEN
            IF COALESCE(c->>'mode', '') = 'Single' THEN
                IF NOT jnum_ok(c, 'aliquot', 0) OR (c->>'aliquot')::numeric = 0 OR NOT jnum_ok(c, 'diluent', 0) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Enter the default aliquot and diluent amounts (what is added, not a factor)';
                END IF;
            ELSIF COALESCE(c->>'mode', '') = 'Serial' THEN
                IF NOT jnum_ok(c, 'initial_amount', 0) OR (c->>'initial_amount')::numeric = 0 OR NOT jnum_ok(c, 'initial_diluent', 0)
                   OR NOT jnum_ok(c, 'transfer_aliquot', 0) OR (c->>'transfer_aliquot')::numeric = 0 OR NOT jnum_ok(c, 'transfer_diluent', 0) OR NOT jnum_ok(c, 'depth', 1) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Enter the initial amounts, the transfer amounts and the standard depth';
                END IF;
            ELSE RETURN QUERY SELECT 'Error', s.step_key, 'Choose Single or Serial dilution';
            END IF;
            IF NOT jnum_ok(c, 'fields_per_entry', 1, false) THEN RETURN QUERY SELECT 'Error', s.step_key, 'Dilution fields per entry must be 1 or more'; END IF;
        WHEN 'Split off Test', 'Hold Point' THEN
            SELECT * INTO tgt FROM test WHERE id = CASE WHEN (c->>'test_id') ~ '^[0-9a-f-]{36}$' THEN (c->>'test_id')::uuid END;
            IF tgt.id IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, CASE s.step_type WHEN 'Hold Point' THEN 'Choose the test this step waits for' ELSE 'Choose the test to split off' END;
            ELSIF tgt.id = t.id THEN RETURN QUERY SELECT 'Error', s.step_key, 'A test cannot split off or wait for itself';
            ELSIF tgt.status <> 'Active' THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s is retired', tgt.test_name);
            ELSIF tgt.site_id IS NOT NULL AND tgt.site_id IS DISTINCT FROM t.site_id THEN RETURN QUERY SELECT 'Error', s.step_key, format('%s belongs to another lab; copy it to this lab first', tgt.test_name);
            END IF;
            IF s.step_type = 'Split off Test' AND COALESCE(c->>'trigger', '') NOT IN ('On finding','Manual only') THEN
                RETURN QUERY SELECT 'Error', s.step_key, 'Choose when it is split off (on a finding, or by the analyst only)';
            END IF;
            IF s.step_type = 'Split off Test' AND c->>'trigger' = 'On finding' THEN
                IF jsonb_typeof(c->'finding_steps') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'finding_steps') = 0 THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Choose the Data Entry step(s), before this one, whose finding splits off the test';
                ELSE
                    FOR o IN SELECT * FROM jsonb_array_elements(c->'finding_steps') LOOP
                        SELECT * INTO ref FROM workflow_step WHERE test_version_id = p_version AND workflow_step.step_key = (o #>> '{}') AND status = 'Active';
                        IF ref.id IS NULL OR NOT (ref.id = ANY(COALESCE(anc, '{}'))) OR ref.step_type <> 'Data Entry' THEN
                            RETURN QUERY SELECT 'Error', s.step_key, format('"%s" is not a Data Entry step that comes before this one', o #>> '{}');
                        END IF;
                    END LOOP;
                END IF;
                IF COALESCE(c->>'finding', '') NOT IN ('Present','Count above') OR (c->>'finding' = 'Count above' AND NOT jnum_ok(c, 'count_above', 0)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'Choose the finding: Present, or a count above a number';
                END IF;
            END IF;
        WHEN 'Calculation' THEN
            IF formula_check(c->>'formula') IS NOT NULL THEN RETURN QUERY SELECT 'Error', s.step_key, 'Formula: ' || formula_check(c->>'formula'); END IF;
            FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'overrides', '[]')) LOOP
                IF tv_analytes IS NULL OR NOT ((o->>'analyte_id')::uuid = ANY(tv_analytes)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'A formula exception names an analyte that is not on this test';
                ELSIF formula_check(o->>'formula') IS NOT NULL THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('Formula for %s: %s', (SELECT analyte_name FROM analyte WHERE id = (o->>'analyte_id')::uuid), formula_check(o->>'formula'));
                END IF;
            END LOOP;
            -- every token must name a step that comes before this one, and a field that step offers
            FOREACH tok IN ARRAY formula_tokens(COALESCE(c->>'formula', '') || ' ' || COALESCE((SELECT string_agg(o2->>'formula', ' ') FROM jsonb_array_elements(COALESCE(c->'overrides', '[]')) o2), '')) LOOP
                SELECT * INTO ref FROM workflow_step WHERE test_version_id = p_version AND workflow_step.step_key = split_part(tok, '.', 1) AND status = 'Active';
                IF ref.id IS NULL THEN RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: there is no step "%s"', tok, split_part(tok, '.', 1));
                ELSIF NOT (ref.id = ANY(COALESCE(anc, '{}'))) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: "%s" does not come before this step, so its value would not exist yet', tok, ref.step_name);
                ELSIF NOT (split_part(tok, '.', 2) = ANY(step_token_fields(ref.id))) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, format('{%s}: "%s" offers %s', tok, ref.step_name,
                        COALESCE(NULLIF(array_to_string(array(SELECT '{' || ref.step_key || '.' || x || '}' FROM unnest(step_token_fields(ref.id)) x), ', '), ''), 'no values to formulas'));
                END IF;
            END LOOP;
        WHEN 'Data Entry' THEN
            IF COALESCE(btrim(c->>'value_label'), '') = '' THEN RETURN QUERY SELECT 'Error', s.step_key, 'Name the value that is entered (e.g. Concentration in solution)'; END IF;
            FOR o IN SELECT * FROM jsonb_array_elements(COALESCE(c->'analyte_ids', '[]')) LOOP
                IF tv_analytes IS NULL OR NOT ((o #>> '{}')::uuid = ANY(tv_analytes)) THEN
                    RETURN QUERY SELECT 'Error', s.step_key, 'This step lists an analyte that is not on the test';
                END IF;
            END LOOP;
        ELSE NULL;
        END CASE;
    END LOOP;
    RETURN;
END $$;

-------------------------------------------------------------------------------
-- 9. NEW TESTS, NEW VERSIONS, DUPLICATES AND COPIES, APPROVAL
-------------------------------------------------------------------------------
-- A new test at a lab: Draft version 1 and an unpriced catalogue entry
CREATE FUNCTION create_test(p_site uuid, p_name text, p_department uuid DEFAULT NULL, p_method uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_test uuid;
BEGIN
    IF p_site IS NULL THEN RAISE EXCEPTION 'A new test belongs to a lab'; END IF;
    PERFORM require_permission_at('methods.design', p_site);
    INSERT INTO test (test_name, site_id, department_id) VALUES (p_name, p_site, p_department) RETURNING id INTO v_test;
    INSERT INTO test_version (test_id, version_no, status, method_id) VALUES (v_test, 1, 'Draft', p_method);
    PERFORM set_methods_internal(true);
    INSERT INTO test_catalog_entry (test_id) VALUES (v_test);
    PERFORM set_methods_internal(false);
    RETURN v_test;
END $$;

-- Copy a version's content (analytes, steps, their equipment and dependencies) into another (Draft) version.
-- Within a lab everything carries over; to another lab, departments map by code and equipment types by name.
CREATE FUNCTION copy_version_content(p_src uuid, p_dst uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE src_site uuid; dst_site uuid; s workflow_step; v_new uuid; map jsonb := '{}';
BEGIN
    SELECT t.site_id INTO src_site FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = p_src;
    SELECT t.site_id INTO dst_site FROM test t JOIN test_version v ON v.test_id = t.id WHERE v.id = p_dst;
    INSERT INTO test_version_analyte (test_version_id, analyte_id, sort_order, result_type, reporting_unit, loq, lod, rounding_mode, rounding_digits,
                                      hide_on_report, default_spec_min, default_spec_max, default_spec_text)
    SELECT p_dst, analyte_id, sort_order, result_type, reporting_unit, loq, lod, rounding_mode, rounding_digits, hide_on_report, default_spec_min, default_spec_max, default_spec_text
      FROM test_version_analyte WHERE test_version_id = p_src AND status = 'Active';
    FOR s IN SELECT * FROM workflow_step WHERE test_version_id = p_src AND status = 'Active' ORDER BY sort_order LOOP
        INSERT INTO workflow_step (test_version_id, step_key, step_name, step_type, sort_order, department_id, instructions, config)
        VALUES (p_dst, s.step_key, s.step_name, s.step_type, s.sort_order,
                CASE WHEN src_site IS NOT DISTINCT FROM dst_site THEN s.department_id
                     ELSE (SELECT d2.id FROM department d1 JOIN department d2 ON upper(d2.department_code) = upper(d1.department_code) AND d2.site_id = dst_site
                            WHERE d1.id = s.department_id AND d2.status = 'Active') END,
                s.instructions, s.config)
        RETURNING id INTO v_new;
        map := map || jsonb_build_object(s.id::text, v_new);
        INSERT INTO workflow_step_equipment (step_id, equipment_type_id, is_main)
        SELECT v_new, CASE WHEN src_site IS NOT DISTINCT FROM dst_site THEN e.equipment_type_id ELSE e2.id END, e.is_main
          FROM workflow_step_equipment e JOIN equipment_type e1 ON e1.id = e.equipment_type_id
          LEFT JOIN equipment_type e2 ON lower(e2.type_name) = lower(e1.type_name) AND e2.site_id = dst_site AND e2.status = 'Active'
         WHERE e.step_id = s.id AND e.status = 'Active' AND (src_site IS NOT DISTINCT FROM dst_site OR e2.id IS NOT NULL);
    END LOOP;
    INSERT INTO workflow_step_dependency (step_id, depends_on_step_id, dependency_type)
    SELECT (map->>d.step_id::text)::uuid, (map->>d.depends_on_step_id::text)::uuid, d.dependency_type
      FROM workflow_step_dependency d JOIN workflow_step s1 ON s1.id = d.step_id
     WHERE s1.test_version_id = p_src AND d.status = 'Active' AND map ? d.step_id::text AND map ? d.depends_on_step_id::text;
END $$;

-- Start a new Draft version of a test, copied from the Effective one (or the latest)
CREATE FUNCTION new_test_version(p_test uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t test; src test_version; v_new uuid; d integer;
BEGIN
    SELECT * INTO t FROM test WHERE id = p_test;
    IF t.id IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
    PERFORM require_methods_permission('methods.design', t.site_id);
    SELECT version_no INTO d FROM test_version WHERE test_id = p_test AND status = 'Draft';
    IF d IS NOT NULL THEN RAISE EXCEPTION 'Version % is already a Draft: continue that one', d; END IF;
    SELECT * INTO src FROM test_version WHERE test_id = p_test ORDER BY (status = 'Effective') DESC, version_no DESC LIMIT 1;
    INSERT INTO test_version (test_id, version_no, status, method_id, procedure_text, rounding_mode, rounding_digits, nd_below_lod, copied_from_version_id)
    VALUES (p_test, COALESCE((SELECT max(version_no) FROM test_version WHERE test_id = p_test), 0) + 1, 'Draft',
            src.method_id, src.procedure_text, COALESCE(src.rounding_mode, 'Significant figures'), COALESCE(src.rounding_digits, 3), COALESCE(src.nd_below_lod, false), src.id)
    RETURNING id INTO v_new;
    IF src.id IS NOT NULL THEN PERFORM copy_version_content(src.id, v_new); END IF;
    RETURN v_new;
END $$;

-- Duplicate a test (same lab, as a quick template) or copy it to another lab. The copy is a new test with a Draft
-- version 1 that its lab approves. Its catalogue terms come too (a lab's prices can then be changed in the catalogue).
CREATE FUNCTION copy_test(p_test uuid, p_site uuid, p_name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE t test; src test_version; m method; v_method uuid; v_test uuid; v_ver uuid; v_entry uuid; e test_catalog_entry;
BEGIN
    SELECT * INTO t FROM test WHERE id = p_test;
    IF t.id IS NULL THEN RAISE EXCEPTION 'Test not found'; END IF;
    IF p_site IS NULL THEN RAISE EXCEPTION 'Choose the lab the copy belongs to'; END IF;
    IF t.site_id IS NOT NULL AND NOT user_can_view_site(current_app_user(), t.site_id) THEN RAISE EXCEPTION 'You cannot see the lab this test belongs to'; END IF;
    PERFORM require_permission_at('methods.design', p_site);
    SELECT * INTO src FROM test_version WHERE test_id = p_test ORDER BY (status = 'Effective') DESC, version_no DESC LIMIT 1;
    -- the method: the same one in the same lab; in another lab, its method of the same name, else a copy
    IF src.method_id IS NOT NULL THEN
        SELECT * INTO m FROM method WHERE id = src.method_id;
        IF m.site_id = p_site THEN v_method := m.id;
        ELSE
            SELECT id INTO v_method FROM method WHERE site_id = p_site AND lower(method_name) = lower(m.method_name);
            IF v_method IS NULL THEN
                INSERT INTO method (site_id, method_name, sop_code, sop_link, description)
                VALUES (p_site, m.method_name, m.sop_code, m.sop_link, 'Copied from ' || m.method_code || '; check the SOP code for this lab') RETURNING id INTO v_method;
            END IF;
        END IF;
    END IF;
    INSERT INTO test (test_name, site_id, department_id, copied_from_test_id)
    VALUES (p_name, p_site,
            CASE WHEN t.site_id IS NOT DISTINCT FROM p_site THEN t.department_id
                 ELSE (SELECT d2.id FROM department d1 JOIN department d2 ON upper(d2.department_code) = upper(d1.department_code) AND d2.site_id = p_site
                        WHERE d1.id = t.department_id AND d2.status = 'Active') END, p_test)
    RETURNING id INTO v_test;
    INSERT INTO test_version (test_id, version_no, status, method_id, procedure_text, rounding_mode, rounding_digits, nd_below_lod, copied_from_version_id, change_summary)
    VALUES (v_test, 1, 'Draft', v_method, src.procedure_text, COALESCE(src.rounding_mode, 'Significant figures'), COALESCE(src.rounding_digits, 3),
            COALESCE(src.nd_below_lod, false), src.id, 'Copied from ' || t.test_code || ' ' || t.test_name || COALESCE(' version ' || src.version_no, ''))
    RETURNING id INTO v_ver;
    IF src.id IS NOT NULL THEN PERFORM copy_version_content(src.id, v_ver); END IF;
    PERFORM set_methods_internal(true);
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = p_test;
    IF e.id IS NOT NULL THEN
        INSERT INTO test_catalog_entry (test_id, description, pricing_mode, base_price, prep_fee, standard_tat, tat_unit, cutoff_time, rush_schedule_id, show_in_public_catalogue)
        VALUES (v_test, e.description, e.pricing_mode, e.base_price, e.prep_fee, e.standard_tat, e.tat_unit, e.cutoff_time, e.rush_schedule_id, false) RETURNING id INTO v_entry;
        INSERT INTO test_analyte_price (catalog_entry_id, analyte_id, price) SELECT v_entry, analyte_id, price FROM test_analyte_price WHERE catalog_entry_id = e.id AND status = 'Active';
    ELSE
        INSERT INTO test_catalog_entry (test_id) VALUES (v_test);
    END IF;
    PERFORM set_methods_internal(false);
    RETURN v_test;
END $$;

-- Everyone who created or changed a version or any of its parts (they may not approve it)
CREATE FUNCTION test_version_authors(p_version uuid) RETURNS TABLE (user_id uuid) LANGUAGE sql STABLE AS $$
    WITH parts(t, id) AS (
        SELECT 'test_version', p_version
        UNION ALL SELECT 'test_version_analyte', id FROM test_version_analyte WHERE test_version_id = p_version
        UNION ALL SELECT 'workflow_step', id FROM workflow_step WHERE test_version_id = p_version
        UNION ALL SELECT 'workflow_step_equipment', e.id FROM workflow_step_equipment e JOIN workflow_step s ON s.id = e.step_id WHERE s.test_version_id = p_version
        UNION ALL SELECT 'workflow_step_dependency', d.id FROM workflow_step_dependency d JOIN workflow_step s ON s.id = d.step_id WHERE s.test_version_id = p_version)
    SELECT DISTINCT a.changed_by FROM audit_log a JOIN parts ON parts.t = a.table_name AND parts.id = a.record_id
    UNION SELECT created_by FROM test_version WHERE id = p_version
$$;

CREATE FUNCTION approve_test_version(p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
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
    PERFORM ensure_reason('Test version approved');
    PERFORM set_methods_internal(true);
    UPDATE test_version SET status = 'Superseded' WHERE test_id = v.test_id AND status = 'Effective';
    UPDATE test_version SET status = 'Effective', effective_from = now(), approved_by = current_app_user(), approved_at = now(),
           approval_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid
     WHERE id = p_version;
    PERFORM set_methods_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 10. ORDERING: a lab's test is ordered only at that lab
-------------------------------------------------------------------------------
CREATE FUNCTION requested_test_lab_rule() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_test_site uuid; v_order_site uuid;
BEGIN
    SELECT site_id INTO v_test_site FROM test WHERE id = NEW.test_id;
    IF v_test_site IS NULL THEN RETURN NEW; END IF;
    SELECT o.site_id INTO v_order_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id;
    IF v_order_site IS DISTINCT FROM v_test_site THEN
        RAISE EXCEPTION '% belongs to % and can only be ordered there (copy the test to this lab to offer it here)',
            (SELECT test_name FROM test WHERE id = NEW.test_id), (SELECT site_code FROM lab_site WHERE id = v_test_site);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a03_test_lab BEFORE INSERT ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_lab_rule();

-------------------------------------------------------------------------------
-- 11. SPECIFICATIONS (per quoted test and per requested test; none = unspecified, results reported as they are)
-------------------------------------------------------------------------------
CREATE TYPE spec_source AS ENUM ('Lab','Client','Client portal');
CREATE TABLE specification (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quoted_line_id     uuid REFERENCES quoted_test_configuration(id),
    requested_test_id  uuid REFERENCES requested_test(id),
    analyte_id         uuid NOT NULL REFERENCES analyte(id),
    min_value          numeric,
    max_value          numeric,
    text_value         text,                          -- qualitative limits, e.g. Absent
    unit               text,
    source             spec_source NOT NULL DEFAULT 'Client',
    copied_from_spec_id uuid REFERENCES specification(id),
    status             record_status NOT NULL DEFAULT 'Active',
    record_version     integer NOT NULL DEFAULT 1,
    created_at         timestamptz NOT NULL DEFAULT now(),
    created_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at        timestamptz NOT NULL DEFAULT now(),
    modified_by        uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT specification_one_owner CHECK ((quoted_line_id IS NULL) <> (requested_test_id IS NULL)),
    CONSTRAINT specification_has_limit CHECK (min_value IS NOT NULL OR max_value IS NOT NULL OR NULLIF(btrim(text_value), '') IS NOT NULL),
    CONSTRAINT specification_order CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value)
);
CREATE UNIQUE INDEX specification_line_uq ON specification (quoted_line_id, analyte_id) WHERE status = 'Active' AND quoted_line_id IS NOT NULL;
CREATE UNIQUE INDEX specification_rt_uq ON specification (requested_test_id, analyte_id) WHERE status = 'Active' AND requested_test_id IS NOT NULL;
CALL make_gxp('specification');
CREATE FUNCTION specification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_version uuid; v_site uuid; v_pv uuid; rt requested_test;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.quoted_line_id IS DISTINCT FROM OLD.quoted_line_id OR NEW.requested_test_id IS DISTINCT FROM OLD.requested_test_id
                             OR NEW.analyte_id <> OLD.analyte_id) THEN
        RAISE EXCEPTION 'Remove the specification (Inactive) and add a new one instead';
    END IF;
    NEW.text_value := NULLIF(btrim(NEW.text_value), '');
    NEW.unit := canonical_unit(NEW.unit, enum_range(NULL::unit_dimension), 'Specification unit');
    IF NEW.quoted_line_id IS NOT NULL THEN
        SELECT q.project_version_id, v.id INTO v_pv, v_version FROM quoted_test_configuration q
          LEFT JOIN test_version v ON v.test_id = q.test_id AND v.status = 'Effective' WHERE q.id = NEW.quoted_line_id;
        IF NOT version_is_editable(v_pv) THEN RAISE EXCEPTION 'Specifications are locked once a quote is issued; create a new version of the quote'; END IF;
        IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to change quotes (quotes.edit). Ask your lab administrator.'; END IF;
    ELSE
        SELECT * INTO rt FROM requested_test WHERE id = NEW.requested_test_id;
        v_version := rt.test_version_id;
        IF rt.status = 'Cancelled' THEN RAISE EXCEPTION 'The test is cancelled'; END IF;
        SELECT o.site_id INTO v_site FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = rt.sample_id;
        PERFORM require_permission_at('orders.edit', v_site);
    END IF;
    IF NEW.status = 'Active' AND v_version IS NOT NULL AND NOT EXISTS (SELECT 1 FROM test_version_analyte WHERE test_version_id = v_version AND analyte_id = NEW.analyte_id AND status = 'Active') THEN
        RAISE EXCEPTION '% is not an analyte of this test', (SELECT analyte_name FROM analyte WHERE id = NEW.analyte_id);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON specification FOR EACH ROW EXECUTE FUNCTION specification_rules();

-- A requested test takes the specifications of its quoted line (a project's limits carry to every order)
CREATE FUNCTION requested_test_copy_specs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO specification (requested_test_id, analyte_id, min_value, max_value, text_value, unit, source, copied_from_spec_id)
    SELECT NEW.id, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.id
      FROM specification s
     WHERE s.quoted_line_id = NEW.quoted_line_id AND s.status = 'Active'
       AND EXISTS (SELECT 1 FROM test_version_analyte a WHERE a.test_version_id = NEW.test_version_id AND a.analyte_id = s.analyte_id AND a.status = 'Active');
    RETURN NULL;
END $$;
CREATE TRIGGER z_copy_specs AFTER INSERT ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_copy_specs();

-- A new quote version keeps its lines' specifications
CREATE OR REPLACE FUNCTION new_project_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_new uuid; v_prev uuid; r record; v_line uuid;
BEGIN
    SELECT id INTO v_prev FROM project_version WHERE project_id = p_project ORDER BY version_no DESC LIMIT 1;
    INSERT INTO project_version (project_id, version_no) VALUES (p_project, 0) RETURNING id INTO v_new;
    IF v_prev IS NOT NULL THEN
        FOR r IN SELECT l.* FROM quoted_test_configuration l JOIN test t ON t.id = l.test_id
                  WHERE l.project_version_id = v_prev AND l.status = 'Active' AND t.status = 'Active' LOOP
            INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, special_instructions)
            VALUES (v_new, r.test_id, r.quantity, r.special_instructions) RETURNING id INTO v_line;
            UPDATE quoted_analyte_selection s SET included = false
             WHERE s.line_id = v_line AND EXISTS (SELECT 1 FROM quoted_analyte_selection o
                                                   WHERE o.line_id = r.id AND o.analyte_id = s.analyte_id AND NOT o.included);
            -- keep the previous discount % against the refreshed list price
            UPDATE quoted_test_configuration q
               SET final_price = CASE WHEN r.final_price IS NULL OR r.list_price = 0 THEN r.final_price
                                      ELSE round(q.list_price * r.final_price / r.list_price, 2) END
             WHERE q.id = v_line;
            INSERT INTO specification (quoted_line_id, analyte_id, min_value, max_value, text_value, unit, source, copied_from_spec_id)
            SELECT v_line, s.analyte_id, s.min_value, s.max_value, s.text_value, s.unit, s.source, s.id
              FROM specification s WHERE s.quoted_line_id = r.id AND s.status = 'Active';
        END LOOP;
        UPDATE quote_rush_term n SET discount_pct = o.discount_pct
          FROM quote_rush_term o WHERE n.project_version_id = v_new AND o.project_version_id = v_prev AND o.tier_id = n.tier_id;
    END IF;
    RETURN v_new;
END $$;

-------------------------------------------------------------------------------
-- 12. VIEWS, AUDIT REFERENCES, CANNED REASONS MODULE
-------------------------------------------------------------------------------
CREATE VIEW test_design_view AS
SELECT t.id, t.test_code, t.test_name, t.status, t.site_id, s.site_code, t.department_id, d.department_code, d.department_name,
       t.copied_from_test_id, ct.test_code AS copied_from_code,
       ev.id AS effective_version_id, ev.version_no AS effective_version, ev.effective_from,
       dv.id AS draft_version_id, dv.version_no AS draft_version,
       COALESCE(dv.id, ev.id, lv.id) AS open_version_id,
       m.id AS method_id, m.method_name, m.sop_code,
       (SELECT count(*) FROM test_version_analyte a WHERE a.test_version_id = COALESCE(dv.id, ev.id, lv.id) AND a.status = 'Active') AS analyte_count,
       (SELECT count(*) FROM workflow_step w WHERE w.test_version_id = COALESCE(dv.id, ev.id, lv.id) AND w.status = 'Active') AS step_count,
       EXISTS (SELECT 1 FROM test_catalog_entry e WHERE e.test_id = t.id) AS has_catalog_entry
  FROM test t
  LEFT JOIN lab_site s ON s.id = t.site_id
  LEFT JOIN department d ON d.id = t.department_id
  LEFT JOIN test ct ON ct.id = t.copied_from_test_id
  LEFT JOIN test_version ev ON ev.test_id = t.id AND ev.status = 'Effective'
  LEFT JOIN LATERAL (SELECT * FROM test_version x WHERE x.test_id = t.id AND x.status = 'Draft' ORDER BY version_no DESC LIMIT 1) dv ON true
  LEFT JOIN LATERAL (SELECT * FROM test_version x WHERE x.test_id = t.id ORDER BY version_no DESC LIMIT 1) lv ON true
  LEFT JOIN method m ON m.id = COALESCE(dv.method_id, ev.method_id, lv.method_id);

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_slice10;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_ver uuid;
BEGIN
    CASE p_table
    WHEN 'method' THEN RETURN jsonb_build_object('label', 'Method ' || (r->>'method_code') || ' ' || (r->>'method_name'), 'link', '#/methods/sops?find=' || (r->>'method_code'));
    WHEN 'test_version' THEN RETURN jsonb_build_object('label', 'Test ' || COALESCE((SELECT test_code FROM test WHERE id = (r->>'test_id')::uuid), '') || ' version ' || (r->>'version_no'),
        'link', '#/methods/versions/' || p_id);
    WHEN 'test_version_analyte' THEN RETURN jsonb_build_object('label', 'Analyte ' || COALESCE((SELECT analyte_name FROM analyte WHERE id = (r->>'analyte_id')::uuid), '') || ' on '
        || COALESCE((SELECT t.test_code || ' v' || v.version_no FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = (r->>'test_version_id')::uuid), ''),
        'link', '#/methods/versions/' || (r->>'test_version_id') || '?tab=analytes');
    WHEN 'workflow_step' THEN RETURN jsonb_build_object('label', 'Step ' || (r->>'step_name') || ' (' || (r->>'step_key') || ') on '
        || COALESCE((SELECT t.test_code || ' v' || v.version_no FROM test_version v JOIN test t ON t.id = v.test_id WHERE v.id = (r->>'test_version_id')::uuid), ''),
        'link', '#/methods/versions/' || (r->>'test_version_id') || '?tab=workflow');
    WHEN 'workflow_step_equipment', 'workflow_step_dependency' THEN
        SELECT s.test_version_id INTO v_ver FROM workflow_step s WHERE s.id = (r->>'step_id')::uuid;
        RETURN jsonb_build_object('label', CASE p_table WHEN 'workflow_step_equipment' THEN 'Equipment of step ' ELSE 'Dependency of step ' END
            || COALESCE((SELECT step_name FROM workflow_step WHERE id = (r->>'step_id')::uuid), ''), 'link', '#/methods/versions/' || v_ver || '?tab=workflow');
    WHEN 'specification' THEN RETURN jsonb_build_object('label', 'Specification for ' || COALESCE((SELECT analyte_name FROM analyte WHERE id = (r->>'analyte_id')::uuid), ''),
        'link', CASE WHEN r->>'requested_test_id' IS NOT NULL THEN '#/samples/' || (SELECT sample_id FROM requested_test WHERE id = (r->>'requested_test_id')::uuid)
                     ELSE '#/quote/' || (SELECT project_version_id FROM quoted_test_configuration WHERE id = (r->>'quoted_line_id')::uuid) END);
    WHEN 'test' THEN RETURN jsonb_build_object('label', 'Test ' || (r->>'test_code') || ' ' || (r->>'test_name'), 'link', '#/methods/tests/' || p_id);
    ELSE RETURN audit_record_ref_slice10(p_table, p_id, r);
    END CASE;
END $$;
ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Admin'));
-- (the Methods canned reasons are demo data: db/seed_010_methods.sql)

SELECT set_config('lims.group_sync', '', true);
COMMIT;
