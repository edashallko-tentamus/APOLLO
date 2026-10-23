-- 046: sensor entries after a change of limits (Claude Code, 2026-10-19; version 0.25.1). Found by Alex on his first
-- test (EQ-00133, LB-0034): the equipment's limits were typed as 10 to 30 instead of 33 to 37, so the feed recorded
-- two days of an incubator at 34 °C as one long excursion and every hour as failing. Correcting the limits changed
-- nothing recorded (an entry is judged when it is recorded, as for entries typed by hand), and the excursion stayed
-- open for ever (it started before the 48 hours the feed changes), flagging every batch that would use the incubator.
--  - The feed now closes an open excursion at the first reading inside the current limits, and an entry records the
--    limits it was judged against (sensor_summary lo, hi). A regular read changes only entries judged against the
--    current limits: a change of limits is never applied to past entries by itself.
--  - Re-judging: when the limits were wrong, someone with sensors.configure asks (signed, with a reason) for the
--    sensor's entries from a date on to be judged again against the current limits (request_sensor_rejudge). The
--    feed then does it at once: excursions that no longer are one are voided, new ones recorded, the hours judged
--    again (an approved hour goes back to QA). Each change carries "Re-judged against the corrected limits (asked by
--    <name>): <reason>" in the audit trail.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 046: sensor entries after a change of limits', true);

ALTER TABLE sensor_link
    ADD COLUMN rejudge_from          timestamptz,     -- a request waiting for the feed: judge again from here on
    ADD COLUMN rejudge_reason        text,
    ADD COLUMN rejudge_by            uuid REFERENCES app_user(id),
    ADD COLUMN rejudge_signature_id  uuid REFERENCES signature_event(id);

