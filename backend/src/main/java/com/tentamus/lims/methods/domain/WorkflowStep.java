package com.tentamus.lims.methods.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A step of a test version's workflow (11 types), with its settings per type. Replaces the database triggers
 * workflow_step_rules, workflow_step_replicates_rule and workflow_step_equipment_rules and the step checks (migration 066).
 */
public record WorkflowStep(String id, String versionId, String key, String name, String type, int sortOrder, String departmentId,
                           JsonNode config, String status) {
    private static final Pattern KEY = Pattern.compile("^[a-z][a-z0-9_]{0,29}$");
    private static final Pattern WHOLE = Pattern.compile("^[0-9]+$");
    /** Step types that take a scanned lot, so a logbook's published values reach their formulas. */
    private static final Set<String> MATERIAL_TYPES = Set.of("Weighing", "Preparation", "Dilution", "Data Entry", "Plating/Inoculation", "Incubation");

    public static WorkflowStep of(Map<String, Object> row) {
        if (row == null) return null;
        Integer so = Values.integer(row.get("sort_order"));
        Object cfg = row.get("config");
        return new WorkflowStep(Values.str(row.get("id")), Values.str(row.get("test_version_id")), Values.str(row.get("step_key")),
            Values.str(row.get("step_name")), Values.str(row.get("step_type")), so == null ? 0 : so, Values.str(row.get("department_id")),
            cfg instanceof JsonNode n ? n : null, Values.str(row.get("status")));
    }

    public boolean active() { return "Active".equals(status); }

    public boolean is(String t) { return t.equals(type); }

    /**
     * Checks a step about to be saved (its version must be a Draft, checked by the version).
     *
     * @param departmentSite the lab of the department it names, when it names one
     * @param testSite       the test's lab
     */
    public static void check(WorkflowStep before, String versionId, String key, String name, String type, JsonNode config, String departmentId,
                             String departmentSite, String testSite) {
        if (before != null && !Objects.equals(before.versionId, versionId)) throw RuleException.database("A step cannot move to another version");
        if (key == null || !KEY.matcher(key).matches())
            throw RuleException.withCode("The step key is a short lower-case word (letters, numbers, _), used in formulas like {weigh.weight}.", "23514");
        if (Values.trimmed(name) == null) throw RuleException.withCode("Name the step.", "23514");
        if (config == null || !config.isObject()) throw RuleException.withCode("A step's settings are a set of named values.", "23514");
        if (departmentId != null && !Objects.equals(departmentSite, testSite))
            throw RuleException.database("The step's department must be one of the test's own lab's departments");
        if ("Weighing".equals(type) && config.has("replicates")) {
            String r = Values.text(config, "replicates");
            if (r != null && !r.isEmpty() && (!WHOLE.matcher(r).matches() || r.length() > 3 || Integer.parseInt(r) < 1 || Integer.parseInt(r) > 10))
                throw RuleException.database("Replicate weighings: a whole number from 1 to 10");
        }
    }

    /** An equipment type on a step must be one of the test's own lab's types. */
    public static void checkEquipmentType(String typeSite, String testSite) {
        if (!Objects.equals(typeSite, testSite)) throw RuleException.database("The equipment type must be one of the test's own lab's equipment types");
    }

    /** A Preparation field's label as a formula key: "Digest final volume (mL)" becomes digest_final_volume_ml. */
    public static String fieldKey(String label) {
        String s = (label == null ? "" : label).toLowerCase().replaceAll("[^a-z0-9]+", "_");
        return s.replaceAll("^_+|_+$", "");
    }

    /** What the step offers to formulas ({step.field}): its own values, then the values logbooks publish for scanned lots. */
    public List<String> tokenFields(List<String> publishedKeys) {
        List<String> base = baseTokenFields();
        List<String> out = new ArrayList<>(base);
        if (MATERIAL_TYPES.contains(type)) for (String k : publishedKeys) if (!base.contains(k)) out.add(k);
        return out;
    }

    List<String> baseTokenFields() {
        return switch (type == null ? "" : type) {
            case "Weighing" -> List.of("weight");
            case "Dilution" -> List.of("factor", "final_volume");
            case "Incubation" -> List.of("duration");
            case "Data Entry" -> List.of("reading");
            case "Calculation", "Hold Point" -> List.of("result");
            case "Preparation" -> {
                List<String> keys = new ArrayList<>();
                for (JsonNode f : Values.array(config, "fields"))
                    if ("Number".equals(Values.text(f, "type")) && !Values.textOr(f, "label").isEmpty()) keys.add(fieldKey(Values.text(f, "label")));
                yield keys;
            }
            default -> List.of();
        };
    }

    /** The step a copy makes in another version (the department mapped by the caller). */
    public Map<String, Object> copyRow(String toVersion, String department, String instructions) {
        Map<String, Object> r = new java.util.LinkedHashMap<>();
        r.put("test_version_id", toVersion);
        r.put("step_key", key);
        r.put("step_name", name);
        r.put("step_type", type);
        r.put("sort_order", sortOrder);
        r.put("department_id", department);
        r.put("instructions", instructions);
        r.put("config", config == null ? "{}" : config.toString());
        return r;
    }
}
