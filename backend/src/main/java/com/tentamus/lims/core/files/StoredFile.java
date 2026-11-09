package com.tentamus.lims.core.files;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;

/**
 * A stored file sent to the browser, decided as the Node backend's safeRaw() decides it: shown inline only when its first
 * bytes make it a PDF, PNG, JPEG, GIF or WebP (the type claimed at upload is not trusted); an SVG is shown sandboxed;
 * office files keep their zip type and download; anything else downloads as application/octet-stream. Every file except
 * a PDF carries a sandbox Content-Security-Policy, so nothing in it can run as part of the app.
 */
public record StoredFile(byte[] content, String claimedType, String fileName) {
    private static final String FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox";
    private static final Set<String> INLINE = Set.of("application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp");
    private static final Pattern ZIP_TYPES = Pattern.compile("^application/(zip|vnd\\.openxmlformats-officedocument\\.[\\w.]+|vnd\\.ms-excel\\.sheet\\.macroenabled\\.12|vnd\\.oasis\\.opendocument\\.[\\w.]+)$");
    private static final Pattern ACTIVE = Pattern.compile("(html|xml|javascript|ecmascript|svg|x-sh|x-msdownload|wasm)");
    private static final Pattern PLAIN_TYPE = Pattern.compile("^[a-z0-9.+-]+/[a-z0-9.+-]+$");

    /** What the bytes really are (server.js sniff()). */
    static String sniff(byte[] b) {
        if (b == null || b.length < 4) return null;
        if (b.length >= 5 && new String(b, 0, 5, StandardCharsets.ISO_8859_1).equals("%PDF-")) return "application/pdf";
        if ((b[0] & 0xFF) == 0x89 && new String(b, 1, 3, StandardCharsets.ISO_8859_1).equals("PNG")) return "image/png";
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        if (new String(b, 0, 4, StandardCharsets.ISO_8859_1).equals("GIF8")) return "image/gif";
        if (b.length >= 12 && new String(b, 0, 4, StandardCharsets.ISO_8859_1).equals("RIFF") && new String(b, 8, 4, StandardCharsets.ISO_8859_1).equals("WEBP")) return "image/webp";
        if (b[0] == 0x50 && b[1] == 0x4B && b[2] == 0x03 && b[3] == 0x04) return "zip";
        return null;
    }

    public ResponseEntity<byte[]> response() {
        String claimed = (claimedType == null ? "application/octet-stream" : claimedType).toLowerCase();
        String base = claimed.split(";")[0].trim();
        String found = sniff(content);
        String name = (fileName == null ? "file" : fileName).replaceAll("[^\\w.\\- ()#,+]", "_");
        name = name.substring(0, Math.min(150, name.length()));
        if (name.isEmpty()) name = "file";
        String type; boolean inline = false;
        if (found != null && INLINE.contains(found)) { type = found; inline = true; }
        else if ("zip".equals(found)) type = ZIP_TYPES.matcher(base).matches() ? base : "application/zip";
        else if (base.equals("image/svg+xml") && Pattern.compile("<svg[\\s>]", Pattern.CASE_INSENSITIVE).matcher(new String(content, 0, Math.min(4096, content.length), StandardCharsets.UTF_8)).find()) { type = base; inline = true; }
        else if (INLINE.contains(base) || ACTIVE.matcher(base).find() || !PLAIN_TYPE.matcher(base).matches()) type = "application/octet-stream";
        else type = claimed;
        HttpHeaders h = new HttpHeaders();
        h.set(HttpHeaders.CONTENT_TYPE, type);
        h.set(HttpHeaders.CONTENT_DISPOSITION, (inline ? "inline" : "attachment") + "; filename=\"" + name + "\"");
        if (!type.equals("application/pdf")) h.set("Content-Security-Policy", FILE_CSP);
        return ResponseEntity.ok().headers(h).body(content);
    }
}
