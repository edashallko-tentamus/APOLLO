package com.tentamus.lims.core.documents;

import com.fasterxml.jackson.databind.JsonNode;
import com.tentamus.lims.core.excel.Js;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.text.DecimalFormat;
import java.text.DecimalFormatSymbols;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The text helpers of the documents the server prints (the Node backend's coa.js esc, fmtDate and fmtDateTime, and the
 * invoices', quotes' and stability reports' money and dOnly), written exactly as the browser-side JavaScript wrote them
 * so the PDFs read the same: dates as "Oct 14, 2026", times as "Oct 14, 2026, 3:05 PM PDT", money as "$1,234.50".
 */
public final class Html {
    private Html() {}

    private static final DateTimeFormatter DATE = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    private static final DateTimeFormatter DATE_TIME = DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a z", Locale.US);
    private static final DateTimeFormatter MEDIUM_SHORT = DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a", Locale.US);
    private static final Pattern DATE_ONLY = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}$");
    private static final Pattern LEADING_DATE = Pattern.compile("^(\\d{4})-(\\d{2})-(\\d{2})");

    /** String(x) with & < > " ' escaped (null and undefined print nothing). */
    public static String esc(Object s) {
        return text(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;");
    }

    /** String(x) as JavaScript writes it: numbers without trailing zeros, null as "". */
    public static String text(Object s) {
        if (s == null) return "";
        if (s instanceof JsonNode n) return n.isNull() || n.isMissingNode() ? "" : n.isValueNode() ? (n.isNumber() ? Js.number(n.numberValue()) : n.asText()) : n.toString();
        return Js.string(s);
    }

    /** new Date(d): a date alone is midnight UTC (as JavaScript reads "2026-10-14"); null when d is empty or unreadable. */
    public static Instant instant(Object d) {
        if (d == null || "".equals(d) || Boolean.FALSE.equals(d)) return null;
        if (d instanceof Instant i) return i;
        if (d instanceof OffsetDateTime o) return o.toInstant();
        if (d instanceof JsonNode n) return n.isNull() ? null : instant(n.asText());
        String s = d.toString().trim();
        try {
            if (DATE_ONLY.matcher(s).matches()) return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant();
            return OffsetDateTime.parse(s.replace(' ', 'T').replaceFirst("([+-]\\d\\d)$", "$1:00")).toInstant();
        } catch (RuntimeException e) {
            try { return Instant.parse(s); } catch (RuntimeException e2) { return null; }
        }
    }

    private static ZoneId zone(String tz) { return ZoneId.of(tz == null || tz.isEmpty() ? "America/Los_Angeles" : tz); }

    /** coa.js fmtDate: "Oct 14, 2026" in the lab's time zone (Los Angeles when none). */
    public static String fmtDate(Object d, String tz) {
        Instant t = instant(d);
        return t == null ? (Js.truthy(d) ? "Invalid Date" : "") : DATE.format(t.atZone(zone(tz)));
    }

    /** coa.js fmtDateTime: "Oct 14, 2026, 3:05 PM PDT". */
    public static String fmtDateTime(Object d, String tz) {
        Instant t = instant(d);
        return t == null ? (Js.truthy(d) ? "Invalid Date" : "") : DATE_TIME.format(t.atZone(zone(tz)));
    }

    /** toLocaleString('en-US', { timeZone, dateStyle: 'medium', timeStyle: 'short' }): "Oct 14, 2026, 6:05 PM"; tz null = the server's zone. */
    public static String mediumShort(Object d, String tz) {
        Instant t = instant(d);
        if (t == null) return "";
        return MEDIUM_SHORT.format(t.atZone(tz == null || tz.isEmpty() ? ZoneId.systemDefault() : ZoneId.of(tz)));
    }

    /** dOnly: the date part of a date or timestamp, "Oct 14, 2026" (no time zone shift); anything else as fallback(d). */
    public static String dOnly(Object d, java.util.function.Function<Object, String> fallback) {
        if (!Js.truthy(d)) return "";
        Matcher m = LEADING_DATE.matcher(text(d));
        if (!m.find()) return fallback.apply(d);
        return DATE.format(LocalDate.of(Integer.parseInt(m.group(1)), Integer.parseInt(m.group(2)), Integer.parseInt(m.group(3))));
    }

    /** Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }): "1,234.50", "-12.00". */
    public static String amount(double v) {
        if (Double.isNaN(v)) return "NaN";
        if (Double.isInfinite(v)) return v > 0 ? "∞" : "-∞";
        BigDecimal b = BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP);
        DecimalFormat f = new DecimalFormat("#,##0.00", DecimalFormatSymbols.getInstance(Locale.US));
        return (b.signum() == 0 && v < 0 ? "-" : "") + f.format(b);
    }

    /** The quotes' and stability reports' money: "" for nothing, else "$" and the amount. */
    public static String money(Object v) {
        if (v == null || "".equals(v)) return "";
        return "$" + amount(Js.toNumber(v instanceof JsonNode n ? text(n) : v));
    }

    /** Number(v) for a value that may be text, a number or null (null and "" are 0). */
    public static double num(Object v) { return Js.toNumber(v instanceof JsonNode n ? text(n) : v); }

    /** A numeric value as JSON carries it in JavaScript (5 or 5.5, never 5.0): null stays null. */
    public static Object jsNumber(Object v) {
        if (!(v instanceof Number n)) return v;
        double d = n.doubleValue();
        if (n instanceof BigDecimal || n instanceof Double || n instanceof Float) return d == Math.rint(d) && Math.abs(d) < 9e15 ? (Object) (long) d : (Object) d;
        return v;
    }
}
