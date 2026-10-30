package com.tentamus.lims.testing.domain.calc;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A test's calculation: numbers, {step.field} tokens, + - * / ^ ( ) and the functions log10 ln exp sqrt abs min max power.
 * Java's own copy of the database functions formula_lex, formula_tokens, formula_check and formula_eval, which stay in the
 * database because the bench's live results (batch_results), logbooks, the workflow verification and the designer's
 * try-out still call them. It evaluates as PostgreSQL does (a sign binds tighter than ^, and ^ is left associative), so
 * Java's result agrees with the database's.
 */
public final class Formula {
    public static final MathContext MC = new MathContext(34, RoundingMode.HALF_EVEN);
    private static final Pattern LEX = Pattern.compile(
        "(\\{[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\}|[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|[^\\s])");
    private static final List<String> FUNCTIONS = List.of("log10", "ln", "exp", "sqrt", "abs", "min", "max", "power");
    public static final String LOG_OR_ROOT = "The formula takes the log or root of a value that is zero or negative";
    public static final String DIVIDES_BY_ZERO = "The formula divides by zero with these values";

    private final String text;
    private final List<String> tokens;

    private Formula(String text) {
        this.text = text;
        this.tokens = lex(text);
    }

    public static Formula of(String text) { return new Formula(text); }

