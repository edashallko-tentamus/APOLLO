package com.tentamus.lims.testing.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.util.ArrayList;
import java.util.List;

/**
 * A new analytical run of a reading (Data Entry) step (re-analysis): the chosen samples read again single, duplicate or
 * triplicate, plus one reading of each analytical QC (ICV, CCV...), at most 10 readings per entry; optionally diluted
 * further first (one more aliquot + diluent on each sample's dilution, for this run). Java's copy of
 * add_analytical_run() (kept in the database for the demo data load) and of add_analytical_run_diluted().
 */
public final class AnalyticalRun {
    /** A reading request of the run: the entry, how many readings, and the first reading number. */
    public record Reading(String entryId, int runs, int firstRunNo) {}

    /** An entry as the run sees it: in the batch and active, not a shared daily control, analytical QC, its readings so far. */
    public record Candidate(String id, String label, boolean activeHere, boolean analyticalQc, int readings) {}

    private AnalyticalRun() {}

    /** The replicates asked for: single, duplicate or triplicate. */
    public static void assertReplicates(Integer replicates) {
        if (replicates == null || replicates < 1 || replicates > 3) throw RuleException.database("Choose single, duplicate or triplicate");
    }

    /**
     * Plans the run's readings (in the batch's run order), refusing what the rules do not allow.
     *
     * @param chosen     the entries chosen to read again
     * @param candidates the batch's active entries in run order, plus any chosen entry not active here (activeHere false)
     */
    public static List<Reading> plan(BenchStep step, List<String> chosen, Integer replicates, boolean reasonGiven, List<Candidate> candidates) {
        if (!"Data Entry".equals(step.stepType())) throw RuleException.database("Analytical runs (re-analysis) are added at a reading (Data Entry) step");
        assertReplicates(replicates);
        if (chosen.isEmpty()) throw RuleException.database("Choose the samples to read again in the new run");
        step.assertCanWork();
        if (!reasonGiven) throw RuleException.database("Say why the samples are read again (re-analysis)");
        step.assertNotReleased();
        for (String id : chosen)
            if (candidates.stream().noneMatch(c -> c.id().equals(id) && c.activeHere())) throw RuleException.database("An entry is not active in this batch");
        List<Reading> out = new ArrayList<>();
        for (Candidate c : candidates) {
            if (!c.activeHere() || !(chosen.contains(c.id()) || c.analyticalQc())) continue;
            int reps = chosen.contains(c.id()) ? replicates : 1;
            if (c.readings() + reps > 10) throw RuleException.database("At most 10 readings per entry (" + c.label() + " has " + c.readings() + ")");
            out.add(new Reading(c.id(), reps, c.readings() + 1));
        }
        return out;
    }

    /**
     * Refuses a further dilution that cannot be made.
     *
     * @param lastReadingStep whether the step is the batch's last reading step
     * @param hasDilutionStep whether the test has a Dilution step
     */
    public static void assertDilutable(BigDecimal aliquot, BigDecimal diluent, boolean lastReadingStep, boolean hasDilutionStep) {
        if (aliquot.signum() <= 0 || (diluent != null && diluent.signum() < 0))
            throw RuleException.database("A further dilution needs an aliquot above zero and a diluent of zero or more");
        if (!lastReadingStep) throw RuleException.database("A further dilution goes with a run of the batch's last reading step");
        if (!hasDilutionStep) throw RuleException.database("This test has no Dilution step: add the run without a further dilution");
    }

    /** A sample's dilution for run k: its previous dilution with one more aliquot + diluent. */
    public static ObjectNode furtherDilution(String label, JsonNode base, BigDecimal aliquot, BigDecimal diluent, int k) {
        if (base == null || factor(base) == null) throw RuleException.database(label + " has no dilution recorded to dilute further");
        ArrayNode fields = JsonNodeFactory.instance.arrayNode();
        if (base.get("fields") instanceof ArrayNode a) fields.addAll(a);
        fields.addObject().put("aliquot", aliquot).put("diluent", diluent == null ? BigDecimal.ZERO : diluent);
        ObjectNode out = JsonNodeFactory.instance.objectNode();
        out.set("fields", fields);
        out.put("for_run", k);
        return out;
    }

    /** A dilution's factor: each field with an aliquot above zero multiplies it by (aliquot + diluent) / aliquot; null when none. */
    public static BigDecimal factor(JsonNode data) {
        BigDecimal f = null;
        JsonNode fields = data == null ? null : data.get("fields");
        if (fields == null || !fields.isArray()) return null;
        for (JsonNode x : fields) {
            BigDecimal a = number(x.get("aliquot"));
            if (a == null || a.signum() <= 0) continue;
            BigDecimal d = number(x.get("diluent"));
            f = (f == null ? BigDecimal.ONE : f).multiply(a.add(d == null ? BigDecimal.ZERO : d)).divide(a, MathContext.DECIMAL128);
        }
        return f;
    }

    private static BigDecimal number(JsonNode n) {
        if (n == null || n.isNull()) return null;
        if (n.isNumber()) return n.decimalValue();
        try { return new BigDecimal(n.asText().strip()); } catch (NumberFormatException e) { return null; }
    }
}
