-- LIMS3 schema, migration 003
-- Lab sites (time zone, holidays, default OOS procedure), Lab Orders, Samples, Requested Tests,
-- Requested Analytes, Rush Decisions and the email Outbox.
-- Rules: quoted-only ordering, analyte trimming keeps the quoted discount %, TAT clock (Day 0, cutoff,
-- business or calendar days, site holidays), rush auto-accept vs intake approval, automatic decline email.

BEGIN;
SET search_path = lims, public;

-------------------------------------------------------------------------------
-- 1. LAB SITES AND HOLIDAYS
-------------------------------------------------------------------------------
CREATE TYPE oos_procedure AS ENUM ('Full Phase I (21 CFR 211)','Check and Acknowledge');

CREATE TABLE lab_site (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_code               text NOT NULL UNIQUE CHECK (site_code ~ '^[A-Z0-9]{2,6}$'),
    site_name               text NOT NULL,
    time_zone               text NOT NULL,      -- IANA name, e.g. America/Los_Angeles
    address                 text,
    default_oos_procedure   oos_procedure NOT NULL DEFAULT 'Check and Acknowledge',
    status                  record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('lab_site');

-- A time zone name must be one PostgreSQL knows
CREATE FUNCTION lab_site_check_tz() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = NEW.time_zone) THEN
        RAISE EXCEPTION 'Unknown time zone "%". Use a name like America/Los_Angeles or America/New_York', NEW.time_zone;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_lab_site_check_tz BEFORE INSERT OR UPDATE OF time_zone ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_check_tz();

