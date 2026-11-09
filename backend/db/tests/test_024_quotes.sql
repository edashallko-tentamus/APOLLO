-- Verification for migration 029: standalone quotes. Quote codes (Q-), the kind is fixed, the quote's contact belongs
-- to the client, who issued and who rejected, sending (only an issued quote, to a contact of the client with an
-- email, with the stored PDF; the email in the Outbox with the link and the PDF), the client's answer through the link
-- (accept or decline once, a name required, not after expiry), the quote list, and that an accepted quote's tests
-- can be ordered. The PDF is made by the server (server/quotes.js) and exercised by tests/e2e_quotes.js.
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.qas(u text) RETURNS text LANGUAGE sql AS $$
  SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false) $$;
CREATE OR REPLACE FUNCTION pg_temp.qpdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
CREATE OR REPLACE FUNCTION pg_temp.qsha(d uuid) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(content), 'hex') FROM document_file WHERE id = d $$;
CREATE OR REPLACE FUNCTION pg_temp.qv(code text) RETURNS uuid LANGUAGE sql AS $$
  SELECT pv.id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_code = code ORDER BY pv.version_no DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.qsite() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;

SELECT pg_temp.qas('akiddle');
SELECT set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
-- fixture: a client with a contact, and a contact of another client
INSERT INTO client (legal_name, account_status) VALUES ('Quote Test Foods Inc', 'Active'), ('Quote Other Co', 'Active');
INSERT INTO contact (first_name, last_name, email) VALUES ('Quinn', 'Buyer', 'quinn@quote-test.example'), ('Olga', 'Other', 'olga@quote-other.example');
INSERT INTO client_contact (client_id, contact_id, roles)
SELECT c.id, ct.id, '{PRIMARY}'::text[] FROM client c, contact ct WHERE c.legal_name = 'Quote Test Foods Inc' AND ct.first_name = 'Quinn'
UNION ALL SELECT c.id, ct.id, '{PRIMARY}' FROM client c, contact ct WHERE c.legal_name = 'Quote Other Co' AND ct.first_name = 'Olga';

-- 1. codes, kind, contact
INSERT INTO project (client_id, project_name, kind, quote_contact_id)
SELECT c.id, 'Rule test quote A', 'Quote', ct.id FROM client c, contact ct WHERE c.legal_name = 'Quote Test Foods Inc' AND ct.first_name = 'Quinn';
INSERT INTO project (client_id, project_name, kind) SELECT id, 'Rule test quote B', 'Quote' FROM client WHERE legal_name = 'Quote Test Foods Inc';
INSERT INTO project (client_id, project_name) SELECT id, 'Rule test project' FROM client WHERE legal_name = 'Quote Test Foods Inc';
SELECT pg_temp.expect_true('A quote gets a Q- code, a project keeps its PRJ- code',
  (SELECT bool_and(CASE WHEN kind = 'Quote' THEN project_code ~ '^Q-\d{5}$' ELSE project_code ~ '^PRJ-\d{5}$' END) FROM project WHERE project_name LIKE 'Rule test %'));
SELECT pg_temp.expect_true('The person creating it owns it (prepared by)',
  (SELECT owner_id = (SELECT id FROM app_user WHERE username = 'akiddle') FROM project WHERE project_name = 'Rule test quote A'));
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): a quote never becomes a project (kind is not written after the insert)
-- Moved to the Java backend in migration 061 (JUnit: QuoteRulesTest): the quote is for an active contact of the client

CREATE TEMP TABLE qt AS SELECT p.project_code, new_project_version(p.id) AS vid FROM project p WHERE p.project_name IN ('Rule test quote A', 'Rule test quote B');
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity)
SELECT qt.vid, c.test_id, 2 FROM qt, (SELECT test_id FROM test_catalogue WHERE test_status = 'Active' ORDER BY test_code LIMIT 2) c;
UPDATE quoted_test_configuration SET final_price = list_price WHERE project_version_id IN (SELECT vid FROM qt);

-- 2. sending
SELECT pg_temp.expect_error_like('Only an issued quote is sent', $$SELECT send_quote(pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')),
  (SELECT id FROM contact WHERE first_name = 'Quinn'), pg_temp.qpdf('a0'), pg_temp.qsha(pg_temp.qpdf('a0')), pg_temp.qsite(), '', 'http://lab.example')$$, 'Only an issued quote');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id IN (SELECT vid FROM qt);
