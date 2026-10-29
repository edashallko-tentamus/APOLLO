package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.web.RuleException;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * One row of a controlled list about to be written: the row as stored (none for a new one) and the values a save
 * brings. Each list's own class checks its rules in {@link #check(MasterFacts)} and returns the values to write.
 */
public abstract class MasterRecord {
    private final Map<String, Object> stored;
    protected final Map<String, Object> values;

    protected MasterRecord(Map<String, Object> stored, Map<String, Object> changes) {
        this.stored = stored;
        this.values = new LinkedHashMap<>(changes);
    }

    /** Applies the list's rules; returns the values to write (possibly tidied, e.g. trimmed or defaulted). */
    public abstract Map<String, Object> check(MasterFacts facts);

    public boolean isNew() { return stored == null; }

    /** The value the row will hold: the one being written, else the stored one. */
    protected Object value(String col) {
        return values.containsKey(col) ? values.get(col) : stored == null ? null : stored.get(col);
    }

    protected Object storedValue(String col) { return stored == null ? null : stored.get(col); }

    /** Whether this save sets the column (always for a new row). */
    protected boolean touches(String col) { return isNew() || values.containsKey(col); }

    /** Whether this save changes a stored value (numbers compared by value, 1.50 = 1.5). */
    protected boolean changes(String col) {
        return !isNew() && values.containsKey(col) && !same(stored.get(col), values.get(col));
    }

    protected String text(String col) {
        Object v = value(col);
        return v == null ? null : v.toString();
    }

    protected static boolean blank(Object v) { return v == null || v.toString().strip().isEmpty(); }

    /** A required text column: refused when it would be blank. */
    protected void requireText(String col, String message) {
        if (touches(col) && blank(value(col))) throw RuleException.withCode(message, "23514");
    }

    /** Trims the text being written to a column (the database used to do it in its trigger). */
    protected void trim(String col) {
        if (values.get(col) != null) values.put(col, values.get(col).toString().strip());
    }

    /** A number column's value, or null when empty or not a number (the database then refuses the type itself). */
    protected BigDecimal number(String col) { return toNumber(value(col)); }

    static BigDecimal toNumber(Object v) {
        if (v == null) return null;
        if (v instanceof BigDecimal b) return b;
        try { return new BigDecimal(v.toString().strip()); } catch (NumberFormatException e) { return null; }
    }

    static boolean same(Object a, Object b) {
        if (a == null || b == null) return a == b;
        BigDecimal x = toNumber(a), y = toNumber(b);
        if (x != null && y != null) return x.compareTo(y) == 0;
        return Objects.equals(a.toString(), b.toString());
    }
}
