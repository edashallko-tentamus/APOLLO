package com.tentamus.lims.purchasing.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.Answers;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.purchasing.domain.PurchaseLine;
import com.tentamus.lims.purchasing.domain.PurchaseOrder;
import com.tentamus.lims.purchasing.domain.PurchasingSetting;
import com.tentamus.lims.purchasing.domain.ScopeList;
import com.tentamus.lims.purchasing.domain.VendorDecision;
import com.tentamus.lims.purchasing.repo.DatabaseChecks;
import com.tentamus.lims.purchasing.repo.PurchaseLineRepository;
import com.tentamus.lims.purchasing.repo.PurchasingRepository;
import com.tentamus.lims.purchasing.repo.VendorRepository;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Purchasing: the request queue, approvals and rejections, purchase orders (one per supplier, the finance PO number),
 * receiving (partial, problems, packing slips, into inventory or the equipment register) and the lab's settings.
 * Every step is signed. The rules are {@link PurchaseLine}'s and {@link VendorDecision}'s; the database still checks
 * permissions and signatures, and keeps its own copy of the request rules for inventory's writes (migration 065).
 */
@Service
public class PurchasingService {
    static final Pattern SLIP_TYPES = Pattern.compile("^(application/pdf|image/(png|jpeg|gif|webp))$");
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final PurchasingRepository repo;
    private final PurchaseLineRepository lines;
    private final VendorRepository vendors;
    private final DatabaseChecks checks;
    private final LabClock clock;

