package com.tentamus.lims.verification.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.options.Cookie;
import com.microsoft.playwright.options.WaitUntilState;
import com.tentamus.lims.core.browser.HeadlessBrowser;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.files.DocumentStore;
import com.tentamus.lims.core.session.SessionStore;
import com.tentamus.lims.core.signature.AuthEvents;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.verification.domain.JsValues;
import java.nio.ByteBuffer;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Objective evidence for a workflow verification (evidence.js): after the run, every page the run's checks point to (the
 * order, each step of each batch, the results and QC, each sample) is opened in the shared headless browser as the
 * person who asked for the capture, and a full-page screenshot of each is kept, stamped with the verification, the
 * evidence number, the page, the time and who captured it, and stored unchanged with its SHA-256.
 */
@Component
public class EvidenceCapture {
    private final HeadlessBrowser browser;
    private final SessionStore sessions;
    private final AuthEvents events;
    private final int port;
    private static final ObjectMapper JSON = new ObjectMapper();

    public EvidenceCapture(HeadlessBrowser browser, SessionStore sessions, AuthEvents events, @Value("${lims.public-port:3000}") int port) {
        this.browser = browser;
        this.sessions = sessions;
        this.events = events;
        this.port = port;
    }

    /** A page to capture and the checks it shows. */
    record EvPage(String ref, String title, List<Object> checks) {}

    /** A screenshot taken. */
    record Shot(EvPage page, byte[] png, String sha256, String capturedAt, Integer width, Integer height) {}

    /** What the capture gives: the screenshots, and the pages that could not be captured. */
    public record Captured(List<Shot> items, List<String> missed) {}

    static Integer[] pngSize(byte[] b) {
        if (b.length > 24 && ByteBuffer.wrap(b, 12, 4).getInt() == 0x49484452)
            return new Integer[] {(int) (ByteBuffer.wrap(b, 16, 4).getInt() & 0xFFFFFFFFL), (int) (ByteBuffer.wrap(b, 20, 4).getInt() & 0xFFFFFFFFL)};
        return new Integer[] {null, null};
    }

    // The pages to capture, in report order, and the checks each one shows
    List<EvPage> evidencePages(Db db, Map<String, Object> w) {
        List<Map<String, Object>> checks = db.rows("SELECT check_code, inputs, evidence_ref, batch_id FROM verification_check WHERE verification_id = ?::uuid ORDER BY sort_order", w.get("id"));
        List<Map<String, Object>> batches = db.rows("SELECT id, batch_code FROM test_batch WHERE verification_id = ?::uuid ORDER BY batch_code", w.get("id"));
        List<EvPage> pages = new ArrayList<>();
        Map<String, EvPage> byRef = new LinkedHashMap<>();
        java.util.function.BiConsumer<String, String> add = (ref, title) -> {
            if (!byRef.containsKey(ref)) { EvPage p = new EvPage(ref, title, new ArrayList<>()); byRef.put(ref, p); pages.add(p); }
        };
        if (w.get("lab_order_id") != null) {
            Map<String, Object> o = db.one("SELECT order_code FROM lab_order WHERE id = ?::uuid", w.get("lab_order_id"));
            add.accept("#/orders/" + w.get("lab_order_id"), "Order " + o.get("order_code") + ": the verification's samples and their tests");
        }
        for (Map<String, Object> b : batches) {
            for (Map<String, Object> s : db.rows("""
                SELECT ws.step_key, ws.step_name, ws.step_type::text AS step_type FROM step_run r JOIN workflow_step ws ON ws.id = r.step_id
                 WHERE r.batch_id = ?::uuid ORDER BY ws.sort_order, ws.step_key""", b.get("id")))
                add.accept("#/testing/batches/" + b.get("id") + "?step=" + s.get("step_key"), b.get("batch_code") + ": " + s.get("step_name") + " (" + s.get("step_type") + ")");
            add.accept("#/testing/batches/" + b.get("id") + "?step=results", b.get("batch_code") + ": Results and QC");
        }
        if (w.get("lab_order_id") != null) {
            for (Map<String, Object> s : db.rows("SELECT id, sample_code FROM sample WHERE lab_order_id = ?::uuid ORDER BY sample_code", w.get("lab_order_id")))
                add.accept("#/samples/" + s.get("id"), "Sample " + s.get("sample_code") + ": approved results");
        }
        for (Map<String, Object> c : checks) {
            Object ref = c.get("evidence_ref");
            if (ref == null || ref.toString().isEmpty()) continue;
            // a check pointing at a batch as a whole is shown by the batch's first step
            EvPage p = byRef.get(ref.toString());
            if (p == null) p = pages.stream().filter(x -> x.ref().startsWith(ref + "?step=")).findFirst().orElse(null);
            if (p != null) p.checks().add(c.get("check_code"));
        }
        return pages;
    }

