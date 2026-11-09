package com.tentamus.lims.core.db;

import com.tentamus.lims.core.config.Env;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;

/**
 * npm run reset: empties the app database (DATABASE_URL; the database itself stays) so the next start rebuilds it with
 * fresh demo data. Every record in it is lost: only for databases holding demo data.
 */
public final class Reset {
    private Reset() {}

    public static int run() {
        String url = Env.get("DATABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalStateException("DATABASE_URL is not set. Copy backend/.env.example to backend/.env and point it at your PostgreSQL database.");
        empty(url);
        System.out.println("Database emptied. Run \"npm run start:backend\" to rebuild it with demo data.");
        return 0;
    }

    /** Every table, rule and row goes (the schemas lims and public), so the migrations rebuild it all. */
    static void empty(String url) {
        try (Connection c = Migrations.connect(url); Statement s = c.createStatement()) {
            s.execute("DROP SCHEMA IF EXISTS lims CASCADE; DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public");
        } catch (SQLException e) {
            throw new IllegalStateException("Could not empty the database: " + e.getMessage(), e);
        }
    }
}
