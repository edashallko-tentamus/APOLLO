package com.tentamus.lims.equipment.domain;

import java.time.LocalDate;

/**
 * Where a piece of equipment stands on calibration, derived and never typed. Java's own copy of the database's
 * calibration_status(), which stays for the views, the bench and the logbooks that read it.
 */
public enum CalibrationStatus {
    NOT_REQUIRED("Not required"), DEFICIENT("Deficient"), ALERT("Alert"), CONFORMS("Conforms");

    private final String label;

    CalibrationStatus(String label) { this.label = label; }

    public String label() { return label; }

    /** No calibration, a failed one or an expired one: Deficient; within the warning days of expiry: Alert. */
    public static CalibrationStatus of(boolean required, Calibration current, int alertDays, LocalDate today) {
        if (!required) return NOT_REQUIRED;
        if (current == null || current.failed() || current.expiredOn(today)) return DEFICIENT;
        if (current.expirationDate() != null && !current.expirationDate().isAfter(today.plusDays(alertDays))) return ALERT;
        return CONFORMS;
    }
}
