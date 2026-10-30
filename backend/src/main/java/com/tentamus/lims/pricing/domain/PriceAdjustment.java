package com.tentamus.lims.pricing.domain;

import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;

/**
 * A change of catalogue prices by a percentage, each price rounded to the cent or the dollar. Used by "Update prices"
 * (Java's own reprice_catalog) and by dated price changes; replaces the percentage CHECK on catalog_price_change.
 */
public record PriceAdjustment(BigDecimal pct, int digits) {
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);

    /** @param rounding "Dollar" for whole dollars, anything else for cents */
    public static PriceAdjustment of(BigDecimal pct, String rounding) {
        if (pct == null || pct.signum() == 0) throw RuleException.database("Give the percentage to change the prices by (e.g. 3 or -5)");
        if (pct.compareTo(BigDecimal.valueOf(-90)) <= 0 || pct.compareTo(BigDecimal.valueOf(500)) > 0)
            throw RuleException.database("A price change of " + Js.number(pct) + " % is outside what this tool allows (more than -90 % and up to 500 %)");
        return new PriceAdjustment(pct, "Dollar".equals(rounding) ? 0 : 2);
    }

    public BigDecimal apply(BigDecimal price) {
        if (price == null) return null;
        return Amount.round(price.multiply(BigDecimal.ONE.add(pct.divide(HUNDRED))), digits);
    }
}
