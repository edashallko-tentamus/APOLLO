package com.tentamus.lims.oos.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.oos.service.OosService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** OOS investigations' routes other than the conclusion (it makes the report PDF) and the client's public page: same paths and answers. */
@RestController
public class OosController {
    private final OosService oos;

    public OosController(OosService oos) { this.oos = oos; }

    @GetMapping("/api/oos")
    public Object list(HttpServletRequest req, @RequestParam Map<String, String> q) { return oos.list(ctx(req, null), q); }

    @GetMapping("/api/oos/for")
    public Object forRecord(HttpServletRequest req, @RequestParam Map<String, String> q) { return oos.forRecord(ctx(req, null), q); }

    @GetMapping("/api/oos/config")
    public Object config(HttpServletRequest req) { return oos.config(ctx(req, null)); }

    @GetMapping("/api/oos/{id}")
    public Object one(HttpServletRequest req, @PathVariable String id) { return oos.one(ctx(req, null), id); }

    @PostMapping("/api/oos/open")
    public Object open(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return oos.open(ctx(req, b), body(b)); }

    @PostMapping("/api/oos/{id}/checks")
    public Object checks(HttpServletRequest req, @PathVariable String id) { return oos.runChecksNow(ctx(req, null), id); }

    @PostMapping("/api/oos/{id}/analyst")
    public Object analyst(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.analyst(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/{id}/supervisor")
    public Object supervisor(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.supervisor(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/{id}/cancel")
    public Object cancel(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.cancel(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/{id}/retest")
    public Object retest(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.retest(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/{id}/determination")
    public Object determination(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.determination(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/{id}/phase2")
    public Object phase2(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return oos.phase2(ctx(req, b), id, body(b)); }

    @PostMapping("/api/oos/responses/{rid}/handled")
    public Object handled(HttpServletRequest req, @PathVariable String rid, @RequestBody(required = false) Map<String, Object> b) { return oos.responseHandled(ctx(req, b), rid, body(b)); }

    @GetMapping("/api/oos/{id}/report.pdf")
    public ResponseEntity<byte[]> report(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> d = oos.report(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), "application/pdf", (String) d.get("file_name")).response();
    }

    @GetMapping("/api/outbox/{id}/document")
    public ResponseEntity<byte[]> outboxDocument(HttpServletRequest req, @PathVariable String id) {
        Map<String, Object> e = oos.outboxDocument(ctx(req, null), id);
        return new StoredFile(Base64.getMimeDecoder().decode((String) e.get("b64")), (String) e.get("mime_type"), String.valueOf(e.get("file_name")).replace("\"", "")).response();
    }

    @PostMapping("/api/oos/config/items")
    public Object saveItems(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return oos.saveItems(ctx(req, b), body(b)); }

    @PostMapping("/api/oos/config/settings")
    public Object saveSettings(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return oos.saveSettings(ctx(req, b), body(b)); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
