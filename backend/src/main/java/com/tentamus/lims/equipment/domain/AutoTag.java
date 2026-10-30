package com.tentamus.lims.equipment.domain;

import java.time.LocalDate;

/**
 * An automatic tag-out made by System: calibration expired, failed or missing, or maintenance due with "tag out when
 * due". Java's own copy of the database's equipment_auto_tag, which stays for the Node server's hourly job.
 */
public record AutoTag(String equipmentId, String reason, String source, String scheduleId, String description) {

    /** A tag for equipment in service that needs calibration and is Deficient, unless one is already open; else null. */
    public static AutoTag forCalibration(Equipment e, Calibration current, LocalDate today, boolean calibrationTagOpen) {
        if (!e.inService() || !e.calibrationRequired() || calibrationTagOpen) return null;
        if (e.calibrationStatus(current, today) != CalibrationStatus.DEFICIENT) return null;
        return new AutoTag(e.id(), "Calibration", "Calibration due", null, Calibration.deficiencyNote(current));
    }

    /** A tag for a schedule due today or earlier on equipment in service, unless its tag is already open; else null. */
    public static AutoTag forSchedule(Equipment e, MaintenanceSchedule s, LocalDate today, boolean scheduleTagOpen) {
        if (!e.inService() || scheduleTagOpen || !s.dueForTagOut(today)) return null;
        return new AutoTag(e.id(), EquipmentTag.MAINTENANCE, "Maintenance due", s.id(), s.dueNote());
    }
}
