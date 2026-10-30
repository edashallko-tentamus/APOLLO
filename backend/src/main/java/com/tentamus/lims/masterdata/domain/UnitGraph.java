package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Units list and its conversions as one graph: how many [to] in one [from], following conversions both ways and
 * chained up to 4 steps. Java's own copy of the database functions unit_factor, convertible_units and canonical_unit,
 * which stay in the database because inventory and testing database code still calls them.
 */
public final class UnitGraph {
    private static final int MAX_STEPS = 4;

    /** One unit of the list. */
    public record UnitOfMeasure(String id, String code, String dimension, int sortOrder, boolean active) {}

    /** One conversion row: 1 [from] = factor x [to]. */
    public record Conversion(String fromId, String toId, BigDecimal factor, String appliesTo, boolean active) {}

    private record Edge(String to, BigDecimal factor) {}

    private final List<UnitOfMeasure> units;
    private final Collection<Conversion> conversions;

    public UnitGraph(List<UnitOfMeasure> units, Collection<Conversion> conversions) {
        this.units = units.stream().sorted(Comparator.comparingInt(UnitOfMeasure::sortOrder).thenComparing(UnitOfMeasure::code)).toList();
        this.conversions = conversions;
    }

    /** The factor, or null when the table cannot convert. form ('Liquid' or 'Solid', or null) decides which ppm-type conversions apply. */
    public BigDecimal factor(String from, String to, String form) {
        UnitOfMeasure a = find(from), b = find(to);
        if (a == null || b == null) return null;
        Map<String, List<Edge>> edges = edges(form);
        // breadth first: the shortest chain wins, as in the database function
        record Step(String node, BigDecimal f, int depth, Set<String> path) {}
        ArrayDeque<Step> queue = new ArrayDeque<>();
        queue.add(new Step(a.id(), BigDecimal.ONE, 0, Set.of(a.id())));
        while (!queue.isEmpty()) {
            Step s = queue.poll();
            if (s.node().equals(b.id())) return plain(s.f());
            if (s.depth() >= MAX_STEPS) continue;
            for (Edge e : edges.getOrDefault(s.node(), List.of())) {
                if (s.path().contains(e.to())) continue;
                Set<String> path = new HashSet<>(s.path());
                path.add(e.to());
                queue.add(new Step(e.to(), s.f().multiply(e.factor(), MathContext.DECIMAL128), s.depth() + 1, path));
            }
        }
        return null;
    }

    /** The active units that can stand in for the given one (itself included), in the list's order. */
    public List<String> convertible(String unit, String form) {
        List<String> out = new ArrayList<>();
        for (UnitOfMeasure u : units)
            if (u.active() && (u.code().equalsIgnoreCase(unit) || factor(u.code(), unit, form) != null)) out.add(u.code());
        return out;
    }

    /** A unit code from the list, in the list's spelling, of one of the given kinds; refuses anything else. Null for none. */
    public String canonical(String code, Collection<String> dimensions, String what) {
        if (code == null || code.strip().isEmpty()) return null;
        for (UnitOfMeasure u : units)
            if (u.active() && u.code().equalsIgnoreCase(code.strip()) && dimensions.contains(u.dimension())) return u.code();
        throw RuleException.database(what + " \"" + code + "\" is not on the Units list (Admin > Units) as a " + String.join(", ", dimensions) + " unit");
    }

    private UnitOfMeasure find(String code) {
        if (code == null) return null;
        for (UnitOfMeasure u : units) if (u.code().equalsIgnoreCase(code.strip())) return u;
        return null;
    }

    private Map<String, List<Edge>> edges(String form) {
        Map<String, List<Edge>> out = new HashMap<>();
        for (Conversion c : conversions) {
            if (!c.active() || !("Any".equals(c.appliesTo()) || c.appliesTo().equals(form))) continue;
            out.computeIfAbsent(c.fromId(), k -> new ArrayList<>()).add(new Edge(c.toId(), c.factor()));
            out.computeIfAbsent(c.toId(), k -> new ArrayList<>()).add(new Edge(c.fromId(), BigDecimal.ONE.divide(c.factor(), MathContext.DECIMAL128)));
        }
        return out;
    }

    /** Without trailing zeros or an exponent, so the answer reads 1000, not 1E+3. */
    private static BigDecimal plain(BigDecimal v) { return new BigDecimal(v.round(new MathContext(20)).stripTrailingZeros().toPlainString()); }
}
