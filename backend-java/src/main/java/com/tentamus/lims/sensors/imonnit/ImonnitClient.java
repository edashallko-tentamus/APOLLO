package com.tentamus.lims.sensors.imonnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Calls iMonnit's REST API (connectors/imonnit.js client): the sensor list, and a sensor's data messages one
 * maxRangeHours window at a time, oldest first. "Too many requests" (429) is waited out and tried again. The message
 * format is ASSUMED where the pretend service says so (confirm against Monnit's method reference before production).
 */
public final class ImonnitClient {
    static final long HOUR = 3_600_000L;
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private final String base, token;
    private final int maxRangeHours, retries;
    private final long waitMs;
    public int calls = 0;

    public ImonnitClient(String base, String token, int maxRangeHours, int retries, long waitMs) {
        if (base == null || base.isEmpty() || token == null || token.isEmpty()) throw new RuleException("The iMonnit address and key are not set");
        this.base = base; this.token = token; this.maxRangeHours = maxRangeHours; this.retries = retries; this.waitMs = waitMs;
    }

    public ImonnitClient(String base, String token, long waitMs) { this(base, token, 24, 3, waitMs); }

    // encodeURIComponent
    static String component(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8).replace("+", "%20").replace("%21", "!").replace("%27", "'").replace("%28", "(").replace("%29", ")").replace("%7E", "~");
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> call(String method, Map<String, String> params) {
        StringBuilder q = new StringBuilder();
        for (Map.Entry<String, String> p : params.entrySet())
            q.append(q.length() > 0 ? "&" : "").append(URLEncoder.encode(p.getKey(), StandardCharsets.UTF_8)).append('=').append(URLEncoder.encode(p.getValue(), StandardCharsets.UTF_8));
        URI uri = URI.create(base + "/json/" + method + "/" + component(token) + (q.length() > 0 ? "?" + q : ""));
        for (int attempt = 0; ; attempt++) {
            HttpResponse<String> res;
            try {
                res = HTTP.send(HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(60)).GET().build(), HttpResponse.BodyHandlers.ofString());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new RuleException("fetch failed");
            } catch (Exception e) {
                throw new RuleException("fetch failed");
            }
            if (res.statusCode() == 429 && attempt < retries) {
                try { Thread.sleep(waitMs * (attempt + 1)); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
                continue;
            }
            JsonNode body;
            try { body = JSON.readTree(res.body()); } catch (Exception e) { body = null; }
            if (res.statusCode() == 401) throw new RuleException("iMonnit refused the key (401)");
            if (res.statusCode() < 200 || res.statusCode() > 299) throw new RuleException("iMonnit answered " + res.statusCode() + " to " + method);
            JsonNode result = body == null ? null : body.get("Result");
            if (result == null || !result.isArray()) {
                String r = result == null || result.isNull() || (result.isTextual() && result.asText().isEmpty()) || (result.isBoolean() && !result.asBoolean()) || (result.isNumber() && result.asDouble() == 0)
                    ? "no result" : result.isTextual() ? result.asText() : result.toString();
                throw new RuleException("iMonnit " + method + ": " + r);
            }
            List<Map<String, Object>> out = new ArrayList<>();
            for (JsonNode x : result) out.add(JSON.convertValue(x, LinkedHashMap.class));
            return out;
        }
    }

    public List<Map<String, Object>> listSensors() {
        calls++;
        return call("SensorList", Map.of());
    }

    /** One call per maxRangeHours, oldest first. */
    public List<Map<String, Object>> messages(Object sensorId, long from, long to) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (long a = from; a < to; a += maxRangeHours * HOUR) {
            long b = Math.min(to, a + maxRangeHours * HOUR);
            calls++;
            Map<String, String> p = new LinkedHashMap<>();
            p.put("sensorID", String.valueOf(sensorId));
            p.put("fromDate", ImonnitReader.iso(a));
            p.put("toDate", ImonnitReader.iso(b));
            out.addAll(call("SensorDataMessages", p));
        }
        return out;
    }
}
