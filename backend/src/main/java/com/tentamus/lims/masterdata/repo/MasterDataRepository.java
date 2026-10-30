package com.tentamus.lims.masterdata.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.core.excel.Js;
import com.tentamus.lims.masterdata.domain.ControlledList;
import com.tentamus.lims.masterdata.domain.MasterFacts;
import com.tentamus.lims.masterdata.domain.UnitGraph;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.springframework.stereotype.Repository;

/** Reads the master lists, one stored row, the facts the lists' rules need, and the unit graph. SQL only here. */
@Repository
public class MasterDataRepository {
    private static final Pattern IDENT = Pattern.compile("^[a-z_]+$");
    private final Db db;

    public MasterDataRepository(Db db) { this.db = db; }

    public List<Map<String, Object>> read(ControlledList list, Object... params) { return db.rows(list.select(), params); }

    /** The stored row of a list, or null when there is none. */
    public Map<String, Object> find(Db d, ControlledList list, String id) {
        if (!IDENT.matcher(list.table()).matches()) throw new IllegalArgumentException("Bad table " + list.table());
        return d.one("SELECT * FROM " + list.table() + " WHERE id::text = ?", id);
    }

    public List<Map<String, Object>> timezones() {
        return db.rows("SELECT name FROM pg_timezone_names WHERE name ~ '^(America|Europe|Asia|Australia|Pacific|Africa)/' ORDER BY name");
    }

    public UnitGraph unitGraph() {
        List<UnitGraph.UnitOfMeasure> units = db.rows("SELECT id, unit_code, dimension::text AS dimension, sort_order, status::text AS status FROM unit_of_measure").stream()
            .map(r -> new UnitGraph.UnitOfMeasure((String) r.get("id"), (String) r.get("unit_code"), (String) r.get("dimension"),
                ((Number) r.get("sort_order")).intValue(), "Active".equals(r.get("status")))).toList();
        List<UnitGraph.Conversion> conversions = db.rows("SELECT from_unit_id, to_unit_id, factor, applies_to, status::text AS status FROM unit_conversion").stream()
            .map(r -> new UnitGraph.Conversion((String) r.get("from_unit_id"), (String) r.get("to_unit_id"), new BigDecimal(r.get("factor").toString()),
                (String) r.get("applies_to"), "Active".equals(r.get("status")))).toList();
        return new UnitGraph(units, conversions);
    }

    /** The facts the lists' rules need, read inside the given transaction (so earlier rows of the same save count). */
    public MasterFacts facts(Db d) {
        return new MasterFacts() {
            @Override
            public boolean matrixUsedOnSamples(String matrixName) {
                return exists(d, "SELECT EXISTS (SELECT 1 FROM sample WHERE lower(matrix) = lower(?)) AS x", matrixName);
            }

            @Override
            public boolean unitUsedOnInventory(String unitCode) {
                return exists(d, "SELECT EXISTS (SELECT 1 FROM inventory_lot WHERE unit = ? OR concentration_unit = ?) AS x", unitCode, unitCode);
            }

            @Override
            public boolean unitHasActiveConversions(String unitId) {
                return exists(d, "SELECT EXISTS (SELECT 1 FROM unit_conversion WHERE (from_unit_id::text = ? OR to_unit_id::text = ?) AND status = 'Active') AS x",
                    unitId, unitId);
            }

            @Override
            public String unitDimension(String unitId) {
                Map<String, Object> r = d.one("SELECT dimension::text AS d FROM unit_of_measure WHERE id::text = ?", unitId);
                return r == null ? null : (String) r.get("d");
            }

            @Override
            public boolean isTimeZone(String name) {
                return name != null && exists(d, "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ?) AS x", name);
            }
        };
    }

    private static boolean exists(Db d, String sql, Object... params) { return Js.truthy(d.one(sql, params).get("x")); }
}
