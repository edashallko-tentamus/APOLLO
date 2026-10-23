-- Verification for migration 036: invoicing (I-1). Who invoices; what is ready (the COA issued to the client); claiming
-- work into one's own draft per lab order, which nobody else can change or issue; checking the price (a reason when it
-- differs from the order); a late rush billed at the tier whose turnaround was met (or standard), never a dearer one
-- or one missed too; taking lines off and releasing drafts; issuing (signed, numbered per lab, dated today, payment
-- terms), the PDF attached once in the issuing transaction, the email to the billing contacts and the QuickBooks
-- Online queue; an issued invoice never changes; credit notes (signed, with a reason; the work invoiced again or
-- not); the order's billing; the catch-up dated the Friday of the week the COA was issued, not sent.
-- Fixture: the completed work left by the earlier rule tests (Acme Irvine Site at CFL: LO-000003 and LO-000011).
SET search_path = lims, public;
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', 'Rule test', false);
SELECT set_config('lims.group_sync', '', false);
SELECT set_config('lims.invoice_internal', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (wrong error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_ok(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'PASS');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, 'FAIL: ' || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.iv_as(u text, sign boolean DEFAULT true) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false);
  PERFORM set_config('lims.site_id', (SELECT id::text FROM lab_site WHERE site_code = 'CFL'), false);
  IF sign THEN PERFORM script_signature('Rule test', false); ELSE PERFORM set_config('lims.signature_id', '', false); END IF;
  RETURN u;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ivu(u text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM app_user WHERE username = u $$;
CREATE OR REPLACE FUNCTION pg_temp.ivcfl() RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = 'CFL' $$;
-- the fixture sample numbered 999 of the day the earlier tests ran (its number carries that day's date)
CREATE OR REPLACE FUNCTION pg_temp.ivc(sfx text) RETURNS text LANGUAGE sql AS $$
  SELECT sample_code FROM sample WHERE sample_code ~ ('^CFL[0-9]{6}' || sfx || '$') ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.iv999() RETURNS text LANGUAGE sql AS $$
  SELECT sample_code FROM sample WHERE sample_code ~ '^CFL[0-9]{6}999$' ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.ivrt(smp text, tname text) RETURNS uuid LANGUAGE sql AS $$
  SELECT rt.id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN test t ON t.id = rt.test_id
   WHERE s.sample_code = smp AND t.test_name = tname AND rt.status <> 'Cancelled' ORDER BY rt.created_at LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.ivline(smp text, tname text) RETURNS invoice_line LANGUAGE sql AS $$
  SELECT l.* FROM invoice_line l WHERE l.id = test_invoice_line(pg_temp.ivrt(smp, tname)) $$;
CREATE OR REPLACE FUNCTION pg_temp.ivdraft(u text, ord text) RETURNS uuid LANGUAGE sql AS $$
  SELECT i.id FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id WHERE o.order_code = ord AND i.claimed_by = pg_temp.ivu(u) AND i.status = 'Draft' $$;
CREATE OR REPLACE FUNCTION pg_temp.ivpdf(t text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content)
  VALUES (t || '.pdf', 'application/pdf', length(t), encode(sha256(convert_to('%PDF-1.4 ' || t, 'UTF8')), 'hex'), convert_to('%PDF-1.4 ' || t, 'UTF8')) RETURNING id $$;
CREATE TEMP TABLE IF NOT EXISTS ivk (k text PRIMARY KEY, v text);
DELETE FROM ivk;

-- people: two in CFL's Accounting group, an Account Manager (view only), the analyst wd.ana (none)
SELECT pg_temp.iv_as('akiddle');
INSERT INTO app_user (username, full_name) VALUES ('inv.acc', 'INV Accounting'), ('inv.acc2', 'INV Accounting Two'), ('inv.am', 'INV Account Manager') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.ivu(u) FROM lab_group g, (VALUES ('inv.acc'), ('inv.acc2')) x(u)
 WHERE g.site_id = pg_temp.ivcfl() AND g.group_name = 'Accounting' ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id) SELECT g.id, pg_temp.ivu('inv.am') FROM lab_group g WHERE g.site_id = pg_temp.ivcfl() AND g.group_name = 'Account Manager' ON CONFLICT DO NOTHING;

-- 1. who invoices
SELECT pg_temp.expect_true('Accounting and General Managers issue invoices; Account and Project Managers see them; analysts neither',
  user_has_permission_at(pg_temp.ivu('inv.acc'), 'invoicing.issue', pg_temp.ivcfl())
  AND EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.ivcfl() AND g.group_name = 'General Manager' AND p.permission_code = 'invoicing.issue')
  AND EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.ivcfl() AND g.group_name = 'Project Manager' AND p.permission_code = 'invoicing.view')
  AND user_has_permission_at(pg_temp.ivu('inv.am'), 'invoicing.view', pg_temp.ivcfl())
  AND NOT user_has_permission_at(pg_temp.ivu('inv.am'), 'invoicing.issue', pg_temp.ivcfl())
  AND NOT EXISTS (SELECT 1 FROM lab_group g JOIN group_permission p ON p.group_id = g.id WHERE g.site_id = pg_temp.ivcfl() AND g.group_name = 'Analyst' AND p.permission_code LIKE 'invoicing.%'));

