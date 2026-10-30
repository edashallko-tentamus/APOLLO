package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;

/**
 * One stock movement on a lot (Receipt, Usage, Adjustment, Transfer Out, Disposal). Movements are never edited: a
 * correction is an Adjustment. Quantity on hand is their sum and may go negative.
 *
 * <p>Java's own copy of the database trigger inventory_txn_rules, which stays because the bench (entry_material),
 * mixtures and purchasing write movements through it.
 *
 * @param quantity the signed change: Usage, Transfer Out and Disposal are taken off
 */
public record StockMovement(String lotId, String type, BigDecimal quantity, String relatedLotId, String reference, String notes, String reason) {

    /** A movement about to be recorded on a lot: checked against the lot, signed by its type. */
    public static StockMovement record(Lot lot, String type, BigDecimal quantity, String reference, String notes, String reason, LocalDate today) {
        if (quantity == null || quantity.signum() == 0) throw RuleException.withCode("Enter a quantity other than zero.", "23514");
        lot.assertMovable();
        BigDecimal q = quantity;
        switch (type) {
            case "Receipt" -> { if (q.signum() < 0) throw RuleException.database("A receipt adds stock"); }
            case "Usage", "Transfer Out", "Disposal" -> {
                if (q.signum() > 0) q = q.negate();
                if (type.equals("Usage")) lot.assertUsable(today);
            }
            case "Adjustment" -> {
                if (reason == null || reason.isBlank()) throw RuleException.database("An adjustment needs a reason (for example a stock count)");
            }
            default -> throw RuleException.database("Unknown movement type: " + type);
        }
        return new StockMovement(lot.id(), type, q, null, reference, notes, reason);
    }

    /** Movements are append-only. */
    public static void assertNotEdited() {
        throw RuleException.database("Stock movements cannot be edited; record an Adjustment to correct one");
    }
}
