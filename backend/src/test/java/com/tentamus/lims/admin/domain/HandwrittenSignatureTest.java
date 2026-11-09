package com.tentamus.lims.admin.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import org.junit.jupiter.api.Test;

/** The handwritten signature rules moved out of the database in migration 071 (they were checked by test_021a). */
class HandwrittenSignatureTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    @Test
    void recordingASignature() {
        assertTrue(refusal(() -> HandwrittenSignature.check("RF PM", false, "image/png", 10, "PM")).contains("lab administrator"));
        assertTrue(refusal(() -> HandwrittenSignature.check("RF PM", true, "image/png", 10, " ")).contains("title"));
        assertTrue(refusal(() -> HandwrittenSignature.check("RF PM", true, "application/pdf", 10, "PM")).contains("PNG or JPEG"));
        assertTrue(refusal(() -> HandwrittenSignature.check("RF PM", true, "image/jpeg", 2_000_000, "PM")).contains("larger than 1 MB"));
        assertEquals("Person not found", refusal(() -> HandwrittenSignature.check(null, true, null, 0, "PM")));
        assertEquals("Project Manager", HandwrittenSignature.check("RF PM", true, null, 0, " Project Manager "));   // the title alone
    }
}
