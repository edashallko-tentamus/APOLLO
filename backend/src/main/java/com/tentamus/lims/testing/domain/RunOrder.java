package com.tentamus.lims.testing.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The run order of a batch: once-per-batch analytical QC, the first bracket, prep QC (blanks, LCS), then the samples with
 * a bracket after every N and each matrix spike after its sample, then the last brackets. Brackets ("every N" QC) are
 * labelled CCV-1, CCV-2... and go in groups by their number. Java's copy of batch_order(), which stays in the database
 * for create_batch (the demo data load and Node's automated verification run).
 */
public final class RunOrder {
    private static final Pattern BRACKET = Pattern.compile("-([0-9]+)$");

    /** An entry as the run order sees it (position is its current one, which breaks ties). */
    public record Slot(String id, String entryType, String qcClass, String qcType, String label, String parentId, boolean active, int position) {
        boolean qc() { return "QC".equals(entryType); }

        Integer bracket() {
            Matcher m = BRACKET.matcher(label);
            return m.find() ? Integer.valueOf(m.group(1)) : null;
        }
    }

    private RunOrder() {}

    /**
     * The new position of every entry it places (entries it does not place keep theirs).
     *
     * @param everyN the smallest "every N" of the Batching step's QC, or null when it has none
     */
    public static Map<String, Integer> positions(List<Slot> entries, Integer everyN) {
        Comparator<Slot> byPos = Comparator.comparingInt(Slot::position);
        Comparator<Slot> byPosLabel = byPos.thenComparing(Slot::label);
        Integer groups = entries.stream().filter(e -> e.qc() && e.active() && e.bracket() != null).map(Slot::bracket).max(Integer::compare).orElse(null);
        Map<String, Integer> out = new LinkedHashMap<>();
        int[] pos = {0};
        java.util.function.Consumer<Slot> place = e -> out.put(e.id(), ++pos[0]);
        sorted(entries, e -> e.qc() && "Analytical".equals(e.qcClass()) && e.bracket() == null, byPosLabel).forEach(place);
        int gi = 1;
        if (groups != null) {
            group(entries, 1).forEach(place);
            gi = 2;
        }
        sorted(entries, e -> e.qc() && "Prep".equals(e.qcClass()) && e.parentId() == null && e.bracket() == null, byPosLabel).forEach(place);
        int sn = 0;
        for (Slot s : sorted(entries, e -> "Sample".equals(e.entryType()), byPos)) {
            place.accept(s);
            sn++;
            sorted(entries, e -> s.id().equals(e.parentId()), Comparator.comparing(Slot::qcType, Comparator.nullsLast(Comparator.naturalOrder())).thenComparing(byPos)).forEach(place);
            if (groups != null && everyN != null && sn % everyN == 0 && gi < groups) group(entries, gi++).forEach(place);
        }
        while (groups != null && gi <= groups) group(entries, gi++).forEach(place);
        return out;
    }

    private static List<Slot> group(List<Slot> entries, int gi) {
        return sorted(entries, e -> e.qc() && e.active() && Integer.valueOf(gi).equals(e.bracket()), Comparator.comparingInt(Slot::position));
    }

    private static List<Slot> sorted(List<Slot> entries, java.util.function.Predicate<Slot> which, Comparator<Slot> order) {
        List<Slot> out = new ArrayList<>(entries.stream().filter(which).toList());
        out.sort(order);
        return out;
    }
}
