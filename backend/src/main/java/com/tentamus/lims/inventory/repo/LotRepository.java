package com.tentamus.lims.inventory.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.inventory.domain.Lot;
import com.tentamus.lims.inventory.domain.LotAnalyteLine;
import com.tentamus.lims.inventory.domain.LotQaTesting;
import com.tentamus.lims.inventory.domain.Mixture;
import com.tentamus.lims.inventory.domain.StockMovement;
import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.domain.Values;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Repository;

/** Inventory lots (items), their analyte lines, movements and the pages that show them. */
@Repository
public class LotRepository {
    public static final List<String> LOT_FIELDS = List.of("item_name", "cas_number", "physical_form", "chemical_id", "item_description", "chemical_types",
        "supplier_id", "manufacturer_id", "catalog_number", "manufacturer_lot", "requested_quantity", "quantity_received", "unit", "container_count",
        "concentration", "concentration_unit", "purity_pct", "received_date", "opened_date", "expiration_date", "retest_date", "storage_condition",
        "storage_location_id", "status", "notes", "item_url", "department_id", "waste_classification_id");
    public static final RecordWriter LOTS = new RecordWriter("inventory_lot", LOT_FIELDS);
    /** A purchase request also sets its receipt status (Requested). */
    public static final RecordWriter REQUESTS = new RecordWriter("inventory_lot", concat(LOT_FIELDS, "receipt_status"));
    /** Every column Java's own lot actions write (receive, transfer, reorder, mixtures). */
    static final RecordWriter ALL = new RecordWriter("inventory_lot", concat(concat(concat(concat(LOT_FIELDS, "receipt_status"), "site_id"), "transferred_from_lot_id"),
        "reorder_of_lot_id"));
    static final String LOTS_SQL = """
        SELECT v.*, media_status(v.id) AS media_status, lot_qa_status(v.id) AS qa_status,
            w.waste_name, w.waste_code, w.needs_review AS waste_review, w.hazard_classes AS waste_hazards
          FROM inventory_lot_view v JOIN inventory_lot il ON il.id = v.id LEFT JOIN waste_classification w ON w.id = il.waste_classification_id WHERE v.site_id = ?::uuid""";
    static final String LOT_OPEN = "status::text NOT IN ('Disposed','Cancelled','Depleted')";
    private final Db db;

    public LotRepository(Db db) { this.db = db; }

    public List<Map<String, Object>> lots(String site) {
        return db.rows(LOTS_SQL + " ORDER BY (v.receipt_status = 'Received') DESC, (v.status IN ('Disposed','Cancelled')), v.material, v.lot_code", site);
    }

    public Map<String, Object> page(String site, Map<String, String> query) {
        return PagedList.of(LOTS_SQL, site)
            .filter("active", LOT_OPEN).filter("wasted", "NOT (" + LOT_OPEN + ")")
            .filter("expired", LOT_OPEN + " AND expiry_status::text IN ('Expired','Retest due')").filter("negative", "negative_stock")
            .filter("order", "receipt_status::text <> 'Received' AND status::text <> 'Cancelled'")
            .filter("qa", LOT_OPEN + " AND qa_status IS NOT NULL AND qa_status NOT LIKE 'Released%'")
            .filter("waste", LOT_OPEN + " AND (waste_name IS NULL OR waste_review)")
            .search("lot_code", "material", "manufacturer_lot", "cas_display", "supplier_name", "analytes_text").ids("lot_code", "manufacturer_lot")
            .order("ORDER BY created_at DESC, lot_code DESC").run(db, query);
    }

    public Map<String, Object> dashboard(String site) {
        return db.one("""
            SELECT count(*) FILTER (WHERE receipt_status = 'Received' AND status = 'Available') AS available,
              count(*) FILTER (WHERE expiry_status = 'Expired' AND status NOT IN ('Disposed','Cancelled')) AS expired,
              count(*) FILTER (WHERE expiry_status = 'Expiring soon' AND status NOT IN ('Disposed','Cancelled')) AS expiring,
              count(*) FILTER (WHERE low_stock) AS low_stock, count(*) FILTER (WHERE negative_stock) AS negative,
              count(*) FILTER (WHERE receipt_status = 'Requested' AND status <> 'Cancelled') AS awaiting_approval,
              count(*) FILTER (WHERE receipt_status IN ('Approved','Ordered','In Transit') AND status <> 'Cancelled') AS on_order
              FROM inventory_lot_view WHERE site_id = ?::uuid""", site);
    }

