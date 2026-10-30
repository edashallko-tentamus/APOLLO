package com.tentamus.lims.core.excel;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class XlsxWorkbookTest {
    private static Map<String, String> book() {
        Xlsx.Sheet summary = new Xlsx.Sheet("Summary", List.of(
            Arrays.asList(Xlsx.Cell.of("Performance report", "title")),
            Arrays.asList("CFL", Xlsx.Cell.formula(1234.5, "SUMIFS('Invoices'!$M$2:$M$3,'Invoices'!$C$2:$C$3,\"CFL\")", "money0"), Xlsx.Cell.formula(null, "B2-E2", "pct"),
                Xlsx.Cell.of(null, "money0"), true)), List.of(26), 0, false, false);
        Xlsx.Sheet raw = new Xlsx.Sheet("Invoices", List.of(Arrays.asList(Xlsx.Cell.of("invoice_date", "head"), Xlsx.Cell.of("issued_at", "head")),
            Arrays.asList(Xlsx.Cell.date("2026-10-14"), Xlsx.Cell.dateTime("2026-10-14T12:00:00.000Z"))), List.of(14, 12), 1, true, true);
        return Xlsx.unzip(Xlsx.writeWorkbook(List.of(summary, raw)));
    }

    @Test
    void summaryCellsCarryStylesFormulasAndCachedValues() {
        String s = book().get("xl/worksheets/sheet1.xml");
        assertTrue(s.contains("<c r=\"A1\" t=\"inlineStr\" s=\"2\">"), s);
        assertTrue(s.contains("<c r=\"B2\" s=\"16\"><f>SUMIFS('Invoices'!$M$2:$M$3,'Invoices'!$C$2:$C$3,&quot;CFL&quot;)</f><v>1234.5</v></c>"), s);
        assertTrue(s.contains("<c r=\"C2\" s=\"4\"><f>B2-E2</f></c>"), s);
        assertTrue(s.contains("<c r=\"D2\" s=\"16\"/>"), s);
        assertTrue(s.contains("<t>Yes</t>"), s);
        assertTrue(s.contains("tabSelected=\"1\" showGridLines=\"0\">"), s);
    }

    @Test
    void datesAreSerialNumbersWithTheirStyles() {
        String s = book().get("xl/worksheets/sheet2.xml");
        assertTrue(s.contains("<c r=\"A2\" s=\"11\"><v>46309</v></c>"), s);
        assertTrue(s.contains("<c r=\"B2\" s=\"14\"><v>46309.5</v></c>"), s);
        assertTrue(s.contains("<pane ySplit=\"1\" topLeftCell=\"A2\""), s);
        assertTrue(s.contains("<autoFilter ref=\"A1:B2\"/>"), s);
        assertTrue(book().get("xl/workbook.xml").contains("<definedName name=\"_xlnm._FilterDatabase\" localSheetId=\"1\" hidden=\"1\">'Invoices'!$A$1:$B$2</definedName>"));
        assertEquals(46309.0, Xlsx.serial("2026-10-14"));
    }
}
