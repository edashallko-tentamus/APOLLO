package com.tentamus.lims.charges.web;

import com.tentamus.lims.charges.service.ChargesService;
import com.tentamus.lims.core.web.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Service lines, the order's test picker, and charges: same paths and answers as the Node backend. */
@RestController
public class ChargesController {
    private final ChargesService charges;

    public ChargesController(ChargesService charges) { this.charges = charges; }

    @GetMapping("/api/service-lines")
    public Object lines(HttpServletRequest req) { return charges.serviceLines(ctx(req, null)); }

    @PostMapping("/api/service-lines")
    public Object saveLines(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return charges.saveLines(ctx(req, b), body(b)); }

    @PostMapping("/api/service-lines/types")
    public Object saveTypes(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return charges.saveTypes(ctx(req, b), body(b)); }

    @GetMapping("/api/service-lines/tests")
    public Object tests(HttpServletRequest req) { return charges.tests(ctx(req, null)); }

    @PostMapping("/api/service-lines/tests")
    public Object saveTests(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return charges.saveTests(ctx(req, b), body(b)); }

    @GetMapping("/api/clients/{id}/service-lines")
    public Object clientLines(@PathVariable String id) { return charges.clientLines(id); }

    @PutMapping("/api/clients/{id}/service-lines")
    public Object saveClientLines(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return charges.saveClientLines(ctx(req, b), id, body(b)); }

    @GetMapping("/api/orders/{id}/picker")
    public Object picker(HttpServletRequest req, @PathVariable String id) { return charges.picker(ctx(req, null), id); }

    @PostMapping("/api/orders/{id}/catalogue-tests")
    public Object orderTests(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return charges.orderTests(ctx(req, b), id, body(b)); }

    @GetMapping("/api/charge-items")
    public Object items(HttpServletRequest req) { return charges.items(ctx(req, null)); }

    @PostMapping("/api/charge-items")
    public Object saveItems(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return charges.saveItems(ctx(req, b), body(b)); }

    @GetMapping("/api/versions/{vid}/charges")
    public Object quoteCharges(HttpServletRequest req, @PathVariable String vid) { return charges.quoteCharges(ctx(req, null), vid); }

    @PostMapping("/api/versions/{vid}/charges")
    public Object addQuoteCharge(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return charges.addQuoteCharge(ctx(req, b), vid, body(b)); }

    @PutMapping("/api/quoted-charges/{id}")
    public Object changeQuoteCharge(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return charges.changeQuoteCharge(ctx(req, b), id, body(b)); }

    @GetMapping("/api/orders/{id}/charges")
    public Object orderCharges(HttpServletRequest req, @PathVariable String id) { return charges.orderCharges(ctx(req, null), id); }

    @PostMapping("/api/orders/{id}/charges")
    public Object addOrderCharge(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return charges.addOrderCharge(ctx(req, b), id, body(b)); }

    @PutMapping("/api/order-charges/{id}")
    public Object changeOrderCharge(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return charges.changeOrderCharge(ctx(req, b), id, body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
