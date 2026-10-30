package com.tentamus.lims.training.domain;

import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * A lab's (or one department's) training rule: when someone is department trained, what that unlocks, how often
 * continuing competency is due, the minimum runs and which routes are accepted. Replaces the rule part of the trigger
 * training_rule_rules and the column checks on training_rule (migration 071); the permission check stays in the database.
 *
 * @param deptTrainedAfter tests needed to be department trained (null: no department-trained status)
 * @param unlockAnyTest    department trained may do any test of the department
 * @param unlockCanTrain   department trained may evaluate others there
 */
public record TrainingRule(Integer deptTrainedAfter, boolean unlockAnyTest, boolean unlockCanTrain, Integer continuingMonths, int dueSoonDays,
                           Integer minRuns, Integer minRunsMonths, boolean allowTrainingSamples, boolean allowRecords) {

    /** The rule from a training_rule row (or the result of training_rule_for). */
    public static TrainingRule of(Map<String, Object> r) {
        return new TrainingRule(intOrNull(r.get("dept_trained_after")), bool(r.get("unlock_any_test"), true), bool(r.get("unlock_can_train"), true),
            intOrNull(r.get("continuing_months")), r.get("due_soon_days") == null ? 30 : intOrNull(r.get("due_soon_days")),
            intOrNull(r.get("min_runs")), intOrNull(r.get("min_runs_months")), bool(r.get("allow_training_samples"), true), bool(r.get("allow_records"), true));
    }

    /**
     * Checks a rule about to be saved: the ranges, runs and months together, at least one route; on a change it stays
     * with its lab and department; a department rule names a department of its lab.
     *
     * @param before         the stored rule (null for a new one)
     * @param after          the rule as it will be
     * @param departmentSite the lab of the rule's department (null when it has none)
     */
    public static TrainingRule checked(Map<String, Object> before, Map<String, Object> after, String departmentSite) {
        if (before != null && (!Objects.equals(str(before.get("site_id")), str(after.get("site_id")))
            || !Objects.equals(str(before.get("department_id")), str(after.get("department_id")))))
            throw RuleException.database("A training rule stays with its lab and department");
        if (after.get("department_id") != null && departmentSite != null && !departmentSite.equals(str(after.get("site_id"))))
            throw RuleException.database("The department belongs to another lab");
        TrainingRule r = of(after);
        range(r.deptTrainedAfter, 1, 50, "dept_trained_after");
        range(r.continuingMonths, 1, 60, "continuing_months");
        range(r.dueSoonDays, 0, 180, "due_soon_days");
        range(r.minRuns, 1, 500, "min_runs");
        range(r.minRunsMonths, 1, 60, "min_runs_months");
        if ((r.minRuns == null) != (r.minRunsMonths == null)) throw check("training_rule_runs");
        if (!r.allowTrainingSamples && !r.allowRecords) throw check("training_rule_routes");
        return r;
    }

    /** May someone evaluate (train) on a test: training.record, or department trained where the rule lets them train (can_evaluate_training). */
    public static boolean letsTrain(boolean recordPermission, boolean testHasDepartment, TrainingRule rule, boolean departmentTrained) {
        return recordPermission || (testHasDepartment && rule != null && rule.unlockCanTrain && departmentTrained);
    }

    private static void range(Integer v, int lo, int hi, String col) {
        if (v != null && (v < lo || v > hi)) throw check("training_rule_" + col + "_check");
    }

    private static RuleException check(String name) {
        return RuleException.withCode("new row for relation \"training_rule\" violates check constraint \"" + name + "\"", "23514");
    }

    static Integer intOrNull(Object v) {
        if (v == null || "".equals(v)) return null;
        double d = Js.toNumber(v);
        if (Double.isNaN(d) || d != Math.rint(d)) throw RuleException.withCode("invalid input syntax for type integer: \"" + v + "\"", "22P02");
        return (int) d;
    }

    private static boolean bool(Object v, boolean d) {
        if (v == null) return d;
        if (v instanceof Boolean b) return b;
        return "true".equalsIgnoreCase(v.toString()) || "t".equals(v.toString()) || "1".equals(v.toString());
    }

    private static String str(Object v) { return v == null ? null : v.toString(); }
}
