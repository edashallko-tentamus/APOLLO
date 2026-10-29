package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A lab's proposal to make its own approval of a vendor a corporate one (VP-00001): Proposed, then Approved or
 * Rejected by Corporate QA (never the proposer), or Withdrawn by the lab. Stays with its vendor, lab and approval.
 * Replaces vendor_promotion_rules and the functions propose_vendor_promotion, withdraw_vendor_promotion and
 * decide_vendor_promotion (migration 065).
 */
public record VendorPromotion(String id, String code, String supplierId, String siteId, String fromQualificationId, String riskClassId,
                              List<String> scopeIds, String status, String createdBy) {

    public static VendorPromotion of(Map<String, Object> r) {
        if (r == null) return null;
        return new VendorPromotion(Val.str(r.get("id")), Val.str(r.get("promotion_code")), Val.str(r.get("supplier_id")), Val.str(r.get("site_id")),
            Val.str(r.get("from_qualification_id")), Val.str(r.get("risk_class_id")), Val.list(r.get("scope_ids")), Val.str(r.get("status")), Val.str(r.get("created_by")));
    }

    /** The approval about to be proposed is the lab's own, current, latest decision. Checked before the signature. */
    public static void assertProposable(VendorQualification q) {
        if (q == null || !"Active".equals(q.status())) throw RuleException.database("Approval not found");
        if (q.corporate()) throw RuleException.database(q.code() + " is already a corporate approval");
    }

    /**
     * Checks a proposal and returns the scopes it asks for (null = every scope). asked: null when nothing was named (then
     * what the lab approved); openCode: the vendor's proposal already waiting, if any.
     */
    public static List<String> propose(VendorQualification q, LocalDate today, VendorQualification latestLocal, VendorQualification corporate,
                                       RiskClass rc, List<String> asked, boolean hasDocument, String openCode, ScopeList scopes) {
        if (!q.approved() || !q.current(today)) throw RuleException.database("Only a current approval of this lab can be proposed for corporate approval");
        if (latestLocal == null || !Objects.equals(latestLocal.id(), q.id())) throw RuleException.database("Propose the lab's latest decision on this vendor");
        if (corporate != null && !corporate.approved())
            throw RuleException.database("Corporate QA has " + ("Suspended".equals(corporate.approvalStatus()) ? "suspended" : "rejected") + " this vendor ("
                + corporate.code() + "): it cannot be proposed");
        if (rc == null || !rc.active() || !rc.shared()) throw RuleException.database("Choose one of the shared risk classes: a corporate approval uses those");
        if (asked != null && asked.isEmpty()) throw RuleException.database("Name what the vendor should be approved for");
        List<String> want = asked != null ? asked : q.scopeIds();
        if (!withinLab(q, want)) throw RuleException.database("Propose only what this lab approved the vendor for (" + scopes.names(q.scopeIds()) + ")");
        if (!hasDocument)
            throw RuleException.database("Attach at least one document to the approval first (a questionnaire, a certificate or an audit report): Corporate QA decides on the evidence");
        if (openCode != null) throw RuleException.database("This vendor is already waiting for corporate approval (" + openCode + ")");
        return want;
    }

    private static boolean withinLab(VendorQualification q, List<String> want) {
        return ScopeList.covers(q.scopeIds(), want) && !(want == null && q.scopeIds() != null);
    }

    /** The lab withdraws it, with a reason. */
    public void withdraw(String reason) {
        assertOpen();
        if (Val.blank(reason)) throw RuleException.database("Give the reason for withdrawing the proposal");
    }

    private void assertOpen() {
        if (!"Proposed".equals(status)) throw RuleException.database("Proposal " + code + " is already " + Val.lower(status));
    }

    /** Corporate QA's decision: the risk class and scopes a corporate approval gets (null scopes = every scope). */
    public record Decision(String decision, String riskClassId, List<String> scopeIds) {}

    public Decision decide(String me, String decision, String note, String riskClassId, List<String> scopesAsked, VendorQualification from, ScopeList scopes) {
        assertOpen();
        if (Objects.equals(createdBy, me)) throw RuleException.database("You proposed " + code + ": someone else in Corporate QA decides it");
        if (!List.of("Approved", "Rejected").contains(decision)) throw RuleException.database("Approve or reject the proposal");
        if ("Rejected".equals(decision)) {
            if (Val.blank(note)) throw RuleException.database("Say why the proposal is rejected (the lab sees it)");
            return new Decision(decision, null, null);
        }
        List<String> want = scopesAsked != null ? scopesAsked : scopeIds;
        if (want != null && want.isEmpty()) throw RuleException.database("Name what the vendor is approved for");
        if (!withinLab(from, want)) throw RuleException.database("A corporate approval covers at most what the lab approved (" + scopes.names(from.scopeIds()) + ")");
        return new Decision(decision, riskClassId != null ? riskClassId : this.riskClassId, want);
    }

    /** The justification on the corporate approval it makes. */
    public String justification(String siteCode, String fromCode, String note) {
        return "Corporate approval from " + siteCode + "'s " + fromCode + " (" + code + ")" + (Val.blank(note) ? "" : ": " + note.strip());
    }

    /** What the proposing lab is told. */
    public String notice(Decision d, String supplierName, String scopeText, String note) {
        return "Approved".equals(d.decision())
            ? "Corporate QA approved " + supplierName + " for every lab (" + code + "; " + scopeText + ")."
            : "Corporate QA did not approve " + supplierName + " for every lab (" + code + "): " + note.strip() + " This lab's own approval stands.";
    }
}
