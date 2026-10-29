package com.tentamus.lims.orders.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.orders.service.IntakeService;
import com.tentamus.lims.orders.service.OrderService;
import com.tentamus.lims.orders.service.SampleService;
import com.tentamus.lims.orders.service.TestOrderingService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Lab orders, samples, intake, rush decisions and the Outbox: same paths and answers as the Node backend. */
@RestController
@RequestMapping("/api")
public class OrderController {
    private final OrderService orders;
    private final IntakeService intake;
    private final SampleService samples;
    private final TestOrderingService tests;

    public OrderController(OrderService orders, IntakeService intake, SampleService samples, TestOrderingService tests) {
        this.orders = orders;
        this.intake = intake;
        this.samples = samples;
        this.tests = tests;
    }

    @GetMapping("/orders")
    public Object orders(HttpServletRequest req, @RequestParam Map<String, String> q) { return orders.list(ctx(req, null), q); }

    @PostMapping("/orders")
    public Map<String, Object> create(HttpServletRequest req, @RequestBody Map<String, Object> b) { return orders.create(ctx(req, b), row(b)); }

    @PutMapping("/orders/{id}")
    public List<Map<String, Object>> update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) {
        return orders.update(ctx(req, b), id, row(b));
    }

    @GetMapping("/orders/{id}")
    public Map<String, Object> order(HttpServletRequest req, @PathVariable String id) { return orders.page(ctx(req, null), id); }

    @GetMapping("/samples/{id}")
    public Map<String, Object> sample(HttpServletRequest req, @PathVariable String id) { return orders.sample(ctx(req, null), id); }

    @GetMapping("/order-setup/{clientId}")
    public Map<String, Object> setup(@PathVariable String clientId) { return orders.setup(clientId); }

    @PostMapping("/orders/{id}/samples")
    public List<Map<String, Object>> samples(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) {
        return samples.saveSamples(ctx(req, b), id, rows(b));
    }

    @PostMapping("/samples/{id}/serving-request")
    public Map<String, Object> servingRequest(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        Map<String, Object> body = b == null ? Map.of() : b;
        return samples.requestServingTest(ctx(req, body), id, body);
    }

    @PostMapping("/orders/{id}/apply-project")
    public Map<String, Object> applyProject(HttpServletRequest req, @RequestBody Map<String, Object> b) { return tests.applyProject(ctx(req, b), b); }

    @PostMapping("/orders/{id}/add-test")
    public Map<String, Object> addTest(HttpServletRequest req, @RequestBody Map<String, Object> b) { return tests.addTest(ctx(req, b), b); }

    @PostMapping("/orders/{id}/tests")
    public List<Map<String, Object>> tests(HttpServletRequest req, @RequestBody Map<String, Object> b) { return tests.saveTests(ctx(req, b), rows(b)); }

    @PostMapping("/orders/{id}/rush")
    public Map<String, Object> rush(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return tests.rush(ctx(req, b), id, b); }

    @PostMapping("/orders/{id}/log")
    public Map<String, Object> log(HttpServletRequest req, @RequestBody Map<String, Object> b) { return samples.log(ctx(req, b), b); }

    @PostMapping("/orders/{id}/cancel")
    public Map<String, Object> cancel(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        Map<String, Object> body = b == null ? Map.of() : b;
        return samples.cancel(ctx(req, body), id, body);
    }

    @GetMapping("/requested-tests/{id}/analytes")
    public List<Map<String, Object>> analytes(HttpServletRequest req, @PathVariable String id) { return tests.analytes(ctx(req, null), id); }

    @PostMapping("/requested-tests/{id}/analytes")
    public List<Map<String, Object>> saveAnalytes(HttpServletRequest req, @RequestBody Map<String, Object> b) { return tests.saveAnalytes(ctx(req, b), rows(b)); }

    @GetMapping("/intake")
    public Map<String, Object> intake(HttpServletRequest req) { return intake.dashboard(ctx(req, null)); }

    @PostMapping("/rush-decisions")
    public List<Map<String, Object>> rushDecision(HttpServletRequest req, @RequestBody Map<String, Object> b) { return intake.rushDecision(ctx(req, b), b); }

    @GetMapping("/outbox")
    public Object outbox(HttpServletRequest req, @RequestParam Map<String, String> q) { return intake.outbox(ctx(req, null), q); }

    @GetMapping("/outbox/templates")
    public Map<String, Object> templates(HttpServletRequest req) { return intake.templates(ctx(req, null)); }

    @PostMapping("/outbox/templates")
    public List<Map<String, Object>> saveTemplates(HttpServletRequest req, @RequestBody Map<String, Object> b) { return intake.saveTemplates(ctx(req, b), rows(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(Map<String, Object> b) { return b != null && b.get("row") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
