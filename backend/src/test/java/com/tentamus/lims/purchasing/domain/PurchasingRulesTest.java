package com.tentamus.lims.purchasing.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The purchasing and vendor approval rules moved out of the database in migration 065 (checked before by test_010,
 * test_020 and test_043), and Java's own copies of the purchase request rules the database keeps for inventory.
 */
class PurchasingRulesTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 29);
    private static final ScopeList SCOPES = new ScopeList(List.of(
        scope("S1", "Reference standards", 1, List.of("Reference Standard"), List.of("Inventory item"), null),
        scope("S4", "Reagents and solvents", 4, List.of("Reagent", "Solvent"), List.of("Inventory item"), null),
        scope("S5", "Consumables", 5, List.of("Consumable"), List.of("Inventory item", "Other"), null),
        scope("S6", "Equipment", 6, List.of(), List.of("Equipment"), "Equipment"),
        scope("S7", "Calibration services", 7, List.of(), List.of("Service"), null),
        scope("S10", "Other services", 10, List.of(), List.of("Service"), "Service"),
        scope("S11", "Other purchases", 11, List.of(), List.of("Other"), "Other"),
        new SupplyScope("SX", "Retired scope", 12, "Inactive", List.of(), List.of("Service"), null)));
    private static final RiskClass CLASS_II = new RiskClass("C2", null, "Class II", 24, "Active");
    private static final RiskClass CFL_IV = new RiskClass("C4", "CFL", "Class IV", 60, "Active");

    private static SupplyScope scope(String id, String name, int sort, List<String> types, List<String> lines, String def) {
        return new SupplyScope(id, name, sort, "Active", types, lines, def);
    }

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static PurchaseLine line(Object... more) {
        Map<String, Object> v = m("id", "L1", "line_code", "PR-000001", "site_id", "CFL", "line_type", "Other", "status", "Requested", "description", "Lab coats",
            "supplier_id", "SUP", "requested_by", "ana", "quantity", "2", "unit_price", "60", "received_quantity", "0", "unit", "box");
        for (int i = 0; i < more.length; i += 2) v.put((String) more[i], more[i + 1]);
        return PurchaseLine.of(v);
    }

    private static VendorQualification q(String id, String site, String status, LocalDate expires, List<String> scopes) {
        return new VendorQualification(id, "VQ-" + id, "SUP", site, status, TODAY.minusDays(10), expires, scopes, "Active", null);
    }

    private static PurchaseLine.Delivery delivery(String qty, boolean more) {
        return new PurchaseLine.Delivery(new BigDecimal(qty), more, "None", null, null, false, null, false);
    }

    // ------------------------------------------------------------ requests (Java's copy of purchase_line_rules)
    @Test
    void newRequests() {
        assertTrue(refusal(() -> PurchaseLine.checkNew("Inventory item")).contains("request inventory items from the Inventory page"));
        assertNull(refusal(() -> PurchaseLine.checkNew("Service")));
        assertEquals("Describe what is to be bought.", refusal(() -> PurchaseLine.checkValues(m("description", "  ", "quantity", 1), true)));
        assertEquals("Enter a quantity above zero.", refusal(() -> PurchaseLine.checkValues(m("description", "x", "quantity", 0), true)));
        assertEquals("The price cannot be negative.", refusal(() -> PurchaseLine.checkValues(m("description", "x", "quantity", 1, "unit_price", -1), true)));
        assertEquals("The web link must be a full web address starting with http:// or https://.",
            refusal(() -> PurchaseLine.checkValues(m("description", "x", "quantity", 1, "item_url", "not a link"), true)));
        assertNull(refusal(() -> PurchaseLine.checkValues(m("description", "x", "quantity", 1, "item_url", "https://example.com/sb-1000"), true)));
    }

    @Test
    void changingAndCancelling() {
        assertTrue(line("status", "Awaiting second approval", "approved_by", "sup").change(m("unit_price", "3500"), "ana", false),
            "a change after the first approval sends it back to Requested");
        assertFalse(line().change(m("status", "Cancelled"), "ana", false), "the requester can cancel");
        assertEquals("Request PR-000001 is cancelled and cannot be changed", refusal(() -> line("status", "Cancelled").change(m("quantity", "2"), "ana", false)));
        assertEquals("Use Approve, Reject, Order or Receive to move a request on", refusal(() -> line().change(m("status", "Approved"), "ana", true)));
        assertEquals("Use Approve, Reject, Order or Receive to move a request on", refusal(() -> line("status", "Ordered").change(m("status", "Cancelled"), "ana", true)));
        assertTrue(refusal(() -> line("status", "Approved").change(m("quantity", "3"), "ana", true)).startsWith("Request PR-000001 is already approved"));
        assertEquals("Only the requester or an approver can change or cancel request PR-000001", refusal(() -> line().change(m("quantity", "3"), "someone", false)));
        assertNull(refusal(() -> line().change(m("quantity", "3"), "someone", true)));
    }

    // ------------------------------------------------------------ approval and rejection
    @Test
    void approval() {
        assertEquals("You requested PR-000001 yourself, so someone else must approve it", refusal(() -> line().approve("ana", null)));
        assertEquals("Approved", line().approve("sup", new BigDecimal("1000")), "under the amount: approved");
        assertEquals("Awaiting second approval", line("unit_price", "4500", "quantity", "1").approve("sup", new BigDecimal("1000")), "over it: a second approval");
        assertEquals("Approved", line("unit_price", "4500").approve("sup", null), "no amount set: one approval");
        assertEquals("purchasing.approve_over", line("status", "Awaiting second approval").approvalPermission());
        assertEquals("You gave PR-000001 its first approval; the second approval must be someone else",
            refusal(() -> line("status", "Awaiting second approval", "approved_by", "gm1").approve("gm1", null)));
        assertEquals("Approved", line("status", "Awaiting second approval", "approved_by", "sup").approve("gm1", null));
        assertEquals("Request PR-000001 is ordered and cannot be approved", refusal(() -> line("status", "Ordered").approve("sup", null)));
        assertEquals("Say why the request is rejected", refusal(() -> PurchaseLine.checkRejectReason(" ")));
        assertEquals("Request PR-000001 is approved and cannot be rejected", refusal(() -> line("status", "Approved").assertRejectable()));
        assertNull(refusal(() -> line("status", "Awaiting second approval").assertRejectable()));
    }

    // ------------------------------------------------------------ purchase orders
    @Test
    void orders() {
        assertEquals("An order goes to one supplier: pick requests of the same supplier (give a supplier to any request without one)",
            refusal(() -> PurchaseLine.orderGroup(List.of(line(), line("id", "L2", "supplier_id", "OTHER")))));
        assertEquals("Pick approved requests of one lab", refusal(() -> PurchaseLine.orderGroup(List.of(line(), line("id", "L2", "site_id", "TPS")))));
        assertTrue(refusal(() -> PurchaseLine.orderGroup(List.of(line("supplier_id", null)))).startsWith("An order goes to one supplier"));
        assertEquals(new PurchaseLine.OrderGroup("CFL", "SUP"), PurchaseLine.orderGroup(List.of(line(), line("id", "L2"))));
        assertEquals("Request PR-000001 is requested: only approved requests can be ordered", refusal(() -> line().assertOrderable()));
        assertEquals("PO-CFL-00042", PurchaseOrder.code("CFL", 42));
        assertEquals(List.of("external_po_number", "confirmation_number", "notes"), PurchaseOrder.EDITABLE);
    }

    // ------------------------------------------------------------ receiving (moved: receive_purchase_line)
    @Test
    void receiving() {
        PurchaseLine acn = line("line_type", "Inventory item", "status", "Ordered", "quantity", "5", "lot_id", "LOT");
        PurchaseLine.Receipt part = acn.receive(delivery("2", true));
        assertEquals(new PurchaseLine.Receipt("Lot", true, new BigDecimal("3"), "Partly received"), part, "2 of 5 with more to come: a back-order for 3");
        PurchaseLine rest = line("line_type", "Inventory item", "status", "Partly received", "quantity", "5", "received_quantity", "2", "lot_id", "LOT2");
        assertEquals(new PurchaseLine.Receipt("Lot", false, BigDecimal.ZERO, "Received"), rest.receive(delivery("3", false)), "the back-order arrives");
        assertEquals("Received", acn.receive(delivery("2", false)).newStatus(), "nothing more to come: received");
        assertEquals("Request PR-000001 is received: only ordered requests can be received", refusal(() -> line("status", "Received").receive(delivery("1", false))));
        assertEquals("Enter the quantity received", refusal(() -> line("status", "Ordered").receive(delivery("-1", false))));
        assertEquals("Enter the quantity received", refusal(() -> acn.receive(delivery("0", false))));
        assertEquals("The actual price cannot be negative",
            refusal(() -> line("status", "Ordered").receive(new PurchaseLine.Delivery(BigDecimal.ONE, true, "None", null, new BigDecimal("-1"), false, null, false))));
        assertEquals("Describe the problem with the delivery (what was damaged, how warm it arrived, what was missing).",
            refusal(() -> line("status", "Ordered").receive(new PurchaseLine.Delivery(new BigDecimal("2"), false, "Damaged", "", null, false, null, false))));
        PurchaseLine viscometer = line("line_type", "Equipment", "status", "Ordered", "quantity", "1");
        assertEquals("Say what the equipment is and which group is responsible for it",
            refusal(() -> viscometer.receive(new PurchaseLine.Delivery(BigDecimal.ONE, false, "None", null, null, true, null, false))));
        assertEquals("Equipment", viscometer.receive(new PurchaseLine.Delivery(BigDecimal.ONE, false, "None", null, null, true, "GRP", false)).makes());
        PurchaseLine bags = line("status", "Ordered", "quantity", "3");
        PurchaseLine.Receipt into = bags.receive(new PurchaseLine.Delivery(new BigDecimal("2"), true, "None", null, new BigDecimal("82.50"), false, null, true));
        assertEquals(new PurchaseLine.Receipt("Inventory", false, BigDecimal.ONE, "Partly received"), into, "an Other purchase put into inventory");
        assertEquals("None", line("line_type", "Service", "status", "Ordered").receive(delivery("1", false)).makes(), "a service is received as done");
        assertEquals("Received (Short shipped)", PurchaseLine.receiptReason("Short shipped"));
    }

    // ------------------------------------------------------------ vendor decisions (Java's copy of vendor_decision)
    @Test
    void vendorDecisions() {
        VendorQualification corp = q("C", null, "Approved", TODAY.plusYears(1), null);
        VendorQualification tpsSuspended = q("T", "TPS", "Suspended", null, null);
        assertEquals("Approved", VendorDecision.of(corp, null, TODAY, null, SCOPES).status());
        assertEquals("Corporate", VendorDecision.of(corp, null, TODAY, null, SCOPES).decidedAt());
        assertEquals("Suspended", VendorDecision.of(corp, tpsSuspended, TODAY, null, SCOPES).status(), "a lab can be stricter");
        assertEquals("Suspended", VendorDecision.of(q("C", null, "Suspended", null, null), q("L", "CFL", "Approved", null, null), TODAY, null, SCOPES).status(),
            "a corporate suspension blocks every lab");
        assertEquals("Not qualified", VendorDecision.of(null, null, TODAY, null, SCOPES).status());
        assertEquals("Expired", VendorDecision.of(null, q("L", "CFL", "Approved", TODAY.minusDays(1), null), TODAY, null, SCOPES).status());
        VendorQualification cal = q("L", "CFL", "Approved", null, List.of("S7"));
        VendorDecision other = VendorDecision.of(null, cal, TODAY, List.of("S10"), SCOPES);
        assertEquals("Not approved for this", other.status());
        assertEquals("Cannot request from VA Calibration Svc: it is not approved for other services at this lab. Ask QA to approve the vendor for it.",
            refusal(() -> VendorDecision.assertAllows("request", "VA Calibration Svc", other, VendorDecision.of(null, cal, TODAY, null, SCOPES))));
        VendorDecision blocked = VendorDecision.of(q("C", null, "Suspended", null, null), null, TODAY, List.of("S5"), SCOPES);
        assertEquals("Cannot approve a purchase from VA Glassware: the supplier is suspended by Corporate QA for every lab. Ask QA to qualify it first.",
            refusal(() -> VendorDecision.assertAllows("approve a purchase", "VA Glassware", blocked, blocked)));
        assertEquals("Cannot request from Pur Unvetted LLC: the supplier is not qualified for this lab. Ask QA to qualify it first.",
            refusal(() -> VendorDecision.assertAllows("request", "Pur Unvetted LLC", null, VendorDecision.of(null, null, TODAY, null, SCOPES))));
        VendorQualification standards = q("C", null, "Approved", null, List.of("S1"));
        assertEquals("Approved", VendorDecision.of(standards, null, TODAY, List.of("S1"), SCOPES).status(), "TPS may order reference standards");
        assertEquals("Not approved for this", VendorDecision.of(standards, null, TODAY, List.of("S4"), SCOPES).status(), "... but not reagents");
    }

    // ------------------------------------------------------------ supply scopes (moved: supply_scope_rules, purchase_line_scope's copy)
    @Test
    void supplyScopes() {
        assertEquals(List.of("S10"), SCOPES.forRequest("Service", null, null), "a service with no scope chosen is Other services");
        assertEquals(List.of("S6"), SCOPES.forRequest("Equipment", List.of("S7"), null), "equipment always gets the Equipment scope");
        assertEquals(List.of("S4"), SCOPES.forRequest("Inventory item", null, List.of("Reagent")), "a reagent takes its scope from the item type");
        assertNull(SCOPES.forRequest("Inventory item", null, List.of("Media")));
        assertEquals("A service request cannot be for Reference standards", refusal(() -> SCOPES.forRequest("Service", List.of("S1"), null)));
        assertEquals("A service request cannot be for Retired scope", refusal(() -> SCOPES.forRequest("Service", List.of("SX"), null)));
        assertEquals("Reference standards, Reagents and solvents", SCOPES.names(List.of("S4", "S1")));
        assertEquals("Every scope", SCOPES.names(null));
        assertTrue(ScopeList.covers(null, List.of("S1")) && ScopeList.covers(List.of("S1"), null) && !ScopeList.covers(List.of("S1"), List.of("S4")));
        assertEquals("Items of type Reference Standard already fall under the scope \"Reference standards\": an item type belongs to one scope",
            refusal(() -> SupplyScope.check(null, m("scope_name", "Standards again", "chemical_types", "{\"Reference Standard\"}", "line_types", "{\"Inventory item\"}"), m(), SCOPES.all())));
        assertEquals("Scope \"Water\" is the default for other requests, so it must be offered for them",
            refusal(() -> SupplyScope.check(null, m("scope_name", "Water", "line_types", "{Service}", "default_for", "Other"), m(), SCOPES.all())));
        assertEquals("Waste disposal", SupplyScope.check(null, m("scope_name", " Waste disposal ", "line_types", "{Service}"), m("scope_name", " Waste disposal "), SCOPES.all()).get("scope_name"));
        assertNull(refusal(() -> SupplyScope.check("S1", m("scope_name", "Reference standards", "chemical_types", List.of("Reference Standard")), m(), SCOPES.all())),
            "a scope does not clash with itself");
    }

    // ------------------------------------------------------------ risk classes (moved: supplier_risk_class_rules' rule part, checks)
    @Test
    void riskClasses() {
        assertEquals("A risk class cannot move between labs", refusal(() -> RiskClass.check(CFL_IV, m("site_id", "TPS", "class_name", "Class IV", "requal_months", 60))));
        assertEquals("Re-qualify every 1 month or more.", refusal(() -> RiskClass.check(null, m("class_name", "Class Z", "requal_months", 0))));
        assertEquals("Name the risk class.", refusal(() -> RiskClass.check(null, m("class_name", " ", "requal_months", 6))));
        assertNull(refusal(() -> RiskClass.check(null, m("site_id", "CFL", "class_name", "Class IV", "requal_months", 60))));
    }

    // ------------------------------------------------------------ approvals (moved: vendor_qualification_rules' rule part, the date check)
    @Test
    void vendorApprovals() {
        VendorQualification.Request chem = new VendorQualification.Request("SUP", null, "Approved", TODAY.minusDays(10), null, null);
        assertEquals(TODAY.minusDays(10).plusMonths(24), VendorQualification.settle(chem, CLASS_II, SCOPES, TODAY, null, "Pur Chem Supply").expires(),
            "expiry comes from the risk class (Class II: 24 months)");
        assertEquals("Risk class Class IV belongs to one lab: use it only for that lab's own qualifications (a corporate approval uses a shared class)",
            refusal(() -> VendorQualification.settle(chem, CFL_IV, SCOPES, TODAY, null, "x")));
        assertEquals("Risk class Class II is Inactive",
            refusal(() -> VendorQualification.settle(chem, new RiskClass("C2", null, "Class II", 24, "Inactive"), SCOPES, TODAY, null, "x")));
        VendorQualification.Request suspend = new VendorQualification.Request("SUP", "TPS", "Suspended", TODAY, null, List.of("S1"));
        VendorQualification.Settled s = VendorQualification.settle(suspend, CLASS_II, SCOPES, TODAY, null, "x");
        assertNull(s.scopeIds(), "a suspension is for the whole vendor");
        assertNull(s.expires());
        assertEquals("Name what the vendor is approved for (or every scope)",
            refusal(() -> VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY, null, List.of()), CLASS_II, SCOPES, TODAY, null, "x")));
        assertEquals("An approval names only active supply scopes",
            refusal(() -> VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY, null, List.of("NOPE")), CLASS_II, SCOPES, TODAY, null, "x")));
        assertEquals(List.of("S1", "S4"),
            VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY, null, List.of("S4", "S1", "S4")), CLASS_II, SCOPES, TODAY, null, "x").scopeIds());
        assertEquals("The approval date cannot be in the future",
            refusal(() -> VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY.plusDays(2), null, null), CLASS_II, SCOPES, TODAY, null, "x")));
        assertEquals("The expiry cannot be before the approval date.",
            refusal(() -> VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY, TODAY.minusDays(1), null), CLASS_II, SCOPES, TODAY, null, "x")));
        assertEquals("Corporate QA has suspended VA Glassware for every lab (VQ-C): a lab cannot approve it",
            refusal(() -> VendorQualification.settle(new VendorQualification.Request("SUP", "CFL", "Approved", TODAY, null, null), CLASS_II, SCOPES, TODAY,
                q("C", null, "Suspended", null, null), "VA Glassware")));
        assertEquals("A qualification cannot be changed; record a new qualification (or withdraw this one as entered in error)",
            refusal(() -> VendorQualification.assertOnlyStatusChanges(List.of("accreditations"))));
        assertNull(refusal(() -> VendorQualification.assertOnlyStatusChanges(List.of("status"))));
    }

    // ------------------------------------------------------------ proposals (moved: propose / withdraw / decide_vendor_promotion, vendor_promotion_rules)
    @Test
    void proposals() {
        VendorQualification local = q("L", "CFL", "Approved", null, List.of("S1", "S4"));
        assertEquals("VQ-C is already a corporate approval", refusal(() -> VendorPromotion.assertProposable(q("C", null, "Approved", null, null))));
        assertEquals("Approval not found", refusal(() -> VendorPromotion.assertProposable(null)));
        assertTrue(refusal(() -> VendorPromotion.propose(local, TODAY, local, null, CLASS_II, null, false, null, SCOPES)).startsWith("Attach at least one document"));
        assertEquals("Choose one of the shared risk classes: a corporate approval uses those",
            refusal(() -> VendorPromotion.propose(local, TODAY, local, null, CFL_IV, null, true, null, SCOPES)));
        assertEquals("Propose only what this lab approved the vendor for (Reference standards, Reagents and solvents)",
            refusal(() -> VendorPromotion.propose(local, TODAY, local, null, CLASS_II, List.of("S5"), true, null, SCOPES)));
        assertEquals("This vendor is already waiting for corporate approval (VP-00001)",
            refusal(() -> VendorPromotion.propose(local, TODAY, local, null, CLASS_II, null, true, "VP-00001", SCOPES)));
        assertEquals("Only a current approval of this lab can be proposed for corporate approval",
            refusal(() -> VendorPromotion.propose(q("L", "CFL", "Suspended", null, null), TODAY, local, null, CLASS_II, null, true, null, SCOPES)));
        assertEquals("Propose the lab's latest decision on this vendor",
            refusal(() -> VendorPromotion.propose(local, TODAY, q("NEWER", "CFL", "Approved", null, null), null, CLASS_II, null, true, null, SCOPES)));
        assertEquals("Corporate QA has suspended this vendor (VQ-C): it cannot be proposed",
            refusal(() -> VendorPromotion.propose(local, TODAY, local, q("C", null, "Suspended", null, null), CLASS_II, null, true, null, SCOPES)));
        assertEquals("Name what the vendor should be approved for", refusal(() -> VendorPromotion.propose(local, TODAY, local, null, CLASS_II, List.of(), true, null, SCOPES)));
        assertEquals(List.of("S1"), VendorPromotion.propose(local, TODAY, local, null, CLASS_II, List.of("S1"), true, null, SCOPES));
        assertEquals(List.of("S1", "S4"), VendorPromotion.propose(local, TODAY, local, null, CLASS_II, null, true, null, SCOPES), "nothing named: what the lab approved");

        VendorPromotion p = new VendorPromotion("P", "VP-00001", "SUP", "CFL", "L", "C2", List.of("S1"), "Proposed", "qa");
        assertEquals("You proposed VP-00001: someone else in Corporate QA decides it", refusal(() -> p.decide("qa", "Approved", "", null, null, local, SCOPES)));
        assertEquals("Say why the proposal is rejected (the lab sees it)", refusal(() -> p.decide("corp1", "Rejected", "", null, null, local, SCOPES)));
        assertEquals("Approve or reject the proposal", refusal(() -> p.decide("corp1", "Maybe", "x", null, null, local, SCOPES)));
        assertEquals("A corporate approval covers at most what the lab approved (Reference standards, Reagents and solvents)",
            refusal(() -> p.decide("corp1", "Approved", "", null, List.of("S5"), local, SCOPES)));
        assertEquals(new VendorPromotion.Decision("Approved", "C2", List.of("S1")), p.decide("corp1", "Approved", "Evidence reviewed", null, null, local, SCOPES));
        VendorPromotion decided = new VendorPromotion("P", "VP-00001", "SUP", "CFL", "L", "C2", null, "Approved", "qa");
        assertEquals("Proposal VP-00001 is already approved", refusal(() -> decided.decide("corp1", "Rejected", "x", null, null, local, SCOPES)));
        assertEquals("Proposal VP-00001 is already approved", refusal(() -> decided.withdraw("Sent too early")));
        assertEquals("Give the reason for withdrawing the proposal", refusal(() -> p.withdraw("")));
        assertEquals("Corporate QA approved VA Standards Co for every lab (VP-00001; Reference standards).",
            p.notice(new VendorPromotion.Decision("Approved", "C2", List.of("S1")), "VA Standards Co", "Reference standards", null));
        assertEquals("Corporate QA did not approve VA Calibration Svc for every lab (VP-00001): One lab's use is not enough evidence yet This lab's own approval stands.",
            p.notice(new VendorPromotion.Decision("Rejected", null, null), "VA Calibration Svc", "", "One lab's use is not enough evidence yet"));
        assertEquals("Corporate approval from CFL's VQ-L (VP-00001): Evidence reviewed", p.justification("CFL", "VQ-L", "Evidence reviewed"));
    }

    // ------------------------------------------------------------ notices and documents (moved: vendor_qualification_notices, vendor_notice / vendor_document rules)
    @Test
    void noticesAndDocuments() {
        VendorQualification suspended = q("C", null, "Suspended", null, null);
        assertTrue(VendorNotice.tellsLabs(suspended));
        assertFalse(VendorNotice.tellsLabs(q("C", null, "Approved", null, null)));
        assertFalse(VendorNotice.tellsLabs(q("L", "TPS", "Suspended", null, null)), "a lab's own suspension tells nobody else");
        assertEquals("Corporate QA suspended VA Glassware for every lab (VQ-C): Recall of a glassware lot. 2 open requests are stopped until it is approved again.",
            VendorNotice.corporateBlock(suspended, "VA Glassware", "Recall of a glassware lot", 2));
        assertEquals("Corporate QA rejected VA Glassware for every lab (VQ-C). 1 open request is stopped until it is approved again.",
            VendorNotice.corporateBlock(q("C", null, "Not Approved", null, null), "VA Glassware", null, 1));
        assertFalse(VendorNotice.unread("2026-10-29T10:00:00.000Z"), "a notice is acknowledged once");
        assertEquals("The proposal is decided: its documents are closed", refusal(() -> VendorDocument.assertCanAttach("Rejected")));
        assertNull(refusal(() -> VendorDocument.assertCanAttach(null)));
        assertEquals("A Reason for Change is required to withdraw a vendor document", refusal(() -> VendorDocument.assertWithdrawReason("")));
        assertTrue(refusal(() -> VendorDocument.checkFile("text/html", "Other")).startsWith("Attach a PDF"));
        assertTrue(refusal(() -> VendorDocument.checkFile("application/pdf", "Brochure")).startsWith("Say what each document is"));
        assertNull(refusal(() -> VendorDocument.checkFile("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Quality agreement")));
        assertEquals("The amount cannot be negative.", refusal(() -> PurchasingSetting.checkSecondApprovalOver(new BigDecimal("-1"))));
    }
}
