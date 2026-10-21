-- I-1 Invoicing (Alex, 2026-10-15). Vault: Decision - Invoicing Is Done in the LIMS, Decision - Invoicing I-1.
--  - "LIMS will do all the invoicing ... invoices need to be sent to the client from LIMS"; an API pushes them to the
--    accounting side. Each lab is its own QuickBooks Online company; QuickBooks Online first (Desktop and SAP later).
--  - "We want invoicing to be flexible - any completed work can be invoiced at any time." Completed = the test has
--    been on an issued COA (sent to the client). Partial invoices per lab order; the order shows its billing.
--  - "someone manually reviews invoices and pushes them to the client/quickbooks. Much like the QA Finalization module,
--    the user reviewing should group what they want to review first and claims them": claiming work makes the
--    reviewer's own Draft invoice for each lab order; they check the discounts, then issue (signed "Invoiced by").
--  - Late rush: a rush test reported after its due date shows by how many days, and the reviewer may bill the closest
--    rush tier whose turnaround was actually met (or standard).
--  - Retests are shown clearly on the invoice. Net 30 by default per client; no sales tax (finance to confirm).
--  - An issued invoice is never edited: corrections by credit note.
--  - Permission for the Accounting group and General Managers.
--  - Catch-up: work completed before go-live is invoiced on the Friday of the week its COA was issued ("that mimics
--    how we currently invoice on a weekly basis"); catch-up invoices are not emailed or pushed (Claude's choice).
BEGIN;
SET search_path = lims, public;
SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'system'), true);
SELECT set_config('lims.group_sync', '1', true);
SELECT set_config('lims.reason', 'Migration 036: invoicing', true);

-------------------------------------------------------------------------------
-- 0. PERMISSIONS, CLIENT PAYMENT TERMS, LAB INVOICE SETTINGS
-------------------------------------------------------------------------------
INSERT INTO permission (code, module, area, description, cross_lab, sort_order) VALUES
 ('invoicing.view', 'Invoicing', 'Invoices', 'See the work ready to invoice, invoices, credit notes and each order''s billing', true, 110),
 ('invoicing.issue', 'Invoicing', 'Invoices', 'Claim completed work into draft invoices, check them, issue invoices and credit notes, set clients'' payment terms', false, 111);
CREATE TEMP TABLE new_std_perms (group_name text, perms text[]) ON COMMIT DROP;
INSERT INTO new_std_perms VALUES ('Accounting', '{invoicing.view,invoicing.issue}'), ('General Manager', '{invoicing.view,invoicing.issue}'),
 ('Account Manager', '{invoicing.view}'), ('Project Manager', '{invoicing.view}');
UPDATE standard_group_template t SET permissions = array(SELECT DISTINCT x FROM unnest(t.permissions || n.perms) x)
  FROM new_std_perms n WHERE n.group_name = t.group_name;
INSERT INTO group_permission (group_id, permission_code)
SELECT g.id, p FROM lab_group g JOIN new_std_perms n ON n.group_name = g.group_name, unnest(n.perms) p
 WHERE g.is_standard AND g.site_id IS NOT NULL ON CONFLICT DO NOTHING;

ALTER TABLE reason_code DROP CONSTRAINT reason_code_module_check;
ALTER TABLE reason_code ADD CONSTRAINT reason_code_module_check
    CHECK (module IN ('General','Clients','Orders','Quotes','Catalog','Inventory','Equipment','Purchasing','Methods','Testing','Reports','COA comments','Logbooks','Invoicing','Admin'));

-- Payment terms per client (days after the invoice date); kept by the people who issue invoices
ALTER TABLE client ADD COLUMN payment_terms_days integer NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 365);
CREATE FUNCTION client_payment_terms_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.payment_terms_days IS DISTINCT FROM OLD.payment_terms_days AND NOT in_group_sync()
       AND NOT has_permission('invoicing.issue') AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'Only people who issue invoices (invoicing.issue) change a client''s payment terms';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a02_payment_terms BEFORE UPDATE OF payment_terms_days ON client FOR EACH ROW EXECUTE FUNCTION client_payment_terms_rule();
CREATE FUNCTION set_client_payment_terms(p_client uuid, p_days integer) RETURNS void LANGUAGE plpgsql AS $$
DECLARE prev text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    IF NOT has_permission('invoicing.issue') AND NOT current_user_is_admin() THEN
        RAISE EXCEPTION 'Only people who issue invoices (invoicing.issue) change a client''s payment terms';
    END IF;
    IF p_days IS NULL OR p_days < 0 OR p_days > 365 THEN RAISE EXCEPTION 'Payment terms are 0 to 365 days'; END IF;
    PERFORM ensure_reason('Payment terms changed');
    PERFORM set_config('lims.group_sync', '1', true);   -- not a change to the client's master data (master.clients)
    UPDATE client SET payment_terms_days = p_days WHERE id = p_client;
    PERFORM set_config('lims.group_sync', prev, true);
    IF NOT FOUND THEN RAISE EXCEPTION 'Client not found'; END IF;
END $$;

-- What the invoice says about paying the lab (each lab is its own company); placeholder until finance provides it
ALTER TABLE lab_site ADD COLUMN invoice_remit_to text;

CREATE FUNCTION invoice_internal() RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT COALESCE(current_setting('lims.invoice_internal', true), '') = '1'
$$;
CREATE FUNCTION set_invoice_internal(p_on boolean) RETURNS text LANGUAGE sql AS $$
    SELECT set_config('lims.invoice_internal', CASE WHEN p_on THEN '1' ELSE '' END, true)
$$;

-------------------------------------------------------------------------------
-- 1. WHEN IS A TEST'S WORK COMPLETE? (its COA issued to the client)
-------------------------------------------------------------------------------
-- The first issued COA version that carried the test's results: the version its finalization issued, or (a client
-- who takes no partial reports) the first version of the sample's COA issued after it was finalized
CREATE FUNCTION test_reported_at(p_rt uuid) RETURNS timestamptz LANGUAGE sql STABLE AS $$
    SELECT min(COALESCE((SELECT cv.issued_at FROM coa_version cv WHERE cv.id = f.coa_version_id),
                        (SELECT min(cv.issued_at) FROM coa JOIN coa_version cv ON cv.coa_id = coa.id WHERE coa.sample_id = rt.sample_id AND cv.issued_at >= f.finalized_at)))
      FROM result_finalization f JOIN requested_test rt ON rt.id = f.requested_test_id
     WHERE f.requested_test_id = p_rt
$$;
-- Billing completion: when the test was reported; a test never reported because a retest replaced it (a lab
-- investigation retest) is complete when its retest is reported
CREATE FUNCTION billing_completed_at(p_rt uuid) RETURNS timestamptz LANGUAGE plpgsql STABLE AS $$
DECLARE d timestamptz := test_reported_at(p_rt); r2 uuid; depth integer := 0; cur uuid := p_rt;
BEGIN
    WHILE d IS NULL AND depth < 5 LOOP
        SELECT id INTO r2 FROM requested_test WHERE retest_of_id = cur AND status <> 'Cancelled' ORDER BY created_at DESC LIMIT 1;
        IF r2 IS NULL THEN RETURN NULL; END IF;
        d := test_reported_at(r2); cur := r2; depth := depth + 1;
    END LOOP;
    RETURN d;
END $$;

-- Days late: working days after the due date for business-day tests, calendar days otherwise (0 = on time)
CREATE FUNCTION days_late(p_site uuid, p_due date, p_done date, p_unit tat_unit) RETURNS integer LANGUAGE sql STABLE AS $$
    SELECT CASE WHEN p_due IS NULL OR p_done IS NULL OR p_done <= p_due THEN 0
                WHEN p_unit = 'Calendar Days' THEN p_done - p_due
                ELSE (SELECT count(*)::integer FROM generate_series(p_due + 1, p_done, interval '1 day') g WHERE is_working_day(p_site, g::date)) END
