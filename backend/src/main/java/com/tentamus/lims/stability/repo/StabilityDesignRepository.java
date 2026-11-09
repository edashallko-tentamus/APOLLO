package com.tentamus.lims.stability.repo;

import com.tentamus.lims.core.db.Db;
import com.tentamus.lims.stability.domain.StabilityDesign;
import java.util.Map;
import org.springframework.stereotype.Repository;

/**
 * The facts the stability setup and design rules decide on (the rules are in StabilitySetup and StabilityDesign).
 * stability_study_of_version and stability_timepoint_used are the database's read functions (the kept amendment
 * functions use them too).
 */
@Repository
public class StabilityDesignRepository {
    public Map<String, Object> row(Db d, String table, Object id) {
        return d.one("SELECT * FROM " + table + " WHERE id = ?::uuid FOR UPDATE", id);
    }

    public Map<String, Object> equipment(Db d, Object id) {
        return d.one("SELECT site_id, equipment_code, admin_status::text = 'Retired' AS retired FROM equipment WHERE id = ?::uuid", id);
    }

    public Map<String, Object> condition(Db d, Object id) {
        return d.one("SELECT id, site_id, status::text = 'Active' AS active, condition_name FROM stability_condition WHERE id = ?::uuid", id);
    }

    public boolean onQuote(Db d, Object condition) {
        return d.one("SELECT 1 AS x FROM stability_version_condition WHERE condition_id = ?::uuid LIMIT 1", condition) != null;
    }

    public boolean chamberHoldsMaterial(Db d, Object chamber) {
        return d.one("SELECT 1 AS x FROM stability_storage s JOIN stability_rack r ON r.id = s.rack_id WHERE r.chamber_id = ?::uuid AND s.status = 'Stored' LIMIT 1", chamber) != null;
    }

    public boolean rackHoldsMaterial(Db d, Object rack) {
        return d.one("SELECT 1 AS x FROM stability_storage WHERE rack_id = ?::uuid AND status = 'Stored' LIMIT 1", rack) != null;
    }

    public String chamberSite(Db d, Object chamber) {
        Map<String, Object> r = d.one("SELECT site_id FROM stability_chamber WHERE id = ?::uuid", chamber);
        return r == null ? null : (String) r.get("site_id");
    }

    /** The design of a version: its lab (the quote's, else the plan's) and the study it amends. */
    public StabilityDesign design(Db d, Object version) {
        Map<String, Object> r = d.one("""
            SELECT COALESCE(p.site_id, pl.site_id) AS site_id, (stability_study_of_version(pv.id)).id AS study_id
              FROM project_version pv JOIN project p ON p.id = pv.project_id LEFT JOIN stability_plan pl ON pl.project_version_id = pv.id WHERE pv.id = ?::uuid""", version);
        return new StabilityDesign((String) r.get("site_id"), (String) r.get("study_id"));
    }

    public Map<String, Object> timepoint(Db d, Object id) {
        return d.one("SELECT id, project_version_id, label, interval_value, interval_unit, carried_from_id, status::text AS status FROM stability_timepoint WHERE id = ?::uuid", id);
    }

    public boolean timepointUsed(Db d, String study, Object carriedFrom, Object condition) {
        if (study == null || carriedFrom == null) return false;
        Map<String, Object> r = d.one("SELECT stability_timepoint_used(?::uuid, ?::uuid, ?::uuid) AS u", study, carriedFrom, condition);
        return r != null && Boolean.TRUE.equals(r.get("u"));
    }

    /** A quote line with its test's lab and name. */
    public Map<String, Object> line(Db d, Object id) {
        return d.one("""
            SELECT q.id, q.project_version_id, q.status::text AS status, t.site_id AS test_site, t.test_name, s.site_code
              FROM quoted_test_configuration q JOIN test t ON t.id = q.test_id LEFT JOIN lab_site s ON s.id = t.site_id WHERE q.id = ?::uuid""", id);
    }

    public boolean conditionOnDesign(Db d, Object version, Object condition) {
        return condition != null && d.one("SELECT 1 AS x FROM stability_version_condition WHERE project_version_id = ?::uuid AND condition_id = ?::uuid AND status = 'Active'",
            version, condition) != null;
    }
}
