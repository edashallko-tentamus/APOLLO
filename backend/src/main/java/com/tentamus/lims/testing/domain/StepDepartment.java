package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;

/**
 * Who may do a workflow step: a member of a group marked as the step's department (the step's own, else the test's).
 * A step with no department is done by nobody until one is set. Java's copy of can_perform_step() and
 * user_in_department(), which stay in the database for its own functions (create_batch, complete_step) and the OOS checks.
 *
 * @param departmentId   the step's department, or null
 * @param departmentName its name, or null
 * @param inDepartment   whether the person is an active member of an active group marked as that department
 */
public record StepDepartment(String departmentId, String departmentName, boolean inDepartment) {

    public boolean canPerform() { return departmentId != null && inDepartment; }

    private String name() { return departmentName == null ? "test's" : departmentName; }

    /** Refuses someone outside the department of a bench step. */
    public void assertCanPerform(String stepName) {
        if (!canPerform()) throw RuleException.database("\"" + stepName + "\" is done by the " + name() + " department; you are not in a group for it (Admin > Groups)");
    }

    /** Refuses someone outside the department of the Batching step (making or changing a batch). */
    public void assertCanBatch(String testName) {
        if (!canPerform()) throw RuleException.database("Batching " + testName + " is done by the " + name() + " department; you are not in a group for it");
    }
}
