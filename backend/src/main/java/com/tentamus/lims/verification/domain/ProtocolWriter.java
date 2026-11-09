package com.tentamus.lims.verification.domain;

import static com.tentamus.lims.verification.domain.JsValues.map;
import static com.tentamus.lims.verification.domain.JsValues.nn;
import static com.tentamus.lims.verification.domain.JsValues.num;
import static com.tentamus.lims.verification.domain.JsValues.numOr;
import static com.tentamus.lims.verification.domain.JsValues.or;
import static com.tentamus.lims.verification.domain.JsValues.str;

import com.tentamus.lims.core.excel.Js;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;

/**
 * Writes a version's verification protocol from its design (verification.js buildPlan and buildProtocol): the samples
 * of the run (S1 typical, S2 below the LOQ, S3 outside the specification, S4 below the LOD), every value the run will
 * enter, the expected results from the independent calculation, the URS and FRS requirements, and the checks.
 */
public final class ProtocolWriter {
    public static final String GENERATOR = "LIMS3 workflow verification 1.0 (protocol writer and independent calculation in server/verification.js)";
    private static final String BASE_READING = "10";
    private final Design D;

    public ProtocolWriter(Design design) { this.D = design; }

    /** The protocol: {requirements, checks, plan}, ready for create_verification. */
    public record Protocol(List<Map<String, Object>> requirements, List<Map<String, Object>> checks, Map<String, Object> plan) {}

    /** A planned sample: its inputs and expected results. */
    static final class Sample {
        String key, kase, description;
        Map<String, Object> inputs;
        List<String> steered;
        List<Map<String, Object>> specs;
        Map<String, Design.Entry> expected;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> at(Map<String, Object> o, String... path) {
        Map<String, Object> x = o;
        for (String k : path) {
            Object v = x == null ? null : x.get(k);
            x = v instanceof Map<?, ?> mm ? (Map<String, Object>) mm : null;
        }
        return x;
    }

    // ------------------------------------------------------------ the plan
    static String prepValue(Map<String, Object> f) {
        String t = or(f.get("type"), "Text");
        String l = str(f.get("label") == null ? "" : f.get("label")).toLowerCase();
        if (t.equals("Number")) return l.contains("temperature") ? "95" : l.contains("volume") ? "50" : "10";
        if (t.equals("Time")) return "08:00";
        if (t.equals("Date")) return LocalDate.now(ZoneOffset.UTC).toString();
        return "Verification run";
    }

    private static boolean given(Object v) { return v != null && v != JsValues.UNDEFINED; }

    static String baseWeight(Step s) {
        Map<String, Object> c = s.config;
        Object mode = c.get("target_mode");
        if (("Single".equals(mode) || (!Js.truthy(mode) && given(c.get("target")))) && given(c.get("target"))) return Rational.of(str(c.get("target"))).toInput(8);
        if ("By product category".equals(mode)) {
            for (Object o : s.cfgList("by_category")) {
                Map<String, Object> y = map(o);
                if (given(y.get("min")) && given(y.get("max"))) return Rational.of(str(y.get("min"))).add(Rational.of(str(y.get("max")))).div(Rational.of(2)).toInput(8);
            }
        }
        return "1";
    }

    private static String n(Object x, String d) { return !given(x) || "".equals(x) ? d : str(x); }

    static List<Object> baseDilution(Step s) {
        Map<String, Object> c = s.config;
        List<Object> f = new ArrayList<>();
        if ("Serial".equals(c.get("mode"))) {
            f.add(m("aliquot", n(c.get("initial_amount"), "1"), "diluent", n(c.get("initial_diluent"), "9")));
            double depth = Math.max(numOr(c.get("depth"), 1), 1);
            for (int i = 1; i < depth; i += 1) f.add(m("aliquot", n(c.get("transfer_aliquot"), "1"), "diluent", n(c.get("transfer_diluent"), "9")));
            return f;
        }
        if (given(c.get("aliquot")) && !"".equals(c.get("aliquot"))) { f.add(m("aliquot", str(c.get("aliquot")), "diluent", n(c.get("diluent"), "0"))); return f; }
        List<Object> by = s.cfgList("by_category");
        if (!by.isEmpty()) { Map<String, Object> b = map(by.get(0)); f.add(m("aliquot", n(b.get("aliquot"), "1"), "diluent", n(b.get("diluent"), "9"))); return f; }
        f.add(m("aliquot", "1", "diluent", "9"));
        return f;
    }

    static Map<String, Object> incubationOf(Step s) {
        Map<String, Object> c = s.config;
        String unit = or(c.get("duration_unit"), "hours");
        Rational d = given(c.get("duration")) ? Rational.of(str(c.get("duration"))) : null;
        Rational lo = given(c.get("window_min")) ? Rational.of(str(c.get("window_min"))) : null;
        Rational hi = given(c.get("window_max")) ? Rational.of(str(c.get("window_max"))) : null;
        if (d == null || (lo != null && d.cmp(lo) < 0) || (hi != null && d.cmp(hi) > 0)) d = lo != null && hi != null ? lo.add(hi).div(Rational.of(2)) : lo != null ? lo : hi != null ? hi : Rational.of(24);
        return m("duration", d.toInput(8), "unit", unit, "temperature", given(c.get("temp_c")) ? str(c.get("temp_c")) : null);
    }

    static Rational niceUp(Rational q) {
        Rational x = q.abs();
        Rational p = Rational.pow10(x.log10Floor());
        for (long mm : new long[] {1, 2, 5, 10}) {
            Rational c = p.mul(Rational.of(mm));
            if (c.cmp(x) >= 0) return q.cmp(Rational.ZERO) < 0 ? c.neg() : c;
        }
        return x;
    }

    private Map<String, Object> batch;

