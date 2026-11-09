package com.tentamus.lims.labels.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** What each barcode label shows, for samples, inventory lots, equipment and batches (the screens draw and lay them out). Read only. */
@Service
public class LabelsService {
    private static final Map<String, String> SQL = Map.of(
        "sample", """
            SELECT s.id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.lot AS product_lot, s.number_of_units,
                (s.logged_at AT TIME ZONE ls.time_zone)::date::text AS logged_at,
                o.order_code, o.site_id, COALESCE(cl.display_name, cl.legal_name) AS client_name,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('test_name', t.test_name, 'due_date', rt.due_date, 'rush', rt.rush_status IN ('Auto-accepted','Approved')) ORDER BY rt.due_date NULLS LAST, t.test_name)
                            FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled'), '[]') AS tests
              FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id JOIN lab_site ls ON ls.id = o.site_id
             WHERE s.id = ANY(?::uuid[]) AND s.sample_code IS NOT NULL ORDER BY s.sample_code""",
        "lot", """
            SELECT l.id, l.lot_code, l.item_name, l.manufacturer_lot, l.expiration_date, l.retest_date, l.received_date, l.opened_date,
                l.container_count, l.storage_condition::text AS storage_condition, l.site_id, media_status(l.id) AS media_status, lot_qa_status(l.id) AS qa_status
              FROM inventory_lot l WHERE l.id = ANY(?::uuid[]) ORDER BY l.lot_code""",
        "equipment", """
            SELECT e.id, e.equipment_code, e.equipment_name, e.type_name, e.serial_number, e.model, e.cal_expires, e.calibration_status,
                e.maintenance_due, e.site_id FROM equipment_view e WHERE e.id = ANY(?::uuid[]) ORDER BY e.equipment_code""",
        "batch", """
            SELECT b.id, b.batch_code, b.test_name, b.test_code, b.version_no, b.site_id, b.created_at, b.assigned_name,
                COALESCE((SELECT jsonb_agg(jsonb_build_object('position', e.position, 'label', e.label, 'entry_type', e.entry_type, 'qc_type', e.qc_type, 'sample_code', s.sample_code) ORDER BY e.position)
                            FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
                           WHERE e.batch_id = b.id AND e.status = 'Active' AND e.daily_of_entry_id IS NULL), '[]') AS entries
              FROM test_batch_view b WHERE b.id = ANY(?::uuid[]) ORDER BY b.batch_code""");
    private final Db db;
    private final AccessPolicy access;

    public LabelsService(Db db, AccessPolicy access) {
        this.db = db;
        this.access = access;
    }

    public List<Map<String, Object>> labels(RequestContext ctx, String kind, Map<String, String> query) {
        access.currentSite(ctx);
        List<Object> ids = new ArrayList<>();
        for (String x : Js.string(query.get("ids")).split(",")) if (RequestContext.isUuid(x.trim()) && ids.size() < 500) ids.add(x.trim());
        if (ids.isEmpty()) throw new RuleException("Choose what to print labels for");
        String sql = SQL.get(kind);
        if (sql == null) throw new RuleException("Unknown kind of label");
        List<Map<String, Object>> rows = db.rows(sql, ids);
        Set<Object> labs = new LinkedHashSet<>();
        for (Map<String, Object> r : rows) labs.add(r.get("site_id"));
        for (Object s : labs) access.checkSite(ctx, (String) s);
        return rows;
    }
}
