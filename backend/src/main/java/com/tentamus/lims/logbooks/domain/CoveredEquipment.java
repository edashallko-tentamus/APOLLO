package com.tentamus.lims.logbooks.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Iterator;
import java.util.Map;

/**
 * A piece of equipment covered by an equipment logbook, with its own limits per field. Replaces the rule part of the
 * database trigger logbook_equipment_rules (migration 070).
 *
 * @param subject       what the logbook is about
 * @param equipmentSite the equipment's lab
 * @param retired       whether the equipment is retired
 * @param limits        the limits per field ({"temperature": {"min": 2, "max": 8}}), or null when not changed
 */
public record CoveredEquipment(String logbookCode, String subject, String logbookSite, String equipmentCode, String equipmentSite, boolean retired, JsonNode limits) {
    /** Checks a new row (isNew) or a change of its limits. */
    public void check(boolean isNew) {
        if (!"Equipment".equals(subject)) throw RuleException.database(logbookCode + " is not a logbook about equipment");
        if (!logbookSite.equals(equipmentSite)) throw RuleException.database(equipmentCode + " belongs to another lab");
        if (isNew && retired) throw RuleException.database(equipmentCode + " is retired");
        if (limits == null) return;
        if (!limits.isObject()) throw RuleException.database("Limits are given per field: {\"temperature\": {\"min\": 2, \"max\": 8}}");
        for (Iterator<Map.Entry<String, JsonNode>> it = limits.fields(); it.hasNext(); ) {
            Map.Entry<String, JsonNode> e = it.next();
            JsonNode lo = e.getValue().get("min"), hi = e.getValue().get("max");
            if (lo != null && !lo.isNull() && hi != null && !hi.isNull() && new BigDecimal(lo.asText()).compareTo(new BigDecimal(hi.asText())) > 0)
                throw RuleException.database(equipmentCode + " (" + e.getKey() + "): the lower limit is above the upper limit");
        }
    }
}
