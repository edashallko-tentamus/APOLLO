package com.tentamus.lims.inventory.web;

import com.tentamus.lims.core.db.PgArrays;
import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.inventory.domain.InventoryMessages;
import com.tentamus.lims.inventory.service.BulkService;
import com.tentamus.lims.inventory.service.InventoryListsService;
import com.tentamus.lims.inventory.service.LotService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

/**
 * The inventory routes and the Excel export / upload routes, same paths and answers as the Node backend. Thin: every
 * answer has its enum arrays as lists, and inventory's database checks are worded for the screen.
 */
@RestController
@RequestMapping("/api")
public class InventoryController {
    private final InventoryListsService lists;
    private final LotService lots;
    private final BulkService bulk;
    private final ApiExceptionHandler errors;

    public InventoryController(InventoryListsService lists, LotService lots, BulkService bulk, ApiExceptionHandler errors) {
        this.lists = lists;
        this.lots = lots;
        this.bulk = bulk;
        this.errors = errors;
    }

    // ---- who am I, pick lists, the lists kept by supervisors, QA and administrators
    @GetMapping("/inventory/me")
    public Object me(HttpServletRequest req) { return lists.me(ctx(req, null)); }

    @GetMapping("/inventory/meta")
    public Object meta() { return lists.meta(); }

    @GetMapping("/inventory/chemicals")
    public Object chemicals() { return out(lists.chemicals()); }

