package com.tentamus.lims.purchasing.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.purchasing.domain.RiskClass;
import com.tentamus.lims.purchasing.domain.ScopeList;
import com.tentamus.lims.purchasing.domain.SupplyScope;
import com.tentamus.lims.purchasing.domain.VendorPromotion;
import com.tentamus.lims.purchasing.domain.VendorQualification;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Loads and writes vendor approvals, risk classes, supply scopes, proposals, documents and notices. */
@Repository
public class VendorRepository {

    public ScopeList scopes(Db d) {
        return new ScopeList(d.rows("""
            SELECT id, scope_name, sort_order, status, chemical_types::text[] AS chemical_types, line_types::text[] AS line_types, default_for::text AS default_for
              FROM supply_scope ORDER BY sort_order, scope_name""").stream().map(SupplyScope::of).toList());
    }

    public Map<String, Object> scopeRow(Db d, Object id) {
        return d.one("""
            SELECT id, scope_name, status, chemical_types::text[] AS chemical_types, line_types::text[] AS line_types, default_for::text AS default_for
              FROM supply_scope WHERE id = ?::uuid""", id);
    }

    public RiskClass riskClass(Db d, Object id) { return id == null ? null : RiskClass.of(d.one("SELECT * FROM supplier_risk_class WHERE id = ?::uuid", id)); }

    public VendorQualification qualification(Db d, Object id) {
        return VendorQualification.of(d.one("SELECT * FROM vendor_qualification WHERE id = ?::uuid", id));
    }

    /** The vendor's latest active corporate decision. */
    public VendorQualification corporate(Db d, String supplier) {
        return VendorQualification.of(d.one("""
            SELECT * FROM vendor_qualification WHERE supplier_id = ?::uuid AND site_id IS NULL AND status = 'Active' ORDER BY approval_date DESC, created_at DESC LIMIT 1""", supplier));
    }

    /** The lab's latest active decision on the vendor. */
    public VendorQualification local(Db d, String supplier, String site) {
        return VendorQualification.of(d.one("""
            SELECT * FROM vendor_qualification WHERE supplier_id = ?::uuid AND site_id = ?::uuid AND status = 'Active' ORDER BY approval_date DESC, created_at DESC LIMIT 1""",
            supplier, site));
    }

    public String supplierName(Db d, Object supplier) {
        Map<String, Object> s = d.one("SELECT supplier_name FROM supplier WHERE id = ?::uuid", supplier);
        return s == null ? null : (String) s.get("supplier_name");
    }

    public Map<String, Object> insertQualification(Db d, VendorQualification.Request a, String riskClass, Object accreditations, Object justification,
                                                   VendorQualification.Settled s, String promotedFrom, String promotion) {
        return d.one("""
            INSERT INTO vendor_qualification (supplier_id, site_id, risk_class_id, approval_status, accreditations, approval_date, expiration_date, justification,
                                              scope_ids, promoted_from_id, promotion_id, signature_id)
              VALUES (?::uuid, ?::uuid, ?::uuid, ?::vendor_approval_status, ?, ?::date, ?::date, ?, ?::uuid[], ?::uuid, ?::uuid,
                      NULLIF(current_setting('lims.signature_id', true), '')::uuid)
              RETURNING id, qualification_code, expiration_date""",
            a.supplierId(), a.siteId(), riskClass, a.approvalStatus(), accreditations, a.approvalDate().toString(), date(s.expires()), justification,
            s.scopeIds(), promotedFrom, promotion);
    }

    /** Every lab, with how many of its open requests from the vendor a corporate block stops. */
    public List<Map<String, Object>> labsWithOpenRequests(Db d, String supplier) {
        return d.rows("""
            SELECT s.id, (SELECT count(*) FROM purchase_line l WHERE l.supplier_id = ?::uuid AND l.site_id = s.id
                            AND l.status IN ('Requested','Awaiting second approval','Approved','Ordered','Partly received')) AS n FROM lab_site s""", supplier);
    }

    public void insertNotice(Db d, Object site, String supplier, Object qualification, Object promotion, String notice) {
        d.update("INSERT INTO vendor_notice (site_id, supplier_id, qualification_id, promotion_id, notice) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?)",
            site, supplier, qualification, promotion, notice);
    }

    public List<Map<String, Object>> unreadNotices(Db d, List<Object> ids, String site) {
        return d.rows("SELECT id, acknowledged_at FROM vendor_notice WHERE id = ANY (?::uuid[]) AND site_id = ?::uuid FOR UPDATE", ids, site);
    }

    public void acknowledge(Db d, Object id, String me) {
        d.update("UPDATE vendor_notice SET acknowledged_by = ?::uuid, acknowledged_at = clock_timestamp() WHERE id = ?::uuid", me, id);
    }

    // ---------------------------------------------------------------- proposals
    public VendorPromotion promotion(Db d, Object id) { return VendorPromotion.of(d.one("SELECT * FROM vendor_promotion WHERE id = ?::uuid FOR UPDATE", id)); }

    public String openPromotionCode(Db d, String supplier) {
        Map<String, Object> p = d.one("SELECT promotion_code FROM vendor_promotion WHERE supplier_id = ?::uuid AND status = 'Proposed'", supplier);
        return p == null ? null : (String) p.get("promotion_code");
    }

    public boolean hasActiveDocument(Db d, String qualification) {
        return d.one("SELECT 1 FROM vendor_document WHERE qualification_id = ?::uuid AND status = 'Active' LIMIT 1", qualification) != null;
    }

    public String insertPromotion(Db d, VendorQualification q, String riskClass, List<String> scopes, Object note) {
        return (String) d.one("""
            INSERT INTO vendor_promotion (supplier_id, site_id, from_qualification_id, risk_class_id, scope_ids, note, proposal_signature_id)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?::uuid[], NULLIF(btrim(?), ''), NULLIF(current_setting('lims.signature_id', true), '')::uuid) RETURNING id""",
            q.supplierId(), q.siteId(), q.id(), riskClass, scopes, note).get("id");
    }

    public void closePromotion(Db d, String id, String status, String me, Object note, String corporateQualification, boolean signed) {
        d.update("""
            UPDATE vendor_promotion SET status = ?, decided_by = ?::uuid, decided_at = clock_timestamp(), decision_note = NULLIF(btrim(?), ''),
                   decision_signature_id = CASE WHEN ? THEN NULLIF(current_setting('lims.signature_id', true), '')::uuid END, corporate_qualification_id = ?::uuid
             WHERE id = ?::uuid""", status, me, note, signed, corporateQualification, id);
    }

    /** The lab's documents (on its approval or the proposal) carried to the corporate approval. */
    public void copyDocuments(Db d, String toQualification, String fromQualification, String promotion) {
        d.update("""
            INSERT INTO vendor_document (qualification_id, document_id, doc_kind, title, certificate_expires)
            SELECT ?::uuid, document_id, doc_kind, title, certificate_expires FROM vendor_document
             WHERE status = 'Active' AND (qualification_id = ?::uuid OR promotion_id = ?::uuid)""", toQualification, fromQualification, promotion);
    }

    public String siteCode(Db d, String site) { return (String) d.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", site).get("site_code"); }

    /** The status of the proposal a document would join (null when it joins an approval). */
    public String proposalStatus(Db d, Object promotion) {
        if (promotion == null) return null;
        Map<String, Object> p = d.one("SELECT status FROM vendor_promotion WHERE id = ?::uuid", promotion);
        return p == null ? null : (String) p.get("status");
    }

    private static String date(LocalDate v) { return v == null ? null : v.toString(); }
}
