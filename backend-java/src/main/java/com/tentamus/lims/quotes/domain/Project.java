package com.tentamus.lims.quotes.domain;

import com.tentamus.lims.core.web.RuleException;
import com.tentamus.lims.pricing.domain.Amount;
import java.util.List;
import java.util.Map;

/**
 * A project (a reusable quoted test package) or a quote (a one-off answer to a customer). Replaces the refusals of the
 * database triggers project_code_assign and project_site_default and the name CHECKs (migration 061): a project never
 * becomes a quote nor a quote a project, a quote stays with the lab it was made in, and a quote is for an active contact
 * of its client. The first two hold because kind and site_id are not among the columns Java writes after the insert
 * ({@link #EDITABLE}); the database still gives the code and the lab on insert.
 */
public final class Project {
    /** The columns a person may change on a project after it is made. */
    public static final List<String> EDITABLE = List.of("project_name", "purpose", "available_to_child_clients", "status");
    /** The columns a new project may be given. */
    public static final List<String> NEW = List.of("client_id", "project_name", "purpose", "available_to_child_clients", "is_list_price_acceptance");

    private Project() {}

    public static void check(Map<String, Object> vals, boolean isNew) {
        if (isNew || vals.containsKey("project_name")) Amount.notBlank(vals.get("project_name"), true, "Give the project a name.");
    }

    /** The contact a quote is for must be an active contact of the client. */
    public static void checkQuoteContact(String contactId, boolean activeContactOfClient) {
        if (contactId != null && !activeContactOfClient) throw RuleException.database("The quote's contact must be an active contact of the client");
    }
}
