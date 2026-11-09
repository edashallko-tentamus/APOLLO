package com.tentamus.lims.oos.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;

/**
 * Opening an OOS investigation, from the stored (approved) result or, before approval, from the batch's QC Review
 * reading. Replaces open_oos (migration 069). Checked after the oos.open permission and the signature.
 */
public final class OosOpening {
    private OosOpening() {}

    /** The result investigated: the stored one (resultId set) or the batch's reading; null fields when nothing was found. */
    public record Result(String resultId, String batchId, String reported, BigDecimal value, String unit, String conformance, String specText,
                         BigDecimal specMin, BigDecimal specMax, String specUnit) {

        /** "≥ min and ≤ max unit" when the specification has no text of its own. */
        public String spec() {
            if (specText != null) return specText;
            String lo = specMin == null ? null : "≥ " + specMin.toPlainString(), hi = specMax == null ? null : "≤ " + specMax.toPlainString();
            String both = lo == null ? (hi == null ? "" : hi) : hi == null ? lo : lo + " and " + hi;
            return specUnit == null ? both : both + " " + specUnit;
        }
    }

    /**
     * @param openCode      the code of an investigation already open on this result, if any
     * @param stored        the stored final result, or null
     * @param closedCode    the code of a closed investigation of that stored result, if any
     * @param batchId       the batch it is opened from (null after approval)
     * @param batchCode     its code, for the message
     * @param reading       the batch's reading for the result, or null when the batch has none
     */
    public static Result check(String openCode, Result stored, String closedCode, String batchId, String batchCode, Result reading) {
        if (openCode != null) throw RuleException.database(openCode + " is already open for this result");
        if (stored != null) {
            if (!"Does not conform".equals(stored.conformance()))
                throw RuleException.database("The approved result conforms to its specification: there is nothing to investigate");
            if (closedCode != null) throw RuleException.database("This result was already investigated (" + closedCode + ")");
            return stored;
        }
        if (batchId == null) throw RuleException.database("Open the investigation from the batch's QC Review (the result is not approved yet)");
        if (reading == null) throw RuleException.database("That result is not in batch " + batchCode);
        if (!"Does not conform".equals(reading.conformance()))
            throw RuleException.database("The chosen reading conforms to its specification: there is nothing to investigate");
        return new Result(null, batchId, reading.reported(), reading.value(), reading.unit(), reading.conformance(), reading.specText(), reading.specMin(),
            reading.specMax(), reading.specUnit());
    }

    /** GMP work always follows Full Phase I; other work the lab's default procedure. */
    public static String procedure(boolean gmp, String labDefault) { return gmp ? OosInvestigation.PHASE_I : labDefault; }

    /** Days to close it: the procedure's setting, 30 when none. */
    public static int closeWithin(Integer days) { return days == null ? 30 : days; }
}
