package com.tentamus.lims.purchasing.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** The request queue, purchase orders and receipts, suppliers and their approvals, the lab's purchasing lists. */
@Repository
public class PurchasingRepository {
    static final List<String> LINE_FIELDS = List.of("description", "supplier_id", "catalog_number", "quantity", "unit", "unit_price", "needed_by",
        "justification", "item_url", "scope_ids");
    public static final RecordWriter NEW_LINE = new RecordWriter("purchase_line", concat(List.of("line_type"), LINE_FIELDS));
    public static final RecordWriter LINE = new RecordWriter("purchase_line", concat(LINE_FIELDS, List.of("status")));
    public static final RecordWriter ORDER = new RecordWriter("purchase_order", List.of("external_po_number", "confirmation_number", "notes"));
    public static final RecordWriter SCOPES = new RecordWriter("supply_scope", List.of("scope_name", "description", "chemical_types", "line_types", "default_for",
        "sort_order", "status"));
    public static final RecordWriter RISK_CLASSES = new RecordWriter("supplier_risk_class", List.of("class_name", "requal_months", "description", "sort_order", "status"));

    static final String LINES_SQL = """
        SELECT v.*, (v.requested_by = ?::uuid) AS mine, pl.scope_ids, scope_names(pl.scope_ids) AS scope_text
          FROM purchase_line_view v JOIN purchase_line pl ON pl.id = v.id WHERE v.site_id = ?::uuid""";
    static final String ORDERS_SQL = """
        SELECT o.*, s.supplier_name, u.full_name AS ordered_by,
            (SELECT count(*) FROM purchase_line l WHERE l.purchase_order_id = o.id) AS line_count,
            (SELECT sum(l.quantity * l.unit_price) FROM purchase_line l WHERE l.purchase_order_id = o.id) AS amount,
            (SELECT CASE WHEN bool_and(l.status IN ('Received','Cancelled')) THEN 'Received' WHEN bool_or(l.status IN ('Partly received','Received')) THEN 'Partly received' ELSE 'Open' END
               FROM purchase_line l WHERE l.purchase_order_id = o.id) AS receipt_state
          FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id JOIN app_user u ON u.id = o.created_by WHERE o.site_id = ?::uuid""";
    private final Db db;

    public PurchasingRepository(Db db) { this.db = db; }

    public Map<String, Object> setting(String site) { return db.one("SELECT * FROM purchasing_setting WHERE site_id = ?::uuid", site); }

    // ---------------------------------------------------------------- requests
    public List<Map<String, Object>> lines(String site, String user) {
        return db.rows(LINES_SQL + """

             ORDER BY CASE v.status WHEN 'Awaiting second approval' THEN 0 WHEN 'Requested' THEN 1 WHEN 'Approved' THEN 2 WHEN 'Ordered' THEN 3 WHEN 'Partly received' THEN 4 ELSE 5 END, v.requested_at DESC""",
            user, site);
    }

    /** One page, newest first. */
    public Map<String, Object> linesPage(String site, String user, Map<String, String> query) {
        return PagedList.of(LINES_SQL, user, site)
            .filter("approve", "status::text IN ('Requested','Awaiting second approval')").filter("order", "status::text = 'Approved'")
            .filter("receive", "status::text IN ('Ordered','Partly received')").filter("mine", "mine").filter("all", "true")
            .search("line_code", "description", "supplier_name", "catalog_number", "po_code", "external_po_number", "lot_code", "equipment_code", "requested_by_name")
            .ids("line_code", "po_code", "external_po_number").order("ORDER BY requested_at DESC, line_code DESC").run(db, query);
    }

    public Map<String, Object> line(String id) { return db.one("SELECT * FROM purchase_line_view WHERE id = ?::uuid", id); }

    public Map<String, Object> lineDetail(Map<String, Object> l) {
        Object id = l.get("id");
        List<Map<String, Object>> receipts = db.rows("""
            SELECT r.*, u.full_name AS received_by, il.lot_code, e.equipment_code, f.file_name AS slip_name
              FROM purchase_receipt r JOIN app_user u ON u.id = r.created_by LEFT JOIN inventory_lot il ON il.id = r.lot_id LEFT JOIN equipment e ON e.id = r.equipment_id
              LEFT JOIN document_file f ON f.id = r.packing_slip_id WHERE r.purchase_line_id = ?::uuid ORDER BY r.received_at""", id);
        List<Map<String, Object>> lots = db.rows("""
            SELECT id, lot_code, receipt_status, status, quantity_received, requested_quantity, unit, manufacturer_lot FROM inventory_lot
             WHERE purchase_line_id = ?::uuid ORDER BY created_at""", id);
        Map<String, Object> sc = db.one("SELECT scope_ids, scope_names(scope_ids) AS scope_text FROM purchase_line WHERE id = ?::uuid", id);
        Map<String, Object> line = new LinkedHashMap<>(l);
        line.put("scope_ids", sc.get("scope_ids"));
        line.put("scope_text", sc.get("scope_ids") != null ? sc.get("scope_text") : "");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("line", line);
        out.put("receipts", receipts);
        out.put("lots", lots);
        return out;
    }

