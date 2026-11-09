package com.tentamus.lims.stability.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The stability reports' PDFs: the summary (study page), the preview of the report that would be issued now, issuing it
 * (the password first, then the PDF, then the signed issue_stability_report) and an issued report's stored PDF.
 */
@Service
public class StabilityReportsService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final HeadlessBrowser browser;
    private final ObjectMapper json;

    public StabilityReportsService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, HeadlessBrowser browser, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.browser = browser;
        this.json = json;
    }

    /** A PDF to send: its bytes and file name. */
    public record File(byte[] buf, String name) {}

    private Map<String, Object> studyOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Study not found");
        Map<String, Object> st = db.one("SELECT id, site_id, study_code FROM stability_study WHERE id = ?::uuid", id);
        if (st == null) throw new RuleException("Study not found");
        access.checkSite(ctx, (String) st.get("site_id"));
        return st;
    }

    private byte[] pdf(String html, String footer) { return browser.htmlToPdf(html, Html.esc(footer), false); }

    /** The summary report (not issued). */
    public File summary(RequestContext ctx, String id) {
        Map<String, Object> st = studyOf(ctx, id);
        Map<String, Object> r = StabilityData.reportData(db, id, false);
        return new File(pdf(StabilityDocuments.reportHtml(r, null), st.get("study_code") + " stability summary · Tentamus North America"), st.get("study_code") + " stability summary.pdf");
    }

    private record Parts(Map<String, Object> data, StabilityDocuments.Issue issue, Map<String, Object> content) {}

    @SuppressWarnings("unchecked")
    private Parts issueParts(Db d, Map<String, Object> st, String userId) {
        Object next = d.one("SELECT COALESCE(max(version_no), 0) + 1 AS n FROM stability_report WHERE study_id = ?::uuid", st.get("id")).get("n");
        Map<String, Object> meta = d.one("""
            SELECT stability_report_fingerprint(?::uuid) AS fingerprint, stability_report_is_final(?::uuid) AS is_final, clock_timestamp() AS at,
                (SELECT time_zone FROM lab_site WHERE id = ?::uuid) AS tz""", st.get("id"), st.get("id"), st.get("site_id"));
        Map<String, Object> me = d.one("""
            SELECT u.full_name, u.title, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64
              FROM app_user u LEFT JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = ?::uuid""", userId);
        Map<String, Object> data = StabilityData.reportData(d, st.get("id"), true);
        int n = ((Number) next).intValue();
        StabilityDocuments.Issue issue = new StabilityDocuments.Issue(st.get("study_code") + "-SR" + n, n, Boolean.TRUE.equals(meta.get("is_final")), (String) me.get("full_name"),
            Js.truthy(me.get("title")) ? (String) me.get("title") : "", Js.truthy(me.get("sig_b64")) ? "data:" + me.get("sig_type") + ";base64," + me.get("sig_b64") : null, meta.get("at"), (String) meta.get("tz"));
        Map<String, Object> study = (Map<String, Object>) data.get("study");
        Map<String, Object> content = map("report_code", issue.reportCode(), "version_no", n, "is_final", issue.isFinal(), "fingerprint", meta.get("fingerprint"),
            "issued_by", issue.by(), "signer_title", issue.title(), "result_ids", data.get("result_ids"), "sections", data.get("sections"), "excursions", data.get("excursions"),
            "amendments", data.get("amendments"), "study", map("code", study.get("study_code"), "status", study.get("status"), "client", study.get("client_name"),
                "product", study.get("product"), "lot", study.get("lot"), "placement_date", study.get("placement_date")));
        return new Parts(data, issue, content);
    }

    /** A preview of the report that would be issued now (marked as a preview, not signed). */
    public File preview(RequestContext ctx, String id) {
        Map<String, Object> st = studyOf(ctx, id);
        Parts p = issueParts(db, st, ctx.userId());
        StabilityDocuments.Issue i = p.issue();
        StabilityDocuments.Issue unsigned = new StabilityDocuments.Issue(i.reportCode(), i.versionNo(), i.isFinal(), i.by(), i.title(), null, i.at(), i.tz());
        String html = StabilityDocuments.reportHtml(p.data(), unsigned).replaceFirst("<body>",
            "<body><div style=\"border:2px solid #c68a00;color:#8a5a00;padding:6px 10px;margin-bottom:10px;font-weight:700\">PREVIEW: not issued</div>");
        return new File(pdf(html, i.reportCode() + " PREVIEW, NOT ISSUED · Tentamus North America"), i.reportCode() + " preview.pdf");
    }

    /** Issue: the password first, then the PDF as it will stand, then the signed issue with it. */
    public Map<String, Object> issue(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> st = studyOf(ctx, id);
        signatures.verify(ctx, body);
        List<String> blocks = db.rows("SELECT problem FROM stability_report_problems(?::uuid, ?::uuid) WHERE severity = ?", st.get("id"), ctx.userId(), "Block")
            .stream().map(x -> (String) x.get("problem")).toList();
        if (!blocks.isEmpty()) throw new RuleException("The report cannot be issued: " + String.join("; ", blocks));
        Parts p = issueParts(db, st, ctx.userId());
        StabilityDocuments.Issue i = p.issue();
        Pdfs.Made made = Pdfs.Made.of(pdf(StabilityDocuments.reportHtml(p.data(), i), i.reportCode() + " · " + (i.isFinal() ? "Final" : "Interim") + " stability report · Tentamus North America"));
        String contentJson;
        try { contentJson = json.writeValueAsString(p.content()); } catch (JsonProcessingException e) { throw new IllegalStateException(e); }
        String reason = Js.truthy(body.get("reason")) ? Js.string(body.get("reason")) : "Stability report " + i.reportCode() + " issued";
        return uow.run(ctx.withSite((String) st.get("site_id")), reason, d -> {
            d.one("SELECT sign_action(?, ?, ?, ?) AS id", "Issued by", "Stability report " + i.reportCode() + (i.isFinal() ? " (Final)" : ""), "Stability", null);
            String doc = Pdfs.store(d, i.reportCode() + " stability report.pdf", made);
            Object rid = d.one("SELECT issue_stability_report(?::uuid, ?::jsonb, ?::uuid, ?) AS id", st.get("id"), contentJson, doc, made.sha256()).get("id");
            return map("id", rid, "report_code", i.reportCode(), "is_final", i.isFinal());
        });
    }

    /** An issued report's stored PDF. */
    public File issued(RequestContext ctx, String id) {
        Map<String, Object> rp = db.one("""
            SELECT r.report_code, s.site_id, encode(f.content, 'base64') AS b64 FROM stability_report r JOIN stability_study s ON s.id = r.study_id
              JOIN document_file f ON f.id = r.document_id WHERE r.id = ?::uuid""", RequestContext.isUuid(id) ? id : null);
        if (rp == null) throw new RuleException("Report not found");
        access.checkSite(ctx, (String) rp.get("site_id"));
        return new File(Base64.getMimeDecoder().decode((String) rp.get("b64")), rp.get("report_code") + " stability report.pdf");
    }
}
