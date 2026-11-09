package com.tentamus.lims.orders.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.UnitOfWork;
import com.tentamus.lims.core.paging.PagedList;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.orders.domain.LabOrder;
import com.tentamus.lims.orders.repo.OrderRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;

/**
 * Lab orders: the list, a new order and its changes (checked by {@link LabOrder}), an order's page and a sample's page.
 * Samples are {@link SampleService}'s, ordering tests {@link TestOrderingService}'s.
 */
@Service
public class OrderService {
    private final OrderRepository repo;
    private final AccessPolicy access;
    private final UnitOfWork uow;

    public OrderService(OrderRepository repo, AccessPolicy access, UnitOfWork uow) {
        this.repo = repo;
        this.access = access;
        this.uow = uow;
    }

    public Object list(RequestContext ctx, Map<String, String> query) {
        String site = access.currentSite(ctx);
        return PagedList.wanted(query) ? repo.page(site, query) : repo.orders(site);
    }

    /** A new order is always for the lab the person is working in. */
    public Map<String, Object> create(RequestContext ctx, Map<String, Object> row) {
        String site = access.currentSite(ctx);
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("site_id", site);
        return uow.run(ctx, d -> {
            Map<String, Object> vals = OrderRepository.NEW_ORDER.pick(r);
            LabOrder.State after = LabOrder.apply(new LabOrder.State(null, null, "Draft", null, null, false), vals);
            check(LabOrder.change(null, after), after);
            Map<String, Object> out = OrderRepository.NEW_ORDER.upsert(d, List.of(r), Map.of()).get(0);
            repo.stampSubmitted(out.get("id"));
            return out;
        });
    }

    public List<Map<String, Object>> update(RequestContext ctx, String id, Map<String, Object> row) {
        Map<String, Object> r = new LinkedHashMap<>(row);
        r.put("id", id);
        return uow.run(ctx, d -> {
            LabOrder.State before = repo.state(id);
            if (before != null) {
                LabOrder.State after = LabOrder.apply(before, OrderRepository.ORDER.pick(r));
                check(LabOrder.change(before, after), after);
            }
            List<Map<String, Object>> out = OrderRepository.ORDER.upsert(d, List.of(r), Map.of());
            if (before != null) repo.stampSubmitted(id);
            return out;
        });
    }

    private void check(LabOrder order, LabOrder.State after) {
        order.check(order.partyChosen() ? repo.party(after.clientId(), after.orderingContactId()) : null,
            order.licenseChecked() ? repo.license(after.licenseId()) : null);
    }


    /** An order's page: the order, its samples and tests, what can be ordered, and the lists its grids pick from. */
    public Map<String, Object> page(RequestContext ctx, String id) {
        Map<String, Object> order = repo.order(id);
        if (order == null) throw new RuleException("Order not found");
        access.checkSite(ctx, (String) order.get("site_id"));
        Object license = repo.licenseOf(order.get("id"));
        order.put("client_license_id", license);
        Object client = order.get("client_id"), site = order.get("site_id");
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("order", order);
        out.put("samples", repo.samplesOf(id));
        out.put("tests", repo.testsOfOrder(id));
        out.put("orderable", repo.orderableLines(client, site));
        out.put("packages", repo.orderablePackages(client, site));
        out.put("tiers", repo.rushTiers());
        out.put("contacts", repo.orderingContacts(client));
        out.put("emails", repo.emails(id));
        out.put("matrices", repo.names("SELECT matrix_name FROM matrix WHERE status = 'Active' ORDER BY lower(matrix_name)"));
        out.put("categories", repo.names("SELECT category_name FROM compliance_category WHERE status = 'Active' ORDER BY sort_order, category_name"));
        out.put("attachments", repo.attachments(id));
        out.put("units", repo.units());
        out.put("elsewhere", repo.quotedElsewhere(client, site));
        out.put("licenses", repo.licenses(client, license, site));
        return out;
    }

    /** A sample's page: the sample (with who logged it), its order and tests, and what holds results per serving. */
    public Map<String, Object> sample(RequestContext ctx, String id) {
        Map<String, Object> sample = repo.sample(id);
        if (sample == null) throw new RuleException("Sample not found");
        Map<String, Object> order = repo.order(sample.get("lab_order_id"));
        access.checkSite(ctx, (String) order.get("site_id"));
        sample.put("logged_by_name", sample.get("logged_by") == null ? null : repo.fullName(sample.get("logged_by")));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("sample", sample);
        out.put("order", order);
        out.put("tests", repo.testsOfSample(id));
        out.put("serving_held", repo.servingHeld(id));
        out.put("serving_tests", repo.servingTests(id));
        return out;
    }

    /** For a new order: the client's ordering contacts and how many quoted lines it can order. */
    public Map<String, Object> setup(String clientId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("contacts", repo.orderingContacts(clientId));
        out.put("orderableCount", repo.orderableCount(clientId));
        return out;
    }

}
