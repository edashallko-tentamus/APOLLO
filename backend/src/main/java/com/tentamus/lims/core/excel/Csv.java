package com.tentamus.lims.core.excel;

import java.util.ArrayList;
import java.util.List;

/** CSV as Excel writes it: commas, double quotes around values that need them ("" inside), CR, LF or CRLF line ends. */
final class Csv {
    private Csv() {}

    /** Rows of cells; an empty cell is null. */
    static List<List<Object>> parse(String text) {
        List<List<Object>> out = new ArrayList<>();
        List<Object> row = new ArrayList<>();
        StringBuilder cur = new StringBuilder();
        boolean q = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (q) {
                if (ch == '"') { if (i + 1 < text.length() && text.charAt(i + 1) == '"') { cur.append('"'); i++; } else q = false; }
                else cur.append(ch);
            } else if (ch == '"') q = true;
            else if (ch == ',') { row.add(cell(cur)); cur.setLength(0); }
            else if (ch == '\n' || ch == '\r') {
                if (ch == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') i++;
                row.add(cell(cur)); out.add(row); row = new ArrayList<>(); cur.setLength(0);
            } else cur.append(ch);
        }
        if (cur.length() > 0 || !row.isEmpty()) { row.add(cell(cur)); out.add(row); }
        return out;
    }

    private static Object cell(StringBuilder b) { return b.length() == 0 ? null : b.toString(); }
}
