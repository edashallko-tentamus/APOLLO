package com.tentamus.lims.verification.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.verification.domain.WorkflowVerification;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Workflow verification: a version's verifications and the gate, QA's approval of the protocol, a screenshot of the
 * evidence, QA's signature on the report, cancelling. Writing the protocol, the automated run, capturing the evidence,
 * the whole document (it reports the capture in progress) and the Word file stay in the Node backend for now.
 */
@Service
public class VerificationService {
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final ObjectMapper json;

    public VerificationService(Db db, AccessPolicy access, SignatureService signatures, ObjectMapper json) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.json = json;
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
