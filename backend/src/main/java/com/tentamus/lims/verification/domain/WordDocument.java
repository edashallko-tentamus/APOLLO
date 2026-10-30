package com.tentamus.lims.verification.domain;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.BiFunction;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * A minimal Word (.docx) writer (docx.js): a zip of XML parts with a title, headings, paragraphs with bold, italic,
 * coloured or monospaced runs, tables with a shaded header row, PNG images, page breaks, a landscape Letter page, and a
 * footer with "Page X of Y".
 */
public final class WordDocument {
    private static final int PAGE_W = 15840, PAGE_H = 12240, MARGIN = 720, USABLE_W = PAGE_W - 2 * MARGIN;
    private final List<String> body = new ArrayList<>();
    private final List<byte[]> images = new ArrayList<>();

    /** A run of text with its look; null fields mean the default. */
    public record Run(String text, boolean bold, boolean italic, String color, Double size, boolean mono) {
        public static Run of(String text) { return new Run(text, false, false, null, null, false); }
        public Run bolded() { return new Run(text, true, italic, color, size, mono); }
        public Run sized(double s) { return new Run(text, bold, italic, color, s, mono); }
        public Run colored(String c) { return new Run(text, bold, italic, c, size, mono); }
        public Run italics() { return new Run(text, bold, true, color, size, mono); }
        public Run monospaced() { return new Run(text, bold, italic, color, size, true); }
    }

    public static String esc(Object s) {
        String x = s == null ? "" : s.toString();
        StringBuilder b = new StringBuilder();
        for (char c : x.toCharArray()) {
            switch (c) {
                case '&' -> b.append("&amp;");
                case '<' -> b.append("&lt;");
                case '>' -> b.append("&gt;");
                case '"' -> b.append("&quot;");
                default -> { if (c >= 0x20 || c == 0x09 || c == 0x0A || c == 0x0D) b.append(c); }
            }
        }
        return b.toString();
    }

    static String run(Run r) {
        StringBuilder p = new StringBuilder();
        if (r.bold()) p.append("<w:b/>");
        if (r.italic()) p.append("<w:i/>");
        if (r.color() != null) p.append("<w:color w:val=\"").append(r.color()).append("\"/>");
        if (r.size() != null && r.size() != 0) { long h = Math.round(r.size() * 2); p.append("<w:sz w:val=\"").append(h).append("\"/><w:szCs w:val=\"").append(h).append("\"/>"); }
        if (r.mono()) p.append("<w:rFonts w:ascii=\"Consolas\" w:hAnsi=\"Consolas\"/>");
        String[] lines = (r.text() == null ? "" : r.text()).split("\n", -1);
        StringBuilder t = new StringBuilder();
        for (int i = 0; i < lines.length; i++) t.append(i > 0 ? "<w:br/>" : "").append("<w:t xml:space=\"preserve\">").append(esc(lines[i])).append("</w:t>");
        return "<w:r>" + (p.length() > 0 ? "<w:rPr>" + p + "</w:rPr>" : "") + t + "</w:r>";
    }

    /** Paragraph options: style, align, spaceAfter (null for none), keepNext, breakBefore. */
    public record Para(String style, String align, Integer spaceAfter, boolean keepNext, boolean breakBefore) {
        public static final Para NONE = new Para(null, null, null, false, false);
        public static Para after(int s) { return new Para(null, null, s, false, false); }
    }

    static String para(List<Run> runs, Para o) {
        StringBuilder pp = new StringBuilder();
        if (o.style() != null) pp.append("<w:pStyle w:val=\"").append(o.style()).append("\"/>");
        if (o.keepNext()) pp.append("<w:keepNext/>");
        if (o.breakBefore()) pp.append("<w:pageBreakBefore/>");
        if (o.spaceAfter() != null) pp.append("<w:spacing w:after=\"").append(o.spaceAfter()).append("\"/>");
        if (o.align() != null) pp.append("<w:jc w:val=\"").append(o.align()).append("\"/>");
        StringBuilder rs = new StringBuilder();
        for (Run r : runs) rs.append(run(r));
        return "<w:p>" + (pp.length() > 0 ? "<w:pPr>" + pp + "</w:pPr>" : "") + rs + "</w:p>";
    }

    public WordDocument title(String text, String sub) {
        body.add(para(List.of(new Run(text, true, false, "1F3A2C", 20.0, false)), Para.after(60)));
        if (sub != null && !sub.isEmpty()) body.add(para(List.of(new Run(sub, false, false, "5C6773", 11.0, false)), Para.after(200)));
        return this;
    }

    public WordDocument h1(String text, boolean newPage) { body.add(para(List.of(Run.of(text)), new Para("Heading1", null, null, true, newPage))); return this; }

    public WordDocument h2(String text, boolean newPage) { body.add(para(List.of(Run.of(text)), new Para("Heading2", null, null, true, newPage))); return this; }

