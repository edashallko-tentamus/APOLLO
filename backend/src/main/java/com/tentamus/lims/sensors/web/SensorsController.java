package com.tentamus.lims.sensors.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.sensors.service.SensorsService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Sensors: same paths and answers as routes_sensors.js. */
@RestController
public class SensorsController {
    private final SensorsService sensors;

    public SensorsController(SensorsService sensors) { this.sensors = sensors; }

    @GetMapping("/api/sensors")
    public Object page(HttpServletRequest req) { return sensors.page(ctx(req, null)); }

    @PostMapping("/api/sensors/links/{id}/rejudge")
    public Object rejudge(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return sensors.rejudge(ctx(req, b), id, body(b)); }

    @PostMapping("/api/sensors/read-now")
    public Object readNow(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return sensors.readNow(ctx(req, b)); }

    @PostMapping("/api/sensors/connection")
    public Object connection(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return sensors.saveConnection(ctx(req, b), body(b)); }

    @PostMapping("/api/sensors/links")
    public Object link(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return sensors.link(ctx(req, b), body(b)); }

    @PostMapping("/api/sensors/links/{id}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return sensors.approve(ctx(req, b), id, body(b)); }

    @PostMapping("/api/sensors/links/{id}/retire")
    public Object retire(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return sensors.retire(ctx(req, b), id, body(b)); }

    @PostMapping("/api/logbooks/entries/{id}/reason")
    public Object reason(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return sensors.entryReason(ctx(req, b), id, body(b)); }

    @GetMapping("/api/sensors/equipment/{id}")
    public Object equipment(HttpServletRequest req, @PathVariable String id) { return sensors.forEquipment(ctx(req, null), id); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
