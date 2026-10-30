package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Objects;

/**
 * Moving equipment to another lab with its history: the receiving lab gets it tagged out for Qualification, owned by
 * one of its groups and in one of its departments. Replaces the database action transfer_equipment and the trigger
 * equipment_transfer_rules (migration 064 drops them).
 */
public record Transfer(Equipment equipment, String toSiteId, String fromSiteCode, String toSiteCode, String notes) {

    /**
     * Checks the transfer.
     *
     * @param ownerGroup the group of the receiving lab named to be responsible for it, or null
     * @param department the receiving lab's department it will belong to, or null
     */
    public void check(Equipment.LabEntry ownerGroup, Equipment.LabEntry department) {
        equipment.assertNotRetired();
        if (Objects.equals(toSiteId, equipment.siteId())) throw RuleException.database("Pick another lab");
        if (ownerGroup == null || !ownerGroup.activeIn(toSiteId)) throw RuleException.database("Name a group of the receiving lab to be responsible for it");
        if (department == null || !department.activeIn(toSiteId)) throw RuleException.database("Pick the department of the receiving lab it will belong to");
    }

    /** The Reason for Change written on the moved records when the person gave none. */
    public String reason() {
        String n = Fields.trimmed(notes);
        return "Transferred to " + toSiteCode + (n == null ? "" : ": " + n);
    }

    public String tagNote() { return "Transferred in from " + fromSiteCode + ": qualify before use"; }

    /** The description of the type added to the receiving lab's list when it has none of that name. */
    public String typeNote() { return "Added when " + equipment.code() + " was transferred in"; }
}
