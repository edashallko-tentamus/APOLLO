package com.tentamus.lims.clients.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The client, contact and license rules moved out of the database in migration 059 (they were checked by test_001 and test_048). */
class ClientRulesTest {
    private static final Set<String> ROLES = Set.of("PRIMARY", "SECONDARY", "ORDERING", "REPORT", "BILLING", "QUALITY", "ALERT");

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    @Test
    void accountStatusDecidesOrderingAndRelease() {
        assertTrue(Client.canOrder("Active"));
        assertTrue(Client.canOrder("On Hold"));          // On Hold still orders and tests
        assertFalse(Client.canOrder("Inactive"));
        assertFalse(Client.canReleaseReport("On Hold")); // On Hold holds report release
        assertTrue(Client.canReleaseReport("Inactive")); // work already in the lab is still reported
    }

    @Test
    void clientHierarchyAndName() {
        assertEquals("Parent Client would create a loop in the client hierarchy", refusal(() -> Client.assertNoLoop("A", List.of("B", "A"))));
        assertNull(refusal(() -> Client.assertNoLoop("A", List.of("B", "C"))));
        assertEquals("A client cannot be its own parent.", refusal(() -> Client.check("A", m("parent_client_id", "A"), false)));
        assertEquals("Legal name is required.", refusal(() -> Client.check(null, m("legal_name", "  "), true)));
        assertEquals("Legal name is required.", refusal(() -> Client.check(null, m(), true)));
        assertNull(refusal(() -> Client.check("A", m("display_name", "x"), false)));   // an update that leaves the name alone
    }

    @Test
    void contactNamesAndEmail() {
        assertNull(refusal(() -> Contact.check(m("first_name", "Maria", "last_name", "Lopez", "email", "maria@consult.com"), true)));
        assertEquals("First name is required.", refusal(() -> Contact.check(m("first_name", " ", "last_name", "L", "email", "a@b.co"), true)));
        assertEquals("Last name is required.", refusal(() -> Contact.check(m("first_name", "M", "email", "a@b.co"), true)));
        assertEquals("Email address is not valid.", refusal(() -> Contact.check(m("first_name", "M", "last_name", "L", "email", "maria@consult"), true)));
        assertEquals("Email address is not valid.", refusal(() -> Contact.check(m("email", "a b@c.de"), false)));
        assertNull(refusal(() -> Contact.check(m("phone", "555"), false)));
    }

    @Test
    void contactRoles() {
        assertEquals(List.of("ORDERING", "REPORT"), ContactRoles.of("{REPORT,ORDERING,REPORT}", ROLES).list());
        assertEquals("A contact cannot be both Primary and Secondary for the same client", refusal(() -> ContactRoles.of(List.of("PRIMARY", "SECONDARY"), ROLES)));
        assertEquals("Unknown Contact Role: CEO", refusal(() -> ContactRoles.of("{CEO}", ROLES)));
        assertEquals("Choose at least one role for the contact.", refusal(() -> ContactRoles.of("{}", ROLES)));
        assertEquals(List.of("PRIMARY"), ContactRoles.of(List.of("PRIMARY", "BILLING"), ROLES).onlyOnePerClient(Set.of("PRIMARY")));
    }

    @Test
    void licenses() {
        Map<String, Object> stored = m("client_id", "C1", "license_type", "Cannabis distributor", "license_number", "C11-1", "status", "Active",
            "issued_on", "2026-01-01", "expires_on", "2027-01-01");
        assertEquals("Cannabis distributor", ClientLicense.checked(null, m("license_type", " Cannabis distributor ", "license_number", "C11-1"),
            m("license_type", " Cannabis distributor ", "license_number", "C11-1")).get("license_type"));
        assertEquals("Give the license type.", refusal(() -> ClientLicense.checked(null, m("license_type", " ", "license_number", "X"), m())));
        assertEquals("The license cannot expire before it was issued.", refusal(() -> ClientLicense.checked(null,
            m("license_type", "X", "license_number", "X-1", "issued_on", "2026-05-02", "expires_on", "2026-05-01"), m())));
        Map<String, Object> moved = new HashMap<>(stored);
        moved.put("client_id", "C2");
        assertEquals("A license stays with its client", refusal(() -> ClientLicense.checked(stored, moved, m("client_id", "C2"))));
        Map<String, Object> retiring = new HashMap<>(stored);
        retiring.put("status", "Retired");
        assertTrue(refusal(() -> ClientLicense.checked(stored, retiring, m("status", "Retired"))).startsWith("Say why the license is retired"));
        Map<String, Object> retired = new HashMap<>(retiring);
        retired.put("retired_reason", "Replaced by a renewal");
        Map<String, Object> changed = new HashMap<>(retired);
        changed.put("expires_on", "2028-01-01");
        assertEquals("A retired license is kept as it was", refusal(() -> ClientLicense.checked(retired, changed, m("expires_on", "2028-01-01"))));
    }
}
