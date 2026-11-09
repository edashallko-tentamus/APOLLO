package com.tentamus.lims.invoicing.service;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.Answers;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The invoice page as invoices.js wrote it (money, discounts, late rush, retests, a credit note's signs). */
class InvoiceDocumentTest {
    static Map<String, Object> inv(String kind, String status) {
        return Answers.map("kind", kind, "status", status, "invoice_number", "INV-CFL-000001", "draft_code", "DR-00001", "site_name", "CFL", "order_code", "LO-000001",
            "legal_name", "Acme Inc", "payment_terms_days", 30, "invoice_date", "2026-10-16", "due_date", "2026-11-15", "list_total", new BigDecimal("1234.50"),
            "discount_total", new BigDecimal("100.00"), "rush_total", BigDecimal.ZERO, "total", new BigDecimal("1134.50"), "po_number", "PO-1");
    }

    static Map<String, Object> line() {
        return Answers.map("sample_code", "CFL261016001", "test_name", "Lead <ICP>", "completed_on", "2026-10-15", "list_price", new BigDecimal("1234.50"),
            "price", new BigDecimal("1134.50"), "rush_fee", BigDecimal.ZERO, "amount", new BigDecimal("1134.50"), "retest_of_id", "x",
            "rush_ordered", "48 h", "rush_billed", null, "late_days", 2, "due_date", "2026-10-13");
    }

    @Test
    void invoicePage() {
        String h = InvoiceDocument.html(new InvoiceDocument.Data(inv("Invoice", "Issued"), List.of(line())), false, null);
        assertTrue(h.contains("<td class=\"n\">$1,234.50</td>"));
        assertTrue(h.contains("<td class=\"n\">$100.00</td>"));
        assertTrue(h.contains("<span>Discounts</span><span>-$100.00</span>"));
        assertTrue(h.contains("Lead &lt;ICP&gt;"));
        assertTrue(h.contains("<tr class=\"retest\">"));
        assertTrue(h.contains("Rush ordered: 48 h, due Oct 13, 2026; reported Oct 15, 2026 (2 working days late)."));
        assertTrue(h.contains("Billed without a rush fee."));
        assertTrue(h.contains("Due: Nov 15, 2026"));
        assertTrue(h.contains("<div><b>Terms</b>Net 30 days</div>"));
        assertFalse(h.contains("DRAFT: not issued"));
    }

    @Test
    void creditNoteNegatesAmounts() {
        String h = InvoiceDocument.html(new InvoiceDocument.Data(inv("Credit note", "Issued"), List.of(line())), false, null);
        assertTrue(h.contains("<h1>Credit note</h1>"));
        assertTrue(h.contains("<td class=\"n\">-$1,234.50</td>"));
        assertTrue(h.contains("Total credited"));
    }

    @Test
    void correctedCopyBanner() {
        String h = InvoiceDocument.html(new InvoiceDocument.Data(inv("Invoice", "Issued"), List.of()), false, new InvoiceDocument.Corrected(null, "PO-2", "2026-10-20T17:00:00.000Z"));
        assertTrue(h.contains("CORRECTED COPY (Oct 20, 2026): the PO number has changed from none to PO-2."));
    }
}
