package com.tentamus.lims.testing.domain.review;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.domain.calc.AnalyteReporting;
import com.tentamus.lims.testing.domain.calc.Formula;
import com.tentamus.lims.testing.domain.calc.Specification;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * One result to report: a sample (requested test) and analyte, for the final result or a timepoint's (key), with the
 * readings it can be reported from. Java's own copy of batch_review_items (021, 039, 048): the reviewer's choice wins
 * (a pick, or the average of readings that are all still numeric candidates), else the analyst's pick, else a single
 * reading is chosen by itself; the result is then rounded and compared with the specification by Java's engine.
 * The database keeps batch_review_items for the verification run, OOS checks and the COA.
 */
public final class ReviewItem {
    /** A reading the result can be reported from. */
    public record Candidate(String entryId, int runNo, int run, BigDecimal value, String valueText) {
        boolean is(String e, int r) { return entryId.equals(e) && runNo == r; }
    }

    /** A recorded choice: the reviewer's (Pick or Average) or the analyst's pick. */
    public record Choice(String mode, String entryId, int runNo, String justification, List<Reading> readings) {}

    /** One of the readings of an average. */
    public record Reading(String entryId, int runNo) {}

    private final String requestedTestId, analyteId, analyteName, sampleLabel, unit, key;
    private final Object candidatesJson;
    private final List<Candidate> candidates;
    private final AnalyteReporting reporting;
    private final boolean numeric;

    private String chosenEntry, mode = "Pick", justification;
    private Integer chosenRun;
    private boolean auto;
    private List<Reading> readings;
    private BigDecimal value;
    private String valueText, reported;
    private Specification.Comparison spec;

    public ReviewItem(String requestedTestId, String analyteId, String analyteName, String sampleLabel, String unit, String key, Object candidatesJson,
                      List<Candidate> candidates, AnalyteReporting reporting, boolean numeric) {
        this.requestedTestId = requestedTestId;
        this.analyteId = analyteId;
        this.analyteName = analyteName;
        this.sampleLabel = sampleLabel;
        this.unit = unit;
        this.key = key;
        this.candidatesJson = candidatesJson;
        this.candidates = candidates;
        this.reporting = reporting;
        this.numeric = numeric;
    }

    /**
     * Decides the reading reported.
     *
     * @param reviewer     the reviewer's active choice, or null
     * @param analystPick  the analyst's pick for this sample (final result only), or null
     * @param analystName  who picked it
     * @param compare      compares a chosen result with the specification (final result only)
     */
    public void decide(Choice reviewer, Choice analystPick, String analystName, java.util.function.Function<ReviewItem, Specification.Comparison> compare) {
        if (reviewer != null && "Average".equals(reviewer.mode())) {
            List<Candidate> used = candidates.stream().filter(c -> c.value() != null && reviewer.readings().stream().anyMatch(r -> c.is(r.entryId(), r.runNo()))).toList();
            if (used.size() == reviewer.readings().size()) {
                chosenEntry = reviewer.readings().get(0).entryId();
                chosenRun = reviewer.readings().get(0).runNo();
                mode = "Average";
                justification = reviewer.justification();
                readings = reviewer.readings();
                value = average(used);
                reported = reporting.report(value);
            }
        } else if (reviewer != null && find(reviewer.entryId(), reviewer.runNo()) != null) {
            pick(find(reviewer.entryId(), reviewer.runNo()), false);
            justification = reviewer.justification();
        } else if (candidates.size() == 1) pick(candidates.get(0), true);
        // the analyst's pick, where the reviewer has not chosen (0.27.0)
        if (key == null && reviewer == null && (chosenEntry == null || auto) && analystPick != null && find(analystPick.entryId(), analystPick.runNo()) != null) {
            pick(find(analystPick.entryId(), analystPick.runNo()), false);
            readings = null;
            justification = "Picked by the analyst (" + analystName + "): " + analystPick.justification();
        }
        spec = chosenEntry == null ? null : key == null ? compare.apply(this) : Specification.Comparison.notCompared();
    }

    private void pick(Candidate c, boolean byItself) {
        chosenEntry = c.entryId();
        chosenRun = c.runNo();
        auto = byItself;
        mode = "Pick";
        value = numeric ? c.value() : null;
        valueText = c.valueText();
        reported = numeric ? reporting.report(c.value()) : c.valueText();
    }

    private static BigDecimal average(List<Candidate> used) {
        BigDecimal sum = BigDecimal.ZERO;
        for (Candidate c : used) sum = sum.add(c.value());
        return sum.divide(BigDecimal.valueOf(used.size()), Formula.MC);
    }

    Candidate find(String entry, int run) {
        for (Candidate c : candidates) if (c.is(entry, run)) return c;
        return null;
    }

