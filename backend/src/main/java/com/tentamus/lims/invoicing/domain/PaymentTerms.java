package com.tentamus.lims.invoicing.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A client's payment terms (days after the invoice date), kept by the people who issue invoices. Replaces
 * set_client_payment_terms, the trigger client_payment_terms_rule and the CHECK on client.payment_terms_days (migration 069).
 */
public final class PaymentTerms {
    private PaymentTerms() {}

    /** @param days the whole number typed, null when it is not a number */
    public static int check(boolean mayChange, Long days) {
        if (days == null) throw RuleException.withCode("invalid input syntax for type integer: \"NaN\"", "22P02");   // as the database refused it
        if (!mayChange) throw RuleException.database("Only people who issue invoices (invoicing.issue) change a client's payment terms");
        if (days < 0 || days > 365) throw RuleException.database("Payment terms are 0 to 365 days");
        return days.intValue();
    }
}
