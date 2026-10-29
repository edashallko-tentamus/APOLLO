package com.tentamus.lims.equipment.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.equipment.domain.AutoTag;
import com.tentamus.lims.equipment.domain.Calibration;
import com.tentamus.lims.equipment.domain.Equipment;
import com.tentamus.lims.equipment.domain.EquipmentTag;
import com.tentamus.lims.equipment.domain.MaintenanceSchedule;
import com.tentamus.lims.equipment.domain.Owners;
import com.tentamus.lims.equipment.domain.Transfer;
import java.time.LocalDate;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/**
 * Loads and saves equipment's domain objects inside a transaction (SQL only here): equipment, its owners' facts, tags
 * with the work under them, calibrations, schedules, transfers and automatic tag-outs.
 */
@Repository
public class EquipmentStore {
    /** The tables whose stored rows the checks read. */
    private static final Set<String> TABLES = Set.of("equipment", "equipment_type", "department", "calibration", "qualification", "maintenance_schedule");

    public Map<String, Object> stored(Db d, String table, Object id) {
        if (!TABLES.contains(table)) throw new IllegalArgumentException("Not an equipment table: " + table);
        return id == null ? null : d.one("SELECT * FROM " + table + " WHERE id = ?::uuid", id);
    }

    public Equipment equipment(Db d, Object id) { return Equipment.of(stored(d, "equipment", id)); }

    public Equipment.LabEntry type(Db d, Object id) {
        return id == null ? null : Equipment.LabEntry.of(d.one("SELECT id, type_name, site_id, status FROM equipment_type WHERE id = ?::uuid", id), "type_name");
    }

    public Equipment.LabEntry department(Db d, Object id) {
        return id == null ? null : Equipment.LabEntry.of(d.one("SELECT id, department_name, site_id, status FROM department WHERE id = ?::uuid", id), "department_name");
    }

    public Equipment.LabEntry group(Db d, Object id) {
        return id == null ? null : Equipment.LabEntry.of(d.one("SELECT id, group_name, site_id, status FROM lab_group WHERE id = ?::uuid", id), "group_name");
    }

    public String locationSite(Db d, Object id) {
        Map<String, Object> l = id == null ? null : d.one("SELECT site_id FROM storage_location WHERE id = ?::uuid", id);
        return l == null ? null : (String) l.get("site_id");
    }

    public Owners.Person person(Db d, Object userId, String site) {
        Map<String, Object> u = d.one("SELECT id, full_name, is_active, user_can_access_site(id, ?::uuid) AS in_lab FROM app_user WHERE id = ?::uuid", site, userId);
        if (u == null) return new Owners.Person(String.valueOf(userId), null, false, false);
        return new Owners.Person((String) u.get("id"), (String) u.get("full_name"), Boolean.TRUE.equals(u.get("is_active")), Boolean.TRUE.equals(u.get("in_lab")));
    }

    public Calibration currentCalibration(Db d, String equipmentId) {
        return Calibration.of(d.one("""
            SELECT id, calibration_code, result, performed_date, expiration_date FROM calibration WHERE equipment_id = ?::uuid AND status = 'Active'
             ORDER BY performed_date DESC, created_at DESC LIMIT 1""", equipmentId));
    }

    // ---------------------------------------------------------------- tags
    public EquipmentTag tag(Db d, Object tagId) {
        Map<String, Object> t = d.one("""
            SELECT t.*,
                (SELECT count(*) FROM equipment_event v WHERE v.tag_id = t.id AND v.status = 'Active') + (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active')
                  + (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active') AS records,
                (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_calibrations,
                (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_qualifications
              FROM equipment_tag t WHERE t.id = ?::uuid""", tagId);
        if (t == null) return null;
        Set<String> workers = new HashSet<>();
        for (Map<String, Object> w : d.rows("""
            SELECT DISTINCT u FROM (
                SELECT tagged_out_by AS u FROM equipment_tag WHERE id = ?::uuid
                UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM equipment_event WHERE tag_id = ?::uuid AND status = 'Active'
                UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM calibration WHERE tag_id = ?::uuid AND status = 'Active'
                UNION ALL SELECT unnest(ARRAY[performed_by_user_id, created_by]) FROM qualification WHERE tag_id = ?::uuid AND status = 'Active') x
             WHERE u IS NOT NULL""", tagId, tagId, tagId, tagId)) workers.add(w.get("u").toString());
        return EquipmentTag.of(t, new EquipmentTag.Work(count(t, "records"), count(t, "passing_calibrations"), count(t, "passing_qualifications"), workers));
    }

    /** An open tag of this reason and schedule (no schedule matches only tags without one). */
    public boolean openTag(Db d, String equipmentId, Object reason, Object scheduleId) {
        return d.one("""
            SELECT 1 FROM equipment_tag WHERE equipment_id = ?::uuid AND tagged_in_at IS NULL AND reason::text = ?
               AND schedule_id IS NOT DISTINCT FROM ?::uuid""", equipmentId, reason, scheduleId) != null;
    }

    public Map<String, Object> insertTag(Db d, String equipmentId, Object reason, String source, Object scheduleId, Object description) {
        return d.one("INSERT INTO equipment_tag (equipment_id, reason, source, schedule_id, description) VALUES (?::uuid, ?::tag_reason, ?::tag_source, ?::uuid, ?) RETURNING id, tag_code",
            equipmentId, reason, source, scheduleId, description);
    }