    /** The reviewer picks one reading (choose_result): one of this sample's, with a justification when there are several. */
    public Choice choosePick(String entry, int run, String why) {
        if (find(entry, run) == null) throw RuleException.database("That reading is not a result of this sample in this batch");
        if (candidates.size() > 1 && blank(why))
            throw RuleException.database("Write why this reading is the one reported (the sample has " + candidates.size() + " readings)");
        return new Choice("Pick", entry, run, blank(why) ? null : why.strip(), null);
    }

    /** The reviewer reports the average of the readings ticked (average_results): two or more numeric readings of this sample. */
    public Choice chooseAverage(List<Reading> ticked, String why) {
        List<Reading> rd = new ArrayList<>(new java.util.LinkedHashSet<>(ticked));
        rd.sort(Comparator.comparingInt(Reading::runNo).thenComparing(Reading::entryId));   // the database's jsonb order
        if (rd.size() < 2) throw RuleException.database("Tick at least two readings to average");
        long numericCount = candidates.stream().filter(c -> c.value() != null).count();
        long ok = rd.stream().filter(r -> { Candidate c = find(r.entryId(), r.runNo()); return c != null && c.value() != null; }).count();
        if (ok != rd.size()) throw RuleException.database("Only numeric readings of this sample in this batch can be averaged");
        if (ok < numericCount && blank(why))
            throw RuleException.database("Write why " + (numericCount - ok) + " of the " + numericCount + " readings are left out of the average");
        return new Choice("Average", rd.get(0).entryId(), rd.get(0).runNo(), blank(why) ? null : why.strip(), rd);
    }

    static boolean blank(String s) { return s == null || s.isBlank(); }

    public boolean chosen() { return chosenEntry != null; }

    /** Whether the reported result uses this reading (the pick, or one of the readings averaged). */
    public boolean usesReading(String entry, int run) {
        if (!chosen()) return false;
        if ("Average".equals(mode)) return readings.stream().anyMatch(r -> r.entryId().equals(entry) && r.runNo() == run);
        return chosenEntry.equals(entry) && chosenRun == run;
    }

    /** The analytical runs its reported readings were read in (batch_used_runs). */
    public List<Integer> runsUsed() {
        List<Integer> out = new ArrayList<>();
        if (!chosen()) return out;
        if ("Average".equals(mode)) for (Reading r : readings) { Candidate c = find(r.entryId(), r.runNo()); if (c != null) out.add(c.run()); }
        else { Candidate c = find(chosenEntry, chosenRun); if (c != null) out.add(c.run()); }
        return out;
    }

    /** "VC-2201 Vitamin C: choose the reportable reading" (or no result). */
    public String unresolved() { return sampleLabel + " " + analyteName + ": " + (candidates.isEmpty() ? "no result" : "choose the reportable reading"); }

    /** How the stored result was reached. */
    public String basis() { return "Average".equals(mode) ? "Average" : candidates.size() > 1 ? "Picked" : "Single"; }

    public String requestedTestId() { return requestedTestId; }
    public String analyteId() { return analyteId; }
    public String analyteName() { return analyteName; }
    public String sampleLabel() { return sampleLabel; }
    public String unit() { return unit; }
    public String key() { return key; }
    public String chosenEntry() { return chosenEntry; }
    public Integer chosenRun() { return chosenRun; }
    public BigDecimal value() { return value; }
    public String valueText() { return valueText; }
    public String reported() { return reported; }
    public String justification() { return justification; }
    public List<Reading> readings() { return readings; }
    public Specification.Comparison spec() { return spec; }

    /** The row the QC Review screen reads (the columns of batch_review_items). */
    public Map<String, Object> toRow() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("requested_test_id", requestedTestId);
        m.put("analyte_id", analyteId);
        m.put("analyte_name", analyteName);
        m.put("sample_label", sampleLabel);
        m.put("candidates", candidatesJson);
        m.put("chosen_entry_id", chosenEntry);
        m.put("chosen_run_no", chosenRun);
        m.put("auto_chosen", auto);
        m.put("value", value);
        m.put("value_text", valueText);
        m.put("reported", reported);
        m.put("unit", unit);
        m.put("spec_min", spec == null ? null : spec.specMin());
        m.put("spec_max", spec == null ? null : spec.specMax());
        m.put("spec_text", spec == null ? null : spec.specText());
        m.put("spec_unit", spec == null ? null : spec.specUnit());
        m.put("conformance", spec == null ? null : spec.conformance());
        m.put("mode", mode);
        m.put("justification", justification);
        m.put("readings", readings == null ? null : readings.stream().map(r -> {
            Map<String, Object> x = new LinkedHashMap<>();
            x.put("run_no", r.runNo());
            x.put("entry_id", r.entryId());
            return x;
        }).toList());
        m.put("result_key", key);
        return m;
    }

    @Override
    public boolean equals(Object o) { return o instanceof ReviewItem i && Objects.equals(i.requestedTestId, requestedTestId) && Objects.equals(i.analyteId, analyteId) && Objects.equals(i.key, key); }

    @Override
    public int hashCode() { return Objects.hash(requestedTestId, analyteId, key); }
}