-- 2. what is ready: tests whose COA was issued to the client, not internal, not cancelled, not billed
SELECT pg_temp.expect_true('Ready to invoice: the completed work of LO-000003 and LO-000011, dated by the COA''s issue in the lab''s time zone',
  (SELECT count(*) FROM invoice_ready_view WHERE order_code IN ('LO-000003', 'LO-000011')) >= 6
  AND NOT EXISTS (SELECT 1 FROM invoice_ready_view WHERE completed_on IS NULL OR is_internal)
  AND (SELECT completed_on FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals'))
      = (test_reported_at(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) AT TIME ZONE 'America/Los_Angeles')::date);
SELECT pg_temp.expect_true('Work not yet on an issued COA, internal work (media qualification, verifications) and cancelled tests are not ready',
  NOT EXISTS (SELECT 1 FROM invoice_ready_view r JOIN requested_test rt ON rt.id = r.requested_test_id WHERE test_reported_at(rt.id) IS NULL AND NOT EXISTS (SELECT 1 FROM requested_test x WHERE x.retest_of_id = rt.id))
  AND NOT EXISTS (SELECT 1 FROM invoice_ready_view r JOIN client c ON c.id = r.client_id WHERE c.is_internal)
  AND EXISTS (SELECT 1 FROM billable_test_view b WHERE b.completed_at IS NULL AND b.lab_order_id IN (SELECT id FROM lab_order WHERE order_code = 'LO-000003')));

-- 3. a late rush (fixture, written directly with triggers off: WD Metals on CFL261015999 rushed at 1 business day,
--    logged 14 days before its COA; standard turnaround 15 business days; tiers 1, 3 and 12 business days)
SET session_replication_role = replica;
DO $$
DECLARE r requested_test := (SELECT x FROM requested_test x WHERE x.id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals'));
        pv uuid := (SELECT project_version_id FROM quoted_test_configuration WHERE id = r.quoted_line_id);
        sch uuid; t1 uuid; t3 uuid; t7 uuid; done date := (test_reported_at(r.id) AT TIME ZONE 'America/Los_Angeles')::date;
BEGIN
  INSERT INTO rush_fee_schedule (schedule_name) VALUES ('INV test rush') RETURNING id INTO sch;
  INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value) VALUES (sch, 'Next day', 1, 'Business Days', 'Percent', 100) RETURNING id INTO t1;
  INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value) VALUES (sch, '3-day', 3, 'Business Days', 'Percent', 50) RETURNING id INTO t3;
  INSERT INTO rush_fee_tier (schedule_id, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value) VALUES (sch, '12-day', 12, 'Business Days', 'Flat', 20) RETURNING id INTO t7;
  INSERT INTO quote_rush_term (project_version_id, tier_id, schedule_name, tier_name, rush_tat, tat_unit, surcharge_type, surcharge_value, discount_pct) VALUES
    (pv, t1, 'INV test rush', 'Next day', 1, 'Business Days', 'Percent', 100, 0), (pv, t3, 'INV test rush', '3-day', 3, 'Business Days', 'Percent', 50, 0),
    (pv, t7, 'INV test rush', '12-day', 12, 'Business Days', 'Flat', 20, 0);
  UPDATE test_catalog_entry SET rush_schedule_id = sch, standard_tat = 15, tat_unit = 'Business Days' WHERE test_id = r.test_id;
  UPDATE requested_test SET rush_tier_id = t1, rush_status = 'Approved', rush_fee = r.price, tat_days = 1, tat_unit = 'Business Days',
         day0 = done - 14, due_date = tat_due(pg_temp.ivcfl(), done - 14, 1, 'Business Days') WHERE id = r.id;
  INSERT INTO ivk VALUES ('t1', t1), ('t3', t3), ('t7', t7);
