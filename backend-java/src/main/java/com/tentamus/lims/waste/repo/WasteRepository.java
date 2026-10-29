package com.tentamus.lims.waste.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.inventory.domain.Values;
import com.tentamus.lims.waste.domain.WasteClassification;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Reads waste classifications as domain objects (the lists the screens show stay as rows in WasteService). */
@Repository
public class WasteRepository {
    private static final String SELECT = "SELECT id, site_id, waste_name, status::text = 'Active' AS active, default_for::text AS default_for FROM waste_classification";
    private final Db db;

    public WasteRepository(Db db) { this.db = db; }

    public Map<String, Object> row(Db d, Object id) { return d.one("SELECT *, default_for::text AS default_for, status::text AS status FROM waste_classification WHERE id = ?::uuid", id); }

    public WasteClassification find(Db d, Object id) {
        Map<String, Object> r = d.one(SELECT + " WHERE id = ?::uuid", id);
        return r == null ? null : of(r);
    }

    /** The active classifications an item at this lab may take, shared ones included, in their sort order. */
    public List<WasteClassification> candidates(Db d, String site) {
        return d.rows(SELECT + " WHERE status = 'Active' AND (site_id IS NULL OR site_id = ?::uuid) ORDER BY sort_order, waste_code", site).stream().map(WasteRepository::of).toList();
    }

    /** The other active classifications of the same list (the lab's own, or the shared ones). */
    public List<WasteClassification> sameList(Db d, String site) {
        return d.rows(SELECT + " WHERE status = 'Active' AND site_id IS NOT DISTINCT FROM ?::uuid", site).stream().map(WasteRepository::of).toList();
    }

    private static WasteClassification of(Map<String, Object> r) {
        return new WasteClassification((String) r.get("id"), (String) r.get("site_id"), (String) r.get("waste_name"), Boolean.TRUE.equals(r.get("active")),
            Values.list(r.get("default_for")));
    }

}