$$;

-- The rush choices for billing a test: standard (no rush fee) and every tier of the test's rush schedule on the
-- client's quote, with the due date each would have given (from the test's Day 0) and whether it was met
CREATE FUNCTION invoice_rush_options(p_rt uuid, p_done date DEFAULT NULL)
RETURNS TABLE (tier_id uuid, tier_name text, tat_days integer, tat_unit tat_unit, due_date date, met boolean, fee numeric, is_ordered boolean)
LANGUAGE plpgsql STABLE AS $$
DECLARE r requested_test; o lab_order; e test_catalog_entry; q quoted_test_configuration; v_done date;
BEGIN
    SELECT * INTO r FROM requested_test WHERE id = p_rt;
    SELECT lo.* INTO o FROM sample s JOIN lab_order lo ON lo.id = s.lab_order_id WHERE s.id = r.sample_id;
    SELECT * INTO e FROM test_catalog_entry WHERE test_id = r.test_id;
    SELECT * INTO q FROM quoted_test_configuration WHERE id = r.quoted_line_id;
    v_done := COALESCE(p_done, (billing_completed_at(p_rt) AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = o.site_id))::date);
    tier_id := NULL; tier_name := 'Standard (no rush fee)'; tat_days := e.standard_tat; tat_unit := e.tat_unit;
    due_date := CASE WHEN r.day0 IS NOT NULL AND e.standard_tat IS NOT NULL THEN tat_due(o.site_id, r.day0, e.standard_tat, e.tat_unit) END;
    met := due_date IS NULL OR v_done IS NULL OR v_done <= due_date; fee := 0;
    is_ordered := r.rush_tier_id IS NULL OR r.rush_fee = 0;
    RETURN NEXT;
    IF q.id IS NULL OR e.rush_schedule_id IS NULL THEN RETURN; END IF;
    FOR tier_id, tier_name, tat_days, tat_unit, fee IN
        SELECT qr.tier_id, qr.tier_name, qr.rush_tat, qr.tat_unit,
               round(CASE WHEN qr.surcharge_type = 'Flat' THEN qr.surcharge_value ELSE r.price * qr.surcharge_value / 100 END * (1 - qr.discount_pct / 100), 2)
          FROM quote_rush_term qr JOIN rush_fee_tier ft ON ft.id = qr.tier_id
         WHERE qr.project_version_id = q.project_version_id AND ft.schedule_id = e.rush_schedule_id ORDER BY qr.rush_tat LOOP
        due_date := CASE WHEN r.day0 IS NOT NULL THEN tat_due(o.site_id, r.day0, tat_days, tat_unit) END;
        met := due_date IS NULL OR v_done IS NULL OR v_done <= due_date;
        is_ordered := r.rush_tier_id = tier_id AND r.rush_fee > 0;
        IF r.billing_status = 'Non-billable' THEN fee := 0; END IF;
        RETURN NEXT;
    END LOOP;
END $$;

-------------------------------------------------------------------------------
-- 2. INVOICES, CREDIT NOTES AND THEIR LINES
-------------------------------------------------------------------------------
-- Gapless numbers per lab and kind (INV-CFL-000001, CN-CFL-000001), given when an invoice is issued
CREATE TABLE invoice_counter (
    site_id   uuid NOT NULL REFERENCES lab_site(id),
    kind      text NOT NULL,
    last_no   integer NOT NULL DEFAULT 0,
    PRIMARY KEY (site_id, kind)
);
CREATE FUNCTION invoice_counter_rule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF invoice_internal() THEN RETURN COALESCE(NEW, OLD); END IF;
    RAISE EXCEPTION 'Invoice numbers are given only when an invoice is issued';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE OR DELETE ON invoice_counter FOR EACH ROW EXECUTE FUNCTION invoice_counter_rule();
CREATE FUNCTION next_invoice_number(p_site uuid, p_kind text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
    INSERT INTO invoice_counter (site_id, kind, last_no) VALUES (p_site, p_kind, 1)
    ON CONFLICT (site_id, kind) DO UPDATE SET last_no = invoice_counter.last_no + 1 RETURNING last_no INTO n;
    RETURN CASE WHEN p_kind = 'Credit note' THEN 'CN-' ELSE 'INV-' END || (SELECT site_code FROM lab_site WHERE id = p_site) || '-' || lpad(n::text, 6, '0');
END $$;

CREATE SEQUENCE invoice_draft_seq;
CREATE TABLE invoice (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    draft_code          text NOT NULL UNIQUE DEFAULT 'DR-' || lpad(nextval('invoice_draft_seq')::text, 6, '0'),
    invoice_number      text UNIQUE,                       -- given at issue
    kind                text NOT NULL DEFAULT 'Invoice' CHECK (kind IN ('Invoice','Credit note')),
    status              text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Issued','Discarded')),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    client_id           uuid NOT NULL REFERENCES client(id),
    lab_order_id        uuid NOT NULL REFERENCES lab_order(id),
    credit_of_id        uuid REFERENCES invoice(id),       -- a credit note: the invoice it credits
    claimed_by          uuid REFERENCES app_user(id),      -- a draft: who is checking it
    note                text,                              -- printed on the invoice
    internal_note       text,
    po_number           text,
    bill_to_name        text,
    bill_to_address     text,
    payment_terms_days  integer,
    invoice_date        date,
    due_date            date,
    currency            text NOT NULL DEFAULT 'USD',
    list_total          numeric(12,2) NOT NULL DEFAULT 0,
    discount_total      numeric(12,2) NOT NULL DEFAULT 0,
    rush_total          numeric(12,2) NOT NULL DEFAULT 0,
    total               numeric(12,2) NOT NULL DEFAULT 0,  -- negative for a credit note
    catchup             boolean NOT NULL DEFAULT false,    -- issued for work completed before invoicing went live
    reason              text,                              -- a credit note: why
    issued_at           timestamptz,
    issued_by           uuid REFERENCES app_user(id),
    signature_id        uuid REFERENCES signature_event(id),
    issue_txid          bigint,
    document_id         uuid REFERENCES document_file(id),
    sha256              text,
    sent_at             timestamptz,
    discarded_at        timestamptz,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CHECK (status <> 'Issued' OR (invoice_number IS NOT NULL AND invoice_date IS NOT NULL AND due_date IS NOT NULL AND issued_at IS NOT NULL)),
    CHECK ((kind = 'Credit note') = (credit_of_id IS NOT NULL))
);
CREATE INDEX invoice_order ON invoice (lab_order_id);
CREATE INDEX invoice_site_date ON invoice (site_id, invoice_date);
CALL make_gxp('invoice', false);

CREATE TABLE invoice_line (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          uuid NOT NULL REFERENCES invoice(id),
    line_no             integer NOT NULL,
    kind                text NOT NULL DEFAULT 'Charge' CHECK (kind IN ('Charge','Credit')),
    status              text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Removed')),
    requested_test_id   uuid NOT NULL REFERENCES requested_test(id),
    credits_line_id     uuid REFERENCES invoice_line(id),  -- a credit: the invoice line it credits
    rebill              boolean,                           -- a credit: the work can be invoiced again
    sample_code         text NOT NULL,
    client_sample_id    text,
    test_code           text,
    test_name           text NOT NULL,
    completed_on        date,
    due_date            date,
    late_days           integer NOT NULL DEFAULT 0,
    list_price          numeric(12,2) NOT NULL DEFAULT 0,
    quoted_price        numeric(12,2) NOT NULL DEFAULT 0,  -- the price on the order (from the quote)
    price               numeric(12,2) NOT NULL DEFAULT 0,  -- the price billed
    price_note          text,                              -- why the billed price differs from the order
    rush_ordered        text,                              -- the rush tier ordered (name), if any
    rush_ordered_fee    numeric(12,2) NOT NULL DEFAULT 0,
    rush_tier_id        uuid,                              -- the tier billed (NULL = no rush fee)
    rush_billed         text,
    rush_fee            numeric(12,2) NOT NULL DEFAULT 0,
    rush_note           text,
    retest_of_id        uuid REFERENCES requested_test(id),
    line_note           text,                              -- printed: retests, non-billable work
    amount              numeric(12,2) NOT NULL,            -- price + rush fee (negative on a credit)
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    CHECK ((kind = 'Credit') = (credits_line_id IS NOT NULL))
);
CREATE INDEX invoice_line_invoice ON invoice_line (invoice_id);
CREATE INDEX invoice_line_test ON invoice_line (requested_test_id);
CREATE UNIQUE INDEX invoice_line_credited_once ON invoice_line (credits_line_id) WHERE credits_line_id IS NOT NULL;
CALL make_gxp('invoice_line', false);

-- Invoices are written only by the steps below; an issued invoice or credit note never changes (apart from its
-- PDF and sending, recorded once in the transaction that issued it)
CREATE FUNCTION invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT invoice_internal() THEN RAISE EXCEPTION 'Invoices change only through Billing (claim, check, issue, credit)'; END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Issued' THEN
        IF (to_jsonb(NEW) - ARRAY['document_id','sha256','sent_at','record_version','modified_at','modified_by'])
           IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['document_id','sha256','sent_at','record_version','modified_at','modified_by'])
           OR (OLD.document_id IS NOT NULL AND NEW.document_id IS DISTINCT FROM OLD.document_id) THEN
            RAISE EXCEPTION '% is issued and is never changed: correct it with a credit note', OLD.invoice_number;
        END IF;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'Discarded' THEN RAISE EXCEPTION 'A discarded draft is kept as it was'; END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON invoice FOR EACH ROW EXECUTE FUNCTION invoice_rules();
