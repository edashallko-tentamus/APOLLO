package com.tentamus.lims.testing.domain.calc;

import java.math.BigDecimal;

/** The Units list as the calculation engine needs it (the repository gives it from the unit and conversion tables). */
public interface UnitConverter {
    /** How many [to] in one [from], or null when the tables cannot convert (unit_factor with no form). */
    BigDecimal factor(String from, String to);

    /** The unit's dimension (Mass, Volume...), or null when it is not on the list (unit_dimension_of). */
    String dimension(String unit);
}
