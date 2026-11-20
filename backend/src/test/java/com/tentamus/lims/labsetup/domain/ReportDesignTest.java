package com.tentamus.lims.labsetup.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.invoicing.service.InvoiceDocument;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The report designer's rules (migration 074): what a design may hold, approval, taking a shared template from a lab. */
class ReportDesignTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> blocks(Map<String, Object> d) { return (List<Map<String, Object>>) d.get("blocks"); }

    @Test
    void theStandardDesignsPass() {
        assertNull(refusal(() -> ReportDesign.check("COA", ReportDesign.defaults("COA"))));
        assertNull(refusal(() -> ReportDesign.check("Invoice", ReportDesign.defaults("Invoice"))));
    }

    @Test
    void templatesFromBefore074KeepTheirOptionsAndPhotos() {
        Map<String, Object> d = ReportDesign.normalize("COA", Map.of("layout", "COA with 2 photos", "options", Map.of("show_loq", false, "title", "Short COA")));
        assertEquals("Short COA", d.get("title"));
        assertEquals(2, ReportDesign.photoCount(d));
        Map<String, Object> tests = blocks(d).stream().filter(b -> "tests".equals(b.get("type"))).findFirst().orElseThrow();
        assertEquals(false, tests.get("show_loq"));
        assertEquals(true, tests.get("show_method"));
        assertEquals(ReportDesign.defaults("COA"), ReportDesign.normalize("COA", null));
        assertNull(refusal(() -> ReportDesign.check("COA", d)));
    }

    @Test
    void aCoaDesignKeepsItsRequiredBlocksOnce() {
        Map<String, Object> d = new HashMap<>(ReportDesign.defaults("COA"));
        List<Map<String, Object>> noTests = new ArrayList<>(blocks(d));
        noTests.removeIf(b -> "tests".equals(b.get("type")));
        d.put("blocks", noTests);
        assertEquals("The design needs exactly one Test results block", refusal(() -> ReportDesign.check("COA", d)));
        List<Map<String, Object>> twoClients = new ArrayList<>(blocks(ReportDesign.defaults("COA")));
        twoClients.add(twoClients.get(0));
        d.put("blocks", twoClients);
        assertEquals("The design needs exactly one Client block", refusal(() -> ReportDesign.check("COA", d)));
    }

    @Test
    void nothingOutsideTheFixedChoices() {
        Map<String, Object> d = new HashMap<>(ReportDesign.defaults("COA"));
        d.put("html", "<script>alert(1)</script>");
        assertEquals("Unknown design setting \"html\"", refusal(() -> ReportDesign.check("COA", d)));
        Map<String, Object> white = new HashMap<>(ReportDesign.defaults("COA"));
        white.put("theme", Map.of("font", "Sans serif", "size", 10, "accent", "#ffffff"));
        assertEquals("Pick an accent colour from the list", refusal(() -> ReportDesign.check("COA", white)));
        Map<String, Object> tiny = new HashMap<>(ReportDesign.defaults("COA"));
        tiny.put("theme", Map.of("font", "Sans serif", "size", 2, "accent", "#1f3a2c"));
        assertEquals("Text size is 9, 10 or 11 points", refusal(() -> ReportDesign.check("COA", tiny)));
        Map<String, Object> iframe = new HashMap<>(ReportDesign.defaults("COA"));
        List<Map<String, Object>> b = new ArrayList<>(blocks(iframe));
        b.add(Map.of("type", "iframe"));
        iframe.put("blocks", b);
        assertEquals("Unknown block \"iframe\"", refusal(() -> ReportDesign.check("COA", iframe)));
        Map<String, Object> lot = new HashMap<>(ReportDesign.defaults("COA"));
        List<Map<String, Object>> hideLot = new ArrayList<>(blocks(lot));
        hideLot.set(1, Map.of("type", "sample", "fields", Map.of("lot", false)));
        lot.put("blocks", hideLot);
        assertEquals("Unknown field \"lot\"", refusal(() -> ReportDesign.check("COA", lot)));
    }

    @Test
    void approvalIsNeverByAnAuthor() {
        assertNull(refusal(() -> ReportTemplate.checkApproval("Draft", "qa", Set.of("designer"))));
        assertEquals("You worked on this version: someone else approves it", refusal(() -> ReportTemplate.checkApproval("Draft", "designer", Set.of("designer"))));
        assertEquals("Only a draft version can be approved", refusal(() -> ReportTemplate.checkApproval("Effective", "qa", Set.of("designer"))));
    }

    @Test
    void aLabStillUsingASharedTemplateKeepsIt() {
        assertNull(refusal(() -> ReportTemplate.checkWithdraw(false, List.of())));
        assertEquals("The lab still uses this template (it is the lab's default; these tests print with it: HM-01 v2). Change those first",
            refusal(() -> ReportTemplate.checkWithdraw(true, List.of("HM-01 v2"))));
    }

    @Test
    void theInvoiceFollowsItsDesign() {
        Map<String, Object> inv = new HashMap<>(Map.of("status", "Issued", "kind", "Invoice", "invoice_number", "INV-CFL-000001", "site_name", "Lab", "order_code", "LO-1",
            "legal_name", "Client", "total", 10, "list_total", 10, "discount_total", 0, "rush_total", 0));
        Map<String, Object> d = new HashMap<>(ReportDesign.defaults("Invoice"));
        d.put("title", "Tax invoice");
        d.put("show_list_price", false);
        d.put("company_line", "Example Group");
        String h = InvoiceDocument.html(new InvoiceDocument.Data(inv, List.of()), false, null, d);
        assertTrue(h.contains("<h1>Tax invoice</h1>"));
        assertFalse(h.contains("List price</th>"));
        assertTrue(h.contains("Example Group"));
        assertTrue(InvoiceDocument.html(new InvoiceDocument.Data(inv, List.of()), false, null).contains("List price</th>"));
    }
}
