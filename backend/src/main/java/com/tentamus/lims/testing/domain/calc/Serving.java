package com.tentamus.lims.testing.domain.calc;

import com.tentamus.lims.core.calc.Formula;
import java.math.BigDecimal;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A sample's serving as the client gave it (and the density measured for it), and the amount per serving of a result.
 * Java's own copy of per_serving and sample_per_serving, which stay in the database for the COA and its release check.
 */
public record Serving(BigDecimal size, String unit, BigDecimal density, String densityUnit, BigDecimal servingsPerPackage) {
    private static final Pattern MULTIPLE = Pattern.compile("^[0-9.]+\\s*\\S+$");
    private static final Pattern LEAD = Pattern.compile("^([0-9.]+)\\s*");

    /** An amount and its unit ("mg per serving"). */
    public record Amount(BigDecimal value, String unit) {}

    /**
     * A result per mass or volume (mg/kg, µg/g, mg/L, ppm, %...) times a serving in the same terms; null when the
     * units do not combine (e.g. CFU per serving of a count).
     */
    public static Amount perServing(BigDecimal value, String resultUnit, BigDecimal size, String sizeUnit, UnitConverter units) {
        String u = resultUnit == null ? "" : resultUnit.strip();
        if (value == null || size == null || sizeUnit == null || u.isEmpty()) return null;
        if (u.equalsIgnoreCase("ppm")) u = "mg/kg";
        else if (u.equalsIgnoreCase("ppb")) u = "µg/kg";
        else if (u.equals("%") || u.equals("% w/w")) u = "g/100 g";
        if (!u.contains("/")) return null;
        String[] parts = u.split("/", -1);
        String num = parts[0].strip(), den = parts[1].strip();
        BigDecimal mult = BigDecimal.ONE;
        if (MULTIPLE.matcher(den).matches()) {   // "g/100 g": per 100 g
            Matcher lead = LEAD.matcher(den);
            lead.find();
            mult = new BigDecimal(lead.group(1));
            den = den.substring(lead.end()).strip();
        }
        BigDecimal f = units.factor(sizeUnit, den);
        if (f == null) return null;
        return new Amount(value.multiply(size, Formula.MC).multiply(f, Formula.MC).divide(mult, Formula.MC), num + " per serving");
    }

    /** The amount per serving of a result of this sample: as served, else through the density (by volume or by weight). */
    public Amount of(BigDecimal value, String resultUnit, UnitConverter units) {
        if (size == null || value == null) return null;
        Amount direct = perServing(value, resultUnit, size, unit, units);
        if (direct != null) return direct;
        if (density == null) return null;
        BigDecimal toGml = "g/ml".equals((densityUnit == null ? "g/mL" : densityUnit).toLowerCase(Locale.ROOT)) ? BigDecimal.ONE : units.factor(densityUnit, "g/mL");
        if (toGml == null) return null;
        BigDecimal d = density.multiply(toGml, Formula.MC);   // grams per millilitre
        if (d.signum() <= 0) return null;
        String dim = units.dimension(unit);
        if ("Volume".equals(dim)) {
            BigDecimal ml = "mL".equals(unit) ? BigDecimal.ONE : units.factor(unit, "mL");
            return ml == null ? null : perServing(value, resultUnit, size.multiply(ml, Formula.MC).multiply(d, Formula.MC), "g", units);
        }
        if ("Mass".equals(dim)) {
            BigDecimal g = "g".equals(unit) ? BigDecimal.ONE : units.factor(unit, "g");
            return g == null ? null : perServing(value, resultUnit, size.multiply(g, Formula.MC).divide(d, Formula.MC), "mL", units);
        }
        return null;
    }
}
