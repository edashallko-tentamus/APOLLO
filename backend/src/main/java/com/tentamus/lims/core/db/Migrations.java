package com.tentamus.lims.core.db;

import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Array;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Builds and updates the database at start (the Node backend's migrate() in db.js): every file of migrations/ not yet
 * applied, in name order, then the demo data, seed.sql and seed_*.sql, each once; each file is tracked in
 * public.schema_migrations. A file runs whole, as one script: a failure rolls back what it did since its last COMMIT and
 * stops the start. With LIMS_MIGRATE_URL the files run as that owner account, which then gives the app account
 * (DATABASE_URL's user) its rights with grant_app_role().
 */
public final class Migrations {
    private static final Logger log = LoggerFactory.getLogger(Migrations.class);
    private final Path root;

    public Migrations(Path root) { this.root = root; }

    /** Migrates with the owner account when there is one, then warns when the app account could change the audit trail. */
    public static void atStart(String databaseUrl, String migrateUrl, String dbRoot) {
        Migrations m = new Migrations(Path.of(dbRoot).toAbsolutePath().normalize());
        List<String> applied;
        if (migrateUrl != null && !migrateUrl.isBlank()) {
            String appRole = URLDecoder.decode(String.valueOf(URI.create(databaseUrl).getRawUserInfo()).split(":", 2)[0], StandardCharsets.UTF_8);
            applied = m.migrate(migrateUrl, appRole);
        } else {
            applied = m.migrate(databaseUrl, null);
        }
        if (!applied.isEmpty()) log.info("Applied: {}", String.join(", ", applied));
        accountWarning(databaseUrl);
    }

    /** Applies what has not run yet; returns the files applied. */
    public List<String> migrate(String url, String grantTo) { return migrate(url, grantTo, true); }

    /** The same, with or without the demo data (the rule tests run on the migrations alone). */
    public List<String> migrate(String url, String grantTo, boolean seed) {
        try (Connection c = connect(url)) {
            c.setAutoCommit(false);
            try (Statement s = c.createStatement()) {
                s.execute("CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
                c.commit();
                Set<String> done = new HashSet<>();
                try (ResultSet r = s.executeQuery("SELECT name FROM public.schema_migrations")) { while (r.next()) done.add(r.getString(1)); }
                c.commit();
                List<String> applied = new ArrayList<>();
                for (String f : migrationFiles(root.resolve("migrations"))) if (!done.contains(f)) apply(c, root.resolve("migrations").resolve(f), f, applied);
                List<String> seeds = seed ? seedFiles(root) : List.of();
                // demo media lots count as already qualified (migration 023); a seed can switch this off for a lot it wants unqualified
                if (seeds.stream().anyMatch(f -> !done.contains(f))) { s.execute("SELECT set_config('lims.media_preapproved', '1', false)"); c.commit(); }
                try {
                    for (String f : seeds) if (!done.contains(f)) apply(c, root.resolve(f), f, applied);
                } finally {
                    c.rollback();
                    s.execute("SELECT set_config('lims.media_preapproved', '', false)");
                    c.commit();
                }
                s.execute("SET search_path = lims, public");
                if (grantTo != null) {
                    try (PreparedStatement g = c.prepareStatement("SELECT grant_app_role(?) AS msg")) { g.setString(1, grantTo); g.execute(); }
                }
                c.commit();
                return applied;
            }
        } catch (SQLException | IOException e) {
            throw new IllegalStateException("Could not migrate the database: " + e.getMessage(), e);
        }
    }

    /** One file as one script (a statement may span lines, functions hold semicolons), then its record, committed together. */
    private static void apply(Connection c, Path file, String name, List<String> applied) throws SQLException, IOException {
        try (Statement s = c.createStatement()) {
            s.setEscapeProcessing(false);   // the file is PostgreSQL as written, never JDBC {fn ...} escapes
            s.execute(Files.readString(file, StandardCharsets.UTF_8));
            try (PreparedStatement p = c.prepareStatement("INSERT INTO public.schema_migrations (name) VALUES (?)")) { p.setString(1, name); p.execute(); }
            c.commit();
            applied.add(name);
        } catch (SQLException e) {
            try { c.rollback(); } catch (SQLException ignored) { /* the connection is closed with the start */ }
            throw new SQLException(name + ": " + e.getMessage(), e.getSQLState(), e);
        }
    }

    /** The migrations, *.sql, in name order (as JavaScript sorts them). */
    static List<String> migrationFiles(Path dir) throws IOException {
        try (Stream<Path> s = Files.list(dir)) { return s.map(p -> p.getFileName().toString()).filter(n -> n.endsWith(".sql")).sorted().toList(); }
    }

    /** The demo data: seed.sql then seed_*.sql (anything named seed*.sql), in name order. */
    static List<String> seedFiles(Path dir) throws IOException {
        try (Stream<Path> s = Files.list(dir)) { return s.map(p -> p.getFileName().toString()).filter(n -> n.matches("^seed.*\\.sql$")).sorted().toList(); }
    }

    /** server.js: says so when the app connects as a superuser or the owner (fine for the Sandbox, not for GxP data). */
    private static void accountWarning(String url) {
        try (Connection c = connect(url); Statement s = c.createStatement(); ResultSet r = s.executeQuery("SELECT database_account_problems() AS p")) {
            if (!r.next()) return;
            Array a = r.getArray(1);
            Object[] list = a == null ? new Object[0] : (Object[]) a.getArray();
            if (list.length > 0) {
                List<String> p = new ArrayList<>();
                for (Object o : list) p.add(String.valueOf(o));
                log.warn("Database account: {}.\n  Fine for the Sandbox; not for GxP data (see db/roles_setup.sql).", String.join("; ", p));
            }
        } catch (SQLException e) {
            // an older database without the function
        }
    }

    /** A plain connection (not the pool): simple queries as the Node client sent them, the lab-neutral time zone, no statement time limit. */
    static Connection connect(String url) throws SQLException {
        DataSourceConfig.Jdbc j = DataSourceConfig.Jdbc.from(url);
        Connection c = DriverManager.getConnection(j.url() + "&preferQueryMode=simple", j.user(), j.password());
        try (Statement s = c.createStatement()) {
            s.execute("SET search_path = lims, public; SET TIME ZONE '" + DataSourceConfig.timeZone() + "'");
        }
        return c;
    }
}
