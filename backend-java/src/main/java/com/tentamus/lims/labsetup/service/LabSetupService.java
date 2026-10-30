package com.tentamus.lims.labsetup.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.labsetup.domain.LabImage;
import com.tentamus.lims.labsetup.domain.ReportTemplate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Lab setup: the product name, each lab's images (logo, small logo, accreditation mark) and the report templates. The
 * rules are the domain's (labsetup/domain, migration 071); who may change what is checked here (migration 072). The public product name (the sign-in page) stays in the Node backend for now.
 */
@Service
public class LabSetupService {
    private static final RecordWriter TEMPLATES = new RecordWriter("report_template", List.of("template_name", "description", "layout", "site_id", "is_default", "options", "status"));
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final ObjectMapper json;

    public LabSetupService(Db db, UnitOfWork uow, AccessPolicy access, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.json = json;
    }

    public Map<String, Object> setProductName(RequestContext ctx, Map<String, Object> body) {
        access.requireSystemAdmin(ctx);
        String v = Js.string(Js.orBlank(body.get("product_name"))).trim();
        if (v.isEmpty()) throw new RuleException("Type the product name");
        String name = v.substring(0, Math.min(60, v.length()));
        LabImage.checkSetting(name);
        return uow.run(ctx.orReason("Product name changed"), d -> d.raw("UPDATE system_setting SET setting_value = ? WHERE setting_key = 'product_name'", name));
    }

    // ---------------------------------------------------------------- lab images
    public Map<String, Object> media(RequestContext ctx, String siteId) {
        if (!RequestContext.isUuid(siteId)) throw new RuleException("Lab not found");
        access.checkSite(ctx, siteId);
        return map("rows", db.rows("""
                SELECT m.id, m.kind, m.title, m.status::text AS status, m.created_at, u.full_name AS uploaded_by, f.file_name, f.mime_type, f.size_bytes, f.sha256
                  FROM site_media m JOIN document_file f ON f.id = m.document_id JOIN app_user u ON u.id = m.created_by WHERE m.site_id = ?::uuid ORDER BY m.status, m.kind, m.created_at DESC""", siteId),
            "can_edit", access.load(ctx.userId()).can("admin.lab", siteId));
    }