END $$;
SET session_replication_role = origin;
SELECT pg_temp.expect_true('A rush reported late shows by how many working days; its options: the tier ordered, tiers met or not, standard',
  (SELECT late_days FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) >= 8
  AND (SELECT count(*) FROM invoice_rush_options(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals'))) = 4
  AND (SELECT met FROM invoice_rush_options(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) WHERE tier_name = '12-day')
  AND NOT (SELECT met FROM invoice_rush_options(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) WHERE tier_name = '3-day')
  AND (SELECT is_ordered AND NOT met FROM invoice_rush_options(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) WHERE tier_name = 'Next day')
  AND (SELECT met FROM invoice_rush_options(pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) WHERE tier_id IS NULL));

-- 4. claiming work into drafts
SELECT pg_temp.iv_as('wd.ana', false);
SELECT pg_temp.expect_error_like('Someone without invoicing.issue cannot claim work',
  $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')])$$, 'permission');
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_error_like('Claiming needs a choice', $$SELECT claim_invoice_work('{}')$$, 'Choose the completed work');
SELECT pg_temp.expect_ok('Accounting claims three tests of CFL261015999 (no signature: it only says who is checking them)',
  $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.iv999(), 'WD Metals'), pg_temp.ivrt(pg_temp.iv999(), 'WD Micro Screen')], 'Week 42')$$);
SELECT pg_temp.expect_true('One Draft for the lab order, held by the claimer, numbered DR-, its lines billed as ordered (the rush as ordered)',
  (SELECT count(*) FROM invoice WHERE claimed_by = pg_temp.ivu('inv.acc') AND status = 'Draft') = 1
  AND (SELECT count(*) FROM invoice_line WHERE invoice_id = pg_temp.ivdraft('inv.acc', 'LO-000003') AND status = 'Active') = 2
  AND (SELECT draft_code LIKE 'DR-%' AND invoice_number IS NULL FROM invoice WHERE id = pg_temp.ivdraft('inv.acc', 'LO-000003'))
  AND (SELECT rush_ordered = 'Next day' AND rush_billed = 'Next day' AND rush_fee = price AND amount = 2 * price FROM pg_temp.ivline(pg_temp.iv999(), 'WD Metals'))
  AND (SELECT total = (SELECT sum(amount) FROM invoice_line WHERE invoice_id = i.id AND status = 'Active') FROM invoice i WHERE i.id = pg_temp.ivdraft('inv.acc', 'LO-000003'))
  AND NOT EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')));
SELECT pg_temp.expect_ok('Claiming more work of the same order adds it to the same draft',
  $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.iv999(), 'WD Growth Promotion')])$$);
SELECT pg_temp.expect_true('Still one draft for LO-000003, now three lines',
  (SELECT count(*) FROM invoice WHERE claimed_by = pg_temp.ivu('inv.acc') AND status = 'Draft') = 1
  AND (SELECT count(*) FROM invoice_line WHERE invoice_id = pg_temp.ivdraft('inv.acc', 'LO-000003') AND status = 'Active') = 3);
