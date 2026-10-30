package com.tentamus.lims.equipment.web;

import com.tentamus.lims.core.files.StoredFile;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.equipment.domain.EquipmentMessages;
import com.tentamus.lims.equipment.service.EquipmentService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.*;

/** The equipment routes, same paths and answers as the Node backend. Thin: equipment's database checks worded for the screen. */
@RestController
@RequestMapping("/api/equipment")
public class EquipmentController {
    private final EquipmentService equipment;
    private final ApiExceptionHandler errors;

    public EquipmentController(EquipmentService equipment, ApiExceptionHandler errors) {
        this.equipment = equipment;
        this.errors = errors;
    }

    @GetMapping("/me")
    public Object me(HttpServletRequest req) { return equipment.me(ctx(req, null)); }

    @GetMapping("/lists")
    public Object lists(HttpServletRequest req) { return equipment.lists(ctx(req, null)); }

    @PostMapping("/types/bulk")
    public Object types(HttpServletRequest req, @RequestBody Map<String, Object> b) { return equipment.saveTypes(ctx(req, b), b, rows(b)); }

    @PostMapping("/departments/bulk")
    public Object departments(HttpServletRequest req, @RequestBody Map<String, Object> b) { return equipment.saveDepartments(ctx(req, b), b, rows(b)); }

    @GetMapping
    public Object register(HttpServletRequest req, @RequestParam Map<String, String> q) { return equipment.register(ctx(req, null), q); }

    @GetMapping("/due")
    public Object due(HttpServletRequest req) { return equipment.due(ctx(req, null)); }

    @GetMapping("/transfer-options")
    public Object transferOptions(HttpServletRequest req) { return equipment.transferOptions(ctx(req, null)); }

    @PostMapping("/many")
    public Object many(HttpServletRequest req, @RequestBody Map<String, Object> b) { return equipment.createMany(ctx(req, b), b, rows(b)); }

    @PostMapping("/documents/bulk")
    public Object documents(HttpServletRequest req, @RequestBody Map<String, Object> b) { return equipment.saveDocuments(ctx(req, b), b, rows(b)); }

    @GetMapping("/documents/{docId}/file")
    public ResponseEntity<byte[]> documentFile(HttpServletRequest req, @PathVariable String docId) {
        Map<String, Object> d = equipment.documentFile(ctx(req, null), docId);
        return new StoredFile(Base64.getMimeDecoder().decode((String) d.get("b64")), (String) d.get("mime_type"), (String) d.get("file_name")).response();
    }

    @PutMapping("/calibrations/{cid}")
    public Object updateCalibration(HttpServletRequest req, @PathVariable String cid, @RequestBody Map<String, Object> b) { return equipment.updateCalibration(ctx(req, b), cid, b); }

    @PutMapping("/qualifications/{qid}")
    public Object updateQualification(HttpServletRequest req, @PathVariable String qid, @RequestBody Map<String, Object> b) { return equipment.updateQualification(ctx(req, b), qid, b); }

    @PostMapping("/tags/{tagId}/tag-in")
    public Object tagIn(HttpServletRequest req, @PathVariable String tagId, @RequestBody Map<String, Object> b) { return equipment.tagIn(ctx(req, b), tagId, b); }

    @PostMapping
    public Object create(HttpServletRequest req, @RequestBody Map<String, Object> b) { return equipment.create(ctx(req, b), b); }

    @GetMapping("/{id}")
    public Object detail(HttpServletRequest req, @PathVariable String id) { return equipment.detail(ctx(req, null), id); }

    @PutMapping("/{id}")
    public Object update(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.update(ctx(req, b), id, b); }

    @PostMapping("/{id}/status")
    public Object status(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.status(ctx(req, b), id, b); }

    @PostMapping("/{id}/tag-out")
    public Object tagOut(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.tagOut(ctx(req, b), id, b); }

    @PostMapping("/{id}/events")
    public Object events(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.addEvent(ctx(req, b), id, b); }

    @PostMapping("/{id}/calibrations")
    public Object calibrations(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.addCalibration(ctx(req, b), id, b); }

    @PostMapping("/{id}/qualifications")
    public Object qualifications(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.addQualification(ctx(req, b), id, b); }

    @PostMapping("/{id}/documents")
    public Object addDocument(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.addDocument(ctx(req, b), id, b); }

    @PostMapping("/{id}/schedules")
    public Object schedules(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.saveSchedules(ctx(req, b), id, b, rows(b)); }

    @PostMapping("/{id}/transfer")
    public Object transfer(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) { return equipment.transfer(ctx(req, b), id, b); }

    /** Equipment's own wording for its database checks, then the usual error contract. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> error(Exception e) {
        if (e instanceof HttpMessageNotReadableException bad) return errors.badJson(bad);
        Exception t = EquipmentMessages.MESSAGES.translate(e);
        return t instanceof RuleException r ? errors.rule(r) : errors.other(t);
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
