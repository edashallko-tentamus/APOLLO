package com.tentamus.lims.core.web;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.postgresql.util.PSQLException;
import org.postgresql.util.ServerErrorMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * The error contract of the Node backend (server.js): every refusal is 400 {error, code}, with database messages
 * reworded by the same rules (friendly()). Unlike the Node backend, every unexpected error is also logged.
 */
@RestControllerAdvice
public class ApiExceptionHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final Map<String, String> CHECK_MESSAGES = Map.of(
        "analyte_cas_number_check", "CAS Number is not valid (format or check digit).",
        "cas_only_for_chemicals", "Only Chemical analytes can have a CAS Number.",
        "base_only_has_no_prep_fee", "Base Price Only tests cannot have a preparation fee. Choose \"Base + Preparation Fee\".",
        "portal_projects_name_requester", "Portal-built projects must name the requesting contact.",
        "contact_email_check", "Email address is not valid.",
        "requested_test_tat_override_check", "A TAT override cannot be negative.",
        "matrix_matrix_name_check", "Matrix name cannot be blank.");

    @ExceptionHandler(RuleException.class)
    ResponseEntity<Map<String, Object>> rule(RuleException e) {
        return body(HttpStatus.BAD_REQUEST, e.getMessage(), e.code());
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<Map<String, Object>> notFound(NoResourceFoundException e) {
        return body(HttpStatus.NOT_FOUND, "Not found", null);
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    ResponseEntity<Map<String, Object>> badJson(HttpMessageNotReadableException e) {
        return body(HttpStatus.BAD_REQUEST, "Invalid JSON", null);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<Map<String, Object>> other(Exception e) {
        PSQLException pg = find(e);
        if (pg != null && pg.getServerErrorMessage() != null) {
            ServerErrorMessage m = pg.getServerErrorMessage();
            return body(HttpStatus.BAD_REQUEST, friendly(m.getMessage(), m.getDetail()), m.getSQLState());
        }
        log.error("Unexpected error", e);
        return body(HttpStatus.BAD_REQUEST, e.getMessage() == null ? e.toString() : e.getMessage(), null);
    }

    /** server.js friendly(): readable messages for the screen. */
    static String friendly(String m, String detail) {
        if (m == null) return "Database error";
        if (m.contains("duplicate key value")) return "That value already exists (must be unique). " + (detail == null ? "" : detail);
        Matcher check = Pattern.compile("violates check constraint \"?(\\w+)").matcher(m);
        if (check.find()) return CHECK_MESSAGES.getOrDefault(check.group(1), m);
        if (m.contains("violates not-null constraint")) {
            Matcher col = Pattern.compile("column \"(\\w+)\"").matcher(m);
            return "A required field is empty: " + (col.find() ? col.group(1).replace('_', ' ') : "");
        }
        if (m.contains("invalid input syntax")) return "A value is in the wrong format: " + m.replaceFirst("^.*?: ", "");
        if (m.contains("No user context")) return "Select who you are (top right) before making changes.";
        if (m.contains("Reason for Change is required")) return m.replace(" (SET lims.reason)", "");
        return m;
    }

    private static PSQLException find(Throwable t) {
        for (Throwable x = t; x != null; x = x.getCause()) if (x instanceof PSQLException p) return p;
        return null;
    }

    static ResponseEntity<Map<String, Object>> body(HttpStatus status, String error, String code) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("error", error);
        b.put("code", code);
        return ResponseEntity.status(status).body(b);
    }
}