SELECT pg_temp.iv_as('inv.acc2', false);
SELECT pg_temp.expect_error_like('Nobody else claims work already on a draft',
  $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')])$$, 'already on a draft');
SELECT pg_temp.expect_ok('A second person claims other work of the same order (their own draft)',
  $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.ivc('002'), 'WD Micro Screen'), pg_temp.ivrt(pg_temp.ivc('002'), 'WD Growth Promotion')])$$);
SELECT pg_temp.expect_error_like('Nobody else changes a draft',
  $$SELECT update_invoice_draft(pg_temp.ivdraft('inv.acc', 'LO-000003'), 'PO-1', '', '')$$, 'being checked by INV Accounting');
SELECT pg_temp.expect_error_like('Nobody else releases a draft (unless a lab administrator)',
  $$SELECT release_invoice_draft(pg_temp.ivdraft('inv.acc', 'LO-000003'))$$, 'only they, or a lab administrator');
SELECT pg_temp.expect_error_like('Invoices are not written directly',
  $$UPDATE invoice SET note = 'x' WHERE id = pg_temp.ivdraft('inv.acc', 'LO-000003')$$, 'only through Billing');
SELECT pg_temp.expect_error_like('Invoice lines are not written directly',
  $$UPDATE invoice_line SET price = 1 WHERE invoice_id = pg_temp.ivdraft('inv.acc', 'LO-000003')$$, 'only through Billing');

-- 5. checking the draft: the price, the late rush
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_error_like('A price above the list price is refused',
  $$SELECT set_invoice_line_price((pg_temp.ivline(pg_temp.iv999(), 'WD Micro Screen')).id, 999, 'x')$$, 'above the list price');
SELECT pg_temp.expect_error_like('A price other than the order''s needs a reason',
  $$SELECT set_invoice_line_price((pg_temp.ivline(pg_temp.iv999(), 'WD Micro Screen')).id, 60, '')$$, 'Say why the price differs');
SELECT pg_temp.expect_ok('The price corrected with its reason',
  $$SELECT set_invoice_line_price((pg_temp.ivline(pg_temp.iv999(), 'WD Micro Screen')).id, 60, 'Discount corrected to the accepted quote')$$);
SELECT pg_temp.expect_true('The line keeps the order''s price, the price billed and why; the total follows',
  (SELECT quoted_price = 80 AND price = 60 AND amount = 60 AND price_note = 'Discount corrected to the accepted quote' FROM pg_temp.ivline(pg_temp.iv999(), 'WD Micro Screen'))
  AND (SELECT total = (SELECT sum(amount) FROM invoice_line WHERE invoice_id = i.id AND status = 'Active') AND discount_total = 20 FROM invoice i WHERE i.id = pg_temp.ivdraft('inv.acc', 'LO-000003')));
SELECT pg_temp.expect_error_like('A late rush is not billed at a tier also missed',
  $$SELECT set_invoice_line_rush((pg_temp.ivline(pg_temp.iv999(), 'WD Metals')).id, (SELECT v::uuid FROM ivk WHERE k = 't3'), 'late')$$, 'was not met either');
SELECT pg_temp.expect_error_like('Billing another tier needs a reason',
  $$SELECT set_invoice_line_rush((pg_temp.ivline(pg_temp.iv999(), 'WD Metals')).id, (SELECT v::uuid FROM ivk WHERE k = 't7'), '')$$, 'Say why the rush');
SELECT pg_temp.expect_ok('The late rush billed at the closest tier met (12-day, flat 20)',
  $$SELECT set_invoice_line_rush((pg_temp.ivline(pg_temp.iv999(), 'WD Metals')).id, (SELECT v::uuid FROM ivk WHERE k = 't7'), 'Reported 8 business days late: billed at the 12-day tier met')$$);
SELECT pg_temp.expect_true('The line shows the rush ordered and the rush billed, its fee and why',
  (SELECT rush_ordered = 'Next day' AND rush_billed = '12-day' AND rush_fee = 20 AND amount = price + 20 AND rush_note LIKE 'Reported%' FROM pg_temp.ivline(pg_temp.iv999(), 'WD Metals')));
