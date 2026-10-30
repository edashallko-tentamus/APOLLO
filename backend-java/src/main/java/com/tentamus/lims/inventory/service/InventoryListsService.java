package com.tentamus.lims.inventory.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The inventory lists kept by Lab Supervisors, QA and administrators (chemicals, suppliers, storage locations, warning
 * rules), what the person may do, the screens' pick lists, the lab's QA testing defaults and sample storage.
 */
@Service
public class InventoryListsService {
    private static final RecordWriter CHEMICALS = new RecordWriter("chemical", List.of("chemical_name", "cas_number", "analyte_id", "synonyms", "hazard_notes", "status"));
    private static final RecordWriter SUPPLIERS = new RecordWriter("supplier", List.of("supplier_name", "supplier_type", "website", "email", "phone", "notes", "status",
        "account_number", "contact_name", "address"));
    private static final RecordWriter LOCATIONS = com.tentamus.lims.inventory.repo.StorageLocationRepository.WRITER;
    private static final RecordWriter THRESHOLDS = new RecordWriter("threshold_rule", List.of("rule_name", "subject", "rule_type", "value", "site_id", "chemical_id", "status"));
    private static final RecordWriter SAMPLE_STORAGE = new RecordWriter("sample", List.of("storage_location_id", "storage_condition", "retained_quantity", "retained_unit"));
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final CoaReader ai;
    private final ListRowRules rules;

