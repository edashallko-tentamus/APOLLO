package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Recurring maintenance of a piece of equipment ("Wavelength check every 3 months"). Replaces the checks on the task,
 * interval and warning days and the trigger equipment_event_advance_schedule (migration 064 drops them): recording the
 * scheduled work moves the next due date on.
 */
public record MaintenanceSchedule(String id, String equipmentId, String taskName, int intervalCount, String intervalUnit,
                                  LocalDate nextDue, boolean tagOutWhenDue, String status) {
    public static final List<String> UNITS = List.of("days", "weeks", "months", "years");

    public static MaintenanceSchedule of(Map<String, Object> row) {
        if (row == null) return null;
        Integer n = Fields.integer(row.get("interval_count"));
        return new MaintenanceSchedule(Fields.str(row.get("id")), Fields.str(row.get("equipment_id")), Fields.str(row.get("task_name")),
            n == null ? 0 : n, Fields.str(row.get("interval_unit")), Fields.date(row.get("next_due_date")),
            row.get("tag_out_when_due") == null || Fields.bool(row.get("tag_out_when_due")), Fields.str(row.get("status")));
    }

    /** Checks a schedule about to be saved and returns the values to write (the task name trimmed). */
    public static Map<String, Object> checked(Map<String, Object> after, Map<String, Object> changes) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (changes.containsKey("task_name")) out.put("task_name", Fields.trimmed(changes.get("task_name")));
        if (Fields.blank(after.get("task_name"))) throw RuleException.withCode("Name the maintenance task.", "23514");
        Integer n = Fields.integer(after.get("interval_count"));
        if (n != null && n < 1) throw RuleException.withCode("The interval must be at least 1.", "23514");
        Object unit = after.get("interval_unit");
        if (unit != null && !UNITS.contains(unit.toString())) throw RuleException.withCode("The interval unit must be days, weeks, months or years.", "23514");
        Integer alert = Fields.integer(after.get("alert_days"));
        if (alert != null && alert < 0) throw RuleException.withCode("Warning days cannot be negative.", "23514");
        return out;
    }

    public boolean active() { return status == null || "Active".equals(status); }

    /** The next due date once the work was done on the given day (the database's date + interval_of(count, unit)). */
    public LocalDate nextDueAfter(LocalDate done) {
        return switch (intervalUnit) {
            case "days" -> done.plusDays(intervalCount);
            case "weeks" -> done.plusDays(7L * intervalCount);
            case "months" -> done.plusMonths(intervalCount);
            case "years" -> done.plusMonths(12L * intervalCount);
            default -> throw new IllegalStateException("Unknown interval unit " + intervalUnit);
        };
    }

    /** Due for an automatic tag-out: active, "tag out when due", and due on or before today. */
    public boolean dueForTagOut(LocalDate today) {
        return active() && tagOutWhenDue && nextDue != null && !nextDue.isAfter(today);
    }

    public String dueNote() { return taskName + " due " + nextDue; }
}
