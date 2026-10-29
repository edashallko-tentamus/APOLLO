package com.tentamus.lims.masterdata.domain;

import com.tentamus.lims.core.db.RecordWriter;
import java.util.List;

/**
 * A controlled list kept on an admin page (matrices, units, analytes...): how it is read, which fields a grid may write,
 * whether a save is electronically signed, and the domain record whose rules each saved row passes.
 *
 * @param table   the table the list is kept in
 * @param select  the list, in the order the page shows it
 * @param signing what a save is signed as; null when saves are not signed
 * @param rules   the row's rules; null for a list without any (e.g. holidays)
 */
public record ControlledList(String table, String select, RecordWriter writer, Signing signing, ListRules rules) {

    /** The signature a save carries: meaning, the action as recorded, and the module. */
    public record Signing(String meaning, String action, String module) {}

    public static ControlledList of(String table, String select, List<String> fields) {
        return new ControlledList(table, select, new RecordWriter(table, fields), null, null);
    }

    public ControlledList signedAs(String meaning, String action, String module) {
        return new ControlledList(table, select, writer, new Signing(meaning, action, module), rules);
    }

    public ControlledList checkedBy(ListRules rules) {
        return new ControlledList(table, select, writer, signing, rules);
    }
}
