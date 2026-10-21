-- LIMS3 schema, migration 025: WD-6.1, objective evidence for workflow verification (Alex Kiddle, 2026-10-13: "there
-- needs to be objective evidence so screenshots are something that we would love to have"; "make the next slice for the
-- verification piece"). Built by Claude in the cloud.
--  - After a run, the server opens every page the run's checks point to (each batch step, the review, the results, the
--    samples, the order) in a headless browser, as the person capturing it (the executor, right after the run), and keeps a full-page screenshot of
--    each: stamped on the image with the verification, the page, the time and who captured it, stored unchanged with its
--    SHA-256, linked to the checks it shows. Captured once per verification, signed "Evidence captured by".
--  - QA signs the report only once the evidence is captured.
--  - The protocol and report export as a Word document (server only; nothing stored).

BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);

ALTER TABLE workflow_verification ADD COLUMN evidence_captured_at timestamptz;
ALTER TABLE workflow_verification ADD COLUMN evidence_captured_by uuid REFERENCES app_user(id);
ALTER TABLE workflow_verification ADD COLUMN evidence_signature_id uuid REFERENCES signature_event(id);
ALTER TABLE workflow_verification ADD COLUMN evidence_note text;   -- e.g. pages that could not be captured

CREATE TABLE verification_evidence (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    verification_id  uuid NOT NULL REFERENCES workflow_verification(id),
    seq              integer NOT NULL,                 -- E-01, E-02... in the report
    title            text NOT NULL CHECK (btrim(title) <> ''),
    page_ref         text NOT NULL,                    -- the page shown (#/testing/batches/...)
    check_codes      text[] NOT NULL DEFAULT '{}',     -- the checks it is evidence for
    document_id      uuid NOT NULL REFERENCES document_file(id),
    sha256           text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    width_px         integer,
    height_px        integer,
    captured_at      timestamptz NOT NULL,
    record_version   integer NOT NULL DEFAULT 1,
    created_at       timestamptz NOT NULL DEFAULT now(),
    created_by       uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at      timestamptz NOT NULL DEFAULT now(),
    modified_by      uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (verification_id, seq)
);
CALL make_gxp('verification_evidence', false);
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON verification_evidence FOR EACH ROW EXECUTE FUNCTION verification_tables_rules();
CREATE FUNCTION verification_evidence_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Verification evidence is kept exactly as captured'; END $$;
CREATE TRIGGER a00_frozen BEFORE UPDATE ON verification_evidence FOR EACH ROW EXECUTE FUNCTION verification_evidence_frozen();

-- Record the captured evidence (signed "Evidence captured by"): once, after the run, before QA signs the report.
-- p_items: [{title, page_ref, check_codes, document_id, sha256, width, height, captured_at}]; the image must be the stored
-- file with that SHA-256 (the database checks it).
CREATE FUNCTION record_verification_evidence(p_id uuid, p_items jsonb, p_note text DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE w workflow_verification; x jsonb; n integer := 0; d document_file;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    IF NOT (has_permission_at('methods.design', w.site_id) OR has_permission_at('methods.verify', w.site_id)) THEN
        PERFORM require_methods_permission('methods.design', w.site_id);
    END IF;
    PERFORM assert_signed('record verification evidence');
    IF w.status <> 'Executed' THEN RAISE EXCEPTION '% is %: evidence is captured after the run and before the report is signed', w.verification_code, w.status; END IF;
    IF w.evidence_captured_at IS NOT NULL THEN RAISE EXCEPTION 'The evidence of % was already captured', w.verification_code; END IF;
    IF jsonb_array_length(COALESCE(p_items, '[]')) = 0 THEN RAISE EXCEPTION 'No evidence to record'; END IF;
    PERFORM ensure_reason('Verification evidence captured');
    PERFORM set_verification_internal(true);
    FOR x IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        n := n + 1;
        SELECT * INTO d FROM document_file WHERE id = (x->>'document_id')::uuid;
        IF d.id IS NULL OR encode(sha256(d.content), 'hex') <> x->>'sha256' OR d.mime_type <> 'image/png' THEN
            RAISE EXCEPTION 'Evidence % is not the stored image it claims to be', n;
        END IF;
        INSERT INTO verification_evidence (verification_id, seq, title, page_ref, check_codes, document_id, sha256, width_px, height_px, captured_at)
        VALUES (p_id, n, x->>'title', x->>'page_ref', ARRAY(SELECT jsonb_array_elements_text(COALESCE(x->'check_codes', '[]'))),
                d.id, x->>'sha256', (x->>'width')::int, (x->>'height')::int, (x->>'captured_at')::timestamptz);
    END LOOP;
    UPDATE workflow_verification SET evidence_captured_at = clock_timestamp(), evidence_captured_by = current_app_user(),
           evidence_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid, evidence_note = NULLIF(btrim(p_note), '')
     WHERE id = p_id;
    PERFORM set_verification_internal(false);
    RETURN n;
END $$;

-- QA signs the report (as in 024) only once the evidence is captured
CREATE OR REPLACE FUNCTION sign_verification_report(p_id uuid, p_conclusion text, p_justifications jsonb DEFAULT '{}') RETURNS text LANGUAGE plpgsql AS $$
DECLARE w workflow_verification; rq record; j text;
BEGIN
    SELECT * INTO w FROM workflow_verification WHERE id = p_id FOR UPDATE;
    IF w.id IS NULL THEN RAISE EXCEPTION 'Verification not found'; END IF;
    PERFORM require_methods_permission('methods.verify', w.site_id);
    PERFORM assert_signed('sign a verification report');
    IF w.status <> 'Executed' THEN RAISE EXCEPTION '% is %: the report is signed after the run', w.verification_code, w.status; END IF;
    IF w.executed_by = current_app_user() THEN RAISE EXCEPTION 'You executed this verification, so someone else (QA) must sign its report'; END IF;
    IF COALESCE(btrim(p_conclusion), '') = '' THEN RAISE EXCEPTION 'Write the report''s conclusion'; END IF;
    IF w.evidence_captured_at IS NULL THEN
        RAISE EXCEPTION 'Capture the evidence (screenshots of the run''s pages) before the report is signed';
    END IF;
    PERFORM set_verification_internal(true);
    FOR rq IN SELECT * FROM verification_requirement WHERE verification_id = p_id AND result = 'Not tested' ORDER BY sort_order LOOP
        j := btrim(COALESCE(p_justifications->>rq.req_code, ''));
        IF j = '' THEN RAISE EXCEPTION '% was not tested: write why that is acceptable', rq.req_code; END IF;
        UPDATE verification_requirement SET qa_justification = j WHERE id = rq.id;
    END LOOP;
    PERFORM ensure_reason('Verification report signed');
    UPDATE workflow_verification SET status = 'Report signed', report_conclusion = btrim(p_conclusion), report_signed_by = current_app_user(),
           report_signed_at = clock_timestamp(), report_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = p_id;
    PERFORM set_verification_internal(false);
    RETURN w.outcome;
END $$;

ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_wd6;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'verification_evidence' THEN
        RETURN jsonb_build_object('label', 'Verification evidence ' || COALESCE((SELECT verification_code FROM workflow_verification WHERE id = (r->>'verification_id')::uuid), '')
                                           || ' E-' || lpad(COALESCE(r->>'seq', ''), 2, '0'),
                                  'link', '#/verification/' || (r->>'verification_id'));
    END IF;
    RETURN audit_record_ref_wd6(p_table, p_id, r);
END $$;

COMMIT;
