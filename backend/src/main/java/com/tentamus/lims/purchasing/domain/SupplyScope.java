package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * What a vendor may be approved for (V-1): its name, the item types that fall under it, the kinds of request that may
 * name it, and the kind of request it is the default for. Replaces the rule part of the database's supply_scope_rules
 * and the scope name check (migration 065); keeping the scopes stays Corporate QA's permission, checked by the database.
 */
public record SupplyScope(String id, String name, int sortOrder, String status, List<String> chemicalTypes, List<String> lineTypes, String defaultFor) {

    public static SupplyScope of(Map<String, Object> r) {
        List<String> ct = Val.list(r.get("chemical_types")), lt = Val.list(r.get("line_types"));
        return new SupplyScope(Val.str(r.get("id")), Val.str(r.get("scope_name")), r.get("sort_order") == null ? 0 : ((Number) r.get("sort_order")).intValue(),
            r.get("status") == null ? "Active" : r.get("status").toString(), ct == null ? List.of() : ct, lt == null ? List.of() : lt, Val.str(r.get("default_for")));
    }

    public boolean active() { return "Active".equals(status); }

    /**
     * Checks a scope about to be written (its stored values with the changes applied) against the other scopes, and
     * returns the changes with the name trimmed.
     */
    public static Map<String, Object> check(String id, Map<String, Object> merged, Map<String, Object> changes, List<SupplyScope> others) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (Val.blank(merged.get("scope_name"))) throw RuleException.withCode("Name the supply scope.", "23514");
        String name = merged.get("scope_name").toString().strip();
        if (changes.containsKey("scope_name")) out.put("scope_name", name);
        String def = Val.blank(merged.get("default_for")) ? null : merged.get("default_for").toString();
        List<String> lineTypes = Val.list(merged.get("line_types"));
        if (def != null && (lineTypes == null || !lineTypes.contains(def)))
            throw RuleException.database("Scope \"" + name + "\" is the default for " + def.toLowerCase() + " requests, so it must be offered for them");
        if (!"Inactive".equals(Val.str(merged.get("status")))) {
            List<String> types = Val.list(merged.get("chemical_types"));
            for (String t : types == null ? List.<String>of() : types)
                for (SupplyScope o : others)
                    if (!Objects.equals(o.id, id) && o.active() && o.chemicalTypes.contains(t))
                        throw RuleException.database("Items of type " + t + " already fall under the scope \"" + o.name + "\": an item type belongs to one scope");
        }
        return out;
    }
}
