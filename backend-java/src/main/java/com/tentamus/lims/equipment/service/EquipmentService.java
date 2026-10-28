package com.tentamus.lims.equipment.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.equipment.domain.EquipmentMessages;
import com.tentamus.lims.equipment.repo.EquipmentOwners;
import com.tentamus.lims.equipment.repo.EquipmentRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Equipment: the register and the due list, the lab's types and departments, new equipment (one or many), owners,
 * tag-out and the work under a tag, tag-in and release, calibrations and qualifications (QA corrections), documents,
 * maintenance schedules and transfers. Every change is signed; the rules (owners, release by someone else, automatic
 * tag-outs, schedules, transfers) are the database's.
 */
@Service
public class EquipmentService {
    private static final Pattern DOC_TYPES = Pattern.compile(
        "^(application/pdf|image/(png|jpeg|gif|webp)|text/plain|text/csv|application/vnd\\.openxmlformats-officedocument\\.(spreadsheetml\\.sheet|wordprocessingml\\.document))$");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final EquipmentRepository repo;

    public EquipmentService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, EquipmentRepository repo) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
    }

    private <T> T sign(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Equipment"), work);
    }

    /** Equipment of a lab the person may see, or a refusal. */
    private Map<String, Object> equipment(RequestContext ctx, String id) {
        Map<String, Object> e = repo.basic(id);
        if (e == null) throw new RuleException("Equipment not found");
        access.checkSite(ctx, (String) e.get("site_id"));
        return e;
    }

    private static String label(Map<String, Object> e) { return e.get("equipment_code") + " " + e.get("equipment_name"); }

    /** Automatic tag-outs (calibration expired, maintenance due), made by System before the lists are read. */
    public void autoTag(String site) {
        Object system = db.one("SELECT id FROM app_user WHERE username = 'system'").get("id");
        uow.run(new RequestContext((String) system, null, "", "Automatic tag-out", "127.0.0.1"), d -> d.one("SELECT equipment_auto_tag(?::uuid) AS n", site));
    }

    // ---------------------------------------------------------------- reading
    public Map<String, Object> me(RequestContext ctx) {
        access.currentSite(ctx);
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> out = new LinkedHashMap<>();
        for (String k : List.of("edit", "tag", "calibrate", "release", "lists")) out.put("can_" + k, a.can("equipment." + k, ctx.siteId()));
        return out;
    }

    public Map<String, Object> lists(RequestContext ctx) { return repo.lists(access.currentSite(ctx)); }

    public Object register(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        autoTag(site);
        return PagedList.wanted(query) ? repo.page(site, ctx.userId(), query) : repo.register(site, ctx.userId());
    }

    public List<Map<String, Object>> due(RequestContext ctx) {
        String site = access.currentSite(ctx);
        autoTag(site);
        return repo.due(site, ctx.userId());
    }

    public List<Map<String, Object>> transferOptions(RequestContext ctx) { return repo.transferOptions(access.currentSite(ctx)); }

    public Map<String, Object> detail(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Equipment not found");
        equipment(ctx, id);
        return repo.detail(id, ctx.userId());
    }

    // ---------------------------------------------------------------- the lab's lists
    public List<Map<String, Object>> saveTypes(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return sign(ctx, body, "Changed by", "Equipment types list: " + rows.size() + " change(s)", d -> EquipmentRepository.TYPES.upsert(d, rows, Map.of("site_id", site)));
    }

    public List<Map<String, Object>> saveDepartments(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return sign(ctx, body, "Changed by", "Departments list: " + rows.size() + " change(s)", d -> EquipmentRepository.DEPARTMENTS.upsert(d, rows, Map.of("site_id", site)));
    }

    // ---------------------------------------------------------------- equipment
    @SuppressWarnings("unchecked")
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        row.remove("id");
        String action = "New equipment: " + str(row.get("equipment_name")) + (truthy(row.get("serial_number")) ? " (S/N " + str(row.get("serial_number")) + ")" : "");
        return sign(ctx, body, "Created by", action, d -> {
            Object id = EquipmentRepository.EQUIPMENT.upsert(d, List.of(row), Map.of("site_id", site)).get(0).get("id");
            EquipmentOwners.sync(d, id, body.get("owners") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of());
            return d.one("SELECT id, equipment_code FROM equipment WHERE id = ?::uuid", id);
        });
    }

    /** Add many at once (paste, fill down): one owner group per row; the first refused row stops them all. */
    public Map<String, Object> createMany(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> given) {
        String site = access.currentSite(ctx);
        List<Map<String, Object>> rows = given.stream().filter(x -> truthy(x.get("equipment_name"))).toList();
        if (rows.isEmpty()) throw new RuleException("Nothing to add");
        return sign(ctx, body, "Created by", "New equipment: " + rows.size() + " item(s)", d -> {
            int created = 0;
            for (int i = 0; i < rows.size(); i++) {
                Map<String, Object> row = new LinkedHashMap<>(rows.get(i));
                try {
                    if (!truthy(row.get("owner_group_id"))) throw new RuleException("pick the group responsible for it");
                    row.remove("id");
                    Object id = EquipmentRepository.EQUIPMENT.upsert(d, List.of(row), Map.of("site_id", site)).get(0).get("id");
                    EquipmentOwners.sync(d, id, List.of(Map.of("group_id", row.get("owner_group_id"))));
                    created++;
                } catch (RuntimeException e) {
                    throw EquipmentMessages.MESSAGES.withPrefix(e, "Row " + (i + 1) + " (" + str(row.get("equipment_name")) + "): ");
                }
            }
            return Map.of("created", created);
        });
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> update(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        return sign(ctx, body, "Changed by", "Changed " + label(e), d -> {
            Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
            row.put("id", e.get("id"));
            EquipmentRepository.EQUIPMENT.upsert(d, List.of(row), Map.of());
            if (body.get("owners") instanceof List<?> owners) EquipmentOwners.sync(d, e.get("id"), (List<Map<String, Object>>) owners);
            return Map.of("id", e.get("id"));
        });
    }

    public Map<String, Object> status(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Object to = body.get("admin_status");
        if (to == null || !List.of("In Service", "Out of Service", "Retired").contains(to)) throw new RuleException("Pick In Service, Out of Service or Retired");
        return sign(ctx, body, "Changed by", label(e) + ": " + to, d -> d.raw("UPDATE equipment SET admin_status = ? WHERE id = ?::uuid", to, e.get("id")));
    }

    // ---------------------------------------------------------------- tags and the work under them
    public Map<String, Object> tagOut(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        return sign(ctx, body, "Tagged out by", "Tag out " + label(e) + " for " + str(body.get("reason_code")).toLowerCase(), d -> d.one(
            "INSERT INTO equipment_tag (equipment_id, reason, description) VALUES (?::uuid, ?, ?) RETURNING id, tag_code", e.get("id"), body.get("reason_code"), or(body.get("description"))));
    }

    private Map<String, Object> tag(RequestContext ctx, Object tagId) {
        Map<String, Object> tg = repo.tag(tagId.toString());
        if (tg == null) throw new RuleException("Tag not found");
        access.checkSite(ctx, (String) tg.get("site_id"));
        return tg;
    }

    private static Map<String, Object> event(Db d, Object equipmentId, Map<String, Object> v, Object tagId) {
        boolean vendor = truthy(v.get("performed_by_vendor"));
        return d.one("""
            INSERT INTO equipment_event (equipment_id, tag_id, schedule_id, event_type, performed_date, performed_by_user_id, performed_by_vendor, summary)
              VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid, ?, ?) RETURNING id, event_code""",
            equipmentId, tagId, or(v.get("schedule_id")), truthy(v.get("event_type")) ? v.get("event_type") : "Maintenance", or(v.get("performed_date")),
            vendor ? null : or(v.get("performed_by_user_id")), or(v.get("performed_by_vendor")), v.get("summary"));
    }

    /** A maintenance log entry, with or without a tag; for scheduled work the schedule's next due date moves on. */
    public Map<String, Object> addEvent(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> v = map(body.get("row"));
        if (truthy(v.get("tag_id")) && !tag(ctx, v.get("tag_id")).get("equipment_id").equals(e.get("id"))) throw new RuleException("That tag belongs to other equipment");
        String type = truthy(v.get("event_type")) ? str(v.get("event_type")) : "Maintenance";
        return sign(ctx, body, "Performed by", type + " recorded for " + label(e), d -> event(d, e.get("id"), v, or(v.get("tag_id"))));
    }

    /** Back in service: released (by someone who did not tag it out or do the work) or, after maintenance, tagged back in. */
    public Map<String, Object> tagIn(RequestContext ctx, String tagId, Map<String, Object> body) {
        Map<String, Object> tg = tag(ctx, tagId);
        boolean release = !"Maintenance".equals(tg.get("reason"));
        String action = (release ? "Release to service" : "Tag back in") + ": " + tg.get("equipment_code") + " " + tg.get("equipment_name") + " (" + tg.get("tag_code") + ", " + tg.get("reason") + ")";
        return sign(ctx, body, release ? "Released by" : "Returned to service by", action, d -> {
            if (!release && truthy(body.get("summary"))) {
                Map<String, Object> v = new LinkedHashMap<>();
                v.put("event_type", "Maintenance"); v.put("summary", body.get("summary")); v.put("schedule_id", tg.get("schedule_id")); v.put("performed_date", body.get("performed_date"));
                event(d, tg.get("equipment_id"), v, tg.get("id"));
            }
            d.update("UPDATE equipment_tag SET tagged_in_at = clock_timestamp() WHERE id = ?::uuid", tg.get("id"));
            return Map.of("id", tg.get("id"));
        });
    }

    // ---------------------------------------------------------------- calibrations, qualifications, documents
    private static Map<String, Object> addDoc(Db d, Object equipmentId, Map<String, Object> f, Map<String, Object> links) {
        if (f == null || !truthy(f.get("content_base64"))) return null;
        if (!DOC_TYPES.matcher(str(f.get("mime_type"))).matches()) throw new RuleException("Upload a PDF, an image (PNG or JPEG), a text or CSV file, or an Excel or Word file");
        Object file = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
            truthy(f.get("file_name")) ? f.get("file_name") : "document", f.get("mime_type"), f.get("content_base64")).get("id");
        return d.one("""
            INSERT INTO equipment_document (equipment_id, document_id, doc_type, title, calibration_id, qualification_id, event_id, tag_id)
              VALUES (?::uuid, ?::uuid, ?, ?, ?::uuid, ?::uuid, ?::uuid, ?::uuid) RETURNING id""",
            equipmentId, file, truthy(f.get("doc_type")) ? f.get("doc_type") : "Other", or(f.get("title")),
            or(links.get("calibration_id")), or(links.get("qualification_id")), or(links.get("event_id")), or(links.get("tag_id")));
    }

    public Map<String, Object> addCalibration(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> v = map(body.get("row"));
        return sign(ctx, body, "Recorded by", "Calibration of " + label(e) + " on " + str(v.get("performed_date")) + ": " + str(v.get("result")), d -> {
            boolean vendor = truthy(v.get("performed_by_vendor"));
            Map<String, Object> k = d.one("""
                INSERT INTO calibration (equipment_id, tag_id, performed_date, expiration_date, result, performed_by_user_id, performed_by_vendor, certificate_number, notes)
                  VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, ?, ?, ?) RETURNING id, calibration_code, expiration_date""",
                e.get("id"), or(v.get("tag_id")), or(v.get("performed_date")), or(v.get("expiration_date")), or(v.get("result")),
                vendor ? null : or(v.get("performed_by_user_id")), or(v.get("performed_by_vendor")), or(v.get("certificate_number")), or(v.get("notes")));
            Map<String, Object> f = map(body.get("file"));
            if (!f.isEmpty()) {
                Map<String, Object> doc = new LinkedHashMap<>(f);
                doc.put("doc_type", "Calibration certificate");
                doc.put("title", truthy(f.get("title")) ? f.get("title") : "Certificate " + (truthy(v.get("certificate_number")) ? str(v.get("certificate_number")) : str(k.get("calibration_code"))));
                addDoc(d, e.get("id"), doc, links("calibration_id", k.get("id"), v.get("tag_id")));
            }
            return k;
        });
    }

    /** QA corrections of a calibration (expiry, date, result, withdraw); notes and certificate number by the calibrator. */
    public List<Map<String, Object>> updateCalibration(RequestContext ctx, String cid, Map<String, Object> body) {
        Map<String, Object> k = db.one("SELECT equipment_id, calibration_code FROM calibration WHERE id = ?::uuid", cid);
        if (k == null) throw new RuleException("Calibration not found");
        Map<String, Object> e = equipment(ctx, (String) k.get("equipment_id"));
        return sign(ctx, body, "Changed by", "Calibration " + k.get("calibration_code") + " of " + label(e) + " changed",
            d -> EquipmentRepository.CALIBRATIONS.upsert(d, List.of(withId(map(body.get("row")), cid)), Map.of()));
    }

    public Map<String, Object> addQualification(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> v = map(body.get("row"));
        String type = truthy(v.get("qualification_type")) ? str(v.get("qualification_type")) : "Qualification";
        return sign(ctx, body, "Recorded by", type + " of " + label(e) + " on " + str(v.get("performed_date")) + ": " + str(v.get("result")), d -> {
            boolean vendor = truthy(v.get("performed_by_vendor"));
            Map<String, Object> q = d.one("""
                INSERT INTO qualification (equipment_id, tag_id, qualification_type, performed_date, result, performed_by_user_id, performed_by_vendor, protocol_reference, notes)
                  VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, ?, ?, ?) RETURNING id, qualification_code""",
                e.get("id"), or(v.get("tag_id")), or(v.get("qualification_type")), or(v.get("performed_date")), or(v.get("result")),
                vendor ? null : or(v.get("performed_by_user_id")), or(v.get("performed_by_vendor")), or(v.get("protocol_reference")), or(v.get("notes")));
            Map<String, Object> f = map(body.get("file"));
            if (!f.isEmpty()) {
                Map<String, Object> doc = new LinkedHashMap<>(f);
                doc.put("doc_type", "Qualification report");
                doc.put("title", truthy(f.get("title")) ? f.get("title") : (Js.string(v.get("qualification_type") == null ? "undefined" : v.get("qualification_type")) + " report " + str(v.get("protocol_reference"))).trim());
                addDoc(d, e.get("id"), doc, links("qualification_id", q.get("id"), v.get("tag_id")));
            }
            return q;
        });
    }

    public List<Map<String, Object>> updateQualification(RequestContext ctx, String qid, Map<String, Object> body) {
        Map<String, Object> q = db.one("SELECT equipment_id, qualification_code FROM qualification WHERE id = ?::uuid", qid);
        if (q == null) throw new RuleException("Qualification not found");
        Map<String, Object> e = equipment(ctx, (String) q.get("equipment_id"));
        return sign(ctx, body, "Changed by", "Qualification " + q.get("qualification_code") + " of " + label(e) + " changed",
            d -> EquipmentRepository.QUALIFICATIONS.upsert(d, List.of(withId(map(body.get("row")), qid)), Map.of()));
    }

    public Map<String, Object> addDocument(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> f = map(body.get("file"));
        if (!truthy(f.get("content_base64"))) throw new RuleException("Choose the file to upload");
        return sign(ctx, body, "Uploaded by", "Document " + str(f.get("file_name")) + " for " + label(e), d -> addDoc(d, e.get("id"), f, links("tag_id", f.get("tag_id"), null)));
    }

    /** Titles, types and withdrawing of this lab's equipment documents. */
    public List<Map<String, Object>> saveDocuments(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        for (Map<String, Object> x : rows) {
            Map<String, Object> d = db.one("SELECT e.site_id FROM equipment_document d JOIN equipment e ON e.id = d.equipment_id WHERE d.id = ?::uuid", x.get("id"));
            if (d == null || !site.equals(d.get("site_id"))) throw new RuleException("Document not found in this lab");
        }
        return sign(ctx, body, "Changed by", "Equipment documents: " + rows.size() + " change(s)",
            d -> EquipmentRepository.DOCUMENTS.upsert(d, rows.stream().filter(x -> truthy(x.get("id"))).toList(), Map.of()));
    }

    public Map<String, Object> documentFile(RequestContext ctx, String docId) {
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, e.site_id FROM equipment_document d
              JOIN document_file f ON f.id = d.document_id JOIN equipment e ON e.id = d.equipment_id WHERE d.id = ?::uuid""", docId);
        if (d == null) throw new RuleException("Document not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    // ---------------------------------------------------------------- schedules and transfers
    public List<Map<String, Object>> saveSchedules(RequestContext ctx, String id, Map<String, Object> body, List<Map<String, Object>> rows) {
        Map<String, Object> e = equipment(ctx, id);
        return sign(ctx, body, "Changed by", "Maintenance schedules of " + label(e) + ": " + rows.size() + " change(s)",
            d -> EquipmentRepository.SCHEDULES.upsert(d, rows, Map.of("equipment_id", e.get("id"))));
    }

    /** To another lab; the history goes with it and it arrives tagged out for qualification. */
    public Map<String, Object> transfer(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> to = RequestContext.isUuid(body.get("to_site_id")) ? db.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", body.get("to_site_id")) : null;
        if (to == null) throw new RuleException("Pick the lab it is going to");
        return sign(ctx, body, "Transferred by", "Transfer " + label(e) + " to " + to.get("site_code"), d -> d.one("SELECT transfer_equipment(?::uuid, ?::uuid, ?::uuid, ?::uuid, ?) AS id",
            e.get("id"), body.get("to_site_id"), or(body.get("owner_group_id")), or(body.get("department_id")), or(body.get("notes"))));
    }

    // ---------------------------------------------------------------- helpers
    private static Map<String, Object> links(String key, Object id, Object tagId) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put(key, id);
        if (tagId != null) l.put("tag_id", tagId);
        return l;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    private static String str(Object o) { return o == null ? "" : Js.string(o); }

    private static Object or(Object v) { return truthy(v) ? v : null; }

    private static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && n.doubleValue() == 0);
    }

    private static Map<String, Object> withId(Map<String, Object> row, Object id) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return r;
    }
}
