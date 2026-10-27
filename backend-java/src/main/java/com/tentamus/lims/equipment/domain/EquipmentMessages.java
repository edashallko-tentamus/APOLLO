package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.ConstraintMessages;

/** Readable messages for the equipment database checks (the Node backend's routes_equipment.js MESSAGES). */
public final class EquipmentMessages {
    public static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "equipment_serial_uq", "Another piece of equipment already has that manufacturer and serial number.",
        "equipment_type_name_uq", "That equipment type is already on this lab's list (names are unique, ignoring capitals).",
        "department_code_uq", "That department code is already used in this lab.",
        "department_name_uq", "That department name is already used in this lab.",
        "calibration_dates", "The expiry date cannot be before the calibration date.",
        "calibration_who", "Say who did it: a person or the service company.",
        "qualification_who", "Say who did it: a person or the service company.",
        "equipment_event_who", "Say who did it: a person or the service company.",
        "equipment_event_summary_check", "Describe the work done.",
        "maintenance_schedule_interval_count_check", "The interval must be at least 1.",
        "equipment_calibration_alert_days_check", "Warning days cannot be negative.",
        "equipment_calibration_interval_months_check", "The calibration interval must be at least 1 month.");

    private EquipmentMessages() {}
}
