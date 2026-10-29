package com.tentamus.lims.charges.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.math.BigDecimal;
import java.util.Objects;

/**
 * A charge on a lab order (OC-000001), billable once added. Java checks its rules first; the database trigger
 * order_charge_rules keeps them too (with the signed amounts and the client's quoted price), because Invoicing's
 * database functions still add charges to draft invoices through it.
 *
 * @param invoiced the charge is on a draft or issued invoice
 */
public record OrderCharge(String id, String chargeNo, String orderId, String status, boolean invoiced) {

    /**
     * A new charge on the order.
     *
     * @param sampleOrderId the order of the chosen sample, or null when no sample is chosen
     * @param itemStatus    null when the charge does not exist
     * @param typedPrice    the price typed, or null for the client's price
     */
    public static void checkNew(String orderId, String orderSiteId, String sampleId, String sampleOrderId, String itemStatus, String itemSiteId,
                                BigDecimal itemPrice, BigDecimal typedPrice, boolean reasonGiven) {
        if (sampleId != null && !Objects.equals(sampleOrderId, orderId)) throw RuleException.database("That sample is on another order");
        if (!"Active".equals(itemStatus)) throw RuleException.database("That charge is retired");
        if (itemSiteId != null && !itemSiteId.equals(orderSiteId)) throw RuleException.database("That charge belongs to another lab");
        if (typedPrice != null && typedPrice.abs().compareTo(itemPrice.abs()) != 0 && !reasonGiven) throw RuleException.database("Say why this charge is not at its price");
    }

    /** A change of quantity, price or note, or cancelling it. */
    public void checkChange(boolean changesAmountOrStatus, boolean reasonGiven) {
        if ("Cancelled".equals(status)) throw RuleException.database("A cancelled charge is kept as it was");
        if (invoiced && changesAmountOrStatus)
            throw RuleException.database("Charge " + chargeNo + " is on an invoice: change it there (draft) or with a credit note");
        if (changesAmountOrStatus && !reasonGiven) throw RuleException.database("A Reason for Change is required to change or cancel a charge");
    }

    public static void checkQuantity(Object quantity) { Amount.atLeastOne(quantity, "The quantity must be at least 1."); }
}
