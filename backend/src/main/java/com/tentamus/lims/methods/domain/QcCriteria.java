package com.tentamus.lims.methods.domain;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The limit every QC criterion of the Batching step applies to every analyte of the version: the analyte's own row, else an
 * exception (the layout before WD-1.2), else the criterion's default. Java's own copy of the database's qc_criteria (kept:
 * the bench, QC Review and the Node verification read it).
 */
public final class QcCriteria {
    /** One QC, criterion and analyte. */
    public record Row(String qcType, String qcClass, String limitType, String shape, String analyteId, String analyteName, boolean applies,
                      BigDecimal min, BigDecimal max, String limitRef, String source, int qn, int on, int sortOrder) {
        public Map<String, Object> row() {
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("qc_type", qcType);
            r.put("qc_class", qcClass);
            r.put("limit_type", limitType);
            r.put("shape", shape);
            r.put("analyte_id", analyteId);
            r.put("analyte_name", analyteName);
            r.put("applies", applies);
            r.put("min_value", min);
            r.put("max_value", max);
            r.put("limit_ref", limitRef);
            r.put("source", source);
            return r;
        }
    }

    private static final Set<String> FALSE = Set.of("false", "f", "no", "n", "off", "0");

    private QcCriteria() {}

    public static List<Row> of(List<WorkflowStep> activeSteps, List<VersionAnalyte> analytes, DesignFacts facts) {
        List<Row> out = new ArrayList<>();
        for (WorkflowStep s : activeSteps) {
            if (!s.is("Batching")) continue;
            int qn = 0;
            for (JsonNode q : Values.array(s.config(), "qc")) {
                qn++;
                int on = 0;
                for (JsonNode o : Values.array(q, "criteria")) {
                    on++;
                    String shape = facts.limitShape(Values.text(o, "limit_type"));
                    if (shape == null) continue;
                    for (VersionAnalyte a : analytes) {
                        JsonNode r = find(o, "analytes", a.analyteId()), ov = find(o, "overrides", a.analyteId());
                        JsonNode lim = r != null ? r : ov != null ? ov : o;
                        String ref = Values.text(r != null ? r : o, "limit_ref");
                        out.add(new Row(Values.text(q, "qc_type"), Values.text(q, "qc_class"), Values.text(o, "limit_type"), shape, a.analyteId(),
                            a.analyteName(), r == null || Values.text(r, "applies") == null || !FALSE.contains(Values.text(r, "applies").toLowerCase()),
                            Values.number(lim, "min"), Values.number(lim, "max"), ref == null || ref.isEmpty() ? null : ref,
                            r != null ? "Analyte" : ov != null ? "Exception" : "Default", qn, on, a.sortOrder()));
                    }
                }
            }
        }
        out.sort(Comparator.comparingInt(Row::qn).thenComparingInt(Row::on).thenComparingInt(Row::sortOrder)
            .thenComparing(Row::analyteName, Comparator.nullsLast(Comparator.naturalOrder())));
        return out;
    }

    private static JsonNode find(JsonNode o, String list, String analyteId) {
        for (JsonNode x : Values.array(o, list)) if (analyteId.equals(Values.text(x, "analyte_id"))) return x;
        return null;
    }
}