    @PostMapping("/inventory/chemicals/bulk")
    public Object saveChemicals(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveChemicals(ctx(req, b), rows(b))); }

    @GetMapping("/inventory/suppliers")
    public Object suppliers() { return out(lists.suppliers()); }

    @PostMapping("/inventory/suppliers/bulk")
    public Object saveSuppliers(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveSuppliers(ctx(req, b), b, rows(b))); }

    @GetMapping("/inventory/locations")
    public Object locations(HttpServletRequest req) { return out(lists.locations(ctx(req, null))); }

    @PostMapping("/inventory/locations/bulk")
    public Object saveLocations(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveLocations(ctx(req, b), b, rows(b))); }

    @GetMapping("/inventory/locations/{id}")
    public Object location(HttpServletRequest req, @PathVariable String id) { return out(lists.location(ctx(req, null), id)); }

    @GetMapping("/inventory/thresholds")
    public Object thresholds() { return out(lists.thresholds()); }

    @PostMapping("/inventory/thresholds/bulk")
    public Object saveThresholds(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveThresholds(ctx(req, b), b, rows(b))); }

    @GetMapping("/inventory/sites")
    public Object sites() { return out(lists.sites()); }

    @GetMapping("/inventory/qa-defaults")
    public Object qaDefaults(HttpServletRequest req) { return out(lists.qaDefaults(ctx(req, null))); }

    @PostMapping("/inventory/qa-defaults")
    public Object saveQaDefaults(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveQaDefaults(ctx(req, b), rows(b))); }

    @GetMapping("/inventory/samples")
    public Object samples(HttpServletRequest req) { return out(lists.sampleStorage(ctx(req, null))); }

    @PostMapping("/inventory/samples/bulk")
    public Object saveSamples(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lists.saveSampleStorage(ctx(req, b), b, rows(b))); }

    // ---- lots
    @GetMapping("/inventory/lots")
    public Object lots(HttpServletRequest req, @RequestParam Map<String, String> q) { return out(lots.list(ctx(req, null), q)); }

    @GetMapping("/inventory/dashboard")
    public Object dashboard(HttpServletRequest req) { return out(lots.dashboard(ctx(req, null))); }

    @GetMapping("/inventory/lots/{id}")
    public Object lot(HttpServletRequest req, @PathVariable String id) { return out(lots.detail(ctx(req, null), id)); }

    @PostMapping("/inventory/lots/bulk")
    public Object receiveMany(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.receiveMany(ctx(req, b), b, rows(b))); }

    @PostMapping("/inventory/items")
    public Object createItem(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.create(ctx(req, b), b)); }

    @PutMapping("/inventory/items/{id}")
    public Object updateItem(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.updateItem(ctx(req, b), id, b)); }

    @PutMapping("/inventory/lots/{id}")
    public Object updateLot(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.updateLot(ctx(req, b), id, b)); }

    @PostMapping("/inventory/requests")
    public Object request(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.request(ctx(req, b), b)); }

    @PostMapping("/inventory/lots/{id}/purchase-status")
    public Object purchaseStatus(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.purchaseStatus(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/cancel")
    public Object cancel(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.cancel(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/reorder")
    public Object reorder(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.reorder(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/receive")
    public Object receive(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.receive(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/transfer")
    public Object transfer(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.transfer(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/dispose")
    public Object dispose(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.dispose(ctx(req, b), id, b)); }

    @PostMapping("/inventory/movements")
    public Object movements(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.movements(ctx(req, b), b, rows(b))); }

    @PostMapping("/inventory/mixtures")
    public Object mixture(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.mixture(ctx(req, b), b)); }

    @PostMapping("/inventory/mixtures/preview")
    public Object mixturePreview(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.mixturePreview(ctx(req, b), b)); }

    @PostMapping("/inventory/mixtures/prepare")
    public Object prepareMixture(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.prepareMixture(ctx(req, b), b)); }

    @GetMapping("/inventory/lots/{id}/qualify-options")
    public Object qualifyOptions(HttpServletRequest req, @PathVariable String id) { return out(lots.qualifyOptions(ctx(req, null), id)); }

    @PostMapping("/inventory/lots/{id}/qualify")
    public Object qualify(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.qualify(ctx(req, b), id, b)); }

    @PostMapping("/inventory/lots/{id}/waive-qa")
    public Object waiveQa(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.waiveQa(ctx(req, b), id, b)); }

    // ---- Supplier COAs
    @PostMapping("/inventory/coa/read")
    public Object readCoa(HttpServletRequest req, @RequestBody Map<String, Object> b) { return out(lots.readCoa(ctx(req, b), b)); }

    @PostMapping("/inventory/lots/{id}/coa")
    public Object uploadCoa(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.uploadCoa(ctx(req, b), id, b)); }

    @GetMapping("/inventory/coa/{id}/file")
    public ResponseEntity<byte[]> coaFile(HttpServletRequest req, @PathVariable String id, @RequestParam(name = "s", required = false) String s) {
        Map<String, Object> f = lots.coaFile(ctx(req, null), id, s);
        return new StoredFile(Base64.getMimeDecoder().decode((String) f.get("b64")), (String) f.get("mime_type"), (String) f.get("file_name")).response();
    }

    @PostMapping("/inventory/coa/{id}/confirm")
    public Object confirmCoa(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return out(lots.confirmCoa(ctx(req, b), id, b)); }

    // ---- Excel export and upload
    @PostMapping("/bulk/{kind}/export")
    public ResponseEntity<byte[]> export(HttpServletRequest req, @PathVariable String kind, @RequestBody(required = false) Map<String, Object> b) {
        Map<String, Object> body = b == null ? Map.of() : b;
        BulkService.Export e = bulk.export(ctx(req, body), kind, body);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + e.fileName() + "\"")
            .header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'; sandbox").body(e.file());
    }

    @PostMapping("/bulk/{kind}/preview")
    public Object preview(HttpServletRequest req, @PathVariable String kind, @RequestBody Map<String, Object> b) { return out(bulk.preview(ctx(req, b), kind, b)); }

    @PostMapping("/bulk/{kind}/apply")
    public Object apply(HttpServletRequest req, @PathVariable String kind, @RequestBody Map<String, Object> b) { return out(bulk.apply(ctx(req, b), kind, b)); }

    // ---- errors: inventory's own wording for its database checks, then the usual contract
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> error(Exception e) {
        if (e instanceof HttpMessageNotReadableException bad) return errors.badJson(bad);
        Exception t = InventoryMessages.translate(e);
        return t instanceof RuleException r ? errors.rule(r) : errors.other(t);
    }

    private static Object out(Object x) { return x == null ? Map.of("ok", true) : PgArrays.fix(x); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
