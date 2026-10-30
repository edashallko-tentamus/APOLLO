package com.tentamus.lims.methods.domain;

import java.util.List;

/** What the design review looks up outside the version (the lab's lists and other records); the repository answers it. */
public interface DesignFacts {
    /** A method's status, or null when there is none. */
    String methodStatus(String methodId);

    String departmentName(String departmentId);

    boolean departmentHasPeople(String departmentId);

    boolean priced(String testId);

    boolean qcType(String qcType);

    /** The shape of a QC limit type (Range, Max, Qualitative), or null when it is not one. */
    String limitShape(String limitType);

    /** A product category's name (any status), or null. */
    String categoryName(String categoryId);

    boolean categoryActive(String categoryId);

    /** Any analyte's name, or null. */
    String analyteName(String analyteId);

    /** Another test (for split-offs and hold points), or null. */
    TestDefinition test(String testId);

    /** The values logbooks publish to formulas at the test's lab. */
    List<String> publishedKeys();
}
