package com.tentamus.lims.labsetup.domain;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A report template's design (migration 074): blocks and settings that the server's own renderers draw (CoaDocument,
 * InvoiceDocument). Nothing in a design is HTML, a script or a link: the designer picks from fixed choices, so every
 * template keeps the COA's checked values visible and in place (the data-check read-back). A COA design always has the
 * header first and the signature and verification code last; between them the client, sample, tests and in-progress
 * blocks (once each, required), photos (at most once) and free text (up to 5), in the designer's order.
 */
public final class ReportDesign {
    private ReportDesign() {}

    private static final ObjectMapper JSON = new ObjectMapper();

    /** Fonts as CSS stacks, by the name the designer shows. */
    public static final Map<String, String> FONTS = Map.of(
        "Sans serif", "\"Helvetica Neue\", Arial, sans-serif",
        "Serif", "Georgia, \"Times New Roman\", serif");
    /** Accent colours (headings, rules, table heads): all dark enough to read on white; values are always near-black. */
    public static final List<String> ACCENTS = List.of("#1f3a2c", "#1b3a5c", "#0f4c4c", "#3d2a5c", "#5c1f1f", "#6b3e00", "#3b3b3b", "#000000");
    public static final List<Integer> SIZES = List.of(9, 10, 11);

    public static final String COA_TITLE = "CERTIFICATE OF ANALYSIS";
    public static final String DISCLAIMER = "The results relate only to the sample tested, as received. This certificate may not be reproduced except in full without the laboratory's written approval.";
    /** Fields a COA design may hide; the checked ones (order, sample ID, client sample ID, lot) and the client's name always print. */
    public static final List<String> CLIENT_FIELDS = List.of("address", "contact", "po", "license");
    public static final List<String> SAMPLE_FIELDS = List.of("description", "matrix", "product", "batch", "metrc_id", "category", "serving", "received", "condition");
    public static final List<String> TEST_OPTIONS = List.of("show_method", "show_test_version", "show_tested_dates", "show_loq");
    static final Set<String> REQUIRED = Set.of("client", "sample", "tests", "pending");
    static final Set<String> BLOCKS = Set.of("client", "sample", "photos", "tests", "pending", "text");
    public static final List<String> INVOICE_FLAGS = List.of("show_list_price", "show_discount", "show_rush", "show_date");
    static final int MAX_TEXT = 2000, MAX_TEXT_BLOCKS = 5;

    // ---------------------------------------------------------------- defaults
    public static Map<String, Object> defaults(String type) {
        Map<String, Object> d = new LinkedHashMap<>();
        d.put("theme", map("font", "Sans serif", "size", 10, "accent", ACCENTS.get(0)));
        if ("Invoice".equals(type)) {
            d.put("title", "Invoice");
            d.put("credit_title", "Credit note");
            d.put("company_line", "Tentamus North America");
            for (String f : INVOICE_FLAGS) d.put(f, true);
            d.put("payment_text", "");
            d.put("footer_text", "");
            return d;
        }
        d.put("title", COA_TITLE);
        d.put("header", map("show_logo", true, "show_address", true, "show_accreditation", true));
        List<Object> blocks = new ArrayList<>();
        blocks.add(map("type", "client", "fields", allTrue(CLIENT_FIELDS)));
        blocks.add(map("type", "sample", "fields", allTrue(SAMPLE_FIELDS)));
        blocks.add(map("type", "photos", "count", 0));
        Map<String, Object> tests = map("type", "tests");
        for (String o : TEST_OPTIONS) tests.put(o, true);
        blocks.add(tests);
        blocks.add(map("type", "pending"));
        d.put("blocks", blocks);
        d.put("disclaimer", DISCLAIMER);
        return d;
    }

