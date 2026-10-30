package com.tentamus.lims.inventory.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.inventory.domain.ChemicalTypes;
import com.tentamus.lims.inventory.domain.Lot;
import com.tentamus.lims.inventory.domain.LotAnalyteLine;
import com.tentamus.lims.inventory.domain.Mixture;
import com.tentamus.lims.inventory.domain.StockMovement;
import com.tentamus.lims.inventory.domain.SupplierCoa;
import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.domain.Values;
import com.tentamus.lims.inventory.repo.LotRepository;
import com.tentamus.lims.inventory.repo.UnitRepository;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import org.springframework.stereotype.Service;

/**
 * Inventory lots: items and requests, the purchase steps, receiving, transfer, disposal, stock movements, in-house
 * mixtures, QA testing before use and Supplier COAs. Every create and change is signed (user ID and password) with the
 * meaning of the action; routine usage is not. The rules live in the domain objects ({@link Lot}, {@link StockMovement},
 * {@link Mixture}, LotQaTesting, {@link SupplierCoa}); this class loads them, asks them, and saves through {@link LotWriter}.
 * Not here: QA testing samples (send_lot_for_qa_testing stays in the database: it orders tests on the internal order).
 */
@Service
public class LotService {
    private static final Pattern COA_TYPES = Pattern.compile("^(application/pdf|image/(png|jpeg|gif|webp))$");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final LotRepository lots;
    private final CoaReader ai;
    private final ObjectMapper json;
    private final LotWriter writer;
    private final UnitRepository units;
    private final LabClock clock;

