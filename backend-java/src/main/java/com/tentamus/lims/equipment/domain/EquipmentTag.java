package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * A tag-out: the single thing that makes equipment unavailable (Maintenance, Repair, Calibration or Qualification).
 * Replaces the tag-in half of the database trigger equipment_tag_rules (migration 064): the work recorded, a passing
 * calibration or qualification, and the release by someone who did not tag it out or do the work. The tag-out half
 * stays in the database while purchasing and the hourly automatic tag-out write tags; {@link #checkTagOut} is Java's copy.
 */
public record EquipmentTag(String id, String code, String equipmentId, String reason, String scheduleId, boolean closed, Work work) {
    public static final String MAINTENANCE = "Maintenance";

    /** The work recorded under the tag, and who tagged it out or did or recorded that work. */
    public record Work(int records, int passingCalibrations, int passingQualifications, Set<String> workers) {}

    public static EquipmentTag of(Map<String, Object> row, Work work) {
        if (row == null) return null;
        return new EquipmentTag(Fields.str(row.get("id")), Fields.str(row.get("tag_code")), Fields.str(row.get("equipment_id")),
            Fields.str(row.get("reason")), Fields.str(row.get("schedule_id")), row.get("tagged_in_at") != null, work);
    }

    /**
     * A new tag-out of the equipment.
     *
     * @param scheduleEquipmentId the equipment of the maintenance schedule it names, or null
     * @param alreadyOpen         an open tag of the same reason (and schedule) exists
     */
    public static void checkTagOut(Equipment e, String reason, String scheduleId, String scheduleEquipmentId, boolean alreadyOpen) {
        e.assertNotRetired();
        if (scheduleId != null && !Objects.equals(scheduleEquipmentId, e.id())) throw RuleException.database("That maintenance schedule belongs to other equipment");
        if (alreadyOpen) throw RuleException.database(e.code() + " is already tagged out for " + Fields.str(reason).toLowerCase(Locale.ROOT));
    }

    /** Work recorded under this tag must be for the same equipment and the tag still open. */
    public void assertOpenFor(String equipmentId, boolean inserting) {
        if (!Objects.equals(this.equipmentId, equipmentId)) throw RuleException.database("That tag belongs to other equipment");
        if (inserting && closed) throw RuleException.database("Tag " + code + " is already closed");
    }

    /** A document filed under this tag must be filed on the same equipment (the rule of equipment_document_rules). */
    public void assertDocumentOf(String equipmentId) {
        if (!Objects.equals(this.equipmentId, equipmentId)) throw RuleException.database("The document is linked to a record of other equipment");
    }

    public boolean needsRelease() { return !MAINTENANCE.equals(reason); }

    /**
     * Back in service. Returns the meaning signed: "Returned to service by" after maintenance, else "Released by".
     *
     * @param user       who is tagging it back in
     * @param mayRelease they hold equipment.release in the equipment's lab
     */
    public String tagIn(Equipment e, CalibrationStatus status, String user, boolean mayRelease) {
        if (closed) throw RuleException.database("Tag " + code + " is closed and cannot be changed");
        if (work.records() == 0) throw RuleException.database("Record the work done (what was done, by whom, when) before tagging " + e.code() + " back in");
        if ("Calibration".equals(reason) && e.calibrationRequired() && status == CalibrationStatus.DEFICIENT)
            throw RuleException.database(e.code() + " has no passing, in-date calibration: record the calibration first");
        if ("Calibration".equals(reason) && work.passingCalibrations() == 0)
            throw RuleException.database("Record the passing calibration done under this tag before releasing " + e.code());
        if ("Qualification".equals(reason) && work.passingQualifications() == 0)
            throw RuleException.database("Record the passing qualification (IQ/OQ/PQ) done under this tag before releasing " + e.code());
        if (!needsRelease()) return "Returned to service by";
        if (!mayRelease)
            throw RuleException.database("Releasing equipment after " + reason.toLowerCase(Locale.ROOT) + " needs the release permission (equipment.release), usually QA");
        if (work.workers().contains(user))
            throw RuleException.database("You tagged " + e.code() + " out or did or recorded the work, so someone else must release it to service");
        return "Released by";
    }
}
