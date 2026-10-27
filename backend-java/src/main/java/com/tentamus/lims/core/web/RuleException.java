package com.tentamus.lims.core.web;

/**
 * A refusal the person can act on, answered 400 with its message. Rules that stand in for a database trigger carry the
 * trigger's SQL state (P0001), so the answer is the same as when the database refused it; the server's own checks carry none.
 */
public class RuleException extends RuntimeException {
    private final String code;

    public RuleException(String message) { this(message, null); }

    private RuleException(String message, String code) {
        super(message);
        this.code = code;
    }

    /** The same refusal as the database rule this replaces. */
    public static RuleException database(String message) { return new RuleException(message, "P0001"); }

    public String code() { return code; }
}
