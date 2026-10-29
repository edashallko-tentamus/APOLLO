package com.tentamus.lims.inventory.domain;

import java.util.List;

/**
 * What an inventory item is (Chemical Type multi-select): Consumable, In-house mixture, Solvent, Reagent, Media,
 * Reference Standard, Microbiological Strain. Replaces lot_is_mixture() and lot_is_consumable_only() for Java's use.
 */
public record ChemicalTypes(List<String> types) {
    /** The enum's own order (Postgres sorts chemical_type values by it). */
    public static final List<String> ORDER = List.of("Consumable", "In-house mixture", "Solvent", "Reagent", "Media", "Reference Standard", "Microbiological Strain");
    public static final String MIXTURE = "In-house mixture";

    public ChemicalTypes { types = List.copyOf(types); }

    /** @param raw a list, or Postgres array text such as {Reagent,"Reference Standard"} */
    public static ChemicalTypes of(Object raw) { return new ChemicalTypes(Values.list(raw)); }

    public boolean isMixture() { return types.contains(MIXTURE); }

    public boolean isConsumableOnly() { return types.equals(List.of("Consumable")); }

    /** Reference Standards and Microbiological Strains must name an analyte. */
    public boolean needsAnalyte() { return types.contains("Reference Standard") || types.contains("Microbiological Strain"); }

    public boolean isEmpty() { return types.isEmpty(); }

    /** The types with In-house mixture added, without duplicates, in the enum's order. */
    public ChemicalTypes asMixture() {
        return new ChemicalTypes(ORDER.stream().filter(t -> t.equals(MIXTURE) || types.contains(t)).toList());
    }
}
