package com.tentamus.lims.core.signature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
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
    void makesTheSameHashAsNodeForTheSameSalt() {
        byte[] salt = new byte[16];
        for (int i = 0; i < 16; i++) salt[i] = (byte) i;
        // node: crypto.scryptSync('Fixture-pass-2026', salt 00..0f, 64, {N: 16384, r: 8, p: 1}) in hashPassword's format
        assertEquals("scrypt$16384$8$1$AAECAwQFBgcICQoLDA0ODw==$AotqoGfeHmQJONZ0QcUKv/O6g1d6DUqUUGGCU+ZyBTrLbrIw9J3RnlLXb/+rVl6lvQiPyLoHmuJ2bcMzA2II7w==",
            PasswordHash.create("Fixture-pass-2026", salt).stored());
    }

    @Test
    void aNewHashHasAFreshSaltAndMatches() {
        PasswordHash a = PasswordHash.create("Fixture-pass-2026"), b = PasswordHash.create("Fixture-pass-2026");
        assertNotEquals(a.stored(), b.stored());
        assertTrue(a.matches("Fixture-pass-2026"));
        assertFalse(a.matches("fixture-pass-2026"));
    }

    @Test
    void refusesMissingOrForeignHashes() {
        assertFalse(new PasswordHash(null).matches("x"));
        assertFalse(new PasswordHash("bcrypt$whatever").matches("x"));
    }
}
