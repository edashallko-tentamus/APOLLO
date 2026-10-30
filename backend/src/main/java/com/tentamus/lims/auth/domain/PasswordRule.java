package com.tentamus.lims.auth.domain;

import java.util.Locale;
import java.util.regex.Pattern;

/** The password rule (Sandbox; QA to confirm for production): at least 10 characters, a letter and a number, not the user ID. */
public final class PasswordRule {
    private static final Pattern LETTER = Pattern.compile("[A-Za-z]");
    private static final Pattern DIGIT = Pattern.compile("[0-9]");

    private PasswordRule() {}

    /** Why the password is refused, or null. A password that is not text (a number, nothing) is too short, as in JavaScript. */
    public static String problem(Object password, String username) {
        if (!(password instanceof String pw) || pw.length() < 10) return "The password must be at least 10 characters.";
        if (!LETTER.matcher(pw).find() || !DIGIT.matcher(pw).find()) return "The password must contain at least one letter and one number.";
        if (username != null && !username.isEmpty() && pw.toLowerCase(Locale.ROOT).contains(username.toLowerCase(Locale.ROOT)))
            return "The password must not contain your user ID.";
        return null;
    }
}
