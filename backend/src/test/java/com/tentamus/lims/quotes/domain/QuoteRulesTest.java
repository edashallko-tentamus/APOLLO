package com.tentamus.lims.quotes.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The quoting rules moved out of the database in migration 061 (they were checked by test_002, test_024, test_026 and test_041). */
class QuoteRulesTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 29);

    static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    static QuoteVersion version(String status) {
        return new QuoteVersion("V1", "P1", "C1", "S1", "Quote", false, status, "2026-11-30", "n");
    }

    @Test
    void statusMoves() {
        QuoteVersion draft = version("Draft");
        QuoteVersion.Readiness ok = new QuoteVersion.Readiness(2, 0, true);
        assertNull(refusal(() -> draft.checkMove("Quoted", null, ok, TODAY)));
        assertEquals("Cannot quote a project version with no tests", refusal(() -> draft.checkMove("Quoted", null, new QuoteVersion.Readiness(0, 0, true), TODAY)));
        assertEquals("Every test line needs a Final Price before the version can be quoted",
            refusal(() -> draft.checkMove("Quoted", null, new QuoteVersion.Readiness(2, 1, true), TODAY)));
        assertEquals("Project version cannot move from Draft to Accepted", refusal(() -> draft.checkMove("Accepted", null, ok, TODAY)));
        QuoteVersion quoted = version("Quoted");
        assertEquals("Quote must be accepted by an active contact of this client",
            refusal(() -> quoted.checkMove("Accepted", "2026-11-30", new QuoteVersion.Readiness(2, 0, false), TODAY)));
        assertEquals("Quote expired on 2026-10-01; it cannot be accepted", refusal(() -> quoted.checkMove("Accepted", "2026-10-01", ok, TODAY)));
        assertNull(refusal(() -> quoted.checkMove("Accepted", "2026-11-30", ok, TODAY)));
        assertNull(refusal(() -> quoted.checkMove("Rejected", null, ok, TODAY)));
        assertEquals("Project version cannot move from Rejected to Quoted", refusal(() -> version("Rejected").checkMove("Quoted", null, ok, TODAY)));
    }

    @Test
    void quotedVersionIsLocked() {
        QuoteVersion quoted = version("Quoted");
        assertFalse(quoted.editable());
        assertTrue(version("Submitted for Quote").editable());
        assertEquals("A Quoted project version is locked; create a new version to change it", refusal(() -> quoted.checkDetails(m("notes", "other"))));
        assertNull(refusal(() -> quoted.checkDetails(m("valid_until", "2026-11-30", "notes", "n"))));
        QuoteLine line = new QuoteLine("L1", "T1", null);
        assertEquals(QuoteLine.LOCKED, refusal(() -> line.checkChange(quoted, m("final_price", 1))));
        assertEquals("Analyte selections are locked once a version is quoted", refusal(() -> QuoteTerms.checkAnalyteChoice(quoted, false)));
        assertEquals("Rush terms are locked once a version is quoted", refusal(() -> QuoteTerms.checkRushTerm(quoted, m("discount_pct", 50))));
    }

    @Test
    void quoteLines() {
        QuoteVersion draft = version("Draft");
        assertEquals("Test is retired or has no catalogue pricing; it cannot be quoted", refusal(() -> QuoteLine.checkNew(draft, false, m())));
        assertNull(refusal(() -> QuoteLine.checkNew(draft, true, m("quantity", 3, "final_price", "10.50"))));
        assertEquals("The quantity must be at least 1.", refusal(() -> QuoteLine.checkNew(draft, true, m("quantity", 0))));
        QuoteLine line = new QuoteLine("L1", "T1", null);
        assertEquals("The test on a line cannot be changed; remove the line and add a new one", refusal(() -> line.checkChange(draft, m("test_id", "T2"))));
        assertEquals("The final price cannot be negative.", refusal(() -> line.checkChange(draft, m("final_price", -1))));
        assertEquals("This test is part of package PKG-0001: change the package's price or quantity, or remove the package",
            refusal(() -> new QuoteLine("L2", "T1", "PKG-0001").checkChange(draft, m("final_price", 10))));
        assertEquals("The analytes of a test in a package are set in the package (Test catalogue)", refusal(() -> QuoteTerms.checkAnalyteChoice(draft, true)));
        assertEquals("A rush discount is between 0 and 100 %.", refusal(() -> QuoteTerms.checkRushTerm(draft, m("discount_pct", 101))));
        assertNull(refusal(() -> QuoteTerms.checkRushTerm(draft, m("discount_pct", 100))));
    }

    @Test
    void projects() {
        assertEquals("The quote's contact must be an active contact of the client", refusal(() -> Project.checkQuoteContact("CT", false)));
        assertNull(refusal(() -> Project.checkQuoteContact(null, false)));
        assertEquals("Give the project a name.", refusal(() -> Project.check(m("project_name", "  "), true)));
        // a quote never becomes a project and stays with its lab: Java never writes kind or site_id after the insert
        assertFalse(Project.EDITABLE.contains("kind") || Project.EDITABLE.contains("site_id") || Project.NEW.contains("kind"));
    }

    @Test
    void subcontractedPriceFollowsThe2030Rule() {
        // $100 at TPS, quoted from CFL: cost $80, client price $104
        SubcontractPrice p = SubcontractPrice.of(new BigDecimal("100.00"), BigDecimal.valueOf(20), BigDecimal.valueOf(30));
        assertEquals(0, p.cost().compareTo(new BigDecimal("80.00")));
        assertEquals(0, p.price().compareTo(new BigDecimal("104.00")));
        assertEquals(0, SubcontractPrice.of(new BigDecimal("33.33"), BigDecimal.valueOf(20), BigDecimal.valueOf(30)).price().compareTo(new BigDecimal("34.66")));
    }
}