    public PurchasingService(Db db, AccessPolicy access, SignatureService signatures, PurchasingRepository repo, PurchaseLineRepository lines,
                             VendorRepository vendors, DatabaseChecks checks, LabClock clock) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
        this.lines = lines;
        this.vendors = vendors;
        this.checks = checks;
        this.clock = clock;
    }

    <T> T sign(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Purchasing"), work);
    }

    private Map<String, Object> lineOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Request not found");
        Map<String, Object> l = repo.line(id);
        if (l == null) throw new RuleException("Request not found");
        access.checkSite(ctx, (String) l.get("site_id"));
        return l;
    }

    private static String codes(List<Map<String, Object>> rows) { return rows.stream().map(x -> str(x.get("line_code"))).collect(Collectors.joining(", ")); }

    private static List<Object> ids(List<Map<String, Object>> rows) { return rows.stream().map(x -> x.get("id")).toList(); }

    /** Refuses a purchase step from a vendor not approved for it (the request's scopes, then for anything). */
    void assertSupplier(Db d, String supplier, String site, List<String> scopes, String toStatus) {
        if (supplier == null || !PurchaseLine.OPEN.contains(toStatus)) return;
        java.time.LocalDate today = clock.today(site);
        ScopeList all = vendors.scopes(d);
        var corporate = vendors.corporate(d, supplier);
        var local = vendors.local(d, supplier, site);
        VendorDecision forScopes = scopes == null || scopes.isEmpty() ? null : VendorDecision.of(corporate, local, today, scopes, all);
        VendorDecision.assertAllows(PurchaseLine.supplierStep(toStatus), vendors.supplierName(d, supplier), forScopes, VendorDecision.of(corporate, local, today, null, all));
    }

    public Map<String, Object> me(RequestContext ctx) {
        access.currentSite(ctx);
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        for (String k : List.of("request", "approve", "approve_over", "order", "receive", "suppliers", "qualify", "qualify_corporate"))
            out.put("can_" + k, a.can("purchasing." + k, ctx.siteId()));
        out.put("can_settings", a.can("admin.lab", ctx.siteId()));
        Map<String, Object> u = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        out.put("is_system_admin", u != null && Boolean.TRUE.equals(u.get("is_admin")));
        return out;
    }

    // ---------------------------------------------------------------- the request queue
    public Map<String, Object> lines(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        Map<String, Object> setting = repo.setting(site);
        Map<String, Object> out = new LinkedHashMap<>();
        if (PagedList.wanted(query)) out.putAll(repo.linesPage(site, ctx.userId(), query));
        else out.put("rows", repo.lines(site, ctx.userId()));
        out.put("setting", setting);
        return out;
    }

    public Map<String, Object> line(RequestContext ctx, String id) { return repo.lineDetail(lineOf(ctx, id)); }

    /** A request's scopes (V-1): only valid ids are kept; none at all means none chosen. */
    static Map<String, Object> cleanScopes(Map<String, Object> row) {
        if (!row.containsKey("scope_ids")) return row;
        Object v = row.get("scope_ids");
        List<Object> ids = new ArrayList<>();
        if (v instanceof List<?> l) { for (Object x : l) if (RequestContext.isUuid(x)) ids.add(x); }
        else if (RequestContext.isUuid(v)) ids.add(v);
        Map<String, Object> out = new LinkedHashMap<>(row);
        out.put("scope_ids", ids.isEmpty() ? null : ids);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<String> scopeList(Object v) { return v instanceof List<?> l ? (List<String>) (List<?>) l.stream().map(Object::toString).toList() : null; }

    public Map<String, Object> createLine(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = map(body.get("row"));
        PurchaseLine.checkNew(row.get("line_type"));
        Map<String, Object> r = new LinkedHashMap<>(cleanScopes(row));
        r.remove("id");
        PurchaseLine.checkValues(PurchasingRepository.NEW_LINE.pick(r), true);
        return sign(ctx, body, "Requested by", "Purchase request: " + str(row.get("description")), d -> {
            List<String> scopes = vendors.scopes(d).forRequest(str(r.get("line_type")), scopeList(r.get("scope_ids")), null);
            r.put("scope_ids", scopes);
            assertSupplier(d, (String) Answers.uuidOrNull(r.get("supplier_id")), site, scopes, "Requested");
            Object id = PurchasingRepository.NEW_LINE.upsert(d, List.of(r), Map.of("site_id", site)).get(0).get("id");
            return d.one("SELECT id, line_code FROM purchase_line WHERE id = ?::uuid", id);
        });
    }

    public List<Map<String, Object>> updateLine(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> l = lineOf(ctx, id);
        Map<String, Object> row = map(body.get("row"));
        boolean cancel = "Cancelled".equals(row.get("status"));
        Map<String, Object> r = new LinkedHashMap<>(cleanScopes(row));
        r.put("id", l.get("id"));
        return sign(ctx, body, cancel ? "Cancelled by" : "Changed by", (cancel ? "Cancel" : "Change") + " request " + l.get("line_code") + " " + str(l.get("description")), d -> {
            PurchaseLine line = lines.lock(d, (String) l.get("id"));
            Map<String, Object> changes = PurchasingRepository.LINE.pick(r);
            if (changes.isEmpty()) return List.of();
            boolean reset = line.change(changes, ctx.userId(), checks.hasPermission(d, "purchasing.approve", line.siteId()));
            String to = reset ? "Requested" : changes.containsKey("status") ? str(changes.get("status")) : line.status();
            List<String> scopes = line.scopeIds();
            if (changes.containsKey("scope_ids") || List.of("Inventory item", "Equipment").contains(line.lineType())) {
                scopes = vendors.scopes(d).forRequest(line.lineType(), scopeList(changes.get("scope_ids")), lines.lotTypes(d, line.lotId()));
                if (changes.containsKey("scope_ids")) r.put("scope_ids", scopes);
            }
            if (changes.containsKey("supplier_id") || changes.containsKey("scope_ids") || reset)
                assertSupplier(d, changes.containsKey("supplier_id") ? (String) Answers.uuidOrNull(changes.get("supplier_id")) : line.supplierId(), line.siteId(), scopes, to);
            if (reset) lines.resetApproval(d, line.id());
            return PurchasingRepository.LINE.upsert(d, List.of(r), Map.of());
        });
    }

    public Map<String, Object> approve(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the requests to approve");
        return sign(ctx, body, "Approved by", "Approve " + rows.size() + " purchase request(s): " + codes(rows), d -> {
            checks.assertSigned(d, "approve purchase requests");
            checks.ensureReason(d, "Purchase request approved");
            int n = 0;
            for (PurchaseLine l : lines.lockAll(d, ids(rows))) {
                l.assertNotOwn(ctx.userId());
                if (l.approvalPermission() != null) checks.requirePermission(d, l.approvalPermission(), l.siteId());
                String to = l.approve(ctx.userId(), lines.secondApprovalOver(d, l.siteId()));
                assertSupplier(d, l.supplierId(), l.siteId(), l.scopeIds(), to);
                lines.approve(d, l, to, ctx.userId());
                n++;
            }
            return Answers.map("n", n);
        });
    }

    public Map<String, Object> reject(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the requests to reject");
        return sign(ctx, body, "Rejected by", "Reject " + rows.size() + " purchase request(s): " + codes(rows), d -> {
            String reason = ctx.reason();
            PurchaseLine.checkRejectReason(reason);
            checks.assertSigned(d, "reject purchase requests");
            checks.ensureReason(d, "Purchase request rejected: " + reason);
            int n = 0;
            for (PurchaseLine l : lines.lockAll(d, ids(rows))) {
                l.assertRejectable();
                checks.requirePermission(d, "purchasing.approve", l.siteId());
                lines.reject(d, l.id(), reason);
                n++;
            }
            return Answers.map("n", n);
        });
    }

    // ---------------------------------------------------------------- purchase orders
    public Map<String, Object> createOrder(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("line_ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the approved requests to order");
        String po = truthy(body.get("external_po_number")) ? " (PO " + str(body.get("external_po_number")) + ")" : "";
        return sign(ctx, body, "Ordered by", "Purchase order for " + codes(rows) + po, d -> {
            List<PurchaseLine> ls = lines.lockAll(d, ids(rows));
            PurchaseLine.OrderGroup g = PurchaseLine.orderGroup(ls);
            checks.requirePermission(d, "purchasing.order", g.siteId());
            checks.assertSigned(d, "place a purchase order");
            checks.ensureReason(d, "Ordered");
            assertSupplier(d, g.supplierId(), g.siteId(), null, "Ordered");
            for (PurchaseLine l : ls) {
                l.assertOrderable();
                assertSupplier(d, l.supplierId(), l.siteId(), l.scopeIds(), "Ordered");
            }
            String id = lines.createOrder(d, g.siteId(), g.supplierId(), PurchaseOrder::code, PurchaseOrder.clean(or(body.get("external_po_number"))),
                PurchaseOrder.clean(or(body.get("confirmation_number"))), or(body.get("notes")), ls);
            return d.one("SELECT id, po_code FROM purchase_order WHERE id = ?::uuid", id);
        });
    }

    public Object orders(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        return PagedList.wanted(query) ? repo.ordersPage(site, query) : repo.orders(site);
    }

    public Map<String, Object> order(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Order not found");
        Map<String, Object> o = repo.order(id);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("order", o);
        out.put("lines", repo.orderLines(o.get("id")));
        return out;
    }

    public List<Map<String, Object>> updateOrder(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = db.one("SELECT id, po_code, site_id FROM purchase_order WHERE id = ?::uuid", id);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        Map<String, Object> r = new LinkedHashMap<>(map(body.get("row")));
        r.put("id", o.get("id"));
        return sign(ctx, body, "Changed by", "Purchase order " + o.get("po_code") + " changed", d -> PurchasingRepository.ORDER.upsert(d, List.of(r), Map.of()));
    }

    // ---------------------------------------------------------------- receiving
    public Map<String, Object> receive(RequestContext ctx, String id, Map<String, Object> b) {
        Map<String, Object> l0 = lineOf(ctx, id);
        Map<String, Object> slip = map(b.get("slip"));
        boolean hasSlip = truthy(slip.get("content_base64"));
        if (hasSlip && !SLIP_TYPES.matcher(str(slip.get("mime_type"))).matches()) throw new RuleException("Upload the packing slip as a PDF or an image (PNG or JPEG)");
        Object disc = b.get("discrepancy");
        String discrepancy = truthy(disc) ? str(disc) : "None";
        String action = "Received " + str(b.get("quantity")) + " " + str(l0.get("unit")) + " on " + l0.get("line_code") + " " + str(l0.get("description"))
            + (truthy(disc) && !"None".equals(disc) ? " (" + str(disc) + ")" : "");
        Map<String, Object> equipment = truthy(b.get("equipment")) ? map(b.get("equipment")) : null;
        Map<String, Object> inventory = truthy(b.get("inventory")) ? map(b.get("inventory")) : null;
        BigDecimal qty = b.containsKey("quantity") && b.get("quantity") == null ? BigDecimal.ZERO : decimal(b.get("quantity"));
        BigDecimal actual = decimal(b.get("actual_price"));
        return sign(ctx, b, "Received by", action, d -> {
            Object slipId = null;
            if (hasSlip) slipId = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
                truthy(slip.get("file_name")) ? slip.get("file_name") : "packing-slip", slip.get("mime_type"), slip.get("content_base64")).get("id");
            PurchaseLine l = lines.lock(d, (String) l0.get("id"));
            l.assertReceivable();
            checks.requirePermission(d, "purchasing.receive", l.siteId());
            checks.assertSigned(d, "receive a delivery");
            checks.ensureReason(d, PurchaseLine.receiptReason(discrepancy));
            PurchaseLine.Receipt plan = l.receive(new PurchaseLine.Delivery(qty, truthy(b.get("more_to_come")), discrepancy, str(b.get("note")), actual,
                equipment != null, equipment == null ? null : str(equipment.get("owner_group_id")), inventory != null));
            String back = null, newLot = null, eq = null;
            switch (plan.makes()) {
                case "Lot" -> back = lines.receiveLot(d, l, qty, or(b.get("manufacturer_lot")), or(b.get("expiration_date")), or(b.get("retest_date")),
                    or(b.get("storage_location_id")), plan.backOrder() ? plan.left() : null);
                case "Equipment" -> eq = lines.receiveEquipment(d, l, equipment);
                case "Inventory" -> newLot = lines.receiveIntoInventory(d, l, qty, inventory, itemTypes(inventory.get("chemical_types")), or(b.get("manufacturer_lot")),
                    or(b.get("expiration_date")), or(b.get("retest_date")), or(b.get("storage_location_id")));
                default -> { }
            }
            String rc = lines.insertReceipt(d, l, qty, newLot != null ? newLot : l.lotId(), eq, discrepancy, or(b.get("note")), slipId, actual);
            lines.received(d, l, qty, plan.newStatus(), back != null ? back : newLot, eq);
            return d.one("SELECT r.id, r.receipt_code, r.lot_id, l.lot_code FROM purchase_receipt r LEFT JOIN inventory_lot l ON l.id = r.lot_id WHERE r.id = ?::uuid", rc);
        });
    }

    /** The item types of an Other or Service purchase put into inventory; none given is a consumable. */
    static List<String> itemTypes(Object v) {
        List<String> t = v instanceof List<?> l ? l.stream().filter(x -> x != null && !x.toString().isBlank()).map(Object::toString).toList() : List.of();
        return t.isEmpty() ? List.of("Consumable") : t;
    }

    public Map<String, Object> slip(RequestContext ctx, String receiptId) {
        Map<String, Object> d = repo.slip(receiptId);
        if (d == null) throw new RuleException("Packing slip not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    // ---------------------------------------------------------------- settings
    public Map<String, Object> settings(RequestContext ctx) { return repo.setting(access.currentSite(ctx)); }

    public Map<String, Object> saveSettings(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> v = map(body.get("row"));
        Object over = v.get("second_approval_over");
        PurchasingSetting.checkSecondApprovalOver(decimal(over));
        return sign(ctx, body, "Changed by", "Purchasing settings: second approval over " + (over == null ? "no amount" : Js.string(over)),
            d -> {
                access.requireAt(ctx, "admin.lab", site);
                return d.raw("UPDATE purchasing_setting SET second_approval_over = ? WHERE site_id = ?::uuid", number(over), site);
            });
    }

    // ---------------------------------------------------------------- helpers
    /** Number(v), or null for nothing sent (as the Node backend reads an optional amount). */
    static Object number(Object v) { return v == null || "".equals(v) ? null : Js.toNumber(v); }

    /** An optional amount as a decimal; not a number counts as none. */
    static BigDecimal decimal(Object v) {
        Object n = number(v);
        return n instanceof Double x && (x.isNaN() || x.isInfinite()) || n == null ? null : new BigDecimal(Js.string(n));
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }
}
