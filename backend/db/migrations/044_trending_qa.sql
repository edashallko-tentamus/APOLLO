-- 044: QA approval of trend charts, and control chart limits carried into a test's QC criteria (Claude Code, 2026-10-19;
-- version 0.24.1). Alex's notes on T-1 (2026-10-19), with his choices:
--  - "add a QA reviewable configuration to the new chart options and allow it to show up on the QA to do list widget":
--    QA approves the chart and its limits (signed) before it counts; changing what it charts, its rules or its frozen
--    limits sends it back to QA; a chart shown in QC Review must be QA reviewable and appears there only once approved.
--  - "for QC charts ... the control chart limits can be uploaded for the QC type to the test after approval": through a
--    new Draft version of the test (the server writes the limits into its Batching step, signed, with a reason); the
--    version then goes through the normal signed approval. The chart keeps which version it was applied to.
-- Permission trending.approve (QA): approve trend charts and their limits, and turn QA review off on a chart.
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 044: QA approval of trend charts', true);

INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('trending.approve', 'Trending', 'Control charts', 'Approve trend charts and their control limits (signed), and take a chart off QA review', false, 122);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('QA', '{trending.approve}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

ALTER TABLE trend_chart
    ADD COLUMN qa_review           boolean NOT NULL DEFAULT false,   -- QA approves the chart and its limits before it counts
    ADD COLUMN qa_status           text NOT NULL DEFAULT 'Not required' CHECK (qa_status IN ('Not required','Awaiting QA','Approved')),
    ADD COLUMN qa_approved_by      uuid REFERENCES app_user(id),
    ADD COLUMN qa_approved_at      timestamptz,
    ADD COLUMN qa_signature_id     uuid REFERENCES signature_event(id),
    ADD COLUMN applied_version_id  uuid REFERENCES test_version(id),  -- the test version its limits were carried into
    ADD COLUMN applied_by          uuid REFERENCES app_user(id),
    ADD COLUMN applied_at          timestamptz;

CREATE FUNCTION trend_internal() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('lims.trend_internal', true), '') = '1' $$;

-- QA status follows what the chart is: a QA reviewable chart waits for QA after it is made and after every change to
-- what it charts, its rules or its frozen limits; approval and the record of applied limits are written only by the
-- functions below. Taking a chart off QA review is QA's decision (trending.approve).
CREATE FUNCTION trend_chart_qa_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
    IF in_group_sync() OR trend_internal() THEN RETURN NEW; END IF;
    -- a chart in QC Review is always QA reviewed
    IF NEW.show_in_review AND NOT NEW.qa_review THEN
        IF TG_OP = 'UPDATE' AND OLD.qa_review AND OLD.show_in_review THEN RAISE EXCEPTION 'A chart shown in QC Review is always QA reviewed: take it out of QC Review first'; END IF;
        NEW.qa_review := true;
    END IF;
    IF TG_OP = 'INSERT' THEN
        NEW.qa_status := CASE WHEN NEW.qa_review THEN 'Awaiting QA' ELSE 'Not required' END;
        NEW.qa_approved_by := NULL; NEW.qa_approved_at := NULL; NEW.qa_signature_id := NULL;
        NEW.applied_version_id := NULL; NEW.applied_by := NULL; NEW.applied_at := NULL;
        RETURN NEW;
    END IF;
    IF (NEW.qa_status, NEW.qa_approved_by, NEW.qa_approved_at, NEW.qa_signature_id, NEW.applied_version_id, NEW.applied_by, NEW.applied_at)
       IS DISTINCT FROM (OLD.qa_status, OLD.qa_approved_by, OLD.qa_approved_at, OLD.qa_signature_id, OLD.applied_version_id, OLD.applied_by, OLD.applied_at) THEN
        RAISE EXCEPTION 'A chart''s QA approval is given by QA''s signed approval, not edited';
    END IF;
    IF OLD.qa_review AND NOT NEW.qa_review THEN
        PERFORM require_permission_at('trending.approve', NEW.site_id);
    END IF;
    changed := (NEW.source, NEW.params, NEW.rules, NEW.frozen_cl, NEW.frozen_sigma) IS DISTINCT FROM (OLD.source, OLD.params, OLD.rules, OLD.frozen_cl, OLD.frozen_sigma);
    IF NOT NEW.qa_review THEN
        NEW.qa_status := 'Not required'; NEW.qa_approved_by := NULL; NEW.qa_approved_at := NULL; NEW.qa_signature_id := NULL;
    ELSIF changed OR NOT OLD.qa_review OR NEW.status = 'Inactive' AND OLD.status <> 'Inactive' THEN
        NEW.qa_status := CASE WHEN NEW.status = 'Inactive' THEN OLD.qa_status ELSE 'Awaiting QA' END;
        IF NEW.status <> 'Inactive' THEN NEW.qa_approved_by := NULL; NEW.qa_approved_at := NULL; NEW.qa_signature_id := NULL; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_qa BEFORE INSERT OR UPDATE ON trend_chart FOR EACH ROW EXECUTE FUNCTION trend_chart_qa_rules();

