package com.tentamus.lims.orders.domain;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;

/**
 * A sample ID, given at logging: the lab's code, the lab's date (yymmdd) and the day's number, three digits until 999,
 * then simply growing (CFL261012001 ... CFL2610121000). IDs already given in the older SITE-YYMMDD-## form never change.
 */
public record SampleCode(String value) {
    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyMMdd");

    public static SampleCode of(String siteCode, LocalDate labDay, int dayNumber) {
        String n = dayNumber < 1000 ? String.format("%03d", dayNumber) : Integer.toString(dayNumber);
        return new SampleCode(siteCode + labDay.format(DAY) + n);
    }

    @Override
    public String toString() { return value; }
}
