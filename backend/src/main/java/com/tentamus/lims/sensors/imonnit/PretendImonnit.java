package com.tentamus.lims.sensors.imonnit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import com.tentamus.lims.core.excel.Js;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A pretend iMonnit service (connectors/imonnit_mock.js): known, repeatable sensor readings served the way the iMonnit
 * REST API is expected to, on its own loopback port, so the feed can be built and tested without a licence. The
 * Sandbox's pretend connection starts one in live mode on first use. ASSUMED, not confirmed (Monnit's method reference
 * needs an iMonnit sign-in): the URL form /json/Method/token, the method names, the message fields, a 24-hour range
 * limit per call and an occasional "too many requests" (429).
 */
public final class PretendImonnit {
    static final long MIN = 60_000L;
    public static final String TOKEN = "mock-token";
    private static final ObjectMapper JSON = new ObjectMapper();

    /** A pretend sensor. */
    public record Sensor(long id, String name, int applicationID, String kind, double base, double noise, Double baseT, Double noiseT, int seed) {}

    /** A window of the scenario on one sensor (arrives: when held readings come in). */
    public record Window(long sensor, long from, long to, Double value, Long arrives) {
        Window move(long d) { return new Window(sensor, from + d, to + d, value, arrives == null ? null : arrives + d); }
    }

    /** The scenario: sensors, the fridge's excursion (its values), silences, a humid spell and late readings. */
    public record Scenario(long start, long end, int heartbeatMinutes, List<Sensor> sensors, Window excursion, double[] excursionValues, List<Window> silent, Window humid, Window late) {}

    private static long at(String iso) { return Instant.parse(iso).toEpochMilli(); }

    // 49 hours from 2026-10-31 00:00 to 2026-11-02 00:00 at the lab (America/Los_Angeles), across the end of daylight saving time
    public static final long START = at("2026-10-31T07:00:00Z"), END = at("2026-11-02T08:00:00Z");
    public static final Scenario SCENARIO = new Scenario(START, END, 5,
        List.of(new Sensor(501001, "Reagent refrigerator 1", 2, "temperature", 4.6, 0.3, null, null, 11),
            new Sensor(501002, "Incubator 35 C", 2, "temperature", 34.0, 0.15, null, null, 22),
            new Sensor(501003, "Balance room", 43, "humidity", 41, 1.5, 21.0, 0.3, 33)),
        new Window(501001, at("2026-10-31T17:20:00Z"), at("2026-10-31T17:45:00Z"), null, null), new double[] {8.6, 9.1, 9.4, 9.2, 8.7, 8.2},
        List.of(new Window(501002, at("2026-10-31T21:00:00Z"), at("2026-10-31T21:40:00Z"), null, null), new Window(501002, at("2026-11-01T01:05:00Z"), at("2026-11-01T01:10:00Z"), null, null)),
        new Window(501003, at("2026-11-01T09:30:00Z"), at("2026-11-01T09:35:00Z"), 63.0, null),
        new Window(501001, at("2026-11-01T10:30:00Z"), at("2026-11-01T12:55:00Z"), null, at("2026-11-01T17:00:00Z")));

    /** mulberry32: repeatable noise, as the Node mock's rng(seed). */
    static final class Rng {
        private int seed;
        Rng(int seed) { this.seed = seed; }
        double next() {
            seed = seed + 0x6D2B79F5;
            int t = (seed ^ (seed >>> 15)) * (1 | seed);
            t = (t + (t ^ (t >>> 7)) * (61 | t)) ^ t;
            return ((t ^ (t >>> 14)) & 0xFFFFFFFFL) / 4294967296.0;
        }
    }

    static double r1(double v) { return Math.round(v * 10) / 10.0; }

    static double cToF(double c) { return r1(c * 9 / 5 + 32); }

    /** One reading the sensor sends (availableAt: when the service has it). */
    public record Message(long sensorId, long t, double value, Double temp, long availableAt, String guid) {}

    public static List<Message> readingsOf(Sensor s, Scenario sc) {
        Rng rand = new Rng(s.seed());
        List<Message> out = new ArrayList<>();
        for (long t = sc.start(); t < sc.end(); t += sc.heartbeatMinutes() * MIN) {
            double n1 = rand.next() - 0.5, n2 = rand.next() - 0.5;
            final long tt = t;
            if (sc.silent().stream().anyMatch(g -> g.sensor() == s.id() && tt >= g.from() && tt <= g.to())) continue;
            double v = r1(s.base() + n1 * 2 * s.noise());
            Window ex = sc.excursion();
            if (ex.sensor() == s.id() && t >= ex.from() && t <= ex.to()) v = sc.excursionValues()[(int) Math.round((double) (t - ex.from()) / (5 * MIN))];
            if (sc.humid().sensor() == s.id() && t >= sc.humid().from() && t <= sc.humid().to()) v = sc.humid().value();
            boolean late = sc.late().sensor() == s.id() && t >= sc.late().from() && t <= sc.late().to();
            out.add(new Message(s.id(), t, v, "humidity".equals(s.kind()) ? r1(s.baseT() + n2 * 2 * s.noiseT()) : null, late ? sc.late().arrives() : t + 30000, s.id() + "-" + t));
        }
        return out;
    }

