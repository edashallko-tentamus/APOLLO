package com.tentamus.lims.verification.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A test version's design as the verification reads it (verification.js loadDesign): analytes, steps in the bench's
 * order, the calculations (the final one last), QC criteria, the logbook lots the calculations read; and the
 * independent calculation of one entry from the values a run enters.
 */
public final class Design {
    private static final Pattern PLAIN = Pattern.compile("^\\s*-?[0-9]*\\.?[0-9]+\\s*$");

    /** The version itself. */
    public record Version(String id, Object versionNo, String status, String roundingMode, int roundingDigits, boolean ndBelowLod,
                          String testId, String testName, String testCode, String siteId, String siteCode, String siteName, String methodName, String hash) {}

    public final Version version;
    public final List<Analyte> analytes;
    public final List<Step> steps;
    public final Map<String, Step> byKey = new LinkedHashMap<>();
    public final List<Step> calcs, order = new ArrayList<>();
    public final String finalCalc;
    /** qc_criteria(version): {qc_type, qc_class, limit_type, shape, analyte_id, analyte_name, applies, min_value, max_value, limit_ref}. */
    public final List<Map<String, Object>> qc;
    private final Map<String, String> testNames;
    /** step key -> analyte id -> field -> the lot the run scans {lot_id, lot_code, item_name, entry_id, entry_code, logbook_code, value, valid_until}. */
    public final Map<String, Object> material;
    public final List<String> materialTokens;

    public Design(Version version, List<Analyte> analytes, List<Step> steps, List<Map<String, Object>> qc, Map<String, String> testNames,
                  Map<String, Object> material, List<String> materialTokens) {
        this.version = version; this.analytes = analytes; this.steps = steps; this.qc = qc; this.testNames = testNames;
        this.material = material; this.materialTokens = materialTokens;
        for (Step s : steps) byKey.put(s.key, s);
        Map<String, Set<String>> anc = new LinkedHashMap<>();
        for (Step s : steps) s.ancestors = new ArrayList<>(ancestors(s.key, anc));
        List<Step> c = new ArrayList<>(steps.stream().filter(s -> s.is("Calculation")).toList());
        c.sort(Comparator.comparingInt((Step s) -> s.nAncestors).thenComparingInt(s -> s.sortOrder));
        this.calcs = c;
        List<Step> last = new ArrayList<>(c);
        last.sort(Comparator.comparingInt((Step s) -> -s.nAncestors).thenComparingInt(s -> -s.sortOrder));
        this.finalCalc = last.isEmpty() ? null : last.get(0).key;
        Set<String> done = new HashSet<>();
        for (Step s : steps) visit(s, done);
    }

    private Set<String> ancestors(String k, Map<String, Set<String>> anc) {
        if (anc.containsKey(k)) return anc.get(k);
        Set<String> out = new LinkedHashSet<>();
        Step s = byKey.get(k);
        for (String d : s == null ? List.<String>of() : s.deps) { out.add(d); out.addAll(ancestors(d, anc)); }
        anc.put(k, out);
        return out;
    }

    // the order the bench works in: dependencies first, then the designer's order
    private void visit(Step s, Set<String> done) {
        if (!done.add(s.key)) return;
        for (String d : s.deps) if (byKey.containsKey(d)) visit(byKey.get(d), done);
        order.add(s);
    }

    public String testName(Object id) {
        String n = id == null ? null : testNames.get(id.toString());
        return n == null || n.isEmpty() ? "the other test" : n;
    }

    public Step batching() { return steps.stream().filter(s -> s.is("Batching")).findFirst().orElse(null); }

    /** A calculation's formula for the analyte (its own formula when it has one). */
    public static Object formulaFor(Step calc, String analyteId) {
        for (Object o : calc.cfgList("overrides")) {
            Map<String, Object> m = JsValues.map(o);
            if (analyteId.equals(m.get("analyte_id"))) return com.tentamus.lims.core.excel.Js.truthy(m.get("formula")) ? m.get("formula") : formulaOf(calc);
        }
        return formulaOf(calc);
    }

    private static Object formulaOf(Step calc) { return calc.config.containsKey("formula") ? calc.config.get("formula") : JsValues.UNDEFINED; }

    /** QC Review steps set to Timepoint that come before the final calculation and after another calculation. */
    public List<Step> timepointSteps() {
        return steps.stream().filter(s -> s.is("QC Review") && s.scope().equals("Timepoint")
            && !(finalCalc != null && s.ancestors.contains(finalCalc))
            && s.ancestors.stream().anyMatch(k -> byKey.get(k).is("Calculation") && !k.equals(finalCalc))).toList();
    }

    public List<String> timepointKeys(Step s) {
        List<Step> l = new ArrayList<>(steps.stream().filter(x -> s.ancestors.contains(x.key) && x.is("Calculation") && !x.key.equals(finalCalc)).toList());
        l.sort(Comparator.comparingInt(x -> x.sortOrder));
        return l.stream().map(x -> x.key).toList();
    }

    /** The Data Entry step whose reading moves the analyte's final result (the latest one the final formula reaches). */
    public Step steeringStep(Analyte a) {
        if (finalCalc == null || !a.numeric()) return null;
        Set<String> seen = new HashSet<>();
        List<Step> reads = new ArrayList<>();
        walk(finalCalc, a, seen, reads);
        reads.sort(Comparator.comparingInt((Step x) -> -x.sortOrder));
        return reads.isEmpty() ? null : reads.get(0);
    }

