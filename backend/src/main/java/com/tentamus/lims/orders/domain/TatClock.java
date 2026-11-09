package com.tentamus.lims.orders.domain;

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.DayOfWeek;
import java.util.Set;

/**
 * The turnaround clock of a lab (decided with Alex, 2026-10-12): Day 0 is the lab's date when the clock starts, moved to the
 * next day after the test's cutoff; business-day tests never start on a weekend or a lab holiday and count only working
 * days; calendar-day tests count every day. Java's own copy of tat_day0, tat_due, is_working_day and next_working_day,
 * which stay in the database for the requested-test trigger, stability and invoicing.
 */
public final class TatClock {
    public static final String BUSINESS = "Business Days";
    public static final String CALENDAR = "Calendar Days";

    private final ZoneId zone;
    private final Set<LocalDate> holidays;

    /** @param holidays the lab's active holidays */
    public TatClock(ZoneId zone, Set<LocalDate> holidays) {
        this.zone = zone;
        this.holidays = Set.copyOf(holidays);
    }

    public boolean isWorkingDay(LocalDate d) {
        return d.getDayOfWeek() != DayOfWeek.SATURDAY && d.getDayOfWeek() != DayOfWeek.SUNDAY && !holidays.contains(d);
    }

    /** The first working day on or after d. */
    public LocalDate nextWorkingDay(LocalDate d) {
        LocalDate x = d;
        while (!isWorkingDay(x)) x = x.plusDays(1);
        return x;
    }

    /** Day 0 for a clock started at this moment, with the test's cutoff time (the lab's local time). */
    public LocalDate day0(Instant start, LocalTime cutoff, String unit) {
        LocalDateTime loc = LocalDateTime.ofInstant(start, zone);
        LocalDate d = loc.toLocalDate();
        if (cutoff != null && loc.toLocalTime().isAfter(cutoff)) d = d.plusDays(1);
        if (BUSINESS.equals(unit)) d = nextWorkingDay(d);
        return d;
    }

    /** The due date: Day 0 plus the turnaround, in calendar days or in working days. */
    public LocalDate due(LocalDate day0, int days, String unit) {
        if (CALENDAR.equals(unit)) return day0.plusDays(days);
        LocalDate d = day0;
        for (int n = 0; n < days; ) {
            d = d.plusDays(1);
            if (isWorkingDay(d)) n++;
        }
        return d;
    }

    /** The clock starts when the sample is logged, or when a test is added to an already logged sample: the later of the two. */
    public static String clockStart(String loggedAt, String createdAt) {
        if (createdAt == null) return loggedAt;
        return instant(createdAt).isAfter(instant(loggedAt)) ? createdAt : loggedAt;
    }

    /** A time as PostgreSQL writes timestamptz text ("2026-10-05 17:00:00.123456+00") or as ISO text. */
    public static Instant instant(String t) {
        String s = t.strip().replace(' ', 'T');
        if (s.matches(".*[+-]\\d\\d$")) s += ":00";
        return java.time.OffsetDateTime.parse(s).toInstant();
    }

    /** The lab's date at this moment (sample IDs and Day 0 use it). */
    public LocalDate labDate(Instant at) { return LocalDateTime.ofInstant(at, zone).toLocalDate(); }
}
