package com.tentamus.lims.quotes.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.quotes.service.QuoteSendService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Sending a quote, its PDF, and the client's page behind the link: same paths and answers as the Node backend. */
@RestController
public class QuoteSendController {
    private final QuoteSendService quotes;

    public QuoteSendController(QuoteSendService quotes) { this.quotes = quotes; }

    @PostMapping("/api/quotes/versions/{vid}/send")
    public Object send(HttpServletRequest req, @PathVariable String vid, @RequestBody(required = false) Map<String, Object> b) {
        Map<String, Object> body = b == null ? Map.of() : b;
        return quotes.send(RequestContext.of(req, body), vid, body);
    }

    @GetMapping("/api/quotes/versions/{vid}/pdf")
    public ResponseEntity<byte[]> pdf(@PathVariable String vid, @RequestParam Map<String, String> q) { return file(quotes.pdf(vid, q)); }

    @GetMapping("/api/public/quote/{token}")
    public Object publicQuote(@PathVariable String token) { return quotes.publicQuote(token); }

    @GetMapping("/api/public/quote/{token}/pdf")
    public ResponseEntity<byte[]> publicPdf(@PathVariable String token) { return file(quotes.publicPdf(token)); }

    @PostMapping("/api/public/quote/{token}")
    public Object answer(@PathVariable String token, @RequestBody(required = false) Map<String, Object> b) { return quotes.publicAnswer(token, b == null ? Map.of() : b); }

    private static ResponseEntity<byte[]> file(QuoteSendService.File f) { return new StoredFile(f.buf(), "application/pdf", f.name()).response(); }
}
