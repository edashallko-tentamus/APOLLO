package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.List;

/**
 * A lot used at a step (for an entry, or the whole batch): this lab's, received, available, in date and not past retest;
 * a strain is a Microbiological Strain lot of one of the test's organisms; the amount used and its unit are required
 * (it comes off the lot's stock, in the lot's unit). A recorded use is never edited: it is removed and added again.
 * Replaces entry_material_rules (migration 067). Media and logbook lots keep their own database rules (QA testing,
 * logbooks), and the stock movement is still written by the database (entry_material_stock) for every writer.
 *
 * @param lotCode       the lot's ID (INV-...)
 * @param lotSiteId     the lot's lab
 * @param organismsOk   for a strain naming organisms: whether one of them is on the test (true when it names none)
 * @param convertible   whether the amount's unit converts to the lot's unit
 */
public record MaterialUse(BenchStep step, BatchEntry entry, String purpose, Double amount, String amountUnit,
                          String lotCode, String lotSiteId, String receiptStatus, String lotStatus, LocalDate expires, LocalDate retestDue,
                          List<String> chemicalTypes, String lotUnit, boolean organismsOk, boolean convertible) {

    /** Refuses a use the bench rules do not allow (amountUnit already in the Units list's spelling). */
    public void check(LocalDate labToday) {
        if (entry != null) entry.assertIn(step.batch().id());
        step.assertWritable();
        if (!lotSiteId.equals(step.batch().siteId())) throw RuleException.database("Lot " + lotCode + " belongs to another lab");
        if (!"Received".equals(receiptStatus)) throw RuleException.database("Lot " + lotCode + " has not been received");
        if (!"Available".equals(lotStatus)) throw RuleException.database("Lot " + lotCode + " is " + lotStatus + " and cannot be used");
        if (expires != null && expires.isBefore(labToday)) throw RuleException.database("Lot " + lotCode + " expired on " + expires + " and cannot be used");
        if (retestDue != null && retestDue.isBefore(labToday)) throw RuleException.database("Lot " + lotCode + " was due for retest on " + retestDue + " and cannot be used");
        if ("Strain".equals(purpose)) {
            if (!chemicalTypes.contains("Microbiological Strain")) throw RuleException.database("Lot " + lotCode + " is not a Microbiological Strain");
            if (!organismsOk) throw RuleException.database("Strain " + lotCode + " is not one of this test's organisms");
        }
        if (amount == null || amountUnit == null)
            throw RuleException.database("Enter the amount of " + lotCode + " used (and its unit): it is taken off the lot's stock");
        if (!convertible) throw RuleException.database("Lot " + lotCode + " is counted in " + lotUnit + "; " + amountUnit + " cannot be converted to it");
    }

    /** Taking a recorded use off (its stock goes back): only while the step is open, by someone who may work on it. */
    public static void assertRemovable(BenchStep step) { step.assertWritable(); }

    /** A recorded use changes only by being taken off; anything else is removed and added again. */
    public static void assertChange(boolean onlyTakenOff) {
        if (!onlyTakenOff) throw RuleException.database("Remove the material and add the right one");
    }
}
