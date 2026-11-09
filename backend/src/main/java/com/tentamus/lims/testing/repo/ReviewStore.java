package com.tentamus.lims.testing.repo;

import com.tentamus.lims.core.calc.Formula;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.masterdata.domain.UnitGraph;
import com.tentamus.lims.masterdata.repo.MasterDataRepository;
import com.tentamus.lims.testing.domain.calc.AnalyteReporting;
import com.tentamus.lims.testing.domain.calc.QcVerdict;
import com.tentamus.lims.testing.domain.calc.Rounding;
import com.tentamus.lims.testing.domain.calc.Serving;
import com.tentamus.lims.testing.domain.calc.Specification;
import com.tentamus.lims.testing.domain.calc.UnitConverter;
import com.tentamus.lims.testing.domain.review.ReviewBatch;
import com.tentamus.lims.testing.domain.review.ReviewItem;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Repository;

/**
 * Loads a batch in QC Review as a {@link ReviewBatch} and writes what the review decides (choices, acceptances, step
 * approvals, stored results, returns and cancellations). The readings, candidates and base QC measurements are read
 * from the database's read functions (batch_results, batch_review_items, batch_qc_verdicts_022), which stay there for
 * Node; every decision on them is Java's.
 */
@Repository
public class ReviewStore {
    private final MasterDataRepository master;
    private final ObjectMapper json;

    public ReviewStore(MasterDataRepository master, ObjectMapper json) {
        this.master = master;
        this.json = json;
    }

    /** The batch's id, code, lab and status (null when there is none). */
    public Map<String, Object> head(Db d, String batchId) {
        return d.one("SELECT id, batch_code, site_id, status::text AS status, is_verification, test_version_id FROM test_batch WHERE id = ?::uuid", batchId);
    }

