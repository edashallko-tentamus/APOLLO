package com.tentamus.lims.purchasing.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.purchasing.repo.PurchasingRepository;
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
 * Every change is signed; the rules (approved suppliers and scopes, never approving your own request, the second
 * approval, back-orders) are the database's.
 */
@Service
public class PurchasingService {
    static final Pattern SLIP_TYPES = Pattern.compile("^(application/pdf|image/(png|jpeg|gif|webp))$");
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final PurchasingRepository repo;

    public PurchasingService(Db db, AccessPolicy access, SignatureService signatures, PurchasingRepository repo) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
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

    public Map<String, Object> createLine(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = map(body.get("row"));
        if (row.get("line_type") == null || !List.of("Equipment", "Service", "Other").contains(row.get("line_type")))
            throw new RuleException("Pick what kind of purchase it is (equipment, a service, or other); request inventory items from the Inventory page");
        Map<String, Object> r = new LinkedHashMap<>(cleanScopes(row));
        r.remove("id");
        return sign(ctx, body, "Requested by", "Purchase request: " + str(row.get("description")), d -> {
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
        return sign(ctx, body, cancel ? "Cancelled by" : "Changed by", (cancel ? "Cancel" : "Change") + " request " + l.get("line_code") + " " + str(l.get("description")),
            d -> PurchasingRepository.LINE.upsert(d, List.of(r), Map.of()));
    }

    public Map<String, Object> approve(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the requests to approve");
        return sign(ctx, body, "Approved by", "Approve " + rows.size() + " purchase request(s): " + codes(rows),
            d -> d.one("SELECT approve_purchase_lines(?::uuid[]) AS n", ids(rows)));
    }

    public Map<String, Object> reject(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the requests to reject");
        return sign(ctx, body, "Rejected by", "Reject " + rows.size() + " purchase request(s): " + codes(rows),
            d -> d.one("SELECT reject_purchase_lines(?::uuid[], ?) AS n", ids(rows), ctx.reason()));
    }

    // ---------------------------------------------------------------- purchase orders
    public Map<String, Object> createOrder(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = repo.linesOfLab(body.get("line_ids"), site);
        if (rows.isEmpty()) throw new RuleException("Tick the approved requests to order");
        String po = truthy(body.get("external_po_number")) ? " (PO " + str(body.get("external_po_number")) + ")" : "";
        return sign(ctx, body, "Ordered by", "Purchase order for " + codes(rows) + po, d -> {
            Object id = d.one("SELECT create_purchase_order(?::uuid[], ?, ?, ?) AS id", ids(rows), or(body.get("external_po_number")),
                or(body.get("confirmation_number")), or(body.get("notes"))).get("id");
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
        Map<String, Object> l = lineOf(ctx, id);
        Map<String, Object> slip = map(b.get("slip"));
        boolean hasSlip = truthy(slip.get("content_base64"));
        if (hasSlip && !SLIP_TYPES.matcher(str(slip.get("mime_type"))).matches()) throw new RuleException("Upload the packing slip as a PDF or an image (PNG or JPEG)");
        Object disc = b.get("discrepancy");
        String action = "Received " + str(b.get("quantity")) + " " + str(l.get("unit")) + " on " + l.get("line_code") + " " + str(l.get("description"))
            + (truthy(disc) && !"None".equals(disc) ? " (" + str(disc) + ")" : "");
        return sign(ctx, b, "Received by", action, d -> {
            Object slipId = null;
            if (hasSlip) slipId = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
                truthy(slip.get("file_name")) ? slip.get("file_name") : "packing-slip", slip.get("mime_type"), slip.get("content_base64")).get("id");
            // actual_price: what was really paid per unit (optional); inventory: put an Other or Service purchase into inventory now (migration 023)
            Object rc = d.one("SELECT receive_purchase_line(?, ?, ?, ?::receipt_discrepancy, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?::jsonb) AS id",
                l.get("id"), b.containsKey("quantity") && b.get("quantity") == null ? 0 : number(b.get("quantity")), truthy(b.get("more_to_come")), truthy(disc) ? disc : "None", or(b.get("note")), slipId,
                or(b.get("manufacturer_lot")), or(b.get("expiration_date")), or(b.get("retest_date")), or(b.get("storage_location_id")),
                truthy(b.get("equipment")) ? b.get("equipment") : null, number(b.get("actual_price")), truthy(b.get("inventory")) ? b.get("inventory") : null).get("id");
            return d.one("SELECT r.id, r.receipt_code, r.lot_id, l.lot_code FROM purchase_receipt r LEFT JOIN inventory_lot l ON l.id = r.lot_id WHERE r.id = ?::uuid", rc);
        });
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
        return sign(ctx, body, "Changed by", "Purchasing settings: second approval over " + (over == null ? "no amount" : Js.string(over)),
            d -> d.raw("UPDATE purchasing_setting SET second_approval_over = ? WHERE site_id = ?::uuid", number(over), site));
    }

    // ---------------------------------------------------------------- helpers
    /** Number(v), or null for nothing sent (as the Node backend reads an optional amount). */
    static Object number(Object v) { return v == null || "".equals(v) ? null : Js.toNumber(v); }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }
}