    /** The lab a lot belongs to, or null when there is no such lot. */
    public String siteOf(String lotId) {
        Map<String, Object> r = db.one("SELECT site_id FROM inventory_lot WHERE id = ?::uuid", lotId);
        return r == null ? null : (String) r.get("site_id");
    }

    /** "<verb>: lot INV-000012 Methanol", the action words a lot's signature is recorded with. */
    public String words(String lotId, String verb) {
        Map<String, Object> l = db.one("SELECT lot_code, item_name FROM inventory_lot WHERE id = ?::uuid", lotId);
        return verb + ": lot " + l.get("lot_code") + " " + (l.get("item_name") == null ? "null" : l.get("item_name"));
    }

    /** A lot's page: the lot (with its QA testing and waste details), analytes, warning rules, movements and links. */
    public Map<String, Object> detail(String id) {
        Map<String, Object> lot = db.one("SELECT * FROM inventory_lot_view WHERE id = ?::uuid", id);
        lot.putAll(db.one("""
            SELECT l.qualification_required, l.item_url, l.department_id, (SELECT department_name FROM department WHERE id = l.department_id) AS department_name,
                media_status(l.id) AS media_status, l.waste_classification_id, (SELECT to_jsonb(w) FROM waste_classification w WHERE w.id = l.waste_classification_id) AS waste,
                lot_qa_status(l.id) AS qa_status, lot_qa_required(l.id) AS qa_required, lab_qa_default(l.site_id, l.chemical_types) AS qa_default,
                (SELECT s.id FROM sample s WHERE s.sample_code = l.lot_code) AS sample_id FROM inventory_lot l WHERE l.id = ?::uuid""", id));
        Map<String, Object> out = new java.util.LinkedHashMap<>();
        out.put("lot", lot);
        out.put("analytes", db.rows("""
            SELECT la.*, a.analyte_name, a.analyte_code, a.cas_number AS analyte_cas,
              CASE WHEN la.target_concentration IS NULL THEN NULL WHEN la.concentration IS NULL THEN 'Not calculated'
                   WHEN abs(la.concentration - la.target_concentration) <= la.target_concentration * COALESCE(la.tolerance_pct, 0) / 100 THEN 'Conforms' ELSE 'Alert' END AS conformance
              FROM lot_analyte la JOIN analyte a ON a.id = la.analyte_id WHERE la.lot_id = ?::uuid AND la.status = 'Active' ORDER BY a.analyte_name""", id));
        out.put("rules", db.rows("SELECT * FROM lot_rule_results(?::uuid)", id));
        out.put("movements", db.rows("""
            SELECT t.*, u.full_name AS by_name, rl.lot_code AS related_code, rl.id AS related_id, rs.site_code AS related_site,
              sum(t.quantity_change) OVER (ORDER BY t.txn_at, t.created_at) AS running_total
              FROM inventory_transaction t JOIN app_user u ON u.id = t.created_by LEFT JOIN inventory_lot rl ON rl.id = t.related_lot_id LEFT JOIN lab_site rs ON rs.id = rl.site_id
             WHERE t.lot_id = ?::uuid ORDER BY t.txn_at, t.created_at""", id));
        out.put("components", db.rows("""
            SELECT lc.*, v.lot_code, v.material, v.manufacturer_lot, v.unit, v.expiration_date, v.chemical_types_text, v.analytes_text FROM lot_component lc
              JOIN inventory_lot_view v ON v.id = lc.component_lot_id WHERE lc.lot_id = ?::uuid ORDER BY v.material""", id));
        out.put("usedIn", db.rows("""
            SELECT lc.quantity_used, v.id, v.lot_code, v.material, v.expiration_date, v.status FROM lot_component lc
              JOIN inventory_lot_view v ON v.id = lc.lot_id WHERE lc.component_lot_id = ?::uuid ORDER BY v.lot_code""", id));
        out.put("coas", db.rows("""
            SELECT c.id, c.file_name, c.sha256, c.extraction_method, c.ai_model, c.ai_proposed, c.values_confirmed, c.created_at,
              c.confirmed_at, u.full_name AS uploaded_by, cu.full_name AS confirmed_by_name, d.mime_type, d.size_bytes, c.status
              FROM supplier_coa c JOIN document_file d ON d.id = c.document_id JOIN app_user u ON u.id = c.created_by LEFT JOIN app_user cu ON cu.id = c.confirmed_by
             WHERE c.lot_id = ?::uuid ORDER BY c.created_at DESC""", id));
        out.put("related", db.rows("""
            SELECT v.id, v.lot_code, v.site_code, v.receipt_status, v.status, 'Transferred to' AS relation FROM inventory_lot_view v WHERE v.transferred_from_lot_id = ?::uuid
            UNION ALL SELECT v.id, v.lot_code, v.site_code, v.receipt_status, v.status, 'Reordered as' FROM inventory_lot_view v WHERE v.reorder_of_lot_id = ?::uuid""", id, id));
        out.put("purchase", db.one("""
            SELECT v.id, v.line_code, v.status, v.po_code, v.external_po_number, v.requested_by FROM purchase_line_view v
             WHERE v.id = (SELECT purchase_line_id FROM inventory_lot WHERE id = ?::uuid)""", id));
        out.put("qualifications", db.rows("""
            SELECT q.*, COALESCE(ut.test_name, 'Every use') AS use_test_name, qt.test_name AS qualification_test_name, b.batch_code, u.full_name AS decided_by_name
              FROM media_qualification q LEFT JOIN test ut ON ut.id = q.use_test_id JOIN test qt ON qt.id = q.qualification_test_id
              LEFT JOIN test_batch b ON b.id = q.batch_id LEFT JOIN app_user u ON u.id = q.decided_by WHERE q.lot_id = ?::uuid ORDER BY q.created_at""", id));
        return out;
    }