    private Map<String, Object> baseInputs() {
        Map<String, Object> weigh = new LinkedHashMap<>(), dil = new LinkedHashMap<>(), plates = new LinkedHashMap<>(), read = new LinkedHashMap<>();
        for (Step s : D.steps) {
            if (s.is("Weighing")) weigh.put(s.key, baseWeight(s));
            if (s.is("Dilution")) dil.put(s.key, baseDilution(s));
            if (s.is("Plating/Inoculation")) plates.put(s.key, Js.number(Math.max(numOr(s.cfg("plates_per_entry"), 1), 1)));
            if (s.is("Data Entry")) {
                Map<String, Object> r = new LinkedHashMap<>();
                read.put(s.key, r);
                for (Analyte a : D.analytes) {
                    if (!s.reads(a.id)) continue;
                    if (a.numeric()) r.put(a.id, BASE_READING);
                    else if ("Count".equals(a.resultType)) r.put(a.id, "25");
                    else if ("Qualitative".equals(a.resultType)) r.put(a.id, a.notFound(a.resultValues.isEmpty() || !Js.truthy(a.resultValues.get(0)) ? "Absent" : a.resultValues.get(0)));
                    else r.put(a.id, "Verification text");
                }
            }
        }
        return m("weigh", weigh, "dil", dil, "plates", plates, "read", read);
    }

    private Design.Final finalOf(Map<String, Object> inputs, Analyte a) { return D.calculate(batch, inputs, a).fin(); }

    private Double f(Map<String, Object> inputs, Step st, Analyte a, String r) {
        Map<String, Object> x = JsValues.copy(inputs);
        at(x, "read", st.key).put(a.id, r);
        Rational v = finalOf(x, a).value();
        return v == null ? null : v.num();
    }

    /** A reading that brings the analyte's final result to the target (searched on a log scale, then bisected). */
    String steer(Map<String, Object> inputs, Analyte a, Rational target, boolean isCount) {
        Step st = D.steeringStep(a);
        if (st == null) return null;
        double t = target.num();
        Double lo = null, hi = null;
        double[] prev = null;
        for (double k = -8; k <= 10; k += 0.25) {
            double r = StrictMath.pow(10, k);
            Double y = f(inputs, st, a, Rational.fromDouble(r).toInput(12));
            if (y != null && Double.isFinite(y)) {
                if (prev != null && (prev[1] - t) * (y - t) <= 0) { lo = prev[0]; hi = r; break; }
                prev = new double[] {r, y};
            }
        }
        if (lo == null) return null;
        Double fl = f(inputs, st, a, Rational.fromDouble(lo).toInput(12));
        double ylo = (fl == null ? 0 : fl) - t;
        double l = lo, h = hi;
        for (int i = 0; i < 80; i += 1) {
            double mid = Math.sqrt(l * h);
            Double fy = f(inputs, st, a, Rational.fromDouble(mid).toInput(12));
            double y = (fy == null ? 0 : fy) - t;
            if ((y < 0) == (ylo < 0)) l = mid; else h = mid;
        }
        double r = Math.sqrt(l * h);
        return isCount ? Js.number(Math.max(Math.round(r), 0)) : Rational.fromDouble(r).toInput(6);
    }

    // keeps a value clear of rounding and LOQ boundaries, so the comparison is fair to both calculations
    private boolean safe(Rational v, Analyte a) {
        if (v == null) return true;
        Rational up = v.mul(Rational.of("1.00000001")), dn = v.mul(Rational.of("0.99999999"));
        return Objects.equals(Calculation.reportValue(up, a, D.version), Calculation.reportValue(dn, a, D.version));
    }

    private void nudge(Map<String, Object> inputs, Analyte a) {
        Rational v = finalOf(inputs, a).value();
        for (int i = 0; i < 5 && v != null && !safe(v, a); i += 1) {
            Step st = D.steeringStep(a);
            if (st == null) break;
            Map<String, Object> r = at(inputs, "read", st.key);
            r.put(a.id, Rational.of(r.get(a.id)).mul(Rational.of("1.0007")).toInput(7));
            v = finalOf(inputs, a).value();
        }
    }

    private final List<Sample> samples = new ArrayList<>();
    private final Map<String, Map<String, Object>> specs = new LinkedHashMap<>();