    public InventoryListsService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, CoaReader ai, ListRowRules rules) {
        this.rules = rules;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.ai = ai;
    }

    /** What the screens let this person do in the lab. */
    public Map<String, Object> me(RequestContext ctx) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (!RequestContext.isUuid(ctx.userId())) { out.put("can_maintain", false); out.put("can_approve", false); return out; }
        UserAccess a = access.load(ctx.userId());
        String[][] all = {{"can_maintain", "inventory.lists"}, {"can_approve", "purchasing.approve"}, {"can_edit", "inventory.edit"}, {"can_use", "inventory.use"},
            {"can_adjust", "inventory.adjust"}, {"can_request", "purchasing.request"}, {"can_order", "purchasing.order"}, {"can_upload", "inventory.upload"},
            {"can_qualify", "inventory.qualify"}, {"can_qa_configure", "inventory.qa_configure"}};
        for (String[] p : all) out.put(p[0], a.can(p[1], ctx.siteId()));
        return out;
    }

    /** The pick lists of the inventory screens. */
    public Map<String, Object> meta() {
        Map<String, Object> out = new LinkedHashMap<>();
        for (String[] e : new String[][] {{"chemical_types", "chemical_type"}, {"storage_conditions", "storage_condition"}, {"location_types", "location_type"},
            {"supplier_types", "supplier_type"}, {"lot_statuses", "lot_status"}, {"receipt_statuses", "receipt_status"}, {"txn_types", "inventory_txn_type"},
            {"threshold_subjects", "threshold_subject"}, {"threshold_types", "threshold_type"}, {"job_roles", "user_job_role"}})
            out.put(e[0], values(e[1]));
        out.put("units", db.one("SELECT inventory_units() AS u").get("u"));
        out.put("conc_units", db.rows("SELECT unit_code FROM unit_of_measure WHERE status = 'Active' AND dimension = ANY(concentration_dims()) ORDER BY sort_order, unit_code")
            .stream().map(r -> r.get("unit_code")).toList());
        out.put("dimensions", values("unit_dimension"));
        out.put("forms", List.of("Solid", "Liquid"));
        Map<String, Object> aiInfo = new LinkedHashMap<>();
        aiInfo.put("enabled", ai.enabled());
        aiInfo.put("model", ai.model());
        out.put("ai", aiInfo);
        return out;
    }

    private List<Object> values(String enumType) {
        return db.rows("SELECT unnest(enum_range(NULL::" + enumType + "))::text AS v").stream().map(r -> r.get("v")).toList();
    }

    public List<Map<String, Object>> chemicals() {
        return db.rows("""
            SELECT ch.*, a.analyte_name, (SELECT count(*) FROM inventory_lot l WHERE l.chemical_id = ch.id) AS lot_count
              FROM chemical ch LEFT JOIN analyte a ON a.id = ch.analyte_id ORDER BY lower(ch.chemical_name)""");
    }

    public List<Map<String, Object>> saveChemicals(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, d -> {
            if (CHEMICALS.writesAny(rows)) access.requireToChange(ctx, "chemical", "inventory.lists");
            return CHEMICALS.upsert(d, rows, Map.of());
        });
    }

    public List<Map<String, Object>> suppliers() {
        return db.rows("""
            SELECT s.*, (SELECT count(*) FROM inventory_lot l WHERE l.supplier_id = s.id OR l.manufacturer_id = s.id) AS lot_count
              FROM supplier s ORDER BY lower(s.supplier_name)""");
    }

    public List<Map<String, Object>> saveSuppliers(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        return signatures.signed(ctx, body, new Meaning("Changed by", "Supplier list", "Purchasing"), d -> SUPPLIERS.upsert(d, rows, Map.of()));
    }

    public List<Map<String, Object>> locations(RequestContext ctx) {
        return db.rows("""
            SELECT l.*, location_path(l.id) AS path, p.location_code AS parent_code,
              (SELECT count(*) FROM inventory_lot i WHERE i.storage_location_id = l.id AND i.status NOT IN ('Disposed','Cancelled')) AS lot_count,
              (SELECT count(*) FROM sample s WHERE s.storage_location_id = l.id) AS sample_count
              FROM storage_location l LEFT JOIN storage_location p ON p.id = l.parent_location_id WHERE l.site_id = ?::uuid ORDER BY location_path(l.id)""",
            access.currentSite(ctx));
    }

    public List<Map<String, Object>> saveLocations(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return signatures.signed(ctx, body, new Meaning("Changed by", "Storage locations", "Inventory"), 
            d -> LOCATIONS.upsert(d, rows.stream().map(r -> rules.location(d, r, LOCATIONS.pick(r), site)).toList(), Map.of("site_id", site)));
    }

    /** One storage location: where it is, what is inside it, and every lot and sample kept there. */
    public Map<String, Object> location(RequestContext ctx, String id) {
        Map<String, Object> loc = db.one("""
            SELECT l.*, location_path(l.id) AS path, p.location_code AS parent_code, s.site_code FROM storage_location l
              LEFT JOIN storage_location p ON p.id = l.parent_location_id JOIN lab_site s ON s.id = l.site_id WHERE l.id = ?::uuid""", id);
        if (loc == null) throw new RuleException("Storage location not found");
        access.checkSite(ctx, (String) loc.get("site_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("location", loc);
        out.put("children", db.rows("""
            SELECT l.*, location_path(l.id) AS path,
              (SELECT count(*) FROM inventory_lot i WHERE i.storage_location_id = l.id AND i.status NOT IN ('Disposed','Cancelled')) AS lot_count,
              (SELECT count(*) FROM sample s WHERE s.storage_location_id = l.id) AS sample_count FROM storage_location l WHERE l.parent_location_id = ?::uuid ORDER BY l.location_code""", id));
        out.put("lots", db.rows("SELECT * FROM inventory_lot_view WHERE storage_location_id = ?::uuid AND status NOT IN ('Disposed','Cancelled') ORDER BY material", id));
        out.put("samples", db.rows("SELECT * FROM sample_storage_view WHERE storage_location_id = ?::uuid ORDER BY sample_code", id));
        return out;
    }

    public List<Map<String, Object>> thresholds() {
        return db.rows("""
            SELECT r.*, s.site_code, ch.chemical_name FROM threshold_rule r
              LEFT JOIN lab_site s ON s.id = r.site_id LEFT JOIN chemical ch ON ch.id = r.chemical_id ORDER BY r.subject, r.rule_name""");
    }

    public List<Map<String, Object>> saveThresholds(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        return signatures.signed(ctx, body, new Meaning("Changed by", "Warning rules", "Inventory"), 
            d -> THRESHOLDS.upsert(d, rows.stream().map(r -> rules.threshold(d, r, THRESHOLDS.pick(r))).toList(), Map.of()));
    }

    public List<Map<String, Object>> sites() { return db.rows("SELECT id, site_code, site_name FROM lab_site WHERE status = 'Active' ORDER BY site_code"); }

    /** Each lab's QA testing defaults (which item types are tested before use) and the lots waiting for it. */
    public Map<String, Object> qaDefaults(RequestContext ctx) {
        String site = access.currentSite(ctx);
        String waiting = "('Awaiting QA testing','In QA testing','Rejected','Rejected, retest under way')";
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("""
            SELECT d.*, u.full_name AS modified_by_name,
                (SELECT count(*) FROM inventory_lot l WHERE l.site_id = d.site_id AND d.chemical_type = ANY (l.chemical_types) AND lot_qa_status(l.id) IN %s)::int AS waiting
              FROM qa_testing_default d JOIN app_user u ON u.id = d.modified_by WHERE d.site_id = ?::uuid ORDER BY d.chemical_type::text""".formatted(waiting), site));
        out.put("lots", db.rows("""
            SELECT v.id, v.lot_code, v.material, v.manufacturer_lot, v.chemical_types_text, v.received_date, lot_qa_status(v.id) AS qa_status
              FROM inventory_lot_view v WHERE v.site_id = ?::uuid AND v.status NOT IN ('Disposed','Cancelled') AND lot_qa_status(v.id) IN %s
             ORDER BY lot_qa_status(v.id), v.lot_code""".formatted(waiting), site));
        out.put("can_edit", access.has(ctx, "inventory.qa_configure"));
        return out;
    }

    public Map<String, Object> saveQaDefaults(RequestContext ctx, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        if (ctx.reason().trim().isEmpty()) throw new RuleException("A Reason for Change is required");
        uow.run(ctx, d -> {
            for (Map<String, Object> row : rows) {
                if (!RequestContext.isUuid(row.get("id"))) continue;
                Map<String, Object> stored = d.one("SELECT site_id, chemical_type::text AS chemical_type, required, COALESCE(note, '') AS note_text FROM qa_testing_default WHERE id = ?::uuid", row.get("id"));
                if (stored == null) continue;
                Map<String, Object> ch = new LinkedHashMap<>();
                for (String k : List.of("site_id", "chemical_type", "note")) if (row.containsKey(k)) ch.put(k, row.get(k));
                Object note = com.tentamus.lims.inventory.domain.QaTestingDefault.checked(stored, ch).get("note");
                boolean changes = site.equals(stored.get("site_id"))
                    && (truthy(row.get("required")) != Boolean.TRUE.equals(stored.get("required")) || !(note == null ? "" : note.toString()).equals(stored.get("note_text")));
                if (changes) access.requireAt(ctx, "inventory.qa_configure", site);   // qa_testing_default_rules until 072
                d.update("""
                    UPDATE qa_testing_default SET required = ?::boolean, note = ? WHERE id = ?::uuid AND site_id = ?::uuid
                       AND (required, COALESCE(note, '')) IS DISTINCT FROM (?::boolean, COALESCE(?::text, ''))""",
                    truthy(row.get("required")), note, row.get("id"), site, truthy(row.get("required")), note);
            }
            return null;
        });
        return Map.of("ok", true);
    }

    public List<Map<String, Object>> sampleStorage(RequestContext ctx) {
        return db.rows("SELECT * FROM sample_storage_view WHERE site_id = ?::uuid AND status = 'Logged' ORDER BY logged_at DESC NULLS LAST, sample_code",
            access.currentSite(ctx));
    }

    /** Shelving samples by grid (location, condition, retained quantity), signed; only this lab's samples. */
    public List<Map<String, Object>> saveSampleStorage(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return signatures.signed(ctx, body, new Meaning("Changed by", "Sample storage: " + rows.size() + " sample(s)", "Inventory"), d -> {
            for (Map<String, Object> row : rows) {
                Map<String, Object> s = d.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", row.get("id"));
                if (s == null || !site.equals(s.get("site_id"))) throw new RuleException("A sample in the list belongs to another lab");
            }
            return SAMPLE_STORAGE.upsert(d, rows.stream().filter(r -> r.get("id") != null && !"".equals(r.get("id")))
                .map(r -> rules.sampleStorage(d, r, SAMPLE_STORAGE.pick(r), site)).toList(), Map.of());
        });
    }

    private static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }
}
