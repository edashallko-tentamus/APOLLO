package com.tentamus.lims.quotes.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.util.Map;
import java.util.Objects;

/**
 * One priced test on a quote version (quoted_test_configuration). Replaces the refusals of the database triggers
 * qtc_rules and qtc_package_lock and the line CHECKs (migration 061): lines lock once quoted, only a priced active test
 * is quoted, the test on a line never changes, a package's test changes only through its package. The list price
 * snapshot and the 20-30 subcontract price stay worked out by the database (its own version copies and data loads rely on them).
 *
 * @param packageCode the code of the quoted package the line belongs to, or null
 */
public record QuoteLine(String id, String testId, String packageCode) {
    public static final String LOCKED = "Test lines are locked once a version is quoted; create a new version";

    /** A new line on the version. */
    public static void checkNew(QuoteVersion v, boolean testQuotable, Map<String, Object> vals) {
        v.requireEditable(LOCKED);
        if (!testQuotable) throw RuleException.database("Test is retired or has no catalogue pricing; it cannot be quoted");
        checkValues(vals);
    }

    /** A change to this line. */
    public void checkChange(QuoteVersion v, Map<String, Object> vals) {
        if (packageCode != null)
            throw RuleException.database("This test is part of package " + packageCode + ": change the package's price or quantity, or remove the package");
        v.requireEditable(LOCKED);
        if (vals.containsKey("test_id") && !Objects.equals(String.valueOf(vals.get("test_id")), testId))
            throw RuleException.database("The test on a line cannot be changed; remove the line and add a new one");
        checkValues(vals);
    }

    static void checkValues(Map<String, Object> vals) {
        Amount.atLeastOne(vals.get("quantity"), "The quantity must be at least 1.");
        Amount.notNegative(vals.get("final_price"), "The final price cannot be negative.");
    }
}
