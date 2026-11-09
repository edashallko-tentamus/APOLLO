package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A sample on a lab order, as stored. Its rules decide what a grid save may write: the matrix and compliance category come
 * from their lists, the METRC ID is a tag, the serving is in units of the Units list, the measured unit weight and density
 * are never typed, quantities are not negative, and once logged its ID, logging time and order are fixed and other edits
 * need a Reason for Change. It also decides when it may be cancelled and which serving test "Results per serving" orders.
 * Replaces the database triggers sample_rules, sample_matrix_check, sample_compliance_check, sample_serving_rules,
 * sample_metrc_rule, sample_measured_guard, sample_custody_rule, sample_cancel_rule, sample_cancel_tests and
 * sample_per_serving_order (migration 063).
 */
public final class Sample {
    /** Edits to a logged sample that need a Reason for Change. */
    static final List<String> NEEDS_REASON = List.of("client_sample_id", "description", "matrix", "product", "lot", "batch", "quantity_received",
        "quantity_unit", "number_of_units", "condition", "receipt_temperature", "preservation", "received_at", "status");
    static final List<String> SERVING = List.of("serving_size", "serving_unit", "serving_count", "serving_count_unit", "servings_per_package");
    static final List<String> FIXED_ONCE_LOGGED = List.of("logged_at", "sample_code", "logged_by", "lab_order_id");
    static final List<String> MEASURED = List.of("unit_weight", "unit_weight_unit", "unit_weight_result_id", "density", "density_unit", "density_result_id");

    private final Map<String, Object> row;

    private Sample(Map<String, Object> row) { this.row = row; }

    /** A stored sample (its columns), or a new one when the row is null. */
    public static Sample of(Map<String, Object> row) { return new Sample(row); }

    public boolean isNew() { return row == null; }

    public boolean isLogged() { return row != null && row.get("logged_at") != null; }

    public Object get(String col) { return row == null ? null : row.get(col); }

    public String label() {
        Object code = get("sample_code");
        return code != null ? code.toString() : get("client_sample_id") == null ? "" : get("client_sample_id").toString();
    }

    /**
     * The values to write for these changes, in the lists' spelling; refuses what the rules do not allow.
     *
     * @param changes     the columns being written ("" already turned into null)
     * @param reasonGiven whether the person gave a Reason for Change
     */
    public Map<String, Object> accept(Map<String, Object> changes, SampleLists lists, boolean reasonGiven) {
        Map<String, Object> out = new LinkedHashMap<>(changes);
        for (String c : MEASURED)
            if (changes.containsKey(c) && (isNew() ? changes.get(c) != null : !same(get(c), changes.get(c))))
                throw RuleException.database("The measured unit weight and density come from their approved test results (Serving weight and Density tests)");
        if (isLogged())
            for (String c : FIXED_ONCE_LOGGED)
                if (changes.containsKey(c) && !same(get(c), changes.get(c)))
                    throw RuleException.database("Sample code, logging time and order cannot be changed once a sample is logged");
        listValue(out, "matrix", lists.matrices(),
            "Matrix \"%s\" is not on the Matrix list. Pick one from the list, or ask an administrator to add it.");
        if (out.containsKey("metrc_id")) out.put("metrc_id", MetrcId.normalize(out.get("metrc_id")));
        if (out.containsKey("quantity_received") && out.get("quantity_received") != null && dec(out.get("quantity_received")).signum() < 0)
            throw RuleException.withCode("new row for relation \"sample\" violates check constraint \"sample_quantity_received_check\"", "23514");
        if (out.containsKey("number_of_units") && out.get("number_of_units") != null && dec(out.get("number_of_units")).signum() <= 0)
            throw RuleException.withCode("new row for relation \"sample\" violates check constraint \"sample_number_of_units_check\"", "23514");
        if (isLogged() && !reasonGiven && changed(out, NEEDS_REASON)) throw RuleException.database("A Reason for Change is required to edit a logged sample");
        serving(out, lists, reasonGiven);
        listValue(out, "compliance_category", lists.categories(),
            "Compliance category \"%s\" is not on the list. Pick one from the list, or ask QA or an administrator to add it.");
        return out;
    }

    /** A value from a controlled list: blank is none; a new or changed value must be an active entry, stored as the list spells it. */
    private void listValue(Map<String, Object> out, String col, List<String> list, String refusal) {
        if (!out.containsKey(col) || out.get(col) == null) return;
        String v = out.get(col).toString();
        if (v.isBlank()) { out.put(col, null); return; }
        if (!isNew() && same(get(col), v)) return;   // an unchanged value stays, even if it is no longer on the list
        String found = SampleLists.find(list, v);
        if (found == null) throw RuleException.database(String.format(refusal, v));
        out.put(col, found);
    }

