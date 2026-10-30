package com.tentamus.lims.verification.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.verification.domain.Design;
import com.tentamus.lims.verification.domain.JsValues;
import com.tentamus.lims.verification.domain.ProtocolWriter;
import com.tentamus.lims.verification.domain.VerificationReport;
import com.tentamus.lims.verification.domain.WorkflowVerification;
import com.tentamus.lims.verification.repo.DesignRepository;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Workflow verification (routes_verification.js): a version's verifications and the gate, writing the protocol (signed
 * "Prepared by"), QA's approval of it, the automated run (signed "Executed by") and the evidence capture that follows it
 * in the background, the whole document, a screenshot, the Word file, QA's signature on the report, cancelling.
 * Database functions still called: create_verification, start_verification_run, finish_verification_run,
 * record_verification_check, record_verification_evidence and the bench and review functions the run uses.
 */
@Service
public class VerificationService {
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final ObjectMapper json;
    private final UnitOfWork uow;
    private final DesignRepository designs;
    private final EvidenceCapture evidence;
    // verification id -> {started} while capturing, {error} if the last try failed (in this process, as Node's map)
    private final Map<String, Map<String, Object>> capturing = new ConcurrentHashMap<>();
    private final ExecutorService background = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "verification-evidence");
        t.setDaemon(true);
        return t;
    });

    public VerificationService(Db db, AccessPolicy access, SignatureService signatures, ObjectMapper json, UnitOfWork uow, DesignRepository designs, EvidenceCapture evidence) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.json = json;
        this.uow = uow;
        this.designs = designs;
        this.evidence = evidence;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new SignatureService.Meaning(meaning, action, "Methods"), work);
    }

    private Map<String, Object> versionOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Test version not found");
        Map<String, Object> v = db.one("""
            SELECT v.id, v.version_no, v.status::text AS status, t.id AS test_id, t.test_code, t.test_name, t.site_id, s.site_code, s.require_workflow_verification
              FROM test_version v JOIN test t ON t.id = v.test_id LEFT JOIN lab_site s ON s.id = t.site_id WHERE v.id = ?::uuid""", id);
        if (v == null) throw new RuleException("Test version not found");
        if (v.get("site_id") != null) access.checkSite(ctx, (String) v.get("site_id"));
        return v;
    }

    private Map<String, Object> verOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Verification not found");
        Map<String, Object> w = db.one("""
            SELECT w.*, v.version_no, v.status::text AS version_status, t.test_code, t.test_name, t.id AS test_id, s.site_code, s.site_name,
                test_version_config_hash(w.test_version_id) = w.config_hash AS current
              FROM workflow_verification w JOIN test_version v ON v.id = w.test_version_id JOIN test t ON t.id = v.test_id JOIN lab_site s ON s.id = w.site_id WHERE w.id = ?::uuid""", id);
        if (w == null) throw new RuleException("Verification not found");
        access.checkSite(ctx, (String) w.get("site_id"));
        return w;
    }

    private String label(Map<String, Object> w) { return w.get("test_name") + " version " + Js.string(w.get("version_no")); }

    /** The verifications of a version, and whether the gate is open. */
    public Map<String, Object> forVersion(RequestContext ctx, String id) {
        Map<String, Object> v = versionOf(ctx, id);
        Map<String, Object> out = map("version", v, "required", Js.truthy(v.get("require_workflow_verification")),
            "passing", db.one("SELECT version_verification(?::uuid) AS id", v.get("id")).get("id"),
            "rows", db.rows("""
                SELECT w.id, w.verification_code, w.status, w.outcome, w.created_at, w.report_signed_at, w.cancelled_reason,
                    w.config_hash = test_version_config_hash(w.test_version_id) AS current, cu.full_name AS prepared_by_name,
                    (SELECT count(*) FROM verification_check k WHERE k.verification_id = w.id)::int AS checks,
                    (SELECT count(*) FROM verification_check k WHERE k.verification_id = w.id AND k.result = 'Pass')::int AS passed
                  FROM workflow_verification w JOIN app_user cu ON cu.id = w.created_by WHERE w.test_version_id = ?::uuid ORDER BY w.created_at DESC""", v.get("id")),
            "can_design", access.has(ctx, "methods.design"), "can_verify", access.has(ctx, "methods.verify"), "user_id", ctx.userId());
        return out;
    }

    /** Writes the protocol (signed "Prepared by"): requirements, samples, inputs and expected results from the design. */
    public Map<String, Object> protocol(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> v = versionOf(ctx, id);
        Design d = designs.load(db, (String) v.get("id"));
        ProtocolWriter.Protocol p = new ProtocolWriter(d).build();
        return signed(ctx.orReason("Workflow verification protocol written"), body, "Prepared by", "Workflow verification protocol: " + label(v),
            t -> t.one("SELECT create_verification(?::uuid, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb) AS id", v.get("id"), d.version.hash(), ProtocolWriter.GENERATOR,
                JsValues.json(p.plan()), JsValues.json(p.requirements()), JsValues.json(p.checks())));
    }

    private Map<String, Object> sig(Object id) {
        return id == null ? null : db.one("SELECT full_name, meaning, action, method, signed_at FROM signature_event WHERE id = ?::uuid", id);
    }

    /** The whole document: protocol, run, evidence and report. */
    public Map<String, Object> document(RequestContext ctx, String id) {
        Map<String, Object> w = verOf(ctx, id);
        List<Map<String, Object>> requirements = db.rows("SELECT * FROM verification_requirement WHERE verification_id = ?::uuid ORDER BY sort_order", w.get("id"));
        List<Map<String, Object>> checks = db.rows("SELECT * FROM verification_check WHERE verification_id = ?::uuid ORDER BY sort_order", w.get("id"));
        List<Map<String, Object>> batches = db.rows("SELECT id, batch_code, status::text AS status FROM test_batch WHERE verification_id = ?::uuid ORDER BY batch_code", w.get("id"));
        List<Map<String, Object>> samples = w.get("lab_order_id") != null
            ? db.rows("SELECT id, sample_code, client_sample_id FROM sample WHERE lab_order_id = ?::uuid ORDER BY sample_code", w.get("lab_order_id")) : List.of();
        Map<String, Object> prepared = sig(w.get("prepared_signature_id")), approved = sig(w.get("protocol_signature_id")),
            executed = sig(w.get("execution_signature_id")), report = sig(w.get("report_signature_id"));
        Map<String, Object> preparer = db.one("SELECT full_name FROM app_user WHERE id = ?::uuid", w.get("created_by"));
        Map<String, Object> method = db.one("SELECT m.method_name, m.sop_code FROM test_version v LEFT JOIN method m ON m.id = v.method_id WHERE v.id = ?::uuid", w.get("test_version_id"));
        Map<String, Object> order = w.get("lab_order_id") != null ? db.one("SELECT order_code, status::text AS status FROM lab_order WHERE id = ?::uuid", w.get("lab_order_id")) : null;
        List<Map<String, Object>> ev = db.rows("""
            SELECT seq, title, page_ref, check_codes, sha256, width_px, height_px, captured_at FROM verification_evidence WHERE verification_id = ?::uuid ORDER BY seq""", w.get("id"));
        Map<String, Object> ver = new LinkedHashMap<>(w);
        ver.put("prepared_by_name", preparer == null ? null : preparer.get("full_name"));
        ver.put("method_name", method == null ? null : method.get("method_name"));
        ver.put("sop_code", method == null ? null : method.get("sop_code"));
        Map<String, Object> cap = capturing.getOrDefault((String) w.get("id"), Map.of());
        boolean captured = w.get("evidence_captured_at") != null;
        return map("verification", ver, "requirements", requirements, "checks", checks, "batches", batches, "samples", samples, "order", order, "evidence", ev,
            "signatures", map("prepared", prepared, "approved", approved, "executed", executed, "evidence", sig(w.get("evidence_signature_id")), "report", report),
            "capturing", !captured && cap.get("started") != null, "capture_error", captured ? null : cap.get("error"),
            "can_design", access.has(ctx, "methods.design"), "can_verify", access.has(ctx, "methods.verify"), "user_id", ctx.userId());
    }

    private static final Pattern SIGNING = Pattern.compile("signature|password|user ID|locked", Pattern.CASE_INSENSITIVE);

    /** Executes (signed "Executed by"): the automated run, in one transaction; if the run itself breaks, nothing is kept. */
    public Map<String, Object> execute(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        List<Map<String, Object>> log = new ArrayList<>();
        Map<String, Object> res;
        try {
            res = signed(ctx.withReason("Workflow verification executed"), body, "Executed by",
                "Verification " + w.get("verification_code") + ": automated run of " + label(w), t -> {
                    Map<String, Object> out = new AutomatedRun(t, (String) w.get("id"), log, designs).execute();
                    Object outcome = t.one("SELECT finish_verification_run(?::uuid, ?::jsonb) AS outcome", w.get("id"), JsValues.json(log)).get("outcome");
                    return map("outcome", outcome, "batches", out.get("batches"), "blocked", out.get("blocked"));
                });
        } catch (RuntimeException e) {
            String m = AutomatedRun.message(e);
            if (SIGNING.matcher(m).find()) throw e;
            throw new RuleException("The run stopped and nothing was kept (the protocol is still approved): " + m);
        }
        // The run is kept. The screenshots of its pages are taken now, in the background, under the executor's signature
        // just given (a minute or so; the page shows it and refreshes). If it fails, "Capture the evidence" tries again.
        String vid = (String) w.get("id");
        capturing.put(vid, map("started", System.currentTimeMillis()));
        background.submit(() -> {
            try {
                captureEvidence(ctx, w, false, body);
                capturing.remove(vid);
            } catch (RuntimeException e) {
                capturing.put(vid, map("error", AutomatedRun.message(e)));
            }
        });
        res.put("capturing", true);
        return res;
    }

    // Screenshots of every page the run's checks point to, recorded and signed "Evidence captured by"
    private Map<String, Object> captureEvidence(RequestContext ctx, Map<String, Object> w0, boolean verify, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, (String) w0.get("id")); // after the run: its order and batches
        EvidenceCapture.Captured captured = evidence.capture(db, w, ctx.userId(), ctx.siteId() != null ? ctx.siteId() : (String) w.get("site_id"));
        String action = "Verification " + w.get("verification_code") + ": screenshots of the run's pages";
        Function<Db, Map<String, Object>> store = t -> map("pages", evidence.record(t, w.get("id"), captured), "missed", captured.missed());
        if (verify) return signatures.signed(ctx.withReason("Objective evidence captured"), body, new SignatureService.Meaning("Evidence captured by", action, "Methods"), store);
        // the password was checked moments ago for the run itself, in the same request
        return uow.run(ctx.withReason("Objective evidence captured"), t -> {
            t.one("SELECT sign_action(?, ?, ?, ?) AS id", "Evidence captured by", action, "Methods", "Objective evidence captured");
            return store.apply(t);
        });
    }

    /** Captures the evidence again (signed; the password is checked before a minute in the browser). */
    public Map<String, Object> captureAgain(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        String vid = (String) w.get("id");
        if (!"Executed".equals(w.get("status"))) throw new RuleException("Evidence is captured after the run and before QA signs the report");
        if (w.get("evidence_captured_at") != null) throw new RuleException("The evidence for this verification is already captured");
        if (capturing.getOrDefault(vid, Map.of()).get("started") != null) throw new RuleException("The evidence is being captured now: wait a moment");
        signatures.verify(ctx, body);
        capturing.put(vid, map("started", System.currentTimeMillis()));
        try {
            Map<String, Object> out = captureEvidence(ctx, w, true, body);
            capturing.remove(vid);
            return out;
        } catch (RuntimeException e) {
            capturing.put(vid, map("error", AutomatedRun.message(e)));
            throw e;
        }
    }

    /** The protocol and report as a Word document, made from the record when asked (nothing is stored): {body, file_name}. */
    public Map<String, Object> reportDocx(RequestContext ctx, String id) {
        Map<String, Object> d = document(ctx, id);
        Map<String, Object> v = JsValues.map(d.get("verification"));
        List<Map<String, Object>> ev = new ArrayList<>();
        for (Map<String, Object> x : db.rows("""
            SELECT e.seq, e.title, e.page_ref, e.check_codes, e.sha256, e.width_px, e.height_px, e.captured_at, encode(f.content, 'base64') AS b64
              FROM verification_evidence e JOIN document_file f ON f.id = e.document_id WHERE e.verification_id = ?::uuid ORDER BY e.seq""", v.get("id"))) {
            Map<String, Object> e = new LinkedHashMap<>(x);
            e.put("png", Base64.getMimeDecoder().decode((String) x.get("b64")));
            ev.add(e);
        }
        String file = v.get("verification_code") + " " + Js.string(v.get("test_code")).replaceAll("[^\\w.\\- ]", "_") + " v" + Js.string(v.get("version_no")) + ".docx";
        return map("body", VerificationReport.build(d, ev), "file_name", file);
    }

    /** QA approves the protocol (signed "Approved by"). */
    public Map<String, Object> approveProtocol(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        return signed(ctx.withReason("Verification protocol approved"), body, "Approved by", "Verification protocol " + w.get("verification_code") + ": " + label(w),
            d -> {
                load(d, w.get("id")).approveProtocol(ctx.userId(), mayAt(ctx, "methods.verify", w), refusal(d, "methods.verify"));
                internal(d, true);
                d.update("""
                    UPDATE workflow_verification SET status = 'Protocol approved', protocol_approved_by = ?::uuid, protocol_approved_at = clock_timestamp(),
                           protocol_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", ctx.userId(), w.get("id"));
                internal(d, false);
                return ok();
            });
    }

    /** One screenshot: {b64, file_name}. */
    public Map<String, Object> evidence(RequestContext ctx, String id, String seq) {
        Map<String, Object> w = verOf(ctx, id);
        double n = Js.toNumber(seq);
        Map<String, Object> d = db.one("""
            SELECT e.seq, encode(f.content, 'base64') AS b64 FROM verification_evidence e JOIN document_file f ON f.id = e.document_id
             WHERE e.verification_id = ?::uuid AND e.seq = ?""", w.get("id"), Double.isNaN(n) ? 0 : n);
        if (d == null) throw new RuleException("Screenshot not found");
        String s = Js.string(d.get("seq"));
        return map("b64", d.get("b64"), "file_name", w.get("verification_code") + "-E" + (s.length() < 2 ? "0".repeat(2 - s.length()) : "") + s + ".png");
    }

    /** QA signs the report: a conclusion, and why each requirement not tested is acceptable. */
    public Map<String, Object> signReport(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        Map<?, ?> j = body.get("justifications") instanceof Map<?, ?> m ? m : Map.of();
        return signed(ctx.withReason("Verification report signed"), body, "Approved by", "Verification report " + w.get("verification_code") + ": " + label(w),
            d -> {
                List<String> notTested = d.rows("SELECT req_code FROM verification_requirement WHERE verification_id = ?::uuid AND result = 'Not tested' ORDER BY sort_order", w.get("id"))
                    .stream().map(r -> (String) r.get("req_code")).toList();
                String conclusion = Js.string(Js.orBlank(body.get("conclusion")));
                Map<String, String> just = load(d, w.get("id")).signReport(ctx.userId(), mayAt(ctx, "methods.verify", w), refusal(d, "methods.verify"), conclusion, j, notTested);
                internal(d, true);
                for (Map.Entry<String, String> e : just.entrySet())
                    d.update("UPDATE verification_requirement SET qa_justification = ? WHERE verification_id = ?::uuid AND req_code = ?", e.getValue(), w.get("id"), e.getKey());
                Object outcome = d.one("""
                    UPDATE workflow_verification SET status = 'Report signed', report_conclusion = ?, report_signed_by = ?::uuid, report_signed_at = clock_timestamp(),
                           report_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid RETURNING outcome""",
                    conclusion.strip(), ctx.userId(), w.get("id")).get("outcome");
                internal(d, false);
                return map("outcome", outcome);
            });
    }

    /** Cancel a verification not signed off (signed, with the reason). */
    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        if (Js.string(body.get("reason")).trim().isEmpty()) throw new RuleException("Say why the verification is cancelled");
        return signed(ctx, body, "Cancelled by", "Verification " + w.get("verification_code"), d -> {
            load(d, w.get("id")).cancel(mayAt(ctx, "methods.design", w) || mayAt(ctx, "methods.verify", w), refusal(d, "methods.design"), ctx.reason());
            internal(d, true);
            d.update("UPDATE workflow_verification SET status = 'Cancelled', cancelled_reason = ? WHERE id = ?::uuid", ctx.reason(), w.get("id"));
            internal(d, false);
            return ok();
        });
    }

    /** The verification as stored, locked for the sign-off. */
    private static WorkflowVerification load(Db d, Object id) {
        Map<String, Object> w = d.one("""
            SELECT verification_code, status, created_by, executed_by, evidence_captured_at IS NOT NULL AS evidence,
                   config_hash IS NOT DISTINCT FROM test_version_config_hash(test_version_id) AS current
              FROM workflow_verification WHERE id = ?::uuid FOR UPDATE""", id);
        if (w == null) throw RuleException.database("Verification not found");
        return new WorkflowVerification((String) w.get("verification_code"), (String) w.get("status"), (String) w.get("created_by"), (String) w.get("executed_by"),
            Boolean.TRUE.equals(w.get("current")), Boolean.TRUE.equals(w.get("evidence")));
    }

    private boolean mayAt(RequestContext ctx, String code, Map<String, Object> w) { return access.load(ctx.userId()).can(code, (String) w.get("site_id")); }

    /** require_permission_at's refusal text. */
    private static String refusal(Db d, String code) {
        Map<String, Object> p = d.one("SELECT lower(description) AS d FROM permission WHERE code = ?", code);
        return "You do not have permission to do this: " + (p == null ? "" : p.get("d")) + " (" + code + "). Ask your lab administrator to add you to a group that has it.";
    }

    /** The verification tables change only with this switch on (their trigger stays: Node's run writes them too). */
    private static void internal(Db d, boolean on) { d.one("SELECT set_verification_internal(?)", on); }
}
