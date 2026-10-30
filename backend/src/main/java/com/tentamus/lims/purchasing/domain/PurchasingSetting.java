package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;

/** A lab's purchasing settings: the amount above which a request needs a second approval (none: never). */
public final class PurchasingSetting {
    private PurchasingSetting() {}

    public static void checkSecondApprovalOver(BigDecimal over) {
        if (over != null && over.signum() < 0) throw RuleException.withCode("The amount cannot be negative.", "23514");
    }
}
