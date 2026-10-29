package com.tentamus.lims.packages.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The package and price change rules moved out of the database in migration 061 (they were checked by test_041). */
class PackageRulesTest {
    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static BigDecimal d(String s) { return new BigDecimal(s); }

    static QuoteVersion version(String status, String site, boolean lpa, String kind) {
        return new QuoteVersion("V1", "P1", "C1", site, kind, lpa, status, null, null);
    }

    @Test
    void packagesInTheCatalogue() {
        assertEquals("PK Pair", TestPackage.name("  PK Pair "));
        assertEquals("Give the package a name.", refusal(() -> TestPackage.name(" ")));
        assertEquals("A package holds its own lab's tests only (PK Partner assay is another lab's test)",
            refusal(() -> TestPackage.checkTest("CFL", "TPS", "PK Partner assay", true)));
        assertEquals("That test is retired or has no catalogue price, so it cannot be in a package", refusal(() -> TestPackage.checkTest("CFL", "CFL", "X", false)));
        assertEquals("Give the price of PK Lead in the package", refusal(() -> TestPackage.checkPrice(null, "PK Lead", true)));
        assertNull(refusal(() -> TestPackage.checkPrice(null, "PK Lead", false)));   // a new line starts at its catalogue price
        assertEquals("A test's price in the package cannot be negative.", refusal(() -> TestPackage.checkPrice(-1, "PK Lead", true)));
        assertEquals("Only an analyte-priced test has analytes to leave out of a package", refusal(() -> TestPackage.checkAnalyte("Base Price Only", true)));
        assertEquals("That analyte is not priced on the test's catalogue entry", refusal(() -> TestPackage.checkAnalyte("Analyte Selection", false)));
    }

    @Test
    void packagesOnAQuote() {
        QuoteVersion draft = version("Draft", "CFL", false, "Quote");
        assertNull(refusal(() -> QuotedPackage.checkAdd(draft, "PKG-0001", "Active", "CFL", "CFL", "CFL", List.of(), false)));
        assertEquals("Package PKG-0001 is already on this quote; change its quantity instead",
            refusal(() -> QuotedPackage.checkAdd(draft, "PKG-0001", "Active", "CFL", "CFL", "CFL", List.of(), true)));
        assertEquals("Package PKG-0002 belongs to CFL; this quote is made at TPS",
            refusal(() -> QuotedPackage.checkAdd(version("Draft", "TPS", false, "Quote"), "PKG-0002", "Active", "CFL", "CFL", "TPS", List.of(), false)));
        assertEquals("Package PKG-0001 cannot be quoted yet: The package has no tests",
            refusal(() -> QuotedPackage.checkAdd(draft, "PKG-0001", "Active", "CFL", "CFL", "CFL", List.of("The package has no tests"), false)));
        assertEquals("That package is retired or does not exist", refusal(() -> QuotedPackage.checkAdd(draft, "PKG-0001", "Retired", "CFL", "CFL", "CFL", List.of(), false)));
        assertEquals("A stability quote is priced by its study design, not by packages",
            refusal(() -> QuotedPackage.checkAdd(version("Draft", "CFL", false, "Stability"), "P", "Active", "CFL", "CFL", "CFL", List.of(), false)));
        assertEquals("A list-price acceptance has no packages (each test is at its list price)",
            refusal(() -> QuotedPackage.checkAdd(version("Draft", "CFL", true, "Project"), "P", "Active", "CFL", "CFL", "CFL", List.of(), false)));
        assertEquals(QuotedPackage.LOCKED, refusal(() -> QuotedPackage.checkChange(version("Accepted", "CFL", false, "Quote"), d("170"), null)));
        assertEquals("The package price cannot be negative", refusal(() -> QuotedPackage.checkChange(draft, d("-1"), null)));
        assertEquals("The quantity is at least 1", refusal(() -> QuotedPackage.checkChange(draft, null, 0L)));
    }

    @Test
    void aNegotiatedPackagePriceIsSharedInProportion() {
        // $189 as $90 + $54 + $45, renegotiated to $180: $85.71, $51.43, $42.86
        List<BigDecimal> shares = QuotedPackage.allocate(d("180"), List.of(d("90"), d("54"), d("45")));
        assertEquals(List.of(d("85.71"), d("51.43"), d("42.86")), shares);
        assertEquals(List.of(d("33.33"), d("33.33"), d("33.34")), QuotedPackage.allocate(d("100.00"), List.of(BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO)));
    }

    @Test
    void datedPriceChanges() {
        LocalDate today = LocalDate.of(2026, 10, 29);
        assertEquals("A price change starts today or later", refusal(() -> PriceChange.checkNew(today.minusDays(1), today, null, true, d("5"), "x")));
        assertEquals("A price change covers its own lab's tests only", refusal(() -> PriceChange.checkNew(today, today, List.of("T"), false, d("5"), "x")));
        assertEquals("Choose the tests, or every test", refusal(() -> PriceChange.checkNew(today, today, List.of(), true, d("5"), "x")));
        assertNotNull(refusal(() -> PriceChange.checkNew(today, today, null, true, d("-90"), "x")));
        assertNull(refusal(() -> PriceChange.checkNew(today, today, null, true, d("5"), "Annual")));
        PriceChange applied = new PriceChange("1", "PC-0002", "CFL", null, d("10"), "Dollar", true, today, "Applied", "Annual");
        assertEquals("An applied price change does not change", refusal(applied::checkCancel));
        PriceChange next = new PriceChange("2", "PC-0001", "CFL", null, d("5"), "Cent", true, today.plusDays(30), "Scheduled", "Next year");
        assertNull(refusal(next::checkCancel));
        assertEquals("Price change PC-0001 starts on 2026-11-28", refusal(() -> next.toApply(today)));
        assertEquals(0, new PriceChange("3", "PC-0003", "CFL", null, d("10"), "Dollar", true, today, "Scheduled", "x").toApply(today).apply(d("100")).compareTo(d("110")));
    }
}