    /** Back in service: when, by whom, with what meaning and under which signature (the signature of this transaction). */
    public void tagIn(Db d, String tagId, String meaning) {
        d.update("""
            UPDATE equipment_tag SET tagged_in_at = clock_timestamp(), tagged_in_by = current_app_user(), tag_in_meaning = ?,
                   tag_in_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", meaning, tagId);
    }

    // ---------------------------------------------------------------- schedules
    public MaintenanceSchedule schedule(Db d, Object id) { return MaintenanceSchedule.of(stored(d, "maintenance_schedule", id)); }

    /** Moves the schedule's next due date on; a step of the system, so the person's permission checks are skipped. */
    public void moveScheduleOn(Db d, MaintenanceSchedule s, LocalDate next) {
        if (next.equals(s.nextDue())) return;
        internally(d, "Scheduled maintenance done: next due date moved on",
            () -> d.update("UPDATE maintenance_schedule SET next_due_date = ?::date WHERE id = ?::uuid", next.toString(), s.id()));
    }

    // ---------------------------------------------------------------- automatic tag-outs
    public List<Equipment> needingCalibration(Db d, String site) {
        return d.rows("SELECT * FROM equipment WHERE admin_status = 'In Service' AND calibration_required AND site_id = ?::uuid", site).stream().map(Equipment::of).toList();
    }

    public boolean calibrationTagOpen(Db d, String equipmentId) {
        return d.one("SELECT 1 FROM equipment_tag WHERE equipment_id = ?::uuid AND reason = 'Calibration' AND tagged_in_at IS NULL", equipmentId) != null;
    }

    /** Active "tag out when due" schedules of the lab's equipment in service, each with its equipment. */
    public List<Map.Entry<Equipment, MaintenanceSchedule>> tagOutSchedules(Db d, String site) {
        return d.rows("""
            SELECT ms.* FROM maintenance_schedule ms JOIN equipment eq ON eq.id = ms.equipment_id
             WHERE ms.status = 'Active' AND ms.tag_out_when_due AND eq.admin_status = 'In Service' AND eq.site_id = ?::uuid""", site).stream()
            .map(r -> Map.entry(equipment(d, r.get("equipment_id")), MaintenanceSchedule.of(r))).toList();
    }

    public boolean scheduleTagOpen(Db d, String scheduleId) {
        return d.one("SELECT 1 FROM equipment_tag WHERE schedule_id = ?::uuid AND tagged_in_at IS NULL", scheduleId) != null;
    }

    public void insertAutoTags(Db d, List<AutoTag> tags) {
        internally(d, null, () -> { for (AutoTag t : tags) insertTag(d, t.equipmentId(), t.reason(), t.source(), t.scheduleId(), t.description()); });
    }

    // ---------------------------------------------------------------- transfer
    public String siteCode(Db d, String site) {
        Map<String, Object> s = d.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", site);
        return s == null ? null : (String) s.get("site_code");
    }

    /** Writes the transfer: the receiving lab's type, owner, department and Qualification tag, and the transfer record. */
    public String transfer(Db d, Transfer t, String ownerGroupId, String departmentId) {
        Equipment e = t.equipment();
        // who may transfer stays the database's permission check until the permissions wave
        d.one("SELECT require_permission_at('equipment.edit', ?::uuid), assert_signed('transfer equipment to another lab')", e.siteId());
        String[] id = new String[1];
        internally(d, t.reason(), () -> {
            String typeName = (String) d.one("SELECT type_name FROM equipment_type WHERE id = (SELECT equipment_type_id FROM equipment WHERE id = ?::uuid)", e.id()).get("type_name");
            Map<String, Object> type = d.one("SELECT id FROM equipment_type WHERE site_id = ?::uuid AND lower(type_name) = lower(?)", t.toSiteId(), typeName);
            Object typeId = type != null ? type.get("id")
                : d.one("INSERT INTO equipment_type (site_id, type_name, description) VALUES (?::uuid, ?, ?) RETURNING id", t.toSiteId(), typeName, t.typeNote()).get("id");
            d.update("UPDATE equipment_owner SET status = 'Inactive' WHERE equipment_id = ?::uuid AND status = 'Active'", e.id());
            d.update("UPDATE equipment SET site_id = ?::uuid, equipment_type_id = ?::uuid, department_id = ?::uuid, location_id = NULL WHERE id = ?::uuid",
                t.toSiteId(), typeId, departmentId, e.id());
            d.update("INSERT INTO equipment_owner (equipment_id, group_id) VALUES (?::uuid, ?::uuid)", e.id(), ownerGroupId);
            Object tag = insertTag(d, e.id(), "Qualification", "Transfer", null, t.tagNote()).get("id");
            id[0] = (String) d.one("INSERT INTO equipment_transfer (equipment_id, from_site_id, to_site_id, tag_id, notes) VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?) RETURNING id",
                e.id(), e.siteId(), t.toSiteId(), tag, t.notes()).get("id");
        });
        return id[0];
    }

    /**
     * A step of the system rather than of the person (lims.equipment_internal): the database's kept triggers then skip
     * the person's permission checks. A Reason for Change is given when the person gave none, for these writes only.
     */
    private static void internally(Db d, String reason, Runnable work) {
        String was = (String) d.one("SELECT COALESCE(current_setting('lims.equipment_internal', true), '') AS v").get("v");
        String reasonWas = (String) d.one("SELECT COALESCE(current_setting('lims.reason', true), '') AS v").get("v");
        d.one("SELECT set_config('lims.equipment_internal', '1', true)");
        if (reason != null && reasonWas.isBlank()) d.one("SELECT set_config('lims.reason', ?, true)", reason);
        try {
            work.run();
        } finally {
            d.one("SELECT set_config('lims.equipment_internal', ?, true), set_config('lims.reason', ?, true)", was, reasonWas);
        }
    }

    private static int count(Map<String, Object> row, String k) { return row.get(k) instanceof Number n ? n.intValue() : 0; }
}
