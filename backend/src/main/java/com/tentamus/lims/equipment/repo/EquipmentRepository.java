package com.tentamus.lims.equipment.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.paging.PagedList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** The equipment register, the due list, the lab's equipment lists and one instrument's whole history. */
@Repository
public class EquipmentRepository {
    public static final RecordWriter EQUIPMENT = new RecordWriter("equipment", List.of("equipment_name", "equipment_type_id", "department_id", "manufacturer", "model",
        "serial_number", "asset_tag", "location_id", "location_note", "calibration_required", "calibration_interval_months", "calibration_alert_days",
        "qualification_required", "in_service_date", "notes"));
    public static final RecordWriter TYPES = new RecordWriter("equipment_type", List.of("type_name", "description", "status"));
    public static final RecordWriter DEPARTMENTS = new RecordWriter("department", List.of("department_code", "department_name", "status"));
    public static final RecordWriter CALIBRATIONS = new RecordWriter("calibration", List.of("expiration_date", "performed_date", "result", "certificate_number", "notes", "status"));
    public static final RecordWriter QUALIFICATIONS = new RecordWriter("qualification", List.of("performed_date", "result", "protocol_reference", "notes", "status"));
    public static final RecordWriter DOCUMENTS = new RecordWriter("equipment_document", List.of("title", "doc_type", "status"));
    public static final RecordWriter SCHEDULES = new RecordWriter("maintenance_schedule", List.of("task_name", "interval_count", "interval_unit", "next_due_date",
        "alert_days", "tag_out_when_due", "instructions", "status"));
    static final String REGISTER_SQL = "SELECT e.*, is_equipment_owner(?::uuid, e.id) AS mine FROM equipment_view e WHERE e.site_id = ?::uuid";
    private final Db db;

    public EquipmentRepository(Db db) { this.db = db; }

    public List<Map<String, Object>> register(String site, String user) {
        return db.rows(REGISTER_SQL + " ORDER BY e.admin_status = 'Retired', lower(e.type_name), lower(e.equipment_name)", user, site);
    }

    /** One page, newest first. */
    public Map<String, Object> page(String site, String user, Map<String, String> query) {
        return PagedList.of(REGISTER_SQL, user, site)
            .filter("active", "admin_status::text <> 'Retired'").filter("tagged", "availability = 'Tagged out'")
            .filter("caldue", "admin_status::text = 'In Service' AND calibration_status IN ('Alert','Deficient')")
            .filter("mine", "mine AND admin_status::text <> 'Retired'").filter("retired", "admin_status::text = 'Retired'")
            .search("equipment_code", "equipment_name", "type_name", "manufacturer", "model", "serial_number", "owners", "department_code")
            .ids("equipment_code", "serial_number").order("ORDER BY created_at DESC, equipment_code DESC").run(db, query);
    }

    public List<Map<String, Object>> due(String site, String user) {
        return db.rows("""
            SELECT d.*, is_equipment_owner(?::uuid, d.equipment_id) AS mine FROM equipment_due_view d WHERE d.site_id = ?::uuid
             ORDER BY d.urgency = 'Due soon', d.due_date NULLS FIRST, d.equipment_code""", user, site);
    }

