package com.tentamus.lims.inventory.service;

import com.tentamus.lims.core.access.AccessPolicy;
import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.core.web.RequestContext;
import com.tentamus.lims.inventory.domain.Lot;
import com.tentamus.lims.inventory.domain.LotQaTesting;
import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.domain.Values;
import com.tentamus.lims.inventory.repo.LotRepository;
import com.tentamus.lims.inventory.repo.StorageLocationRepository;
import com.tentamus.lims.waste.domain.WasteClassification;
import com.tentamus.lims.waste.repo.WasteRepository;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * Saves a lot through its rules: loads the stored lot, applies the changes to a {@link Lot}, lets it check itself
 * (with its storage location, units, chemical and mixture components), settles its waste classification and, for a new
 * lot, whether it needs QA testing, then writes it. Used by the item screens, Receive many and the Excel upload.
 */
@org.springframework.stereotype.Component
public class LotWriter {
    private final LotRepository lots;
    private final StorageLocationRepository locations;
    private final WasteRepository waste;
    private final AccessPolicy access;

    public LotWriter(LotRepository lots, StorageLocationRepository locations, WasteRepository waste, AccessPolicy access) {
        this.lots = lots;
        this.locations = locations;
        this.waste = waste;
        this.access = access;
    }

    /** What a save needs to know besides the row: the units, the lab's date, the "Send for QA testing" choice and who saves. */
    public record Save(Units units, LocalDate today, Object qaChoice, RequestContext ctx, boolean disposing) {}

    /**
     * A grid or form row: an update when it has an id (only its listed columns), else an insert with the fixed values.
     * Returns {id}, null for an update whose lot does not exist, or nothing (null id) for an update with no change.
     */
    public Map<String, Object> save(Db d, RecordWriter writer, Map<String, Object> row, Map<String, Object> fixed, Save s) {
        Map<String, Object> vals = writer.pick(row);
        String id = row.get("id") == null ? null : row.get("id").toString();
        if (id != null) {
            if (vals.isEmpty()) return Map.of();
            Lot before = lots.find(d, id);
            if (before == null) return null;
            write(d, before, vals, s);
            return Map.of("id", id);
        }
        Map<String, Object> all = new LinkedHashMap<>(vals);
        all.putAll(fixed);
        return Map.of("id", write(d, null, all, s));
    }

    /** Checks and writes a lot (insert when before is null); returns its id. */
    public String write(Db d, Lot before, Map<String, Object> changes, Save s) {
        Map<String, Object> ch = new LinkedHashMap<>(changes);
        Lot after = before == null ? Lot.of(ch) : before.with(ch);
        settleWaste(d, before, after, ch);
        after = before == null ? Lot.of(ch) : before.with(ch);
        String transferSource = after.transferredFrom() == null ? null : lots.find(d, after.transferredFrom()).siteId();
        Lot.Context ctx = new Lot.Context(s.units(), locations.find(after.storageLocationId()), transferSource, s.today(),
            before == null ? null : lots.earliestComponentExpiry(d, before.id()), s.disposing(), lots.chemical(d, after.values().get("chemical_id")));
        Map<String, Object> out = after.checkSave(before, ch, ctx);
        if (before == null) {
            String choice = qaChoice(s.qaChoice());
            boolean configure = RequestContext.isUuid(s.ctx().userId()) && access.load(s.ctx().userId()).can("inventory.qa_configure", after.siteId());
            LotQaTesting.requiredAtReceipt(choice, lots.typesTheLabTests(d, after.siteId(), after.types().types()), configure);
            d.one("SELECT set_config('lims.qa_testing', ?, true)", choice);
            return lots.insert(d, out);
        }
        lots.update(d, before.id(), out);
        return before.id();
    }

    /** A chosen classification must be usable at the lot's lab; none chosen takes the lab's default for the item's types. */
    private void settleWaste(Db d, Lot before, Lot after, Map<String, Object> ch) {
        Object chosen = after.values().get("waste_classification_id");
        Object was = before == null ? null : before.values().get("waste_classification_id");
        if (chosen != null && !"".equals(chosen)) {
            if (before != null && Objects.equals(String.valueOf(chosen), String.valueOf(was))) return;
            WasteClassification w = waste.find(d, chosen);
            // a transferred lot arrives with its sender's lab classification: the receiving lab's default instead
            if (before == null && w != null && w.siteId() != null && !w.siteId().equals(after.siteId())) chosen = null;
            else if (w != null) { w.assertChoosableAt(after.siteId()); return; }
        }
        boolean typesChanged = before != null && !before.types().equals(after.types());
        if (before == null || was != null || typesChanged) {
            WasteClassification def = WasteClassification.defaultFor(after.siteId(), after.types().types(), waste.candidates(d, after.siteId()));
            ch.put("waste_classification_id", def == null ? null : def.id());
        }
    }

    /** "1" needs QA testing, "0" does not (QA's call), "" the lab's default. */
    static String qaChoice(Object v) {
        return Boolean.TRUE.equals(v) || "1".equals(v) ? "1" : Boolean.FALSE.equals(v) || "0".equals(v) ? "0" : "";
    }

    /** Reference Standards and Microbiological Strains name an analyte, once the whole save is done. */
    public void assertAnalyteNamed(Db d, String lotId) {
        Lot l = lots.find(d, lotId);
        if (l != null) l.assertHasAnalyte(lots.activeAnalytes(d, lotId));
    }

    static boolean blank(Object v) { return Values.blank(v); }
}