    void buildPlan() {
        batch = new LinkedHashMap<>();
        Map<String, Object> prep = new LinkedHashMap<>(), inc = new LinkedHashMap<>();
        batch.put("prep", prep);
        batch.put("inc", inc);
        batch.put("mat", D.material == null ? new LinkedHashMap<>() : D.material);
        for (Step s : D.steps) {
            if (s.is("Preparation")) {
                Map<String, Object> fields = new LinkedHashMap<>();
                for (Object o : s.cfgList("fields")) { Map<String, Object> fd = map(o); if (Js.truthy(fd.get("label"))) fields.put(Calculation.fieldKey(fd.get("label")), prepValue(fd)); }
                prep.put(s.key, fields);
            }
            if (s.is("Incubation")) inc.put(s.key, incubationOf(s));
        }
        Map<String, Object> typical = baseInputs();
        // the typical sample: within the LOQ and the specification
        for (Analyte a : D.analytes) {
            if (!a.numeric()) continue;
            Rational v = finalOf(typical, a).value();
            Rational loq = a.loq != null ? Rational.of(a.loq) : null;
            Rational dmax = a.defaultSpecMax != null ? Rational.of(a.defaultSpecMax) : null, dmin = a.defaultSpecMin != null ? Rational.of(a.defaultSpecMin) : null;
            Rational target = null;
            if (v != null && loq != null && v.cmp(loq.mul(Rational.of(2))) < 0) target = loq.mul(Rational.of(10));
            if (v != null && dmax != null && (target != null ? target : v).cmp(dmax) >= 0) target = dmax.mul(Rational.of("0.5"));
            if (v != null && dmin != null && (target != null ? target : v).cmp(dmin) <= 0) target = dmin.cmp(Rational.ZERO) > 0 ? dmin.mul(Rational.of(2)) : dmin.add(Rational.ONE);
            if (target != null && loq != null && target.cmp(loq) < 0 && dmax != null) target = loq.add(dmax).div(Rational.of(2));
            if (target != null) {
                Step st = D.steeringStep(a);
                String r = steer(typical, a, target, false);
                if (st != null && r != null) at(typical, "read", st.key).put(a.id, r);
            }
            nudge(typical, a);
            v = finalOf(typical, a).value();
            // the specification the run puts on its samples: the test's usual limits, else limits around the typical result
            String unit = a.reportingUnit == null || a.reportingUnit.isEmpty() ? null : a.reportingUnit;
            if (dmin != null || dmax != null) specs.put(a.id, m("min", dmin != null ? dmin.toString() : null, "max", dmax != null ? dmax.toString() : null, "text", null, "unit", unit, "source", "the test's usual limits"));
            else if (v != null) specs.put(a.id, v.cmp(Rational.ZERO) > 0
                ? m("min", null, "max", niceUp(v.mul(Rational.of(2))).toString(), "text", null, "unit", unit, "source", "set by the protocol (twice the typical result, rounded up)")
                : m("min", v.sub(Rational.ONE).toInput(6), "max", null, "text", null, "unit", unit, "source", "set by the protocol (the typical result less 1)"));
        }
        for (Analyte a : D.analytes) {
            if (!"Qualitative".equals(a.resultType)) continue;
            boolean own = a.defaultSpecText != null && !a.defaultSpecText.isEmpty();
            specs.put(a.id, m("min", null, "max", null, "text", own ? a.defaultSpecText : a.notFound("Absent"), "unit", null,
                "source", own ? "the test's usual limit" : "set by the protocol (not found)"));
        }
        Sample s1 = new Sample();
        s1.key = "S1"; s1.kase = "Typical"; s1.description = "Automated verification sample: typical result, within the specification"; s1.inputs = typical;
        samples.add(s1);
        boolean withLoq = D.analytes.stream().anyMatch(a -> a.numeric() && a.loq != null && D.steeringStep(a) != null);
        if (withLoq) {
            boolean nd = D.version.ndBelowLod();
            caseSample(typical, "S2", "Below the LOQ", "Automated verification sample: result below the LOQ", a -> a.numeric() && a.loq != null
                ? (nd && a.lod != null ? Rational.of(a.lod).add(Rational.of(a.loq)).div(Rational.of(2)) : Rational.of(a.loq).mul(Rational.of("0.5"))) : null);
        }
        caseSample(typical, "S3", "Outside the specification", "Automated verification sample: result outside the specification", a -> {
            Map<String, Object> sp = specs.get(a.id);
            if (sp == null || !a.numeric()) return null;
            if (sp.get("max") != null) { Rational mx = Rational.of(sp.get("max")); return mx.cmp(Rational.ZERO) > 0 ? mx.mul(Rational.of("1.5")) : mx.add(Rational.ONE); }
            if (sp.get("min") != null) { Rational mn = Rational.of(sp.get("min")); return mn.cmp(Rational.ZERO) > 0 ? mn.mul(Rational.of("0.5")) : mn.sub(Rational.ONE); }
            return null;
        });
        if (D.version.ndBelowLod() && D.analytes.stream().anyMatch(a -> a.numeric() && a.lod != null && D.steeringStep(a) != null)) {
            caseSample(typical, "S4", "Below the LOD", "Automated verification sample: result below the LOD (reported ND)", a -> a.numeric() && a.lod != null ? Rational.of(a.lod).mul(Rational.of("0.5")) : null);
        }
        for (Sample s : samples) {
            s.specs = new ArrayList<>();
            for (Map.Entry<String, Map<String, Object>> e : specs.entrySet())
                s.specs.add(m("analyte_id", e.getKey(), "min", e.getValue().get("min"), "max", e.getValue().get("max"), "text", e.getValue().get("text"), "unit", e.getValue().get("unit")));
            s.expected = D.calculateEntry(batch, s.inputs);
        }
    }

    private void caseSample(Map<String, Object> typical, String key, String kase, String description, Function<Analyte, Rational> targetOf) {
        Map<String, Object> x = JsValues.copy(typical);
        List<String> steered = new ArrayList<>();
        for (Analyte a : D.analytes) {
            Rational target = targetOf.apply(a);
            if (target == null) continue;
            Step st = D.steeringStep(a);
            if (st == null) continue;
            String r = steer(x, a, target, false);
            if (r == null) continue;
            at(x, "read", st.key).put(a.id, r);
            steered.add(a.id);
            nudge(x, a);
        }
        if (kase.equals("Outside the specification")) {
            for (Analyte a : D.analytes) {
                if (!"Qualitative".equals(a.resultType)) continue;
                for (Step s : D.steps) if (s.is("Data Entry") && s.reads(a.id)) at(x, "read", s.key).put(a.id, a.foundValues.isEmpty() || !Js.truthy(a.foundValues.get(0)) ? "Present" : a.foundValues.get(0));
                steered.add(a.id);
            }
        }
        if (!steered.isEmpty()) {
            Sample s = new Sample();
            s.key = key; s.kase = kase; s.description = description; s.inputs = x; s.steered = steered;
            samples.add(s);
        }
    }

    // ------------------------------------------------------------ the protocol
    private final List<Map<String, Object>> reqs = new ArrayList<>(), checks = new ArrayList<>();
    private int nu = 0, nf = 0, nc = 0;

    private static String code(String prefix, int n) { return prefix + (n < 10 ? "0" : "") + n; }

    private String urs(String statement, String source) {
        nu += 1;
        String c = code("URS-", nu);
        reqs.add(m("req_code", c, "kind", "URS", "statement", statement, "source", source, "traces", List.of()));
        return c;
    }

    private String frs(String statement, String source, Collection<String> traces) {
        nf += 1;
        String c = code("FRS-", nf);
        reqs.add(m("req_code", c, "kind", "FRS", "statement", statement, "source", source, "traces", traces.stream().filter(Objects::nonNull).toList()));
        return c;
    }

    private void check(Map<String, Object> c) {
        nc += 1;
        Map<String, Object> out = m("check_code", code("VC-", nc));
        out.putAll(c);
        checks.add(out);
    }

    private static List<String> codes(String... c) { List<String> l = new ArrayList<>(); for (String x : c) if (x != null && !x.isEmpty()) l.add(x); return l; }

    static String qcLabel(Map<String, Object> q) {
        String f = or(q.get("frequency"), "Once");
        return str(q.get("qc_type")) + (f.equals("Once") && num(Js.truthy(q.get("count")) ? q.get("count") : 1) > 1 ? " x" + str(q.get("count")) : "")
            + " (" + (f.equals("Every N") ? "every " + or(q.get("every_n"), "10") + " samples, opening and closing" : f.toLowerCase()) + ")";
    }

    private String rounding(Analyte a) {
        String mo = a.roundingMode != null && !a.roundingMode.isEmpty() ? a.roundingMode : D.version.roundingMode();
        int d = a.roundingDigits != null ? a.roundingDigits : D.version.roundingDigits();
        return d + " " + ("Decimal places".equals(mo) ? "decimal place" + (d == 1 ? "" : "s") : "significant figure" + (d == 1 ? "" : "s"));
    }

