-- Standalone quotes (Alex, 2026-10-14): a quote for a customer that is not a project. It works exactly like a project
-- quote (versions, catalogue list prices, final prices, analyte trimming, rush terms, specifications, ordering against
-- the accepted version), so it IS a project row of kind 'Quote' and reuses all of that machinery. What is new:
--  - Q-00001 codes; the sales person who owns the quote (prepared by) and the contact it is for;
--  - who issued each version, when it was sent, to whom, and the client's answer (accept or decline) through a link
--    in the email, without signing in;
--  - "Quote Sent" email template (Outbox), with the quote PDF attached;
--  - the quote list (standalone quotes and project quotes together): open, accepted, rejected, expired; prepared by;
--    labs on the quote (a sales person adds tests from every lab's catalogue in one quote).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 029: standalone quotes', true);

-------------------------------------------------------------------------------
-- 1. A QUOTE IS A PROJECT OF KIND 'Quote'
-------------------------------------------------------------------------------
ALTER TABLE project ADD COLUMN kind text NOT NULL DEFAULT 'Project' CHECK (kind IN ('Project','Quote'));
ALTER TABLE project ADD COLUMN owner_id uuid REFERENCES app_user(id);          -- the sales person (NULL on older rows: the creator)
ALTER TABLE project ALTER COLUMN owner_id SET DEFAULT current_app_user();
ALTER TABLE project ADD COLUMN quote_contact_id uuid REFERENCES contact(id);   -- who the quote is for

CREATE SEQUENCE quote_code_seq;
ALTER TABLE project ALTER COLUMN project_code DROP DEFAULT;
CREATE FUNCTION project_code_assign() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.project_code IS NULL THEN
        NEW.project_code := CASE WHEN NEW.kind = 'Quote' THEN 'Q-' || lpad(nextval('quote_code_seq')::text, 5, '0')
                                 ELSE 'PRJ-' || lpad(nextval('project_code_seq')::text, 5, '0') END;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.kind IS DISTINCT FROM OLD.kind THEN RAISE EXCEPTION 'A project cannot become a quote, or a quote a project'; END IF;
    IF NEW.quote_contact_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = NEW.client_id AND cc.contact_id = NEW.quote_contact_id AND cc.status = 'Active') THEN
        RAISE EXCEPTION 'The quote''s contact must be an active contact of the client';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a00_project_code BEFORE INSERT OR UPDATE ON project FOR EACH ROW EXECUTE FUNCTION project_code_assign();

-------------------------------------------------------------------------------
-- 2. WHO ISSUED, SENT AND DECIDED EACH VERSION
-------------------------------------------------------------------------------
ALTER TABLE project_version
    ADD COLUMN quoted_by            uuid REFERENCES app_user(id),
    ADD COLUMN sent_at              timestamptz,
    ADD COLUMN sent_by              uuid REFERENCES app_user(id),
    ADD COLUMN sent_to_contact_id   uuid REFERENCES contact(id),
    ADD COLUMN quote_document_id    uuid REFERENCES document_file(id),          -- the PDF last sent
    ADD COLUMN client_token         text UNIQUE,
    ADD COLUMN decided_via          text CHECK (decided_via IN ('Lab','Client link')),
    ADD COLUMN client_response_name text,
    ADD COLUMN client_response_note text,
    ADD COLUMN rejected_reason      text,
    ADD COLUMN rejected_at          timestamptz,
    ADD COLUMN rejected_by          uuid REFERENCES app_user(id);

CREATE FUNCTION project_version_quote_trail() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'Quoted' AND OLD.status IS DISTINCT FROM 'Quoted' THEN NEW.quoted_by := current_app_user(); END IF;
    IF NEW.status = 'Rejected' AND OLD.status IS DISTINCT FROM 'Rejected' THEN
        NEW.rejected_at := clock_timestamp(); NEW.rejected_by := current_app_user();
        NEW.decided_via := COALESCE(NEW.decided_via, 'Lab');
    END IF;
    IF NEW.status = 'Accepted' AND OLD.status IS DISTINCT FROM 'Accepted' THEN NEW.decided_via := COALESCE(NEW.decided_via, 'Lab'); END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER c_project_version_quote_trail BEFORE UPDATE ON project_version FOR EACH ROW EXECUTE FUNCTION project_version_quote_trail();

-------------------------------------------------------------------------------
-- 3. THE EMAIL (Outbox): a quote email belongs to a lab and a quote version, not to an order
-------------------------------------------------------------------------------
ALTER TABLE email_outbox ADD COLUMN project_version_id uuid REFERENCES project_version(id);
ALTER TABLE email_outbox ADD COLUMN site_id uuid REFERENCES lab_site(id);

INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
('Quote Sent', 'Quotation sent to a client',
 'Quotation {{quote_code}} from {{site_name}}',
 E'Dear {{first_name}},\n\nThank you for your interest in our testing services. Please find attached our quotation {{quote_code}} (version {{version_no}}) for {{client_name}}.\n\n{{message}}Quote total: {{total}} (per the quantities listed; prices are per sample)\nValid until: {{valid_until}}\n\nYou can review the quotation and accept or decline it online, without signing in:\n{{link}}\n\nOnce the quotation is accepted, samples can be submitted against it at the prices shown. If you have any questions, simply reply to this email.\n\nKind regards,\n{{staff_name}}\n{{site_name}}',
 '{{first_name}}, {{quote_code}}, {{version_no}}, {{client_name}}, {{message}}, {{total}}, {{valid_until}}, {{link}}, {{staff_name}}, {{site_name}}');

-- Send an issued (Quoted) version to a contact of the client: the PDF made by the server is stored and attached; the
-- client gets a link to accept or decline. Sending again (e.g. to another contact) keeps the same link.
CREATE FUNCTION send_quote(p_version uuid, p_contact uuid, p_doc uuid, p_sha text, p_site uuid, p_message text, p_base text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v project_version; p project; ct contact; d document_file; cl client; si lab_site; v_tok text; v_mail uuid; v_total numeric;
BEGIN
    SELECT * INTO v FROM project_version WHERE id = p_version;
    IF v.id IS NULL THEN RAISE EXCEPTION 'Quote version not found'; END IF;
    SELECT * INTO p FROM project WHERE id = v.project_id;
    IF NOT has_permission('quotes.edit') THEN RAISE EXCEPTION 'You do not have permission to send quotes (quotes.edit)'; END IF;
    IF v.status <> 'Quoted' THEN RAISE EXCEPTION 'Only an issued quote can be sent (this version is %)', v.status; END IF;
    IF v.valid_until IS NOT NULL AND v.valid_until < current_date THEN RAISE EXCEPTION 'This quote expired on %: start a new version', v.valid_until; END IF;
    SELECT ct2.* INTO ct FROM contact ct2 JOIN client_contact cc ON cc.contact_id = ct2.id
     WHERE ct2.id = p_contact AND cc.client_id = p.client_id AND cc.status = 'Active' AND ct2.status = 'Active';
    IF ct.id IS NULL THEN RAISE EXCEPTION 'Send the quote to an active contact of the client'; END IF;
    IF COALESCE(btrim(ct.email), '') = '' THEN RAISE EXCEPTION '% has no email address', ct.first_name || ' ' || ct.last_name; END IF;
    SELECT * INTO d FROM document_file WHERE id = p_doc;
    IF d.id IS NULL OR d.mime_type <> 'application/pdf' OR encode(sha256(d.content), 'hex') <> p_sha THEN RAISE EXCEPTION 'The quote PDF is not the stored file it claims to be'; END IF;
    SELECT * INTO cl FROM client WHERE id = p.client_id;
    SELECT * INTO si FROM lab_site WHERE id = p_site;
    v_tok := COALESCE(v.client_token, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
    SELECT COALESCE(sum(line_total), 0) INTO v_total FROM quoted_test_configuration WHERE project_version_id = v.id AND status = 'Active';
    PERFORM ensure_reason('Quote sent to the client');
    UPDATE project_version SET sent_at = clock_timestamp(), sent_by = current_app_user(), sent_to_contact_id = ct.id, quote_document_id = d.id, client_token = v_tok
     WHERE id = v.id;
    v_mail := queue_email('Quote Sent', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
        'first_name', ct.first_name, 'quote_code', p.project_code, 'version_no', v.version_no, 'client_name', COALESCE(cl.display_name, cl.legal_name),
        'message', CASE WHEN COALESCE(btrim(p_message), '') = '' THEN '' ELSE btrim(p_message) || E'\n\n' END,
        'total', '$' || to_char(v_total, 'FM999,999,990.00'), 'valid_until', COALESCE(to_char(v.valid_until, 'FMMonth DD, YYYY'), 'no expiry date'),
        'link', rtrim(COALESCE(p_base, ''), '/') || '/quote-response.html?t=' || v_tok,
        'staff_name', (SELECT full_name FROM app_user WHERE id = current_app_user()), 'site_name', COALESCE(si.site_name, 'Tentamus North America')),
        NULL, NULL, d.id);
    UPDATE email_outbox SET project_version_id = v.id, site_id = p_site WHERE id = v_mail;
    RETURN v_mail;
END $$;

-- The client's answer through the link (no sign-in; recorded as the system user with the name they typed). Accepting
-- records the contact the quote was sent to as the acceptor.
CREATE FUNCTION record_quote_response(p_token text, p_decision text, p_name text, p_note text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v project_version; p project; gs text;
BEGIN
    SELECT * INTO v FROM project_version WHERE client_token = p_token AND p_token IS NOT NULL;
    IF v.id IS NULL THEN RAISE EXCEPTION 'This link is not valid: please contact the laboratory'; END IF;
    SELECT * INTO p FROM project WHERE id = v.project_id;
    IF v.status <> 'Quoted' THEN RAISE EXCEPTION 'This quotation is % and can no longer be answered online', lower(v.status::text); END IF;
    IF p_decision NOT IN ('Accept','Decline') THEN RAISE EXCEPTION 'Accept or decline the quotation'; END IF;
    IF p_decision = 'Accept' AND v.valid_until IS NOT NULL AND v.valid_until < current_date THEN
        RAISE EXCEPTION 'This quotation expired on %: please contact the laboratory for a new one', to_char(v.valid_until, 'FMMonth DD, YYYY');
    END IF;
    IF COALESCE(btrim(p_name), '') = '' THEN RAISE EXCEPTION 'Type your name'; END IF;
    PERFORM set_config('lims.reason', 'Client ' || CASE WHEN p_decision = 'Accept' THEN 'accepted' ELSE 'declined' END || ' the quotation through the link', true);
    gs := COALESCE(current_setting('lims.group_sync', true), '');
    PERFORM set_config('lims.group_sync', '1', true);
    IF p_decision = 'Accept' THEN
        UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = v.sent_to_contact_id, decided_via = 'Client link',
               client_response_name = btrim(p_name), client_response_note = NULLIF(btrim(p_note), '') WHERE id = v.id;
    ELSE
        UPDATE project_version SET status = 'Rejected', decided_via = 'Client link', rejected_reason = NULLIF(btrim(p_note), ''),
               client_response_name = btrim(p_name), client_response_note = NULLIF(btrim(p_note), '') WHERE id = v.id;
    END IF;
    PERFORM set_config('lims.group_sync', gs, true);
    RETURN p.project_code;
END $$;

-------------------------------------------------------------------------------
-- 4. THE QUOTE LIST: the latest version of every quote and project, with who prepared it and the labs on it
-------------------------------------------------------------------------------
CREATE VIEW quote_list_view AS
SELECT p.id AS project_id, p.kind, p.project_code, p.project_name, p.client_id, COALESCE(cl.display_name, cl.legal_name) AS client_name,
       COALESCE(p.owner_id, p.created_by) AS owner_id, ou.full_name AS owner_name,
       p.quote_contact_id, NULLIF(btrim(COALESCE(qc.first_name, '') || ' ' || COALESCE(qc.last_name, '')), '') AS quote_contact_name,
       lv.id AS version_id, lv.version_no, lv.status::text AS status, lv.created_at AS version_created_at, lv.quoted_at, qu.full_name AS quoted_by_name,
       lv.valid_until, lv.sent_at, NULLIF(btrim(COALESCE(sc.first_name, '') || ' ' || COALESCE(sc.last_name, '')), '') AS sent_to_name, sc.email AS sent_to_email,
       NULLIF(btrim(COALESCE(ac.first_name, '') || ' ' || COALESCE(ac.last_name, '')), '') AS accepted_by_name, lv.accepted_at,
       lv.rejected_at, lv.rejected_reason, lv.decided_via, lv.client_response_name,
       (SELECT COALESCE(sum(q.line_total), 0) FROM quoted_test_configuration q WHERE q.project_version_id = lv.id AND q.status = 'Active') AS total,
       (SELECT count(*) FROM quoted_test_configuration q WHERE q.project_version_id = lv.id AND q.status = 'Active')::int AS line_count,
       (SELECT string_agg(DISTINCT COALESCE(s.site_code, 'Any lab'), ', ') FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
          LEFT JOIN lab_site s ON s.id = t.site_id WHERE q.project_version_id = lv.id AND q.status = 'Active') AS labs,
       ARRAY(SELECT DISTINCT t.site_id FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id
              WHERE q.project_version_id = lv.id AND q.status = 'Active' AND t.site_id IS NOT NULL) AS site_ids,
       lv.status IN ('Draft','Submitted for Quote','Quoted') AS is_open,
       (lv.status = 'Quoted' AND lv.valid_until IS NOT NULL AND lv.valid_until < current_date) AS past_valid,
       p.status::text AS project_status
  FROM project p
  JOIN client cl ON cl.id = p.client_id
  JOIN LATERAL (SELECT * FROM project_version pv WHERE pv.project_id = p.id ORDER BY pv.version_no DESC LIMIT 1) lv ON true
  LEFT JOIN app_user ou ON ou.id = COALESCE(p.owner_id, p.created_by)
  LEFT JOIN app_user qu ON qu.id = lv.quoted_by
  LEFT JOIN contact qc ON qc.id = p.quote_contact_id
  LEFT JOIN contact sc ON sc.id = lv.sent_to_contact_id
  LEFT JOIN contact ac ON ac.id = lv.accepted_by_contact_id;

-------------------------------------------------------------------------------
-- 5. AUDIT REFERENCES: a quote's records link to the quote
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_q1;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE x jsonb;
BEGIN
    IF p_table = 'project' AND r->>'kind' = 'Quote' THEN
        RETURN jsonb_build_object('label', 'Quote ' || COALESCE(r->>'project_code', ''), 'href', '#/quotes/' || p_id);
    END IF;
    RETURN audit_record_ref_q1(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
