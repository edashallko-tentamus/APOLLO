package com.tentamus.lims.purchasing.service;

import static com.tentamus.lims.purchasing.service.PurchasingService.map;
import static com.tentamus.lims.purchasing.service.PurchasingService.or;
import static com.tentamus.lims.purchasing.service.PurchasingService.str;
import static com.tentamus.lims.purchasing.service.PurchasingService.truthy;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.Answers;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.purchasing.domain.RiskClass;
import com.tentamus.lims.purchasing.domain.ScopeList;
import com.tentamus.lims.purchasing.domain.SupplyScope;
import com.tentamus.lims.purchasing.domain.VendorDocument;
import com.tentamus.lims.purchasing.domain.VendorNotice;
import com.tentamus.lims.purchasing.domain.VendorPromotion;
import com.tentamus.lims.purchasing.domain.VendorQualification;
import com.tentamus.lims.purchasing.repo.DatabaseChecks;
import com.tentamus.lims.purchasing.repo.PurchasingRepository;
import com.tentamus.lims.purchasing.repo.VendorRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

/**
 * Vendor approvals (V-1): suppliers and their approvals for this lab or every lab (corporate), the evidence documents,
 * proposals for corporate approval and Corporate QA's decisions, notices to the labs, the supply scopes and the risk
 * classes. The rules are the domain's ({@link VendorQualification}, {@link VendorPromotion}, {@link SupplyScope},
 * {@link RiskClass}, {@link VendorDocument}, {@link VendorNotice}); who may do it stays the database's (migration 065).
 */
