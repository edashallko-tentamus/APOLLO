package com.tentamus.lims.core.signature;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import org.bouncycastle.crypto.generators.SCrypt;

/** A stored password hash, "scrypt$N$r$p$salt$hash" (base64), the format the LIMS has always stored. */
public record PasswordHash(String stored) {
    private static final SecureRandom RANDOM = new SecureRandom();

    /** A new salted hash of a password (N 16384, r 8, p 1, 64 bytes, 16-byte salt), as auth.js hashPassword made them. */
    public static PasswordHash create(String password) {
        byte[] salt = new byte[16];
        RANDOM.nextBytes(salt);
        return create(password, salt);
    }

    static PasswordHash create(String password, byte[] salt) {
        byte[] hash = SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), salt, 16384, 8, 1, 64);
        Base64.Encoder b = Base64.getEncoder();
        return new PasswordHash("scrypt$16384$8$1$" + b.encodeToString(salt) + "$" + b.encodeToString(hash));
    }

    /** Whether the password matches; false for a missing or unknown hash. Compared in constant time. */
    public boolean matches(String password) {
        if (stored == null || password == null) return false;
        String[] p = stored.split("[$]");
        if (p.length != 6 || !"scrypt".equals(p[0])) return false;
        byte[] expected = Base64.getDecoder().decode(p[5]);
        byte[] got = SCrypt.generate(password.getBytes(StandardCharsets.UTF_8), Base64.getDecoder().decode(p[4]),
            Integer.parseInt(p[1]), Integer.parseInt(p[2]), Integer.parseInt(p[3]), expected.length);
        return MessageDigest.isEqual(expected, got);
    }
}