SELECT pg_temp.expect_ok('Or standard (no rush fee)',
  $$SELECT set_invoice_line_rush((pg_temp.ivline(pg_temp.iv999(), 'WD Metals')).id, NULL, 'Late: standard price')$$);
SELECT pg_temp.expect_true('Standard: no rush fee', (SELECT rush_billed IS NULL AND rush_fee = 0 AND amount = price FROM pg_temp.ivline(pg_temp.iv999(), 'WD Metals')));
SELECT pg_temp.expect_ok('Back to the 12-day tier', $$SELECT set_invoice_line_rush((pg_temp.ivline(pg_temp.iv999(), 'WD Metals')).id, (SELECT v::uuid FROM ivk WHERE k = 't7'), 'Late: 12-day tier met')$$);
SELECT pg_temp.expect_ok('The PO and the note printed on the invoice', $$SELECT update_invoice_draft(pg_temp.ivdraft('inv.acc', 'LO-000003'), 'PO-778', 'Thank you for your business.', 'checked')$$);

-- 6. taking work off, releasing
SELECT pg_temp.expect_ok('A line taken off the draft', $$SELECT remove_invoice_lines(ARRAY[(pg_temp.ivline(pg_temp.iv999(), 'WD Growth Promotion')).id])$$);
SELECT pg_temp.expect_true('Its work is ready to invoice again',
  EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Growth Promotion'))
  AND (SELECT count(*) FROM invoice_line WHERE invoice_id = pg_temp.ivdraft('inv.acc', 'LO-000003') AND status = 'Active') = 2);
SELECT pg_temp.iv_as('akiddle', false);
SELECT pg_temp.expect_ok('A lab administrator releases someone else''s draft (with a reason)', $$SELECT release_invoice_draft(pg_temp.ivdraft('inv.acc2', 'LO-000003'))$$);
SELECT pg_temp.expect_true('The released draft is kept, discarded; its work is ready again',
  EXISTS (SELECT 1 FROM invoice WHERE claimed_by = pg_temp.ivu('inv.acc2') AND status = 'Discarded')
  AND EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.ivc('002'), 'WD Micro Screen')));

-- 7. payment terms
SELECT pg_temp.iv_as('wd.ana', false);
SELECT pg_temp.expect_error_like('Only people who issue invoices change payment terms',
  $$SELECT set_client_payment_terms((SELECT client_id FROM lab_order WHERE order_code = 'LO-000003'), 45)$$, 'invoicing.issue');
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_true('Net 30 by default', (SELECT payment_terms_days FROM client c JOIN lab_order o ON o.client_id = c.id WHERE o.order_code = 'LO-000003') = 30);

-- 8. issuing
SELECT pg_temp.expect_error_like('Issuing is signed', $$SELECT issue_invoices(ARRAY[pg_temp.ivdraft('inv.acc', 'LO-000003')])$$, 'electronic signature');
SELECT pg_temp.iv_as('inv.acc2');
SELECT pg_temp.expect_error_like('Nobody issues someone else''s draft', $$SELECT issue_invoices(ARRAY[pg_temp.ivdraft('inv.acc', 'LO-000003')])$$, 'being checked by');
SELECT pg_temp.iv_as('inv.acc');
INSERT INTO ivk VALUES ('draftA', pg_temp.ivdraft('inv.acc', 'LO-000003'));
SELECT pg_temp.expect_ok('Issued, its PDF attached and sent in the same transaction (as the server does)', $q$DO $x$ DECLARE d uuid := pg_temp.ivpdf('inv A'); i uuid := (SELECT v::uuid FROM ivk WHERE k = 'draftA');
  BEGIN PERFORM issue_invoices(ARRAY[i]); PERFORM record_invoice_document(i, d, (SELECT sha256 FROM document_file WHERE id = d)); PERFORM send_invoice(i); END $x$$q$);