    public static List<Message> readingsOf(Sensor s) { return readingsOf(s, SCENARIO); }

    // what the API is expected to answer for one reading
    static Map<String, Object> message(Sensor s, Message m) {
        String digits = m.guid().replaceAll("\\D", "");
        digits = digits.substring(Math.max(0, digits.length() - 12));
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("DataMessageGUID", "00000000-0000-4000-8000-" + "0".repeat(12 - digits.length()) + digits);
        b.put("SensorID", s.id()); b.put("MessageDate", "/Date(" + m.t() + ")/"); b.put("State", 0); b.put("SignalStrength", 84); b.put("Voltage", 3.01);
        b.put("Battery", s.id() == 501002 ? 18 : 92); b.put("GatewayID", 900001);
        String v = Js.number(m.value());
        if ("humidity".equals(s.kind())) {
            String t = Js.number(m.temp());
            b.put("Data", v); b.put("DisplayData", v + "% @ " + Js.number(cToF(m.temp())) + "° F"); b.put("DataValues", v + "|" + t); b.put("DataTypes", "Percentage|TemperatureData");
            b.put("PlotValues", v + "|" + Js.number(cToF(m.temp()))); b.put("PlotLabels", "Humidity|Fahrenheit"); b.put("MetNotificationRequirements", m.value() > 60);
        } else {
            b.put("Data", v); b.put("DisplayData", Js.number(cToF(m.value())) + "° F"); b.put("DataValues", v); b.put("DataTypes", "TemperatureData");
            b.put("PlotValues", Js.number(cToF(m.value()))); b.put("PlotLabels", "Fahrenheit"); b.put("MetNotificationRequirements", m.value() > 8);
        }
        return b;
    }

    static double parseQueryDate(String v) {
        if (v == null || v.isEmpty()) return Double.NaN;
        if (v.matches("^\\d+$")) return Double.parseDouble(v);
        try { return OffsetDateTime.parse(v.matches("(?s).*(Z|[+-]\\d\\d:?\\d\\d)$") ? v : v + "Z").toInstant().toEpochMilli(); } catch (RuntimeException e) { return Double.NaN; }
    }

    /** The same scenario moved so that it ends at `end`, and carried on for `extraDays` (readings as usual after it). */
    public static Scenario shifted(long end, int extraDays) {
        long d = end - SCENARIO.end();
        return new Scenario(SCENARIO.start() + d, end + extraDays * 24L * 60 * MIN, SCENARIO.heartbeatMinutes(), SCENARIO.sensors(), SCENARIO.excursion().move(d), SCENARIO.excursionValues(),
            SCENARIO.silent().stream().map(w -> w.move(d)).toList(), SCENARIO.humid().move(d), SCENARIO.late().move(d));
    }

    private final HttpServer server;
    private final Scenario sc;
    private final Map<Long, List<Message>> all = new LinkedHashMap<>();
    private final int maxRangeHours;
    private final boolean duplicates;
    public final String token;
    private volatile Long now;
    private volatile int fail = 0;
    /** Each call: {method, query}. */
    public final List<Map<String, Object>> calls = Collections.synchronizedList(new ArrayList<>());

    /**
     * fixed (default): the scenario of 2026-10-31 to 2026-11-02, read as at `now`; live: the scenario's 49 hours end when the
     * service starts (on the 5 minutes), readings carry on every 5 minutes for 30 days, "now" is the clock; endAt: the
     * scenario ends then, "now" given by setNow().
     */
    public static PretendImonnit start(Long now, boolean live, Long endAt) { return new PretendImonnit(0, now == null ? END : now, TOKEN, 24, true, live, endAt); }

