package com.tentamus.lims.oos.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.web.RuleException;
import java.util.List;

/** A section of an OOS checklist (QA's items): every active item answered Yes, No or N/A, and a "No" explained. */
public final class Checklist {
    private Checklist() {}

    public record Item(String id, String text) {}

    /** @param items the section's active items in order; answers: {itemId: {answer, comment}} */
    public static void check(String section, List<Item> items, JsonNode answers) {
        for (Item i : items) {
            JsonNode a = answers == null ? null : answers.get(i.id());
            String answer = a == null || a.get("answer") == null || a.get("answer").isNull() ? "" : a.get("answer").asText();
            if (!List.of("Yes", "No", "N/A").contains(answer))
                throw RuleException.database("Answer every item of the " + section.toLowerCase() + " section (Yes, No or N/A): \"" + i.text() + "\"");
            String comment = a.get("comment") == null || a.get("comment").isNull() ? "" : a.get("comment").asText().strip();
            if ("No".equals(answer) && comment.isEmpty()) throw RuleException.database("Explain the \"No\" for: \"" + i.text() + "\"");
        }
    }
}
