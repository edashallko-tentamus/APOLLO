package com.tentamus.lims.verification.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
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
            d -> { d.one("SELECT approve_verification_protocol(?::uuid)", w.get("id")); return ok(); });
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
        Object j = body.get("justifications") instanceof Map<?, ?> m ? m : Map.of();
        String justifications;
        try { justifications = json.writeValueAsString(j); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
        return signed(ctx.withReason("Verification report signed"), body, "Approved by", "Verification report " + w.get("verification_code") + ": " + label(w),
            d -> map("outcome", d.one("SELECT sign_verification_report(?::uuid, ?, ?::jsonb) AS o", w.get("id"), Js.orBlank(body.get("conclusion")), justifications).get("o")));
    }

    /** Cancel a verification not signed off (signed, with the reason). */
    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> w = verOf(ctx, id);
        if (Js.string(body.get("reason")).trim().isEmpty()) throw new RuleException("Say why the verification is cancelled");
        return signed(ctx, body, "Cancelled by", "Verification " + w.get("verification_code"), d -> { d.one("SELECT cancel_verification(?::uuid)", w.get("id")); return ok(); });
    }
}
