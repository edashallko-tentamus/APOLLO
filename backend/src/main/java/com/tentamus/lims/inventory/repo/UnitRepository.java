package com.tentamus.lims.inventory.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.inventory.domain.Units;
import com.tentamus.lims.inventory.domain.Values;
import org.springframework.stereotype.Repository;

/** Loads the Units list and the Unit conversions table as one {@link Units}. */
@Repository
public class UnitRepository {
    private final Db db;

    public UnitRepository(Db db) { this.db = db; }

    public Units load() {
        return new Units(
            db.rows("SELECT id, unit_code, dimension::text AS dimension, status::text = 'Active' AS active FROM unit_of_measure ORDER BY sort_order, unit_code").stream()
                .map(r -> new Units.Unit((String) r.get("id"), (String) r.get("unit_code"), (String) r.get("dimension"), Boolean.TRUE.equals(r.get("active")))).toList(),
            db.rows("SELECT from_unit_id, to_unit_id, factor, applies_to::text AS applies_to, status::text = 'Active' AS active FROM unit_conversion ORDER BY created_at, id").stream()
                .map(r -> new Units.Conversion((String) r.get("from_unit_id"), (String) r.get("to_unit_id"), Values.dec(r.get("factor")), (String) r.get("applies_to"),
                    Boolean.TRUE.equals(r.get("active")))).toList());
    }
}