CREATE FUNCTION invoice_line_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
    IF NOT invoice_internal() THEN RAISE EXCEPTION 'Invoices change only through Billing (claim, check, issue, credit)'; END IF;
    IF TG_OP = 'UPDATE' THEN
        SELECT status INTO st FROM invoice WHERE id = OLD.invoice_id;
        IF st <> 'Draft' THEN RAISE EXCEPTION 'Lines of an issued invoice are never changed: correct it with a credit note'; END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON invoice_line FOR EACH ROW EXECUTE FUNCTION invoice_line_rules();

-- A test's billing now: the active charge on a draft or issued invoice that no issued credit note has taken back
CREATE FUNCTION test_invoice_line(p_rt uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT l.id FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id
     WHERE l.requested_test_id = p_rt AND l.kind = 'Charge' AND l.status = 'Active' AND i.status IN ('Draft','Issued')
       AND NOT EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id WHERE c.credits_line_id = l.id AND ci.status = 'Issued')
     ORDER BY l.created_at DESC LIMIT 1
$$;
-- Credited without re-billing (the charge was taken back for good)
CREATE FUNCTION test_billing_closed(p_rt uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id JOIN invoice_line l ON l.id = c.credits_line_id
                    WHERE l.requested_test_id = p_rt AND ci.status = 'Issued' AND NOT c.rebill)
$$;

-------------------------------------------------------------------------------
-- 3. WORK READY TO INVOICE
-------------------------------------------------------------------------------
CREATE VIEW billable_test_view AS
SELECT rt.id AS requested_test_id, rt.sample_id, s.sample_code, s.client_sample_id, o.id AS lab_order_id, o.order_code, o.po_number, o.site_id, si.site_code,
       o.client_id, COALESCE(c.display_name, c.legal_name) AS client_name, c.is_internal, rt.test_id, t.test_code, t.test_name, rt.status::text AS test_status,
       rt.list_price, rt.price, rt.rush_fee, rt.rush_status::text AS rush_status, rt.rush_tier_id,
       (SELECT qr.tier_name FROM quote_rush_term qr JOIN quoted_test_configuration q ON q.project_version_id = qr.project_version_id
         WHERE q.id = rt.quoted_line_id AND qr.tier_id = rt.rush_tier_id LIMIT 1) AS rush_tier_name,
       rt.due_date, rt.tat_unit, rt.retest_of_id, rt.source::text AS source, rt.billing_status, rt.oos_investigation_id, rt.stability_pull_id, rt.media_lot_id,
       billing_completed_at(rt.id) AS completed_at
  FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id
  JOIN lab_site si ON si.id = o.site_id JOIN test t ON t.id = rt.test_id;

CREATE VIEW invoice_ready_view AS
SELECT b.*, (b.completed_at AT TIME ZONE si.time_zone)::date AS completed_on,
       days_late(b.site_id, b.due_date, (b.completed_at AT TIME ZONE si.time_zone)::date, b.tat_unit) AS late_days,
       b.price + b.rush_fee AS amount, b.list_price - b.price AS discount,
       (b.retest_of_id IS NOT NULL) AS is_retest,
       (SELECT s0.sample_code || ' ' || t0.test_name FROM requested_test r0 JOIN sample s0 ON s0.id = r0.sample_id JOIN test t0 ON t0.id = r0.test_id WHERE r0.id = b.retest_of_id) AS retest_of,
       (SELECT x.oos_code FROM oos_investigation x WHERE x.id = b.oos_investigation_id) AS oos_code,
       EXISTS (SELECT 1 FROM requested_test r2 WHERE r2.retest_of_id = b.requested_test_id AND r2.status <> 'Cancelled') AS was_retested
  FROM billable_test_view b JOIN lab_site si ON si.id = b.site_id
 WHERE NOT b.is_internal AND b.media_lot_id IS NULL AND b.test_status <> 'Cancelled' AND b.completed_at IS NOT NULL
   AND b.billing_status IS DISTINCT FROM 'Pending QA determination'
   AND test_invoice_line(b.requested_test_id) IS NULL AND NOT test_billing_closed(b.requested_test_id);

-- The line a test makes (billed as ordered)
CREATE FUNCTION invoice_line_text(p_rt uuid) RETURNS text LANGUAGE sql STABLE AS $$
    SELECT concat_ws(' ',
        CASE WHEN r.retest_of_id IS NOT NULL THEN
            'Retest of ' || (SELECT s0.sample_code || ' ' || t0.test_name FROM requested_test r0 JOIN sample s0 ON s0.id = r0.sample_id JOIN test t0 ON t0.id = r0.test_id WHERE r0.id = r.retest_of_id)
            || COALESCE(' (' || (SELECT x.oos_code FROM oos_investigation x WHERE x.id = r.oos_investigation_id) || ')', '')
            || CASE WHEN r.source = 'Lab Investigation Retest' THEN ', ordered by the lab'
                    WHEN r.source = 'Client OOS Retest' THEN ', ordered by the client' ELSE '' END
            || CASE WHEN r.billing_status = 'Non-billable' THEN ': not charged.' ELSE '.' END END,
        CASE WHEN EXISTS (SELECT 1 FROM requested_test r2 WHERE r2.retest_of_id = r.id AND r2.status <> 'Cancelled') AND test_reported_at(r.id) IS NULL
             THEN 'Retested; the result was reported from the retest.' END,
        CASE WHEN r.stability_pull_id IS NOT NULL THEN COALESCE((SELECT 'Stability study ' || st.study_code || ', ' || tp.label || ' pull.' FROM stability_pull p
             JOIN stability_study st ON st.id = p.study_id JOIN stability_timepoint tp ON tp.id = p.timepoint_id WHERE p.id = r.stability_pull_id), 'Stability pull.') END)
      FROM requested_test r WHERE r.id = p_rt
$$;

