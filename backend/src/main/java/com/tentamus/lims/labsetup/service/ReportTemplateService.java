package com.tentamus.lims.labsetup.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.invoicing.service.InvoiceDocument;
import com.tentamus.lims.labsetup.domain.ReportDesign;
import com.tentamus.lims.labsetup.domain.ReportTemplate;
import com.tentamus.lims.labsetup.repo.TemplateVersions;
import com.tentamus.lims.reports.domain.CoaContent;
import com.tentamus.lims.reports.service.CoaDocument;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Report templates (migration 074): COA and invoice designs in versions. A lab's templates are designed by its Report
 * Designers (reports.design) and approved, signed, by QA or a General Manager (reports.templates), never by someone who
 * worked on the version. Shared templates (no lab) are system administrators', who design and approve them and tick
 * the labs that may use them. A lab stays on the shared version it accepted until someone there (reports.templates)
 * accepts a newer one; nobody at a lab sees a template of another lab, nor a shared one not ticked for it.
 */
@Service
public class ReportTemplateService {
    private static final SignatureService.Meaning APPROVE = new SignatureService.Meaning("Approved by", "Approve report template version", "Reports");
    private static final SignatureService.Meaning ACCEPT = new SignatureService.Meaning("Approved by", "Use a new shared report template version at the lab", "Reports");
    private static final List<String> TYPES = List.of("COA", "Invoice");

    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final HeadlessBrowser browser;
    private final ObjectMapper json;

