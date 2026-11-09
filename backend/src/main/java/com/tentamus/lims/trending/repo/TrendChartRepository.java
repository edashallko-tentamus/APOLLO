package com.tentamus.lims.trending.repo;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.trending.domain.TrendChart;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Loads and saves trend charts and signal reviews as domain objects (the rules are in {@link TrendChart}). */
@Repository
public class TrendChartRepository {
    private final ObjectMapper json;

    public TrendChartRepository(ObjectMapper json) { this.json = json; }

    /** The chart for a change, locked for the transaction; null when there is none. */
    public TrendChart load(Db d, Object id) {
        Map<String, Object> r = d.one("SELECT *, status::text AS status_text FROM trend_chart WHERE id = ?::uuid FOR UPDATE", id);
        if (r == null) return null;
        TrendChart c = new TrendChart();
        c.id = (String) r.get("id"); c.code = (String) r.get("chart_code"); c.siteId = (String) r.get("site_id"); c.name = (String) r.get("chart_name");
        c.description = (String) r.get("description"); c.source = (String) r.get("source"); c.params = node(r.get("params")); c.status = (String) r.get("status_text");
        c.rules = rulesOf(r.get("rules")); c.watch = Boolean.TRUE.equals(r.get("watch")); c.showInReview = Boolean.TRUE.equals(r.get("show_in_review"));
        c.qaReview = Boolean.TRUE.equals(r.get("qa_review")); c.qaStatus = (String) r.get("qa_status"); c.qaApprovedBy = (String) r.get("qa_approved_by");
        c.qaSignatureId = (String) r.get("qa_signature_id"); c.appliedVersionId = (String) r.get("applied_version_id"); c.appliedBy = (String) r.get("applied_by");
        c.frozenCl = dbl(r.get("frozen_cl")); c.frozenSigma = dbl(r.get("frozen_sigma")); c.frozenN = r.get("frozen_n") == null ? null : ((Number) r.get("frozen_n")).intValue();
        c.frozenFrom = str(r.get("frozen_from")); c.frozenTo = str(r.get("frozen_to")); c.frozenBy = (String) r.get("frozen_by");
        c.createdBy = (String) r.get("created_by"); c.modifiedBy = (String) r.get("modified_by");
        return c;
    }

    /** A new chart; returns its id and code. */
    public Map<String, Object> insert(Db d, TrendChart c) {
        return d.one("""
            INSERT INTO trend_chart (site_id, chart_name, description, source, params, rules, watch, show_in_review, qa_review, qa_status)
            VALUES (?::uuid, ?, ?, ?, ?::jsonb, ?::text[], ?::boolean, ?::boolean, ?::boolean, ?) RETURNING id, chart_code""",
            c.siteId, c.name, c.description, c.source, text(c.params), rulesText(c.rules), c.watch, c.showInReview, c.qaReview, c.qaStatus);
    }

    /** Writes every column a person or a rule changes (who froze and approved are stamped when the chart says so). */
    public void update(Db d, TrendChart c) {
        d.update("""
            UPDATE trend_chart SET chart_name = ?, description = ?, source = ?, params = ?::jsonb, rules = ?::text[], watch = ?::boolean, show_in_review = ?::boolean,
                   qa_review = ?::boolean, qa_status = ?, status = ?::record_status,
                   frozen_cl = ?::numeric, frozen_sigma = ?::numeric, frozen_from = ?::date, frozen_to = ?::date, frozen_n = ?::int, frozen_by = ?::uuid,
                   frozen_at = CASE WHEN ?::boolean THEN clock_timestamp() WHEN ?::numeric IS NULL THEN NULL ELSE frozen_at END,
                   qa_approved_by = ?::uuid, qa_signature_id = CASE WHEN ?::boolean THEN NULLIF(current_setting('lims.signature_id', true), '')::uuid ELSE ?::uuid END,
                   qa_approved_at = CASE WHEN ?::boolean THEN clock_timestamp() WHEN ?::uuid IS NULL THEN NULL ELSE qa_approved_at END,
                   applied_version_id = ?::uuid, applied_by = ?::uuid, applied_at = CASE WHEN ?::boolean THEN clock_timestamp() ELSE applied_at END
             WHERE id = ?::uuid""",
            c.name, c.description, c.source, text(c.params), rulesText(c.rules), c.watch, c.showInReview, c.qaReview, c.qaStatus, c.status,
            c.frozenCl, c.frozenSigma, c.frozenFrom, c.frozenTo, c.frozenN, c.frozenBy, c.frozenNow(), c.frozenCl,
            c.qaApprovedBy, c.approvedNow(), c.qaSignatureId, c.approvedNow(), c.qaApprovedBy,
            c.appliedVersionId, c.appliedBy, c.appliedNow(), c.id);
    }

    /** A signal's review: the earlier active one is set Inactive. */
    public Map<String, Object> review(Db d, String chartId, String key, String label, String rule, String outcome, String comment) {
        d.update("UPDATE trend_signal_review SET status = 'Inactive' WHERE chart_id = ?::uuid AND point_key = ? AND rule = ? AND status = 'Active'", chartId, key, rule);
        return d.one("INSERT INTO trend_signal_review (chart_id, point_key, point_label, rule, outcome, comment) VALUES (?::uuid, ?, ?, ?, ?, ?) RETURNING id",
            chartId, key, label, rule, outcome, comment);
    }

    /** Whether the version is a Draft of the test the chart's limits are for. */
    public boolean draftOfTest(Db d, Object versionId, Object testId) {
        return versionId != null && d.one("SELECT 1 AS x FROM test_version WHERE id = ?::uuid AND test_id = ?::uuid AND status = 'Draft'", versionId, testId) != null;
    }

    public JsonNode node(Object v) {
        try {
            return v instanceof JsonNode n ? n : json.readTree(v == null ? "{}" : v instanceof String s ? s : json.writeValueAsString(v));
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }

    private String text(Object v) { return node(v).toString(); }

    private static String rulesText(List<String> rules) { return "{" + String.join(",", rules) + "}"; }

    @SuppressWarnings("unchecked")
    private static List<String> rulesOf(Object v) {
        if (v instanceof List<?> l) return (List<String>) l;
        if (v == null) return TrendChart.RULES;
        String s = v.toString().replaceAll("[{}]", "");
        return s.isEmpty() ? List.of() : Arrays.asList(s.split(","));
    }

    private static Double dbl(Object v) { return v == null ? null : ((Number) v).doubleValue(); }

    private static String str(Object v) { return v == null ? null : v.toString(); }
}
