package com.tentamus.lims.custody.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;

/**
 * The chain of custody (its receipts and paper copies) and sample photos (4:3). The chain of custody PDF and Receive
 * and sign (which keeps the signed PDF) make PDFs and stay in the Node backend for now.
 */
@Service
public class CustodyService {
    private static final List<String> SCAN_TYPES = List.of("application/pdf", "image/png", "image/jpeg");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;

    public CustodyService(Db db, UnitOfWork uow, AccessPolicy access) {
        this.db = db;
        this.uow = uow;
        this.access = access;
    }

    /** An image's size and type from its header: {w, h, type}, or null when it is not a PNG or JPEG (custody.js imageSize). */
    record Size(int w, int h, String type) {}

    static Size imageSize(byte[] b) {
        if (b.length > 24 && (b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G') return new Size(u32(b, 16), u32(b, 20), "image/png");
        if (b.length > 4 && (b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8) {
            int i = 2;
            while (i + 9 < b.length) {
                if ((b[i] & 0xFF) != 0xFF) { i++; continue; }
                int m = b[i + 1] & 0xFF, len = u16(b, i + 2);
                if ((m >= 0xC0 && m <= 0xC3) || (m >= 0xC5 && m <= 0xC7) || (m >= 0xC9 && m <= 0xCB) || (m >= 0xCD && m <= 0xCF)) return new Size(u16(b, i + 7), u16(b, i + 5), "image/jpeg");
                i += 2 + len;
            }
        }
        return null;
    }

    private static int u16(byte[] b, int i) { return ((b[i] & 0xFF) << 8) | (b[i + 1] & 0xFF); }

    private static int u32(byte[] b, int i) { return (int) (((long) u16(b, i) << 16) | u16(b, i + 2)); }

    /** Buffer.from(b64 without a data: prefix, 'base64'). */
    private static byte[] file(Object b64) {
        try { return Base64.getMimeDecoder().decode(Js.string(b64).replaceFirst("^data:[^,]*,", "")); } catch (IllegalArgumentException e) { return new byte[0]; }
    }

    private Map<String, Object> orderSite(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Order not found");
        Map<String, Object> o = db.one("SELECT id, site_id, order_code FROM lab_order WHERE id = ?::uuid", id);
        if (o == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        return o;
    }

    private Map<String, Object> sampleSite(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Sample not found");
        Map<String, Object> s = db.one("SELECT s.id, s.lab_order_id, o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", id);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
        return s;
    }

    /** A stored file with its name cleaned as the Node route does: {b64, mime_type, file_name}. */
    private static Map<String, Object> raw(Map<String, Object> d) {
        String name = Js.truthy(d.get("file_name")) ? d.get("file_name").toString() : "file";
        return map("b64", d.get("b64"), "mime_type", d.get("mime_type"), "file_name", name.replaceAll("[^\\w.\\- ]", "_"));
    }

    // ---------------------------------------------------------------- the chain of custody
    /** The order's chain of custody: its receipts, the paper copies, the thermometers, who may receive. */
    public Map<String, Object> custody(RequestContext ctx, String orderId) {
        Map<String, Object> o = orderSite(ctx, orderId);
        Map<String, Object> doc = db.one("SELECT * FROM custody_document WHERE lab_order_id = ?::uuid", o.get("id"));
        List<Map<String, Object>> events = doc == null ? List.of() : db.rows("""
            SELECT id, event_no, kind, event_at, delivered_by, tracking_no, temperature::text AS temperature, thermometer_code, thermometer_name, condition, seals, note,
                by_name, sample_codes, sample_count, document_id, created_at FROM custody_event_view WHERE custody_document_id = ?::uuid ORDER BY event_no""", doc.get("id"));
        Map<String, Object> me = db.one("SELECT title, signature_document_id IS NOT NULL AS has_sig FROM app_user WHERE id = ?::uuid", ctx.userId());
        Map<String, Object> lab = db.one("SELECT custody_signature_required FROM lab_site WHERE id = ?::uuid", o.get("site_id"));
        return map("document", doc, "events", events,
            "thermometers", db.rows("""
                SELECT id, equipment_code, equipment_name, type_name FROM equipment_view
                 WHERE site_id = ?::uuid AND availability = 'Available' AND calibration_status <> 'Deficient'
                 ORDER BY (type_name ILIKE '%thermometer%' OR equipment_name ILIKE '%thermometer%') DESC, equipment_code""", o.get("site_id")),
            "can_receive", access.has(ctx, "orders.edit"),
            "my_signature", me != null && Js.truthy(me.get("has_sig")) && Js.truthy(me.get("title")),
            "required", lab != null && Js.truthy(lab.get("custody_signature_required")));
    }

    /** A receipt's signed PDF, or a paper copy's scan. */
    public Map<String, Object> eventFile(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("File not found");
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, cd.site_id FROM custody_event e JOIN custody_document cd ON cd.id = e.custody_document_id
              JOIN document_file f ON f.id = e.document_id WHERE e.id = ?::uuid""", id);
        if (d == null) throw new RuleException("File not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return raw(d);
    }

    /** The scan of the copy the client signed (Relinquished by). */
    public Map<String, Object> paper(RequestContext ctx, String orderId, Map<String, Object> body) {
        Map<String, Object> o = orderSite(ctx, orderId);
        byte[] buf = file(body.get("base64"));
        if (buf.length == 0) throw new RuleException("Choose the scanned file");
        if (buf.length > 15 * 1024 * 1024) throw new RuleException("The scan is larger than 15 MB");
        Object mime = SCAN_TYPES.contains(body.get("mime_type")) ? body.get("mime_type") : null;
        if (mime == null) throw new RuleException("Attach a PDF, PNG or JPEG scan");
        Object note = body.get("note");
        return uow.run(ctx.withReason(Js.truthy(note) ? Js.string(note) : "Paper copy of the chain of custody"), d -> {
            Object doc = d.one("SELECT make_custody_document(?::uuid) AS id", o.get("id")).get("id");
            String sha = DocumentStore.sha256(buf);
            Object f = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                Js.truthy(body.get("file_name")) ? body.get("file_name") : "chain-of-custody-scan", mime, buf.length, sha, Base64.getEncoder().encodeToString(buf)).get("id");
            return d.one("""
                INSERT INTO custody_event (custody_document_id, event_no, kind, event_at, note, document_id, sha256)
                VALUES (?::uuid, 0, 'Paper copy', clock_timestamp(), ?, ?::uuid, ?) RETURNING id""", doc, Js.orNull(note), f, sha);
        });
    }

    // ---------------------------------------------------------------- photos (4:3), taken or uploaded at receipt
    public Map<String, Object> photos(RequestContext ctx, String sampleId) {
        Map<String, Object> s = sampleSite(ctx, sampleId);
        Map<String, Object> need = db.one("SELECT sample_report_photos_missing(?::uuid) AS problem", s.get("id"));
        return map("rows", db.rows("""
                SELECT p.id, p.caption, p.taken_at, p.report_slot, p.width_px, p.height_px, p.status, p.created_at, u.full_name AS by_name
                  FROM sample_photo p JOIN app_user u ON u.id = p.created_by WHERE p.sample_id = ?::uuid ORDER BY p.status, p.report_slot NULLS LAST, p.taken_at""", s.get("id")),
            "problem", need == null ? null : need.get("problem"), "can_edit", access.has(ctx, "orders.edit"));
    }

    private static Integer slot(Object v) {
        double n = Js.toNumber(v);
        return v != null && (n == 1 || n == 2) ? (int) n : null;
    }

    private record Photo(byte[] buf, Size size, Object caption, Integer slot, Object takenAt, Object name) {}

    public Map<String, Object> addPhotos(RequestContext ctx, String sampleId, Map<String, Object> body) {
        Map<String, Object> s = sampleSite(ctx, sampleId);
        List<Map<String, Object>> list = rows(body, "photos");
        if (list.isEmpty()) throw new RuleException("Choose a photo");
        if (list.size() > 10) throw new RuleException("Add at most 10 photos at a time");
        List<Photo> prepared = new ArrayList<>();
        for (int i = 0; i < list.size(); i++) {
            Map<String, Object> p = list.get(i);
            byte[] buf = file(p.get("base64"));
            Size size = imageSize(buf);
            if (size == null) throw new RuleException("Photo " + (i + 1) + " is not a JPEG or PNG image");
            if (buf.length > 6 * 1024 * 1024) throw new RuleException("Photo " + (i + 1) + " is larger than 6 MB");
            if (Math.abs((long) size.w() * 3 - (long) size.h() * 4) > Math.max(size.w(), size.h()) * 0.03)
                throw new RuleException("Photo " + (i + 1) + " is " + size.w() + " x " + size.h() + ": crop it to 4:3 (the photo dialog does this)");
            prepared.add(new Photo(buf, size, Js.orNull(p.get("caption")), slot(p.get("report_slot")), Js.orNull(p.get("taken_at")),
                Js.truthy(p.get("file_name")) ? p.get("file_name") : "photo-" + (i + 1)));
        }
        return uow.run(ctx.orReason("Sample photos at receipt"), d -> {
            List<Object> ids = new ArrayList<>();
            for (Photo p : prepared) {
                if (p.slot() != null) d.update("UPDATE sample_photo SET report_slot = NULL WHERE sample_id = ?::uuid AND report_slot = ? AND status = ?", s.get("id"), p.slot(), "Active");
                String sha = DocumentStore.sha256(p.buf());
                Object f = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                    p.name(), p.size().type(), p.buf().length, sha, Base64.getEncoder().encodeToString(p.buf())).get("id");
                ids.add(d.one("""
                    INSERT INTO sample_photo (sample_id, document_id, width_px, height_px, caption, taken_at, report_slot)
                    VALUES (?::uuid, ?::uuid, ?, ?, ?, COALESCE(?::timestamptz, clock_timestamp()), ?::int) RETURNING id""",
                    s.get("id"), f, p.size().w(), p.size().h(), p.caption(), p.takenAt(), p.slot()).get("id"));
            }
            return map("ids", ids);
        });
    }

    /** Caption, place on the report (Report photo 1 / 2 / none), or retire. */
    public Map<String, Object> changePhoto(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Photo not found");
        Map<String, Object> p = db.one("SELECT p.*, o.site_id FROM sample_photo p JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE p.id = ?::uuid", id);
        if (p == null) throw new RuleException("Photo not found");
        access.checkSite(ctx, (String) p.get("site_id"));
        Object current = p.get("report_slot");
        Integer slot = body.containsKey("report_slot") ? slot(body.get("report_slot")) : current == null ? null : ((Number) current).intValue();
        boolean retire = Js.truthy(body.get("retire"));
        Object status = retire ? "Inactive" : p.get("status");
        if (retire && !Js.truthy(body.get("reason"))) throw new RuleException("Give the reason for retiring the photo");
        Object caption = body.containsKey("caption") ? Js.orNull(body.get("caption")) : p.get("caption");
        return uow.run(ctx.orReason("Photo details"), d -> {
            if (slot != null && !Objects.equals(slot, current == null ? null : ((Number) current).intValue()))
                d.update("UPDATE sample_photo SET report_slot = NULL WHERE sample_id = ?::uuid AND report_slot = ? AND status = ? AND id <> ?::uuid", p.get("sample_id"), slot, "Active", p.get("id"));
            d.update("UPDATE sample_photo SET caption = ?, report_slot = ?::int, status = ? WHERE id = ?::uuid", caption, slot, status, p.get("id"));
            return ok();
        });
    }

    public Map<String, Object> photoFile(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Photo not found");
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, o.site_id FROM sample_photo p JOIN document_file f ON f.id = p.document_id
              JOIN sample s ON s.id = p.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE p.id = ?::uuid""", id);
        if (d == null) throw new RuleException("Photo not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return raw(d);
    }
}
