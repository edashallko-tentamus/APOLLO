-- 069: the Report Finalization, OOS investigation, invoicing and order charge rules move to the Java backend (Edashall
-- Konah, 2026-10-29; the database keeps structures only). Java checks them before every write (reports/domain:
-- FinalizationClaim, CoaNote, SampleAttachment; oos/domain: OosInvestigation, OosOpening, Checklist; invoicing/domain:
-- Invoice, InvoiceLine, PaymentTerms; charges/domain: OrderCharge), loaded and saved by reports/repo/ReportsStore,
-- oos/repo/OosStore, invoicing/repo/InvoiceStore and charges/repo/OrderChargeStore, with JUnit tests in ReportsRulesTest,
-- OosRulesTest, InvoicingRulesTest and ChargeRulesTest.
--
-- Dropped here (Java is now their only checker):
--   * claim_finalization and release_finalization_claim;
--   * the rule parts of coa_note_rules (the test is on the sample, canned notes from COA comments, a note keeps its sample
--     and kind) and the coa_note CHECKs (non-blank text, a result's note names its test); the rule parts of
--     sample_attachment_rules (the sample is on the order, an attachment keeps its file);
--   * open_oos, record_oos_checks, sign_oos_analyst, sign_oos_supervisor, cancel_oos, order_oos_retest,
--     record_retest_determination, handle_oos_response, record_oos_phase2, the cascade z_oos_phase2
--     (oos_phase2_from_retest: Java's client retest records the Phase II decision);
--   * claim_invoice_work, claim_invoice_charges, update_invoice_draft, remove_invoice_lines, release_invoice_draft,
--     set_invoice_line_rush, set_invoice_line_price, add_invoice_charge, record_invoice_payment, set_client_payment_terms,
--     the trigger client_payment_terms_rule (a02_payment_terms) and the CHECK on client.payment_terms_days;
--   * the rule parts of order_charge_rules (the sample on the order, a retired charge or another lab's, a reason for
--     another price, order and item fixed, a cancelled or invoiced charge kept, a reason to change) and its derived
--     amounts (the signed list price, the client's quoted or typed price: Java writes them), and the CHECK on its quantity.
--
-- Kept, with Java's own copy for Java's writes:
--   * the permission checks of coa_note_rules, sample_attachment_rules and order_charge_rules (a later wave moves the
--     permission triggers), and require_permission_at / assert_signed, which Java calls so refusals keep their words;
--   * result_finalization_claims, finalization_holder and the guard finalization_claim_rules with claims_internal:
--     Node's finalization (finalize_sample, it makes the COA PDF) closes claims through them and refuses someone else's
--     claimed test; Java marks its claims and releases with lims.claims_internal;
--   * conclude_oos, oos_get, oos_assert_answers (Node's conclusion, it makes the report PDF), record_oos_client_response
--     (the client's public page in Node), the guard oos_tables_rules (a01_rules on oos_investigation and
--     oos_client_response: those Node steps write through it; Java marks its writes with lims.oos_internal), oos_release_problem and oos_awaiting_phase2 (the COA release check),
--     requested_test_billing (orders' table: a retest's billing follows QA's determination; Java marks its own write with
--     lims.oos_internal), oos_internal and set_oos_internal;
--   * every function the Node PDF routes call (issue_invoices, credit_invoice, correct_invoice_po, record_invoice_document,
--     send_invoice, next_invoice_number, finalize_sample, conclude_oos, record_oos_client_response, send_quote) with its
--     checks and rule triggers, unchanged;
--   * invoice_rules and invoice_line_rules (an issued invoice never changes): Node's issue, credit note and PO correction
--     and the catch-up (seed_029) write through them, so Java marks its writes with lims.invoice_internal;
--     invoice_own_draft, invoice_totals (issue_invoices, credit_invoice), invoice_add_line (invoice_catch_up);
--     invoice_draft_for and invoice_add_charge_line (the SQL rule tests' fixtures build drafts with them; Java has its
--     own copy in InvoiceStore);
--   * the read models invoice_rush_options, invoice_payment_status, order_billing, invoice_ready_view, charge_ready_view,
--     client_charge_price, charge_sign, test_awaits_finalization: Java reads them and decides itself.
-- Sandbox only: other writers of these tables (data load scripts) are no longer checked by the dropped rules.

-- Report Finalization: claims, notes, attachments
DROP FUNCTION IF EXISTS claim_finalization(uuid[], text);
DROP FUNCTION IF EXISTS release_finalization_claim(uuid, uuid[]);

CREATE OR REPLACE FUNCTION coa_note_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    -- the system's own note (group sync) needs no reports.notes
    IF NOT in_group_sync() THEN
        PERFORM require_permission_at('reports.notes', (SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = NEW.sample_id));
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE coa_note DROP CONSTRAINT IF EXISTS coa_note_note_text_check;
ALTER TABLE coa_note DROP CONSTRAINT IF EXISTS coa_note_check;

CREATE OR REPLACE FUNCTION sample_attachment_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_site uuid;
BEGIN
    SELECT site_id INTO v_site FROM lab_order WHERE id = NEW.lab_order_id;
    IF NOT (has_permission_at('orders.edit', v_site) OR has_permission_at('reports.notes', v_site)) THEN
        PERFORM require_permission_at('orders.edit', v_site);
    END IF;
    RETURN NEW;
END $$;

-- OOS investigations
DROP FUNCTION IF EXISTS open_oos(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS record_oos_checks(uuid, jsonb);
DROP FUNCTION IF EXISTS sign_oos_analyst(uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS sign_oos_supervisor(uuid, jsonb, text);
DROP FUNCTION IF EXISTS cancel_oos(uuid, text);
DROP FUNCTION IF EXISTS order_oos_retest(uuid, text, integer, uuid);
DROP FUNCTION IF EXISTS record_retest_determination(uuid, text, text);
DROP FUNCTION IF EXISTS handle_oos_response(uuid, text);
DROP FUNCTION IF EXISTS record_oos_phase2(uuid, text, text);
DROP TRIGGER IF EXISTS z_oos_phase2 ON requested_test;
DROP FUNCTION IF EXISTS oos_phase2_from_retest();

-- Invoicing: drafts, payments, payment terms
DROP FUNCTION IF EXISTS claim_invoice_work(uuid[], text);
DROP FUNCTION IF EXISTS claim_invoice_charges(uuid[], text);
DROP FUNCTION IF EXISTS update_invoice_draft(uuid, text, text, text);
DROP FUNCTION IF EXISTS remove_invoice_lines(uuid[]);
DROP FUNCTION IF EXISTS release_invoice_draft(uuid);
DROP FUNCTION IF EXISTS set_invoice_line_rush(uuid, uuid, text);
DROP FUNCTION IF EXISTS set_invoice_line_price(uuid, numeric, text);
DROP FUNCTION IF EXISTS add_invoice_charge(uuid, uuid, integer, numeric, text, uuid);
DROP FUNCTION IF EXISTS record_invoice_payment(uuid, date, text);
DROP FUNCTION IF EXISTS set_client_payment_terms(uuid, integer);
DROP TRIGGER IF EXISTS a02_payment_terms ON client;
DROP FUNCTION IF EXISTS client_payment_terms_rule();
ALTER TABLE client DROP CONSTRAINT IF EXISTS client_payment_terms_days_check;

-- Charges on orders: the permission check stays (billing adds charges at invoicing, the order page otherwise)
CREATE OR REPLACE FUNCTION order_charge_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT in_group_sync() THEN
        PERFORM require_permission_at(CASE WHEN NEW.source = 'Invoice' THEN 'invoicing.issue' ELSE 'orders.edit' END,
            (SELECT site_id FROM lab_order WHERE id = NEW.lab_order_id));
    END IF;
    RETURN NEW;
END $$;
ALTER TABLE order_charge DROP CONSTRAINT IF EXISTS order_charge_quantity_check;
