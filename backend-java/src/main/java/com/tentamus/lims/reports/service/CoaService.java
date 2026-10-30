package com.tentamus.lims.reports.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.documents.PublicLinks;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.Answers;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.reports.domain.CoaContent;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Service;

/**
 * Making a COA (the Node backend's routes_reports.js preview, finalize and public check): the preview with its release
 * check and the sample's history beside it (the PDF kept 30 minutes under a token for its owner), the signed finalization
 * (the password once, every PDF made and checked before the transaction, then one "Finalized by" signature per COA and
 * finalize_sample), and the public verification check behind a code. finalize_sample, next_finalization_group and
 * coa_public_check stay in the database.
 */
@Service
public class CoaService {
    private static final long PREVIEW_MS = 30 * 60_000L;
    private static final SecureRandom RANDOM = new SecureRandom();
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final HeadlessBrowser browser;
    private final PublicLinks links;
    private final ObjectMapper json;
    private final Map<String, Preview> previews = new ConcurrentHashMap<>();

    private record Preview(byte[] buf, long at, String userId) {}

    /** A made COA PDF and what reading it back found. */
    public record Made(Pdfs.Made pdf, CoaChecks.ReadBack readBack) {}

    public CoaService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, HeadlessBrowser browser, PublicLinks links, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.browser = browser;
        this.links = links;
        this.json = json;
    }

    private void sampleSite(RequestContext ctx, Object id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Sample not found");
        Map<String, Object> s = db.one("SELECT o.site_id FROM sample s JOIN lab_order o ON o.id = s.lab_order_id WHERE s.id = ?::uuid", id);
        if (s == null) throw new RuleException("Sample not found");
        access.checkSite(ctx, (String) s.get("site_id"));
    }

    /** Renders the COA, reads every data-check cell back and compares it with the record, then prints it. */
    public Made pdf(CoaContent c, boolean preview) {
        return browser.render(CoaDocument.html(c), r -> {
            Map<String, String> exp = c.expectedCells();
            List<String> mismatches = CoaContent.mismatches(exp, r.readBack("[data-check]", "data-check"));
            return new Made(Pdfs.Made.of(r.pdf(CoaDocument.footer(c, preview), false)), new CoaChecks.ReadBack(exp.size(), mismatches));
        });
    }

    // ---------------------------------------------------------------- one COA under review
    public Map<String, Object> preview(RequestContext ctx, Map<String, Object> body) {
        Object sampleId = body.get("sample_id");
        sampleSite(ctx, sampleId);
        List<Object> tests = Answers.uuids(body.get("tests"));
        CoaContent content = CoaDocument.content(db, String.valueOf(sampleId), tests, ctx.userId(), links.base(), null);
        Made made = null;
        String pdfError = null;
        try { made = pdf(content, true); } catch (RuntimeException e) { pdfError = e.getMessage(); }
        List<Map<String, Object>> checks = new ArrayList<>(CoaChecks.checks(db, content, ctx.userId(), made == null ? null : made.readBack()));
        if (pdfError != null) checks.add(0, CoaChecks.check("pdf", "The PDF", "Block", pdfError));
        String token = null;
        if (made != null) {
            long now = System.currentTimeMillis();
            previews.values().removeIf(p -> now - p.at() > PREVIEW_MS);
            byte[] b = new byte[16];
            RANDOM.nextBytes(b);
            token = HexFormat.of().formatHex(b);
            previews.put(token, new Preview(made.pdf().buf(), now, ctx.userId()));
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("content", content.stored());
        out.put("checks", checks);
        out.put("token", token);
        out.put("context", sampleContext(String.valueOf(sampleId)));
        out.put("canned", db.rows("SELECT id, reason_text FROM reason_code WHERE module = 'COA comments' AND status = 'Active' ORDER BY sort_order, reason_text"));
        out.put("can_notes", access.has(ctx, "reports.notes"));
        out.put("can_finalize", access.has(ctx, "reports.finalize"));
        out.put("can_gmp", access.has(ctx, "reports.finalize_gmp"));
        return out;
    }

    public byte[] previewPdf(RequestContext ctx, String token) {
        Preview p = previews.get(token);
        if (p == null || !p.userId().equals(ctx.userId())) throw new RuleException("This preview has expired: open the COA again");
        return p.buf();
    }

    private Map<String, Object> sampleContext(String sampleId) {
        Map<String, Object> s = db.one("""
            SELECT s.*, o.order_code, o.notes AS order_notes, o.po_number, o.submission_channel::text AS channel, o.id AS order_id,
                COALESCE(cl.display_name, cl.legal_name) AS client_name, cl.id AS client_id, cl.account_status::text AS account_status, cl.allow_partial_reports, cl.is_gmp_client,
                lu.full_name AS logged_by_name
              FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id LEFT JOIN app_user lu ON lu.id = s.logged_by WHERE s.id = ?::uuid""", sampleId);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sample", s);
        out.put("tests", db.rows("""
            SELECT rt.id, t.test_name, rt.special_instructions, rt.status::text AS status, rt.due_date, test_is_finalized(rt.id) AS finalized,
                test_awaits_finalization(rt.id) AS awaits FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = ?::uuid ORDER BY t.test_name""", sampleId));
        out.put("attachments", db.rows("""
            SELECT a.id, a.kind, a.label, a.sample_id, f.file_name, f.mime_type, a.created_at, u.full_name AS added_by
              FROM sample_attachment a JOIN document_file f ON f.id = a.document_id JOIN app_user u ON u.id = a.created_by
             WHERE a.lab_order_id = ?::uuid AND (a.sample_id IS NULL OR a.sample_id = ?::uuid) AND a.status = 'Active' ORDER BY a.created_at""", s.get("order_id"), sampleId));
        out.put("notes", db.rows("""
            SELECT n.id, n.kind, n.note_text, n.requested_test_id, n.analyte_id, COALESCE(an.report_name, an.analyte_name) AS analyte, t.test_name,
                u.full_name AS by_name, n.created_at FROM coa_note n JOIN app_user u ON u.id = n.created_by LEFT JOIN requested_test rt ON rt.id = n.requested_test_id
                LEFT JOIN test t ON t.id = rt.test_id LEFT JOIN analyte an ON an.id = n.analyte_id WHERE n.sample_id = ?::uuid AND n.status = 'Active' ORDER BY n.created_at""", sampleId));
        out.put("versions", db.rows("""
            SELECT v.id, v.version_no, v.is_final, v.sha256, v.prev_sha256, v.verify_code, v.issued_at, v.group_code, u.full_name AS issued_by_name, c.coa_code,
                s.sample_code || '-R' || v.version_no AS report_id, v.release_checks, v.internal_note
              FROM coa_version v JOIN coa c ON c.id = v.coa_id JOIN sample s ON s.id = c.sample_id JOIN app_user u ON u.id = v.issued_by WHERE c.sample_id = ?::uuid ORDER BY v.version_no DESC""",
            sampleId));
        out.put("changes", db.rows("""
            SELECT a.changed_at, a.changed_fields, a.reason, u.full_name FROM audit_log a JOIN app_user u ON u.id = a.changed_by
             WHERE a.table_name = 'sample' AND a.record_id = ?::uuid AND a.action = 'UPDATE' AND NOT a.changed_fields ? 'logged_at' ORDER BY a.changed_at DESC LIMIT 20""", sampleId));
        out.put("batches", db.rows("""
            SELECT DISTINCT b.id, b.batch_code, b.status::text AS status, t.test_name FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id
              JOIN requested_test rt ON rt.id = e.requested_test_id JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = ?::uuid ORDER BY b.batch_code""", sampleId));
        return out;
    }

    // ---------------------------------------------------------------- finalize a group (one signing act, one signature per COA)
    private record Item(Map<String, Object> it, CoaContent content, Made made, List<Map<String, Object>> checks) {}

    public Map<String, Object> finalize(RequestContext ctx, Map<String, Object> body) {
        List<Map<String, Object>> items = Answers.rows(body, "items");
        if (!(body.get("items") instanceof List<?> l) || l.isEmpty()) throw new RuleException("Nothing to finalize");
        for (Map<String, Object> it : items) sampleSite(ctx, it.get("sample_id"));
        signatures.verify(ctx, body); // the password once, before the PDFs are made
        List<Item> made = new ArrayList<>();
        for (Map<String, Object> it : items) {
            CoaContent content = CoaDocument.content(db, String.valueOf(it.get("sample_id")), Answers.uuids(it.get("tests")), ctx.userId(), links.base(), null);
            Made pdf = pdf(content, false);
            List<Map<String, Object>> checks = CoaChecks.checks(db, content, ctx.userId(), pdf.readBack());
            Map<?, ?> acks = it.get("acks") instanceof Map<?, ?> m ? m : Map.of();
            for (Map<String, Object> k : checks) if ("Warning".equals(k.get("level"))) k.put("ack", (Js.truthy(acks.get(k.get("code"))) ? Html.text(acks.get(k.get("code"))) : "").trim());
            made.add(new Item(it, content, pdf, checks));
        }
        String reason = Js.truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Finalized for release";
        return uow.run(ctx, reason, d -> {
            Object group = d.one("SELECT next_finalization_group() AS g").get("g");
            List<Map<String, Object>> out = new ArrayList<>();
            for (Item m : made) {
                CoaContent content = m.content();
                Map<String, Object> sample = content.part("sample");
                d.one("SELECT sign_action(?, ?, ?, ?) AS id", "Finalized by",
                    "Report " + content.get("report_id") + " (version " + content.get("version_no") + "): " + sample.get("sample_code") + " (" + group + ")", "Reports", reason);
                String doc = Pdfs.store(d, content.get("report_id") + ".pdf", m.made().pdf());
                Object v = d.one("SELECT finalize_sample(?::uuid, ?::uuid[], ?::jsonb, ?::uuid, ?, ?::jsonb, ?, ?) AS id", sample.get("id"), Answers.uuids(m.it().get("tests")),
                    toJson(content.stored()), doc, m.made().pdf().sha256(), toJson(m.checks()), group, Js.truthy(m.it().get("internal_note")) ? m.it().get("internal_note") : null).get("id");
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("sample_id", sample.get("id"));
                r.put("sample_code", sample.get("sample_code"));
                r.put("coa_version_id", v);
                r.put("version_no", v != null ? content.get("version_no") : null);
                r.put("coa_code", content.get("coa_code"));
                r.put("report_id", content.get("report_id"));
                r.put("is_final", content.get("is_final"));
                r.put("held", v == null);
                out.add(r);
            }
            return Answers.map("group", group, "issued", out);
        });
    }

    private String toJson(Object v) {
        try { return json.writeValueAsString(v); } catch (JsonProcessingException e) { throw new IllegalStateException(e); }
    }

    // ---------------------------------------------------------------- the public check (no sign-in)
    public Map<String, Object> publicCheck(String code) {
        String c = code == null ? "" : code.substring(0, Math.min(20, code.length()));
        Map<String, Object> row = db.one("SELECT * FROM coa_public_check(?)", c);
        if (row == null) return Answers.map("found", false);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("found", true);
        out.putAll(row);
        out.put("superseded", Js.toNumber(row.get("latest_version")) > Js.toNumber(row.get("version_no")));
        return out;
    }
}
