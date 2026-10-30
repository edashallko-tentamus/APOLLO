package com.tentamus.lims.sensors.imonnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tentamus.lims.sensors.imonnit.ImonnitReader.HourEntry;
import com.tentamus.lims.sensors.imonnit.ImonnitReader.Link;
import com.tentamus.lims.sensors.imonnit.ImonnitReader.Reading;
import com.tentamus.lims.sensors.imonnit.ImonnitReader.Summary;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.MethodOrderer;
import org.junit.jupiter.api.Order;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.junit.jupiter.api.TestMethodOrder;

/**
 * The iMonnit reading side against the pretend service (tests/imonnit_feed_test.js, its 23 checks): 49 hours of known
 * readings from three sensors (a fridge with an excursion and a gateway that sends readings late, an incubator whose
 * sensor goes silent, a humidity sensor across the end of daylight saving time); every hourly entry, excursion and
 * no-data period is checked against figures worked out here independently from the scenario.
 */
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
@TestMethodOrder(MethodOrderer.OrderAnnotation.class)
class ImonnitReaderTest {
    static final String TZ = "America/Los_Angeles";
    static final long MIN = 60_000L;
    static final PretendImonnit.Scenario S = PretendImonnit.SCENARIO;
    static final long FRIDGE = 501001, INC = 501002, ROOM = 501003;
    static final long NOW1 = Instant.parse("2026-11-01T16:00:00Z").toEpochMilli();   // 08:00 PST on 2026-11-01
    static final List<Object[]> LINKS = List.of(new Object[] {FRIDGE, "temperature", 2.0, 8.0}, new Object[] {INC, "temperature", 33.0, 35.0},
        new Object[] {ROOM, "humidity", 30.0, 60.0}, new Object[] {ROOM, "temperature", 18.0, 25.0});

    PretendImonnit m;
    ImonnitClient api;
    final Map<Object, List<Reading>> store = new LinkedHashMap<>();
    Map<Object, Integer> added1;
    int callsBefore429;
    Summary f1;

    @BeforeAll
    void start() {
        m = PretendImonnit.start(NOW1, false, null);
        api = new ImonnitClient(m.url(), m.token, 24, 3, 10);
    }

    @AfterAll
    void stop() { m.close(); }

    static List<Link> links(Object[]... ls) { List<Link> out = new ArrayList<>(); for (Object[] l : ls) out.add(new Link(l[0], (String) l[1])); return out; }

    static List<Reading> of(Map<Object, List<Reading>> store, Object[] l) {
        return store.getOrDefault(l[0], List.of()).stream().filter(r -> r.kind().equals(l[1])).toList();
    }

    static Summary sum(Map<Object, List<Reading>> store, Object[] l, long now) {
        return ImonnitReader.summarize(of(store, l), new ImonnitReader.Options((Double) l[2], (Double) l[3], TZ, now, S.start(), Math.min(now, S.end())));
    }

    record Fig(int n, double min, double max, double mean) {}

    // the expected figures, worked out from the scenario without the connector
    static List<Fig> expected(long sensorId, String kind, long now, int[] count) {
        PretendImonnit.Sensor s = S.sensors().stream().filter(x -> x.id() == sensorId).findFirst().orElseThrow();
        DateTimeFormatter f = DateTimeFormatter.ofPattern("yyyy-MM-dd HH xxx").withZone(ZoneId.of(TZ));
        Map<String, List<Double>> hours = new LinkedHashMap<>();
        int n = 0;
        for (PretendImonnit.Message r : PretendImonnit.readingsOf(s)) {
            if (r.t() > now || r.availableAt() > now) continue;
            n++;
            double v = kind.equals("temperature") && s.kind().equals("humidity") ? r.temp() : r.value();
            hours.computeIfAbsent(f.format(Instant.ofEpochMilli(r.t())), k -> new ArrayList<>()).add(v);
        }
        if (count != null) count[0] = n;
        List<Fig> out = new ArrayList<>();
        for (List<Double> v : hours.values()) {
            double t = 0;
            for (double x : v) t += x;
            out.add(new Fig(v.size(), v.stream().mapToDouble(x -> x).min().getAsDouble(), v.stream().mapToDouble(x -> x).max().getAsDouble(), Math.round(t / v.size() * 100) / 100.0));
        }
        return out;
    }

    static int count(long sensorId, String kind, long now) { int[] c = {0}; expected(sensorId, kind, now, c); return c[0]; }

    static boolean same(List<HourEntry> hours, List<Fig> e) {
        if (hours.size() != e.size()) return false;
        for (int i = 0; i < e.size(); i++) {
            HourEntry h = hours.get(i);
            if (h.n != e.get(i).n() || h.min != e.get(i).min() || h.max != e.get(i).max() || h.mean != e.get(i).mean()) return false;
        }
        return true;
    }

    // ---- the connection
    @Test @Order(1)
    void aWrongKeyIsRefused() {
        RuntimeException e = assertThrows(RuntimeException.class, () -> new ImonnitClient(m.url(), "wrong-key", 1000).listSensors());
        assertTrue(e.getMessage().contains("refused the key"), e.getMessage());
    }

