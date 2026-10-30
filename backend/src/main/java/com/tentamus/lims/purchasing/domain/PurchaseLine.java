package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * One purchase request (PR-000001): an inventory item, equipment, a service or something else, moving Requested ->
 * (Awaiting second approval) -> Approved -> Ordered -> Partly received -> Received, or Rejected / Cancelled.
 * Holds the rules for requesting, changing, approving (never your own; a second approval above the lab's amount by
 * someone else), rejecting, ordering and receiving it.
 *
 * <p>Java's own implementation of purchase_line_rules, purchase_line_scope, approve_purchase_lines,
 * create_purchase_order and (moved, migration 065) reject_purchase_lines and receive_purchase_line. The two triggers and
 * the approve and order functions stay in the database: inventory's lot triggers and routes and the demo data load
 * write purchase requests through them (migration 065 header).
 */
public final class PurchaseLine {
    public static final List<String> OPEN = List.of("Requested", "Awaiting second approval", "Approved", "Ordered");
    static final Pattern URL = Pattern.compile("(?i)^https?://\\S+$");

    private final String id, code, siteId, lineType, status, description, supplierId, requestedBy, approvedBy, lotId, unit;
    private final BigDecimal quantity, unitPrice, receivedQuantity;
    private final List<String> scopeIds;

    private PurchaseLine(Map<String, Object> r) {
        id = Val.str(r.get("id"));
        code = Val.str(r.get("line_code"));
        siteId = Val.str(r.get("site_id"));
        lineType = Val.str(r.get("line_type"));
        status = Val.str(r.get("status"));
        description = Val.str(r.get("description"));
        supplierId = Val.str(r.get("supplier_id"));
        requestedBy = Val.str(r.get("requested_by"));
        approvedBy = Val.str(r.get("approved_by"));
        lotId = Val.str(r.get("lot_id"));
        unit = Val.str(r.get("unit"));
        quantity = Val.dec(r.get("quantity"));
        unitPrice = Val.dec(r.get("unit_price"));
        receivedQuantity = r.get("received_quantity") == null ? BigDecimal.ZERO : Val.dec(r.get("received_quantity"));
        scopeIds = Val.list(r.get("scope_ids"));
    }

    public static PurchaseLine of(Map<String, Object> row) { return row == null ? null : new PurchaseLine(row); }

    public String id() { return id; }
    public String code() { return code; }
    public String siteId() { return siteId; }
    public String lineType() { return lineType; }
    public String status() { return status; }
    public String description() { return description; }
    public String supplierId() { return supplierId; }
    public String lotId() { return lotId; }
    public String unit() { return unit; }
    public List<String> scopeIds() { return scopeIds; }
    public BigDecimal quantity() { return quantity; }

    private String lowStatus() { return Val.lower(status); }

    // ---------------------------------------------------------------- requesting and changing
    /** The purchase step a supplier is checked for, by the status the request moves to. */
    public static String supplierStep(String status) {
        return "Ordered".equals(status) ? "order" : "Requested".equals(status) ? "request" : "approve a purchase";
    }

    /** A new request raised in Purchasing (inventory items are requested from the Inventory page). */
    public static void checkNew(Object lineType) {
        if (lineType == null || !List.of("Equipment", "Service", "Other").contains(lineType))
            throw new RuleException("Pick what kind of purchase it is (equipment, a service, or other); request inventory items from the Inventory page");
    }

    /** The values a request may hold (the checks on description, quantity, price and web link), as far as they are sent. */
    public static void checkValues(Map<String, Object> v, boolean isNew) {
        if ((isNew || v.containsKey("description")) && Val.blank(v.get("description"))) throw RuleException.withCode("Describe what is to be bought.", "23514");
        if ((isNew || v.containsKey("quantity")) && (v.get("quantity") == null || Val.dec(v.get("quantity")).signum() <= 0))
            throw RuleException.withCode("Enter a quantity above zero.", "23514");
        if (v.get("unit_price") != null && Val.dec(v.get("unit_price")).signum() < 0) throw RuleException.withCode("The price cannot be negative.", "23514");
        if (v.get("item_url") != null && !URL.matcher(v.get("item_url").toString()).matches())
            throw RuleException.withCode("The web link must be a full web address starting with http:// or https://.", "23514");
    }

    /**
     * People may change a request's details while it waits for approval, or cancel it before it is ordered; only the
     * requester or an approver. Returns true when the change sends a first-approved request back to Requested.
     */
    public boolean change(Map<String, Object> changes, String me, boolean isApprover) {
        if (List.of("Received", "Rejected", "Cancelled").contains(status) && !changes.isEmpty())
            throw RuleException.database("Request " + code + " is " + lowStatus() + " and cannot be changed");
        String to = changes.containsKey("status") ? Val.str(changes.get("status")) : status;
        if (!Objects.equals(to, status) && !("Cancelled".equals(to) && List.of("Requested", "Awaiting second approval", "Approved").contains(status)))
            throw RuleException.database("Use Approve, Reject, Order or Receive to move a request on");
        if (!"Cancelled".equals(to) && !List.of("Requested", "Awaiting second approval").contains(status))
            throw RuleException.database("Request " + code + " is already " + lowStatus() + ": its details can no longer be changed (cancel it and request again)");
        if (!Objects.equals(me, requestedBy) && !isApprover) throw RuleException.database("Only the requester or an approver can change or cancel request " + code);
        checkValues(changes, false);
        return !"Cancelled".equals(to) && "Awaiting second approval".equals(status);
    }

