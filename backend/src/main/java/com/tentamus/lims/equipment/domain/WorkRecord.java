package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Work recorded on a piece of equipment: a maintenance log entry, a calibration or a qualification. Replaces the
 * database trigger equipment_work_rules (rules part) and the checks on who did it, the summary and the calibration
 * dates (migration 064 drops them); who may record or correct stays a permission check in the database.
 */
public final class WorkRecord {
    public enum Kind {
        EVENT("equipment_event"), CALIBRATION("calibration"), QUALIFICATION("qualification");

        private final String table;

        Kind(String table) { this.table = table; }

        public String table() { return table; }
    }

    /** The fields only QA corrects: expiry, date, result, withdrawing. */
    static final List<String> CORE = List.of("expiration_date", "performed_date", "result", "status");

    private WorkRecord() {}

    /**
     * Checks a new record and returns the values to write: the person recording it as the performer when nobody else is
     * named, and for a calibration the expiry from the instrument's interval when none is given.
     *
     * @param tag                 the open tag it is recorded under, or null
     * @param scheduleEquipmentId the equipment of the maintenance schedule it names (log entries), or null
     */
    public static Map<String, Object> checkedNew(Kind kind, Equipment e, Map<String, Object> vals, EquipmentTag tag,
                                                 String scheduleEquipmentId, LocalDate today, String user) {
        Map<String, Object> out = new LinkedHashMap<>(vals);
        e.assertNotRetired();
        if (tag != null) tag.assertOpenFor(e.id(), true);
        if (vals.get("schedule_id") != null && !Objects.equals(scheduleEquipmentId, e.id()))
            throw RuleException.database("That maintenance schedule belongs to other equipment");
        LocalDate done = Fields.date(vals.get("performed_date"));
        if (done != null && done.isAfter(today)) throw RuleException.database("The date it was done cannot be in the future");
        if (vals.get("performed_by_user_id") == null && Fields.blank(vals.get("performed_by_vendor"))) out.put("performed_by_user_id", user);
        if (kind == Kind.EVENT && Fields.blank(vals.get("summary"))) throw RuleException.withCode("Describe the work done.", "23514");
        if (kind == Kind.CALIBRATION) {
            if (vals.get("expiration_date") == null) {
                LocalDate expiry = e.defaultExpiry(done);
                if (expiry == null) throw RuleException.database("Give the calibration expiry date (this equipment has no calibration interval set)");
                out.put("expiration_date", expiry.toString());
            }
            checkDates(Fields.date(out.get("expiration_date")), done);
        }
        return out;
    }

    /**
     * A change to a calibration or qualification. Its expiry, date, result or status are corrected only by someone
     * holding equipment.release who did not do or record it; notes and certificate numbers by anyone who records them.
     *
     * @param stored     the record as stored (performed_by_user_id, created_by and the core fields)
     * @param mayRelease the person holds equipment.release in the equipment's lab
     */
    public static void checkCorrection(Kind kind, Map<String, Object> stored, Map<String, Object> changes, LocalDate today, String user, boolean mayRelease) {
        boolean core = CORE.stream().anyMatch(k -> changes.containsKey(k) && !sameValue(changes.get(k), stored.get(k)));
        if (core) {
            if (!mayRelease)
                throw RuleException.database("Changing a " + kind.table.replace('_', ' ') + " record's expiry, date, result or status needs the release permission (equipment.release), usually QA");
            if (Objects.equals(user, Fields.str(stored.get("performed_by_user_id"))) || Objects.equals(user, Fields.str(stored.get("created_by"))))
                throw RuleException.database("You did or recorded this " + kind.table + ", so someone else must change it");
        }
        Map<String, Object> after = Fields.after(stored, changes);
        LocalDate done = Fields.date(after.get("performed_date"));
        if (done != null && done.isAfter(today)) throw RuleException.database("The date it was done cannot be in the future");
        if (kind == Kind.CALIBRATION) checkDates(Fields.date(after.get("expiration_date")), done);
    }

    private static void checkDates(LocalDate expiry, LocalDate done) {
        if (expiry != null && done != null && expiry.isBefore(done)) throw RuleException.withCode("The expiry date cannot be before the calibration date.", "23514");
    }

    private static boolean sameValue(Object a, Object b) {
        if (a == null || b == null) return a == b;
        LocalDate da = Fields.date(a), db = Fields.date(b);
        if (da != null && db != null) return da.equals(db);
        return a.toString().equals(b.toString());
    }
}