    public WordDocument p(String text) { return p(List.of(Run.of(text)), Para.NONE); }

    public WordDocument p(List<Run> runs, Para o) { body.add(para(runs, o)); return this; }

    /**
     * A table: rows of cells; a cell is a String, a Run or a List of Runs. widths are fractions of the page width; fill
     * gives a row's shading (or null).
     */
    public WordDocument table(List<List<Object>> rows, double[] widths, boolean header, double size, BiFunction<List<Object>, Integer, String> fill) {
        int n = rows.stream().mapToInt(List::size).max().orElse(0);
        long[] ws = new long[n];
        for (int i = 0; i < n; i++) ws[i] = Math.round((widths != null ? widths[i] : 1.0 / n) * USABLE_W);
        StringBuilder trs = new StringBuilder();
        for (int ri = 0; ri < rows.size(); ri++) {
            List<Object> r = rows.get(ri);
            boolean isHead = header && ri == 0;
            String shade = isHead ? "E6ECEF" : fill != null ? fill.apply(r, ri) : null;
            trs.append("<w:tr>").append(isHead ? "<w:trPr><w:tblHeader/></w:trPr>" : "<w:trPr><w:cantSplit/></w:trPr>");
            for (int i = 0; i < r.size(); i++) {
                List<Run> runs = new ArrayList<>();
                Object c = r.get(i);
                List<?> parts = c instanceof List<?> l ? l : java.util.Collections.singletonList(c);
                for (Object x : parts) {
                    if (x instanceof Run rr) runs.add(new Run(rr.text(), rr.bold() || isHead, rr.italic(), rr.color(), rr.size() != null ? rr.size() : size, rr.mono()));
                    else runs.add(new Run(x == null ? null : x.toString(), isHead, false, null, size, false));
                }
                trs.append("<w:tc><w:tcPr><w:tcW w:w=\"").append(i < ws.length ? ws[i] : "undefined").append("\" w:type=\"dxa\"/>")
                    .append(shade != null ? "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"" + shade + "\"/>" : "").append("</w:tcPr>").append(para(runs, Para.after(0))).append("</w:tc>");
            }
            trs.append("</w:tr>");
        }
        StringBuilder grid = new StringBuilder();
        for (long w : ws) grid.append("<w:gridCol w:w=\"").append(w).append("\"/>");
        body.add("<w:tbl><w:tblPr><w:tblStyle w:val=\"Grid\"/><w:tblW w:w=\"" + USABLE_W + "\" w:type=\"dxa\"/><w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid>" + grid + "</w:tblGrid>" + trs + "</w:tbl>");
        body.add(para(List.of(Run.of("")), Para.after(120)));
        return this;
    }

    public WordDocument table(List<List<Object>> rows, double[] widths, double size) { return table(rows, widths, true, size, null); }

    /** A PNG scaled to fit the box (inches), keeping its proportions. */
    public WordDocument image(byte[] png, Integer width, Integer height, double maxW, double maxH) {
        int w = width != null && width != 0 ? width : ByteBuffer.wrap(png, 16, 4).getInt();
        int h = height != null && height != 0 ? height : ByteBuffer.wrap(png, 20, 4).getInt();
        double k = Math.min(Math.min(maxW / (w / 96.0), maxH / (h / 96.0)), 1);
        long cx = Math.round((w / 96.0) * k * 914400), cy = Math.round((h / 96.0) * k * 914400);
        int n = images.size() + 1;
        images.add(png);
        body.add("<w:p><w:pPr><w:jc w:val=\"center\"/><w:spacing w:after=\"60\"/></w:pPr><w:r><w:drawing><wp:inline distT=\"0\" distB=\"0\" distL=\"0\" distR=\"0\"><wp:extent cx=\"" + cx + "\" cy=\"" + cy + "\"/><wp:docPr id=\"" + n + "\" name=\"Evidence " + n + "\"/>"
            + "<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" noChangeAspect=\"1\"/></wp:cNvGraphicFramePr>"
            + "<a:graphic xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\">"
            + "<pic:pic xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:nvPicPr><pic:cNvPr id=\"" + n + "\" name=\"image" + n + ".png\"/><pic:cNvPicPr/></pic:nvPicPr>"
            + "<pic:blipFill><a:blip r:embed=\"rImg" + n + "\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>"
            + "<pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"" + cx + "\" cy=\"" + cy + "\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>"
            + "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>");
        return this;
    }

    private static String fld(String code) {
        return "<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r><w:r><w:instrText xml:space=\"preserve\"> " + code + " </w:instrText></w:r><w:r><w:fldChar w:fldCharType=\"separate\"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType=\"end\"/></w:r>";
    }

