package com.tentamus.lims.verification.domain;

import com.tentamus.lims.core.excel.Js;
import java.math.BigInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * An exact decimal (a fraction of two whole numbers) for the verification's independent calculation (verification.js
 * class Q). A value that came from a logarithm or a root is marked approximate: it is then compared to 9 significant
 * figures, not exactly.
 */
public final class Rational {
    private static final Pattern NUMBER = Pattern.compile("^([+-]?)(\\d*)(?:\\.(\\d*))?(?:[eE]([+-]?\\d+))?$");
    public static final Rational ZERO = new Rational(BigInteger.ZERO, BigInteger.ONE, false);
    public static final Rational ONE = new Rational(BigInteger.ONE, BigInteger.ONE, false);
    final BigInteger n, d;
    public final boolean approx;

    public Rational(BigInteger n, BigInteger d, boolean approx) {
        if (d.signum() == 0) throw new CalcFailure("The formula divides by zero with these values");
        if (d.signum() < 0) { n = n.negate(); d = d.negate(); }
        BigInteger g = n.gcd(d);
        if (g.signum() == 0) g = BigInteger.ONE;
        this.n = n.divide(g);
        this.d = d.divide(g);
        this.approx = approx;
    }

    public static Rational of(long x) { return new Rational(BigInteger.valueOf(x), BigInteger.ONE, false); }

    /** Q.of(x): a Rational, a number (JavaScript's number semantics) or a decimal text. */
    public static Rational of(Object x) {
        if (x instanceof Rational r) return r;
        if (x instanceof Number num) {
            double v = num.doubleValue();
            boolean whole = Double.isFinite(v) && v == Math.rint(v);
            Rational q = parse(whole ? Js.number(v) : Js.toPrecision(v, 17));
            return whole ? q : new Rational(q.n, q.d, true);
        }
        return parse(x == null ? "null" : x.toString().strip());
    }

    private static Rational parse(String s) {
        Matcher m = NUMBER.matcher(s);
        String whole = m.matches() ? m.group(2) : null, frac = m.matches() ? (m.group(3) == null ? "" : m.group(3)) : null;
        if (whole == null || (whole.isEmpty() && frac.isEmpty())) throw new CalcFailure("Not a number: " + s);
        String digits = (whole.isEmpty() ? "0" : whole) + frac;
        long scale = frac.length() - (m.group(4) == null ? 0 : Long.parseLong(m.group(4)));
        BigInteger n = new BigInteger(digits), d = BigInteger.ONE;
        if (scale > 0) d = BigInteger.TEN.pow((int) scale);
        else if (scale < 0) n = n.multiply(BigInteger.TEN.pow((int) -scale));
        return new Rational("-".equals(m.group(1)) ? n.negate() : n, d, false);
    }

    /** Q.fromDouble: a value from floating point (a log, a root), kept to 17 significant figures and marked approximate. */
    public static Rational fromDouble(double x) {
        if (!Double.isFinite(x)) throw new CalcFailure("The formula gives a value that is not a number");
        Rational q = parse(Js.toPrecision(x, 17));
        return new Rational(q.n, q.d, true);
    }

    public Rational add(Rational o) { return new Rational(n.multiply(o.d).add(o.n.multiply(d)), d.multiply(o.d), approx || o.approx); }
    public Rational sub(Rational o) { return new Rational(n.multiply(o.d).subtract(o.n.multiply(d)), d.multiply(o.d), approx || o.approx); }
    public Rational mul(Rational o) { return new Rational(n.multiply(o.n), d.multiply(o.d), approx || o.approx); }

    public Rational div(Rational o) {
        if (o.n.signum() == 0) throw new CalcFailure("The formula divides by zero with these values");
        return new Rational(n.multiply(o.d), d.multiply(o.n), approx || o.approx);
    }

    public Rational neg() { return new Rational(n.negate(), d, approx); }
    public Rational abs() { return new Rational(n.abs(), d, approx); }
    public int cmp(Rational o) { return Integer.signum(n.multiply(o.d).compareTo(o.n.multiply(d))); }
    public boolean isZero() { return n.signum() == 0; }
    public boolean isInt() { return d.equals(BigInteger.ONE); }

    /** As a floating-point number (BigInteger to double rounds to nearest, as JavaScript's Number(bigint) does). */
    public double num() { return n.doubleValue() / d.doubleValue(); }

    /** The value rounded half away from zero to `scale` decimals (scale may be negative), as PostgreSQL prints numeric. */
    public String round(int scale) {
        if (scale >= 0) {
            BigInteger m = n.multiply(BigInteger.TEN.pow(scale));
            BigInteger q = m.divide(d), r = m.remainder(d).abs();
            if (r.shiftLeft(1).compareTo(d) >= 0) q = q.add(m.signum() < 0 ? BigInteger.ONE.negate() : BigInteger.ONE);
            String s = q.abs().toString();
            if (s.length() < scale + 1) s = "0".repeat(scale + 1 - s.length()) + s;
            String out = scale > 0 ? s.substring(0, s.length() - scale) + "." + s.substring(s.length() - scale) : s;
            return (q.signum() < 0 ? "-" : "") + out;
        }
        BigInteger p = BigInteger.TEN.pow(-scale), den = d.multiply(p);
        BigInteger q = n.divide(den), r = n.remainder(den).abs();
        if (r.shiftLeft(1).compareTo(den) >= 0) q = q.add(n.signum() < 0 ? BigInteger.ONE.negate() : BigInteger.ONE);
        return q.multiply(p).toString();
    }

    /** floor(log10(|x|)), exactly. */
    public int log10Floor() {
        Rational a = abs();
        int k = a.n.toString().length() - a.d.toString().length();
        while (pow10(k).cmp(a) > 0) k -= 1;
        while (pow10(k + 1).cmp(a) <= 0) k += 1;
        return k;
    }

    static Rational pow10(int e) {
        return e >= 0 ? new Rational(BigInteger.TEN.pow(e), BigInteger.ONE, false) : new Rational(BigInteger.ONE, BigInteger.TEN.pow(-e), false);
    }

    /** A plain decimal text with at most `sig` significant figures (for values the run enters). */
    public String toInput(int sig) {
        if (isZero()) return "0";
        String s = round(sig - 1 - log10Floor());
        return s.contains(".") ? s.replaceAll("0+$", "").replaceAll("\\.$", "") : s;
    }

    public String toInput() { return toInput(6); }

    @Override
    public String toString() {
        if (isInt()) return n.toString();
        return round(12).replaceAll("0+$", "").replaceAll("\\.$", "");
    }
}