    public ReviewBatch load(Db d, String batchId) {
        Map<String, Object> b = head(d, batchId);
        if (b == null) return null;
        Object version = b.get("test_version_id");
        List<ReviewBatch.Step> steps = new ArrayList<>();
        for (Map<String, Object> r : d.rows("""
            SELECT ws.id, ws.step_key, ws.step_name, ws.step_type::text AS step_type, ws.sort_order, ws.status::text = 'Active' AS active,
                   COALESCE(ws.config->>'scope', 'Batch') = 'Timepoint' AS tp, ARRAY(SELECT a.step_id::text FROM step_ancestors(ws.id) a) AS anc
              FROM workflow_step ws WHERE ws.test_version_id = ?::uuid""", version))
            steps.add(new ReviewBatch.Step(s(r, "id"), s(r, "step_key"), s(r, "step_name"), s(r, "step_type"), i(r, "sort_order"), Boolean.TRUE.equals(r.get("active")),
                Boolean.TRUE.equals(r.get("tp")), new HashSet<>(strings(r.get("anc")))));
        List<ReviewBatch.Run> runs = d.rows("SELECT id, step_id, status::text AS status, performed_by, witness_id FROM step_run WHERE batch_id = ?::uuid", batchId).stream()
            .map(r -> new ReviewBatch.Run(s(r, "id"), s(r, "step_id"), s(r, "status"), s(r, "performed_by"), s(r, "witness_id"))).toList();
        Set<String> marked = new HashSet<>();
        for (Map<String, Object> r : d.rows("SELECT step_run_id FROM review_step_mark WHERE batch_id = ?::uuid AND status = 'Active'", batchId)) marked.add(s(r, "step_run_id"));
        List<ReviewBatch.Load> loads = d.rows("""
            SELECT l.id, r.step_id, l.equipment_code, ws.step_name, l.check_text, a.check_text AS accepted
              FROM incubation_load_view l JOIN step_run r ON r.id = l.step_run_id JOIN workflow_step ws ON ws.id = r.step_id
              LEFT JOIN load_acceptance a ON a.load_id = l.id AND a.status = 'Active'
             WHERE l.batch_id = ?::uuid AND l.status = 'Active' ORDER BY l.time_in""", batchId).stream()
            .map(r -> new ReviewBatch.Load(s(r, "id"), s(r, "step_id"), s(r, "equipment_code"), s(r, "step_name"), s(r, "check_text"), s(r, "accepted"))).toList();
        List<ReviewBatch.InvalidReading> invalid = d.rows("SELECT * FROM batch_invalid_readings(?::uuid)", batchId).stream()
            .map(r -> new ReviewBatch.InvalidReading(s(r, "entry_id"), s(r, "entry_type"), s(r, "sample_label"), s(r, "analyte_id"), s(r, "analyte_name"), i(r, "run_no"),
                s(r, "value_text"))).toList();
        List<ReviewBatch.Acceptance> accepted = d.rows("SELECT entry_id, analyte_id, limit_type, analytical_run FROM qc_acceptance WHERE batch_id = ?::uuid AND status = 'Active'",
            batchId).stream().map(r -> new ReviewBatch.Acceptance(s(r, "entry_id"), s(r, "analyte_id"), s(r, "limit_type"), i(r, "analytical_run"))).toList();
        Map<String, String> qcClass = new HashMap<>();
        for (Map<String, Object> r : d.rows("SELECT id, qc_class FROM batch_entry WHERE batch_id = ?::uuid", batchId)) qcClass.put(s(r, "id"), s(r, "qc_class"));

        // the live results: per reading, for the final result ("") and each Calculation step's key
        List<Map<String, Object>> results = d.rows("SELECT entry_id, analyte_id, run_no, step_key, is_final, value, value_text, waiting, inputs FROM batch_results(?::uuid)", batchId);
        Map<String, BigDecimal> values = new HashMap<>();
        for (Map<String, Object> r : results) {
            BigDecimal v = dec(r.get("value"));
            values.put(s(r, "entry_id") + "|" + s(r, "analyte_id") + "|" + i(r, "run_no") + "|" + s(r, "step_key"), v);
            if (Boolean.TRUE.equals(r.get("is_final"))) values.put(s(r, "entry_id") + "|" + s(r, "analyte_id") + "|" + i(r, "run_no") + "|", v);
        }

        ReviewBatch shape = new ReviewBatch(s(b, "id"), s(b, "batch_code"), s(b, "site_id"), s(b, "status"), Boolean.TRUE.equals(b.get("is_verification")), steps, runs,
            marked, loads, List.of(), accepted, qcClass, invalid, Map.of());
        String finalKey = shape.finalKey();

        // QC checks: the database's measurements, then Java's rules for readings that are not results and controls counted 0
        Set<String> zero = new HashSet<>();
        for (Map<String, Object> r : results)
            if (finalKey != null && finalKey.equals(r.get("step_key")) && QcVerdict.undefinedAtZero(s(r, "waiting"), inputs(r.get("inputs"))))
                zero.add(s(r, "entry_id") + "|" + s(r, "analyte_id"));
        List<QcVerdict> verdicts = new ArrayList<>();
        for (Map<String, Object> r : d.rows("SELECT * FROM batch_qc_verdicts_022(?::uuid)", batchId)) {
            QcVerdict v = new QcVerdict(r);
            invalid.stream().filter(x -> x.entryId().equals(v.entryId()) && x.analyteId().equals(v.analyteId()) && v.runNo() != null && x.runNo() == v.runNo())
                .findFirst().ifPresentOrElse(x -> v.invalidate(x.valueText()), () -> { if (v.waitingForCount() && zero.contains(v.entryId() + "|" + v.analyteId())) v.judgeOnZeroCount(); });
            verdicts.add(v);
        }

        // the results to report: the final one and each timepoint's
        Map<String, Map<String, Object>> analytes = new HashMap<>();
        for (Map<String, Object> r : d.rows("""
            SELECT tva.analyte_id, tva.loq, tva.lod, COALESCE(tva.rounding_mode, v.rounding_mode)::text AS mode, COALESCE(tva.rounding_digits, v.rounding_digits) AS digits,
                   v.nd_below_lod, tva.result_type::text AS result_type, tva.reporting_unit, tva.found_values
              FROM test_version_analyte tva JOIN test_version v ON v.id = tva.test_version_id WHERE tva.test_version_id = ?::uuid AND tva.status = 'Active'""", version))
            analytes.put(s(r, "analyte_id"), r);
        Map<String, ReviewItem.Choice> choices = new HashMap<>();
        for (Map<String, Object> r : d.rows("SELECT requested_test_id, analyte_id, result_key, mode, entry_id, run_no, justification, readings FROM result_choice WHERE batch_id = ?::uuid AND status = 'Active'", batchId))
            choices.put(s(r, "requested_test_id") + "|" + s(r, "analyte_id") + "|" + (r.get("result_key") == null ? "" : s(r, "result_key")),
                new ReviewItem.Choice(s(r, "mode"), s(r, "entry_id"), i(r, "run_no"), s(r, "justification"), readings(r.get("readings"))));
        List<Map<String, Object>> picks = d.rows("""
            SELECT ap.requested_test_id, ap.analyte_id, ap.entry_id, ap.run_no, ap.note, u.full_name FROM analyst_pick ap JOIN app_user u ON u.id = ap.created_by
             WHERE ap.batch_id = ?::uuid AND ap.status = 'Active'""", batchId);
        Map<String, List<ReviewItem>> items = new LinkedHashMap<>();
        Comparer comparer = new Comparer(d);
        List<String> keys = new ArrayList<>();
        keys.add(null);
        for (ReviewBatch.Timepoint t : shape.timepoints()) for (String k : t.keys()) if (!keys.contains(k)) keys.add(k);
        for (String key : keys) {
            List<ReviewItem> list = new ArrayList<>();
            for (Map<String, Object> r : d.rows("SELECT requested_test_id, analyte_id, analyte_name, sample_label, candidates, unit FROM batch_review_items(?::uuid, ?)", batchId, key)) {
                Map<String, Object> a = analytes.getOrDefault(s(r, "analyte_id"), Map.of());
                List<ReviewItem.Candidate> cands = new ArrayList<>();
                if (r.get("candidates") instanceof JsonNode cn) for (JsonNode c : cn) {
                    String e = c.path("entry_id").asText();
                    int rn = c.path("run_no").asInt();
                    BigDecimal v = values.get(e + "|" + s(r, "analyte_id") + "|" + rn + "|" + (key == null ? "" : key));
                    if (v == null && c.hasNonNull("value")) v = c.get("value").decimalValue();
                    cands.add(new ReviewItem.Candidate(e, rn, c.path("run").asInt(1), v, c.hasNonNull("value_text") ? c.get("value_text").asText() : null));
                }
                Rounding rounding = new Rounding(s(a, "mode"), a.get("digits") == null ? 3 : i(a, "digits"));
                ReviewItem item = new ReviewItem(s(r, "requested_test_id"), s(r, "analyte_id"), s(r, "analyte_name"), s(r, "sample_label"), s(r, "unit"), key, r.get("candidates"),
                    cands, new AnalyteReporting(dec(a.get("loq")), dec(a.get("lod")), Boolean.TRUE.equals(a.get("nd_below_lod")), rounding), "Numeric".equals(a.get("result_type")));
                ReviewItem.Choice reviewer = choices.get(s(r, "requested_test_id") + "|" + s(r, "analyte_id") + "|" + (key == null ? "" : key));
                Map<String, Object> pick = picks.stream().filter(p -> s(p, "requested_test_id").equals(s(r, "requested_test_id"))
                        && (s(r, "analyte_id").equals(s(p, "analyte_id")) || p.get("analyte_id") == null))
                    .min((x, y) -> Boolean.compare(x.get("analyte_id") == null, y.get("analyte_id") == null)).orElse(null);
                item.decide(reviewer, pick == null ? null : new ReviewItem.Choice("Pick", s(pick, "entry_id"), i(pick, "run_no"), s(pick, "note"), null),
                    pick == null ? null : s(pick, "full_name"), it -> comparer.compare(it, s(a, "reporting_unit"), strings(a.get("found_values"))));
                list.add(item);
            }
            items.put(key == null ? "" : key, list);
        }
        return new ReviewBatch(s(b, "id"), s(b, "batch_code"), s(b, "site_id"), s(b, "status"), Boolean.TRUE.equals(b.get("is_verification")), steps, runs, marked, loads,
            verdicts, accepted, qcClass, invalid, items);
    }

