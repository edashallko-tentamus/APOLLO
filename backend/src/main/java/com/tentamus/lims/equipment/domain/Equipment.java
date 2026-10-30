package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * A piece of equipment in a lab's register (an HPLC or a pipette alike). Java's own copy of the database trigger
 * equipment_rules and the equipment column checks, which stay in the database while purchasing (received equipment)
 * and the demo data load still write equipment directly.
 */
public record Equipment(String id, String code, String name, String siteId, String status, boolean calibrationRequired,
                        Integer intervalMonths, int alertDays) {

    /** An entry of one of the lab's lists (equipment types, departments) or a group, as the checks need it. */
    public record LabEntry(String id, String name, String siteId, String status) {
        public static LabEntry of(Map<String, Object> row, String nameColumn) {
            if (row == null) return null;
            return new LabEntry(Fields.str(row.get("id")), Fields.str(row.get(nameColumn)), Fields.str(row.get("site_id")), Fields.str(row.get("status")));
        }

        public boolean active() { return "Active".equals(status); }

        public boolean activeIn(String site) { return active() && Objects.equals(siteId, site); }
    }

    public static Equipment of(Map<String, Object> row) {
        if (row == null) return null;
        Integer alert = Fields.integer(row.get("calibration_alert_days"));
        return new Equipment(Fields.str(row.get("id")), Fields.str(row.get("equipment_code")), Fields.str(row.get("equipment_name")),
            Fields.str(row.get("site_id")), Fields.str(row.get("admin_status")), Fields.bool(row.get("calibration_required")),
            Fields.integer(row.get("calibration_interval_months")), alert == null ? 30 : alert);
    }

    public String label() { return code + " " + name; }

    public boolean retired() { return "Retired".equals(status); }

    public boolean inService() { return status == null || "In Service".equals(status); }

    /** Nothing new is recorded or tagged on retired equipment. */
    public void assertNotRetired() {
        if (retired()) throw RuleException.database(code + " is retired");
    }

    /** The default calibration expiry: the instrument's interval from the date it was done, less a day. */
    public LocalDate defaultExpiry(LocalDate performed) {
        return intervalMonths == null || performed == null ? null : performed.plusMonths(intervalMonths).minusDays(1);
    }

    public CalibrationStatus calibrationStatus(Calibration current, LocalDate today) {
        return CalibrationStatus.of(calibrationRequired, current, alertDays, today);
    }

    /**
     * Checks equipment about to be saved and returns the values to write (name trimmed, serial number and manufacturer
     * trimmed or empty).
     *
     * @param before    the equipment as stored, or null for new equipment
     * @param after     the equipment as it will be (stored values with the changes, or the new values and its lab)
     * @param changes   the columns being written
     * @param type      the equipment type it names
     * @param department the department it names, or null
     * @param locationSite the lab of the storage location it names, or null
     */
    public static Map<String, Object> checked(Equipment before, Map<String, Object> after, Map<String, Object> changes,
                                              LabEntry type, LabEntry department, String locationSite) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("equipment_name")) out.put("equipment_name", Fields.trimmed(changes.get("equipment_name")));
        if (changes.containsKey("serial_number")) out.put("serial_number", Fields.trimmed(changes.get("serial_number")));
        if (changes.containsKey("manufacturer")) out.put("manufacturer", Fields.trimmed(changes.get("manufacturer")));
        String name = Fields.trimmed(after.get("equipment_name"));
        if (name == null) throw RuleException.withCode("Give the equipment a name.", "23514");
        Integer interval = Fields.integer(after.get("calibration_interval_months"));
        if (interval != null && interval < 1) throw RuleException.withCode("The calibration interval must be at least 1 month.", "23514");
        Integer alert = Fields.integer(after.get("calibration_alert_days"));
        if (alert != null && alert < 0) throw RuleException.withCode("Warning days cannot be negative.", "23514");
        String site = Fields.str(after.get("site_id"));
        if (before == null || changes.containsKey("equipment_type_id")) {
            String v = listProblem(type, site);
            if (v != null) throw RuleException.database("That equipment type " + v + "; pick one from this lab's Equipment types list");
        }
        if (department != null && (before == null || changes.containsKey("department_id"))) {
            String v = listProblem(department, site);
            if (v != null) throw RuleException.database("That department " + v + "; pick one from this lab's Departments list");
        }
        if (locationSite != null && !locationSite.equals(site)) throw RuleException.database("That location belongs to another lab");
        if (Fields.blank(after.get("department_id")) && !"Retired".equals(Fields.str(after.get("admin_status"))))
            throw RuleException.database("Pick the department " + name + " belongs to (from this lab's Departments list)");
        return out;
    }

    private static String listProblem(LabEntry entry, String site) {
        if (entry == null) return null;
        if (!Objects.equals(entry.siteId(), site)) return "belongs to another lab";
        return entry.active() ? null : "is Inactive";
    }
}
