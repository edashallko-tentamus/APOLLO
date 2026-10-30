package com.tentamus.lims.equipment.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.equipment.domain.AutoTag;
import com.tentamus.lims.equipment.domain.Equipment;
import com.tentamus.lims.equipment.domain.EquipmentMessages;
import com.tentamus.lims.equipment.domain.EquipmentTag;
import com.tentamus.lims.equipment.domain.Fields;
import com.tentamus.lims.equipment.domain.LabListEntry;
import com.tentamus.lims.equipment.domain.MaintenanceSchedule;
import com.tentamus.lims.equipment.domain.Owners;
import com.tentamus.lims.equipment.domain.Transfer;
import com.tentamus.lims.equipment.domain.WorkRecord;
import com.tentamus.lims.equipment.repo.EquipmentOwners;
import com.tentamus.lims.equipment.repo.EquipmentRepository;
import com.tentamus.lims.equipment.repo.EquipmentStore;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.BiFunction;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Equipment: the register and the due list, the lab's types and departments, new equipment (one or many), owners,
 * tag-out and the work under a tag, tag-in and release, calibrations and qualifications (QA corrections), documents,
 * maintenance schedules and transfers. Every change is signed. The rules are the domain objects' (Equipment, Owners,
 * EquipmentTag, WorkRecord, MaintenanceSchedule, Transfer, AutoTag, LabListEntry); who may do what stays the
 * database's permission triggers until the permissions wave.
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
    private final EquipmentStore store;
    private final LabClock clock;

    public EquipmentService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, EquipmentRepository repo,
                            EquipmentStore store, LabClock clock) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.repo = repo;
        this.store = store;
        this.clock = clock;
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

    /** Automatic tag-outs (calibration expired, maintenance due), made by System before the lists are read. Returns how many. */
    public int autoTag(String site) {
        Object system = db.one("SELECT id FROM app_user WHERE username = 'system'").get("id");
        return uow.run(new RequestContext((String) system, null, "", "Automatic tag-out", "127.0.0.1"), d -> {
            LocalDate today = clock.today(site);
            List<AutoTag> tags = new ArrayList<>();
            for (Equipment e : store.needingCalibration(d, site)) {
                AutoTag t = AutoTag.forCalibration(e, store.currentCalibration(d, e.id()), today, store.calibrationTagOpen(d, e.id()));
                if (t != null) tags.add(t);
            }
            for (Map.Entry<Equipment, MaintenanceSchedule> x : store.tagOutSchedules(d, site)) {
                AutoTag t = AutoTag.forSchedule(x.getKey(), x.getValue(), today, store.scheduleTagOpen(d, x.getValue().id()));
                if (t != null) tags.add(t);
            }
            store.insertAutoTags(d, tags);
            return tags.size();
        });
    }

    /** Equipment loaded inside the transaction (the person's lab already checked). */
    private Equipment load(Db d, Object id) {
        Equipment e = store.equipment(d, id);
        if (e == null) throw new RuleException("Equipment not found");
        return e;
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
        return sign(ctx, body, "Changed by", "Equipment types list: " + rows.size() + " change(s)",
            d -> EquipmentRepository.TYPES.upsert(d, checkedRows(d, rows, "equipment_type", EquipmentRepository.TYPES, LabListEntry::type), Map.of("site_id", site)));
    }

    public List<Map<String, Object>> saveDepartments(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        return sign(ctx, body, "Changed by", "Departments list: " + rows.size() + " change(s)",
            d -> EquipmentRepository.DEPARTMENTS.upsert(d, checkedRows(d, rows, "department", EquipmentRepository.DEPARTMENTS, LabListEntry::department), Map.of("site_id", site)));
    }

    /**
     * Grid rows as they will be written, each checked by its domain rule (stored row, changes) -> values to write. An
     * update of a missing row is passed on unchanged (the writer then answers null for it, as before).
     */
    private List<Map<String, Object>> checkedRows(Db d, List<Map<String, Object>> rows, String table, RecordWriter writer,
                                                  BiFunction<Map<String, Object>, Map<String, Object>, Map<String, Object>> rule) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Map<String, Object> row : rows) {
            Map<String, Object> stored = store.stored(d, table, row.get("id"));
            if (row.get("id") != null && stored == null) { out.add(row); continue; }
            Map<String, Object> vals = writer.pick(row);
            if (row.get("id") != null && vals.isEmpty()) continue;
            out.add(withOptionalId(rule.apply(stored, vals), row.get("id")));
        }
        return out;
    }

    // ---------------------------------------------------------------- equipment
    @SuppressWarnings("unchecked")
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        row.remove("id");
        String action = "New equipment: " + str(row.get("equipment_name")) + (truthy(row.get("serial_number")) ? " (S/N " + str(row.get("serial_number")) + ")" : "");
        return sign(ctx, body, "Created by", action, d -> {
            Object id = insertEquipment(d, row, site);
            saveOwners(d, id, body.get("owners") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of());
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
                    Object id = insertEquipment(d, row, site);
                    saveOwners(d, id, List.of(Map.of("group_id", row.get("owner_group_id"))));
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
            Map<String, Object> vals = EquipmentRepository.EQUIPMENT.pick(map(body.get("row")));
            if (!vals.isEmpty()) EquipmentRepository.EQUIPMENT.update(d, (String) e.get("id"), checkedEquipment(d, store.stored(d, "equipment", e.get("id")), vals));
            if (body.get("owners") instanceof List<?> owners) saveOwners(d, e.get("id"), (List<Map<String, Object>>) owners);
            return Map.of("id", e.get("id"));
        });
    }

    /** New equipment, checked, in the person's lab. Returns its id. */
    private Object insertEquipment(Db d, Map<String, Object> row, String site) {
        Map<String, Object> vals = new LinkedHashMap<>(EquipmentRepository.EQUIPMENT.pick(row));
        vals.put("site_id", site);
        return EquipmentRepository.EQUIPMENT.insert(d, checkedEquipment(d, null, vals), "id").get("id");
    }

    private Map<String, Object> checkedEquipment(Db d, Map<String, Object> stored, Map<String, Object> vals) {
        Map<String, Object> after = Fields.after(stored, vals);
        return Equipment.checked(Equipment.of(stored), after, vals, store.type(d, after.get("equipment_type_id")),
            store.department(d, after.get("department_id")), store.locationSite(d, after.get("location_id")));
    }

    /** The complete set of owners, checked against the equipment's lab, then written. */
    private void saveOwners(Db d, Object equipmentId, List<Map<String, Object>> owners) {
        Equipment e = load(d, equipmentId);
        List<Equipment.LabEntry> groups = new ArrayList<>();
        List<Owners.Person> people = new ArrayList<>();
        for (Map<String, Object> o : owners) {
            if (truthy(o.get("group_id"))) groups.add(store.group(d, o.get("group_id")));
            else if (truthy(o.get("user_id"))) people.add(store.person(d, o.get("user_id"), e.siteId()));
        }
        groups.removeIf(Objects::isNull);
        new Owners(e, groups, people).check();
        EquipmentOwners.sync(d, equipmentId, owners);
    }

    public Map<String, Object> status(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Object to = body.get("admin_status");
        if (to == null || !List.of("In Service", "Out of Service", "Retired").contains(to)) throw new RuleException("Pick In Service, Out of Service or Retired");
        return sign(ctx, body, "Changed by", label(e) + ": " + to, d -> {
            Map<String, Object> vals = new LinkedHashMap<>();
            vals.put("admin_status", to);
            checkedEquipment(d, store.stored(d, "equipment", e.get("id")), vals);
            return d.raw("UPDATE equipment SET admin_status = ? WHERE id = ?::uuid", to, e.get("id"));
        });
    }

    // ---------------------------------------------------------------- tags and the work under them
    public Map<String, Object> tagOut(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        return sign(ctx, body, "Tagged out by", "Tag out " + label(e) + " for " + str(body.get("reason_code")).toLowerCase(), d -> {
            Equipment eq = load(d, e.get("id"));
            EquipmentTag.checkTagOut(eq, str(body.get("reason_code")), null, null, store.openTag(d, eq.id(), body.get("reason_code"), null));
            return store.insertTag(d, eq.id(), body.get("reason_code"), "Manual", null, or(body.get("description")));
        });
    }

    private Map<String, Object> tag(RequestContext ctx, Object tagId) {
        Map<String, Object> tg = repo.tag(tagId.toString());
        if (tg == null) throw new RuleException("Tag not found");
        access.checkSite(ctx, (String) tg.get("site_id"));
        return tg;
    }

    /** A maintenance log entry, checked; scheduled work moves the schedule's next due date on from the day it was done. */
    private Map<String, Object> event(Db d, RequestContext ctx, Object equipmentId, Map<String, Object> v, Object tagId) {
        Equipment e = load(d, equipmentId);
        Map<String, Object> vals = performer(v);
        vals.put("schedule_id", or(v.get("schedule_id")));
        vals.put("summary", v.get("summary"));
        MaintenanceSchedule s = vals.get("schedule_id") == null ? null : store.schedule(d, vals.get("schedule_id"));
        vals = WorkRecord.checkedNew(WorkRecord.Kind.EVENT, e, vals, tagId == null ? null : store.tag(d, tagId), s == null ? null : s.equipmentId(),
            clock.today(e.siteId()), ctx.userId());
        Map<String, Object> ev = d.one("""
            INSERT INTO equipment_event (equipment_id, tag_id, schedule_id, event_type, performed_date, performed_by_user_id, performed_by_vendor, summary)
              VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::uuid, ?, ?) RETURNING id, event_code, performed_date""",
            equipmentId, tagId, vals.get("schedule_id"), truthy(v.get("event_type")) ? v.get("event_type") : "Maintenance", vals.get("performed_date"),
            vals.get("performed_by_user_id"), vals.get("performed_by_vendor"), vals.get("summary"));
        if (s != null) store.moveScheduleOn(d, s, s.nextDueAfter(Fields.date(ev.get("performed_date"))));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", ev.get("id"));
        out.put("event_code", ev.get("event_code"));
        return out;
    }

    /** When and by whom, as the form sent it (a service company named means no person). */
    private static Map<String, Object> performer(Map<String, Object> v) {
        boolean vendor = truthy(v.get("performed_by_vendor"));
        Map<String, Object> vals = new LinkedHashMap<>();
        vals.put("performed_date", or(v.get("performed_date")));
        vals.put("performed_by_user_id", vendor ? null : or(v.get("performed_by_user_id")));
        vals.put("performed_by_vendor", or(v.get("performed_by_vendor")));
        return vals;
    }

    /** A maintenance log entry, with or without a tag; for scheduled work the schedule's next due date moves on. */
    public Map<String, Object> addEvent(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> v = map(body.get("row"));
        if (truthy(v.get("tag_id")) && !tag(ctx, v.get("tag_id")).get("equipment_id").equals(e.get("id"))) throw new RuleException("That tag belongs to other equipment");
        String type = truthy(v.get("event_type")) ? str(v.get("event_type")) : "Maintenance";
        return sign(ctx, body, "Performed by", type + " recorded for " + label(e), d -> event(d, ctx, e.get("id"), v, or(v.get("tag_id"))));
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
                event(d, ctx, tg.get("equipment_id"), v, tg.get("id"));
            }
            Equipment e = load(d, tg.get("equipment_id"));
            EquipmentTag tag = store.tag(d, tg.get("id"));
            String meaning = tag.tagIn(e, e.calibrationStatus(store.currentCalibration(d, e.id()), clock.today(e.siteId())), ctx.userId(),
                access.load(ctx.userId()).can("equipment.release", e.siteId()));
            store.tagIn(d, tag.id(), meaning);
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
            Map<String, Object> w = work(d, ctx, WorkRecord.Kind.CALIBRATION, e.get("id"), v);
            Map<String, Object> k = d.one("""
                INSERT INTO calibration (equipment_id, tag_id, performed_date, expiration_date, result, performed_by_user_id, performed_by_vendor, certificate_number, notes)
                  VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, ?, ?, ?) RETURNING id, calibration_code, expiration_date""",
                e.get("id"), or(v.get("tag_id")), w.get("performed_date"), w.get("expiration_date"), or(v.get("result")),
                w.get("performed_by_user_id"), w.get("performed_by_vendor"), or(v.get("certificate_number")), or(v.get("notes")));
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
            d -> correct(d, ctx, WorkRecord.Kind.CALIBRATION, EquipmentRepository.CALIBRATIONS, cid, (String) e.get("site_id"), map(body.get("row"))));
    }

    public Map<String, Object> addQualification(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> v = map(body.get("row"));
        String type = truthy(v.get("qualification_type")) ? str(v.get("qualification_type")) : "Qualification";
        return sign(ctx, body, "Recorded by", type + " of " + label(e) + " on " + str(v.get("performed_date")) + ": " + str(v.get("result")), d -> {
            Map<String, Object> w = work(d, ctx, WorkRecord.Kind.QUALIFICATION, e.get("id"), v);
            Map<String, Object> q = d.one("""
                INSERT INTO qualification (equipment_id, tag_id, qualification_type, performed_date, result, performed_by_user_id, performed_by_vendor, protocol_reference, notes)
                  VALUES (?::uuid, ?::uuid, ?, ?, ?, ?::uuid, ?, ?, ?) RETURNING id, qualification_code""",
                e.get("id"), or(v.get("tag_id")), or(v.get("qualification_type")), w.get("performed_date"), or(v.get("result")),
                w.get("performed_by_user_id"), w.get("performed_by_vendor"), or(v.get("protocol_reference")), or(v.get("notes")));
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
            d -> correct(d, ctx, WorkRecord.Kind.QUALIFICATION, EquipmentRepository.QUALIFICATIONS, qid, (String) e.get("site_id"), map(body.get("row"))));
    }

    /** A calibration or qualification about to be recorded: who did it, when, and for a calibration its expiry. */
    private Map<String, Object> work(Db d, RequestContext ctx, WorkRecord.Kind kind, Object equipmentId, Map<String, Object> v) {
        Equipment e = load(d, equipmentId);
        Map<String, Object> vals = performer(v);
        if (kind == WorkRecord.Kind.CALIBRATION) vals.put("expiration_date", or(v.get("expiration_date")));
        Object tagId = or(v.get("tag_id"));
        return WorkRecord.checkedNew(kind, e, vals, tagId == null ? null : store.tag(d, tagId), null, clock.today(e.siteId()), ctx.userId());
    }

    /** A correction: QA's for the expiry, date, result or withdrawing, never the person who did or recorded it. */
    private List<Map<String, Object>> correct(Db d, RequestContext ctx, WorkRecord.Kind kind, RecordWriter writer, String id, String site, Map<String, Object> row) {
        Map<String, Object> vals = writer.pick(row);
        Map<String, Object> stored = store.stored(d, kind.table(), id);
        if (stored != null && !vals.isEmpty())
            WorkRecord.checkCorrection(kind, stored, vals, clock.today(site), ctx.userId(), access.load(ctx.userId()).can("equipment.release", site));
        return writer.upsert(d, List.of(withId(row, id)), Map.of());
    }

    public Map<String, Object> addDocument(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> f = map(body.get("file"));
        if (!truthy(f.get("content_base64"))) throw new RuleException("Choose the file to upload");
        return sign(ctx, body, "Uploaded by", "Document " + str(f.get("file_name")) + " for " + label(e), d -> {
            EquipmentTag tag = truthy(f.get("tag_id")) ? store.tag(d, f.get("tag_id")) : null;
            if (tag != null) tag.assertDocumentOf((String) e.get("id"));
            return addDoc(d, e.get("id"), f, links("tag_id", f.get("tag_id"), null));
        });
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
        return sign(ctx, body, "Changed by", "Maintenance schedules of " + label(e) + ": " + rows.size() + " change(s)", d -> {
            if (rows.stream().anyMatch(r -> r.get("id") == null)) load(d, e.get("id")).assertNotRetired();
            return EquipmentRepository.SCHEDULES.upsert(d, checkedRows(d, rows, "maintenance_schedule", EquipmentRepository.SCHEDULES,
                (stored, vals) -> MaintenanceSchedule.checked(Fields.after(stored, vals), vals)), Map.of("equipment_id", e.get("id")));
        });
    }

    /** To another lab; the history goes with it and it arrives tagged out for qualification. */
    public Map<String, Object> transfer(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> e = equipment(ctx, id);
        Map<String, Object> to = RequestContext.isUuid(body.get("to_site_id")) ? db.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", body.get("to_site_id")) : null;
        if (to == null) throw new RuleException("Pick the lab it is going to");
        return sign(ctx, body, "Transferred by", "Transfer " + label(e) + " to " + to.get("site_code"), d -> {
            Equipment eq = load(d, e.get("id"));
            Transfer t = new Transfer(eq, (String) body.get("to_site_id"), store.siteCode(d, eq.siteId()), (String) to.get("site_code"), truthy(body.get("notes")) ? str(body.get("notes")) : null);
            Object group = or(body.get("owner_group_id")), dept = or(body.get("department_id"));
            t.check(RequestContext.isUuid(group) ? store.group(d, group) : null, RequestContext.isUuid(dept) ? store.department(d, dept) : null);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", store.transfer(d, t, (String) group, (String) dept));
            return out;
        });
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

    private static Map<String, Object> withOptionalId(Map<String, Object> vals, Object id) {
        Map<String, Object> r = new LinkedHashMap<>(vals);
        if (id != null) r.put("id", id);
        return r;
    }

    private static Map<String, Object> withId(Map<String, Object> row, Object id) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return r;
    }
}
