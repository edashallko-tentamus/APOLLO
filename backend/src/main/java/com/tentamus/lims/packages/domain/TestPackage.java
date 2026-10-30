package com.tentamus.lims.packages.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.math.BigDecimal;

/**
 * A catalogue package of a lab's tests, each at its price in the package (the package price is their sum).
 * Replaces the refusals of the database trigger test_package_rules and the package CHECKs (migration 061): its own
 * lab's priced active tests only, a test's price is never emptied nor negative, only an analyte-priced test has analytes
 * to leave out. A package stays with its lab and a line keeps its test because Java never writes those columns after the
 * insert. The database keeps the permission check and the default price (the test's catalogue price) for other writers.
 */
public final class TestPackage {
    private TestPackage() {}

    /** The package's name as saved (trimmed); a blank one is refused. */
    public static String name(Object raw) {
        String n = raw == null ? "" : raw.toString().strip();
        if (n.isEmpty()) throw RuleException.withCode("Give the package a name.", "23514");
        return n;
    }

    /**
     * A test on an active package line.
     *
     * @param priced the test is active and has a catalogue entry
     */
    public static void checkTest(String packageSiteId, String testSiteId, String testName, boolean priced) {
        if (!priced) throw RuleException.database("That test is retired or has no catalogue price, so it cannot be in a package");
        if (testSiteId == null || !testSiteId.equals(packageSiteId))
            throw RuleException.database("A package holds its own lab's tests only (" + testName + " is another lab's test)");
    }

    /** A test's price in the package: required once the line exists, never below zero. */
    public static void checkPrice(Object price, String testName, boolean existingLine) {
        BigDecimal p = Amount.of(price);
        if (p == null && existingLine) throw RuleException.database("Give the price of " + testName + " in the package");
        if (p != null && p.signum() < 0) throw RuleException.withCode("A test's price in the package cannot be negative.", "23514");
    }

    /** An analyte left out of (or put back in) a package line. */
    public static void checkAnalyte(String testPricingMode, boolean analytePricedOnTest) {
        if (!"Analyte Selection".equals(testPricingMode)) throw RuleException.database("Only an analyte-priced test has analytes to leave out of a package");
        if (!analytePricedOnTest) throw RuleException.database("That analyte is not priced on the test's catalogue entry");
    }
}
