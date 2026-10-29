package com.tentamus.lims.equipment.domain;

import java.time.LocalDate;
import java.util.Map;

/** One calibration of a piece of equipment (the latest active one is its current calibration). */
public record Calibration(String id, String code, String result, LocalDate performedDate, LocalDate expirationDate) {

    public static Calibration of(Map<String, Object> row) {
        if (row == null || row.get("id") == null) return null;
        return new Calibration(Fields.str(row.get("id")), Fields.str(row.get("calibration_code")), Fields.str(row.get("result")),
            Fields.date(row.get("performed_date")), Fields.date(row.get("expiration_date")));
    }

    public boolean failed() { return "Fail".equals(result); }

    public boolean expiredOn(LocalDate today) { return expirationDate != null && expirationDate.isBefore(today); }

    /** Why the automatic tag-out was made (the database's equipment_auto_tag wording). */
    public static String deficiencyNote(Calibration current) {
        if (current == null) return "No calibration on record";
        if (current.failed()) return "Last calibration " + current.code + " failed";
        return "Calibration " + current.code + " expired " + current.expirationDate;
    }
}
