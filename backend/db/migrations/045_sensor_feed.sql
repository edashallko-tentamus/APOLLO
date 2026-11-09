-- 045: the iMonnit sensor feed into the logbooks (Claude Code, 2026-10-19; version 0.25.0). Vault: Proposal - iMonnit
-- Sensor Feed for Logbooks and Workflows. Alex, 2026-10-19: "Hourly with your suggestion" (an entry per sensor per
-- hour, plus one per spell outside the limits and one per period with no data), then "go" to build it on the pretend
-- iMonnit service until the production server and a licence exist.
-- How it is built:
--  - A sensor link says which iMonnit sensor (and which of its values: temperature or humidity) feeds which logbook
--    field for which piece of equipment. Linked by someone with sensors.configure (signed), then approved by QA
--    (logbook.review, signed, not whoever linked it); it feeds only from its approval on. Retired, never deleted.
--  - The connection (one per lab: the pretend service in the Sandbox, iMonnit's cloud or our own iMonnit Enterprise)
--    is set by a system administrator. The key is kept on the server, never here.
--  - Readings are kept as received (sensor_reading: never changed or deleted), each once.
--  - The automated account "sensor.feed" records the entries. It cannot sign in, is in no group, and has
--    logbook.record only while the feed runs (lims.sensor_feed); its signature says "Automated sensor feed".
--  - sensor_feed_refresh() turns the readings into entries, in the database: one per lab hour (minimum, maximum,
--    average, number of readings; it fails when a reading is outside the limits and points to the excursion), one per
--    spell outside the limits (every reading in it, the peak; a person gives the reason) and one per period with no
--    reading for longer than the link's gap (a person gives the reason). Late readings correct the entries (the hour
--    goes back to QA if it was approved); a no-data period that late readings fill is voided by the feed.
--  - QC Review: an excursion or a no-data period flags every batch step that used the equipment during it (an
--    incubator load overlapping it included), through equipment_failure_view, now exact for sensor entries (from the
--    spell's first reading to the first one back inside). Hourly entries flag nothing themselves.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 045: the sensor feed', true);

-------------------------------------------------------------------------------
-- 0. PERMISSION, THE AUTOMATED ACCOUNT, WHAT IT MAY DO AND HOW IT SIGNS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('sensors.configure', 'Logbooks', 'Sensors', 'Link sensors (iMonnit) to logbooks and equipment, retire links, read the sensors now (QA approves each link)', false, 103);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{sensors.configure}'), ('Lab Supervisor', '{sensors.configure}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

INSERT INTO app_user (username, full_name, is_active, is_automated) VALUES ('sensor.feed', 'Sensor feed (automated)', true, true)
ON CONFLICT (username) DO NOTHING;

-- the feed is running in this transaction, as its own account
CREATE FUNCTION sensor_feed_running() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.sensor_feed', true), '') = '1'
       AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = current_app_user() AND u.username = 'sensor.feed' AND u.is_automated AND u.is_active)
$$;
CREATE FUNCTION sensor_feed_grant(p_user uuid, p_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.sensor_feed', true), '') = '1' AND p_code = 'logbook.record'
       AND EXISTS (SELECT 1 FROM app_user u WHERE u.id = p_user AND u.username = 'sensor.feed' AND u.is_automated AND u.is_active)
$$;
-- 024's rules, plus the feed's one right while it runs
CREATE OR REPLACE FUNCTION user_has_permission_at(p_user uuid, p_code text, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                     JOIN group_permission gp ON gp.group_id = g.id JOIN permission p ON p.code = gp.permission_code
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND gp.status = 'Active' AND p.status = 'Active'
                      AND gp.permission_code = p_code
                      AND (g.site_id IS NULL OR p_site IS NULL OR g.site_id = p_site))
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> '' AND automated_grant(p_user, p_code, p_site))
        OR sensor_feed_grant(p_user, p_code)
$$;
-- 032's rules, plus the feed while it runs
CREATE OR REPLACE FUNCTION user_can_access_site(p_user uuid, p_site uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT is_admin AND is_active FROM app_user WHERE id = p_user), false)
        OR EXISTS (SELECT 1 FROM group_member m JOIN lab_group g ON g.id = m.group_id
                    WHERE m.user_id = p_user AND m.status = 'Active' AND g.status = 'Active' AND g.site_id = p_site)
        OR (COALESCE(current_setting('lims.verification_id', true), '') <> ''
            AND (automated_grant(p_user, 'testing.perform', p_site) OR automated_grant(p_user, 'testing.review', p_site)))
        OR COALESCE(current_setting('lims.stability_internal', true), '') = '1'
        OR sensor_feed_grant(p_user, 'logbook.record')
$$;

