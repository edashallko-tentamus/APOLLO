package com.tentamus.lims.labsetup.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.labsetup.service.LabSetupService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Lab setup (product name, lab images, report templates): same paths and answers as the Node backend. */
@RestController
public class LabSetupController {
    private final LabSetupService setup;

    public LabSetupController(LabSetupService setup) { this.setup = setup; }

    @GetMapping("/api/public/settings")
    public Object publicSettings() { return setup.publicSettings(); }

    @PostMapping("/api/settings")
    public Object productName(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return setup.setProductName(ctx(req, b), body(b)); }

    @GetMapping("/api/sites/{id}/media")
    public Object media(HttpServletRequest req, @PathVariable String id) { return setup.media(ctx(req, null), id); }

    @PostMapping("/api/sites/{id}/media")
    public Object upload(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return setup.upload(ctx(req, b), id, body(b)); }

    @PostMapping("/api/sites/media/{mid}/retire")
    public Object retire(HttpServletRequest req, @PathVariable String mid, @RequestBody(required = false) Map<String, Object> b) { return setup.retire(ctx(req, b), mid); }

    @GetMapping("/api/sites/media/{mid}/file")
    public ResponseEntity<byte[]> file(@PathVariable String mid) {
        Map<String, Object> f = setup.file(mid);
        ResponseEntity<byte[]> r = new StoredFile(Base64.getMimeDecoder().decode((String) f.get("b64")), (String) f.get("mime_type"), "image").response();
        HttpHeaders h = new HttpHeaders();
        h.putAll(r.getHeaders());
        h.set(HttpHeaders.CACHE_CONTROL, "private, max-age=300");
        return ResponseEntity.status(r.getStatusCode()).headers(h).body(r.getBody());
    }

    @GetMapping("/api/sites/{id}/media-current")
    public Object current(@PathVariable String id, @RequestParam Map<String, String> q) { return setup.current(id, q); }

    @GetMapping("/api/report-templates")
    public Object templates(HttpServletRequest req) { return setup.templates(ctx(req, null)); }

    @PostMapping("/api/report-templates")
    public Object saveTemplates(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return setup.saveTemplates(ctx(req, b), body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