SELECT pg_temp.expect_true('Issuing records who issued it', (SELECT bool_and(quoted_by = (SELECT id FROM app_user WHERE username = 'akiddle')) FROM project_version WHERE id IN (SELECT vid FROM qt)));
SELECT pg_temp.expect_error_like('Sent only to a contact of the client', $$SELECT send_quote(pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')),
  (SELECT id FROM contact WHERE first_name = 'Olga'), pg_temp.qpdf('a1'), pg_temp.qsha(pg_temp.qpdf('a1')), pg_temp.qsite(), '', 'http://lab.example')$$, 'active contact of the client');
SELECT pg_temp.expect_error_like('The PDF must be the stored file', $$SELECT send_quote(pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')),
  (SELECT id FROM contact WHERE first_name = 'Quinn'), pg_temp.qpdf('a3'), repeat('0', 64), pg_temp.qsite(), '', 'http://lab.example')$$, 'stored file');
SELECT pg_temp.qas('wd.ana2');
SELECT pg_temp.expect_error_like('Sending needs quotes.edit', $$SELECT send_quote(pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')),
  (SELECT id FROM contact WHERE first_name = 'Quinn'), pg_temp.qpdf('a4'), pg_temp.qsha(pg_temp.qpdf('a4')), pg_temp.qsite(), '', 'http://lab.example')$$, 'quotes.edit');
SELECT pg_temp.qas('akiddle');
CREATE TEMP TABLE qsent AS SELECT send_quote(pg_temp.qv(p.project_code), (SELECT id FROM contact WHERE first_name = 'Quinn'), d.id, pg_temp.qsha(d.id), pg_temp.qsite(), 'As discussed', 'http://lab.example/') AS mail
  FROM project p, LATERAL (SELECT pg_temp.qpdf('quote ' || p.project_code) AS id) d WHERE p.project_name IN ('Rule test quote A', 'Rule test quote B');
SELECT pg_temp.expect_true('Sent: the version records when, by whom, to whom, the PDF and a link token',
  (SELECT bool_and(sent_at IS NOT NULL AND sent_by IS NOT NULL AND sent_to_contact_id = (SELECT id FROM contact WHERE first_name = 'Quinn') AND quote_document_id IS NOT NULL AND length(client_token) = 64)
     FROM project_version WHERE id IN (SELECT vid FROM qt)));
SELECT pg_temp.expect_true('The email is in the Outbox for the lab, with the message, the link and the PDF',
  (SELECT bool_and(e.template = 'Quote Sent' AND e.site_id = pg_temp.qsite() AND e.project_version_id IS NOT NULL AND e.document_id IS NOT NULL AND e.lab_order_id IS NULL
      AND e.body LIKE '%As discussed%' AND e.body LIKE '%http://lab.example/quote-response.html?t=%' AND e.to_address = 'quinn@quote-test.example')
     FROM email_outbox e WHERE e.id IN (SELECT mail FROM qsent)));
CREATE TEMP TABLE qre AS SELECT send_quote(pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')),
     (SELECT id FROM contact WHERE first_name = 'Quinn'), d, pg_temp.qsha(d), pg_temp.qsite(), '', 'http://lab.example') AS mail FROM pg_temp.qpdf('resend') d;
