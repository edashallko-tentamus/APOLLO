package com.tentamus.lims.testing.domain.calc;

import java.math.BigDecimal;

/**
 * How one analyte of a test version is reported: rounded as the analyte (else the version) says, "< LOQ" below the
 * LOQ, "ND" below the LOD when the version reports ND. Java's own copy of report_value, which stays in the database for
 * the bench's live results and the COA.
 */
public record AnalyteReporting(BigDecimal loq, BigDecimal lod, boolean ndBelowLod, Rounding rounding) {
    public String report(BigDecimal v) {
        if (v == null) return null;
        if (ndBelowLod && lod != null && v.compareTo(lod) < 0) return "ND";
        if (loq != null && v.compareTo(loq) < 0) return "< " + Rounding.text(loq);
        return Rounding.text(rounding.round(v));
    }
}
