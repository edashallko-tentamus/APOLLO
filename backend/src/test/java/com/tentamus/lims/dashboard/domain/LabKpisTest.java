package com.tentamus.lims.dashboard.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.excel.Js;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The Lab Score and the swing flag (0.37.0); expected values worked out with Node's own routes_dashboard.js functions. */
class LabKpisTest {
    @Test
    void labScoreWeightsProratesAndCaps() {
        // this month, 4 of 30 days gone: attainment over 100 % counts as 100
        LabKpis.Score a = LabKpis.score(17, 20, 30000, 50000.0, 40000.0, 4 / 30.0);
        assertEquals(new LabKpis.Score(91.0, 85.0, 100.0, 100.0, false), a);
        LabKpis.Score b = LabKpis.score(17, 20, 3000, 50000.0, 40000.0, 4 / 30.0);
        assertEquals(new LabKpis.Score(72.0, 85.0, 45.0, 56.3, false), b);
        // no budget and a forecast of 0: only samples on time is scored
        assertEquals(new LabKpis.Score(78.0, 77.8, null, null, true), LabKpis.score(7, 9, 12000, null, 0.0, 1));
        assertEquals(new LabKpis.Score(70.0, 66.7, 90.0, null, true), LabKpis.score(2, 3, 9000, 10000.0, null, 1));
        assertEquals(new LabKpis.Score(null, null, null, null, false), LabKpis.score(0, 0, 0, null, null, 1));
    }

    @Test
    void swingOutsideTwoSampleStandardDeviations() {
        List<Double> base = List.of(10.0, 12.0, 11.0, 9.0, 10.0, 13.0, 12.0, 11.0, 10.0, 9.0, 12.0, 11.0);
        LabKpis.Swing high = LabKpis.swing(with(base, 25));
        assertEquals("high", high.flag());
        assertEquals(10.833333333333334, high.mean());
        assertEquals(1.2673044646258476, high.sd());
        assertEquals("10.8", Js.toFixed(high.mean(), 1));
        assertEquals("1.3", Js.toFixed(high.sd(), 1));
        assertEquals("low", LabKpis.swing(with(base, 2)).flag());
        assertEquals("high", LabKpis.swing(with(base, 14)).flag());
        assertEquals("", LabKpis.swing(with(base, 13)).flag());
        assertEquals("", LabKpis.swing(with(base, 9)).flag());
        List<Double> flat = List.of(5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0);
        assertEquals("", LabKpis.swing(with(flat, 5)).flag());
        assertEquals("high", LabKpis.swing(with(flat, 6)).flag());
        assertEquals("0.0", Js.toFixed(LabKpis.swing(with(flat, 5)).sd(), 1));
    }

    private static List<Double> with(List<Double> base, double last) {
        List<Double> l = new java.util.ArrayList<>(base);
        l.add(last);
        return l;
    }
}
