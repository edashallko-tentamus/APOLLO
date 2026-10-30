-- Verification for migration 058 (0.36.0): service lines on tests and clients; ordering any test of the lab at its
-- list price (an accepted quote line wins); miscellaneous charges (catalogue, on quotes, on orders, on invoices, credit
-- notes); invoice payment status; correcting the PO number of an issued invoice.
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username='akiddle'), false);
SELECT set_config('lims.signature_id', '', false);
SELECT set_config('lims.reason', '', false);
SELECT set_config('lims.site_id', '', false);
CREATE TEMP TABLE IF NOT EXISTS results (test text, outcome text);
DELETE FROM results;
CREATE OR REPLACE FUNCTION pg_temp.expect_error_like(label text, stmt text, pat text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; INSERT INTO results VALUES (label, 'FAIL (no error)');
  EXCEPTION WHEN others THEN INSERT INTO results VALUES (label, CASE WHEN SQLERRM ILIKE '%' || pat || '%' THEN 'PASS: ' ELSE 'FAIL (other error): ' END || SQLERRM); END;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.expect_true(label text, cond boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN INSERT INTO results VALUES (label, CASE WHEN COALESCE(cond, false) THEN 'PASS' ELSE 'FAIL' END); END $$;
CREATE OR REPLACE FUNCTION pg_temp.as_user(u text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = u), false); PERFORM script_signature('Rule test', false); RETURN u; END $$;
CREATE OR REPLACE FUNCTION pg_temp.m_site(code text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_site WHERE site_code = code $$;
CREATE OR REPLACE FUNCTION pg_temp.m_reason(r text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('lims.reason', r, false) $$;
CREATE OR REPLACE FUNCTION pg_temp.m_client(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM client WHERE legal_name = n $$;
-- an order at CFL with one sample, no tests
CREATE OR REPLACE FUNCTION pg_temp.m_order(client text, po text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE o uuid; ct uuid;
BEGIN
  SELECT cc.contact_id INTO ct FROM client_contact cc WHERE cc.client_id = pg_temp.m_client(client) AND cc.status = 'Active' ORDER BY ('ORDERING' = ANY(cc.roles)) DESC LIMIT 1;
  INSERT INTO lab_order (client_id, site_id, ordering_contact_id, po_number) VALUES (pg_temp.m_client(client), pg_temp.m_site('CFL'), ct, po) RETURNING id INTO o;
  INSERT INTO sample (lab_order_id, client_sample_id, matrix, number_of_units) VALUES (o, po || '-1', 'Powder', 1);
  RETURN o;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.m_s(po text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM sample WHERE client_sample_id = po || '-1' $$;
CREATE OR REPLACE FUNCTION pg_temp.m_o(po text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lab_order WHERE po_number = po ORDER BY created_at DESC LIMIT 1 $$;
CREATE OR REPLACE FUNCTION pg_temp.m_test(n text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM test WHERE test_name = n $$;
CREATE OR REPLACE FUNCTION pg_temp.m_v(n text) RETURNS uuid LANGUAGE sql AS $$
  SELECT pv.id FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE p.project_name = n ORDER BY pv.version_no DESC LIMIT 1 $$;
SELECT set_config('lims.site_id', pg_temp.m_site('CFL')::text, false);
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.m_reason('Rule test fixtures');
INSERT INTO lab_site (site_code, site_name, time_zone) SELECT 'TPS', 'Tentamus Pharmaceutical Services', 'America/New_York'
 WHERE NOT EXISTS (SELECT 1 FROM lab_site WHERE site_code = 'TPS');
-- people: CFL's General Manager, Analyst, Intake, Account Manager and Accounting
INSERT INTO app_user (username, full_name) VALUES ('ch.gm', 'CH General Manager'), ('ch.ana', 'CH Analyst'), ('ch.in', 'CH Intake'),
  ('ch.am', 'CH Account Manager'), ('ch.bill', 'CH Accounting') ON CONFLICT DO NOTHING;
INSERT INTO group_member (group_id, user_id)
SELECT g.id, u.id FROM (VALUES ('ch.gm', 'General Manager'), ('ch.ana', 'Analyst'), ('ch.in', 'Intake'), ('ch.am', 'Account Manager'), ('ch.bill', 'Accounting')) x(u, g)
  JOIN app_user u ON u.username = x.u JOIN lab_group g ON g.group_name = x.g AND g.site_id = pg_temp.m_site('CFL') ON CONFLICT DO NOTHING;
-- clients: one with nothing quoted, one with an accepted quote of a test and a charge
INSERT INTO client (legal_name, account_status) VALUES ('CH Walk-in Co', 'Active'), ('CH Quoted Co', 'Active');
INSERT INTO contact (first_name, last_name, email) VALUES ('Wally', 'Walkin', 'wally@ch-walkin.example'), ('Quinn', 'Quoted', 'quinn@ch-quoted.example');
INSERT INTO client_contact (client_id, contact_id, roles) SELECT c.id, ct.id, '{PRIMARY,ORDERING,BILLING}' FROM client c JOIN contact ct
  ON (c.legal_name, ct.email) IN (('CH Walk-in Co', 'wally@ch-walkin.example'), ('CH Quoted Co', 'quinn@ch-quoted.example'));
-- tests: two CFL tests with an approved workflow (one with the rush schedule), one TPS test, one CFL draft
SELECT create_test(pg_temp.m_site('CFL'), x) FROM unnest(ARRAY['CH Assay', 'CH Moisture', 'CH Draft only']) x;
SELECT create_test(pg_temp.m_site('TPS'), 'CH Partner assay');
UPDATE test_catalog_entry SET base_price = 100, rush_schedule_id = (SELECT id FROM rush_fee_schedule WHERE schedule_name = 'Chemistry Rush') WHERE test_id = pg_temp.m_test('CH Assay');
UPDATE test_catalog_entry SET base_price = 60 WHERE test_id IN (pg_temp.m_test('CH Moisture'), pg_temp.m_test('CH Draft only'), pg_temp.m_test('CH Partner assay'));
SELECT set_config('lims.methods_internal', '1', false);
UPDATE test_version SET status = 'Effective', effective_from = now() WHERE test_id IN (pg_temp.m_test('CH Assay'), pg_temp.m_test('CH Moisture'), pg_temp.m_test('CH Partner assay'));
SELECT set_config('lims.methods_internal', '', false);
DO $$ DECLARE p uuid; BEGIN
  INSERT INTO project (client_id, project_name, kind) VALUES ((SELECT id FROM client WHERE legal_name = 'CH Quoted Co'), 'CH quote', 'Quote') RETURNING id INTO p;
  PERFORM new_project_version(p);
  INSERT INTO project (client_id, project_name, kind) VALUES ((SELECT id FROM client WHERE legal_name = 'CH Walk-in Co'), 'CH draft quote', 'Quote') RETURNING id INTO p;
  PERFORM new_project_version(p);
END $$;
INSERT INTO quoted_test_configuration (project_version_id, test_id, quantity, final_price) VALUES (pg_temp.m_v('CH quote'), pg_temp.m_test('CH Moisture'), 1, 45),
  (pg_temp.m_v('CH draft quote'), pg_temp.m_test('CH Assay'), 1, 90);

-------------------------------------------------------------------------------
-- 1. SERVICE LINES
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('Five service lines are seeded, each with its types',
  (SELECT count(*) FROM service_line) = 5 AND NOT EXISTS (SELECT 1 FROM service_line sl WHERE NOT EXISTS (SELECT 1 FROM service_line_type t WHERE t.service_line_id = sl.id)));
SELECT pg_temp.as_user('ch.ana');
SELECT pg_temp.expect_error_like('An analyst cannot add a service line', $$INSERT INTO service_line (line_name) VALUES ('Hemp')$$, 'permission');
SELECT pg_temp.as_user('ch.gm');
SELECT pg_temp.m_reason('Rule test: service lines');
INSERT INTO service_line (line_name, sort_order) VALUES ('Hemp', 60);
SELECT pg_temp.expect_error_like('A service line name is unique ignoring capitals', $$INSERT INTO service_line (line_name) VALUES ('hemp')$$, 'service_line_name');
INSERT INTO service_line_type (service_line_id, type_name) SELECT id, 'Compliance' FROM service_line WHERE line_name = 'Hemp';
-- Moved to the Java backend in migration 061 (JUnit: ChargeRulesTest): a service line type stays under its service line (its line is not written after the insert)
UPDATE test SET service_line_type_id = (SELECT t.id FROM service_line_type t JOIN service_line sl ON sl.id = t.service_line_id WHERE sl.line_name = 'Dietary supplements' AND t.type_name = 'Release testing')
 WHERE id = pg_temp.m_test('CH Assay');
SELECT pg_temp.expect_true('A test takes a service line type',
  (SELECT service_line_type_id IS NOT NULL FROM test WHERE id = pg_temp.m_test('CH Assay')));
SELECT pg_temp.as_user('ch.in');
SELECT pg_temp.m_reason('Rule test: client service lines');
INSERT INTO client_service_line (client_id, service_line_id) SELECT pg_temp.m_client('CH Walk-in Co'), id FROM service_line WHERE line_name = 'Dietary supplements';
SELECT pg_temp.expect_error_like('A client has each service line once',
  $$INSERT INTO client_service_line (client_id, service_line_id) SELECT pg_temp.m_client('CH Walk-in Co'), id FROM service_line WHERE line_name = 'Dietary supplements'$$, 'client_service_line_one');

-------------------------------------------------------------------------------
-- 2. ORDERING ANY TEST AT ITS LIST PRICE
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('ch.in');
SELECT pg_temp.m_reason('');
SELECT pg_temp.m_order('CH Walk-in Co', 'M-CAT');
-- a CFL test with an approved workflow that the walk-in client has no quote for
CREATE TEMP TABLE m_t AS SELECT t.id, e.id AS entry FROM test t JOIN test_catalog_entry e ON e.test_id = t.id WHERE t.id = pg_temp.m_test('CH Moisture');
CREATE TEMP TABLE m_rt AS SELECT order_catalogue_test(pg_temp.m_s('M-CAT'), (SELECT id FROM m_t)) AS id;
SELECT pg_temp.expect_true('A test not on the client''s quote is ordered at its list price, without a warning',
  (SELECT r.catalogue_order AND r.quoted_line_id IS NULL AND r.price = catalog_list_price((SELECT entry FROM m_t)) AND r.list_price = r.price
     FROM requested_test r WHERE r.id = (SELECT id FROM m_rt)));
SELECT pg_temp.expect_true('It carries the test''s standard turnaround',
  (SELECT r.tat_days = e.standard_tat FROM requested_test r JOIN test_catalog_entry e ON e.test_id = r.test_id WHERE r.id = (SELECT id FROM m_rt)));
SELECT pg_temp.expect_error_like('A list-price test cannot be turned into a quoted one',
  $$UPDATE requested_test SET catalogue_order = false WHERE id = (SELECT id FROM m_rt)$$, 'fixed');
SELECT pg_temp.expect_error_like('A test with no approved workflow is not ordered',
  $$SELECT order_catalogue_test(pg_temp.m_s('M-CAT'), pg_temp.m_test('CH Draft only'))$$, 'no approved workflow');
SELECT pg_temp.expect_error_like('Another lab''s test is not ordered on this lab''s order',
  $$SELECT order_catalogue_test(pg_temp.m_s('M-CAT'), pg_temp.m_test('CH Partner assay'))$$, 'another lab');
-- a rush tier on a list-price test: the schedule's surcharge in full
CREATE TEMP TABLE m_rush AS
SELECT t.id AS test_id, tr.id AS tier, tr.surcharge_type, tr.surcharge_value FROM test t JOIN test_catalog_entry e ON e.test_id = t.id
  JOIN rush_fee_tier tr ON tr.schedule_id = e.rush_schedule_id AND tr.tier_name = '48 Hour' WHERE t.id = pg_temp.m_test('CH Assay');
SELECT pg_temp.m_order('CH Walk-in Co', 'M-RUSH');
CREATE TEMP TABLE m_rrt AS SELECT order_catalogue_test(pg_temp.m_s('M-RUSH'), (SELECT test_id FROM m_rush), (SELECT tier FROM m_rush)) AS id;
SELECT pg_temp.expect_true('A rush on a list-price test is billed at the schedule''s full surcharge (48 Hour: 50 % of $100)',
  (SELECT r.price = 100 AND r.rush_status = 'Auto-accepted' AND r.rush_fee = 50 AND r.tat_days = 2 FROM requested_test r WHERE r.id = (SELECT id FROM m_rrt)));
SELECT pg_temp.expect_error_like('A rush tier from another schedule is refused',
  $$SELECT order_catalogue_test(pg_temp.m_s('M-RUSH'), pg_temp.m_test('CH Moisture'), (SELECT tier FROM m_rush))$$, 'rush schedule');
-- the quote wins (CH quote, with a shipping charge at $15, is quoted and accepted)
SELECT pg_temp.as_user('akiddle');
SELECT pg_temp.m_reason('Rule test: quote');
INSERT INTO charge_item (charge_name, kind, price, site_id) VALUES ('Sampling kit', 'Kit', 40, pg_temp.m_site('CFL')),
       ('Ground shipping', 'Shipping', 25, pg_temp.m_site('CFL')), ('Loyalty discount', 'Discount', 10, pg_temp.m_site('CFL'));
INSERT INTO quoted_charge (project_version_id, charge_item_id, unit_price) SELECT pg_temp.m_v('CH quote'), id, 15 FROM charge_item WHERE charge_name = 'Ground shipping';
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.m_v('CH quote');
UPDATE project_version SET status = 'Accepted', accepted_by_contact_id = (SELECT id FROM contact WHERE email = 'quinn@ch-quoted.example') WHERE id = pg_temp.m_v('CH quote');
SELECT pg_temp.as_user('ch.in');
SELECT pg_temp.m_reason('');
SELECT pg_temp.m_order('CH Quoted Co', 'M-QUOTE');
CREATE TEMP TABLE m_qrt AS SELECT order_catalogue_test(pg_temp.m_s('M-QUOTE'), pg_temp.m_test('CH Moisture')) AS id;
SELECT pg_temp.expect_true('A test on the client''s accepted quote is ordered from the quote, at the quoted price',
  (SELECT NOT r.catalogue_order AND r.quoted_line_id IS NOT NULL AND r.price = 45 FROM requested_test r WHERE r.id = (SELECT id FROM m_qrt)));

-------------------------------------------------------------------------------
-- 3. CHARGES: THE CATALOGUE AND QUOTES
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('ch.gm');
SELECT pg_temp.m_reason('Rule test: charges');
SELECT pg_temp.expect_error_like('Charges for every lab are kept by system administrators',
  $$INSERT INTO charge_item (charge_name, kind, price) VALUES ('Courier', 'Shipping', 30)$$, 'system administrators');
INSERT INTO charge_item (charge_name, kind, price, site_id) VALUES ('Courier pickup', 'Shipping', 30, pg_temp.m_site('CFL'));
SELECT pg_temp.expect_true('A lab''s General Manager adds charges; they are numbered CHG-',
  (SELECT bool_and(charge_code LIKE 'CHG-%') FROM charge_item));
-- Moved to the Java backend in migration 061 (JUnit: ChargeRulesTest): a charge price is never negative
SELECT pg_temp.as_user('ch.ana');
SELECT pg_temp.expect_error_like('An analyst cannot add a charge to the catalogue',
  $$INSERT INTO charge_item (charge_name, price, site_id) VALUES ('X', 5, pg_temp.m_site('CFL'))$$, 'permission');
-- on a quote
SELECT pg_temp.as_user('ch.am');
SELECT pg_temp.m_reason('');
INSERT INTO quoted_charge (project_version_id, charge_item_id, unit_price) SELECT pg_temp.m_v('CH draft quote'), id, 30 FROM charge_item WHERE charge_name = 'Sampling kit';
SELECT pg_temp.expect_true('A charge on a draft quote keeps the item''s price as its list price',
  (SELECT qc.list_price = 40 AND qc.unit_price = 30 FROM quoted_charge qc JOIN charge_item ci ON ci.id = qc.charge_item_id WHERE ci.charge_name = 'Sampling kit'));
-- Moved to the Java backend in migration 061 (JUnit: ChargeRulesTest): charges are locked once a version is quoted
SELECT pg_temp.expect_true('The client''s price for a charge comes from their accepted quote',
  (SELECT unit_price = 15 FROM client_charge_price(pg_temp.m_client('CH Quoted Co'), (SELECT id FROM charge_item WHERE charge_name = 'Ground shipping'))));
SELECT pg_temp.as_user('ch.gm');
SELECT pg_temp.m_reason('Rule test: new version');
UPDATE project_version SET status = 'Quoted', valid_until = current_date + 30 WHERE id = pg_temp.m_v('CH draft quote');
CREATE TEMP TABLE m_nv AS SELECT new_project_version((SELECT id FROM project WHERE project_name = 'CH draft quote')) AS id;
SELECT pg_temp.expect_true('A new version of a quote carries its charges',
  (SELECT version_no = 2 FROM project_version WHERE id = pg_temp.m_v('CH draft quote'))
  AND EXISTS (SELECT 1 FROM quoted_charge WHERE project_version_id = pg_temp.m_v('CH draft quote') AND unit_price = 30 AND list_price = 40));

-- Charges and drafts as Java writes them (their rules moved to the Java backend in migration 069: ChargeRulesTest, InvoicingRulesTest)
CREATE OR REPLACE FUNCTION pg_temp.claim_charges(p_charges uuid[]) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE o record; inv uuid; v uuid; out uuid[] := '{}';
BEGIN
  PERFORM set_invoice_internal(true);
  FOR o IN SELECT DISTINCT lab_order_id FROM charge_ready_view WHERE order_charge_id = ANY (p_charges) LOOP
    inv := invoice_draft_for(o.lab_order_id);
    FOR v IN SELECT order_charge_id FROM charge_ready_view WHERE order_charge_id = ANY (p_charges) AND lab_order_id = o.lab_order_id ORDER BY sample_code NULLS FIRST, charge_name LOOP
      PERFORM invoice_add_charge_line(inv, v);
    END LOOP;
    PERFORM invoice_totals(inv);
    out := out || inv;
  END LOOP;
  PERFORM set_invoice_internal(false);
  RETURN out;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.add_charge(p_inv uuid, p_item uuid, p_price numeric, p_note text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE ci charge_item; v uuid;
BEGIN
  SELECT * INTO ci FROM charge_item WHERE id = p_item;
  INSERT INTO order_charge (lab_order_id, charge_item_id, quantity, list_price, unit_price, source, note)
  SELECT lab_order_id, p_item, 1, charge_sign(ci.kind) * ci.price, charge_sign(ci.kind) * abs(p_price), 'Invoice', p_note FROM invoice WHERE id = p_inv RETURNING id INTO v;
  PERFORM set_invoice_internal(true);
  PERFORM invoice_add_charge_line(p_inv, v);
  PERFORM invoice_totals(p_inv);
  PERFORM set_invoice_internal(false);
  RETURN v;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.pay(p_inv uuid, p_on date, p_note text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ensure_reason(CASE WHEN p_on IS NULL THEN 'Payment record cleared' ELSE 'Payment recorded' END);
  PERFORM set_invoice_internal(true);
  PERFORM set_config('lims.invoice_after_issue', 'payment', true);
  UPDATE invoice SET paid_on = p_on, paid_note = p_note, paid_recorded_by = current_app_user(), paid_recorded_at = clock_timestamp() WHERE id = p_inv;
  PERFORM set_config('lims.invoice_after_issue', '', true);
  PERFORM set_invoice_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 4. CHARGES ON ORDERS AND INVOICES
-------------------------------------------------------------------------------
SELECT pg_temp.as_user('ch.in');
SELECT pg_temp.m_reason('');
SELECT pg_temp.m_order('CH Quoted Co', 'M-CHG');
-- the client's quoted price, as Java's OrderCharge.price works it out
INSERT INTO order_charge (lab_order_id, charge_item_id, list_price, unit_price, quoted_charge_id)
  SELECT pg_temp.m_o('M-CHG'), ci.id, ci.price, cp.unit_price, cp.quoted_charge_id FROM charge_item ci, client_charge_price(pg_temp.m_client('CH Quoted Co'), ci.id) cp
   WHERE ci.charge_name = 'Ground shipping';
SELECT pg_temp.expect_true('A charge on an order takes the client''s quoted price',
  (SELECT oc.unit_price = 15 AND oc.list_price = 25 AND oc.quoted_charge_id IS NOT NULL AND oc.charge_no LIKE 'OC-%' FROM order_charge oc WHERE oc.lab_order_id = pg_temp.m_o('M-CHG')));
-- Moved to the Java backend in migration 069 (JUnit: ChargeRulesTest.chargesOnAnOrder): a charge typed at another price needs a reason
SELECT pg_temp.m_reason('Two kits at the promised price');
INSERT INTO order_charge (lab_order_id, charge_item_id, list_price, unit_price, quantity) SELECT pg_temp.m_o('M-CHG'), id, price, 35, 2 FROM charge_item WHERE charge_name = 'Sampling kit';
SELECT pg_temp.m_reason('');
SELECT pg_temp.expect_true('Charges are ready to invoice at once (no workflow, no COA)',
  (SELECT count(*) FROM charge_ready_view WHERE lab_order_id = pg_temp.m_o('M-CHG')) = 2
  AND (SELECT sum(amount) FROM charge_ready_view WHERE lab_order_id = pg_temp.m_o('M-CHG')) = 85);
-- Moved to the Java backend in migration 069 (JUnit: ChargeRulesTest): a charge's item is fixed (Java never changes it)
-- Moved to the Java backend in migration 069 (JUnit: ChargeRulesTest.chargesOnAnOrder): changing a charge needs a reason
-- Moved to the Java backend in migration 069 (JUnit: InvoicingRulesTest.draftsAndClaims): only billing claims charges (the database permission function stays)
SELECT pg_temp.as_user('ch.bill');
CREATE TEMP TABLE m_inv AS SELECT unnest(pg_temp.claim_charges(ARRAY(SELECT order_charge_id FROM charge_ready_view WHERE lab_order_id = pg_temp.m_o('M-CHG')))) AS id;
SELECT pg_temp.expect_true('Claiming charges makes one draft for the order, a line per charge',
  (SELECT count(*) FROM m_inv) = 1 AND (SELECT count(*) FROM invoice_line WHERE invoice_id = (SELECT id FROM m_inv) AND order_charge_id IS NOT NULL) = 2
  AND NOT EXISTS (SELECT 1 FROM charge_ready_view WHERE lab_order_id = pg_temp.m_o('M-CHG')));
SELECT pg_temp.m_reason('Charge on an invoice');
SELECT pg_temp.as_user('ch.in');
-- Moved to the Java backend in migration 069 (JUnit: ChargeRulesTest.chargesOnAnOrder): a charge on an invoice is changed there, not on the order
SELECT pg_temp.as_user('ch.bill');
SELECT pg_temp.add_charge((SELECT id FROM m_inv), (SELECT id FROM charge_item WHERE charge_name = 'Loyalty discount'), 10, 'Goodwill');
SELECT pg_temp.expect_true('A discount added on the draft is taken off, and is recorded on the order',
  (SELECT total = 75 FROM invoice WHERE id = (SELECT id FROM m_inv))
  AND EXISTS (SELECT 1 FROM order_charge WHERE lab_order_id = pg_temp.m_o('M-CHG') AND source = 'Invoice' AND unit_price = -10));
SELECT issue_invoices(ARRAY(SELECT id FROM m_inv));
SELECT pg_temp.expect_true('An invoice of charges alone is issued and numbered',
  (SELECT status = 'Issued' AND invoice_number LIKE 'INV-CFL-%' FROM invoice WHERE id = (SELECT id FROM m_inv)));
SELECT pg_temp.expect_true('QuickBooks gets the discount as a negative line',
  (SELECT bool_or((x->>'Amount')::numeric = -10) FROM jsonb_array_elements(qbo_payload((SELECT id FROM m_inv))->'Line') x));

-------------------------------------------------------------------------------
-- 5. PAYMENT STATUS AND THE PO CORRECTION
-------------------------------------------------------------------------------
SELECT pg_temp.expect_true('An issued invoice not yet due is Unpaid', invoice_payment_status((SELECT id FROM m_inv)) = 'Unpaid');
-- Moved to the Java backend in migration 069 (JUnit: InvoicingRulesTest.paymentsAndTerms): a payment cannot be dated in the future
SELECT pg_temp.m_reason('');
SELECT pg_temp.pay((SELECT id FROM m_inv), site_today(pg_temp.m_site('CFL')), 'Cheque 1042');
SELECT pg_temp.expect_true('Recording the payment marks it Paid, with who and when',
  invoice_payment_status((SELECT id FROM m_inv)) = 'Paid' AND (SELECT paid_recorded_by IS NOT NULL AND paid_note = 'Cheque 1042' FROM invoice WHERE id = (SELECT id FROM m_inv)));
SELECT pg_temp.expect_true('The payment is in the audit trail with its reason',
  EXISTS (SELECT 1 FROM audit_log WHERE table_name = 'invoice' AND record_id = (SELECT id FROM m_inv) AND reason = 'Payment recorded'));
SELECT pg_temp.pay((SELECT id FROM m_inv), NULL, NULL);
SELECT pg_temp.expect_true('A payment record can be cleared', invoice_payment_status((SELECT id FROM m_inv)) = 'Unpaid');
SELECT pg_temp.expect_error_like('An issued invoice''s amounts never change',
  $$SELECT set_invoice_internal(true); UPDATE invoice SET total = 1 WHERE id = (SELECT id FROM m_inv)$$, 'never changed');
SELECT set_invoice_internal(false);
SELECT pg_temp.m_reason('');   -- the payment steps set a reason for their own transaction (the runner runs this file as one)
SELECT pg_temp.expect_error_like('Correcting the PO needs a reason',
  $$SELECT correct_invoice_po((SELECT id FROM m_inv), 'PO-NEW-1')$$, 'Say why');
SELECT pg_temp.m_reason('Client sent the PO after the invoice');
SELECT pg_temp.expect_error_like('Correcting to the same PO is refused',
  $$SELECT correct_invoice_po((SELECT id FROM m_inv), 'M-CHG')$$, 'already');
CREATE TEMP TABLE m_corr AS SELECT correct_invoice_po((SELECT id FROM m_inv), 'PO-NEW-1') AS id;
SELECT pg_temp.expect_true('The PO is corrected on the issued invoice, and the correction keeps the old and new PO and the signature',
  (SELECT po_number = 'PO-NEW-1' FROM invoice WHERE id = (SELECT id FROM m_inv))
  AND (SELECT old_value = 'M-CHG' AND new_value = 'PO-NEW-1' AND signature_id IS NOT NULL AND push_payload->'CustomerMemo'->>'value' LIKE '%PO-NEW-1%'
         FROM invoice_correction WHERE id = (SELECT id FROM m_corr)));
SELECT pg_temp.expect_error_like('A correction is never changed',
  $$SELECT set_invoice_internal(true); UPDATE invoice_correction SET new_value = 'X' WHERE id = (SELECT id FROM m_corr)$$, 'never changed');
SELECT set_invoice_internal(false);
SELECT pg_temp.as_user('ch.ana');
SELECT pg_temp.expect_error_like('Only billing corrects an invoice',
  $$SELECT correct_invoice_po((SELECT id FROM m_inv), 'PO-NEW-2')$$, 'permission');
SELECT pg_temp.as_user('ch.bill');

-------------------------------------------------------------------------------
-- 6. CREDITING A CHARGE
-------------------------------------------------------------------------------
SELECT pg_temp.m_reason('');
CREATE TEMP TABLE m_cn AS SELECT credit_invoice((SELECT id FROM m_inv),
  ARRAY(SELECT l.id FROM invoice_line l JOIN order_charge oc ON oc.id = l.order_charge_id WHERE l.invoice_id = (SELECT id FROM m_inv) AND oc.unit_price = 15), false, 'Shipping waived') AS id;
SELECT pg_temp.expect_true('A credit note credits a charge line and names the charge',
  (SELECT count(*) = 1 AND bool_and(order_charge_id IS NOT NULL AND amount = -15) FROM invoice_line WHERE invoice_id = (SELECT id FROM m_cn)));
SELECT pg_temp.expect_true('A charge credited without re-billing is closed (not ready to invoice again)',
  NOT EXISTS (SELECT 1 FROM charge_ready_view WHERE lab_order_id = pg_temp.m_o('M-CHG')));
-- Moved to the Java backend in migration 069 (JUnit: InvoicingRulesTest.paymentsAndTerms): a credit note is not paid

SELECT set_config('lims.reason', '', false);
SELECT test, outcome AS result FROM results;
