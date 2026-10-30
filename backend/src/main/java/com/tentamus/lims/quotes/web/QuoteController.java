package com.tentamus.lims.quotes.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.pricing.domain.CatalogueCsv;
import com.tentamus.lims.pricing.service.CatalogueService;
import com.tentamus.lims.quotes.service.ProjectService;
import com.tentamus.lims.quotes.service.QuoteService;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Pricing and quoting routes (catalogue, rush schedules, projects, versions, quotes), same paths and answers as Node. */
@RestController
@RequestMapping("/api")
public class QuoteController {
    private final CatalogueService catalogue;
    private final ProjectService projects;
    private final QuoteService quotes;

    public QuoteController(CatalogueService catalogue, ProjectService projects, QuoteService quotes) {
        this.catalogue = catalogue;
        this.projects = projects;
        this.quotes = quotes;
    }

    // ---- rush fee schedules
    @GetMapping("/rush-schedules")
    public List<Map<String, Object>> rushSchedules() { return catalogue.rushSchedules(); }

    @PostMapping("/rush-schedules/bulk")
    public List<Map<String, Object>> saveSchedules(HttpServletRequest req, @RequestBody Map<String, Object> b) { return catalogue.saveSchedules(ctx(req, b), rows(b)); }

    @PostMapping("/rush-schedules/{id}/tiers/bulk")
    public List<Map<String, Object>> saveTiers(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) {
        return catalogue.saveTiers(ctx(req, b), id, rows(b));
    }

    // ---- test catalogue
    @GetMapping("/catalog")
    public List<Map<String, Object>> catalogue() { return catalogue.catalogue(); }

    @GetMapping("/catalog.csv")
    public ResponseEntity<byte[]> catalogueCsv(@RequestParam(name = "public", required = false) String pub) {
        boolean p = "1".equals(pub);
        return ResponseEntity.ok().header(HttpHeaders.CONTENT_TYPE, "text/csv; charset=utf-8")
            .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + (p ? "public_" : "") + "test_catalogue.csv\"")
            .body(CatalogueCsv.of(catalogue.csvRows(p)).getBytes(StandardCharsets.UTF_8));
    }

    @PostMapping("/catalog/reprice")
    public Map<String, Object> reprice(HttpServletRequest req, @RequestBody Map<String, Object> b) { return catalogue.reprice(ctx(req, b), b); }

    @GetMapping("/catalog/{testId}")
    public Map<String, Object> cataloguePage(@PathVariable String testId) { return catalogue.page(testId); }

    @PutMapping("/catalog/{testId}")
    public Map<String, Object> saveCataloguePage(HttpServletRequest req, @PathVariable String testId, @RequestBody Map<String, Object> b) {
        return catalogue.save(ctx(req, b), testId, b);
    }

    // ---- projects and their versions (shared with quotes)
    @GetMapping("/projects")
    public Object projects(@RequestParam Map<String, String> q) { return projects.list(q); }

    @PostMapping("/projects")
    public Map<String, Object> createProject(HttpServletRequest req, @RequestBody Map<String, Object> b) { return projects.create(ctx(req, b), row(b)); }

    @PutMapping("/projects/{id}")
    public List<Map<String, Object>> updateProject(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) {
        return projects.update(ctx(req, b), id, row(b));
    }

    @GetMapping("/projects/{id}")
    public Map<String, Object> project(@PathVariable String id) { return projects.detail(id); }

    @PostMapping("/projects/{id}/versions")
    public Map<String, Object> newVersion(HttpServletRequest req, @PathVariable String id, @RequestBody(required = false) Map<String, Object> b) {
        return projects.newVersion(ctx(req, b), id);
    }

    @GetMapping("/versions/{vid}")
    public Map<String, Object> version(@PathVariable String vid) { return projects.version(vid); }

    @PutMapping("/versions/{vid}")
    public List<Map<String, Object>> updateVersion(HttpServletRequest req, @PathVariable String vid, @RequestBody Map<String, Object> b) {
        return projects.updateVersion(ctx(req, b), vid, row(b));
    }

    @PostMapping("/versions/{vid}/status")
    public List<Map<String, Object>> versionStatus(HttpServletRequest req, @PathVariable String vid, @RequestBody Map<String, Object> b) {
        return projects.setStatus(ctx(req, b), vid, b);
    }

    @PostMapping("/versions/{vid}/lines")
    public List<Map<String, Object>> saveLines(HttpServletRequest req, @PathVariable String vid, @RequestBody Map<String, Object> b) {
        Object prefill = b.get("prefill");
        return projects.saveLines(ctx(req, b), vid, rows(b), prefill != null && !Boolean.FALSE.equals(prefill) && !"".equals(prefill));
    }

    @PostMapping("/versions/{vid}/rush-terms")
    public List<Map<String, Object>> saveRushTerms(HttpServletRequest req, @PathVariable String vid, @RequestBody Map<String, Object> b) {
        return projects.saveRushTerms(ctx(req, b), rows(b));
    }

    @GetMapping("/lines/{lineId}/analytes")
    public List<Map<String, Object>> analyteChoices(@PathVariable String lineId) { return projects.analyteChoices(lineId); }

    @PostMapping("/lines/{lineId}/analytes")
    public List<Map<String, Object>> saveAnalyteChoices(HttpServletRequest req, @PathVariable String lineId, @RequestBody Map<String, Object> b) {
        return projects.saveAnalyteChoices(ctx(req, b), rows(b));
    }

    // ---- standalone quotes
    @GetMapping("/quotes")
    public Map<String, Object> quotes(HttpServletRequest req, @RequestParam Map<String, String> q) { return quotes.list(ctx(req, null), q); }

    @PostMapping("/quotes")
    public Map<String, Object> createQuote(HttpServletRequest req, @RequestBody Map<String, Object> b) { return quotes.create(ctx(req, b), b); }

    @PutMapping("/quotes/{id}")
    public Map<String, Object> updateQuote(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> b) {
        return quotes.update(ctx(req, b), id, b);
    }

    @GetMapping("/quotes/people")
    public List<Map<String, Object>> people() { return quotes.people(); }

    @GetMapping("/quotes/catalog")
    public List<Map<String, Object>> quoteCatalogue(@RequestParam(name = "v", required = false) String v) { return quotes.catalogue(v); }

    @PostMapping("/quotes/versions/{vid}/decide")
    public Map<String, Object> decide(HttpServletRequest req, @PathVariable String vid, @RequestBody Map<String, Object> b) {
        return quotes.decide(ctx(req, b), vid, b);
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> row(Map<String, Object> b) { return b != null && b.get("row") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(Map<String, Object> b) { return b != null && b.get("rows") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of(); }
}
