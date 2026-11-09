package com.tentamus.lims.verification.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.junit.jupiter.api.Test;

/**
 * The verification's independent calculation and protocol writer against verification.js: every expected value below was
 * computed with node -e from the Node backend's verification.js (removed since) (formula precedence, exact rationals, rounding, LOQ and LOD
 * reporting, conformance, the steered samples of a small design), plus the Word file's zip structure.
 */
class IndependentCalculationTest {
    private static final ObjectMapper JSON = new ObjectMapper();

    private static String eval(String f, Map<String, Object> v) {
        try {
            Rational r = Calculation.evaluate(f, v);
            return r + "|" + r.approx + "|" + r.num();
        } catch (CalcFailure e) {
            return "ERR|" + e.getMessage();
        }
    }

    @Test
    void formulasFollowOrdinaryPrecedenceAndExactArithmetic() {
        Map<String, Object> ab = Map.of("a.x", "0.1", "b.y", "0.3");
        assertEquals("14|false|14.0", eval("2+3*4", Map.of()));
        assertEquals("512|false|512.0", eval("2^3^2", Map.of()));
        assertEquals("-4|false|-4.0", eval("-2^2", Map.of()));
        assertEquals("1|false|1.0", eval("(1+2)/3", Map.of()));
        assertEquals("33.333333333333|false|33.333333333333336", eval("{a.x}/{b.y}*100", ab));
        assertEquals("3|false|3.0", eval("log10(1000)", Map.of()));
        assertEquals("0.301029995664|true|0.3010299956639812", eval("log10(2)", Map.of()));
        assertEquals("1.414213562373|true|1.4142135623730951", eval("sqrt(2)", Map.of()));
        assertEquals("6|false|6.0", eval("min(3,1,2)+max(4,5)", Map.of()));
        assertEquals("0.25|false|0.25", eval("power(2,-2)", Map.of()));
        assertEquals("0.333333333333|false|0.3333333333333333", eval("1/3", Map.of()));
        assertEquals("2.302585092994|true|2.302585092994046", eval("ln(10)", Map.of()));
        assertEquals("2.718281828459|true|2.718281828459045", eval("exp(1)", Map.of()));
        assertEquals("0.0015|false|0.0015", eval("abs(-1.5e-3)", Map.of()));
    }

    @Test
    void formulaErrorsAreWordedAsNodeWordsThem() {
        assertEquals("ERR|The formula divides by zero with these values", eval("1/0", Map.of()));
        assertEquals("ERR|The formula takes the log or root of a value that is zero or negative", eval("log10(0)", Map.of()));
        assertEquals("ERR|The formula ends too early", eval("2*", Map.of()));
        assertEquals("ERR|\"foo\" is not a known function", eval("foo(2)", Map.of()));
        assertEquals("ERR|No numeric value for {a.x}", eval("{a.x}+1", Map.of()));
        assertEquals("ERR|The formula cannot be read near \"the end\"", eval("(1+2", Map.of()));
    }

    private static Analyte lead() {
        return new Analyte("a1", "Lead", "Numeric", "mg/kg", "0.1", "0.05", null, null, null, null, null, List.of(), List.of("Present"), List.of());
    }

    @Test
    void reportingRoundsAndReportsBelowTheLoqAndLod() {
        Design.Version v = new Design.Version("v", 1, "Draft", "Significant figures", 3, true, "t", "T", "T", "s", "S", "S", null, "h");
        String[][] cases = {{"0.04", "ND", "0.04"}, {"0.07", "< 0.1", "0.07"}, {"12.345", "12.3", "12.35"}, {"0.123456", "0.123", "0.12"},
            {"1234567", "1230000", "1234567.00"}, {"0.0015", "ND", "0.00"}, {"-2.5", "ND", "-2.50"}, {"12.355", "12.4", "12.36"}};
        for (String[] c : cases) {
            assertEquals(c[1], Calculation.reportValue(Rational.of(c[0]), lead(), v), c[0]);
            assertEquals(c[2], Calculation.roundResult(Rational.of(c[0]), "Decimal places", 2), c[0]);
        }
    }

    private static Map<String, Object> spec(String min, String max) { Map<String, Object> s = new HashMap<>(); s.put("min", min); s.put("max", max); return s; }

    @Test
    void conformanceComparesWithTheSpecification() {
        Analyte a = lead();
        assertEquals("Does not conform", Calculation.conformance(spec("1", "10"), a, "< 0.1", null));
        assertEquals("Conforms", Calculation.conformance(spec(null, "10"), a, "< 0.1", null));
        assertEquals("Does not conform", Calculation.conformance(spec(null, "10"), a, "12.0", null));
        assertEquals("Does not conform", Calculation.conformance(spec(null, null), a, null, "Present"));
        assertEquals("No specification", Calculation.conformance(null, a, "1", null));
        assertEquals("Conforms", Calculation.conformance(spec(null, "10"), a, "ND", null));
    }

