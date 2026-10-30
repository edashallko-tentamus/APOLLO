package com.tentamus.lims.core.session;

/** Finds the person behind a request's session cookie. */
public interface SessionGateway {

    /** The result of looking a session up: the person and their session token, or nobody (timedOut when it just expired). */
    record Session(String userId, String token, boolean timedOut) {
        public static Session none(boolean timedOut) { return new Session(null, null, timedOut); }
        public boolean signedIn() { return userId != null; }
    }

    Session resolve(String cookieHeader);
}
