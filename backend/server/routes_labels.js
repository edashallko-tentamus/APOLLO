// Barcode labels (Alex, 2026-10-13; vault: "Decision - Media Qualification, Batch Edits and Barcode Labels"): what each
// label shows, for samples, inventory lots, equipment and batches. The screens draw the Code 128 barcode and lay the
// labels out for the Dymo LabelWriter 450 (samples 2 1/8 x 4 in., everything else 1 x 2 1/8 in.). Read only.
'use strict';

module.exports = function registerLabels({ route, checkSite, currentSite, isUuid }) {
  const idsOf = (c) => String(c.query.ids || '').split(',').map((x) => x.trim()).filter(isUuid).slice(0, 500);
  const sameLab = async (c, rows) => { for (const s of new Set(rows.map((x) => x.site_id))) await checkSite(c, s); return rows; };

  route('GET', '/api/labels/:kind', async (c) => {
    await currentSite(c);
    const ids = idsOf(c);
    if (!ids.length) throw new Error('Choose what to print labels for');
    switch (c.params.kind) {
      case 'sample':
        return sameLab(c, await c.db.rows(`SELECT s.id, s.sample_code, s.client_sample_id, s.description, s.matrix, s.lot AS product_lot, s.number_of_units,
            (s.logged_at AT TIME ZONE ls.time_zone)::date::text AS logged_at,
            o.order_code, o.site_id, COALESCE(cl.display_name, cl.legal_name) AS client_name,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('test_name', t.test_name, 'due_date', rt.due_date, 'rush', rt.rush_status IN ('Auto-accepted','Approved')) ORDER BY rt.due_date NULLS LAST, t.test_name)
                        FROM requested_test rt JOIN test t ON t.id = rt.test_id WHERE rt.sample_id = s.id AND rt.status <> 'Cancelled'), '[]') AS tests
          FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client cl ON cl.id = o.client_id JOIN lab_site ls ON ls.id = o.site_id
         WHERE s.id = ANY($1::uuid[]) AND s.sample_code IS NOT NULL ORDER BY s.sample_code`, [ids]));
      case 'lot':
        return sameLab(c, await c.db.rows(`SELECT l.id, l.lot_code, l.item_name, l.manufacturer_lot, l.expiration_date, l.retest_date, l.received_date, l.opened_date,
            l.container_count, l.storage_condition::text AS storage_condition, l.site_id, media_status(l.id) AS media_status, lot_qa_status(l.id) AS qa_status
          FROM inventory_lot l WHERE l.id = ANY($1::uuid[]) ORDER BY l.lot_code`, [ids]));
      case 'equipment':
        return sameLab(c, await c.db.rows(`SELECT e.id, e.equipment_code, e.equipment_name, e.type_name, e.serial_number, e.model, e.cal_expires, e.calibration_status,
            e.maintenance_due, e.site_id FROM equipment_view e WHERE e.id = ANY($1::uuid[]) ORDER BY e.equipment_code`, [ids]));
      case 'batch':
        return sameLab(c, await c.db.rows(`SELECT b.id, b.batch_code, b.test_name, b.test_code, b.version_no, b.site_id, b.created_at, b.assigned_name,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('position', e.position, 'label', e.label, 'entry_type', e.entry_type, 'qc_type', e.qc_type, 'sample_code', s.sample_code) ORDER BY e.position)
                        FROM batch_entry e LEFT JOIN requested_test rt ON rt.id = e.requested_test_id LEFT JOIN sample s ON s.id = rt.sample_id
                       WHERE e.batch_id = b.id AND e.status = 'Active' AND e.daily_of_entry_id IS NULL), '[]') AS entries
          FROM test_batch_view b WHERE b.id = ANY($1::uuid[]) ORDER BY b.batch_code`, [ids]));
      default:
        throw new Error('Unknown kind of label');
    }
  });
};
