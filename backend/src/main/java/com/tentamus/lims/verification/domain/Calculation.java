package com.tentamus.lims.verification.domain;

import java.math.BigInteger;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The verification's independent calculation (verification.js): its own formula reader (ordinary maths precedence,
 * right-associative ^), exact arithmetic, rounding, LOQ and LOD reporting, dilution factors and specification
 * conformance, written apart from the database's calculation engine so the two can be compared. reportValue and
 * conformance stay separate from core/calc/ResultReporting (the COA check): these round exact rationals (1/3 has no
 * decimal form) and read numeric limits as JavaScript did, which BigDecimal over decimal text cannot reproduce exactly.
 */
public final class Calculation {
    private Calculation() {}

    private static final Set<String> FUNCS = Set.of("log10", "ln", "exp", "sqrt", "abs", "min", "max", "power");
    private static final Pattern LEX = Pattern.compile("(\\{[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\}|[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|[^\\s])");
    private static final Pattern PLAIN = Pattern.compile("^\\s*-?[0-9]*\\.?[0-9]+\\s*$");
    static final String LOG_ROOT = "The formula takes the log or root of a value that is zero or negative";

    static List<String> lex(Object formula) {
        List<String> out = new ArrayList<>();
        Matcher m = LEX.matcher(formula == null || formula == JsValues.UNDEFINED ? "" : formula.toString());
        while (m.find()) out.add(m.group());
        return out;
    }

    /** The {step.field} values a formula reads, once each, in order. */
    public static List<String> formulaTokens(Object f) {
        Set<String> s = new LinkedHashSet<>();
        for (String t : lex(Boolean.FALSE.equals(f) || "".equals(f) ? null : f)) if (t.startsWith("{")) s.add(t.substring(1, t.length() - 1));
        return new ArrayList<>(s);
    }

    static Rational pow(Rational a, Rational b) {
        if (b == null) throw new CalcFailure("Cannot read properties of undefined (reading 'isInt')");
        if (b.isInt() && b.n.abs().compareTo(BigInteger.valueOf(1000)) <= 0) {
            int e = b.n.intValue();
            if (e >= 0) return new Rational(a.n.pow(e), a.d.pow(e), a.approx || b.approx);
            if (a.isZero()) throw new CalcFailure("The formula divides by zero with these values");
            return new Rational(a.d.pow(-e), a.n.pow(-e), a.approx || b.approx);
        }
        if (a.cmp(Rational.ZERO) < 0) throw new CalcFailure(LOG_ROOT);
        return Rational.fromDouble(StrictMath.pow(a.num(), b.num()));
    }

    static Rational log10(Rational a) {
        if (a.cmp(Rational.ZERO) <= 0) throw new CalcFailure(LOG_ROOT);
        int k = a.log10Floor();
        if (Rational.pow10(k).cmp(a) == 0) return new Rational(BigInteger.valueOf(k), BigInteger.ONE, a.approx);
        return Rational.fromDouble(StrictMath.log10(a.num()));
    }

    /** Evaluates a formula with its {step.field} values (Rationals or decimal texts). */
    public static Rational evaluate(Object formula, Map<String, ?> values) {
        return new Parser(lex(Boolean.FALSE.equals(formula) || "".equals(formula) ? null : formula), values).run();
    }

    private static final class Parser {
        final List<String> toks;
        final Map<String, ?> values;
        int i = 0;

        Parser(List<String> toks, Map<String, ?> values) { this.toks = toks; this.values = values; }

        String peek() { return i < toks.size() ? toks.get(i) : null; }
        String next() { String t = peek(); i++; return t; }
        String at(int k) { return k >= 0 && k < toks.size() ? toks.get(k) : null; }

        void expect(String t) {
            if (!t.equals(next())) throw new CalcFailure("The formula cannot be read near \"" + (at(i - 1) == null ? "the end" : at(i - 1)) + "\"");
        }

        Rational run() {
            Rational v = expr();
            if (i < toks.size()) throw new CalcFailure("The formula cannot be read near \"" + toks.get(i) + "\"");
            return v;
        }

        Rational expr() {
            Rational v = term();
            while ("+".equals(peek()) || "-".equals(peek())) { String op = next(); Rational r = term(); v = op.equals("+") ? v.add(r) : v.sub(r); }
            return v;
        }

        Rational term() {
            Rational v = unary();
            while ("*".equals(peek()) || "/".equals(peek())) { String op = next(); Rational r = unary(); v = op.equals("*") ? v.mul(r) : v.div(r); }
            return v;
        }

        Rational unary() {
            if ("-".equals(peek())) { next(); return unary().neg(); }
            if ("+".equals(peek())) { next(); return unary(); }
            return power();
        }

        Rational power() {
            Rational b = primary();
            if ("^".equals(peek())) { next(); return pow(b, unary()); }
            return b;
        }