    private static String unitOf(Analyte a) { return a.reportingUnit != null && !a.reportingUnit.isEmpty() ? " " + a.reportingUnit : ""; }

    private static String join(Collection<?> l, String sep) {
        StringBuilder b = new StringBuilder();
        int i = 0;
        for (Object x : l) { if (i++ > 0) b.append(sep); b.append(x == null || x == JsValues.UNDEFINED ? "" : str(x)); }
        return b.toString();
    }

    private String analyteName(Object id) {
        for (Analyte a : D.analytes) if (a.id.equals(id)) return a.name;
        return "undefined";
    }

    public Protocol build() {
        buildPlan();
        Design.Version V = D.version;
        Step bs = D.batching();
        List<Map<String, Object>> qcCfg = new ArrayList<>();
        if (bs != null) for (Object o : bs.cfgList("qc")) qcCfg.add(map(o));
        String qcText = join(qcCfg.stream().map(ProtocolWriter::qcLabel).toList(), ", ");

        // ---- URS
        String uTest = urs(V.testName() + " (version " + str(V.versionNo()) + ") tests a sample for " + join(D.analytes.stream().map(a -> a.name).toList(), ", ") + " at " + V.siteCode()
            + (V.methodName() != null && !V.methodName().isEmpty() ? ", by " + V.methodName() : "") + ", and reports one approved result for each.", "The test, its method and its analytes");
        Map<String, String> uAnalyte = new LinkedHashMap<>();
        for (Analyte a : D.analytes) {
            if (a.numeric()) {
                uAnalyte.put(a.id, urs(a.name + " is reported" + (a.reportingUnit != null && !a.reportingUnit.isEmpty() ? " in " + a.reportingUnit : "") + ", rounded to " + rounding(a)
                    + (a.loq != null ? "; a result below the LOQ (" + a.loq + unitOf(a) + ") is reported as \"< " + a.loq + "\"" : "")
                    + (V.ndBelowLod() && a.lod != null ? ", and below the LOD (" + a.lod + unitOf(a) + ") as \"ND\"" : "") + ".", "Analyte " + a.name + ": unit, rounding, LOQ and LOD"));
            } else {
                uAnalyte.put(a.id, urs(a.name + " is reported as recorded (" + str(a.resultType).toLowerCase() + " result"
                    + ("Qualitative".equals(a.resultType) ? ": " + join(a.resultValues, ", ") + "; found means " + join(a.foundValues, " or ") : "") + ").", "Analyte " + a.name + ": result type"));
            }
        }
        String uSpec = urs("Each result is compared with the sample's specification; a result outside it is reported as not conforming (\"< LOQ\" counts as below any limit).", "Specifications on requested tests");
        String uQc = !qcCfg.isEmpty() ? urs("Samples are tested in batches of at most " + or(bs.cfg("max_samples"), "500") + ", with " + qcText + "; each QC is judged against its acceptance criteria.", "Batching step: maximum and QC") : null;
        String uIntegrity = urs("Every bench step is done by a person in the step's department, recorded under their name and signed when completed (with a witness where the step needs one); a step cannot be completed with data missing; every recorded value is in the audit trail.", "Data integrity (21 CFR Part 11)");
        String uReview = urs("A different person reviews each step and approves the results before they are reported; nobody reviews work they did.", "QC Review");
        List<Step> tps = D.timepointSteps();
        String uTime = !tps.isEmpty() ? urs("Interim results (" + join(tps.stream().map(s -> s.name).toList(), ", ") + ") are reviewed and released as preliminary results; the final approval keeps them unchanged.", "Timepoint reviews") : null;
        Map<String, String> uSplit = new LinkedHashMap<>();
        for (Step s : D.steps) {
            if (!s.is("Split off Test")) continue;
            uSplit.put(s.key, urs(D.testName(s.cfg("test_id")) + " is " + ("On finding".equals(s.cfg("trigger")) ? "split off for a sample with a finding (" + or(s.cfg("finding"), "Present") + ")" : "split off for every sample")
                + (Boolean.FALSE.equals(s.cfg("consent_required")) ? ", ordered at once" : ", with the customer's consent") + ".", "Step " + s.name));
        }
        Map<String, String> uHold = new LinkedHashMap<>();
        for (Step s : D.steps) if (s.is("Hold Point")) uHold.put(s.key, urs(s.name + " waits for the " + D.testName(s.cfg("test_id")) + " result on the same sample.", "Step " + s.name));
        String uOrder = urs("The order shows Approved once every test on it has approved results.", "Order statuses");

        // ---- FRS per step
        Map<String, String> fStep = new LinkedHashMap<>();
        for (Step s : D.order) {
            Map<String, Object> c = s.config;
            String dept = s.departmentName != null && !s.departmentName.isEmpty() ? " (" + s.departmentName + ")" : "";
            String eqText = s.equipment.isEmpty() ? "" : " with the " + join(s.equipment.stream().map(e -> e.get("type_name")).toList(), " or ") + " used (available and in calibration)";
            String witness = s.witnessRequired() ? "; a witness signs too" : "";
            String text = switch (s.type) {
                case "Batching" -> s.name + dept + " makes a batch from the backlog of at most " + or(c.get("max_samples"), "500") + " samples" + (!qcCfg.isEmpty() ? " and adds " + qcText : "") + ".";
                case "Weighing" -> s.name + dept + " records " + (num(c.get("replicates")) > 1 ? str(c.get("replicates")) + " weights (their average is the step's weight)" : "a weight") + " in " + or(c.get("unit"), "g")
                    + " for each sample and prep QC" + eqText + witness + ".";
                case "Preparation" -> s.name + dept + " records " + (!s.cfgList("fields").isEmpty() ? join(s.cfgList("fields").stream().map(o -> map(o).get("label")).toList(), ", ") : "that it was done") + " once for the batch" + witness + ".";
                case "Dilution" -> s.name + dept + " records each sample's dilution (aliquot and diluent" + ("Serial".equals(c.get("mode")) ? ", serial" : "") + "); the dilution factor multiplies the steps" + witness + ".";
                case "Plating/Inoculation" -> s.name + dept + " records the plates for each sample and prep QC, and the media lot used" + witness + ".";
                case "Incubation" -> s.name + dept + " records incubator loads" + eqText + ": time in, time out and temperature, against " + nn(c.get("temp_c"), "?") + " ± " + nn(c.get("temp_tolerance"), "0") + " °C for "
                    + nn(c.get("window_min"), "?") + " to " + nn(c.get("window_max"), "?") + " " + or(c.get("duration_unit"), "hours") + witness + ".";
                case "Data Entry" -> s.name + dept + " records " + or(c.get("value_label"), "the reading") + (Js.truthy(c.get("value_unit")) ? " in " + str(c.get("value_unit")) : "") + " for every entry and analyte"
                    + (!s.cfgList("analyte_ids").isEmpty() ? " (" + join(D.analytes.stream().filter(a -> s.reads(a.id)).map(a -> a.name).toList(), ", ") + ")" : "")
                    + (Boolean.FALSE.equals(c.get("require_attachment")) ? "" : ", with the raw data file") + eqText + witness + ".";
                case "Calculation" -> s.name + " calculates " + or(c.get("formula"), "(no formula)")
                    + (!s.cfgList("overrides").isEmpty() ? " (own formula for " + join(s.cfgList("overrides").stream().map(o -> analyteName(map(o).get("analyte_id")) + ": " + nnu(map(o).containsKey("formula") ? map(o).get("formula") : JsValues.UNDEFINED)).toList(), "; ") + ")" : "")
                    + (Js.truthy(c.get("result_unit")) ? ", in " + str(c.get("result_unit")) : "") + (s.key.equals(D.finalCalc) ? "; it is the test's final result" : "") + ".";
                case "Split off Test" -> s.name + dept + ": completing it raises a request to order " + D.testName(c.get("test_id")) + " for "
                    + ("On finding".equals(c.get("trigger")) ? "each sample with " + or(c.get("finding"), "a finding") + " in " + join(s.cfgList("finding_steps"), ", ") : "every sample") + ".";
                case "Hold Point" -> s.name + dept + " cannot be completed until the " + D.testName(c.get("test_id")) + " result on the same sample is ready.";
                case "QC Review" -> s.scope().equals("Timepoint") && tps.contains(s)
                    ? s.name + " (timepoint review): once the steps before it are completed and approved, the reviewer releases " + join(D.timepointKeys(s).stream().map(k -> D.byKey.get(k).name).toList(), ", ") + " as preliminary results (signed)."
                    : s.name + ": the reviewer approves each step, chooses the reportable reading, accepts or rejects QC, and approves the batch (signed); the results are stored as final.";
                default -> s.name + " (" + s.type + ").";
            };
            List<String> traces = new ArrayList<>();
            traces.add(uIntegrity);
            if (s.is("Batching")) traces.add(uQc != null ? uQc : uTest);
            if (s.is("Calculation")) for (Analyte a : D.analytes) if (a.numeric()) traces.add(uAnalyte.get(a.id));
            if (s.is("QC Review")) { traces.add(uReview); traces.add(s.scope().equals("Timepoint") ? uTime : uTest); }
            if (s.is("Split off Test")) traces.add(uSplit.get(s.key));
            if (s.is("Hold Point")) traces.add(uHold.get(s.key));
            if (s.is("Data Entry") || s.is("Weighing")) traces.add(uTest);
            fStep.put(s.key, frs(text, "Step " + s.name + " (" + s.type + ")", new LinkedHashSet<>(traces)));
        }
        Map<String, String> fQc = new LinkedHashMap<>();
        Map<String, List<Map<String, Object>>> crit = new LinkedHashMap<>();
        for (Map<String, Object> q : D.qc) crit.computeIfAbsent(str(q.get("qc_type")) + "|" + str(q.get("limit_type")), k -> new ArrayList<>()).add(q);
        for (Map.Entry<String, List<Map<String, Object>>> e : crit.entrySet()) {
            String[] tl = e.getKey().split("\\|", -1);
            String t = tl[0], l = tl[1];
            List<Map<String, Object>> ap = e.getValue().stream().filter(r -> Boolean.TRUE.equals(r.get("applies"))).toList();
            Function<Map<String, Object>, String> lim = r -> r.get("min_value") != null && r.get("max_value") != null ? r.get("min_value") + " to " + r.get("max_value")
                : r.get("max_value") != null ? "at most " + r.get("max_value") : Js.truthy(r.get("limit_ref")) ? "below " + str(r.get("limit_ref")) : r.get("min_value") != null ? "at least " + r.get("min_value") : l;
            List<String> limits = new ArrayList<>(new LinkedHashSet<>(ap.stream().map(lim).toList()));
            fQc.put(e.getKey(), frs(t + " is judged on " + l + ": " + (limits.size() == 1 ? limits.get(0) + " for " + (ap.size() == D.analytes.size() ? "every analyte" : join(ap.stream().map(r -> r.get("analyte_name")).toList(), ", "))
                : join(ap.stream().map(r -> str(r.get("analyte_name")) + " " + lim.apply(r)).toList(), "; ")) + "; a failed or missing QC result stops the approval until the reviewer accepts it with a justification.",
                "Batching step QC criteria", listOf(uQc)));
        }
        String fConf = frs("The final result is compared with the sample's specification (in the result's unit) and stored with Conforms, Does not conform or No specification.", "QC Review: specification comparison", List.of(uSpec));
        String fOrder = frs("The order's status follows its tests: In Testing while batched, In Review when nothing is left at the bench, Approved when every test has final results.", "Order statuses", List.of(uOrder));

        // ---- the batches the run will make, and their QC
        double maxS = bs != null ? numOr(bs.cfg("max_samples"), 500) : 500;
        List<String> keys = samples.stream().map(s -> s.key).toList();
        List<List<String>> batches = new ArrayList<>();
        for (int i = 0; i < keys.size(); i += (int) Math.ceil(maxS)) batches.add(keys.subList(i, (int) Math.min(keys.size(), i + Math.ceil(maxS))));
        List<String> batchTexts = new ArrayList<>();
        List<Object> batchPlan = new ArrayList<>();
        for (int i = 0; i < batches.size(); i++) {
            List<String> q = expectQc(qcCfg, batches.get(i).size(), i == 0);
            batchTexts.add("Batch " + (i + 1) + ": " + String.join(", ", batches.get(i)) + (!q.isEmpty() ? " with " + String.join(", ", q) : ""));
            batchPlan.add(m("samples", new ArrayList<>(batches.get(i)), "qc", q));
        }
        check(m("case_label", "Process", "title", "The samples are in the backlog and batches are made from it with the Batching step's QC",
            "procedure_text", "Order and log the samples below (internal client, codes VER-...); the automated analyst makes batches from the backlog until it is empty.",
            "requirement_codes", codes(uTest, uQc, fStep.get(bs != null ? bs.key : D.order.get(0).key)),
            "inputs", m("kind", "batches"), "expected", m("text", String.join("; ", batchTexts), "batches", batchPlan)));
        Step firstWork = D.order.stream().filter(s -> List.of("Weighing", "Dilution", "Data Entry", "Plating/Inoculation", "Incubation").contains(s.type) || (s.is("Preparation") && !s.cfgList("fields").isEmpty())).findFirst().orElse(null);
        if (firstWork != null) check(m("case_label", "Process", "title", "\"" + firstWork.name + "\" cannot be completed while its data are missing", "procedure_text", "Before entering anything, try to complete " + firstWork.name + " (signed).",
            "requirement_codes", codes(uIntegrity, fStep.get(firstWork.key)), "inputs", m("kind", "refuse_incomplete", "step_key", firstWork.key), "expected", m("text", "Refused: the step cannot be completed yet")));
        for (Step s : D.order) {
            if (s.is("QC Review")) continue;
            if (s.is("Hold Point")) {
                check(m("case_label", "Process", "title", "\"" + s.name + "\" waits for " + D.testName(s.cfg("test_id")), "procedure_text", "Try to complete " + s.name + " before the other test has a result.",
                    "requirement_codes", codes(uHold.get(s.key), fStep.get(s.key)), "inputs", m("kind", "hold", "step_key", s.key),
                    "expected", m("text", "Refused while the other test's result is not ready (the steps after it cannot be tested in this run)")));
                continue;
            }
            List<String> lots = stepLots(s);
            List<String> lacking = new ArrayList<>();
            for (String x : D.materialTokens == null ? List.<String>of() : D.materialTokens) {
                if (!x.startsWith(s.key + ".")) continue;
                String fld = x.split("\\.")[1];
                for (Analyte a : D.analytes) if (!Js.truthy(at(batch, "mat", s.key, a.id) == null ? null : at(batch, "mat", s.key, a.id).get(fld))) lacking.add(fld + " for " + a.name);
            }
            Map<String, Object> values = new LinkedHashMap<>(stepInputs(s));
            if (!lots.isEmpty()) values.put("Logbook lots", String.join("; ", lots));
            check(m("case_label", "Process", "title", "\"" + s.name + "\" is completed and signed Performed by" + (s.witnessRequired() ? " and Witnessed by" : ""),
                "procedure_text", describeStep(s) + (!lots.isEmpty() || !lacking.isEmpty() ? " Scan the logbook lots the calculation reads" + (!lots.isEmpty() ? ": " + String.join("; ", lots) : "")
                    + (!lacking.isEmpty() ? ". No usable lot at the lab gives " + String.join(", ", lacking) + " (record and approve one in its logbook, then write the protocol again)" : "") + "." : ""),
                "requirement_codes", codes(uIntegrity, fStep.get(s.key)), "inputs", m("kind", "step", "step_key", s.key, "values", values),
                "expected", m("text", "Completed in every batch by the Verification analyst, signed \"Performed by\"" + (s.witnessRequired() ? " and \"Witnessed by\"" : ""))));
            if (s.is("Split off Test")) {
                List<String> finding = new ArrayList<>();
                for (Sample x : samples) {
                    boolean hit = !"On finding".equals(s.cfg("trigger"));
                    if (!hit) for (Object k : s.cfgList("finding_steps")) {
                        Map<String, Object> r = at(x.inputs, "read", str(k));
                        if (r != null) for (Object v : r.values()) if (D.analytes.stream().anyMatch(a -> a.foundValues.contains(v))) hit = true;
                    }
                    if (hit) finding.add(x.key);
                }
                check(m("case_label", "Process", "title", "\"" + s.name + "\" raises a split-off request for each sample with a finding, and only for them", "procedure_text", "Complete the step, then read the split-off requests of the batch.",
                    "requirement_codes", codes(uSplit.get(s.key), fStep.get(s.key)), "inputs", m("kind", "split", "step_key", s.key),
                    "expected", m("text", !finding.isEmpty() ? "Requests for " + String.join(", ", finding) + " only" : "No request (no sample has a finding)", "samples", finding)));
            }
        }
        // QC
        for (Map.Entry<String, List<Map<String, Object>>> e : crit.entrySet()) {
            String[] tl = e.getKey().split("\\|", -1);
            String t = tl[0], l = tl[1];
            if (e.getValue().stream().noneMatch(r -> Boolean.TRUE.equals(r.get("applies")))) continue;
            String solve = switch (l) {
                case "Recovery %" -> "readings set so the recovery is 100 % (from the standard or spike recorded)";
                case "Blank threshold" -> "reading 0";
                case "Presence" -> "a reading that shows growth";
                case "Absence" -> "a reading that shows no growth";
                case "Identified" -> "an identification";
                case "RPD" -> "the spike and its duplicate read alike";
                default -> "a typical reading (this limit type is not judged yet)";
            };
            check(m("case_label", "QC", "title", t + ": " + l + " passes", "procedure_text", "Enter the QC readings (" + solve + "); at review, read the QC verdicts.",
                "requirement_codes", codes(uQc, fQc.get(e.getKey())), "inputs", m("kind", "qc", "qc_type", t, "limit_type", l),
                "expected", m("text", List.of("RSD", "Stdev", "Area Counts", "Tailing Factor", "Retention time", "Signal-to-noise", "Resolution").contains(l) ? "Not judged (the bench records it; judged in a later slice)" : "Pass for every analyte it judges")));
        }
        // results per sample
        for (Sample smp : samples) {
            for (Analyte a : D.analytes) {
                Design.Entry ex = smp.expected.get(a.id);
                Map<String, Object> sp = smp.specs.stream().filter(x -> a.id.equals(x.get("analyte_id"))).findFirst().orElse(null);
                if (a.numeric()) {
                    for (Step cs : D.calcs) {
                        if (cs.key.equals(D.finalCalc)) continue;
                        Design.Calc c = ex.calcs().get(cs.key);
                        Map<String, Object> inputs = m("kind", "calc", "step_key", cs.key, "analyte_id", a.id, "formula", c.formula(), "tokens", c.inputs());
                        check(m("case_label", smp.kase, "sample_key", smp.key, "title", smp.key + " " + a.name + ": " + cs.name + " = " + (c.value() != null ? c.value().toString() : c.error()),
                            "procedure_text", "Read the calculated " + cs.name + " of " + smp.key + " at the bench.", "requirement_codes", codes(fStep.get(cs.key), uAnalyte.get(a.id)),
                            "inputs", inputs,
                            "expected", m("text", c.value() != null ? c.value().toString() + (c.value().approx ? " (to 9 significant figures)" : "") : "Not calculable: " + c.error(), "value", c.value() != null ? c.value().toString() : null)));
                    }
                    for (Step tp : tps) {
                        for (String key : D.timepointKeys(tp)) {
                            Design.Calc c = ex.calcs().get(key);
                            if (c == null) continue;
                            String rep = c.value() != null ? Calculation.reportValue(c.value(), a, V) : null;
                            check(m("case_label", smp.kase, "sample_key", smp.key, "title", smp.key + " " + a.name + ": " + D.byKey.get(key).name + " released as preliminary",
                                "procedure_text", "The reviewer approves the steps before " + tp.name + " and releases it (signed); read the stored result.",
                                "requirement_codes", codes(uTime, fStep.get(tp.key), uAnalyte.get(a.id)),
                                "inputs", m("kind", "timepoint", "step_key", tp.key, "result_key", key, "analyte_id", a.id),
                                "expected", m("text", c.value() != null ? rep + " (Preliminary)" : "Not calculable: " + c.error(), "value", c.value() != null ? c.value().toString() : null, "reported", rep, "stage", "Preliminary")));
                        }
                    }
                }
                Design.Final fin = ex.fin();
                String conf = fin.reported() == null && fin.valueText() == null ? null : Calculation.conformance(sp, a, fin.reported(), fin.valueText());
                List<String> fcodes = codes(uTest, uAnalyte.get(a.id), D.finalCalc != null && a.numeric() ? fStep.get(D.finalCalc) : null, sp != null ? uSpec : null, sp != null ? fConf : null);
                String spText = sp != null ? (Js.truthy(sp.get("text")) ? "specification " + sp.get("text")
                    : "specification " + (sp.get("min") != null ? "at least " + sp.get("min") : "") + (sp.get("min") != null && sp.get("max") != null ? " and " : "") + (sp.get("max") != null ? "at most " + sp.get("max") : "")
                        + (Js.truthy(sp.get("unit")) ? " " + sp.get("unit") : "")) : "no specification";
                String shown = fin.reported() != null ? fin.reported() : fin.valueText();
                Map<String, Object> readings = new LinkedHashMap<>();
                Map<String, Object> read = at(smp.inputs, "read");
                if (read != null) for (Map.Entry<String, Object> r : read.entrySet()) { Map<String, Object> x = map(r.getValue()); if (x.containsKey(a.id)) readings.put(r.getKey(), x.get(a.id)); }
                check(m("case_label", smp.kase, "sample_key", smp.key, "title", smp.key + " " + a.name + ": final result " + (shown != null ? shown : "(none)") + (conf != null ? ", " + conf : ""),
                    "procedure_text", "After the approval, read the stored final result of " + smp.key + " (" + spText + ").", "requirement_codes", fcodes,
                    "inputs", m("kind", "result", "analyte_id", a.id, "spec", sp, "readings", readings),
                    "expected", m("text", fin.reported() != null || fin.valueText() != null
                            ? shown + (Js.truthy(a.reportingUnit) && Js.truthy(fin.reported()) && !fin.reported().startsWith("<") && !"ND".equals(fin.reported()) ? " " + a.reportingUnit : "") + ", " + conf
                                + (fin.value() != null ? " (unrounded " + fin.value() + ")" : "")
                            : "No result: " + fin.waiting(),
                        "value", fin.value() != null ? fin.value().toString() : null, "reported", fin.reported(), "value_text", fin.valueText(), "conformance", conf, "stage", "Final")));
            }
        }
        Step finalReview = D.steps.stream().filter(s -> s.is("QC Review") && !tps.contains(s)).findFirst().orElse(null);
        String fReview = finalReview == null ? null : fStep.get(finalReview.key);
        check(m("case_label", "Process", "title", "The person who did the bench work cannot review the batch", "procedure_text", "The Verification analyst tries to approve a step in QC Review.",
            "requirement_codes", codes(uReview, fReview), "inputs", m("kind", "refuse_self_review"), "expected", m("text", "Refused: someone else must review it")));
        check(m("case_label", "Process", "title", "The batch cannot be approved before each step is approved", "procedure_text", "The Verification reviewer tries to approve the batch (signed) before approving the steps.",
            "requirement_codes", codes(uReview, fReview), "inputs", m("kind", "refuse_unapproved"), "expected", m("text", "Refused: steps not approved yet")));
        check(m("case_label", "Process", "title", "The reviewer approves each batch and the results are stored as final, signed Reviewed by",
            "procedure_text", "The Verification reviewer approves each step, accepts what needs accepting, and approves the batch (signed \"Reviewed by\").",
            "requirement_codes", codes(uReview, uTest, fReview), "inputs", m("kind", "approve"), "expected", m("text", "Every batch Approved by the Verification reviewer; one final result per sample and analyte")));
        check(m("case_label", "Process", "title", "The order shows Approved", "procedure_text", "After the last approval, read the order's status.", "requirement_codes", codes(uOrder, fOrder),
            "inputs", m("kind", "order_status"), "expected", m("text", "Approved")));
        check(m("case_label", "Process", "title", "Every recorded value and signature is in the audit trail",
            "procedure_text", "Count the audit entries of the values recorded in the batches, and the signatures of the completed steps.",
            "requirement_codes", codes(uIntegrity), "inputs", m("kind", "audit"), "expected", m("text", "One audit entry by the Verification analyst for each value recorded; each completed step points to its signature")));
        // the protocol keeps the inputs, not the rational objects
        List<Object> planSamples = new ArrayList<>();
        for (Sample s : samples)
            planSamples.add(m("key", s.key, "case", s.kase, "description", s.description, "inputs", s.inputs, "specs", s.specs, "steered", s.steered));
        Map<String, Object> planOut = m("batch", batch, "batches", new ArrayList<>(batches.stream().map(b -> (Object) new ArrayList<>(b)).toList()), "samples", planSamples);
        return new Protocol(reqs, checks, planOut);
    }

