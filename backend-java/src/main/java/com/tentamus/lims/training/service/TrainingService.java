package com.tentamus.lims.training.service;

import static com.tentamus.lims.core.web.Answers.*;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.access.UserAccess;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.signature.SignatureService;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.training.domain.CompetencyAttempt;
import com.tentamus.lims.training.domain.KnownValue;
import com.tentamus.lims.training.domain.Qualification;
import com.tentamus.lims.training.domain.TrainingRule;
import com.tentamus.lims.training.repo.TrainingRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import org.springframework.stereotype.Service;

/**
 * Training and competency: qualifications, competency attempts (initial and continuing, by training samples or by
 * record), the rules per department, legacy qualifications. The rules are the domain's (training/domain, migration 071).
 * The training report PDF: {@link TrainingReport}.
 */
@Service
public class TrainingService {
    private static final List<String> RULE_FIELDS = List.of("dept_trained_after", "unlock_any_test", "unlock_can_train", "continuing_months", "due_soon_days", "min_runs",
        "min_runs_months", "allow_training_samples", "allow_records", "status");
    private final Db db;
    private final UnitOfWork uow;
    private final AccessPolicy access;
    private final SignatureService signatures;
    private final ObjectMapper json;
    private final TrainingRepository repo;
    private final LabClock clock;
    private final TrainingReport report;

    public TrainingService(Db db, UnitOfWork uow, AccessPolicy access, SignatureService signatures, ObjectMapper json, TrainingRepository repo, LabClock clock, TrainingReport report) {
        this.report = report;
        this.repo = repo;
        this.clock = clock;
        this.db = db;
        this.uow = uow;
        this.access = access;
        this.signatures = signatures;
        this.json = json;
    }

    private Map<String, Object> can(RequestContext ctx) {
        UserAccess a = access.load(ctx.userId());
        return map("view", a.can("training.view", ctx.siteId()), "record", a.can("training.record", ctx.siteId()),
            "approve", a.can("training.approve", ctx.siteId()), "configure", a.can("training.configure", ctx.siteId()));
    }

    private void needView(RequestContext ctx, Object userId) {
        if (!String.valueOf(userId).equals(ctx.userId()) && !access.has(ctx, "training.view"))
            throw new RuleException("You may see your own training only (training.view shows everyone's)");
    }

    private Map<String, Object> attemptOf(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Attempt not found");
        Map<String, Object> a = db.one("SELECT * FROM competency_attempt_view WHERE id = ?::uuid", id);
        if (a == null) throw new RuleException("Attempt not found");
        access.checkSite(ctx, (String) a.get("site_id"));
        return a;
    }

    private <T> T signed(RequestContext ctx, Map<String, Object> body, String meaning, String action, Function<Db, T> work) {
        return signatures.signed(ctx, body, new SignatureService.Meaning(meaning, action, "Training"), work);
    }

