package com.tentamus.lims.core.session;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Sessions still live in the Node backend (sign-in has not moved yet). This asks it who the cookie belongs to,
 * through its own GET /api/auth/state, which also keeps the session's idle timer running. One sign-in therefore
 * works for both backends. Replaced when sign-in and sessions move to Java (sessions stored in the database).
 */
@Component
public class NodeSessionBridge implements SessionGateway {
    private final HttpClient http = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper json;
    private final String nodeUrl;

    public NodeSessionBridge(ObjectMapper json, @Value("${lims.node-url}") String nodeUrl) {
        this.json = json;
        this.nodeUrl = nodeUrl.replaceAll("/+$", "");
    }

    @Override
    public Session resolve(String cookieHeader) {
        if (cookieHeader == null || !cookieHeader.contains("lims3_sid=")) return Session.none(false);
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(nodeUrl + "/api/auth/state"))
                .timeout(Duration.ofSeconds(10)).header("Cookie", cookieHeader).GET().build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            JsonNode body = json.readTree(res.body());
            JsonNode user = body.path("user");
            if (user.isObject() && user.hasNonNull("id")) return new Session(user.get("id").asText(), false);
            return Session.none(body.path("timedOut").asBoolean(false));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Could not reach the sign-in service", e);
        } catch (Exception e) {
            throw new IllegalStateException("Could not reach the sign-in service (the Node backend at " + nodeUrl + "): " + e.getMessage(), e);
        }
    }
}
