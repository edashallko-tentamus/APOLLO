package com.tentamus.lims.invoicing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Locale;

/**
 * A line of a draft invoice: a test's or a charge's. Its price and late rush are checked here. Replaces
 * set_invoice_line_price and set_invoice_line_rush (migration 069).
 */
public record InvoiceLine(String id, String invoiceId, String kind, String status, String requestedTestId, BigDecimal listPrice, BigDecimal quotedPrice,
                          BigDecimal price, String rushTierId, BigDecimal rushFee, BigDecimal rushOrderedFee, Integer lateDays, BigDecimal amount) {
    private static final DateTimeFormatter DUE = DateTimeFormatter.ofPattern("MMM dd, yyyy", Locale.ENGLISH);

    public boolean active() { return "Active".equals(status); }

    public boolean credit() { return "Credit".equals(kind); }

    /** Only an active charge line of a draft is changed. */
    public void checkChangeable() {
        if (!active() || !"Charge".equals(kind)) throw RuleException.database("Invoice line not found");
    }

    /** One rush option of the test on the client's quote (tierId null = standard). */
    public record RushOption(String tierId, String tierName, boolean ordered, boolean met, BigDecimal fee, LocalDate dueDate) {}

    /** What a line becomes. */
    public record Change(BigDecimal price, String priceNote, String rushTierId, String rushBilled, BigDecimal rushFee, String rushNote, BigDecimal amount) {}

    /**
     * Bills another rush tier: the one ordered, one whose turnaround was met, or standard; never a dearer one; a note
     * says why when it is not the one ordered.
     *
     * @param option the option asked for, null when it is not one of the test's options
     */
    public Change rush(RushOption option, String note) {
        if (option == null) throw RuleException.database("That rush tier is not one of this test's options on the client's quote");
        if (!option.ordered() && !option.met())
            throw RuleException.database(option.tierName() + " was not met either (due " + (option.dueDate() == null ? "" : DUE.format(option.dueDate()))
                + "): bill a tier whose turnaround was met, or standard");
        if (!option.ordered() && option.tierId() != null && rushOrderedFee != null && option.fee().compareTo(rushOrderedFee) > 0)
            throw RuleException.database("A tier dearer than the one ordered is not billed");
        String why = Invoice.text(note);
        if (!option.ordered() && why == null)
            throw RuleException.database("Say why the rush is billed differently (for example: reported " + (lateDays == null ? "" : lateDays) + " days late)");
        return new Change(price, null, option.tierId(), option.tierId() == null ? null : option.tierName(), option.fee(),
            option.ordered() ? null : why, price.add(option.fee()));
    }

    /** The rush term on the quote for the line's tier (a percentage follows the price billed). */
    public record RushTerm(String surchargeType, BigDecimal surchargeValue, BigDecimal discountPct) {
        BigDecimal feeFor(BigDecimal price) {
            BigDecimal base = "Flat".equals(surchargeType) ? surchargeValue : price.multiply(surchargeValue).divide(BigDecimal.valueOf(100), 20, RoundingMode.HALF_UP);
            return base.multiply(BigDecimal.ONE.subtract(discountPct.divide(BigDecimal.valueOf(100), 20, RoundingMode.HALF_UP))).setScale(2, RoundingMode.HALF_UP);
        }
    }

    /**
     * Corrects the price billed: never negative, never above the list price, a note when it differs from the order.
     *
     * @param term the quote's rush term for the line's tier, or null
     */
    public Change reprice(BigDecimal asked, String note, RushTerm term) {
        if (asked == null || asked.signum() < 0) throw RuleException.database("The price cannot be negative");
        if (asked.compareTo(listPrice) > 0 && listPrice.signum() > 0) throw RuleException.database("The price cannot be above the list price (" + listPrice.toPlainString() + ")");
        String why = Invoice.text(note);
        if (asked.compareTo(quotedPrice) != 0 && why == null) throw RuleException.database("Say why the price differs from the order (" + quotedPrice.toPlainString() + ")");
        BigDecimal p = asked.setScale(2, RoundingMode.HALF_UP);
        BigDecimal fee = term != null ? term.feeFor(asked) : rushTierId == null ? BigDecimal.ZERO : rushFee;
        return new Change(p, p.compareTo(quotedPrice) == 0 ? null : (note == null ? "" : note.strip()), rushTierId, null, fee, null, p.add(fee));
    }
}
