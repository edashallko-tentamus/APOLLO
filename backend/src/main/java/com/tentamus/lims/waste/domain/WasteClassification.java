package com.tentamus.lims.waste.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeSet;

/**
 * A waste classification (WC-001): shared by every lab (site null) or a lab's own; its hazard classes from the
 * controlled list, the item types it is the default for (one default per type in a lab), and whether an item may take it.
 * Replaces the rule part of the database trigger waste_classification_rules and the non-blank check on the name
 * (migration 062 keeps only the permission check); inventory_lot_waste_rule and waste_default_for() stay in the
 * database for the other writers of lots (purchasing, logbooks, the demo data load).
 */
public record WasteClassification(String id, String siteId, String name, boolean active, List<String> defaultFor) {
    public static final List<String> HAZARD_CLASSES = List.of("Ignitable", "Corrosive", "Reactive", "Toxic", "Oxidizer", "Peroxide former", "Water-reactive",
        "Heavy metal", "Halogenated", "Biohazardous", "Sharps", "Pharmaceutical", "Universal waste", "Non-hazardous");

    /**
     * Checks a classification about to be saved and returns the values to write (hazard classes trimmed, without
     * duplicates and sorted; default item types without duplicates, in the item types' order).
     *
     * @param before the classification as stored, or null; after as it will be; changes the columns being written
     * @param others the lab's (or the shared list's) other active classifications
     * @param typeOrder the item types in their own order
     */
    public static Map<String, Object> checked(WasteClassification before, Map<String, Object> after, Map<String, Object> changes,
                                              List<WasteClassification> others, List<String> typeOrder) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        String name = after.get("waste_name") == null ? null : after.get("waste_name").toString();
        if (name == null || name.isBlank()) throw RuleException.withCode("Give the waste classification a name", "23514");
        String site = after.get("site_id") == null ? null : after.get("site_id").toString();
        if (before != null && !Objects.equals(before.siteId(), site)) throw RuleException.database("A waste classification stays with its lab");
        List<String> hz = new ArrayList<>(new TreeSet<>(trimmed(list(after.get("hazard_classes")))));
        List<String> bad = hz.stream().filter(x -> !HAZARD_CLASSES.contains(x)).toList();
        if (!bad.isEmpty()) throw RuleException.database("Unknown hazard class: " + String.join(", ", bad) + " (use: " + String.join(", ", HAZARD_CLASSES) + ")");
        if (hz.contains("Non-hazardous") && hz.size() > 1) throw RuleException.database("A waste is Non-hazardous or has hazard classes, not both");
        boolean review = Boolean.TRUE.equals(after.get("needs_review")) || "true".equals(String.valueOf(after.get("needs_review")));
        if (hz.isEmpty() && !review) throw RuleException.database("Give the hazard classes of " + name + ", Non-hazardous, or mark it Needs review");
        List<String> given = list(after.get("default_for"));
        List<String> df = typeOrder.stream().filter(given::contains).toList();
        boolean active = after.get("status") == null || "Active".equals(after.get("status").toString());
        String self = before == null ? null : before.id();
        if (active)
            for (String t : df)
                for (WasteClassification o : others)
                    if (o.active() && !Objects.equals(o.id(), self) && Objects.equals(o.siteId(), site) && o.defaultFor().contains(t))
                        throw RuleException.database(o.name() + " is already the default for " + t + " (one default per item type)");
        if (before == null || changes.containsKey("hazard_classes")) out.put("hazard_classes", hz);
        if (before == null || changes.containsKey("default_for")) out.put("default_for", df);
        return out;
    }

    /** May an item of this lab take this classification? */
    public void assertChoosableAt(String lab) {
        if (!active) throw RuleException.database("Waste classification " + name + " is retired");
        if (siteId != null && !siteId.equals(lab)) throw RuleException.database("Waste classification " + name + " belongs to another lab");
    }

    /** The default for an item: the lab's own default for one of its types, else the shared one (the first type that has one). */
    public static WasteClassification defaultFor(String lab, List<String> itemTypes, List<WasteClassification> candidates) {
        for (boolean own : new boolean[] {true, false})
            for (String t : itemTypes)
                for (WasteClassification w : candidates)
                    if (w.active() && (own ? lab != null && lab.equals(w.siteId()) : w.siteId() == null) && w.defaultFor().contains(t)) return w;
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<String> list(Object v) {
        if (v instanceof List<?> l) return l.stream().map(String::valueOf).toList();
        return com.tentamus.lims.inventory.domain.Values.list(v);
    }

    private static List<String> trimmed(List<String> l) { return l.stream().map(String::strip).filter(s -> !s.isEmpty()).toList(); }
}
