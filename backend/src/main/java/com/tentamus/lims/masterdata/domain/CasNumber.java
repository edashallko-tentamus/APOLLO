package com.tentamus.lims.masterdata.domain;

import java.util.regex.Pattern;

/**
 * A CAS Registry Number with its check digit (e.g. 7439-92-1). Java's copy of the database function is_valid_cas, which
 * stays in the database for the inventory checks that still call it.
 */
public final class CasNumber {
    private static final Pattern FORMAT = Pattern.compile("^\\d{2,7}-\\d{2}-\\d$");

    private CasNumber() {}

    /** True for none at all, or a well-formed number whose check digit is right. */
    public static boolean isValid(String cas) {
        if (cas == null) return true;
        if (!FORMAT.matcher(cas).matches()) return false;
        String digits = cas.substring(0, cas.lastIndexOf('-')).replace("-", "");
        int total = 0, n = digits.length();
        for (int i = 1; i <= n; i++) total += (digits.charAt(n - i) - '0') * i;
        return total % 10 == cas.charAt(cas.length() - 1) - '0';
    }
}
