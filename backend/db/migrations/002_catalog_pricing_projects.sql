-- LIMS3 schema, migration 002
-- Test catalogue with pricing modes, analyte prices, standard TAT, cutoff and rush schedules;
-- Projects (client-specific quoted test packages) with versioned quotes, analyte trimming and rush terms.
-- Vault: Test Catalog Entry, Test-Analyte Availability, Rush Fee Schedule/Tier, Project, Project Version,
--        Quoted Test Configuration, Quoted Analyte Selection, Quote Rush Term.

BEGIN;
SET search_path = lims, public;

CREATE TYPE tat_unit       AS ENUM ('Business Days','Calendar Days');
CREATE TYPE surcharge_type AS ENUM ('Percent','Flat');
CREATE TYPE pricing_mode   AS ENUM ('Base Price Only','Base + Preparation Fee','Analyte Selection');

-------------------------------------------------------------------------------
-- 1. RUSH FEE SCHEDULES
-------------------------------------------------------------------------------
CREATE TABLE rush_fee_schedule (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_name   text NOT NULL CHECK (btrim(schedule_name) <> ''),
    description     text,
    status          master_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX rush_schedule_name_uq ON rush_fee_schedule (lower(schedule_name));
CALL make_gxp('rush_fee_schedule');

CREATE TABLE rush_fee_tier (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id         uuid NOT NULL REFERENCES rush_fee_schedule(id),
    tier_name           text NOT NULL CHECK (btrim(tier_name) <> ''),
    rush_tat            integer NOT NULL CHECK (rush_tat >= 0),
    tat_unit            tat_unit NOT NULL DEFAULT 'Business Days',
    surcharge_type      surcharge_type NOT NULL DEFAULT 'Percent',
    surcharge_value     numeric(12,2) NOT NULL CHECK (surcharge_value >= 0),
    requires_approval   boolean NOT NULL DEFAULT false,      -- default for tests using this schedule
    escalation_hours    numeric(6,2) NOT NULL DEFAULT 2 CHECK (escalation_hours > 0),
    sort_order          integer NOT NULL DEFAULT 0,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX rush_tier_name_uq ON rush_fee_tier (schedule_id, lower(tier_name)) WHERE status = 'Active';
CALL make_gxp('rush_fee_tier');

-------------------------------------------------------------------------------
-- 2. TEST (identity) AND TEST VERSION (scientific content; placeholder until the Workflow Designer)
-------------------------------------------------------------------------------
CREATE SEQUENCE test_code_seq;

CREATE TABLE test (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_code       text NOT NULL UNIQUE DEFAULT 'T-' || lpad(nextval('test_code_seq')::text, 5, '0'),
    test_name       text NOT NULL CHECK (btrim(test_name) <> ''),
    status          master_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX test_name_uq ON test (lower(test_name));
CALL make_gxp('test');

CREATE TYPE test_version_status AS ENUM ('Draft','Effective','Superseded');
CREATE TABLE test_version (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id         uuid NOT NULL REFERENCES test(id),
    version_no      integer NOT NULL,
    status          test_version_status NOT NULL DEFAULT 'Draft',
    effective_from  timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (test_id, version_no)
);
CREATE UNIQUE INDEX test_version_one_effective ON test_version (test_id) WHERE status = 'Effective';
CALL make_gxp('test_version');

-------------------------------------------------------------------------------
-- 3. TEST CATALOG ENTRY (commercial terms; deliberately outside the validated Test Version)
-------------------------------------------------------------------------------
CREATE TABLE test_catalog_entry (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id                     uuid NOT NULL UNIQUE REFERENCES test(id),
    description                 text,
    pricing_mode                pricing_mode NOT NULL DEFAULT 'Base Price Only',
    base_price                  numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_price >= 0),
    prep_fee                    numeric(12,2) NOT NULL DEFAULT 0 CHECK (prep_fee >= 0),
    standard_tat                integer NOT NULL DEFAULT 5 CHECK (standard_tat >= 0),   -- the maximum
    tat_unit                    tat_unit NOT NULL DEFAULT 'Business Days',
    cutoff_time                 time NOT NULL DEFAULT '15:00',                         -- site local time
    rush_schedule_id            uuid REFERENCES rush_fee_schedule(id),
    show_in_public_catalogue    boolean NOT NULL DEFAULT false,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT base_only_has_no_prep_fee CHECK (pricing_mode <> 'Base Price Only' OR prep_fee = 0)
);
CALL make_gxp('test_catalog_entry');

-- Per-test override of a tier's "requires intake approval" default
CREATE TABLE test_rush_approval (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_entry_id    uuid NOT NULL REFERENCES test_catalog_entry(id),
    tier_id             uuid NOT NULL REFERENCES rush_fee_tier(id),
    requires_approval   boolean NOT NULL,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (catalog_entry_id, tier_id)
);
CALL make_gxp('test_rush_approval');

-- Test-Analyte Availability: selectable analytes and their prices (Analyte Selection mode)
CREATE TABLE test_analyte_price (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    catalog_entry_id    uuid NOT NULL REFERENCES test_catalog_entry(id),
    analyte_id          uuid NOT NULL REFERENCES analyte(id),
    price               numeric(12,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX test_analyte_price_uq ON test_analyte_price (catalog_entry_id, analyte_id) WHERE status = 'Active';
CALL make_gxp('test_analyte_price');

-- List Price = base (if set) + prep fee (if set, not in Base Price Only) + selected analyte prices (Analyte Selection only)
-- p_analytes NULL means the full active analyte set.
CREATE FUNCTION catalog_list_price(p_entry uuid, p_analytes uuid[] DEFAULT NULL)
RETURNS numeric LANGUAGE sql STABLE AS $$
    SELECT e.base_price
         + CASE WHEN e.pricing_mode = 'Base Price Only' THEN 0 ELSE e.prep_fee END
         + CASE WHEN e.pricing_mode = 'Analyte Selection' THEN COALESCE((
               SELECT sum(ap.price) FROM test_analyte_price ap
                WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active'
                  AND (p_analytes IS NULL OR ap.analyte_id = ANY(p_analytes))), 0)
           ELSE 0 END
      FROM test_catalog_entry e WHERE e.id = p_entry
$$;

-- Effective approval requirement for a test and tier (override, else schedule default)
CREATE FUNCTION rush_requires_approval(p_entry uuid, p_tier uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT requires_approval FROM test_rush_approval WHERE catalog_entry_id = p_entry AND tier_id = p_tier),
                    (SELECT requires_approval FROM rush_fee_tier WHERE id = p_tier))
$$;

-- The Test Catalogue (downloadable / publishable)
CREATE VIEW test_catalogue AS
SELECT t.id AS test_id, e.id AS catalog_entry_id, t.test_code, t.test_name, t.status AS test_status,
       e.description, e.pricing_mode, e.base_price,
       CASE WHEN e.pricing_mode = 'Base Price Only' THEN 0 ELSE e.prep_fee END AS prep_fee,
       catalog_list_price(e.id) AS list_price,
       (SELECT count(*) FROM test_analyte_price ap WHERE ap.catalog_entry_id = e.id AND ap.status = 'Active') AS analyte_count,
       e.standard_tat, e.tat_unit, e.cutoff_time, s.schedule_name AS rush_schedule, e.show_in_public_catalogue
  FROM test t
  JOIN test_catalog_entry e ON e.test_id = t.id
  LEFT JOIN rush_fee_schedule s ON s.id = e.rush_schedule_id;

-------------------------------------------------------------------------------
-- 4. PROJECTS, VERSIONS, QUOTED LINES
-------------------------------------------------------------------------------
CREATE SEQUENCE project_code_seq;
CREATE TYPE project_origin AS ENUM ('Lab','Portal');

CREATE TABLE project (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_code                text NOT NULL UNIQUE DEFAULT 'PRJ-' || lpad(nextval('project_code_seq')::text, 5, '0'),
    client_id                   uuid NOT NULL REFERENCES client(id),
    project_name                text NOT NULL CHECK (btrim(project_name) <> ''),
    purpose                     text,
    origin                      project_origin NOT NULL DEFAULT 'Lab',
    requested_by_contact_id     uuid REFERENCES contact(id),
    available_to_child_clients  boolean NOT NULL DEFAULT false,
    is_list_price_acceptance    boolean NOT NULL DEFAULT false,
    status                      record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT portal_projects_name_requester CHECK (origin = 'Lab' OR requested_by_contact_id IS NOT NULL)
);
CREATE INDEX project_client_idx ON project (client_id);
CALL make_gxp('project', false);

CREATE TYPE project_version_status AS ENUM
    ('Draft','Submitted for Quote','Quoted','Accepted','Rejected','Expired','Superseded');

CREATE TABLE project_version (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id              uuid NOT NULL REFERENCES project(id),
    version_no              integer NOT NULL,
    status                  project_version_status NOT NULL DEFAULT 'Draft',
    quoted_at               timestamptz,
    valid_until             date,
    accepted_by_contact_id  uuid REFERENCES contact(id),
    accepted_at             timestamptz,
    notes                   text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (project_id, version_no),
    CONSTRAINT accepted_has_acceptor CHECK (status NOT IN ('Accepted','Superseded') OR (accepted_by_contact_id IS NOT NULL AND accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX project_version_one_accepted ON project_version (project_id) WHERE status = 'Accepted';
CALL make_gxp('project_version', false);

CREATE TYPE line_status AS ENUM ('Active','Removed');

-- Quoted Test Configuration: one priced test line on a Project Version
CREATE TABLE quoted_test_configuration (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    test_id             uuid NOT NULL REFERENCES test(id),
    quantity            integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
    list_price          numeric(12,2) NOT NULL DEFAULT 0,          -- derived: never typed
    final_price         numeric(12,2) CHECK (final_price >= 0),   -- manually entered, per sample
    discount_amount     numeric(12,2) GENERATED ALWAYS AS (list_price - final_price) STORED,
    discount_pct        numeric(6,2)  GENERATED ALWAYS AS
                            (CASE WHEN list_price > 0 THEN round((list_price - final_price) / list_price * 100, 2) END) STORED,
    line_total          numeric(14,2) GENERATED ALWAYS AS (final_price * quantity) STORED,
    special_instructions text,
    status              line_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX qtc_one_per_test ON quoted_test_configuration (project_version_id, test_id) WHERE status = 'Active';
CALL make_gxp('quoted_test_configuration', false);

-- Quoted Analyte Selection: analytes on an analyte-priced line (price snapshot at quoting)
CREATE TABLE quoted_analyte_selection (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    line_id         uuid NOT NULL REFERENCES quoted_test_configuration(id),
    analyte_id      uuid NOT NULL REFERENCES analyte(id),
    analyte_price   numeric(12,2) NOT NULL,
    included        boolean NOT NULL DEFAULT true,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (line_id, analyte_id)
);
CALL make_gxp('quoted_analyte_selection', false);

-- Quote Rush Term: per tier rush discount on a version (surcharge snapshot)
CREATE TABLE quote_rush_term (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_version_id  uuid NOT NULL REFERENCES project_version(id),
    tier_id             uuid NOT NULL REFERENCES rush_fee_tier(id),
    schedule_name       text NOT NULL,
    tier_name           text NOT NULL,
    rush_tat            integer NOT NULL,
    tat_unit            tat_unit NOT NULL,
    surcharge_type      surcharge_type NOT NULL,
    surcharge_value     numeric(12,2) NOT NULL,
    discount_pct        numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct BETWEEN 0 AND 100),
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (project_version_id, tier_id)
);
CALL make_gxp('quote_rush_term', false);

-------------------------------------------------------------------------------
-- 5. RULES
-------------------------------------------------------------------------------
CREATE FUNCTION version_is_editable(p_version uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT status IN ('Draft','Submitted for Quote') FROM project_version WHERE id = p_version
$$;

-- Version number assigned automatically; new versions start as Draft
CREATE FUNCTION project_version_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    SELECT COALESCE(max(version_no), 0) + 1 INTO NEW.version_no FROM project_version WHERE project_id = NEW.project_id;
    NEW.status := 'Draft';
    RETURN NEW;
END $$;
CREATE TRIGGER a_project_version_number BEFORE INSERT ON project_version
    FOR EACH ROW EXECUTE FUNCTION project_version_number();

CREATE FUNCTION project_version_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_client uuid;
BEGIN
    IF NEW.status = OLD.status THEN
        IF OLD.status NOT IN ('Draft','Submitted for Quote')
           AND (NEW.valid_until, NEW.notes) IS DISTINCT FROM (OLD.valid_until, OLD.notes) THEN
            RAISE EXCEPTION 'A % project version is locked; create a new version to change it', OLD.status;
        END IF;
        RETURN NEW;
    END IF;
    IF (OLD.status, NEW.status) NOT IN (
        ('Draft','Submitted for Quote'), ('Draft','Quoted'),
        ('Submitted for Quote','Quoted'), ('Submitted for Quote','Rejected'),
        ('Quoted','Accepted'), ('Quoted','Rejected'), ('Quoted','Expired'),
        ('Accepted','Superseded'), ('Accepted','Expired')) THEN
        RAISE EXCEPTION 'Project version cannot move from % to %', OLD.status, NEW.status;
    END IF;
    IF NEW.status = 'Quoted' THEN
        IF NOT EXISTS (SELECT 1 FROM quoted_test_configuration WHERE project_version_id = NEW.id AND status = 'Active') THEN
            RAISE EXCEPTION 'Cannot quote a project version with no tests';
        END IF;
        IF EXISTS (SELECT 1 FROM quoted_test_configuration WHERE project_version_id = NEW.id AND status = 'Active' AND final_price IS NULL) THEN
            RAISE EXCEPTION 'Every test line needs a Final Price before the version can be quoted';
        END IF;
        NEW.quoted_at := clock_timestamp();
    END IF;
    IF NEW.status = 'Accepted' THEN
        IF NEW.valid_until IS NOT NULL AND NEW.valid_until < current_date THEN
            RAISE EXCEPTION 'Quote expired on %; it cannot be accepted', NEW.valid_until;
        END IF;
        SELECT client_id INTO v_client FROM project WHERE id = NEW.project_id;
        IF NEW.accepted_by_contact_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
             WHERE cc.client_id = v_client AND cc.contact_id = NEW.accepted_by_contact_id
               AND cc.status = 'Active' AND ct.status = 'Active') THEN
            RAISE EXCEPTION 'Quote must be accepted by an active contact of this client';
        END IF;
        NEW.accepted_at := COALESCE(NEW.accepted_at, clock_timestamp());
        UPDATE project_version SET status = 'Superseded'
         WHERE project_id = NEW.project_id AND status = 'Accepted' AND id <> NEW.id;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER b_project_version_lifecycle BEFORE UPDATE ON project_version
    FOR EACH ROW EXECUTE FUNCTION project_version_lifecycle();

-- Line rules: locked once quoted; list price always derived (snapshot), never typed
CREATE FUNCTION qtc_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entry test_catalog_entry; v_lp_accept boolean;
BEGIN
    IF NOT version_is_editable(NEW.project_version_id) THEN
        RAISE EXCEPTION 'Test lines are locked once a version is quoted; create a new version';
    END IF;
    SELECT p.is_list_price_acceptance INTO v_lp_accept
      FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = NEW.project_version_id;
    SELECT * INTO v_entry FROM test_catalog_entry WHERE test_id = NEW.test_id;
    IF TG_OP = 'INSERT' THEN
        IF v_entry.id IS NULL OR NOT EXISTS (SELECT 1 FROM test WHERE id = NEW.test_id AND status = 'Active') THEN
            RAISE EXCEPTION 'Test is retired or has no catalogue pricing; it cannot be quoted';
        END IF;
        NEW.list_price := catalog_list_price(v_entry.id);   -- full analyte set; trimmed via selections
    ELSE
        IF NEW.test_id <> OLD.test_id THEN
            RAISE EXCEPTION 'The test on a line cannot be changed; remove the line and add a new one';
        END IF;
        IF v_entry.pricing_mode = 'Analyte Selection' THEN
            NEW.list_price := v_entry.base_price + v_entry.prep_fee
                + COALESCE((SELECT sum(analyte_price) FROM quoted_analyte_selection WHERE line_id = NEW.id AND included), 0);
        ELSE
            NEW.list_price := OLD.list_price;
        END IF;
    END IF;
    IF v_lp_accept THEN
        NEW.final_price := NEW.list_price;     -- list-price acceptance: never discounted
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_qtc_rules BEFORE INSERT OR UPDATE ON quoted_test_configuration
    FOR EACH ROW EXECUTE FUNCTION qtc_rules();

-- After a line is added: snapshot analyte selections and create rush terms for its schedule
CREATE FUNCTION qtc_after_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entry test_catalog_entry;
BEGIN
    SELECT * INTO v_entry FROM test_catalog_entry WHERE test_id = NEW.test_id;
    IF v_entry.pricing_mode = 'Analyte Selection' THEN
        INSERT INTO quoted_analyte_selection (line_id, analyte_id, analyte_price, included)
        SELECT NEW.id, ap.analyte_id, ap.price, true
          FROM test_analyte_price ap WHERE ap.catalog_entry_id = v_entry.id AND ap.status = 'Active';
    END IF;
    IF v_entry.rush_schedule_id IS NOT NULL THEN
        INSERT INTO quote_rush_term (project_version_id, tier_id, schedule_name, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value)
        SELECT NEW.project_version_id, rt.id, s.schedule_name, rt.tier_name, rt.rush_tat, rt.tat_unit, rt.surcharge_type, rt.surcharge_value
          FROM rush_fee_tier rt JOIN rush_fee_schedule s ON s.id = rt.schedule_id
         WHERE rt.schedule_id = v_entry.rush_schedule_id AND rt.status = 'Active'
        ON CONFLICT (project_version_id, tier_id) DO NOTHING;
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_qtc_after_insert AFTER INSERT ON quoted_test_configuration
    FOR EACH ROW EXECUTE FUNCTION qtc_after_insert();

-- Removing or restoring an analyte: list price recalculates, the negotiated discount % is kept
CREATE FUNCTION qas_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT version_is_editable((SELECT project_version_id FROM quoted_test_configuration WHERE id = NEW.line_id)) THEN
        RAISE EXCEPTION 'Analyte selections are locked once a version is quoted';
    END IF;
    IF NEW.analyte_price <> OLD.analyte_price OR NEW.analyte_id <> OLD.analyte_id OR NEW.line_id <> OLD.line_id THEN
        RAISE EXCEPTION 'Analyte price and analyte are fixed on a quote line';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_qas_lock BEFORE UPDATE ON quoted_analyte_selection FOR EACH ROW EXECUTE FUNCTION qas_lock();

CREATE FUNCTION qas_reprice() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_line quoted_test_configuration; v_entry test_catalog_entry; v_new_list numeric;
BEGIN
    SELECT * INTO v_line FROM quoted_test_configuration WHERE id = NEW.line_id;
    SELECT * INTO v_entry FROM test_catalog_entry WHERE test_id = v_line.test_id;
    v_new_list := v_entry.base_price + v_entry.prep_fee
        + COALESCE((SELECT sum(analyte_price) FROM quoted_analyte_selection WHERE line_id = NEW.line_id AND included), 0);
    -- the line trigger recalculates list_price from the selections; final keeps the discount %
    UPDATE quoted_test_configuration
       SET final_price = CASE WHEN v_line.final_price IS NULL OR v_line.list_price = 0 THEN v_line.final_price
                              ELSE round(v_new_list * v_line.final_price / v_line.list_price, 2) END,
           special_instructions = special_instructions
     WHERE id = NEW.line_id;
    RETURN NULL;
END $$;
CREATE TRIGGER z_qas_reprice AFTER UPDATE OF included ON quoted_analyte_selection
    FOR EACH ROW WHEN (OLD.included IS DISTINCT FROM NEW.included) EXECUTE FUNCTION qas_reprice();

CREATE FUNCTION qrt_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT version_is_editable(NEW.project_version_id) THEN
        RAISE EXCEPTION 'Rush terms are locked once a version is quoted';
    END IF;
    IF (NEW.surcharge_type, NEW.surcharge_value, NEW.tier_id) IS DISTINCT FROM (OLD.surcharge_type, OLD.surcharge_value, OLD.tier_id) THEN
        RAISE EXCEPTION 'Rush surcharges are copied from the schedule and cannot be edited on a quote; change the discount instead';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_qrt_rules BEFORE UPDATE ON quote_rush_term FOR EACH ROW EXECUTE FUNCTION qrt_rules();

-- Start a new Draft version by copying the latest one (re-quote); list prices refresh from the catalogue
CREATE FUNCTION new_project_version(p_project uuid) RETURNS uuid LANGUAGE plpgsql AS $$
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
        END LOOP;
        UPDATE quote_rush_term n SET discount_pct = o.discount_pct
          FROM quote_rush_term o WHERE n.project_version_id = v_new AND o.project_version_id = v_prev AND o.tier_id = n.tier_id;
    END IF;
    RETURN v_new;
END $$;

-------------------------------------------------------------------------------
-- 6. WHAT A CLIENT MAY ORDER, AND PRICING REVIEW
-------------------------------------------------------------------------------
CREATE FUNCTION orderable_lines(p_client uuid)
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
     WHERE p.status = 'Active'
       AND (p.client_id = p_client OR (p.available_to_child_clients AND p.client_id IN (SELECT id FROM anc)))
$$;

CREATE VIEW quote_line_review AS
SELECT l.id AS line_id, pv.id AS project_version_id, p.project_code, pv.version_no, pv.status AS version_status,
       t.test_code, t.test_name, e.pricing_mode, l.quantity, l.list_price, l.final_price,
       l.discount_amount, l.discount_pct, l.line_total, l.special_instructions,
       (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = l.id) AS analytes_total,
       (SELECT count(*) FROM quoted_analyte_selection s WHERE s.line_id = l.id AND s.included) AS analytes_included,
       e.standard_tat, e.tat_unit, rs.schedule_name AS rush_schedule,
       CASE
         WHEN l.final_price IS NULL        THEN 'Missing final price'
         WHEN l.final_price > l.list_price THEN 'Final price above list price'
         WHEN l.discount_pct >= 50         THEN 'Discount of 50% or more'
         WHEN l.final_price = 0            THEN 'Zero price'
       END AS issue
  FROM quoted_test_configuration l
  JOIN project_version pv ON pv.id = l.project_version_id
  JOIN project p ON p.id = pv.project_id
  JOIN test t ON t.id = l.test_id
  JOIN test_catalog_entry e ON e.test_id = t.id
  LEFT JOIN rush_fee_schedule rs ON rs.id = e.rush_schedule_id
 WHERE l.status = 'Active';

COMMIT;
