package com.tentamus.lims.core.documents;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.tentamus.lims.core.files.DocumentStore;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;

/** The QR matrices match the Node backend's qr.js module for module (fingerprints taken with node -e from qr.js). */
class QrCodeTest {
    private static String fingerprint(boolean[][] m) {
        StringBuilder b = new StringBuilder();
        for (int y = 0; y < m.length; y++) {
            if (y > 0) b.append('/');
            for (boolean v : m[y]) b.append(v ? '1' : '0');
        }
        return DocumentStore.sha256(b.toString().getBytes(StandardCharsets.UTF_8));
    }

    @Test
    void version1MatchesNode() {
        boolean[][] m = QrCode.matrix("HELLO");
        assertEquals(21, m.length);
        assertEquals("0e255a229d55a5b475a8849eaa7d2921234d911f872c218b8b0cbb32ed8d491f", fingerprint(m));
    }

    @Test
    void aVerificationLinkMatchesNode() {
        boolean[][] m = QrCode.matrix("http://localhost:3000/verify.html?c=ABCD-EFGH-JKLM");
        assertEquals(33, m.length);
        assertEquals("17d60d7753e00adc472ff9058ed4925bf844041eff7c15fbeed39b748251a2b9", fingerprint(m));
    }

    @Test
    void svgHasTheQuietZone() {
        String s = QrCode.svg("HELLO", 2, "x");
        assertTrue(s.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 29 29\" width=\"58\" height=\"58\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"x\"><rect width=\"29\" height=\"29\" fill=\"#fff\"/><path d=\"M4 4h1v1h-1"), s);
    }
}