    private static List<String> listOf(String x) { List<String> l = new ArrayList<>(); l.add(x); return l; }

    private static String nnu(Object v) { return v == null ? "null" : v == JsValues.UNDEFINED ? "undefined" : str(v); }

    static List<String> expectQc(List<Map<String, Object>> qcCfg, int n, boolean first) {
        List<String> out = new ArrayList<>();
        for (Map<String, Object> q : qcCfg) {
            String f = or(q.get("frequency"), "Once"), t = str(q.get("qc_type"));
            if (f.equals("Once")) { double c = numOr(q.get("count"), 1); for (int i = 1; i <= c; i += 1) out.add(t + (c > 1 ? " " + i : "")); }
            else if (f.equals("Every N")) { double e = Math.max(numOr(q.get("every_n"), 10), 1); double k = Math.ceil(n / e) + 1; for (int i = 1; i <= k; i += 1) out.add(t + "-" + i); }
            else if (f.equals("Daily")) out.add(t + (first ? " (daily)" : " (daily, from the first batch)"));
        }
        return out;
    }

    private Map<String, Object> stepInputs(Step s) {
        String k = s.key;
        Map<String, Object> out = new LinkedHashMap<>();
        switch (s.type) {
            case "Weighing" -> { for (Sample x : samples) out.put(x.key, str(at(x.inputs, "weigh").get(k)) + " " + or(s.cfg("unit"), "g")); }
            case "Dilution" -> { for (Sample x : samples) out.put(x.key, dilText(at(x.inputs, "dil").get(k))); }
            case "Preparation" -> { Map<String, Object> p = at(batch, "prep", k); if (p != null) out.putAll(p); }
            case "Incubation" -> { Map<String, Object> p = at(batch, "inc", k); if (p != null) out.putAll(p); }
            case "Plating/Inoculation" -> { for (Sample x : samples) out.put(x.key, str(at(x.inputs, "plates").get(k)) + " plate(s)"); }
            case "Data Entry" -> { for (Sample x : samples) out.put(x.key, at(x.inputs, "read", k)); }
            default -> { }
        }
        return out;
    }