    /** Compares chosen results with their specifications, reading each sample's serving and the Units list once, when needed. */
    private final class Comparer implements UnitConverter {
        private final Db d;
        private UnitGraph graph;
        private Map<String, String> dimensions;

        Comparer(Db d) { this.d = d; }

        Specification.Comparison compare(ReviewItem it, String reportingUnit, List<String> found) {
            Map<String, Object> sp = d.one("""
                SELECT min_value, max_value, text_value, unit, basis::text AS basis FROM specification
                 WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND status = 'Active' LIMIT 1""", it.requestedTestId(), it.analyteId());
            if (sp == null) return Specification.none();
            Specification spec = new Specification(dec(sp.get("min_value")), dec(sp.get("max_value")), s(sp, "text_value"), s(sp, "unit"), s(sp, "basis"));
            Map<String, Object> sv = d.one("""
                SELECT s.serving_size, s.serving_unit, s.density, s.density_unit, s.servings_per_package FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
                 WHERE rt.id = ?::uuid""", it.requestedTestId());
            Serving serving = sv == null ? null : new Serving(dec(sv.get("serving_size")), s(sv, "serving_unit"), dec(sv.get("density")), s(sv, "density_unit"),
                dec(sv.get("servings_per_package")));
            return spec.compare(it.value(), it.valueText(), it.reported(), reportingUnit, found, serving, this);
        }

