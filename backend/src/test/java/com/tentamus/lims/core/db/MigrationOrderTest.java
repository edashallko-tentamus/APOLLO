package com.tentamus.lims.core.db;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Which files run at start, and in which order (db.js migrate()). */
class MigrationOrderTest {
    @Test
    void migrationsInNameOrderAndSeedSqlBeforeTheNumberedSeeds(@TempDir Path root) throws Exception {
        Path m = Files.createDirectories(root.resolve("migrations"));
        for (String f : List.of("010_b.sql", "002_a.sql", "059_c.sql", "notes.txt", "001_core.sql")) Files.writeString(m.resolve(f), "");
        for (String f : List.of("seed_002_x.sql", "seed.sql", "seed_001_y.sql", "create_database.sql", "roles_setup.sql", "seed_010.txt")) Files.writeString(root.resolve(f), "");
        assertEquals(List.of("001_core.sql", "002_a.sql", "010_b.sql", "059_c.sql"), Migrations.migrationFiles(m));
        assertEquals(List.of("seed.sql", "seed_001_y.sql", "seed_002_x.sql"), Migrations.seedFiles(root));
    }
}