    private void serving(Map<String, Object> out, SampleLists lists, boolean reasonGiven) {
        if (!isNew() && SERVING.stream().noneMatch(out::containsKey) && !out.containsKey("quantity_unit")) return;
        for (String c : List.of("serving_unit", "serving_count_unit", "quantity_unit"))
            if (out.get(c) != null && out.get(c).toString().isBlank()) out.put(c, null);
        Object unit = after(out, "serving_unit");
        if (out.containsKey("serving_unit") && unit != null && (isNew() || !same(get("serving_unit"), unit)))
            out.put("serving_unit", unit = lists.units().canonical(unit.toString(), List.of("Mass", "Volume"), "Serving weight or volume unit"));
        if (after(out, "serving_size") != null && unit == null) throw RuleException.database("Give the serving's weight or volume a unit (e.g. g or mL)");
        Object countUnit = after(out, "serving_count_unit");
        if (countUnit != null) {
            String found = SampleLists.find(lists.servingUnits(), countUnit.toString());
            if (found == null) throw RuleException.database("The serving unit must be one of the serving units on the Units list (Admin > Units), e.g. capsule or scoop");
            if (out.containsKey("serving_count_unit")) out.put("serving_count_unit", found);
        }
        if (after(out, "serving_count") != null && countUnit == null) throw RuleException.database("Say what the serving is counted in (e.g. 2 capsules)");
        Object qUnit = after(out, "quantity_unit");
        if (out.containsKey("quantity_unit") && qUnit != null && (isNew() || !same(get("quantity_unit"), qUnit)))
            out.put("quantity_unit", lists.units().canonical(qUnit.toString(), List.of("Mass", "Volume", "Count"), "Quantity unit"));
        if (isLogged() && !reasonGiven && changed(out, SERVING)) throw RuleException.database("A Reason for Change is required to change the serving of a logged sample");
    }

    /**
     * The serving test "Results per serving" orders once these changes are saved (Serving weight, or Density for a serving
     * by volume), or null when nothing is to be ordered: the box newly ticked, or the serving's unit changed while ticked.
     *
     * @param written   the values written
     * @param dimension the Units list's dimension of the serving unit, or null
     */
    public String servingTestToOrder(Map<String, Object> written, String dimension) {
        boolean ticked = Boolean.TRUE.equals(bool(after(written, "report_per_serving")));
        if (!ticked || "Cancelled".equals(after(written, "status"))) return null;
        boolean was = !isNew() && Boolean.TRUE.equals(bool(get("report_per_serving")));
        boolean unitChanged = !isNew() && written.containsKey("serving_unit") && !same(get("serving_unit"), written.get("serving_unit"));
        if (!isNew() && was && !unitChanged) return null;
        return "Volume".equals(dimension) ? "Density" : "Serving weight";
    }

    /**
     * Cancelling: refused while one of its tests has results or is in a batch (the first problem found is given).
     *
     * @param testProblems why each of its tests cannot be cancelled (none: it may be)
     */
    public void assertCancellable(List<String> testProblems) {
        if (!testProblems.isEmpty()) throw RuleException.database("Sample " + label() + " cannot be cancelled: " + testProblems.get(0));
    }

    /** A sample is logged by Java only where the lab does not require a signed receipt ("Receive and sign" logs it there). */
    public static void assertLoggable(boolean labRequiresSignedReceipt) {
        if (labRequiresSignedReceipt)
            throw RuleException.database("This lab logs samples only when they are received and the chain of custody is signed (\"Receive and sign\")");
    }

    /** Logging needs at least one test ordered. */
    public void assertHasTests(int activeTests) {
        if (activeTests == 0) {
            Object name = get("client_sample_id") != null ? get("client_sample_id") : get("description") != null ? get("description") : "unnamed";
            throw RuleException.database("Sample \"" + name + "\" has no tests ordered; apply a project or add a test before logging it");
        }
    }

    private boolean changed(Map<String, Object> out, List<String> cols) {
        for (String c : cols) if (out.containsKey(c) && !same(get(c), out.get(c))) return true;
        return false;
    }

    private Object after(Map<String, Object> out, String col) { return out.containsKey(col) ? out.get(col) : get(col); }

    private static Boolean bool(Object v) {
        if (v == null) return null;
        if (v instanceof Boolean b) return b;
        return "true".equalsIgnoreCase(v.toString()) || "t".equals(v.toString());
    }

    /** The database's IS NOT DISTINCT FROM for values that may arrive as numbers, text or ISO times. */
    static boolean same(Object a, Object b) {
        if (a == null || b == null) return a == b;
        if (a.equals(b)) return true;
        String x = a.toString(), y = b.toString();
        if (x.equals(y)) return true;
        try { return new BigDecimal(x).compareTo(new BigDecimal(y)) == 0; } catch (NumberFormatException ignored) { }
        try { return OffsetDateTime.parse(x).toInstant().equals(OffsetDateTime.parse(y).toInstant()); } catch (RuntimeException ignored) { }
        return false;
    }

    private static BigDecimal dec(Object v) {
        try { return new BigDecimal(v.toString().strip()); } catch (NumberFormatException e) { return BigDecimal.ZERO; }
    }
}
