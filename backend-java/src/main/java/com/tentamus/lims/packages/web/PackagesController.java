package com.tentamus.lims.packages.web;

import static com.tentamus.lims.core.web.Answers.json;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.packages.service.PackagesService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Test packages and dated price changes: same paths and answers as the Node backend. */
@RestController
public class PackagesController {
    private final PackagesService packages;

    public PackagesController(PackagesService packages) { this.packages = packages; }

    @GetMapping("/api/packages")
    public Object list(HttpServletRequest req) { return packages.list(ctx(req, null)); }

    @GetMapping("/api/packages/options")
    public Object options(HttpServletRequest req) { return packages.options(ctx(req, null)); }

    @GetMapping("/api/packages/{id}")
    public Object one(HttpServletRequest req, @PathVariable String id) { return packages.one(ctx(req, null), id); }

    @PostMapping("/api/packages")
    public Object create(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return packages.create(ctx(req, b), body(b)); }

    @PutMapping("/api/packages/{id}")
    public Object save(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.save(ctx(req, b), id, body(b)); }

    @PostMapping("/api/packages/{id}/retire")
    public Object retire(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.retire(ctx(req, b), id); }

    @GetMapping("/api/versions/{vid}/packages")
    public Object quotePackages(@PathVariable String vid) { return packages.quotePackages(vid); }

    @PostMapping("/api/versions/{vid}/packages")
    public Object addToQuote(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) { return packages.addToQuote(ctx(req, b), vid, body(b)); }

    @PutMapping("/api/quoted-packages/{id}")
    public Object setQuoted(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.setQuoted(ctx(req, b), id, body(b)); }

    @PostMapping("/api/quoted-packages/{id}/remove")
    public Object removeQuoted(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.removeQuoted(ctx(req, b), id); }

    @PostMapping("/api/orders/{id}/add-package")
    public Object addToOrder(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.addToOrder(ctx(req, b), id, body(b)); }

    @GetMapping("/api/requested-tests/{id}/package-cancel")
    public Object cancelPreview(HttpServletRequest req, @PathVariable String id) { return json(packages.cancelPreview(ctx(req, null), id)); }

    @PostMapping("/api/ordered-packages/{id}/cancel")
    public Object cancelOrdered(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.cancelOrdered(ctx(req, b), id); }

    @GetMapping("/api/price-changes")
    public Object priceChanges(HttpServletRequest req) { return packages.priceChanges(ctx(req, null)); }

    @PostMapping("/api/price-changes")
    public Object schedule(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return packages.schedule(ctx(req, b), body(b)); }

    @PostMapping("/api/price-changes/{id}/cancel")
    public Object cancelChange(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return packages.cancelChange(ctx(req, b), id); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
