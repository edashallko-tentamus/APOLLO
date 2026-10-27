package com.tentamus.lims.core.db;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.sql.DataSource;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.convert.DurationStyle;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * The connection pool, built from DATABASE_URL (the variable the Node backend reads), so both backends use one database.
 * Parameters are sent untyped (stringtype=unspecified), as the Node client does, so PostgreSQL infers uuid, enum, date
 * and array types from the column exactly as it does for the existing SQL.
 */
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource(@Value("${lims.database-url}") String databaseUrl,
                                 @Value("${lims.db.pool-size}") int poolSize,
                                 @Value("${lims.db.statement-timeout}") String statementTimeout) {
        if (databaseUrl == null || databaseUrl.isBlank()) {
            throw new IllegalStateException("Set DATABASE_URL (postgres://user:pass@host:port/db). The Java backend needs a PostgreSQL server; "
                + "the embedded PGlite database works only inside the Node backend.");
        }
        HikariConfig c = new HikariConfig();
        Jdbc j = Jdbc.from(databaseUrl);
        c.setJdbcUrl(j.url());
        c.setUsername(j.user());
        c.setPassword(j.password());
        c.setMaximumPoolSize(poolSize);
        c.setPoolName("lims");
        long ms = DurationStyle.detectAndParse(statementTimeout).toMillis();
        // The JDBC driver always sends the computer's time zone; the Node backend's connections use the database server's default
        // (UTC on the Docker and cloud servers). Timestamps turned into text and "today" in SQL depend on it, so it is set here
        // (LIMS_DB_TIMEZONE when the server's default is not UTC).
        String zone = System.getenv().getOrDefault("LIMS_DB_TIMEZONE", "UTC");
        if (!zone.matches("[A-Za-z0-9/_+-]+")) throw new IllegalStateException("LIMS_DB_TIMEZONE is not a time zone name: " + zone);
        c.setConnectionInitSql("SET search_path = lims, public; SET statement_timeout = " + ms + "; SET TIME ZONE '" + zone + "'");
        c.setConnectionTimeout(Duration.ofSeconds(10).toMillis());
        return new HikariDataSource(c);
    }

    /** postgres://user:pass@host:port/db?sslmode=x  ->  jdbc:postgresql://host:port/db?stringtype=unspecified&sslmode=x */
    record Jdbc(String url, String user, String password) {
        static Jdbc from(String databaseUrl) {
            URI u = URI.create(databaseUrl);
            String[] auth = u.getRawUserInfo() == null ? new String[0] : u.getRawUserInfo().split(":", 2);
            Map<String, String> params = new LinkedHashMap<>();
            params.put("stringtype", "unspecified");
            params.put("ApplicationName", "lims-backend-java");
            if (u.getRawQuery() != null) {
                for (String p : u.getRawQuery().split("&")) {
                    String[] kv = p.split("=", 2);
                    if (kv.length == 2) params.put(kv[0], kv[1]);
                }
            }
            StringBuilder q = new StringBuilder();
            params.forEach((k, v) -> q.append(q.isEmpty() ? "?" : "&").append(k).append('=').append(v));
            int port = u.getPort() < 0 ? 5432 : u.getPort();
            return new Jdbc("jdbc:postgresql://" + u.getHost() + ":" + port + u.getRawPath() + q,
                auth.length > 0 ? decode(auth[0]) : null, auth.length > 1 ? decode(auth[1]) : null);
        }

        private static String decode(String s) { return URLDecoder.decode(s, StandardCharsets.UTF_8); }
    }
}
