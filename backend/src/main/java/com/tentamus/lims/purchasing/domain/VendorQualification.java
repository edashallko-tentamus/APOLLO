package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * One vendor approval decision (VQ-00001): for one lab (local) or every lab (corporate), Approved, Suspended or Not
 * Approved, with its risk class, expiry and the scopes it covers (null = every scope). Never changed once recorded:
 * the only change Java makes is withdrawing it (status Inactive).
 * Replaces the rule part of vendor_qualification_rules and the date check (migration 065).
 */
public record VendorQualification(String id, String code, String supplierId, String siteId, String approvalStatus, LocalDate approvalDate,
                                  LocalDate expires, List<String> scopeIds, String status, String accreditations) {

    public static VendorQualification of(Map<String, Object> r) {
        if (r == null) return null;
        return new VendorQualification(Val.str(r.get("id")), Val.str(r.get("qualification_code")), Val.str(r.get("supplier_id")), Val.str(r.get("site_id")),
            Val.str(r.get("approval_status")), Val.date(r.get("approval_date")), Val.date(r.get("expiration_date")), Val.list(r.get("scope_ids")),
            r.get("status") == null ? "Active" : r.get("status").toString(), Val.str(r.get("accreditations")));
    }

    public boolean corporate() { return siteId == null; }

    public boolean approved() { return "Approved".equals(approvalStatus); }

    /** Not expired on the lab's day. */
    public boolean current(LocalDate today) { return expires == null || !expires.isBefore(today); }

    /** A new approval as asked for. scopeIds: null = every scope. */
    public record Request(String supplierId, String siteId, String approvalStatus, LocalDate approvalDate, LocalDate expires, List<String> scopeIds) {}

    /** What is written for a new approval: its scopes and expiry as the rules settle them. */
    public record Settled(List<String> scopeIds, LocalDate expires) {}

    /**
     * Checks a new approval and settles its scopes and expiry. corporate: the vendor's corporate decision (null if none),
     * for "stricter, never looser"; today: the lab's day (for a corporate approval, the lab being worked in).
     */
    public static Settled settle(Request a, RiskClass rc, ScopeList scopes, LocalDate today, VendorQualification corporate, String supplierName) {
        rc.assertUsableFor(a.siteId());
        boolean approved = "Approved".equals(a.approvalStatus());
        List<String> ids = approved ? scopes.forApproval(a.scopeIds()) : null;   // a suspension or rejection is for the whole vendor
        LocalDate expires = a.expires() == null && approved ? a.approvalDate().plusMonths(rc.requalMonths()) : a.expires();
        if (a.approvalDate().isAfter(today.plusDays(1))) throw RuleException.database("The approval date cannot be in the future");
        if (expires != null && expires.isBefore(a.approvalDate())) throw RuleException.withCode("The expiry cannot be before the approval date.", "23514");
        if (a.siteId() != null && approved && corporate != null && !corporate.approved())
            throw RuleException.database("Corporate QA has " + ("Suspended".equals(corporate.approvalStatus()) ? "suspended" : "rejected") + " " + supplierName
                + " for every lab (" + corporate.code() + "): a lab cannot approve it");
        return new Settled(ids, expires);
    }

    /** Only the record status changes after an approval is recorded (withdrawn as entered in error). */
    public static void assertOnlyStatusChanges(java.util.Collection<String> changedColumns) {
        if (changedColumns.stream().anyMatch(c -> !List.of("status", "record_version", "modified_at", "modified_by").contains(c)))
            throw RuleException.database("A qualification cannot be changed; record a new qualification (or withdraw this one as entered in error)");
    }
}
