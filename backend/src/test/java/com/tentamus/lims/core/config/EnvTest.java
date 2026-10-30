package com.tentamus.lims.core.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class EnvTest {
    @Test
    void readsKeyValueLinesAndSkipsComments() {
        Map<String, String> m = Env.parse(List.of(
            "# comment",
            "",
            "DATABASE_URL=postgres://lims:p=w@localhost:5432/lims3?sslmode=disable",
            "#LIMS_API_PORT=3001",
            "  PORT = 3000  ",
            "QUOTED=\"a b\"",
            "not a setting"));
        assertEquals("postgres://lims:p=w@localhost:5432/lims3?sslmode=disable", m.get("DATABASE_URL"));
        assertEquals("3000", m.get("PORT"));
        assertEquals("a b", m.get("QUOTED"));
        assertFalse(m.containsKey("LIMS_API_PORT"));
        assertEquals(3, m.size());
    }
}
