package com.tentamus.lims.core.session;

/** Finds the person behind a request's session cookie. */
public interface SessionGateway {

    /** The result of looking a session up. */
    record Session(String userId, boolean timedOut) {
        public static Session none(boolean timedOut) { return new Session(null, timedOut); }
        public boolean signedIn() { return userId != null; }
    }

    Session resolve(String cookieHeader);
}
