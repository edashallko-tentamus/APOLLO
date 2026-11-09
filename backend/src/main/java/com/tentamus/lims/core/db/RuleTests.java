package com.tentamus.lims.core.db;

import com.tentamus.lims.core.config.Env;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.regex.Pattern;

/**
 * npm test: empties the test database (LIMS_TEST_DATABASE_URL, an existing database kept for tests only), applies every
 * migration without the demo data, then runs the rule tests in db/tests in name order on one connection (their pg_temp
 * helpers and session settings carry over), printing each row's result column. Exit code 1 on any failure.
 */
public final class RuleTests {
    // shortcut: only a COMMIT at the start of a line ends a file's transaction, as test_021 and test_031 write it
    private static final Pattern COMMIT = Pattern.compile("(?mi)^COMMIT\s*;.*$");
    private static final Pattern PASS = Pattern.compile("\bPASS\b");

    private RuleTests() {}

    public static int run(Path root) throws IOException, SQLException {
        String url = Env.get("LIMS_TEST_DATABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalStateException("LIMS_TEST_DATABASE_URL is not set: name a database kept for tests only (see backend/.env.example).");
        // the run empties it first, so never the app's own database
        if (url.equals(Env.get("DATABASE_URL"))) throw new IllegalStateException("LIMS_TEST_DATABASE_URL must not be the app database (DATABASE_URL).");
        Reset.empty(url);
        new Migrations(root).migrate(url, null, false);
        int pass = 0;
        int fail = 0;
        Path dir = root.resolve("tests");
        try (Connection c = Migrations.connect(url); Statement s = c.createStatement()) {
            c.setAutoCommit(false);
            s.setEscapeProcessing(false);
            for (String f : Migrations.migrationFiles(dir)) {
                System.out.println("\n== " + f);
                // each part is one transaction, as a whole file sent at once was for the Node client (a COMMIT in it starts the next)
                for (String part : COMMIT.split(Files.readString(dir.resolve(f), StandardCharsets.UTF_8))) {
                    if (part.isBlank()) continue;
                    boolean isRows = s.execute(part);
                    while (isRows || s.getUpdateCount() != -1) {
                        if (isRows) {
                            try (ResultSet r = s.getResultSet()) {
                                int col = column(r.getMetaData());
                                while (col > 0 && r.next()) {
                                    String v = r.getString(col);
                                    if (v == null || v.isEmpty()) continue;
                                    System.out.println("  " + v);
                                    if (PASS.matcher(v).find()) pass++; else fail++;
                                }
                            }
                        }
                        isRows = s.getMoreResults();
                    }
                    c.commit();
                }
            }
        }
        System.out.println("\nTOTAL: " + pass + " passed, " + fail + " failed");
        return fail > 0 ? 1 : 0;
    }

    /** The result column's position, 0 when this result set has none. */
    private static int column(ResultSetMetaData m) throws SQLException {
        for (int i = 1; i <= m.getColumnCount(); i++) if ("result".equals(m.getColumnLabel(i))) return i;
        return 0;
    }
}
