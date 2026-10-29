package com.tentamus.lims.quotes.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * One version of a project or quote and its status lifecycle: Draft, Submitted for Quote, Quoted, then Accepted,
 * Rejected, Expired or Superseded. Its tests, analytes, rush terms, packages and charges are locked once it is quoted.
 * The status moves are also kept in the database (project_version_lifecycle) because the Node backend still issues and
 * sends quotes and takes the client's answer through the public link; Java checks them first, with the same words.
 */
public record QuoteVersion(String id, String projectId, String clientId, String siteId, String kind, boolean listPriceAcceptance,
                           String status, String validUntil, String notes) {
    public static final String DRAFT = "Draft", SUBMITTED = "Submitted for Quote", QUOTED = "Quoted", ACCEPTED = "Accepted";
    private static final Set<List<String>> MOVES = Set.of(
        List.of(DRAFT, SUBMITTED), List.of(DRAFT, QUOTED), List.of(SUBMITTED, QUOTED), List.of(SUBMITTED, "Rejected"),
        List.of(QUOTED, ACCEPTED), List.of(QUOTED, "Rejected"), List.of(QUOTED, "Expired"),
        List.of(ACCEPTED, "Superseded"), List.of(ACCEPTED, "Expired"));

    /**
     * What a status move needs to know about the version's contents.
     *
     * @param activeLines         its active test lines
     * @param linesWithoutPrice   active lines with no final price
     * @param acceptorIsContact   the accepting contact is an active contact of the client (Accepted only)
     */
    public record Readiness(int activeLines, int linesWithoutPrice, boolean acceptorIsContact) {}

    /** Draft and Submitted for Quote may still be changed (version_is_editable). */
    public boolean editable() { return DRAFT.equals(status) || SUBMITTED.equals(status); }

    public boolean isStability() { return "Stability".equals(kind); }

    /** Refuses a change to a part of the version once it is quoted, with that part's own words. */
    public void requireEditable(String lockedMessage) {
        if (!editable()) throw RuleException.database(lockedMessage);
    }

    /** The validity date and notes of a quoted (or later) version stay as they are. */
    public void checkDetails(Map<String, Object> vals) {
        if (editable()) return;
        boolean changed = (vals.containsKey("valid_until") && !Objects.equals(text(vals.get("valid_until")), validUntil))
            || (vals.containsKey("notes") && !Objects.equals(text(vals.get("notes")), notes));
        if (changed) throw RuleException.database("A " + status + " project version is locked; create a new version to change it");
    }

    /**
     * A move to another status: only the allowed moves; quoting needs priced tests; accepting needs an unexpired quote
     * and an active contact of the client.
     *
     * @param validUntil the validity date the version will have (yyyy-MM-dd or null)
     */
    public void checkMove(String to, String validUntil, Readiness r, LocalDate today) {
        if (Objects.equals(to, status)) return;
        if (!MOVES.contains(List.of(status, String.valueOf(to))))
            throw RuleException.database("Project version cannot move from " + status + " to " + to);
        if (QUOTED.equals(to)) {
            if (r.activeLines() == 0) throw RuleException.database("Cannot quote a project version with no tests");
            if (r.linesWithoutPrice() > 0) throw RuleException.database("Every test line needs a Final Price before the version can be quoted");
        }
        if (ACCEPTED.equals(to)) {
            if (validUntil != null && LocalDate.parse(validUntil).isBefore(today))
                throw RuleException.database("Quote expired on " + validUntil + "; it cannot be accepted");
            if (!r.acceptorIsContact()) throw RuleException.database("Quote must be accepted by an active contact of this client");
        }
    }

    private static String text(Object v) { return v == null || "".equals(v) ? null : v.toString(); }
}
