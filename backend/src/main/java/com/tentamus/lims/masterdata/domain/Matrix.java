package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;

/**
 * A matrix on the controlled Matrix list. Samples store the matrix name, so a matrix in use is never renamed (set it
 * Inactive and add the new name). Replaces the database trigger matrix_rules and the name check (migration 060).
 */
public final class Matrix extends MasterRecord {

    public Matrix(Map<String, Object> stored, Map<String, Object> changes) { super(stored, changes); }

    @Override
    public Map<String, Object> check(MasterFacts facts) {
        trim("matrix_name");
        requireText("matrix_name", "Matrix name cannot be blank.");
        String was = (String) storedValue("matrix_name");
        String now = text("matrix_name");
        // a change of capitals only is allowed: samples match the name ignoring capitals
        if (changes("matrix_name") && !now.equalsIgnoreCase(was) && facts.matrixUsedOnSamples(was))
            throw RuleException.database("Matrix \"" + was + "\" is used on samples and cannot be renamed. Set it Inactive and add the new name instead.");
        return values;
    }
}