CREATE TABLE site_holiday (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         uuid NOT NULL REFERENCES lab_site(id),
    holiday_date    date NOT NULL,
    description     text NOT NULL,
    status          record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX site_holiday_uq ON site_holiday (site_id, holiday_date) WHERE status = 'Active';
CALL make_gxp('site_holiday');

-------------------------------------------------------------------------------
-- 2. TAT CALENDAR FUNCTIONS
-------------------------------------------------------------------------------
CREATE FUNCTION is_working_day(p_site uuid, d date) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT extract(isodow FROM d) < 6
       AND NOT EXISTS (SELECT 1 FROM site_holiday h WHERE h.site_id = p_site AND h.holiday_date = d AND h.status = 'Active')
$$;

CREATE FUNCTION next_working_day(p_site uuid, d date) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE x date := d;
BEGIN
    WHILE NOT is_working_day(p_site, x) LOOP x := x + 1; END LOOP;   -- on or after d
    RETURN x;
END $$;

-- Day 0: the site-local date the clock starts. After the test's cutoff, Day 0 moves to the next day;
-- business-day tests never start on a weekend or site holiday.
CREATE FUNCTION tat_day0(p_site uuid, p_start timestamptz, p_cutoff time, p_unit tat_unit) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE tz text; loc timestamp; d date;
BEGIN
    SELECT time_zone INTO tz FROM lab_site WHERE id = p_site;
    loc := p_start AT TIME ZONE tz;
    d := loc::date;
    IF loc::time > p_cutoff THEN d := d + 1; END IF;
    IF p_unit = 'Business Days' THEN d := next_working_day(p_site, d); END IF;
    RETURN d;
END $$;

CREATE FUNCTION tat_due(p_site uuid, p_day0 date, p_days integer, p_unit tat_unit) RETURNS date LANGUAGE plpgsql STABLE AS $$
DECLARE d date := p_day0; n integer := 0;
BEGIN
    IF p_unit = 'Calendar Days' THEN RETURN p_day0 + p_days; END IF;
    WHILE n < p_days LOOP
        d := d + 1;
        IF is_working_day(p_site, d) THEN n := n + 1; END IF;
    END LOOP;
    RETURN d;
END $$;

-------------------------------------------------------------------------------
-- 3. LAB ORDERS
-------------------------------------------------------------------------------
CREATE SEQUENCE lab_order_seq;
CREATE TYPE submission_channel AS ENUM ('Online','Walk-in','Paper','Phone');
CREATE TYPE lab_order_origin   AS ENUM ('Client Submission','Stability Baseline','Stability Pull');
CREATE TYPE lab_order_status   AS ENUM ('Draft','Submitted','Received','In Testing','Complete','Reported');

CREATE TABLE lab_order (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_code              text NOT NULL UNIQUE DEFAULT 'LO-' || lpad(nextval('lab_order_seq')::text, 6, '0'),
    client_id               uuid NOT NULL REFERENCES client(id),
    site_id                 uuid NOT NULL REFERENCES lab_site(id),
    ordering_contact_id     uuid NOT NULL REFERENCES contact(id),
    submission_channel      submission_channel NOT NULL DEFAULT 'Walk-in',
    origin                  lab_order_origin NOT NULL DEFAULT 'Client Submission',
    po_number               text,
    notes                   text,
    status                  lab_order_status NOT NULL DEFAULT 'Draft',
    submitted_at            timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX lab_order_client_idx ON lab_order (client_id);
CALL make_gxp('lab_order', false);

CREATE FUNCTION lab_order_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' OR NEW.client_id <> OLD.client_id OR NEW.ordering_contact_id <> OLD.ordering_contact_id THEN
        IF NOT COALESCE(client_can_order(NEW.client_id), false) THEN
            RAISE EXCEPTION 'This client is Inactive and cannot place new orders';
        END IF;
        IF NOT contact_can_order(NEW.ordering_contact_id, NEW.client_id) THEN
            RAISE EXCEPTION 'The ordering contact must be an active contact of this client with the Ordering role';
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.client_id <> OLD.client_id AND EXISTS (SELECT 1 FROM sample WHERE lab_order_id = NEW.id) THEN
        RAISE EXCEPTION 'The client cannot be changed once samples are on the order';
    END IF;
    IF NEW.status = 'Submitted' AND NEW.submitted_at IS NULL THEN NEW.submitted_at := clock_timestamp(); END IF;
    RETURN NEW;
END $$;

-------------------------------------------------------------------------------
-- 4. SAMPLES
-------------------------------------------------------------------------------
CREATE TYPE sample_status AS ENUM ('Expected','Logged','Cancelled');

CREATE TABLE sample (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lab_order_id        uuid NOT NULL REFERENCES lab_order(id),
    sample_code         text UNIQUE,                 -- SITE-yymmdd-## assigned at logging
    client_sample_id    text,
    description         text,
    matrix              text,
    product             text,
    lot                 text,
    batch               text,
    quantity_received   numeric(12,3) CHECK (quantity_received >= 0),
    quantity_unit       text,
    number_of_units     integer CHECK (number_of_units > 0),
    condition           text,                         -- e.g. Acceptable, Damaged, Temperature excursion, Short shipped
    receipt_temperature numeric(6,2),
    preservation        text,
    received_at         timestamptz,                  -- physical arrival (chain of custody)
    logged_at           timestamptz,                  -- entered into the system: starts the clock
    logged_by           uuid REFERENCES app_user(id),
    status              sample_status NOT NULL DEFAULT 'Expected',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX sample_order_idx ON sample (lab_order_id);
CALL make_gxp('sample', false);

-- Daily sequence per site for sample codes
CREATE TABLE site_day_counter (
    site_id  uuid NOT NULL REFERENCES lab_site(id),
    day      date NOT NULL,
    last_no  integer NOT NULL,
    PRIMARY KEY (site_id, day)
);

-- After logging, edits to a sample need a Reason for Change; logging fields cannot be altered
CREATE FUNCTION sample_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.logged_at IS NOT NULL THEN
        IF NEW.logged_at IS DISTINCT FROM OLD.logged_at OR NEW.sample_code IS DISTINCT FROM OLD.sample_code
           OR NEW.logged_by IS DISTINCT FROM OLD.logged_by OR NEW.lab_order_id <> OLD.lab_order_id THEN
            RAISE EXCEPTION 'Sample code, logging time and order cannot be changed once a sample is logged';
        END IF;
        IF current_reason() IS NULL AND (NEW.client_sample_id, NEW.description, NEW.matrix, NEW.product, NEW.lot, NEW.batch,
             NEW.quantity_received, NEW.quantity_unit, NEW.number_of_units, NEW.condition, NEW.receipt_temperature,
             NEW.preservation, NEW.received_at, NEW.status)
           IS DISTINCT FROM (OLD.client_sample_id, OLD.description, OLD.matrix, OLD.product, OLD.lot, OLD.batch,
             OLD.quantity_received, OLD.quantity_unit, OLD.number_of_units, OLD.condition, OLD.receipt_temperature,
             OLD.preservation, OLD.received_at, OLD.status) THEN
            RAISE EXCEPTION 'A Reason for Change is required to edit a logged sample';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_sample_rules BEFORE UPDATE ON sample FOR EACH ROW EXECUTE FUNCTION sample_rules();

-------------------------------------------------------------------------------
-- 5. REQUESTED TESTS AND ANALYTES
-------------------------------------------------------------------------------
CREATE TYPE requested_test_status AS ENUM ('Ordered','In Pool','Cancelled');
CREATE TYPE rush_status AS ENUM ('None','Auto-accepted','Pending Approval','Approved','Not Accepted');
CREATE TYPE test_source AS ENUM ('Quote','Client OOS Retest','Lab Investigation Retest');

CREATE TABLE requested_test (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id           uuid NOT NULL REFERENCES sample(id),
    test_id             uuid NOT NULL REFERENCES test(id),
    test_version_id     uuid NOT NULL REFERENCES test_version(id),     -- pinned at ordering
    quoted_line_id      uuid NOT NULL REFERENCES quoted_test_configuration(id),
    source              test_source NOT NULL DEFAULT 'Quote',
    status              requested_test_status NOT NULL DEFAULT 'Ordered',
    special_instructions text,
    rush_tier_id        uuid REFERENCES rush_fee_tier(id),
    rush_status         rush_status NOT NULL DEFAULT 'None',
    rush_requested_at   timestamptz,
    -- derived (recalculated by the database on every change)
    list_price          numeric(12,2) NOT NULL DEFAULT 0,
    price               numeric(12,2) NOT NULL DEFAULT 0,
    rush_fee            numeric(12,2) NOT NULL DEFAULT 0,
    tat_days            integer,
    tat_unit            tat_unit,
    clock_start         timestamptz,
    day0                date,
    due_date            date,
    recalc_at           timestamptz,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE INDEX requested_test_sample_idx ON requested_test (sample_id);
CREATE UNIQUE INDEX requested_test_one_active ON requested_test (sample_id, test_id) WHERE status <> 'Cancelled';
CALL make_gxp('requested_test', false);

CREATE TABLE requested_analyte (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_test_id   uuid NOT NULL REFERENCES requested_test(id),
    analyte_id          uuid NOT NULL REFERENCES analyte(id),
    analyte_price       numeric(12,2) NOT NULL,     -- from the quote's analyte snapshot
    included            boolean NOT NULL DEFAULT true,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (requested_test_id, analyte_id)
);
CALL make_gxp('requested_analyte', false);

-- Price, rush fee, TAT and due date are always recalculated here (never typed)
CREATE FUNCTION requested_test_derive() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER a_requested_test_derive BEFORE INSERT OR UPDATE ON requested_test FOR EACH ROW EXECUTE FUNCTION requested_test_derive();

-- Analyte trimming at order: may remove (or restore) quoted analytes, never add unquoted ones
CREATE FUNCTION requested_analyte_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rt requested_test;
BEGIN
    SELECT * INTO v_rt FROM requested_test WHERE id = NEW.requested_test_id;
    IF TG_OP = 'INSERT' THEN
        IF NOT EXISTS (SELECT 1 FROM quoted_analyte_selection WHERE line_id = v_rt.quoted_line_id AND analyte_id = NEW.analyte_id AND included) THEN
            RAISE EXCEPTION 'That analyte is not on the client''s quote; re-quote or accept list price to add it';
        END IF;
    ELSE
        IF NEW.analyte_id <> OLD.analyte_id OR NEW.analyte_price <> OLD.analyte_price THEN
            RAISE EXCEPTION 'Analyte and price are fixed on a requested analyte';
        END IF;
        IF v_rt.status = 'Cancelled' THEN RAISE EXCEPTION 'The test is cancelled'; END IF;
        IF v_rt.clock_start IS NOT NULL AND current_reason() IS NULL AND NEW.included IS DISTINCT FROM OLD.included THEN
            RAISE EXCEPTION 'A Reason for Change is required to change analytes on a logged sample';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a_requested_analyte_rules BEFORE INSERT OR UPDATE ON requested_analyte FOR EACH ROW EXECUTE FUNCTION requested_analyte_rules();

CREATE FUNCTION requested_analyte_reprice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (SELECT count(*) FROM requested_analyte WHERE requested_test_id = NEW.requested_test_id AND included) = 0 THEN
        RAISE EXCEPTION 'At least one analyte must stay on the test (cancel the test instead)';
    END IF;
    UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = NEW.requested_test_id;
    RETURN NULL;
END $$;
CREATE TRIGGER z_requested_analyte_reprice AFTER UPDATE OF included ON requested_analyte
    FOR EACH ROW WHEN (OLD.included IS DISTINCT FROM NEW.included) EXECUTE FUNCTION requested_analyte_reprice();

-- Order a quoted test on a sample (the only way tests are created)
CREATE FUNCTION order_test(p_sample uuid, p_line uuid, p_rush_tier uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; q quoted_test_configuration; v_ver uuid; v_id uuid; v_mode pricing_mode;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sample not found'; END IF;
    IF s.status = 'Cancelled' THEN RAISE EXCEPTION 'The sample is cancelled'; END IF;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    IF NOT EXISTS (SELECT 1 FROM orderable_lines(o.client_id) ol WHERE ol.line_id = p_line) THEN
        RAISE EXCEPTION 'This test is not on an accepted quote for this client. Quote it, or record list price acceptance, first';
    END IF;
    IF NOT COALESCE(client_can_order(o.client_id), false) THEN
        RAISE EXCEPTION 'This client is Inactive and cannot order';
    END IF;
    SELECT * INTO q FROM quoted_test_configuration WHERE id = p_line;
    SELECT id INTO v_ver FROM test_version WHERE test_id = q.test_id AND status = 'Effective';
    IF v_ver IS NULL THEN
        RAISE EXCEPTION 'This test has no Effective version yet, so it cannot be ordered';
    END IF;
    INSERT INTO requested_test (sample_id, test_id, test_version_id, quoted_line_id, rush_tier_id)
    VALUES (p_sample, q.test_id, v_ver, p_line, p_rush_tier) RETURNING id INTO v_id;
    SELECT pricing_mode INTO v_mode FROM test_catalog_entry WHERE test_id = q.test_id;
    IF v_mode = 'Analyte Selection' THEN
        INSERT INTO requested_analyte (requested_test_id, analyte_id, analyte_price, included)
        SELECT v_id, qs.analyte_id, qs.analyte_price, true FROM quoted_analyte_selection qs WHERE qs.line_id = p_line AND qs.included;
        UPDATE requested_test SET recalc_at = clock_timestamp() WHERE id = v_id;
    END IF;
    RETURN v_id;
END $$;

-- Apply every quoted test of a project to a sample (already-ordered tests are skipped)
CREATE FUNCTION apply_project(p_sample uuid, p_project uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s sample; o lab_order; r record; n integer := 0;
BEGIN
    SELECT * INTO s FROM sample WHERE id = p_sample;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    FOR r IN SELECT ol.line_id, ol.test_id FROM orderable_lines(o.client_id) ol
              JOIN quoted_test_configuration q ON q.id = ol.line_id
              JOIN project_version pv ON pv.id = q.project_version_id
             WHERE pv.project_id = p_project LOOP
        IF NOT EXISTS (SELECT 1 FROM requested_test WHERE sample_id = p_sample AND test_id = r.test_id AND status <> 'Cancelled') THEN
            PERFORM order_test(p_sample, r.line_id); n := n + 1;
        END IF;
    END LOOP;
    IF n = 0 AND NOT EXISTS (SELECT 1 FROM orderable_lines(o.client_id) ol JOIN quoted_test_configuration q ON q.id = ol.line_id
                              JOIN project_version pv ON pv.id = q.project_version_id WHERE pv.project_id = p_project) THEN
        RAISE EXCEPTION 'That project has no accepted, orderable tests for this client';
    END IF;
    RETURN n;
END $$;

-- Log samples: assigns SITE-yymmdd-## codes, starts the clock, moves tests into the pool
CREATE FUNCTION log_samples(p_samples uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
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
               sample_code = v_site.site_code || '-' || to_char(v_day, 'YYMMDD') || '-' || CASE WHEN v_no < 10 THEN '0' || v_no ELSE v_no::text END
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
-- 6. RUSH DECISIONS AND THE OUTBOX
-------------------------------------------------------------------------------
CREATE TYPE rush_decision_type AS ENUM ('Approved','Not Accepted');

CREATE TABLE email_outbox (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    template        text NOT NULL,
    to_address      text,
    to_name         text,
    subject         text NOT NULL,
    body            text NOT NULL,
    lab_order_id    uuid REFERENCES lab_order(id),
    delivery_status text NOT NULL DEFAULT 'Not sent (Sandbox)',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('email_outbox', false);

CREATE TABLE rush_decision (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    requested_test_id   uuid NOT NULL REFERENCES requested_test(id),
    decision            rush_decision_type NOT NULL,
    requested_tier_id   uuid NOT NULL REFERENCES rush_fee_tier(id),
    replacement_tier_id uuid REFERENCES rush_fee_tier(id),     -- Not Accepted: slower tier, or NULL = standard TAT
    reason              text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CONSTRAINT decline_needs_reason CHECK (decision = 'Approved' OR (reason IS NOT NULL AND btrim(reason) <> ''))
);
CALL make_gxp('rush_decision');

CREATE FUNCTION rush_decision_apply() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_rt requested_test; v_old_fee numeric; v_old_due date; n requested_test; s sample; o lab_order; c contact;
        t test; tier_req rush_fee_tier; tier_rep rush_fee_tier; u app_user; si lab_site;
BEGIN
    SELECT * INTO v_rt FROM requested_test WHERE id = NEW.requested_test_id;
    IF v_rt.rush_tier_id IS DISTINCT FROM NEW.requested_tier_id OR v_rt.rush_status NOT IN ('Pending Approval','Auto-accepted','Approved') THEN
        RAISE EXCEPTION 'There is no open rush request for that tier on this test';
    END IF;
    IF NEW.decision = 'Approved' THEN
        IF v_rt.rush_status <> 'Pending Approval' THEN RAISE EXCEPTION 'This rush does not need approval'; END IF;
        UPDATE requested_test SET rush_status = 'Approved' WHERE id = v_rt.id;
        RETURN NULL;
    END IF;
    -- Not Accepted: apply the replacement and send the fixed automatic email
    IF NEW.replacement_tier_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM rush_fee_tier a JOIN rush_fee_tier b ON b.schedule_id = a.schedule_id
         WHERE a.id = NEW.requested_tier_id AND b.id = NEW.replacement_tier_id AND b.rush_tat > a.rush_tat) THEN
        RAISE EXCEPTION 'The replacement must be a slower tier on the same rush schedule, or standard turnaround';
    END IF;
    v_old_fee := v_rt.rush_fee; v_old_due := v_rt.due_date;
    PERFORM set_config('lims.rush_explicit', '1', true);   -- intake sets the status explicitly
    UPDATE requested_test
       SET rush_tier_id = NEW.replacement_tier_id,
           rush_status = CASE WHEN NEW.replacement_tier_id IS NULL THEN 'Not Accepted' ELSE 'Approved' END::rush_status
     WHERE id = v_rt.id RETURNING * INTO n;
    PERFORM set_config('lims.rush_explicit', '', true);
    SELECT * INTO s FROM sample WHERE id = n.sample_id;
    SELECT * INTO o FROM lab_order WHERE id = s.lab_order_id;
    SELECT * INTO c FROM contact WHERE id = o.ordering_contact_id;
    SELECT * INTO t FROM test WHERE id = n.test_id;
    SELECT * INTO tier_req FROM rush_fee_tier WHERE id = NEW.requested_tier_id;
    SELECT * INTO tier_rep FROM rush_fee_tier WHERE id = NEW.replacement_tier_id;
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    SELECT * INTO si FROM lab_site WHERE id = o.site_id;
    INSERT INTO email_outbox (template, to_address, to_name, subject, body, lab_order_id)
    VALUES ('Rush Not Accepted', c.email, c.first_name || ' ' || c.last_name,
        'Rush request not accepted: ' || t.test_name || ' on ' || COALESCE(s.sample_code, s.client_sample_id, 'your sample') || ' (order ' || o.order_code || ')',
        'Dear ' || c.first_name || E',\n\n'
        || 'We are unable to accept the ' || tier_req.tier_name || ' rush you requested for ' || t.test_name
        || ' on sample ' || COALESCE(s.sample_code, s.client_sample_id, '(not yet logged)') || ' (your ID: ' || COALESCE(s.client_sample_id, 'none') || ').' || E'\n\n'
        || 'It has been changed to: ' || COALESCE(tier_rep.tier_name || ' rush', 'standard turnaround') || E'.\n'
        || 'New due date: ' || COALESCE(to_char(n.due_date, 'FMMonth FMDD, YYYY'), 'set when the sample is logged') || E'.\n'
        || 'Rush fee: $' || to_char(v_old_fee, 'FM999990.00') || ' changed to $' || to_char(n.rush_fee, 'FM999990.00') || E'.\n'
        || 'Reason: ' || NEW.reason || E'\n\n'
        || 'Processed by ' || u.full_name || ', ' || si.site_name || E'.\n'
        || 'Please reply to this email or call us if you have any questions.',
        o.id);
    RETURN NULL;
END $$;
CREATE TRIGGER z_rush_decision_apply AFTER INSERT ON rush_decision FOR EACH ROW EXECUTE FUNCTION rush_decision_apply();

-------------------------------------------------------------------------------
-- 7. VIEWS
-------------------------------------------------------------------------------
CREATE VIEW requested_test_view AS
SELECT rt.*, t.test_code, t.test_name, e.pricing_mode, e.rush_schedule_id AS test_rush_schedule_id, s.sample_code, s.client_sample_id, s.lab_order_id, s.logged_at,
       o.order_code, o.site_id, o.client_id, p.project_code, p.project_name,
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

CREATE VIEW sample_view AS
SELECT s.*, (SELECT max(due_date) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS due_date,
       (SELECT count(*) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS test_count,
       (SELECT COALESCE(sum(price + rush_fee), 0) FROM requested_test rt WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled') AS sample_value
  FROM sample s;

CREATE VIEW lab_order_view AS
SELECT o.*, COALESCE(c.display_name, c.legal_name) AS client_name, c.account_status, c.is_gmp_client,
       ls.site_code, ls.site_name, ct.first_name || ' ' || ct.last_name AS ordering_contact, ct.email AS ordering_email,
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

CREATE TRIGGER a_lab_order_rules BEFORE INSERT OR UPDATE ON lab_order FOR EACH ROW EXECUTE FUNCTION lab_order_rules();

COMMIT;
