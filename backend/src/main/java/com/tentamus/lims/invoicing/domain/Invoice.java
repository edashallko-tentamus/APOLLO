package com.tentamus.lims.invoicing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Objects;

/**
 * An invoice or credit note: a Draft claimed by the person checking it (DR-...), then Issued (INV-/CN-<lab>-000001) or
 * Discarded. Replaces claim_invoice_work, claim_invoice_charges, update_invoice_draft, remove_invoice_lines,
 * release_invoice_draft, add_invoice_charge and record_invoice_payment (migration 069). Issuing, credit notes and PO
 * corrections make PDFs and stay in the Node backend with their database functions; the database keeps invoice_rules
 * (an issued invoice never changes) as their backstop.
 */
public record Invoice(String id, String draftCode, String invoiceNumber, String siteId, String labOrderId, String kind, String status,
                      String claimedBy, String claimedByName, LocalDate invoiceDate) {

    /** Its number once issued, else its draft code. */
    public String code() { return invoiceNumber != null ? invoiceNumber : draftCode; }

    /** A draft can be changed. Checked before the invoicing.issue permission. */
    public void checkDraft() {
        if (!"Draft".equals(status)) throw RuleException.database(code() + " is " + status.toLowerCase() + " and cannot be changed");
    }

    /** Only the person checking a draft changes or issues it. Checked after the permission. */
    public void checkHolder(String me) {
        if (!Objects.equals(claimedBy, me)) throw RuleException.database(draftCode + " is being checked by " + claimedByName + ": only they change or issue it");
    }

    /**
     * Its claimer releases a draft; anyone else must be a lab administrator and say why.
     *
     * @return true when the claimer releases it (who then needs invoicing.issue)
     */
    public boolean checkRelease(String me, boolean labAdmin, String reason) {
        if (!"Draft".equals(status)) throw RuleException.database(code() + " is " + status.toLowerCase() + " already");
        if (Objects.equals(claimedBy, me)) return true;
        if (!labAdmin) throw RuleException.database(draftCode + " is being checked by " + claimedByName + ": only they, or a lab administrator, can release it");
        if (reason == null || reason.isEmpty() || "Draft invoice released".equals(reason)) throw RuleException.database("Say why you release someone else's draft");
        return false;
    }

    /** Only an issued invoice (not a credit note) is paid. Checked before the permission. */
    public void checkPayable() {
        if (!"Issued".equals(status)) throw RuleException.database("Only an issued invoice is paid");
        if (!"Invoice".equals(kind)) throw RuleException.database("A credit note is not paid");
    }

    /** The payment date (null clears the record): not in the future, not before the invoice date. */
    public void checkPaidOn(LocalDate paidOn, LocalDate today) {
        if (paidOn == null) return;
        if (paidOn.isAfter(today)) throw RuleException.database("The payment date cannot be in the future");
        if (invoiceDate != null && paidOn.isBefore(invoiceDate)) throw RuleException.database("The payment date cannot be before the invoice date");
    }

    /** Blank text kept as no text. */
    public static String text(String v) { return v == null || v.strip().isEmpty() ? null : v.strip(); }

    /** Claiming needs a choice. */
    public static void checkClaimChoice(int tests) {
        if (tests == 0) throw RuleException.database("Choose the completed work to invoice");
    }

    /** A test that is not ready to invoice: on a draft or invoice already (holderDraft set), or not complete. */
    public static RuleException notReady(String testName, String sampleCode, String holderDraft, String holderName) {
        return RuleException.database(testName + " on " + sampleCode + ": " + (holderDraft != null
            ? "already on a draft or invoice (" + holderDraft + (holderName != null ? ", " + holderName : "") + ")"
            : "not ready to invoice (its COA has not been issued, or it is not billed)"));
    }

    public static RuleException chargeNotReady(String chargeNo) {
        return RuleException.database("Charge " + chargeNo + " is not ready to invoice (cancelled, or on an invoice already)");
    }

    /** The draft's totals from its active lines. */
    public record Totals(BigDecimal list, BigDecimal discount, BigDecimal rush, BigDecimal total) {}

    public static Totals totals(List<InvoiceLine> lines) {
        BigDecimal list = BigDecimal.ZERO, discount = BigDecimal.ZERO, rush = BigDecimal.ZERO, total = BigDecimal.ZERO;
        for (InvoiceLine l : lines) {
            if (!l.active()) continue;
            BigDecimal sign = l.credit() ? BigDecimal.ONE.negate() : BigDecimal.ONE;
            list = list.add(sign.multiply(l.listPrice()));
            discount = discount.add(sign.multiply(l.listPrice().subtract(l.price())));
            rush = rush.add(sign.multiply(l.rushFee()));
            total = total.add(l.amount());
        }
        return new Totals(list, discount, rush, total);
    }

    /** A draft left with no active line is discarded. */
    public static boolean emptied(List<InvoiceLine> lines) { return lines.stream().noneMatch(InvoiceLine::active); }
}
