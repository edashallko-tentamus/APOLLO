package com.tentamus.lims.verification.service;

import static com.tentamus.lims.verification.domain.JsValues.map;
import static com.tentamus.lims.verification.domain.JsValues.str;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.verification.domain.Analyte;
import com.tentamus.lims.verification.domain.Calculation;
import com.tentamus.lims.verification.domain.Design;
import com.tentamus.lims.verification.domain.JsValues;
import com.tentamus.lims.verification.domain.Rational;
import com.tentamus.lims.verification.domain.Step;
import com.tentamus.lims.verification.repo.DesignRepository;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.postgresql.util.PSQLException;

/**
 * The automated run of an approved protocol (verification.js execute), inside the caller's one signed transaction: the
 * automated accounts (Verification analyst, witness, reviewer) do the work through the same database functions and rules
 * the bench and review screens use, and each check records what the system produced. A check the run cannot reach is
 * Not tested, with the reason. shortcut: the run is one long script of SQL calls, kept here rather than split into a
 * repository, because each call is a step of the procedure the protocol describes.
 */
final class AutomatedRun {
    private static final DateTimeFormatter ISO = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);
    private static final Map<String, String> USERS = new LinkedHashMap<>();
    static { USERS.put("analyst", "verify.analyst"); USERS.put("witness", "verify.witness"); USERS.put("reviewer", "verify.reviewer"); }
    private final Db t;
    private final String verificationId;
    private final List<Map<String, Object>> log;
    private final DesignRepository designs;
    private int sp = 0;

    AutomatedRun(Db t, String verificationId, List<Map<String, Object>> log, DesignRepository designs) {
        this.t = t; this.verificationId = verificationId; this.log = log; this.designs = designs;
    }

    static String iso(Instant i) { return ISO.format(i.truncatedTo(ChronoUnit.MILLIS)); }

    /** What a refused database call says (the message only, as the Node client gave it). */
    static String message(Throwable e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg != null && pg.getServerErrorMessage() != null && pg.getServerErrorMessage().getMessage() != null) return pg.getServerErrorMessage().getMessage();
        return String.valueOf(e.getMessage());
    }

    /** One try inside a savepoint: kept when it works, rolled back when it fails. */
    record Try(boolean ok, Object value, String error) {}

    private Try attempt(Supplier<Object> fn) {
        sp += 1;
        String name = "v" + sp;
        t.update("SAVEPOINT " + name);
        try {
            Object v = fn.get();
            t.update("RELEASE SAVEPOINT " + name);
            return new Try(true, v, null);
        } catch (RuntimeException e) {
            t.update("ROLLBACK TO SAVEPOINT " + name);
            t.update("RELEASE SAVEPOINT " + name);
            return new Try(false, null, message(e));
        }
    }

    private void say(String who, String action, String detail) {
        Map<String, Object> l = new LinkedHashMap<>();
        l.put("at", iso(Instant.now())); l.put("who", who); l.put("action", action); l.put("detail", detail);
        log.add(l);
    }

    private Map<String, Map<String, Object>> users = new LinkedHashMap<>();
    private String executor;

    private void as(String who) { t.one("SELECT set_config('lims.user_id', ?, true)", who.equals("executor") ? executor : users.get(who).get("id")); }

    private void reason(String r) { t.one("SELECT set_config('lims.reason', ?, true)", r == null ? "" : r); }

    private Object sign(String meaning, String action) { return t.one("SELECT sign_action(?, ?, ?, NULL) AS id", meaning, action, "Testing").get("id"); }

    // results gathered per check (a check can span several batches)
    private static final class Res { final List<String> results = new ArrayList<>(); final List<Object> actual = new ArrayList<>(); final List<String> notes = new ArrayList<>(); Object batch, evidence; }
    private final Map<String, Res> res = new LinkedHashMap<>();

    private void put(Object code, String result, Object actual, String note, Object batchId, String evidence) {
        Res o = res.computeIfAbsent(str(code), k -> new Res());
        o.results.add(result);
        if (actual != JsValues.UNDEFINED) o.actual.add(actual);
        if (note != null && !note.isEmpty()) o.notes.add(note);
        if (!Js.truthy(o.batch) && Js.truthy(batchId)) o.batch = batchId;
        if (!Js.truthy(o.evidence) && evidence != null && !evidence.isEmpty()) o.evidence = evidence;
    }

    private List<Map<String, Object>> checks;

    private static Map<String, Object> in(Map<String, Object> c) { return map(c.get("inputs")); }

    private static Map<String, Object> exp(Map<String, Object> c) { return map(c.get("expected")); }

    private List<Map<String, Object>> byKind(String kind, Predicate<Map<String, Object>> f) {
        return checks.stream().filter(c -> kind.equals(in(c).get("kind")) && f.test(c)).toList();
    }

    private Map<String, Object> one(String kind, Predicate<Map<String, Object>> f) { List<Map<String, Object>> l = byKind(kind, f); return l.isEmpty() ? null : l.get(0); }

    private Map<String, Object> one(String kind) { return one(kind, c -> true); }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static boolean eq(Object a, Object b) { return Objects.equals(a, b); }

    private static int intOf(Object v) { return v instanceof Number n ? n.intValue() : (int) Js.toNumber(v); }

    // ------------------------------------------------------------ the run
    private Design D;
    private Map<String, Object> plan;
    private String site;
    private Map<String, Object> typical;

    private Map<String, Object> usable(String stepKey) {
        Step s = D.byKey.get(stepKey);
        if (s.equipment.isEmpty()) return null;
        List<Object> types = s.equipment.stream().map(x -> x.get("equipment_type_id")).toList();
        return t.one("""
            SELECT e.id, e.equipment_code, e.equipment_name, e.type_name FROM equipment_view e
              WHERE e.site_id = ?::uuid AND e.equipment_type_id = ANY(?::uuid[]) AND e.availability = 'Available' AND e.calibration_status IS DISTINCT FROM 'Deficient'
              ORDER BY array_position(?::uuid[], e.equipment_type_id), e.equipment_code LIMIT 1""", site, types, types);
    }

    private Map<String, Object> lotFor(String purpose, List<String> analyteIds, Object hint) {
        List<Map<String, Object>> rows = t.rows("""
            SELECT l.id, l.lot_code, l.item_name, l.unit, l.physical_form::text AS form, l.chemical_types,
                (SELECT count(*) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active' AND la.analyte_id = ANY(?::uuid[]))::int AS covers,
                (SELECT count(*) FROM lot_analyte la WHERE la.lot_id = l.id AND la.status = 'Active')::int AS names
              FROM inventory_lot l WHERE l.site_id = ?::uuid AND l.receipt_status::text = 'Received' AND l.status::text = 'Available'
                AND (l.expiration_date IS NULL OR l.expiration_date >= site_today(l.site_id)) AND (l.retest_date IS NULL OR l.retest_date >= site_today(l.site_id))
                AND lot_qa_problem(l.id, ?::uuid) IS NULL""", analyteIds, site, D.version.testId());
        List<Map<String, Object>> c;
        if (purpose.equals("Strain")) c = rows.stream().filter(r -> JsValues.pgList(r.get("chemical_types")).contains("Microbiological Strain") && (intOf(r.get("names")) == 0 || intOf(r.get("covers")) > 0)).toList();
        else if (purpose.equals("Media")) c = rows.stream().filter(r -> JsValues.pgList(r.get("chemical_types")).contains("Media")).toList();
        else c = rows.stream().filter(r -> intOf(r.get("covers")) > 0 && (JsValues.pgList(r.get("chemical_types")).contains("Reference Standard") || JsValues.pgList(r.get("chemical_types")).contains("In-house mixture"))).toList();
        c = new ArrayList<>(c);
        if (Js.truthy(hint)) {
            String h = str(hint).toLowerCase();
            c.sort(Comparator.comparingLong((Map<String, Object> r) -> -java.util.Arrays.stream(str(Js.orBlank(r.get("item_name"))).toLowerCase().split("[^a-z0-9]+"))
                .filter(x -> x.length() > 2 && h.contains(x)).count()));
        }
        c.sort(Comparator.comparingInt((Map<String, Object> r) -> -intOf(r.get("covers"))));
        return c.isEmpty() ? null : c.get(0);
    }

    private Map<String, Object> amount(Map<String, Object> lot, String wanted) {
        for (String[] vu : new String[][] {{wanted, "mL"}, {"1", (String) lot.get("unit")}}) {
            Map<String, Object> ok = t.one("SELECT unit_factor(?, ?, ?) IS NOT NULL AS ok", vu[1], lot.get("unit"), lot.get("form"));
            if (ok != null && Boolean.TRUE.equals(ok.get("ok"))) return m("volume", vu[0], "unit", vu[1]);
        }
        return m("volume", "1", "unit", lot.get("unit"));
    }

    private record Batch(String id, String code, List<Map<String, Object>> entries) {}

    private Map<String, Object> stepRun(String batchId, String key) {
        return t.one("SELECT r.* FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id WHERE r.batch_id = ?::uuid AND ws.step_key = ? AND ws.status = 'Active'", batchId, key);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> sampleInputs(Map<String, Object> e) {
        for (Object o : JsValues.list(plan.get("samples"))) { Map<String, Object> s = (Map<String, Object>) o; if (eq(s.get("key"), e.get("sample_key"))) return map(s.get("inputs")); }
        return typical;
    }

    private static Object read(Map<String, Object> inputs, String part, String step) {
        Object p = map(inputs.get(part)).get(step);
        return p;
    }

    private static boolean worksOn(Map<String, Object> e) { return e.get("daily_of_entry_id") == null && ("Sample".equals(e.get("entry_type")) || "Prep".equals(e.get("qc_class"))); }

    private Try completeStep(Batch b, Step s, Map<String, Object> r) {
        String what = s.name + " of " + b.code();
        return attempt(() -> {
            reason("Step completed");
            sign("Performed by", what);
            Object wsig = null;
            if (s.witnessRequired()) wsig = t.one("SELECT sign_witness(?::uuid, ?) AS id", users.get("witness").get("id"), "Witnessed: " + what).get("id");
            t.rows("SELECT complete_step(?::uuid, ?::uuid)", r.get("id"), wsig);
            reason("Workflow verification run");
            return null;
        });
    }

    /** Runs the protocol; returns {batches, blocked}. */
    Map<String, Object> execute() {
        Map<String, Object> w = t.one("SELECT * FROM workflow_verification WHERE id = ?::uuid", verificationId);
        D = designs.load(t, str(w.get("test_version_id")));
        plan = map(w.get("plan"));
        checks = new ArrayList<>();
        for (Map<String, Object> c : t.rows("SELECT * FROM verification_check WHERE verification_id = ?::uuid ORDER BY sort_order", verificationId)) {
            Map<String, Object> x = new LinkedHashMap<>(c);
            x.put("inputs", map(c.get("inputs")));
            x.put("expected", map(c.get("expected")));
            checks.add(x);
        }
        for (Map.Entry<String, String> u : USERS.entrySet()) users.put(u.getKey(), t.one("SELECT id, full_name FROM app_user WHERE username = ?", u.getValue()));
        executor = str(t.one("SELECT current_setting('lims.user_id', true) AS id").get("id"));
        List<Object> planSamples = JsValues.list(plan.get("samples"));

        // ---- the order and its samples
        List<Object> spec = new ArrayList<>();
        for (Object o : planSamples) { Map<String, Object> s = map(o); spec.add(m("key", s.get("key"), "description", s.get("description"), "specs", s.get("specs"))); }
        Map<String, Object> setup = map(t.one("SELECT start_verification_run(?::uuid, ?::jsonb) AS x", verificationId, JsValues.json(spec)).get("x"));
        Map<String, Map<String, Object>> samples = new LinkedHashMap<>();
        List<String> codes = new ArrayList<>();
        for (Object o : JsValues.list(setup.get("samples"))) { Map<String, Object> s = map(o); samples.put(str(s.get("key")), s); codes.add(str(s.get("sample_code"))); }
        say("executor", "Started the run (signed \"Executed by\")", samples.size() + " samples ordered and logged: " + String.join(", ", codes));
        site = str(w.get("site_id"));
        typical = map(map(planSamples.get(0)).get("inputs"));

        // ---- batches
        as("analyst");
        reason("Workflow verification run");
        List<Batch> batches = new ArrayList<>();
        for (int i = 0; i < 20; i += 1) {
            Map<String, Object> left = t.one("SELECT count(*)::int AS n FROM test_pool_view WHERE site_id = ?::uuid AND test_version_id = ?::uuid", site, w.get("test_version_id"));
            if (intOf(left.get("n")) == 0) break;
            Try b = attempt(() -> t.one("SELECT create_batch(?::uuid, ?::uuid) AS id", site, w.get("test_version_id")).get("id"));
            if (!b.ok()) { say("analyst", "Could not make a batch", b.error()); break; }
            String id = str(b.value());
            Map<String, Object> info = t.one("SELECT batch_code FROM test_batch WHERE id = ?::uuid", id);
            List<Map<String, Object>> ents = t.rows("""
                SELECT e.*, s.client_sample_id AS sample_key FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
                 WHERE e.batch_id = ?::uuid AND e.status = 'Active' ORDER BY e.position""", id);
            batches.add(new Batch(id, str(info.get("batch_code")), ents));
            say("analyst", "Made batch " + info.get("batch_code") + " from the backlog", String.join(", ", ents.stream().map(e -> str(Js.orBlank(e.get("label")))).toList()));
        }
        {
            Map<String, Object> c = one("batches");
            List<Object> expd = JsValues.list(exp(c).get("batches"));
            List<Object> got = new ArrayList<>();
            boolean same = batches.size() == expd.size();
            List<String> texts = new ArrayList<>();
            for (int i = 0; i < batches.size(); i++) {
                List<Object> smp = new ArrayList<>(), qc = new ArrayList<>();
                for (Map<String, Object> e : batches.get(i).entries()) {
                    if ("Sample".equals(e.get("entry_type"))) smp.add(e.get("sample_key"));
                    if ("QC".equals(e.get("entry_type"))) qc.add(e.get("label"));
                }
                got.add(m("samples", smp, "qc", qc));
                if (same) {
                    Map<String, Object> x = map(expd.get(i));
                    List<Object> normQc = qc.stream().map(q -> (Object) (q == null ? null : str(q).replaceAll(" \\(daily, from .*\\)$", " (daily, from the first batch)"))).toList();
                    same = sorted(smp).equals(sorted(JsValues.list(x.get("samples")))) && sorted(normQc).equals(sorted(JsValues.list(x.get("qc"))));
                }
                texts.add(batches.get(i).code() + ": " + joinJs(smp, ", ") + (!qc.isEmpty() ? " with " + joinJs(qc, ", ") : ""));
            }
            String text = String.join("; ", texts);
            put(c.get("check_code"), same ? "Pass" : "Fail", m("text", text.isEmpty() ? "No batch was made" : text, "batches", got),
                same ? null : "The batches differ from the protocol", batches.isEmpty() ? null : batches.get(0).id(), batches.isEmpty() ? null : "#/testing/batches/" + batches.get(0).id());
        }
        List<Step> tps = D.timepointSteps();
        Map<String, String> blocked = new LinkedHashMap<>();
        boolean refusedOnce = false;

        for (Batch b : batches) {
            List<Map<String, Object>> entries = b.entries();
            for (Step s : D.order) {
                if (blocked.containsKey(b.id())) break;
                if (s.is("QC Review")) {
                    // a timepoint review is released as soon as the steps before it are done; the final review comes last
                    if (!tps.contains(s)) continue;
                    as("reviewer");
                    Map<String, Object> r = stepRun(b.id(), s.key);
                    for (String k : s.ancestors) {
                        if (D.byKey.get(k).is("QC Review")) continue;
                        Map<String, Object> rr = stepRun(b.id(), k);
                        Try mk = attempt(() -> { reason("Step approved in QC Review"); t.rows("SELECT approve_review_step(?::uuid)", nullId(rr)); return null; });
                        if (!mk.ok()) say("reviewer", "Could not approve " + D.byKey.get(k).name, mk.error());
                    }
                    Try rel = attempt(() -> {
                        reason("Timepoint reviewed: preliminary results released");
                        sign("Reviewed by", s.name + " of " + b.code() + ": release preliminary results");
                        return t.one("SELECT release_timepoint(?::uuid) AS n", nullId(r)).get("n");
                    });
                    say("reviewer", "Released " + s.name + " of " + b.code(), rel.ok() ? JsValues.number(rel.value()) + " preliminary results" : rel.error());
                    for (Map<String, Object> c : byKind("timepoint", x -> eq(in(x).get("step_key"), s.key))) {
                        Map<String, Object> smp = samples.get(str(c.get("sample_key")));
                        if (entries.stream().noneMatch(e -> eq(e.get("sample_key"), c.get("sample_key")))) continue;
                        String ev = "#/testing/batches/" + b.id() + "?step=" + s.key;
                        if (!rel.ok()) { put(c.get("check_code"), "Fail", m("text", "Not released: " + rel.error()), rel.error(), b.id(), ev); continue; }
                        Map<String, Object> tr = t.one("SELECT value_num::text AS value, reported, stage FROM test_result WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key = ? AND status = 'Active'",
                            smp == null ? null : smp.get("requested_test_id"), in(c).get("analyte_id"), in(c).get("result_key"));
                        boolean ok = tr != null && Calculation.close(tr.get("value"), exp(c).get("value")) && eq(tr.get("reported"), exp(c).get("reported")) && "Preliminary".equals(tr.get("stage"));
                        put(c.get("check_code"), ok ? "Pass" : "Fail", m("text", tr != null ? tr.get("reported") + " (" + tr.get("stage") + "; unrounded " + tr.get("value") + ")" : "No stored result",
                            "value", tr == null ? null : tr.get("value"), "reported", tr == null ? null : tr.get("reported"), "stage", tr == null ? null : tr.get("stage")),
                            ok ? null : "Differs from the expected result", b.id(), ev);
                    }
                    as("analyst");
                    continue;
                }
                Map<String, Object> r = stepRun(b.id(), s.key);
                String ev = "#/testing/batches/" + b.id() + "?step=" + s.key;
                List<Map<String, Object>> work = entries.stream().filter(AutomatedRun::worksOn).toList();
                // the negative check: completing before the data are in is refused
                Map<String, Object> neg = one("refuse_incomplete", c -> eq(in(c).get("step_key"), s.key));
                if (neg != null && !refusedOnce) {
                    refusedOnce = true;
                    Try x = attempt(() -> { reason("Step completed"); sign("Performed by", s.name + " of " + b.code()); t.rows("SELECT complete_step(?::uuid, NULL)", nullId(r)); return null; });
                    boolean ok = !x.ok() && x.error().contains("cannot be completed yet");
                    put(neg.get("check_code"), ok ? "Pass" : "Fail", m("text", x.ok() ? "The step was completed with its data missing" : "Refused: " + x.error()), ok ? null : "Not refused as expected", b.id(), ev);
                    reason("Workflow verification run");
                    if (x.ok()) { blocked.put(b.id(), "The step was completed without data"); break; }
                }
                List<String> problems = new ArrayList<>();
                Map<String, Object> eq = usable(s.key);
                String eqTypes = String.join(" or ", s.equipment.stream().map(x -> str(x.get("type_name"))).toList());
                switch (s.type) {
                    case "Batching" -> {
                        for (Map<String, Object> e : entries) {
                            if (!List.of("Matrix Spike", "Matrix Spike Duplicate").contains(e.get("qc_type")) || Js.truthy(e.get("parent_entry_id")) || e.get("daily_of_entry_id") != null) continue;
                            Map<String, Object> first = entries.stream().filter(x -> "Sample".equals(x.get("entry_type"))).findFirst().orElse(null);
                            run(problems, "Spiked sample of " + e.get("label"), () -> {
                                reason("Spiked sample chosen");
                                t.update("UPDATE batch_entry SET parent_entry_id = ?::uuid WHERE id = ?::uuid", nullId(first), e.get("id"));
                                reason("Workflow verification run");
                            });
                        }
                    }
                    case "Weighing" -> {
                        // replicate weighings (033): the planned weight for each one, so their average is the planned weight
                        for (Map<String, Object> e : work) {
                            double reps = Math.max(1, Math.min(10, JsValues.numOr(s.cfg("replicates"), 1)));
                            for (int k = 1; k <= reps; k++) {
                                final int kk = k;
                                Object wt = read("Sample".equals(e.get("entry_type")) ? sampleInputs(e) : typical, "weigh", s.key);
                                run(problems, "Weight of " + e.get("label") + (reps > 1 ? " (" + k + " of " + Js.number(reps) + ")" : ""),
                                    () -> t.update("INSERT INTO entry_value (step_run_id, entry_id, run_no, value_num) VALUES (?::uuid, ?::uuid, ?::int, ?::numeric)", r.get("id"), e.get("id"), kk, wt));
                            }
                        }
                        if (eq != null) run(problems, "Balance", () -> t.update("INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id) VALUES (?::uuid, NULL, ?::uuid)", r.get("id"), eq.get("id")));
                        else if (!s.equipment.isEmpty()) problems.add("No usable " + eqTypes + " at the lab (available and in calibration)");
                    }
                    case "Preparation" -> {
                        Object fields = map(plan.get("batch")).get("prep") instanceof Map<?, ?> p ? ((Map<?, ?>) p).get(s.key) : null;
                        run(problems, "Fields", () -> t.update("UPDATE step_run SET fields = ?::jsonb WHERE id = ?::uuid", JsValues.json(fields == null ? new LinkedHashMap<>() : fields), r.get("id")));
                        if (eq != null) run(problems, "Equipment", () -> t.update("INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id) VALUES (?::uuid, NULL, ?::uuid)", r.get("id"), eq.get("id")));
                    }
                    case "Dilution" -> {
                        for (Map<String, Object> e : work) {
                            Object fl = read("Sample".equals(e.get("entry_type")) ? sampleInputs(e) : typical, "dil", s.key);
                            run(problems, "Dilution of " + e.get("label"), () -> t.update("INSERT INTO entry_value (step_run_id, entry_id, data) VALUES (?::uuid, ?::uuid, ?::jsonb)", r.get("id"), e.get("id"), JsValues.json(m("fields", fl == null ? JsValues.UNDEFINED : fl))));
                        }
                    }
                    case "Plating/Inoculation" -> {
                        for (Map<String, Object> e : work) {
                            Object pl = read("Sample".equals(e.get("entry_type")) ? sampleInputs(e) : typical, "plates", s.key);
                            run(problems, "Plates of " + e.get("label"), () -> t.update("INSERT INTO entry_value (step_run_id, entry_id, value_num) VALUES (?::uuid, ?::uuid, ?::numeric)", r.get("id"), e.get("id"), pl));
                        }
                        Map<String, Object> lot = lotFor("Media", List.of(), s.cfg("expected_media"));
                        if (lot != null) {
                            Map<String, Object> am = amount(lot, "20");
                            run(problems, "Media lot", () -> t.update("INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (?::uuid, NULL, ?::uuid, 'Media', ?::numeric, ?)", r.get("id"), lot.get("id"), am.get("volume"), am.get("unit")));
                        } else problems.add("No usable media lot at the lab (received, available, in date, and qualified for this test when it needs qualifying)");
                    }
                    case "Incubation" -> {
                        if (eq == null) { problems.add("No usable " + (eqTypes.isEmpty() ? "incubator" : eqTypes) + " at the lab (available and in calibration)"); break; }
                        Map<String, Object> inc = map(map(map(plan.get("batch")).get("inc")).get(s.key));
                        double secs = JsValues.num(inc.get("duration")) * ("days".equals(inc.get("unit")) ? 86400 : 3600);
                        run(problems, "Load", () -> t.update("""
                            INSERT INTO incubation_load (step_run_id, equipment_id, entry_ids, time_in, time_out, temperature)
                            VALUES (?::uuid, ?::uuid, NULL, date_trunc('second', clock_timestamp()) - make_interval(secs => ?::double precision), date_trunc('second', clock_timestamp()), ?::numeric)""",
                            r.get("id"), eq.get("id"), Double.isNaN(secs) ? "NaN" : Js.number(secs), inc.get("temperature")));
                    }
                    case "Data Entry" -> dataEntry(b, s, r, entries, eq, problems);
                    case "Calculation" -> {
                        List<Map<String, Object>> live = t.rows("SELECT entry_id, analyte_id, value::text AS value, waiting FROM batch_results(?::uuid) WHERE step_key = ? AND run_no = 1", b.id(), s.key);
                        for (Map<String, Object> c : byKind("calc", x -> eq(in(x).get("step_key"), s.key))) {
                            Map<String, Object> e = entries.stream().filter(x -> eq(x.get("sample_key"), c.get("sample_key")) && "Sample".equals(x.get("entry_type"))).findFirst().orElse(null);
                            if (e == null) continue;
                            Map<String, Object> got = live.stream().filter(x -> eq(x.get("entry_id"), e.get("id")) && eq(x.get("analyte_id"), in(c).get("analyte_id"))).findFirst().orElse(null);
                            Object ev2 = exp(c).get("value");
                            boolean ok = got != null && (ev2 == null ? got.get("value") == null : Calculation.close(got.get("value"), ev2));
                            put(c.get("check_code"), ok ? "Pass" : "Fail", m("text", got != null ? (got.get("value") != null ? got.get("value") : got.get("waiting")) : "No result", "value", got != null ? got.get("value") : JsValues.UNDEFINED),
                                ok ? null : "Differs from the independent calculation", b.id(), ev);
                        }
                    }
                    case "Hold Point" -> { }
                    default -> { }
                }
                if (s.is("Hold Point")) {
                    Map<String, Object> c = one("hold", x -> eq(in(x).get("step_key"), s.key));
                    Try x = completeStep(b, s, r);
                    if (!x.ok()) {
                        boolean ok = x.error().contains("Waits for");
                        if (c != null) put(c.get("check_code"), ok ? "Pass" : "Fail", m("text", "Refused: " + x.error()), null, b.id(), ev);
                        blocked.put(b.id(), s.name + " waits for " + D.testName(s.cfg("test_id")) + ": the steps after it cannot be done in this run");
                        say("analyst", "Stopped at " + s.name + " of " + b.code(), x.error());
                    } else {
                        if (c != null) put(c.get("check_code"), "Fail", m("text", "Completed without the other test's result"), "The step did not wait", b.id(), ev);
                        say("analyst", "Completed " + s.name + " of " + b.code(), null);
                    }
                    continue;
                }
                // L-2: the logbook lots the calculations read from this step, scanned for every entry with the protocol's entry
                Object matStep = map(map(plan.get("batch")).get("mat")).get(s.key);
                if (Js.truthy(matStep)) {
                    Map<String, Map<String, Object>> lots = new LinkedHashMap<>();
                    for (Object flds : map(matStep).values()) for (Object x : map(flds).values()) lots.put(str(map(x).get("lot_id")), map(x));
                    for (Map<String, Object> x : lots.values()) {
                        Map<String, Object> lot = t.one("SELECT id, lot_code, unit, physical_form::text AS form, chemical_types FROM inventory_lot WHERE id = ?::uuid", x.get("lot_id"));
                        if (lot == null) { problems.add("Lot " + x.get("lot_code") + " is gone"); continue; }
                        Map<String, Object> am = amount(lot, "0.1");
                        String purpose = JsValues.pgList(lot.get("chemical_types")).contains("Microbiological Strain") ? "Strain" : "Reagent";
                        for (Map<String, Object> e : entries) {
                            if (e.get("daily_of_entry_id") != null) continue;
                            run(problems, x.get("lot_code") + " (" + x.get("entry_code") + ") for " + e.get("label"), () -> t.update(
                                "INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit, logbook_entry_id) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?::numeric, ?, ?::uuid)",
                                r.get("id"), e.get("id"), x.get("lot_id"), purpose, am.get("volume"), am.get("unit"), x.get("entry_id")));
                        }
                    }
                }
                Map<String, Object> stc = one("step", c -> eq(in(c).get("step_key"), s.key));
                Try x = completeStep(b, s, r);
                if (!x.ok()) {
                    List<String> all = new ArrayList<>(problems);
                    all.add(x.error());
                    String why = String.join("; ", all);
                    if (stc != null) put(stc.get("check_code"), problems.stream().anyMatch(p -> p.startsWith("No usable")) ? "Not tested" : "Fail", m("text", "Not completed: " + x.error(), "problems", problems), why, b.id(), ev);
                    blocked.put(b.id(), s.name + " could not be completed: " + why);
                    say("analyst", "Could not complete " + s.name + " of " + b.code(), why);
                    break;
                }
                Map<String, Object> done = t.one("""
                    SELECT r.status, u.full_name AS by, se.meaning, se.method, w2.full_name AS witness FROM step_run r JOIN app_user u ON u.id = r.performed_by
                      JOIN signature_event se ON se.id = r.signature_id LEFT JOIN app_user w2 ON w2.id = r.witness_id WHERE r.id = ?::uuid""", r.get("id"));
                boolean okStep = done != null && "Completed".equals(done.get("status")) && "Performed by".equals(done.get("meaning")) && "Automated verification run".equals(done.get("method"))
                    && (!s.witnessRequired() || Js.truthy(done.get("witness")));
                if (stc != null) put(stc.get("check_code"), okStep ? "Pass" : "Fail", m("text", b.code() + ": " + (done != null ? done.get("status") + ", " + done.get("meaning") + " " + done.get("by")
                    + (Js.truthy(done.get("witness")) ? ", witnessed by " + done.get("witness") : "") : "not completed")), problems.isEmpty() ? null : String.join("; ", problems), b.id(), ev);
                say("analyst", "Completed " + s.name + " of " + b.code() + " (signed \"Performed by\")", problems.isEmpty() ? null : String.join("; ", problems));
                if (s.is("Split off Test")) {
                    Map<String, Object> c = one("split", y -> eq(in(y).get("step_key"), s.key));
                    if (c != null) {
                        List<Object> got = new ArrayList<>(t.rows("SELECT s.client_sample_id AS k FROM split_request q JOIN sample s ON s.id = q.sample_id WHERE q.step_run_id = ?::uuid AND q.status <> 'Cancelled' ORDER BY 1", r.get("id"))
                            .stream().map(y -> y.get("k")).toList());
                        List<Object> expd = sorted(JsValues.list(exp(c).get("samples")).stream().filter(k -> entries.stream().anyMatch(e -> eq(e.get("sample_key"), k))).toList());
                        boolean ok = got.equals(expd);
                        put(c.get("check_code"), ok ? "Pass" : "Fail", m("text", !got.isEmpty() ? "Requests for " + joinJs(got, ", ") : "No request", "samples", got), ok ? null : "Differs from the protocol", b.id(), ev);
                    }
                }
            }
            if (blocked.containsKey(b.id())) continue;
            finalReview(b, tps, blocked, samples);
        }
        // ---- across the run
        as("executor");
        Map<String, Object> os = t.one("SELECT status::text AS s FROM lab_order WHERE id = ?::uuid", setup.get("lab_order_id"));
        Map<String, Object> oc = one("order_status");
        if (oc != null && !batches.isEmpty() && blocked.isEmpty()) put(oc.get("check_code"), "Approved".equals(os.get("s")) ? "Pass" : "Fail", m("text", os.get("s")), null, null, "#/orders/" + setup.get("lab_order_id"));
        Map<String, Object> au = one("audit");
        if (au != null && !batches.isEmpty()) {
            List<Object> ids = batches.stream().map(x -> (Object) x.id()).toList();
            Map<String, Object> a1 = t.one("""
                SELECT count(*)::int AS vals, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM audit_log al WHERE al.table_name = 'entry_value' AND al.record_id = ev.id AND al.action = 'CREATE' AND al.changed_by = ev.created_by))::int AS audited
                  FROM entry_value ev JOIN step_run r ON r.id = ev.step_run_id WHERE r.batch_id = ANY(?::uuid[])""", ids);
            Map<String, Object> a2 = t.one("""
                SELECT count(*)::int AS steps, count(*) FILTER (WHERE se.id IS NOT NULL AND EXISTS (SELECT 1 FROM audit_log al WHERE al.table_name = 'step_run' AND al.record_id = r.id AND al.signature_id = r.signature_id))::int AS signed
                  FROM step_run r LEFT JOIN signature_event se ON se.id = r.signature_id WHERE r.batch_id = ANY(?::uuid[]) AND r.status = 'Completed'""", ids);
            boolean ok = intOf(a1.get("vals")) > 0 && intOf(a1.get("vals")) == intOf(a1.get("audited")) && intOf(a2.get("steps")) == intOf(a2.get("signed"));
            put(au.get("check_code"), ok ? "Pass" : "Fail", m("text", a1.get("audited") + " of " + a1.get("vals") + " values audited under who recorded them; " + a2.get("signed") + " of " + a2.get("steps")
                + " completed steps with their signature in the audit trail"), null, batches.get(0).id(), "#/testing/batches/" + batches.get(0).id() + "?step=results");
        }
        // ---- record every check (blocked batches leave theirs Not tested, with the reason)
        List<String> why = new ArrayList<>(blocked.values());
        for (Map<String, Object> c : checks) {
            Res o = res.get(str(c.get("check_code")));
            if (o == null) {
                if (!why.isEmpty()) t.one("SELECT record_verification_check(?::uuid, ?, ?::jsonb, ?, ?, NULL, NULL)", verificationId, c.get("check_code"), "{}", "Not tested", "Blocked: " + String.join("; ", why));
                continue;
            }
            String result = o.results.contains("Fail") ? "Fail" : o.results.contains("Not tested") ? "Not tested" : "Pass";
            Object actual;
            if (o.actual.size() == 1) actual = o.actual.get(0);
            else actual = m("text", joinJs(o.actual.stream().map(x -> x instanceof Map<?, ?> mm ? ((Map<?, ?>) mm).get("text") : null).toList(), "; "), "runs", o.actual);
            String notes = String.join("; ", new LinkedHashSet<>(o.notes));
            t.one("SELECT record_verification_check(?::uuid, ?, ?::jsonb, ?, ?, ?::uuid, ?)", verificationId, c.get("check_code"), JsValues.json(actual), result, notes.isEmpty() ? null : notes, o.batch, o.evidence);
        }
        return m("batches", batches.stream().map(Batch::code).toList(), "blocked", why);
    }

    private static Object nullId(Map<String, Object> row) { return row == null ? null : row.get("id"); }

    private void run(List<String> problems, String label, Runnable fn) {
        Try x = attempt(() -> { fn.run(); return null; });
        if (!x.ok()) problems.add(label + ": " + x.error());
    }

    private static List<Object> sorted(Collection<?> l) {
        List<Object> out = new ArrayList<>(l);
        out.sort(Comparator.comparing(x -> x == null ? "null" : str(x)));
        return out;
    }

    private static String joinJs(Collection<?> l, String sep) {
        StringBuilder b = new StringBuilder();
        int i = 0;
        for (Object x : l) { if (i++ > 0) b.append(sep); b.append(x == null || x == JsValues.UNDEFINED ? "" : str(x)); }
        return b.toString();
    }

    private void dataEntry(Batch b, Step s, Map<String, Object> r, List<Map<String, Object>> entries, Map<String, Object> eq, List<String> problems) {
        List<Analyte> ans = D.analytes.stream().filter(a -> s.reads(a.id)).toList();
        // materials the QC needs, before its readings
        List<Map<String, Object>> qcE = entries.stream().filter(e -> "QC".equals(e.get("entry_type")) && e.get("daily_of_entry_id") == null).toList();
        List<String> anIds = D.analytes.stream().map(a -> a.id).toList();
        for (Map<String, Object> e : qcE) {
            List<Map<String, Object>> cr = D.qc.stream().filter(q -> eq(q.get("qc_type"), e.get("qc_type")) && Boolean.TRUE.equals(q.get("applies"))).toList();
            boolean needSpike = "Prep".equals(e.get("qc_class")) && cr.stream().anyMatch(q -> "Recovery %".equals(q.get("limit_type")));
            boolean needStd = "Analytical".equals(e.get("qc_class")) && List.of("ICV", "CCV").contains(e.get("qc_type"));
            Map<String, Object> bq = new LinkedHashMap<>();
            for (Object q : D.byKey.get(D.batching().key).cfgList("qc")) if (eq(map(q).get("qc_type"), e.get("qc_type"))) { bq = map(q); break; }
            Object[][] needs = {{needSpike, "Spike"}, {needStd, "Standard"}, {"Strains".equals(bq.get("material")) && "QC".equals(e.get("entry_type")), "Strain"}};
            for (Object[] nd : needs) {
                if (!(Boolean) nd[0]) continue;
                String purpose = (String) nd[1];
                Map<String, Object> done = t.one("SELECT 1 AS x FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id WHERE sr.batch_id = ?::uuid AND em.entry_id = ?::uuid AND em.purpose::text = ? AND em.status = 'Active'",
                    b.id(), e.get("id"), purpose);
                if (done != null) continue;
                Map<String, Object> lot = lotFor(purpose, anIds, purpose.equals("Spike") ? "spike" : purpose.equals("Standard") ? "check standard calibration" : null);
                if (lot == null) { problems.add("No usable " + purpose.toLowerCase() + " lot for " + e.get("label") + " at the lab"); continue; }
                Map<String, Object> am = amount(lot, purpose.equals("Spike") ? "0.5" : "0.1");
                run(problems, purpose + " for " + e.get("label"), () -> t.update(
                    "INSERT INTO entry_material (step_run_id, entry_id, lot_id, purpose, volume, volume_unit) VALUES (?::uuid, ?::uuid, ?::uuid, ?, ?::numeric, ?)",
                    r.get("id"), e.get("id"), lot.get("id"), purpose, am.get("volume"), am.get("unit")));
            }
        }
        // the samples' readings (from the protocol)
        for (Map<String, Object> e : entries) {
            if (!"Sample".equals(e.get("entry_type"))) continue;
            for (Analyte a : ans) reading(problems, r, e, a, map(read(sampleInputs(e), "read", s.key)).get(a.id));
        }
        // the QC readings: set so each QC meets its criteria
        Step dataStep = D.steps.stream().filter(x -> x.is("Data Entry")).max(Comparator.comparingInt(x -> x.sortOrder)).orElse(null);
        for (Map<String, Object> e : qcE) {
            for (Analyte a : ans) {
                List<Object> cr = D.qc.stream().filter(q -> eq(q.get("qc_type"), e.get("qc_type")) && Boolean.TRUE.equals(q.get("applies")) && eq(q.get("analyte_id"), a.id)).map(q -> q.get("limit_type")).toList();
                String nf = a.notFound("Absent");
                String fv = a.foundValues.isEmpty() || !Js.truthy(a.foundValues.get(0)) ? "Present" : a.foundValues.get(0);
                Object v = map(read(typical, "read", s.key)).get(a.id);
                if (cr.contains("Absence")) v = a.numeric() ? "0" : nf;
                else if (cr.contains("Presence")) v = a.numeric() ? "50" : fv;
                else if (cr.contains("Identified")) v = a.numeric() ? "50" : ("Qualitative".equals(a.resultType) ? fv : "Verification organism (identified)");
                else if (cr.contains("Blank threshold")) v = "0";
                else if (cr.contains("Recovery %") && a.numeric() && s.key.equals(dataStep.key)) {
                    if ("Analytical".equals(e.get("qc_class"))) {
                        Map<String, Object> c = t.one("""
                            SELECT lot_analyte_conc(em.lot_id, ?::uuid, ?)::text AS v FROM entry_material em JOIN step_run sr ON sr.id = em.step_run_id
                             WHERE sr.batch_id = ?::uuid AND em.entry_id = ?::uuid AND em.purpose = 'Standard' AND em.status = 'Active' ORDER BY em.created_at DESC LIMIT 1""",
                            a.id, Js.truthy(s.cfg("value_unit")) ? s.cfg("value_unit") : null, b.id(), e.get("id"));
                        if (c != null && c.get("v") != null) v = Rational.of(c.get("v")).toInput(10);
                    } else {
                        // the recovery is linear in the reading: try two readings (rolled back), then enter the one that gives 100 %
                        double x1 = JsValues.numOr(map(read(typical, "read", s.key)).get(a.id), 10), x2 = x1 * 3 + 1;
                        Double m1 = probe(b, r, e, a, Js.number(x1)), m2 = probe(b, r, e, a, Js.number(x2));
                        if (m1 != null && m2 != null && !m2.equals(m1)) v = Rational.fromDouble(x1 + (100 - m1) * (x2 - x1) / (m2 - m1)).toInput(8);
                    }
                }
                // a spike duplicate is read like its spike (so their RPD is 0)
                if (cr.contains("RPD") && "Matrix Spike Duplicate".equals(e.get("qc_type"))) {
                    Map<String, Object> ms = entries.stream().filter(x -> "Matrix Spike".equals(x.get("qc_type")) && eq(x.get("parent_entry_id"), e.get("parent_entry_id")) && x.get("daily_of_entry_id") == null).findFirst().orElse(null);
                    Map<String, Object> mv = ms == null ? null : t.one("SELECT value_num::text AS v FROM entry_value WHERE step_run_id = ?::uuid AND entry_id = ?::uuid AND analyte_id = ?::uuid AND run_no = 1 AND status = 'Active'", r.get("id"), ms.get("id"), a.id);
                    if (mv != null && mv.get("v") != null) v = mv.get("v");
                }
                reading(problems, r, e, a, v);
            }
        }
        if (!Boolean.FALSE.equals(s.cfg("require_attachment"))) {
            List<List<Object>> rows = new ArrayList<>();
            rows.add(List.of("Entry", "Analyte", "Reading"));
            for (Map<String, Object> e : entries) {
                if (e.get("daily_of_entry_id") != null) continue;
                for (Analyte a : ans) {
                    Map<String, Object> x = t.one("SELECT COALESCE(value_num::text, value_text) AS v FROM entry_value WHERE step_run_id = ?::uuid AND entry_id = ?::uuid AND analyte_id = ?::uuid AND run_no = 1 AND status = 'Active'", r.get("id"), e.get("id"), a.id);
                    List<Object> row = new ArrayList<>();
                    row.add(e.get("label")); row.add(a.name); row.add(x != null ? x.get("v") : "");
                    rows.add(row);
                }
            }
            StringBuilder csv = new StringBuilder("# Raw data written by the automated workflow verification run (not an instrument export)\r\n");
            for (List<Object> row : rows) csv.append(String.join(",", row.stream().map(y -> "\"" + (y == null ? "null" : str(y)).replace("\"", "\"\"") + "\"").toList())).append("\r\n");
            run(problems, "Raw data file", () -> {
                Object d = t.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, 'text/csv', 0, '', convert_to(?, 'UTF8')) RETURNING id", b.code() + "-" + s.key + "-verification.csv", csv.toString()).get("id");
                t.update("INSERT INTO step_attachment (step_run_id, document_id, label, analytical_run_no) VALUES (?::uuid, ?::uuid, ?, 1)", r.get("id"), d, "Verification raw data");
            });
        }
        if (eq != null) run(problems, "Instrument", () -> t.update("INSERT INTO entry_equipment (step_run_id, entry_id, equipment_id, analytical_run_no) VALUES (?::uuid, NULL, ?::uuid, 1)", r.get("id"), eq.get("id")));
        else if (!s.equipment.isEmpty() && !Boolean.FALSE.equals(s.cfg("require_attachment")))
            problems.add("No usable " + String.join(" or ", s.equipment.stream().map(x -> str(x.get("type_name"))).toList()) + " at the lab (available and in calibration)");
    }

    private void reading(List<String> problems, Map<String, Object> r, Map<String, Object> e, Analyte a, Object v) {
        Object num = a.numeric() ? v : null, text = a.numeric() ? null : v;
        run(problems, "Reading of " + e.get("label") + " " + a.name, () -> t.update(
            "INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num, value_text) VALUES (?::uuid, ?::uuid, ?::uuid, 1, ?::numeric, ?)", r.get("id"), e.get("id"), a.id, num, text));
    }

    private Double probe(Batch b, Map<String, Object> r, Map<String, Object> e, Analyte a, String x) {
        Double[] m = {null};
        attempt(() -> {
            t.update("INSERT INTO entry_value (step_run_id, entry_id, analyte_id, run_no, value_num) VALUES (?::uuid, ?::uuid, ?::uuid, 1, ?::numeric)", r.get("id"), e.get("id"), a.id, x);
            for (Map<String, Object> q : t.rows("SELECT * FROM batch_qc_verdicts(?::uuid)", b.id())) {
                if (eq(q.get("entry_id"), e.get("id")) && eq(q.get("analyte_id"), a.id) && "Recovery %".equals(str(q.get("limit_type"))) && intOf(q.get("analytical_run")) == 1) {
                    m[0] = q.get("measured") != null ? Js.toNumber(q.get("measured")) : null;
                    break;
                }
            }
            throw new IllegalStateException("probe");
        });
        return m[0];
    }

    private void finalReview(Batch b, List<Step> tps, Map<String, String> blocked, Map<String, Map<String, Object>> samples) {
        Step finalReview = D.steps.stream().filter(x -> x.is("QC Review") && !tps.contains(x)).findFirst().orElse(null);
        String ev = "#/testing/batches/" + b.id() + "?step=" + (finalReview != null ? finalReview.key : "results");
        String evResults = "#/testing/batches/" + b.id() + "?step=results";
        Map<String, Object> status = t.one("SELECT status::text AS s FROM test_batch WHERE id = ?::uuid", b.id());
        if (!"Awaiting Review".equals(status.get("s"))) { blocked.put(b.id(), "The batch is " + status.get("s") + ", not waiting for review"); return; }
        List<Map<String, Object>> marks = t.rows("SELECT * FROM review_step_runs(?::uuid)", b.id());
        Map<String, Object> self = one("refuse_self_review");
        if (self != null && !res.containsKey(str(self.get("check_code"))) && !marks.isEmpty()) {
            as("analyst");
            Try x = attempt(() -> { reason("Step approved in QC Review"); t.rows("SELECT approve_review_step(?::uuid)", marks.get(0).get("step_run_id")); return null; });
            boolean ok = !x.ok() && x.error().contains("someone else must review");
            put(self.get("check_code"), ok ? "Pass" : "Fail", m("text", x.ok() ? "The analyst approved a step of their own batch" : "Refused: " + x.error()), null, b.id(), ev);
        }
        as("reviewer");
        Map<String, Object> unap = one("refuse_unapproved");
        if (unap != null && !res.containsKey(str(unap.get("check_code")))) {
            Try x = attempt(() -> { reason("Batch reviewed and approved"); sign("Reviewed by", "QC Review and approval of " + b.code()); t.rows("SELECT approve_batch(?::uuid)", b.id()); return null; });
            boolean listed = !x.ok() && intOf(t.one("SELECT count(*)::int AS n FROM batch_review_problems(?::uuid) WHERE problem LIKE '%not approved yet%'", b.id()).get("n")) > 0;
            boolean ok = !x.ok() && listed;
            put(unap.get("check_code"), ok ? "Pass" : "Fail", m("text", x.ok() ? "The batch was approved with steps not approved" : "Refused: " + x.error()), null, b.id(), ev);
            if (x.ok()) return;
        }
        for (Map<String, Object> mk : marks) {
            if (Js.truthy(mk.get("mark_id"))) continue;
            Try x = attempt(() -> { reason("Step approved in QC Review"); t.rows("SELECT approve_review_step(?::uuid)", mk.get("step_run_id")); return null; });
            if (!x.ok()) say("reviewer", "Could not approve a step", x.error());
        }
        say("reviewer", "Approved each step of " + b.code() + " in QC Review", null);
        // QC verdicts: record them; anything failed or waiting is a failed check, accepted only so the run can go on
        List<Double> usedRuns = JsValues.pgList(t.one("SELECT batch_used_runs(?::uuid)::text AS u", b.id()).get("u")).stream().map(JsValues::num).toList();
        List<Map<String, Object>> verd = t.rows("SELECT * FROM batch_qc_verdicts(?::uuid)", b.id()).stream()
            .filter(v -> v.get("analytical_run") != null && (intOf(v.get("analytical_run")) == 1 || usedRuns.contains(JsValues.num(v.get("analytical_run"))))).toList();
        for (Map<String, Object> c : byKind("qc", x -> true)) {
            Object qt = in(c).get("qc_type"), lt = in(c).get("limit_type");
            List<Map<String, Object>> vs = verd.stream().filter(v -> eq(v.get("qc_type"), qt) && eq(str(v.get("limit_type")), lt) && !"Not judged".equals(v.get("verdict"))).toList();
            List<Map<String, Object>> nj = verd.stream().filter(v -> eq(v.get("qc_type"), qt) && eq(str(v.get("limit_type")), lt) && "Not judged".equals(v.get("verdict"))).toList();
            boolean notJudgedType = str(exp(c).get("text")).contains("Not judged");
            if (notJudgedType) {
                String text = String.join("; ", nj.stream().map(v -> v.get("label") + " " + str(Js.orBlank(v.get("analyte_name"))) + ": " + v.get("verdict") + (Js.truthy(v.get("note")) ? " (" + v.get("note") + ")" : "")).toList());
                put(c.get("check_code"), !nj.isEmpty() ? "Pass" : "Fail", m("text", text.isEmpty() ? "No verdict" : text), null, b.id(), evResults);
                continue;
            }
            if (vs.isEmpty() && nj.isEmpty()) continue; // not in this batch (e.g. linked daily QC)
            List<Map<String, Object>> bad = vs.stream().filter(v -> !"Pass".equals(v.get("verdict"))).toList();
            List<Map<String, Object>> both = new ArrayList<>(vs);
            both.addAll(nj);
            put(c.get("check_code"), !bad.isEmpty() || vs.isEmpty() ? "Fail" : "Pass",
                m("text", String.join("; ", both.stream().map(v -> v.get("label") + " " + str(Js.orBlank(v.get("analyte_name"))) + ": " + v.get("verdict")
                    + (v.get("measured") != null ? " " + JsValues.number(v.get("measured")) : "") + (Js.truthy(v.get("note")) ? " (" + v.get("note") + ")" : "")).toList())),
                !bad.isEmpty() ? bad.size() + " verdict" + (bad.size() > 1 ? "s" : "") + " not Pass (accepted by the automated reviewer only so the run could go on)" : vs.isEmpty() ? "Not judged" : null, b.id(), evResults);
            for (Map<String, Object> v : bad) {
                Try x = attempt(() -> {
                    reason("QC accepted by the reviewer");
                    t.rows("SELECT accept_qc(?::uuid, ?::uuid, ?::uuid, ?, ?, ?::int)", b.id(), v.get("entry_id"), v.get("analyte_id"), str(v.get("limit_type")),
                        "Automated verification: recorded as a failed check (" + c.get("check_code") + "); accepted only so the run can go on", v.get("analytical_run"));
                    return null;
                });
                if (!x.ok()) say("reviewer", "Could not accept QC " + v.get("label"), x.error());
            }
        }
        for (Map<String, Object> l : t.rows("SELECT * FROM batch_load_problems(?::uuid)", b.id())) {
            attempt(() -> { reason("Incubator load accepted by the reviewer"); t.rows("SELECT accept_load(?::uuid, ?::uuid, ?)", b.id(), l.get("load_id"), "Automated verification run: load times set by the run"); return null; });
        }
        Try ap = attempt(() -> { reason("Batch reviewed and approved"); sign("Reviewed by", "QC Review and approval of " + b.code()); return t.one("SELECT approve_batch(?::uuid) AS n", b.id()).get("n"); });
        Map<String, Object> apc = one("approve");
        Map<String, Object> bst = t.one("""
            SELECT b.status::text AS status, u.full_name AS by, se.meaning, se.method FROM test_batch b LEFT JOIN app_user u ON u.id = b.reviewed_by
              LEFT JOIN signature_event se ON se.id = b.review_signature_id WHERE b.id = ?::uuid""", b.id());
        boolean okAp = ap.ok() && "Approved".equals(bst.get("status")) && "Reviewed by".equals(bst.get("meaning"));
        if (apc != null) put(apc.get("check_code"), okAp ? "Pass" : "Fail", m("text", b.code() + ": " + bst.get("status") + (Js.truthy(bst.get("by")) ? ", " + bst.get("meaning") + " " + bst.get("by") : "")
            + (ap.ok() ? " (" + JsValues.number(ap.value()) + " results stored)" : " (" + ap.error() + ")")), ap.ok() ? null : ap.error(), b.id(), ev);
        say("reviewer", ap.ok() ? "Approved " + b.code() + " (signed \"Reviewed by\"): " + JsValues.number(ap.value()) + " results stored" : "Could not approve " + b.code(), ap.ok() ? null : ap.error());
        if (!ap.ok()) { blocked.put(b.id(), "The batch could not be approved: " + ap.error()); return; }
        // the stored final results against the independent calculation
        for (Map<String, Object> c : byKind("result", x -> true)) {
            if (b.entries().stream().noneMatch(e -> eq(e.get("sample_key"), c.get("sample_key")))) continue;
            Map<String, Object> smp = samples.get(str(c.get("sample_key")));
            Map<String, Object> tr = t.one("SELECT value_num::text AS value, value_text, reported, conformance, stage FROM test_result WHERE requested_test_id = ?::uuid AND analyte_id = ?::uuid AND result_key IS NULL AND status = 'Active'",
                smp == null ? null : smp.get("requested_test_id"), in(c).get("analyte_id"));
            Map<String, Object> e = exp(c);
            boolean ok = tr != null && (e.get("value") == null ? tr.get("value") == null : Calculation.close(tr.get("value"), e.get("value"))) && eq(tr.get("reported"), e.get("reported"))
                && eq(tr.get("value_text"), e.get("value_text")) && eq(tr.get("conformance"), e.get("conformance")) && "Final".equals(tr.get("stage"));
            Map<String, Object> actual = m("text", tr != null ? (tr.get("reported") != null ? tr.get("reported") : tr.get("value_text") != null ? tr.get("value_text") : "(none)") + ", " + tr.get("conformance")
                + (tr.get("value") != null ? " (unrounded " + tr.get("value") + ")" : "") + ", " + tr.get("stage") : "No stored result");
            if (tr != null) actual.putAll(tr);
            put(c.get("check_code"), ok ? "Pass" : "Fail", actual, ok ? null : "Differs from the independent calculation", b.id(), "#/samples/" + (smp == null ? "undefined" : smp.get("sample_id")));
        }
    }
}
