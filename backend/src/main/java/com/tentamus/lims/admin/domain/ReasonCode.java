package com.tentamus.lims.admin.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.masterdata.domain.MasterFacts;
import com.tentamus.lims.masterdata.domain.MasterRecord;
import java.util.List;
import java.util.Map;

/**
 * A canned reason, offered in the Reason for Change box of its module's pages (General ones everywhere). Replaces the
 * database's module and text checks on reason_code (migration 060). A new module goes in {@link #MODULES}.
 */
public final class ReasonCode extends MasterRecord {
    public static final List<String> MODULES = List.of("General", "Clients", "Orders", "Quotes", "Catalog", "Inventory", "Equipment", "Purchasing",
        "Methods", "Testing", "Reports", "COA comments", "Logbooks", "Invoicing", "Stability", "Trending", "Admin");

    public ReasonCode(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        if (touches("module") && !MODULES.contains(text("module")))
            throw RuleException.withCode("Reasons belong to a known module: " + String.join(", ", MODULES) + ".", "23514");
        requireText("reason_text", "The reason cannot be blank.");
        return values;
    }
}
