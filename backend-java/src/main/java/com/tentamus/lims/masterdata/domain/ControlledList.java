package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.db.RecordWriter;
import java.util.List;

/**
 * A controlled list kept on an admin page (matrices, units, analytes...): how it is read, which fields a grid may write,
 * and whether a save is electronically signed.
 *
 * @param select  the list, in the order the page shows it
 * @param signing what a save is signed as; null when saves are not signed
 */
public record ControlledList(String select, RecordWriter writer, Signing signing) {

    /** The signature a save carries: meaning, the action as recorded, and the module. */
    public record Signing(String meaning, String action, String module) {}

    public static ControlledList of(String table, String select, List<String> fields) {
        return new ControlledList(select, new RecordWriter(table, fields), null);
    }

    public ControlledList signedAs(String meaning, String action, String module) {
        return new ControlledList(select, writer, new Signing(meaning, action, module));
    }
}
