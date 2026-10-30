package com.tentamus.lims.inventory.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.db.RecordWriter;
import com.tentamus.lims.inventory.domain.StorageLocation;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Reads and writes storage locations. */
@Repository
public class StorageLocationRepository {
    public static final RecordWriter WRITER = new RecordWriter("storage_location", List.of("location_code", "location_name", "location_type", "parent_location_id",
        "supported_conditions", "holds_samples", "status"));
    private final Db db;

    public StorageLocationRepository(Db db) { this.db = db; }

    public Map<String, Object> row(String id) { return id == null ? null : db.one("SELECT * FROM storage_location WHERE id = ?::uuid", id); }

    public StorageLocation find(String id) { return StorageLocation.of(row(id)); }

    /** The location and every location above it (at most 50 levels, as the database walked). */
    public List<String> selfAndAbove(String id) {
        if (id == null) return List.of();
        return db.rows("""
            WITH RECURSIVE up(id, parent, depth) AS (
              SELECT id, parent_location_id, 0 FROM storage_location WHERE id = ?::uuid
              UNION ALL SELECT l.id, l.parent_location_id, up.depth + 1 FROM storage_location l JOIN up ON l.id = up.parent WHERE up.depth < 50)
            SELECT id FROM up""", id).stream().map(r -> (String) r.get("id")).toList();
    }
}
