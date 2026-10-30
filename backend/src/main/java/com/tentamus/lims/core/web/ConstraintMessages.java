package com.tentamus.lims.core.web;

import java.util.LinkedHashMap;
import java.util.Map;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;

/**
 * A feature's own wording for its database checks, matched on the constraint's name in the database message (the Node
 * backend's per-feature translate()). The first match wins; the SQL state is kept.
 */
public final class ConstraintMessages {
    private final Map<String, String> messages;

    /** pairs: constraint name, message, constraint name, message... */
    public ConstraintMessages(String... pairs) {
        messages = new LinkedHashMap<>();
        for (int i = 0; i + 1 < pairs.length; i += 2) messages.put(pairs[i], pairs[i + 1]);
    }

    /** The readable refusal for one of these checks; anything else unchanged. */
    public Exception translate(Exception e) {
        String own = own(e);
        return own == null ? e : RuleException.withCode(own, ApiExceptionHandler.find(e).getServerErrorMessage().getSQLState());
    }

    /** "<prefix><message>", as the Node backend words a refused row of a list it saves row by row. */
    public RuleException withPrefix(Exception e, String prefix) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg == null || pg.getServerErrorMessage() == null) return RuleException.withCode(prefix + e.getMessage(), e instanceof RuleException r ? r.code() : null);
        ServerErrorMessage m = pg.getServerErrorMessage();
        String own = own(e);
        return RuleException.withCode(own != null ? prefix + own : ApiExceptionHandler.friendly(prefix + m.getMessage(), m.getDetail()), m.getSQLState());
    }

    private String own(Exception e) {
        PSQLException pg = ApiExceptionHandler.find(e);
        if (pg == null || pg.getServerErrorMessage() == null || pg.getServerErrorMessage().getMessage() == null) return null;
        String m = pg.getServerErrorMessage().getMessage();
        for (Map.Entry<String, String> x : messages.entrySet()) if (m.contains("\"" + x.getKey() + "\"")) return x.getValue();
        return null;
    }
}
