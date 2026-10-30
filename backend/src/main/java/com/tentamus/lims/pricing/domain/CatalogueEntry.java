package com.tentamus.lims.pricing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * A test's commercial terms in the catalogue: its pricing mode, base price, preparation fee and the prices of the
 * analytes a client can choose. Works out the list price (Java's own catalog_list_price, which the database keeps for
 * its views and the ordering rules) and replaces the CHECKs on test_catalog_entry and test_analyte_price (migration 061).
 *
 * @param analytePrices the active analyte prices by analyte id
 */
public record CatalogueEntry(String pricingMode, BigDecimal basePrice, BigDecimal prepFee, Map<String, BigDecimal> analytePrices) {
    public static final String BASE_ONLY = "Base Price Only";
    public static final String ANALYTE_SELECTION = "Analyte Selection";

    /** List price = base + preparation fee (unless Base Price Only) + the chosen analytes' prices (Analyte Selection only). */
    public BigDecimal listPrice(Collection<String> chosenAnalytes) {
        BigDecimal p = basePrice == null ? BigDecimal.ZERO : basePrice;
        if (!BASE_ONLY.equals(pricingMode) && prepFee != null) p = p.add(prepFee);
        if (ANALYTE_SELECTION.equals(pricingMode))
            for (Map.Entry<String, BigDecimal> a : analytePrices.entrySet())
                if (chosenAnalytes == null || chosenAnalytes.contains(a.getKey())) p = p.add(a.getValue());
        return p;
    }

    /** The full analyte set's list price. */
    public BigDecimal listPrice() { return listPrice(null); }

    /** The entry repriced by a percentage (each part on its own, as the database's reprice did). */
    public CatalogueEntry adjusted(PriceAdjustment a) {
        Map<String, BigDecimal> prices = new LinkedHashMap<>();
        analytePrices.forEach((k, v) -> prices.put(k, a.apply(v)));
        return new CatalogueEntry(pricingMode, a.apply(basePrice), a.apply(prepFee), prices);
    }

    /** The entry as it will be saved (stored values with the changes laid over them). */
    public static void check(Map<String, Object> entry) {
        Amount.notNegative(entry.get("base_price"), "The base price cannot be negative.");
        Amount.notNegative(entry.get("prep_fee"), "The preparation fee cannot be negative.");
        Amount.notNegative(entry.get("standard_tat"), "The standard TAT cannot be negative.");
        BigDecimal prep = Amount.of(entry.get("prep_fee"));
        if (BASE_ONLY.equals(String.valueOf(entry.get("pricing_mode"))) && prep != null && prep.signum() != 0)
            throw RuleException.withCode("Base Price Only tests cannot have a preparation fee. Choose \"Base + Preparation Fee\".", "23514");
    }

    public static void checkAnalytePrice(Object price) { Amount.notNegative(price, "An analyte's price cannot be negative."); }
}