    /** The lab's requests among the given ids (ticked on the screen). */
    public List<Map<String, Object>> linesOfLab(Object ids, String site) {
        return db.rows("SELECT id, line_code FROM purchase_line WHERE id = ANY(?::uuid[]) AND site_id = ?::uuid", ids == null ? List.of() : ids, site);
    }

    // ---------------------------------------------------------------- orders and receipts
    public List<Map<String, Object>> orders(String site) { return db.rows(ORDERS_SQL + " ORDER BY o.ordered_at DESC", site); }

    public Map<String, Object> ordersPage(String site, Map<String, String> query) {
        return PagedList.of(ORDERS_SQL, site)
            .filter("open", "receipt_state <> 'Received'").filter("received", "receipt_state = 'Received'").filter("all", "true")
            .search("po_code", "external_po_number", "supplier_name", "confirmation_number", "ordered_by").ids("po_code", "external_po_number")
            .order("ORDER BY ordered_at DESC, po_code DESC").run(db, query);
    }

    public Map<String, Object> order(String id) {
        return db.one("""
            SELECT o.*, s.supplier_name, s.account_number, s.contact_name, s.email AS supplier_email, s.phone AS supplier_phone, s.address AS supplier_address,
                u.full_name AS ordered_by, ls.site_code, ls.site_name FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id JOIN app_user u ON u.id = o.created_by
                JOIN lab_site ls ON ls.id = o.site_id WHERE o.id = ?::uuid""", id);
    }

    public List<Map<String, Object>> orderLines(Object orderId) {
        return db.rows("SELECT * FROM purchase_line_view WHERE purchase_order_id = ?::uuid ORDER BY line_code", orderId);
    }