        Rational primary() {
            String t = next();
            if (t == null) throw new CalcFailure("The formula ends too early");
            if (t.equals("(")) { Rational v = expr(); expect(")"); return v; }
            if (t.startsWith("{")) {
                String k = t.substring(1, t.length() - 1);
                Object v = values.get(k);
                if (v == null || v == JsValues.UNDEFINED) throw new CalcFailure("No numeric value for " + t);
                return Rational.of(v);
            }
            if (t.matches("^[0-9.].*")) return Rational.of(t);
            String f = t.toLowerCase();
            if (!FUNCS.contains(f)) throw new CalcFailure("\"" + t + "\" is not a known function");
            expect("(");
            List<Rational> args = new ArrayList<>();
            args.add(expr());
            while (",".equals(peek())) { next(); args.add(expr()); }
            expect(")");
            Rational a = args.get(0);
            switch (f) {
                case "abs": return a.abs();
                case "min": { Rational x = args.get(0); for (Rational y : args.subList(1, args.size())) if (y.cmp(x) < 0) x = y; return x; }
                case "max": { Rational x = args.get(0); for (Rational y : args.subList(1, args.size())) if (y.cmp(x) > 0) x = y; return x; }
                case "power": return pow(a, args.size() > 1 ? args.get(1) : null);
                case "log10": return log10(a);
                case "ln": if (a.cmp(Rational.ZERO) <= 0) throw new CalcFailure(LOG_ROOT); return Rational.fromDouble(StrictMath.log(a.num()));
                case "exp": { double x = a.num(); return Rational.fromDouble(x == 1 ? Math.E : StrictMath.exp(x)); }   // V8: fdlibm, with exp(1) = Math.E
                case "sqrt": if (a.cmp(Rational.ZERO) < 0) throw new CalcFailure(LOG_ROOT); return Rational.fromDouble(StrictMath.sqrt(a.num()));
                default: throw new CalcFailure("Unknown function " + f);
            }
        }
    }

    /** A field's key from its label ("Final volume" -> final_volume). */
    public static String fieldKey(Object label) {
        return (label == null ? "" : JsValues.str(label)).toLowerCase().replaceAll("[^a-z0-9]+", "_").replaceAll("^_+|_+$", "");
    }

    public static String roundResult(Rational v, String mode, int digits) {
        if ("Decimal places".equals(mode)) return v.round(digits);
        if (v.isZero()) return Rational.ZERO.round(Math.max(digits - 1, 0));
        return v.round(digits - 1 - v.log10Floor());
    }

    /** A numeric result as reported for an analyte: "ND" below the LOD when chosen, "< LOQ" below the LOQ, else rounded. */
    public static String reportValue(Rational v, Analyte a, Design.Version version) {
        if (v == null) return null;
        if (version.ndBelowLod() && a.lod != null && v.cmp(Rational.of(a.lod)) < 0) return "ND";
        if (a.loq != null && v.cmp(Rational.of(a.loq)) < 0) return "< " + a.loq;
        return roundResult(v, a.roundingMode != null && !a.roundingMode.isEmpty() ? a.roundingMode : version.roundingMode(),
            a.roundingDigits != null ? a.roundingDigits : version.roundingDigits());
    }

    /** Whether a reported result conforms to the sample's specification (min, max, text; limits in the result's unit). */
    public static String conformance(Map<String, Object> spec, Analyte a, String reported, String valueText) {
        if (spec == null) return "No specification";
        Object min = spec.get("min"), max = spec.get("max");
        if (min == null && max == null) {
            if (valueText == null) return "Not compared";
            return a.foundValues.contains(valueText) ? "Does not conform" : "Conforms";
        }
        Rational x;
        boolean below = false;
        if (reported != null && PLAIN.matcher(reported).matches()) x = Rational.of(reported);
        else if (reported != null && !reported.isEmpty() && (reported.startsWith("<") || reported.equals("ND"))) {
            below = true;
            String d = reported.replaceAll("[^0-9.]", "");
            x = d.isEmpty() ? Rational.ZERO : Rational.of(d);
        } else return "Not compared";
        boolean out = (max != null && x.cmp(Rational.of(max)) > 0 && !below) || (min != null && (x.cmp(Rational.of(min)) < 0 || below));
        return out ? "Does not conform" : "Conforms";
    }

    private static boolean given(Object v) { return v != null && v != JsValues.UNDEFINED; }

    private static Rational diluent(Object v) { return !given(v) || "".equals(v) ? Rational.ZERO : Rational.of(v); }

    /** The dilution factor of a list of {aliquot, diluent} (null when none is usable). */
    public static Rational dilutionFactor(List<?> fields) {
        Rational v = null;
        for (Object o : fields == null ? List.of() : fields) {
            Map<String, Object> f = JsValues.map(o);
            if (given(f.get("aliquot")) && Rational.of(f.get("aliquot")).cmp(Rational.ZERO) > 0) {
                Rational a = Rational.of(f.get("aliquot")), d = diluent(f.get("diluent"));
                v = (v == null ? Rational.ONE : v).mul(a.add(d).div(a));
            }
        }
        return v;
    }

    public static Rational dilutionFinalVolume(List<?> fields) {
        Map<String, Object> last = null;
        for (Object o : fields == null ? List.of() : fields) {
            Map<String, Object> f = JsValues.map(o);
            if (given(f.get("aliquot")) && Rational.of(f.get("aliquot")).cmp(Rational.ZERO) > 0) last = f;
        }
        return last == null ? null : Rational.of(last.get("aliquot")).add(diluent(last.get("diluent")));
    }

    /** Two unrounded values agree (the database divides to about 20 significant figures; logarithms are approximate). */
    public static boolean close(Object a, Object b) {
        if (a == null || b == null) return a == b;
        double x = Rational.of(a).num(), y = Rational.of(b).num();
        return Math.abs(x - y) <= 1e-9 * Math.max(Math.abs(x), Math.abs(y)) + 1e-12;
    }
}
