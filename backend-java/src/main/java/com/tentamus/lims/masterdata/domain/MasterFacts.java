package com.tentamus.lims.masterdata.domain;

/** What a list's rules need to know beyond the row itself (answered from the database by the repository). */
public interface MasterFacts {
    boolean matrixUsedOnSamples(String matrixName);

    boolean unitUsedOnInventory(String unitCode);

    boolean unitHasActiveConversions(String unitId);

    /** The unit's dimension (Mass, Volume...), or null when there is no such unit. */
    String unitDimension(String unitId);

    boolean isTimeZone(String name);
}
