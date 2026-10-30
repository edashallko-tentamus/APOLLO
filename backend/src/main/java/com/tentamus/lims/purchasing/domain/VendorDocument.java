package com.tentamus.lims.purchasing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.regex.Pattern;

/**
 * The evidence behind a vendor approval or proposal (a questionnaire, certificate, audit report, quality agreement).
 * Never changed once attached: withdrawn with a reason. Replaces the rule part of vendor_document_rules (migration 065).
 */
public final class VendorDocument {
    public static final List<String> KINDS = List.of("Questionnaire", "Certificate", "Audit report", "Quality agreement", "Other");
    private static final Pattern TYPES = Pattern.compile(
        "^(application/pdf|image/(png|jpeg|gif|webp)|text/plain|application/vnd\\.openxmlformats-officedocument\\.(spreadsheetml\\.sheet|wordprocessingml\\.document))$");

    private VendorDocument() {}

    public static void checkFile(String mimeType, Object kind) {
        if (mimeType == null || !TYPES.matcher(mimeType).matches()) throw new RuleException("Attach a PDF, an image (PNG or JPEG), a text file, or an Excel or Word file");
        if (kind == null || !KINDS.contains(kind))
            throw new RuleException("Say what each document is (questionnaire, certificate, audit report, quality agreement or other)");
    }

    /** A document joins a proposal only while it is still Proposed (proposalStatus null: it belongs to an approval). */
    public static void assertCanAttach(String proposalStatus) {
        if (proposalStatus != null && !"Proposed".equals(proposalStatus)) throw RuleException.database("The proposal is decided: its documents are closed");
    }

    public static void assertWithdrawReason(String reason) {
        if (reason == null || reason.isBlank()) throw RuleException.database("A Reason for Change is required to withdraw a vendor document");
    }
}
