package com.tentamus.lims.core.access;

import java.util.List;
import java.util.Objects;
import java.util.Set;

/**
 * What one person may do, and where. Replaces the database functions user_has_permission_at, user_can_access_site and
 * user_can_view_site (migrations 008, 024, 045) for ordinary requests.
 *
 * <p>Rules: a system administrator (active) holds every permission everywhere. Otherwise a permission comes from an
 * active membership of an active group holding that active permission, either at that lab or in an all-labs group
 * (no lab). A person can open a lab when they are in an active group there; they can view it also when they hold
 * data.view_all. The automated verification and sensor-feed accounts get rights only inside their own runs, which do not
 * come through these requests.
 *
 * @param grants      every (lab, permission) held through groups; lab is null for all-labs groups
 * @param memberSites the labs where the person is in an active group
 */
public record UserAccess(String userId, boolean systemAdmin, List<Grant> grants, Set<String> memberSites) {

    /** One permission held through one group. siteId is null for an all-labs group. */
    public record Grant(String siteId, String permission) {}

    /** user_has_permission_at(user, code, site): a null site means "anywhere" (any group matches). */
    public boolean can(String permission, String siteId) {
        if (systemAdmin) return true;
        return grants.stream().anyMatch(g -> g.permission().equals(permission)
            && (g.siteId() == null || siteId == null || Objects.equals(g.siteId(), siteId)));
    }

    /** user_can_access_site(user, site): may work in that lab. */
    public boolean canAccess(String siteId) {
        return systemAdmin || (siteId != null && memberSites.contains(siteId));
    }

    /** user_can_view_site(user, site): may open that lab, at least to look. */
    public boolean canView(String siteId) {
        return canAccess(siteId) || can("data.view_all", null);
    }
}