    private static String dilText(Object fields) {
        List<String> parts = new ArrayList<>();
        for (Object o : JsValues.list(fields)) { Map<String, Object> f = map(o); parts.add(str(f.get("aliquot")) + " + " + str(f.get("diluent"))); }
        return String.join(", ", parts);
    }

    // the logbook lots scanned at a step (L-2): one line per lot, with the values it gives and the analytes it serves
    private List<String> stepLots(Step s) {
        Map<String, Object> mm = at(batch, "mat", s.key);
        if (mm == null) return List.of();
        Map<String, Map<String, Object>> by = new LinkedHashMap<>();
        Map<String, Map<String, Object>> vals = new LinkedHashMap<>();
        Map<String, Set<String>> ans = new LinkedHashMap<>();
        for (Map.Entry<String, Object> ae : mm.entrySet()) {
            for (Map.Entry<String, Object> fe : map(ae.getValue()).entrySet()) {
                Map<String, Object> x = map(fe.getValue());
                String lot = str(x.get("lot_id"));
                by.putIfAbsent(lot, x);
                vals.computeIfAbsent(lot, z -> new LinkedHashMap<>()).put(fe.getKey(), x.get("value"));
                String an = D.analytes.stream().filter(a -> a.id.equals(ae.getKey())).map(a -> a.name).findFirst().orElse(ae.getKey());
                ans.computeIfAbsent(lot, z -> new LinkedHashSet<>()).add(an);
            }
        }
        List<String> out = new ArrayList<>();
        for (Map.Entry<String, Map<String, Object>> e : by.entrySet()) {
            Map<String, Object> o = e.getValue();
            List<String> v = new ArrayList<>();
            for (Map.Entry<String, Object> f : vals.get(e.getKey()).entrySet()) v.add(f.getKey() + " = " + str(f.getValue()));
            out.add(str(o.get("lot_code")) + " " + str(o.get("item_name")) + " (" + str(o.get("logbook_code")) + " entry " + str(o.get("entry_code")) + ": " + String.join(", ", v) + "; for " + String.join(", ", ans.get(e.getKey())) + ")");
        }
        return out;
    }

