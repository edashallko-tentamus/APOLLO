package com.tentamus.lims.core.files;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.web.RuleException;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Component;

/** Uploaded documents (document_file): kept exactly as uploaded, with their SHA-256 fingerprint and size. */
@Component
public class DocumentStore {
    private final Db db;

    public DocumentStore(Db db) { this.db = db; }

    /** An upload sent as {file_name, mime_type, data (base64)}; null when nothing was sent. */
    public record Upload(String fileName, String mimeType, String base64) {
        @SuppressWarnings("unchecked")
        public static Upload from(Object o) {
            if (!(o instanceof Map<?, ?> m) || m.get("data") == null) return null;
            Map<String, Object> d = (Map<String, Object>) m;
            return new Upload(d.get("file_name") == null ? null : d.get("file_name").toString(),
                d.get("mime_type") == null ? null : d.get("mime_type").toString(), d.get("data").toString());
        }
    }

    /** Stores a file after checking its size and type; returns the new document id. */
    public String store(Upload u, long maxBytes, Set<String> allowedTypes, String sizeMessage, String typeMessage, String defaultName) {
        byte[] bytes;
        try { bytes = Base64.getMimeDecoder().decode(u.base64()); } catch (IllegalArgumentException e) { bytes = new byte[0]; }
        if (bytes.length == 0 || bytes.length > maxBytes) throw new RuleException(sizeMessage);
        if (u.mimeType() == null || !allowedTypes.contains(u.mimeType())) throw new RuleException(typeMessage);
        String name = u.fileName() == null ? defaultName : u.fileName();
        Map<String, Object> r = db.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, ?) RETURNING id",
            name.substring(0, Math.min(200, name.length())), u.mimeType(), bytes.length, sha256(bytes), bytes);
        return (String) r.get("id");
    }

    static String sha256(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
}
