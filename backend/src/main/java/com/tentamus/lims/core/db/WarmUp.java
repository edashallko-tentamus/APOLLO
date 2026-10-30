package com.tentamus.lims.core.db;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.session.SessionGateway;
import com.tentamus.lims.core.web.RequestContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Runs the read and transaction paths a few times when the server starts, so the first person's save after a restart
 * is not the one that pays for Java loading and compiling them (measured: about 1 s cold, under 0.1 s warm). Reads only:
 * the transactions change nothing.
 */
@Component
public class WarmUp {
    private static final Logger log = LoggerFactory.getLogger(WarmUp.class);
    private static final String[] WIDE_VIEWS = {"lab_site", "lab_order_view", "sample_view", "requested_test_view", "quote_list_view", "test_catalogue",
        "email_outbox", "client_license_view"};
    private final Db db;
    private final UnitOfWork uow;
    private final ObjectMapper json;
    private final SessionGateway sessions;

    public WarmUp(Db db, UnitOfWork uow, ObjectMapper json, SessionGateway sessions) {
        this.db = db;
        this.uow = uow;
        this.json = json;
        this.sessions = sessions;
    }

    /** In the background, so it never delays or stops the start; retried while the database is still being built. */
    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        Thread t = new Thread(this::warm, "warm-up");
        t.setDaemon(true);
        t.start();
    }

    void warm() {
        RequestContext nobody = new RequestContext(null, null, "", "", "127.0.0.1");
        for (int attempt = 1; attempt <= 60; attempt++) {
            try {
                for (int i = 0; i < 20; i++) {
                    // wide rows of every column type the pages send (dates, times, numbers, arrays, json), turned into JSON
                    for (String view : WIDE_VIEWS) json.writeValueAsString(db.rows("SELECT * FROM " + view + " LIMIT 50"));
                    uow.run(nobody, d -> d.rows("SELECT id, status FROM analyte ORDER BY analyte_name LIMIT 5"));
                }
                for (int i = 0; i < 5; i++) sessions.resolve("lims3_sid=warm-up");   // a cookie that is no session: answered "not signed in"
                log.info("Warmed up the database and transaction paths");
                return;
            } catch (Exception e) {
                try { Thread.sleep(5000); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); return; }
            }
        }
        log.warn("Warm-up skipped: the database was not ready within 5 minutes");
    }
}
