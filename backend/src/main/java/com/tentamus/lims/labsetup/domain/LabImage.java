package com.tentamus.lims.labsetup.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Set;

/**
 * A lab's image (logo, small logo, accreditation mark, other): a PNG, JPEG or SVG up to 2 MB, never replaced (retired
 * and uploaded again). Also the product name setting, which keeps its name and is never blank. Replaces site_media_rules
 * and the rule part of system_setting_rules (migration 071).
 */
public final class LabImage {
    private static final Set<String> TYPES = Set.of("image/png", "image/jpeg", "image/svg+xml");

    private LabImage() {}

    /** A new image: refused unless it is a PNG, JPEG or SVG of at most 2 MB. */
    public static void checkUpload(String mimeType, long bytes) {
        if (!TYPES.contains(mimeType)) throw RuleException.database("Upload a PNG, JPEG or SVG image");
        if (bytes > 2L * 1024 * 1024) throw RuleException.database("The image is larger than 2 MB");
    }

    /** A system setting's new value: never blank (the old system_setting value check). */
    public static void checkSetting(String value) {
        if (value == null || value.strip().isEmpty())
            throw RuleException.withCode("new row for relation \"system_setting\" violates check constraint \"system_setting_setting_value_check\"", "23514");
    }
}