    /** The "Send for QA testing" choice made at receipt: '1' needs it, '0' does not (QA's call), anything else the lab's default. */
    public void qaChoice(Db d, Object v) {
        String s = Boolean.TRUE.equals(v) || "1".equals(v) ? "1" : Boolean.FALSE.equals(v) || "0".equals(v) ? "0" : "";
        d.one("SELECT set_config('lims.qa_testing', ?, true)", s);
    }

    /** Keeps or adds each analyte line on an item (checked by {@link LotAnalyteLine}); lines not in the list are set Inactive (never deleted). */
    public void syncAnalytes(Db d, Object lotId, List<Map<String, Object>> list, Units units) {
        Lot lot = find(d, lotId.toString());
        List<Map<String, Object>> cur = d.rows("SELECT * FROM lot_analyte WHERE lot_id = ?::uuid", lotId);
        List<Map<String, Object>> given = list == null ? List.of() : list;
        for (Map<String, Object> a : given) {
            if (blank(a.get("analyte_id"))) continue;
            Map<String, Object> ex = cur.stream().filter(x -> Objects.equals(x.get("analyte_id"), a.get("analyte_id"))).findFirst().orElse(null);
            Map<String, Object> after = new LinkedHashMap<>(ex == null ? Map.of() : ex);
            after.put("lot_id", lotId.toString());
            after.put("analyte_id", a.get("analyte_id"));
            after.put("concentration", a.get("concentration"));
            after.put("concentration_unit", or(a.get("concentration_unit")));
            after.put("target_concentration", a.get("target_concentration"));
            Map<String, Object> ok = LotAnalyteLine.checked(lot, ex, after, analyteActive(d, a.get("analyte_id")), units);
            Object[] vals = {a.get("concentration"), ok.get("concentration_unit"), a.get("target_concentration"), a.get("tolerance_pct"),
                or(a.get("expressed_as")), a.get("formula_weight"), a.get("analyte_per_unit")};
            if (ex == null) d.update("""
                INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, expressed_as, formula_weight, analyte_per_unit)
                  VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, ?, ?, ?)""", lotId, a.get("analyte_id"), vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6]);
            else d.update("""
                UPDATE lot_analyte SET concentration = ?, concentration_unit = ?, target_concentration = ?, tolerance_pct = ?,
                  expressed_as = ?, formula_weight = ?, analyte_per_unit = ?, status = 'Active' WHERE id = ?::uuid""", vals[0], vals[1], vals[2], vals[3], vals[4], vals[5], vals[6], ex.get("id"));
        }
        for (Map<String, Object> ex : cur)
            if ("Active".equals(ex.get("status")) && given.stream().noneMatch(a -> Objects.equals(a.get("analyte_id"), ex.get("analyte_id"))))
                d.update("UPDATE lot_analyte SET status = 'Inactive' WHERE id = ?::uuid", ex.get("id"));
    }

    // ---------------------------------------------------------------- the lot as a domain object
    public Lot find(Db d, String id) { return Lot.of(d.one("SELECT * FROM inventory_lot WHERE id = ?::uuid", id)); }

    public Lot byCode(Db d, String code) { return Lot.of(d.one("SELECT * FROM inventory_lot WHERE upper(lot_code) = upper(?)", code)); }

    public Lot.Chemical chemical(Db d, Object id) {
        if (blank(id)) return null;
        Map<String, Object> c = d.one("SELECT chemical_name, cas_number, status::text = 'Active' AS active FROM chemical WHERE id = ?::uuid", id);
        return c == null ? null : new Lot.Chemical((String) c.get("chemical_name"), (String) c.get("cas_number"), Boolean.TRUE.equals(c.get("active")));
    }

    public LocalDate earliestComponentExpiry(Db d, String lotId) {
        if (lotId == null) return null;
        return Values.date(d.one("""
            SELECT min(c.expiration_date) AS d FROM lot_component lc JOIN inventory_lot c ON c.id = lc.component_lot_id WHERE lc.lot_id = ?::uuid""", lotId).get("d"));
    }

    public int activeAnalytes(Db d, String lotId) {
        return ((Number) d.one("SELECT count(*)::int AS n FROM lot_analyte WHERE lot_id = ?::uuid AND status = 'Active'", lotId).get("n")).intValue();
    }

    public boolean analyteActive(Db d, Object analyteId) {
        Map<String, Object> a = d.one("SELECT status::text AS s FROM analyte WHERE id = ?::uuid", analyteId);
        return a != null && "Active".equals(a.get("s"));
    }

    public BigDecimal onHand(Db d, String lotId) {
        return Values.dec(d.one("SELECT COALESCE(sum(quantity_change), 0) AS q FROM inventory_transaction WHERE lot_id = ?::uuid", lotId).get("q"));
    }

    /** The item types among these that the lab tests before use (its QA testing defaults). */
    public List<String> typesTheLabTests(Db d, String site, List<String> types) {
        return d.rows("SELECT chemical_type::text AS t FROM qa_testing_default WHERE site_id = ?::uuid AND required AND chemical_type::text = ANY(?::text[]) ORDER BY chemical_type",
            site, types).stream().map(r -> (String) r.get("t")).toList();
    }

    public LotQaTesting qaTesting(Db d, String lotId) {
        Map<String, Object> l = d.one("SELECT qualification_required FROM inventory_lot WHERE id = ?::uuid", lotId);
        List<LotQaTesting.Qualification> q = d.rows("""
            SELECT q.status::text AS status, q.use_test_id, t.test_name, to_char(q.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') AS at
              FROM media_qualification q LEFT JOIN test t ON t.id = q.use_test_id WHERE q.lot_id = ?::uuid""", lotId).stream()
            .map(r -> new LotQaTesting.Qualification((String) r.get("status"), (String) r.get("use_test_id"), (String) r.get("test_name"), (String) r.get("at"))).toList();
        return new LotQaTesting(l != null && Boolean.TRUE.equals(l.get("qualification_required")), q);
    }

    /** Component lots for a mixture, with their active analyte lines. */
    public Map<String, Mixture.Component> components(Db d, List<String> lotIds) {
        Map<String, Mixture.Component> out = new LinkedHashMap<>();
        for (Map<String, Object> l : d.rows("SELECT id, lot_code, item_name, unit, physical_form, expiration_date FROM inventory_lot WHERE id = ANY(?::uuid[])", lotIds)) {
            List<Mixture.AnalyteLine> lines = d.rows("""
                SELECT la.analyte_id, an.analyte_name, an.molar_mass, la.concentration, la.concentration_unit, uom.dimension::text AS dimension,
                       la.expressed_as, la.formula_weight, la.analyte_per_unit
                  FROM lot_analyte la JOIN analyte an ON an.id = la.analyte_id LEFT JOIN unit_of_measure uom ON uom.unit_code = la.concentration_unit
                 WHERE la.lot_id = ?::uuid AND la.status = 'Active' ORDER BY la.created_at, la.id""", l.get("id")).stream()
                .map(a -> new Mixture.AnalyteLine((String) a.get("analyte_id"), (String) a.get("analyte_name"), Values.dec(a.get("molar_mass")),
                    Values.dec(a.get("concentration")), (String) a.get("concentration_unit"), (String) a.get("dimension"), (String) a.get("expressed_as"),
                    Values.dec(a.get("formula_weight")), Values.dec(a.get("analyte_per_unit")))).toList();
            out.put((String) l.get("id"), new Mixture.Component((String) l.get("id"), (String) l.get("lot_code"), (String) l.get("unit"), (String) l.get("physical_form"),
                Values.date(l.get("expiration_date")), lines));
        }
        return out;
    }

    public String insert(Db d, Map<String, Object> vals) { return (String) ALL.insert(d, vals, "id").get("id"); }

    public void update(Db d, String id, Map<String, Object> changes) { if (!changes.isEmpty()) ALL.update(d, id, changes); }

    public Map<String, Object> insertMovement(Db d, StockMovement m, Object at) {
        return d.one("""
            INSERT INTO inventory_transaction (lot_id, txn_type, quantity_change, related_lot_id, reference, notes, reason, txn_at)
              VALUES (?::uuid, ?::inventory_txn_type, ?, ?::uuid, ?, ?, ?, COALESCE(?::timestamptz, clock_timestamp())) RETURNING id""",
            m.lotId(), m.type(), m.quantity(), m.relatedLotId(), m.reference(), m.notes(), blank(m.reason()) ? null : m.reason(), at);
    }

    /** A reorder or a transfer carries the item's analytes (a transfer also its targets and calculated values). */
    public void copyAnalytes(Db d, String from, String to, boolean all) {
        d.update(all ? """
            INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note)
            SELECT ?::uuid, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note
              FROM lot_analyte WHERE lot_id = ?::uuid AND status = 'Active' ON CONFLICT (lot_id, analyte_id) DO NOTHING""" : """
            INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit)
            SELECT ?::uuid, analyte_id, concentration, concentration_unit FROM lot_analyte WHERE lot_id = ?::uuid AND status = 'Active'
            ON CONFLICT (lot_id, analyte_id) DO NOTHING""", to, from);
    }

    /** The Supplier COA travels with transferred material (same document, name and fingerprint). */
    public void copyCoas(Db d, String from, String to) {
        d.update("""
            INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at)
            SELECT ?::uuid, document_id, file_name, sha256, extraction_method, values_confirmed, confirmed_by, confirmed_at
              FROM supplier_coa WHERE lot_id = ?::uuid AND status = 'Active'""", to, from);
    }

    public void addComponent(Db d, String mixture, Mixture.Portion p) {
        d.update("INSERT INTO lot_component (lot_id, component_lot_id, quantity_used, entered_quantity, entered_unit) VALUES (?::uuid, ?::uuid, ?, ?, ?)",
            mixture, p.lot().lotId(), p.quantity(), p.enteredQuantity(), p.enteredUnit());
    }

    public void addCalculatedAnalyte(Db d, String lot, Mixture.Concentration c, Object target, Object tolerance) {
        d.update("""
            INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit, target_concentration, tolerance_pct, calculated, calc_note)
              VALUES (?::uuid, ?::uuid, ?, ?, ?, ?, true, ?) ON CONFLICT (lot_id, analyte_id) DO NOTHING""",
            lot, c.analyteId(), c.concentration(), c.unit(), target, tolerance, c.note());
    }

    /** JavaScript's "x || null": empty text, false and 0 become null. */
    static Object or(Object v) { return blank(v) || Boolean.FALSE.equals(v) || (v instanceof Number n && n.doubleValue() == 0) ? null : v; }

    static boolean blank(Object v) { return v == null || "".equals(v); }

    private static List<String> concat(List<String> a, String b) { List<String> l = new ArrayList<>(a); l.add(b); return l; }
}
