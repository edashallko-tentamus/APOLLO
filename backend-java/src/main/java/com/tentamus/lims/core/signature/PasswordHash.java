package com.tentamus.lims.core.signature;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import org.bouncycastle.crypto.generators.SCrypt;

/** A stored password hash, "scrypt$N$r$p$salt$hash" (base64), as the Node backend writes it. */
public record PasswordHash(String stored) {

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
