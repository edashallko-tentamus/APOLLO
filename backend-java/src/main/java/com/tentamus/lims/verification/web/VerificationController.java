package com.tentamus.lims.verification.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.verification.service.VerificationService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Workflow verification other than the protocol writer, the run, the evidence capture and the documents: same paths and answers. */
@RestController
public class VerificationController {
    private final VerificationService verification;

    public VerificationController(VerificationService verification) { this.verification = verification; }

    @GetMapping("/api/verification/versions/{id}")
    public Object forVersion(HttpServletRequest req, @PathVariable String id) { return verification.forVersion(ctx(req, null), id); }

    @PostMapping("/api/verification/{id}/approve-protocol")
    public Object approveProtocol(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return verification.approveProtocol(ctx(req, b), id, body(b)); }

    @GetMapping("/api/verification/{id}/evidence/{seq}")
    public ResponseEntity<byte[]> evidence(HttpServletRequest req, @PathVariable String id, @PathVariable String seq) {
        Map<String, Object> d = verification.evidence(ctx(req, null), id, seq);
        ResponseEntity<byte[]> r = new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), "image/png", (String) d.get("file_name")).response();
        HttpHeaders h = new HttpHeaders();
        h.putAll(r.getHeaders());
        h.set(HttpHeaders.CACHE_CONTROL, "private, max-age=31536000, immutable");
        return ResponseEntity.status(r.getStatusCode()).headers(h).body(r.getBody());
    }

    @PostMapping("/api/verification/{id}/sign-report")
    public Object signReport(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return verification.signReport(ctx(req, b), id, body(b)); }

    @PostMapping("/api/verification/{id}/cancel")
    public Object cancel(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return verification.cancel(ctx(req, b), id, body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
