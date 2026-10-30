package com.tentamus.lims.equipment.repo;

import com.tentamus.lims.core.db.Db;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Who is responsible for a piece of equipment: groups of its lab and/or named people. The list given is the complete
 * set; owners not in it are set Inactive (kept as history), never deleted.
 */
public final class EquipmentOwners {
    private EquipmentOwners() {}

    public static void sync(Db d, Object equipmentId, List<Map<String, Object>> owners) {
        List<Map<String, Object>> cur = d.rows("SELECT * FROM equipment_owner WHERE equipment_id = ?::uuid", equipmentId);
        Set<String> want = new LinkedHashSet<>();
        for (Map<String, Object> o : owners) if (set(o.get("group_id")) || set(o.get("user_id"))) want.add(key(o));
        for (String k : want) {
            Map<String, Object> ex = cur.stream().filter(o -> key(o).equals(k)).findFirst().orElse(null);
            if (ex == null) d.update("INSERT INTO equipment_owner (equipment_id, group_id, user_id) VALUES (?::uuid, ?::uuid, ?::uuid)",
                equipmentId, k.charAt(0) == 'g' ? k.substring(1) : null, k.charAt(0) == 'u' ? k.substring(1) : null);
            else if (!"Active".equals(ex.get("status"))) d.update("UPDATE equipment_owner SET status = 'Active' WHERE id = ?::uuid", ex.get("id"));
        }
        for (Map<String, Object> ex : cur)
            if ("Active".equals(ex.get("status")) && !want.contains(key(ex))) d.update("UPDATE equipment_owner SET status = 'Inactive' WHERE id = ?::uuid", ex.get("id"));
    }

    private static String key(Map<String, Object> o) { return set(o.get("group_id")) ? "g" + o.get("group_id") : "u" + o.get("user_id"); }

    private static boolean set(Object v) { return v != null && !"".equals(v) && !Boolean.FALSE.equals(v); }
}
