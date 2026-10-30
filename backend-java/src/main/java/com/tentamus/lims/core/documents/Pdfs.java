package com.tentamus.lims.core.documents;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.files.DocumentStore;
import java.util.Map;

/** A PDF the server made, kept unchanged in document_file with its SHA-256 fingerprint. */
public final class Pdfs {
    private Pdfs() {}

    /** A made PDF and its fingerprint. */
    public record Made(byte[] buf, String sha256) {
        public static Made of(byte[] buf) { return new Made(buf, DocumentStore.sha256(buf)); }
    }

    /** Stores the PDF under the file name; returns the new document id. */
    public static String store(Db d, String fileName, Made pdf) {
        Map<String, Object> r = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, 'application/pdf', ?, ?, ?) RETURNING id",
            fileName, pdf.buf().length, pdf.sha256(), pdf.buf());
        return (String) r.get("id");
    }
}
