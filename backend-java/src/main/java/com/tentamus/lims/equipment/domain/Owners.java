package com.tentamus.lims.equipment.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;

/**
 * Who is responsible for a piece of equipment: groups of its lab and/or named people, at least one. Java's own copy of
 * the database triggers equipment_owner_rules and equipment_owner_required, which stay while purchasing (received
 * equipment) still writes owners directly.
 */
public final class Owners {
    /** A named owner as the check needs them: are they active, and in a group at the equipment's lab. */
    public record Person(String id, String fullName, boolean active, boolean inLab) {}

    private final Equipment equipment;
    private final List<Equipment.LabEntry> groups;
    private final List<Person> people;

    public Owners(Equipment equipment, List<Equipment.LabEntry> groups, List<Person> people) {
        this.equipment = equipment;
        this.groups = groups;
        this.people = people;
    }

    /** Every owner must belong to the equipment's lab, and equipment in use needs at least one. */
    public void check() {
        for (Equipment.LabEntry g : groups) {
            if (!java.util.Objects.equals(g.siteId(), equipment.siteId()))
                throw RuleException.database("Owner group \"" + g.name() + "\" is not a group of this equipment's lab");
            if (!g.active()) throw RuleException.database("Group \"" + g.name() + "\" is Inactive");
        }
        for (Person p : people)
            if (!p.active() || !p.inLab()) throw RuleException.database(p.fullName() + " is not in a group at this lab, so cannot own its equipment");
        if (!equipment.retired() && groups.isEmpty() && people.isEmpty())
            throw RuleException.database(equipment.label() + " needs at least one responsible group or person (owners get its calibration and maintenance warnings)");
    }
}
