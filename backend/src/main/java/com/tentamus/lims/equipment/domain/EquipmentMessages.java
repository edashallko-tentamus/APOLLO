package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.ConstraintMessages;

/** Readable messages for the equipment database checks still kept (the unique indexes and the equipment column checks). */
public final class EquipmentMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "equipment_serial_uq", "Another piece of equipment already has that manufacturer and serial number.",
        "equipment_type_name_uq", "That equipment type is already on this lab's list (names are unique, ignoring capitals).",
        "department_code_uq", "That department code is already used in this lab.",
        "department_name_uq", "That department name is already used in this lab.",
        "equipment_calibration_alert_days_check", "Warning days cannot be negative.",
        "equipment_calibration_interval_months_check", "The calibration interval must be at least 1 month.");

    private EquipmentMessages() {}
}
