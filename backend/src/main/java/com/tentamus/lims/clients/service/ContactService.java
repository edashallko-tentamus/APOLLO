package com.tentamus.lims.clients.service;

import com.tentamus.lims.clients.domain.Contact;
import com.tentamus.lims.clients.domain.ContactRoles;
import com.tentamus.lims.clients.repo.ContactRepository;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.stereotype.Service;

/** The contact use cases: the contacts list, saving contacts by grid, and linking contacts to clients with their roles. */
@Service
public class ContactService {
    private final ContactRepository contacts;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public ContactService(ContactRepository contacts, AccessPolicy access, UnitOfWork uow) {
        this.contacts = contacts;
        this.access = access;
        this.uow = uow;
    }

    public Object list(Map<String, String> query) {
        return PagedList.wanted(query) ? contacts.page(query) : contacts.all();
    }

    /** POST /api/contacts/bulk: the contacts grid. */
    public List<Map<String, Object>> saveContacts(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, db -> {
            if (anyWrite(rows, contacts.contactWriter()::pick)) access.requireToChange(ctx, "contact", ClientService.PERMISSION);
            for (Map<String, Object> row : rows) Contact.check(contacts.contactWriter().pick(row), row.get("id") == null);
            return contacts.contactWriter().upsert(db, rows, Map.of());
        });
    }

    /**
     * POST /api/client-contacts/bulk: a client's contacts and roles. Rows are checked one by one, so a later row sees the
     * earlier ones (only one active Primary contact per client, for example).
     */
    public List<Map<String, Object>> saveLinks(RequestContext ctx, List<Map<String, Object>> rows) {
        return uow.run(ctx, db -> {
            Set<String> known = contacts.knownRoles();
            Set<String> onePerClient = contacts.onePerClientRoles();
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> row : rows) {
                Map<String, Object> vals = contacts.linkWriter().pick(row);
                String id = row.get("id") == null ? null : row.get("id").toString();
                if (id != null && vals.isEmpty()) continue;
                access.requireToChange(ctx, "client_contact", ClientService.PERMISSION);
                Map<String, Object> before = id == null ? null : contacts.findLink(id);
                if (id != null && before == null) { out.add(contacts.linkWriter().update(db, id, vals)); continue; }
                Map<String, Object> after = new LinkedHashMap<>(before == null ? Map.of() : before);
                after.putAll(vals);
                ContactRoles roles = ContactRoles.of(after.get("roles"), known);
                if (vals.containsKey("roles")) vals.put("roles", roles.list());
                Object status = after.get("status");
                if (status == null || "Active".equals(status.toString())) {
                    for (String role : roles.onlyOnePerClient(onePerClient)) {
                        if (contacts.roleTaken(String.valueOf(after.get("client_id")), id, role))
                            throw RuleException.database("Client already has an active " + role + " contact");
                    }
                }
                out.add(id != null ? contacts.linkWriter().update(db, id, vals) : contacts.linkWriter().insert(db, vals, "id"));
            }
            return out;
        });
    }

    private static boolean anyWrite(List<Map<String, Object>> rows, java.util.function.Function<Map<String, Object>, Map<String, Object>> pick) {
        return rows.stream().anyMatch(r -> r.get("id") == null || !pick.apply(r).isEmpty());
    }
}
