package com.tentamus.lims.clients.web;

import com.tentamus.lims.clients.service.ClientService;
import com.tentamus.lims.clients.service.ContactService;
import com.tentamus.lims.clients.service.LicenseService;
import com.tentamus.lims.core.web.RequestContext;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** The client, contact and license routes, with the same paths and answers as the Node backend. Thin: no rules here. */
@RestController
@RequestMapping("/api")
public class ClientController {
    private final ClientService clients;
    private final ContactService contacts;
    private final LicenseService licenses;

    public ClientController(ClientService clients, ContactService contacts, LicenseService licenses) {
        this.clients = clients;
        this.contacts = contacts;
        this.licenses = licenses;
    }

    @GetMapping("/clients")
    public Object clients(@RequestParam Map<String, String> q) { return clients.list(q); }

    @GetMapping("/clients/{id}")
    public Map<String, Object> client(HttpServletRequest req, @PathVariable String id) {
        return clients.detail(RequestContext.of(req, null), id);
    }

    @PostMapping("/clients")
    public Map<String, Object> createClient(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> body) {
        return clients.create(RequestContext.of(req, body), row(body));
    }

    @PutMapping("/clients/{id}")
    public List<Map<String, Object>> updateClient(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        return clients.update(RequestContext.of(req, body), id, row(body));
    }

    @PostMapping("/clients/{id}/licenses")
    public Map<String, Object> addLicense(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        return licenses.add(RequestContext.of(req, b), id, b);
    }

    @PutMapping("/licenses/{id}")
    public Map<String, Object> updateLicense(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> body) {
        Map<String, Object> b = body == null ? Map.of() : body;
        return licenses.update(RequestContext.of(req, b), id, b);
    }

    @GetMapping("/licenses/{id}/file")
    public ResponseEntity<byte[]> licenseFile(@PathVariable String id) { return licenses.file(id); }

    @GetMapping("/licenses")
    public Map<String, Object> allLicenses(HttpServletRequest req) { return licenses.list(RequestContext.of(req, null)); }

    @GetMapping("/contacts")
    public Object contacts(@RequestParam Map<String, String> q) { return contacts.list(q); }

    @PostMapping("/contacts/bulk")
    public List<Map<String, Object>> saveContacts(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return contacts.saveContacts(RequestContext.of(req, body), rows(body));
    }

    @PostMapping("/client-contacts/bulk")
    public List<Map<String, Object>> saveLinks(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return contacts.saveLinks(RequestContext.of(req, body), rows(body));
    }

    /** The client screens send {row: {...}, reason}. */
    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(Map<String, Object> body) {
        Object r = body == null ? null : body.get("row");
        return r instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> body) {
        Object r = body == null ? null : body.get("rows");
        return r instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }
}
