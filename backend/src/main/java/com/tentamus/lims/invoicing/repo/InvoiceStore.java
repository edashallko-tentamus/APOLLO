package com.tentamus.lims.invoicing.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.invoicing.domain.Invoice;
import com.tentamus.lims.invoicing.domain.InvoiceLine;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Loads and saves draft invoices and their lines. The database's invoice_rules guard stays (Node issues, credits and
 * corrects invoices through it), so every write here is marked as Billing's own (lims.invoice_internal).
 */
@Repository
public class InvoiceStore {

    public void requirePermission(Db d, String code, String site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public boolean has(Db d, String code, String site) {
        return Boolean.TRUE.equals(d.one("SELECT has_permission_at(?, ?::uuid) AS ok", code, site).get("ok"));
    }

    private static void internal(Db d, boolean on) { d.one("SELECT set_invoice_internal(?::boolean)", on); }

    private static String s(Map<String, Object> r, String k) { return (String) r.get(k); }

    private static BigDecimal n(Map<String, Object> r, String k) {
        Object v = r.get(k);
        return v == null ? null : v instanceof BigDecimal b ? b : new BigDecimal(v.toString());
    }

    private static LocalDate date(Object v) { return v == null ? null : LocalDate.parse(v.toString().substring(0, 10)); }

    public Invoice load(Db d, Object id) {
        Map<String, Object> r = d.one("""
            SELECT i.id, i.draft_code, i.invoice_number, i.site_id, i.lab_order_id, i.kind, i.status, i.claimed_by, u.full_name, i.invoice_date
              FROM invoice i LEFT JOIN app_user u ON u.id = i.claimed_by WHERE i.id = ?::uuid FOR UPDATE OF i""", id);
        if (r == null) throw RuleException.database("Invoice not found");
        return new Invoice(s(r, "id"), s(r, "draft_code"), s(r, "invoice_number"), s(r, "site_id"), s(r, "lab_order_id"), s(r, "kind"), s(r, "status"),
            s(r, "claimed_by"), s(r, "full_name"), date(r.get("invoice_date")));
    }

    /** The draft about to change: a draft, the permission, its holder. */
    public Invoice ownDraft(Db d, Object id, String me) {
        Invoice i = load(d, id);
        i.checkDraft();
        requirePermission(d, "invoicing.issue", i.siteId());
        i.checkHolder(me);
        return i;
    }

    private static final String LINE_COLS = """
        SELECT id, invoice_id, kind, status, requested_test_id, list_price, quoted_price, price, rush_tier_id, rush_fee, rush_ordered_fee, late_days, amount, completed_on
          FROM invoice_line""";

    private static InvoiceLine line(Map<String, Object> r) {
        return new InvoiceLine(s(r, "id"), s(r, "invoice_id"), s(r, "kind"), s(r, "status"), s(r, "requested_test_id"), n(r, "list_price"), n(r, "quoted_price"),
            n(r, "price"), s(r, "rush_tier_id"), n(r, "rush_fee"), n(r, "rush_ordered_fee"), r.get("late_days") == null ? null : ((Number) r.get("late_days")).intValue(),
            n(r, "amount"));
    }

    public Map<String, Object> lineRow(Db d, Object id) { return d.one(LINE_COLS + " WHERE id = ?::uuid", id); }

    public InvoiceLine line(Db d, Object id) {
        Map<String, Object> r = lineRow(d, id);
        return r == null ? null : line(r);
    }

    public List<InvoiceLine> lines(Db d, String invoice) { return d.rows(LINE_COLS + " WHERE invoice_id = ?::uuid", invoice).stream().map(InvoiceStore::line).toList(); }

    /** The totals worked out by {@link Invoice#totals} from the active lines. */
    public void saveTotals(Db d, String invoice) {
        Invoice.Totals t = Invoice.totals(lines(d, invoice));
        internal(d, true);
        d.update("UPDATE invoice SET list_total = ?::numeric, discount_total = ?::numeric, rush_total = ?::numeric, total = ?::numeric WHERE id = ?::uuid",
            t.list(), t.discount(), t.rush(), t.total(), invoice);
        internal(d, false);
    }

    // ---------------------------------------------------------------- claiming
    /** The tests' ready-to-invoice rows (lab order, lab), or why one is not ready. */
    public List<Map<String, Object>> readyTests(Db d, List<Object> tests) {
        d.rows("SELECT id FROM requested_test WHERE id = ANY (?::uuid[]) ORDER BY id FOR UPDATE", tests);   // one claim at a time per test
        for (Object t : tests) {
            if (d.one("SELECT 1 FROM invoice_ready_view WHERE requested_test_id = ?::uuid", t) != null) continue;
            Map<String, Object> x = d.one("""
                SELECT tt.test_name, s.sample_code, i.draft_code, u.full_name FROM requested_test r JOIN test tt ON tt.id = r.test_id JOIN sample s ON s.id = r.sample_id
                  LEFT JOIN invoice_line l ON l.id = test_invoice_line(r.id) LEFT JOIN invoice i ON i.id = l.invoice_id LEFT JOIN app_user u ON u.id = i.claimed_by
                 WHERE r.id = ?::uuid""", t);
            throw Invoice.notReady(x == null ? null : s(x, "test_name"), x == null ? null : s(x, "sample_code"), x == null ? null : s(x, "draft_code"),
                x == null ? null : s(x, "full_name"));
        }
        return d.rows("SELECT requested_test_id, lab_order_id, site_id FROM invoice_ready_view WHERE requested_test_id = ANY (?::uuid[]) ORDER BY sample_code, test_name", tests);
    }

    public List<Map<String, Object>> readyCharges(Db d, List<Object> charges) {
        d.rows("SELECT id FROM order_charge WHERE id = ANY (?::uuid[]) ORDER BY id FOR UPDATE", charges);
        for (Object c : charges)
            if (d.one("SELECT 1 FROM charge_ready_view WHERE order_charge_id = ?::uuid", c) == null) {
                Map<String, Object> x = d.one("SELECT charge_no FROM order_charge WHERE id = ?::uuid", c);
                throw Invoice.chargeNotReady(x == null ? null : s(x, "charge_no"));
            }
        return d.rows("SELECT order_charge_id, lab_order_id, site_id FROM charge_ready_view WHERE order_charge_id = ANY (?::uuid[]) ORDER BY sample_code NULLS FIRST, charge_name",
            charges);
    }

    /** The claimer's own draft for the order, made when there is none. */
    public String draftFor(Db d, Object order, String note) {
        Map<String, Object> r = d.one("""
            SELECT id FROM invoice WHERE lab_order_id = ?::uuid AND status = 'Draft' AND kind = 'Invoice' AND claimed_by = current_app_user() ORDER BY created_at LIMIT 1""", order);
        if (r != null) return s(r, "id");
        internal(d, true);
        String id = s(d.one("""
            INSERT INTO invoice (site_id, client_id, lab_order_id, claimed_by, po_number, internal_note)
            SELECT site_id, client_id, id, current_app_user(), po_number, ? FROM lab_order WHERE id = ?::uuid RETURNING id""", Invoice.text(note), order), "id");
        internal(d, false);
        return id;
    }

    private static final String NEXT_LINE = "(SELECT COALESCE(max(line_no), 0) + 1 FROM invoice_line WHERE invoice_id = ?::uuid)";

    /** A test's line: a snapshot of its ready-to-invoice row (prices as ordered, the rush as ordered). */
    public void addTestLine(Db d, String invoice, Object test) {
        internal(d, true);
        d.update("""
            INSERT INTO invoice_line (invoice_id, line_no, requested_test_id, sample_code, client_sample_id, test_code, test_name, completed_on, due_date, late_days,
                list_price, quoted_price, price, rush_ordered, rush_ordered_fee, rush_tier_id, rush_billed, rush_fee, retest_of_id, line_note, amount)
            SELECT ?::uuid, %s, b.requested_test_id, b.sample_code, b.client_sample_id, b.test_code, b.test_name, b.completed_on, b.due_date, b.late_days,
                b.list_price, b.price, b.price, CASE WHEN b.rush_fee > 0 THEN COALESCE(b.rush_tier_name, 'Rush') END, b.rush_fee,
                CASE WHEN b.rush_fee > 0 THEN b.rush_tier_id END, CASE WHEN b.rush_fee > 0 THEN COALESCE(b.rush_tier_name, 'Rush') END, b.rush_fee,
                b.retest_of_id, NULLIF(invoice_line_text(b.requested_test_id), ''), b.price + b.rush_fee
              FROM invoice_ready_view b WHERE b.requested_test_id = ?::uuid""".formatted(NEXT_LINE), invoice, invoice, test);
        internal(d, false);
    }

    /** A charge's line: a snapshot of its ready-to-invoice row. */
    public void addChargeLine(Db d, String invoice, Object charge) {
        if (d.one("SELECT 1 FROM charge_ready_view WHERE order_charge_id = ?::uuid", charge) == null)
            throw RuleException.database("That charge is not ready to invoice (cancelled, or on an invoice already)");
        internal(d, true);
        d.update("""
            INSERT INTO invoice_line (invoice_id, line_no, order_charge_id, sample_code, client_sample_id, test_code, test_name, completed_on,
                list_price, quoted_price, price, line_note, amount)
            SELECT ?::uuid, %s, b.order_charge_id, b.sample_code, b.client_sample_id, b.charge_code,
                b.charge_name || CASE WHEN b.quantity > 1 THEN ' × ' || b.quantity ELSE '' END, (b.created_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = b.site_id))::date,
                b.list_price * b.quantity, b.unit_price * b.quantity, b.unit_price * b.quantity, NULLIF(btrim(COALESCE(b.note, '')), ''), b.unit_price * b.quantity
              FROM charge_ready_view b WHERE b.order_charge_id = ?::uuid""".formatted(NEXT_LINE), invoice, invoice, charge);
        internal(d, false);
    }

    // ---------------------------------------------------------------- checking a draft
    public void update(Db d, String invoice, String po, String note, String internalNote) {
        internal(d, true);
        d.update("UPDATE invoice SET po_number = ?, note = ?, internal_note = ? WHERE id = ?::uuid", Invoice.text(po), Invoice.text(note), Invoice.text(internalNote), invoice);
        internal(d, false);
    }

    public void saveLine(Db d, String line, InvoiceLine.Change c, boolean priceChange) {
        internal(d, true);
        if (priceChange)
            d.update("UPDATE invoice_line SET price = ?::numeric, price_note = ?, rush_fee = ?::numeric, amount = ?::numeric WHERE id = ?::uuid",
                c.price(), c.priceNote(), c.rushFee(), c.amount(), line);
        else
            d.update("UPDATE invoice_line SET rush_tier_id = ?::uuid, rush_billed = ?, rush_fee = ?::numeric, rush_note = ?, amount = ?::numeric WHERE id = ?::uuid",
                c.rushTierId(), c.rushBilled(), c.rushFee(), c.rushNote(), c.amount(), line);
        internal(d, false);
    }

    /** The test's rush options on the client's quote (the read model invoice_rush_options). */
    public List<InvoiceLine.RushOption> rushOptions(Db d, String test, Object completedOn) {
        return d.rows("SELECT tier_id, tier_name, is_ordered, met, fee, due_date FROM invoice_rush_options(?::uuid, ?::date)", test, completedOn).stream()
            .map(r -> new InvoiceLine.RushOption(s(r, "tier_id"), s(r, "tier_name"), Boolean.TRUE.equals(r.get("is_ordered")), Boolean.TRUE.equals(r.get("met")),
                n(r, "fee"), date(r.get("due_date")))).toList();
    }

    /** The quote's rush term for the line's tier, or null. */
    public InvoiceLine.RushTerm rushTerm(Db d, String test, String tier) {
        if (tier == null) return null;
        Map<String, Object> r = d.one("""
            SELECT qr.surcharge_type::text AS surcharge_type, qr.surcharge_value, qr.discount_pct FROM requested_test r JOIN quoted_test_configuration q ON q.id = r.quoted_line_id
              JOIN quote_rush_term qr ON qr.project_version_id = q.project_version_id WHERE r.id = ?::uuid AND qr.tier_id = ?::uuid LIMIT 1""", test, tier);
        return r == null ? null : new InvoiceLine.RushTerm(s(r, "surcharge_type"), n(r, "surcharge_value"), n(r, "discount_pct"));
    }

    /** Takes lines off (or all of them); how many. */
    public int removeLines(Db d, String invoice, List<Object> lines) {
        internal(d, true);
        int k = d.update("UPDATE invoice_line SET status = 'Removed' WHERE invoice_id = ?::uuid AND (?::uuid[] IS NULL OR id = ANY (?::uuid[])) AND status = 'Active'",
            invoice, lines, lines);
        internal(d, false);
        return k;
    }

    public void discard(Db d, String invoice) {
        internal(d, true);
        d.update("UPDATE invoice SET status = 'Discarded', discarded_at = clock_timestamp() WHERE id = ?::uuid", invoice);
        internal(d, false);
    }

    /** The invoices the lines are on, in no particular order. */
    public List<String> invoicesOfLines(Db d, List<Object> lines) {
        return d.rows("SELECT DISTINCT invoice_id FROM invoice_line WHERE id = ANY (?::uuid[])", lines).stream().map(r -> s(r, "invoice_id")).toList();
    }

    // ---------------------------------------------------------------- payments and terms
    public LocalDate today(Db d, String site) { return date(d.one("SELECT site_today(?::uuid)::text AS t", site).get("t")); }

    public void recordPayment(Db d, String invoice, LocalDate paidOn, String note) {
        internal(d, true);
        d.one("SELECT set_config('lims.invoice_after_issue', 'payment', true)");
        d.update("UPDATE invoice SET paid_on = ?::date, paid_note = ?, paid_recorded_by = current_app_user(), paid_recorded_at = clock_timestamp() WHERE id = ?::uuid",
            paidOn == null ? null : paidOn.toString(), Invoice.text(note), invoice);
        d.one("SELECT set_config('lims.invoice_after_issue', '', true)");
        internal(d, false);
    }

    /** A client's payment terms: not a change to its master data (master.clients), so written as a system step. */
    public void setTerms(Db d, Object client, int days) {
        d.one("SELECT set_config('lims.group_sync', '1', true)");
        int n = d.update("UPDATE client SET payment_terms_days = ? WHERE id = ?::uuid", days, client);
        d.one("SELECT set_config('lims.group_sync', '', true)");
        if (n == 0) throw RuleException.database("Client not found");
    }

    public boolean systemAdmin(Db d) { return Boolean.TRUE.equals(d.one("SELECT current_user_is_admin() AS ok").get("ok")); }

    public boolean hasHere(Db d, String code) { return Boolean.TRUE.equals(d.one("SELECT has_permission(?) AS ok", code).get("ok")); }
}
