package com.tentamus.lims.inventory.service;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.inventory.domain.SampleRetain;
import com.tentamus.lims.inventory.domain.StorageLocation;
import com.tentamus.lims.inventory.domain.ThresholdRule;
import com.tentamus.lims.inventory.repo.StorageLocationRepository;
import com.tentamus.lims.masterdata.domain.Unit;
import com.tentamus.lims.masterdata.domain.UnitConversion;
import com.tentamus.lims.masterdata.repo.MasterDataRepository;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Runs the rules of one list row about to be written (storage locations, warning rules, sample storage, and the master
 * data's units and conversions), for the list screens and the Excel upload alike. Each returns the row to write
 * (with its id when it has one), or the row unchanged when it is an update of a record that does not exist.
 */
@org.springframework.stereotype.Component
public class ListRowRules {
    private final StorageLocationRepository locations;
    private final MasterDataRepository master;

    public ListRowRules(StorageLocationRepository locations, MasterDataRepository master) {
        this.locations = locations;
        this.master = master;
    }

    /** One table's row as it will be: the stored row with the changes, or the changes and fixed values of a new row. */
    private static Map<String, Object> after(Map<String, Object> stored, Map<String, Object> changes, Map<String, Object> fixed) {
        Map<String, Object> a = new LinkedHashMap<>(stored == null ? fixed : stored);
        a.putAll(changes);
        return a;
    }

    private static Map<String, Object> withId(Map<String, Object> row, Map<String, Object> vals) {
        Map<String, Object> out = new LinkedHashMap<>(vals);
        if (row.get("id") != null) out.put("id", row.get("id"));
        return out;
    }

    public Map<String, Object> location(Db d, Map<String, Object> row, Map<String, Object> vals, String site) {
        Map<String, Object> stored = row.get("id") == null ? null : d.one("SELECT * FROM storage_location WHERE id = ?::uuid", row.get("id"));
        if (row.get("id") != null && stored == null) return row;
        Map<String, Object> a = after(stored, vals, Map.of("site_id", site));
        String parentId = a.get("parent_location_id") == null ? null : a.get("parent_location_id").toString();
        StorageLocation parent = locations.find(parentId);
        return withId(row, StorageLocation.checked(StorageLocation.of(stored), a, vals, parent, locations.selfAndAbove(parentId)));
    }

    public Map<String, Object> threshold(Db d, Map<String, Object> row, Map<String, Object> vals) {
        Map<String, Object> stored = row.get("id") == null ? null : d.one("SELECT * FROM threshold_rule WHERE id = ?::uuid", row.get("id"));
        if (row.get("id") != null && stored == null) return row;
        ThresholdRule.check(after(stored, vals, Map.of()));
        return withId(row, vals);
    }

    /** Sample storage of a sample of this lab (the caller checks the lab). */
    public Map<String, Object> sampleStorage(Db d, Map<String, Object> row, Map<String, Object> vals, String site) {
        Map<String, Object> stored = d.one("SELECT * FROM sample WHERE id = ?::uuid", row.get("id"));
        if (stored == null) return row;
        Map<String, Object> a = after(stored, vals, Map.of());
        Object loc = a.get("storage_location_id");
        return withId(row, SampleRetain.checked(a, vals, loc == null ? null : locations.find(loc.toString()), site));
    }

    public Map<String, Object> unit(Db d, Map<String, Object> row, Map<String, Object> vals) {
        Map<String, Object> stored = row.get("id") == null ? null : d.one("SELECT * FROM unit_of_measure WHERE id = ?::uuid", row.get("id"));
        return withId(row, new Unit(stored, vals).check(master.facts(d)));
    }

    public Map<String, Object> conversion(Db d, Map<String, Object> row, Map<String, Object> vals) {
        Map<String, Object> stored = row.get("id") == null ? null : d.one("SELECT * FROM unit_conversion WHERE id = ?::uuid", row.get("id"));
        return withId(row, new UnitConversion(stored, vals).check(master.facts(d)));
    }

    /** The rules of the list a bulk upload writes; lots go through {@link LotWriter}. */
    public Map<String, Object> forKind(String kind, Db d, Map<String, Object> row, Map<String, Object> vals, String site) {
        return switch (kind) {
            case "locations" -> location(d, row, vals, site);
            case "thresholds" -> threshold(d, row, vals);
            case "samplestorage" -> sampleStorage(d, row, vals, site);
            case "units" -> unit(d, row, vals);
            case "conversions" -> conversion(d, row, vals);
            default -> row;
        };
    }

    static final List<String> CHECKED = List.of("locations", "thresholds", "samplestorage", "units", "conversions");
}