    @Test
    void rationalsAndDilutions() {
        Map<String, Object> f1 = new LinkedHashMap<>(Map.of("aliquot", "1", "diluent", "9")), f2 = new LinkedHashMap<>(Map.of("aliquot", "2", "diluent", ""));
        assertEquals("10", Calculation.dilutionFactor(List.of(f1, f2)).toString());
        assertEquals("0.0000123", Rational.of("1.23e-5").toString());
        assertEquals("0.1", Rational.fromDouble(0.1).toString());
        assertEquals("123.5", Rational.of("123.456").toInput(4));
        assertEquals("0.000123", Rational.of("0.000123456").toInput(3));
        assertEquals("-1", Rational.of("-0.5").round(0));
        assertEquals("3", Rational.of("2.5").round(0));
        assertEquals("1300", Rational.of("1250").round(-2));
        assertEquals(-3, Rational.of("0.001").log10Floor());
        assertEquals("final_volume_ml", Calculation.fieldKey("  Final Volume (mL) "));
    }

    private static Map<String, Object> cfg(Object... kv) { Map<String, Object> m = new LinkedHashMap<>(); for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]); return m; }

    @Test
    void theProtocolOfASmallDesignMatchesNodes() throws Exception {
        Step weigh = new Step("weigh-id", "weigh", "Weigh", "Weighing", 1, cfg("target", 0.5, "unit", "g"), "Chemistry", 0, List.of("weight"));
        Step dil = new Step("dil-id", "dil", "Dilute", "Dilution", 2, cfg("aliquot", 1L, "diluent", 49L), "Chemistry", 1, List.of("factor", "final_volume"));
        Step read = new Step("read-id", "read", "Read", "Data Entry", 3, cfg("value_unit", "ug/L"), "Chemistry", 2, List.of("reading"));
        Step calc = new Step("calc-id", "calc", "Result", "Calculation", 4, cfg("formula", "{read.reading} * {dil.final_volume} / {weigh.weight} / 1000"), "Chemistry", 3, List.of("result"));
        dil.deps.add("weigh"); read.deps.add("dil"); calc.deps.addAll(List.of("read", "dil", "weigh"));
        List<Analyte> analytes = List.of(
            new Analyte("a1", "Lead", "Numeric", "mg/kg", "0.1", "0.05", null, null, null, "10", null, List.of(), List.of(), List.of()),
            new Analyte("a2", "Cadmium", "Numeric", "mg/kg", "0.02", null, "Decimal places", 2, null, null, null, List.of(), List.of(), List.of()));
        Design d = new Design(new Design.Version("v", 2, "Draft", "Significant figures", 3, true, "t", "Metals", "T1", "s", "CFL", "Lab", null, "h"),
            analytes, List.of(weigh, dil, read, calc), List.of(), Map.of(), new LinkedHashMap<>(), new ArrayList<>());
        ProtocolWriter.Protocol p = new ProtocolWriter(d).build();
        JsonNode expected;
        try (InputStream in = getClass().getResourceAsStream("/verification/protocol_expected.json")) { expected = JSON.readTree(in); }
        assertEquals(expected.get("plan"), JSON.readTree(JsValues.json(p.plan())));
        assertEquals(expected.get("requirements"), JSON.readTree(JsValues.json(p.requirements())));
        assertEquals(expected.get("checks"), JSON.readTree(JsValues.json(p.checks())));
    }

    @Test
    void theWordFileIsAZipOfTheExpectedParts() throws Exception {
        byte[] png = new byte[33];
        byte[] sig = {(byte) 0x89, 'P', 'N', 'G', 13, 10, 26, 10, 0, 0, 0, 13, 'I', 'H', 'D', 'R', 0, 0, 0, 100, 0, 0, 0, 50};
        System.arraycopy(sig, 0, png, 0, sig.length);
        byte[] doc = new WordDocument().title("T & <x>", "sub").h1("1. Purpose", false)
            .table(List.of(List.of("A", "B"), List.of(WordDocument.Run.of("x").bolded(), "y\nz")), new double[] {0.3, 0.7}, 8)
            .image(png, null, null, 9.6, 5.7).build("Footer & co", "LIMS3");
        Map<String, String> parts = new LinkedHashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(doc))) {
            for (ZipEntry e; (e = z.getNextEntry()) != null;) parts.put(e.getName(), new String(z.readAllBytes(), StandardCharsets.ISO_8859_1));
        }
        assertEquals(List.of("[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml", "word/footer1.xml",
            "word/_rels/document.xml.rels", "word/media/image1.png"), new ArrayList<>(parts.keySet()));
        String body = parts.get("word/document.xml");
        assertTrue(body.contains("T &amp; &lt;x&gt;"));
        assertTrue(body.contains("<w:gridCol w:w=\"4320\"/><w:gridCol w:w=\"10080\"/>"));
        assertTrue(body.contains("<w:br/><w:t xml:space=\"preserve\">z</w:t>"));
        assertTrue(body.contains("<wp:extent cx=\"952500\" cy=\"476250\"/>"));
        assertTrue(parts.get("word/_rels/document.xml.rels").contains("Id=\"rImg1\""));
        assertTrue(parts.get("docProps/core.xml").contains("<dc:title>Footer &amp; co</dc:title>"));
    }
}
