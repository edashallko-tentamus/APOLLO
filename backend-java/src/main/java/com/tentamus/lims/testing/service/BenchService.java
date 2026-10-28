package com.tentamus.lims.testing.service;

import static com.tentamus.lims.testing.service.TestingValues.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.signature.FailureLimiter;
import com.tentamus.lims.core.signature.PasswordHash;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.testing.repo.TestingRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * The bench: values (new ones under the user's name, changes are corrections with a reason), step fields, equipment and
 * materials for selected entries or the whole batch, raw data files, spiked-sample choice, incubation loads, split-off
 * decisions, the analyst's picks, and the signed step actions (complete with an optional witness, reopen, re-analysis,
 * a new analytical run).
 */
@Service
public class BenchService {
    private static final Map<String, String> USED_TABLES = Map.of("equipment", "entry_equipment", "material", "entry_material", "file", "step_attachment");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final BatchService batches;
    private final TestingRepository repo;
    private final FailureLimiter limiter;
    private final ObjectMapper json;

    public BenchService(Db db, UnitOfWork uow, AccessPolicy access, BatchService batches, TestingRepository repo, FailureLimiter limiter, ObjectMapper json) {
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.batches = batches;
        this.repo = repo;
        this.limiter = limiter;
        this.json = json;
    }

