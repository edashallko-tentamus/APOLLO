package com.tentamus.lims.testing.domain.calc;

import com.tentamus.lims.core.calc.Formula;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * One QC check of a batch: a QC entry judged on one criterion for one analyte in one analytical run. The measurement
 * and its base verdict come from the database's batch_qc_verdicts_022 (the readings, spikes and standards it gathers);
 * Java then applies the two later rules itself, as batch_qc_verdicts (039 and 042) does for Node: a control whose
 * reading is not a result is Invalid, and a Presence / Absence control whose calculation is undefined because its
 * count is 0 is judged on the count (0 = no growth).
 */
public final class QcVerdict {
    public static final String ZERO_NOTE = "Judged on its count: 0 (no growth); the calculated result is undefined at zero";

    private final Map<String, Object> row;

    public QcVerdict(Map<String, Object> row) { this.row = new LinkedHashMap<>(row); }

    public String entryId() { return str("entry_id"); }
    public String label() { return str("label"); }
    public String limitType() { return str("limit_type"); }
    public String analyteId() { return str("analyte_id"); }
    public String analyteName() { return str("analyte_name"); }
    public String verdict() { return str("verdict"); }
    public String note() { return str("note"); }
    public Object measured() { return row.get("measured"); }
    public int analyticalRun() { return num("analytical_run", 1); }
    public Integer runNo() { return row.get("run_no") == null ? null : num("run_no", 0); }

    /** The control's reading in this run is not a result (one of the analyte's "not a result" values). */
    public void invalidate(String readingText) {
        row.put("verdict", "Invalid");
        row.put("note", "reading " + readingText + " is not a result: read the control again in a new analytical run");
    }

    /** A control counted 0 whose calculation is undefined at zero: Absence passes, Presence fails. */
    public void judgeOnZeroCount() {
        if (!"Waiting".equals(verdict()) || measured() != null || analyteId() == null || !Set.of("Absence", "Presence").contains(limitType())) return;
        row.put("measured", BigDecimal.ZERO);
        row.put("verdict", "Absence".equals(limitType()) ? "Pass" : "Fail");
        row.put("note", ZERO_NOTE);
    }

    public boolean waitingForCount() {
        return "Waiting".equals(verdict()) && measured() == null && analyteId() != null && Set.of("Absence", "Presence").contains(limitType());
    }

    /**
     * Whether a calculation is undefined only because a count it uses is 0 (the log or root of zero): calc_undefined_at_zero.
     *
     * @param inputs the token values the calculation was given
     */
    public static boolean undefinedAtZero(String waiting, Map<String, BigDecimal> inputs) {
        if (waiting == null || !waiting.startsWith(Formula.LOG_OR_ROOT)) return false;
        for (Map.Entry<String, BigDecimal> e : inputs.entrySet())
            if (e.getKey().endsWith(".reading") && e.getValue() != null && e.getValue().signum() == 0) return true;
        return false;
    }

    public boolean failedOrWaiting() { return "Fail".equals(verdict()) || "Waiting".equals(verdict()); }

    public boolean isInvalid() { return "Invalid".equals(verdict()); }

    /**
     * Whether it counts for approval: run 1 of a prep QC (it judges the preparation) and daily controls, and any verdict
     * of a run that holds a reported reading (qc_verdict_counts).
     */
    public boolean counts(Set<Integer> usedRuns, String qcClass) {
        return usedRuns.contains(analyticalRun()) || (analyticalRun() == 1 && !"Analytical".equals(qcClass == null ? "" : qcClass));
    }

    /** The same entry, analyte and criterion (another reading of the same check). */
    public boolean sameCheck(QcVerdict o) {
        return Objects.equals(entryId(), o.entryId()) && Objects.equals(analyteId(), o.analyteId()) && Objects.equals(limitType(), o.limitType());
    }

    public boolean readLaterThan(QcVerdict o) { return runNo() != null && o.runNo() != null && runNo() > o.runNo(); }

    /** "QC-1 Lead Recovery % (run 2)": how problems name the check. */
    public String name() {
        return label() + " " + (analyteName() == null ? "" : analyteName()) + " " + limitType() + (analyticalRun() > 1 ? " (run " + analyticalRun() + ")" : "");
    }

    public String needsAcceptance() { return name() + ": " + verdict().toLowerCase() + ", accept it with a justification or return the batch"; }

    public Map<String, Object> toRow() { return row; }

    private String str(String k) { return row.get(k) == null ? null : row.get(k).toString(); }

    private int num(String k, int d) { return row.get(k) instanceof Number n ? n.intValue() : row.get(k) == null ? d : Integer.parseInt(row.get(k).toString()); }
}
