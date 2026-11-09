package com.tentamus.lims.custody.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.Test;

/** The sample photo rules moved out of the database in migration 063 (they were checked by test_044). */
class SamplePhotoRulesTest {
    private static final Instant NOW = Instant.parse("2026-10-20T17:00:00Z");

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    @Test
    void aNewPhoto() {
        assertNull(refusal(() -> SamplePhoto.taken(1200, 900, "image/jpeg", 1, null, NOW)));
        assertNull(refusal(() -> SamplePhoto.taken(1600, 1200, "image/png", null, NOW, NOW)));
        assertTrue(refusal(() -> SamplePhoto.taken(1000, 400, "image/jpeg", null, null, NOW)).contains("sample_photo_4_3"));
        assertTrue(refusal(() -> SamplePhoto.taken(200, 150, "image/jpeg", null, null, NOW)).contains("px_check"));
        assertEquals("A sample photo is a JPEG or PNG image", refusal(() -> SamplePhoto.taken(1200, 900, "application/pdf", null, null, NOW)));
        assertEquals("A photo cannot be taken in the future", refusal(() -> SamplePhoto.taken(1200, 900, "image/png", null, NOW.plus(10, ChronoUnit.MINUTES), NOW)));
        assertTrue(SamplePhoto.isFourThree(1203, 900));   // within 3 %
    }

    @Test
    void retiringAPhoto() {
        SamplePhoto p = new SamplePhoto(1600, 1200, "image/jpeg", 2, "Active");
        SamplePhoto retired = p.changed(2, "Inactive");
        assertNull(retired.slot());   // a retired photo leaves the report
        assertEquals("A retired photo stays retired", refusal(() -> retired.changed(null, "Active")));
        assertEquals(Integer.valueOf(1), p.changed(1, "Active").slot());
    }
}
