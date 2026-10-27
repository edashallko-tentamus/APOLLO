package com.tentamus.lims.core.signature;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class PasswordHashTest {
    // Made by the Node backend's hashPassword('Fixture-pass-2026') (a test value, not anyone's password)
    private static final PasswordHash NODE = new PasswordHash(
        "scrypt$16384$8$1$1Aln1IUYxor2lc9oZ+fuLA==$IHRenFk7bBz+mm2FhH1BcKtgQrfy2PukfmIu+yXtWWl8vL1JTGLVgOYseNs4TP1UYLaZuffEwGqfvtB0yM7Xsw==");

    @Test
    void acceptsTheRightPasswordForANodeHash() { assertTrue(NODE.matches("Fixture-pass-2026")); }

    @Test
    void refusesAWrongPassword() {
        assertFalse(NODE.matches("Fixture-pass-2025"));
        assertFalse(NODE.matches(""));
        assertFalse(NODE.matches(null));
    }

    @Test
    void refusesMissingOrForeignHashes() {
        assertFalse(new PasswordHash(null).matches("x"));
        assertFalse(new PasswordHash("bcrypt$whatever").matches("x"));
    }
}