    private void walk(String calcKey, Analyte a, Set<String> seen, List<Step> reads) {
        if (!seen.add(calcKey)) return;
        for (String tok : Calculation.formulaTokens(formulaFor(byKey.get(calcKey), a.id))) {
            String k = tok.split("\\.")[0];
            Step ref = byKey.get(k);
            if (ref == null) continue;
            if (ref.is("Data Entry") && ref.reads(a.id)) reads.add(ref);
            if (ref.is("Calculation")) walk(k, a, seen, reads);
        }
    }

    // ------------------------------------------------------------ the independent calculation of one entry

    /** One calculation's outcome for an entry and analyte. */
    public record Calc(Rational value, String error, Object formula, Map<String, String> inputs) {}

    /** The final (reported) result of an entry and analyte, and what it is waiting for when there is none. */
    public record Final(Rational value, String valueText, String reported, String waiting) {}

    public record Entry(Map<String, Calc> calcs, Final fin) {}

    /** Every analyte of an entry. batchInputs: {prep, inc, mat}; inputs: {weigh, dil, plates, read}. */
    public Map<String, Entry> calculateEntry(Map<String, Object> batchInputs, Map<String, Object> inputs) {
        Map<String, Entry> out = new LinkedHashMap<>();
        for (Analyte a : analytes) out.put(a.id, calculate(batchInputs, inputs, a));
        return out;
    }

    private static Map<String, Object> sub(Map<String, Object> m, String k) { return m == null ? null : m.get(k) instanceof Map<?, ?> ? JsValues.map(m.get(k)) : null; }

    private static Object get(Map<String, Object> m, String k) { return m == null ? null : m.get(k); }

    public Entry calculate(Map<String, Object> batchInputs, Map<String, Object> inputs, Analyte a) {
        Map<String, Object> read = sub(inputs, "read");
        if (calcs.isEmpty() || !a.numeric()) {
            // no calculation, or a qualitative / text / count result: the result is the last reading of the analyte
            Step de = steps.stream().filter(s -> s.is("Data Entry") && s.reads(a.id)).max(Comparator.comparingInt(s -> s.sortOrder)).orElse(null);
            Object raw = de == null ? null : get(sub(read, de.key), a.id);
            String rawText = raw == null ? null : JsValues.str(raw);
            Final f;
            if (a.numeric()) {
                Rational v = raw == null ? null : Rational.of(raw);
                f = new Final(v, null, v != null ? Calculation.reportValue(v, a, version) : null, v != null ? null : "no reading");
            } else f = new Final(null, rawText, rawText, com.tentamus.lims.core.excel.Js.truthy(raw) ? null : "no reading");
            return new Entry(new LinkedHashMap<>(), f);
        }
        Map<String, Calc> calc = new LinkedHashMap<>();
        for (Step cs : calcs) {
            Object f = formulaFor(cs, a.id);
            Map<String, Object> vals = new LinkedHashMap<>();
            List<String> miss = new ArrayList<>();
            for (String tok : Calculation.formulaTokens(f)) {
                String[] p = tok.split("\\.", 2);
                String k = p[0], fld = p.length > 1 ? p[1] : "";
                Step ref = byKey.get(k);
                Object v = null;
                if (ref == null) { miss.add("{" + tok + "}"); continue; }
                if (!fld.isEmpty() && !ref.baseFields.contains(fld)) {
                    // a value published by the logbook entry of the lot the protocol scans at that step (L-2)
                    Object m = get(sub(sub(sub(batchInputs, "mat"), k), a.id), fld);
                    v = m == null ? null : JsValues.map(m).get("value");
                    if (v == null) { miss.add("{" + tok + "} (no usable lot at the lab publishes " + fld + " for " + a.name + ")"); continue; }
                    vals.put(tok, Rational.of(v));
                    continue;
                }
                switch (ref.type) {
                    case "Weighing" -> v = get(sub(inputs, "weigh"), k);
                    case "Dilution" -> {
                        Object fl = get(sub(inputs, "dil"), k);
                        if (fl instanceof List<?> l) v = fld.equals("factor") ? Calculation.dilutionFactor(l) : Calculation.dilutionFinalVolume(l);
                        else if (fl != null) v = null;
                    }
                    case "Preparation" -> {
                        Object x = get(sub(sub(batchInputs, "prep"), k), fld);
                        v = x != null && PLAIN.matcher(JsValues.str(x)).matches() ? JsValues.str(x) : null;
                    }
                    case "Incubation" -> v = get(sub(sub(batchInputs, "inc"), k), "duration");
                    case "Data Entry" -> v = ref.reads(a.id) ? get(sub(read, k), a.id) : null;
                    case "Calculation" -> v = calc.containsKey(k) ? calc.get(k).value() : null;
                    case "Hold Point" -> { miss.add("{" + tok + "} (waits for " + testName(ref.cfg("test_id")) + ")"); continue; }
                    default -> v = null;
                }
                if (v == null) miss.add("{" + tok + "}");
                else vals.put(tok, v instanceof Rational r ? r : Rational.of(v));
            }
            Rational value = null;
            String error = null;
            if (miss.isEmpty()) {
                try { value = Calculation.evaluate(f, vals); } catch (RuntimeException e) { error = e.getMessage(); }
            } else error = "Waiting for " + String.join(", ", miss);
            Map<String, String> used = new LinkedHashMap<>();
            for (Map.Entry<String, Object> e : vals.entrySet()) used.put(e.getKey(), e.getValue().toString());
            calc.put(cs.key, new Calc(value, error, f, used));
        }
        Calc fin = finalCalc == null ? null : calc.get(finalCalc);
        Final f = fin != null && fin.value() != null ? new Final(fin.value(), null, Calculation.reportValue(fin.value(), a, version), null)
            : new Final(null, null, null, fin != null ? fin.error() : "no calculation");
        return new Entry(calc, f);
    }
}