SELECT pg_temp.expect_true('Numbered per lab (INV-CFL-), dated today in the lab, due net 30, billed to the client''s legal name, no longer claimed',
  (SELECT invoice_number ~ '^INV-CFL-\d{6}$' AND status = 'Issued' AND invoice_date = site_today(pg_temp.ivcfl()) AND due_date = invoice_date + 30
     AND payment_terms_days = 30 AND bill_to_name = (SELECT legal_name FROM client WHERE id = i.client_id) AND claimed_by IS NULL
     AND issued_by = pg_temp.ivu('inv.acc') AND signature_id IS NOT NULL AND document_id IS NOT NULL AND sent_at IS NOT NULL AND po_number = 'PO-778'
   FROM invoice i WHERE i.id = (SELECT v::uuid FROM ivk WHERE k = 'draftA')));
SELECT pg_temp.expect_true('Emailed with the PDF to the client''s billing contact',
  EXISTS (SELECT 1 FROM email_outbox e JOIN invoice i ON i.document_id = e.document_id WHERE i.id = (SELECT v::uuid FROM ivk WHERE k = 'draftA')
           AND e.template = 'Invoice Issued' AND e.to_address = 'sam@acme.com' AND e.subject LIKE '%' || i.invoice_number || '%' AND e.body LIKE '%PO-778%'));
SELECT pg_temp.expect_true('Queued for the lab''s QuickBooks Online company (waiting: not connected), as its API takes an invoice',
  (SELECT p.status = 'Waiting for connection' AND entity = 'Invoice' AND provider = 'QuickBooks Online' AND payload->>'DocNumber' = i.invoice_number
     AND jsonb_array_length(payload->'Line') = 2 AND (payload->'SalesTermRef'->>'name') = 'Net 30' AND payload->'BillEmail'->>'Address' = 'sam@acme.com'
     AND (SELECT sum((x->>'Amount')::numeric) FROM jsonb_array_elements(payload->'Line') x) = i.total
   FROM accounting_push p JOIN invoice i ON i.id = p.invoice_id WHERE i.id = (SELECT v::uuid FROM ivk WHERE k = 'draftA')));
SELECT pg_temp.expect_error_like('Sent once', $$SELECT send_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'))$$, 'sent already');
SELECT pg_temp.expect_error_like('An issued invoice is never changed, even by Billing''s own steps',
  $q$DO $x$ BEGIN PERFORM set_invoice_internal(true); UPDATE invoice SET total = 0 WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'draftA'); END $x$$q$, 'never changed');
SELECT pg_temp.expect_error_like('Nor its lines',
  $q$DO $x$ BEGIN PERFORM set_invoice_internal(true); UPDATE invoice_line SET price = 0 WHERE invoice_id = (SELECT v::uuid FROM ivk WHERE k = 'draftA'); END $x$$q$, 'never changed');
SELECT pg_temp.expect_error_like('The PDF is attached only when it is issued',
  $$SELECT record_invoice_document((SELECT v::uuid FROM ivk WHERE k = 'draftA'), pg_temp.ivpdf('again'), encode(sha256(convert_to('%PDF-1.4 again', 'UTF8')), 'hex'))$$, 'already has its PDF');

-- terms changed, a second invoice
SELECT pg_temp.expect_ok('Payment terms set to net 45 by Accounting', $$SELECT set_client_payment_terms((SELECT client_id FROM lab_order WHERE order_code = 'LO-000003'), 45)$$);
SELECT pg_temp.expect_ok('More work claimed', $$SELECT claim_invoice_work(ARRAY[pg_temp.ivrt(pg_temp.iv999(), 'WD Growth Promotion'), pg_temp.ivrt(pg_temp.ivc('002'), 'WD Micro Screen')])$$);
INSERT INTO ivk VALUES ('draftB', pg_temp.ivdraft('inv.acc', 'LO-000003'));
SELECT pg_temp.expect_ok('Issued without its PDF in this transaction', $$SELECT issue_invoices(ARRAY[(SELECT v::uuid FROM ivk WHERE k = 'draftB')])$$);
SELECT pg_temp.expect_true('The next number, net 45',
  (SELECT right(invoice_number, 6)::int = (SELECT right(invoice_number, 6)::int + 1 FROM invoice WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'draftA'))
          AND due_date = invoice_date + 45 FROM invoice WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'draftB')));
