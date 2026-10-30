package com.tentamus.lims.sensors.imonnit;

import com.tentamus.lims.core.excel.Js;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The reading side of the iMonnit feed (connectors/imonnit.js): one message to readings in the sensor's own unit,
 * the lab's hours (daylight saving time told apart by the offset), and what a logbook would record for one sensor and
 * measured value: an entry per hour, one per spell outside the limits, one per period with no data. Each read takes
 * the last lookback hours again, because a gateway that was offline sends its readings late.
 */
public final class ImonnitReader {
    private ImonnitReader() {}

    static final long MIN = 60_000L, HOUR = 60 * MIN;
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final Pattern MS_DATE = Pattern.compile("/Date\\((-?\\d+)");
    private static final Pattern HAS_ZONE = Pattern.compile("Z|[+-]\\d\\d:?\\d\\d$");

    /** new Date(ms).toISOString(). */
    public static String iso(long ms) { return ISO.format(Instant.ofEpochMilli(ms)); }

    /** One reading of one measured value. */
    public record Reading(String kind, String unit, double value, String guid, long sensorId, Long at, Object battery, Object signal) {}

    /** "/Date(ms)/", a number, or an ISO date (no zone given: UTC, to confirm); null when it cannot be read. */
    public static Long parseDate(Object v) {
        if (v instanceof Number n) return n.longValue();
        String s = String.valueOf(v);
        Matcher m = MS_DATE.matcher(s);
        if (m.find()) return Long.parseLong(m.group(1));
        try {
            if (HAS_ZONE.matcher(s).find() || !s.matches("(?s).*\\d:\\d.*")) {
                if (s.matches("^\\d{4}-\\d{2}-\\d{2}$")) return LocalDate.parse(s).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
                return OffsetDateTime.parse(s.endsWith("Z") ? s : s.replaceFirst("([+-]\\d\\d)(\\d\\d)$", "$1:$2")).toInstant().toEpochMilli();
            }
            return LocalDateTime.parse(s.replace(' ', 'T')).toInstant(ZoneOffset.UTC).toEpochMilli();
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static Object nn(Object v) { return v; }

    /** A message gives one reading per measured value, in the sensor's own unit (°C, % RH), never the display unit. */
    public static List<Reading> normalize(Map<String, Object> msg) {
        Long at = parseDate(msg.get("MessageDate"));
        String[] types = (Js.truthy(msg.get("DataTypes")) ? Js.string(msg.get("DataTypes")) : "").split("\\|", -1);
        Object raw = msg.get("DataValues") != null ? msg.get("DataValues") : msg.get("Data") != null ? msg.get("Data") : "";
        String[] vals = Js.string(raw).split("\\|", -1);
        List<Reading> out = new ArrayList<>();
        for (int i = 0; i < types.length; i++) {
            double v = i < vals.length ? Js.toNumber(vals[i]) : Double.NaN;
            if (!Double.isFinite(v)) continue;
            String guid = Js.string(msg.get("DataMessageGUID"));
            long sensor = (long) Js.toNumber(msg.get("SensorID"));
            if (types[i].toLowerCase().contains("temperature")) out.add(new Reading("temperature", "°C", v, guid, sensor, at, nn(msg.get("Battery")), nn(msg.get("SignalStrength"))));
            else if (types[i].toLowerCase().matches(".*(percentage|humidity).*")) out.add(new Reading("humidity", "% RH", v, guid, sensor, at, nn(msg.get("Battery")), nn(msg.get("SignalStrength"))));
        }
        return out;
    }

    /** The hour a moment falls in at the lab: its key ("2026-11-01 01:00 GMT-8") and its start and end in UTC. */
    public record Hour(String key, long start, long end) {}

    public static Hour hourOf(long t, String tz) {
        long start = Math.floorDiv(t, HOUR) * HOUR;   // every zone the labs use is a whole number of hours from UTC
        ZonedDateTime z = Instant.ofEpochMilli(start).atZone(ZoneId.of(tz));
        int off = z.getOffset().getTotalSeconds();
        String name = "GMT";
        if (off != 0) {
            int a = Math.abs(off) / 60;
            name += (off < 0 ? "-" : "+") + (a / 60) + (a % 60 != 0 ? ":" + String.format("%02d", a % 60) : "");
        }
        String key = String.format("%04d-%02d-%02d %02d:00 %s", z.getYear(), z.getMonthValue(), z.getDayOfMonth(), z.getHour(), name);
        return new Hour(key, start, start + HOUR);
    }

    /** One hour's entry. */
    public static final class HourEntry {
        public String key, result;
        public long start, end, first, last;
        public int n;
        public double min, max, mean;
        double sum;
        public List<Integer> excursions = new ArrayList<>();
        public boolean closed;
    }

    /** A spell outside the limits: consecutive readings outside lo..hi (end: the first reading back inside). */
    public static final class Excursion {
        public long start;
        public Long end;
        public double peak;
        public int n;
        public final List<double[]> readings = new ArrayList<>();
        public boolean open;
    }

    /** No reading for longer than the gap limit. */
    public record Gap(long from, Long to, long minutes, boolean open) {}

    public record Summary(List<HourEntry> hours, List<Excursion> excursions, List<Gap> gaps, int readings) {}

    /** Limits and times for summarize (lo, hi, from, to may be null). */
    public record Options(Double lo, Double hi, double gapMinutes, double closeAfterHours, String tz, long now, Long from, Long to) {
        public Options(Double lo, Double hi, String tz, long now, Long from, Long to) { this(lo, hi, 30, 2, tz, now, from, to); }
    }

    private static double z(Double v) { return v == null ? 0 : v; }

    /** What the logbook would record for ONE sensor and measured value. */
    public static Summary summarize(List<Reading> readings, Options o) {
        Set<String> seen = new HashSet<>();
        List<Reading> sorted = new ArrayList<>(readings);
        sorted.sort(Comparator.comparingLong(r -> r.at()));
        List<Reading> rs = new ArrayList<>();
        for (Reading r : sorted) if (seen.add(r.guid())) rs.add(r);
        java.util.function.DoublePredicate out = v -> (o.lo() != null && v < o.lo()) || (o.hi() != null && v > o.hi());
        double hiOrInf = o.hi() == null ? Double.POSITIVE_INFINITY : o.hi();
        List<Excursion> excursions = new ArrayList<>();
        Excursion cur = null;
        for (Reading r : rs) {
            if (out.test(r.value())) {
                if (cur == null) { cur = new Excursion(); cur.start = r.at(); cur.peak = r.value(); cur.open = true; excursions.add(cur); }
                cur.n++;
                cur.readings.add(new double[] {r.at(), r.value()});
                double dv = Math.abs(r.value() - (r.value() > hiOrInf ? z(o.hi()) : z(o.lo()))), dp = Math.abs(cur.peak - (cur.peak > hiOrInf ? z(o.hi()) : z(o.lo())));
                if (dv > dp) cur.peak = r.value();
            } else if (cur != null) { cur.end = r.at(); cur.open = false; cur = null; }
        }
        List<Gap> gaps = new ArrayList<>();
        double limit = o.gapMinutes() * MIN;
        for (int i = 1; i < rs.size(); i++) {
            long d = rs.get(i).at() - rs.get(i - 1).at();
            if (d > limit) gaps.add(new Gap(rs.get(i - 1).at(), rs.get(i).at(), Math.round((double) d / MIN), false));
        }
        if (o.from() != null && !rs.isEmpty() && rs.get(0).at() - o.from() > limit) gaps.add(0, new Gap(o.from(), rs.get(0).at(), Math.round((double) (rs.get(0).at() - o.from()) / MIN), false));
        Long tail = !rs.isEmpty() ? rs.get(rs.size() - 1).at() : o.from();
        long upTo = o.to() != null ? o.to() : o.now();
        if (tail != null && upTo - tail > limit) gaps.add(new Gap(tail, null, Math.round((double) (upTo - tail) / MIN), true));
        Map<String, HourEntry> byHour = new LinkedHashMap<>();
        for (Reading r : rs) {
            Hour h = hourOf(r.at(), o.tz());
            HourEntry x = byHour.get(h.key());
            if (x == null) {
                x = new HourEntry();
                x.key = h.key(); x.start = h.start(); x.end = h.end(); x.min = Double.POSITIVE_INFINITY; x.max = Double.NEGATIVE_INFINITY; x.first = r.at(); x.last = r.at();
                byHour.put(h.key(), x);
            }
            x.n++; x.sum += r.value(); x.min = Math.min(x.min, r.value()); x.max = Math.max(x.max, r.value()); x.last = r.at();
        }
        List<HourEntry> hours = new ArrayList<>(byHour.values());
        hours.sort(Comparator.comparingLong(h -> h.start));
        for (HourEntry x : hours) {
            for (int i = 0; i < excursions.size(); i++) {
                Excursion e = excursions.get(i);
                double end = e.open ? Double.POSITIVE_INFINITY : e.end;
                if (e.start < x.end && end >= x.start) x.excursions.add(i);
            }
            x.mean = Math.round((x.sum / x.n) * 100) / 100.0;
            x.result = out.test(x.min) || out.test(x.max) ? "Fail" : "Pass";
            x.closed = x.end + o.closeAfterHours() * HOUR <= o.now();
        }
        return new Summary(hours, excursions, gaps, rs.size());
    }

    /** What changed since an earlier summary. */
    public record Changes(List<HourEntry[]> corrections, List<HourEntry> lateHours, List<Gap> filled) {}

    /**
     * Closed hours whose figures changed (a correction with the reason "late readings from the sensor"), hours added after
     * closing, and no-data periods that later readings filled. Each correction is {before, after}.
     */
    public static Changes changes(Summary before, Summary after) {
        Map<String, HourEntry> was = new LinkedHashMap<>();
        for (HourEntry h : before.hours()) was.put(h.key, h);
        List<HourEntry[]> corrections = new ArrayList<>();
        List<HourEntry> lateHours = new ArrayList<>();
        for (HourEntry h : after.hours()) {
            HourEntry o = was.get(h.key);
            if (o == null) {
                if (h.closed && !before.hours().isEmpty() && h.start < before.hours().get(before.hours().size() - 1).start) lateHours.add(h);
                continue;
            }
            if (o.closed && (o.n != h.n || o.min != h.min || o.max != h.max || o.mean != h.mean)) corrections.add(new HourEntry[] {o, h});
        }
        List<Gap> filled = new ArrayList<>();
        for (Gap g : before.gaps()) {
            boolean still = after.gaps().stream().anyMatch(x -> x.from() == g.from() && java.util.Objects.equals(x.to(), g.to()) && x.open() == g.open());
            boolean openBoth = after.gaps().stream().anyMatch(x -> x.open() && g.open());
            if (!still && !openBoth) filled.add(g);
        }
        return new Changes(corrections, lateHours, filled);
    }

    /** A sensor link for sync: the sensor and the value it measures. */
    public record Link(Object sensorId, String kind) {}

    /**
     * One read of every linked sensor into the store (sensor id -> readings kept between reads); returns the readings
     * added per sensor.
     */
    public static Map<Object, Integer> sync(ImonnitClient api, List<Link> links, Map<Object, List<Reading>> store, long now, long since, double lookbackHours) {
        Map<Object, Integer> added = new LinkedHashMap<>();
        for (Object sensorId : new LinkedHashSet<>(links.stream().map(Link::sensorId).toList())) {
            List<Reading> have = store.computeIfAbsent(sensorId, k -> new ArrayList<>());
            Set<String> known = new HashSet<>();
            for (Reading r : have) known.add(r.guid() + r.kind());
            long last = have.isEmpty() ? since : have.stream().mapToLong(Reading::at).max().getAsLong();
            long from = Math.max(since, Math.min(last, now - (long) (lookbackHours * HOUR)));
            int n = 0;
            for (Map<String, Object> m : api.messages(sensorId, from, now)) for (Reading r : normalize(m)) if (known.add(r.guid() + r.kind())) { have.add(r); n++; }
            added.put(sensorId, n);
        }
        return added;
    }
}
