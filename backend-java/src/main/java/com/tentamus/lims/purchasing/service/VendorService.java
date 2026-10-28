package com.tentamus.lims.purchasing.service;

import static com.tentamus.lims.purchasing.service.PurchasingService.map;
import static com.tentamus.lims.purchasing.service.PurchasingService.or;
import static com.tentamus.lims.purchasing.service.PurchasingService.str;
import static com.tentamus.lims.purchasing.service.PurchasingService.truthy;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.purchasing.repo.PurchasingRepository;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Vendor approvals (V-1): suppliers and their approvals for this lab or every lab (corporate), the evidence documents,
 * proposals for corporate approval and Corporate QA's decisions, notices to the labs, the supply scopes and the risk
 * classes. The rules (who may approve at which level, scopes, a lab stricter never looser) are the database's.
 */
@Service
public class VendorService {
    private static final Pattern DOC_TYPES = Pattern.compile(
        "^(application/pdf|image/(png|jpeg|gif|webp)|text/plain|application/vnd\\.openxmlformats-officedocument\\.(spreadsheetml\\.sheet|wordprocessingml\\.document))$");
    private static final List<String> DOC_KINDS = List.of("Questionnaire", "Certificate", "Audit report", "Quality agreement", "Other");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final PurchasingService purchasing;
    private final PurchasingRepository repo;

