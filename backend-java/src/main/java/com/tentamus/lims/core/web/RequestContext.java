package com.tentamus.lims.core.web;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Who is asking, in which lab, and why: the Node backend's request context.
 * The user comes only from the signed-in session (resolved by SessionFilter), never from the request itself.
 *
 * @param userId   the signed-in person
 * @param siteId   the lab chosen in the header (x-site-id) when it is a valid id, else null
 * @param rawSite  the header as sent (some lookups use it even when it is not an id, as the Node backend does)
 * @param reason   the Reason for Change sent with the request (body.reason), or ""
 */
public record RequestContext(String userId, String siteId, String rawSite, String reason, String ip) {
    public static final String USER_ATTRIBUTE = "lims.userId";
    private static final Pattern UUID = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", Pattern.CASE_INSENSITIVE);

    public static RequestContext of(HttpServletRequest req, Map<String, Object> body) {
        String site = req.getHeader("x-site-id");
        Object reason = body == null ? null : body.get("reason");
        return new RequestContext((String) req.getAttribute(USER_ATTRIBUTE), isUuid(site) ? site : null, site == null ? "" : site,
            reason == null ? "" : reason.toString(), req.getRemoteAddr());
    }

    public RequestContext withReason(String r) { return new RequestContext(userId, siteId, rawSite, r == null ? "" : r, ip); }

    public static boolean isUuid(Object v) { return v != null && UUID.matcher(v.toString()).matches(); }
}
