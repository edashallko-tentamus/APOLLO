package com.tentamus.lims.orders.domain;

import com.tentamus.lims.inventory.domain.Units;
import java.util.List;

/**
 * The controlled lists a sample's values come from: the active matrices and compliance categories, the Units list, and
 * the active serving units (capsule, scoop...).
 */
public record SampleLists(List<String> matrices, List<String> categories, Units units, List<String> servingUnits) {

    /** The entry spelled as the list spells it, ignoring capitals and outer spaces; null when it is not on the list. */
    static String find(List<String> list, String value) {
        String v = value.strip();
        for (String s : list) if (s.equalsIgnoreCase(v)) return s;
        return null;
    }
}
