package com.tentamus.lims.verification.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * A workflow verification's sign-offs: QA approves the protocol (not its author, only for the current design), QA signs
 * the report (not the executor, after the evidence, with a conclusion and a justification for each requirement not
 * tested), and a verification not signed off may be cancelled with a reason. Replaces approve_verification_protocol,
 * sign_verification_report and cancel_verification (migration 071); writing the protocol and the run stay in Node.
 */
public final class WorkflowVerification {
    private final String code, status, createdBy, executedBy;
    private final boolean current, evidenceCaptured;

    /**
     * @param current          its fingerprint is still the version's design
     * @param evidenceCaptured the screenshots of the run are recorded
     */
    public WorkflowVerification(String code, String status, String createdBy, String executedBy, boolean current, boolean evidenceCaptured) {
        this.code = code; this.status = status; this.createdBy = createdBy; this.executedBy = executedBy; this.current = current; this.evidenceCaptured = evidenceCaptured;
    }

    /** QA approves the protocol (methods.verify checked by the caller, refusal text given). */
    public void approveProtocol(String user, boolean mayVerify, String refusal) {
        if (!mayVerify) throw RuleException.database(refusal);
        if (!"Protocol draft".equals(status)) throw RuleException.database(code + " is " + status + ", not a protocol waiting for approval");
        if (Objects.equals(createdBy, user)) throw RuleException.database("You wrote this protocol, so someone else (QA) must approve it");
        if (!current) throw RuleException.database("The version changed after " + code + " was written: write a new verification protocol");
    }

    /**
     * QA signs the report; returns the justification to store per requirement code.
     *
     * @param notTested the codes of the requirements Not tested, in order
     */
    public Map<String, String> signReport(String user, boolean mayVerify, String refusal, String conclusion, Map<?, ?> justifications, List<String> notTested) {
        if (!mayVerify) throw RuleException.database(refusal);
        if (!"Executed".equals(status)) throw RuleException.database(code + " is " + status + ": the report is signed after the run");
        if (Objects.equals(executedBy, user)) throw RuleException.database("You executed this verification, so someone else (QA) must sign its report");
        if (conclusion == null || conclusion.strip().isEmpty()) throw RuleException.database("Write the report's conclusion");
        if (!evidenceCaptured) throw RuleException.database("Capture the evidence (screenshots of the run's pages) before the report is signed");
        Map<String, String> out = new LinkedHashMap<>();
        for (String req : notTested) {
            Object j = justifications == null ? null : justifications.get(req);
            String t = j == null ? "" : j.toString().strip();
            if (t.isEmpty()) throw RuleException.database(req + " was not tested: write why that is acceptable");
            out.put(req, t);
        }
        return out;
    }

    /** Cancel (methods.design or methods.verify checked by the caller), with the reason. */
    public void cancel(boolean mayCancel, String refusal, String reason) {
        if (!mayCancel) throw RuleException.database(refusal);
        if (List.of("Report signed", "Cancelled", "Running").contains(status)) throw RuleException.database(code + " is " + status + " and cannot be cancelled");
        if (reason == null || reason.strip().isEmpty()) throw RuleException.database("Say why the verification is cancelled");
    }
}
