package com.tentamus.lims.core.excel;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class XlsxTest {
    @Test
    void aWrittenSheetReadsBack() {
        byte[] file = Xlsx.write("Inventory <test>", List.of("ID", "Name", "Amount", "Holds"),
            List.of(Arrays.asList("INV-000001", "Lead & <Cadmium> \"std\"", 12.5, true), Arrays.asList("", "Iron", 3, null)), List.of(12, 30, 9, 9));
        Xlsx.Table t = Xlsx.read(file, "export.xlsx");
        assertEquals(List.of("ID", "Name", "Amount", "Holds"), t.headers());
        Map<String, Object> first = t.rows().get(0);
        assertEquals(2, first.get("__row"));
        assertEquals("Lead & <Cadmium> \"std\"", first.get("Name"));
        assertEquals(12.5, first.get("Amount"));
        assertEquals("Yes", first.get("Holds"));
        assertNull(t.rows().get(1).get("ID"));
        assertEquals(3.0, t.rows().get(1).get("Amount"));
    }

    @Test
    void csvWithQuotesAndBlankLines() {
        String csv = "﻿Code,Name\r\nU1,\"micro, litre\"\r\n\r\nU2,\"say \"\"hi\"\"\"\n";
        Xlsx.Table t = Xlsx.read(csv.getBytes(StandardCharsets.UTF_8), "units.csv");
        assertEquals(List.of("Code", "Name"), t.headers());
        assertEquals(2, t.rows().size());
        assertEquals("micro, litre", t.rows().get(0).get("Name"));
        assertEquals("say \"hi\"", t.rows().get(1).get("Name"));
        assertEquals(4, t.rows().get(1).get("__row"));   // the sheet's line (the blank line 3 is skipped), as Node's reader numbers it
    }

    @Test
    void numbersAreWrittenAsJavaScriptWritesThem() {
        assertEquals("5", Js.number(5.0));
        assertEquals("5.5", Js.number(new java.math.BigDecimal("5.50")));
        assertEquals("0.001", Js.number(0.001));
        assertEquals("0", Js.number(new java.math.BigDecimal("0.00")));
        assertEquals(Double.NaN, Js.toNumber("abc"));
        assertEquals(0.0, Js.toNumber(" "));
    }

    @Test
    void columnNames() {
        assertEquals("A", Xlsx.colName(0));
        assertEquals("Z", Xlsx.colName(25));
        assertEquals("AA", Xlsx.colName(26));
        assertEquals(27, Xlsx.colIndex("AB12"));
    }
}
