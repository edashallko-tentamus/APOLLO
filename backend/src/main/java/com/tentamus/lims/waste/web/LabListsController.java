package com.tentamus.lims.waste.web;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.labels.service.LabelsService;
import com.tentamus.lims.search.service.SearchService;
import com.tentamus.lims.waste.service.WasteService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** Waste classifications, search everything, and label contents: same paths and answers as the Node backend. */
@RestController
public class LabListsController {
    private final WasteService waste;
    private final SearchService search;
    private final LabelsService labels;

    public LabListsController(WasteService waste, SearchService search, LabelsService labels) {
        this.waste = waste;
        this.search = search;
        this.labels = labels;
    }

    @GetMapping("/api/waste")
    public Object waste(HttpServletRequest req) { return waste.list(ctx(req, null)); }

    @GetMapping("/api/waste/options")
    public Object wasteOptions(HttpServletRequest req) { return waste.options(ctx(req, null)); }

    @PostMapping("/api/waste")
    public Object saveWaste(HttpServletRequest req, @RequestBody(required = false) Map<String, Object> b) { return waste.save(ctx(req, b), b == null ? Map.of() : b); }

    @GetMapping("/api/search")
    public Object search(HttpServletRequest req, @RequestParam Map<String, String> q) { return search.search(ctx(req, null), q); }

    @GetMapping("/api/labels/{kind}")
    public Object labels(HttpServletRequest req, @PathVariable String kind, @RequestParam Map<String, String> q) { return labels.labels(ctx(req, null), kind, q); }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }
}
