package com.tentamus.lims.oos.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.oos.domain.Checklist;
import com.tentamus.lims.oos.domain.OosInvestigation;
import com.tentamus.lims.oos.domain.OosOpening;
import com.tentamus.lims.oos.repo.OosStore;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * OOS investigations: the list, one investigation, its signed steps (open, analyst, supervisor, cancel, retests, the
 * retest determination, the client's Phase II decision), the client's answers handled, the stored report and an Outbox
 * email's attachment, and the OOS checklists (QA). The rules are the domain's ({@link OosInvestigation}, {@link OosOpening}, {@link Checklist}). The conclusion (which makes the
 * report PDF) and the client's public answer page stay in the Node backend for now.
 */
@Service
public class OosService {
    private static final String LIST = """
        SELECT x.id, x.oos_code, x.status, x.procedure::text AS procedure, x.conclusion, x.reported, x.unit, x.spec_text, x.opened_at, x.due_date, x.is_gmp,
            x.client_notified_at, x.retest_determination, s.id AS sample_id, s.sample_code, s.client_sample_id, t.test_name, a.analyte_name, b.batch_code, b.id AS batch_id,
            COALESCE(c.display_name, c.legal_name) AS client_name, ou.full_name AS opened_by_name,
            (x.status NOT IN ('Closed','Cancelled') AND x.due_date < site_today(x.site_id)) AS overdue,
            (SELECT count(*) FROM oos_client_response cr WHERE cr.oos_id = x.id AND cr.handled_at IS NULL)::int AS responses_waiting
          FROM oos_investigation x JOIN sample s ON s.id = x.sample_id JOIN lab_order lo ON lo.id = s.lab_order_id JOIN client c ON c.id = lo.client_id
          JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id JOIN analyte a ON a.id = x.analyte_id
          LEFT JOIN test_batch b ON b.id = x.batch_id JOIN app_user ou ON ou.id = x.opened_by""";
    private static final RecordWriter ITEMS = new RecordWriter("oos_checklist_item", List.of("procedure", "section", "item_text", "sort_order", "status"));
    private static final RecordWriter SETTINGS = new RecordWriter("oos_procedure_setting", List.of("close_within_days"));
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final OosChecks checks;
    private final ObjectMapper json;
    private final OosStore store;

    public OosService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, OosChecks checks, ObjectMapper json, OosStore store) {
        this.store = store;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.checks = checks;
        this.json = json;
    }

    private static boolean truthy(Object v) { return v != null && !"".equals(v) && !Boolean.FALSE.equals(v); }

    private static Object orNull(Object v) { return truthy(v) ? v : null; }

    private static Object orBlank(Object v) { return truthy(v) ? v : ""; }

    /** What Node answered for SELECT fn(...) returning void: {fields: [{name, dataTypeID}], rows: [{fn: ""}]}. */
    private static Map<String, Object> voidAnswer(String fn) {
        Map<String, Object> field = new LinkedHashMap<>();
        field.put("name", fn);
        field.put("dataTypeID", 2278L);
        Map<String, Object> row = new LinkedHashMap<>();
        row.put(fn, "");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("fields", List.of(field));
        out.put("rows", List.of(row));
        return out;
    }

    /** A text field as the database read it (null and false as blank). */
    private static String str(Object v) { return truthy(v) ? Js.string(v) : ""; }

    /** The checklist answers as JSON ({} when none). */
    private JsonNode answers(Map<String, Object> body) { return json.valueToTree(truthy(body.get("answers")) ? body.get("answers") : Map.of()); }

    private String toJson(Object v) {
        try { return json.writeValueAsString(v == null || "".equals(v) || Boolean.FALSE.equals(v) ? Map.of() : v); }
        catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    /** An investigation of a lab the person may see. */
    private Map<String, Object> oosOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("OOS investigation not found");
        Map<String, Object> o = db.one("SELECT id, site_id, oos_code, status FROM oos_investigation WHERE id = ?::uuid", id);
        if (o == null) throw new RuleException("OOS investigation not found");
        access.checkSite(ctx, (String) o.get("site_id"));
        return o;
    }

    /** Signed in module Testing; the Reason for Change is the given one, else the request's, else the meaning. */
    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, String reason, Function<Db, T> work) {
        String r = truthy(reason) ? reason : truthy(body.get("reason")) ? Js.string(body.get("reason")) : meaning;
        return signatures.signed(ctx.withReason(r), body, new SignatureService.Meaning(meaning, action, "Testing"), work);
    }

    private List<Map<String, Object>> runChecks(RequestContext ctx, String id) {
        List<Map<String, Object>> list = checks.run(id);
        uow.run(ctx, "Automatic data checks run", d -> {
            OosInvestigation o = store.load(d, id);
            if (!store.has(d, "oos.open", o.siteId()) && !store.has(d, "testing.review", o.siteId())) store.requirePermission(d, "oos.open", o.siteId());
            o.checkChecksOpen();
            store.saveChecks(d, o.id(), toJson(list));
            return null;
        });
        return list;
    }

    // ---------------------------------------------------------------- reading
    public Map<String, Object> list(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        boolean canOpen = access.has(ctx, "oos.open");
        Map<String, Object> out = new LinkedHashMap<>();
        if (PagedList.wanted(query)) {
            out.putAll(PagedList.of(LIST + " WHERE x.site_id = ?::uuid", site)
                .filter("open", "(status::text NOT IN ('Closed','Cancelled') OR responses_waiting > 0)").filter("overdue", "overdue")
                .filter("closed", "status::text IN ('Closed','Cancelled')").filter("all", "true")
                .search("oos_code", "sample_code", "client_sample_id", "client_name", "test_name", "analyte_name", "batch_code", "conclusion")
                .ids("oos_code", "sample_code", "batch_code").order("ORDER BY opened_at DESC").run(db, query));
        } else out.put("rows", db.rows(LIST + " WHERE x.site_id = ?::uuid ORDER BY (x.status IN ('Closed','Cancelled')), x.opened_at DESC", site));
        out.put("can_open", canOpen);
        return out;
    }

    /** The OOS state of the results of a batch (QC Review) or a sample (sample page). */
    public Map<String, Object> forRecord(RequestContext ctx, Map<String, String> query) {
        String key = RequestContext.isUuid(query.get("batch")) ? "batch" : RequestContext.isUuid(query.get("sample")) ? "sample" : null;
        if (key == null) return Map.of("rows", List.of());
        List<Map<String, Object>> rows = db.rows("""
            SELECT x.id, x.oos_code, x.status, x.conclusion, x.requested_test_id, x.analyte_id, x.site_id, x.client_notified_at, x.phase2_decision, x.phase2_note,
                x.phase2_at, pu.full_name AS phase2_by_name, a.analyte_name, t.test_name, x.reported, x.unit,
                (SELECT count(*) FROM oos_client_response cr WHERE cr.oos_id = x.id)::int AS responses
              FROM oos_investigation x JOIN analyte a ON a.id = x.analyte_id JOIN requested_test rt ON rt.id = x.requested_test_id JOIN test t ON t.id = rt.test_id
              LEFT JOIN app_user pu ON pu.id = x.phase2_by WHERE x.""" + key + "_id = ?::uuid AND x.status <> 'Cancelled' ORDER BY x.opened_at",
            query.get("batch") != null && !query.get("batch").isEmpty() ? query.get("batch") : query.get("sample"));
        if (!rows.isEmpty()) access.checkSite(ctx, (String) rows.get(0).get("site_id"));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", rows);
        out.put("can_open", access.has(ctx, "oos.open"));
        out.put("can_phase2", access.has(ctx, "orders.edit") || access.has(ctx, "oos.open") || access.has(ctx, "reports.finalize"));
        return out;
    }

    public Map<String, Object> config(RequestContext ctx) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("items", db.rows("SELECT id, procedure::text AS procedure, section, item_text, sort_order, status::text AS status FROM oos_checklist_item ORDER BY procedure, section, sort_order"));
        out.put("settings", db.rows("SELECT id, procedure::text AS procedure, close_within_days FROM oos_procedure_setting ORDER BY procedure"));
        out.put("can_edit", access.has(ctx, "oos.configure"));
        return out;
    }

    public Map<String, Object> one(RequestContext ctx, String id) {
        Map<String, Object> o = oosOf(ctx, id);
        Map<String, Object> d = new LinkedHashMap<>(db.one(LIST.replace("SELECT x.id,", "SELECT x.*, x.id,") + " WHERE x.id = ?::uuid", o.get("id")));
        List<Object> people = new ArrayList<>();
        for (String k : List.of("analyst_by", "supervisor_by", "concluded_by", "determined_by", "cancelled_by")) if (truthy(d.get(k))) people.add(d.get(k));
        Map<Object, Object> names = new LinkedHashMap<>();
        for (Map<String, Object> n : db.rows("SELECT id, full_name FROM app_user WHERE id = ANY(?::uuid[])", people)) names.put(n.get("id"), n.get("full_name"));
        d.put("analyst_name", names.get(d.get("analyst_by")));
        d.put("supervisor_name", names.get(d.get("supervisor_by")));
        d.put("concluded_name", names.get(d.get("concluded_by")));
        d.put("determined_name", names.get(d.get("determined_by")));
        d.put("cancelled_name", names.get(d.get("cancelled_by")));
        String site = (String) o.get("site_id");
        UserAccess a = access.load(ctx.userId());
        Map<String, Object> can = new LinkedHashMap<>();
        can.put("open", a.can("oos.open", site));
        can.put("perform", a.can("testing.perform", site));
        can.put("review", a.can("testing.review", site));
        can.put("approve", a.can("oos.approve", site));
        can.put("order", a.can("orders.edit", site));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("oos", d);
        out.put("items", db.rows("SELECT id, section, item_text, sort_order FROM oos_checklist_item WHERE procedure::text = ? AND status = 'Active' ORDER BY section, sort_order", d.get("procedure")));
        out.put("responses", db.rows("""
            SELECT cr.*, hu.full_name AS handled_by_name, rt.id AS retest_id FROM oos_client_response cr LEFT JOIN app_user hu ON hu.id = cr.handled_by
              LEFT JOIN requested_test rt ON rt.id = cr.retest_requested_test_id WHERE cr.oos_id = ?::uuid ORDER BY cr.received_at""", o.get("id")));
        out.put("retests", db.rows("""
            SELECT rt.id, rt.source::text AS source, rt.status::text AS status, rt.billing_status, rt.retest_replicates, rt.price, rt.due_date,
                (SELECT string_agg(tr.reported || COALESCE(' ' || tr.unit, '') || ' (' || tr.conformance || ')', ', ') FROM test_result tr WHERE tr.requested_test_id = rt.id
                   AND tr.status = 'Active' AND tr.stage = 'Final' AND tr.result_key IS NULL) AS result
              FROM requested_test rt WHERE rt.oos_investigation_id = ?::uuid ORDER BY rt.created_at""", o.get("id")));
        out.put("me", ctx.userId());
        out.put("can", can);
        return out;
    }

    // ---------------------------------------------------------------- the signed steps
    /** Opened (signed "Opened by"), then the automatic checks (a failure of the checks does not stop the opening). */
    public Map<String, Object> open(RequestContext ctx, Map<String, Object> body) {
        Map<String, Object> rt = RequestContext.isUuid(body.get("requested_test_id")) ? db.one(
            "SELECT o.site_id FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = ?::uuid", body.get("requested_test_id")) : null;
        if (rt == null) throw new RuleException("Test not found");
        access.checkSite(ctx, (String) rt.get("site_id"));
        Map<String, Object> out = signed(ctx, body, "Opened by", "OOS investigation opened", "OOS investigation opened", d -> {
            Object test = body.get("requested_test_id"), analyte = RequestContext.isUuid(body.get("analyte_id")) ? body.get("analyte_id") : null;
            Object batch = RequestContext.isUuid(body.get("batch_id")) ? body.get("batch_id") : null;
            Map<String, Object> t = store.testOf(d, test);
            store.requirePermission(d, "oos.open", (String) t.get("site_id"));
            store.assertSigned(d, "open an OOS investigation");
            OosOpening.Result stored = store.storedResult(d, test, analyte);
            OosOpening.Result res = OosOpening.check(store.openCode(d, test, analyte), stored, stored == null ? null : store.closedCodeOf(d, stored.resultId()),
                (String) batch, store.batchCode(d, batch), stored == null ? store.reading(d, batch, test, analyte) : null);
            String procedure = OosOpening.procedure(Boolean.TRUE.equals(t.get("gmp")), (String) t.get("lab_default"));
            Object id = store.insert(d, t, test, analyte, res, procedure, OosOpening.closeWithin(store.closeWithinDays(d, procedure)),
                truthy(body.get("reason")) ? Js.string(body.get("reason")) : null);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", id);
            return m;
        });
        try { runChecks(ctx, (String) out.get("id")); } catch (RuntimeException ignored) { }
        return out;
    }

    public Map<String, Object> runChecksNow(RequestContext ctx, String id) {
        Map<String, Object> o = oosOf(ctx, id);
        return Map.of("checks", runChecks(ctx, (String) o.get("id")));
    }

    public Map<String, Object> analyst(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        return signed(ctx, body, "Investigated by", o.get("oos_code") + ": analyst section", "OOS investigation: analyst section signed",
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                x.checkAnalystSection();
                store.requirePermission(d, "testing.perform", x.siteId());
                store.assertSigned(d, "sign the analyst section of an OOS investigation");
                Checklist.check("Analyst", store.items(d, x.procedure(), "Analyst"), answers(body));
                store.signAnalyst(d, x.id(), toJson(body.get("answers")), str(body.get("comment")), str(body.get("hypothesis")));
                return voidAnswer("sign_oos_analyst");
            });
    }

    public Map<String, Object> supervisor(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        return signed(ctx, body, "Reviewed by", o.get("oos_code") + ": supervisor section", "OOS investigation: supervisor section signed",
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                x.checkSupervisorSection(ctx.userId(), store.didBenchWork(d, x.batchId()));
                store.requirePermission(d, "testing.review", x.siteId());
                store.assertSigned(d, "sign the supervisor section of an OOS investigation");
                Checklist.check("Supervisor", store.items(d, x.procedure(), "Supervisor"), answers(body));
                store.signSupervisor(d, x.id(), toJson(body.get("answers")), str(body.get("comment")));
                return voidAnswer("sign_oos_supervisor");
            });
    }

    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        return signed(ctx, body, "Cancelled by", o.get("oos_code") + " cancelled", null,
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                String why = str(body.get("reason"));
                x.checkCancel(ctx.userId(), store.has(d, "oos.approve", x.siteId()), store.has(d, "oos.open", x.siteId()), why);
                store.assertSigned(d, "cancel an OOS investigation");
                store.cancel(d, x.id(), why);
                return voidAnswer("cancel_oos");
            });
    }

    public Map<String, Object> retest(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        double asked = Js.toNumber(body.get("replicates"));
        Object reps = Double.isNaN(asked) || asked == 0 ? 1 : asked == Math.rint(asked) ? (Object) (long) asked : asked;
        return signed(ctx, body, "Ordered by", o.get("oos_code") + ": " + ("Client".equals(body.get("kind")) ? "client" : "lab investigation") + " retest", null,
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                store.requirePermission(d, "orders.edit", x.siteId());
                store.assertSigned(d, "order an OOS retest");
                Map<String, Object> f = store.retestFacts(d, x.requestedTestId());
                double n = Js.toNumber(reps);
                // a fraction is refused, as the database's integer argument refused it
                if (n != Math.rint(n)) throw RuleException.database("A retest is single, duplicate or triplicate");
                OosInvestigation.Retest r = x.retest(Js.string(body.get("kind")), (int) n, Boolean.TRUE.equals(f.get("gone")), (String) f.get("sample_code"),
                    Boolean.TRUE.equals(f.get("replaced")));
                Object made = store.orderRetest(d, x, r, RequestContext.isUuid(body.get("response_id")) ? body.get("response_id") : null);
                if (x.recordsPhase2(r)) store.recordPhase2Retest(d, x.id());
                store.reopenOrder(d, f.get("order_id"), (String) f.get("order_status"));
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("id", made);
                return m;
            });
    }

    public Map<String, Object> determination(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        return signed(ctx, body, "Approved by", o.get("oos_code") + ": retest determination", "Retest determination recorded",
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                store.requirePermission(d, "oos.approve", x.siteId());
                store.assertSigned(d, "record the retest determination");
                Map<String, Object> r = store.clientRetest(d, x.id());
                String det = str(body.get("determination")), why = str(body.get("reason"));
                String billing = x.determine(r != null, r != null && Boolean.TRUE.equals(r.get("approved")), store.determination(d, x.id()), det, why);
                store.determine(d, x.id(), det, why, r.get("id"), billing);
                return voidAnswer("record_retest_determination");
            });
    }

    /** The client's Phase II decision recorded on the sample: "no re-test" closes the loop, signed. */
    public Map<String, Object> phase2(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> o = oosOf(ctx, id);
        return signed(ctx, body, "Recorded by", o.get("oos_code") + ": client's Phase II decision (no re-test)", "Phase II decision: no re-test",
            d -> {
                OosInvestigation x = store.load(d, o.get("id"));
                if (!store.has(d, "orders.edit", x.siteId()) && !store.has(d, "oos.open", x.siteId()) && !store.has(d, "reports.finalize", x.siteId()))
                    store.requirePermission(d, "orders.edit", x.siteId());
                store.assertSigned(d, "record the client's Phase II decision");
                String note = str(body.get("note"));
                x.checkNoRetest("No retest", note);
                store.recordNoRetest(d, x, note);
                return voidAnswer("record_oos_phase2");
            });
    }

    public Map<String, Object> responseHandled(RequestContext ctx, String rid, Map<String, Object> body) {
        Map<String, Object> x = db.one("SELECT o.id FROM oos_client_response cr JOIN oos_investigation o ON o.id = cr.oos_id WHERE cr.id = ?::uuid", rid);
        if (x == null) throw new RuleException("Response not found");
        oosOf(ctx, (String) x.get("id"));
        return uow.run(ctx, "Client response handled", d -> {
            Map<String, Object> r = store.response(d, rid);
            String site = (String) r.get("site_id");
            if (!store.has(d, "orders.edit", site) && !store.has(d, "oos.open", site)) store.requirePermission(d, "orders.edit", site);
            OosInvestigation.checkHandle(Boolean.TRUE.equals(r.get("handled")));
            store.handle(d, rid, str(body.get("note")));
            return voidAnswer("handle_oos_response");
        });
    }

    // ---------------------------------------------------------------- files
    /** The investigation report (made at the conclusion): {b64, file_name}. */
    public Map<String, Object> report(RequestContext ctx, String id) {
        Map<String, Object> o = oosOf(ctx, id);
        Map<String, Object> d = db.one("SELECT encode(f.content, 'base64') AS b64 FROM oos_investigation x JOIN document_file f ON f.id = x.report_document_id WHERE x.id = ?::uuid", o.get("id"));
        if (d == null) throw new RuleException("The report is made when the investigation is concluded");
        return Map.of("b64", d.get("b64"), "file_name", o.get("oos_code") + " investigation report.pdf");
    }

    /** A document attached to an Outbox email (the Phase I report on the OOS email). */
    public Map<String, Object> outboxDocument(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Email not found");
        Map<String, Object> e = db.one("""
            SELECT o.site_id, f.file_name, f.mime_type, encode(f.content, 'base64') AS b64 FROM email_outbox e JOIN lab_order o ON o.id = e.lab_order_id
              JOIN document_file f ON f.id = e.document_id WHERE e.id = ?::uuid""", id);
        if (e == null) throw new RuleException("This email has no attachment");
        access.checkSite(ctx, (String) e.get("site_id"));
        return e;
    }

    // ---------------------------------------------------------------- QA: the checklists and target times
    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> body) {
        return body.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }

    public List<Map<String, Object>> saveItems(RequestContext ctx, Map<String, Object> body) {
        return uow.run(ctx, d -> ITEMS.upsert(d, rows(body), Map.of()));
    }

    public List<Map<String, Object>> saveSettings(RequestContext ctx, Map<String, Object> body) {
        return uow.run(ctx, d -> SETTINGS.upsert(d, rows(body).stream().filter(x -> truthy(x.get("id"))).toList(), Map.of()));
    }
}