    @Test @Order(2)
    void theSensorListHasThreeSensorsAndTheIncubatorsBatteryIsLow() {
        List<Map<String, Object>> sensors = api.listSensors();
        assertEquals(3, sensors.size());
        Map<String, Object> inc = sensors.stream().filter(x -> ((Number) x.get("SensorID")).longValue() == INC).findFirst().orElseThrow();
        assertEquals(18, ((Number) inc.get("BatteryLevel")).intValue());
    }

    // ---- first read, 08:00 on 2026-11-01
    @Test @Order(3)
    void tooManyRequestsIsWaitedOutAndTriedAgain() {
        m.failNext(1);
        callsBefore429 = m.calls.size();
        added1 = ImonnitReader.sync(api, links(LINKS.toArray(Object[][]::new)), store, NOW1, S.start(), 24);
        long n = m.calls.subList(callsBefore429, m.calls.size()).stream().filter(c -> "SensorDataMessages".equals(c.get("method"))).count();
        assertEquals(7, n);
    }

    @Test @Order(4)
    @SuppressWarnings("unchecked")
    void eachCallAsksFor24HoursAtMost() {
        for (Map<String, Object> c : m.calls.subList(callsBefore429, m.calls.size())) {
            if (!"SensorDataMessages".equals(c.get("method"))) continue;
            Map<String, String> q = (Map<String, String>) c.get("query");
            assertTrue(Instant.parse(q.get("toDate")).toEpochMilli() - Instant.parse(q.get("fromDate")).toEpochMilli() <= 24 * 60 * MIN);
        }
    }

    @Test @Order(5)
    void aMessageReceivedTwiceIsKeptOnce() {
        int n = count(FRIDGE, "temperature", NOW1);
        assertEquals(n, of(store, LINKS.get(0)).size());
        assertEquals(n, added1.get(FRIDGE));
    }

    @Test @Order(6)
    void valuesAreInTheSensorsOwnUnit() {
        List<Map<String, Object>> msgs = api.messages(ROOM, S.start(), S.start() + 10 * MIN);
        List<Reading> one = ImonnitReader.normalize(msgs.get(0));
        assertEquals(2, one.size());
        assertEquals("% RH", one.get(0).unit());
        assertEquals("°C", one.get(1).unit());
        assertTrue(one.get(1).value() < 30);
        assertTrue(Double.parseDouble(msgs.get(0).get("PlotValues").toString().split("\\|")[1]) > 60);
    }

    // ---- the fridge: hours and the excursion
    @Test @Order(7)
    void theFridgeDoorLeftOpenIsOneExcursion() {
        f1 = sum(store, LINKS.get(0), NOW1);
        assertEquals(1, f1.excursions().size());
        ImonnitReader.Excursion ex = f1.excursions().get(0);
        assertEquals(6, ex.n);
        assertEquals(9.4, ex.peak);
        assertEquals(Instant.parse("2026-10-31T17:20:00Z").toEpochMilli(), ex.start);
        assertEquals(Instant.parse("2026-10-31T17:50:00Z").toEpochMilli(), ex.end);
        assertTrue(!ex.open);
    }

    @Test @Order(8)
    void itsHourlyEntryFailsAndEveryOtherHourPasses() {
        HourEntry h10 = f1.hours().stream().filter(h -> h.key.equals("2026-10-31 10:00 GMT-7")).findFirst().orElse(null);
        assertNotNull(h10);
        assertEquals("Fail", h10.result);
        assertEquals(0, h10.excursions.get(0));
        assertEquals(9.4, h10.max);
        assertEquals(1, f1.hours().stream().filter(h -> h.result.equals("Fail")).count());
    }

    @Test @Order(9)
    void everyHourlyFigureMatchesTheScenario() { assertTrue(same(f1.hours(), expected(FRIDGE, "temperature", NOW1, null))); }

    @Test @Order(10)
    void closedAndOpenHours() {
        assertEquals(2, f1.hours().stream().filter(h -> !h.closed).count());
        assertTrue(f1.hours().stream().filter(h -> h.key.equals("2026-11-01 05:00 GMT-8")).findFirst().orElseThrow().closed);
    }

    @Test @Order(11)
    void theGatewayOfflineIsAPeriodWithNoData() {
        assertEquals(1, f1.gaps().size());
        assertEquals(155, f1.gaps().get(0).minutes());
        assertTrue(!f1.gaps().get(0).open());
    }

    // ---- the incubator: silences
    @Test @Order(12)
    void silentFor50MinutesIsANoDataPeriodBut15IsNot() {
        Summary inc = sum(store, LINKS.get(1), NOW1);
        assertEquals(1, inc.gaps().size());
        assertEquals(50, inc.gaps().get(0).minutes());
        assertEquals(Instant.parse("2026-10-31T20:55:00Z").toEpochMilli(), inc.gaps().get(0).from());
    }

