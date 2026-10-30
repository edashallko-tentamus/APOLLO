package com.tentamus.lims.labsetup.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The lab setup rules moved out of the database in migration 071 (they were checked by test_025). */
class LabSetupRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> tpl(Object... kv) {
        Map<String, Object> m = new HashMap<>(Map.of("template_name", "Short COA", "status", "Active"));
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    @Test
    void reportTemplates() {
        assertNull(refusal(() -> ReportTemplate.check(null, tpl("options", Map.of("show_loq", false, "title", "COA")))));
        assertEquals("Unknown template option \"colour\"", refusal(() -> ReportTemplate.check(null, tpl("options", Map.of("colour", "red")))));
        assertEquals("Template options must be a set of named settings", refusal(() -> ReportTemplate.check(null, tpl("options", java.util.List.of(1)))));
        assertTrue(refusal(() -> ReportTemplate.check(null, tpl("template_name", " "))).contains("template_name_check"));
        assertEquals("The default template cannot be retired: make another one the default first",
            refusal(() -> ReportTemplate.check(tpl(), tpl("status", "Inactive", "is_default", true))));
        assertEquals("A template stays with its lab", refusal(() -> ReportTemplate.check(tpl("site_id", "CFL"), tpl("site_id", "TPS"))));
    }

    @Test
    void labImagesAndSettings() {
        assertNull(refusal(() -> LabImage.checkUpload("image/svg+xml", 1000)));
        assertEquals("Upload a PNG, JPEG or SVG image", refusal(() -> LabImage.checkUpload("application/pdf", 1000)));
        assertEquals("The image is larger than 2 MB", refusal(() -> LabImage.checkUpload("image/png", 3L * 1024 * 1024)));
        assertTrue(refusal(() -> LabImage.checkSetting(" ")).contains("setting_value_check"));
    }
}
