package com.tentamus.lims.purchasing.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.purchasing.domain.PurchaseLine;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * Loads purchase requests and writes their steps (approval, rejection, orders, receipts, and the inventory lots and
 * equipment receiving makes). Status steps are written with lims.purchasing_internal on, which the purchase request
 * and inventory lot triggers the database keeps for inventory's own writes expect.
 */
@Repository
public class PurchaseLineRepository {
    public PurchaseLine find(Db d, String id) { return PurchaseLine.of(d.one("SELECT * FROM purchase_line WHERE id = ?::uuid", id)); }

    public PurchaseLine lock(Db d, String id) { return PurchaseLine.of(d.one("SELECT * FROM purchase_line WHERE id = ?::uuid FOR UPDATE", id)); }

    public List<PurchaseLine> lockAll(Db d, List<Object> ids) {
        return d.rows("SELECT * FROM purchase_line WHERE id = ANY (?::uuid[]) ORDER BY line_code FOR UPDATE", ids).stream().map(PurchaseLine::of).toList();
    }

    public BigDecimal secondApprovalOver(Db d, String site) {
        Map<String, Object> s = d.one("SELECT second_approval_over FROM purchasing_setting WHERE site_id = ?::uuid", site);
        return s == null || s.get("second_approval_over") == null ? null : new BigDecimal(s.get("second_approval_over").toString());
    }

    /** The item types of a request's inventory lot (its scopes follow them). */
    public List<String> lotTypes(Db d, String lotId) {
        if (lotId == null) return null;
        Map<String, Object> r = d.one("SELECT chemical_types::text[] AS t FROM inventory_lot WHERE id = ?::uuid", lotId);
        return r == null || !(r.get("t") instanceof List<?> t) ? null : t.stream().map(Object::toString).toList();
    }

    private void internal(Db d, boolean on) { d.one("SELECT set_purchasing_internal(?)", on); }

    // ---------------------------------------------------------------- steps
    /** A change after a first approval: back to Requested, approved again. */
    public void resetApproval(Db d, String id) {
        internal(d, true);
        d.update("UPDATE purchase_line SET status = 'Requested', approved_by = NULL, approved_at = NULL WHERE id = ?::uuid", id);
        internal(d, false);
    }

    public void approve(Db d, PurchaseLine l, String newStatus, String me) {
        internal(d, true);
        if ("Requested".equals(l.status()))
            d.update("UPDATE purchase_line SET approved_by = ?::uuid, approved_at = clock_timestamp(), status = ?::purchase_line_status WHERE id = ?::uuid", me, newStatus, l.id());
        else
            d.update("UPDATE purchase_line SET approved2_by = ?::uuid, approved2_at = clock_timestamp(), status = 'Approved' WHERE id = ?::uuid", me, l.id());
        if ("Approved".equals(newStatus) && l.lotId() != null)
            d.update("UPDATE inventory_lot SET receipt_status = 'Approved' WHERE id = ?::uuid AND receipt_status = 'Requested'", l.lotId());
        internal(d, false);
    }

    public void reject(Db d, String id, String reason) {
        internal(d, true);
        d.update("UPDATE purchase_line SET status = 'Rejected', rejected_reason = ? WHERE id = ?::uuid", reason, id);
        internal(d, false);
    }

    /** The purchase order (its code PO-<lab>-00001 from the domain) and its lines moved to Ordered with their lots. */
    public String createOrder(Db d, String site, String supplier, java.util.function.BiFunction<String, Long, String> code, String po, String confirmation,
                              Object notes, List<PurchaseLine> lines) {
        Map<String, Object> n = d.one("SELECT nextval('purchase_order_seq') AS n, (SELECT site_code FROM lab_site WHERE id = ?::uuid) AS site_code", site);
        internal(d, true);
        String id = (String) d.one("""
            INSERT INTO purchase_order (po_code, site_id, supplier_id, external_po_number, confirmation_number, notes, signature_id)
            VALUES (?, ?::uuid, ?::uuid, ?, ?, ?, NULLIF(current_setting('lims.signature_id', true), '')::uuid) RETURNING id""",
            code.apply((String) n.get("site_code"), ((Number) n.get("n")).longValue()), site, supplier, po, confirmation, notes).get("id");
        for (PurchaseLine l : lines) {
            d.update("UPDATE purchase_line SET status = 'Ordered', purchase_order_id = ?::uuid WHERE id = ?::uuid", id, l.id());
            if (l.lotId() != null) d.update("UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE id = ?::uuid AND receipt_status = 'Approved'", l.lotId());
        }
        internal(d, false);
        return id;
    }