    /** The .docx file, with the footer text (also its title) and the author. */
    public byte[] build(String footer, String author) {
        String ns = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" "
            + "xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" "
            + "xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"";
        String sect = "<w:sectPr><w:footerReference w:type=\"default\" r:id=\"rFooter\"/><w:pgSz w:w=\"" + PAGE_W + "\" w:h=\"" + PAGE_H + "\" w:orient=\"landscape\"/>"
            + "<w:pgMar w:top=\"" + MARGIN + "\" w:right=\"" + MARGIN + "\" w:bottom=\"" + MARGIN + "\" w:left=\"" + MARGIN + "\" w:header=\"360\" w:footer=\"360\" w:gutter=\"0\"/></w:sectPr>";
        String document = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document " + ns + "><w:body>" + String.join("", body) + sect + "</w:body></w:document>";
        String footerXml = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:ftr " + ns + "><w:p><w:pPr><w:tabs><w:tab w:val=\"right\" w:pos=\"" + USABLE_W + "\"/></w:tabs><w:rPr><w:sz w:val=\"16\"/></w:rPr></w:pPr>"
            + run(new Run(footer, false, false, "5C6773", 8.0, false)) + "<w:r><w:rPr><w:sz w:val=\"16\"/></w:rPr><w:tab/><w:t xml:space=\"preserve\">Page </w:t></w:r>" + fld("PAGE")
            + "<w:r><w:rPr><w:sz w:val=\"16\"/></w:rPr><w:t xml:space=\"preserve\"> of </w:t></w:r>" + fld("NUMPAGES") + "</w:p></w:ftr>";
        StringBuilder borders = new StringBuilder();
        for (String b : new String[] {"top", "left", "bottom", "right", "insideH", "insideV"}) borders.append("<w:").append(b).append(" w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"BFC7CE\"/>");
        String styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">"
            + "<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/><w:sz w:val=\"20\"/><w:szCs w:val=\"20\"/></w:rPr></w:rPrDefault>"
            + "<w:pPrDefault><w:pPr><w:spacing w:after=\"100\" w:line=\"264\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>"
            + "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>"
            + "<w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"280\" w:after=\"100\"/><w:outlineLvl w:val=\"0\"/></w:pPr><w:rPr><w:b/><w:color w:val=\"1F3A2C\"/><w:sz w:val=\"28\"/></w:rPr></w:style>"
            + "<w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:pPr><w:keepNext/><w:spacing w:before=\"200\" w:after=\"80\"/><w:outlineLvl w:val=\"1\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"23\"/></w:rPr></w:style>"
            + "<w:style w:type=\"table\" w:styleId=\"Grid\"><w:name w:val=\"Table Grid\"/><w:tblPr><w:tblBorders>" + borders
            + "</w:tblBorders><w:tblCellMar><w:top w:w=\"40\" w:type=\"dxa\"/><w:left w:w=\"80\" w:type=\"dxa\"/><w:bottom w:w=\"40\" w:type=\"dxa\"/><w:right w:w=\"80\" w:type=\"dxa\"/></w:tblCellMar></w:tblPr></w:style></w:styles>";
        StringBuilder rels = new StringBuilder("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + "<Relationship Id=\"rStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>"
            + "<Relationship Id=\"rFooter\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/>");
        for (int i = 1; i <= images.size(); i++) rels.append("<Relationship Id=\"rImg").append(i).append("\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image").append(i).append(".png\"/>");
        rels.append("</Relationships>");
        String types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
            + "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Default Extension=\"png\" ContentType=\"image/png\"/>"
            + "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
            + "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>"
            + "<Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/>"
            + "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/></Types>";
        String now = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString();
        String core = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">"
            + "<dc:title>" + esc(footer) + "</dc:title><dc:creator>" + esc(author) + "</dc:creator><dcterms:created xsi:type=\"dcterms:W3CDTF\">" + now + "</dcterms:created></cp:coreProperties>";
        String rootRels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
            + "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
            + "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/></Relationships>";
        Map<String, byte[]> parts = new LinkedHashMap<>();
        parts.put("[Content_Types].xml", utf8(types));
        parts.put("_rels/.rels", utf8(rootRels));
        parts.put("docProps/core.xml", utf8(core));
        parts.put("word/document.xml", utf8(document));
        parts.put("word/styles.xml", utf8(styles));
        parts.put("word/footer1.xml", utf8(footerXml));
        parts.put("word/_rels/document.xml.rels", utf8(rels.toString()));
        for (int i = 0; i < images.size(); i++) parts.put("word/media/image" + (i + 1) + ".png", images.get(i));
        return zip(parts);
    }

    private static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    static byte[] zip(Map<String, byte[]> parts) {
        try (ByteArrayOutputStream out = new ByteArrayOutputStream(); ZipOutputStream z = new ZipOutputStream(out, StandardCharsets.UTF_8)) {
            for (Map.Entry<String, byte[]> p : parts.entrySet()) {
                z.putNextEntry(new ZipEntry(p.getKey()));
                z.write(p.getValue());
                z.closeEntry();
            }
            z.finish();
            return out.toByteArray();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }
}