    static List<String> lex(String text) {
        List<String> out = new ArrayList<>();
        Matcher m = LEX.matcher(text == null ? "" : text);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** The {step.field} tokens it uses, sorted and without braces (formula_tokens). */
    public Set<String> tokens() {
        Set<String> out = new TreeSet<>();
        for (String t : tokens) if (t.startsWith("{")) out.add(t.substring(1, t.length() - 1));
        return out;
    }

    /** Null when the formula is well formed, else what is wrong with it (formula_check). */
    public String problem() {
        if (text == null || text.isBlank()) return "The formula is empty";
        boolean expectOperand = true;
        List<Character> stack = new ArrayList<>();
        String prev = "";
        for (String t : tokens) {
            if (expectOperand) {
                if (Character.isDigit(t.charAt(0)) || t.charAt(0) == '.' || t.startsWith("{")) expectOperand = false;
                else if (t.equals("(")) stack.add("__func".equals(prev) ? 'f' : 'p');
                else if (t.equals("-") || t.equals("+")) { /* a sign */ }
                else if (Character.isLetter(t.charAt(0)) || t.charAt(0) == '_') {
                    if (!FUNCTIONS.contains(t.toLowerCase(Locale.ROOT)))
                        return "\"" + t + "\" is not a step token or a known function (use {step.field}, or " + String.join(", ", FUNCTIONS) + ")";
                    prev = "__func";
                    continue;
                } else return "\"" + t + "\" is out of place";
                if ("__func".equals(prev) && !t.equals("(")) return "A function name must be followed by (";
            } else {
                if (Set.of("+", "-", "*", "/", "^").contains(t)) expectOperand = true;
                else if (t.equals(")")) {
                    if (stack.isEmpty()) return "There is a ) without its (";
                    stack.remove(stack.size() - 1);
                } else if (t.equals(",")) {
                    if (stack.isEmpty() || stack.get(stack.size() - 1) != 'f') return "A comma can only separate a function's values";
                    expectOperand = true;
                } else return "\"" + t + "\" is out of place (an operator is missing before it)";
            }
            prev = t;
        }
        if (expectOperand) return "The formula ends with an operator or is missing a value";
        if (!stack.isEmpty()) return "A ( is not closed";
        return null;
    }

    /** The value with the given token values ({"weigh.weight": 0.5012, ...}); refuses as formula_eval does. */
    public BigDecimal evaluate(Map<String, BigDecimal> values) {
        String prob = problem();
        if (prob != null) throw RuleException.database("The formula cannot be used: " + prob);
        try {
            Parser p = new Parser(values);
            BigDecimal v = p.expr();
            if (p.i != tokens.size()) throw RuleException.database("The formula cannot be used: \"" + tokens.get(p.i) + "\" is out of place");
            return v;
        } catch (ArithmeticException e) {
            throw RuleException.database(DIVIDES_BY_ZERO);
        }
    }

    /** Two calculations of the same result agree to 1 part in a billion (the database's numeric and Java's decimals differ only far down). */
    public static boolean agrees(BigDecimal a, BigDecimal b) {
        if (a == null || b == null) return a == b;
        BigDecimal scale = a.abs().max(b.abs());
        return a.subtract(b).abs().compareTo(scale.multiply(new BigDecimal("1e-9"))) <= 0;
    }

    /** Recursive descent with PostgreSQL's precedence: + -, then * /, then ^ (left), then a sign. */
    private final class Parser {
        private final Map<String, BigDecimal> values;
        int i;

        Parser(Map<String, BigDecimal> values) { this.values = values; }

        private String peek() { return i < tokens.size() ? tokens.get(i) : null; }

        BigDecimal expr() {
            BigDecimal v = term();
            for (String t = peek(); "+".equals(t) || "-".equals(t); t = peek()) {
                i++;
                BigDecimal r = term();
                v = "+".equals(t) ? v.add(r, MC) : v.subtract(r, MC);
            }
            return v;
        }

        BigDecimal term() {
            BigDecimal v = power();
            for (String t = peek(); "*".equals(t) || "/".equals(t); t = peek()) {
                i++;
                BigDecimal r = power();
                if ("*".equals(t)) v = v.multiply(r, MC);
                else {
                    if (r.signum() == 0) throw RuleException.database(DIVIDES_BY_ZERO);
                    v = v.divide(r, MC);
                }
            }
            return v;
        }

        BigDecimal power() {
            BigDecimal v = unary();
            while ("^".equals(peek())) {
                i++;
                v = pow(v, unary());
            }
            return v;
        }

        BigDecimal unary() {
            String t = peek();
            if ("-".equals(t)) { i++; return unary().negate(); }
            if ("+".equals(t)) { i++; return unary(); }
            return primary();
        }

        BigDecimal primary() {
            String t = tokens.get(i++);
            if (t.startsWith("{")) {
                BigDecimal v = values == null ? null : values.get(t.substring(1, t.length() - 1));
                if (v == null) throw RuleException.database("No numeric value for " + t);
                return v;
            }
            if (Character.isDigit(t.charAt(0)) || t.charAt(0) == '.') return new BigDecimal(t);
            if (t.equals("(")) {
                BigDecimal v = expr();
                i++;   // the ")"
                return v;
            }
            String f = t.toLowerCase(Locale.ROOT);
            i++;   // the "("
            List<BigDecimal> args = new ArrayList<>();
            if (!")".equals(peek())) {
                args.add(expr());
                while (",".equals(peek())) { i++; args.add(expr()); }
            }
            i++;   // the ")"
            return call(f, args);
        }
    }

    private static BigDecimal call(String f, List<BigDecimal> a) {
        int n = a.size();
        boolean one = n == 1;
        switch (f) {
            case "abs": if (one) return a.get(0).abs(); break;
            case "sqrt":
                if (one) {
                    if (a.get(0).signum() < 0) throw RuleException.database(LOG_OR_ROOT);
                    return a.get(0).sqrt(MC);
                }
                break;
            case "ln": if (one) return BigDecimal.valueOf(Math.log(positive(a.get(0)).doubleValue())); break;
            case "log10":
                if (one) return log10(positive(a.get(0)));
                if (n == 2) return BigDecimal.valueOf(Math.log(positive(a.get(1)).doubleValue()) / Math.log(positive(a.get(0)).doubleValue()));
                break;
            case "exp": if (one) return BigDecimal.valueOf(Math.exp(a.get(0).doubleValue())); break;
            case "power": if (n == 2) return pow(a.get(0), a.get(1)); break;
            case "min": if (n >= 1) return a.stream().min(BigDecimal::compareTo).orElseThrow(); break;
            case "max": if (n >= 1) return a.stream().max(BigDecimal::compareTo).orElseThrow(); break;
            default: break;
        }
        throw RuleException.database("The formula cannot be used: " + f + " does not take " + n + " value" + (n == 1 ? "" : "s"));
    }

    private static BigDecimal positive(BigDecimal v) {
        if (v.signum() <= 0) throw RuleException.database(LOG_OR_ROOT);
        return v;
    }

    /** log10, exact for powers of ten (as PostgreSQL's numeric log is). */
    private static BigDecimal log10(BigDecimal v) {
        BigDecimal s = v.stripTrailingZeros();
        if (s.unscaledValue().abs().equals(java.math.BigInteger.ONE)) return BigDecimal.valueOf(-s.scale());
        return BigDecimal.valueOf(Math.log10(v.doubleValue()));
    }

    private static BigDecimal pow(BigDecimal base, BigDecimal exp) {
        if (base.signum() == 0 && exp.signum() < 0) throw RuleException.database(LOG_OR_ROOT);
        BigDecimal e = exp.stripTrailingZeros();
        if (e.scale() <= 0 && e.abs().compareTo(BigDecimal.valueOf(9999)) <= 0) {
            int k = e.intValueExact();
            return k >= 0 ? base.pow(k, MC) : BigDecimal.ONE.divide(base.pow(-k, MC), MC);
        }
        if (base.signum() < 0) throw RuleException.database(LOG_OR_ROOT);
        return BigDecimal.valueOf(Math.pow(base.doubleValue(), exp.doubleValue()));
    }
}