    // ---------------------------------------------------------------- receiving
    /** Completes the request's lot with inventory's receive_lot; a back-order lot for what is left stays Ordered. Returns the back-order's id. */
    public String receiveLot(Db d, PurchaseLine l, BigDecimal qty, Object mfrLot, Object expires, Object retest, Object location, BigDecimal backOrder) {
        Object before = d.one("SELECT storage_location_id FROM inventory_lot WHERE id = ?::uuid", l.lotId()).get("storage_location_id");
        d.one("SELECT set_config('lims.receiving_line', '1', true)");
        d.one("SELECT receive_lot(?::uuid, ?, NULL, ?, ?::date, ?::date, ?::uuid, NULL)", l.lotId(), qty, mfrLot, expires, retest, location);
        String back = null;
        if (backOrder != null) {
            internal(d, true);
            back = (String) d.one("""
                INSERT INTO inventory_lot (site_id, chemical_id, item_name, cas_number, physical_form, item_description, chemical_types, supplier_id, manufacturer_id,
                                           catalog_number, receipt_status, requested_quantity, unit, concentration, concentration_unit, storage_condition,
                                           storage_location_id, reorder_of_lot_id, purchase_line_id, notes, item_url)
                SELECT site_id, chemical_id, item_name, cas_number, physical_form, item_description, chemical_types, supplier_id, manufacturer_id,
                       catalog_number, 'Requested', ?, unit, concentration, concentration_unit, storage_condition,
                       ?::uuid, reorder_of_lot_id, ?::uuid, ?, item_url FROM inventory_lot WHERE id = ?::uuid RETURNING id""",
                backOrder, before, l.id(), "Back-order of " + l.code(), l.lotId()).get("id");
            d.update("UPDATE inventory_lot SET receipt_status = 'Approved' WHERE id = ?::uuid", back);
            d.update("UPDATE inventory_lot SET receipt_status = 'Ordered' WHERE id = ?::uuid", back);
            d.update("""
                INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
                SELECT ?::uuid, analyte_id, concentration, concentration_unit FROM lot_analyte WHERE lot_id = ?::uuid AND status = 'Active' ON CONFLICT DO NOTHING""", back, l.lotId());
            internal(d, false);
        }
        d.one("SELECT set_config('lims.receiving_line', '', true)");
        return back;
    }

    /** Received equipment goes into the register, owned by the group, tagged out for qualification. */
    public String receiveEquipment(Db d, PurchaseLine l, Map<String, Object> eq) {
        Object was = d.one("SELECT COALESCE(current_setting('lims.equipment_internal', true), '') AS w").get("w");
        d.one("SELECT set_config('lims.equipment_internal', '1', true)");
        String id = (String) d.one("""
            INSERT INTO equipment (site_id, equipment_name, equipment_type_id, department_id, manufacturer, model, serial_number, notes, in_service_date, admin_status)
            VALUES (?::uuid, COALESCE(NULLIF(?, ''), ?), ?::uuid, ?::uuid, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULL, 'In Service') RETURNING id""",
            l.siteId(), text(eq.get("equipment_name")), l.description(), text(eq.get("equipment_type_id")), text(eq.get("department_id")),
            text(eq.get("manufacturer")), text(eq.get("model")), text(eq.get("serial_number")), "Received on " + l.code()).get("id");
        d.update("INSERT INTO equipment_owner (equipment_id, group_id) VALUES (?::uuid, ?::uuid)", id, text(eq.get("owner_group_id")));
        d.update("INSERT INTO equipment_tag (equipment_id, reason, source, description) VALUES (?::uuid, 'Qualification', 'New equipment', ?)",
            id, "New equipment received on " + l.code() + ": install and qualify before use");
        d.one("SELECT set_config('lims.equipment_internal', ?, true)", was);
        return id;
    }

    /** An Other or Service purchase put into inventory: a received item to fill out. types: item types (none = Consumable). */
    public String receiveIntoInventory(Db d, PurchaseLine l, BigDecimal qty, Map<String, Object> inv, List<String> types, Object mfrLot, Object expires,
                                       Object retest, Object location) {
        internal(d, true);
        d.one("SELECT set_config('lims.receiving_line', '1', true)");
        String id = (String) d.one("""
            INSERT INTO inventory_lot (site_id, item_name, chemical_types, supplier_id, catalog_number, manufacturer_lot, receipt_status, quantity_received, unit,
                                       container_count, expiration_date, retest_date, storage_location_id, purchase_line_id, item_url, notes)
            SELECT l.site_id, COALESCE(NULLIF(btrim(?), ''), l.description), ?::chemical_type[], l.supplier_id, l.catalog_number, NULLIF(btrim(?), ''),
                   'Received', COALESCE(NULLIF(?, '')::numeric, ?::numeric), COALESCE(NULLIF(btrim(?), ''), NULLIF(btrim(l.unit), ''), 'each'),
                   CASE WHEN ?::numeric = trunc(?::numeric) THEN ?::numeric::integer END, ?::date, ?::date, ?::uuid, l.id, l.item_url, 'Received on ' || l.line_code
              FROM purchase_line l WHERE l.id = ?::uuid RETURNING id""",
            text(inv.get("item_name")), "{" + String.join(",", types.stream().map(t -> "\"" + t + "\"").toList()) + "}", mfrLot,
            inv.get("quantity") == null ? null : inv.get("quantity").toString(), qty, text(inv.get("unit")), qty, qty, qty, expires, retest, location, l.id()).get("id");
        d.one("SELECT set_config('lims.receiving_line', '', true)");
        internal(d, false);
        return id;
    }

    public String insertReceipt(Db d, PurchaseLine l, BigDecimal qty, String lotId, String equipmentId, String discrepancy, Object note, Object slip, BigDecimal actualPrice) {
        return (String) d.one("""
            INSERT INTO purchase_receipt (purchase_line_id, quantity, lot_id, equipment_id, discrepancy, note, packing_slip_id, actual_unit_price)
            VALUES (?::uuid, ?, ?::uuid, ?::uuid, ?::receipt_discrepancy, NULLIF(btrim(?), ''), ?::uuid, ?) RETURNING id""",
            l.id(), qty, lotId, equipmentId, discrepancy, note, slip, actualPrice).get("id");
    }

    public void received(Db d, PurchaseLine l, BigDecimal qty, String status, String newLot, String equipmentId) {
        internal(d, true);
        d.update("""
            UPDATE purchase_line SET received_quantity = received_quantity + ?, status = ?::purchase_line_status,
                   lot_id = COALESCE(?::uuid, lot_id), equipment_id = COALESCE(?::uuid, equipment_id) WHERE id = ?::uuid""",
            qty, status, newLot, equipmentId, l.id());
        internal(d, false);
    }

    private static String text(Object v) { return v == null ? null : v.toString(); }
}
