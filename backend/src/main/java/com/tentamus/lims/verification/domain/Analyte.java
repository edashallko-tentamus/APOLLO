package com.tentamus.lims.verification.domain;

import java.util.List;

/** An analyte of the version being verified, with how it is reported (the design's test_version_analyte). */
public final class Analyte {
    public final String id, name, resultType, reportingUnit, loq, lod, roundingMode, defaultSpecMin, defaultSpecMax, defaultSpecText;
    public final Integer roundingDigits;
    /** Readings that are not results (migration 039) are already left out of resultValues. */
    public final List<String> resultValues, foundValues, invalidValues;

    public Analyte(String id, String name, String resultType, String reportingUnit, String loq, String lod, String roundingMode, Integer roundingDigits,
                   String defaultSpecMin, String defaultSpecMax, String defaultSpecText, List<String> resultValues, List<String> foundValues, List<String> invalidValues) {
        this.id = id; this.name = name; this.resultType = resultType; this.reportingUnit = reportingUnit; this.loq = loq; this.lod = lod;
        this.roundingMode = roundingMode; this.roundingDigits = roundingDigits; this.defaultSpecMin = defaultSpecMin; this.defaultSpecMax = defaultSpecMax;
        this.defaultSpecText = defaultSpecText; this.foundValues = foundValues; this.invalidValues = invalidValues;
        this.resultValues = resultValues.stream().filter(x -> !invalidValues.contains(x)).toList();
    }

    public boolean numeric() { return "Numeric".equals(resultType); }

    /** The first value that is not a finding, else the fallback. */
    public String notFound(String fallback) {
        for (String v : resultValues) if (!foundValues.contains(v)) return v;
        return fallback;
    }
}
