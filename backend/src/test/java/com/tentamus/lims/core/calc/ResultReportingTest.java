package com.tentamus.lims.core.calc;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;
import org.junit.jupiter.api.Test;

/** reportValue and conformance give what verification.js gives (expected values taken with node -e). */
class ResultReportingTest {
    private static String rv(String v, String loq, String lod, String mode, Integer digits, boolean nd) {
        return ResultReporting.reportValue(v, loq, lod, mode, digits, nd, "Significant figures", 3);
    }

    @Test
    void reportedValues() {
        assertEquals("12.3", rv("12.345", null, null, null, null, false));
        assertEquals("0.00123", rv("0.0012345", null, null, null, null, false));
        assertEquals("98800", rv("98765", null, null, null, null, false));
        assertEquals("0.00", rv("0", null, null, null, null, false));
        assertEquals("-1.24", rv("-1.235", null, null, null, null, false));
        assertEquals("3", rv("2.5", null, null, "Decimal places", 0, false));
        assertEquals("< 0.1", rv("0.05", "0.1", "0.03", null, null, false));
        assertEquals("ND", rv("0.01", "0.1", "0.03", null, null, true));
        assertEquals("12.35", rv("12.345", null, null, "Decimal places", 2, false));
    }

    @Test
    void conformance() {
        List<String> found = List.of("Present");
        assertEquals("No specification", ResultReporting.conformance(null, found, "1", null));
        assertEquals("Does not conform", ResultReporting.conformance(new ResultReporting.Spec("90", null), found, "89.9", null));
        assertEquals("Conforms", ResultReporting.conformance(new ResultReporting.Spec("90", "110"), found, "100", null));
        assertEquals("Conforms", ResultReporting.conformance(new ResultReporting.Spec(null, "10"), found, "< 5", null));
        assertEquals("Does not conform", ResultReporting.conformance(new ResultReporting.Spec("1", null), found, "< 5", null));
        assertEquals("Conforms", ResultReporting.conformance(new ResultReporting.Spec(null, "10"), found, "ND", null));
        assertEquals("Does not conform", ResultReporting.conformance(new ResultReporting.Spec(null, null), found, null, "Present"));
        assertEquals("Conforms", ResultReporting.conformance(new ResultReporting.Spec(null, null), found, null, "Absent"));
        assertEquals("Not compared", ResultReporting.conformance(new ResultReporting.Spec("1", null), found, "abc", null));
    }
}