ALTER TABLE signature_event DROP CONSTRAINT signature_event_method_check;
ALTER TABLE signature_event ADD CONSTRAINT signature_event_method_check CHECK (method IN ('User ID and password','Data load script','Automated verification run','Automated sensor feed'));
-- 024's rules: the verification accounts sign only during their run; the feed signs only while it runs, as itself
CREATE OR REPLACE FUNCTION signature_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u app_user;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Signatures are permanent and cannot be changed or deleted'; END IF;
    NEW.user_id := current_app_user();     -- nobody can sign for someone else
    SELECT * INTO u FROM app_user WHERE id = NEW.user_id;
    NEW.full_name := u.full_name;
    NEW.signed_at := clock_timestamp();
    NEW.verification_id := NULL;
    IF u.is_automated AND u.username = 'sensor.feed' THEN
        IF NOT sensor_feed_running() THEN RAISE EXCEPTION '% signs only while the sensor feed runs', u.full_name; END IF;
        NEW.method := 'Automated sensor feed';
    ELSIF u.is_automated THEN
        IF verification_running() IS NULL THEN RAISE EXCEPTION '% signs only during a workflow verification run', u.full_name; END IF;
        NEW.method := 'Automated verification run';
        NEW.verification_id := verification_running();
    ELSIF NEW.method = 'Automated verification run' THEN
        RAISE EXCEPTION 'Only the automated verification accounts sign as an automated verification run';
    ELSIF NEW.method = 'Automated sensor feed' THEN
        RAISE EXCEPTION 'Only the sensor feed signs as the automated sensor feed';
    END IF;
    RETURN NEW;
