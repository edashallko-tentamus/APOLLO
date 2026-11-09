package com.tentamus.lims.methods.web;

import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.methods.domain.MethodsMessages;
import com.tentamus.lims.methods.service.DesignerService;
import com.tentamus.lims.methods.service.SpecService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

/** The Workflow Designer and specifications routes, same paths and answers as the Node backend. Thin. */
@RestController
public class MethodsController {
    private final DesignerService designer;
    private final SpecService specs;
    private final ApiExceptionHandler errors;

    public MethodsController(DesignerService designer, SpecService specs, ApiExceptionHandler errors) {
        this.designer = designer;
        this.specs = specs;
        this.errors = errors;
    }

    @GetMapping("/api/methods/me")
    public Object me(HttpServletRequest req) { return designer.meAnswer(ctx(req, null)); }

    @GetMapping("/api/methods/new-options")
    public Object newOptions(HttpServletRequest req) { return designer.newOptions(ctx(req, null)); }

    @GetMapping("/api/methods/tests")
    public Object tests(HttpServletRequest req) { return designer.tests(ctx(req, null)); }

    @PostMapping("/api/methods/tests")
    public Object createTest(HttpServletRequest req, @RequestBody Map<String, Object> b) { return designer.createTest(ctx(req, b), b); }

    @GetMapping("/api/methods/tests/{id}")
    public Object test(HttpServletRequest req, @PathVariable String id) { return designer.test(ctx(req, null), id); }

    @PostMapping("/api/methods/tests/{id}/new-version")
    public Object newVersion(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return designer.newVersion(ctx(req, b), id, body(b)); }

    @PostMapping("/api/methods/tests/{id}/copy")
    public Object copy(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return designer.copy(ctx(req, b), id, b); }

    @GetMapping("/api/methods/versions/{id}")
    public Object version(HttpServletRequest req, @PathVariable String id) { return designer.version(ctx(req, null), id); }

    @GetMapping("/api/methods/versions/{id}/problems")
    public Object problems(HttpServletRequest req, @PathVariable String id) { return designer.problems(ctx(req, null), id); }

    @PutMapping("/api/methods/versions/{id}/header")
    public Object header(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(designer.header(ctx(req, b), id, b)); }

    @PostMapping("/api/methods/versions/{id}/analytes")
    public Object analytes(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return designer.analytes(ctx(req, b), id, b); }

    @PostMapping("/api/methods/versions/{id}/steps")
    public Object saveStep(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return designer.saveStep(ctx(req, b), id, b); }

    @PostMapping("/api/methods/versions/{id}/steps/order")
    public Object orderSteps(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(designer.orderSteps(ctx(req, b), id, b)); }

    @PostMapping("/api/methods/versions/{id}/steps/{stepId}/remove")
    public Object removeStep(HttpServletRequest req, @PathVariable String id, @PathVariable String stepId, @RequestBody(required = false) Map<String, Object> b) {
        return designer.removeStep(ctx(req, b), id, stepId, body(b));
    }

    @PostMapping("/api/methods/versions/{id}/approve")
    public Object approve(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return designer.approve(ctx(req, b), id, body(b)); }

    @PostMapping("/api/methods/formula-test")
    public Object formulaTest(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return designer.formulaTest(ctx(req, b), body(b)); }

    @GetMapping("/api/methods/sops")
    public Object methods(HttpServletRequest req) { return designer.methods(ctx(req, null)); }

    @PostMapping("/api/methods/sops")
    public Object saveMethods(HttpServletRequest req, @RequestBody Map<String, Object> b) { return designer.saveMethods(ctx(req, b), b); }

    @GetMapping("/api/specs")
    public Object specs(HttpServletRequest req, @RequestParam Map<String, String> q) { return specs.specs(ctx(req, null), q); }

    @PostMapping("/api/specs")
    public Object saveSpecs(HttpServletRequest req, @RequestParam Map<String, String> q, @RequestBody Map<String, Object> b) { return specs.save(ctx(req, b), q, b); }

    /** The designer's own wording for its database checks, then the usual error contract. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> error(Exception e) {
        if (e instanceof HttpMessageNotReadableException bad) return errors.badJson(bad);
        Exception t = MethodsMessages.MESSAGES.translate(e);
        return t instanceof RuleException r ? errors.rule(r) : errors.other(t);
    }

    private static Object out(Object x) { return x == null ? Map.of("ok", true) : x; }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
