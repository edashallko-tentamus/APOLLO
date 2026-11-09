package com.tentamus.lims.trending.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The trend chart rules moved out of the database in migration 070 (they were checked by test_037 and test_038). */
class TrendChartRulesTest {
    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static TrendChart chart(String source) {
        TrendChart c = new TrendChart();
        c.id = "c1"; c.code = "TC-0001"; c.siteId = "cfl"; c.name = "TR fridge"; c.source = source; c.params = Map.of("a", 1);
        c.createdBy = "maker"; c.modifiedBy = "maker";
        return c;
    }

    @Test
    void savingAChart() {
        TrendChart c = chart("logbook");
        c.name = "  ";
        assertEquals("Give the chart a name", refusal(() -> c.checkSave(null, "sup")));
        TrendChart q = chart("logbook");
        q.showInReview = true;
        assertEquals("Only QC charts are shown in QC Review", refusal(() -> q.checkSave(null, "sup")));
        TrendChart s = chart("logbook"), moved = s.copy();
        moved.siteId = "tps";
        assertEquals("A chart stays with its lab", refusal(() -> moved.checkSave(s, "sup")));
        TrendChart bad = chart("invoices");
        assertNotNull(refusal(() -> bad.checkSave(null, "sup")));
        TrendChart rules = chart("counts");
        rules.rules = List.of("R1", "R9");
        assertNotNull(refusal(() -> rules.checkSave(null, "sup")));
    }

    @Test
    void frozenLimits() {
        TrendChart s = chart("logbook"), f = s.copy();
        f.frozenCl = 5.0; f.frozenSigma = 0.5; f.frozenN = 1;
        assertTrue(refusal(() -> f.checkSave(s, "sup")).contains("at least 2 points"));
        TrendChart g = s.copy();
        g.frozenCl = 5.0; g.frozenN = 25;
        assertTrue(refusal(() -> g.checkSave(s, "sup")).contains("a sigma"));
        TrendChart h = s.copy();
        h.frozenCl = 5.0; h.frozenSigma = 0.5; h.frozenN = 25;
        h.checkSave(s, "sup");
        assertEquals("sup", h.frozenBy);              // who froze them is recorded
        assertTrue(h.frozenNow());
        TrendChart other = h.copy();
        other.params = Map.of("field_key", "humidity");
        assertTrue(refusal(() -> other.checkSave(h, "sup")).contains("unfreeze them"));
        TrendChart un = h.copy();
        un.frozenCl = null;
        un.checkSave(h, "sup");
        assertNull(un.frozenSigma); assertNull(un.frozenN); assertNull(un.frozenBy);   // unfreezing clears the baseline
    }

    @Test
    void qaReviewAndStatus() {
        TrendChart plain = chart("counts");
        plain.checkSave(null, "sup");
        assertEquals("Not required", plain.qaStatus);
        TrendChart qc = chart("qc");
        qc.qaReview = true;
        qc.checkSave(null, "sup");
        assertEquals("Awaiting QA", qc.qaStatus);
        TrendChart inReview = chart("qc");
        inReview.showInReview = true;
        inReview.checkSave(null, "sup");
        assertTrue(inReview.qaReview);                  // a chart in QC Review is always QA reviewed
        assertEquals("Awaiting QA", inReview.qaStatus);
        TrendChart off = inReview.copy();
        off.qaReview = false;
        assertTrue(refusal(() -> off.checkSave(inReview, "sup")).contains("take it out of QC Review first"));
        TrendChart offPlain = qc.copy();
        offPlain.qaReview = false;
        assertTrue(offPlain.checkSave(qc, "sup"));       // needs trending.approve
        assertEquals("Not required", offPlain.qaStatus);
    }

    @Test
    void qaApproval() {
        TrendChart qc = chart("qc");
        qc.qaReview = true;
        qc.checkSave(null, "maker");
        assertTrue(refusal(() -> qc.copy().approve("maker")).contains("someone else approves"));
        TrendChart a = qc.copy();
        a.approve("qa");
        assertEquals("Approved", a.qaStatus);
        assertEquals("qa", a.qaApprovedBy);
        assertTrue(refusal(() -> a.copy().approve("qa2")).contains("already approved"));
        TrendChart plain = chart("counts");
        plain.checkSave(null, "sup");
        assertTrue(refusal(() -> plain.approve("qa")).contains("not set for QA review"));
        TrendChart retired = qc.copy();
        retired.status = "Inactive";
        assertEquals("A retired chart is not approved", refusal(() -> retired.approve("qa")));
        // a change to what it charts sends it back to QA, the earlier approval cleared
        TrendChart changed = a.copy();
        changed.params = Map.of("a", 2);
        changed.checkSave(a, "sup");
        assertEquals("Awaiting QA", changed.qaStatus);
        assertNull(changed.qaApprovedBy);
        // recording where its limits went is not a change
        TrendChart applied = a.copy();
        assertTrue(refusal(() -> applied.limitsApplied("v", false, "sup")).contains("Draft version"));
        applied.limitsApplied("v", true, "sup");
        assertEquals("Approved", applied.qaStatus);
        assertEquals("v", applied.appliedVersionId);
        // a frozen-limits change waits for QA too; whoever froze them cannot approve
        TrendChart frozen = a.copy();
        frozen.frozenCl = 100.0; frozen.frozenSigma = 4.0; frozen.frozenN = 25;
        frozen.checkSave(a, "fz");
        assertEquals("Awaiting QA", frozen.qaStatus);
        assertTrue(refusal(() -> frozen.approve("fz")).contains("someone else approves"));
    }

    @Test
    void signalReviews() {
        assertNotNull(refusal(() -> new SignalReview("entry-1", "R1", "Action taken", " ").checkedComment()));
        assertNotNull(refusal(() -> new SignalReview("entry-1", "R9", "Action taken", "x").checkedComment()));
        assertEquals("ok", new SignalReview("entry-1", "R1", "Action taken", " ok ").checkedComment());
    }
}
