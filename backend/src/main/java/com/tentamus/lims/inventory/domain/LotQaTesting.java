package com.tentamus.lims.inventory.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.stream.Collectors;

/**
 * A lot's QA testing before use: whether it needs it, its status (Awaiting, In QA testing, Released for every use or
 * for named tests, Rejected), why it cannot be used for a test, and QA's waiver.
 *
 * <p>Java's own copy of lot_qa_required(), lot_qa_rejected(), lot_qa_status() and lot_qa_problem() (they stay in the
 * database: the bench, labels and the lot views use them), and the replacement of lot_component_qa_rule and
 * waive_lot_qa_testing() (migration 062 drops them).
 */
public final class LotQaTesting {
    /** One QA test of the lot (a media_qualification row). useTestId null = released for every use. */
    public record Qualification(String status, String useTestId, String useTestName, String createdAt) {}

    private final boolean qualificationRequired;
    private final List<Qualification> tests;

    public LotQaTesting(boolean qualificationRequired, List<Qualification> tests) {
        this.qualificationRequired = qualificationRequired;
        this.tests = List.copyOf(tests);
    }

    /**
     * Whether a new lot needs QA testing: the person's choice ("1" or "0"), else the lab's default for its types.
     * Receiving without it when the default asks for it is QA's call.
     */
    public static boolean requiredAtReceipt(String choice, List<String> typesTheLabTests, boolean mayConfigure) {
        boolean dflt = !typesTheLabTests.isEmpty();
        if ("1".equals(choice)) return true;
        if ("0".equals(choice)) {
            if (dflt && !mayConfigure)
                throw RuleException.database("This lab tests " + String.join(", ", typesTheLabTests)
                    + " before use: only QA can receive it without QA testing (inventory.qa_configure)");
            return false;
        }
        return dflt;
    }

    public boolean required() { return qualificationRequired || tests.stream().anyMatch(q -> !"Cancelled".equals(q.status())); }

    /** A failed QA test with no pass since (a retest that passes lifts it). */
    public boolean rejected() {
        return tests.stream().anyMatch(f -> "Failed".equals(f.status())
            && tests.stream().noneMatch(p -> "Passed".equals(p.status()) && p.createdAt().compareTo(f.createdAt()) > 0));
    }

    /** The status in words; null when the lot needs no QA testing. */
    public String status() {
        if (!required()) return null;
        if (rejected()) return has("Testing") ? "Rejected, retest under way" : "Rejected";
        if (tests.stream().anyMatch(q -> "Passed".equals(q.status()) && q.useTestId() == null)) return "Released for every use";
        if (has("Passed")) return "Released for named tests";
        if (has("Testing")) return "In QA testing";
        return "Awaiting QA testing";
    }

    /**
     * Why the lot cannot be used for a test (null: it can). testId null = a use outside a test (e.g. a mixture
     * component), which only a release for every use allows. In its own QA batch it can always be used.
     */
    public String problem(String testId, boolean inItsOwnQaBatch) {
        if (!required() || inItsOwnQaBatch) return null;
        if (rejected()) return "it was rejected in QA testing; it can be used again only if a retest passes (or dispose of it)";
        if (tests.stream().anyMatch(q -> "Passed".equals(q.status()) && (q.useTestId() == null || q.useTestId().equals(testId)))) return null;
        String named = tests.stream().filter(q -> "Passed".equals(q.status()) && q.useTestName() != null).map(Qualification::useTestName).sorted()
            .collect(Collectors.joining(", "));
        if (!named.isEmpty()) return "it is released only for " + named + (testId == null ? ", not for every use" : "");
        if (has("Testing")) return "it is still in QA testing; it can be used once QA approves the test";
        return "it is waiting for QA testing (on the lot's page: Send for QA testing)";
    }

    /** An in-house mixture is made only from lots released for every use. */
    public void assertMixtureComponent(String lotCode, String lotName) {
        String why = problem(null, false);
        if (why != null) throw RuleException.database("Lot " + lotCode + " (" + lotName + ") cannot go into a mixture: " + why);
    }

    /** QA waives the testing of a lot the lab's default asks for, with a reason, before anything is sent for it. */
    public void assertWaivable(String lotCode, String reason) {
        if (reason == null || reason.isBlank()) throw RuleException.database("A reason is required to waive QA testing");
        if (!qualificationRequired) throw RuleException.database("Lot " + lotCode + " does not need QA testing");
        if (tests.stream().anyMatch(q -> !"Cancelled".equals(q.status())))
            throw RuleException.database("Lot " + lotCode + " has been sent for QA testing: its result decides (a rejected lot is retested or disposed of)");
    }

    private boolean has(String status) { return tests.stream().anyMatch(q -> status.equals(q.status())); }
}
