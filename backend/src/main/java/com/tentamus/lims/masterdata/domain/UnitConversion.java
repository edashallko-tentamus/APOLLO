package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * One conversion: 1 [from] = factor x [to], for any form or for liquids or solids only. Only units that measure the same
 * thing convert (ppm-type units may convert to mass/volume or mass/mass, for liquids or solids). Replaces the database
 * trigger unit_conversion_rules and the factor, form and not-itself checks (migration 060).
 */
public final class UnitConversion extends MasterRecord {
    public static final Set<String> FORMS = Set.of("Any", "Liquid", "Solid");
    private static final Set<String> PARTS_PER_PARTNERS = Set.of("Mass/Volume", "Mass/Mass");

    public UnitConversion(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        if (isNew() && values.get("applies_to") == null) values.put("applies_to", "Any");
        BigDecimal f = number("factor");
        if (touches("factor") && value("factor") != null && f != null && f.signum() <= 0)
            throw RuleException.withCode("The factor must be more than 0.", "23514");
        if (touches("applies_to") && !FORMS.contains(text("applies_to")))
            throw RuleException.withCode("Applies to: pick Any, Liquid or Solid.", "23514");
        String from = text("from_unit_id"), to = text("to_unit_id");
        if (from != null && Objects.equals(from, to)) throw RuleException.withCode("A unit cannot be converted to itself.", "23514");
        if (from == null || to == null) return values;
        String a = facts.unitDimension(from), b = facts.unitDimension(to);
        if (a == null || b == null) return values;   // no such unit: the reference to the Units list refuses it
        assertJoins(a, b, text("applies_to"));
        return values;
    }

    /** The dimension rule on its own: which kinds of unit may be joined, and for which form. */
    public static void assertJoins(String a, String b, String appliesTo) {
        boolean partsPer = a.equals("Parts per") || b.equals("Parts per");
        if (!a.equals(b) && !(a.equals("Parts per") && PARTS_PER_PARTNERS.contains(b)) && !(b.equals("Parts per") && PARTS_PER_PARTNERS.contains(a)))
            throw RuleException.database("A " + a + " unit cannot be converted to a " + b + " unit");
        if (partsPer && !a.equals(b) && "Any".equals(appliesTo))
            throw RuleException.database("A ppm-type conversion must say whether it applies to liquids or to solids");
    }
}
