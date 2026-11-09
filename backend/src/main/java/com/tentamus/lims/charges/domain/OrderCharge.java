package com.tentamus.lims.charges.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.math.BigDecimal;
import java.util.Objects;

/**
 * A charge on a lab order (OC-000001), billable once added, with its signed amounts (a discount is negative) and the
 * client's quoted price. Replaces the rule parts of order_charge_rules and the CHECK on its quantity (migration 069);
 * the permission check stays in the database. Its order, item and source never change because Java never writes them
 * after the insert.
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

    /** A discount is taken off: its amounts are negative. */
    public static int sign(String kind) { return "Discount".equals(kind) ? -1 : 1; }

    /** A typed price is a positive amount; a discount's is taken off. */
    public static BigDecimal signed(String kind, BigDecimal typed) { return typed == null ? null : typed.abs().multiply(BigDecimal.valueOf(sign(kind))); }

    /** What a new charge costs: the item's price (signed), and the client's: typed, else quoted, else the item's. */
    public record Price(BigDecimal listPrice, BigDecimal unitPrice, String quotedChargeId) {}

    /**
     * @param clientPrice    the client's accepted quote price for the item, or null
     * @param quotedChargeId that quote's charge line, or null
     */
    public static Price price(String kind, BigDecimal itemPrice, BigDecimal typed, BigDecimal clientPrice, String quotedChargeId) {
        BigDecimal list = itemPrice.multiply(BigDecimal.valueOf(sign(kind)));
        if (typed != null) return new Price(list, signed(kind, typed), null);
        if (quotedChargeId != null) return new Price(list, clientPrice.multiply(BigDecimal.valueOf(sign(kind))), quotedChargeId);
        return new Price(list, list, null);
    }

    public static void checkQuantity(Object quantity) { Amount.atLeastOne(quantity, "The quantity must be at least 1."); }
}
