package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Locale;

/**
 * A piece of equipment used at a step (an instrument, a balance, an incubator): this lab's, available, not out of
 * calibration, of a type the step uses when it names types, and for an analytical run that exists. Replaces
 * entry_equipment_rules, analytical_run_no_rules and the equipment part of incubation_load_rules (migration 067).
 *
 * @param availability      Available, Tagged out...
 * @param taggedFor         why it is tagged out, or null
 * @param calibrationStatus Deficient when out of calibration
 * @param stepTypes         the equipment types the step uses (empty: any)
 */
public record EquipmentUse(String code, String siteId, String availability, String taggedFor, String calibrationStatus,
                           String typeId, String typeName, List<String> stepTypes) {

    /** Refuses equipment that may not be used at this step. */
    public void check(BenchStep step) {
        if (!siteId.equals(step.batch().siteId())) throw RuleException.database(code + " belongs to another lab");
        if (!"Available".equals(availability))
            throw RuleException.database(code + " is " + availability.toLowerCase(Locale.ROOT) + " and cannot be used" + (taggedFor == null ? "" : " (" + taggedFor + ")"));
        if ("Deficient".equals(calibrationStatus)) throw RuleException.database(code + " is out of calibration and cannot be used");
        if (!stepTypes.isEmpty() && !stepTypes.contains(typeId)) throw RuleException.database(code + " is a " + typeName + ", which this step does not use");
    }

    /** Equipment and raw data files belong to an analytical run that exists at the step. */
    public static void assertRunExists(int runNo, int runs) {
        if (runNo > runs) throw RuleException.database("Analytical run " + runNo + " does not exist at this step");
    }
}
