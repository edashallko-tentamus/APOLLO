package com.tentamus.lims.custody.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.custody.service.CustodyService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** The chain of custody (other than its PDF and Receive and sign) and sample photos: same paths and answers. */
@RestController
public class CustodyController {
    private final CustodyService custody;

    public CustodyController(CustodyService custody) { this.custody = custody; }

    @GetMapping("/api/orders/{id}/custody")
    public Object custody(HttpServletRequest req, @PathVariable String id) { return custody.custody(ctx(req, null), id); }

    @GetMapping("/api/custody/events/{id}/file")
    public ResponseEntity<byte[]> eventFile(HttpServletRequest req, @PathVariable String id) { return file(custody.eventFile(ctx(req, null), id)); }

    @PostMapping("/api/orders/{id}/custody/paper")
    public Object paper(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return custody.paper(ctx(req, b), id, body(b)); }

    @GetMapping("/api/samples/{id}/photos")
    public Object photos(HttpServletRequest req, @PathVariable String id) { return custody.photos(ctx(req, null), id); }

    @PostMapping("/api/samples/{id}/photos")
    public Object addPhotos(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return custody.addPhotos(ctx(req, b), id, body(b)); }

    @PutMapping("/api/photos/{id}")
    public Object changePhoto(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) { return custody.changePhoto(ctx(req, b), id, body(b)); }

    @GetMapping("/api/photos/{id}/file")
    public ResponseEntity<byte[]> photoFile(HttpServletRequest req, @PathVariable String id) { return file(custody.photoFile(ctx(req, null), id)); }

    private static ResponseEntity<byte[]> file(Map<String, Object> d) {
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    private static Map<String, Object> body(Map<String, Object> b) { return b == null ? Map.of() : b; }
}
