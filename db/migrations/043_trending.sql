-- T-1 Trending and control charts (built without Alex's input on his instruction, 2026-10-17; vault: Decision -
-- Trending and Control Charts T-1, build choices Proposed). The charts themselves are read-only views of approved
-- records, computed by the server (server/trending.js). What the database keeps:
--  - saved charts (TC-0001): what is charted, the rules, whether it is watched and shown in QC Review, and limits
--    frozen from a baseline (centre line and sigma, with the baseline period and who froze them);
--  - signal reviews: a person's acknowledgement of a signal on a saved chart (the point, the rule, a comment).
-- Permissions: trending.view (see and download charts; Analyst, Lab Supervisor, QA, General Manager, Project Manager)
-- and trending.manage (save, change, freeze and review signals; Lab Supervisor, QA).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 043: trending and control charts', true);

INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('trending.view', 'Trending', 'Control charts', 'See, build and download trend and control charts of the lab''s results, QC, logbooks, stability and events', false, 120),
 ('trending.manage', 'Trending', 'Control charts', 'Save charts, freeze their control limits, apply them to QC Review and review their signals', false, 121);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Analyst', '{trending.view}'), ('Lab Supervisor', '{trending.view,trending.manage}'), ('QA', '{trending.view,trending.manage}'),
 ('General Manager', '{trending.view}'), ('Project Manager', '{trending.view}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check
    CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Reports','COA comments','Logbooks','Invoicing','Stability','Trending','Admin'));

CREATE SEQUENCE trend_chart_seq;
CREATE TABLE trend_chart (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chart_code          text NOT NULL UNIQUE DEFAULT 'TC-' || lpad(nextval('trend_chart_seq')::text, 4, '0'),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    chart_name          text NOT NULL CHECK (btrim(chart_name) <> ''),
    description         text,
    source              text NOT NULL CHECK (source IN ('results','qc','logbook','stability','counts','pareto')),
    params              jsonb NOT NULL DEFAULT '{}',          -- test, analyte, QC type, logbook field, metric, period... ("*" = each one)
    rules               text[] NOT NULL DEFAULT '{R1,R2,R3,R4,R5,LIM}' CHECK (rules <@ ARRAY['R1','R2','R3','R4','R5','LIM']),
    watch               boolean NOT NULL DEFAULT true,        -- on Trend watch
    show_in_review      boolean NOT NULL DEFAULT false,       -- in QC Review of the test's batches (QC charts)
    frozen_cl           numeric,                              -- limits frozen from a baseline: centre line and sigma
    frozen_sigma        numeric,
    frozen_from         date,
    frozen_to           date,
    frozen_n            integer,
    frozen_by           uuid REFERENCES app_user(id),
    frozen_at           timestamptz,
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX trend_chart_name_uq ON trend_chart (site_id, lower(btrim(chart_name))) WHERE status = 'Active';
CALL make_gxp('trend_chart');

CREATE TABLE trend_signal_review (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    chart_id            uuid NOT NULL REFERENCES trend_chart(id),
    point_key           text NOT NULL,                        -- the charted record (result, QC check, entry, period)
    point_label         text,
    rule                text NOT NULL CHECK (rule IN ('R1','R2','R3','R4','R5','LIM')),
    outcome             text NOT NULL CHECK (outcome IN ('Investigated: no action','Action taken','Linked to an OOS or deviation','Expected (known cause)')),
    comment             text NOT NULL CHECK (btrim(comment) <> ''),
    reviewed_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    reviewed_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    status              record_status NOT NULL DEFAULT 'Active',
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX trend_signal_review_uq ON trend_signal_review (chart_id, point_key, rule) WHERE status = 'Active';
CALL make_gxp('trend_signal_review');

-- Who changes what: trending.manage at the chart's lab. Frozen limits carry who froze them and when; a review stays with its chart.
CREATE FUNCTION trend_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    IF in_group_sync() THEN RETURN NEW; END IF;
    IF TG_TABLE_NAME = 'trend_chart' THEN
        v_site := NEW.site_id;
        IF TG_OP = 'UPDATE' AND NEW.site_id <> OLD.site_id THEN RAISE EXCEPTION 'A chart stays with its lab'; END IF;
        IF TG_OP = 'UPDATE' AND (NEW.source, NEW.params) IS DISTINCT FROM (OLD.source, OLD.params) AND OLD.frozen_cl IS NOT NULL AND NEW.frozen_cl IS NOT DISTINCT FROM OLD.frozen_cl THEN
            RAISE EXCEPTION 'The chart''s limits are frozen for what it charts: unfreeze them before charting something else';
        END IF;
        IF NEW.frozen_cl IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.frozen_cl IS DISTINCT FROM OLD.frozen_cl OR NEW.frozen_sigma IS DISTINCT FROM OLD.frozen_sigma) THEN
            IF NEW.frozen_sigma IS NULL OR NEW.frozen_sigma < 0 OR NEW.frozen_n IS NULL OR NEW.frozen_n < 2 THEN RAISE EXCEPTION 'Frozen limits need a centre line, a sigma and the baseline they came from (at least 2 points)'; END IF;
            NEW.frozen_by := current_app_user(); NEW.frozen_at := clock_timestamp();
        END IF;
        IF NEW.frozen_cl IS NULL THEN NEW.frozen_sigma := NULL; NEW.frozen_from := NULL; NEW.frozen_to := NULL; NEW.frozen_n := NULL; NEW.frozen_by := NULL; NEW.frozen_at := NULL; END IF;
        IF NEW.show_in_review AND NEW.source <> 'qc' THEN RAISE EXCEPTION 'Only QC charts are shown in QC Review'; END IF;
    ELSE
        SELECT site_id INTO v_site FROM trend_chart WHERE id = NEW.chart_id;
        IF TG_OP = 'UPDATE' AND (NEW.chart_id, NEW.point_key, NEW.rule) IS DISTINCT FROM (OLD.chart_id, OLD.point_key, OLD.rule) THEN RAISE EXCEPTION 'A review stays with its signal'; END IF;
    END IF;
    PERFORM require_permission_at('trending.manage', v_site);
    RETURN NEW;
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON trend_chart FOR EACH ROW EXECUTE FUNCTION trend_rules();
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON trend_signal_review FOR EACH ROW EXECUTE FUNCTION trend_rules();

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_043;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'trend_chart' THEN
        RETURN jsonb_build_object('label', 'Trend chart ' || COALESCE(r->>'chart_code', '') || ' ' || COALESCE(r->>'chart_name', ''), 'href', '#/trending/charts/' || p_id);
    ELSIF p_table = 'trend_signal_review' THEN
        RETURN jsonb_build_object('label', 'Signal review on ' || COALESCE((SELECT chart_code FROM trend_chart WHERE id = (r->>'chart_id')::uuid), '') || ': ' || COALESCE(r->>'point_label', ''),
                                  'href', '#/trending/charts/' || COALESCE(r->>'chart_id', ''));
    END IF;
    RETURN audit_record_ref_043(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
