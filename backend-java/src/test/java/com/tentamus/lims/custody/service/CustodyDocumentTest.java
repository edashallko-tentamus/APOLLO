package com.tentamus.lims.custody.service;

import static org.junit.jupiter.api.Assertions.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** The chain of custody page as custody.js html() wrote it: the manifest rows, the receipt block and the empty boxes. */
class CustodyDocumentTest {
    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> x = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) x.put((String) kv[i], kv[i + 1]);
        return x;
    }

    @Test
    void theManifestAndAReceipt() {
        Map<String, Object> s = m("id", "s1", "sample_code", "CFL261020001", "client_sample_id", "Lot <A>", "description", null, "matrix", "Capsule", "lot", "L1", "metrc_id", null,
            "number_of_units", 3, "quantity", "12.50", "quantity_unit", "g", "serving_count", "2", "serving_count_unit", "capsules", "serving_size", "1.20", "serving_unit", "g",
            "preservation", null, "condition", "Intact", "temperature", "4.0", "logged_at", "2026-10-20T17:00:00.000Z", "tests", "Assay", "receipt", 1);
        Map<String, Object> e = m("n", 1, "sample_ids", List.of("s1"), "by_name", "Intake Tech", "signer_title", "Technician", "signed_at", "2026-10-20T17:05:00.000Z",
            "event_at", "2026-10-20T17:00:00.000Z", "delivered_by", "FedEx", "tracking_no", "1Z", "temperature", "3.80", "temperature_unit", "°C", "thermometer_code", "EQ-1",
            "thermometer_name", "Probe", "condition", "Intact", "seals", "Intact", "note", null, "signature", null);
        Map<String, Object> d = m("coc_code", "COC-LO-000001", "made_at_migration", false, "time_zone", "America/Los_Angeles",
            "lab", m("code", "CFL", "name", "CFL Lab", "address", ""), "client", m("code", "C1", "name", "Acme", "address", "", "contact", "Pat", "email", "", "phone", ""),
            "order", m("id", "o1", "code", "LO-000001", "po", "", "channel", "Portal", "submitted_at", null, "notes", ""), "samples", List.of(s), "receipts", List.of(e), "qr", "<svg/>");
        String h = CustodyDocument.html(d);
        assertTrue(h.contains("<td>Lot &lt;A&gt;<div class=\"sub\">Serving 2 capsules = 1.2 g</div></td>"), h);
        assertTrue(h.contains("<td>12.5 g</td>"));
        assertTrue(h.contains("<div class=\"sub\">Receipt 1</div>"));
        assertTrue(h.contains("<div class=\"sub\">4 °C</div>"));
        assertTrue(h.contains("<tr><td>Samples</td><td>1, 3 container(s)</td></tr>"));
        assertTrue(h.contains("Received by the laboratory: receipt 1 (1 sample)"));
        assertTrue(h.contains("Signed electronically Oct 20, 2026, 10:05 AM PDT"));
        assertTrue(h.contains("<span>Temperature</span>3.8 °C<div class=\"sub\">Thermometer EQ-1 Probe</div>"));
        assertTrue(h.contains("Relinquished by (courier)"));
    }
}
