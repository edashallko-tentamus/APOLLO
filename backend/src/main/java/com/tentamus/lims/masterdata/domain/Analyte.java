package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.Map;

/**
 * An analyte on the static master list (Chemical, Microbiological, Physical/General). Replaces the database's name,
 * report name, CAS and molar mass checks and the report name default (migration 060). Who may change a molar mass, and
 * its signature, are still enforced by the database trigger analyte_molar_mass_rules.
 */
public final class Analyte extends MasterRecord {

    public Analyte(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        requireText("analyte_name", "Analyte name cannot be blank.");
        if (isNew() && blank(values.get("report_name"))) values.put("report_name", values.get("analyte_name"));
        requireText("report_name", "Report name cannot be blank.");
        if (touches("cas_number") || touches("analyte_class")) {
            String cas = text("cas_number");
            if (!CasNumber.isValid(cas)) throw RuleException.withCode("CAS Number is not valid (format or check digit).", "23514");
            if (cas != null && !"Chemical".equals(text("analyte_class")))
                throw RuleException.withCode("Only Chemical analytes can have a CAS Number.", "23514");
        }
        if (isNew() ? value("molar_mass") != null || value("molar_mass_source") != null : changes("molar_mass") || changes("molar_mass_source")) {
            BigDecimal mm = number("molar_mass");
            if (mm != null && mm.signum() <= 0) throw RuleException.withCode("A molar mass must be more than 0 g/mol.", "23514");
            if (value("molar_mass") != null && blank(value("molar_mass_source")))
                throw RuleException.database("Give the source of the molar mass (for example \"IUPAC standard atomic weights 2021\")");
        }
        return values;
    }
}
