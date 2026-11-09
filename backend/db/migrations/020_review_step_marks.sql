-- LIMS3 schema, migration 020: WD-3.1: the reviewer approves each step (Alex Kiddle, 2026-10-13; vault: "Decision -
-- QC Review Approves Each Step"). Built by Claude Code.
--  - When the workflow has finished (the batch is Awaiting Review), the reviewer opens each step and approves it with a
--    click: a recorded mark (who, when), not a signature (deck slide 16: an affirmative clicked act per step, one Part 11
--    signature for the release). Approve batch (signed "Reviewed by") is refused until every step is approved.
--  - Returning the batch reopens a step and those after it: their marks are withdrawn (kept in the audit trail) and
--    must be given again; earlier steps keep theirs. The reviewer can also undo a mark before approving the batch.
--  - Alex's answer for a QC Review in the middle of a workflow (e.g. a USP <51> timepoint): it covers everything done
--    so far. Not built yet: today every QC Review step completes when the whole batch is approved (open question on
--    releasing timepoints separately).

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

CREATE TABLE review_step_mark (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id        uuid NOT NULL REFERENCES test_batch(id),
    step_run_id     uuid NOT NULL REFERENCES step_run(id),
    status          record_status NOT NULL DEFAULT 'Active',     -- Inactive = withdrawn (undone, or the step was reopened)
    withdrawn_note  text,
    record_version  integer NOT NULL DEFAULT 1,
    created_at      timestamptz NOT NULL DEFAULT now(),
    created_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at     timestamptz NOT NULL DEFAULT now(),
    modified_by     uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CREATE UNIQUE INDEX review_step_mark_uq ON review_step_mark (step_run_id) WHERE status = 'Active';
CALL make_gxp('review_step_mark', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON review_step_mark FOR EACH ROW EXECUTE FUNCTION review_tables_rules();

-- The steps a reviewer approves: every step of the batch except the QC Review steps themselves
CREATE FUNCTION review_step_runs(p_batch uuid)
RETURNS TABLE (step_run_id uuid, step_name text, step_type text, sort_order integer, status text, mark_id uuid, marked_by uuid, marked_at timestamptz)
LANGUAGE sql STABLE AS $$
    SELECT r.id, ws.step_name, ws.step_type::text, ws.sort_order, r.status::text, m.id, m.created_by, m.created_at
      FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
      LEFT JOIN review_step_mark m ON m.step_run_id = r.id AND m.status = 'Active'
     WHERE r.batch_id = p_batch AND ws.step_type <> 'QC Review'
     ORDER BY ws.sort_order, ws.step_name
$$;

CREATE FUNCTION approve_review_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch; t text;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    b := assert_can_review(r.batch_id);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %: steps are approved once every bench step is completed', b.batch_code, b.status; END IF;
    SELECT ws.step_type::text INTO t FROM workflow_step ws WHERE ws.id = r.step_id;
    IF t = 'QC Review' THEN RAISE EXCEPTION 'The QC Review is approved with the batch (Approve batch)'; END IF;
    IF r.status <> 'Completed' THEN RAISE EXCEPTION 'Only a completed step can be approved'; END IF;
    IF EXISTS (SELECT 1 FROM review_step_mark WHERE step_run_id = p_step_run AND status = 'Active') THEN RETURN; END IF;
    PERFORM ensure_reason('Step approved in QC Review');
    PERFORM set_testing_internal(true);
    INSERT INTO review_step_mark (batch_id, step_run_id) VALUES (r.batch_id, p_step_run);
    PERFORM set_testing_internal(false);
END $$;

CREATE FUNCTION withdraw_review_step(p_step_run uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r step_run; b test_batch;
BEGIN
    SELECT * INTO r FROM step_run WHERE id = p_step_run;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Step not found'; END IF;
    b := assert_can_review(r.batch_id);
    IF b.status <> 'Awaiting Review' THEN RAISE EXCEPTION 'Batch % is %, not waiting for review', b.batch_code, b.status; END IF;
    PERFORM ensure_reason('Step approval undone in QC Review');
    PERFORM set_testing_internal(true);
    UPDATE review_step_mark SET status = 'Inactive', withdrawn_note = 'Undone by the reviewer' WHERE step_run_id = p_step_run AND status = 'Active';
    PERFORM set_testing_internal(false);
END $$;

-- A step that is reopened (returned by the reviewer, or reopened at the bench) loses its approval mark
CREATE FUNCTION review_marks_on_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE was text := COALESCE(current_setting('lims.testing_internal', true), '');
BEGIN
    IF OLD.status = 'Completed' AND NEW.status <> 'Completed'
       AND EXISTS (SELECT 1 FROM review_step_mark WHERE step_run_id = NEW.id AND status = 'Active') THEN
        PERFORM ensure_reason('Step reopened');
        PERFORM set_config('lims.testing_internal', '1', true);
        UPDATE review_step_mark SET status = 'Inactive', withdrawn_note = 'The step was reopened' WHERE step_run_id = NEW.id AND status = 'Active';
        PERFORM set_config('lims.testing_internal', was, true);   -- back to what the caller had (e.g. return_batch)
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER z_review_marks AFTER UPDATE OF status ON step_run FOR EACH ROW EXECUTE FUNCTION review_marks_on_reopen();

-- What still stops approval: as in 018, plus every step approved
CREATE OR REPLACE FUNCTION batch_review_problems(p_batch uuid) RETURNS TABLE (problem text) LANGUAGE plpgsql STABLE AS $$
#variable_conflict use_column
DECLARE b test_batch;
BEGIN
    SELECT * INTO b FROM test_batch WHERE id = p_batch;
    IF b.status <> 'Awaiting Review' THEN RETURN QUERY SELECT 'The batch is ' || b.status || ', not waiting for review'; RETURN; END IF;
    RETURN QUERY SELECT 'Step "' || s.step_name || '": not approved yet (open it and click Approve step)'
      FROM review_step_runs(p_batch) s WHERE s.mark_id IS NULL;
    RETURN QUERY SELECT i.sample_label || ' ' || i.analyte_name || ': ' || CASE WHEN jsonb_array_length(i.candidates) = 0 THEN 'no result' ELSE 'choose the reportable reading' END
      FROM batch_review_items(p_batch) i WHERE i.chosen_entry_id IS NULL;
    RETURN QUERY SELECT v.label || ' ' || COALESCE(v.analyte_name, '') || ' ' || v.limit_type || ': ' || lower(v.verdict) || ', accept it with a justification or return the batch'
      FROM batch_qc_verdicts(p_batch) v
     WHERE v.verdict IN ('Fail','Waiting')
       AND NOT EXISTS (SELECT 1 FROM qc_acceptance q WHERE q.batch_id = p_batch AND q.entry_id = v.entry_id AND q.analyte_id IS NOT DISTINCT FROM v.analyte_id
                         AND q.limit_type = v.limit_type AND q.status = 'Active');
END $$;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_wd31;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'review_step_mark' THEN
        RETURN jsonb_build_object('label', 'Step approved in review: ' || COALESCE((SELECT ws.step_name || ' (' || b.batch_code || ')' FROM step_run sr JOIN workflow_step ws ON ws.id = sr.step_id
                                     JOIN test_batch b ON b.id = sr.batch_id WHERE sr.id = (r->>'step_run_id')::uuid), ''),
                                  'link', '#/testing/batches/' || (r->>'batch_id'));
    END IF;
    RETURN audit_record_ref_wd31(p_table, p_id, r);
END $$;

COMMIT;
