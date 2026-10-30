package com.tentamus.lims.core.access;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.tentamus.lims.core.db.Db;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Java's access answers must equal the database functions they replace, for every person, permission and lab
 * (plus "no lab"). Runs against a real database only: DATABASE_URL set.
 */
@SpringBootTest
@EnabledIfEnvironmentVariable(named = "DATABASE_URL", matches = ".+")
class AccessEquivalenceTest {
    @Autowired AccessPolicy access;
    @Autowired Db db;

    @Test
    void javaAnswersEqualTheDatabaseFunctions() {
        List<String> users = db.rows("SELECT id FROM app_user WHERE NOT is_automated AND username <> 'system'").stream().map(r -> (String) r.get("id")).toList();
        List<String> perms = db.rows("SELECT code FROM permission").stream().map(r -> (String) r.get("code")).toList();
        List<String> sites = new ArrayList<>(db.rows("SELECT id FROM lab_site").stream().map(r -> (String) r.get("id")).toList());
        sites.add(null);
        List<String> wrong = new ArrayList<>();
        int checked = 0;
        for (String u : users) {
            UserAccess a = access.load(u);
            for (String s : sites) {
                Map<String, Object> sql = db.one("SELECT user_can_access_site(?::uuid, ?::uuid) AS acc, user_can_view_site(?::uuid, ?::uuid) AS vw", u, s, u, s);
                if (s != null) {
                    checked += 2;
                    if (!Boolean.valueOf(a.canAccess(s)).equals(sql.get("acc"))) wrong.add("access " + u + " " + s);
                    if (!Boolean.valueOf(a.canView(s)).equals(sql.get("vw"))) wrong.add("view " + u + " " + s);
                }
                Map<String, Boolean> held = new java.util.HashMap<>();
                for (Map<String, Object> r : db.rows("SELECT p.code, user_has_permission_at(?::uuid, p.code, ?::uuid) AS ok FROM permission p", u, s))
                    held.put((String) r.get("code"), (Boolean) r.get("ok"));
                for (String p : perms) {
                    checked++;
                    if (a.can(p, s) != Boolean.TRUE.equals(held.get(p))) wrong.add(p + " " + u + " " + s + " java=" + a.can(p, s));
                }
            }
        }
        System.out.println("Access equivalence: " + checked + " answers compared, " + wrong.size() + " different");
        assertEquals(List.of(), wrong.subList(0, Math.min(20, wrong.size())));
    }
}
