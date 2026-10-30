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
 * @param keeper  who may change it; null when the route checks it (or nobody is checked)
 */
public record ControlledList(String table, String select, RecordWriter writer, Signing signing, ListRules rules, Keeper keeper) {

    /** The signature a save carries: meaning, the action as recorded, and the module. */
    public record Signing(String meaning, String action, String module) {}

    /**
     * Who may change the list (the database's permission trigger until migration 072): a permission in the lab being
     * worked in (a shared list), or at the row's own lab (atLab), with the refusal the database gave (null: its general one).
     */
    public record Keeper(String permission, boolean atLab, String refusal) {}

    public static ControlledList of(String table, String select, List<String> fields) {
        return new ControlledList(table, select, new RecordWriter(table, fields), null, null, null);
    }

    public ControlledList signedAs(String meaning, String action, String module) {
        return new ControlledList(table, select, writer, new Signing(meaning, action, module), rules, keeper);
    }

    public ControlledList checkedBy(ListRules rules) {
        return new ControlledList(table, select, writer, signing, rules, keeper);
    }

    /** Kept by holders of the permission in the lab being worked in. */
    public ControlledList keptBy(String permission) {
        return new ControlledList(table, select, writer, signing, rules, new Keeper(permission, false, null));
    }

    /** Kept by holders of the permission in the lab being worked in, refused with the given words. */
    public ControlledList keptBy(String permission, String refusal) {
        return new ControlledList(table, select, writer, signing, rules, new Keeper(permission, false, refusal));
    }

    /** Kept, row by row, by holders of the permission at the row's lab (its site_id). */
    public ControlledList keptAtLabBy(String permission) {
        return new ControlledList(table, select, writer, signing, rules, new Keeper(permission, true, null));
    }
}
