package com.tentamus.lims.methods.domain;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A formula as the designer checks it: numbers, {step.field} tokens, + - * / ^ ( ) and the functions log10 ln exp sqrt
 * abs min max power. Java's own copy of the database's formula_lex, formula_tokens and formula_check (kept in the database:
 * the logbooks and the bench still call them). Evaluating a formula is the calculation engine's (formula_eval), not this.
 */
public final class Formula {
    private static final Pattern TOKEN = Pattern.compile(
        "(\\{[a-z][a-z0-9_]*\\.[a-z][a-z0-9_]*\\}|[0-9]*\\.?[0-9]+(?:[eE][-+]?[0-9]+)?|[A-Za-z_][A-Za-z0-9_]*|[-+*/^(),]|[^\\s])");
    private static final List<String> FUNCTIONS = List.of("log10", "ln", "exp", "sqrt", "abs", "min", "max", "power");
    private static final Set<String> OPERATORS = Set.of("+", "-", "*", "/", "^");

    private final String text;

    public Formula(String text) { this.text = text; }

    public static Formula of(String text) { return new Formula(text); }

    List<String> lex() {
        List<String> out = new ArrayList<>();
        Matcher m = TOKEN.matcher(text == null ? "" : text);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** The {step.field} tokens it uses, without braces, each once, sorted. */
    public List<String> tokens() {
        TreeSet<String> out = new TreeSet<>();
        for (String t : lex()) if (t.startsWith("{")) out.add(t.substring(1, t.length() - 1));
        return new ArrayList<>(out);
    }

    /** Null when the formula is well formed, else what is wrong with it. */
    public String problem() {
        if (text == null || text.strip().isEmpty()) return "The formula is empty";
        boolean expectOperand = true;
        Deque<Character> stack = new ArrayDeque<>();
        String prev = "";
        for (String tok : lex()) {
            if (expectOperand) {
                if (tok.matches("^[0-9.].*") || tok.startsWith("{")) expectOperand = false;
                else if (tok.equals("(")) stack.push("__func".equals(prev) ? 'f' : 'p');
                else if (tok.equals("-") || tok.equals("+")) { /* a sign */ }
                else if (tok.matches("^[A-Za-z_].*")) {
                    if (!FUNCTIONS.contains(tok.toLowerCase()))
                        return "\"" + tok + "\" is not a step token or a known function (use {step.field}, or " + String.join(", ", FUNCTIONS) + ")";
                    prev = "__func";
                    continue;
                } else return "\"" + tok + "\" is out of place";
                if ("__func".equals(prev) && !tok.equals("(")) return "A function name must be followed by (";
            } else {
                if (OPERATORS.contains(tok)) expectOperand = true;
                else if (tok.equals(")")) {
                    if (stack.isEmpty()) return "There is a ) without its (";
                    stack.pop();
                } else if (tok.equals(",")) {
                    if (stack.isEmpty() || stack.peek() != 'f') return "A comma can only separate a function's values";
                    expectOperand = true;
                } else return "\"" + tok + "\" is out of place (an operator is missing before it)";
            }
            prev = tok;
        }
        if (expectOperand) return "The formula ends with an operator or is missing a value";
        if (!stack.isEmpty()) return "A ( is not closed";
        return null;
    }
}
