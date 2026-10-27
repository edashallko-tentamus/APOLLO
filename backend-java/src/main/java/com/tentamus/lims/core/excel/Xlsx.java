package com.tentamus.lims.core.excel;

import com.tentamus.lims.core.web.RuleException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * A minimal Excel (.xlsx) writer and reader, as the Node backend's xlsx.js (an .xlsx file is a zip of XML parts; Java's
 * zip does the compression). Writes one sheet with a bold, frozen, filtered header row. Reads the first sheet of any
 * workbook Excel saves (shared or inline strings, numbers, booleans; dates come back as Excel serial numbers), or a CSV.
 */
public final class Xlsx {
    private Xlsx() {}

    /** A table read from a sheet: its headers, and each row as header -> value with "__row" = the sheet's row number. */
    public record Table(List<String> headers, List<Map<String, Object>> rows) {}

    // ---------------------------------------------------------------- write
    /** One sheet: headers, rows (numbers stay numbers, booleans Yes/No, everything else text), column widths in characters. */
    public static byte[] write(String sheetName, List<String> headers, List<List<Object>> rows, List<Integer> widths) {
        StringBuilder cols = new StringBuilder();
        for (int i = 0; i < headers.size(); i++) {
            Integer w = i < widths.size() ? widths.get(i) : null;
            int width = Math.min(60, Math.max(8, w != null && w > 0 ? w : headers.get(i).length() + 4));
            cols.append("<col min=\"").append(i + 1).append("\" max=\"").append(i + 1).append("\" width=\"").append(width).append("\" customWidth=\"1\"/>");
        }
        StringBuilder data = new StringBuilder(row(new ArrayList<>(headers), 0, " s=\"1\""));
        for (int i = 0; i < rows.size(); i++) data.append(row(rows.get(i), i + 1, ""));
        String last = colName(Math.max(0, headers.size() - 1));
        String sheet = """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
            <cols>%s</cols><sheetData>%s</sheetData>
            <autoFilter ref="A1:%s%d"/></worksheet>""".formatted(cols, data, last, rows.size() + 1);
        String safe = esc(sheetName.replaceAll("[\\\\/?*\\[\\]:]", " ").substring(0, Math.min(31, sheetName.length())));
        Map<String, String> files = new LinkedHashMap<>();
        files.put("[Content_Types].xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
            <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>""");
        files.put("_rels/.rels", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""");
        files.put("xl/workbook.xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="%s" sheetId="1" r:id="rId1"/></sheets>
            <definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'%s'!$A$1:$%s$%d</definedName></definedNames></workbook>"""
            .formatted(safe, safe.replace("'", "''"), last, rows.size() + 1));
        files.put("xl/_rels/workbook.xml.rels", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
            <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>""");
        files.put("xl/styles.xml", """
            <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
            <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
            <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7F5EE"/><bgColor indexed="64"/></patternFill></fill></fills>
            <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
            <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>""");
        files.put("xl/worksheets/sheet1.xml", sheet);
        return zip(files);
    }

    private static String row(List<Object> vals, int r, String style) {
        StringBuilder b = new StringBuilder("<row r=\"").append(r + 1).append("\">");
        for (int c = 0; c < vals.size(); c++) {
            Object v = vals.get(c);
            if (v == null || "".equals(v)) continue;
            String ref = colName(c) + (r + 1);
            if (v instanceof Number n && Double.isFinite(n.doubleValue())) b.append("<c r=\"").append(ref).append('"').append(style).append("><v>").append(Js.number(n)).append("</v></c>");
            else if (v instanceof Boolean bo) b.append("<c r=\"").append(ref).append("\" t=\"inlineStr\"").append(style).append("><is><t>").append(bo ? "Yes" : "No").append("</t></is></c>");
            else b.append("<c r=\"").append(ref).append("\" t=\"inlineStr\"").append(style).append("><is><t xml:space=\"preserve\">").append(esc(v.toString())).append("</t></is></c>");
        }
        return b.append("</row>").toString();
    }

