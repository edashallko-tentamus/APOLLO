package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Locale;

/**
 * A split-off request raised by a Split off Test step (e.g. identification of a finding): the customer's decision,
 * Consent given or Declined (a decline says who declined and how), recorded while the request is still open. Replaces
 * decide_split_request and split_request_rules (migration 067); the requests are still raised by the database when a
 * Split off step is completed (make_split_requests), for every writer.
 */
public record SplitRequest(String id, String status) {

    /** Refuses a decision the rules do not allow; returns the note to store (trimmed, empty as none). */
    public String decide(String decision, String note) {
        if (!List.of("Consent given", "Declined").contains(decision)) throw RuleException.database("Record Consent given or Declined");
        if (!List.of("Awaiting consent", "Consent given", "Declined").contains(status))
            throw RuleException.database("This request is already " + status.toLowerCase(Locale.ROOT));
        String n = BenchValue.text(note);
        if ("Declined".equals(decision) && n == null) throw RuleException.database("Note who declined and how (e.g. email from the client)");
        return n;
    }
}
