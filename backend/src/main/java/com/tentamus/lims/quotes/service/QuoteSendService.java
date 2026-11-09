package com.tentamus.lims.quotes.service;

import static com.tentamus.lims.core.web.Answers.map;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.documents.Html;
import com.tentamus.lims.core.documents.Pdfs;
import com.tentamus.lims.core.documents.PublicLinks;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.quotes.repo.ProjectRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Sending a quote to the client (issued first if still a Draft; the PDF; send_quote records it and queues the email with
 * the accept/decline link), the quotation PDF, and the client's page behind the link (no sign-in; the answer is recorded
 * as the system user by record_quote_response).
 */
@Service
public class QuoteSendService {
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final ProjectRepository projects;
    private final ProjectService versions;
    private final QuoteDocument document;
    private final PublicLinks links;

    public QuoteSendService(Db db, UnitOfWork uow, AccessPolicy access, ProjectRepository projects, ProjectService versions, QuoteDocument document, PublicLinks links) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.projects = projects;
        this.versions = versions;
        this.document = document;
        this.links = links;
    }

    /** A PDF to send: its bytes and file name. */
    public record File(byte[] buf, String name) {}

    private Map<String, Object> versionOf(Object vid) {
        if (!RequestContext.isUuid(vid)) throw new RuleException("Quote not found");
        Map<String, Object> v = db.one("""
            SELECT pv.id, pv.status::text AS status, pv.valid_until, pv.project_id, p.client_id, p.project_code, p.quote_contact_id, p.kind
              FROM project_version pv JOIN project p ON p.id = pv.project_id WHERE pv.id = ?::uuid""", vid);
        if (v == null) throw new RuleException("Quote not found");
        return v;
    }

    private static String cut(Object v, int n) {
        String s = Js.truthy(v) ? Js.string(v) : "";
        return s.length() <= n ? s : s.substring(0, n);
    }

    /** Send to the client: issue it first if it is still a Draft, make the PDF, then record and queue the email. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> send(RequestContext ctx, String vid, Map<String, Object> b) {
        Map<String, Object> v = versionOf(vid);
        if (!RequestContext.isUuid(b.get("contact_id"))) throw new RuleException("Choose who to send the quote to");
        String site = access.currentSite(ctx);
        Object status = v.get("status");
        if ("Draft".equals(status) || "Submitted for Quote".equals(status)) {
            Object valid = Js.orNull(b.get("valid_until"));
            uow.run(ctx, "Quote issued", d -> {
                versions.moveTo(d, projects.quoteVersion(d, v.get("id")), "Quoted", map("valid_until", valid));
                return d.update("UPDATE project_version SET status = 'Quoted', valid_until = ?::date WHERE id = ?::uuid", valid, v.get("id"));
            });
        } else if (!"Quoted".equals(status)) throw new RuleException("This version is " + status + ": start a new version to send a new quote");
        QuoteDocument.Made made = document.pdf(db, v.get("id"), false);
        Map<String, Object> qv = (Map<String, Object>) made.data().get("v");
        String base = links.base();
        return uow.run(ctx, "Quote sent to the client", d -> {
            String doc = Pdfs.store(d, qv.get("project_code") + " v" + Html.text(qv.get("version_no")) + " quotation.pdf", made.pdf());
            Object email = d.one("SELECT send_quote(?::uuid, ?::uuid, ?::uuid, ?, ?::uuid, ?, ?) AS id", v.get("id"), b.get("contact_id"), doc, made.pdf().sha256(), site,
                Js.truthy(b.get("message")) ? b.get("message") : "", base).get("id");
            Object tok = d.one("SELECT client_token FROM project_version WHERE id = ?::uuid", v.get("id")).get("client_token");
            return map("email_id", email, "link", base + "/quote-response.html?t=" + tok);
        });
    }

    /** The quotation PDF: the one last sent, or a preview of the version as it stands (?fresh=1). */
    public File pdf(String vid, Map<String, String> query) {
        Map<String, Object> v = versionOf(vid);
        Map<String, Object> sent = db.one("SELECT encode(f.content, 'base64') AS b64, f.file_name FROM project_version pv JOIN document_file f ON f.id = pv.quote_document_id WHERE pv.id = ?::uuid", v.get("id"));
        boolean fresh = sent == null || Js.truthy(query.get("fresh"));
        byte[] buf = fresh ? document.pdf(db, v.get("id"), "Draft".equals(v.get("status")) || "Submitted for Quote".equals(v.get("status"))).pdf().buf()
            : Base64.getMimeDecoder().decode((String) sent.get("b64"));
        return new File(buf, v.get("project_code") + " quotation.pdf");
    }

    /** The client's page (no sign-in): the quotation behind the link. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> publicQuote(String token) {
        Map<String, Object> row = db.one("SELECT id FROM project_version WHERE client_token = ?", cut(token, 80));
        if (row == null) return map("found", false);
        Map<String, Object> d = QuoteDocument.data(db, row.get("id"));
        Map<String, Object> x = (Map<String, Object>) d.get("v");
        List<Map<String, Object>> lines = new ArrayList<>();
        double total = 0;
        for (Map<String, Object> l : (List<Map<String, Object>>) d.get("lines")) {
            total += Html.num(l.get("line_total"));
            lines.add(map("test_name", l.get("test_name"), "lab", l.get("site_name"), "quantity", Html.jsNumber(l.get("quantity")), "list_price", Html.jsNumber(l.get("list_price")),
                "final_price", Html.jsNumber(l.get("final_price")), "line_total", Html.jsNumber(l.get("line_total")),
                "tat", Html.text(l.get("standard_tat")) + " " + ("Business Days".equals(l.get("tat_unit")) ? "business" : "calendar") + " days",
                "analytes", "Analyte Selection".equals(l.get("pricing_mode")) ? Html.text(l.get("analytes_included")) + " of " + Html.text(l.get("analytes_total")) + " analytes" : ""));
        }
        Object valid = x.get("valid_until");
        String today = LocalDate.now(ZoneOffset.UTC).toString();
        return map("found", true, "quote_code", x.get("project_code"), "version_no", x.get("version_no"), "status", x.get("status"), "client_name", x.get("client_legal_name"),
            "contact", x.get("sent_to_name"), "prepared_by", x.get("owner_name"), "quoted_at", x.get("quoted_at"), "valid_until", valid, "valid_until_text", QuoteDocument.dOnly(valid),
            "expired", Js.truthy(valid) && cut(valid, 10).compareTo(today) < 0, "decided_via", x.get("decided_via"), "response_name", x.get("client_response_name"), "notes", x.get("notes"),
            "lines", lines, "total", Html.jsNumber(total));
    }

    /** The PDF the client was sent. */
    public File publicPdf(String token) {
        Map<String, Object> v = db.one("""
            SELECT pv.id, p.project_code, encode(f.content, 'base64') AS b64 FROM project_version pv JOIN project p ON p.id = pv.project_id
              JOIN document_file f ON f.id = pv.quote_document_id WHERE pv.client_token = ?""", cut(token, 80));
        if (v == null) throw new RuleException("Not found");
        return new File(Base64.getMimeDecoder().decode((String) v.get("b64")), v.get("project_code") + " quotation.pdf");
    }

    /** The client's answer, recorded as the system user. */
    public Map<String, Object> publicAnswer(String token, Map<String, Object> b) {
        Object sys = db.one("SELECT id FROM app_user WHERE username = 'system'").get("id");
        RequestContext as = new RequestContext((String) sys, null, "", "Client answer through the quote link", "127.0.0.1");
        Object code = uow.run(as, d -> d.one("SELECT record_quote_response(?, ?, ?, ?) AS code", cut(token, 80), Js.truthy(b.get("decision")) ? b.get("decision") : "",
            cut(b.get("name"), 200), cut(b.get("note"), 2000)).get("code"));
        return map("ok", true, "quote_code", code);
    }
}
