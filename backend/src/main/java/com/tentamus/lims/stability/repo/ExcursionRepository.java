package com.tentamus.lims.stability.repo;

import com.tentamus.lims.core.db.Db;
import java.util.Map;
import org.springframework.stereotype.Repository;

/** Records QA's excursion assessments (the rules are in ExcursionAssessment). */
@Repository
public class ExcursionRepository {
    public boolean isExcursion(Db d, Object study, Object entry) {
        return entry != null && d.one("SELECT 1 AS x FROM stability_excursion_view WHERE study_id = ?::uuid AND logbook_entry_id = ?::uuid LIMIT 1", study, entry) != null;
    }

    /**
     * Replaces the active assessment: the excursion as read (equipment, local time, problems, reason) and the pulls of the
     * exposed material taken after the last good reading before it, and those still to come.
     */
    public Map<String, Object> record(Db d, Object study, Object entry, String decision, String justification) {
        // the study's records change only through its steps (stability_record_rules): this is one of them
        d.one("SELECT set_config('lims.stability_internal', '1', true) AS x");
        d.update("UPDATE stability_excursion_assessment SET status = 'Inactive' WHERE study_id = ?::uuid AND logbook_entry_id = ?::uuid AND status = 'Active'", study, entry);
        Map<String, Object> r = d.one("""
            INSERT INTO stability_excursion_assessment (study_id, logbook_entry_id, storage_id, decision, justification, excursion_text, affected_pull_ids, signature_id)
            SELECT x.study_id, x.logbook_entry_id, x.storage_id, ?, ?,
                   x.equipment_code || ' ' || x.equipment_name || ', ' || to_char(x.entry_at AT TIME ZONE (SELECT time_zone FROM lab_site WHERE id = st.site_id), 'Mon DD, YYYY HH24:MI') || ': '
                     || array_to_string(x.problems, '; ') || COALESCE(' (' || x.failure_reason || ')', ''),
                   COALESCE((SELECT array_agg(p.id ORDER BY p.scheduled_date) FROM stability_pull p WHERE p.storage_id = x.storage_id AND p.status <> 'Cancelled'
                              AND (p.pulled_at IS NULL OR p.pulled_at >= x.window_start)), '{}'),
                   NULLIF(current_setting('lims.signature_id', true), '')::uuid
              FROM (SELECT * FROM stability_excursion_view WHERE study_id = ?::uuid AND logbook_entry_id = ?::uuid LIMIT 1) x JOIN stability_study st ON st.id = x.study_id
            RETURNING id""", decision, justification, study, entry);
        d.one("SELECT set_config('lims.stability_internal', '', true) AS x");
        return r;
    }
}
