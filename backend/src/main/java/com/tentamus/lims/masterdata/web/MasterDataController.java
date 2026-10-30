package com.tentamus.lims.masterdata.web;

import static com.tentamus.lims.masterdata.domain.MasterLists.*;

import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.masterdata.service.ControlledListService;
import com.tentamus.lims.masterdata.service.MasterDataService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.*;

/** The master data routes, with the same paths and answers as the Node backend. Thin: no rules here. */
@RestController
@RequestMapping("/api")
public class MasterDataController {
    private final MasterDataService master;
    private final ControlledListService lists;

    public MasterDataController(MasterDataService master, ControlledListService lists) {
        this.master = master;
        this.lists = lists;
    }

    @GetMapping("/sites")
    public List<Map<String, Object>> sites(HttpServletRequest req) { return master.sites(ctx(req, null)); }

    @PostMapping("/sites/bulk")
    public List<Map<String, Object>> saveSites(HttpServletRequest req, @RequestBody Map<String, Object> body) { return master.saveSites(ctx(req, body), body); }

    @GetMapping("/sites/{id}/holidays")
    public List<Map<String, Object>> holidays(HttpServletRequest req, @PathVariable String id) { return master.holidays(ctx(req, null), id); }

    @PostMapping("/sites/{id}/holidays/bulk")
    public List<Map<String, Object>> saveHolidays(HttpServletRequest req, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return master.saveHolidays(ctx(req, body), id, body);
    }

    @GetMapping("/timezones")
    public List<Map<String, Object>> timezones() { return master.timezones(); }

    @GetMapping("/matrices")
    public List<Map<String, Object>> matrices() { return lists.read(MATRICES); }

    @PostMapping("/matrices/bulk")
    public List<Map<String, Object>> saveMatrices(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return lists.save(ctx(req, body), MATRICES, body, Map.of());
    }

    @GetMapping("/product-categories")
    public List<Map<String, Object>> productCategories() { return lists.read(PRODUCT_CATEGORIES); }

    @PostMapping("/product-categories/bulk")
    public List<Map<String, Object>> saveProductCategories(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return lists.save(ctx(req, body), PRODUCT_CATEGORIES, body, Map.of());
    }

    @GetMapping("/compliance-categories")
    public Map<String, Object> complianceCategories(HttpServletRequest req) { return master.complianceCategories(ctx(req, null)); }

    @PostMapping("/compliance-categories")
    public List<Map<String, Object>> saveComplianceCategories(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return lists.save(ctx(req, body), COMPLIANCE_CATEGORIES, body, Map.of());
    }

    @GetMapping("/analytes")
    public List<Map<String, Object>> analytes() { return lists.read(ANALYTES); }

    @PostMapping("/analytes/bulk")
    public List<Map<String, Object>> saveAnalytes(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return master.saveAnalytes(ctx(req, body), body);
    }

    @GetMapping("/units")
    public List<Map<String, Object>> units() { return lists.read(UNITS); }

    @PostMapping("/units/bulk")
    public List<Map<String, Object>> saveUnits(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return lists.save(ctx(req, body), UNITS, body, Map.of());
    }

    @GetMapping("/units/convertible")
    public Map<String, Object> convertible(@RequestParam(required = false) String units, @RequestParam(required = false) String form) {
        return master.convertibleUnits(units, form);
    }

    @GetMapping("/units/convert")
    public Map<String, Object> convert(@RequestParam(required = false) String from, @RequestParam(required = false) String to,
                                       @RequestParam(required = false) String form) {
        return master.convert(from, to, form);
    }

    @GetMapping("/unit-conversions")
    public List<Map<String, Object>> unitConversions() { return lists.read(UNIT_CONVERSIONS); }

    @PostMapping("/unit-conversions/bulk")
    public List<Map<String, Object>> saveUnitConversions(HttpServletRequest req, @RequestBody Map<String, Object> body) {
        return lists.save(ctx(req, body), UNIT_CONVERSIONS, body, Map.of());
    }

    private static RequestContext ctx(HttpServletRequest req, Map<String, Object> body) { return RequestContext.of(req, body); }
}
