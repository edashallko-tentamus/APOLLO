package com.tentamus.lims.quotes.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.math.BigDecimal;
import java.util.Map;

/**
 * The negotiable parts of a quote line beside its price: the rush discount per tier (quote_rush_term) and the analytes
 * chosen on an analyte-priced line (quoted_analyte_selection). Replaces the database triggers qrt_rules, qas_lock and
 * qas_package_lock and the discount CHECK (migration 061). Surcharges, analyte prices and the analyte itself are never
 * written by Java (only discount_pct and included are), which keeps them as copied from the catalogue.
 */
public final class QuoteTerms {
    private QuoteTerms() {}

    /** A change to a rush term's discount. */
    public static void checkRushTerm(QuoteVersion v, Map<String, Object> vals) {
        v.requireEditable("Rush terms are locked once a version is quoted");
        BigDecimal d = Amount.of(vals.get("discount_pct"));
        if (d != null && (d.signum() < 0 || d.compareTo(BigDecimal.valueOf(100)) > 0))
            throw RuleException.withCode("A rush discount is between 0 and 100 %.", "23514");
    }

    /** Including or leaving out an analyte on a line. */
    public static void checkAnalyteChoice(QuoteVersion v, boolean lineInPackage) {
        if (lineInPackage) throw RuleException.database("The analytes of a test in a package are set in the package (Test catalogue)");
        v.requireEditable("Analyte selections are locked once a version is quoted");
    }
}