    // ---------------------------------------------------------------- reading
    /** The lab's overview: people, open attempts, rules. */
    public Map<String, Object> overview(RequestContext ctx) {
        String site = access.currentSite(ctx);
        Map<String, Object> cn = can(ctx);
        boolean view = Boolean.TRUE.equals(cn.get("view"));
        Map<String, Object> me = db.one("SELECT is_admin FROM app_user WHERE id = ?::uuid", ctx.userId());
        Map<String, Object> all = new LinkedHashMap<>(cn);
        all.put("sysadmin", me != null && Js.truthy(me.get("is_admin")));
        String attempts = "SELECT * FROM competency_attempt_view WHERE site_id = ?::uuid AND (status IN ('In progress','Evaluated') OR modified_at > now() - interval '60 days') "
            + (view ? "" : "AND user_id = ?::uuid ") + "ORDER BY (status = 'Evaluated') DESC, (status = 'In progress') DESC, created_at DESC";
        return map("lab", db.one("SELECT id, site_code, require_training FROM lab_site WHERE id = ?::uuid", site),
            "people", view ? db.rows("""
                WITH s AS (SELECT ?::uuid AS site), p AS (SELECT DISTINCT u.id, u.full_name FROM app_user u JOIN group_member gm ON gm.user_id = u.id JOIN lab_group g ON g.id = gm.group_id
                    WHERE g.site_id = (SELECT site FROM s) AND g.status = 'Active' AND gm.status = 'Active' AND u.is_active AND NOT u.is_automated AND u.username <> 'system')
                SELECT p.id, p.full_name,
                  (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = (SELECT site FROM s) AND q.status = 'Active' AND q.state IN ('Current','Due soon'))::int AS current,
                  (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = (SELECT site FROM s) AND q.status = 'Active' AND q.state = 'Due soon')::int AS due_soon,
                  (SELECT count(*) FROM analyst_qualification_view q WHERE q.user_id = p.id AND q.site_id = (SELECT site FROM s) AND q.status = 'Active' AND q.state = 'Lapsed')::int AS lapsed,
                  (SELECT count(*) FROM competency_attempt a WHERE a.user_id = p.id AND a.site_id = (SELECT site FROM s) AND a.status IN ('In progress','Evaluated'))::int AS open_attempts,
                  (SELECT string_agg(d.department_name, ', ' ORDER BY d.department_name) FROM department d WHERE d.site_id = (SELECT site FROM s) AND d.status = 'Active'
                      AND department_trained(p.id, (SELECT site FROM s), d.id)) AS departments_trained,
                  (SELECT max(q.last_competency_at) FROM analyst_qualification q WHERE q.user_id = p.id AND q.site_id = (SELECT site FROM s) AND q.status = 'Active') AS last_competency
                FROM p ORDER BY p.full_name""", site) : List.of(),
            "attempts", view ? db.rows(attempts, site) : db.rows(attempts, site, ctx.userId()),
            "rules", db.rows("SELECT r.*, d.department_name FROM training_rule r LEFT JOIN department d ON d.id = r.department_id WHERE r.site_id = ?::uuid AND r.status = 'Active' ORDER BY d.department_name NULLS LAST", site),
            "departments", db.rows("SELECT id, department_code, department_name FROM department WHERE site_id = ?::uuid AND status = 'Active' ORDER BY department_name", site),
            "can", all, "me", ctx.userId());
    }

    /** One person's training: qualifications, attempts, departments, what they did (the rolling counters). */
    private Map<String, Object> person(String site, String userId) {
        Map<String, Object> u = db.one("SELECT id, full_name, username, title FROM app_user WHERE id = ?::uuid", userId);
        if (u == null) throw new RuleException("Person not found");
        return map("person", u,
            "qualifications", db.rows("SELECT * FROM analyst_qualification_view WHERE user_id = ?::uuid AND site_id = ?::uuid ORDER BY status, department_name NULLS LAST, test_name", userId, site),
            "attempts", db.rows("SELECT * FROM competency_attempt_view WHERE user_id = ?::uuid AND site_id = ?::uuid ORDER BY created_at DESC", userId, site),
            "departments", db.rows("""
                WITH p AS (SELECT ?::uuid AS u, ?::uuid AS site)
                SELECT d.id, d.department_name, (training_rule_for((SELECT site FROM p), d.id)).dept_trained_after AS needed,
                    (SELECT count(DISTINCT q.test_id) FROM analyst_qualification q JOIN test t ON t.id = q.test_id WHERE q.user_id = (SELECT u FROM p) AND q.site_id = (SELECT site FROM p)
                        AND t.department_id = d.id AND q.status = 'Active' AND qualification_current((SELECT u FROM p), q.test_id))::int AS current_tests,
                    department_trained((SELECT u FROM p), (SELECT site FROM p), d.id) AS trained, (training_rule_for((SELECT site FROM p), d.id)).unlock_any_test AS unlock_any_test,
                    (training_rule_for((SELECT site FROM p), d.id)).unlock_can_train AS unlock_can_train
                  FROM department d WHERE d.site_id = (SELECT site FROM p) AND d.status = 'Active' ORDER BY d.department_name""", userId, site),
            "activity", db.rows("""
                WITH p AS (SELECT ?::uuid AS u, ?::uuid AS site)
                SELECT t.id AS test_id, t.test_name, d.department_name, x12.runs AS runs_12m, xa.runs AS runs_total, xa.last_at
                  FROM p, test t LEFT JOIN department d ON d.id = t.department_id, LATERAL training_runs((SELECT u FROM p), t.id, (SELECT site FROM p), 12) x12,
                       LATERAL training_runs((SELECT u FROM p), t.id, (SELECT site FROM p), NULL) xa
                 WHERE t.site_id = p.site AND xa.runs > 0 ORDER BY xa.last_at DESC""", userId, site),
            "last_competency_sample", db.one("""
                SELECT attempt_code, test_name, kind, decided_at FROM competency_attempt_view WHERE user_id = ?::uuid AND site_id = ?::uuid AND status = 'Approved' AND route = 'Training samples'
                 ORDER BY decided_at DESC LIMIT 1""", userId, site));
    }

