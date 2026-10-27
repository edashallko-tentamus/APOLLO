package com.tentamus.lims.inventory.bulk;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import java.util.List;

/**
 * A list that can be exported to Excel and uploaded back.
 *
 * @param list            the rows, in the order exported ("?" = the lab, when siteScoped)
 * @param key             the field that identifies a row in the sheet
 * @param creates         whether rows without a match are created
 * @param newKeyGenerated whether the system gives new rows their key (then the key column must be empty for a new row)
 * @param module          the module the upload's signature is recorded under
 * @param afterRow        what is saved after each row besides its fields (equipment: its owners); null when nothing
 */
public record BulkKind(String title, String table, boolean siteScoped, String key, boolean creates, boolean newKeyGenerated, String list,
                       List<BulkColumn> cols, String module, AfterRow afterRow) {

    /** A step after a row is written, given what the row's derived column read (e.g. the owners). */
    @FunctionalInterface
    public interface AfterRow { void apply(Db d, Object id, Object value); }

    public BulkKind(String title, String table, boolean siteScoped, String key, boolean creates, boolean newKeyGenerated, String list,
                    List<BulkColumn> cols, String module) {
        this(title, table, siteScoped, key, creates, newKeyGenerated, list, cols, module, null);
    }

    public BulkColumn keyColumn() { return cols.stream().filter(c -> key.equals(c.field())).findFirst().orElseThrow(); }

    /** The fields an upload may write (editable columns, not the derived ones). */
    public List<String> writableFields() {
        return cols.stream().filter(c -> !c.readOnly() && c.field() != null && !c.field().startsWith("__")).map(BulkColumn::field).toList();
    }

    public RecordWriter writer() { return new RecordWriter(table, writableFields()); }
}
