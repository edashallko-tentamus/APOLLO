package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.ApiExceptionHandler;
import com.tentamus.lims.core.web.ConstraintMessages;
import com.tentamus.lims.core.web.RuleException;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.postgresql.util.PSQLException;

/** Readable messages for testing's database checks (the Node backend's routes_testing.js translate()). */
public final class TestingMessages {
    private static final ConstraintMessages MESSAGES = new ConstraintMessages(
        "entry_value_uq", "That value was just recorded by someone else; reload the batch.",
        "step_run_batch_id_step_id_key", "The step already has a run in this batch.");
    private static final Pattern DEPARTMENT = Pattern.compile("^\"?(.+?)\"? is done by the (.+?) department; you are not in a group for it");

    private TestingMessages() {}

    /**
     * The constraint messages, and department steps said plainly (system administrators are not in department groups by
     * default, by design: bench work depends on training, not rights; nobody can add themselves to a group).
     */
    public static Exception translate(Exception e) {
        Exception t = MESSAGES.translate(e);
        if (t != e) return t;
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg == null || pg.getServerErrorMessage() == null || pg.getServerErrorMessage().getMessage() == null) return e;
        Matcher m = DEPARTMENT.matcher(pg.getServerErrorMessage().getMessage());
        if (!m.find()) return e;
        String what = m.group(1).startsWith("Batching ") ? "the batching for " + m.group(1).substring(9) : "\"" + m.group(1) + "\"";
        return RuleException.withCode("Only people in a " + m.group(2) + " department group can do " + what + ". "
            + "Ask a lab administrator to add you to the " + m.group(2) + " group (Admin > People and groups); nobody can add themselves. "
            + "System administrators are not in department groups unless added: bench work depends on training.", pg.getServerErrorMessage().getSQLState());
    }
}