    private PretendImonnit(int port, long nowAt, String token, int maxRangeHours, boolean duplicates, boolean live, Long endAt) {
        this.sc = live ? shifted(Math.floorDiv(System.currentTimeMillis(), 5 * MIN) * 5 * MIN, 30) : endAt != null ? shifted(endAt, 0) : SCENARIO;
        for (Sensor s : sc.sensors()) all.put(s.id(), readingsOf(s, sc));
        this.token = token; this.maxRangeHours = maxRangeHours; this.duplicates = duplicates;
        this.now = live ? null : endAt != null && nowAt == END ? endAt : nowAt;
        try {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        } catch (IOException e) { throw new IllegalStateException(e); }
        server.createContext("/", this::handle);
        server.start();
    }

    public String url() { return "http://127.0.0.1:" + server.getAddress().getPort(); }

    public void setNow(long ms) { now = ms; }

    public void failNext(int n) { fail = n; }

    public void close() { server.stop(0); }

    private long nowMs() { Long n = now; return n == null ? System.currentTimeMillis() : n; }

    private static void send(HttpExchange ex, int code, Object body) throws IOException {
        byte[] b = JSON.writeValueAsBytes(body);
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.sendResponseHeaders(code, b.length);
        try (OutputStream o = ex.getResponseBody()) { o.write(b); }
    }

    private static Map<String, Object> answer(String method, Object result) { Map<String, Object> m = new LinkedHashMap<>(); m.put("Method", method); m.put("Result", result); return m; }

    private synchronized void handle(HttpExchange ex) throws IOException {
        String[] p = ex.getRequestURI().getRawPath().split("/", -1);
        String fmt = p.length > 1 ? p[1] : null, method = p.length > 2 ? URLDecoder.decode(p[2], StandardCharsets.UTF_8) : null, tok = p.length > 3 ? URLDecoder.decode(p[3], StandardCharsets.UTF_8) : null;
        Map<String, String> q = new LinkedHashMap<>();
        String raw = ex.getRequestURI().getRawQuery();
        if (raw != null) for (String kv : raw.split("&")) {
            if (kv.isEmpty()) continue;
            int i = kv.indexOf('=');
            q.put(URLDecoder.decode(i < 0 ? kv : kv.substring(0, i), StandardCharsets.UTF_8), i < 0 ? "" : URLDecoder.decode(kv.substring(i + 1), StandardCharsets.UTF_8));
        }
        Map<String, Object> call = new LinkedHashMap<>();
        call.put("method", method); call.put("query", q);
        calls.add(call);
        if (!"json".equals(fmt)) { send(ex, 404, answer(method, "Only /json/ is served by the mock")); return; }
        if (!token.equals(tok)) { send(ex, 401, answer(method, "Invalid Authorization Token")); return; }
        if (fail > 0) { fail--; send(ex, 429, answer(method, "Too many requests")); return; }
        if ("SensorList".equals(method)) {
            List<Object> list = new ArrayList<>();
            for (Sensor s : sc.sensors()) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("SensorID", s.id()); m.put("SensorName", s.name()); m.put("MonnitApplicationID", s.applicationID()); m.put("CSNetID", 4001);
                m.put("LastCommunicationDate", "/Date(" + Math.min(nowMs(), sc.end()) + ")/"); m.put("ReportInterval", sc.heartbeatMinutes()); m.put("Status", 0);
                m.put("BatteryLevel", s.id() == 501002 ? 18 : 92); m.put("SignalStrength", 84); m.put("IsActive", true);
                list.add(m);
            }
            send(ex, 200, answer(method, list));
            return;
        }
        if ("SensorDataMessages".equals(method)) {
            Sensor s = sc.sensors().stream().filter(x -> String.valueOf(x.id()).equals(q.get("sensorID"))).findFirst().orElse(null);
            if (s == null) { send(ex, 200, answer(method, "Invalid SensorID")); return; }
            double from = parseQueryDate(q.get("fromDate")), to = parseQueryDate(q.get("toDate"));
            if (!(from < to)) { send(ex, 200, answer(method, "Invalid date range")); return; }
            if (to - from > maxRangeHours * 60 * MIN) { send(ex, 200, answer(method, "Date range cannot exceed " + maxRangeHours + " hours")); return; }
            long n = nowMs();
            List<Message> ms = new ArrayList<>(all.get(s.id()).stream().filter(m -> m.t() >= from && m.t() <= to && m.t() <= n && m.availableAt() <= n).toList());
            ms.sort(Comparator.comparingLong((Message m) -> m.t()).reversed());
            List<Object> rows = new ArrayList<>();
            for (Message m : ms) rows.add(message(s, m));
            if (duplicates && rows.size() > 3) rows.add(2, rows.get(1));   // the same message twice, as a retried upload can give
            send(ex, 200, answer(method, rows));
            return;
        }
        send(ex, 200, answer(method, "Unknown method in the mock"));
    }
}