    /**
     * The design as the renderers use it: the stored one filled out with the defaults. A template from before 074
     * stores {layout, options}: its options become the tests block's and its title, its layout the photo count.
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> normalize(String type, Object raw) {
        Map<String, Object> in = asMap(raw);
        Map<String, Object> d = defaults(type);
        if (in.isEmpty()) return d;
        if ("COA".equals(type) && (in.containsKey("layout") || in.containsKey("options")) && !in.containsKey("blocks")) {
            Map<String, Object> o = asMap(in.get("options"));
            for (Map<String, Object> b : (List<Map<String, Object>>) d.get("blocks")) {
                if ("tests".equals(b.get("type"))) for (String k : TEST_OPTIONS) if (o.containsKey(k)) b.put(k, !Boolean.FALSE.equals(o.get(k)) && !"false".equals(String.valueOf(o.get(k))));
                if ("photos".equals(b.get("type"))) b.put("count", "COA with 2 photos".equals(in.get("layout")) ? 2 : "COA with 1 photo".equals(in.get("layout")) ? 1 : 0);
            }
            if (o.get("title") != null && !String.valueOf(o.get("title")).isBlank()) d.put("title", String.valueOf(o.get("title")));
            return d;
        }
        for (Map.Entry<String, Object> e : in.entrySet()) {
            if ("theme".equals(e.getKey()) || "header".equals(e.getKey())) ((Map<String, Object>) d.get(e.getKey())).putAll(asMap(e.getValue()));
            else d.put(e.getKey(), e.getValue() instanceof JsonNode n ? JSON.convertValue(n, Object.class) : e.getValue());
        }
        return d;
    }

    // ---------------------------------------------------------------- the check before a draft is saved
    /** Refuses a design the renderers cannot draw safely; returns it normalized. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> check(String type, Object raw) {
        Map<String, Object> in = asMap(raw);
        Map<String, Object> d = normalize(type, raw);
        Set<String> known = defaults(type).keySet();
        for (String k : in.keySet()) if (!known.contains(k)) throw RuleException.database("Unknown design setting \"" + k + "\"");
        Map<String, Object> theme = asMap(d.get("theme"));
        if (!FONTS.containsKey(String.valueOf(theme.get("font")))) throw RuleException.database("Pick a font from the list");
        if (!(theme.get("size") instanceof Number n) || !SIZES.contains(n.intValue())) throw RuleException.database("Text size is 9, 10 or 11 points");
        if (!ACCENTS.contains(String.valueOf(theme.get("accent")))) throw RuleException.database("Pick an accent colour from the list");
        text(d, "title", 80, true);
        if ("Invoice".equals(type)) {
            text(d, "credit_title", 80, true);
            text(d, "company_line", 120, false);
            text(d, "payment_text", MAX_TEXT, false);
            text(d, "footer_text", MAX_TEXT, false);
            for (String f : INVOICE_FLAGS) bool(d, f);
            return d;
        }
        Map<String, Object> header = asMap(d.get("header"));
        for (String k : header.keySet()) if (!List.of("show_logo", "show_address", "show_accreditation").contains(k)) throw RuleException.database("Unknown header setting \"" + k + "\"");
        for (String k : header.keySet()) bool(header, k);
        text(d, "disclaimer", MAX_TEXT, true);
        if (!(d.get("blocks") instanceof List<?> blocks)) throw RuleException.database("The design has no blocks");
        Map<String, Integer> count = new LinkedHashMap<>();
        for (Object o : blocks) {
            Map<String, Object> b = asMap(o);
            String t = String.valueOf(b.get("type"));
            if (!BLOCKS.contains(t)) throw RuleException.database("Unknown block \"" + t + "\"");
            count.merge(t, 1, Integer::sum);
            switch (t) {
                case "client" -> fields(b, CLIENT_FIELDS);
                case "sample" -> fields(b, SAMPLE_FIELDS);
                case "photos" -> { if (!(b.get("count") instanceof Number c) || c.intValue() < 0 || c.intValue() > 2) throw RuleException.database("A photo block prints 0, 1 or 2 photos"); }
                case "tests" -> { for (String k : TEST_OPTIONS) bool(b, k); }
                case "text" -> text(b, "text", MAX_TEXT, true);
                default -> { }
            }
        }
        for (String r : REQUIRED) if (count.getOrDefault(r, 0) != 1) throw RuleException.database("The design needs exactly one " + blockName(r) + " block");
        if (count.getOrDefault("photos", 0) > 1) throw RuleException.database("The design has more than one photo block");
        if (count.getOrDefault("text", 0) > MAX_TEXT_BLOCKS) throw RuleException.database("At most " + MAX_TEXT_BLOCKS + " text blocks");
        return d;
    }

    /** How many report photos a COA design prints (0, 1 or 2). */
    public static int photoCount(Map<String, Object> design) {
        if (design.get("blocks") instanceof List<?> l) for (Object o : l) {
            Map<String, Object> b = asMap(o);
            if ("photos".equals(b.get("type")) && b.get("count") instanceof Number n) return n.intValue();
        }
        return 0;
    }

    public static String blockName(String type) {
        return switch (type) {
            case "client" -> "Client"; case "sample" -> "Sample"; case "tests" -> "Test results"; case "pending" -> "Tests in progress";
            case "photos" -> "Photos"; default -> "Text";
        };
    }

    // ---------------------------------------------------------------- helpers
    private static void text(Map<String, Object> m, String k, int max, boolean required) {
        Object v = m.get(k);
        if (v != null && !(v instanceof String)) throw RuleException.database("\"" + k + "\" must be text");
        String s = v == null ? "" : (String) v;
        if (required && s.isBlank()) throw RuleException.database("Type the " + k.replace('_', ' '));
        if (s.length() > max) throw RuleException.database("\"" + k.replace('_', ' ') + "\" is longer than " + max + " characters");
    }

    private static void bool(Map<String, Object> m, String k) {
        if (!(m.get(k) instanceof Boolean)) throw RuleException.database("\"" + k + "\" must be yes or no");
    }

    private static void fields(Map<String, Object> b, List<String> allowed) {
        Map<String, Object> f = asMap(b.get("fields"));
        for (String k : f.keySet()) if (!allowed.contains(k)) throw RuleException.database("Unknown field \"" + k + "\"");
        for (String k : f.keySet()) bool(f, k);
    }

    private static Map<String, Object> allTrue(List<String> keys) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (String k : keys) m.put(k, true);
        return m;
    }

    /** A design value as a Map (JSON object, JsonNode or JSON text); anything else is empty. */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object v) {
        try {
            if (v instanceof Map<?, ?> m) return new LinkedHashMap<>((Map<String, Object>) m);
            if (v instanceof JsonNode n && n.isObject()) return JSON.convertValue(n, LinkedHashMap.class);
            if (v instanceof String s && s.trim().startsWith("{")) return JSON.readValue(s, LinkedHashMap.class);
            if (v != null && v.getClass().getName().equals("org.postgresql.util.PGobject")) return asMap(v.toString());
        } catch (Exception e) {
            throw RuleException.database("The design is not readable");
        }
        return new LinkedHashMap<>();
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }
}
