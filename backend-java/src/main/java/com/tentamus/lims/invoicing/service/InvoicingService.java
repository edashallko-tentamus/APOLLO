package com.tentamus.lims.invoicing.service;

import com.tentamus.lims.charges.domain.OrderCharge;
import com.tentamus.lims.charges.repo.OrderChargeStore;
import com.tentamus.lims.invoicing.domain.Invoice;
import com.tentamus.lims.invoicing.domain.InvoiceLine;
import com.tentamus.lims.invoicing.domain.PaymentTerms;
import com.tentamus.lims.invoicing.repo.InvoiceStore;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Billing: work ready to invoice, claimed into the reviewer's own draft per lab order; the draft checked (price, late
 * rush, PO, note, charges) or released; payments recorded by hand; an order's billing; settings (payment terms, the
 * accounting connection). The rules are the domain's ({@link Invoice}, {@link InvoiceLine}, {@link PaymentTerms}). Issuing, credit notes, PO corrections and a draft's PDF
 * make PDFs and stay in the Node backend for now; stored PDFs of corrections are served here.
 */
@Service
public class InvoicingService {
    private static final Pattern LEADING_INT = Pattern.compile("^\\s*([+-]?\\d+)");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final InvoiceStore store;
    private final OrderChargeStore orderCharges;

    public InvoicingService(Db db, UnitOfWork uow, AccessPolicy access, InvoiceStore store, OrderChargeStore orderCharges) {
        this.store = store;
        this.orderCharges = orderCharges;
        this.db = db;
        this.uow = uow;
        this.access = access;
    }

    private static boolean truthy(Object v) { return v != null && !"".equals(v) && !Boolean.FALSE.equals(v); }

    private static Object orBlank(Object v) { return truthy(v) ? v : ""; }

    /** A text field as the database read it (null and false as blank). */
    private static String str(Object v) { return truthy(v) ? Js.string(v) : ""; }

    /** parseInt(v, 10) in JavaScript: the leading whole number, or null for NaN. */
    static Long parseInt(Object v) {
        if (v == null) return null;
        Matcher m = LEADING_INT.matcher(v instanceof Number n ? Js.number(n) : v.toString());
        if (!m.find()) return null;
        try { return Long.parseLong(m.group(1)); } catch (NumberFormatException e) { return null; }
    }

    private static List<Object> uuids(Object o) {
        List<Object> out = new ArrayList<>();
        if (o instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x);
        return out;
    }

    /** The request's Reason for Change, else the fallback (c.reason || '...'). */
    private static RequestContext reason(RequestContext ctx, String fallback) {
        return ctx.reason().isEmpty() ? ctx.withReason(fallback) : ctx;
    }

