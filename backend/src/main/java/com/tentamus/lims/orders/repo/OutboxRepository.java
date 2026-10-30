package com.tentamus.lims.orders.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.orders.domain.EmailTemplate;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Email templates and the Outbox (nothing is sent in the Sandbox). */
@Repository
public class OutboxRepository {
    public static final RecordWriter TEMPLATES = new RecordWriter("email_template", List.of("template_name", "subject", "body", "is_active"));
    private final Db db;

    public OutboxRepository(Db db) { this.db = db; }

    public EmailTemplate template(String code) {
        Map<String, Object> r = db.one("SELECT template_code, subject, body, is_active FROM email_template WHERE template_code = ?", code);
        return r == null ? null : new EmailTemplate((String) r.get("template_code"), (String) r.get("subject"), (String) r.get("body"), Boolean.TRUE.equals(r.get("is_active")));
    }

    /** The code of a stored template, or null. */
    public String codeOf(Object id) {
        Map<String, Object> r = db.one("SELECT template_code FROM email_template WHERE id = ?::uuid", id);
        return r == null ? null : (String) r.get("template_code");
    }

    public Object queue(EmailTemplate.Email e, Object orderId) {
        return db.one("""
            INSERT INTO email_outbox (template, to_address, to_name, subject, body, lab_order_id) VALUES (?, ?, ?, ?, ?, ?::uuid) RETURNING id""",
            e.template(), e.to(), e.toName(), e.subject(), e.body(), orderId).get("id");
    }
}
