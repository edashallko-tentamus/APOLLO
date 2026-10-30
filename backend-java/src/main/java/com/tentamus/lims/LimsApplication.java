package com.tentamus.lims;

import com.tentamus.lims.core.db.Reset;
import com.tentamus.lims.core.db.RuleTests;
import java.nio.file.Path;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

/** The LIMS3 API in Java. It migrates the database at start, then serves the API (the front end forwards /api here) and runs the background jobs. */
@SpringBootApplication
@EnableScheduling
public class LimsApplication {
    public static void main(String[] args) {
        // npm test and npm run reset: a database command, then stop (no web server)
        String cmd = args.length > 0 ? args[0] : "";
        if (cmd.equals("test") || cmd.equals("reset")) {
            try {
                System.exit(cmd.equals("test") ? RuleTests.run(Path.of(System.getenv().getOrDefault("LIMS_DB_ROOT", "../backend/db")).toAbsolutePath().normalize()) : Reset.run());
            } catch (Exception e) {
                System.err.println((cmd.equals("test") ? "Test run failed: " : "Reset failed: ") + e.getMessage());
                System.exit(1);
            }
        }
        SpringApplication.run(LimsApplication.class, args);
    }
}
