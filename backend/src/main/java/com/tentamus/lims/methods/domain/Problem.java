package com.tentamus.lims.methods.domain;

import java.util.LinkedHashMap;
import java.util.Map;

/** One thing the designer's review lists: an Error stops approval, a Warning is to look at. stepKey is null for the test. */
public record Problem(String severity, String stepKey, String problem) {
    public static Problem error(String stepKey, String text) { return new Problem("Error", stepKey, text); }

    public static Problem warning(String stepKey, String text) { return new Problem("Warning", stepKey, text); }

    public boolean error() { return "Error".equals(severity); }

    /** As the screens read it (the database function's columns). */
    public Map<String, Object> row() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("severity", severity);
        r.put("step_key", stepKey);
        r.put("problem", problem);
        return r;
    }
}
