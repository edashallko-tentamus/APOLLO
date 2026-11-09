package com.tentamus.lims.auth.domain;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** The password rule and the new-password checks (auth.js passwordProblem, setup and change-password). */
class PasswordRuleTest {
    @Test
    void atLeastTenCharactersWithALetterAndANumber() {
        assertEquals("The password must be at least 10 characters.", PasswordRule.problem("Short1", "amy"));
        assertEquals("The password must be at least 10 characters.", PasswordRule.problem(1234567890, "amy"));
        assertEquals("The password must be at least 10 characters.", PasswordRule.problem(null, "amy"));
        assertEquals("The password must contain at least one letter and one number.", PasswordRule.problem("abcdefghijk", "amy"));
        assertEquals("The password must contain at least one letter and one number.", PasswordRule.problem("12345678901", "amy"));
        assertNull(PasswordRule.problem("Lab-bench-2026", "amy"));
    }

    @Test
    void notContainingTheUserIdInAnyCase() {
        assertEquals("The password must not contain your user ID.", PasswordRule.problem("xxAKIDDLExx2026", "akiddle"));
        assertNull(PasswordRule.problem("xxAKIDDLExx2026", null));
        assertNull(PasswordRule.problem("xxAKIDDLExx2026", ""));
    }

    @Test
    void theNewPasswordIsTypedTwiceTheSame() {
        Account a = new Account(Map.of("username", "amy"));
        assertEquals("not same", a.newPasswordProblem("Lab-bench-2026", "Lab-bench-2027", "not same"));
        assertEquals("not same", a.newPasswordProblem("Lab-bench-2026", null, "not same"));
        assertNull(a.newPasswordProblem("Lab-bench-2026", "Lab-bench-2026", "not same"));
    }

    @Test
    void userIds() {
        assertTrue(Account.validUserId("a.kiddle-2_x"));
        assertFalse(Account.validUserId("ab"));
        assertFalse(Account.validUserId("a kiddle"));
        assertFalse(Account.validUserId("x".repeat(41)));
    }
}
