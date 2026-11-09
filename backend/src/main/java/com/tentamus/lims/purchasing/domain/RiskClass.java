package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * A supplier risk class: shared by every lab (kept by Corporate QA) or one lab's own; it sets how often a vendor is
 * re-qualified. Replaces the rule part of supplier_risk_class_rules and the name and interval checks (migration 065).
 */
public record RiskClass(String id, String siteId, String name, int requalMonths, String status) {

    public static RiskClass of(Map<String, Object> r) {
        if (r == null) return null;
        return new RiskClass(Val.str(r.get("id")), Val.str(r.get("site_id")), Val.str(r.get("class_name")),
            r.get("requal_months") == null ? 0 : ((Number) r.get("requal_months")).intValue(), Val.str(r.get("status")));
    }

    public boolean shared() { return siteId == null; }

    public boolean active() { return "Active".equals(status); }

    /** A risk class about to be written: its stored lab (null for a new one), and its values with the changes applied. */
    public static void check(RiskClass before, Map<String, Object> merged) {
        if (before != null && !Objects.equals(before.siteId, Val.str(merged.get("site_id")))) throw RuleException.database("A risk class cannot move between labs");
        if (Val.blank(merged.get("class_name"))) throw RuleException.withCode("Name the risk class.", "23514");
        Object m = merged.get("requal_months");
        if (m == null || Val.dec(m).signum() <= 0) throw RuleException.withCode("Re-qualify every 1 month or more.", "23514");
    }

    /** May an approval of this lab (null = corporate) use this class? */
    public void assertUsableFor(String qualificationSite) {
        if (!active()) throw RuleException.database("Risk class " + name + " is Inactive");
        if (siteId != null && !siteId.equals(qualificationSite))
            throw RuleException.database("Risk class " + name + " belongs to one lab: use it only for that lab's own qualifications (a corporate approval uses a shared class)");
    }
}
