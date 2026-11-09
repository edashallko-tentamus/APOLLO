package com.tentamus.lims.core.web;

/**
 * A refusal the person can act on, answered 400 with its message. Rules that stand in for a database trigger carry the
 * trigger's SQL state (P0001), so the answer is the same as when the database refused it; the server's own checks carry none.
 */
public class RuleException extends RuntimeException {
    private final String code;
    private final int status;

    public RuleException(String message) { this(message, null, 400); }

    private RuleException(String message, String code, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    /** The same refusal as the database rule this replaces. */
    public static RuleException database(String message) { return new RuleException(message, "P0001", 400); }

    /** A refusal that keeps the database's SQL state (e.g. a database message reworded for the screen). */
    public static RuleException withCode(String message, String code) { return new RuleException(message, code, 400); }

    /** Too many requests from one computer (answered 429). */
    public static RuleException tooMany(String message) { return new RuleException(message, null, 429); }

    public String code() { return code; }

    public int status() { return status; }
}
