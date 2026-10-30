package com.tentamus.lims.quotes.service;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.Answers;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The quotation page as quotes.js wrote it (prices, discount, turnaround, labs, rush terms). */
class QuoteDocumentTest {
    static Map<String, Object> line(String lab, String name, String total) {
        return Answers.map("test_name", name, "site_name", lab, "quantity", 2, "list_price", new BigDecimal("100.00"), "final_price", new BigDecimal("90.00"),
            "discount_pct", new BigDecimal("10.00"), "line_total", new BigDecimal(total), "standard_tat", 5, "tat_unit", "Business Days", "pricing_mode", "Base Price Only");
    }

    @Test
    void quotationPage() {
        Map<String, Object> v = Answers.map("project_code", "Q-00001", "version_no", 1, "quoted_at", "2026-10-14T17:00:00.000Z", "valid_until", "2026-11-13",
            "client_legal_name", "Acme & Co", "owner_name", "Sam", "kind", "Quote", "project_name", "Spring testing");
        Map<String, Object> rush = Answers.map("schedule_name", "Standard rush", "tier_name", "48 h", "rush_tat", 2, "tat_unit", "Calendar Days",
            "surcharge_type", "Percent", "surcharge_value", new BigDecimal("50.00"), "discount_pct", BigDecimal.ZERO);
        String h = QuoteDocument.html(Answers.map("v", v, "lines", List.of(line("CFL", "Lead", "180.00"), line("TPS", "Assay", "180.00")), "rush", List.of(rush),
            "packages", List.of(), "charges", List.of()), true);
        assertTrue(h.contains("PREVIEW: not issued"));
        assertTrue(h.contains("Q-00001 · version 1<br>Issued: Oct 14, 2026<br>Valid until: Nov 13, 2026"));
        assertTrue(h.contains("Acme &amp; Co"));
        assertTrue(h.contains("<td class=\"n\">10.0%</td>"));
        assertTrue(h.contains("5 business days"));
        assertTrue(h.contains("<tr class=\"lab\"><td colspan=\"7\">CFL</td></tr>"));
        assertTrue(h.contains("Subtotal, TPS</td><td class=\"n\">$180.00</td>"));
        assertTrue(h.contains("List value $400.00</span><span>You save $40.00</span><span class=\"big\">Total $360.00"));
        assertTrue(h.contains("<td class=\"n\">50% of price</td><td class=\"n\">-</td>"));
        assertTrue(h.contains("<div><b>Reference</b>Spring testing</div>"));
    }
}