    /** The person's training report as a PDF: {buf, file_name}. */
    public Map<String, Object> reportPdf(RequestContext ctx, String userId) {
        if (!RequestContext.isUuid(userId)) throw new RuleException("Person not found");
        needView(ctx, userId);
        String site = access.currentSite(ctx);
        Map<String, Object> lab = db.one("SELECT site_code, site_name, time_zone FROM lab_site WHERE id = ?::uuid", site);
        Map<String, Object> p = person(site, userId);
        return map("buf", report.pdf(lab, p), "file_name", "training-" + ((Map<?, ?>) p.get("person")).get("username") + ".pdf");
    }

    public Map<String, Object> personPage(RequestContext ctx, String userId) {
        if (!RequestContext.isUuid(userId)) throw new RuleException("Person not found");
        needView(ctx, userId);
        String site = access.currentSite(ctx);
        Map<String, Object> out = new LinkedHashMap<>(person(site, userId));
        out.put("tests", db.rows("""
            SELECT t.id, t.test_code, t.test_name, t.department_id, d.department_name, tv.id AS version_id,
                (SELECT json_agg(json_build_object('analyte_id', a.analyte_id, 'analyte', COALESCE(an.report_name, an.analyte_name), 'unit', a.reporting_unit) ORDER BY a.sort_order)
                   FROM test_version_analyte a JOIN analyte an ON an.id = a.analyte_id WHERE a.test_version_id = tv.id AND a.status = 'Active') AS analytes
              FROM test t LEFT JOIN department d ON d.id = t.department_id LEFT JOIN test_version tv ON tv.test_id = t.id AND tv.status = 'Effective'
             WHERE t.site_id = ?::uuid AND t.status = 'Active' ORDER BY t.test_name""", site));
        out.put("can", can(ctx));
        out.put("me", ctx.userId());
        return out;
    }

    public Map<String, Object> attempt(RequestContext ctx, String id) {
        Map<String, Object> a = attemptOf(ctx, id);
        needView(ctx, a.get("user_id"));
        Map<String, Object> ev = db.one("SELECT can_evaluate_training(?::uuid, ?::uuid) AS ok", ctx.userId(), a.get("test_id"));
        Map<String, Object> cn = new LinkedHashMap<>(can(ctx));
        cn.put("evaluate", ev != null && Js.truthy(ev.get("ok")) && !String.valueOf(a.get("user_id")).equals(ctx.userId()));
        return map("attempt", a,
            "results", db.rows("SELECT * FROM competency_results(?::uuid)", a.get("id")),
            "samples", db.rows("""
                SELECT s.id, s.sample_code, rt.id AS requested_test_id, rt.status::text AS status FROM requested_test rt JOIN sample s ON s.id = rt.sample_id
                 WHERE rt.competency_attempt_id = ?::uuid ORDER BY s.sample_code""", a.get("id")),
            "evidence", db.rows("""
                SELECT e.id, e.title, f.file_name, e.created_at, u.full_name AS by_name FROM competency_evidence e JOIN document_file f ON f.id = e.document_id
                  JOIN app_user u ON u.id = e.created_by WHERE e.attempt_id = ?::uuid ORDER BY e.created_at""", a.get("id")),
            "can", cn, "me", ctx.userId());
    }

    public Map<String, Object> evidenceFile(RequestContext ctx, String id) {
        if (!RequestContext.isUuid(id)) throw new RuleException("File not found");
        Map<String, Object> d = db.one("""
            SELECT f.file_name, f.mime_type, encode(f.content, 'base64') AS b64, a.site_id, a.user_id FROM competency_evidence e JOIN competency_attempt a ON a.id = e.attempt_id
              JOIN document_file f ON f.id = e.document_id WHERE e.id = ?::uuid""", id);
        if (d == null) throw new RuleException("File not found");
        access.checkSite(ctx, (String) d.get("site_id"));
        needView(ctx, d.get("user_id"));
        return map("b64", d.get("b64"), "mime_type", d.get("mime_type"), "file_name", String.valueOf(d.get("file_name")).replaceAll("[^\\w.\\- ]", "_"));
    }