    private Map<String, Object> runOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Step not found");
        Map<String, Object> x = repo.run(id);
        if (x == null) throw new RuleException("Step not found");
        access.checkSite(ctx, (String) x.get("site_id"));
        return x;
    }

    // ---------------------------------------------------------------- values and fields
    /** One row per entry (and analyte and reading); empty cells are not recorded; unchanged ones are skipped. */
    public Map<String, Object> values(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        List<Map<String, Object>> rows = maps(body.get("rows"));
        return uow.run(ctx, d -> {
            int n = 0;
            for (Map<String, Object> x : rows) {
                if (!RequestContext.isUuid(x.get("entry_id"))) throw new RuleException("Unknown entry");
                Object analyte = RequestContext.isUuid(x.get("analyte_id")) ? x.get("analyte_id") : null;
                Object runNo = orOne(x.get("run_no"));
                Object vnum = num(x.get("value_num"));
                if (vnum instanceof Double v && (v.isNaN() || v.isInfinite())) throw new RuleException("Not a number: " + Js.string(x.get("value_num")));
                String vtext = x.get("value_text") == null ? null : Js.string(x.get("value_text"));
                Object given = x.get("data");
                JsonNode data = given instanceof Map<?, ?> || given instanceof List<?> ? json.valueToTree(given) : json.createObjectNode();
                String dataText = toJson(json, data);
                Map<String, Object> old = d.one("""
                    SELECT id, value_num, value_text, data FROM entry_value WHERE step_run_id = ?::uuid AND entry_id = ?::uuid AND analyte_id IS NOT DISTINCT FROM ?::uuid
                       AND run_no = ? AND status = 'Active'""", run.get("id"), x.get("entry_id"), analyte, runNo);
                String text = vtext != null && !vtext.trim().isEmpty() ? vtext : null;
                if (old != null && sameNumber(old.get("value_num"), vnum) && java.util.Objects.equals(old.get("value_text"), text)
                    && sameJson(old.get("data") instanceof JsonNode j ? j : json.createObjectNode(), data)) continue;   // unchanged
                if (old != null) d.update("UPDATE entry_value SET value_num = ?, value_text = ?, data = ?::jsonb WHERE id = ?::uuid", vnum, vtext, dataText, old.get("id"));
                else if (vnum != null || text != null || !"{}".equals(dataText))
                    d.update("INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num, value_text, data) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::jsonb)",
                        run.get("id"), x.get("entry_id"), analyte, runNo, vnum, vtext, dataText);
                else continue;
                n++;
            }
            return kv("saved", n);
        });
    }

    private static boolean sameNumber(Object a, Object b) {
        if (a == null || b == null) return a == b;
        return Js.toNumber(a) == Js.toNumber(b);
    }

    /** The same JSON whatever the key order, numbers compared by value (JavaScript writes 1.0 as 1). */
    private static final Comparator<JsonNode> BY_VALUE = (x, y) -> x.isNumber() && y.isNumber() ? Double.compare(x.doubleValue(), y.doubleValue()) : x.equals(y) ? 0 : 1;

    static boolean sameJson(JsonNode a, JsonNode b) { return a.equals(BY_VALUE, b); }

    public Map<String, Object> fields(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        Object f = body.get("fields") instanceof Map<?, ?> || body.get("fields") instanceof List<?> ? body.get("fields") : Map.of();
        return uow.run(ctx, d -> d.one("UPDATE step_run SET fields = ?::jsonb, notes = COALESCE(?, notes) WHERE id = ?::uuid RETURNING id", toJson(json, f), body.get("notes"), run.get("id")));
    }

    // ---------------------------------------------------------------- equipment, materials, files: for the selected entries, or the whole batch
    public Map<String, Object> equipment(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        if (!RequestContext.isUuid(body.get("equipment_id"))) throw new RuleException("Choose the equipment");
        List<Object> ids = uuids(body.get("entry_ids"));
        Object k = orOne(body.get("analytical_run_no"));   // the analytical run it was used for (reading steps; WD-5)
        return uow.run(ctx, d -> {
            for (Object e : ids.isEmpty() ? java.util.Collections.singletonList(null) : ids) {
                d.update("""
                    UPDATE entry_equipment SET status = 'Inactive' WHERE step_run_id = ?::uuid AND entry_id IS NOT DISTINCT FROM ?::uuid AND status = 'Active' AND analytical_run_no = ?
                       AND equipment_id IN (SELECT id FROM equipment WHERE equipment_type_id = (SELECT equipment_type_id FROM equipment WHERE id = ?::uuid))""",
                    run.get("id"), e, k, body.get("equipment_id"));
                d.update("INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id, analytical_run_no) VALUES (?::uuid, ?::uuid, ?::uuid, ?)", run.get("id"), e, body.get("equipment_id"), k);
            }
            return kv("added", ids.isEmpty() ? 1 : ids.size());
        });
    }

    public Map<String, Object> materials(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        if (!RequestContext.isUuid(body.get("lot_id"))) throw new RuleException("Choose the lot");
        List<Object> ids = uuids(body.get("entry_ids"));
        return uow.run(ctx, d -> {
            for (Object e : ids.isEmpty() ? java.util.Collections.singletonList(null) : ids)
                // a lot with logbook values carries its entry (migration 035): chosen by the database, or by the analyst when there are several
                d.update("INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit, logbook_entry_id) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?, ?, ?::uuid)",
                    run.get("id"), e, body.get("lot_id"), truthy(body.get("purpose")) ? body.get("purpose") : "Reagent", num(body.get("volume")), or(body.get("volume_unit")),
                    RequestContext.isUuid(body.get("logbook_entry_id")) ? body.get("logbook_entry_id") : null);
            return kv("added", ids.isEmpty() ? 1 : ids.size());
        });
    }

    public Map<String, Object> removeUsed(RequestContext ctx, String kind, String id, Map<String, Object> body) {
        String table = USED_TABLES.get(kind);
        if (table == null || !RequestContext.isUuid(id)) throw new RuleException("Not found");
        Map<String, Object> x = db.one("SELECT step_run_id FROM " + table + " WHERE id = ?::uuid", id);
        if (x == null) throw new RuleException("Not found");
        runOf(ctx, (String) x.get("step_run_id"));
        return uow.run(withReason(ctx, body, ""), d -> d.one("UPDATE " + table + " SET status = 'Inactive' WHERE id = ?::uuid RETURNING id", id));
    }

    public Map<String, Object> attach(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        Object content = body.get("content_base64");
        if (!truthy(content)) throw new RuleException("Choose the file to attach");
        if (Js.string(content).length() > 28_000_000) throw new RuleException("The file is too large (20 MB at most)");
        String name = truthy(body.get("file_name")) ? Js.string(body.get("file_name")) : "raw-data";
        return uow.run(ctx, d -> {
            Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, 0, '', decode(?, 'base64')) RETURNING id",
                name.substring(0, Math.min(200, name.length())), truthy(body.get("mime_type")) ? body.get("mime_type") : "application/octet-stream", content).get("id");
            return d.one("INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) VALUES (?::uuid, ?::uuid, ?, ?) RETURNING id",
                run.get("id"), doc, or(body.get("label")), orOne(body.get("analytical_run_no")));
        });
    }

    public Map<String, Object> attachmentFile(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("File not found");
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, b.site_id FROM step_attachment a JOIN document_file f ON f.id = a.document_id
              JOIN step_run r ON r.id = a.step_run_id JOIN test_batch b ON b.id = r.batch_id WHERE a.id = ?::uuid""", id);
        if (d == null) throw new RuleException("File not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        return d;
    }

    public Map<String, Object> parent(RequestContext ctx, String entryId, Map<String, Object> body) {
        if (!RequestContext.isUuid(entryId)) throw new RuleException("Entry not found");
        Map<String, Object> e = db.one("SELECT batch_id FROM batch_entry WHERE id = ?::uuid", entryId);
        if (e == null) throw new RuleException("Entry not found");
        batches.batchOf(ctx, (String) e.get("batch_id"));
        return uow.run(withReason(ctx, body, "Spiked sample chosen"),
            d -> d.one("UPDATE batch_entry SET parent_entry_id = ?::uuid WHERE id = ?::uuid RETURNING id", or(body.get("parent_entry_id")), entryId));
    }

    // ---------------------------------------------------------------- incubation loads (WD-4)
    public Map<String, Object> addLoad(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        if (!RequestContext.isUuid(body.get("equipment_id"))) throw new RuleException("Choose the incubator");
        List<Object> ids = uuids(body.get("entry_ids"));
        String in = when(truthy(body.get("time_in")) ? body.get("time_in") : "now"), out = when(body.get("time_out"));
        return uow.run(ctx, d -> d.one("""
            INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature, note) VALUES (?::uuid, ?::uuid, ?::uuid[], ?, ?, ?, ?) RETURNING id""",
            run.get("id"), body.get("equipment_id"), ids.isEmpty() ? null : ids, in, out, num(body.get("temperature")), or(body.get("note"))));
    }

    public Map<String, Object> changeLoad(RequestContext ctx, String id, Map<String, Object> b) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Load not found");
        Map<String, Object> l = db.one("SELECT step_run_id FROM incubation_load WHERE id = ?::uuid", id);
        if (l == null) throw new RuleException("Load not found");
        runOf(ctx, (String) l.get("step_run_id"));
        List<String> sets = new ArrayList<>();
        List<Object> vals = new ArrayList<>();
        if (b.containsKey("time_in")) { sets.add("time_in = ?"); vals.add(when(b.get("time_in"))); }
        if (b.containsKey("time_out")) { sets.add("time_out = ?"); vals.add(when(b.get("time_out"))); }
        if (b.containsKey("temperature")) { sets.add("temperature = ?"); vals.add(num(b.get("temperature"))); }
        if (b.containsKey("note")) { sets.add("note = ?"); vals.add(or(b.get("note"))); }
        if (truthy(b.get("remove"))) { sets.add("status = ?"); vals.add("Inactive"); }
        if (sets.isEmpty()) return ok();
        vals.add(id);
        return uow.run(ctx, d -> d.one("UPDATE incubation_load SET " + String.join(", ", sets) + " WHERE id = ?::uuid RETURNING id", vals.toArray()));
    }

    // ---------------------------------------------------------------- split-off requests (WD-4): the customer's decision
    public Map<String, Object> splitRequests(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("rows", db.rows("""
            SELECT q.* FROM split_request_view q WHERE q.site_id = ?::uuid AND q.status IN ('Awaiting consent','Consent given','To order')
               AND NOT EXISTS (SELECT 1 FROM test_batch b WHERE b.id = q.batch_id AND b.is_verification) ORDER BY q.created_at""", site));
        out.put("can_decide", access.has(ctx, "orders.edit"));
        return out;
    }

    public Map<String, Object> decideSplit(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Request not found");
        Map<String, Object> x = db.one("SELECT site_id FROM split_request_view WHERE id = ?::uuid", id);
        if (x == null) throw new RuleException("Request not found");
        access.checkSite(ctx, (String) x.get("site_id"));
        return uow.run(withReason(ctx, body, "Customer decision on a split-off test"), d -> {
            d.one("SELECT decide_split_request(?::uuid, ?, ?)", id, body.get("decision"), truthy(body.get("note")) ? body.get("note") : "");
            return ok();
        });
    }

    // ---------------------------------------------------------------- signed actions
    /** The witness types their own user ID and password in the same dialog; both signatures go on the step. */
    private Map<String, Object> checkWitness(RequestContext ctx, Object given) {
        Map<String, Object> w = map(given);
        if (!truthy(w.get("username")) || !truthy(w.get("password"))) throw new RuleException("The witness enters their user ID and password.");
        limiter.check(ctx.ip());
        Map<String, Object> u = db.one("SELECT * FROM app_user WHERE lower(username) = lower(?) AND username <> 'system'", Js.string(w.get("username")).trim());
        if (u == null || !Boolean.TRUE.equals(u.get("is_active")) || u.get("password_hash") == null) {
            limiter.note(ctx.ip());
            throw new RuleException("The witness user ID or password is not correct.");
        }
        if (u.get("locked_at") != null) throw new RuleException("The witness account is locked. Ask an administrator to unlock it.");
        if (u.get("id").equals(ctx.userId())) throw new RuleException("The witness must be someone else.");
        if (!new PasswordHash((String) u.get("password_hash")).matches(Js.string(w.get("password")))) {
            limiter.note(ctx.ip());
            int n = (u.get("failed_attempts") == null ? 0 : ((Number) u.get("failed_attempts")).intValue()) + 1;
            db.update("UPDATE app_user SET failed_attempts = ?::int, locked_at = CASE WHEN ?::int >= 5 THEN clock_timestamp() ELSE locked_at END WHERE id = ?::uuid", n, n, u.get("id"));
            throw new RuleException("The witness user ID or password is not correct. Nothing was signed.");
        }
        if (truthy(u.get("failed_attempts"))) db.update("UPDATE app_user SET failed_attempts = 0 WHERE id = ?::uuid", u.get("id"));
        return u;
    }

    public Map<String, Object> complete(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        Map<String, Object> witness = truthy(body.get("witness")) ? checkWitness(ctx, body.get("witness")) : null;
        String what = run.get("step_name") + " of " + run.get("batch_code");
        return batches.signed(withReason(ctx, body, "Step completed"), body, "Performed by", what, d -> {
            Object wsig = witness == null ? null : d.one("SELECT sign_witness(?::uuid, ?) AS id", witness.get("id"), "Witnessed: " + what).get("id");
            d.one("SELECT complete_step(?::uuid, ?::uuid)", run.get("id"), wsig);
            return ok();
        });
    }

    public Map<String, Object> reopen(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        if (str(body.get("reason")).trim().isEmpty()) throw new RuleException("Say why the step is reopened");
        return batches.signed(ctx, body, "Reopened by", run.get("step_name") + " of " + run.get("batch_code"), d -> { d.one("SELECT reopen_step(?::uuid)", run.get("id")); return ok(); });
    }

    private static String entries(int n) { return n + " entr" + (n == 1 ? "y" : "ies"); }

    public Map<String, Object> reanalysis(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        List<Object> ids = uuids(body.get("entry_ids"));
        if (ids.isEmpty()) throw new RuleException("Select the samples to re-analyse");
        Object runs = jsNumber(body, "runs");
        return batches.signed(ctx, body, "Requested by", "Re-analysis (" + replicateWord(runs) + ") of " + entries(ids.size()) + " in " + run.get("batch_code"),
            d -> kv("n", d.one("SELECT request_reanalysis(?::uuid, ?::uuid[], ?) AS n", run.get("id"), ids, runs).get("n")));
    }

    /** Add an analytical run (WD-5): the chosen samples read again, optionally diluted further (aliquot + diluent, 0.27.0). */
    public Map<String, Object> addRun(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> run = runOf(ctx, id);
        List<Object> ids = uuids(body.get("entry_ids"));
        if (ids.isEmpty()) throw new RuleException("Choose the samples to read again in the new run");
        Object reps = jsNumber(body, "replicates");
        Object a = body.get("aliquot");
        Object al = a == null || "".equals(a) ? null : whole(Js.toNumber(a));
        Object dil = al == null ? null : whole(truthy(body.get("diluent")) ? Js.toNumber(body.get("diluent")) : 0);
        if (al != null && !(Js.toNumber(al) > 0)) throw new RuleException("A further dilution needs an aliquot above zero");
        String further = al == null ? "" : ", diluted further " + Js.string(al) + " + " + Js.string(dil);
        return batches.signed(ctx, body, "Requested by", "New analytical run (" + replicateWord(reps) + ") of " + entries(ids.size()) + " at " + run.get("step_name") + " of "
            + run.get("batch_code") + further,
            d -> kv("run_no", d.one("SELECT add_analytical_run_diluted(?::uuid, ?::uuid[], ?, ?, ?) AS k", run.get("id"), ids, reps, al, dil).get("k")));
    }

    /** The analyst's pick of the reading reported for a sample (all its analytes, or one), with a note (migration 048). */
    public Map<String, Object> pick(RequestContext ctx, String entryId, Map<String, Object> body) {
        if (!RequestContext.isUuid(entryId)) throw new RuleException("Entry not found");
        Map<String, Object> e = db.one("SELECT e.id, b.site_id FROM batch_entry e JOIN test_batch b ON b.id = e.batch_id WHERE e.id = ?::uuid", entryId);
        if (e == null) throw new RuleException("Entry not found");
        access.checkSite(ctx, (String) e.get("site_id"));
        return uow.run(atLab(withReason(ctx, body, "Reading picked by the analyst"), e.get("site_id")), d -> {
            d.one("SELECT set_analyst_pick(?::uuid, ?, ?::uuid, ?)", e.get("id"), jsNumber(body, "run_no"), RequestContext.isUuid(body.get("analyte_id")) ? body.get("analyte_id") : null,
                truthy(body.get("note")) ? body.get("note") : "");
            return ok();
        });
    }

    public Map<String, Object> clearPick(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Pick not found");
        Map<String, Object> p = db.one("SELECT p.id, b.site_id FROM analyst_pick p JOIN test_batch b ON b.id = p.batch_id WHERE p.id = ?::uuid", id);
        if (p == null) throw new RuleException("Pick not found");
        access.checkSite(ctx, (String) p.get("site_id"));
        return uow.run(atLab(withReason(ctx, body, "Analyst's pick taken off"), p.get("site_id")), d -> { d.one("SELECT clear_analyst_pick(?::uuid)", p.get("id")); return ok(); });
    }

    /** The record's own lab as the lab worked in (lims.site_id), as the Node backend does for picks. */
    private static RequestContext atLab(RequestContext ctx, Object site) {
        return new RequestContext(ctx.userId(), (String) site, (String) site, ctx.reason(), ctx.ip());
    }
}
