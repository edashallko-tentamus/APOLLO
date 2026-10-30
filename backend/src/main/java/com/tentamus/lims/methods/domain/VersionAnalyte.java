package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * An analyte of a test version: its result type, reporting unit, LOQ and LOD, rounding, hide flags, the lab's suggested
 * limit, the qualitative result values (and which mean "found" or are not results) and the measurement uncertainty.
 * Replaces the database triggers tva_rules and tva_values, the value tidy and the "Report ±" rule of
 * tva_invalid_values_rules and tva_uncertainty_rules, and the analyte checks (migration 066). Copying the uncertainty and
 * the values that are not results into a new version stays in the database for the data loads' new versions.
 */
public record VersionAnalyte(String id, String versionId, String analyteId, String analyteName, String analyteClass, int sortOrder,
                             String resultType, String reportingUnit, BigDecimal loq, BigDecimal lod, String roundingMode, Integer roundingDigits,
                             List<String> resultValues, List<String> foundValues, List<String> invalidValues, String status) {

    /** The Units list as the reporting unit needs it: any active unit, matched ignoring capitals. */
    public record Units(Map<String, String> byLowerCode, String dimensions) {
        public String canonical(Object code, String what) {
            String c = Values.trimmed(code);
            if (c == null) return null;
            String u = byLowerCode.get(c.toLowerCase());
            if (u == null) throw RuleException.database(what + " \"" + code + "\" is not on the Units list (Admin > Units) as a " + dimensions + " unit");
            return u;
        }
    }

    public static VersionAnalyte of(Map<String, Object> row) {
        if (row == null) return null;
        Integer so = Values.integer(row.get("sort_order"));
        return new VersionAnalyte(Values.str(row.get("id")), Values.str(row.get("test_version_id")), Values.str(row.get("analyte_id")),
            Values.str(row.get("analyte_name")), Values.str(row.get("analyte_class")), so == null ? 0 : so, Values.str(row.get("result_type")),
            Values.str(row.get("reporting_unit")), Values.num(row.get("loq")), Values.num(row.get("lod")), Values.str(row.get("rounding_mode")),
            Values.integer(row.get("rounding_digits")), Values.list(row.get("result_values")), Values.list(row.get("found_values")),
            Values.list(row.get("invalid_values")), Values.str(row.get("status")));
    }

    public boolean active() { return "Active".equals(status); }

    public boolean qualitative() { return "Qualitative".equals(resultType); }

    /**
     * Checks an analyte row about to be saved and returns the values to write.
     *
     * @param before        the stored row (with its columns), or null for a new one
     * @param changes       the columns being written
     * @param analyteActive for a new row: whether the analyte it names is active
     */
    public static Map<String, Object> checked(Map<String, Object> before, Map<String, Object> changes, boolean analyteActive, Units units) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        if (before != null && changes.containsKey("analyte_id") && !Objects.equals(Values.str(changes.get("analyte_id")), Values.str(before.get("analyte_id"))))
            throw RuleException.database("Remove the analyte (Inactive) and add the other one instead");
        if (before == null && !analyteActive) throw RuleException.database("That analyte is retired; pick an active one");
        if (changes.containsKey("reporting_unit")) out.put("reporting_unit", units.canonical(changes.get("reporting_unit"), "Reporting unit"));
        Map<String, Object> after = new LinkedHashMap<>(before == null ? Map.of() : before);
        after.putAll(out);
        String type = Values.str(after.get("result_type"));
        if ("Qualitative".equals(type) || "Text".equals(type)) {
            for (String k : List.of("loq", "lod", "rounding_mode", "rounding_digits")) {
                if (after.get(k) != null || out.containsKey(k)) out.put(k, null);
                after.put(k, null);
            }
        }
        if (changes.containsKey("default_spec_text")) after.put("default_spec_text", put(out, "default_spec_text", Values.trimmed(changes.get("default_spec_text"))));
        for (String k : List.of("result_values", "found_values", "invalid_values"))
            if (changes.containsKey(k)) after.put(k, put(out, k, Values.tidy(Values.list(changes.get(k)))));
        BigDecimal unc = Values.num(after.get("uncertainty"));
        if (unc != null && after.get("uncertainty_kind") == null && (changes.containsKey("uncertainty") || changes.containsKey("uncertainty_kind")))
            after.put("uncertainty_kind", put(out, "uncertainty_kind", "Unit"));
        if (Values.bool(after.get("report_uncertainty")) && unc == null && (changes.containsKey("uncertainty") || changes.containsKey("report_uncertainty") || changes.containsKey("uncertainty_kind")))
            throw RuleException.database("Enter the uncertainty before switching \"Report ±\" on");
        BigDecimal loq = Values.num(after.get("loq")), lod = Values.num(after.get("lod"));
        if (loq != null && loq.signum() < 0) throw RuleException.withCode("The LOQ cannot be negative.", "23514");
        if (lod != null && lod.signum() < 0) throw RuleException.withCode("The LOD cannot be negative.", "23514");
        if (loq != null && lod != null && lod.compareTo(loq) > 0) throw RuleException.withCode("The LOD cannot be above the LOQ.", "23514");
        String mode = Values.str(after.get("rounding_mode"));
        Integer digits = Values.integer(after.get("rounding_digits"));
        if ((mode == null) != (digits == null))
            throw RuleException.withCode("Choose both the rounding (significant figures or decimal places) and the number of digits, or neither.", "23514");
        TestVersion.checkRounding(mode, digits, false);
        BigDecimal min = Values.num(after.get("default_spec_min")), max = Values.num(after.get("default_spec_max"));
        if (min != null && max != null && min.compareTo(max) > 0) throw RuleException.withCode("The suggested minimum cannot be above the maximum.", "23514");
        if (unc != null && unc.signum() < 0) throw RuleException.withCode("The uncertainty cannot be negative.", "23514");
        return out;
    }

    private static <T> T put(Map<String, Object> out, String k, T v) {
        out.put(k, v);
        return v;
    }

    /** The row a copy of this analyte makes in another version (uncertainty and every list carried). */
    public static Map<String, Object> copyRow(Map<String, Object> source, String toVersion) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("test_version_id", toVersion);
        for (String k : List.of("analyte_id", "sort_order", "result_type", "reporting_unit", "loq", "lod", "rounding_mode", "rounding_digits", "hide_on_report",
            "hide_loq", "hide_lod", "default_spec_min", "default_spec_max", "default_spec_text", "result_values", "found_values", "invalid_values",
            "uncertainty", "uncertainty_kind", "report_uncertainty")) r.put(k, source.get(k));
        return r;
    }
}
