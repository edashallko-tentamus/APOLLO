package com.tentamus.lims.invoicing.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The invoicing rules moved out of the database in migration 069 (they were checked by test_031 and test_051). */
class InvoicingRulesTest {
    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static BigDecimal d(String v) { return new BigDecimal(v); }

    static Invoice inv(String status, String kind) {
        return new Invoice("I1", "DR-000001", "Issued".equals(status) ? "INV-CFL-000001" : null, "CFL", "O1", kind, status, "acc", "INV Accounting", LocalDate.of(2026, 10, 1));
    }

    static InvoiceLine line(String tier, BigDecimal rushFee) {
        return new InvoiceLine("L1", "I1", "Charge", "Active", "RT1", d("75.00"), d("67.50"), d("67.50"), tier, rushFee, d("20.00"), 8, d("67.50").add(rushFee));
    }

    @Test
    void draftsAndClaims() {
        assertEquals("Choose the completed work to invoice", refusal(() -> Invoice.checkClaimChoice(0)));
        assertEquals("WD Metals on S1: already on a draft or invoice (DR-000001, INV Accounting)", Invoice.notReady("WD Metals", "S1", "DR-000001", "INV Accounting").getMessage());
        assertEquals("WD Metals on S1: not ready to invoice (its COA has not been issued, or it is not billed)", Invoice.notReady("WD Metals", "S1", null, null).getMessage());
        assertEquals("Charge OC-000001 is not ready to invoice (cancelled, or on an invoice already)", Invoice.chargeNotReady("OC-000001").getMessage());
        assertEquals("INV-CFL-000001 is issued and cannot be changed", refusal(() -> inv("Issued", "Invoice").checkDraft()));
        assertEquals("DR-000001 is being checked by INV Accounting: only they change or issue it", refusal(() -> inv("Draft", "Invoice").checkHolder("acc2")));
        assertNull(refusal(() -> inv("Draft", "Invoice").checkHolder("acc")));
        assertEquals("DR-000001 is being checked by INV Accounting: only they, or a lab administrator, can release it",
            refusal(() -> inv("Draft", "Invoice").checkRelease("acc2", false, "x")));
        assertEquals("Say why you release someone else's draft", refusal(() -> inv("Draft", "Invoice").checkRelease("admin", true, "Draft invoice released")));
        assertFalse(inv("Draft", "Invoice").checkRelease("admin", true, "Away today"));
        assertTrue(inv("Draft", "Invoice").checkRelease("acc", false, "Draft invoice released"));
        assertEquals("DR-000001 is discarded already", refusal(() -> inv("Discarded", "Invoice").checkRelease("acc", false, "x")));
    }

    @Test
    void totals() {
        InvoiceLine a = new InvoiceLine("A", "I1", "Charge", "Active", "RT1", d("100"), d("90"), d("90"), null, d("0"), null, 0, d("90"));
        InvoiceLine b = new InvoiceLine("B", "I1", "Charge", "Active", "RT2", d("50"), d("50"), d("45"), "T1", d("10"), d("10"), 0, d("55"));
        InvoiceLine gone = new InvoiceLine("C", "I1", "Charge", "Removed", "RT3", d("500"), d("500"), d("500"), null, d("0"), null, 0, d("500"));
        Invoice.Totals t = Invoice.totals(List.of(a, b, gone));
        assertEquals(0, t.list().compareTo(d("150")));
        assertEquals(0, t.discount().compareTo(d("15")));
        assertEquals(0, t.rush().compareTo(d("10")));
        assertEquals(0, t.total().compareTo(d("145")));
        assertTrue(Invoice.emptied(List.of(gone)));
        assertFalse(Invoice.emptied(List.of(a, gone)));
    }