    public Map<String, Object> upload(RequestContext ctx, String siteId, Map<String, Object> body) {
        if (!RequestContext.isUuid(siteId)) throw new RuleException("Lab not found");
        String b64 = Js.string(body.get("b64"));
        if (b64.isEmpty()) throw new RuleException("Choose an image");
        Object kind = body.get("kind");
        byte[] buf;
        try { buf = Base64.getMimeDecoder().decode(b64); } catch (IllegalArgumentException e) { buf = new byte[0]; }
        byte[] bytes = buf;
        String name = Js.truthy(body.get("file_name")) ? Js.string(body.get("file_name")) : "image";
        Object mime = Js.truthy(body.get("mime_type")) ? body.get("mime_type") : "application/octet-stream";
        LabImage.checkUpload(mime.toString(), bytes.length);
        access.requireAt(ctx, "admin.lab", siteId);
        return uow.run(ctx.withSite(siteId).orReason(kind + " uploaded"), d -> {
            if (!"Other".equals(kind)) d.update("UPDATE site_media SET status = 'Inactive' WHERE site_id = ?::uuid AND kind = ? AND status = 'Active'", siteId, kind);
            Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                name.substring(0, Math.min(200, name.length())), mime, bytes.length,
                DocumentStore.sha256(bytes), b64).get("id");
            return d.one("INSERT INTO site_media (site_id, kind, title, document_id) VALUES (?::uuid, ?, ?, ?::uuid) RETURNING id", siteId, kind, Js.orNull(body.get("title")), doc);
        });
    }

    public Map<String, Object> retire(RequestContext ctx, String mediaId) {
        Map<String, Object> m = db.one("SELECT site_id FROM site_media WHERE id = ?::uuid", mediaId);
        if (m == null) throw new RuleException("Image not found");
        access.requireAt(ctx, "admin.lab", (String) m.get("site_id"));
        return uow.run(ctx.withSite((String) m.get("site_id")).orReason("Image retired"), d -> d.raw("UPDATE site_media SET status = 'Inactive' WHERE id = ?::uuid", mediaId));
    }

    /** The image itself (any signed-in person: the header shows the lab's small logo): {b64, mime_type}. */
    public Map<String, Object> file(String mediaId) {
        if (!RequestContext.isUuid(mediaId)) throw new RuleException("Image not found");
        Map<String, Object> f = db.one("SELECT f.mime_type, encode(f.content, 'base64') AS b64 FROM site_media m JOIN document_file f ON f.id = m.document_id WHERE m.id = ?::uuid", mediaId);
        if (f == null) throw new RuleException("Image not found");
        return f;
    }

    /** A lab's current image of one kind (the header's small logo). */
    public Map<String, Object> current(String siteId, Map<String, String> query) {
        if (!RequestContext.isUuid(siteId)) return map("id", null);
        String kind = query.get("kind") == null || query.get("kind").isEmpty() ? "Small logo" : query.get("kind");
        Map<String, Object> m = db.one("SELECT id FROM site_media WHERE site_id = ?::uuid AND kind = ? AND status = 'Active'", siteId, kind);
        return map("id", m == null ? null : m.get("id"));
    }

    // ---------------------------------------------------------------- report templates
    public Map<String, Object> templates(RequestContext ctx) {
        List<Map<String, Object>> labs = db.rows("SELECT id, site_code FROM lab_site WHERE status = 'Active' ORDER BY site_code");
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> can = new LinkedHashMap<>();
        for (Map<String, Object> l : labs) can.put((String) l.get("id"), a.can("reports.templates", (String) l.get("id")));
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        return map("rows", db.rows("""
                SELECT rt.*, rt.status::text AS status, s.site_code, (SELECT count(*) FROM test_version tv WHERE tv.report_template_id = rt.id)::int AS used_by
                  FROM report_template rt LEFT JOIN lab_site s ON s.id = rt.site_id ORDER BY rt.site_id NULLS FIRST, rt.template_code"""),
            "labs", labs, "can", can, "sysadmin", me != null && Js.truthy(me.get("is_admin")), "layouts", List.of("Standard COA", "COA with 1 photo", "COA with 2 photos"));
    }

    /** Only what was sent is changed; one default per lab (the old default cleared first). */
    public List<Map<String, Object>> saveTemplates(RequestContext ctx, Map<String, Object> body) {
        List<Map<String, Object>> list = new ArrayList<>();
        for (Map<String, Object> x : rows(body, "rows")) {
            Map<String, Object> o = new LinkedHashMap<>(x);
            if (o.get("options") instanceof Map<?, ?> || o.get("options") instanceof List<?>) {
                try { o.put("options", json.writeValueAsString(o.get("options"))); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
            }
            list.add(o);
        }
        return uow.run(ctx.orReason("Report templates changed"), d -> {
            for (Map<String, Object> x : list) {
                if (!Js.truthy(x.get("id")) || !TEMPLATES.pick(x).isEmpty()) {
                    Map<String, Object> stored = Js.truthy(x.get("id")) ? d.one("SELECT site_id FROM report_template WHERE id = ?::uuid", x.get("id")) : null;
                    if (stored != null || !Js.truthy(x.get("id"))) mayKeepTemplates(ctx, stored != null ? stored.get("site_id") : Js.orNull(x.get("site_id")));
                }
            }
            for (Map<String, Object> x : list) {
                if (!(Boolean.TRUE.equals(x.get("is_default")) || "true".equals(x.get("is_default")))) continue;
                Object site = Js.truthy(x.get("id")) ? d.one("SELECT site_id FROM report_template WHERE id = ?::uuid", x.get("id")).get("site_id") : Js.orNull(x.get("site_id"));
                d.update("UPDATE report_template SET is_default = false WHERE is_default AND site_id IS NOT DISTINCT FROM ?::uuid AND (?::uuid IS NULL OR id <> ?::uuid)",
                    site, Js.orNull(x.get("id")), Js.orNull(x.get("id")));
            }
            List<Map<String, Object>> rows = new ArrayList<>();
            for (Map<String, Object> x : list) {
                Map<String, Object> r = new LinkedHashMap<>(x);
                if (Js.truthy(r.get("id"))) r.remove("site_id");
                Map<String, Object> before = Js.truthy(r.get("id")) ? d.one("SELECT * FROM report_template WHERE id = ?::uuid", r.get("id")) : null;
                Map<String, Object> after = new LinkedHashMap<>(before == null ? Map.of() : before);
                after.putAll(TEMPLATES.pick(r));
                after.put("options", parsed(after.get("options")));
                ReportTemplate.check(before, after);
                rows.add(r);
            }
            return TEMPLATES.upsert(d, rows, Map.of());
        });
    }

    /** Templates for every lab are a system administrator's, a lab's need reports.templates there (report_template_rules until 072). */
    private void mayKeepTemplates(RequestContext ctx, Object site) {
        if (site == null) access.requireSystemAdmin(ctx, "Templates for every lab are kept by a system administrator; make one for your lab instead");
        else access.requireAt(ctx, "reports.templates", site.toString());
    }

    /** Template options as plain values (a Map for a JSON object), for the template check; text that is not JSON is left to the database. */
    private Object parsed(Object options) {
        try {
            if (options instanceof String t) return json.readValue(t, Object.class);
            if (options instanceof com.fasterxml.jackson.databind.JsonNode n) return json.convertValue(n, Object.class);
        } catch (JsonProcessingException e) { return null; }
        return options;
    }
}
