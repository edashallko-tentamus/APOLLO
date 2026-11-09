package com.tentamus.lims.inventory.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.PgArrays;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.signature.SignatureService.Meaning;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.inventory.bulk.BulkKind;
import com.tentamus.lims.inventory.bulk.BulkKinds;
import com.tentamus.lims.inventory.bulk.BulkSheet;
import com.tentamus.lims.inventory.domain.InventoryMessages;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.repo.LotRepository;
import com.tentamus.lims.inventory.repo.UnitRepository;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Excel export and upload of the inventory lists and the Units lists. An upload is first previewed (every change and
 * every error per row), then applied in one signed transaction; the first refused row stops it, so nothing is half saved.
 */
@Service
public class BulkService {
    private static final long MAX_FILE = 10L * 1024 * 1024;
    private final Db db;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final LotRepository lots;
    private final LotWriter lotWriter;
    private final ListRowRules rules;
    private final UnitRepository unitRepo;
    private final LabClock clock;

    public BulkService(Db db, AccessPolicy access, SignatureService signatures, LotRepository lots, LotWriter lotWriter, ListRowRules rules,
                       UnitRepository unitRepo, LabClock clock) {
        this.db = db;
        this.access = access;
        this.signatures = signatures;
        this.lots = lots;
        this.lotWriter = lotWriter;
        this.rules = rules;
        this.unitRepo = unitRepo;
        this.clock = clock;
    }

    public static BulkKind kind(String name) {
        BulkKind k = BulkKinds.KINDS.get(name);
        if (k == null) throw new RuleException("Unknown list");
        return k;
    }

    private List<Map<String, Object>> current(RequestContext ctx, BulkKind k) {
        return PgArrays.fix(k.siteScoped() ? db.rows(k.list(), access.currentSite(ctx)) : db.rows(k.list()));
    }

    /** The file and its name: "<lab> <list> <date>.xlsx". */
    public record Export(byte[] file, String fileName) {}

    public Export export(RequestContext ctx, String name, Map<String, Object> body) {
        BulkKind k = kind(name);
        List<Map<String, Object>> rows = current(ctx, k);
        if (body.get("ids") instanceof List<?> ids && !ids.isEmpty()) rows = rows.stream().filter(r -> ids.contains(r.get("id"))).toList();
        if (LotService.truthy(body.get("template"))) rows = List.of();
        String site = "";
        if (k.siteScoped()) {
            Map<String, Object> s = db.one("SELECT site_code FROM lab_site WHERE id = ?::uuid", ctx.siteId());
            site = (s == null ? "null" : s.get("site_code")) + " ";
        }
        String stamp = LocalDate.now(ZoneOffset.UTC).toString();
        return new Export(new BulkSheet(k).export(rows), (site + k.title()).replaceAll("[^\\w\\- ]", "") + " " + stamp + ".xlsx");
    }

    public Map<String, Object> preview(RequestContext ctx, String name, Map<String, Object> body) {
        BulkKind k = kind(name);
        if (name.equals("lots")) requireUpload(ctx);
        String site = k.siteScoped() ? access.currentSite(ctx) : null;
        BulkSheet.Preview p = new BulkSheet(k).preview(db, current(ctx, k), file(body), LotService.str(body.get("file_name")), site);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", p.rows().stream().map(BulkSheet.Row::shown).toList());
        out.put("unknownHeaders", p.unknownHeaders());
        out.put("total", p.total());
        return out;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> apply(RequestContext ctx, String name, Map<String, Object> body) {
        BulkKind k = kind(name);
        if (name.equals("lots")) requireUpload(ctx);
        String site = k.siteScoped() ? access.currentSite(ctx) : null;
        BulkSheet.Preview p = new BulkSheet(k).preview(db, current(ctx, k), file(body), LotService.str(body.get("file_name")), site);
        List<BulkSheet.Row> bad = p.rows().stream().filter(x -> x.action().equals("Error")).toList();
        if (!bad.isEmpty()) throw new RuleException("Fix the " + bad.size() + " row" + (bad.size() == 1 ? "" : "s") + " with errors first (row "
            + bad.get(0).row() + ": " + bad.get(0).errors().get(0) + ")");
        List<BulkSheet.Row> todo = p.rows().stream().filter(x -> x.action().equals("Create") || x.action().equals("Update")).toList();
        if (todo.isEmpty()) return counts(0, 0);
        Units units = unitRepo.load();
        LotWriter.Save save = new LotWriter.Save(units, clock.today(site), null, ctx, false);
        return signatures.signed(ctx, body, new Meaning("Uploaded by", "Excel upload to " + k.title() + ": " + todo.size() + " row(s)", k.module()), d -> {
            int created = 0, updated = 0;
            for (BulkSheet.Row x : todo) {
                Map<String, Object> payload = new LinkedHashMap<>(x.payload());
                Object analytes = payload.remove("__analytes");
                Object owners = payload.remove("__owners");
                Object id = payload.get("id");
                try {
                    Map<String, Object> fixed = k.siteScoped() && id == null ? Map.of("site_id", site) : Map.of();
                    Object rowId = id;
                    if (payload.keySet().stream().anyMatch(f -> !f.equals("id")) || id == null) {
                        Map<String, Object> res;
                        if (name.equals("lots")) res = lotWriter.save(d, k.writer(), payload, fixed, save);
                        else {
                            Map<String, Object> checked = ListRowRules.CHECKED.contains(name) ? rules.forKind(name, d, payload, k.writer().pick(payload), site) : payload;
                            List<Map<String, Object>> r = k.writer().upsert(d, List.of(checked), fixed);
                            res = r.isEmpty() ? null : r.get(0);
                        }
                        if (res != null && res.get("id") != null) rowId = res.get("id");
                    }
                    if (analytes != null) lots.syncAnalytes(d, rowId, (List<Map<String, Object>>) analytes, units);
                    if (name.equals("lots") && rowId != null) lotWriter.assertAnalyteNamed(d, rowId.toString());
                    if (owners != null && k.afterRow() != null) k.afterRow().apply(d, rowId, owners);
                    if (id != null) updated++; else created++;
                } catch (RuntimeException e) {
                    throw InventoryMessages.forRow(e, x.row(), x.key());
                }
            }
            return counts(created, updated);
        });
    }

    private void requireUpload(RequestContext ctx) { access.require(ctx, "inventory.upload", "upload the inventory list from Excel"); }

    private static byte[] file(Map<String, Object> body) {
        if (!LotService.truthy(body.get("content_base64"))) throw new RuleException("Choose the Excel file to upload");
        byte[] buf = Base64.getMimeDecoder().decode(body.get("content_base64").toString());
        if (buf.length > MAX_FILE) throw new RuleException("The file is larger than 10 MB");
        return buf;
    }

    private static Map<String, Object> counts(int created, int updated) {
        Map<String, Object> o = new LinkedHashMap<>();
        o.put("created", created);
        o.put("updated", updated);
        return o;
    }
}