    private static Map<String, Object> ok() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        return m;
    }

    private void needView(RequestContext ctx, String site) {
        UserAccess a = access.load(ctx.userId());
        if (!a.can("invoicing.view", site) && !a.can("invoicing.issue", site))
            throw new RuleException("You do not have permission to see invoicing in this lab (invoicing.view). Ask your lab administrator.");
    }

    private Map<String, Object> withPerms(Map<String, Object> out, RequestContext ctx, String site) {
        UserAccess a = access.load(ctx.userId());
        out.put("can_issue", a.can("invoicing.issue", site));
        out.put("can_release_any", a.can("admin.users", site));
        return out;
    }

    private Map<String, Object> invoiceOf(RequestContext ctx, Object id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Invoice not found");
        Map<String, Object> i = db.one("SELECT * FROM invoice_view WHERE id = ?::uuid", id);
        if (i == null) throw new RuleException("Invoice not found");
        access.checkSite(ctx, (String) i.get("site_id"));
        needView(ctx, (String) i.get("site_id"));
        return new LinkedHashMap<>(i);
    }

    private Map<String, Object> lineInvoice(RequestContext ctx, String lineId) {
        if (!RequestContext.isUuid(lineId)) throw new RuleException("Invoice line not found");
        Map<String, Object> l = db.one("SELECT invoice_id FROM invoice_line WHERE id = ?::uuid", lineId);
        if (l == null) throw new RuleException("Invoice line not found");
        return invoiceOf(ctx, l.get("invoice_id"));
    }

    // ---------------------------------------------------------------- reading
    /** Ready to invoice (this lab): tests with their COA issued, and charges as soon as they are added. */
    public Map<String, Object> ready(RequestContext ctx) {
        String site = access.currentSite(ctx);
        needView(ctx, site);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("""
            SELECT requested_test_id, sample_id, sample_code, client_sample_id, lab_order_id, order_code, po_number, client_id, client_name,
                test_code, test_name, list_price, price, discount, rush_fee, rush_status, rush_tier_name, due_date, completed_on, late_days, amount, is_retest, retest_of,
                oos_code, was_retested, billing_status, (stability_pull_id IS NOT NULL) AS stability
              FROM invoice_ready_view WHERE site_id = ?::uuid ORDER BY completed_on, order_code, sample_code, test_name""", site));
        out.put("charges", db.rows("""
            SELECT order_charge_id, charge_no, lab_order_id, order_code, po_number, client_id, client_name, sample_id, sample_code,
                charge_code, charge_name, kind, quantity, list_price, unit_price, amount, note, source, project_code, created_at
              FROM charge_ready_view WHERE site_id = ?::uuid ORDER BY created_at, order_code""", site));
        withPerms(out, ctx, site);
        out.put("me", ctx.userId());
        return out;
    }

    /** Drafts and issued invoices (this lab): mine, everyone's drafts, issued (a page, or the last N days), the QuickBooks queue. */
    public Map<String, Object> invoices(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        needView(ctx, site);
        String tab = truthy(query.get("tab")) ? query.get("tab") : "issued";
        Long asked = parseInt(query.get("days"));
        long days = Math.min(Math.max(asked == null || asked == 0 ? 120 : asked, 1), 3660);
        Map<String, Object> out = new LinkedHashMap<>();
        if (tab.equals("mine")) out.put("rows", db.rows("SELECT * FROM invoice_view WHERE site_id = ?::uuid AND status = 'Draft' AND claimed_by = ?::uuid ORDER BY created_at", site, ctx.userId()));
        else if (tab.equals("drafts")) out.put("rows", db.rows("SELECT * FROM invoice_view WHERE site_id = ?::uuid AND status = 'Draft' ORDER BY created_at", site));
        else if (tab.equals("queue")) out.put("rows", db.rows("""
            SELECT p.id AS push_id, p.status AS push_status, p.entity, p.provider, p.attempts, p.last_error, p.sent_at AS pushed_at, p.created_at AS queued_at,
                i.id, i.code, i.kind, i.client_name, i.order_code, i.invoice_date, i.total FROM accounting_push p JOIN invoice_view i ON i.id = p.invoice_id
             WHERE p.site_id = ?::uuid ORDER BY p.created_at DESC LIMIT 500""", site));
        else if (PagedList.wanted(query)) {
            out.putAll(PagedList.of("SELECT v.*, invoice_payment_status(v.id) AS payment_status, i.paid_on FROM invoice_view v JOIN invoice i ON i.id = v.id WHERE v.site_id = ?::uuid AND v.status = 'Issued'", site)
                .filter("all", "true").filter("invoices", "kind::text = 'Invoice'").filter("credits", "kind::text <> 'Invoice'")
                .filter("unpaid", "kind::text = 'Invoice' AND payment_status IN ('Unpaid','Overdue')").filter("overdue", "payment_status = 'Overdue'").filter("paid", "payment_status = 'Paid'")
                .search("code", "invoice_number", "client_name", "order_code", "po_number", "issued_by_name").ids("code", "invoice_number", "order_code")
                .order("ORDER BY invoice_date DESC, invoice_number DESC")
                .aggregate("COALESCE(sum(total) FILTER (WHERE kind::text = 'Invoice'), 0) AS invoiced, COALESCE(-sum(total) FILTER (WHERE kind::text <> 'Invoice'), 0) AS credited, "
                    + "count(*) FILTER (WHERE kind::text = 'Invoice')::int AS invoices")
                .run(db, query));
            withPerms(out, ctx, site);
            out.put("me", ctx.userId());
            return out;
        } else out.put("rows", db.rows("""
            SELECT * FROM invoice_view WHERE site_id = ?::uuid AND status = 'Issued' AND invoice_date >= site_today(?::uuid) - ?::int
             ORDER BY invoice_date DESC, invoice_number DESC LIMIT 2000""", site, site, days));
        withPerms(out, ctx, site);
        out.put("me", ctx.userId());
        return out;
    }

    /** One invoice: its lines (with the rush tiers a draft's late lines could be billed at), payment, corrections, credits, emails, the QuickBooks push. */
    public Map<String, Object> invoice(RequestContext ctx, String id) {
        Map<String, Object> i = invoiceOf(ctx, id);
        boolean draft = "Draft".equals(i.get("status"));
        List<Map<String, Object>> lines = new ArrayList<>();
        for (Map<String, Object> l : db.rows("""
            SELECT l.*, COALESCE(rt.sample_id, oc.sample_id) AS sample_id, i.lab_order_id,
                (SELECT x.oos_code FROM oos_investigation x JOIN requested_test r2 ON r2.oos_investigation_id = x.id WHERE r2.id = l.requested_test_id) AS oos_code,
                (SELECT ci.invoice_number FROM invoice_line cl JOIN invoice ci ON ci.id = cl.invoice_id WHERE cl.credits_line_id = l.id AND ci.status = 'Issued') AS credited_by,
                oc.charge_no, (l.order_charge_id IS NOT NULL) AS is_charge
              FROM invoice_line l JOIN invoice i ON i.id = l.invoice_id LEFT JOIN requested_test rt ON rt.id = l.requested_test_id LEFT JOIN order_charge oc ON oc.id = l.order_charge_id
             WHERE l.invoice_id = ?::uuid AND l.status = 'Active' ORDER BY l.line_no""", i.get("id"))) {
            Map<String, Object> line = new LinkedHashMap<>(l);
            if (draft && line.get("requested_test_id") != null && (truthy(line.get("rush_ordered")) || Js.toNumber(line.get("late_days")) > 0))
                line.put("rush_options", db.rows("SELECT * FROM invoice_rush_options(?::uuid, ?::date)", line.get("requested_test_id"), line.get("completed_on")));
            lines.add(line);
        }
        i.putAll(db.one("""
            SELECT invoice_payment_status(i.id) AS payment_status, i.paid_on, i.paid_note, i.paid_recorded_at, u.full_name AS paid_recorded_by_name
              FROM invoice i LEFT JOIN app_user u ON u.id = i.paid_recorded_by WHERE i.id = ?::uuid""", i.get("id")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("invoice", i);
        out.put("lines", lines);
        out.put("credits", db.rows("SELECT id, code, invoice_date, total, reason FROM invoice_view WHERE credit_of_id = ?::uuid AND status = 'Issued' ORDER BY issued_at", i.get("id")));
        out.put("emails", db.rows("SELECT id, to_address, subject, created_at FROM email_outbox WHERE document_id = ?::uuid AND ?::uuid IS NOT NULL ORDER BY created_at",
            i.get("document_id"), i.get("document_id")));
        out.put("push", db.one("SELECT id, status, entity, provider, payload, attempts, last_error, sent_at, created_at FROM accounting_push WHERE invoice_id = ?::uuid", i.get("id")));
        out.put("corrections", db.rows("""
            SELECT k.id, k.correction_no, k.field, k.old_value, k.new_value, k.reason, k.document_id, k.push_status, k.sent_at, k.created_at, u.full_name AS by_name
              FROM invoice_correction k JOIN app_user u ON u.id = k.created_by WHERE k.invoice_id = ?::uuid ORDER BY k.created_at""", i.get("id")));
        out.put("charge_items", draft ? db.rows("""
            SELECT id, charge_code, charge_name, kind, price FROM charge_item
             WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid) ORDER BY kind = 'Discount', charge_name""", i.get("site_id")) : List.of());
        out.put("samples", draft ? db.rows("SELECT id, sample_code, client_sample_id FROM sample WHERE lab_order_id = ?::uuid AND status <> 'Cancelled' ORDER BY sample_code",
            i.get("lab_order_id")) : List.of());
        withPerms(out, ctx, (String) i.get("site_id"));
        out.put("me", ctx.userId());
        return out;
    }

    /** The order's billing (order page): its tests and invoices, or {allowed: false} without invoicing rights. */
    public Map<String, Object> orderBilling(RequestContext ctx, String orderId) {
        if (!RequestContext.isUuid(orderId)) throw new RuleException("Order not found");
        Map<String, Object> o = db.one("SELECT id, site_id FROM lab_order WHERE id = ?::uuid", orderId);
        if (o == null) throw new RuleException("Order not found");
        String site = (String) o.get("site_id");
        access.checkSite(ctx, site);
        UserAccess a = access.load(ctx.userId());
        if (!a.can("invoicing.view", site) && !a.can("invoicing.issue", site)) return Map.of("allowed", false);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("allowed", true);
        out.put("tests", db.rows("SELECT * FROM order_billing(?::uuid)", o.get("id")));
        out.put("invoices", db.rows("""
            SELECT id, code, kind, status, invoice_date, total, claimed_by_name, catchup, credits_number FROM invoice_view
             WHERE lab_order_id = ?::uuid AND status IN ('Draft','Issued') ORDER BY COALESCE(invoice_date, created_at::date), code""", o.get("id")));
        return out;
    }

    public Map<String, Object> settings(RequestContext ctx) {
        String site = access.currentSite(ctx);
        needView(ctx, site);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connection", db.one("SELECT * FROM accounting_connection WHERE site_id = ?::uuid", site));
        out.put("lab", db.one("SELECT id, site_code, site_name, invoice_remit_to FROM lab_site WHERE id = ?::uuid", site));
        out.put("clients", db.rows("""
            SELECT c.id, c.client_code, COALESCE(c.display_name, c.legal_name) AS client_name, c.payment_terms_days,
                (SELECT string_agg(ct.email, ', ') FROM client_contact cc JOIN contact ct ON ct.id = cc.contact_id
                  WHERE cc.client_id = c.id AND cc.status = 'Active' AND 'BILLING' = ANY (cc.roles)) AS billing_emails
              FROM client c WHERE NOT c.is_internal AND c.account_status <> 'Inactive' ORDER BY 3"""));
        withPerms(out, ctx, site);
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        out.put("is_admin", me != null && truthy(me.get("is_admin")));
        return out;
    }

    /** A stored corrected copy: {b64, file_name}. */
    public Map<String, Object> correctionPdf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Correction not found");
        Map<String, Object> k = db.one("SELECT invoice_id, document_id, correction_no FROM invoice_correction WHERE id = ?::uuid", id);
        if (k == null || k.get("document_id") == null) throw new RuleException("Correction not found");
        Map<String, Object> i = invoiceOf(ctx, k.get("invoice_id"));
        Map<String, Object> d = db.one("SELECT encode(content, 'base64') AS b64 FROM document_file WHERE id = ?::uuid", k.get("document_id"));
        return Map.of("b64", d.get("b64"), "file_name", i.get("code") + " corrected " + Js.string(k.get("correction_no")) + ".pdf");
    }

    // ---------------------------------------------------------------- the draft
    /** Claim tests and charges into one's own drafts (one per lab order): {invoices: [ids]}. */
    public Map<String, Object> claim(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        List<Object> tests = uuids(body.get("tests")), charges = uuids(body.get("charges"));
        if (tests.isEmpty() && charges.isEmpty()) throw new RuleException("Choose the work to invoice");
        Object note = truthy(body.get("note")) ? body.get("note") : null;
        List<Object> ids = uow.run(reason(ctx, "Work claimed for invoicing"), d -> {
            Set<Object> all = new LinkedHashSet<>();
            String why = note == null ? null : Js.string(note);
            if (!tests.isEmpty()) all.addAll(claimTests(d, tests, why));
            if (!charges.isEmpty()) all.addAll(claimCharges(d, charges, why));
            return new ArrayList<>(all);
        });
        return Map.of("invoices", ids);
    }

    /** Each lab order's tests go onto the claimer's own draft for that order (made if needed): the drafts, in order. */
    private List<Object> claimTests(Db d, List<Object> tests, String note) {
        List<Map<String, Object>> ready = store.readyTests(d, tests);
        for (Map<String, Object> r : ready) store.requirePermission(d, "invoicing.issue", (String) r.get("site_id"));
        Map<Object, String> drafts = new LinkedHashMap<>();
        for (Map<String, Object> r : ready) {
            String inv = drafts.computeIfAbsent(r.get("lab_order_id"), o -> store.draftFor(d, o, note));
            store.addTestLine(d, inv, r.get("requested_test_id"));
        }
        for (String inv : drafts.values()) store.saveTotals(d, inv);
        return new ArrayList<>(drafts.values());
    }

    /** Charges ready to invoice go onto the claimer's draft for each order, as tests do. */
    private List<Object> claimCharges(Db d, List<Object> charges, String note) {
        List<Map<String, Object>> ready = store.readyCharges(d, charges);
        for (Map<String, Object> r : ready) store.requirePermission(d, "invoicing.issue", (String) r.get("site_id"));
        Map<Object, String> drafts = new LinkedHashMap<>();
        for (Map<String, Object> r : ready) {
            String inv = drafts.computeIfAbsent(r.get("lab_order_id"), o -> store.draftFor(d, o, note));
            store.addChargeLine(d, inv, r.get("order_charge_id"));
        }
        for (String inv : drafts.values()) store.saveTotals(d, inv);
        return new ArrayList<>(drafts.values());
    }

    public Map<String, Object> update(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> i = invoiceOf(ctx, id);
        uow.run(reason(ctx, "Draft invoice checked"), d -> {
            Invoice draft = store.ownDraft(d, i.get("id"), ctx.userId());
            store.update(d, draft.id(), str(body.get("po_number")), str(body.get("note")), str(body.get("internal_note")));
            return null;
        });
        return ok();
    }

    public Map<String, Object> linePrice(RequestContext ctx, String lineId, Map<String, Object> body) {
        lineInvoice(ctx, lineId);
        double price = body.containsKey("price") ? Js.toNumber(body.get("price")) : Double.NaN;
        if (Double.isNaN(price) || Double.isInfinite(price)) throw new RuleException("Type the price");
        uow.run(reason(ctx, "Invoice price corrected"), d -> {
            InvoiceLine l = store.line(d, lineId);
            l.checkChangeable();
            store.ownDraft(d, l.invoiceId(), ctx.userId());
            InvoiceLine.Change c = l.reprice(new BigDecimal(Js.number(price)), str(body.get("note")), store.rushTerm(d, l.requestedTestId(), l.rushTierId()));
            store.saveLine(d, l.id(), c, true);
            store.saveTotals(d, l.invoiceId());
            return null;
        });
        return ok();
    }

    public Map<String, Object> lineRush(RequestContext ctx, String lineId, Map<String, Object> body) {
        lineInvoice(ctx, lineId);
        Object tier = RequestContext.isUuid(body.get("tier_id")) ? body.get("tier_id") : null;
        uow.run(reason(ctx, "Rush billed at the tier met"), d -> {
            Map<String, Object> row = store.lineRow(d, lineId);
            InvoiceLine l = store.line(d, lineId);
            l.checkChangeable();
            store.ownDraft(d, l.invoiceId(), ctx.userId());
            InvoiceLine.RushOption opt = store.rushOptions(d, l.requestedTestId(), row.get("completed_on")).stream()
                .filter(o -> java.util.Objects.equals(o.tierId(), tier == null ? null : tier.toString())).findFirst().orElse(null);
            store.saveLine(d, l.id(), l.rush(opt, str(body.get("note"))), false);
            store.saveTotals(d, l.invoiceId());
            return null;
        });
        return ok();
    }

    public Map<String, Object> removeLines(RequestContext ctx, Map<String, Object> body) {
        List<Object> lines = uuids(body.get("lines"));
        if (!lines.isEmpty()) {
            Map<String, Object> one = db.one("SELECT invoice_id FROM invoice_line WHERE id = ?::uuid", lines.get(0));
            if (one != null) invoiceOf(ctx, one.get("invoice_id"));
        }
        if (lines.isEmpty()) throw RuleException.database("Choose the lines to take off");
        Object n = uow.run(reason(ctx, "Taken off the draft invoice"), d -> {
            int k = 0;
            for (String inv : store.invoicesOfLines(d, lines)) {
                store.ownDraft(d, inv, ctx.userId());
                k += store.removeLines(d, inv, lines);
                if (Invoice.emptied(store.lines(d, inv))) store.discard(d, inv);
                else store.saveTotals(d, inv);
            }
            return k;
        });
        return Map.of("removed", (long) Js.toNumber(n));
    }

    public Map<String, Object> release(RequestContext ctx, String id) {
        Map<String, Object> i = invoiceOf(ctx, id);
        RequestContext r = reason(ctx, "Draft invoice released");
        uow.run(r, d -> {
            Invoice draft = store.load(d, i.get("id"));
            if (draft.checkRelease(ctx.userId(), store.has(d, "admin.users", draft.siteId()), r.reason())) store.requirePermission(d, "invoicing.issue", draft.siteId());
            store.removeLines(d, draft.id(), null);
            store.discard(d, draft.id());
            return null;
        });
        return ok();
    }

    /** A charge (or a discount) added straight onto one's own draft; recorded on the order too. */
    public Map<String, Object> addCharge(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> i = invoiceOf(ctx, id);
        if (!RequestContext.isUuid(body.get("charge_item_id"))) throw new RuleException("Choose the charge");
        Object raw = body.get("price");
        Double price = raw == null || "".equals(raw) ? null : Js.toNumber(raw);
        if (price != null && (price.isNaN() || price.isInfinite())) throw new RuleException("Type the price as a number");
        Long asked = parseInt(body.get("quantity"));
        long q = asked == null || asked == 0 ? 1 : asked;
        Object out = uow.run(reason(ctx, "Charge added at invoicing"), d -> {
            Invoice draft = store.ownDraft(d, i.get("id"), ctx.userId());
            Map<String, Object> item = orderCharges.item(d, body.get("charge_item_id"));
            Object sample = RequestContext.isUuid(body.get("sample_id")) ? body.get("sample_id") : null;
            Map<String, Object> s = sample == null ? null : d.one("SELECT lab_order_id FROM sample WHERE id = ?::uuid", sample);
            BigDecimal p = price != null ? new BigDecimal(Js.number(price)) : item == null ? BigDecimal.ZERO : new BigDecimal(item.get("price").toString());
            OrderCharge.checkQuantity(q);
            OrderCharge.checkNew(draft.labOrderId(), draft.siteId(), sample == null ? null : sample.toString(), s == null ? null : (String) s.get("lab_order_id"),
                item == null ? null : (String) item.get("status"), item == null ? null : (String) item.get("site_id"), p, p, true);
            Object charge = orderCharges.insert(d, draft.labOrderId(), sample, body.get("charge_item_id"), q, p, Invoice.text(str(body.get("note"))), "Invoice").get("id");
            store.addChargeLine(d, draft.id(), charge);
            store.saveTotals(d, draft.id());
            return charge;
        });
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("order_charge_id", out);
        return m;
    }

    /** Payment recorded by hand until QuickBooks reports payments (an empty date clears it). */
    public Map<String, Object> payment(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> i = invoiceOf(ctx, id);
        String d0 = Js.string(body.get("paid_on")).trim();
        if (!d0.isEmpty() && !d0.matches("^\\d{4}-\\d{2}-\\d{2}$")) throw new RuleException("Give the payment date as a date");
        uow.run(reason(ctx, d0.isEmpty() ? "Payment record cleared" : "Payment recorded"), d -> {
            Invoice inv = store.load(d, i.get("id"));
            inv.checkPayable();
            store.requirePermission(d, "invoicing.issue", inv.siteId());
            LocalDate paidOn;
            try { paidOn = d0.isEmpty() ? null : LocalDate.parse(d0); }
            catch (DateTimeParseException e) { throw RuleException.withCode("date/time field value out of range: \"" + d0 + "\"", "22008"); }
            inv.checkPaidOn(paidOn, store.today(d, inv.siteId()));
            store.recordPayment(d, inv.id(), paidOn, str(body.get("paid_note")));
            return null;
        });
        return ok();
    }

    // ---------------------------------------------------------------- settings
    @SuppressWarnings("unchecked")
    public Map<String, Object> saveTerms(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        List<Map<String, Object>> rows = body.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
        uow.run(reason(ctx, "Payment terms changed"), d -> {
            for (Map<String, Object> x : rows) {
                if (!RequestContext.isUuid(x.get("id"))) continue;
                int days = PaymentTerms.check(store.hasHere(d, "invoicing.issue") || store.systemAdmin(d), parseInt(x.get("payment_terms_days")));
                store.setTerms(d, x.get("id"), days);
            }
            return null;
        });
        return ok();
    }

    public Map<String, Object> saveConnection(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        uow.run(reason(ctx, "Accounting connection changed"), d -> {
            d.update("""
                UPDATE accounting_connection SET provider = COALESCE(?, provider), company_name = NULLIF(btrim(?), ''), company_id = NULLIF(btrim(?), ''),
                    environment = COALESCE(?, environment), item_name = COALESCE(NULLIF(btrim(?), ''), item_name) WHERE site_id = ?::uuid""",
                truthy(body.get("provider")) ? body.get("provider") : null, orBlank(body.get("company_name")), orBlank(body.get("company_id")),
                truthy(body.get("environment")) ? body.get("environment") : null, orBlank(body.get("item_name")), site);
            if (body.containsKey("invoice_remit_to")) d.update("UPDATE lab_site SET invoice_remit_to = NULLIF(btrim(?), '') WHERE id = ?::uuid", body.get("invoice_remit_to"), site);
            return null;
        });
        return ok();
    }
}
