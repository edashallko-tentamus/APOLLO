-- LIMS3 schema, migration 004
-- Administrators and per-user lab access, the controlled Matrix list, per-test TAT override,
-- the SITEyymmdd### sample ID format, and record references for the per-page audit trail.
-- Rules: lab data can only be written by users assigned to that lab; only administrators change
-- sites, holidays, matrices and lab assignments; a sample's matrix must come from the Matrix list;
-- overriding a test's TAT always needs a Reason for Change and never changes its price.

BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. ADMINISTRATORS AND LAB ACCESS
-------------------------------------------------------------------------------
-- Interim admin flag until the Roles and Permissions module replaces it (set directly, not from the screens)
ALTER TABLE app_user ADD COLUMN is_admin boolean NOT NULL DEFAULT false;

CREATE FUNCTION current_user_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin FROM app_user WHERE id = current_app_user()), false)
$$;

CREATE FUNCTION require_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'Only an administrator can change %', replace(TG_TABLE_NAME, '_', ' ');
    END IF;
    RETURN NEW;
END $$;

CREATE TABLE user_site_access (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL REFERENCES app_user(id),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (user_id, site_id)
);
CALL make_gxp('user_site_access');

CREATE TRIGGER a_admin_only BEFORE INSERT OR UPDATE ON user_site_access FOR EACH ROW EXECUTE FUNCTION require_admin();
CREATE TRIGGER a_admin_only BEFORE INSERT OR UPDATE ON lab_site FOR EACH ROW EXECUTE FUNCTION require_admin();
CREATE TRIGGER a_admin_only BEFORE INSERT OR UPDATE ON site_holiday FOR EACH ROW EXECUTE FUNCTION require_admin();

-- Whoever creates a site is assigned to it
CREATE FUNCTION lab_site_grant_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO user_site_access (user_id, site_id) VALUES (current_app_user(), NEW.id) ON CONFLICT (user_id, site_id) DO NOTHING;
    RETURN NULL;
END $$;
CREATE TRIGGER z_lab_site_grant_creator AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_grant_creator();

CREATE FUNCTION user_can_access_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM user_site_access a WHERE a.user_id = p_user AND a.site_id = p_site AND a.status = 'Active')
$$;

