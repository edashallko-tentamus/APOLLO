package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * A warning rule (Threshold Rule): low stock, expiring lots, low sample retains. Warnings never block work.
 * Replaces the database checks threshold_rule_type_fits, threshold_rule_chemical_fits, threshold_rule_pct and those on
 * the name and value (migration 062 drops them); below_threshold() stays in the database for inventory_lot_view.
 */
public record ThresholdRule(String subject, String ruleType, BigDecimal value, String siteId, String chemicalId, String status) {

    public static ThresholdRule of(Map<String, Object> row) {
        return new ThresholdRule(Values.str(row.get("subject")), Values.str(row.get("rule_type")), Values.dec(row.get("value")),
            Values.str(row.get("site_id")), Values.str(row.get("chemical_id")), row.get("status") == null ? "Active" : row.get("status").toString());
    }

    /** The values about to be written (a stored rule with the changes applied). */
    public static void check(Map<String, Object> after) {
        if (Values.blank(after.get("rule_name"))) throw RuleException.withCode("Give the warning rule a name.", "23514");
        ThresholdRule r = of(after);
        if (r.value() == null) throw RuleException.withCode("Give the warning rule a value.", "23514");
        if (r.value().signum() < 0) throw RuleException.withCode("The value cannot be negative.", "23514");
        boolean amount = List.of("Lot Quantity", "Sample Retain").contains(r.subject());
        boolean fits = amount ? List.of("Percentage of Base", "Absolute Max-Min").contains(r.ruleType())
            : "Lot Expiry".equals(r.subject()) && "Days Until/Since".equals(r.ruleType());
        if (!fits) throw RuleException.withCode("That rule type does not fit what it watches: quantities use Percentage of Base or Absolute Max-Min; expiry uses Days Until/Since.", "23514");
        if (r.chemicalId() != null && !"Lot Quantity".equals(r.subject())) throw RuleException.withCode("Only stock (Lot Quantity) rules can be limited to one chemical.", "23514");
        if ("Percentage of Base".equals(r.ruleType()) && r.value().compareTo(BigDecimal.valueOf(100)) > 0) throw RuleException.withCode("A percentage cannot be more than 100.", "23514");
    }

    /** Does the rule apply to this subject at this lab (and chemical)? */
    public boolean appliesTo(String subj, String site, String chemical) {
        return "Active".equals(status) && subject.equals(subj) && (siteId == null || siteId.equals(site)) && (chemicalId == null || chemicalId.equals(chemical));
    }

    /** Is a quantity below this rule? Percentage of Base: below value% of the base; Absolute: below the value. */
    public boolean isBelow(BigDecimal qty, BigDecimal base) {
        if (qty == null) return false;
        if ("Percentage of Base".equals(ruleType)) return base != null && base.signum() > 0 && qty.compareTo(base.multiply(value).divide(BigDecimal.valueOf(100))) < 0;
        if ("Absolute Max-Min".equals(ruleType)) return qty.compareTo(value) < 0;
        return false;
    }
}
