package com.tentamus.lims.search.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Search everything: the box at the top of every page. Any ID, name or number (typed or scanned) finds the records it
 * belongs to. Lab records come from the lab being worked in; shared records from everywhere. An exact ID match is
 * returned as exact so the screen opens it at once. Opening a record still runs that page's own checks.
 */
@Service
public class SearchService {
    /** A kind of record: the permissions it needs (any of them), and its query over p (site, lk = '%text%', q = the text). */
    record Source(String kind, List<String> perm, String sql) {}

    private static final List<Source> SOURCES = List.of(
        new Source("Sample", List.of(), """
            SELECT s.id, COALESCE(s.sample_code, s.client_sample_id, 'Not logged') AS code, COALESCE(s.client_sample_id, s.description, '') AS title, o.order_code AS sub, '#/samples/' || s.id AS href,
            (upper(replace(s.sample_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(s.metrc_id::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, s.created_at
            FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE o.site_id = (SELECT site FROM p) AND (s.sample_code ILIKE (SELECT lk FROM p) OR s.client_sample_id ILIKE (SELECT lk FROM p) OR s.metrc_id ILIKE (SELECT lk FROM p) OR s.description ILIKE (SELECT lk FROM p))"""),
        new Source("Lab order", List.of(), """
            SELECT o.id, o.order_code AS code, COALESCE(c.display_name, c.legal_name) AS title, COALESCE('PO ' || o.po_number, '') AS sub, '#/orders/' || o.id AS href,
            (upper(replace(o.order_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(o.po_number::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, o.created_at
            FROM lab_order o JOIN client c ON c.id = o.client_id WHERE o.site_id = (SELECT site FROM p) AND (o.order_code ILIKE (SELECT lk FROM p) OR o.po_number ILIKE (SELECT lk FROM p))"""),
        new Source("COA", List.of(), """
            SELECT s.id, s.sample_code || '-R' || v.version_no AS code, COALESCE(s.client_sample_id, '') AS title, 'Version ' || v.version_no || CASE WHEN v.is_final THEN ', final' ELSE '' END AS sub,
            '#/samples/' || s.id AS href, (upper(replace(s.sample_code || '-R' || v.version_no::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(v.verify_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, v.issued_at AS created_at
            FROM coa_version v JOIN coa ON coa.id = v.coa_id JOIN sample s ON s.id = coa.sample_id WHERE coa.site_id = (SELECT site FROM p)
            AND ((s.sample_code || '-R' || v.version_no) ILIKE (SELECT lk FROM p) OR v.verify_code ILIKE (SELECT lk FROM p))"""),
        new Source("Inventory", List.of(), """
            SELECT l.id, l.lot_code AS code, l.material AS title, COALESCE('Lot ' || l.manufacturer_lot, '') AS sub, '#/inventory/lots/' || l.id AS href,
            (upper(replace(l.lot_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(l.manufacturer_lot::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, l.created_at
            FROM inventory_lot_view l WHERE l.site_id = (SELECT site FROM p) AND (l.lot_code ILIKE (SELECT lk FROM p) OR l.material ILIKE (SELECT lk FROM p) OR l.manufacturer_lot ILIKE (SELECT lk FROM p) OR l.cas_display ILIKE (SELECT lk FROM p))"""),
        new Source("Equipment", List.of(), """
            SELECT e.id, e.equipment_code AS code, e.equipment_name AS title, concat_ws(' · ', e.type_name, CASE WHEN e.serial_number IS NOT NULL THEN 'S/N ' || e.serial_number END) AS sub,
            '#/equipment/' || e.id AS href, (upper(replace(e.equipment_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(e.serial_number::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, e.created_at
            FROM equipment_view e WHERE e.site_id = (SELECT site FROM p) AND (e.equipment_code ILIKE (SELECT lk FROM p) OR e.equipment_name ILIKE (SELECT lk FROM p) OR e.serial_number ILIKE (SELECT lk FROM p) OR e.model ILIKE (SELECT lk FROM p))"""),
        new Source("Batch", List.of(), """
            SELECT b.id, b.batch_code AS code, b.test_code || ' ' || b.test_name AS title, b.status::text AS sub, '#/testing/batches/' || b.id AS href,
            upper(replace(b.batch_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, b.created_at
            FROM test_batch_view b WHERE b.site_id = (SELECT site FROM p) AND NOT b.is_verification AND (b.batch_code ILIKE (SELECT lk FROM p))"""),
        new Source("Client", List.of(), """
            SELECT c.id, c.client_code AS code, COALESCE(c.display_name, c.legal_name) AS title, c.account_status::text AS sub, '#/clients/' || c.id AS href,
            upper(replace(c.client_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, c.created_at
            FROM client c WHERE (SELECT site FROM p)::uuid IS NOT NULL AND (c.client_code ILIKE (SELECT lk FROM p) OR c.legal_name ILIKE (SELECT lk FROM p) OR c.display_name ILIKE (SELECT lk FROM p))"""),
        new Source("Contact", List.of(), """
            SELECT ct.id, ct.contact_code AS code, ct.first_name || ' ' || ct.last_name AS title, ct.email AS sub, '#/contacts?find=' || ct.contact_code AS href,
            (upper(replace(ct.contact_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(ct.email::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, ct.created_at
            FROM contact ct WHERE (SELECT site FROM p)::uuid IS NOT NULL AND (ct.contact_code ILIKE (SELECT lk FROM p) OR (ct.first_name || ' ' || ct.last_name) ILIKE (SELECT lk FROM p) OR ct.email ILIKE (SELECT lk FROM p))"""),
        new Source("Quote or project", List.of(), """
            SELECT p.id, p.project_code AS code, p.project_name AS title, p.kind::text || ' · ' || COALESCE(cl.display_name, cl.legal_name) AS sub,
            CASE p.kind::text WHEN 'Project' THEN '#/projects/' WHEN 'Stability' THEN '#/stability/quotes/' ELSE '#/quotes/' END || p.id AS href,
            upper(replace(p.project_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, p.created_at
            FROM project p JOIN client cl ON cl.id = p.client_id WHERE (SELECT site FROM p)::uuid IS NOT NULL AND (p.project_code ILIKE (SELECT lk FROM p) OR p.project_name ILIKE (SELECT lk FROM p))"""),
        new Source("Stability study", List.of(), """
            SELECT s.id, s.study_code AS code, s.product AS title, s.client_name AS sub, '#/stability/studies/' || s.id AS href,
            upper(replace(s.study_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, s.created_at
            FROM stability_study_view s WHERE s.site_id = (SELECT site FROM p) AND (s.study_code ILIKE (SELECT lk FROM p) OR s.product ILIKE (SELECT lk FROM p))"""),
        new Source("OOS investigation", List.of(), """
            SELECT x.id, x.oos_code AS code, a.analyte_name || ' in ' || s.sample_code AS title, x.status::text AS sub, '#/oos/' || x.id AS href,
            upper(replace(x.oos_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, x.opened_at AS created_at
            FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN analyte a ON a.id = x.analyte_id WHERE x.site_id = (SELECT site FROM p) AND x.oos_code ILIKE (SELECT lk FROM p)"""),
        new Source("Invoice", List.of("invoicing.view", "invoicing.issue"), """
            SELECT i.id, i.code, i.client_name AS title, i.kind::text || ' · ' || i.status::text AS sub, '#/billing/invoices/' || i.id AS href,
            (upper(replace(i.code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(i.invoice_number::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, i.created_at
            FROM invoice_view i WHERE i.site_id = (SELECT site FROM p) AND (i.code ILIKE (SELECT lk FROM p) OR i.invoice_number::text ILIKE (SELECT lk FROM p))"""),
        new Source("Purchase request", List.of(), """
            SELECT v.id, v.line_code AS code, v.description AS title, v.status::text AS sub, '#/purchasing/requests/' || v.id AS href,
            upper(replace(v.line_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, v.requested_at AS created_at
            FROM purchase_line_view v WHERE v.site_id = (SELECT site FROM p) AND (v.line_code ILIKE (SELECT lk FROM p) OR v.description ILIKE (SELECT lk FROM p) OR v.catalog_number ILIKE (SELECT lk FROM p))"""),
        new Source("Purchase order", List.of(), """
            SELECT o.id, o.po_code AS code, s.supplier_name AS title, COALESCE('Finance PO ' || o.external_po_number, '') AS sub, '#/purchasing/orders/' || o.id AS href,
            (upper(replace(o.po_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) OR upper(replace(o.external_po_number::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', ''))) AS exact, o.ordered_at AS created_at
            FROM purchase_order o JOIN supplier s ON s.id = o.supplier_id WHERE o.site_id = (SELECT site FROM p) AND (o.po_code ILIKE (SELECT lk FROM p) OR o.external_po_number ILIKE (SELECT lk FROM p))"""),
        new Source("Supplier", List.of(), """
            SELECT s.id, s.supplier_code AS code, s.supplier_name AS title, '' AS sub, '#/purchasing/suppliers/' || s.id AS href,
            upper(replace(s.supplier_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, s.created_at
            FROM supplier s WHERE (SELECT site FROM p)::uuid IS NOT NULL AND (s.supplier_code ILIKE (SELECT lk FROM p) OR s.supplier_name ILIKE (SELECT lk FROM p))"""),
        new Source("Logbook", List.of(), """
            SELECT l.id, l.logbook_code AS code, l.logbook_name AS title, l.kind::text AS sub, '#/logbooks/' || l.id AS href,
            upper(replace(l.logbook_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, l.created_at
            FROM logbook l WHERE l.site_id = (SELECT site FROM p) AND (l.logbook_code ILIKE (SELECT lk FROM p) OR l.logbook_name ILIKE (SELECT lk FROM p))"""),
        new Source("Logbook entry", List.of(), """
            SELECT e.id, e.entry_code AS code, l.logbook_name AS title, e.status::text AS sub, '#/logbooks/entries/' || e.id AS href,
            upper(replace(e.entry_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, e.created_at
            FROM logbook_entry e JOIN logbook l ON l.id = e.logbook_id WHERE l.site_id = (SELECT site FROM p) AND e.entry_code ILIKE (SELECT lk FROM p)"""),
        new Source("Test", List.of(), """
            SELECT t.id, t.test_code AS code, t.test_name AS title, COALESCE(ls.site_code, '') AS sub, '#/methods/tests/' || t.id AS href,
            upper(replace(t.test_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, t.created_at
            FROM test t LEFT JOIN lab_site ls ON ls.id = t.site_id WHERE (t.site_id = (SELECT site FROM p) OR t.site_id IS NULL) AND (t.test_code ILIKE (SELECT lk FROM p) OR t.test_name ILIKE (SELECT lk FROM p))"""),
        new Source("Trend chart", List.of(), """
            SELECT t.id, t.chart_code AS code, t.chart_name AS title, t.source::text AS sub, '#/trending/charts/' || t.id AS href,
            upper(replace(t.chart_code::text, ' ', '')) = upper(replace((SELECT q FROM p), ' ', '')) AS exact, t.created_at
            FROM trend_chart t WHERE t.site_id = (SELECT site FROM p) AND t.status = 'Active' AND (t.chart_code ILIKE (SELECT lk FROM p) OR t.chart_name ILIKE (SELECT lk FROM p))""")
    );
    private final Db db;
    private final AccessPolicy access;