    public LotService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, LotRepository lots, CoaReader ai, ObjectMapper json,
                      LotWriter writer, UnitRepository units, LabClock clock) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.lots = lots;
        this.ai = ai;
        this.json = json;
        this.writer = writer;
        this.units = units;
        this.clock = clock;
    }

    // ---------------------------------------------------------------- reading
    public Object list(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        return com.tentamus.lims.core.paging.PagedList.wanted(query) ? lots.page(site, query) : lots.lots(site);
    }

    public Map<String, Object> dashboard(RequestContext ctx) { return lots.dashboard(access.currentSite(ctx)); }

    public Map<String, Object> detail(RequestContext ctx, String id) {
        lotSite(ctx, id);
        return lots.detail(id);
    }

    /** The lab of a lot the person may see, or a refusal. */
    String lotSite(RequestContext ctx, String id) {
        String site = lots.siteOf(id);
        if (site == null) throw new RuleException("Lot not found");
        access.checkSite(ctx, site);
        return site;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new Meaning(meaning, action, "Inventory"), work);
    }

    // ---------------------------------------------------------------- items and requests
    private LotWriter.Save save(RequestContext ctx, String site, Object qaChoice) {
        return new LotWriter.Save(units.load(), clock.today(site), qaChoice, ctx, false);
    }

    /** Receive many (paste grid): each row may name one analyte with its concentration. */
    public List<Map<String, Object>> receiveMany(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        Units u = units.load();
        LocalDate today = clock.today(site);
        return signed(ctx, body, "Received by", "Receive many: " + rows.size() + " item(s)", d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, Object> rest = new LinkedHashMap<>(row);
                Object aid = rest.remove("analyte_id"), ac = rest.remove("analyte_concentration"), au = rest.remove("analyte_unit"), qa = rest.remove("qa_testing");
                Map<String, Object> res = writer.save(d, LotRepository.LOTS, rest, Map.of("site_id", site), new LotWriter.Save(u, today, row.get("id") != null ? null : qa, ctx, false));
                Object lotId = res != null && res.get("id") != null ? res.get("id") : row.get("id");
                if (aid != null && !"".equals(aid)) {
                    Map<String, Object> ex = d.one("SELECT * FROM lot_analyte WHERE lot_id = ?::uuid AND analyte_id = ?::uuid", lotId, aid);
                    Map<String, Object> after = new LinkedHashMap<>(ex == null ? Map.of() : ex);
                    after.put("lot_id", lotId.toString());
                    after.put("analyte_id", aid);
                    after.put("concentration", ac);
                    after.put("concentration_unit", au == null || "".equals(au) ? null : au);
                    Object unit = LotAnalyteLine.checked(lots.find(d, lotId.toString()), ex, after, lots.analyteActive(d, aid), u).get("concentration_unit");
                    if (ex != null) d.update("UPDATE lot_analyte SET concentration = ?, concentration_unit = ?, status = 'Active' WHERE id = ?::uuid", ac, unit, ex.get("id"));
                    else d.update("INSERT INTO lot_analyte (lot_id, analyte_id, concentration, concentration_unit) VALUES (?::uuid, ?::uuid, ?, ?)", lotId, aid, ac, unit);
                }
                writer.assertAnalyteNamed(d, lotId.toString());
                Map<String, Object> id = new LinkedHashMap<>();
                id.put("id", lotId);
                out.add(id);
            }
            return out;
        });
    }

    /** A new item (received now, or a purchase request) with its analytes, and its Supplier COA when one comes with it. */
    @SuppressWarnings("unchecked")
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        boolean request = truthy(body.get("request"));
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        row.remove("id");
        if (request) row.put("receipt_status", "Requested");
        Map<String, Object> coa = map(body.get("coa"));
        boolean withCoa = coa.get("content_base64") != null && !"".equals(coa.get("content_base64"));
        if (withCoa && !COA_TYPES.matcher(str(coa.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        String action = "New inventory item: " + str(row.get("item_name")) + (withCoa ? " (with its Supplier COA)" : "");
        LotWriter.Save s = save(ctx, site, body.get("qa_testing"));
        return signed(ctx, body, request ? "Requested by" : "Created by", action, d -> {
            Map<String, Object> lot = writer.save(d, request ? LotRepository.REQUESTS : LotRepository.LOTS, row, Map.of("site_id", site), s);
            lots.syncAnalytes(d, lot.get("id"), (List<Map<String, Object>>) list(body.get("analytes")), s.units());
            writer.assertAnalyteNamed(d, lot.get("id").toString());
            if (withCoa) saveCoa(d, lot.get("id"), coa, coa.get("proposal"), coa.get("confirmed"));
            return new LinkedHashMap<>(lot);
        });
    }

    /** Edit an item and its analytes (one signature and Reason for Change). */
    @SuppressWarnings("unchecked")
    public Map<String, Object> updateItem(RequestContext ctx, String id, Map<String, Object> body) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        signed(ctx, body, "Changed by", lots.words(id, "Changed"), d -> {
            writer.save(d, LotRepository.LOTS, withId(map(body.get("row")), id), Map.of(), s);
            if (body.get("analytes") != null) lots.syncAnalytes(d, id, (List<Map<String, Object>>) list(body.get("analytes")), s.units());
            writer.assertAnalyteNamed(d, id);
            return null;
        });
        return Map.of("ok", true);
    }

    public List<Map<String, Object>> updateLot(RequestContext ctx, String id, Map<String, Object> body) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, body, "Changed by", lots.words(id, "Changed"), d -> {
            Map<String, Object> r = writer.save(d, LotRepository.LOTS, withId(map(body.get("row")), id), Map.of(), s);
            List<Map<String, Object>> out = new ArrayList<>();
            if (r == null || !r.isEmpty()) out.add(r);
            return out;
        });
    }

    /** A new purchase request (not a reorder of a lot). */
    public Map<String, Object> request(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        Map<String, Object> row = new LinkedHashMap<>(map(body.get("row")));
        row.remove("id");
        row.put("receipt_status", "Requested");
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, body, "Requested by", "Purchase request: " + str(row.get("item_name")),
            d -> new LinkedHashMap<>(writer.save(d, LotRepository.REQUESTS, row, Map.of("site_id", site), s)));
    }

    // ---------------------------------------------------------------- purchase steps, receiving, transfer, disposal
    /** Approve or order the lot's purchase request (since migration 011 through Purchasing). */
    public Map<String, Object> purchaseStatus(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        Object to = body.get("receipt_status");
        if (!"Approved".equals(to) && !"Ordered".equals(to)) throw new RuleException("Use Receive to receive a lot");
        Map<String, Object> l = db.one("SELECT purchase_line_id FROM inventory_lot WHERE id = ?::uuid", id);
        Object line = l == null ? null : l.get("purchase_line_id");
        if (line == null) throw new RuleException("This lot has no purchase request");
        boolean approve = "Approved".equals(to);
        RequestContext c = reasonOr(ctx, approve ? "Purchase request approved" : "Ordered");
        Meaning m = new Meaning(approve ? "Approved by" : "Ordered by", lots.words(id, approve ? "Purchase approved" : "Ordered"), "Purchasing");
        return signatures.signed(c, body, m, d -> approve
            ? d.raw("SELECT approve_purchase_lines(?::uuid[])", List.of(line))
            : d.raw("SELECT create_purchase_order(?::uuid[], ?, ?, NULL)", List.of(line), or(body.get("external_po_number")), or(body.get("confirmation_number"))));
    }

    public Map<String, Object> cancel(RequestContext ctx, String id, Map<String, Object> body) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, body, "Cancelled by", lots.words(id, "Purchase request cancelled"), d -> {
            writer.write(d, lots.find(d, id), Map.of("status", "Cancelled"), s);
            return noRows();
        });
    }

    public Map<String, Object> reorder(RequestContext ctx, String id, Map<String, Object> body) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, body, "Requested by", lots.words(id, "Reorder of"), d -> {
            Lot lot = lots.find(d, id);
            String made = writer.write(d, null, lot.reorder(Values.dec(or(body.get("quantity"))), (String) or(body.get("notes"))), s);
            lots.copyAnalytes(d, id, made, false);
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", made);
            return out;
        });
    }

    public Map<String, Object> receive(RequestContext ctx, String id, Map<String, Object> b) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signatures.signed(reasonOr(ctx, "Received into inventory"), b, new Meaning("Received by", lots.words(id, "Received"), "Inventory"), d -> {
            Lot lot = lots.find(d, id);
            writer.write(d, lot, lot.receive(Values.dec(or(b.get("quantity"))), (String) or(b.get("unit")), (String) or(b.get("manufacturer_lot")),
                (String) or(b.get("expiration_date")), (String) or(b.get("retest_date")), (String) or(b.get("storage_location_id")), (String) or(b.get("received_date")), s.today()), s);
            return d.raw("SELECT ''::text AS receive_lot");
        });
    }

    public Map<String, Object> transfer(RequestContext ctx, String id, Map<String, Object> b) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, b, "Transferred by", lots.words(id, "Transferred"), d -> {
            Lot lot = lots.find(d, id);
            String toSite = b.get("to_site_id") == null ? null : b.get("to_site_id").toString();
            BigDecimal qty = Values.dec(b.get("quantity"));
            Map<String, Object> values = lot.transferTo(toSite, qty, (String) or(b.get("notes")));
            String made = writer.write(d, null, values, new LotWriter.Save(s.units(), clock.today(toSite), null, ctx, false));
            lots.copyAnalytes(d, id, made, true);
            Map<String, Object> to = d.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", toSite);
            StockMovement out = StockMovement.record(lot, "Transfer Out", qty, "Transfer to " + (to == null ? null : to.get("site_code")), (String) or(b.get("notes")), ctx.reason(), s.today());
            lots.insertMovement(d, new StockMovement(out.lotId(), out.type(), out.quantity(), made, out.reference(), out.notes(), out.reason()), null);
            lots.copyCoas(d, id, made);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("id", made);
            return r;
        });
    }

    public Map<String, Object> dispose(RequestContext ctx, String id, Map<String, Object> b) {
        String site = lotSite(ctx, id);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, b, "Disposed by", lots.words(id, "Disposed"), d -> {
            Lot lot = lots.find(d, id);
            StockMovement off = lot.dispose(lots.onHand(d, id), ctx.reason());
            if (off != null) lots.insertMovement(d, off, null);
            // the database's lot trigger (kept for other writers) still asks that a disposal comes through Dispose
            d.one("SELECT set_config('lims.disposing', '1', true)");
            writer.write(d, lot, Map.of("status", "Disposed"), new LotWriter.Save(s.units(), s.today(), null, ctx, true));
            d.one("SELECT set_config('lims.disposing', '', true)");
            return d.raw("SELECT ''::text AS dispose_lot");
        });
    }

    // ---------------------------------------------------------------- stock movements
    /** Usage and adjustments for one or many lots of this lab; usage needs no signature, adjustments do. */
    public List<Map<String, Object>> movements(RequestContext ctx, Map<String, Object> body, List<Map<String, Object>> rows) {
        String site = access.currentSite(ctx);
        LocalDate today = clock.today(site);
        boolean routine = rows.stream().allMatch(m -> "Usage".equals(m.get("txn_type") == null || "".equals(m.get("txn_type")) ? "Usage" : m.get("txn_type")));
        Function<Db, List<Map<String, Object>>> work = d -> {
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> m : rows) {
                boolean byId = m.get("lot_id") != null && !"".equals(m.get("lot_id"));
                Lot lot = byId ? lots.find(d, m.get("lot_id").toString()) : lots.byCode(d, str(m.get("lot_code")).trim());
                if (lot == null) throw new RuleException("Lot \"" + str(m.get("lot_code")) + "\" not found");
                if (!site.equals(lot.siteId())) throw new RuleException("Lot " + str(m.get("lot_code")) + " belongs to another lab");
                String type = or(m.get("txn_type")) == null ? "Usage" : m.get("txn_type").toString();
                StockMovement mv = StockMovement.record(lot, type, Values.dec(m.get("quantity")), (String) or(m.get("reference")), (String) or(m.get("notes")),
                    ctx.reason(), today);
                out.add(lots.insertMovement(d, mv, or(m.get("txn_at"))));
            }
            return out;
        };
        return routine ? uow.run(ctx, work) : signed(ctx, body, "Adjusted by", "Stock adjustment: " + rows.size() + " line(s)", work);
    }

    // ---------------------------------------------------------------- in-house mixtures
    /** The components as entered, each lot checked: this lab's, released by QA testing for every use. */
    private Mixture mixtureOf(Db d, String site, Object components, Units u) {
        List<Map<String, Object>> entered = new ArrayList<>();
        for (Object x : list(components)) if (x instanceof Map<?, ?> m) entered.add(map(m));
        List<String> ids = entered.stream().map(e -> str(e.get("lot_id"))).filter(RequestContext::isUuid).toList();
        Mixture mix = Mixture.of(entered, lots.components(d, ids), u);
        for (Mixture.Portion p : mix.portions()) {
            Lot c = lots.find(d, p.lot().lotId());
            if (!site.equals(c.siteId())) throw RuleException.database("Component lot " + c.code() + " is in another lab");
            lots.qaTesting(d, c.id()).assertMixtureComponent(c.code(), c.name());
        }
        return mix;
    }

    /** The mixture lot, its components (each draws a Usage, written by the database) and its calculated analytes. */
    private String makeMixture(Db d, Mixture mix, Map<String, Object> values, LotWriter.Save s, Map<String, String> outUnits, List<?> targets) {
        String id = writer.write(d, null, values, s);
        for (Mixture.Portion p : mix.portions()) {
            if (p.lot().lotId().equals(id)) throw RuleException.database("A mixture cannot be a component of itself");
            lots.addComponent(d, id, p);
        }
        Lot made = lots.find(d, id);
        for (Mixture.Concentration c : mix.concentrations(made.quantityReceived(), made.unit(), made.physicalForm() == null ? "Liquid" : made.physicalForm(), outUnits)) {
            Map<String, Object> t = targets.stream().filter(x -> x instanceof Map<?, ?> m && c.analyteId().equals(str(m.get("analyte_id")))).map(x -> map(x)).findFirst().orElse(Map.of());
            lots.addCalculatedAnalyte(d, id, c, Values.dec(t.get("target")), Values.dec(t.get("tolerance_pct")));
        }
        return id;
    }

    public Map<String, Object> mixture(RequestContext ctx, Map<String, Object> b) {
        String site = access.currentSite(ctx);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, b, "Prepared by", "In-house mixture: " + str(b.get("item_description")), d -> {
            Mixture mix = mixtureOf(d, site, b.get("components"), s.units());
            mix.assertHasComponents();
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("site_id", site);
            v.put("chemical_id", or(b.get("chemical_id")));
            v.put("item_description", or(b.get("item_description")));
            v.put("chemical_types", List.of(ChemicalTypes.MIXTURE));
            v.put("quantity_received", b.get("quantity"));
            v.put("unit", b.get("unit"));
            v.put("concentration", or(b.get("concentration")));
            v.put("concentration_unit", or(b.get("concentration_unit")));
            LocalDate exp = mix.expiry(Values.date(or(b.get("expiration_date"))));
            v.put("expiration_date", exp == null ? null : exp.toString());
            v.put("storage_condition", or(b.get("storage_condition")));
            v.put("storage_location_id", or(b.get("storage_location_id")));
            v.put("notes", or(b.get("notes")));
            v.put("received_date", s.today().toString());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", makeMixture(d, mix, v, s, Map.of(), List.of()));
            return out;
        });
    }

    /** The mixture page: the default quantity made and the calculated concentration of each analyte, before saving. */
    public Map<String, Object> mixturePreview(RequestContext ctx, Map<String, Object> b) {
        access.currentSite(ctx);
        Units u = units.load();
        List<Map<String, Object>> comps = new ArrayList<>();
        for (Object x : list(b.get("components")))
            if (x instanceof Map<?, ?> m && truthy(m.get("lot_id")) && Js.toNumber(m.get("quantity")) > 0) comps.add(map(m));
        Mixture mix = Mixture.of(comps, lots.components(db, comps.stream().map(c -> str(c.get("lot_id"))).filter(RequestContext::isUuid).toList()), u);
        Object unit = b.get("unit");
        BigDecimal def = truthy(unit) ? mix.defaultQuantity(unit.toString()) : null;
        double asked = Js.toNumber(b.get("quantity"));
        Object qty = asked > 0 ? (Object) asked : def;
        List<Map<String, Object>> analytes = new ArrayList<>();
        if (truthy(qty) && truthy(unit)) {
            Map<String, String> outUnits = new LinkedHashMap<>();
            map(b.get("out_units")).forEach((k, v) -> outUnits.put(k, v == null ? null : v.toString()));
            Map<String, Object> cas = new LinkedHashMap<>();
            for (Mixture.Concentration c : mix.concentrations(Values.dec(qty), unit.toString(), truthy(b.get("form")) ? b.get("form").toString() : "Liquid", outUnits)) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("analyte_id", c.analyteId());
                r.put("analyte_name", c.analyteName());
                r.put("concentration", c.concentration());
                r.put("concentration_unit", c.unit());
                r.put("calc_note", c.note());
                r.put("cas_number", cas.computeIfAbsent(c.analyteId(), k -> db.one("SELECT cas_number FROM analyte WHERE id = ?::uuid", k).get("cas_number")));
                analytes.add(r);
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("default_quantity", def);
        out.put("quantity", qty);
        out.put("analytes", analytes);
        return out;
    }

    public Map<String, Object> prepareMixture(RequestContext ctx, Map<String, Object> b) {
        String site = access.currentSite(ctx);
        LotWriter.Save s = save(ctx, site, null);
        return signed(ctx, b, "Prepared by", "In-house mixture: " + str(b.get("item_name")), d -> {
            Mixture mix = mixtureOf(d, site, b.get("components"), s.units());
            BigDecimal qty = Values.dec(b.get("quantity"));
            String form = (String) or(b.get("physical_form"));
            mix.assertCanPrepare(form, qty);
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("site_id", site);
            v.put("item_name", b.get("item_name"));
            v.put("chemical_types", ChemicalTypes.of(b.get("chemical_types")).asMixture().types());
            v.put("physical_form", form);
            v.put("quantity_received", qty);
            v.put("unit", b.get("unit"));
            LocalDate exp = mix.expiry(Values.date(or(b.get("expiration_date"))));
            v.put("expiration_date", exp == null ? null : exp.toString());
            v.put("retest_date", or(b.get("retest_date")));
            v.put("storage_condition", or(b.get("storage_condition")));
            v.put("storage_location_id", or(b.get("storage_location_id")));
            v.put("notes", or(b.get("notes")));
            v.put("received_date", s.today().toString());
            Map<String, String> outUnits = new LinkedHashMap<>();
            for (Object t : list(b.get("targets")))
                if (t instanceof Map<?, ?> m && m.get("unit") != null) outUnits.put(str(m.get("analyte_id")), m.get("unit").toString());
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("id", makeMixture(d, mix, v, s, outUnits, list(b.get("targets"))));
            return out;
        });
    }

    // ---------------------------------------------------------------- QA testing before use
    /** The tests a lot can be released for and qualified by: this lab's tests with an approved version. */
    public Map<String, Object> qualifyOptions(RequestContext ctx, String id) {
        String site = lotSite(ctx, id);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("tests", db.rows("""
            SELECT t.id, t.test_code, t.test_name, d.department_code FROM test t LEFT JOIN department d ON d.id = t.department_id
             WHERE t.site_id = ?::uuid AND t.status = 'Active' AND EXISTS (SELECT 1 FROM test_version v WHERE v.test_id = t.id AND v.status = 'Effective')
             ORDER BY d.department_code NULLS LAST, t.test_name""", site));
        out.put("can_qualify", access.has(ctx, "inventory.qualify"));
        return out;
    }

    /** Sends the lot for QA testing: one test sample with the lot's ID; an empty use = released for every use. */
    public Map<String, Object> qualify(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        List<Map<String, Object>> items = new ArrayList<>();
        for (Object o : list(body.get("items"))) {
            if (!(o instanceof Map<?, ?> x)) continue;
            Object use = x.get("use_test_id");
            boolean useOk = use == null || "".equals(use) || RequestContext.isUuid(use);
            if (!RequestContext.isUuid(x.get("qualification_test_id")) || !useOk) continue;
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("use_test_id", use == null || "".equals(use) ? null : use);
            item.put("qualification_test_id", x.get("qualification_test_id"));
            items.add(item);
        }
        return uow.run(reasonOr(ctx, "Sent for QA testing"), d -> {
            Object sample = d.one("SELECT send_lot_for_qa_testing(?::uuid, ?::jsonb) AS sample_id", id, toJson(items)).get("sample_id");
            return d.one("SELECT id AS sample_id, sample_code FROM sample WHERE id = ?::uuid", sample);
        });
    }

    /** QA waives a lot's QA testing (signed, with a reason; only before anything was sent for it). */
    public Map<String, Object> waiveQa(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        if (ctx.reason().trim().isEmpty()) throw new RuleException("Give the reason for waiving QA testing");
        access.require(ctx, "inventory.qa_configure", "waive QA testing");
        signatures.signed(ctx, body, new Meaning("Approved by", lots.words(id, "QA testing waived"), "Inventory"), d -> {
            Lot lot = lots.find(d, id);
            lots.qaTesting(d, id).assertWaivable(lot.code(), ctx.reason());
            // the lot trigger (kept for other writers) lets only the system change whether a lot needs QA testing
            d.one("SELECT set_config('lims.group_sync', '1', true), set_config('lims.media_internal', '1', true)");
            d.update("UPDATE inventory_lot SET qualification_required = false WHERE id = ?::uuid", id);
            d.one("SELECT set_config('lims.media_internal', '', true), set_config('lims.group_sync', '', true)");
            return null;
        });
        return Map.of("ok", true);
    }

    // ---------------------------------------------------------------- Supplier COAs
    /** Reads a COA before the item exists: the AI proposes values to fill the form; nothing is saved. */
    public Map<String, Object> readCoa(RequestContext ctx, Map<String, Object> body) {
        access.currentSite(ctx);
        if (!truthy(body.get("content_base64"))) throw new RuleException("Choose the COA file first");
        if (!COA_TYPES.matcher(str(body.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("aiEnabled", ai.enabled());
        out.put("proposal", ai.enabled() ? ai.read(str(body.get("content_base64")), str(body.get("mime_type"))) : null);
        return out;
    }

    /** Uploads a COA to a lot (kept unchanged, with its SHA-256); the AI proposes values when it is switched on. */
    public Map<String, Object> uploadCoa(RequestContext ctx, String id, Map<String, Object> body) {
        lotSite(ctx, id);
        if (!truthy(body.get("content_base64"))) throw new RuleException("Choose the COA file to upload");
        if (!COA_TYPES.matcher(str(body.get("mime_type"))).matches()) throw new RuleException("Upload the COA as a PDF or an image (PNG or JPEG)");
        JsonNode proposal = null;
        String aiError = null;
        if (ai.enabled() && !Boolean.FALSE.equals(body.get("use_ai"))) {
            try { proposal = ai.read(str(body.get("content_base64")), str(body.get("mime_type"))); } catch (RuleException e) { aiError = e.getMessage(); }
        }
        final JsonNode p = proposal;
        Map<String, Object> coa = signatures.signed(reasonOr(ctx, "Supplier COA uploaded"), body,
            new Meaning("Uploaded by", lots.words(id, "Supplier COA " + str(body.get("file_name")) + " uploaded"), "Inventory"),
            d -> saveCoa(d, id, body, p, null));
        Map<String, Object> out = new LinkedHashMap<>(coa);
        out.put("proposal", proposal);
        out.put("aiError", aiError);
        out.put("aiEnabled", ai.enabled());
        return out;
    }

    private Map<String, Object> saveCoa(Db d, Object lotId, Map<String, Object> f, Object proposal, Object confirmed) {
        Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
            truthy(f.get("file_name")) ? f.get("file_name") : "coa", f.get("mime_type"), f.get("content_base64")).get("id");
        boolean proposed = proposal != null && !(proposal instanceof JsonNode n && n.isNull());
        boolean stamp = SupplierCoa.confirmationNeedsStamp(null, confirmed);
        // the COA record carries the stored file's name and fingerprint
        return d.one("""
            INSERT INTO supplier_coa (lot_id, document_id, file_name, sha256, extraction_method, ai_model, ai_proposed, values_confirmed, confirmed_by, confirmed_at)
            SELECT ?::uuid, f.id, f.file_name, f.sha256, ?, ?, ?::jsonb, ?::jsonb, CASE WHEN ? THEN current_app_user() END, CASE WHEN ? THEN clock_timestamp() END
              FROM document_file f WHERE f.id = ?::uuid RETURNING id, sha256""",
            lotId, proposed ? "AI proposed, person confirmed" : "Manual", proposed ? ai.model() : null, proposed ? toJson(proposal) : null,
            confirmed == null ? null : toJson(confirmed), stamp, stamp, doc);
    }

    /** A COA file; opened in a new tab, the lab comes in the link (?s=). */
    public Map<String, Object> coaFile(RequestContext ctx, String id, String linkSite) {
        Map<String, Object> d = db.one("""
            SELECT d.file_name, d.mime_type, encode(d.content, 'base64') AS b64, l.site_id FROM supplier_coa s
              JOIN document_file d ON d.id = s.document_id JOIN inventory_lot l ON l.id = s.lot_id WHERE s.id = ?::uuid""", id);
        if (d == null) throw new RuleException("COA not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    /** The values a person confirmed from the COA are written to the lot (signed "Verified by"). */
    public Map<String, Object> confirmCoa(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> s = db.one("SELECT lot_id FROM supplier_coa WHERE id = ?::uuid", id);
        if (s == null) throw new RuleException("COA not found");
        String lotId = (String) s.get("lot_id");
        String site = lotSite(ctx, lotId);
        List<String> allowed = List.of("manufacturer_lot", "expiration_date", "retest_date", "purity_pct", "concentration", "concentration_unit", "catalog_number");
        Map<String, Object> values = new LinkedHashMap<>();
        for (Map.Entry<String, Object> e : map(body.get("values")).entrySet())
            if (allowed.contains(e.getKey()) && e.getValue() != null && !"".equals(e.getValue())) values.put(e.getKey(), e.getValue());
        LotWriter.Save sv = save(ctx, site, null);
        signatures.signed(reasonOr(ctx, "Values confirmed from the Supplier COA"), body,
            new Meaning("Verified by", lots.words(lotId, "Supplier COA values confirmed"), "Inventory"), d -> {
                if (!values.isEmpty()) writer.save(d, new com.tentamus.lims.core.db.RecordWriter("inventory_lot", allowed), withId(values, lotId), Map.of(), sv);
                Object before = d.one("SELECT values_confirmed FROM supplier_coa WHERE id = ?::uuid", id).get("values_confirmed");
                boolean stamp = SupplierCoa.confirmationNeedsStamp(before, json.valueToTree(values));
                d.update("""
                    UPDATE supplier_coa SET values_confirmed = ?::jsonb, confirmed_by = CASE WHEN ? THEN current_app_user() ELSE confirmed_by END,
                      confirmed_at = CASE WHEN ? THEN clock_timestamp() ELSE confirmed_at END WHERE id = ?::uuid""", toJson(values), stamp, stamp, id);
                return null;
            });
        return Map.of("ok", true);
    }

    // ---------------------------------------------------------------- helpers
    /** The request's Reason for Change, or the action's own words when none was given. */
    static RequestContext reasonOr(RequestContext ctx, String fallback) {
        return ctx.reason().isEmpty() ? ctx.withReason(fallback) : ctx;
    }

    private String toJson(Object o) {
        try { return json.writeValueAsString(o); } catch (Exception e) { throw new IllegalStateException(e); }
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> map(Object o) { return o instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of(); }

    static List<?> list(Object o) { return o instanceof List<?> l ? l : List.of(); }

    static String str(Object o) { return o == null ? "" : Js.string(o); }

    /** JavaScript's "x || null". */
    static Object or(Object v) { return truthy(v) ? v : null; }

    static boolean truthy(Object v) {
        return v != null && !Boolean.FALSE.equals(v) && !"".equals(v) && !(v instanceof Number n && (n.doubleValue() == 0 || Double.isNaN(n.doubleValue())));
    }

    /** What Node answers for a write without RETURNING: no fields, no rows. */
    static Map<String, Object> noRows() {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("fields", List.of());
        r.put("rows", List.of());
        return r;
    }

    private static Map<String, Object> withId(Map<String, Object> row, String id) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return r;
    }
}
