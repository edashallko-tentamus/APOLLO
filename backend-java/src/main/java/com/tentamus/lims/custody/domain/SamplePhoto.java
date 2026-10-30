package com.tentamus.lims.custody.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * A photo of a sample taken at receipt: a JPEG or PNG, 4:3 (within 3 %), at least 400 x 300, never taken in the future.
 * The photo itself never changes: its caption and its place on the report (Report photo 1 or 2) may; it may be retired,
 * which takes it off the report, and a retired photo stays retired. Replaces the rule part of the trigger
 * sample_photo_rules and the checks on its size and shape (migration 063); the permission check is CustodyService's (migration 072).
 *
 * @param slot   its place on the report (1, 2) or null
 * @param status Active or Inactive
 */
public record SamplePhoto(int width, int height, String mimeType, Integer slot, String status) {

    /** A new photo: refused unless it is a JPEG or PNG, 4:3, at least 400 x 300 and not taken in the future. */
    public static SamplePhoto taken(int width, int height, String mimeType, Integer slot, Instant takenAt, Instant now) {
        if (width < 400) throw RuleException.withCode("new row for relation \"sample_photo\" violates check constraint \"sample_photo_width_px_check\"", "23514");
        if (height < 300) throw RuleException.withCode("new row for relation \"sample_photo\" violates check constraint \"sample_photo_height_px_check\"", "23514");
        if (!isFourThree(width, height)) throw RuleException.withCode("new row for relation \"sample_photo\" violates check constraint \"sample_photo_4_3\"", "23514");
        if (!"image/jpeg".equals(mimeType) && !"image/png".equals(mimeType)) throw RuleException.database("A sample photo is a JPEG or PNG image");
        if (takenAt != null && takenAt.isAfter(now.plus(5, ChronoUnit.MINUTES))) throw RuleException.database("A photo cannot be taken in the future");
        return new SamplePhoto(width, height, mimeType, slot, "Active");
    }

    /** 4:3 within 3 % of its longer side (integer arithmetic, as the database check). */
    public static boolean isFourThree(int w, int h) {
        return Math.abs((long) w * 3 - (long) h * 4) <= (long) Math.max(w, h) * 3 / 100;
    }

    /**
     * The photo with a new caption, place or status: a retired photo stays retired and leaves the report.
     *
     * @param newSlot   the report place asked for (null: none)
     * @param newStatus Active or Inactive
     */
    public SamplePhoto changed(Integer newSlot, String newStatus) {
        if (!"Active".equals(status) && "Active".equals(newStatus)) throw RuleException.database("A retired photo stays retired");
        return new SamplePhoto(width, height, mimeType, "Active".equals(newStatus) ? newSlot : null, newStatus);
    }
}
