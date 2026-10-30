package com.tentamus.lims.testing.domain;

import com.tentamus.lims.core.web.RuleException;
import java.time.Duration;
import java.time.Instant;

/**
 * A witness's signature on a step: someone else, signed "Witnessed by" within the last 30 minutes, who may do bench
 * work in the batch's lab (the witness need not be in the step's department).
 */
public record Witness(String id, String userId, String meaning, Instant signedAt, boolean doesBenchWork) {

    /** Refuses a witness who is the performer, the wrong kind of signature, a stale one, or someone without bench rights. */
    public void assertValid(String performer, Instant now) {
        if (id == null || userId == null || !"Witnessed by".equals(meaning) || userId.equals(performer) || signedAt.isBefore(now.minus(Duration.ofMinutes(30))))
            throw RuleException.database("The witness signature is not valid for this step");
        if (!doesBenchWork) throw RuleException.database("The witness must be able to do bench work in this lab (testing.perform)");
    }

    /** Before signing: the witness must be someone else. */
    public static void assertSomeoneElse(String witness, String performer) {
        if (witness.equals(performer)) throw RuleException.database("The witness must be someone else");
    }
}