COMMIT;  -- (the rule tests run as one transaction: end it, so the next statement is a later transaction)
SELECT pg_temp.expect_error_like('Its PDF cannot be attached afterwards',
  $$SELECT record_invoice_document((SELECT v::uuid FROM ivk WHERE k = 'draftB'), pg_temp.ivpdf('late'), encode(sha256(convert_to('%PDF-1.4 late', 'UTF8')), 'hex'))$$, 'attached when it is issued');

-- 9. credit notes
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_error_like('A credit note is signed', $$SELECT credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'), NULL, true, 'x')$$, 'electronic signature');
SELECT pg_temp.iv_as('inv.acc');
SELECT pg_temp.expect_error_like('A credit note says why', $$SELECT credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'), NULL, true, ' ')$$, 'Say why');
SELECT pg_temp.expect_ok('One line credited, to be invoiced again',
  $q$DO $x$ DECLARE cn uuid; d uuid := pg_temp.ivpdf('cn A');
    BEGIN cn := credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'), ARRAY[(SELECT l.id FROM invoice_line l WHERE l.invoice_id = (SELECT v::uuid FROM ivk WHERE k = 'draftA') AND l.test_name = 'WD Micro Screen')], true, 'Billing error corrected');
      PERFORM record_invoice_document(cn, d, (SELECT sha256 FROM document_file WHERE id = d)); PERFORM send_invoice(cn); INSERT INTO ivk VALUES ('cnA', cn); END $x$$q$);
SELECT pg_temp.expect_true('Credit note CN-CFL-, negative, issued today, credits the invoice; emailed; queued as a QuickBooks credit memo',
  (SELECT invoice_number ~ '^CN-CFL-\d{6}$' AND kind = 'Credit note' AND total = -60 AND credit_of_id = (SELECT v::uuid FROM ivk WHERE k = 'draftA') AND reason = 'Billing error corrected'
   FROM invoice WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'cnA'))
  AND EXISTS (SELECT 1 FROM email_outbox e JOIN invoice i ON i.document_id = e.document_id WHERE i.id = (SELECT v::uuid FROM ivk WHERE k = 'cnA') AND e.template = 'Credit Note Issued' AND e.body LIKE '%corrected invoice will follow%')
  AND (SELECT entity FROM accounting_push WHERE invoice_id = (SELECT v::uuid FROM ivk WHERE k = 'cnA')) = 'CreditMemo'
  AND (SELECT credited FROM invoice_view WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'draftA')) = 60);