SELECT pg_temp.expect_true('Sending again keeps the same link', (SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A')))
  = (SELECT substring(e.body FROM 't=([0-9a-f]{64})') FROM email_outbox e WHERE e.id = (SELECT mail FROM qre)));

-- 3. the client's answer through the link
SELECT pg_temp.qas('system');
SELECT pg_temp.expect_error_like('A wrong link is refused', $$SELECT record_quote_response('nope', 'Accept', 'Quinn', '')$$, 'not valid');
SELECT pg_temp.expect_error_like('The client types their name', $$SELECT record_quote_response((SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A'))), 'Accept', ' ', '')$$, 'Type your name');
SELECT record_quote_response((SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A'))), 'Accept', 'Quinn Buyer', 'PO 1234');
SELECT pg_temp.expect_true('Accepted online: by the contact it was sent to, marked Client link, with the name and note',
  (SELECT status = 'Accepted' AND accepted_by_contact_id = (SELECT id FROM contact WHERE first_name = 'Quinn') AND decided_via = 'Client link' AND client_response_name = 'Quinn Buyer' AND client_response_note = 'PO 1234'
     FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A'))));
SELECT pg_temp.expect_error_like('Answered once', $$SELECT record_quote_response((SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote A'))), 'Decline', 'Quinn', '')$$, 'no longer be answered');
SELECT pg_temp.expect_true('An accepted quote''s tests can be ordered by the client',
  (SELECT count(*) = 2 FROM orderable_lines((SELECT id FROM client WHERE legal_name = 'Quote Test Foods Inc')) WHERE project_code = (SELECT project_code FROM project WHERE project_name = 'Rule test quote A')));
SELECT pg_temp.qas('akiddle');
-- (fixture only: the quote's validity runs out; an issued version is locked, so the rule triggers are bypassed for this one change)
SET session_replication_role = replica;
UPDATE project_version SET valid_until = current_date - 1 WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote B'));
SET session_replication_role = origin;
SELECT pg_temp.qas('system');
SELECT pg_temp.expect_error_like('An expired quote cannot be accepted online', $$SELECT record_quote_response((SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote B'))), 'Accept', 'Quinn', '')$$, 'expired');
SELECT record_quote_response((SELECT client_token FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote B'))), 'Decline', 'Quinn Buyer', 'Too slow');
SELECT pg_temp.expect_true('Declined online: Rejected, with the reason, marked Client link',
  (SELECT status = 'Rejected' AND rejected_reason = 'Too slow' AND decided_via = 'Client link' AND rejected_at IS NOT NULL FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote B'))));

-- 4. decisions by the lab, and the list
SELECT pg_temp.qas('akiddle');
INSERT INTO project (client_id, project_name, kind) SELECT id, 'Rule test quote C', 'Quote' FROM client WHERE legal_name = 'Quote Test Foods Inc';
INSERT INTO qt SELECT p.project_code, new_project_version(p.id) FROM project p WHERE p.project_name = 'Rule test quote C';
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price)
SELECT pg_temp.qv(p.project_code), c.test_id, 1, 10 FROM project p, (SELECT test_id FROM test_catalogue WHERE test_status = 'Active' ORDER BY test_code LIMIT 1) c WHERE p.project_name = 'Rule test quote C';
UPDATE project_version SET status = 'Quoted' WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote C'));
UPDATE project_version SET status = 'Rejected', rejected_reason = 'Price' WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote C'));
SELECT pg_temp.expect_true('Rejected by the lab: who and when recorded, marked Lab',
  (SELECT rejected_by = (SELECT id FROM app_user WHERE username = 'akiddle') AND rejected_at IS NOT NULL AND decided_via = 'Lab' FROM project_version WHERE id = pg_temp.qv((SELECT project_code FROM project WHERE project_name = 'Rule test quote C'))));
SELECT pg_temp.expect_true('The quote list: kind, owner, status, totals, the decision',
  (SELECT count(*) = 3 AND bool_and(kind = 'Quote' AND owner_name = 'Alex Kiddle') AND count(*) FILTER (WHERE status = 'Accepted' AND accepted_by_name = 'Quinn Buyer' AND total > 0) = 1
      AND count(*) FILTER (WHERE status = 'Rejected') = 2 FROM quote_list_view WHERE project_name LIKE 'Rule test quote %'));
SELECT new_project_version(id) FROM project WHERE project_name = 'Rule test project';
SELECT pg_temp.expect_true('The project is in the list too, as a project', EXISTS (SELECT 1 FROM quote_list_view WHERE project_name = 'Rule test project' AND kind = 'Project'));
SELECT pg_temp.expect_true('The audit trail links a quote to its page', (SELECT audit_record_ref('project', id, to_jsonb(p)) ->> 'href' LIKE '#/quotes/%' FROM project p WHERE project_name = 'Rule test quote A'));
SELECT pg_temp.expect_true('The quotation email is a template in the Outbox', EXISTS (SELECT 1 FROM email_template WHERE template_code = 'Quote Sent' AND body LIKE '%{{link}}%'));

SELECT set_config('lims.site_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
