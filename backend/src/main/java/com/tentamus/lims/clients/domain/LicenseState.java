package com.tentamus.lims.clients.domain;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/**
 * Where a license stands on a given day (the lab's day): Retired, Expired, Expiring soon (within 30 days) or Current,
 * and how many days are left. Replaces the database functions license_state and license_state_on.
 */
public record LicenseState(String state, Integer daysLeft) {
    public static final int SOON_DAYS = 30;

    public static LicenseState on(LocalDate expires, String status, LocalDate today) {
        Integer left = expires == null ? null : (int) ChronoUnit.DAYS.between(today, expires);
        String s;
        if ("Retired".equals(status)) s = "Retired";
        else if (expires == null) s = "Current";
        else if (expires.isBefore(today)) s = "Expired";
        else if (!expires.isAfter(today.plusDays(SOON_DAYS))) s = "Expiring soon";
        else s = "Current";
        return new LicenseState(s, left);
    }

    /** For sorting a list: expired first, then expiring soon, then the rest. */
    public int urgency() {
        return switch (state) { case "Expired" -> 0; case "Expiring soon" -> 1; default -> 2; };
    }
}
