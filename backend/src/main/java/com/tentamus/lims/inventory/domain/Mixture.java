package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * An in-house mixture made from component lots: each portion is drawn in the lot's own unit (it may be entered in any
 * unit that converts), the mixture cannot outlive its earliest-expiring component, the quantity made defaults to the
 * components' total, and each analyte's concentration is worked out from the components (liquid: mg/L x volume;
 * solid: mg/kg x mass; molar standards through the analyte's molar mass; "expressed as" a compound through its formula weight).
 *
 * <p>Java's own copy of mixture_components_in_lot_units(), mixture_default_quantity(), mixture_concentrations() and the
 * checks of make_mixture() / prepare_mixture(), which stay in the database for the demo data load.
 */
public final class Mixture {
    /** A component lot as the maths needs it. */
    public record Component(String lotId, String lotCode, String unit, String form, LocalDate expires, List<AnalyteLine> analytes) {}

    /** One active analyte line of a component lot. */
    public record AnalyteLine(String analyteId, String name, BigDecimal molarMass, BigDecimal concentration, String unit, String dimension,
                              String expressedAs, BigDecimal formulaWeight, BigDecimal perUnit) {}

    /** How much of a component goes in: in the lot's unit, and as entered. */
    public record Portion(Component lot, BigDecimal quantity, BigDecimal enteredQuantity, String enteredUnit) {}

    /** One analyte's calculated concentration, or null with the reason in the note. */
    public record Concentration(String analyteId, String analyteName, BigDecimal concentration, String unit, String note) {}

    private final List<Portion> portions;
    private final Units units;

    private Mixture(List<Portion> portions, Units units) {
        this.portions = portions;
        this.units = units;
    }

    /**
     * The components as entered (quantity in any convertible unit, or the lot's own when none is given).
     *
     * @param entered each {lot_id, quantity, unit}; lots maps a lot id to its component
     */
    public static Mixture of(List<Map<String, Object>> entered, Map<String, Component> lots, Units units) {
        List<Portion> out = new ArrayList<>();
        for (Map<String, Object> e : entered) {
            Component c = lots.get(Values.str(e.get("lot_id")));
            if (c == null) continue;
            BigDecimal q = Values.dec(e.get("quantity"));
            String u = Values.trimmed(e.get("unit"));
            BigDecimal f;
            if (u == null || c.unit() == null || u.equalsIgnoreCase(c.unit())) { f = BigDecimal.ONE; u = c.unit() != null ? c.unit() : u; }
            else {
                f = units.factor(u, c.unit(), c.form());
                if (f == null) throw RuleException.database("Lot " + c.lotCode() + ": " + u + " cannot be converted to " + c.unit() + " (the unit it is kept in)");
            }
            out.add(new Portion(c, q == null ? null : q.multiply(f, Units.MC), q, u));
        }
        return new Mixture(out, units);
    }

    public List<Portion> portions() { return portions; }

    /** A mixture needs components, and is Solid or Liquid with a quantity made (the checks of prepare_mixture). */
    public void assertCanPrepare(String form, BigDecimal quantity) {
        assertHasComponents();
        if (form == null || form.isBlank()) throw RuleException.database("Say whether the mixture is Solid or Liquid");
        if (quantity == null || quantity.signum() <= 0) throw RuleException.database("Enter the quantity made");
    }

    public void assertHasComponents() {
        if (portions.isEmpty()) throw RuleException.database("A mixture needs at least one component lot");
    }

    /** The expiry: the date given, never later than the earliest-expiring component (and defaulting to it). */
    public LocalDate expiry(LocalDate given) {
        LocalDate min = portions.stream().map(p -> p.lot().expires()).filter(d -> d != null).min(Comparator.naturalOrder()).orElse(null);
        if (given != null && min != null && given.isAfter(min))
            throw RuleException.database("This mixture must expire on or before " + min + " (its earliest-expiring component)");
        return given != null ? given : min;
    }

    /** The total of the components that can be expressed in the mixture's unit; null when none can. */
    public BigDecimal defaultQuantity(String unit) {
        BigDecimal sum = null;
        for (Portion p : portions) {
            if (p.quantity() == null) continue;
            BigDecimal f = units.factor(p.lot().unit(), unit, p.lot().form());
            if (f == null) continue;
            sum = (sum == null ? BigDecimal.ZERO : sum).add(p.quantity().multiply(f, Units.MC));
        }
        return sum;
    }

    /** Each analyte's concentration in the quantity made, sorted by analyte name. outUnits: analyte id to the unit wanted. */
    public List<Concentration> concentrations(BigDecimal quantity, String unit, String form, Map<String, String> outUnits) {
        boolean solid = "Solid".equals(form);
        String base = solid ? "mg/kg" : "mg/L";
        BigDecimal toTotal = units.factor(unit, solid ? "kg" : "L", form);
        BigDecimal total = quantity == null || toTotal == null ? null : quantity.multiply(toTotal, Units.MC);
        record Acc(String name, String firstUnit, BigDecimal[] mg, List<String> bad, List<String> from) {}
        Map<String, Acc> acc = new LinkedHashMap<>();
        for (Portion p : portions) {
            Component cl = p.lot();
            BigDecimal q = p.quantity();
            for (AnalyteLine a : cl.analytes()) {
                Acc e = acc.computeIfAbsent(a.analyteId(), k -> new Acc(a.name(), a.unit(), new BigDecimal[] {BigDecimal.ZERO}, new ArrayList<>(), new ArrayList<>()));
                BigDecimal m = null;
                String why = null;
                BigDecimal per = a.perUnit() == null ? BigDecimal.ONE : a.perUnit();
                if (a.concentration() == null) why = cl.lotCode() + " has no " + a.name() + " concentration";
                else if ("Amount/Volume".equals(a.dimension())) {
                    BigDecimal fm = units.factor(a.unit(), "M", "Liquid");
                    BigDecimal vol = units.factor(cl.unit(), "L", "Liquid");
                    if (fm == null) why = cl.lotCode() + ": " + a.unit() + " cannot be converted to an amount (normality depends on the reaction)";
                    else if (a.molarMass() == null) why = a.name() + " has no molar mass on the Analytes list";
                    else if (vol == null) why = cl.lotCode() + ": " + cl.unit() + " is not a volume";
                    else m = mul(a.concentration(), fm, per, a.molarMass(), BigDecimal.valueOf(1000), q, vol);
                } else {
                    boolean liquid = cl.form() == null || "Liquid".equals(cl.form());
                    BigDecimal f = units.factor(a.unit(), liquid ? "mg/L" : "mg/kg", liquid ? "Liquid" : "Solid");
                    BigDecimal amt = units.factor(cl.unit(), liquid ? "L" : "kg", liquid ? "Liquid" : "Solid");
                    if (f == null || amt == null)
                        why = cl.lotCode() + ": cannot convert " + a.unit() + " x " + (cl.unit() == null ? "?" : cl.unit()) + " to an amount";
                    else if (a.expressedAs() != null && (a.formulaWeight() == null || a.molarMass() == null))
                        why = cl.lotCode() + ": " + a.name() + " is expressed as " + a.expressedAs() + " but the formula weight or the molar mass of " + a.name() + " is missing";
                    else {
                        m = mul(a.concentration(), f, q, amt);
                        if (m != null && a.expressedAs() != null) m = mul(m, per, a.molarMass()).divide(a.formulaWeight(), Units.MC);
                    }
                }
                if (why != null) e.bad().add(why);
                if (m != null) { e.mg()[0] = e.mg()[0].add(m); e.from().add(cl.lotCode()); }
            }
        }
        List<Concentration> out = new ArrayList<>();
        for (Map.Entry<String, Acc> en : acc.entrySet()) {
            Acc e = en.getValue();
            String want = outUnits == null ? null : Values.trimmed(outUnits.get(en.getKey()));
            String out1 = want != null ? want : e.firstUnit();
            if (out1 == null || units.factor(base, out1, form) == null) out1 = base;
            if (!e.bad().isEmpty()) out.add(new Concentration(en.getKey(), e.name(), null, out1, "Not calculated: " + String.join("; ", e.bad())));
            else if (total == null || total.signum() == 0)
                out.add(new Concentration(en.getKey(), e.name(), null, out1, "Not calculated: the quantity made (" + (quantity == null ? "?" : quantity.toPlainString()) + " "
                    + (unit == null ? "?" : unit) + ") cannot be expressed as a " + (solid ? "mass" : "volume")));
            else {
                BigDecimal val = e.mg()[0].divide(total, Units.MC).multiply(units.factor(base, out1, form), Units.MC).setScale(6, RoundingMode.HALF_UP);
                String note = "Calculated: " + Values.fmt(e.mg()[0].setScale(6, RoundingMode.HALF_UP)) + " mg of " + e.name() + " from " + String.join(", ", e.from())
                    + " in " + Values.fmt(quantity) + " " + unit;
                if (!solid && (isParts(e.firstUnit()) || isParts(out1))) note += ". ppm = mg/L assumes a dilute water-based solution (density 1 g/mL)";
                out.add(new Concentration(en.getKey(), e.name(), val, out1, note));
            }
        }
        out.sort(Comparator.comparing(Concentration::analyteName, Comparator.nullsLast(Comparator.naturalOrder())));
        return out;
    }

    private static boolean isParts(String u) { return u != null && u.matches("(?i)^pp[mbt]$"); }

    private static BigDecimal mul(BigDecimal... xs) {
        BigDecimal r = BigDecimal.ONE;
        for (BigDecimal x : xs) { if (x == null) return null; r = r.multiply(x, Units.MC); }   // NULL arithmetic, as in SQL
        return r;
    }
}