    public SearchService(Db db, AccessPolicy access) {
        this.db = db;
        this.access = access;
    }

    public Map<String, Object> search(RequestContext ctx, Map<String, String> query) {
        String q = Js.string(query.get("q")).trim();
        if (q.length() > 100) q = q.substring(0, 100);
        if (q.length() < 2) return map("q", q, "results", List.of(), "exact", null);
        String site = access.currentSite(ctx);
        String like = "%" + q.replaceAll("([\\%_])", "\\$1") + "%";
        long each = Math.min(20, Math.max(3, Js.intOr(query.get("each"), 6)));
        UserAccess a = access.load(ctx.userId());
        List<Map<String, Object>> results = new ArrayList<>(), errors = new ArrayList<>();
        for (Source s : SOURCES) {
            if (!s.perm().isEmpty() && s.perm().stream().noneMatch(p -> a.can(p, ctx.siteId()))) continue;
            try {
                for (Map<String, Object> r : db.rows("WITH p AS (SELECT ?::uuid AS site, ?::text AS lk, ?::text AS q) SELECT * FROM (" + s.sql()
                        + ") x ORDER BY exact DESC, created_at DESC NULLS LAST LIMIT " + each, site, like, q))
                    results.add(map("kind", s.kind(), "id", r.get("id"), "code", r.get("code"), "title", r.get("title"), "sub", r.get("sub"), "href", r.get("href"),
                        "exact", Js.truthy(r.get("exact"))));
            } catch (RuntimeException e) {
                errors.add(map("kind", s.kind(), "error", e.getMessage()));
            }
        }
        List<Map<String, Object>> exacts = results.stream().filter(r -> Boolean.TRUE.equals(r.get("exact"))).toList();
        // one exact match opens it; a sample ID that is also its COA's first part prefers the sample
        Map<String, Object> exact = exacts.size() == 1 ? exacts.get(0) : exacts.stream().filter(r -> "Sample".equals(r.get("kind"))).findFirst().orElse(null);
        return map("q", q, "results", results, "errors", errors, "exact", exact);
    }
}