    static byte[] zip(Map<String, String> files) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream(); ZipOutputStream z = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, String> f : files.entrySet()) {
                z.putNextEntry(new ZipEntry(f.getKey()));
                z.write(f.getValue().getBytes(StandardCharsets.UTF_8));
                z.closeEntry();
            }
            z.finish();
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---------------------------------------------------------------- read
    /** The first sheet of a workbook, or a CSV (by its name, or when the file does not start like a zip). */
    public static Table read(byte[] buf, String fileName) {
        if ((fileName != null && fileName.toLowerCase().endsWith(".csv")) || (buf.length > 0 && buf[0] != 0x50)) {
            String text = new String(buf, StandardCharsets.UTF_8);
            if (text.startsWith("\uFEFF")) text = text.substring(1);
            return toTable(Csv.parse(text));
        }
        Map<String, String> files = unzip(buf);
        String wb = files.get("xl/workbook.xml");
        if (wb == null) throw new RuleException("This file is not an Excel workbook (.xlsx)");
        Matcher rid = Pattern.compile("<sheet\\b[^>]*\\br:id=\"([^\"]+)\"").matcher(wb);
        String rels = files.getOrDefault("xl/_rels/workbook.xml.rels", "");
        String target = "worksheets/sheet1.xml";
        if (rid.find()) {
            String id = Pattern.quote(rid.group(1));
            Matcher m = Pattern.compile("<Relationship\\b[^>]*Id=\"" + id + "\"[^>]*Target=\"([^\"]+)\"").matcher(rels);
            Matcher m2 = Pattern.compile("<Relationship\\b[^>]*Target=\"([^\"]+)\"[^>]*Id=\"" + id + "\"").matcher(rels);
            if (m.find()) target = m.group(1); else if (m2.find()) target = m2.group(1);
        }
        String path = target.startsWith("/") ? target.substring(1) : "xl/" + target.replaceFirst("^\\./", "");
        String sheet = files.get(path);
        if (sheet == null) throw new RuleException("The first sheet of the workbook could not be read");
        List<String> shared = new ArrayList<>();
        String ss = files.get("xl/sharedStrings.xml");
        if (ss != null) {
            Matcher si = Pattern.compile("<si>([\\s\\S]*?)</si>").matcher(ss);
            while (si.find()) shared.add(texts(si.group(1)));
        }
        List<List<Object>> grid = new ArrayList<>();
        Matcher rowM = Pattern.compile("<row\\b[\\s\\S]*?</row>|<row\\b[^>]*/>").matcher(sheet);
        while (rowM.find()) {
            String row = rowM.group();
            Matcher rn = Pattern.compile("\\br=\"(\\d+)\"").matcher(row);
            int r = (rn.find() ? Integer.parseInt(rn.group(1)) : grid.size() + 1) - 1;
            List<Object> vals = new ArrayList<>();
            Matcher cm = Pattern.compile("<c\\b[^>]*/>|<c\\b[\\s\\S]*?</c>").matcher(row);
            while (cm.find()) {
                String c = cm.group();
                Matcher refM = Pattern.compile("\\br=\"([A-Z]+\\d+)\"").matcher(c);
                Matcher tM = Pattern.compile("\\bt=\"(\\w+)\"").matcher(c);
                Matcher vM = Pattern.compile("<v>([\\s\\S]*?)</v>").matcher(c);
                String t = tM.find() ? tM.group(1) : null;
                String v = vM.find() ? vM.group(1) : null;
                Object val = null;
                if ("s".equals(t)) { int k = Integer.parseInt(v.trim()); val = k < shared.size() ? shared.get(k) : null; }
                else if ("inlineStr".equals(t)) val = texts(c);
                else if ("b".equals(t)) val = "1".equals(v);
                else if ("str".equals(t) || "e".equals(t)) val = v == null ? null : unescape(v);
                else if (v != null) val = Js.toNumber(v);
                if (refM.find()) {
                    int ci = colIndex(refM.group(1));
                    while (vals.size() <= ci) vals.add(null);
                    vals.set(ci, val);
                }
            }
            while (grid.size() <= r) grid.add(new ArrayList<>());
            grid.set(r, vals);
        }
        return toTable(grid);
    }

    /** The joined text of every <t> element in a piece of sheet XML. */
    private static String texts(String xml) {
        StringBuilder b = new StringBuilder();
        Matcher t = Pattern.compile("<t[^>]*>([\\s\\S]*?)</t>").matcher(xml);
        while (t.find()) b.append(t.group(1));
        return unescape(b.toString());
    }

    static Table toTable(List<List<Object>> grid) {
        int hi = -1;
        for (int i = 0; i < grid.size() && hi < 0; i++) if (!blankRow(grid.get(i))) hi = i;
        if (hi < 0) return new Table(List.of(), List.of());
        List<String> headers = new ArrayList<>();
        for (Object h : grid.get(hi)) headers.add(h == null ? "" : Js.string(h).trim());
        List<Map<String, Object>> rows = new ArrayList<>();
        for (int i = hi + 1; i < grid.size(); i++) {
            List<Object> r = grid.get(i);
            if (blankRow(r)) continue;
            Map<String, Object> o = new LinkedHashMap<>();
            o.put("__row", i + 1);
            for (int j = 0; j < headers.size(); j++) if (!headers.get(j).isEmpty()) o.put(headers.get(j), j < r.size() ? r.get(j) : null);
            rows.add(o);
        }
        return new Table(headers.stream().filter(h -> !h.isEmpty()).toList(), rows);
    }

    private static boolean blankRow(List<Object> r) {
        return r == null || r.stream().allMatch(v -> v == null || Js.string(v).trim().isEmpty());
    }

    static Map<String, String> unzip(byte[] buf) {
        Map<String, String> out = new HashMap<>();
        try (ZipInputStream z = new ZipInputStream(new ByteArrayInputStream(buf), StandardCharsets.UTF_8)) {
            boolean any = false;
            for (ZipEntry e; (e = z.getNextEntry()) != null; ) { any = true; out.put(e.getName(), new String(z.readAllBytes(), StandardCharsets.UTF_8)); }
            if (!any) throw new RuleException("This file is not an Excel workbook (.xlsx) or CSV file");
        } catch (IOException e) {
            throw new RuleException("The Excel file is damaged");
        }
        return out;
    }

    // ---------------------------------------------------------------- helpers
    public static String colName(int i) {
        StringBuilder s = new StringBuilder();
        for (int n = i + 1; n > 0; n = (n - 1) / 26) s.insert(0, (char) ('A' + (n - 1) % 26));
        return s.toString();
    }

    static int colIndex(String ref) {
        int n = 0;
        for (char ch : ref.replaceAll("\\d+", "").toCharArray()) n = n * 26 + (ch - 'A' + 1);
        return n - 1;
    }

    static String esc(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
            .replaceAll("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
    }

    static String unescape(String s) {
        Matcher m = Pattern.compile("&(#x[0-9a-fA-F]+|#\\d+|amp|lt|gt|quot|apos);", Pattern.CASE_INSENSITIVE).matcher(s);
        StringBuilder b = new StringBuilder();
        while (m.find()) {
            String k = m.group(1).toLowerCase();
            String r = switch (k) {
                case "amp" -> "&"; case "lt" -> "<"; case "gt" -> ">"; case "quot" -> "\""; case "apos" -> "'";
                default -> new String(Character.toChars(k.startsWith("#x") ? Integer.parseInt(k.substring(2), 16) : Integer.parseInt(k.substring(1))));
            };
            m.appendReplacement(b, Matcher.quoteReplacement(r));
        }
        return m.appendTail(b).toString();
    }
}
