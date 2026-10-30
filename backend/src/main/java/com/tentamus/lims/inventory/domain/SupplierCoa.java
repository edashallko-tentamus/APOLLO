package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * A Supplier COA on a lot: the uploaded document is kept unchanged (with its SHA-256) and so is the AI's proposal; a
 * person's confirmation of the values records who confirmed and when. Replaces the database trigger supplier_coa_rules
 * (migration 062 drops it); transfer_lot() copies COA records with their name and fingerprint itself.
 */
public final class SupplierCoa {
    private SupplierCoa() {}

    /** The document, its fingerprint and the AI proposal never change after upload. */
    public static void assertUnchanged(Map<String, Object> before, Map<String, Object> after) {
        if (!same(before, after, "document_id") || !same(before, after, "sha256") || !same(before, after, "ai_proposed"))
            throw RuleException.database("The document and the AI proposal on a COA record cannot be changed; upload the COA again");
    }

    /** Confirming values (new ones, not cleared) records the confirmer and the time. */
    public static boolean confirmationNeedsStamp(Object before, Object after) {
        return after != null && !Objects.equals(before, after);   // JSON values compare by content
    }

    private static boolean same(Map<String, Object> a, Map<String, Object> b, String k) {
        return Objects.equals(a.get(k) == null ? null : a.get(k).toString(), b.get(k) == null ? null : b.get(k).toString());
    }
}