    // ---------------------------------------------------------------- attempts
    /** May this person train (evaluate) on the test: training.record, or department trained where the rule lets them train. */
    private boolean mayTrain(Db d, String user, Map<String, Object> test) {
        String site = (String) test.get("site_id");
        Object dept = test.get("department_id");
        if (access.load(user).can("training.record", site)) return true;
        TrainingRule r = dept == null ? null : repo.ruleFor(d, site, dept);
        return TrainingRule.letsTrain(false, dept != null, r, r != null && r.unlockCanTrain() && repo.departmentTrained(d, user, site, dept));
    }

    /** Start an attempt (a trainer): training samples (an internal order is made) or a record. */
    public Map<String, Object> start(RequestContext ctx, Map<String, Object> body) {
        if (!RequestContext.isUuid(body.get("user_id")) || !RequestContext.isUuid(body.get("test_id"))) throw new RuleException("Choose the person and the test");
        List<Map<String, Object>> known = new ArrayList<>();
        for (Map<String, Object> k : rows(body, "known_values")) {
            boolean value = k.containsKey("value") && !"".equals(k.get("value"));
            if (RequestContext.isUuid(k.get("analyte_id")) && (value || k.containsKey("min") || k.containsKey("max") || Js.truthy(k.get("text")))) known.add(k);
        }
        String knownJson;
        try { knownJson = json.writeValueAsString(known); } catch (JsonProcessingException e) { throw new IllegalArgumentException(e); }
        double samples = Js.toNumber(body.get("samples"));
        Integer n = !body.containsKey("samples") || Double.isNaN(samples) || samples == 0 ? null : (int) samples;
        String kind = Js.truthy(body.get("kind")) ? Js.string(body.get("kind")) : "Initial";
        String route = Js.truthy(body.get("route")) ? Js.string(body.get("route")) : "Record";
        Object trainedOn = Js.orNull(body.get("trained_on"));
        Object userId = body.get("user_id"), testId = body.get("test_id");
        return uow.run(ctx.orReason("Competency started"), d -> {
            Map<String, Object> t = repo.test(d, testId);
            if (t == null || t.get("site_id") == null) throw RuleException.database("Choose a test of this lab");
            String site = (String) t.get("site_id");
            access.checkSite(ctx, site);
            String testName = (String) t.get("test_name");
            Map<String, Object> trainee = repo.trainee(d, userId);
            String qual = repo.activeQualification(d, userId, testId);
            String version = repo.effectiveVersion(d, testId);
            String desc = CompetencyAttempt.checkStart(new CompetencyAttempt.Start(ctx.userId(), String.valueOf(userId), kind, route, testName, site, mayTrain(d, ctx.userId(), t),
                trainee != null, access.load(String.valueOf(userId)).canAccess(site), repo.ruleFor(d, site, t.get("department_id")), qual != null,
                repo.openAttempt(d, userId, testId), Js.string(Js.orBlank(body.get("description"))), trainedOn == null ? null : LocalDate.parse(trainedOn.toString()),
                clock.today(site), n, known.size(), version != null));
            Map<String, Object> a = repo.insertAttempt(d, userId, testId, site, kind, route, "Continuing".equals(kind) ? qual : null, knownJson, desc, trainedOn);
            if ("Training samples".equals(route)) {
                List<KnownValue> specs = new ArrayList<>();
                for (Map<String, Object> k : known) {
                    if (!repo.analyteOnVersion(d, version, String.valueOf(k.get("analyte_id")))) throw RuleException.database("A known value names an analyte that is not on " + testName);
                    specs.add(KnownValue.of(k));
                }
                repo.makeTrainingSamples(d, (String) a.get("id"), (String) a.get("attempt_code"), testId, testName, site, version, (String) trainee.get("full_name"), n, specs, ctx.userId());
            }
            return map("id", a.get("id"));
        });
    }