END $$;
-- the feed signs what it records ("Recorded by", for the readings of this run)
CREATE FUNCTION sensor_feed_sign(p_what text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v uuid;
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Only the sensor feed signs as the sensor feed'; END IF;
    INSERT INTO signature_event (user_id, full_name, meaning, action, module, method)
    VALUES (current_app_user(), '', 'Recorded by', p_what, 'Logbooks', 'Automated sensor feed') RETURNING id INTO v;
    PERFORM set_config('lims.signature_id', v::text, true);
    RETURN v;
END $$;

-------------------------------------------------------------------------------
-- 1. THE CONNECTION, THE LINKS, THE READINGS, EACH READ
-------------------------------------------------------------------------------
CREATE TABLE sensor_connection (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL UNIQUE REFERENCES lab_site(id),
    mode                text NOT NULL DEFAULT 'Pretend (sandbox)' CHECK (mode IN ('Pretend (sandbox)','iMonnit cloud','iMonnit Enterprise')),
    base_url            text,                                   -- iMonnit's address (the key is on the server, not here)
    enabled             boolean NOT NULL DEFAULT false,
    read_every_minutes  integer NOT NULL DEFAULT 10 CHECK (read_every_minutes BETWEEN 5 AND 60),
    lookback_hours      integer NOT NULL DEFAULT 24 CHECK (lookback_hours BETWEEN 2 AND 72),   -- each read takes these hours again (late readings)
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('sensor_connection');
CREATE FUNCTION sensor_connection_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF NOT current_user_is_admin() THEN RAISE EXCEPTION 'Only a system administrator sets the sensor connection'; END IF;
    IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A connection stays with its lab'; END IF;
    NEW.base_url := NULLIF(btrim(NEW.base_url), '');
    IF NEW.mode <> 'Pretend (sandbox)' AND NEW.enabled AND NEW.base_url IS NULL THEN RAISE EXCEPTION 'Give iMonnit''s address before switching the connection on'; END IF;
    IF NEW.base_url IS NOT NULL AND NEW.base_url !~ '^https?://' THEN RAISE EXCEPTION 'iMonnit''s address starts with https://'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON sensor_connection FOR EACH ROW EXECUTE FUNCTION sensor_connection_rules();
-- every lab gets one, switched off
INSERT INTO sensor_connection (site_id) SELECT id FROM lab_site ON CONFLICT DO NOTHING;
CREATE FUNCTION lab_site_sensor_connection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO sensor_connection (site_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', was, true);
    RETURN NULL;
END $$;
CREATE TRIGGER zz_sensor_connection AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_sensor_connection();

CREATE TABLE sensor_link (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    external_id         text NOT NULL CHECK (external_id ~ '^[0-9A-Za-z_-]{1,40}$'),   -- iMonnit's sensor ID
    sensor_name         text,
    measures            text NOT NULL CHECK (measures IN ('temperature','humidity')),
    equipment_id        uuid NOT NULL REFERENCES equipment(id),
    logbook_id          uuid NOT NULL REFERENCES logbook(id),
    field_key           text NOT NULL,
    gap_minutes         integer NOT NULL DEFAULT 30 CHECK (gap_minutes BETWEEN 10 AND 1440),
    status              text NOT NULL DEFAULT 'Awaiting QA' CHECK (status IN ('Awaiting QA','Active','Retired')),
    approved_by         uuid REFERENCES app_user(id),
    approved_at         timestamptz,
    feeds_from          timestamptz,                        -- the feed records readings from here on (QA's approval, or up to 7 days before it)
    approval_signature_id uuid REFERENCES signature_event(id),
    retired_reason      text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX sensor_link_sensor_uq ON sensor_link (site_id, external_id, measures) WHERE status <> 'Retired';
CREATE UNIQUE INDEX sensor_link_target_uq ON sensor_link (logbook_id, equipment_id, field_key) WHERE status <> 'Retired';
CALL make_gxp('sensor_link');

CREATE FUNCTION sensor_internal() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('lims.sensor_internal', true), '') = '1' $$;

-- What a sensor can feed: a Number field of an Equipment logbook in use, covering the equipment; nothing else the
-- logbook asks for that a sensor cannot give (another required field that is not a number, a calculation, a lot)
CREATE FUNCTION sensor_link_problem(p_logbook uuid, p_equipment uuid, p_field text) RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE l logbook; v uuid; f logbook_field; x text;
BEGIN
    SELECT * INTO l FROM logbook WHERE id = p_logbook;
    IF l.id IS NULL THEN RETURN 'Logbook not found'; END IF;
    IF l.status <> 'Active' THEN RETURN l.logbook_code || ' is not in use'; END IF;
    IF l.subject <> 'Equipment' THEN RETURN l.logbook_code || ' is not about equipment'; END IF;
    IF l.creates_lot THEN RETURN l.logbook_code || ' makes lots: a sensor cannot feed it'; END IF;
    v := logbook_effective_version(l.id);
    IF v IS NULL THEN RETURN l.logbook_code || ' has no approved design yet'; END IF;
    SELECT * INTO f FROM logbook_field WHERE version_id = v AND field_key = p_field AND status = 'Active';
    IF f.id IS NULL THEN RETURN l.logbook_code || ' has no field "' || COALESCE(p_field, '') || '"'; END IF;
    IF f.field_type <> 'Number' THEN RETURN f.label || ' is not a number field'; END IF;
    SELECT string_agg(label, ', ' ORDER BY sort_order) INTO x FROM logbook_field
     WHERE version_id = v AND status = 'Active' AND field_key <> p_field AND (field_type IN ('Calculated','Lot','Equipment') OR (required AND field_type <> 'Number'));
    IF x IS NOT NULL THEN RETURN l.logbook_code || ' also asks for ' || x || ', which a sensor cannot give'; END IF;
    IF NOT EXISTS (SELECT 1 FROM logbook_equipment WHERE logbook_id = l.id AND equipment_id = p_equipment AND status = 'Active') THEN
        RETURN l.logbook_code || ' does not cover ' || COALESCE((SELECT equipment_code FROM equipment WHERE id = p_equipment), 'that equipment');
    END IF;
    RETURN NULL;
END $$;

CREATE FUNCTION sensor_link_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE x text;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NOT sensor_internal() THEN RAISE EXCEPTION 'A sensor link is approved or retired with its own actions; to change one, retire it and link the sensor again'; END IF;
        RETURN NEW;
    END IF;
    PERFORM require_permission_at('sensors.configure', NEW.site_id);
    PERFORM assert_signed('link a sensor');
    IF (SELECT site_id FROM logbook WHERE id = NEW.logbook_id) <> NEW.site_id OR (SELECT site_id FROM equipment WHERE id = NEW.equipment_id) <> NEW.site_id THEN
        RAISE EXCEPTION 'The logbook and the equipment must be of the sensor''s lab';
    END IF;
    x := sensor_link_problem(NEW.logbook_id, NEW.equipment_id, NEW.field_key);
    IF x IS NOT NULL THEN RAISE EXCEPTION '%', x; END IF;
    NEW.external_id := btrim(NEW.external_id); NEW.sensor_name := NULLIF(btrim(NEW.sensor_name), '');
    NEW.status := 'Awaiting QA'; NEW.approved_by := NULL; NEW.approved_at := NULL; NEW.approval_signature_id := NULL; NEW.retired_reason := NULL; NEW.feeds_from := NULL;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON sensor_link FOR EACH ROW EXECUTE FUNCTION sensor_link_rules();

-- QA approves a link (signed, not whoever linked it): the feed records from this moment, or from up to 7 days before it
-- (a sensor that was already running fills in its recent readings)
CREATE FUNCTION approve_sensor_link(p_link uuid, p_from timestamptz DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s sensor_link; x text; v_from timestamptz := COALESCE(p_from, clock_timestamp());
BEGIN
    SELECT * INTO s FROM sensor_link WHERE id = p_link FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sensor link not found'; END IF;
    PERFORM require_permission_at('logbook.review', s.site_id);
    IF s.status <> 'Awaiting QA' THEN RAISE EXCEPTION 'The link is %', lower(s.status); END IF;
    IF s.created_by = current_app_user() THEN RAISE EXCEPTION 'You linked this sensor: someone else in QA approves it'; END IF;
    x := sensor_link_problem(s.logbook_id, s.equipment_id, s.field_key);
    IF x IS NOT NULL THEN RAISE EXCEPTION '%', x; END IF;
    IF v_from > clock_timestamp() + interval '1 minute' THEN RAISE EXCEPTION 'The feed cannot start in the future'; END IF;
    IF v_from < clock_timestamp() - interval '7 days' THEN RAISE EXCEPTION 'The feed starts at most 7 days back'; END IF;
    PERFORM assert_signed('approve a sensor link');
    PERFORM ensure_reason('Sensor link approved by QA');
    PERFORM set_config('lims.sensor_internal', '1', true);
    UPDATE sensor_link SET status = 'Active', approved_by = current_app_user(), approved_at = clock_timestamp(),
           approval_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, feeds_from = least(v_from, clock_timestamp()) WHERE id = p_link;
    PERFORM set_config('lims.sensor_internal', '', true);
END $$;
CREATE FUNCTION retire_sensor_link(p_link uuid, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s sensor_link;
BEGIN
    SELECT * INTO s FROM sensor_link WHERE id = p_link FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sensor link not found'; END IF;
    PERFORM require_permission_at('sensors.configure', s.site_id);
    IF s.status = 'Retired' THEN RAISE EXCEPTION 'The link is already retired'; END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the sensor is no longer linked (moved, replaced, equipment retired)'; END IF;
    PERFORM assert_signed('retire a sensor link');
    PERFORM ensure_reason('Sensor link retired');
    PERFORM set_config('lims.sensor_internal', '1', true);
    UPDATE sensor_link SET status = 'Retired', retired_reason = btrim(p_reason) WHERE id = p_link;
    PERFORM set_config('lims.sensor_internal', '', true);
END $$;

-- The readings, as received: kept once each, never changed or deleted (they are not audited row by row: they are the
-- raw record themselves, each with when it was received)
CREATE TABLE sensor_reading (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id             uuid NOT NULL REFERENCES sensor_link(id),
    guid                text NOT NULL,                          -- iMonnit's message ID
    read_at             timestamptz NOT NULL,
    value               numeric NOT NULL,                       -- in the sensor's own unit (°C, % RH)
    battery             numeric,
    signal              numeric,
    received_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (link_id, guid)
);
CREATE INDEX sensor_reading_time_idx ON sensor_reading (link_id, read_at);
CREATE TRIGGER sensor_reading_no_change BEFORE UPDATE OR DELETE ON sensor_reading FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER sensor_reading_no_truncate BEFORE TRUNCATE ON sensor_reading FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();
CREATE FUNCTION sensor_reading_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Sensor readings are recorded only by the sensor feed'; END IF;
    IF NEW.read_at > clock_timestamp() + interval '5 minutes' THEN RAISE EXCEPTION 'A reading cannot be in the future'; END IF;
    NEW.received_at := clock_timestamp();
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT ON sensor_reading FOR EACH ROW EXECUTE FUNCTION sensor_reading_rules();

-- Each read of a lab's sensors (what came in, what went wrong)
CREATE TABLE sensor_sync_log (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    started_at          timestamptz NOT NULL,
    finished_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    ok                  boolean NOT NULL,
    readings            integer NOT NULL DEFAULT 0,
    entries             integer NOT NULL DEFAULT 0,
    message             text,
    run_by              uuid REFERENCES app_user(id)
);
CREATE INDEX sensor_sync_log_idx ON sensor_sync_log (site_id, finished_at DESC);
CREATE TRIGGER sensor_sync_log_no_change BEFORE UPDATE OR DELETE ON sensor_sync_log FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

-- the readings of one read (JSON array of {guid, at, value, battery, signal}); returns how many were new
CREATE FUNCTION sensor_add_readings(p_link uuid, p_rows jsonb) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE s sensor_link; n integer;
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Sensor readings are recorded only by the sensor feed'; END IF;
    SELECT * INTO s FROM sensor_link WHERE id = p_link;
    IF s.status <> 'Active' THEN RETURN 0; END IF;
    INSERT INTO sensor_reading (link_id, guid, read_at, value, battery, signal)
    SELECT s.id, x->>'guid', (x->>'at')::timestamptz, (x->>'value')::numeric, NULLIF(x->>'battery', '')::numeric, NULLIF(x->>'signal', '')::numeric
      FROM jsonb_array_elements(COALESCE(p_rows, '[]')) x
     WHERE (x->>'at')::timestamptz >= s.feeds_from AND NULLIF(x->>'guid', '') IS NOT NULL AND jsonb_typeof(x->'value') = 'number'
    ON CONFLICT (link_id, guid) DO NOTHING;
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 2. LOGBOOK ENTRIES FROM THE FEED
-------------------------------------------------------------------------------
ALTER TABLE logbook_entry
    ADD COLUMN source          text NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','Sensor feed')),
    ADD COLUMN sensor_link_id  uuid REFERENCES sensor_link(id),
    ADD COLUMN sensor_kind     text CHECK (sensor_kind IN ('Hour','Excursion','No data')),
    ADD COLUMN period_start    timestamptz,
    ADD COLUMN period_end      timestamptz,             -- open (NULL) while an excursion or a silence lasts
    ADD COLUMN sensor_summary  jsonb;                   -- Hour: n, min, max, mean, first, last, label, excursions;
                                                        -- Excursion: n, peak, readings [{at, value}]; No data: minutes
CREATE INDEX logbook_entry_sensor_idx ON logbook_entry (sensor_link_id, sensor_kind, period_start) WHERE sensor_link_id IS NOT NULL;

-- Before the logbook's own rules (a01_rules): a sensor entry is only the feed's; people may only give the reason of an
-- excursion or a no-data period (and void it). The generic rules check values typed by hand, so they are given a value
-- inside the limits and a placeholder reason here; the sensor's figures, the result and the reason are set after them.
CREATE FUNCTION logbook_entry_sensor_before() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v uuid; f record; lo numeric; hi numeric; vals jsonb := '{}';
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.sensor_link_id IS NOT NULL AND NOT sensor_feed_running() THEN RAISE EXCEPTION 'Sensor entries are recorded only by the sensor feed'; END IF;
        IF NEW.sensor_link_id IS NULL AND sensor_feed_running() THEN RAISE EXCEPTION 'The sensor feed records sensor entries only'; END IF;
        IF NEW.sensor_link_id IS NULL THEN
            NEW.source := 'Manual'; NEW.sensor_kind := NULL; NEW.period_start := NULL; NEW.period_end := NULL; NEW.sensor_summary := NULL;
            RETURN NEW;
        END IF;
        NEW.source := 'Sensor feed';
        IF NEW.sensor_kind IS NULL OR NEW.sensor_summary IS NULL OR NEW.period_start IS NULL THEN RAISE EXCEPTION 'A sensor entry says what it covers'; END IF;
        v := logbook_effective_version(NEW.logbook_id);
    ELSE
        IF (NEW.source, NEW.sensor_link_id, NEW.sensor_kind) IS DISTINCT FROM (OLD.source, OLD.sensor_link_id, OLD.sensor_kind) THEN
            RAISE EXCEPTION 'An entry keeps where it came from';
        END IF;
        IF OLD.source = 'Manual' THEN RETURN NEW; END IF;
        IF logbook_internal() THEN
            -- approval, return and void (logbook_internal): an excursion or a silence is approved only with its reason
            IF NEW.status = 'Approved' AND OLD.status <> 'Approved' AND NEW.result = 'Fail' AND NEW.failure_reason IS NULL THEN
                RAISE EXCEPTION '% needs its reason (what happened, what was done) before QA approves it', OLD.entry_code;
            END IF;
            RETURN NEW;
        END IF;
        IF NOT sensor_feed_running() THEN
            IF NEW.entry_values IS DISTINCT FROM OLD.entry_values OR NEW.entry_at <> OLD.entry_at OR NEW.sensor_summary IS DISTINCT FROM OLD.sensor_summary
               OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end THEN
                RAISE EXCEPTION '% comes from a sensor: its readings cannot be changed by hand (give the reason, or void it)', OLD.entry_code;
            END IF;
            IF OLD.sensor_kind = 'Hour' AND NEW.failure_reason IS DISTINCT FROM OLD.failure_reason THEN
                RAISE EXCEPTION '% is an hourly entry: give the reason on its excursion', OLD.entry_code;
            END IF;
            IF NEW.failure_reason IS NOT DISTINCT FROM OLD.failure_reason THEN RETURN NEW; END IF;
        END IF;
        v := NEW.version_id;
    END IF;
    PERFORM set_config('lims.sensor_reason', COALESCE(NULLIF(btrim(NEW.failure_reason), ''), ''), true);
    -- a value inside its limits for every number field (removed again after the logbook's rules)
    FOR f IN SELECT id, field_key FROM logbook_field WHERE version_id = v AND status = 'Active' AND field_type = 'Number' LOOP
        SELECT x.lo, x.hi INTO lo, hi FROM logbook_limits(f.id, NEW.equipment_id) x;
        vals := vals || jsonb_build_object(f.field_key, COALESCE((lo + hi) / 2, lo, hi, 0));
    END LOOP;
    NEW.entry_values := vals;
    NEW.failure_reason := 'sensor';
    RETURN NEW;
END $$;
CREATE TRIGGER a00_sensor BEFORE INSERT OR UPDATE ON logbook_entry FOR EACH ROW EXECUTE FUNCTION logbook_entry_sensor_before();

-- After the logbook's rules: the sensor's value, what is outside the limits, the result and the reason
CREATE FUNCTION logbook_entry_sensor_after() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s sensor_link; f logbook_field; lo numeric; hi numeric; m jsonb; probs text[] := '{}'; reason text; tz text; u text; ex text;
BEGIN
    IF NEW.source IS DISTINCT FROM 'Sensor feed' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND (logbook_internal() OR (NOT sensor_feed_running() AND NEW.failure_reason IS NOT DISTINCT FROM OLD.failure_reason
                                                     AND NEW.entry_values IS NOT DISTINCT FROM OLD.entry_values)) THEN RETURN NEW; END IF;
    SELECT * INTO s FROM sensor_link WHERE id = NEW.sensor_link_id;
    SELECT * INTO f FROM logbook_field WHERE version_id = NEW.version_id AND field_key = s.field_key AND status = 'Active';
    SELECT x.lo, x.hi INTO lo, hi FROM logbook_limits(f.id, NEW.equipment_id) x;
    tz := (SELECT time_zone FROM lab_site WHERE id = NEW.site_id);
    u := COALESCE(' ' || f.unit, '');
    m := NEW.sensor_summary;
    IF NEW.sensor_kind = 'Hour' THEN
        NEW.entry_values := jsonb_build_object(s.field_key, m->'mean');
        IF lo IS NOT NULL AND (m->>'min')::numeric < lo THEN probs := probs || format('%s fell to %s%s (below %s)', f.label, lb_num((m->>'min')::numeric), u, lb_num(lo)); END IF;
        IF hi IS NOT NULL AND (m->>'max')::numeric > hi THEN probs := probs || format('%s rose to %s%s (above %s)', f.label, lb_num((m->>'max')::numeric), u, lb_num(hi)); END IF;
    ELSIF NEW.sensor_kind = 'Excursion' THEN
        NEW.entry_values := jsonb_build_object(s.field_key, m->'peak');
        probs := probs || format('%s outside %s from %s %s: peak %s%s, %s reading%s', f.label,
            CASE WHEN lo IS NOT NULL AND hi IS NOT NULL THEN lb_num(lo) || ' to ' || lb_num(hi) WHEN lo IS NOT NULL THEN 'at least ' || lb_num(lo) ELSE 'at most ' || lb_num(hi) END || u,
            to_char(NEW.period_start AT TIME ZONE tz, 'YYYY-MM-DD HH24:MI'),
            CASE WHEN NEW.period_end IS NULL THEN '(still outside)' ELSE 'to ' || to_char(NEW.period_end AT TIME ZONE tz, 'HH24:MI') END,
            lb_num((m->>'peak')::numeric), u, m->>'n', CASE WHEN m->>'n' = '1' THEN '' ELSE 's' END);
    ELSE
        NEW.entry_values := '{}';
        probs := probs || format('No reading from the sensor from %s %s', to_char(NEW.period_start AT TIME ZONE tz, 'YYYY-MM-DD HH24:MI'),
            CASE WHEN NEW.period_end IS NULL THEN '(still silent)' ELSE 'to ' || to_char(NEW.period_end AT TIME ZONE tz, 'HH24:MI') || format(' (%s minutes)', m->>'minutes') END);
    END IF;
    NEW.problems := probs;
    NEW.result := CASE WHEN cardinality(probs) > 0 THEN 'Fail' WHEN lo IS NULL AND hi IS NULL AND NEW.sensor_kind = 'Hour' THEN NULL ELSE 'Pass' END;
    reason := NULLIF(current_setting('lims.sensor_reason', true), '');
    IF NEW.result IS DISTINCT FROM 'Fail' THEN NEW.failure_reason := NULL;
    ELSIF NEW.sensor_kind = 'Hour' THEN
        ex := (SELECT string_agg(value #>> '{}', ', ') FROM jsonb_array_elements(COALESCE(m->'excursions', '[]')));
        NEW.failure_reason := COALESCE('See the excursion ' || ex, 'Readings outside the limits: see the excursion entries');
    ELSE
        IF reason IS NULL AND NOT sensor_feed_running() THEN RAISE EXCEPTION 'Give the reason (what happened, what was done about it)'; END IF;
        NEW.failure_reason := reason;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_sensor BEFORE INSERT OR UPDATE ON logbook_entry FOR EACH ROW EXECUTE FUNCTION logbook_entry_sensor_after();

-- QC Review and the equipment page: a sensor excursion or silence covers exactly its period; hourly entries flag nothing
-- (034's view, same columns)
CREATE OR REPLACE VIEW equipment_failure_view AS
SELECT e.id AS logbook_entry_id, e.entry_code, e.logbook_id, l.logbook_code, l.logbook_name, l.kind, e.site_id, e.equipment_id, eq.equipment_code, eq.equipment_name,
       e.entry_at, e.problems, e.failure_reason, e.status,
       CASE WHEN e.source = 'Sensor feed' THEN e.period_start ELSE
       COALESCE((SELECT max(p.entry_at) FROM logbook_entry p WHERE p.logbook_id = e.logbook_id AND p.equipment_id = e.equipment_id AND p.status <> 'Voided'
                   AND p.result = 'Pass' AND p.entry_at < e.entry_at),
                (SELECT min(v.approved_at) FROM logbook_version v WHERE v.logbook_id = e.logbook_id AND v.approved_at IS NOT NULL AND v.approved_at < e.entry_at),
                e.entry_at) END AS window_start,
       CASE WHEN e.source = 'Sensor feed' THEN e.period_end ELSE
       (SELECT min(p.entry_at) FROM logbook_entry p WHERE p.logbook_id = e.logbook_id AND p.equipment_id = e.equipment_id AND p.status <> 'Voided'
         AND p.result = 'Pass' AND p.entry_at > e.entry_at) END AS window_end
  FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id JOIN equipment eq ON eq.id = e.equipment_id
 WHERE e.result = 'Fail' AND e.status <> 'Voided' AND e.equipment_id IS NOT NULL AND e.sensor_kind IS DISTINCT FROM 'Hour';

-------------------------------------------------------------------------------
-- 3. READINGS TO ENTRIES
-------------------------------------------------------------------------------
-- Works over the last 72 hours of readings and changes entries that start in the last 48 (an excursion or a silence
-- still open from before is only closed). Each entry is matched to the excursion or silence it overlaps, so late
-- readings change it rather than add another; one that late readings removed is voided. Returns what it did.
CREATE FUNCTION sensor_feed_refresh(p_link uuid, p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s sensor_link; fld logbook_field; lo numeric; hi numeric; tz text; v_from timestamptz; v_touch timestamptz; v_gap interval;
        r record; e logbook_entry; matched uuid[] := '{}'; summ jsonb; n_new integer := 0; n_upd integer := 0; n_void integer := 0; v_id uuid;
        prev timestamptz; codes jsonb; v_first timestamptz; v_st timestamptz;
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Only the sensor feed turns readings into entries'; END IF;
    SELECT * INTO s FROM sensor_link WHERE id = p_link;
    IF s.id IS NULL OR s.status <> 'Active' THEN RETURN jsonb_build_object('skipped', true); END IF;
    SELECT * INTO fld FROM logbook_field WHERE version_id = logbook_effective_version(s.logbook_id) AND field_key = s.field_key AND status = 'Active';
    IF fld.id IS NULL OR fld.field_type <> 'Number' THEN RAISE EXCEPTION 'The linked logbook field "%" is no longer a number field of the approved design: retire the link', s.field_key; END IF;
    SELECT x.lo, x.hi INTO lo, hi FROM logbook_limits(fld.id, s.equipment_id) x;
    tz := (SELECT time_zone FROM lab_site WHERE id = s.site_id);
    v_from := greatest(s.feeds_from, p_now - interval '72 hours');
    v_touch := greatest(s.feeds_from, p_now - interval '48 hours');
    v_gap := make_interval(mins => s.gap_minutes);
    prev := (SELECT max(read_at) FROM sensor_reading WHERE link_id = s.id AND read_at < v_from);
    v_first := (SELECT min(read_at) FROM sensor_reading WHERE link_id = s.id AND read_at >= s.feeds_from);

    -- (a) spells outside the limits
    FOR r IN
        WITH rd AS (SELECT read_at, value, (lo IS NOT NULL AND value < lo) OR (hi IS NOT NULL AND value > hi) AS o
                      FROM sensor_reading WHERE link_id = s.id AND read_at >= COALESCE(prev, v_from) AND read_at <= p_now),
             g AS (SELECT *, sum(CASE WHEN o THEN 0 ELSE 1 END) OVER (ORDER BY read_at) AS grp FROM rd),
             isl AS (SELECT grp, min(read_at) AS st, count(*) AS n,
                            jsonb_agg(jsonb_build_object('at', read_at, 'value', value) ORDER BY read_at) AS readings,
                            (array_agg(value ORDER BY greatest(value - hi, lo - value) DESC NULLS LAST))[1] AS peak
                       FROM g WHERE o GROUP BY grp)
        SELECT isl.*, (SELECT min(rd.read_at) FROM rd WHERE NOT rd.o AND rd.read_at > isl.st) AS en FROM isl ORDER BY st
    LOOP
        SELECT * INTO e FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Excursion' AND x.status <> 'Voided'
           AND x.period_start <= COALESCE(r.en, p_now) AND COALESCE(x.period_end, 'infinity'::timestamptz) >= r.st AND NOT (x.id = ANY (matched))
         ORDER BY x.period_start LIMIT 1;
        IF r.st < v_touch AND e.id IS NULL THEN CONTINUE; END IF;
        IF r.st < v_touch THEN   -- an older spell: only its end is updated
            IF e.period_end IS DISTINCT FROM r.en THEN
                PERFORM set_config('lims.reason', 'Sensor feed: the excursion ended', true);
                UPDATE logbook_entry SET period_end = r.en, sensor_summary = sensor_summary || jsonb_build_object('open', r.en IS NULL) WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
            matched := matched || e.id; CONTINUE;
        END IF;
        summ := jsonb_build_object('n', r.n, 'peak', r.peak, 'readings', r.readings, 'open', r.en IS NULL);
        IF e.id IS NULL THEN
            PERFORM set_config('lims.reason', 'Sensor feed: readings outside the limits', true);
            INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, sensor_link_id, sensor_kind, period_start, period_end, sensor_summary)
            VALUES (s.logbook_id, s.equipment_id, r.st, s.id, 'Excursion', r.st, r.en, summ) RETURNING id INTO v_id;
            matched := matched || v_id; n_new := n_new + 1;
        ELSE
            IF (e.period_start, e.period_end, e.sensor_summary) IS DISTINCT FROM (r.st, r.en, summ) THEN
                PERFORM set_config('lims.reason', CASE WHEN e.period_end IS NULL AND r.en IS NOT NULL AND e.period_start = r.st THEN 'Sensor feed: the excursion ended' ELSE 'Late readings from the sensor' END, true);
                UPDATE logbook_entry SET entry_at = r.st, period_start = r.st, period_end = r.en, sensor_summary = summ WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
            matched := matched || e.id;
        END IF;
    END LOOP;
    FOR e IN SELECT * FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Excursion' AND x.status <> 'Voided'
               AND x.period_start >= v_touch AND NOT (x.id = ANY (matched)) LOOP
        PERFORM set_config('lims.reason', 'Late readings from the sensor', true);
        PERFORM void_logbook_entry(e.id, 'Late readings from the sensor changed this excursion: see the entries around it');
        n_void := n_void + 1;
    END LOOP;

    -- (b) silences longer than the link's gap (from the last reading before, or from the link's approval)
    matched := '{}';
    FOR r IN
        WITH rd AS (SELECT read_at FROM sensor_reading WHERE link_id = s.id AND read_at >= COALESCE(prev, v_from) AND read_at <= p_now),
             x AS (SELECT lag(read_at) OVER (ORDER BY read_at) AS a, read_at AS b FROM rd)
        SELECT a AS st, b AS en FROM x WHERE a IS NOT NULL AND b - a > v_gap
        UNION ALL SELECT s.feeds_from, min(read_at) FROM rd HAVING min(read_at) = v_first AND min(read_at) - s.feeds_from > v_gap
        UNION ALL SELECT COALESCE(max(read_at), prev, s.feeds_from), NULL FROM rd HAVING p_now - COALESCE(max(read_at), prev, s.feeds_from) > v_gap
        ORDER BY 1
    LOOP
        SELECT * INTO e FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'No data' AND x.status <> 'Voided'
           AND x.period_start <= COALESCE(r.en, p_now) AND COALESCE(x.period_end, 'infinity'::timestamptz) >= r.st AND NOT (x.id = ANY (matched))
         ORDER BY x.period_start LIMIT 1;
        IF r.st < v_touch AND e.id IS NULL THEN CONTINUE; END IF;
        summ := jsonb_build_object('minutes', CASE WHEN r.en IS NULL THEN NULL ELSE round(extract(epoch FROM r.en - r.st) / 60) END, 'open', r.en IS NULL);
        IF e.id IS NULL THEN
            PERFORM set_config('lims.reason', 'Sensor feed: no readings from the sensor', true);
            INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, sensor_link_id, sensor_kind, period_start, period_end, sensor_summary)
            VALUES (s.logbook_id, s.equipment_id, r.st, s.id, 'No data', r.st, r.en, summ) RETURNING id INTO v_id;
            matched := matched || v_id; n_new := n_new + 1;
        ELSE
            v_st := CASE WHEN r.st < v_touch THEN e.period_start ELSE r.st END;
            summ := jsonb_build_object('minutes', CASE WHEN r.en IS NULL THEN NULL ELSE round(extract(epoch FROM r.en - v_st) / 60) END, 'open', r.en IS NULL);
            IF (e.period_start, e.period_end, e.sensor_summary) IS DISTINCT FROM (v_st, r.en, summ) THEN
                PERFORM set_config('lims.reason', CASE WHEN e.period_end IS NULL AND e.period_start = v_st THEN 'Sensor feed: the sensor is reading again' ELSE 'Late readings from the sensor' END, true);
                UPDATE logbook_entry SET entry_at = v_st, period_start = v_st, period_end = r.en, sensor_summary = summ WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
            matched := matched || e.id;
        END IF;
    END LOOP;
    FOR e IN SELECT * FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'No data' AND x.status <> 'Voided'
               AND x.period_start >= v_touch AND NOT (x.id = ANY (matched)) LOOP
        PERFORM set_config('lims.reason', 'Late readings from the sensor', true);
        PERFORM void_logbook_entry(e.id, 'Late readings from the sensor filled this period');
        n_void := n_void + 1;
    END LOOP;

    -- (c) one entry per ended lab hour with readings (the lab's zones are a whole number of hours from UTC)
    FOR r IN
        SELECT date_trunc('hour', read_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hs, count(*) AS n, min(value) AS mn, max(value) AS mx,
               round(avg(value), 2) AS mean, min(read_at) AS first, max(read_at) AS last
          FROM sensor_reading WHERE link_id = s.id AND read_at >= v_touch AND read_at <= p_now
         GROUP BY 1 HAVING date_trunc('hour', min(read_at) AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 hour' <= p_now ORDER BY 1
    LOOP
        IF r.hs < v_touch THEN CONTINUE; END IF;
        codes := (SELECT COALESCE(jsonb_agg(x.entry_code ORDER BY x.period_start), '[]') FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Excursion'
                    AND x.status <> 'Voided' AND x.period_start < r.hs + interval '1 hour' AND COALESCE(x.period_end, 'infinity'::timestamptz) > r.hs);
        summ := jsonb_build_object('n', r.n, 'min', r.mn, 'max', r.mx, 'mean', r.mean, 'first', r.first, 'last', r.last,
                                   'label', to_char(r.hs AT TIME ZONE tz, 'YYYY-MM-DD HH24:00') || ' to ' || to_char((r.hs + interval '1 hour') AT TIME ZONE tz, 'HH24:00'),
                                   'excursions', codes);
        SELECT * INTO e FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Hour' AND x.status <> 'Voided' AND x.period_start = r.hs;
        IF e.id IS NULL THEN
            PERFORM set_config('lims.reason', 'Sensor feed: hourly readings', true);
            INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, sensor_link_id, sensor_kind, period_start, period_end, sensor_summary)
            VALUES (s.logbook_id, s.equipment_id, r.hs + interval '1 hour', s.id, 'Hour', r.hs, r.hs + interval '1 hour', summ);
            n_new := n_new + 1;
        ELSIF e.sensor_summary IS DISTINCT FROM summ THEN
            PERFORM set_config('lims.reason', CASE WHEN (e.sensor_summary->>'n') IS DISTINCT FROM (summ->>'n') THEN 'Late readings from the sensor' ELSE 'Sensor feed: the hour''s excursion changed' END, true);
            UPDATE logbook_entry SET sensor_summary = summ WHERE id = e.id;
            n_upd := n_upd + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('new', n_new, 'updated', n_upd, 'voided', n_void);
END $$;

-- A sensor's readings over a period (the incubator during a load): number, lowest, highest, average
CREATE FUNCTION sensor_range(p_equipment uuid, p_measures text, p_from timestamptz, p_to timestamptz)
RETURNS TABLE (n integer, lo numeric, hi numeric, mean numeric, sensor text) LANGUAGE sql STABLE AS $$
    SELECT count(r.id)::int, min(r.value), max(r.value), round(avg(r.value), 2), min(s.external_id || COALESCE(' ' || s.sensor_name, ''))
      FROM sensor_link s LEFT JOIN sensor_reading r ON r.link_id = s.id AND r.read_at >= p_from AND r.read_at <= p_to
     WHERE s.equipment_id = p_equipment AND s.measures = p_measures AND s.status <> 'Awaiting QA'
     HAVING count(s.id) > 0
$$;

-------------------------------------------------------------------------------
-- 4. AUDIT REFERENCES (and the trend chart links of 043, which used the wrong key)
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_045;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE x jsonb;
BEGIN
    IF p_table = 'sensor_link' THEN
        RETURN jsonb_build_object('label', 'Sensor ' || COALESCE(r->>'external_id', '') || COALESCE(' ' || (r->>'sensor_name'), '') || ' (' || COALESCE(r->>'measures', '') || ')', 'link', '#/sensors');
    ELSIF p_table = 'sensor_connection' THEN
        RETURN jsonb_build_object('label', 'Sensor connection of ' || COALESCE((SELECT site_code FROM lab_site WHERE id = (r->>'site_id')::uuid), ''), 'link', '#/sensors');
    END IF;
    x := audit_record_ref_045(p_table, p_id, r);
    IF x ? 'href' AND NOT x ? 'link' THEN x := x || jsonb_build_object('link', x->>'href'); END IF;
    RETURN x;
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
