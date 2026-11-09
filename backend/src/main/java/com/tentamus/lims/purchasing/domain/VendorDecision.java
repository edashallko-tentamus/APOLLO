package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

/**
 * The decision that applies to a vendor at a lab for the scopes a purchase needs: a corporate Suspended or Not Approved
 * blocks every lab; then the lab's own Suspended or Not Approved blocks that lab; then a current approval covering the
 * scopes (the lab's own first, else the corporate one). Java's copy of the database's vendor_decision(), with the
 * refusals of assert_supplier_scope and assert_supplier_approved; the database keeps those for its views and the
 * purchase request triggers inventory still writes through.
 */
public record VendorDecision(String status, String decidedAt, String qualificationId, LocalDate expires, String missing) {

    public static VendorDecision of(VendorQualification corporate, VendorQualification local, LocalDate today, List<String> need, ScopeList scopes) {
        VendorQualification c = corporate, l = local;
        if (c != null && !c.approved()) return new VendorDecision(c.approvalStatus(), "Corporate", c.id(), c.expires(), null);
        if (l != null && !l.approved()) return new VendorDecision(l.approvalStatus(), "This lab", l.id(), l.expires(), null);
        boolean lCur = l != null && l.current(today), cCur = c != null && c.current(today);
        if (lCur && ScopeList.covers(l.scopeIds(), need)) return new VendorDecision("Approved", "This lab", l.id(), l.expires(), null);
        if (cCur && ScopeList.covers(c.scopeIds(), need)) return new VendorDecision("Approved", "Corporate", c.id(), c.expires(), null);
        if (lCur || cCur) {
            String missing = scopes.all().stream().filter(s -> need.contains(s.id()))
                .filter(s -> !(lCur && ScopeList.covers(l.scopeIds(), List.of(s.id()))) && !(cCur && ScopeList.covers(c.scopeIds(), List.of(s.id()))))
                .sorted(java.util.Comparator.comparingInt(SupplyScope::sortOrder)).map(SupplyScope::name).collect(Collectors.joining(", "));
            return lCur ? new VendorDecision("Not approved for this", "This lab", l.id(), l.expires(), missing)
                        : new VendorDecision("Not approved for this", "Corporate", c.id(), c.expires(), missing);
        }
        if (l != null || c != null) {
            VendorQualification q = l != null ? l : c;
            return new VendorDecision("Expired", l != null ? "This lab" : "Corporate", q.id(), q.expires(), null);
        }
        return new VendorDecision("Not qualified", null, null, null, null);
    }

    public boolean approved() { return "Approved".equals(status); }

    /**
     * Refuses a purchase step (what: "request", "approve a purchase", "order") from a vendor not approved for it.
     * forScopes: the decision for the request's scopes (null when it names none); overall: the decision for anything.
     */
    public static void assertAllows(String what, String supplierName, VendorDecision forScopes, VendorDecision overall) {
        if (forScopes != null) {
            if ("Not approved for this".equals(forScopes.status))
                throw RuleException.database("Cannot " + what + " from " + supplierName + ": it is not approved for " + Val.lower(forScopes.missing)
                    + " at this lab. Ask QA to approve the vendor for it.");
            if (!forScopes.approved())
                throw RuleException.database("Cannot " + what + " from " + supplierName + ": the supplier is " + Val.lower(forScopes.status) + " "
                    + ("Corporate".equals(forScopes.decidedAt) ? "by Corporate QA for every lab" : "for this lab") + ". Ask QA to qualify it first.");
        }
        if (!overall.approved())
            throw RuleException.database("Cannot " + what + " from " + supplierName + ": the supplier is " + Val.lower(overall.status) + " for this lab. Ask QA to qualify it first.");
    }
}
