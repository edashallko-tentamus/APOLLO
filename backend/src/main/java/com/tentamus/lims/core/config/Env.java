package com.tentamus.lims.core.config;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The backend's settings: the environment first, then backend/.env (KEY=value lines, # comments). Values from the file
 * are also made system properties, so application.properties' ${NAME:default} sees them.
 */
public final class Env {
    private static final Map<String, String> FILE = new HashMap<>();

    private Env() {}

    /** Reads the settings file once at start; a missing file is fine (everything then comes from the environment). */
    public static void load(Path file) {
        if (!Files.isRegularFile(file)) return;
        try {
            FILE.putAll(parse(Files.readAllLines(file, StandardCharsets.UTF_8)));
        } catch (IOException e) {
            throw new IllegalStateException("Cannot read " + file + ": " + e.getMessage(), e);
        }
        FILE.forEach((k, v) -> { if (System.getenv(k) == null && System.getProperty(k) == null) System.setProperty(k, v); });
    }

    static Map<String, String> parse(List<String> lines) {
        Map<String, String> out = new HashMap<>();
        for (String raw : lines) {
            String line = raw.strip();
            if (line.isEmpty() || line.startsWith("#")) continue;
            int eq = line.indexOf('=');
            if (eq <= 0) continue;
            String value = line.substring(eq + 1).strip();
            if (value.length() >= 2 && (value.startsWith("\"") && value.endsWith("\"") || value.startsWith("'") && value.endsWith("'"))) {
                value = value.substring(1, value.length() - 1);
            }
            out.put(line.substring(0, eq).strip(), value);
        }
        return out;
    }

    public static String get(String name) {
        String v = System.getenv(name);
        return v != null ? v : FILE.get(name);
    }

    public static String get(String name, String fallback) {
        String v = get(name);
        return v != null ? v : fallback;
    }
}
