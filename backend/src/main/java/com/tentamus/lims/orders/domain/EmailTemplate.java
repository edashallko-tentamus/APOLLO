package com.tentamus.lims.orders.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.Map;
import java.util.Objects;

/**
 * An automatic email's wording. {{name}} in the subject and body is replaced by the value given for that name (names
 * without a value stay visible, so a template error shows). The system's templates are added by migrations; people change
 * their wording, never their code. Java's own copy of fill_template and queue_email (kept in the database: report
 * release, OOS, quotes, invoicing and stability still send through them); replaces the trigger email_template_rules.
 */
public record EmailTemplate(String code, String subject, String body, boolean active) {

    /** {{k}} replaced by vars[k] (null values become empty). */
    public static String fill(String text, Map<String, ?> vars) {
        String out = text;
        for (Map.Entry<String, ?> e : vars.entrySet()) out = out.replace("{{" + e.getKey() + "}}", e.getValue() == null ? "" : e.getValue().toString());
        return out;
    }

    /** The email it queues: subject and body filled; null when the template is switched off. */
    public Email email(String to, String toName, Map<String, ?> vars) {
        return active ? new Email(code, to, toName, fill(subject, vars), fill(body, vars)) : null;
    }

    public record Email(String template, String to, String toName, String subject, String body) {}

    /** A template's code is fixed. */
    public static void checkChange(String storedCode, Map<String, Object> changes) {
        if (changes.containsKey("template_code") && !Objects.equals(storedCode, changes.get("template_code")))
            throw RuleException.database("A template's code is what the system sends it for: it cannot change");
    }

    /** People never add templates. */
    public static void refuseNew() {
        throw RuleException.database("The system's templates are added by migrations; change the wording of an existing one instead");
    }

    /** Queuing a template that does not exist is an error. */
    public static EmailTemplate required(EmailTemplate t, String code) {
        if (t == null) throw RuleException.database("No email template \"" + code + "\"");
        return t;
    }
}
