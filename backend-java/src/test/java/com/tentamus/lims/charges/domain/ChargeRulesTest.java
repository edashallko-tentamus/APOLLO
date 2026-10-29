package com.tentamus.lims.charges.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.quotes.domain.QuoteVersion;
import java.math.BigDecimal;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The charge rules moved out of the database in migration 061 (they were checked by test_051), and the order charge rules Java checks first. */
class ChargeRulesTest {
    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static QuoteVersion version(String status) { return new QuoteVersion("V1", "P1", "C1", "CFL", "Quote", false, status, null, null); }

    @Test
    void chargesInTheCatalogueAndOnQuotes() {
        assertNotNull(refusal(() -> Charge.checkItem("Kit", new BigDecimal("-5"))));
        assertEquals("Give the charge a name.", refusal(() -> Charge.checkItem(" ", BigDecimal.ONE)));
        assertNull(refusal(() -> Charge.checkItem("Courier", new BigDecimal("25"))));
        assertEquals("Charges are locked once a version is quoted; create a new version",
            refusal(() -> Charge.checkAddToQuote(version("Quoted"), "Active", Map.of())));
        assertEquals("That charge is retired", refusal(() -> Charge.checkAddToQuote(version("Draft"), "Retired", Map.of())));
        assertEquals("The quantity must be at least 1.", refusal(() -> Charge.checkAddToQuote(version("Draft"), "Active", Map.of("quantity", 0))));
        assertEquals("Charges are locked once a version is quoted; create a new version", refusal(() -> Charge.checkQuoteChange(version("Accepted"), Map.of())));
    }

    @Test
    void chargesOnAnOrder() {
        BigDecimal p = new BigDecimal("40");
        assertEquals("That sample is on another order", refusal(() -> OrderCharge.checkNew("O1", "CFL", "S1", "O2", "Active", null, p, null, false)));
        assertEquals("That charge belongs to another lab", refusal(() -> OrderCharge.checkNew("O1", "CFL", null, null, "Active", "TPS", p, null, false)));
        assertEquals("That charge is retired", refusal(() -> OrderCharge.checkNew("O1", "CFL", null, null, "Retired", null, p, null, false)));
        assertEquals("Say why this charge is not at its price", refusal(() -> OrderCharge.checkNew("O1", "CFL", null, null, "Active", null, p, new BigDecimal("30"), false)));
        assertNull(refusal(() -> OrderCharge.checkNew("O1", "CFL", null, null, "Active", null, p, new BigDecimal("40"), false)));
        assertEquals("Charge OC-000001 is on an invoice: change it there (draft) or with a credit note",
            refusal(() -> new OrderCharge("1", "OC-000001", "O1", "Active", true).checkChange(true, true)));
        assertEquals("A cancelled charge is kept as it was", refusal(() -> new OrderCharge("1", "OC-000001", "O1", "Cancelled", false).checkChange(false, true)));
        assertEquals("A Reason for Change is required to change or cancel a charge",
            refusal(() -> new OrderCharge("1", "OC-000001", "O1", "Active", false).checkChange(true, false)));
    }
}
