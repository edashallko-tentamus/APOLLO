package com.tentamus.lims.charges.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import java.math.BigDecimal;
import java.util.Map;

/**
 * Miscellaneous charges (kits, shipping, report fees, surcharges, discounts) in the catalogue and on quotes. Replaces
 * the CHECKs on charge_item, service_line, service_line_type and quoted_charge and the refusals of the database
 * triggers service_line_type_rules, charge_item_rules ("stays with its lab") and quoted_charge_rules (migration 061).
 * A service line type stays under its line, and a charge with its lab and item, because Java never writes those
 * columns after the insert. The database keeps the charge item permission check and the quoted charge's list price.
 */
public final class Charge {
    private Charge() {}

    /** A charge in the catalogue: its name and a price never below zero (a discount is a Discount charge). */
    public static void checkItem(String name, BigDecimal price) {
        Amount.notBlank(name, true, "Give the charge a name.");
        if (price != null && price.signum() < 0) throw RuleException.withCode("A charge's price cannot be negative (take money off with a Discount charge).", "23514");
    }

    /**
     * A charge added to a quote version.
     *
     * @param itemStatus null when the charge does not exist
     */
    public static void checkAddToQuote(QuoteVersion v, String itemStatus, Map<String, Object> vals) {
        v.requireEditable("Charges are locked once a version is quoted; create a new version");
        if (!"Active".equals(itemStatus)) throw RuleException.database("That charge is retired");
        checkQuoted(vals);
    }

    /** A change to (or removal of) a charge on a quote version. */
    public static void checkQuoteChange(QuoteVersion v, Map<String, Object> vals) {
        v.requireEditable("Charges are locked once a version is quoted; create a new version");
        checkQuoted(vals);
    }

    static void checkQuoted(Map<String, Object> vals) {
        Amount.atLeastOne(vals.get("quantity"), "The quantity must be at least 1.");
        Amount.notNegative(vals.get("unit_price"), "A charge's price cannot be negative (take money off with a Discount charge).");
    }
}