CREATE FUNCTION assert_site_access(p_site uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF p_site IS NOT NULL AND NOT user_can_access_site(current_app_user(), p_site) THEN
        RAISE EXCEPTION 'You do not have access to lab %. Ask an administrator to assign you to it.',
            (SELECT site_code FROM lab_site WHERE id = p_site);
    END IF;
END $$;

-- Lab orders, samples and requested tests can only be written by users assigned to the order's lab
CREATE FUNCTION lab_order_site_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_site_access(NEW.site_id);
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN PERFORM assert_site_access(OLD.site_id); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a0_site_access BEFORE INSERT OR UPDATE ON lab_order FOR EACH ROW EXECUTE FUNCTION lab_order_site_access();

CREATE FUNCTION sample_site_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_site_access((SELECT site_id FROM lab_order WHERE id = NEW.lab_order_id));
    RETURN NEW;
END $$;
CREATE TRIGGER a0_site_access BEFORE INSERT OR UPDATE ON sample FOR EACH ROW EXECUTE FUNCTION sample_site_access();

CREATE FUNCTION requested_test_site_access() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    PERFORM assert_site_access((SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id));
    RETURN NEW;
END $$;
CREATE TRIGGER a0_site_access BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_site_access();

-------------------------------------------------------------------------------
-- 2. CONTROLLED MATRIX LIST
-------------------------------------------------------------------------------
CREATE TABLE matrix (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    matrix_name     text NOT NULL CHECK (btrim(matrix_name) <> ''),
    description     text,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX matrix_name_uq ON matrix (lower(matrix_name));
CALL make_gxp('matrix');
CREATE TRIGGER a_admin_only BEFORE INSERT OR UPDATE ON matrix FOR EACH ROW EXECUTE FUNCTION require_admin();

-- Samples store the matrix name, so a matrix in use cannot be renamed (retire it and add a new one)
CREATE FUNCTION matrix_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.matrix_name := btrim(NEW.matrix_name);
    IF TG_OP = 'UPDATE' AND NEW.matrix_name <> OLD.matrix_name AND lower(NEW.matrix_name) <> lower(OLD.matrix_name)
       AND EXISTS (SELECT 1 FROM sample WHERE lower(matrix) = lower(OLD.matrix_name)) THEN
        RAISE EXCEPTION 'Matrix "%" is used on samples and cannot be renamed. Set it Inactive and add the new name instead.', OLD.matrix_name;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_matrix_rules BEFORE INSERT OR UPDATE ON matrix FOR EACH ROW EXECUTE FUNCTION matrix_rules();

-- A new or changed sample matrix must be an Active entry on the list (stored with the list's spelling)
CREATE FUNCTION sample_matrix_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
    IF NEW.matrix IS NOT NULL AND btrim(NEW.matrix) = '' THEN NEW.matrix := NULL; END IF;
    IF NEW.matrix IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.matrix IS DISTINCT FROM OLD.matrix) THEN
        SELECT matrix_name INTO v FROM matrix WHERE lower(matrix_name) = lower(btrim(NEW.matrix)) AND status = 'Active';
        IF v IS NULL THEN
            RAISE EXCEPTION 'Matrix "%" is not on the Matrix list. Pick one from the list, or ask an administrator to add it.', NEW.matrix;
        END IF;
        NEW.matrix := v;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_matrix BEFORE INSERT OR UPDATE OF matrix ON sample FOR EACH ROW EXECUTE FUNCTION sample_matrix_check();

-------------------------------------------------------------------------------
-- 3. TAT OVERRIDE PER REQUESTED TEST
-------------------------------------------------------------------------------
ALTER TABLE requested_test ADD COLUMN tat_override integer CHECK (tat_override >= 0);

-- Same as migration 003, plus: an override replaces the calculated TAT (standard or rush tier, same unit),
-- always needs a Reason for Change, and never changes the price or rush fee.
CREATE OR REPLACE FUNCTION requested_test_derive() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    q quoted_test_configuration; e test_catalog_entry; s sample; o lab_order; rt quote_rush_term;
    v_list numeric; v_active boolean; v_needs boolean;
BEGIN
    SELECT * INTO q FROM quoted_test_configuration WHERE id = NEW.quoted_line_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = NEW.test_id;
    SELECT * INTO s FROM sample WHERE id = NEW.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.test_id <> OLD.test_id OR NEW.quoted_line_id <> OLD.quoted_line_id OR NEW.sample_id <> OLD.sample_id
           OR NEW.test_version_id <> OLD.test_version_id THEN
            RAISE EXCEPTION 'Test, sample, quote line and test version are fixed on a requested test';
        END IF;
        IF OLD.status = 'Cancelled' AND NEW.status <> 'Cancelled' THEN
            RAISE EXCEPTION 'A cancelled test cannot be reinstated; order it again';
        END IF;
        -- post-logging edits by people need a reason (derived recalculations do not)
        IF OLD.clock_start IS NOT NULL AND current_reason() IS NULL
           AND (NEW.status, NEW.rush_tier_id, NEW.special_instructions) IS DISTINCT FROM (OLD.status, OLD.rush_tier_id, OLD.special_instructions) THEN
            RAISE EXCEPTION 'A Reason for Change is required to change a test on a logged sample';
        END IF;
    END IF;
    IF NEW.tat_override IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.tat_override END) AND current_reason() IS NULL THEN
        RAISE EXCEPTION 'A Reason for Change is required to override the turnaround (TAT)';
    END IF;

    -- Rush: a change of tier re-evaluates approval unless the caller set the status explicitly (intake decisions)
    IF TG_OP = 'INSERT' OR (NEW.rush_tier_id IS DISTINCT FROM OLD.rush_tier_id AND COALESCE(current_setting('lims.rush_explicit', true), '') <> '1') THEN
        IF NEW.rush_tier_id IS NULL THEN
            NEW.rush_status := 'None'; NEW.rush_requested_at := NULL;
        ELSE
            SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
            IF rt.id IS NULL OR e.rush_schedule_id IS DISTINCT FROM (SELECT schedule_id FROM rush_fee_tier WHERE id = NEW.rush_tier_id) THEN
                RAISE EXCEPTION 'That rush tier is not available for this test on the client''s quote';
            END IF;
            v_needs := rush_requires_approval(e.id, NEW.rush_tier_id);
            NEW.rush_status := CASE WHEN v_needs THEN 'Pending Approval' ELSE 'Auto-accepted' END::rush_status;
            NEW.rush_requested_at := clock_timestamp();
        END IF;
    END IF;

    -- Price: trimmed list price at the quoted discount %
    IF e.pricing_mode = 'Analyte Selection' AND TG_OP = 'UPDATE' THEN
        v_list := e.base_price + e.prep_fee
                + COALESCE((SELECT sum(analyte_price) FROM requested_analyte WHERE requested_test_id = NEW.id AND included), 0);
    ELSE
        v_list := q.list_price;
    END IF;
    NEW.list_price := v_list;
    NEW.price := CASE WHEN q.list_price = 0 THEN q.final_price ELSE round(v_list * q.final_price / q.list_price, 2) END;
    IF NEW.status = 'Cancelled' THEN NEW.price := 0; END IF;

    -- Rush fee and turnaround
    v_active := NEW.rush_tier_id IS NOT NULL AND NEW.rush_status IN ('Auto-accepted','Approved') AND NEW.status <> 'Cancelled';
    IF v_active THEN
        SELECT * INTO rt FROM quote_rush_term WHERE project_version_id = q.project_version_id AND tier_id = NEW.rush_tier_id;
        NEW.rush_fee := round(CASE WHEN rt.surcharge_type = 'Flat' THEN rt.surcharge_value
                                   ELSE NEW.price * rt.surcharge_value / 100 END * (1 - rt.discount_pct / 100), 2);
        NEW.tat_days := rt.rush_tat; NEW.tat_unit := rt.tat_unit;
    ELSE
        NEW.rush_fee := 0;
        NEW.tat_days := e.standard_tat; NEW.tat_unit := e.tat_unit;
    END IF;
    IF NEW.tat_override IS NOT NULL THEN NEW.tat_days := NEW.tat_override; END IF;

    -- Clock: starts when the sample is logged (or when the test is added to an already logged sample)
    IF s.logged_at IS NOT NULL AND NEW.clock_start IS NULL THEN
        NEW.clock_start := GREATEST(s.logged_at, COALESCE(NEW.created_at, clock_timestamp()));
        IF NEW.status = 'Ordered' THEN NEW.status := 'In Pool'; END IF;
    END IF;
    IF NEW.clock_start IS NOT NULL THEN
        NEW.day0 := tat_day0(o.site_id, NEW.clock_start, e.cutoff_time, NEW.tat_unit);
        NEW.due_date := tat_due(o.site_id, NEW.day0, NEW.tat_days, NEW.tat_unit);
    END IF;
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 4. SAMPLE ID FORMAT: SITEyymmdd### (e.g. CFL261012001); IDs already assigned never change
-------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_samples(p_samples uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s record; v_site lab_site; v_now timestamptz := clock_timestamp(); v_day date; v_no integer; n integer := 0; v_order uuid;
BEGIN
    FOR s IN SELECT sa.*, o.site_id, o.status AS order_status FROM sample sa JOIN lab_order o ON o.id = sa.lab_order_id
              WHERE sa.id = ANY(p_samples) AND sa.logged_at IS NULL AND sa.status = 'Expected' ORDER BY sa.created_at, sa.id LOOP
        IF NOT EXISTS (SELECT 1 FROM requested_test WHERE sample_id = s.id AND status <> 'Cancelled') THEN
            RAISE EXCEPTION 'Sample "%" has no tests ordered; apply a project or add a test before logging it', COALESCE(s.client_sample_id, s.description, 'unnamed');
        END IF;
        SELECT * INTO v_site FROM lab_site WHERE id = s.site_id;
        v_day := (v_now AT TIME ZONE v_site.time_zone)::date;
        INSERT INTO site_day_counter (site_id, day, last_no) VALUES (s.site_id, v_day, 1)
        ON CONFLICT (site_id, day) DO UPDATE SET last_no = site_day_counter.last_no + 1 RETURNING last_no INTO v_no;
        UPDATE sample SET logged_at = v_now, logged_by = current_app_user(), status = 'Logged',
               sample_code = v_site.site_code || to_char(v_day, 'YYMMDD') || CASE WHEN v_no < 1000 THEN lpad(v_no::text, 3, '0') ELSE v_no::text END
         WHERE id = s.id;
        UPDATE requested_test SET recalc_at = v_now WHERE sample_id = s.id AND status <> 'Cancelled';
        v_order := s.lab_order_id; n := n + 1;
        UPDATE lab_order SET status = 'Submitted' WHERE id = s.lab_order_id AND status = 'Draft';
        UPDATE lab_order SET status = 'Received' WHERE id = s.lab_order_id AND status = 'Submitted'
           AND NOT EXISTS (SELECT 1 FROM sample WHERE lab_order_id = s.lab_order_id AND status = 'Expected');
    END LOOP;
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 5. VIEWS (recreated so requested_test_view includes tat_override; otherwise unchanged)
-------------------------------------------------------------------------------
DROP VIEW lab_order_view;
DROP VIEW requested_test_view;

CREATE VIEW requested_test_view AS
SELECT rt.*, t.test_code, t.test_name, e.pricing_mode, e.rush_schedule_id AS test_rush_schedule_id, s.sample_code, s.client_sample_id, s.lab_order_id, s.logged_at,
       o.order_code, o.site_id, o.client_id, p.project_code, p.project_name, pv.id AS project_version_id, pv.version_no AS project_version_no, p.id AS project_id,
       rft.tier_name AS rush_tier_name, rfs.schedule_name AS rush_schedule,
       (SELECT count(*) FROM requested_analyte ra WHERE ra.requested_test_id = rt.id) AS analytes_total,
       (SELECT count(*) FROM requested_analyte ra WHERE ra.requested_test_id = rt.id AND ra.included) AS analytes_included,
       CASE WHEN rt.rush_status = 'Pending Approval'
            THEN rt.rush_requested_at + make_interval(secs => (rft.escalation_hours * 3600)::double precision) END AS approval_due_at
  FROM requested_test rt
  JOIN test t ON t.id = rt.test_id
  JOIN test_catalog_entry e ON e.test_id = t.id
  JOIN sample s ON s.id = rt.sample_id
  JOIN lab_order o ON o.id = s.lab_order_id
  JOIN quoted_test_configuration q ON q.id = rt.quoted_line_id
  JOIN project_version pv ON pv.id = q.project_version_id
  JOIN project p ON p.id = pv.project_id
  LEFT JOIN rush_fee_tier rft ON rft.id = rt.rush_tier_id
  LEFT JOIN rush_fee_schedule rfs ON rfs.id = rft.schedule_id;

CREATE VIEW lab_order_view AS
SELECT o.*, COALESCE(c.display_name, c.legal_name) AS client_name, c.account_status, c.is_gmp_client, c.client_code,
       ls.site_code, ls.site_name, ct.first_name || ' ' || ct.last_name AS ordering_contact, ct.email AS ordering_email, ct.contact_code AS ordering_contact_code,
       (SELECT count(*) FROM sample s WHERE s.lab_order_id = o.id AND s.status <> 'Cancelled') AS sample_count,
       (SELECT count(*) FROM sample s WHERE s.lab_order_id = o.id AND s.status = 'Logged') AS logged_count,
       (SELECT max(due_date) FROM sample_view sv WHERE sv.lab_order_id = o.id AND sv.status <> 'Cancelled') AS due_date,
       (SELECT COALESCE(sum(sample_value), 0) FROM sample_view sv WHERE sv.lab_order_id = o.id AND sv.status <> 'Cancelled') AS order_value,
       (SELECT count(*) FROM requested_test_view r WHERE r.lab_order_id = o.id AND r.rush_status = 'Pending Approval') AS rush_pending,
       (SELECT count(*) FROM requested_test_view r WHERE r.lab_order_id = o.id AND r.rush_status IN ('Auto-accepted','Approved') AND r.status <> 'Cancelled') AS rush_active,
       client_can_release_report(o.client_id) AS reports_releasable
  FROM lab_order o
  JOIN client c ON c.id = o.client_id
  JOIN lab_site ls ON ls.id = o.site_id
  JOIN contact ct ON ct.id = o.ordering_contact_id;

-------------------------------------------------------------------------------
-- 6. AUDIT TRAIL REFERENCES: a readable label and a link to the record's page for every audit entry
-------------------------------------------------------------------------------
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE lbl text; lnk text;
BEGIN
    CASE p_table
    WHEN 'lab_order' THEN lbl := r->>'order_code'; lnk := '#/orders/' || p_id;
    WHEN 'sample' THEN lbl := COALESCE(r->>'sample_code', r->>'client_sample_id', 'Sample (not logged)'); lnk := '#/samples/' || p_id;
    WHEN 'requested_test' THEN
        SELECT t.test_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'sample') INTO lbl
          FROM test t, sample s WHERE t.id = (r->>'test_id')::uuid AND s.id = (r->>'sample_id')::uuid;
        lnk := '#/samples/' || (r->>'sample_id');
    WHEN 'requested_analyte' THEN
        SELECT a.analyte_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'sample'), '#/samples/' || s.id INTO lbl, lnk
          FROM analyte a, requested_test rt JOIN sample s ON s.id = rt.sample_id
         WHERE a.id = (r->>'analyte_id')::uuid AND rt.id = (r->>'requested_test_id')::uuid;
    WHEN 'rush_decision' THEN
        SELECT 'Rush ' || lower(r->>'decision') || ': ' || t.test_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'sample'), '#/samples/' || s.id INTO lbl, lnk
          FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN sample s ON s.id = rt.sample_id WHERE rt.id = (r->>'requested_test_id')::uuid;
    WHEN 'email_outbox' THEN
        lbl := 'Email: ' || (r->>'subject'); lnk := CASE WHEN r->>'lab_order_id' IS NOT NULL THEN '#/orders/' || (r->>'lab_order_id') END;
    WHEN 'client' THEN lbl := (r->>'client_code') || ' ' || (r->>'legal_name'); lnk := '#/clients/' || p_id;
    WHEN 'client_contact' THEN
        SELECT c.client_code || ' contact ' || ct.first_name || ' ' || ct.last_name INTO lbl
          FROM client c, contact ct WHERE c.id = (r->>'client_id')::uuid AND ct.id = (r->>'contact_id')::uuid;
        lnk := '#/clients/' || (r->>'client_id');
    WHEN 'contact' THEN lbl := (r->>'contact_code') || ' ' || (r->>'first_name') || ' ' || (r->>'last_name'); lnk := '#/contacts?find=' || (r->>'contact_code');
    WHEN 'analyte' THEN lbl := (r->>'analyte_code') || ' ' || (r->>'analyte_name'); lnk := '#/analytes?find=' || (r->>'analyte_code');
    WHEN 'project' THEN lbl := (r->>'project_code') || ' ' || (r->>'project_name'); lnk := '#/projects/' || p_id;
    WHEN 'project_version' THEN
        SELECT p.project_code || ' v' || (r->>'version_no') INTO lbl FROM project p WHERE p.id = (r->>'project_id')::uuid;
        lnk := '#/quote/' || p_id;
    WHEN 'quoted_test_configuration' THEN
        SELECT p.project_code || ' v' || pv.version_no || ': ' || t.test_name INTO lbl
          FROM project_version pv JOIN project p ON p.id = pv.project_id, test t
         WHERE pv.id = (r->>'project_version_id')::uuid AND t.id = (r->>'test_id')::uuid;
        lnk := '#/quote/' || (r->>'project_version_id');
    WHEN 'quote_rush_term' THEN
        SELECT p.project_code || ' v' || pv.version_no || ': rush ' || COALESCE(ft.tier_name, '') INTO lbl
          FROM project_version pv JOIN project p ON p.id = pv.project_id LEFT JOIN rush_fee_tier ft ON ft.id = (r->>'tier_id')::uuid
         WHERE pv.id = (r->>'project_version_id')::uuid;
        lnk := '#/quote/' || (r->>'project_version_id');
    WHEN 'quoted_analyte_selection' THEN
        SELECT p.project_code || ' v' || pv.version_no || ': ' || a.analyte_name, '#/quote/' || pv.id INTO lbl, lnk
          FROM quoted_test_configuration q JOIN project_version pv ON pv.id = q.project_version_id JOIN project p ON p.id = pv.project_id, analyte a
         WHERE q.id = (r->>'line_id')::uuid AND a.id = (r->>'analyte_id')::uuid;
    WHEN 'test' THEN lbl := (r->>'test_code') || ' ' || (r->>'test_name'); lnk := '#/catalog/' || p_id;
    WHEN 'test_version' THEN
        SELECT t.test_code || ' version ' || (r->>'version_no') INTO lbl FROM test t WHERE t.id = (r->>'test_id')::uuid;
        lnk := '#/catalog/' || (r->>'test_id');
    WHEN 'test_catalog_entry' THEN
        SELECT t.test_code || ' pricing and turnaround' INTO lbl FROM test t WHERE t.id = (r->>'test_id')::uuid;
        lnk := '#/catalog/' || (r->>'test_id');
    WHEN 'test_analyte_price', 'test_rush_approval' THEN
        SELECT t.test_code || CASE WHEN p_table = 'test_analyte_price' THEN ' analyte price' ELSE ' rush approval' END, '#/catalog/' || t.id INTO lbl, lnk
          FROM test_catalog_entry e JOIN test t ON t.id = e.test_id WHERE e.id = (r->>'catalog_entry_id')::uuid;
    WHEN 'rush_fee_schedule' THEN lbl := r->>'schedule_name'; lnk := '#/rush/' || p_id;
    WHEN 'rush_fee_tier' THEN
        SELECT s.schedule_name || ': ' || (r->>'tier_name') INTO lbl FROM rush_fee_schedule s WHERE s.id = (r->>'schedule_id')::uuid;
        lnk := '#/rush/' || (r->>'schedule_id');
    WHEN 'lab_site' THEN lbl := 'Lab ' || (r->>'site_code'); lnk := '#/admin/sites/' || p_id;
    WHEN 'site_holiday' THEN
        SELECT s.site_code || ' holiday ' || (r->>'holiday_date') INTO lbl FROM lab_site s WHERE s.id = (r->>'site_id')::uuid;
        lnk := '#/admin/sites/' || (r->>'site_id');
    WHEN 'matrix' THEN lbl := 'Matrix ' || (r->>'matrix_name'); lnk := '#/admin/matrices?find=' || (r->>'matrix_name');
    WHEN 'user_site_access' THEN
        SELECT u.full_name || ' in ' || s.site_code INTO lbl FROM app_user u, lab_site s WHERE u.id = (r->>'user_id')::uuid AND s.id = (r->>'site_id')::uuid;
        lnk := '#/admin/users';
    ELSE lbl := NULL;
    END CASE;
    RETURN jsonb_build_object('label', COALESCE(lbl, replace(p_table, '_', ' ')), 'link', lnk);
END $$;

COMMIT;