@Service
public class VendorService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final PurchasingService purchasing;
    private final PurchasingRepository repo;
    private final VendorRepository vendors;
    private final DatabaseChecks checks;
    private final LabClock clock;

    public VendorService(Db db, UnitOfWork uow, AccessPolicy access, PurchasingService purchasing, PurchasingRepository repo, VendorRepository vendors,
                         DatabaseChecks checks, LabClock clock) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.purchasing = purchasing;
        this.repo = repo;
        this.vendors = vendors;
        this.checks = checks;
        this.clock = clock;
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
    private void addDocs(Db d, Object docs, Object qualificationId, Object promotionId) {
        if (!(docs instanceof List<?> list)) return;
        for (Object o : list) {
            Map<String, Object> f = map(o);
            if (!truthy(f.get("content_base64"))) continue;
            VendorDocument.checkFile(str(f.get("mime_type")), f.get("doc_kind"));
            VendorDocument.assertCanAttach(vendors.proposalStatus(d, promotionId));
            Object file = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
                truthy(f.get("file_name")) ? f.get("file_name") : "document", f.get("mime_type"), f.get("content_base64")).get("id");
            d.update("INSERT INTO vendor_document (qualification_id, promotion_id, document_id, doc_kind, title, certificate_expires) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::date)",
                qualificationId, promotionId, file, f.get("doc_kind"), or(f.get("title")), or(f.get("certificate_expires")));
        }
    }

    /** The valid ids of a list sent (none: an empty list). */
    private static List<String> uuids(Object v) {
        List<String> out = new ArrayList<>();
        if (v instanceof List<?> l) for (Object x : l) if (RequestContext.isUuid(x)) out.add(x.toString());
        return out;
    }

    // ---------------------------------------------------------------- approvals
    public Map<String, Object> qualify(RequestContext ctx, String supplierId, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> s = db.one("SELECT id, supplier_name FROM supplier WHERE id = ?::uuid", supplierId);
        if (s == null) throw new RuleException("Supplier not found");
        Map<String, Object> v = map(body.get("row"));
        boolean corporate = "corporate".equals(v.get("level"));
        List<String> scopes = truthy(v.get("all_scopes")) ? null : uuids(v.get("scope_ids"));
        boolean approved = "Approved".equals(v.get("approval_status"));
        if (approved && scopes != null && scopes.isEmpty()) throw new RuleException("Tick what the vendor is approved for, or \"Every scope\"");
        String meaning = switch (str(v.get("approval_status"))) {
            case "Suspended" -> "Suspended by";
            case "Not Approved" -> "Rejected by";
            default -> "Approved by";
        };
        String name = (String) s.get("supplier_name");
        String action = "Vendor approval of " + name + ": " + str(or(v.get("approval_status"))) + " (" + (corporate ? "corporate, every lab" : "this lab") + ")";
        return purchasing.sign(ctx, body, meaning, action, d -> {
            RiskClass rc = vendors.riskClass(d, or(v.get("risk_class_id")));
            if (rc == null) throw RuleException.withCode("Choose the risk class.", "23502");
            LocalDate today = clock.today(site);
            VendorQualification.Request req = new VendorQualification.Request((String) s.get("id"), corporate ? null : site, (String) or(v.get("approval_status")),
                truthy(v.get("approval_date")) ? LocalDate.parse(str(v.get("approval_date"))) : today,
                truthy(v.get("expiration_date")) ? LocalDate.parse(str(v.get("expiration_date"))) : null, approved ? scopes : null);
            VendorQualification.Settled settled = VendorQualification.settle(req, rc, vendors.scopes(d), today, vendors.corporate(d, req.supplierId()), name);
            Map<String, Object> q = vendors.insertQualification(d, req, rc.id(), or(v.get("accreditations")), or(v.get("justification")), settled, null, null);
            addDocs(d, body.get("documents"), q.get("id"), null);
            VendorQualification made = vendors.qualification(d, q.get("id"));
            if (VendorNotice.tellsLabs(made))
                for (Map<String, Object> lab : vendors.labsWithOpenRequests(d, made.supplierId()))
                    vendors.insertNotice(d, lab.get("id"), made.supplierId(), made.id(), null,
                        VendorNotice.corporateBlock(made, name, str(v.get("justification")), ((Number) lab.get("n")).longValue()));
            return q;
        });
    }

    public Map<String, Object> withdrawQualification(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> q = db.one("SELECT q.id, q.qualification_code, q.site_id, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = ?::uuid", id);
        if (q == null) throw new RuleException("Qualification not found");
        labOf(ctx, q.get("site_id"));
        Map<String, Object> change = Map.of("status", "Inactive");
        VendorQualification.assertOnlyStatusChanges(change.keySet());
        return purchasing.sign(ctx, body, "Withdrawn by", "Withdraw qualification " + q.get("qualification_code") + " of " + q.get("supplier_name"),
            d -> d.raw("UPDATE vendor_qualification SET status = ?::record_status WHERE id = ?::uuid", change.get("status"), q.get("id")));
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
        VendorDocument.assertWithdrawReason(ctx.reason());
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
        Map<String, Object> q0 = db.one("SELECT q.id, q.site_id, q.qualification_code, s.supplier_name FROM vendor_qualification q JOIN supplier s ON s.id = q.supplier_id WHERE q.id = ?::uuid", id);
        if (q0 == null || q0.get("site_id") == null) throw new RuleException("Propose one of this lab's approvals");
        access.checkSite(ctx, (String) q0.get("site_id"));
        List<String> asked = uuids(body.get("scope_ids"));
        return purchasing.sign(ctx, body, "Proposed by", "Propose " + q0.get("supplier_name") + " (" + q0.get("qualification_code") + ") for corporate approval", d -> {
            VendorQualification q = vendors.qualification(d, q0.get("id"));
            VendorPromotion.assertProposable(q);
            checks.requirePermission(d, "purchasing.qualify", q.siteId());
            checks.assertSigned(d, "propose a vendor for corporate approval");
            RiskClass rc = vendors.riskClass(d, or(body.get("risk_class_id")));
            List<String> scopes = VendorPromotion.propose(q, clock.today(q.siteId()), vendors.local(d, q.supplierId(), q.siteId()), vendors.corporate(d, q.supplierId()),
                rc, asked.isEmpty() ? null : asked, vendors.hasActiveDocument(d, q.id()),
                vendors.openPromotionCode(d, q.supplierId()), vendors.scopes(d));
            String p = vendors.insertPromotion(d, q, rc.id(), scopes, or(body.get("note")));
            return d.one("SELECT id, promotion_code FROM vendor_promotion WHERE id = ?::uuid", p);
        });
    }

    public Map<String, Object> decide(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Proposal not found");
        Map<String, Object> p0 = db.one("SELECT p.id, p.promotion_code, s.supplier_name FROM vendor_promotion p JOIN supplier s ON s.id = p.supplier_id WHERE p.id = ?::uuid", id);
        if (p0 == null) throw new RuleException("Proposal not found");
        access.currentSite(ctx);
        boolean approve = "Approved".equals(body.get("decision"));
        List<String> asked = uuids(body.get("scope_ids"));
        String name = (String) p0.get("supplier_name");
        return purchasing.sign(ctx, body, approve ? "Approved by" : "Rejected by",
            (approve ? "Approve " : "Reject ") + p0.get("promotion_code") + ": " + name + " for every lab", d -> {
                VendorPromotion p = vendors.promotion(d, p0.get("id"));
                if (!checks.corporate(d)) throw RuleException.database("Only Corporate QA (purchasing.qualify_corporate) decides proposals for corporate approval");
                checks.assertSigned(d, approve ? "approve a vendor for every lab" : "reject a proposal for corporate approval");
                VendorQualification from = vendors.qualification(d, p.fromQualificationId());
                ScopeList scopes = vendors.scopes(d);
                Object note = or(body.get("note"));
                VendorPromotion.Decision dec = p.decide(ctx.userId(), approve ? "Approved" : "Rejected", str(note), (String) or(body.get("risk_class_id")),
                    asked.isEmpty() ? null : asked, from, scopes);
                String made = null;
                if (approve) {
                    LocalDate today = clock.today(p.siteId());
                    VendorQualification.Request req = new VendorQualification.Request(p.supplierId(), null, "Approved", today, null, dec.scopeIds());
                    RiskClass rc = vendors.riskClass(d, dec.riskClassId());
                    VendorQualification.Settled settled = VendorQualification.settle(req, rc, scopes, today, null, name);
                    made = (String) vendors.insertQualification(d, req, rc.id(), from.accreditations(),
                        p.justification(vendors.siteCode(d, p.siteId()), from.code(), str(note)), settled, from.id(), p.id()).get("id");
                    vendors.copyDocuments(d, made, from.id(), p.id());
                }
                vendors.closePromotion(d, p.id(), dec.decision(), ctx.userId(), note, made, true);
                vendors.insertNotice(d, p.siteId(), p.supplierId(), made, p.id(), p.notice(dec, name, scopes.names(dec.scopeIds()), str(note)));
                return Answers.map("id", made != null ? made : p.id());
            });
    }

    public Map<String, Object> withdrawPromotion(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Proposal not found");
        Map<String, Object> p0 = db.one("SELECT id, site_id FROM vendor_promotion WHERE id = ?::uuid", id);
        if (p0 == null) throw new RuleException("Proposal not found");
        access.checkSite(ctx, (String) p0.get("site_id"));
        return uow.run(ctx, d -> {
            VendorPromotion p = vendors.promotion(d, p0.get("id"));
            checks.requirePermission(d, "purchasing.qualify", p.siteId());
            p.withdraw(ctx.reason());
            vendors.closePromotion(d, p.id(), "Withdrawn", ctx.userId(), ctx.reason(), null, false);
            return Map.of("ok", true);
        });
    }

    public Map<String, Object> acknowledge(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        List<Object> ids = new ArrayList<>(uuids(body.get("ids")));
        if (ids.isEmpty()) throw new RuleException("Tick the notices you have read");
        return uow.run(ctx, "Notice acknowledged", d -> {
            int n = 0;
            for (Map<String, Object> notice : vendors.unreadNotices(d, ids, site))
                if (VendorNotice.unread(notice.get("acknowledged_at"))) { vendors.acknowledge(d, notice.get("id"), ctx.userId()); n++; }
            return Answers.map("n", n);
        });
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
        return purchasing.sign(ctx, body, "Changed by", "Supply scopes: " + rows.size() + " change(s)", d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Object id = row.get("id");
                Map<String, Object> changes = PurchasingRepository.SCOPES.pick(row);
                if (id != null && changes.isEmpty()) continue;
                Map<String, Object> merged = new LinkedHashMap<>(id == null ? Map.of() : vendors.scopeRow(d, id));
                merged.putAll(changes);
                Map<String, Object> checked = new LinkedHashMap<>(row);
                checked.putAll(SupplyScope.check(id == null ? null : id.toString(), merged, changes, vendors.scopes(d).all()));
                out.addAll(PurchasingRepository.SCOPES.upsert(d, List.of(checked), Map.of()));
            }
            return out;
        });
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
                RiskClass before = truthy(row.get("id")) ? vendors.riskClass(d, row.get("id")) : null;
                boolean shared = before != null ? before.shared() : truthy(row.get("shared"));
                Map<String, Object> changes = PurchasingRepository.RISK_CLASSES.pick(row);
                if (before != null && changes.isEmpty()) continue;
                Map<String, Object> merged = new LinkedHashMap<>();
                if (before != null) { merged.put("class_name", before.name()); merged.put("requal_months", before.requalMonths()); }
                merged.putAll(changes);
                merged.put("site_id", before != null ? before.siteId() : shared ? null : site);
                RiskClass.check(before, merged);
                out.addAll(PurchasingRepository.RISK_CLASSES.upsert(d, List.of(row), shared ? Map.of() : Map.of("site_id", site)));
            }
            return out;
        });
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