    /** The lab's equipment types and departments, and the choices the forms need. */
    public Map<String, Object> lists(String site) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("types", db.rows("""
            SELECT t.*, (SELECT count(*) FROM equipment e WHERE e.equipment_type_id = t.id AND e.admin_status <> 'Retired') AS equipment_count
              FROM equipment_type t WHERE t.site_id = ?::uuid ORDER BY t.status, lower(t.type_name)""", site));
        out.put("departments", db.rows("""
            SELECT d.*, (SELECT count(*) FROM equipment e WHERE e.department_id = d.id AND e.admin_status <> 'Retired') AS equipment_count
              FROM department d WHERE d.site_id = ?::uuid ORDER BY d.status, d.department_code""", site));
        out.put("groups", db.rows("SELECT id, group_name, description FROM lab_group WHERE site_id = ?::uuid AND status = 'Active' ORDER BY is_standard DESC, lower(group_name)", site));
        out.put("people", db.rows("""
            SELECT u.id, u.full_name, u.username FROM app_user u WHERE u.is_active AND u.username <> 'system' AND user_can_access_site(u.id, ?::uuid) ORDER BY u.full_name""", site));
        out.put("locations", db.rows("SELECT id, location_code, location_path(id) AS path FROM storage_location WHERE site_id = ?::uuid AND status = 'Active' ORDER BY location_path(id)", site));
        return out;
    }

    /** The other active labs, with their groups and departments (to transfer equipment to). */
    public List<Map<String, Object>> transferOptions(String site) {
        return db.rows("""
            SELECT s.id, s.site_code, s.site_name,
                (SELECT COALESCE(json_agg(json_build_object('id', g.id, 'group_name', g.group_name) ORDER BY g.is_standard DESC, g.group_name), '[]') FROM lab_group g
                  WHERE g.site_id = s.id AND g.status = 'Active') AS groups,
                (SELECT COALESCE(json_agg(json_build_object('id', d.id, 'department_code', d.department_code, 'department_name', d.department_name) ORDER BY d.department_code), '[]')
                  FROM department d WHERE d.site_id = s.id AND d.status = 'Active') AS departments
              FROM lab_site s WHERE s.status = 'Active' AND s.id <> ?::uuid ORDER BY s.site_code""", site);
    }

    public Map<String, Object> basic(String id) { return db.one("SELECT id, site_id, equipment_code, equipment_name FROM equipment WHERE id = ?::uuid", id); }

    public Map<String, Object> tag(String tagId) {
        return db.one("SELECT t.*, e.equipment_code, e.equipment_name, e.site_id FROM equipment_tag t JOIN equipment e ON e.id = t.equipment_id WHERE t.id = ?::uuid", tagId);
    }

    /** One instrument with owners, calibrations, qualifications, schedules, tags, logbook, documents and transfers. */
    public Map<String, Object> detail(String id, String user) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("eq", db.one("SELECT * FROM equipment_view WHERE id = ?::uuid", id));
        out.put("owners", db.rows("""
            SELECT o.id, o.group_id, o.user_id, g.group_name, u.full_name FROM equipment_owner o LEFT JOIN lab_group g ON g.id = o.group_id
              LEFT JOIN app_user u ON u.id = o.user_id WHERE o.equipment_id = ?::uuid AND o.status = 'Active' ORDER BY o.user_id IS NOT NULL, COALESCE(g.group_name, u.full_name)""", id));
        out.put("calibrations", db.rows("""
            SELECT k.*, COALESCE(u.full_name, k.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code,
                (SELECT json_agg(json_build_object('id', d.id, 'title', COALESCE(d.title, f.file_name))) FROM equipment_document d JOIN document_file f ON f.id = d.document_id
                  WHERE d.calibration_id = k.id AND d.status = 'Active') AS docs
              FROM calibration k LEFT JOIN app_user u ON u.id = k.performed_by_user_id JOIN app_user cu ON cu.id = k.created_by LEFT JOIN equipment_tag t ON t.id = k.tag_id
             WHERE k.equipment_id = ?::uuid ORDER BY k.status, k.performed_date DESC, k.created_at DESC""", id));
        out.put("qualifications", db.rows("""
            SELECT q.*, COALESCE(u.full_name, q.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code
              FROM qualification q LEFT JOIN app_user u ON u.id = q.performed_by_user_id JOIN app_user cu ON cu.id = q.created_by LEFT JOIN equipment_tag t ON t.id = q.tag_id
             WHERE q.equipment_id = ?::uuid ORDER BY q.status, q.performed_date DESC""", id));
        out.put("schedules", db.rows("""
            SELECT m.*, (m.next_due_date - site_today(e.site_id)) AS days_left FROM maintenance_schedule m JOIN equipment e ON e.id = m.equipment_id
             WHERE m.equipment_id = ?::uuid ORDER BY m.status, m.next_due_date""", id));
        out.put("tags", db.rows("""
            SELECT t.*, ou.full_name AS tagged_out_name, iu.full_name AS tagged_in_name, m.task_name,
                (SELECT count(*) FROM equipment_event v WHERE v.tag_id = t.id AND v.status = 'Active') + (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active')
                  + (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active') AS work_count,
                (SELECT count(*) FROM calibration v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_calibrations,
                (SELECT count(*) FROM qualification v WHERE v.tag_id = t.id AND v.status = 'Active' AND v.result = 'Pass') AS passing_qualifications,
                (?::uuid = ANY (COALESCE(tag_workers(t.id), '{}'))) AS i_worked_on_it
              FROM equipment_tag t JOIN app_user ou ON ou.id = t.tagged_out_by LEFT JOIN app_user iu ON iu.id = t.tagged_in_by LEFT JOIN maintenance_schedule m ON m.id = t.schedule_id
             WHERE t.equipment_id = ?::uuid ORDER BY t.tagged_in_at IS NOT NULL, t.tagged_out_at DESC""", user, id));
        out.put("events", db.rows("""
            SELECT v.*, COALESCE(u.full_name, v.performed_by_vendor) AS performed_by, cu.full_name AS recorded_by, t.tag_code, m.task_name
              FROM equipment_event v LEFT JOIN app_user u ON u.id = v.performed_by_user_id JOIN app_user cu ON cu.id = v.created_by
              LEFT JOIN equipment_tag t ON t.id = v.tag_id LEFT JOIN maintenance_schedule m ON m.id = v.schedule_id
             WHERE v.equipment_id = ?::uuid ORDER BY v.performed_date DESC, v.created_at DESC""", id));
        out.put("documents", db.rows("""
            SELECT d.id, d.doc_type, d.title, d.status, d.created_at, f.file_name, f.mime_type, f.size_bytes, f.sha256, u.full_name AS uploaded_by,
                k.calibration_code, q.qualification_code, v.event_code, t.tag_code
              FROM equipment_document d JOIN document_file f ON f.id = d.document_id JOIN app_user u ON u.id = d.created_by
              LEFT JOIN calibration k ON k.id = d.calibration_id LEFT JOIN qualification q ON q.id = d.qualification_id
              LEFT JOIN equipment_event v ON v.id = d.event_id LEFT JOIN equipment_tag t ON t.id = d.tag_id
             WHERE d.equipment_id = ?::uuid ORDER BY d.status, d.created_at DESC""", id));
        out.put("transfers", db.rows("""
            SELECT x.*, fs.site_code AS from_code, ts.site_code AS to_code, u.full_name AS by_name FROM equipment_transfer x
              JOIN lab_site fs ON fs.id = x.from_site_id JOIN lab_site ts ON ts.id = x.to_site_id JOIN app_user u ON u.id = x.created_by
             WHERE x.equipment_id = ?::uuid ORDER BY x.created_at DESC""", id));
        return out;
    }
}