        @Override
        public BigDecimal factor(String from, String to) {
            if (graph == null) graph = master.unitGraph();
            return graph.factor(from, to, null);
        }

        @Override
        public String dimension(String unit) {
            if (dimensions == null) {
                dimensions = new HashMap<>();
                for (Map<String, Object> r : d.rows("SELECT unit_code, dimension::text AS dimension FROM unit_of_measure"))
                    dimensions.putIfAbsent(s(r, "unit_code").toLowerCase(Locale.ROOT), s(r, "dimension"));
            }
            return unit == null ? null : dimensions.get(unit.strip().toLowerCase(Locale.ROOT));
        }
    }

    // ------------------------------------------------------------ read models kept from the logbooks feature
    public List<String> flagProblems(Db d, String batchId, List<String> steps) {
        return d.rows("SELECT problem FROM batch_flag_problems(?::uuid, ?::uuid[])", batchId, steps).stream().map(r -> s(r, "problem")).toList();
    }

    public List<String> aliquotProblems(Db d, String batchId) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : d.rows("""
            SELECT 'Aliquot ' || a.entry_code || ' (' || a.entry_label || ') was corrected after it was scanned (now ' || lb_num(a.weight) || COALESCE(' ' || a.unit, '') || '): return the batch to scan it again' AS p
              FROM batch_aliquots(?::uuid) a WHERE a.used AND a.corrected""", batchId)) out.add(s(r, "p"));
        for (Map<String, Object> r : d.rows("""
            SELECT 'Aliquot ' || a.entry_code || ' (' || a.entry_label || ') was voided: return the batch to weigh the sample again' AS p
              FROM batch_aliquots(?::uuid) a WHERE a.used AND a.entry_status = 'Voided'""", batchId)) out.add(s(r, "p"));
        return out;
    }

    /**
     * Java's engine recalculates every reported calculated reading from the inputs the bench used; any that disagrees
     * with the live result (beyond 1 in a billion) stops the approval.
     */
    public List<String> calculationProblems(Db d, String batchId, List<ReviewItem> items) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> r : d.rows("""
            SELECT r.entry_id, r.analyte_id, r.run_no, r.step_key, r.is_final, r.value, r.inputs,
                   COALESCE((SELECT o->>'formula' FROM jsonb_array_elements(COALESCE(ws.config->'overrides', '[]')) o WHERE o->>'analyte_id' = r.analyte_id::text LIMIT 1),
                            ws.config->>'formula') AS formula
              FROM batch_results(?::uuid) r JOIN test_batch b ON b.id = ?::uuid
              JOIN workflow_step ws ON ws.test_version_id = b.test_version_id AND ws.step_key = r.step_key AND ws.status = 'Active' AND ws.step_type = 'Calculation'
             WHERE r.value IS NOT NULL""", batchId, batchId)) {
            for (ReviewItem i : items) {
                boolean sameKey = i.key() == null ? Boolean.TRUE.equals(r.get("is_final")) : i.key().equals(r.get("step_key"));
                if (!sameKey || !i.analyteId().equals(s(r, "analyte_id")) || !i.usesReading(s(r, "entry_id"), i(r, "run_no"))) continue;
                BigDecimal db = dec(r.get("value"));
                BigDecimal java = Formula.of(s(r, "formula")).evaluate(inputs(r.get("inputs")));
                if (!Formula.agrees(db, java))
                    out.add(i.sampleLabel() + " " + i.analyteName() + ": the calculation gives " + db.toPlainString() + " but its formula gives " + java.toPlainString()
                        + "; return the batch to check it");
            }
        }
        return out;
    }

    public boolean verificationRunning(Db d) { return d.one("SELECT verification_running() AS v").get("v") != null; }

    /** The database's permission check (its message names the permission). */
    public void requirePermission(Db d, String code, String site) { d.one("SELECT require_permission_at(?, ?::uuid)", code, site); }

    public boolean hasPreliminary(Db d, String batchId) {
        return Boolean.TRUE.equals(d.one("SELECT EXISTS (SELECT 1 FROM test_result WHERE batch_id = ?::uuid AND stage = 'Preliminary' AND status = 'Active') AS x", batchId).get("x"));
    }

    // ------------------------------------------------------------ writes
    /** Batch, step and re-prep rows keep their bench rules in the database; review writes pass them as the review functions did. */
    public void internal(Db d, boolean on) { d.one("SELECT set_testing_internal(?)", on); }

    public void saveChoice(Db d, String batchId, String rt, String analyte, String key, ReviewItem.Choice c) {
        d.update("UPDATE result_choice SET status = 'Inactive' WHERE batch_id = ?::uuid AND requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key IS NOT DISTINCT FROM ? AND status = 'Active'",
            batchId, rt, analyte, key);
        d.update("""
            INSERT INTO result_choice (batch_id, requested_test_id, analyte_id, entry_id, run_no, mode, justification, readings, result_key)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::jsonb, ?)""", batchId, rt, analyte, c.entryId(), c.runNo(), c.mode(), c.justification(),
            c.readings() == null ? null : write(c.readings().stream().map(r -> Map.of("entry_id", r.entryId(), "run_no", r.runNo())).toList()), key);
    }

    public void saveQcAcceptance(Db d, String batchId, QcVerdict v, String why) {
        d.update("""
            UPDATE qc_acceptance SET status = 'Inactive' WHERE batch_id = ?::uuid AND entry_id = ?::uuid AND analyte_id IS NOT DISTINCT FROM ?::uuid AND limit_type = ?
               AND analytical_run = ? AND status = 'Active'""", batchId, v.entryId(), v.analyteId(), v.limitType(), v.analyticalRun());
        d.update("""
            INSERT INTO qc_acceptance (batch_id, entry_id, analyte_id, limit_type, verdict, measured, justification, analytical_run)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?::numeric, ?, ?)""", batchId, v.entryId(), v.analyteId(), v.limitType(), v.verdict(), v.measured(), why.strip(), v.analyticalRun());
    }

    public void saveLoadAcceptance(Db d, String batchId, ReviewBatch.Load l, String why) {
        d.update("UPDATE load_acceptance SET status = 'Inactive' WHERE load_id = ?::uuid AND status = 'Active'", l.id());
        d.update("INSERT INTO load_acceptance (batch_id, load_id, check_text, justification) VALUES (?::uuid, ?::uuid, ?, ?)", batchId, l.id(), l.checkText(), why.strip());
    }

    public void mark(Db d, String batchId, String runId) {
        d.update("INSERT INTO review_step_mark (batch_id, step_run_id) VALUES (?::uuid, ?::uuid)", batchId, runId);
    }

    public void unmark(Db d, String runId) {
        d.update("UPDATE review_step_mark SET status = 'Inactive', withdrawn_note = 'Undone by the reviewer' WHERE step_run_id = ?::uuid AND status = 'Active'", runId);
    }

    /** Stores one result (superseding the active one of the same requested test, analyte and key). */
    public void storeResult(Db d, String batchId, ReviewItem i, String stage, String releasedRunId) {
        d.update("UPDATE test_result SET status = 'Superseded' WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key IS NOT DISTINCT FROM ? AND status = 'Active'",
            i.requestedTestId(), i.analyteId(), i.key());
        Specification.Comparison sp = i.spec();
        d.update("""
            INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit, spec_min, spec_max, spec_text, spec_unit,
                                     conformance, approved_by, signature_id, result_key, stage, basis, justification, averaged, released_step_run_id)
            VALUES (?::uuid, ?::uuid, ?::uuid, ?::uuid, ?, ?::numeric, ?, ?, ?, ?::numeric, ?::numeric, ?, ?, ?, current_app_user(), NULLIF(current_setting('lims.signature_id', true), '')::uuid,
                    ?, ?, ?, ?, ?::jsonb, ?::uuid)""",
            i.requestedTestId(), i.analyteId(), batchId, i.chosenEntry(), i.chosenRun(), i.value(), i.valueText(), i.reported(), i.unit(),
            i.key() == null && sp != null ? sp.specMin() : null, i.key() == null && sp != null ? sp.specMax() : null, i.key() == null && sp != null ? sp.specText() : null,
            i.key() == null && sp != null ? sp.specUnit() : null, i.key() == null && sp != null ? sp.conformance() : "Not compared",
            i.key(), stage, i.basis(), i.justification(), i.readings() == null ? null : write(i.toRow().get("readings")), releasedRunId);
    }

    /** A released (preliminary) timepoint result is carried into the final unchanged; false when there is none. */
    public boolean carryPreliminary(Db d, String batchId, ReviewItem i) {
        Map<String, Object> pre = d.one("SELECT id FROM test_result WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key = ? AND status = 'Active' AND stage = 'Preliminary'",
            i.requestedTestId(), i.analyteId(), i.key());
        if (pre == null) return false;
        d.update("UPDATE test_result SET status = 'Superseded' WHERE id = ?::uuid", pre.get("id"));
        d.update("""
            INSERT INTO test_result (requested_test_id, analyte_id, batch_id, entry_id, run_no, value_num, value_text, reported, unit, conformance, approved_by, signature_id,
                                     result_key, stage, basis, justification, averaged, released_step_run_id, carried_from_id)
            SELECT requested_test_id, analyte_id, ?::uuid, entry_id, run_no, value_num, value_text, reported, unit, conformance, current_app_user(),
                   NULLIF(current_setting('lims.signature_id', true), '')::uuid, result_key, 'Final', basis, justification, averaged, released_step_run_id, id
              FROM test_result WHERE id = ?::uuid""", batchId, pre.get("id"));
        return true;
    }

    public void completeRun(Db d, String runId) {
        d.update("UPDATE step_run SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(), signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid", runId);
    }

    public void approved(Db d, String batchId) {
        d.update("""
            UPDATE step_run r SET status = 'Completed', performed_by = current_app_user(), completed_at = clock_timestamp(), signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid
              FROM workflow_step ws WHERE ws.id = r.step_id AND r.batch_id = ?::uuid AND ws.step_type = 'QC Review' AND r.status <> 'Completed'""", batchId);
        d.update("""
            UPDATE test_batch SET status = 'Approved', reviewed_by = current_app_user(), reviewed_at = clock_timestamp(),
                   review_signature_id = NULLIF(current_setting('lims.signature_id', true), '')::uuid WHERE id = ?::uuid""", batchId);
    }

    public void returned(Db d, String batchId, List<String> reopen) {
        d.update("UPDATE step_run SET status = 'In progress' WHERE id = ANY(?::uuid[])", reopen);
        d.update("UPDATE test_batch SET status = 'In Progress', returned_by = current_app_user(), returned_at = clock_timestamp(), returned_reason = current_reason() WHERE id = ?::uuid", batchId);
    }

    public void cancelled(Db d, String batchId) {
        d.update("UPDATE reprep_request SET status = 'Pooled', batch_id = NULL WHERE batch_id = ?::uuid AND status = 'Batched'", batchId);
        d.update("UPDATE test_batch SET status = 'Cancelled', cancelled_by = current_app_user(), cancelled_at = clock_timestamp(), cancelled_reason = current_reason() WHERE id = ?::uuid", batchId);
    }

    /** The order statuses follow their tests (refresh_order_status stays in the database: orders, OOS and triggers call it). */
    public void refreshOrders(Db d, String batchId) { d.one("SELECT refresh_batch_orders(?::uuid)", batchId); }

    // ------------------------------------------------------------ helpers
    private String write(Object v) {
        try { return json.writeValueAsString(v); } catch (com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalArgumentException(e); }
    }

    private static List<ReviewItem.Reading> readings(Object v) {
        if (!(v instanceof JsonNode n) || !n.isArray()) return List.of();
        List<ReviewItem.Reading> out = new ArrayList<>();
        for (JsonNode x : n) out.add(new ReviewItem.Reading(x.path("entry_id").asText(), x.path("run_no").asInt()));
        return out;
    }

    private static Map<String, BigDecimal> inputs(Object v) {
        Map<String, BigDecimal> out = new HashMap<>();
        if (v instanceof JsonNode n) n.fields().forEachRemaining(e -> out.put(e.getKey(), e.getValue().isNumber() ? e.getValue().decimalValue() : null));
        return out;
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object v) {
        if (v instanceof List<?> l) return (List<String>) l;
        return TestingRepository.pgList(v).stream().map(Object::toString).toList();
    }

    private static String s(Map<String, Object> r, String k) { return r.get(k) == null ? null : r.get(k).toString(); }

    private static int i(Map<String, Object> r, String k) { return r.get(k) instanceof Number n ? n.intValue() : Integer.parseInt(r.get(k).toString()); }

    private static BigDecimal dec(Object v) { return v == null ? null : v instanceof BigDecimal b ? b : new BigDecimal(v.toString()); }
}
