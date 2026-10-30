package com.tentamus.lims.stability.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;

/**
 * QA's assessment of a chamber excursion for one study (signed, justified); a new one replaces the earlier one. Replaces
 * the function assess_stability_excursion and the justification check (migration 070).
 */
public record ExcursionAssessment(String studyCode, boolean isExcursionOfStudy, String decision, String justification) {
    public static final List<String> DECISIONS = List.of("No impact", "Impact: results flagged", "Client to decide");

    /** Refuses an assessment the rules do not allow; returns the justification to store (trimmed). */
    public String check() {
        if (!isExcursionOfStudy) throw RuleException.database("That reading is not an excursion of study " + studyCode);
        if (decision == null || !DECISIONS.contains(decision)) throw RuleException.database("Choose No impact, Impact (results flagged) or Client to decide");
        String j = justification == null ? "" : justification.strip();
        if (j.isEmpty()) throw RuleException.database("Justify the assessment");
        return j;
    }
}
