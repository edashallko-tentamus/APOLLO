package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;

/**
 * A unit on the Units list. Records store the unit code, so a unit used on inventory keeps its code, and a unit with
 * active conversions keeps what it measures. Replaces the database trigger unit_rules and the code and name checks
 * (migration 060).
 */
public final class Unit extends MasterRecord {

    public Unit(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        trim("unit_code");
        requireText("unit_code", "Unit code cannot be blank.");
        requireText("unit_name", "Unit name cannot be blank.");
        String code = (String) storedValue("unit_code");
        if (changes("unit_code") && facts.unitUsedOnInventory(code))
            throw RuleException.database("Unit \"" + code + "\" is used on inventory and cannot be renamed. Set it Inactive and add the new one instead.");
        if (changes("dimension") && facts.unitHasActiveConversions((String) storedValue("id")))
            throw RuleException.database("Unit \"" + code + "\" has conversions; set them Inactive before changing what it measures");
        return values;
    }
}