    public Map<String, Object> addEvidence(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> a = attemptOf(ctx, id);
        List<Map<String, Object>> docs = rows(body, "documents");
        if (docs.isEmpty()) throw new RuleException("Choose a file");
        return uow.run(ctx.orReason("Training evidence"), d -> {
            for (Map<String, Object> f : docs) {
                byte[] buf;
                try { buf = Base64.getMimeDecoder().decode(Js.string(f.get("base64")).replaceFirst("^data:[^,]*,", "")); } catch (IllegalArgumentException e) { buf = new byte[0]; }
                if (buf.length == 0) throw new RuleException("A file is empty");
                if (buf.length > 15 * 1024 * 1024) throw new RuleException("A file is larger than 15 MB");
                repo.attempt(d, a.get("id")).checkEvidence(ctx.userId(), mayTrain(d, ctx.userId(), repo.test(d, a.get("test_id"))));
                Object doc = d.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, ?, ?, ?, decode(?, 'base64')) RETURNING id",
                    Js.truthy(f.get("file_name")) ? f.get("file_name") : "evidence", Js.truthy(f.get("mime_type")) ? f.get("mime_type") : "application/octet-stream",
                    buf.length, DocumentStore.sha256(buf), Base64.getEncoder().encodeToString(buf)).get("id");
                d.update("INSERT INTO competency_evidence (attempt_id, document_id, title) VALUES (?::uuid, ?::uuid, ?)", a.get("id"), doc,
                    Js.truthy(f.get("title")) ? f.get("title") : Js.orNull(f.get("file_name")));
            }
            return map("added", docs.size());
        });
    }

    public Map<String, Object> evaluate(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> a = attemptOf(ctx, id);
        return signed(ctx.withReason(Js.string(Js.orBlank(body.get("note")))), body, "Evaluated by",
            "Competency " + a.get("attempt_code") + " of " + a.get("full_name") + " on " + a.get("test_name") + ": " + body.get("evaluation"),
            d -> {
                CompetencyAttempt at = repo.attempt(d, a.get("id"));
                if (at == null) throw RuleException.database("Attempt not found");
                at.evaluate(ctx.userId(), mayTrain(d, ctx.userId(), repo.test(d, at.testId())), body.get("evaluation") == null ? null : body.get("evaluation").toString(),
                    noteOf(body), repo.testsWaiting(d, at.id()), repo.hasEvidence(d, at.id()));
                repo.saveEvaluation(d, at);
                return ok();
            });
    }

    public Map<String, Object> decide(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> a = attemptOf(ctx, id);
        String dec = "Rejected".equals(body.get("decision")) ? "Rejected" : "Approved";
        return signed(ctx.withReason(Js.string(Js.orBlank(body.get("note")))), body, dec.equals("Approved") ? "Approved by" : "Rejected by",
            "Competency " + a.get("attempt_code") + " of " + a.get("full_name") + " on " + a.get("test_name"),
            d -> {
                CompetencyAttempt at = repo.attempt(d, a.get("id"));
                if (at == null) throw RuleException.database("Attempt not found");
                CompetencyAttempt.Outcome o = at.decide(ctx.userId(), access.load(ctx.userId()).can("training.approve", at.siteId()),
                    repo.permissionRefusal(d, "training.approve"), dec, noteOf(body));
                repo.saveDecision(d, at, ctx.userId());
                String q = o == CompetencyAttempt.Outcome.GRANT ? repo.grantQualification(d, at, ctx.userId())
                    : o == CompetencyAttempt.Outcome.KEEP_UP ? repo.keepUpQualification(d, at) : null;
                return map("qualification_id", q);
            });
    }

    public Map<String, Object> withdrawAttempt(RequestContext ctx, String id, Map<String, Object> body) {
        Map<String, Object> a = attemptOf(ctx, id);
        if (!Js.truthy(body.get("reason"))) throw new RuleException("Give the reason");
        return uow.run(ctx, d -> {
            CompetencyAttempt at = repo.attempt(d, a.get("id"));
            if (at == null) throw RuleException.database("Only an open attempt is withdrawn");
            at.withdraw(mayTrain(d, ctx.userId(), repo.test(d, at.testId())) || access.load(ctx.userId()).can("training.approve", at.siteId()), Js.string(body.get("reason")));
            repo.saveWithdrawal(d, at);
            return ok();
        });
    }

    public Map<String, Object> withdrawQualification(RequestContext ctx, String id, Map<String, Object> body) {
        if (!RequestContext.isUuid(id)) throw new RuleException("Qualification not found");
        Map<String, Object> q = db.one("SELECT site_id, full_name, test_name FROM analyst_qualification_view WHERE id = ?::uuid", id);
        if (q == null) throw new RuleException("Qualification not found");
        access.checkSite(ctx, (String) q.get("site_id"));
        if (!Js.truthy(body.get("reason"))) throw new RuleException("Give the reason");
        return signed(ctx, body, "Withdrawn by", "Qualification of " + q.get("full_name") + " on " + q.get("test_name"),
            d -> {
                Qualification ql = repo.qualification(d, id);
                if (ql == null) throw RuleException.database("Qualification not found");
                ql.withdraw(access.load(ctx.userId()).can("training.approve", ql.siteId()), repo.permissionRefusal(d, "training.approve"), Js.string(body.get("reason")));
                repo.saveQualification(d, ql);
                return ok();
            });
    }

    public Map<String, Object> legacy(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return signed(ctx.orReason("Legacy qualifications when the lab starts training"), body, "Approved by", "Legacy qualifications (who did a test in the last 12 months)",
            d -> {
                if (!access.load(ctx.userId()).can("training.approve", site)) throw RuleException.database(repo.permissionRefusal(d, "training.approve"));
                return map("granted", repo.grantLegacy(d, site, ctx.userId()));
            });
    }

    private static String noteOf(Map<String, Object> body) {
        Object n = Js.orNull(body.get("note"));
        return n == null ? null : n.toString();
    }

    /** The rules per department (a reason for changes); a department named without the rule's id changes its rule. */
    public Map<String, Object> saveRules(RequestContext ctx, Map<String, Object> body) {
        String site = access.currentSite(ctx);
        return uow.run(ctx.orReason("Training rules"), d -> {
            for (Map<String, Object> r : rows(body, "rows")) {
                Map<String, Object> f = new LinkedHashMap<>();
                for (String k : RULE_FIELDS) if (r.containsKey(k)) f.put(k, "".equals(r.get(k)) ? null : r.get(k));
                Object id = Js.truthy(r.get("id")) ? r.get("id") : null;
                if (id == null && RequestContext.isUuid(r.get("department_id"))) {
                    Map<String, Object> x = d.one("SELECT id FROM training_rule WHERE site_id = ?::uuid AND department_id = ?::uuid AND status = 'Active'", site, r.get("department_id"));
                    id = x == null ? null : x.get("id");
                }
                if (id != null) {
                    if (f.isEmpty()) continue;
                    Map<String, Object> before = repo.rule(d, id, site);
                    if (before == null) continue;   // another lab's rule: nothing changes, as before
                    Map<String, Object> after = new LinkedHashMap<>(before);
                    after.putAll(f);
                    TrainingRule.checked(before, after, repo.departmentSite(d, before.get("department_id")));
                    access.requireAt(ctx, "training.configure", site);
                    List<String> sets = new ArrayList<>();
                    List<Object> vals = new ArrayList<>();
                    for (Map.Entry<String, Object> e : f.entrySet()) { sets.add(e.getKey() + " = ?"); vals.add(e.getValue()); }
                    vals.add(id);
                    vals.add(site);
                    d.update("UPDATE training_rule SET " + String.join(", ", sets) + " WHERE id = ?::uuid AND site_id = ?::uuid", vals.toArray());
                } else {
                    if (!RequestContext.isUuid(r.get("department_id"))) throw new RuleException("Choose the department the rule is for");
                    Map<String, Object> after = new LinkedHashMap<>(f);
                    after.put("site_id", site);
                    after.put("department_id", r.get("department_id"));
                    TrainingRule.checked(null, after, repo.departmentSite(d, r.get("department_id")));
                    access.requireAt(ctx, "training.configure", site);
                    d.update("""
                        INSERT INTO training_rule (site_id, department_id, dept_trained_after, unlock_any_test, unlock_can_train, continuing_months, due_soon_days, min_runs, min_runs_months,
                            allow_training_samples, allow_records)
                        VALUES (?::uuid, ?::uuid, ?::int, COALESCE(?::boolean, true), COALESCE(?::boolean, true), ?::int, COALESCE(?::int, 30), ?::int, ?::int, COALESCE(?::boolean, true), COALESCE(?::boolean, true))""",
                        site, r.get("department_id"), f.get("dept_trained_after"), f.get("unlock_any_test"), f.get("unlock_can_train"), f.get("continuing_months"), f.get("due_soon_days"),
                        f.get("min_runs"), f.get("min_runs_months"), f.get("allow_training_samples"), f.get("allow_records"));
                }
            }
            return ok();
        });
    }
}
