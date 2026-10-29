package com.tentamus.lims.quotes.domain;

import com.tentamus.lims.pricing.domain.Amount;
import java.math.BigDecimal;

/**
 * The 20-30 rule for a test quoted from another network lab: its cost is the performing lab's list price less the
 * quoting lab's discount, and the client pays that cost plus the markup, each step rounded to the cent. Java's own
 * subcontract_price (the database keeps it for its quote line trigger).
 */
public record SubcontractPrice(BigDecimal cost, BigDecimal price) {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    public static SubcontractPrice of(BigDecimal listPrice, BigDecimal discountPct, BigDecimal markupPct) {
        BigDecimal cost = Amount.round(listPrice.multiply(BigDecimal.ONE.subtract(discountPct.divide(HUNDRED))), 2);
        return new SubcontractPrice(cost, Amount.round(cost.multiply(BigDecimal.ONE.add(markupPct.divide(HUNDRED))), 2));
    }
}
