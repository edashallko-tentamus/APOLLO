package com.tentamus.lims.clients.service;

import com.tentamus.lims.clients.domain.Client;
import com.tentamus.lims.clients.repo.ClientRepository;
import com.tentamus.lims.clients.repo.LicenseRepository;
import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.time.LabClock;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/** The client use cases: the list, one client's page, and creating or changing a client. */
@Service
public class ClientService {
    public static final String PERMISSION = "master.clients";
    private final ClientRepository clients;
    private final LicenseRepository licenses;
    private final AccessPolicy access;
    private final LabClock clock;
    private final UnitOfWork uow;

    public ClientService(ClientRepository clients, LicenseRepository licenses, AccessPolicy access, LabClock clock, UnitOfWork uow) {
        this.clients = clients;
        this.licenses = licenses;
        this.access = access;
        this.clock = clock;
        this.uow = uow;
    }

    /** Every client, or one page of them when the screen asks for a page. */
    public Object list(Map<String, String> query) {
        return PagedList.wanted(query) ? clients.page(query) : clients.all();
    }

    /** One client's page: the client, contacts, projects, child clients, orderable quote lines and licenses. */
    public Map<String, Object> detail(RequestContext ctx, String id) {
        Map<String, Object> client = clients.find(id);
        if (client == null) throw new RuleException("Client not found");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("client", client);
        out.put("contacts", clients.contactsOf(id));
        out.put("projects", clients.projectsOf(id));
        out.put("children", clients.childrenOf(id));
        out.put("orderable", clients.orderableLines(id));
        out.put("licenses", licenses.ofClient(id, clock.today(ctx.siteId())));
        out.put("can_edit", access.has(ctx, PERMISSION));
        return out;
    }

    /** POST /api/clients: one row, created (or changed when it carries an id). Returns {id}. */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> row) {
        List<Map<String, Object>> r = save(ctx, row == null ? Map.of() : row);
        return r.isEmpty() ? null : r.get(0);
    }

    /** PUT /api/clients/:id: changes the client. Returns [{id}], or [] when nothing editable was sent. */
    public List<Map<String, Object>> update(RequestContext ctx, String id, Map<String, Object> row) {
        Map<String, Object> withId = new LinkedHashMap<>(row == null ? Map.of() : row);
        withId.put("id", id);
        return save(ctx, withId);
    }

    private List<Map<String, Object>> save(RequestContext ctx, Map<String, Object> row) {
        return uow.run(ctx, db -> {
            Map<String, Object> vals = clients.writer().pick(row);
            List<Map<String, Object>> out = new ArrayList<>();
            if (row.get("id") != null && vals.isEmpty()) return out;
            access.requireToChange(ctx, "client", PERMISSION);
            Client.check(row.get("id") == null ? null : row.get("id").toString(), vals, row.get("id") == null);
            if (row.get("id") != null) {
                Object parent = vals.get("parent_client_id");
                if (parent != null) Client.assertNoLoop(row.get("id").toString(), clients.selfAndAncestors(parent.toString()));
                out.add(clients.writer().update(db, row.get("id").toString(), vals));
            } else {
                out.add(clients.writer().insert(db, vals, "id"));
            }
            return out;
        });
    }
}
