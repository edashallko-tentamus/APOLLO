// Admin > Lab setup > Waste classifications (0.30.0, migration 052): how each inventory item is disposed of
import { useMemo } from 'react';
import { getWaste, saveWaste } from '../../api/waste.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';

const AUDIT = { kind: 'waste' };
const TEXT_FIELDS = ['waste_name', 'epa_codes', 'waste_stream', 'container', 'disposal_instructions', 'segregation', 'status'];
const csv = (a) => (Array.isArray(a) ? a.join(', ') : a || '');
const split = (v) => String(v || '').split(/[,;]/).map((x) => x.trim()).filter(Boolean);
const listCheck = (allowed) => (v) => { const bad = split(v).filter((x) => !allowed.some((a) => a.toLowerCase() === x.toLowerCase())); return bad.length ? 'Not on the list: ' + bad.join(', ') : null; };
// shortcut: the old grid rewrote these cells in the list's spelling as typed (column `canon`); the React grid has no such hook,
// so the spelling is corrected when saving instead (the saved values are the same). Move it into the cell when the grid gets `canon`.
const canon = (allowed) => (v) => split(v).map((x) => allowed.find((a) => a.toLowerCase() === x.toLowerCase()) || x).join(', ');
const rowClass = (r) => (r.status === 'Inactive' ? 'mutedrow' : '');

export default function WastePage() {
  const { data: d, error, reload } = useApi(getWaste, []);

  const view = useMemo(() => {
    if (!d) return null;
    const mayEdit = (r) => (r.site_id ? d.can_edit : d.sysadmin);
    const ed = (r, isNew) => isNew || mayEdit(r);
    const canAny = d.can_edit || d.sysadmin;
    const rows = d.rows.map((r) => ({ ...r, lab: r.site_id ? d.lab.site_code : 'Every lab', hazards: csv(r.hazard_classes), defaults: csv(r.default_for) }));
    const columns = [
      { field: 'waste_code', title: 'Code', type: 'readonly', width: 70 },
      { field: 'waste_name', title: 'Classification', width: 250, required: true, editable: ed },
      { field: 'lab', title: 'Lab', type: 'select', options: [d.lab.site_code, 'Every lab'], width: 90, editable: (r, isNew) => isNew },
      { field: 'hazards', title: 'Hazard classes', width: 190, editable: ed, validate: listCheck(d.hazard_classes), help: 'Comma-separated: ' + d.hazard_classes.join(', ') },
      { field: 'epa_codes', title: 'EPA codes', width: 130, editable: ed, help: 'e.g. D001, F003 (RCRA), and state codes as the lab uses them' },
      { field: 'waste_stream', title: 'Waste stream', width: 170, editable: ed, help: 'The accumulation container it goes to' },
      { field: 'container', title: 'Container', width: 190, editable: ed },
      { field: 'disposal_instructions', title: 'How to dispose of it', width: 300, editable: ed },
      { field: 'segregation', title: 'Keep away from', width: 220, editable: ed },
      { field: 'defaults', title: 'Default for', width: 190, editable: ed, validate: listCheck(d.item_types), help: 'Item types that get this classification when none is chosen on the item' },
      { field: 'needs_review', title: 'Needs review', type: 'bool', width: 95, editable: ed, help: 'A placeholder: its items still have to be classified from their SDS' },
      { field: 'items_in_use', title: 'Items', type: 'readonly', width: 60 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90, editable: ed },
    ];
    const newRow = () => ({ status: 'Active', lab: d.can_edit ? d.lab.site_code : 'Every lab', needs_review: false, hazards: '', defaults: '' });
    const save = (changed, reason) => saveWaste(changed.map((r) => {
      const out = { id: r.id };
      for (const k of TEXT_FIELDS) if (r[k] !== undefined) out[k] = r[k];
      if (r.needs_review !== undefined) out.needs_review = r.needs_review === true || r.needs_review === 'true';
      if (r.hazards !== undefined) out.hazard_classes = canon(d.hazard_classes)(r.hazards).split(', ').filter(Boolean);
      if (r.defaults !== undefined) out.default_for = canon(d.item_types)(r.defaults).split(', ').filter(Boolean);
      if (!r.id) { out.every_lab = (r.lab || '') === 'Every lab'; out.waste_name = r.waste_name; }
      return out;
    }), reason);
    return { canAny, rows, columns, newRow, save };
  }, [d]);

  return <>
    <PageHeader title="Waste classifications" audit={AUDIT}
      subtitle={d ? `How each inventory item is disposed of. Every item has one: chosen on the item, or the default for its type. A classification marked "Needs review" (classify from the SDS) lists its items under Inventory > Waste to classify. Shared classifications (every lab) are kept by system administrators; ${d.lab.site_code}'s own by its Lab Supervisors, QA and General Managers. Confirm hazard classes and codes with the lab's EHS contact.` : ''} />
    {error ? <div className="card err">{error.message}</div> : !view ? <div className="loading">Loading…</div> : (
      <Section title="Classifications" help={`Hazard classes: ${d.hazard_classes.join(', ')}. "Default for" takes item types (${d.item_types.join(', ')}); one default per type in the lab (the lab's own default comes before the shared one). Paste from Excel, fill down with Ctrl+D.`}>
        <EditableGrid rows={view.rows} columns={view.columns} allowAdd={view.canAny} readOnly={!view.canAny} what="the waste classifications"
          newRow={view.newRow} rowClass={rowClass} save={view.save} afterSave={reload} />
      </Section>
    )}
  </>;
}