    public Map<String, Object> slip(String receiptId) {
        return db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, l.site_id FROM purchase_receipt r
              JOIN document_file f ON f.id = r.packing_slip_id JOIN purchase_line l ON l.id = r.purchase_line_id WHERE r.id = ?::uuid""", receiptId);
    }

    // ---------------------------------------------------------------- suppliers and vendor approvals
    public List<Map<String, Object>> suppliers(String site) {
        return db.rows("""
            SELECT v.*, s.website, s.email, s.phone, s.account_number, s.contact_name,
                (SELECT count(*) FROM vendor_qualification q WHERE q.supplier_id = s.id) AS qualification_count,
                (SELECT count(*) FROM purchase_line l WHERE l.supplier_id = s.id AND l.site_id = ?::uuid) AS request_count
              FROM supplier_status_view v JOIN supplier s ON s.id = v.supplier_id WHERE v.site_id = ?::uuid ORDER BY lower(v.supplier_name)""", site, site);
    }

    /** A vendor at this lab: its approvals, requests, the risk classes, documents, proposals, the scopes and its decision. */
    public Map<String, Object> supplier(String id, String site) {
        Map<String, Object> sup = db.one("""
            SELECT s.*, v.approval_status, v.approved_until, v.lab_specific, v.risk_class, d.decided_at
              FROM supplier s JOIN supplier_status_view v ON v.supplier_id = s.id AND v.site_id = ?::uuid CROSS JOIN LATERAL vendor_decision(s.id, ?::uuid, NULL) d WHERE s.id = ?::uuid""",
            site, site, id);
        if (sup == null) return null;
        Object sid = sup.get("id");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("supplier", sup);
        out.put("qualifications", db.rows("""
            SELECT q.*, rc.class_name, ls.site_code, u.full_name AS recorded_by, se.full_name AS signed_by, se.meaning AS signature_meaning,
                CASE WHEN q.approval_status = 'Approved' THEN scope_names(q.scope_ids) END AS scope_text, pq.qualification_code AS promoted_from_code
              FROM vendor_qualification q JOIN supplier_risk_class rc ON rc.id = q.risk_class_id LEFT JOIN lab_site ls ON ls.id = q.site_id JOIN app_user u ON u.id = q.created_by
              LEFT JOIN signature_event se ON se.id = q.signature_id LEFT JOIN vendor_qualification pq ON pq.id = q.promoted_from_id
             WHERE q.supplier_id = ?::uuid AND (q.site_id IS NULL OR q.site_id = ?::uuid)
             ORDER BY q.approval_date DESC, q.created_at DESC""", sid, site));
        out.put("lines", db.rows("""
            SELECT v.*, scope_names(pl.scope_ids) AS scope_text FROM purchase_line_view v JOIN purchase_line pl ON pl.id = v.id
             WHERE v.supplier_id = ?::uuid AND v.site_id = ?::uuid ORDER BY v.requested_at DESC LIMIT 200""", sid, site));
        out.put("classes", db.rows("SELECT * FROM supplier_risk_class WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid) ORDER BY site_id NULLS FIRST, sort_order, class_name", site));
        out.put("documents", db.rows("""
            SELECT d.id, d.qualification_id, d.promotion_id, d.doc_kind, d.title, d.certificate_expires, d.status, d.created_at, f.file_name, u.full_name AS added_by
              FROM vendor_document d JOIN document_file f ON f.id = d.document_id JOIN app_user u ON u.id = d.created_by
              LEFT JOIN vendor_qualification q ON q.id = d.qualification_id LEFT JOIN vendor_promotion p ON p.id = d.promotion_id
             WHERE COALESCE(q.supplier_id, p.supplier_id) = ?::uuid AND (q.id IS NULL OR q.site_id IS NULL OR q.site_id = ?::uuid) ORDER BY d.created_at DESC""", sid, site));
        out.put("promotions", db.rows("SELECT * FROM vendor_promotion_view WHERE supplier_id = ?::uuid ORDER BY created_at DESC", sid));
        out.put("scopes", db.rows("""
            SELECT id, scope_name, description, line_types::text[] AS line_types, chemical_types::text[] AS chemical_types FROM supply_scope
             WHERE status = 'Active' ORDER BY sort_order, scope_name"""));
        out.put("row", db.one("SELECT * FROM vendor_approval_view WHERE supplier_id = ?::uuid AND site_id = ?::uuid", sid, site));
        return out;
    }

    /** The Vendor approvals page: every vendor at this lab, the proposals, the notices, the scopes. */
    public Map<String, Object> vendors(String site) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("SELECT * FROM vendor_approval_view WHERE site_id = ?::uuid ORDER BY lower(supplier_name)", site));
        out.put("promotions", db.rows("""
            SELECT * FROM vendor_promotion_view WHERE status = 'Proposed' OR (site_id = ?::uuid AND decided_at > now() - interval '60 days')
             ORDER BY status <> 'Proposed', created_at DESC""", site));
        out.put("notices", db.rows("""
            SELECT n.*, s.supplier_name, s.supplier_code, u.full_name AS acknowledged_by_name FROM vendor_notice n JOIN supplier s ON s.id = n.supplier_id
              LEFT JOIN app_user u ON u.id = n.acknowledged_by WHERE n.site_id = ?::uuid AND (n.acknowledged_at IS NULL OR n.acknowledged_at > now() - interval '30 days')
             ORDER BY n.acknowledged_at IS NOT NULL, n.created_at DESC""", site));
        out.put("scopes", db.rows("SELECT id, scope_name FROM supply_scope WHERE status = 'Active' ORDER BY sort_order, scope_name"));
        return out;
    }

    public List<Map<String, Object>> scopes() {
        return db.rows("""
            SELECT sc.id, sc.scope_name, sc.description, sc.chemical_types::text[] AS chemical_types, sc.line_types::text[] AS line_types, sc.default_for::text AS default_for,
                sc.sort_order, sc.status, (SELECT count(*) FROM vendor_qualification q WHERE sc.id = ANY (q.scope_ids))::int AS used FROM supply_scope sc ORDER BY sc.sort_order, sc.scope_name""");
    }

    public List<Map<String, Object>> riskClasses(String site) {
        return db.rows("""
            SELECT rc.*, ls.site_code, (SELECT count(*) FROM vendor_qualification q WHERE q.risk_class_id = rc.id) AS used
              FROM supplier_risk_class rc LEFT JOIN lab_site ls ON ls.id = rc.site_id WHERE rc.site_id IS NULL OR rc.site_id = ?::uuid
             ORDER BY rc.site_id NULLS FIRST, rc.sort_order, rc.class_name""", site);
    }

    /** A vendor document's file, with the lab of the approval or proposal it belongs to (null for a corporate approval). */
    public Map<String, Object> documentFile(String id) {
        return db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, COALESCE(q.site_id, p.site_id) AS site_id
              FROM vendor_document d JOIN document_file f ON f.id = d.document_id LEFT JOIN vendor_qualification q ON q.id = d.qualification_id
              LEFT JOIN vendor_promotion p ON p.id = d.promotion_id WHERE d.id = ?::uuid""", id);
    }

    private static List<String> concat(List<String> a, List<String> b) {
        return java.util.stream.Stream.concat(a.stream(), b.stream()).toList();
    }
}