    // ---- the balance room across the end of daylight saving time
    @Test @Order(13)
    void twoOneOClockHoursWhenDaylightSavingTimeEnds() {
        List<HourEntry> one00 = sum(store, LINKS.get(2), NOW1).hours().stream().filter(h -> h.key.startsWith("2026-11-01 01:00")).toList();
        assertEquals(2, one00.size());
        assertTrue(one00.stream().allMatch(h -> h.n == 12));
    }

    @Test @Order(14)
    void humidityAt63PercentIsAnExcursionInTheSecondOneOClockHourOnly() {
        Summary hum = sum(store, LINKS.get(2), NOW1);
        List<HourEntry> one00 = hum.hours().stream().filter(h -> h.key.startsWith("2026-11-01 01:00")).toList();
        assertEquals(1, hum.excursions().size());
        assertEquals(2, hum.excursions().get(0).n);
        assertEquals(63.0, hum.excursions().get(0).peak);
        assertEquals("Fail", one00.get(1).result);
        assertEquals("Pass", one00.get(0).result);
    }

    @Test @Order(15)
    void theSameSensorsTemperatureHasItsOwnPassingHours() {
        Summary rt = sum(store, LINKS.get(3), NOW1), hum = sum(store, LINKS.get(2), NOW1);
        assertEquals(hum.hours().size(), rt.hours().size());
        assertTrue(rt.hours().stream().allMatch(h -> h.result.equals("Pass")));
    }

    // ---- second read, midnight: the fridge's late readings arrive
    @Test @Order(16)
    void readingBackOnly2HoursMissesTheLateReadings() {
        m.setNow(S.end());
        Map<Object, List<Reading>> shortStore = new LinkedHashMap<>();
        for (Map.Entry<Object, List<Reading>> e : store.entrySet()) shortStore.put(e.getKey(), new ArrayList<>(e.getValue()));
        ImonnitReader.sync(api, links(LINKS.get(0)), shortStore, S.end(), S.start(), 2);
        assertTrue(of(shortStore, LINKS.get(0)).size() < count(FRIDGE, "temperature", S.end()));
    }

    Summary f2;

    @Test @Order(17)
    void reading24HoursBackCatchesThem() {
        ImonnitReader.sync(api, links(LINKS.toArray(Object[][]::new)), store, S.end(), S.start(), 24);
        f2 = sum(store, LINKS.get(0), S.end());
        assertEquals(count(FRIDGE, "temperature", S.end()), of(store, LINKS.get(0)).size());
    }

    @Test @Order(18)
    void theClosed0200HourIsCorrected() {
        ImonnitReader.Changes ch = ImonnitReader.changes(f1, f2);
        assertEquals(1, ch.corrections().size());
        assertEquals("2026-11-01 02:00 GMT-8", ch.corrections().get(0)[1].key);
        assertEquals(6, ch.corrections().get(0)[0].n);
        assertEquals(12, ch.corrections().get(0)[1].n);
    }

    @Test @Order(19)
    void the0300And0400HoursAreAddedLateAndTheNoDataPeriodIsFilled() {
        ImonnitReader.Changes ch = ImonnitReader.changes(f1, f2);
        assertEquals("2026-11-01 03:00 GMT-8,2026-11-01 04:00 GMT-8", String.join(",", ch.lateHours().stream().map(h -> h.key).toList()));
        assertEquals(1, ch.filled().size());
        assertEquals(0, f2.gaps().size());
    }

    List<Summary> all() { return LINKS.stream().map(l -> sum(store, l, S.end())).toList(); }

    @Test @Order(20)
    void fortyNineHourlyEntriesPerSensorAndValue() { assertTrue(all().stream().allMatch(x -> x.hours().size() == 49)); }

    @Test @Order(21)
    void everyHourlyFigureOfEverySensorMatchesTheScenario() {
        List<Summary> a = all();
        assertTrue(same(a.get(0).hours(), expected(FRIDGE, "temperature", S.end(), null)));
        assertTrue(same(a.get(1).hours(), expected(INC, "temperature", S.end(), null)));
        assertTrue(same(a.get(2).hours(), expected(ROOM, "humidity", S.end(), null)));
        assertTrue(same(a.get(3).hours(), expected(ROOM, "temperature", S.end(), null)));
    }

    @Test @Order(22)
    void nothingOpenAtMidnight() {
        assertTrue(all().stream().allMatch(x -> x.excursions().stream().noneMatch(e -> e.open) && x.gaps().stream().noneMatch(ImonnitReader.Gap::open)));
    }

    // ---- a sensor that stops
    @Test @Order(23)
    void aSensorThatStopsShowsAnOpenNoDataPeriod() {
        long stopNow = S.end() + 50 * MIN;
        Summary st = ImonnitReader.summarize(of(store, LINKS.get(1)), new ImonnitReader.Options(33.0, 35.0, TZ, stopNow, S.start(), null));
        assertTrue(st.gaps().stream().anyMatch(g -> g.open() && g.from() == S.end() - 5 * MIN && g.minutes() == 55));
    }
}