    @Test
    void priceAndLateRush() {
        InvoiceLine l = line("T7", d("20.00"));
        assertEquals("The price cannot be above the list price (75.00)", refusal(() -> l.reprice(d("999"), "x", null)));
        assertEquals("The price cannot be negative", refusal(() -> l.reprice(d("-1"), "x", null)));
        assertEquals("Say why the price differs from the order (67.50)", refusal(() -> l.reprice(d("60"), " ", null)));
        InvoiceLine.Change c = l.reprice(d("60"), "Discount corrected to the accepted quote", new InvoiceLine.RushTerm("Percent", d("50"), d("10")));
        assertEquals(0, c.price().compareTo(d("60.00")));
        assertEquals(0, c.rushFee().compareTo(d("27.00")));   // 60 x 50 % less a 10 % discount
        assertEquals(0, c.amount().compareTo(d("87.00")));
        assertEquals("Discount corrected to the accepted quote", c.priceNote());
        assertNull(l.reprice(d("67.50"), "", null).priceNote());
        assertEquals(0, l.reprice(d("67.50"), "", null).rushFee().compareTo(d("20.00")));

        InvoiceLine.RushOption t3 = new InvoiceLine.RushOption("T3", "3-day", false, false, d("40.00"), LocalDate.of(2026, 10, 5));
        InvoiceLine.RushOption t12 = new InvoiceLine.RushOption("T12", "12-day", false, true, d("10.00"), LocalDate.of(2026, 10, 20));
        InvoiceLine.RushOption dear = new InvoiceLine.RushOption("T1", "1-day", false, true, d("80.00"), LocalDate.of(2026, 10, 2));
        InvoiceLine.RushOption standard = new InvoiceLine.RushOption(null, "Standard (no rush fee)", false, true, d("0"), null);
        assertEquals("That rush tier is not one of this test's options on the client's quote", refusal(() -> l.rush(null, "x")));
        assertEquals("3-day was not met either (due Oct 05, 2026): bill a tier whose turnaround was met, or standard", refusal(() -> l.rush(t3, "late")));
        assertEquals("A tier dearer than the one ordered is not billed", refusal(() -> l.rush(dear, "x")));
        assertEquals("Say why the rush is billed differently (for example: reported 8 days late)", refusal(() -> l.rush(t12, "")));
        InvoiceLine.Change r = l.rush(t12, "Reported 8 business days late");
        assertEquals("12-day", r.rushBilled());
        assertEquals(0, r.amount().compareTo(d("77.50")));
        InvoiceLine.Change s = l.rush(standard, "Late: standard price");
        assertNull(s.rushTierId());
        assertNull(s.rushBilled());
        assertEquals(0, s.amount().compareTo(d("67.50")));
        assertEquals("Invoice line not found", refusal(() -> new InvoiceLine("L", "I", "Credit", "Active", null, d("1"), d("1"), d("1"), null, d("0"), null, 0, d("1")).checkChangeable()));
    }

    @Test
    void paymentsAndTerms() {
        LocalDate today = LocalDate.of(2026, 10, 20);
        assertEquals("Only an issued invoice is paid", refusal(() -> inv("Draft", "Invoice").checkPayable()));
        assertEquals("A credit note is not paid", refusal(() -> inv("Issued", "Credit note").checkPayable()));
        assertEquals("The payment date cannot be in the future", refusal(() -> inv("Issued", "Invoice").checkPaidOn(today.plusDays(1), today)));
        assertEquals("The payment date cannot be before the invoice date", refusal(() -> inv("Issued", "Invoice").checkPaidOn(LocalDate.of(2026, 9, 30), today)));
        assertNull(refusal(() -> inv("Issued", "Invoice").checkPaidOn(today, today)));
        assertNull(refusal(() -> inv("Issued", "Invoice").checkPaidOn(null, today)));
        assertEquals("Only people who issue invoices (invoicing.issue) change a client's payment terms", refusal(() -> PaymentTerms.check(false, 45L)));
        assertEquals("Payment terms are 0 to 365 days", refusal(() -> PaymentTerms.check(true, 400L)));
        assertEquals("Payment terms are 0 to 365 days", refusal(() -> PaymentTerms.check(true, -1L)));
        assertEquals(45, PaymentTerms.check(true, 45L));
        assertNotNull(refusal(() -> PaymentTerms.check(true, null)));
    }
}
