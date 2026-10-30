package com.tentamus.lims.admin.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * A person's handwritten signature (a PNG or JPEG up to 1 MB) and title, printed on COAs and reports; recorded by a lab
 * administrator of a lab where the person works, or a system administrator. Replaces set_user_signature (migration 071);
 * the trigger that writes the change to the audit trail stays in the database.
 */
public final class HandwrittenSignature {
    private HandwrittenSignature() {}

    /**
     * Checks a signature about to be recorded and returns the title to store (trimmed).
     *
     * @param personName null when the person is not found or is an automated account
     * @param mayRecord  a system administrator, or admin.users in a lab where the person works
     * @param mimeType   the image's type, or null when only the title changes
     */
    public static String check(String personName, boolean mayRecord, String mimeType, long bytes, String title) {
        if (personName == null) throw RuleException.database("Person not found");
        if (!mayRecord) throw RuleException.database("Only a lab administrator of a lab where " + personName + " works (admin.users) records their signature");
        if (mimeType != null) {
            if (!"image/png".equals(mimeType) && !"image/jpeg".equals(mimeType)) throw RuleException.database("The signature must be a PNG or JPEG image");
            if (bytes > 1048576) throw RuleException.database("The signature image is larger than 1 MB: crop or shrink it");
        }
        if (title == null || title.strip().isEmpty()) throw RuleException.database("Enter " + personName + "'s title (printed under the signature)");
        return title.strip();
    }
}