SELECT pg_temp.expect_true('The credited work is ready to invoice again',
  EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Micro Screen')));
SELECT pg_temp.expect_error_like('A line is credited once', $$SELECT credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'), ARRAY[(SELECT l.id FROM invoice_line l WHERE l.invoice_id = (SELECT v::uuid FROM ivk WHERE k = 'draftA') AND l.test_name = 'WD Micro Screen')], true, 'again')$$, 'credited already');
SELECT pg_temp.expect_ok('The rest credited for good (not invoiced again)', $$SELECT credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'draftA'), NULL, false, 'Goodwill credit')$$);
SELECT pg_temp.expect_true('Credited for good: not ready again; the order shows it as Credited',
  NOT EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals'))
  AND (SELECT state FROM order_billing((SELECT id FROM lab_order WHERE order_code = 'LO-000003')) WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Metals')) = 'Credited');
SELECT pg_temp.expect_error_like('A credit note is not credited', $$SELECT credit_invoice((SELECT v::uuid FROM ivk WHERE k = 'cnA'), NULL, false, 'x')$$, 'Only an issued invoice');

-- 10. the order's billing
SELECT pg_temp.expect_true('The order lists each test: Invoiced, Ready to invoice, In the lab, with the charge and the invoice',
  (SELECT state FROM order_billing((SELECT id FROM lab_order WHERE order_code = 'LO-000003')) WHERE requested_test_id = pg_temp.ivrt(pg_temp.ivc('002'), 'WD Micro Screen')) = 'Invoiced'
  AND (SELECT invoice_code FROM order_billing((SELECT id FROM lab_order WHERE order_code = 'LO-000003')) WHERE requested_test_id = pg_temp.ivrt(pg_temp.ivc('002'), 'WD Micro Screen'))
      = (SELECT invoice_number FROM invoice WHERE id = (SELECT v::uuid FROM ivk WHERE k = 'draftB'))
  AND (SELECT state FROM order_billing((SELECT id FROM lab_order WHERE order_code = 'LO-000003')) WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Micro Screen')) = 'Ready to invoice'
  AND EXISTS (SELECT 1 FROM order_billing((SELECT id FROM lab_order WHERE order_code = 'LO-000003')) WHERE state = 'In the lab'));

-- 11. the catch-up: LO-000011's COA moved three weeks back (fixture), invoiced on the Friday of that week, not sent
SET session_replication_role = replica;
UPDATE coa_version SET issued_at = issued_at - interval '21 days'
 WHERE coa_id IN (SELECT c.id FROM coa c JOIN sample s ON s.id = c.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE o.order_code = 'LO-000011');
SET session_replication_role = origin;
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_error_like('Only a system administrator runs the catch-up', $$SELECT invoice_catch_up()$$, 'system administrator');
SELECT pg_temp.iv_as('akiddle');
SELECT pg_temp.expect_ok('The catch-up', $$SELECT invoice_catch_up(pg_temp.ivcfl())$$);
SELECT pg_temp.expect_true('LO-000011''s work invoiced once, dated the Friday of the week its COA was issued; this week''s work left ready',
  (SELECT count(*) FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id WHERE o.order_code = 'LO-000011' AND i.catchup AND i.status = 'Issued') = 1
  AND (SELECT invoice_date FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id WHERE o.order_code = 'LO-000011' AND i.catchup)
      = date_trunc('week', (test_reported_at(pg_temp.ivrt(pg_temp.ivc('1001'), 'WD Stability')) AT TIME ZONE 'America/Los_Angeles')::date)::date + 4
  AND extract(isodow FROM (SELECT invoice_date FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id WHERE o.order_code = 'LO-000011' AND i.catchup)) = 5
  AND EXISTS (SELECT 1 FROM invoice_ready_view WHERE requested_test_id = pg_temp.ivrt(pg_temp.iv999(), 'WD Micro Screen'))
  AND NOT EXISTS (SELECT 1 FROM invoice_ready_view WHERE order_code = 'LO-000011'));
SELECT pg_temp.expect_true('Catch-up invoices are not emailed or queued for QuickBooks',
  NOT EXISTS (SELECT 1 FROM invoice i JOIN accounting_push p ON p.invoice_id = i.id WHERE i.catchup)
  AND NOT EXISTS (SELECT 1 FROM invoice i WHERE i.catchup AND i.sent_at IS NOT NULL));
SELECT pg_temp.expect_error_like('A catch-up invoice is not sent', $$SELECT send_invoice((SELECT i.id FROM invoice i WHERE i.catchup LIMIT 1))$$, 'catch-up');
SELECT pg_temp.expect_true('Run again, it invoices nothing twice', invoice_catch_up(pg_temp.ivcfl()) = 0);

-- 12. the accounting connection is kept by system administrators
SELECT pg_temp.iv_as('inv.acc', false);
SELECT pg_temp.expect_error_like('Only a system administrator connects a lab to its accounting company',
  $$UPDATE accounting_connection SET company_id = '123' WHERE site_id = pg_temp.ivcfl()$$, 'system administrator');
SELECT pg_temp.expect_true('Every lab has its QuickBooks Online connection, not connected yet',
  NOT EXISTS (SELECT 1 FROM lab_site s WHERE NOT EXISTS (SELECT 1 FROM accounting_connection c WHERE c.site_id = s.id AND c.provider = 'QuickBooks Online' AND c.status = 'Not connected')));

SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.site_id', '', false);
SELECT rpad(left(test, 74), 75) || outcome AS result FROM results;