    public VendorService(Db db, UnitOfWork uow, AccessPolicy access, PurchasingService purchasing, PurchasingRepository repo) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.purchasing = purchasing;
        this.repo = repo;
    }

    /** A record's own lab, or (corporate, no lab) the lab chosen in the header. */
    private void labOf(RequestContext ctx, Object site) {
        if (site != null) access.checkSite(ctx, (String) site); else access.currentSite(ctx);
    }

    // ---------------------------------------------------------------- suppliers
    public List<Map<String, Object>> suppliers(RequestContext ctx) { return repo.suppliers(access.currentSite(ctx)); }

    public Map<String, Object> supplier(RequestContext ctx, String id) {
        String site = access.currentSite(ctx);
        if (!RequestContext.isUuid(id)) throw new RuleException("Supplier not found");
        Map<String, Object> s = repo.supplier(id, site);
        if (s == null) throw new RuleException("Supplier not found");
        return s;
    }

    public Map<String, Object> vendors(RequestContext ctx) { return repo.vendors(access.currentSite(ctx)); }

    /** A vendor's evidence: files with their kind, title and certificate expiry. */
    private static void addDocs(Db d, Object docs, Object qualificationId, Object promotionId) {
        if (!(docs instanceof List<?> list)) return;
        for (Object o : list) {
            Map<String, Object> f = map(o);
            if (!truthy(f.get("content_base64"))) continue;
            if (!DOC_TYPES.matcher(str(f.get("mime_type"))).matches()) throw new RuleException("Attach a PDF, an image (PNG or JPEG), a text file, or an Excel or Word file");
            if (f.get("doc_kind") == null || !DOC_KINDS.contains(f.get("doc_kind")))
                throw new RuleException("Say what each document is (questionnaire, certificate, audit report, quality agreement or other)");
            Object file = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
                truthy(f.get("file_name")) ? f.get("file_name") : "document", f.get("mime_type"), f.get("content_base64")).get("id");
            d.update("INSERT INTO vendor_document (qualification_id, promotion_id, document_id, doc_kind, title, certificate_expires) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::date)",
                qualificationId, promotionId, file, f.get("doc_kind"), or(f.get("title")), or(f.get("certificate_expires")));
        }
    }

    /** The valid ids of a list sent, or null when the list holds none. */
    private static List<Object> uuids(Object v) {
        List<Object> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x);
        return out;
    }

    // ---------------------------------------------------------------- approvals
    public Map<String, Object> qualify(RequestContext ctx, String supplierId, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> s = db.one("SELECT id, supplier_name FROM supplier WHERE id = ?::uuid", supplierId);
        if (s == null) throw new RuleException("Supplier not found");
        Map<String, Object> v = map(body.get("row"));
        boolean corporate = "corporate".equals(v.get("level"));
        List<Object> scopes = truthy(v.get("all_scopes")) ? null : uuids(v.get("scope_ids"));
        boolean approved = "Approved".equals(v.get("approval_status"));
        if (approved && scopes != null && scopes.isEmpty()) throw new RuleException("Tick what the vendor is approved for, or \"Every scope\"");
        String meaning = switch (str(v.get("approval_status"))) {
            case "Suspended" -> "Suspended by";
            case "Not Approved" -> "Rejected by";
            default -> "Approved by";
        };
        String action = "Vendor approval of " + s.get("supplier_name") + ": " + str(or(v.get("approval_status"))) + " (" + (corporate ? "corporate, every lab" : "this lab") + ")";
        return purchasing.sign(ctx, body, meaning, action, d -> {
            Map<String, Object> q = d.one("""
                INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, accreditations, approval_date, expiration_date, justification, scope_ids)
                  VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, COALESCE(?::date, site_today(?::uuid)), ?::date, ?, ?::uuid[]) RETURNING id, qualification_code, expiration_date""",
                s.get("id"), corporate ? null : site, or(v.get("risk_class_id")), or(v.get("approval_status")), or(v.get("accreditations")), or(v.get("approval_date")),
                site, or(v.get("expiration_date")), or(v.get("justification")), approved ? scopes : null);
            addDocs(d, body.get("documents"), q.get("id"), null);
            return q;
        });
    }

    public Map<String, Object> withdrawQualification(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> q = db.one("SELECT q.id, q.qualification_code, q.site_id, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = ?::uuid", id);
        if (q == null) throw new RuleException("Qualification not found");
        labOf(ctx, q.get("site_id"));
        return purchasing.sign(ctx, body, "Withdrawn by", "Withdraw qualification " + q.get("qualification_code") + " of " + q.get("supplier_name"),
            d -> d.raw("UPDATE vendor_qualification SET status = 'Inactive' WHERE id = ?::uuid", q.get("id")));
    }

    /** Documents added later to an approval. */
    public Map<String, Object> addDocuments(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Approval not found");
        Map<String, Object> q = db.one("SELECT id, site_id, qualification_code FROM vendor_qualification WHERE id = ?::uuid", id);
        if (q == null) throw new RuleException("Approval not found");
        labOf(ctx, q.get("site_id"));
        if (!(body.get("documents") instanceof List<?> l) || l.isEmpty()) throw new RuleException("Choose a file to attach");
        String reason = truthy(body.get("reason")) ? str(body.get("reason")) : "Document attached to " + q.get("qualification_code");
        return uow.run(ctx, reason, d -> { addDocs(d, body.get("documents"), q.get("id"), null); return Map.of("ok", true); });
    }

    public Map<String, Object> withdrawDocument(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Document not found");
        Map<String, Object> d = db.one("""
            SELECT d.id, COALESCE(q.site_id, p.site_id) AS site_id FROM vendor_document d LEFT JOIN vendor_qualification q ON q.id = d.qualification_id
              LEFT JOIN vendor_promotion p ON p.id = d.promotion_id WHERE d.id = ?::uuid""", id);
        if (d == null) throw new RuleException("Document not found");
        labOf(ctx, d.get("site_id"));
        return uow.run(ctx, d2 -> { d2.update("UPDATE vendor_document SET status = 'Inactive' WHERE id = ?::uuid", d.get("id")); return Map.of("ok", true); });
    }

    /** linkSite: opened in a new tab, the lab comes in the link (?s=). */
    public Map<String, Object> documentFile(RequestContext ctx, String id, String linkSite) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Document not found");
        Map<String, Object> d = repo.documentFile(id);
        if (d == null) throw new RuleException("Document not found");
        RequestContext c = linkSite == null || linkSite.isEmpty() ? ctx
            : new RequestContext(ctx.userId(), RequestContext.isUuid(linkSite) ? linkSite : null, linkSite, ctx.reason(), ctx.ip());
        labOf(c, d.get("site_id"));
        return d;
    }

    // ---------------------------------------------------------------- corporate approval
    public Map<String, Object> propose(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Approval not found");
        Map<String, Object> q = db.one("SELECT q.id, q.site_id, q.qualification_code, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = ?::uuid", id);
        if (q == null || q.get("site_id") == null) throw new RuleException("Propose one of this lab's approvals");
        access.checkSite(ctx, (String) q.get("site_id"));
        List<Object> scopes = uuids(body.get("scope_ids"));
        return purchasing.sign(ctx, body, "Proposed by", "Propose " + q.get("supplier_name") + " (" + q.get("qualification_code") + ") for corporate approval", d -> {
            Object p = d.one("SELECT propose_vendor_promotion(?::uuid, ?::uuid, ?::uuid[], ?) AS id", q.get("id"), or(body.get("risk_class_id")),
                scopes.isEmpty() ? null : scopes, or(body.get("note"))).get("id");
            return d.one("SELECT id, promotion_code FROM vendor_promotion WHERE id = ?::uuid", p);
        });
    }

    public Map<String, Object> decide(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Proposal not found");
        Map<String, Object> p = db.one("SELECT p.id, p.promotion_code, s.supplier_name FROM vendor_promotion p JOIN supplier s ON s.id = p.supplier_id WHERE p.id = ?::uuid", id);
        if (p == null) throw new RuleException("Proposal not found");
        access.currentSite(ctx);
        boolean approve = "Approved".equals(body.get("decision"));
        List<Object> scopes = uuids(body.get("scope_ids"));
        return purchasing.sign(ctx, body, approve ? "Approved by" : "Rejected by",
            (approve ? "Approve " : "Reject ") + p.get("promotion_code") + ": " + p.get("supplier_name") + " for every lab",
            d -> d.one("SELECT decide_vendor_promotion(?::uuid, ?, ?, ?::uuid, ?::uuid[]) AS id", p.get("id"), approve ? "Approved" : "Rejected", or(body.get("note")),
                or(body.get("risk_class_id")), scopes.isEmpty() ? null : scopes));
    }

    public Map<String, Object> withdrawPromotion(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Proposal not found");
        Map<String, Object> p = db.one("SELECT id, site_id FROM vendor_promotion WHERE id = ?::uuid", id);
        if (p == null) throw new RuleException("Proposal not found");
        access.checkSite(ctx, (String) p.get("site_id"));
        return uow.run(ctx, d -> { d.one("SELECT withdraw_vendor_promotion(?::uuid)", p.get("id")); return Map.of("ok", true); });
    }

    public Map<String, Object> acknowledge(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Object> ids = uuids(body.get("ids"));
        if (ids.isEmpty()) throw new RuleException("Tick the notices you have read");
        return uow.run(ctx, "Notice acknowledged", d -> d.one(
            "SELECT acknowledge_vendor_notices(ARRAY(SELECT id FROM vendor_notice WHERE id = ANY (?::uuid[]) AND site_id = ?::uuid)) AS n", ids, site));
    }

    // ---------------------------------------------------------------- supply scopes and risk classes
    public List<Map<String, Object>> scopes(RequestContext ctx) {
        access.currentSite(ctx);
        return repo.scopes();
    }

    public List<Map<String, Object>> saveScopes(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> x : rows(body)) {
            Map<String, Object> o = new LinkedHashMap<>(x);
            for (String k : List.of("chemical_types", "line_types")) if (o.containsKey(k)) o.put(k, arrayText(o.get(k)));
            if (o.containsKey("default_for") && !truthy(o.get("default_for"))) o.put("default_for", null);
            rows.add(o);
        }
        return purchasing.sign(ctx, body, "Changed by", "Supply scopes: " + rows.size() + " change(s)", d -> PurchasingRepository.SCOPES.upsert(d, rows, Map.of()));
    }

    /** A list of enum values as PostgreSQL array text: from a list or "a, b" text, quotes removed. */
    static String arrayText(Object v) {
        List<?> items = v instanceof List<?> l ? l : Arrays.asList((truthy(v) ? Js.string(v) : "").split(",", -1));
        return "{" + items.stream().map(x -> Js.string(x).trim()).filter(x -> !x.isEmpty()).map(x -> "\"" + x.replace("\"", "") + "\"").collect(Collectors.joining(",")) + "}";
    }

    public List<Map<String, Object>> riskClasses(RequestContext ctx) { return repo.riskClasses(access.currentSite(ctx)); }

    public List<Map<String, Object>> saveRiskClasses(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = rows(body);
        return purchasing.sign(ctx, body, "Changed by", "Supplier risk classes: " + rows.size() + " change(s)", d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                boolean shared = truthy(row.get("id"))
                    ? Boolean.TRUE.equals(d.one("SELECT site_id IS NULL AS s FROM supplier_risk_class WHERE id = ?::uuid", row.get("id")).get("s"))
                    : truthy(row.get("shared"));
                out.addAll(PurchasingRepository.RISK_CLASSES.upsert(d, List.of(row), shared ? Map.of() : Map.of("site_id", site)));
            }
            return out;
        });
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