    public ReportTemplateService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, HeadlessBrowser browser, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.browser = browser;
        this.json = json;
    }

    // ---------------------------------------------------------------- reading
    /** The templates of the lab in the header (its own and the shared ones ticked for it), and what the person may do. */
    public Map<String, Object> list(RequestContext ctx) {
        String site = access.currentSite(ctx);
        UserAccess a = access.load(ctx.userId());
        List<Map<String, Object>> rows = db.rows("""
            SELECT rt.id, rt.template_code, rt.template_name, rt.description, rt.document_type, rt.site_id, rt.status::text AS status,
                   CASE WHEN rt.site_id IS NULL THEN COALESCE(l.is_default, false) ELSE rt.is_default END AS is_default,
                   uv.version_no AS version_in_use, eff.version_no AS effective_version, dr.version_no AS draft_version,
                   (rt.site_id IS NULL AND eff.id IS NOT NULL AND eff.id IS DISTINCT FROM l.accepted_version_id) AS newer_shared_version,
                   (SELECT count(*) FROM test_version tv JOIN test t ON t.id = tv.test_id
                     WHERE tv.report_template_id = rt.id AND t.site_id = ?::uuid AND tv.status <> 'Superseded')::int AS used_by
              FROM report_template rt
              LEFT JOIN report_template_lab l ON l.template_id = rt.id AND l.site_id = ?::uuid
              LEFT JOIN report_template_version uv ON uv.id = """ + TemplateVersions.VERSION_AT_LAB + """

              LEFT JOIN report_template_version eff ON eff.template_id = rt.id AND eff.status = 'Effective'
              LEFT JOIN report_template_version dr ON dr.template_id = rt.id AND dr.status = 'Draft'
             WHERE rt.site_id = ?::uuid OR (rt.site_id IS NULL AND l.available)
             ORDER BY rt.document_type, rt.site_id NULLS LAST, rt.template_code""", site, site, site);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("site_id", site);
        out.put("can_design", a.can("reports.design", site));
        out.put("can_approve", a.can("reports.templates", site));
        out.put("sysadmin", a.systemAdmin());
        if (a.systemAdmin()) out.put("shared", db.rows("""
            SELECT rt.id, rt.template_code, rt.template_name, rt.document_type, rt.status::text AS status,
                   eff.version_no AS effective_version, dr.version_no AS draft_version,
                   (SELECT string_agg(s.site_code, ', ' ORDER BY s.site_code) FROM report_template_lab l JOIN lab_site s ON s.id = l.site_id
                     WHERE l.template_id = rt.id AND l.available) AS labs
              FROM report_template rt
              LEFT JOIN report_template_version eff ON eff.template_id = rt.id AND eff.status = 'Effective'
              LEFT JOIN report_template_version dr ON dr.template_id = rt.id AND dr.status = 'Draft'
             WHERE rt.site_id IS NULL ORDER BY rt.document_type, rt.template_code"""));
        return out;
    }

    /** One template: its versions with their designs, and (shared, for system administrators) the labs' ticks. */
    public Map<String, Object> one(RequestContext ctx, String id) {
        String site = access.currentSite(ctx);
        Map<String, Object> t = visible(ctx, id, site);
        UserAccess a = access.load(ctx.userId());
        boolean shared = t.get("site_id") == null;
        List<Map<String, Object>> versions = db.rows("""
            SELECT v.id, v.version_no, v.status, v.design, v.change_note, v.created_at, cu.full_name AS created_by_name, v.approved_at, au.full_name AS approved_by_name
              FROM report_template_version v JOIN app_user cu ON cu.id = v.created_by LEFT JOIN app_user au ON au.id = v.approved_by
             WHERE v.template_id = ?::uuid ORDER BY v.version_no DESC""", id);
        String type = (String) t.get("document_type");
        for (Map<String, Object> v : versions) v.put("design", ReportDesign.normalize(type, v.get("design")));
        Map<String, Object> lab = db.one("SELECT available, accepted_version_id, is_default FROM report_template_lab WHERE template_id = ?::uuid AND site_id = ?::uuid", id, site);
        Map<String, Object> out = new LinkedHashMap<>(t);
        out.put("versions", versions);
        out.put("at_lab", lab);
        out.put("in_use_version_id", shared ? (lab == null ? null : lab.get("accepted_version_id"))
            : versions.stream().filter(v -> "Effective".equals(v.get("status"))).map(v -> v.get("id")).findFirst().orElse(null));
        out.put("can_design", shared ? a.systemAdmin() : a.can("reports.design", site));
        out.put("can_approve", shared ? a.systemAdmin() : a.can("reports.templates", site));
        out.put("can_use", a.can("reports.templates", site));
        out.put("can_copy", a.can("reports.design", site));
        out.put("choices", map("fonts", List.copyOf(ReportDesign.FONTS.keySet()), "accents", ReportDesign.ACCENTS, "sizes", ReportDesign.SIZES,
            "client_fields", ReportDesign.CLIENT_FIELDS, "sample_fields", ReportDesign.SAMPLE_FIELDS, "test_options", ReportDesign.TEST_OPTIONS, "invoice_flags", ReportDesign.INVOICE_FLAGS));
        if (shared && a.systemAdmin()) out.put("labs", db.rows("""
            SELECT s.id AS site_id, s.site_code, s.site_name, COALESCE(l.available, false) AS available, av.version_no AS accepted_version, COALESCE(l.is_default, false) AS is_default
              FROM lab_site s LEFT JOIN report_template_lab l ON l.site_id = s.id AND l.template_id = ?::uuid
              LEFT JOIN report_template_version av ON av.id = l.accepted_version_id
             WHERE s.status = 'Active' ORDER BY s.site_code""", id));
        return out;
    }

    /** A template the person may see at the lab: the lab's own, a shared one ticked for it, or any shared one for a system administrator. */
    private Map<String, Object> visible(RequestContext ctx, String id, String site) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Template not found");
        Map<String, Object> t = db.one("""
            SELECT rt.id, rt.template_code, rt.template_name, rt.description, rt.document_type, rt.site_id, rt.status::text AS status, rt.is_default,
                   rt.copied_from_version_id, s.site_code
              FROM report_template rt LEFT JOIN lab_site s ON s.id = rt.site_id WHERE rt.id = ?::uuid""", id);
        if (t == null) throw new RuleException("Template not found");
        if (t.get("site_id") != null) {
            if (!site.equals(t.get("site_id"))) throw new RuleException("Template not found");
        } else if (!access.load(ctx.userId()).systemAdmin()) {
            Map<String, Object> l = db.one("SELECT available FROM report_template_lab WHERE template_id = ?::uuid AND site_id = ?::uuid", id, site);
            if (l == null || !Js.truthy(l.get("available"))) throw new RuleException("Template not found");
        }
        return t;
    }

    /** Design rights on a template: the lab's Report Designers for its own, system administrators for shared ones. */
    private void mayDesign(RequestContext ctx, Map<String, Object> t) {
        if (t.get("site_id") == null) access.requireSystemAdmin(ctx, "Shared templates are kept by system administrators: copy it to your lab to change it");
        else access.requireAt(ctx, "reports.design", (String) t.get("site_id"));
    }

    // ---------------------------------------------------------------- making and changing
    /** A new template, version 1 a Draft with the standard design: for the lab in the header, or shared (system administrators). */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String type = Js.string(body.get("document_type"));
        if (!TYPES.contains(type)) throw new RuleException("Choose COA or Invoice");
        String name = Js.string(Js.orBlank(body.get("template_name"))).trim();
        if (name.isEmpty()) throw new RuleException("Type the template's name");
        boolean shared = Js.truthy(body.get("shared"));
        String site = shared ? null : access.currentSite(ctx);
        if (shared) access.requireSystemAdmin(ctx);
        else access.requireAt(ctx, "reports.design", site);
        return uow.run(ctx.orReason("Report template made"), d -> {
            Map<String, Object> t = d.one("INSERT INTO report_template (template_name, description, site_id, document_type) VALUES (?, ?, ?::uuid, ?) RETURNING id",
                name, Js.orNull(body.get("description")), site, type);
            d.one("INSERT INTO report_template_version (template_id, version_no, design) VALUES (?::uuid, 1, ?::jsonb) RETURNING id", t.get("id"), write(ReportDesign.defaults(type)));
            return t;
        });
    }

    /** A copy into the lab in the header, from a template the person can see: a new lab template, version 1 a Draft. */
    public Map<String, Object> copy(RequestContext ctx, String id, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> t = visible(ctx, id, site);
        access.requireAt(ctx, "reports.design", site);
        Map<String, Object> from = db.one("SELECT v.id, v.version_no, v.design FROM report_template_version v WHERE v.id = COALESCE("
            + "(SELECT accepted_version_id FROM report_template_lab WHERE template_id = ?::uuid AND site_id = ?::uuid AND ?::uuid IS NULL),"
            + "(SELECT e.id FROM report_template_version e WHERE e.template_id = ?::uuid AND e.status = 'Effective'))", id, site, t.get("site_id"), id);
        if (from == null) throw new RuleException("This template has no approved version to copy yet");
        String name = Js.truthy(body.get("template_name")) ? Js.string(body.get("template_name")).trim() : "Copy of " + t.get("template_name");
        return uow.run(ctx.orReason("Report template copied from " + t.get("template_code") + " version " + from.get("version_no")), d -> {
            Map<String, Object> n = d.one("""
                INSERT INTO report_template (template_name, description, site_id, document_type, copied_from_version_id)
                VALUES (?, ?, ?::uuid, ?, ?::uuid) RETURNING id""", name, t.get("description"), site, t.get("document_type"), from.get("id"));
            d.one("INSERT INTO report_template_version (template_id, version_no, design, change_note) VALUES (?::uuid, 1, ?::jsonb, ?) RETURNING id",
                n.get("id"), write(ReportDesign.normalize((String) t.get("document_type"), from.get("design"))), "Copied from " + t.get("template_code") + " version " + from.get("version_no"));
            return n;
        });
    }

    /** Renames a template or changes its description. */
    public Map<String, Object> rename(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> t = visible(ctx, id, access.currentSite(ctx));
        mayDesign(ctx, t);
        Map<String, Object> after = new LinkedHashMap<>(t);
        if (body.containsKey("template_name")) after.put("template_name", Js.string(Js.orBlank(body.get("template_name"))).trim());
        if (body.containsKey("description")) after.put("description", Js.orNull(body.get("description")));
        ReportTemplate.check(t, after);
        return uow.run(ctx.orReason("Report template renamed"), d -> d.raw("UPDATE report_template SET template_name = ?, description = ? WHERE id = ?::uuid",
            after.get("template_name"), after.get("description"), id));
    }

    /** A new Draft from the version in use (one Draft at a time). */
    public Map<String, Object> newDraft(RequestContext ctx, String id) {
        Map<String, Object> t = visible(ctx, id, access.currentSite(ctx));
        mayDesign(ctx, t);
        if (db.one("SELECT 1 AS x FROM report_template_version WHERE template_id = ?::uuid AND status = 'Draft'", id) != null) throw new RuleException("This template already has a draft");
        Map<String, Object> last = db.one("SELECT max(version_no) AS n FROM report_template_version WHERE template_id = ?::uuid", id);
        Map<String, Object> eff = db.one("SELECT design FROM report_template_version WHERE template_id = ?::uuid AND status = 'Effective'", id);
        String type = (String) t.get("document_type");
        int next = ((Number) last.get("n")).intValue() + 1;
        return uow.run(ctx.orReason("New draft of the report template"), d -> d.one(
            "INSERT INTO report_template_version (template_id, version_no, design) VALUES (?::uuid, ?, ?::jsonb) RETURNING id",
            id, next, write(ReportDesign.normalize(type, eff == null ? null : eff.get("design")))));
    }

    /** Saves a Draft's design (checked: only what the renderers draw) and its change note. */
    public Map<String, Object> saveDraft(RequestContext ctx, String versionId, Map<String, Object> body) {
        Map<String, Object> v = version(versionId);
        Map<String, Object> t = visible(ctx, (String) v.get("template_id"), access.currentSite(ctx));
        mayDesign(ctx, t);
        if (!"Draft".equals(v.get("status"))) throw RuleException.database("Only a draft can be changed: make a new draft");
        Map<String, Object> design = ReportDesign.check((String) t.get("document_type"), body.get("design"));
        return uow.run(ctx.orReason("Report template draft changed"), d -> d.raw("UPDATE report_template_version SET design = ?::jsonb, change_note = ? WHERE id = ?::uuid",
            write(design), Js.orNull(body.get("change_note")), versionId));
    }

    /**
     * Approves a Draft, signed: it becomes the Effective version and the one before is Superseded. A lab's own template
     * prints with it at once; a shared one reaches each lab only when someone there accepts it (labs ticked before
     * there was any approved version take it now).
     */
    public Map<String, Object> approve(RequestContext ctx, String versionId, Map<String, Object> body) {
        Map<String, Object> v = version(versionId);
        Map<String, Object> t = visible(ctx, (String) v.get("template_id"), access.currentSite(ctx));
        if (t.get("site_id") == null) access.requireSystemAdmin(ctx, "Shared templates are approved by a system administrator");
        else access.requireAt(ctx, "reports.templates", (String) t.get("site_id"));
        ReportTemplate.checkApproval((String) v.get("status"), ctx.userId(), authors(versionId));
        ReportDesign.check((String) t.get("document_type"), v.get("design"));
        return signatures.signed(ctx.orReason("Report template version approved"), body, APPROVE, d -> {
            d.update("UPDATE report_template_version SET status = 'Superseded' WHERE template_id = ?::uuid AND status = 'Effective'", t.get("id"));
            d.update("""
                UPDATE report_template_version SET status = 'Effective', approved_by = ?::uuid, approved_at = now(),
                       signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", ctx.userId(), versionId);
            d.update("UPDATE report_template_lab SET accepted_version_id = ?::uuid WHERE template_id = ?::uuid AND available AND accepted_version_id IS NULL", versionId, t.get("id"));
            return map("ok", true);
        });
    }

    /** Who worked on a version: who made it and everyone who changed it (from its audit trail). */
    private Set<String> authors(String versionId) {
        Set<String> out = new HashSet<>();
        for (Map<String, Object> r : db.rows("""
            SELECT created_by::text AS u FROM report_template_version WHERE id = ?::uuid
            UNION SELECT changed_by::text FROM audit_log WHERE table_name = 'report_template_version' AND record_id = ?::uuid""", versionId, versionId))
            out.add((String) r.get("u"));
        return out;
    }

    // ---------------------------------------------------------------- shared templates at the labs
    /** System administrators tick the labs that may use a shared template (a reason; refused while a lab still uses it). */
    public Map<String, Object> setLabs(RequestContext ctx, String id, Map<String, Object> body) {
        access.requireSystemAdmin(ctx);
        Map<String, Object> t = db.one("SELECT id, site_id FROM report_template WHERE id = ?::uuid", id);
        if (t == null || t.get("site_id") != null) throw new RuleException("Only a shared template is ticked for labs");
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Map<String, Object> r : com.tentamus.lims.core.web.Answers.rows(body, "rows")) rows.add(r);
        return uow.run(ctx.orReason("Labs for a shared report template changed"), d -> {
            Map<String, Object> eff = d.one("SELECT id FROM report_template_version WHERE template_id = ?::uuid AND status = 'Effective'", id);
            for (Map<String, Object> r : rows) {
                Object site = r.get("site_id");
                if (!RequestContext.isUuid(site)) throw new RuleException("Lab not found");
                boolean on = Js.truthy(r.get("available"));
                Map<String, Object> l = d.one("SELECT available, is_default FROM report_template_lab WHERE template_id = ?::uuid AND site_id = ?::uuid", id, site);
                if (!on && l != null && Js.truthy(l.get("available"))) {
                    List<String> tests = d.rows("""
                        SELECT DISTINCT t.test_code || ' v' || tv.version_no AS x FROM test_version tv JOIN test t ON t.id = tv.test_id
                         WHERE tv.report_template_id = ?::uuid AND t.site_id = ?::uuid AND tv.status <> 'Superseded' ORDER BY 1""", id, site)
                        .stream().map(x -> (String) x.get("x")).toList();
                    ReportTemplate.checkWithdraw(Js.truthy(l.get("is_default")), tests);
                }
                if (l == null) d.update("INSERT INTO report_template_lab (template_id, site_id, available, accepted_version_id) VALUES (?::uuid, ?::uuid, ?, ?::uuid)",
                    id, site, on, on && eff != null ? eff.get("id") : null);
                else d.update("UPDATE report_template_lab SET available = ?, accepted_version_id = COALESCE(accepted_version_id, ?::uuid) WHERE template_id = ?::uuid AND site_id = ?::uuid",
                    on, on && eff != null ? eff.get("id") : null, id, site);
            }
            return map("ok", true);
        });
    }

    /** Someone at the lab (reports.templates) moves the lab to the shared template's newest approved version, signed. */
    public Map<String, Object> accept(RequestContext ctx, String id, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> t = visible(ctx, id, site);
        if (t.get("site_id") != null) throw new RuleException("Only a shared template has versions to accept");
        access.requireAt(ctx, "reports.templates", site);
        Map<String, Object> eff = db.one("SELECT id FROM report_template_version WHERE template_id = ?::uuid AND status = 'Effective'", id);
        if (eff == null) throw new RuleException("This template has no approved version yet");
        return signatures.signed(ctx.orReason("New shared template version used at the lab"), body, ACCEPT, d -> d.raw("UPDATE report_template_lab SET accepted_version_id = ?::uuid WHERE template_id = ?::uuid AND site_id = ?::uuid",
            eff.get("id"), id, site));
    }

    /** The lab's default template of its kind (reports.templates; it must have an approved version for the lab). */
    public Map<String, Object> makeDefault(RequestContext ctx, String id) {
        String site = access.currentSite(ctx);
        Map<String, Object> t = visible(ctx, id, site);
        access.requireAt(ctx, "reports.templates", site);
        if (!"Active".equals(t.get("status"))) throw new RuleException("A retired template cannot be the default");
        Map<String, Object> inUse = db.one("SELECT v.id FROM report_template rt LEFT JOIN report_template_lab l ON l.template_id = rt.id AND l.site_id = ?::uuid "
            + "JOIN report_template_version v ON v.id = " + TemplateVersions.VERSION_AT_LAB + " WHERE rt.id = ?::uuid", site, id);
        if (inUse == null) throw new RuleException("This template has no approved version yet");
        return uow.run(ctx.orReason("Default report template changed"), d -> {
            d.update("UPDATE report_template SET is_default = false WHERE site_id = ?::uuid AND document_type = ? AND is_default AND id <> ?::uuid", site, t.get("document_type"), id);
            d.update("""
                UPDATE report_template_lab l SET is_default = false FROM report_template rt
                 WHERE rt.id = l.template_id AND l.site_id = ?::uuid AND rt.document_type = ? AND l.is_default AND l.template_id <> ?::uuid""", site, t.get("document_type"), id);
            if (t.get("site_id") == null) d.update("UPDATE report_template_lab SET is_default = true WHERE template_id = ?::uuid AND site_id = ?::uuid", id, site);
            else d.update("UPDATE report_template SET is_default = true WHERE id = ?::uuid", id);
            return map("ok", true);
        });
    }

    /** Retires a template (refused while it is a default or tests print with it). */
    public Map<String, Object> retire(RequestContext ctx, String id) {
        Map<String, Object> t = visible(ctx, id, access.currentSite(ctx));
        if (t.get("site_id") == null) access.requireSystemAdmin(ctx);
        else access.requireAt(ctx, "reports.templates", (String) t.get("site_id"));
        boolean isDefault = Js.truthy(t.get("is_default")) || db.one("SELECT 1 AS x FROM report_template_lab WHERE template_id = ?::uuid AND is_default", id) != null;
        List<String> tests = db.rows("""
            SELECT DISTINCT t.test_code || ' v' || tv.version_no AS x FROM test_version tv JOIN test t ON t.id = tv.test_id
             WHERE tv.report_template_id = ?::uuid AND tv.status <> 'Superseded' ORDER BY 1""", id).stream().map(x -> (String) x.get("x")).toList();
        ReportTemplate.checkWithdraw(isDefault, tests);
        return uow.run(ctx.orReason("Report template retired"), d -> d.raw("UPDATE report_template SET status = 'Inactive' WHERE id = ?::uuid", id));
    }

    // ---------------------------------------------------------------- preview
    /** A version drawn with fictional data (nothing of a client's), as a PDF marked PREVIEW. */
    public byte[] preview(RequestContext ctx, String versionId) {
        Map<String, Object> v = version(versionId);
        String site = access.currentSite(ctx);
        Map<String, Object> t = visible(ctx, (String) v.get("template_id"), site);
        String type = (String) t.get("document_type");
        Map<String, Object> design = ReportDesign.normalize(type, v.get("design"));
        Map<String, Object> lab = db.one("SELECT site_name, address, accreditation_statement FROM lab_site WHERE id = ?::uuid", site);
        if ("Invoice".equals(type)) return browser.htmlToPdf(InvoiceDocument.html(Specimen.invoice(lab), true, null, design), "PREVIEW · " + Js.string(t.get("template_name")), false);
        Map<String, Object> logo = db.one("""
            SELECT f.mime_type, encode(f.content, 'base64') AS b64 FROM site_media m JOIN document_file f ON f.id = m.document_id
             WHERE m.site_id = ?::uuid AND m.status = 'Active' AND m.kind = 'Logo' LIMIT 1""", site);
        CoaContent c = Specimen.coa(lab, logo == null ? null : "data:" + logo.get("mime_type") + ";base64," + logo.get("b64"), t, design);
        return browser.htmlToPdf(CoaDocument.html(c), CoaDocument.footer(c, true), false);
    }

    private Map<String, Object> version(String versionId) {
        if (!RequestContext.isUuid(versionId)) throw new RuleException("Version not found");
        Map<String, Object> v = db.one("SELECT id, template_id, version_no, status, design FROM report_template_version WHERE id = ?::uuid", versionId);
        if (v == null) throw new RuleException("Version not found");
        return v;
    }

    private String write(Object design) {
        try { return json.writeValueAsString(design); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }
}
