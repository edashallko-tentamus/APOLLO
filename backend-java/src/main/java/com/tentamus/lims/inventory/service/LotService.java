package com.tentamus.lims.inventory.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.inventory.repo.LotRepository;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Inventory lots: items and requests, the purchase steps, receiving, transfer, disposal, stock movements, in-house
 * mixtures, QA testing before use and Supplier COAs. Every create and change is signed (user ID and password) with the
 * meaning of the action; routine usage is not. The rules themselves (eligibility, stock, conditions, expiry) are the
 * database's.
 */
@Service
public class LotService {
    private static final Pattern COA_TYPES = Pattern.compile("^(application/pdf|image/(png|jpeg|gif|webp))$");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final LotRepository lots;
    private final CoaReader ai;
    private final ObjectMapper json;

    public LotService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, LotRepository lots, CoaReader ai, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.lots = lots;
        this.ai = ai;
        this.json = json;
    }

    // ---------------------------------------------------------------- reading
    public Object list(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        return com.tentamus.lims.core.paging.PagedList.wanted(query) ? lots.page(site, query) : lots.lots(site);
    }

    public Map<String, Object> dashboard(RequestContext ctx) { return lots.dashboard(access.currentSite(ctx)); }

    public Map<String, Object> detail(RequestContext ctx, String id) {
        lotSite(ctx, id);
        return lots.detail(id);
    }

    /** The lab of a lot the person may see, or a refusal. */
    String lotSite(RequestContext ctx, String id) {
        String site = lots.siteOf(id);
        if (site == null) throw new RuleException("Lot not found");
        access.checkSite(ctx, site);
        return site;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Inventory"), work);
    }

    // ---------------------------------------------------------------- items and requests
    /** Receive many (paste grid): each row may name one analyte with its concentration. */
    public List<Map<String, Object>> receiveMany(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return signed(ctx, body, "Received by", "Receive many: " + rows.size() + " item(s)", d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, Object> rest = new LinkedHashMap<>(row);
                Object aid = rest.remove("analyte_id"), ac = rest.remove("analyte_concentration"), au = rest.remove("analyte_unit"), qa = rest.remove("qa_testing");
                lots.qaChoice(d, row.get("id") != null ? null : qa);
                List<Map<String, Object>> res = LotRepository.LOTS.upsert(d, List.of(rest), Map.of("site_id", site));
                Object lotId = !res.isEmpty() && res.get(0) != null ? res.get(0).get("id") : row.get("id");
                if (aid != null && !"".equals(aid)) {
                    Object unit = au == null || "".equals(au) ? null : au;
                    Map<String, Object> ex = d.one("SELECT id FROM lot_analyte WHERE lot_id = ?::uuid AND analyte_id = ?::uuid", lotId, aid);
                    if (ex != null) d.update("UPDATE lot_analyte SET concentration = ?, concentration_unit = ?, status = 'Active' WHERE id = ?::uuid", ac, unit, ex.get("id"));
                    else d.update("INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) VALUES (?::uuid, ?::uuid, ?, ?)", lotId, aid, ac, unit);
                }
                Map<String, Object> id = new LinkedHashMap<>();
                id.put("id", lotId);
                out.add(id);
            }
            return out;
        });
    }

    /** A new item (received now, or a purchase request) with its analytes, and its Supplier COA when one comes with it. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        boolean request = truthy(body.get("request"));
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        if (request) row.put("receipt_status", "Requested");
        Map<String, Object> coa = map(body.get("coa"));
        boolean withCoa = coa.get("content_base64") != null && !"".equals(coa.get("content_base64"));
        if (withCoa && !COA_TYPES.matcher(str(coa.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        String action = "New inventory item: " + str(row.get("item_name")) + (withCoa ? " (with its Supplier COA)" : "");
        return signed(ctx, body, request ? "Requested by" : "Created by", action, d -> {
            lots.qaChoice(d, body.get("qa_testing"));
            Map<String, Object> lot = (request ? LotRepository.REQUESTS : LotRepository.LOTS).upsert(d, List.of(row), Map.of("site_id", site)).get(0);
            lots.syncAnalytes(d, lot.get("id"), (List<Map<String, Object>>) list(body.get("analytes")));
            if (withCoa) saveCoa(d, lot.get("id"), coa, coa.get("proposal"), coa.get("confirmed"));
            return lot;
        });
    }

    /** Edit an item and its analytes (one signature and Reason for Change). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> updateItem(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        signed(ctx, body, "Changed by", lots.words(id, "Changed"), d -> {
            LotRepository.LOTS.upsert(d, List.of(withId(map(body.get("row")), id)), Map.of());
            if (body.get("analytes") != null) lots.syncAnalytes(d, id, (List<Map<String, Object>>) list(body.get("analytes")));
            return null;
        });
        return Map.of("ok", true);
    }

    public List<Map<String, Object>> updateLot(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        return signed(ctx, body, "Changed by", lots.words(id, "Changed"), d -> LotRepository.LOTS.upsert(d, List.of(withId(map(body.get("row")), id)), Map.of()));
    }

    /** A new purchase request (not a reorder of a lot). */
    public Map<String, Object> request(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        row.put("receipt_status", "Requested");
        List<Map<String, Object>> r = signed(ctx, body, "Requested by", "Purchase request: " + str(row.get("item_name")),
            d -> LotRepository.REQUESTS.upsert(d, List.of(row), Map.of("site_id", site)));
        return r.isEmpty() ? null : r.get(0);
    }

    // ---------------------------------------------------------------- purchase steps, receiving, transfer, disposal
    /** Approve or order the lot's purchase request (since migration 011 through Purchasing). */
    public Map<String, Object> purchaseStatus(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        Object to = body.get("receipt_status");
        if (!"Approved".equals(to) && !"Ordered".equals(to)) throw new RuleException("Use Receive to receive a lot");
        Map<String, Object> l = db.one("SELECT purchase_line_id FROM inventory_lot WHERE id = ?::uuid", id);
        Object line = l == null ? null : l.get("purchase_line_id");
        if (line == null) throw new RuleException("This lot has no purchase request");
        boolean approve = "Approved".equals(to);
        RequestContext c = reasonOr(ctx, approve ? "Purchase request approved" : "Ordered");
        Meaning m = new Meaning(approve ? "Approved by" : "Ordered by", lots.words(id, approve ? "Purchase approved" : "Ordered"), "Purchasing");
        return signatures.signed(c, body, m, d -> approve
            ? d.raw("SELECT approve_purchase_lines(?::uuid[])", List.of(line))
            : d.raw("SELECT create_purchase_order(?::uuid[], ?, ?, NULL)", List.of(line), or(body.get("external_po_number")), or(body.get("confirmation_number"))));
    }

    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        return signed(ctx, body, "Cancelled by", lots.words(id, "Purchase request cancelled"), d -> d.raw("UPDATE inventory_lot SET status = 'Cancelled' WHERE id = ?::uuid", id));
    }

    public Map<String, Object> reorder(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        return signed(ctx, body, "Requested by", lots.words(id, "Reorder of"),
            d -> d.one("SELECT reorder_lot(?::uuid, ?, ?) AS id", id, or(body.get("quantity")), or(body.get("notes"))));
    }

    public Map<String, Object> receive(RequestContext ctx, String id, Map<String, Object> b) {
        lotSite(ctx, id);
        return signatures.signed(reasonOr(ctx, "Received into inventory"), b, new Meaning("Received by", lots.words(id, "Received"), "Inventory"),
            d -> d.raw("SELECT receive_lot(?::uuid, ?, ?, ?, ?, ?, ?, ?)", id, or(b.get("quantity")), or(b.get("unit")), or(b.get("manufacturer_lot")),
                or(b.get("expiration_date")), or(b.get("retest_date")), or(b.get("storage_location_id")), or(b.get("received_date"))));
    }

    public Map<String, Object> transfer(RequestContext ctx, String id, Map<String, Object> b) {
        lotSite(ctx, id);
        return signed(ctx, b, "Transferred by", lots.words(id, "Transferred"),
            d -> d.one("SELECT transfer_lot(?::uuid, ?::uuid, ?, ?) AS id", id, b.get("to_site_id"), b.get("quantity"), or(b.get("notes"))));
    }

    public Map<String, Object> dispose(RequestContext ctx, String id, Map<String, Object> b) {
        lotSite(ctx, id);
        return signed(ctx, b, "Disposed by", lots.words(id, "Disposed"), d -> d.raw("SELECT dispose_lot(?::uuid)", id));
    }

    // ---------------------------------------------------------------- stock movements
    /** Usage and adjustments for one or many lots of this lab; usage needs no signature, adjustments do. */
    public List<Map<String, Object>> movements(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        boolean routine = rows.stream().allMatch(m -> "Usage".equals(m.get("txn_type") == null || "".equals(m.get("txn_type")) ? "Usage" : m.get("txn_type")));
        Function<Db, List<Map<String, Object>>> work = d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> m : rows) {
                boolean byId = m.get("lot_id") != null && !"".equals(m.get("lot_id"));
                Map<String, Object> lot = byId ? d.one("SELECT id, site_id FROM inventory_lot WHERE id = ?::uuid", m.get("lot_id"))
                    : d.one("SELECT id, site_id FROM inventory_lot WHERE upper(lot_code) = upper(?)", str(m.get("lot_code")).trim());
                if (lot == null) throw new RuleException("Lot \"" + str(m.get("lot_code")) + "\" not found");
                if (!site.equals(lot.get("site_id"))) throw new RuleException("Lot " + str(m.get("lot_code")) + " belongs to another lab");
                out.add(d.one("""
                    INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, reference, notes, txn_at)
                      VALUES (?::uuid, ?, ?, ?, ?, COALESCE(?::timestamptz, clock_timestamp())) RETURNING id""",
                    lot.get("id"), or(m.get("txn_type")) == null ? "Usage" : m.get("txn_type"), m.get("quantity"), or(m.get("reference")), or(m.get("notes")), or(m.get("txn_at"))));
            }
            return out;
        };
        return routine ? uow.run(ctx, work) : signed(ctx, body, "Adjusted by", "Stock adjustment: " + rows.size() + " line(s)", work);
    }

    // ---------------------------------------------------------------- in-house mixtures
    public Map<String, Object> mixture(RequestContext ctx, Map<String, Object> b) {
        String site = access.currentSite(ctx);
        return signed(ctx, b, "Prepared by", "In-house mixture: " + str(b.get("item_description")), d -> d.one(
            "SELECT make_mixture(?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?, ?, ?::uuid, ?::jsonb, ?) AS id",
            site, or(b.get("chemical_id")), or(b.get("item_description")), b.get("quantity"), b.get("unit"), or(b.get("concentration")), or(b.get("concentration_unit")),
            or(b.get("expiration_date")), or(b.get("storage_condition")), or(b.get("storage_location_id")), toJson(list(b.get("components"))), or(b.get("notes"))));
    }

    /** The mixture page: the default quantity made and the calculated concentration of each analyte, before saving. */
    public Map<String, Object> mixturePreview(RequestContext ctx, Map<String, Object> b) {
        access.currentSite(ctx);
        List<Object> comps = new ArrayList<>();
        for (Object x : list(b.get("components")))
            if (x instanceof Map<?, ?> m && truthy(m.get("lot_id")) && Js.toNumber(m.get("quantity")) > 0) comps.add(x);
        String compsJson = toJson(comps);
        Object unit = b.get("unit");
        Object def = truthy(unit) ? db.one("SELECT mixture_default_quantity(?::jsonb, ?) AS q", compsJson, unit).get("q") : null;
        double asked = Js.toNumber(b.get("quantity"));
        Object qty = asked > 0 ? (Object) asked : def;
        List<Map<String, Object>> analytes = truthy(qty) && truthy(unit) ? db.rows("""
            SELECT m.*, a.cas_number FROM mixture_concentrations(?::jsonb, ?::numeric, ?, ?, ?::jsonb) m
              JOIN analyte a ON a.id = m.analyte_id ORDER BY m.analyte_name""",
            compsJson, qty, unit, truthy(b.get("form")) ? b.get("form") : "Liquid", toJson(b.get("out_units") == null ? Map.of() : b.get("out_units"))) : List.of();
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("default_quantity", def);
        out.put("quantity", qty);
        out.put("analytes", analytes);
        return out;
    }

    public Map<String, Object> prepareMixture(RequestContext ctx, Map<String, Object> b) {
        String site = access.currentSite(ctx);
        return signed(ctx, b, "Prepared by", "In-house mixture: " + str(b.get("item_name")), d -> d.one(
            "SELECT prepare_mixture(?::uuid, ?, ?::chemical_type[], ?, ?, ?, ?, ?, ?::uuid, ?::jsonb, ?::jsonb, ?, ?) AS id",
            site, b.get("item_name"), list(b.get("chemical_types")), b.get("physical_form"), b.get("quantity"), b.get("unit"), or(b.get("expiration_date")),
            or(b.get("storage_condition")), or(b.get("storage_location_id")), toJson(list(b.get("components"))), toJson(list(b.get("targets"))), or(b.get("notes")),
            or(b.get("retest_date"))));
    }

    // ---------------------------------------------------------------- QA testing before use
    /** The tests a lot can be released for and qualified by: this lab's tests with an approved version. */
    public Map<String, Object> qualifyOptions(RequestContext ctx, String id) {
        String site = lotSite(ctx, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tests", db.rows("""
            SELECT t.id, t.test_code, t.test_name, d.department_code FROM test t LEFT JOIN department d ON d.id = t.department_id
             WHERE t.site_id = ?::uuid AND t.status = 'Active' AND EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective')
             ORDER BY d.department_code NULLS LAST, t.test_name""", site));
        out.put("can_qualify", access.has(ctx, "inventory.qualify"));
        return out;
    }

    /** Sends the lot for QA testing: one test sample with the lot's ID; an empty use = released for every use. */
    public Map<String, Object> qualify(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object o : list(body.get("items"))) {
            if (!(o instanceof Map<?, ?> x)) continue;
            Object use = x.get("use_test_id");
            boolean useOk = use == null || "".equals(use) || RequestContext.isUuid(use);
            if (!RequestContext.isUuid(x.get("qualification_test_id")) || !useOk) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("use_test_id", use == null || "".equals(use) ? null : use);
            item.put("qualification_test_id", x.get("qualification_test_id"));
            items.add(item);
        }
        return uow.run(reasonOr(ctx, "Sent for QA testing"), d -> {
            Object sample = d.one("SELECT send_lot_for_qa_testing(?::uuid, ?::jsonb) AS sample_id", id, toJson(items)).get("sample_id");
            return d.one("SELECT id AS sample_id, sample_code FROM sample WHERE id = ?::uuid", sample);
        });
    }

    /** QA waives a lot's QA testing (signed, with a reason; only before anything was sent for it). */
    public Map<String, Object> waiveQa(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        if (ctx.reason().trim().isEmpty()) throw new RuleException("Give the reason for waiving QA testing");
        signatures.signed(ctx, body, new Meaning("Approved by", lots.words(id, "QA testing waived"), "Inventory"), d -> d.one("SELECT waive_lot_qa_testing(?::uuid)", id));
        return Map.of("ok", true);
    }

    // ---------------------------------------------------------------- Supplier COAs
    /** Reads a COA before the item exists: the AI proposes values to fill the form; nothing is saved. */
    public Map<String, Object> readCoa(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        if (!truthy(body.get("content_base64"))) throw new RuleException("Choose the COA file first");
        if (!COA_TYPES.matcher(str(body.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("aiEnabled", ai.enabled());
        out.put("proposal", ai.enabled() ? ai.read(str(body.get("content_base64")), str(body.get("mime_type"))) : null);
        return out;
    }

    /** Uploads a COA to a lot (kept unchanged, with its SHA-256); the AI proposes values when it is switched on. */
    public Map<String, Object> uploadCoa(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        if (!truthy(body.get("content_base64"))) throw new RuleException("Choose the COA file to upload");
        if (!COA_TYPES.matcher(str(body.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        JsonNode proposal = null;
        String aiError = null;
        if (ai.enabled() && !Boolean.FALSE.equals(body.get("use_ai"))) {
            try { proposal = ai.read(str(body.get("content_base64")), str(body.get("mime_type"))); } catch (RuleException e) { aiError = e.getMessage(); }
        }
        final JsonNode p = proposal;
        Map<String, Object> coa = signatures.signed(reasonOr(ctx, "Supplier COA uploaded"), body,
            new Meaning("Uploaded by", lots.words(id, "Supplier COA " + str(body.get("file_name")) + " uploaded"), "Inventory"),
            d -> saveCoa(d, id, body, p, null));
        Map<String, Object> out = new LinkedHashMap<>(coa);
        out.put("proposal", proposal);
        out.put("aiError", aiError);
        out.put("aiEnabled", ai.enabled());
        return out;
    }

    private Map<String, Object> saveCoa(Db d, Object lotId, Map<String, Object> f, Object proposal, Object confirmed) {
        Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
            truthy(f.get("file_name")) ? f.get("file_name") : "coa", f.get("mime_type"), f.get("content_base64")).get("id");
        boolean proposed = proposal != null && !(proposal instanceof JsonNode n && n.isNull());
        return d.one("""
            INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, ai_model, ai_proposed, values_confirmed)
              VALUES (?::uuid, ?::uuid, '', '', ?, ?, ?::jsonb, ?::jsonb) RETURNING id, sha256""",
            lotId, doc, proposed ? "AI proposed, person confirmed" : "Manual", proposed ? ai.model() : null, proposed ? toJson(proposal) : null,
            confirmed == null ? null : toJson(confirmed));
    }

    /** A COA file; opened in a new tab, the lab comes in the link (?s=). */
    public Map<String, Object> coaFile(RequestContext ctx, String id, String linkSite) {
        Map<String, Object> d = db.one("""
            SELECT d.file_name, d.mime_type, encode(d.content, 'base64') AS b64, l.site_id FROM supplier_coa s
              JOIN document_file d ON d.id = s.document_id JOIN inventory_lot l ON l.id = s.lot_id WHERE s.id = ?::uuid""", id);
        if (d == null) throw new RuleException("COA not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    /** The values a person confirmed from the COA are written to the lot (signed "Verified by"). */
    public Map<String, Object> confirmCoa(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> s = db.one("SELECT lot_id FROM supplier_coa WHERE id = ?::uuid", id);
        if (s == null) throw new RuleException("COA not found");
        String lotId = (String) s.get("lot_id");
        lotSite(ctx, lotId);
        List<String> allowed = List.of("manufacturer_lot", "expiration_date", "retest_date", "purity_pct", "concentration", "concentration_unit", "catalog_number");
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(body.get("values")).entrySet())
            if (allowed.contains(e.getKey()) && e.getValue() != null && !"".equals(e.getValue())) values.put(e.getKey(), e.getValue());
        signatures.signed(reasonOr(ctx, "Values confirmed from the Supplier COA"), body,
            new Meaning("Verified by", lots.words(lotId, "Supplier COA values confirmed"), "Inventory"), d -> {
                if (!values.isEmpty()) new com.tentamus.lims.core.db.RecordWriter("inventory_lot", allowed).upsert(d, List.of(withId(values, lotId)), Map.of());
                d.update("UPDATE supplier_coa SET values_confirmed = ?::jsonb WHERE id = ?::uuid", toJson(values), id);
                return null;
            });
        return Map.of("ok", true);
    }

    // ---------------------------------------------------------------- helpers
    /** The request's Reason for Change, or the action's own words when none was given. */
    static RequestContext reasonOr(RequestContext ctx, String fallback) {
        return ctx.reason().isEmpty() ? ctx.withReason(fallback) : ctx;
    }

    private String toJson(Object o) {
        try { return json.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    static List<?> list(Object o) { return o instanceof List<?> l ? l : List.of(); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    /** JavaScript's "x || null". */
    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && (n.doubleValue() == 0 || Double.isNaN(n.doubleValue())));
    }

    private static Map<String, Object> withId(Map<String, Object> row, String id) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return r;
    }
}
