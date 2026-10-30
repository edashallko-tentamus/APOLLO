package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Locale;

/**
 * The Units list and the Unit conversions table: which codes may be used for a quantity or a concentration, and how
 * many of one unit make another (both directions, chained up to 4 steps). Java's own copy of canonical_unit() and
 * unit_factor(), which stay in the database for the database code that still uses them.
 */
public final class Units {
    public static final List<String> QUANTITY = List.of("Mass", "Volume", "Count");
    public static final List<String> CONCENTRATION = List.of("Mass/Volume", "Mass/Mass", "Volume/Volume", "Parts per", "Amount/Volume", "Activity", "Other");
    static final MathContext MC = MathContext.DECIMAL128;

    public record Unit(String id, String code, String dimension, boolean active) {}

    public record Conversion(String fromId, String toId, BigDecimal factor, String appliesTo, boolean active) {}

    private final List<Unit> units;
    private final List<Conversion> conversions;

    public Units(List<Unit> units, List<Conversion> conversions) {
        this.units = List.copyOf(units);
        this.conversions = List.copyOf(conversions);
    }

    /** A code from the list, in the list's spelling, of one of the given kinds; null for none; refuses anything else. */
    public String canonical(String code, List<String> dims, String what) {
        if (code == null || code.isBlank()) return null;
        String c = code.strip();
        for (Unit u : units)
            if (u.active() && u.code().equalsIgnoreCase(c) && dims.contains(u.dimension())) return u.code();
        throw RuleException.database(what + " \"" + code + "\" is not on the Units list (Admin > Units) as a " + String.join(", ", dims) + " unit");
    }

    /** What a unit measures, or null when it is not on the list. */
    public String dimension(String code) {
        Unit u = find(code);
        return u == null ? null : u.dimension();
    }

    /** How many [to] in one [from]; null when the table cannot convert. The form decides which ppm conversions apply. */
    public BigDecimal factor(String from, String to, String form) {
        Unit a = find(from), b = find(to);
        if (a == null || b == null) return null;
        List<String[]> edges = new ArrayList<>();
        List<BigDecimal> f = new ArrayList<>();
        for (Conversion c : conversions) {
            if (!c.active() || !("Any".equals(c.appliesTo()) || c.appliesTo().equals(form))) continue;
            edges.add(new String[] {c.fromId(), c.toId()});
            f.add(c.factor());
            edges.add(new String[] {c.toId(), c.fromId()});
            f.add(BigDecimal.ONE.divide(c.factor(), MC));
        }
        // breadth first, so the shortest chain wins (the database orders by depth)
        record Step(String node, BigDecimal f, List<String> path) {}
        Deque<Step> q = new ArrayDeque<>();
        q.add(new Step(a.id(), BigDecimal.ONE, List.of(a.id())));
        while (!q.isEmpty()) {
            Step s = q.poll();
            if (s.node().equals(b.id())) return s.f();
            if (s.path().size() > 4) continue;
            for (int i = 0; i < edges.size(); i++) {
                String[] e = edges.get(i);
                if (!e[0].equals(s.node()) || s.path().contains(e[1])) continue;
                List<String> p = new ArrayList<>(s.path());
                p.add(e[1]);
                q.add(new Step(e[1], s.f().multiply(f.get(i), MC), p));
            }
        }
        return null;
    }

    private Unit find(String code) {
        if (code == null) return null;
        String c = code.strip().toLowerCase(Locale.ROOT);
        for (Unit u : units) if (u.code().toLowerCase(Locale.ROOT).equals(c)) return u;
        return null;
    }
}
