package com.tentamus.lims.testing.domain.calc;

import java.math.BigDecimal;
import java.util.List;
import java.util.regex.Pattern;

/**
 * A requested test's limit for one analyte (from the quote, or set on the order), and how a result compares with it.
 * Java's own copy of spec_conformance, which stays in the database because the bench's live review items, the COA's
 * release check and the verification run still call it.
 */
public record Specification(BigDecimal min, BigDecimal max, String text, String unit, String basis) {
    public static final String AS_REPORTED = "As reported";
    private static final Pattern PLAIN_NUMBER = Pattern.compile("^\\s*-?[0-9]*\\.?[0-9]+\\s*$");

    /** The outcome: the limit as printed beside the result, and Conforms / Does not conform / No specification / Not compared. */
    public record Comparison(BigDecimal specMin, BigDecimal specMax, String specText, String specUnit, String conformance) {
        public static Comparison notCompared() { return new Comparison(null, null, null, null, "Not compared"); }
    }

    public static Comparison none() { return new Comparison(null, null, null, null, "No specification"); }

    /**
     * Compares a result: the reported (rounded) value; "< LOQ" and ND are below a maximum and fail a minimum; a text
     * limit fails on a found result. Limits per serving or per package use the sample's serving (3 significant figures).
     *
     * @param value      the unrounded value
     * @param valueText  a qualitative result
     * @param reported   the value as reported
     * @param resultUnit the analyte's reporting unit
     * @param found      the analyte's "found" values
     * @param serving    the sample's serving, or null
     */
    public Comparison compare(BigDecimal value, String valueText, String reported, String resultUnit, List<String> found, Serving serving, UnitConverter units) {
        String specUnit = AS_REPORTED.equals(basis) ? unit : (unit == null ? "" : unit) + ("Per serving".equals(basis) ? " per serving" : " per package");
        if (min == null && max == null) {
            String c = valueText == null ? "Not compared" : found != null && found.contains(valueText) ? "Does not conform" : "Conforms";
            return new Comparison(min, max, text, specUnit, c);
        }
        BigDecimal x;
        boolean below = false;
        if (reported != null && PLAIN_NUMBER.matcher(reported).matches()) x = new BigDecimal(reported.strip());
        else if (reported != null && (reported.startsWith("<") || reported.equals("ND"))) {
            below = true;
            String digits = reported.replaceAll("[^0-9.]", "");
            x = digits.isEmpty() ? BigDecimal.ZERO : new BigDecimal(digits);
        } else x = value;
        if (x == null) return new Comparison(min, max, text, specUnit, "Not compared");
        String u = resultUnit;
        if (!AS_REPORTED.equals(basis)) {
            Serving.Amount ps = serving == null ? null : serving.of(x, resultUnit, units);
            if (ps == null || ("Per package".equals(basis) && serving.servingsPerPackage() == null)) return new Comparison(min, max, text, specUnit, "Not compared");
            x = Rounding.sig3(ps.value().multiply("Per package".equals(basis) ? serving.servingsPerPackage() : BigDecimal.ONE, Formula.MC));
            u = ps.unit().replaceAll(" per serving$", "");
        }
        BigDecimal f = unit == null || u == null || unit.equals(u) ? BigDecimal.ONE : units.factor(u, unit);
        if (f == null) return new Comparison(min, max, text, specUnit, "Not compared");
        x = x.multiply(f, Formula.MC);
        boolean fails = (max != null && x.compareTo(max) > 0 && !below) || (min != null && (x.compareTo(min) < 0 || below));
        return new Comparison(min, max, text, specUnit, fails ? "Does not conform" : "Conforms");
    }
}