-- Charts already shown in QC Review are QA reviewed from now on: they wait for QA's approval before they show again
SELECT set_config('lims.trend_internal', '1', true);
UPDATE trend_chart SET qa_review = true, qa_status = 'Awaiting QA' WHERE show_in_review AND status = 'Active';
SELECT set_config('lims.trend_internal', '', true);

-- QA approves a chart and its limits: signed ("Approved by"), trending.approve at the chart's lab, never by whoever made
-- the chart, last changed it or froze its limits
CREATE FUNCTION approve_trend_chart(p_chart uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c trend_chart;
BEGIN
    SELECT * INTO c FROM trend_chart WHERE id = p_chart FOR UPDATE;
    IF c.id IS NULL THEN RAISE EXCEPTION 'Chart not found'; END IF;
    PERFORM require_permission_at('trending.approve', c.site_id);
    IF c.status <> 'Active' THEN RAISE EXCEPTION 'A retired chart is not approved'; END IF;
    IF NOT c.qa_review THEN RAISE EXCEPTION '% is not set for QA review', c.chart_code; END IF;
    IF c.qa_status = 'Approved' THEN RAISE EXCEPTION '% is already approved', c.chart_code; END IF;
    IF current_app_user() IN (c.created_by, c.modified_by) OR current_app_user() IS NOT DISTINCT FROM c.frozen_by THEN
        RAISE EXCEPTION 'You made or changed % (or froze its limits): someone else approves it', c.chart_code;
    END IF;
    PERFORM assert_signed('approve a trend chart');
    PERFORM set_config('lims.trend_internal', '1', true);
    UPDATE trend_chart SET qa_status = 'Approved', qa_approved_by = current_app_user(), qa_approved_at = clock_timestamp(),
           qa_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_chart;
    PERFORM set_config('lims.trend_internal', '', true);
END $$;

-- What a QC chart can carry into its test: one QC check (type and criterion) and one analyte of one test, with frozen
-- limits, approved by QA. Returns the limits (centre line ± 3 sigma) and why not, when it cannot.
CREATE FUNCTION trend_limits_for_test(p_chart uuid) RETURNS TABLE (test_id uuid, qc_type text, limit_type text, analyte_id uuid, lcl numeric, ucl numeric, problem text)
LANGUAGE plpgsql STABLE AS $$
DECLARE c trend_chart; p jsonb;
BEGIN
    SELECT * INTO c FROM trend_chart WHERE id = p_chart; p := COALESCE(c.params, '{}');
    test_id := NULLIF(p->>'test_id', '')::uuid; qc_type := p->>'qc_type'; limit_type := p->>'limit_type';
    analyte_id := CASE WHEN COALESCE(p->>'analyte_id', '') ~ '^[0-9a-f-]{36}$' THEN (p->>'analyte_id')::uuid END;
    IF c.frozen_cl IS NOT NULL THEN lcl := c.frozen_cl - 3 * c.frozen_sigma; ucl := c.frozen_cl + 3 * c.frozen_sigma; END IF;
    problem := CASE
        WHEN c.id IS NULL THEN 'Chart not found'
        WHEN c.source <> 'qc' THEN 'Only a QC chart''s limits can be used for a test'
        WHEN test_id IS NULL OR qc_type IS NULL OR qc_type = '*' OR limit_type IS NULL THEN 'The chart must chart one QC check of one test'
        WHEN analyte_id IS NULL THEN 'The chart must chart one analyte (not each analyte, or every analyte together)'
        WHEN c.frozen_cl IS NULL THEN 'Freeze the limits from a baseline first'
        WHEN NOT c.qa_review OR c.qa_status <> 'Approved' THEN 'QA approves the chart and its limits first'
        WHEN c.status <> 'Active' THEN 'The chart is retired'
        WHEN (SELECT shape FROM qc_limit_type WHERE qc_limit_type.limit_type = trend_limits_for_test.limit_type) = 'Qualitative' THEN 'A qualitative QC check has no numeric limits'
    END;
    RETURN NEXT;
END $$;

-- The server has written the limits into the test's Draft version (signed, in the same transaction): the chart records it
CREATE FUNCTION record_trend_limits_applied(p_chart uuid, p_version uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE c trend_chart; x record;
BEGIN
    SELECT * INTO c FROM trend_chart WHERE id = p_chart FOR UPDATE;
    SELECT * INTO x FROM trend_limits_for_test(p_chart);
    IF x.problem IS NOT NULL THEN RAISE EXCEPTION '%', x.problem; END IF;
    IF NOT EXISTS (SELECT 1 FROM test_version v WHERE v.id = p_version AND v.test_id = x.test_id AND v.status = 'Draft') THEN
        RAISE EXCEPTION 'The limits go into a Draft version of the chart''s test';
    END IF;
    PERFORM require_permission_at('methods.design', c.site_id);
    PERFORM assert_signed('carry a chart''s limits into a test');
    PERFORM set_config('lims.trend_internal', '1', true);
    UPDATE trend_chart SET applied_version_id = p_version, applied_by = current_app_user(), applied_at = clock_timestamp() WHERE id = p_chart;
    PERFORM set_config('lims.trend_internal', '', true);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
