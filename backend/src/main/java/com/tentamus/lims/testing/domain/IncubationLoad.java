package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Objects;

/**
 * An incubator load at an Incubation step: the incubator, the entries in it (none: the whole batch), time in and out,
 * the temperature and a note. Times are not in the future and out comes after in; changing what was recorded is a
 * correction with a reason. Replaces incubation_load_rules (migration 067); its window and temperature checks stay a
 * read model (incubation_load_view) for QC Review.
 */
public record IncubationLoad(String equipmentId, List<String> entryIds, Instant timeIn, Instant timeOut, Double temperature, String note, String status) {

    /** An empty list of entries means the whole batch; a blank note is no note. */
    public IncubationLoad normalized() {
        return new IncubationLoad(equipmentId, entryIds == null || entryIds.isEmpty() ? null : entryIds, timeIn, timeOut, temperature, BenchValue.text(note), status);
    }

    /**
     * Refuses a load (or a change to one, when before is not null) the bench rules do not allow.
     *
     * @param inBatch    whether every entry of the load is in the step's batch
     * @param equipment  the incubator, checked when it is new or changed (null otherwise)
     */
    public void check(BenchStep step, IncubationLoad before, boolean inBatch, EquipmentUse equipment, boolean reasonGiven, Instant now) {
        if (!"Incubation".equals(step.stepType())) throw RuleException.database("Incubator loads belong to an Incubation step");
        step.assertWritable();
        if (equipment != null) equipment.check(step);
        if (!inBatch) throw RuleException.database("An entry of the load is not in this batch");
        if (timeOut != null && !timeOut.isAfter(timeIn)) throw RuleException.database("Time out must be after time in");
        Instant limit = now.plus(Duration.ofMinutes(5));
        if (timeIn.isAfter(limit) || (timeOut != null && timeOut.isAfter(limit))) throw RuleException.database("A time cannot be in the future");
        if (before != null && !reasonGiven && corrects(before)) throw RuleException.database("Changing a recorded load is a correction: give the reason");
    }

    /** Whether it changes something already recorded (filling in time out or temperature the first time is not). */
    boolean corrects(IncubationLoad b) {
        return !timeIn.equals(b.timeIn) || (b.timeOut != null && !Objects.equals(timeOut, b.timeOut))
            || (b.temperature != null && !Objects.equals(temperature, b.temperature)) || !equipmentId.equals(b.equipmentId)
            || !Objects.equals(entryIds, b.entryIds) || !status.equals(b.status);
    }
}
