package com.tentamus.lims.packages.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * A catalogue package on a quote version: one price per sample, shared out over its tests. Java's own
 * add_package_to_quote, set_quoted_package, remove_quoted_package and quoted_package_allocate (the database keeps them
 * for the Node backend), and the refusals of the trigger quoted_package_rules and the quoted package CHECKs (migration 061).
 */
public final class QuotedPackage {
    public static final String LOCKED = "Packages are locked once a version is quoted; create a new version";

    private QuotedPackage() {}

    /**
     * Whether the package can go on the version.
     *
     * @param packageStatus     null when the package does not exist
     * @param quoteSiteCode     the quote's lab, or null
     * @param errors            the package's Error problems (it cannot be quoted while it has one)
     * @param alreadyOnVersion  the package is already on this version
     */
    public static void checkAdd(QuoteVersion v, String packageCode, String packageStatus, String packageSiteId, String packageSiteCode,
                                String quoteSiteCode, List<String> errors, boolean alreadyOnVersion) {
        if (packageStatus == null || !"Active".equals(packageStatus)) throw RuleException.database("That package is retired or does not exist");
        if (v == null) throw RuleException.database("Quote version not found");
        v.requireEditable(LOCKED);
        if (v.isStability()) throw RuleException.database("A stability quote is priced by its study design, not by packages");
        if (v.listPriceAcceptance()) throw RuleException.database("A list-price acceptance has no packages (each test is at its list price)");
        if (v.siteId() == null || !v.siteId().equals(packageSiteId))
            throw RuleException.database("Package " + packageCode + " belongs to " + packageSiteCode + "; this quote is made at " + (quoteSiteCode == null ? "no lab" : quoteSiteCode));
        if (!errors.isEmpty()) throw RuleException.database("Package " + packageCode + " cannot be quoted yet: " + String.join("; ", errors));
        if (alreadyOnVersion) throw RuleException.database("Package " + packageCode + " is already on this quote; change its quantity instead");
    }

    /** The quantity a new quoted package gets (at least 1). */
    public static int quantity(Number requested) {
        return requested == null ? 1 : Math.max(1, requested.intValue());
    }

    /** A new price or quantity for a quoted package. */
    public static void checkChange(QuoteVersion v, BigDecimal price, Long quantity) {
        if (price != null && price.signum() < 0) throw RuleException.database("The package price cannot be negative");
        if (quantity != null && quantity < 1) throw RuleException.database("The quantity is at least 1");
        v.requireEditable(LOCKED);
    }

    /**
     * The package price shared out over its tests in proportion to their current prices (all equal when they have none);
     * each share rounded to the cent, the last one taking what is left.
     */
    public static List<BigDecimal> allocate(BigDecimal price, List<BigDecimal> currentPrices) {
        BigDecimal sum = BigDecimal.ZERO;
        for (BigDecimal p : currentPrices) sum = sum.add(p == null ? BigDecimal.ZERO : p);
        List<BigDecimal> out = new ArrayList<>();
        BigDecimal left = price;
        int n = currentPrices.size();
        for (int i = 0; i < n; i++) {
            BigDecimal fp = currentPrices.get(i) == null ? BigDecimal.ZERO : currentPrices.get(i);
            BigDecimal share = i == n - 1 ? left
                : sum.signum() == 0 ? Amount.round(price.divide(BigDecimal.valueOf(n), 20, RoundingMode.HALF_UP), 2)
                : Amount.round(price.multiply(fp).divide(sum, 20, RoundingMode.HALF_UP), 2);
            if (share.signum() < 0) share = BigDecimal.ZERO;
            out.add(share);
            left = left.subtract(share);
        }
        return out;
    }
}
