package com.tentamus.lims.clients.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

/**
 * The roles a contact holds for one client (Primary, Secondary, Ordering, Report, Billing, Quality, Alerts…).
 * Replaces the role checks of the database trigger client_contact_validate: every role must be a known one,
 * duplicates are removed and the list is kept sorted, and Primary and Secondary exclude each other.
 */
public final class ContactRoles {
    private final List<String> roles;

    private ContactRoles(List<String> roles) { this.roles = roles; }

    /** @param raw the roles as sent: a list, or PostgreSQL array text such as {PRIMARY,ORDERING} */
    public static ContactRoles of(Object raw, Collection<String> knownRoles) {
        List<String> given = parse(raw);
        for (String r : given) if (!knownRoles.contains(r)) throw RuleException.database("Unknown Contact Role: " + r);
        List<String> sorted = new ArrayList<>(new TreeSet<>(given));
        if (sorted.contains("PRIMARY") && sorted.contains("SECONDARY"))
            throw RuleException.database("A contact cannot be both Primary and Secondary for the same client");
        return new ContactRoles(sorted);
    }

    public List<String> list() { return roles; }

    /** The roles that only one active contact of a client may hold, among these. */
    public List<String> onlyOnePerClient(Set<String> onePerClientRoles) {
        return roles.stream().filter(onePerClientRoles::contains).toList();
    }

    static List<String> parse(Object raw) {
        List<String> out = new ArrayList<>();
        if (raw == null) return out;
        if (raw instanceof Collection<?> c) { for (Object o : c) if (o != null) out.add(o.toString()); return out; }
        String s = raw.toString().trim();
        if (s.startsWith("{") && s.endsWith("}")) s = s.substring(1, s.length() - 1);
        for (String p : s.split(",")) { String t = p.trim().replaceAll("^\"|\"$", ""); if (!t.isEmpty()) out.add(t); }
        return out;
    }
}
