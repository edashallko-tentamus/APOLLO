package com.tentamus.lims.training.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.training.service.TrainingService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Training and competency, and the training report PDF: same paths and answers as the Node backend. */
@RestController
public class TrainingController {
    private final TrainingService training;

    public TrainingController(TrainingService training) { this.training = training; }

    @GetMapping("/api/training")
    public Object overview(HttpServletRequest req) { return training.overview(ctx(req, null)); }

    @GetMapping("/api/training/people/{id}/report.pdf")
    public ResponseEntity<byte[]> report(HttpServletRequest req, @PathVariable String id, @RequestParam(required = false) String s) {
        // a link opened in a new tab names its lab in ?s= (no lab header)
        RequestContext c = ctx(req, null);
        Map<String, Object> d = training.reportPdf(s == null || s.isEmpty() ? c : c.withSite(s), id);
        return new StoredFile((byte[]) d.get("buf"), "application/pdf", (String) d.get("file_name")).response();
    }

    @GetMapping("/api/training/people/{id}")
    public Object person(HttpServletRequest req, @PathVariable String id) { return training.personPage(ctx(req, null), id); }

    @PostMapping("/api/training/attempts")
    public Object start(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return training.start(ctx(req, b), body(b)); }

    @GetMapping("/api/training/attempts/{id}")
    public Object attempt(HttpServletRequest req, @PathVariable String id) { return training.attempt(ctx(req, null), id); }

    @PostMapping("/api/training/attempts/{id}/evidence")
    public Object evidence(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return training.addEvidence(ctx(req, b), id, body(b)); }

    @GetMapping("/api/training/evidence/{id}/file")
    public ResponseEntity<byte[]> evidenceFile(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> d = training.evidenceFile(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    @PostMapping("/api/training/attempts/{id}/evaluate")
    public Object evaluate(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return training.evaluate(ctx(req, b), id, body(b)); }

    @PostMapping("/api/training/attempts/{id}/decide")
    public Object decide(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return training.decide(ctx(req, b), id, body(b)); }

    @PostMapping("/api/training/attempts/{id}/withdraw")
    public Object withdraw(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return training.withdrawAttempt(ctx(req, b), id, body(b)); }

    @PostMapping("/api/training/qualifications/{id}/withdraw")
    public Object withdrawQualification(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return training.withdrawQualification(ctx(req, b), id, body(b)); }

    @PostMapping("/api/training/legacy")
    public Object legacy(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return training.legacy(ctx(req, b), body(b)); }

    @PostMapping("/api/training/rules")
    public Object rules(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return training.saveRules(ctx(req, b), body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