    /** Browses and screenshots every page (no database transaction is held while browsing). */
    public Captured capture(Db db, Map<String, Object> verification, String userId, String siteId) {
        List<EvPage> pages = evidencePages(db, verification);
        if (pages.isEmpty()) throw new RuleException("The run made no pages to capture");
        Map<String, Object> user = db.one("SELECT username, full_name FROM app_user WHERE id = ?::uuid", userId);
        SessionStore.CaptureSession sess = sessions.capture(userId);
        String code = JsValues.str(verification.get("verification_code"));
        events.log(userId, user.get("username"), "Logged in", "headless evidence capture for " + code, null);
        List<Shot> out = new ArrayList<>();
        List<String> missed = new ArrayList<>();
        try {
            String base = "http://127.0.0.1:" + port;
            List<Cookie> cookies = List.of(new Cookie(sess.name(), sess.token()).setUrl(base));
            String init;
            try {
                init = "(() => { try { localStorage.setItem('lims3.site.' + " + JSON.writeValueAsString(userId) + ", " + JSON.writeValueAsString(siteId) + "); } catch (_) { /* ignore */ } })();";
            } catch (Exception e) { throw new IllegalStateException(e); }
            for (EvPage p : pages) {
                int seq = out.size() + 1;
                try {
                    // a fresh window for every page, so nothing of the page before is left (the app only changes the hash otherwise)
                    Shot shot = browser.withPage(1440, 900, cookies, init, (Page page) -> {
                        page.navigate(base + "/" + p.ref(), new Page.NavigateOptions().setWaitUntil(WaitUntilState.LOAD));
                        page.waitForSelector("main h1", new Page.WaitForSelectorOptions().setTimeout(15000));
                        page.waitForFunction("() => !document.querySelector('main .loading')", null, new Page.WaitForFunctionOptions().setTimeout(15000));
                        page.waitForTimeout(700);
                        String at = AutomatedRun.iso(Instant.now());
                        String stamp = "LIMS3 objective evidence · " + code + " E-" + JsValues.pad2(seq) + " · " + p.title() + " · " + p.ref() + " · captured " + at + " by " + user.get("full_name");
                        page.evaluate("""
                            (t) => {
                              const d = document.createElement('div'); d.id = 'evidence-stamp'; d.textContent = t;
                              d.style.cssText = 'background:#1f3a2c;color:#fff;font:600 13px/1.4 system-ui,sans-serif;padding:8px 14px;letter-spacing:.2px';
                              document.body.prepend(d);
                            }""", stamp);
                        byte[] png = page.screenshot(new Page.ScreenshotOptions().setFullPage(true));
                        Integer[] size = pngSize(png);
                        return new Shot(p, png, DocumentStore.sha256(png), at, size[0], size[1]);
                    });
                    out.add(shot);
                } catch (RuntimeException e) {
                    missed.add(p.title() + ": " + String.valueOf(e.getMessage()).split("\n")[0]);
                }
            }
        } finally {
            sess.end();
            try { events.log(userId, user.get("username"), "Logged out", "headless evidence capture for " + code, null); } catch (RuntimeException ignored) { /* the capture's own answer matters more */ }
        }
        if (out.isEmpty()) throw new RuleException("No page could be captured: " + String.join("; ", missed.subList(0, Math.min(3, missed.size()))));
        return new Captured(out, missed);
    }

    /** Stores the images and records them (in the transaction of a signed action); the number recorded. */
    public Object record(Db t, Object verificationId, Captured captured) {
        List<Map<String, Object>> items = new ArrayList<>();
        for (Shot x : captured.items()) {
            Object id = t.one("INSERT INTO document_file (file_name, mime_type, size_bytes, sha256, content) VALUES (?, 'image/png', ?::int, ?, decode(?, 'base64')) RETURNING id",
                "evidence-E" + JsValues.pad2(items.size() + 1) + ".png", x.png().length, x.sha256(), Base64.getEncoder().encodeToString(x.png())).get("id");
            Map<String, Object> it = new LinkedHashMap<>();
            it.put("title", x.page().title()); it.put("page_ref", x.page().ref()); it.put("check_codes", x.page().checks()); it.put("document_id", id);
            it.put("sha256", x.sha256()); it.put("width", x.width()); it.put("height", x.height()); it.put("captured_at", x.capturedAt());
            items.add(it);
        }
        String note = captured.missed().isEmpty() ? null : "Not captured: " + String.join("; ", captured.missed());
        return t.one("SELECT record_verification_evidence(?::uuid, ?::jsonb, ?) AS n", verificationId, JsValues.json(items), note).get("n");
    }
}