-------------------------------------------------------------------------------
-- 4. CLAIMING WORK INTO DRAFTS, CHECKING THEM
-------------------------------------------------------------------------------
CREATE FUNCTION invoice_totals(p_invoice uuid) RETURNS void LANGUAGE sql AS $$
    UPDATE invoice i SET list_total = COALESCE(x.lt, 0), discount_total = COALESCE(x.dt, 0), rush_total = COALESCE(x.rt, 0), total = COALESCE(x.t, 0)
      FROM (SELECT sum(CASE WHEN kind = 'Credit' THEN -list_price ELSE list_price END) AS lt,
                   sum(CASE WHEN kind = 'Credit' THEN -(list_price - price) ELSE list_price - price END) AS dt,
                   sum(CASE WHEN kind = 'Credit' THEN -rush_fee ELSE rush_fee END) AS rt, sum(amount) AS t
              FROM invoice_line WHERE invoice_id = p_invoice AND status = 'Active') x
     WHERE i.id = p_invoice
$$;

CREATE FUNCTION invoice_add_line(p_invoice uuid, p_rt uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE b record; v uuid; n integer;
BEGIN
    SELECT * INTO b FROM invoice_ready_view WHERE requested_test_id = p_rt;
    SELECT COALESCE(max(line_no), 0) + 1 INTO n FROM invoice_line WHERE invoice_id = p_invoice;
    INSERT INTO invoice_line (invoice_id, line_no, requested_test_id, sample_code, client_sample_id, test_code, test_name, completed_on, due_date, late_days,
                              list_price, quoted_price, price, rush_ordered, rush_ordered_fee, rush_tier_id, rush_billed, rush_fee, retest_of_id, line_note, amount)
    VALUES (p_invoice, n, p_rt, b.sample_code, b.client_sample_id, b.test_code, b.test_name, b.completed_on, b.due_date, b.late_days,
            b.list_price, b.price, b.price, CASE WHEN b.rush_fee > 0 THEN COALESCE(b.rush_tier_name, 'Rush') END, b.rush_fee,
            CASE WHEN b.rush_fee > 0 THEN b.rush_tier_id END, CASE WHEN b.rush_fee > 0 THEN COALESCE(b.rush_tier_name, 'Rush') END, b.rush_fee,
            b.retest_of_id, NULLIF(invoice_line_text(p_rt), ''), b.price + b.rush_fee)
    RETURNING id INTO v;
    RETURN v;
END $$;

-- Claim completed work: each lab order's tests go onto the claimer's own Draft for that order (made if needed).
-- Nobody else can claim, change or issue them until the draft is issued or released.
CREATE FUNCTION claim_invoice_work(p_tests uuid[], p_note text DEFAULT NULL) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE v_rt uuid; b record; inv uuid; out uuid[] := '{}'; o record; holder text;
BEGIN
    IF COALESCE(cardinality(p_tests), 0) = 0 THEN RAISE EXCEPTION 'Choose the completed work to invoice'; END IF;
    PERFORM 1 FROM requested_test WHERE id = ANY (p_tests) ORDER BY id FOR UPDATE;   -- one claim at a time per test
    FOREACH v_rt IN ARRAY p_tests LOOP
        SELECT * INTO b FROM invoice_ready_view WHERE requested_test_id = v_rt;
        IF b.requested_test_id IS NULL THEN
            SELECT i.draft_code, u.full_name INTO o FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id LEFT JOIN app_user u ON u.id = i.claimed_by
             WHERE l.id = test_invoice_line(v_rt);
            RAISE EXCEPTION '% on %: %', (SELECT t.test_name FROM requested_test r JOIN test t ON t.id = r.test_id WHERE r.id = v_rt),
                (SELECT s.sample_code FROM requested_test r JOIN sample s ON s.id = r.sample_id WHERE r.id = v_rt),
                CASE WHEN o.draft_code IS NOT NULL THEN 'already on a draft or invoice (' || o.draft_code || COALESCE(', ' || o.full_name, '') || ')'
                     ELSE 'not ready to invoice (its COA has not been issued, or it is not billed)' END;
        END IF;
        PERFORM require_permission_at('invoicing.issue', b.site_id);
    END LOOP;
    PERFORM ensure_reason('Work claimed for invoicing');
    PERFORM set_invoice_internal(true);
    FOR o IN SELECT DISTINCT r.lab_order_id, r.site_id, r.client_id, r.po_number FROM invoice_ready_view r WHERE r.requested_test_id = ANY (p_tests) LOOP
        SELECT id INTO inv FROM invoice WHERE lab_order_id = o.lab_order_id AND status = 'Draft' AND kind = 'Invoice' AND claimed_by = current_app_user()
         ORDER BY created_at LIMIT 1;
        IF inv IS NULL THEN
            INSERT INTO invoice (site_id, client_id, lab_order_id, claimed_by, po_number, internal_note)
            VALUES (o.site_id, o.client_id, o.lab_order_id, current_app_user(), o.po_number, NULLIF(btrim(p_note), '')) RETURNING id INTO inv;
        END IF;
        FOR v_rt IN SELECT r.requested_test_id FROM invoice_ready_view r WHERE r.requested_test_id = ANY (p_tests) AND r.lab_order_id = o.lab_order_id
                     ORDER BY r.sample_code, r.test_name LOOP
            PERFORM invoice_add_line(inv, v_rt);
        END LOOP;
        PERFORM invoice_totals(inv);
        out := out || inv;
    END LOOP;
    PERFORM set_invoice_internal(false);
    RETURN out;
END $$;

-- The draft being changed: the claimer's own
CREATE FUNCTION invoice_own_draft(p_invoice uuid) RETURNS invoice LANGUAGE plpgsql AS $$
DECLARE i invoice;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.status <> 'Draft' THEN RAISE EXCEPTION '% is % and cannot be changed', COALESCE(i.invoice_number, i.draft_code), lower(i.status); END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    IF i.claimed_by IS DISTINCT FROM current_app_user() THEN
        RAISE EXCEPTION '% is being checked by %: only they change or issue it', i.draft_code, (SELECT full_name FROM app_user WHERE id = i.claimed_by);
    END IF;
    RETURN i;
END $$;

-- The PO number and the note printed on the invoice
CREATE FUNCTION update_invoice_draft(p_invoice uuid, p_po text, p_note text, p_internal text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i invoice := invoice_own_draft(p_invoice);
BEGIN
    PERFORM ensure_reason('Draft invoice checked');
    PERFORM set_invoice_internal(true);
    UPDATE invoice SET po_number = NULLIF(btrim(p_po), ''), note = NULLIF(btrim(p_note), ''), internal_note = NULLIF(btrim(p_internal), '') WHERE id = i.id;
    PERFORM set_invoice_internal(false);
END $$;

-- Take lines off a draft (the work goes back to Ready to invoice); a draft left empty is discarded
CREATE FUNCTION remove_invoice_lines(p_lines uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i record; n integer := 0; k integer;
BEGIN
    IF COALESCE(cardinality(p_lines), 0) = 0 THEN RAISE EXCEPTION 'Choose the lines to take off'; END IF;
    PERFORM ensure_reason('Taken off the draft invoice');
    FOR i IN SELECT DISTINCT invoice_id FROM invoice_line WHERE id = ANY (p_lines) LOOP
        PERFORM invoice_own_draft(i.invoice_id);
        PERFORM set_invoice_internal(true);
        UPDATE invoice_line SET status = 'Removed' WHERE invoice_id = i.invoice_id AND id = ANY (p_lines) AND status = 'Active';
        GET DIAGNOSTICS k = ROW_COUNT; n := n + k;
        IF NOT EXISTS (SELECT 1 FROM invoice_line WHERE invoice_id = i.invoice_id AND status = 'Active') THEN
            UPDATE invoice SET status = 'Discarded', discarded_at = clock_timestamp() WHERE id = i.invoice_id;
        ELSE PERFORM invoice_totals(i.invoice_id); END IF;
        PERFORM set_invoice_internal(false);
    END LOOP;
    RETURN n;
END $$;

-- Release a draft (all its work back to Ready to invoice): its claimer, or a lab administrator with a reason
CREATE FUNCTION release_invoice_draft(p_invoice uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i invoice;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.status <> 'Draft' THEN RAISE EXCEPTION '% is % already', COALESCE(i.invoice_number, i.draft_code), lower(i.status); END IF;
    IF i.claimed_by IS DISTINCT FROM current_app_user() THEN
        IF NOT has_permission_at('admin.users', i.site_id) THEN
            RAISE EXCEPTION '% is being checked by %: only they, or a lab administrator, can release it', i.draft_code, (SELECT full_name FROM app_user WHERE id = i.claimed_by);
        END IF;
        IF current_reason() IS NULL OR current_reason() = 'Draft invoice released' THEN RAISE EXCEPTION 'Say why you release someone else''s draft'; END IF;
    ELSE
        PERFORM require_permission_at('invoicing.issue', i.site_id);
    END IF;
    PERFORM ensure_reason('Draft invoice released');
    PERFORM set_invoice_internal(true);
    UPDATE invoice_line SET status = 'Removed' WHERE invoice_id = i.id AND status = 'Active';
    UPDATE invoice SET status = 'Discarded', discarded_at = clock_timestamp() WHERE id = i.id;
    PERFORM set_invoice_internal(false);
END $$;

-- Late rush: bill another tier (only the one ordered, one whose turnaround was met, or standard), with a note
CREATE FUNCTION set_invoice_line_rush(p_line uuid, p_tier uuid, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l invoice_line; opt record; i invoice;
BEGIN
    SELECT * INTO l FROM invoice_line WHERE id = p_line;
    IF l.id IS NULL OR l.status <> 'Active' OR l.kind <> 'Charge' THEN RAISE EXCEPTION 'Invoice line not found'; END IF;
    i := invoice_own_draft(l.invoice_id);
    SELECT * INTO opt FROM invoice_rush_options(l.requested_test_id, l.completed_on) x WHERE x.tier_id IS NOT DISTINCT FROM p_tier;
    IF NOT FOUND THEN RAISE EXCEPTION 'That rush tier is not one of this test''s options on the client''s quote'; END IF;
    IF NOT opt.is_ordered AND NOT opt.met THEN
        RAISE EXCEPTION '% was not met either (due %): bill a tier whose turnaround was met, or standard', opt.tier_name, to_char(opt.due_date, 'Mon DD, YYYY');
    END IF;
    IF NOT opt.is_ordered AND p_tier IS NOT NULL AND opt.fee > l.rush_ordered_fee THEN
        RAISE EXCEPTION 'A tier dearer than the one ordered is not billed';
    END IF;
    IF NOT opt.is_ordered AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why the rush is billed differently (for example: reported % days late)', l.late_days; END IF;
    PERFORM ensure_reason('Rush billed at the tier met');
    PERFORM set_invoice_internal(true);
    UPDATE invoice_line SET rush_tier_id = opt.tier_id, rush_billed = CASE WHEN opt.tier_id IS NULL THEN NULL ELSE opt.tier_name END,
           rush_fee = opt.fee, rush_note = CASE WHEN opt.is_ordered THEN NULL ELSE btrim(p_note) END, amount = price + opt.fee
     WHERE id = l.id;
    PERFORM invoice_totals(l.invoice_id);
    PERFORM set_invoice_internal(false);
END $$;

-- Correct the price billed (the discount checked against the quote), with a reason kept on the line
CREATE FUNCTION set_invoice_line_price(p_line uuid, p_price numeric, p_note text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE l invoice_line; i invoice; v_fee numeric;
BEGIN
    SELECT * INTO l FROM invoice_line WHERE id = p_line;
    IF l.id IS NULL OR l.status <> 'Active' OR l.kind <> 'Charge' THEN RAISE EXCEPTION 'Invoice line not found'; END IF;
    i := invoice_own_draft(l.invoice_id);
    IF p_price IS NULL OR p_price < 0 THEN RAISE EXCEPTION 'The price cannot be negative'; END IF;
    IF p_price > l.list_price AND l.list_price > 0 THEN RAISE EXCEPTION 'The price cannot be above the list price (%)', l.list_price; END IF;
    IF p_price <> l.quoted_price AND NULLIF(btrim(p_note), '') IS NULL THEN RAISE EXCEPTION 'Say why the price differs from the order (%)', l.quoted_price; END IF;
    -- a percentage rush fee follows the price billed
    SELECT round(CASE WHEN qr.surcharge_type = 'Flat' THEN qr.surcharge_value ELSE p_price * qr.surcharge_value / 100 END * (1 - qr.discount_pct / 100), 2) INTO v_fee
      FROM requested_test r JOIN quoted_test_configuration q ON q.id = r.quoted_line_id JOIN quote_rush_term qr ON qr.project_version_id = q.project_version_id
     WHERE r.id = l.requested_test_id AND qr.tier_id = l.rush_tier_id;
    PERFORM ensure_reason('Invoice price corrected');
    PERFORM set_invoice_internal(true);
    UPDATE invoice_line SET price = round(p_price, 2), price_note = CASE WHEN round(p_price, 2) = l.quoted_price THEN NULL ELSE btrim(p_note) END,
           rush_fee = COALESCE(v_fee, CASE WHEN l.rush_tier_id IS NULL THEN 0 ELSE l.rush_fee END),
           amount = round(p_price, 2) + COALESCE(v_fee, CASE WHEN l.rush_tier_id IS NULL THEN 0 ELSE l.rush_fee END)
     WHERE id = l.id;
    PERFORM invoice_totals(l.invoice_id);
    PERFORM set_invoice_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 5. ISSUING, THE PDF, SENDING, CREDIT NOTES
-------------------------------------------------------------------------------
CREATE FUNCTION invoice_stamp_issue(p_invoice uuid, p_date date, p_catchup boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i invoice; c client; terms integer;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    SELECT * INTO c FROM client WHERE id = i.client_id;
    terms := CASE WHEN i.kind = 'Credit note' THEN 0 ELSE c.payment_terms_days END;
    PERFORM invoice_totals(i.id);
    UPDATE invoice SET status = 'Issued', invoice_number = next_invoice_number(i.site_id, i.kind), invoice_date = p_date, due_date = p_date + terms,
           payment_terms_days = terms, bill_to_name = c.legal_name, bill_to_address = c.billing_address, claimed_by = NULL, catchup = p_catchup,
           issued_at = clock_timestamp(), issued_by = current_app_user(), signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid,
           issue_txid = txid_current()
     WHERE id = i.id;
END $$;

-- Issue checked drafts (signed "Invoiced by"); dated today in the lab. The server then attaches the PDF and sends it.
CREATE FUNCTION issue_invoices(p_ids uuid[]) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v uuid; i invoice; n integer := 0;
BEGIN
    IF COALESCE(cardinality(p_ids), 0) = 0 THEN RAISE EXCEPTION 'Choose the draft invoices to issue'; END IF;
    PERFORM assert_signed('issue invoices');
    FOREACH v IN ARRAY p_ids LOOP
        i := invoice_own_draft(v);
        IF NOT EXISTS (SELECT 1 FROM invoice_line WHERE invoice_id = i.id AND status = 'Active') THEN RAISE EXCEPTION '% has no lines', i.draft_code; END IF;
        -- the work on it must still be complete and not billed elsewhere
        IF EXISTS (SELECT 1 FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active' AND test_invoice_line(l.requested_test_id) <> l.id) THEN
            RAISE EXCEPTION '% holds work billed on another invoice', i.draft_code;
        END IF;
    END LOOP;
    PERFORM ensure_reason('Invoice issued');
    PERFORM set_invoice_internal(true);
    FOREACH v IN ARRAY p_ids LOOP
        PERFORM invoice_stamp_issue(v, site_today((SELECT site_id FROM invoice WHERE id = v)), false);
        n := n + 1;
    END LOOP;
    PERFORM set_invoice_internal(false);
    RETURN n;
END $$;

-- Credit an issued invoice (all its lines, or some), signed "Credited by", with the reason printed on the credit
-- note. Rebill: the work goes back to Ready to invoice (to be invoiced correctly); otherwise the charge is taken back.
CREATE FUNCTION credit_invoice(p_invoice uuid, p_lines uuid[], p_rebill boolean, p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i invoice; cn uuid; l invoice_line; n integer := 0;
BEGIN
    PERFORM assert_signed('issue a credit note');
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.status <> 'Issued' OR i.kind <> 'Invoice' THEN RAISE EXCEPTION 'Only an issued invoice is credited'; END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    IF NULLIF(btrim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Say why the invoice is credited (printed on the credit note)'; END IF;
    PERFORM ensure_reason('Credit note issued');
    PERFORM set_invoice_internal(true);
    INSERT INTO invoice (kind, site_id, client_id, lab_order_id, credit_of_id, po_number, reason)
    VALUES ('Credit note', i.site_id, i.client_id, i.lab_order_id, i.id, i.po_number, btrim(p_reason)) RETURNING id INTO cn;
    FOR l IN SELECT * FROM invoice_line x WHERE x.invoice_id = i.id AND x.status = 'Active' AND x.kind = 'Charge'
               AND (p_lines IS NULL OR x.id = ANY (p_lines)) ORDER BY x.line_no LOOP
        IF EXISTS (SELECT 1 FROM invoice_line c JOIN invoice ci ON ci.id = c.invoice_id WHERE c.credits_line_id = l.id AND ci.status = 'Issued') THEN
            IF p_lines IS NULL THEN CONTINUE; END IF;   -- "the rest": lines credited earlier are left out
            RAISE EXCEPTION 'Line % (% %) is credited already', l.line_no, l.sample_code, l.test_name;
        END IF;
        n := n + 1;
        INSERT INTO invoice_line (invoice_id, line_no, kind, requested_test_id, credits_line_id, rebill, sample_code, client_sample_id, test_code, test_name,
                                  completed_on, due_date, late_days, list_price, quoted_price, price, price_note, rush_ordered, rush_ordered_fee, rush_tier_id,
                                  rush_billed, rush_fee, rush_note, retest_of_id, line_note, amount)
        VALUES (cn, n, 'Credit', l.requested_test_id, l.id, COALESCE(p_rebill, false), l.sample_code, l.client_sample_id, l.test_code, l.test_name,
                l.completed_on, l.due_date, l.late_days, l.list_price, l.quoted_price, l.price, l.price_note, l.rush_ordered, l.rush_ordered_fee, l.rush_tier_id,
                l.rush_billed, l.rush_fee, l.rush_note, l.retest_of_id, l.line_note, -l.amount);
    END LOOP;
    IF n = 0 THEN RAISE EXCEPTION 'Choose the lines of % to credit', i.invoice_number; END IF;
    PERFORM invoice_stamp_issue(cn, site_today(i.site_id), false);
    PERFORM set_invoice_internal(false);
    RETURN cn;
END $$;

-- The PDF, attached once, in the transaction that issued the invoice, by the person who issued it
CREATE FUNCTION record_invoice_document(p_invoice uuid, p_doc uuid, p_sha text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i invoice; d document_file;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL OR i.status <> 'Issued' THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.document_id IS NOT NULL THEN RAISE EXCEPTION '% already has its PDF', i.invoice_number; END IF;
    IF i.issue_txid IS DISTINCT FROM txid_current() OR i.issued_by <> current_app_user() THEN
        RAISE EXCEPTION 'The PDF of % is attached when it is issued', i.invoice_number;
    END IF;
    SELECT * INTO d FROM document_file WHERE id = p_doc;
    IF d.id IS NULL OR d.sha256 <> p_sha OR d.mime_type <> 'application/pdf' THEN RAISE EXCEPTION 'The invoice PDF was not stored'; END IF;
    PERFORM set_invoice_internal(true);
    UPDATE invoice SET document_id = p_doc, sha256 = p_sha WHERE id = i.id;
    PERFORM set_invoice_internal(false);
END $$;

-------------------------------------------------------------------------------
-- 6. QUICKBOOKS ONLINE: ONE COMPANY PER LAB, AND THE PUSH QUEUE
-------------------------------------------------------------------------------
CREATE TABLE accounting_connection (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL UNIQUE REFERENCES lab_site(id),
    provider            text NOT NULL DEFAULT 'QuickBooks Online' CHECK (provider IN ('QuickBooks Online','QuickBooks Desktop','SAP')),
    company_name        text,
    company_id          text,                              -- QuickBooks Online: the company's realm ID
    environment         text NOT NULL DEFAULT 'Sandbox' CHECK (environment IN ('Sandbox','Production')),
    status              text NOT NULL DEFAULT 'Not connected' CHECK (status IN ('Not connected','Connected','Paused')),
    item_name           text NOT NULL DEFAULT 'Laboratory testing',   -- the product/service the lines are booked to
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('accounting_connection');
CREATE FUNCTION accounting_connection_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF in_group_sync() OR current_user_is_admin() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'Only a system administrator connects a lab to its accounting company';
END $$;
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON accounting_connection FOR EACH ROW EXECUTE FUNCTION accounting_connection_rules();
INSERT INTO accounting_connection (site_id) SELECT id FROM lab_site ON CONFLICT DO NOTHING;
-- a new lab gets its (not connected) QuickBooks Online company
CREATE FUNCTION lab_site_accounting_connection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text := COALESCE(current_setting('lims.group_sync', true), '');
BEGIN
    PERFORM set_config('lims.group_sync', '1', true);
    INSERT INTO accounting_connection (site_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    PERFORM set_config('lims.group_sync', prev, true);
    RETURN NULL;
END $$;
CREATE TRIGGER z_accounting_connection AFTER INSERT ON lab_site FOR EACH ROW EXECUTE FUNCTION lab_site_accounting_connection();

-- A client's customer record in a lab's accounting company (filled in when the connection is built)
CREATE TABLE accounting_customer (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    client_id           uuid NOT NULL REFERENCES client(id),
    external_id         text NOT NULL,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    UNIQUE (site_id, client_id)
);
CALL make_gxp('accounting_customer');
CREATE TRIGGER a01_permission BEFORE INSERT OR UPDATE ON accounting_customer FOR EACH ROW EXECUTE FUNCTION accounting_connection_rules();

CREATE TABLE accounting_push (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id          uuid NOT NULL UNIQUE REFERENCES invoice(id),
    site_id             uuid NOT NULL REFERENCES lab_site(id),
    provider            text NOT NULL,
    entity              text NOT NULL CHECK (entity IN ('Invoice','CreditMemo')),
    payload             jsonb NOT NULL,                    -- what is sent, as QuickBooks Online's API takes it
    status              text NOT NULL DEFAULT 'Waiting for connection' CHECK (status IN ('Waiting for connection','Queued','Sent','Failed')),
    attempts            integer NOT NULL DEFAULT 0,
    last_error          text,
    external_id         text,
    sent_at             timestamptz,
    record_version      integer NOT NULL DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user(),
    modified_at         timestamptz NOT NULL DEFAULT now(),
    modified_by         uuid NOT NULL REFERENCES app_user(id) DEFAULT current_app_user()
);
CALL make_gxp('accounting_push', false);
CREATE FUNCTION accounting_push_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.payload IS DISTINCT FROM OLD.payload THEN RAISE EXCEPTION 'What was queued for accounting is never changed'; END IF;
    IF invoice_internal() OR current_user_is_admin() THEN RETURN NEW; END IF;
    RAISE EXCEPTION 'The accounting queue is written by Billing';
END $$;
CREATE TRIGGER a01_rules BEFORE INSERT OR UPDATE ON accounting_push FOR EACH ROW EXECUTE FUNCTION accounting_push_rules();

-- The invoice (or credit memo) as QuickBooks Online's API takes it. CustomerRef needs the customer's ID in that lab's
-- company: it is filled from accounting_customer when known; otherwise the connector finds or makes the customer by name.
CREATE FUNCTION qbo_payload(p_invoice uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT jsonb_strip_nulls(jsonb_build_object(
        'DocNumber', i.invoice_number,
        'TxnDate', to_char(i.invoice_date, 'YYYY-MM-DD'),
        'DueDate', CASE WHEN i.kind = 'Invoice' THEN to_char(i.due_date, 'YYYY-MM-DD') END,
        'CustomerRef', jsonb_build_object('value', ac.external_id, 'name', i.bill_to_name),
        'SalesTermRef', CASE WHEN i.kind = 'Invoice' THEN jsonb_build_object('name', 'Net ' || i.payment_terms_days) END,
        'BillAddr', CASE WHEN i.bill_to_address IS NOT NULL THEN jsonb_build_object('Line1', i.bill_to_address) END,
        'BillEmail', (SELECT jsonb_build_object('Address', string_agg(DISTINCT ct.email, ', ')) FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
                       WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)),
        'CustomerMemo', jsonb_build_object('value', concat_ws(' · ', 'Order ' || o.order_code, 'PO ' || i.po_number,
                            CASE WHEN i.kind = 'Credit note' THEN 'Credits ' || (SELECT x.invoice_number FROM invoice x WHERE x.id = i.credit_of_id) || ': ' || i.reason END)),
        'PrivateNote', 'LIMS3 ' || i.invoice_number,
        'Line', (SELECT jsonb_agg(jsonb_build_object(
                    'LineNum', l.line_no, 'DetailType', 'SalesItemLineDetail', 'Amount', abs(l.amount),
                    'Description', concat_ws(' · ', l.sample_code || COALESCE(' (' || l.client_sample_id || ')', ''), l.test_name,
                                             CASE WHEN l.rush_fee > 0 THEN 'rush ' || l.rush_billed END, l.line_note),
                    'SalesItemLineDetail', jsonb_build_object('ItemRef', jsonb_build_object('name', cn.item_name), 'Qty', 1, 'UnitPrice', abs(l.amount),
                                                              'ServiceDate', to_char(l.completed_on, 'YYYY-MM-DD'))) ORDER BY l.line_no)
                   FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active')))
      FROM invoice i JOIN lab_order o ON o.id = i.lab_order_id LEFT JOIN accounting_connection cn ON cn.site_id = i.site_id
      LEFT JOIN accounting_customer ac ON ac.site_id = i.site_id AND ac.client_id = i.client_id
     WHERE i.id = p_invoice
$$;

-------------------------------------------------------------------------------
-- 7. SENDING: THE EMAIL TO THE CLIENT'S BILLING CONTACTS, AND THE QUEUE TO QUICKBOOKS
-------------------------------------------------------------------------------
INSERT INTO email_template (template_code, template_name, subject, body, placeholders) VALUES
('Invoice Issued', 'Invoice sent to a client',
 'Invoice {{invoice_number}} from {{site_name}} ({{order_code}})',
 E'Dear {{first_name}},\n\nPlease find attached invoice {{invoice_number}} for testing on order {{order_code}}{{po_line}}.\n\nAmount due: {{total}}\nInvoice date: {{invoice_date}}\nDue by: {{due_date}} ({{terms}})\n\n{{note}}If you have any questions about this invoice, simply reply to this email.\n\nKind regards,\n{{staff_name}}\n{{site_name}}',
 '{{first_name}}, {{invoice_number}}, {{order_code}}, {{po_line}}, {{total}}, {{invoice_date}}, {{due_date}}, {{terms}}, {{note}}, {{staff_name}}, {{site_name}}'),
('Credit Note Issued', 'Credit note sent to a client',
 'Credit note {{invoice_number}} from {{site_name}} (credits {{credits}})',
 E'Dear {{first_name}},\n\nPlease find attached credit note {{invoice_number}}, which credits {{amount}} of invoice {{credits}} (order {{order_code}}).\n\nReason: {{reason}}\n\n{{rebill_line}}If you have any questions, simply reply to this email.\n\nKind regards,\n{{staff_name}}\n{{site_name}}',
 '{{first_name}}, {{invoice_number}}, {{credits}}, {{amount}}, {{order_code}}, {{reason}}, {{rebill_line}}, {{staff_name}}, {{site_name}}');

CREATE FUNCTION fmt_money(p numeric) RETURNS text LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN p < 0 THEN '-' ELSE '' END || '$' || to_char(abs(COALESCE(p, 0)), 'FM999,999,990.00')
$$;

-- After the PDF is attached: email it to the client's billing contacts (else the ordering contact) and queue it for
-- the lab's accounting company. Not for catch-up invoices (that work was invoiced before LIMS3).
CREATE FUNCTION send_invoice(p_invoice uuid) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE i invoice; o lab_order; si lab_site; ct record; n integer := 0; u app_user; cr invoice; v uuid; cn accounting_connection;
BEGIN
    SELECT * INTO i FROM invoice WHERE id = p_invoice;
    IF i.id IS NULL OR i.status <> 'Issued' THEN RAISE EXCEPTION 'Invoice not found'; END IF;
    IF i.catchup THEN RAISE EXCEPTION '% is a catch-up invoice: it is not sent', i.invoice_number; END IF;
    IF i.sent_at IS NOT NULL THEN RAISE EXCEPTION '% was sent already', i.invoice_number; END IF;
    IF i.document_id IS NULL THEN RAISE EXCEPTION '% has no PDF yet', i.invoice_number; END IF;
    PERFORM require_permission_at('invoicing.issue', i.site_id);
    SELECT * INTO o FROM lab_order WHERE id = i.lab_order_id;
    SELECT * INTO si FROM lab_site WHERE id = i.site_id;
    SELECT * INTO u FROM app_user WHERE id = current_app_user();
    SELECT * INTO cr FROM invoice WHERE id = i.credit_of_id;
    FOR ct IN SELECT DISTINCT c2.email, c2.first_name, c2.last_name FROM client_contact cc JOIN contact c2 ON c2.id = cc.contact_id
               WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND c2.status = 'Active' AND 'BILLING' = ANY (cc.roles)
              UNION SELECT c3.email, c3.first_name, c3.last_name FROM contact c3 WHERE c3.id = o.ordering_contact_id
                AND NOT EXISTS (SELECT 1 FROM client_contact cc WHERE cc.client_id = i.client_id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)) LOOP
        IF i.kind = 'Invoice' THEN
            v := queue_email('Invoice Issued', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
                'first_name', ct.first_name, 'invoice_number', i.invoice_number, 'order_code', o.order_code,
                'po_line', COALESCE(' (your PO ' || i.po_number || ')', ''), 'total', fmt_money(i.total),
                'invoice_date', to_char(i.invoice_date, 'Mon DD, YYYY'), 'due_date', to_char(i.due_date, 'Mon DD, YYYY'),
                'terms', CASE WHEN i.payment_terms_days = 0 THEN 'due on receipt' ELSE 'net ' || i.payment_terms_days || ' days' END,
                'note', COALESCE(i.note || E'\n\n', ''), 'staff_name', u.full_name, 'site_name', si.site_name), o.id, NULL, i.document_id);
        ELSE
            v := queue_email('Credit Note Issued', ct.email, ct.first_name || ' ' || ct.last_name, jsonb_build_object(
                'first_name', ct.first_name, 'invoice_number', i.invoice_number, 'credits', cr.invoice_number, 'amount', fmt_money(abs(i.total)),
                'order_code', o.order_code, 'reason', i.reason,
                'rebill_line', CASE WHEN EXISTS (SELECT 1 FROM invoice_line l WHERE l.invoice_id = i.id AND l.rebill) THEN E'A corrected invoice will follow.\n\n' ELSE '' END,
                'staff_name', u.full_name, 'site_name', si.site_name), o.id, NULL, i.document_id);
        END IF;
        n := n + 1;
    END LOOP;
    SELECT * INTO cn FROM accounting_connection WHERE site_id = i.site_id;
    PERFORM set_invoice_internal(true);
    INSERT INTO accounting_push (invoice_id, site_id, provider, entity, payload, status)
    VALUES (i.id, i.site_id, COALESCE(cn.provider, 'QuickBooks Online'), CASE WHEN i.kind = 'Invoice' THEN 'Invoice' ELSE 'CreditMemo' END, qbo_payload(i.id),
            CASE WHEN cn.status = 'Connected' THEN 'Queued' ELSE 'Waiting for connection' END);
    UPDATE invoice SET sent_at = clock_timestamp() WHERE id = i.id;
    PERFORM set_invoice_internal(false);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 8. CATCH-UP: WORK COMPLETED BEFORE INVOICING WENT LIVE
-------------------------------------------------------------------------------
-- One issued invoice per lab order per week, dated the Friday of the week the work was completed (its COA issued),
-- for work completed before the current week (this week's work waits in Ready to invoice). Rush billed as ordered.
-- Not emailed, not pushed. System administrators, or a data load.
CREATE FUNCTION invoice_catch_up(p_site uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE g record; inv uuid; v_rt uuid; n integer := 0;
BEGIN
    IF NOT current_user_is_admin() AND NOT in_group_sync() THEN RAISE EXCEPTION 'Only a system administrator runs the invoicing catch-up'; END IF;
    PERFORM ensure_reason('Catch-up invoice for work completed before invoicing in LIMS3');
    PERFORM set_invoice_internal(true);
    FOR g IN SELECT r.site_id, r.lab_order_id, r.client_id, r.po_number, (date_trunc('week', r.completed_on)::date + 4) AS friday,
                    array_agg(r.requested_test_id ORDER BY r.sample_code, r.test_name) AS tests
               FROM invoice_ready_view r
              WHERE (p_site IS NULL OR r.site_id = p_site) AND r.completed_on < date_trunc('week', site_today(r.site_id))::date
              GROUP BY 1, 2, 3, 4, 5 ORDER BY 5, (SELECT order_code FROM lab_order WHERE id = r.lab_order_id) LOOP
        INSERT INTO invoice (site_id, client_id, lab_order_id, po_number, internal_note)
        VALUES (g.site_id, g.client_id, g.lab_order_id, g.po_number, 'Catch-up: work completed before invoicing in LIMS3') RETURNING id INTO inv;
        FOREACH v_rt IN ARRAY g.tests LOOP PERFORM invoice_add_line(inv, v_rt); END LOOP;
        PERFORM invoice_stamp_issue(inv, g.friday, true);
        n := n + 1;
    END LOOP;
    PERFORM set_invoice_internal(false);
    RETURN n;
END $$;

-------------------------------------------------------------------------------
-- 9. LISTS AND THE ORDER'S BILLING
-------------------------------------------------------------------------------
CREATE VIEW invoice_view AS
SELECT i.*, COALESCE(i.invoice_number, i.draft_code) AS code, s.site_code, o.order_code, COALESCE(c.display_name, c.legal_name) AS client_name,
       cu.full_name AS claimed_by_name, iu.full_name AS issued_by_name, cr.invoice_number AS credits_number,
       (SELECT count(*) FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active') AS line_count,
       (SELECT count(DISTINCT l.sample_code) FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active') AS sample_count,
       (SELECT count(*) FROM invoice_line l WHERE l.invoice_id = i.id AND l.status = 'Active' AND l.late_days > 0 AND l.rush_ordered IS NOT NULL) AS late_rush_count,
       (SELECT COALESCE(sum(-c2.total), 0) FROM invoice c2 WHERE c2.credit_of_id = i.id AND c2.status = 'Issued') AS credited,
       ap.status AS push_status
  FROM invoice i JOIN lab_site s ON s.id = i.site_id JOIN lab_order o ON o.id = i.lab_order_id JOIN client c ON c.id = i.client_id
  LEFT JOIN app_user cu ON cu.id = i.claimed_by LEFT JOIN app_user iu ON iu.id = i.issued_by LEFT JOIN invoice cr ON cr.id = i.credit_of_id
  LEFT JOIN accounting_push ap ON ap.invoice_id = i.id;

-- Each test on an order and where its billing stands (the order page; the client portal will show the same)
CREATE FUNCTION order_billing(p_order uuid)
RETURNS TABLE (requested_test_id uuid, sample_code text, client_sample_id text, test_name text, is_retest boolean, state text, detail text,
               charge numeric, invoice_id uuid, invoice_code text, invoice_date date)
LANGUAGE sql STABLE AS $$
    SELECT b.requested_test_id, b.sample_code, b.client_sample_id, b.test_name, b.retest_of_id IS NOT NULL,
           CASE WHEN b.is_internal OR b.media_lot_id IS NOT NULL THEN 'Not billed'
                WHEN b.test_status = 'Cancelled' THEN 'Cancelled'
                WHEN li.status = 'Issued' THEN 'Invoiced'
                WHEN li.status = 'Draft' THEN 'On a draft'
                WHEN test_billing_closed(b.requested_test_id) THEN 'Credited'
                WHEN b.billing_status = 'Pending QA determination' THEN 'Waiting for QA'
                WHEN b.completed_at IS NOT NULL THEN 'Ready to invoice'
                ELSE 'In the lab' END,
           CASE WHEN b.billing_status = 'Pending QA determination' THEN 'Retest billing waits for QA''s determination'
                WHEN b.billing_status = 'Non-billable' THEN 'Not charged (lab investigation retest)'
                WHEN li.status = 'Draft' THEN 'Being checked by ' || li.claimed_by_name END,
           COALESCE(li.amount, CASE WHEN b.test_status = 'Cancelled' OR b.is_internal THEN 0 ELSE b.price + b.rush_fee END),
           li.invoice_id, li.code, li.invoice_date
      FROM billable_test_view b
      LEFT JOIN LATERAL (SELECT l.amount, l.invoice_id, iv.code, iv.status, iv.invoice_date, iv.claimed_by_name FROM invoice_line l JOIN invoice_view iv ON iv.id = l.invoice_id
                          WHERE l.id = test_invoice_line(b.requested_test_id)) li ON true
     WHERE b.lab_order_id = p_order
     ORDER BY b.sample_code, b.test_name
$$;

-------------------------------------------------------------------------------
-- 10. AUDIT REFERENCES
-------------------------------------------------------------------------------
ALTER FUNCTION audit_record_ref(text, uuid, jsonb) RENAME TO audit_record_ref_036;
CREATE FUNCTION audit_record_ref(p_table text, p_id uuid, r jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_table = 'invoice' THEN
        RETURN jsonb_build_object('label', COALESCE(r->>'kind', 'Invoice') || ' ' || COALESCE(r->>'invoice_number', r->>'draft_code'), 'link', '#/billing/invoices/' || p_id);
    ELSIF p_table = 'invoice_line' THEN
        RETURN jsonb_build_object('label', 'Invoice line ' || COALESCE(r->>'sample_code', '') || ' ' || COALESCE(r->>'test_name', ''), 'link', '#/billing/invoices/' || (r->>'invoice_id'));
    ELSIF p_table IN ('accounting_push', 'accounting_connection', 'accounting_customer') THEN
        RETURN jsonb_build_object('label', CASE p_table WHEN 'accounting_push' THEN 'Accounting queue entry' WHEN 'accounting_connection' THEN 'Accounting connection' ELSE 'Accounting customer' END,
            'link', CASE WHEN p_table = 'accounting_push' THEN '#/billing/invoices/' || (r->>'invoice_id') ELSE '#/billing?tab=settings' END);
    END IF;
    RETURN audit_record_ref_036(p_table, p_id, r);
END $$;

SELECT set_config('lims.group_sync', '', true);
COMMIT;