    private String describeStep(Step s) {
        String k = s.key;
        Map<String, Object> c = s.config;
        switch (s.type) {
            case "Batching": return "Complete the Batching step (spiked QC tied to the first sample).";
            case "Weighing": return "Record the weights (" + String.join(", ", samples.stream().map(x -> x.key + " " + str(at(x.inputs, "weigh").get(k))).toList()) + " " + or(c.get("unit"), "g") + "; prep QC as S1) and a usable balance; complete (signed).";
            case "Preparation": {
                Map<String, Object> p = at(batch, "prep", k);
                List<String> l = new ArrayList<>();
                if (p != null) for (Map.Entry<String, Object> e : p.entrySet()) l.add(e.getKey() + " = " + str(e.getValue()));
                return "Record " + (l.isEmpty() ? "nothing (no fields)" : String.join(", ", l)) + "; complete (signed).";
            }
            case "Dilution": return "Record each dilution (" + dilText(at(samples.get(0).inputs, "dil").get(k)) + " for every entry); complete (signed).";
            case "Plating/Inoculation": return "Record " + str(at(samples.get(0).inputs, "plates").get(k)) + " plate(s) per entry and a usable media lot; complete (signed).";
            case "Incubation": {
                Map<String, Object> i = at(batch, "inc", k);
                if (i == null) i = new LinkedHashMap<>();
                return "Put the batch in a usable incubator for " + nnu(i.containsKey("duration") ? i.get("duration") : JsValues.UNDEFINED) + " " + nnu(i.containsKey("unit") ? i.get("unit") : JsValues.UNDEFINED)
                    + " at " + nn(i.get("temperature"), "the target") + " °C (one load, times in the past); complete (signed).";
            }
            case "Data Entry": return "Enter the readings (see the inputs), the QC readings, the standards, spikes and strains the QC needs" + (Boolean.FALSE.equals(c.get("require_attachment")) ? "" : ", the raw data file") + " and a usable instrument; complete (signed).";
            case "Calculation": return "Read the calculated results; complete (signed).";
            default: return "Complete the step (signed).";
        }
    }
}
