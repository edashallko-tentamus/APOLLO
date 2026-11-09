package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Every supply scope, and what follows from them: their names in order (the database's scope_names), whether an
 * approval covers what a request needs (scopes_cover), and the scopes a purchase request gets (purchase_line_scope).
 * The database keeps those functions for its views and the purchase request triggers it still runs for inventory.
 */
public final class ScopeList {
    private final Map<String, SupplyScope> byId = new LinkedHashMap<>();

    public ScopeList(List<SupplyScope> scopes) { for (SupplyScope s : scopes) byId.put(s.id(), s); }

    public List<SupplyScope> all() { return List.copyOf(byId.values()); }

    /** NULL (every scope) when the list is null; otherwise the names, in the scopes' order. */
    public String names(List<String> ids) {
        if (ids == null) return "Every scope";
        return byId.values().stream().filter(s -> ids.contains(s.id()))
            .sorted(Comparator.comparingInt(SupplyScope::sortOrder).thenComparing(SupplyScope::name)).map(SupplyScope::name).collect(Collectors.joining(", "));
    }

    /** An approval covering null covers everything; a request needing nothing (null or none) needs no check. */
    public static boolean covers(List<String> have, List<String> need) {
        return have == null || need == null || need.isEmpty() || have.containsAll(need);
    }

    /** The scopes an approval names, checked: none at all is refused, each must be active; kept distinct and sorted. */
    public List<String> forApproval(List<String> ids) {
        if (ids == null) return null;
        if (ids.isEmpty()) throw RuleException.database("Name what the vendor is approved for (or every scope)");
        for (String id : ids) if (!byId.containsKey(id) || !byId.get(id).active()) throw RuleException.database("An approval names only active supply scopes");
        return ids.stream().distinct().sorted().toList();
    }

    /**
     * The scopes of a purchase request: from the item's types (inventory) or the kind's default (equipment, or a
     * service or other purchase with none chosen); a chosen one must be active and offered for that kind of request.
     */
    public List<String> forRequest(String lineType, List<String> chosen, List<String> lotTypes) {
        if ("Inventory item".equals(lineType)) {
            List<String> ids = active().filter(s -> lotTypes != null && s.chemicalTypes().stream().anyMatch(lotTypes::contains)).map(SupplyScope::id).sorted().toList();
            return ids.isEmpty() ? null : ids;
        }
        if ("Equipment".equals(lineType) || chosen == null || chosen.isEmpty())
            return active().filter(s -> lineType.equals(s.defaultFor())).map(s -> List.of(s.id())).findFirst().orElse(null);
        List<String> bad = new ArrayList<>();
        for (String id : chosen) {
            SupplyScope s = byId.get(id);
            if (s == null || !s.active() || !s.lineTypes().contains(lineType)) bad.add(s == null ? id : s.name());
        }
        if (!bad.isEmpty()) throw RuleException.database("A " + lineType.toLowerCase() + " request cannot be for " + String.join(", ", bad));
        return chosen;
    }

    private java.util.stream.Stream<SupplyScope> active() { return byId.values().stream().filter(SupplyScope::active); }
}