    // ---------------------------------------------------------------- approving and rejecting
    public boolean needsSecondApproval(BigDecimal secondApprovalOver) {
        return secondApprovalOver != null && quantity != null && unitPrice != null && quantity.multiply(unitPrice).compareTo(secondApprovalOver) > 0;
    }

    /** The permission this request's next approval needs (null when it cannot be approved). */
    public String approvalPermission() {
        return "Requested".equals(status) ? "purchasing.approve" : "Awaiting second approval".equals(status) ? "purchasing.approve_over" : null;
    }

    public void assertNotOwn(String me) {
        if (Objects.equals(requestedBy, me)) throw RuleException.database("You requested " + code + " yourself, so someone else must approve it");
    }

    /** Never your own request; the second approver is not the first. Returns the status the approval moves it to. */
    public String approve(String me, BigDecimal secondApprovalOver) {
        assertNotOwn(me);
        if ("Requested".equals(status)) return needsSecondApproval(secondApprovalOver) ? "Awaiting second approval" : "Approved";
        if ("Awaiting second approval".equals(status)) {
            if (Objects.equals(approvedBy, me)) throw RuleException.database("You gave " + code + " its first approval; the second approval must be someone else");
            return "Approved";
        }
        throw RuleException.database("Request " + code + " is " + lowStatus() + " and cannot be approved");
    }

    public static void checkRejectReason(String reason) {
        if (Val.blank(reason)) throw RuleException.database("Say why the request is rejected");
    }

    public void assertRejectable() {
        if (!List.of("Requested", "Awaiting second approval").contains(status))
            throw RuleException.database("Request " + code + " is " + lowStatus() + " and cannot be rejected");
    }

    // ---------------------------------------------------------------- ordering
    /** The lab and supplier of a purchase order made of these requests: one lab, one supplier. */
    public record OrderGroup(String siteId, String supplierId) {}

    public static OrderGroup orderGroup(List<PurchaseLine> lines) {
        if (lines.stream().map(l -> l.siteId).distinct().count() != 1) throw RuleException.database("Pick approved requests of one lab");
        if (lines.stream().anyMatch(l -> l.supplierId == null) || lines.stream().map(l -> l.supplierId).distinct().count() != 1)
            throw RuleException.database("An order goes to one supplier: pick requests of the same supplier (give a supplier to any request without one)");
        return new OrderGroup(lines.get(0).siteId, lines.get(0).supplierId);
    }

    public void assertOrderable() {
        if (!"Approved".equals(status)) throw RuleException.database("Request " + code + " is " + lowStatus() + ": only approved requests can be ordered");
    }

    // ---------------------------------------------------------------- receiving
    /** What arrived. equipmentOwner: the responsible group, for equipment; intoInventory: put an Other or Service purchase into inventory. */
    public record Delivery(BigDecimal quantity, boolean moreToCome, String discrepancy, String note, BigDecimal actualPrice,
                           boolean equipmentGiven, String equipmentOwner, boolean intoInventory) {}

    /** What receiving does: Lot (completes the request's lot), Equipment, Inventory (a new item), or nothing more; and the line's new state. */
    public record Receipt(String makes, boolean backOrder, BigDecimal left, String newStatus) {}

    public void assertReceivable() {
        if (!List.of("Ordered", "Partly received").contains(status))
            throw RuleException.database("Request " + code + " is " + lowStatus() + ": only ordered requests can be received");
    }

    public Receipt receive(Delivery d) {
        assertReceivable();
        if (d.quantity() == null || d.quantity().signum() < 0) throw RuleException.database("Enter the quantity received");
        if (d.actualPrice() != null && d.actualPrice().signum() < 0) throw RuleException.database("The actual price cannot be negative");
        BigDecimal left = quantity.subtract(receivedQuantity).subtract(d.quantity());
        boolean more = d.moreToCome() && left.signum() > 0;
        String makes = "None";
        if ("Inventory item".equals(lineType)) {
            if (d.quantity().signum() == 0) throw RuleException.database("Enter the quantity received");
            makes = "Lot";
        } else if ("Equipment".equals(lineType)) {
            if (!d.equipmentGiven() || Val.blank(d.equipmentOwner())) throw RuleException.database("Say what the equipment is and which group is responsible for it");
            makes = "Equipment";
        } else if (d.intoInventory()) {
            if (d.quantity().signum() == 0) throw RuleException.database("Enter the quantity received");
            makes = "Inventory";
        }
        if (d.discrepancy() != null && !"None".equals(d.discrepancy()) && Val.blank(d.note()))
            throw RuleException.withCode("Describe the problem with the delivery (what was damaged, how warm it arrived, what was missing).", "23514");
        return new Receipt(makes, "Lot".equals(makes) && more, left, more ? "Partly received" : "Received");
    }

    /** The reason recorded for a receipt. */
    public static String receiptReason(String discrepancy) {
        return "Received" + (discrepancy != null && !"None".equals(discrepancy) ? " (" + discrepancy + ")" : "");
    }
}
