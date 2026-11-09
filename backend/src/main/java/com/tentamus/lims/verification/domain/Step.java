package com.tentamus.lims.verification.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/** A workflow step of the version being verified: its type, settings (config), dependencies and equipment types. */
public final class Step {
    public final String id, key, name, type, departmentName;
    public final int sortOrder, nAncestors;
    public final Map<String, Object> config;
    /** The fields the step itself records (a formula token naming another field reads a scanned lot's logbook entry). */
    public final List<String> baseFields;
    public final List<String> deps = new ArrayList<>();
    /** Each {equipment_type_id, type_name, is_main}, the main type first. */
    public final List<Map<String, Object>> equipment = new ArrayList<>();
    public List<String> ancestors = new ArrayList<>();

    public Step(String id, String key, String name, String type, int sortOrder, Map<String, Object> config, String departmentName, int nAncestors, List<String> baseFields) {
        this.id = id; this.key = key; this.name = name; this.type = type; this.sortOrder = sortOrder; this.config = config;
        this.departmentName = departmentName; this.nAncestors = nAncestors; this.baseFields = baseFields;
    }

    public Object cfg(String k) { return config.get(k); }

    /** config[k] as a list ([] when missing). */
    public List<Object> cfgList(String k) { return config.get(k) instanceof List<?> l ? new ArrayList<>(l) : new ArrayList<>(); }

    public boolean is(String t) { return type.equals(t); }

    /** Whether a Data Entry step reads the analyte (no analyte list = every analyte). */
    public boolean reads(String analyteId) {
        List<Object> ids = cfgList("analyte_ids");
        return !(config.get("analyte_ids") instanceof List<?>) || ids.isEmpty() || ids.contains(analyteId);
    }

    public boolean witnessRequired() { return "Required".equals(config.get("witness")); }

    /** config.scope || 'Batch'. */
    public String scope() { return JsValues.or(config.get("scope"), "Batch"); }
}
