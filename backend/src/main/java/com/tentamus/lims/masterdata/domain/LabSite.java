package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * A lab (site): its code, time zone and the settings with limits. Replaces the database trigger lab_site_check_tz and
 * the checks on the code and the ranges (migration 060). The per-lab rows other modules make for a new lab are still
 * made by their database triggers.
 */
public final class LabSite extends MasterRecord {
    private static final Pattern CODE = Pattern.compile("^[A-Z0-9]{2,6}$");

    public LabSite(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        if (touches("site_code") && (text("site_code") == null || !CODE.matcher(text("site_code")).matches()))
            throw RuleException.withCode("A lab code is 2 to 6 capital letters or digits (e.g. CFL).", "23514");
        if (touches("time_zone") && !facts.isTimeZone(text("time_zone")))
            throw RuleException.database("Unknown time zone \"" + text("time_zone") + "\". Use a name like America/Los_Angeles or America/New_York");
        range("subcontract_discount_pct", 0, 100, false, "The subcontract discount must be at least 0 % and below 100 %.");
        range("subcontract_markup_pct", 0, 500, true, "The subcontract markup must be from 0 % to 500 %.");
        range("stability_pull_window_days", 0, 90, true, "The stability pull window must be from 0 to 90 days.");
        range("stability_reserve_pct", 0, 200, true, "The stability reserve must be from 0 % to 200 %.");
        return values;
    }

    /** Only values being written are checked; an empty value is left to the column's default. */
    private void range(String col, int min, int max, boolean maxIncluded, String message) {
        if (!values.containsKey(col) || values.get(col) == null) return;
        BigDecimal v = number(col);
        if (v == null) return;
        int top = v.compareTo(BigDecimal.valueOf(max));
        if (v.compareTo(BigDecimal.valueOf(min)) < 0 || top > 0 || (!maxIncluded && top == 0)) throw RuleException.withCode(message, "23514");
    }
}
