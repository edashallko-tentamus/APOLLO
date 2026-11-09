package com.tentamus.lims.core.documents;

import com.tentamus.lims.core.web.RuleException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.function.IntPredicate;

/**
 * QR codes with no library (the Node backend's qr.js): byte mode, error correction level M, versions 1 to 10 (up to 213
 * bytes, enough for a verification link), following ISO/IEC 18004 and Project Nayuki's public reference implementation.
 * matrix(text) gives the modules (true = dark); svg(text) an SVG with a 4-module quiet zone.
 */
public final class QrCode {
    private QrCode() {}

    private static final int[] ECC_PER_BLOCK = {-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26};   // level M
    private static final int[] BLOCKS = {-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5};
    private static final int FORMAT_M = 0;

    static int rawModules(int ver) {
        int r = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            int n = ver / 7 + 2;
            r -= (25 * n - 10) * n - 55;
            if (ver >= 7) r -= 36;
        }
        return r;
    }

    static int dataCodewords(int ver) { return rawModules(ver) / 8 - ECC_PER_BLOCK[ver] * BLOCKS[ver]; }

    // Reed-Solomon over GF(256), polynomial 0x11D
    static int gmul(int x, int y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z & 0xFF;
    }

    static int[] rsDivisor(int degree) {
        int[] r = new int[degree];
        r[degree - 1] = 1;
        int root = 1;
        for (int i = 0; i < degree; i++) {
            for (int j = 0; j < r.length; j++) {
                r[j] = gmul(r[j], root);
                if (j + 1 < r.length) r[j] ^= r[j + 1];
            }
            root = gmul(root, 0x02);
        }
        return r;
    }

    static List<Integer> rsRemainder(List<Integer> data, int[] div) {
        List<Integer> r = new ArrayList<>();
        for (int k = 0; k < div.length; k++) r.add(0);
        for (int b : data) {
            int f = b ^ r.remove(0);
            r.add(0);
            for (int i = 0; i < div.length; i++) r.set(i, r.get(i) ^ gmul(div[i], f));
        }
        return r;
    }

    private record Encoded(int ver, List<Integer> cw) {}

    private static Encoded encodeData(byte[] bytes) {
        int ver = 1;
        for (; ver <= 10; ver++) {
            int cc = ver <= 9 ? 8 : 16;
            if (4 + cc + bytes.length * 8 <= dataCodewords(ver) * 8) break;
        }
        if (ver > 10) throw new RuleException("The text is too long for a QR code here (213 bytes at most)");
        List<Integer> bits = new ArrayList<>();
        put(bits, 4, 4);
        put(bits, bytes.length, ver <= 9 ? 8 : 16);
        for (byte b : bytes) put(bits, b & 0xFF, 8);
        int cap = dataCodewords(ver) * 8;
        put(bits, 0, Math.min(4, cap - bits.size()));
        while (bits.size() % 8 != 0) bits.add(0);
        for (int pad = 0xEC; bits.size() < cap; pad ^= 0xEC ^ 0x11) put(bits, pad, 8);
        List<Integer> cw = new ArrayList<>();
        for (int i = 0; i < bits.size(); i += 8) {
            int v = 0;
            for (int k = 0; k < 8; k++) v = (v << 1) | bits.get(i + k);
            cw.add(v);
        }
        return new Encoded(ver, cw);
    }

    private static void put(List<Integer> bits, int v, int n) { for (int i = n - 1; i >= 0; i--) bits.add((v >>> i) & 1); }

    private static List<Integer> addEcc(int ver, List<Integer> data) {
        int nb = BLOCKS[ver], ecl = ECC_PER_BLOCK[ver], raw = rawModules(ver) / 8;
        int nShort = nb - (raw % nb), shortLen = raw / nb;
        int[] div = rsDivisor(ecl);
        List<List<Integer>> blocks = new ArrayList<>();
        int k = 0;
        for (int i = 0; i < nb; i++) {
            int len = shortLen - ecl + (i < nShort ? 0 : 1);
            List<Integer> d = new ArrayList<>(data.subList(k, Math.min(data.size(), k + len)));
            k += d.size();
            List<Integer> e = rsRemainder(d, div);
            if (i < nShort) d.add(0);
            d.addAll(e);
            blocks.add(d);
        }
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < blocks.get(0).size(); i++) {
            for (int j = 0; j < blocks.size(); j++) if (i != shortLen - ecl || j >= nShort) out.add(blocks.get(j).get(i));
        }
        return out;
    }

    /** The modules of the QR code for the text (UTF-8), true = dark, [row][column]. */
    public static boolean[][] matrix(String text) {
        Encoded en = encodeData((text == null ? "" : text).getBytes(StandardCharsets.UTF_8));
        int ver = en.ver();
        List<Integer> all = addEcc(ver, en.cw());
        int size = ver * 4 + 17;
        boolean[][] m = new boolean[size][size], fn = new boolean[size][size];
        Grid g = new Grid(m, fn, size);
        for (int i = 0; i < size; i++) { g.set(6, i, i % 2 == 0); g.set(i, 6, i % 2 == 0); }
        g.finder(3, 3);
        g.finder(size - 4, 3);
        g.finder(3, size - 4);
        if (ver > 1) {
            int n = ver / 7 + 2;
            int step = (int) Math.ceil((ver * 4 + 4) / (double) (n * 2 - 2)) * 2;
            List<Integer> pos = new ArrayList<>(List.of(6));
            for (int p = size - 7; pos.size() < n; p -= step) pos.add(1, p);
            for (int i = 0; i < n; i++) for (int j = 0; j < n; j++) {
                if ((i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0)) continue;
                int a = pos.get(i), b = pos.get(j);
                for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) g.set(a + dx, b + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
            }
        }
        g.format(0);
        if (ver >= 7) {
            int rem = ver;
            for (int i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
            int b = (ver << 12) | rem;
            for (int i = 0; i < 18; i++) {
                boolean d = ((b >>> i) & 1) == 1;
                int a = size - 11 + (i % 3), c = i / 3;
                g.set(a, c, d);
                g.set(c, a, d);
            }
        }
        int i = 0;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int v = 0; v < size; v++) for (int j = 0; j < 2; j++) {
                int x = right - j;
                boolean up = ((right + 1) & 2) == 0;
                int y = up ? size - 1 - v : v;
                if (!fn[y][x] && i < all.size() * 8) { m[y][x] = ((all.get(i >>> 3) >>> (7 - (i & 7))) & 1) == 1; i++; }
            }
        }
        int best = 0;
        long bestP = Long.MAX_VALUE;
        for (int k = 0; k < 8; k++) {
            g.apply(k);
            g.format(k);
            long p = g.penalty();
            if (p < bestP) { bestP = p; best = k; }
            g.apply(k);
        }
        g.apply(best);
        g.format(best);
        return m;
    }

    /** The QR code as an SVG: module size px, a 4-module quiet zone, the label as its accessible name. */
    public static String svg(String text, int px, String label) {
        boolean[][] m = matrix(text);
        int n = m.length + 8;
        StringBuilder d = new StringBuilder();
        for (int y = 0; y < m.length; y++) for (int x = 0; x < m.length; x++) if (m[y][x]) d.append('M').append(x + 4).append(' ').append(y + 4).append("h1v1h-1z");
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + n + " " + n + "\" width=\"" + n * px + "\" height=\"" + n * px
            + "\" shape-rendering=\"crispEdges\" role=\"img\" aria-label=\"" + label + "\"><rect width=\"" + n + "\" height=\"" + n + "\" fill=\"#fff\"/><path d=\"" + d
            + "\" fill=\"#000\"/></svg>";
    }

    /** The modules being drawn and which of them are function patterns (never masked). */
    private record Grid(boolean[][] m, boolean[][] fn, int size) {
        void set(int x, int y, boolean d) { m[y][x] = d; fn[y][x] = true; }

        void finder(int cx, int cy) {
            for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
                int x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
                if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d != 2 && d != 4);
            }
        }

        void format(int mask) {
            int data = (FORMAT_M << 3) | mask, rem = data;
            for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
            int b = ((data << 10) | rem) ^ 0x5412;
            IntPredicate bit = i -> ((b >>> i) & 1) == 1;
            for (int i = 0; i <= 5; i++) set(8, i, bit.test(i));
            set(8, 7, bit.test(6));
            set(8, 8, bit.test(7));
            set(7, 8, bit.test(8));
            for (int i = 9; i < 15; i++) set(14 - i, 8, bit.test(i));
            for (int i = 0; i < 8; i++) set(size - 1 - i, 8, bit.test(i));
            for (int i = 8; i < 15; i++) set(8, size - 15 + i, bit.test(i));
            set(8, size - 8, true);
        }

        static boolean masked(int k, int x, int y) {
            return switch (k) {
                case 0 -> (x + y) % 2 == 0;
                case 1 -> y % 2 == 0;
                case 2 -> x % 3 == 0;
                case 3 -> (x + y) % 3 == 0;
                case 4 -> (x / 3 + y / 2) % 2 == 0;
                case 5 -> (x * y) % 2 + (x * y) % 3 == 0;
                case 6 -> ((x * y) % 2 + (x * y) % 3) % 2 == 0;
                default -> ((x + y) % 2 + (x * y) % 3) % 2 == 0;
            };
        }

        void apply(int k) {
            for (int y = 0; y < size; y++) for (int x = 0; x < size; x++) if (!fn[y][x] && masked(k, x, y)) m[y][x] = !m[y][x];
        }

        // the mask with the lowest penalty (runs, 2x2 blocks, finder-like patterns, dark balance)
        long penalty() {
            long p = 0;
            for (int y = 0; y < size; y++) { final int yy = y; p += line(x -> m[yy][x]); }
            for (int x = 0; x < size; x++) { final int xx = x; p += line(y -> m[y][xx]); }
            for (int y = 0; y < size - 1; y++) for (int x = 0; x < size - 1; x++) {
                boolean c = m[y][x];
                if (c == m[y][x + 1] && c == m[y + 1][x] && c == m[y + 1][x + 1]) p += 3;
            }
            boolean[] pat = {true, false, true, true, true, false, true, false, false, false, false};
            for (int y = 0; y < size; y++) for (int k = 0; k + 11 <= size; k++) {
                final int yy = y;
                if (has(pat, x -> m[yy][x], k)) p += 40;
                if (has(pat, r -> m[r][yy], k)) p += 40;
            }
            int dark = 0;
            for (boolean[] row : m) for (boolean d : row) if (d) dark++;
            p += (long) Math.floor(Math.abs(dark * 20 - size * size * 10) / (double) (size * size)) * 10;
            return p;
        }

        private long line(java.util.function.IntFunction<Boolean> get) {
            int run = 1;
            long s = 0;
            for (int k = 1; k < size; k++) {
                if (get.apply(k).booleanValue() == get.apply(k - 1).booleanValue()) { run++; if (run == 5) s += 3; else if (run > 5) s++; } else run = 1;
            }
            return s;
        }

        private static boolean has(boolean[] pat, java.util.function.IntFunction<Boolean> get, int k) {
            boolean fwd = true, rev = true;
            for (int n = 0; n < pat.length; n++) {
                boolean v = get.apply(k + n);
                if (v != pat[n]) fwd = false;
                if (v != pat[pat.length - 1 - n]) rev = false;
            }
            return fwd || rev;
        }
    }
}
