package com.tentamus.lims.purchasing.domain;

import java.util.List;

/**
 * A purchase order: approved requests of one supplier at one lab, with the finance system's PO number. Only the PO
 * number, the supplier's confirmation and the notes change afterwards (the only columns Java writes on an order). Replaces the rule part of purchase_order_rules
 * (migration 065; its permission and signature checks stay in the database).
 */
public final class PurchaseOrder {
    public static final List<String> EDITABLE = List.of("external_po_number", "confirmation_number", "notes");

    private PurchaseOrder() {}

    /** PO-CFL-00001. */
    public static String code(String siteCode, long number) { return "PO-" + siteCode + "-" + String.format("%05d", number); }

    /** Blank text is no number. */
    public static String clean(Object v) { return v == null || v.toString().isBlank() ? null : v.toString().strip(); }
}
