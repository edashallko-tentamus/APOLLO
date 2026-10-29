package com.tentamus.lims.pricing.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The catalogue pricing rules moved out of the database in migration 061 (they were checked by test_002 and test_026). */
class PricingRulesTest {
    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    static BigDecimal d(String s) { return new BigDecimal(s); }

    @Test
    void listPriceFollowsThePricingMode() {
        Map<String, BigDecimal> five = new LinkedHashMap<>();
        for (String a : List.of("Pb", "As", "Cd", "Hg", "Cr")) five.put(a, d("20.00"));
        assertEquals(0, new CatalogueEntry("Analyte Selection", d("50.00"), d("25.00"), five).listPrice().compareTo(d("175")));
        assertEquals(0, new CatalogueEntry("Analyte Selection", d("50.00"), d("25.00"), five).listPrice(List.of("Pb", "As", "Cd")).compareTo(d("135")));
        assertEquals(0, new CatalogueEntry("Base + Preparation Fee", d("30.00"), d("10.00"), Map.of()).listPrice().compareTo(d("40")));
        assertEquals(0, new CatalogueEntry("Base Price Only", d("60.00"), d("0"), five).listPrice().compareTo(d("60")));
    }

    @Test
    void catalogueEntryChecks() {
        assertEquals("Base Price Only tests cannot have a preparation fee. Choose \"Base + Preparation Fee\".",
            refusal(() -> CatalogueEntry.check(m("pricing_mode", "Base Price Only", "base_price", 60, "prep_fee", 5))));
        assertNull(refusal(() -> CatalogueEntry.check(m("pricing_mode", "Base + Preparation Fee", "base_price", 60, "prep_fee", 5))));
        assertEquals("The base price cannot be negative.", refusal(() -> CatalogueEntry.check(m("base_price", "-1"))));
        assertEquals("The standard TAT cannot be negative.", refusal(() -> CatalogueEntry.check(m("standard_tat", -2))));
        assertEquals("An analyte's price cannot be negative.", refusal(() -> CatalogueEntry.checkAnalytePrice(-3)));
    }

    @Test
    void rushSchedules() {
        assertEquals("Give the rush fee schedule a name.", refusal(() -> RushFeeSchedule.checkSchedule(m("schedule_name", " "), true)));
        assertNull(refusal(() -> RushFeeSchedule.checkSchedule(m("description", "x"), false)));
        assertEquals("Give the rush tier a name.", refusal(() -> RushFeeSchedule.checkTier(m("rush_tat", 1), true)));
        assertEquals("A rush surcharge cannot be negative.", refusal(() -> RushFeeSchedule.checkTier(m("tier_name", "x", "surcharge_value", -1), true)));
        assertEquals("Escalation hours must be more than 0.", refusal(() -> RushFeeSchedule.checkTier(m("escalation_hours", 0), false)));
    }

    @Test
    void repricingByAPercentage() {
        assertEquals("Give the percentage to change the prices by (e.g. 3 or -5)", refusal(() -> PriceAdjustment.of(BigDecimal.ZERO, "Cent")));
        assertEquals("A price change of -95 % is outside what this tool allows (more than -90 % and up to 500 %)", refusal(() -> PriceAdjustment.of(d("-95"), "Cent")));
        assertNotNull(refusal(() -> PriceAdjustment.of(d("501"), "Cent")));
        assertEquals(0, PriceAdjustment.of(d("10"), "Cent").apply(d("33.33")).compareTo(d("36.66")));
        assertEquals(0, PriceAdjustment.of(d("10"), "Dollar").apply(d("40.00")).compareTo(d("44")));
        assertEquals(0, PriceAdjustment.of(d("10"), "Dollar").apply(d("85.71")).compareTo(d("94")));
        CatalogueEntry up = new CatalogueEntry("Analyte Selection", d("50.00"), d("25.00"), Map.of("Pb", d("30.00"))).adjusted(PriceAdjustment.of(d("10"), "Dollar"));
        assertEquals(0, up.basePrice().compareTo(d("55")));
        assertEquals(0, up.analytePrices().get("Pb").compareTo(d("33")));
    }
}