-- someone with sensors.configure asks for the sensor's entries from a date on to be judged again (signed, a reason)
CREATE FUNCTION request_sensor_rejudge(p_link uuid, p_from timestamptz, p_reason text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s sensor_link;
BEGIN
    SELECT * INTO s FROM sensor_link WHERE id = p_link FOR UPDATE;
    IF s.id IS NULL THEN RAISE EXCEPTION 'Sensor link not found'; END IF;
    PERFORM require_permission_at('sensors.configure', s.site_id);
    IF s.status <> 'Active' THEN RAISE EXCEPTION 'The link is %: only an active link is judged again', lower(s.status); END IF;
    IF COALESCE(btrim(p_reason), '') = '' THEN RAISE EXCEPTION 'Say why the entries are judged again (e.g. the limits were typed wrongly)'; END IF;
    IF p_from IS NULL OR p_from > clock_timestamp() THEN RAISE EXCEPTION 'Say from when the entries are judged again'; END IF;
    PERFORM assert_signed('judge the sensor''s entries again');
    PERFORM ensure_reason('Sensor entries to be judged again');
    PERFORM set_config('lims.sensor_internal', '1', true);
    UPDATE sensor_link SET rejudge_from = greatest(p_from, feeds_from), rejudge_reason = btrim(p_reason), rejudge_by = current_app_user(),
           rejudge_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_link;
    PERFORM set_config('lims.sensor_internal', '', true);
END $$;

-- whether an entry was judged against these limits
CREATE FUNCTION x_same_limits(p_summary jsonb, p_lim jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
    SELECT (p_summary->'lo', p_summary->'hi') IS NOT DISTINCT FROM (p_lim->'lo', p_lim->'hi')
$$;

-- The readings into entries (045's, with the changes above). p_from NULL: a regular read (72 hours looked at, 48
-- changed). p_from given: judged again against the current limits from then on, p_reason saying why.
CREATE FUNCTION sensor_feed_refresh(p_link uuid, p_now timestamptz, p_from timestamptz, p_reason text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s sensor_link; fld logbook_field; lo numeric; hi numeric; tz text; v_from timestamptz; v_touch timestamptz; v_gap interval;
        r record; e logbook_entry; matched uuid[] := '{}'; summ jsonb; n_new integer := 0; n_upd integer := 0; n_void integer := 0; v_id uuid;
        prev timestamptz; codes jsonb; v_first timestamptz; v_st timestamptz; v_en timestamptz;
        rejudge boolean := p_from IS NOT NULL; lim jsonb; why text;
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Only the sensor feed turns readings into entries'; END IF;
    SELECT * INTO s FROM sensor_link WHERE id = p_link;
    IF s.id IS NULL OR s.status <> 'Active' THEN RETURN jsonb_build_object('skipped', true); END IF;
    SELECT * INTO fld FROM logbook_field WHERE version_id = logbook_effective_version(s.logbook_id) AND field_key = s.field_key AND status = 'Active';
    IF fld.id IS NULL OR fld.field_type <> 'Number' THEN RAISE EXCEPTION 'The linked logbook field "%" is no longer a number field of the approved design: retire the link', s.field_key; END IF;
    SELECT x.lo, x.hi INTO lo, hi FROM logbook_limits(fld.id, s.equipment_id) x;
    lim := jsonb_strip_nulls(jsonb_build_object('lo', lo, 'hi', hi));
    tz := (SELECT time_zone FROM lab_site WHERE id = s.site_id);
    v_from := greatest(s.feeds_from, CASE WHEN rejudge THEN p_from ELSE p_now - interval '72 hours' END);
    v_touch := greatest(s.feeds_from, CASE WHEN rejudge THEN p_from ELSE p_now - interval '48 hours' END);
    v_gap := make_interval(mins => s.gap_minutes);
    prev := (SELECT max(read_at) FROM sensor_reading WHERE link_id = s.id AND read_at < v_from);
    v_first := (SELECT min(read_at) FROM sensor_reading WHERE link_id = s.id AND read_at >= s.feeds_from);
    why := CASE WHEN rejudge THEN 'Re-judged against the corrected limits: ' || COALESCE(p_reason, '') ELSE 'Late readings from the sensor' END;

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
        IF r.st < v_touch OR (NOT rejudge AND e.id IS NOT NULL AND (e.sensor_summary->'lo', e.sensor_summary->'hi') IS DISTINCT FROM (lim->'lo', lim->'hi')) THEN
            -- an older spell, or one judged against other limits: only its end is updated
            IF e.period_end IS NULL AND r.en IS NOT NULL THEN
                PERFORM set_config('lims.reason', 'Sensor feed: the excursion ended', true);
                UPDATE logbook_entry SET period_end = r.en, sensor_summary = sensor_summary || jsonb_build_object('open', false) WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
            matched := matched || e.id; CONTINUE;
        END IF;
        summ := jsonb_build_object('n', r.n, 'peak', r.peak, 'readings', r.readings, 'open', r.en IS NULL) || lim;
        IF e.id IS NULL THEN
            PERFORM set_config('lims.reason', CASE WHEN rejudge THEN why ELSE 'Sensor feed: readings outside the limits' END, true);
            INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, sensor_link_id, sensor_kind, period_start, period_end, sensor_summary)
            VALUES (s.logbook_id, s.equipment_id, r.st, s.id, 'Excursion', r.st, r.en, summ) RETURNING id INTO v_id;
            matched := matched || v_id; n_new := n_new + 1;
        ELSE
            IF (e.period_start, e.period_end, e.sensor_summary) IS DISTINCT FROM (r.st, r.en, summ) THEN
                PERFORM set_config('lims.reason', CASE WHEN rejudge THEN why WHEN e.period_end IS NULL AND r.en IS NOT NULL AND e.period_start = r.st THEN 'Sensor feed: the excursion ended' ELSE why END, true);
                UPDATE logbook_entry SET entry_at = r.st, period_start = r.st, period_end = r.en, sensor_summary = summ WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
            matched := matched || e.id;
        END IF;
    END LOOP;
    FOR e IN SELECT * FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Excursion' AND x.status <> 'Voided' AND NOT (x.id = ANY (matched))
               AND (x.period_start >= v_touch OR x.period_end IS NULL) ORDER BY x.period_start LOOP
        IF e.period_start >= v_touch AND (rejudge OR x_same_limits(e.sensor_summary, lim)) THEN
            PERFORM set_config('lims.reason', why, true);
            PERFORM void_logbook_entry(e.id, CASE WHEN rejudge THEN why ELSE 'Late readings from the sensor changed this excursion: see the entries around it' END);
            n_void := n_void + 1;
        ELSIF e.period_end IS NULL THEN
            -- judged against other limits and still open: it ends at the first reading inside the current limits
            v_en := (SELECT min(read_at) FROM sensor_reading WHERE link_id = s.id AND read_at > e.period_start AND read_at <= p_now
                       AND NOT ((lo IS NOT NULL AND value < lo) OR (hi IS NOT NULL AND value > hi)));
            IF v_en IS NOT NULL THEN
                PERFORM set_config('lims.reason', 'Sensor feed: the excursion ended (inside the limits as they are now)', true);
                UPDATE logbook_entry SET period_end = v_en, sensor_summary = sensor_summary || jsonb_build_object('open', false) WHERE id = e.id;
                n_upd := n_upd + 1;
            END IF;
        END IF;
    END LOOP;

    -- (b) silences longer than the link's gap (limits play no part)
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

    -- (c) one entry per ended lab hour with readings; a regular read changes an hour only for its readings or its
    -- excursions, keeping the limits it was judged against; a re-judging judges it against the current limits
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
                                   'excursions', codes) || lim;
        SELECT * INTO e FROM logbook_entry x WHERE x.sensor_link_id = s.id AND x.sensor_kind = 'Hour' AND x.status <> 'Voided' AND x.period_start = r.hs;
        IF e.id IS NULL THEN
            PERFORM set_config('lims.reason', 'Sensor feed: hourly readings', true);
            INSERT INTO logbook_entry (logbook_id, equipment_id, entry_at, sensor_link_id, sensor_kind, period_start, period_end, sensor_summary)
            VALUES (s.logbook_id, s.equipment_id, r.hs + interval '1 hour', s.id, 'Hour', r.hs, r.hs + interval '1 hour', summ);
            n_new := n_new + 1;
        ELSIF rejudge AND e.sensor_summary IS DISTINCT FROM summ THEN
            PERFORM set_config('lims.reason', why, true);
            UPDATE logbook_entry SET sensor_summary = summ WHERE id = e.id;
            n_upd := n_upd + 1;
        ELSIF NOT rejudge AND ((e.sensor_summary - 'lo' - 'hi' - 'excursions') IS DISTINCT FROM (summ - 'lo' - 'hi' - 'excursions')
                               OR (x_same_limits(e.sensor_summary, lim) AND e.sensor_summary->'excursions' IS DISTINCT FROM summ->'excursions')) THEN
            PERFORM set_config('lims.reason', CASE WHEN (e.sensor_summary->>'n') IS DISTINCT FROM (summ->>'n') THEN 'Late readings from the sensor' ELSE 'Sensor feed: the hour''s excursion changed' END, true);
            UPDATE logbook_entry SET sensor_summary = summ WHERE id = e.id;   -- judged again by the entry's rules, against the limits as they are
            n_upd := n_upd + 1;
        END IF;
    END LOOP;
    RETURN jsonb_build_object('new', n_new, 'updated', n_upd, 'voided', n_void);
END $$;

-- The regular read: a waiting request to judge again is done first (and cleared), then the read as usual
CREATE OR REPLACE FUNCTION sensor_feed_refresh(p_link uuid, p_now timestamptz DEFAULT clock_timestamp()) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s sensor_link; x jsonb; who text;
BEGIN
    IF NOT sensor_feed_running() THEN RAISE EXCEPTION 'Only the sensor feed turns readings into entries'; END IF;
    SELECT * INTO s FROM sensor_link WHERE id = p_link;
    IF s.id IS NOT NULL AND s.status = 'Active' AND s.rejudge_from IS NOT NULL THEN
        who := (SELECT full_name FROM app_user WHERE id = s.rejudge_by);
        x := sensor_feed_refresh(p_link, p_now, s.rejudge_from, format('%s (asked by %s)', s.rejudge_reason, who));
        PERFORM set_config('lims.sensor_internal', '1', true);
        PERFORM set_config('lims.reason', 'Sensor entries judged again', true);
        UPDATE sensor_link SET rejudge_from = NULL, rejudge_reason = NULL, rejudge_by = NULL, rejudge_signature_id = NULL WHERE id = p_link;
        PERFORM set_config('lims.sensor_internal', '', true);
        RETURN x || jsonb_build_object('rejudged', true);
    END IF;
    RETURN sensor_feed_refresh(p_link, p_now, NULL, NULL);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
