package com.tentamus.lims.labsetup.repo;

import com.tentamus.lims.core.db.Db;
import java.util.Map;

/** Which version of a report template a lab prints with (migration 074). */
public final class TemplateVersions {
    private TemplateVersions() {}

    /**
     * The version id a lab uses of template rt (alias rt, the lab's report_template_lab row as l): its own template's
     * Effective version, or the shared template's version the lab accepted.
     */
    public static final String VERSION_AT_LAB = """
        CASE WHEN rt.site_id IS NULL THEN l.accepted_version_id
             ELSE (SELECT e.id FROM report_template_version e WHERE e.template_id = rt.id AND e.status = 'Effective') END""";

    /** {version_id, design} of the lab's default template of a kind (its own first, else a shared one ticked as its default), or null. */
    public static Map<String, Object> labDefault(Db d, Object siteId, String type) {
        return d.one("""
            SELECT v.id AS version_id, v.design FROM report_template rt
              LEFT JOIN report_template_lab l ON l.template_id = rt.id AND l.site_id = ?::uuid
              JOIN report_template_version v ON v.id = """ + VERSION_AT_LAB + """

             WHERE rt.status = 'Active' AND rt.document_type = ?
               AND ((rt.site_id = ?::uuid AND rt.is_default) OR (rt.site_id IS NULL AND l.available AND l.is_default))
             ORDER BY rt.site_id NULLS LAST LIMIT 1""", siteId, type, siteId);
    }

    /** {version_id, design} of the version that drew a stored PDF, or null. */
    public static Map<String, Object> ofDocument(Db d, Object documentId) {
        return documentId == null ? null : d.one("""
            SELECT v.id AS version_id, v.design FROM document_template_version x JOIN report_template_version v ON v.id = x.template_version_id
             WHERE x.document_id = ?::uuid""", documentId);
    }

    /** Records which version drew a stored PDF. */
    public static void record(Db d, Object documentId, Object versionId) {
        if (versionId != null) d.update("INSERT INTO document_template_version (document_id, template_version_id) VALUES (?::uuid, ?::uuid)", documentId, versionId);
    }
}
