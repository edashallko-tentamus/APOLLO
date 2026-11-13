// The item page: + New Inventory Item (received now, or a purchase request), Duplicate (?from=<lot>) and Edit.
// Saving is signed; an edit also asks for a Reason for Change. A new item can carry its Supplier COA, and with AI reading
// on, "Read the COA" fills in the form first (Alex, 2026-10-13).
import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createItem, getLot, inventoryMe, inventoryMeta, qaDefaults, readCoa, updateItem } from '../../api/inventory.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import DataGrid from '../../components/grid/DataGrid.jsx';
import { useGrid } from '../../components/grid/useGrid.js';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { fileToBase64, signed } from './dialogs.jsx';
import { d8, Failed, Field, isMixture, loadLookups, Loading, NeedLab, opts, today, withBlank } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const MAX_COA = 3.5 * 1024 * 1024;
// COA field -> form field (onlyEmpty: fill only when nothing was typed)
const COA_MAP = [['chemical_name', 'item_name', true], ['cas_number', 'cas_number'], ['catalog_number', 'catalog_number'], ['manufacturer_lot', 'manufacturer_lot'],
  ['expiration_date', 'expiration_date'], ['retest_date', 'retest_date'], ['purity_pct', 'purity_pct'], ['concentration', 'concentration'], ['concentration_unit', 'concentration_unit']];

export default function ItemPage({ params, query }) {
  const editId = params[0] || null;
  const fromId = editId ? null : new URLSearchParams(query).get('from');
  const { site } = useSession();
  const { data, error } = useApi(() => Promise.all([inventoryMeta(), loadLookups(), editId ? null : qaDefaults().catch(() => null), editId ? null : inventoryMe(),
    editId || fromId ? getLot(editId || fromId, { fresh: true }) : null]), [editId, fromId]);
  if (!site) return <NeedLab />;
  if (error && !data) return <Failed error={error} />;
  if (!data) return <Loading />;
  const [M, L, QA, who, src] = data;
  return <ItemForm key={(editId || '') + (fromId || '')} M={M} L={L} QA={QA} who={who} src={src} editId={editId} />;
}

const str = (v) => (v === null || v === undefined ? '' : String(v));

function ItemForm({ M, L, QA, who, src, editId }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const l = src ? src.lot : {};
  const editing = !!editId; const received = editing && l.receipt_status === 'Received';
  const mixture = editing && isMixture(l);
  const [v, setV] = useState(() => {
    const base = editing ? { ...l, item_name: l.item_name || l.material } : src ? { // duplicate: same item, new lot details
      item_name: l.material, chemical_types: l.chemical_types, physical_form: l.physical_form, cas_number: l.cas_number, supplier_id: l.supplier_id,
      manufacturer_id: l.manufacturer_id, catalog_number: l.catalog_number, quantity_received: l.quantity_received, unit: l.unit,
      concentration: l.concentration, concentration_unit: l.concentration_unit, purity_pct: l.purity_pct, storage_condition: l.storage_condition,
      storage_location_id: l.storage_location_id, department_id: l.department_id, waste_classification_id: l.waste_classification_id, received_date: today() } : { received_date: today(), chemical_types: [] };
    const out = { chemical_types: base.chemical_types || [] };
    for (const k of ['item_name', 'physical_form', 'cas_number', 'catalog_number', 'supplier_id', 'manufacturer_id', 'item_url', 'department_id', 'waste_classification_id',
      'storage_location_id', 'storage_condition', 'manufacturer_lot', 'concentration', 'concentration_unit', 'purity_pct', 'quantity_received', 'unit', 'container_count', 'notes']) out[k] = str(base[k]);
    out.requested_quantity = str(base.requested_quantity ?? base.quantity_received);
    for (const k of ['received_date', 'opened_date', 'expiration_date', 'retest_date']) out[k] = d8(base[k]);
    return out;
  });
  const [touched, setTouched] = useState(false);
  const set = (k) => (x) => { setTouched(true); setV((s) => ({ ...s, [k]: x })); };
  const onInput = (k) => (e) => set(k)(e.target.value);
  const [mode, setMode] = useState(editing ? 'edit' : 'received');
  const request = mode === 'request';
  const types = M.chemical_types.filter((t) => t !== 'In-house mixture' || mixture);

  // ---------------------------------------------------------------- analytes
  const analyteCols = useMemo(() => [
    { field: 'analyte_id', title: 'Analyte', type: 'select', options: L.analyteOpts, width: 220 },
    { field: 'concentration', title: 'Concentration', type: 'number', min: 0, width: 110 },
    { field: 'concentration_unit', title: 'Unit', type: 'select', options: M.conc_units, width: 90 },
    { field: 'expressed_as', title: 'Expressed as', width: 100, help: 'Only when the certificate states the concentration as a compound, e.g. NaCl for a sodium standard' },
    { field: 'formula_weight', title: 'Formula wt (g/mol)', type: 'number', min: 0, width: 110, help: 'Formula weight of the compound named in Expressed as, e.g. 58.44 for NaCl' },
    { field: 'analyte_per_unit', title: 'Atoms per formula', type: 'number', min: 0, width: 100, help: 'How many of the analyte are in one formula unit (1 for Na in NaCl, 2 for Na in Na2SO4). Empty = 1' },
  ], [L, M]);
  const [startAnalytes] = useState(() => (src ? src.analytes : []).map((a) => ({ analyte_id: a.analyte_id, concentration: a.concentration, concentration_unit: a.concentration_unit,
    target_concentration: a.target_concentration, tolerance_pct: a.tolerance_pct, expressed_as: a.expressed_as, formula_weight: a.formula_weight, analyte_per_unit: a.analyte_per_unit })));
  const ag = useGrid({ rows: startAnalytes, columns: analyteCols, keyField: 'analyte_id', allowAdd: true, newRow: () => ({}) });
  const addRows = ag.act.addRows;
  const started = useRef(false); // once, an empty line to start (effects run twice in development)
  useEffect(() => { if (!started.current && !startAnalytes.length && !editing) { started.current = true; addRows(1); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // CAS from a single analyte, if not typed
  useEffect(() => {
    const ids = ag.state.rows.filter((r) => r.analyte_id).map((r) => r.analyte_id);
    if (ids.length !== 1) return;
    const a = L.analytes.find((x) => x.id === ids[0]);
    if (a?.cas_number) setV((s) => (s.cas_number.trim() ? s : { ...s, cas_number: a.cas_number }));
  }, [ag.state.rows, L]);

  // ---------------------------------------------------------------- QA testing before use (migration 040): ticked by the lab's
  // default for the item's types; anyone may tick it, only QA may untick it when the lab's default asks for it
  const [qaTouched, setQaTouched] = useState(false);
  const [qaPicked, setQaPicked] = useState(false);
  const qaTypes = QA ? QA.rows.filter((d) => d.required).map((d) => d.chemical_type) : [];
  const hit = v.chemical_types.filter((t) => qaTypes.includes(t));
  const qaChecked = qaTouched ? qaPicked : hit.length > 0;
  const qaLocked = hit.length > 0 && !(who && who.can_qa_configure);

  // ---------------------------------------------------------------- the Supplier COA, attached on save
  const [coa, setCoa] = useState(null);
  const [proposal, setProposal] = useState(null);
  const [filled, setFilled] = useState([]);
  const [coaMsg, setCoaMsg] = useState('');
  const [reading, setReading] = useState(false);
  async function chooseCoa(e) {
    const f = e.target.files[0]; setCoa(null); setProposal(null);
    if (!f) { setCoaMsg(''); return; }
    if (f.size > MAX_COA) { setCoaMsg('The file is larger than 3.5 MB. Save a smaller PDF and choose it again.'); e.target.value = ''; return; }
    setCoa({ file_name: f.name, mime_type: f.type || 'application/pdf', content_base64: await fileToBase64(f) });
    setCoaMsg(`${f.name} will be attached to the item when you save.`);
  }
  async function readTheCoa() {
    if (!coa || reading) return;
    setReading(true);
    try {
      const r = await readCoa({ mime_type: coa.mime_type, content_base64: coa.content_base64 });
      const p = r.proposal || null; const next = { ...v }; const got = [];
      for (const [k, field, onlyEmpty] of COA_MAP) {
        const val = p && p[k];
        if (val === null || val === undefined || val === '' || (field === 'manufacturer_lot' && mixture) || (onlyEmpty && next[field].trim())) continue;
        if (field === 'concentration_unit' && !M.conc_units.includes(String(val))) continue;
        next[field] = String(val); got.push(field);
      }
      if (p && p.manufacturer_name) {
        const name = String(p.manufacturer_name).toLowerCase();
        const o = L.mfrOpts.find((x) => x.label.toLowerCase().includes(name) || name.includes(x.label.toLowerCase()));
        if (o && !next.manufacturer_id) { next.manufacturer_id = o.value; got.push('manufacturer_id'); }
      }
      setProposal(p); setFilled(got); setV(next); if (got.length) setTouched(true);
      setCoaMsg(got.length ? <>Filled in {got.length} value{got.length === 1 ? '' : 's'} from the COA (highlighted): <b>check each one against the document before saving</b>.</>
        : 'The COA was read but no values could be filled in; type them from the document.');
    } catch (e) { toast(e.message, 'err'); }
    setReading(false);
  }
  const ai = (k) => (filled.includes(k) ? 'aifill' : undefined);

  const dirty = touched || ag.changes.length > 0;
  useUnsavedChanges(dirty);
  const [saving, setSaving] = useState(false);
  const leaveTo = (hash) => { flushSync(() => { setTouched(false); ag.reset(ag.state.rows); }); window.location.hash = hash; };

  async function save() {
    if (saving) return;
    const t = (k) => v[k].trim();
    const n = (k) => (t(k) === '' ? null : Number(t(k)));
    const row = { item_name: t('item_name'), chemical_types: [...new Set(v.chemical_types.concat(mixture ? ['In-house mixture'] : []))], physical_form: v.physical_form || null,
      cas_number: t('cas_number') || null, catalog_number: t('catalog_number') || null, supplier_id: v.supplier_id || null, manufacturer_id: v.manufacturer_id || null,
      storage_location_id: v.storage_location_id || null, storage_condition: v.storage_condition || null,
      concentration: n('concentration'), concentration_unit: v.concentration_unit || null, purity_pct: n('purity_pct'), container_count: n('container_count'),
      notes: t('notes') || null, item_url: t('item_url') || null, department_id: v.department_id || null, waste_classification_id: v.waste_classification_id || null };
    if (!row.item_name) { toast('Enter the item name.', 'err'); document.getElementById('f_item_name')?.focus(); return; }
    if (!row.chemical_types.length) { toast('Tick at least one type.', 'err'); return; }
    if (ag.errorCount) { toast('Fix the analyte cells marked in red.', 'err'); return; }
    const analytes = ag.state.rows.filter((r) => r.analyte_id).map((r) => ({ analyte_id: r.analyte_id, concentration: r.concentration ?? null, concentration_unit: r.concentration_unit || null,
      target_concentration: r.target_concentration ?? null, tolerance_pct: r.tolerance_pct ?? null,
      expressed_as: r.expressed_as || null, formula_weight: r.formula_weight ?? null, analyte_per_unit: r.analyte_per_unit ?? null }));
    if (request) Object.assign(row, { requested_quantity: n('requested_quantity'), unit: v.unit || null });
    else {
      Object.assign(row, { manufacturer_lot: mixture ? undefined : t('manufacturer_lot') || null, received_date: v.received_date || null, opened_date: v.opened_date || null,
        expiration_date: v.expiration_date || null, retest_date: v.retest_date || null });
      if (!received) Object.assign(row, { quantity_received: n('quantity_received'), unit: v.unit || null });
    }
    Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
    setSaving(true);
    try {
      if (editing) {
        const ok = await signed(dialogs, { what: `Changes to ${l.lot_code} ${l.material}`, meaning: 'Changed by' },
          (reason, signature) => updateItem(editId, { row, analytes, reason, signature }));
        if (ok) { toast('Saved and signed.'); leaveTo('#/inventory/lots/' + editId); }
      } else {
        // what was saved from the COA's fields is what the person confirmed against it
        const confirmed = coa ? Object.fromEntries(COA_MAP.map(([, f]) => [f, row[f]]).filter(([, x]) => x !== undefined && x !== null && x !== '')) : null;
        const r = await signed(dialogs, { what: `${request ? 'Purchase request' : 'New inventory item'}: ${row.item_name}${coa ? ` (with Supplier COA ${coa.file_name})` : ''}`, meaning: request ? 'Requested by' : 'Created by', needReason: false },
          (reason, signature) => createItem({ row, analytes, request, signature, coa: coa ? { ...coa, proposal, confirmed } : null,
            qa_testing: QA ? (qaChecked ? '1' : '0') : undefined }));
        if (r) { toast(request ? 'Purchase request created and signed.' : 'Item saved and signed.'); leaveTo('#/inventory/lots/' + r.id); }
      }
    } finally { setSaving(false); }
  }

  const title = editing ? `Edit ${l.lot_code}: ${l.material}` : src ? `New inventory item (duplicate of ${l.lot_code})` : 'New inventory item';
  const sel = (k, options, extra = {}) => <SmartSelect id={'f_' + k} value={v[k]} options={withBlank(options)} onChange={set(k)} {...extra} />;
  const inp = (k, type = 'text', extra = {}) => <input id={'f_' + k} type={type} step={type === 'number' ? 'any' : undefined} value={v[k]} onChange={onInput(k)} {...extra} />;
  const toggleType = (t) => (e) => set('chemical_types')(e.target.checked ? [...v.chemical_types, t] : v.chemical_types.filter((x) => x !== t));

  return <>
    <PageHeader title={title}
      subtitle={editing ? 'Changes are saved with a Reason for Change and your electronic signature, and kept in the audit trail.'
        : 'Fill in what you received, or record a purchase request for something not yet in the lab. Reference Standards and Microbiological Strains must name at least one analyte from the Analytes list.'}
      actions={<><Button variant="light" href={editing ? '#/inventory/lots/' + editId : '#/inventory'}>Cancel</Button> <Button type="button" variant="primary" disabled={saving} onClick={save}>{editing ? 'Save changes' : 'Save item'}</Button></>} />
    <div className="itemform">
      {!editing && <div className="modeswitch">
        <label><input type="radio" name="mode" value="received" checked={mode === 'received'} onChange={() => setMode('received')} /> Received now</label>
        <label><input type="radio" name="mode" value="request" checked={mode === 'request'} onChange={() => setMode('request')} /> Purchase request (a Lab Supervisor approves it)</label>
      </div>}
      <div className="cols">
        <Card body><h2>Identity</h2>
          <Field label="Name" req help={'As staff call it, e.g. "Sodium Standard 1000 ppm" or "Pipette tips, 1000 µL"'} className={ai('item_name')}>{inp('item_name')}</Field>
          <Field label="Type" req><div className="checks" id="f_types">{types.map((t) => (
            <label key={t}><input type="checkbox" value={t} checked={v.chemical_types.includes(t)} disabled={mixture && t === 'In-house mixture'} onChange={toggleType(t)} /> {t}</label>))}</div></Field>
          {!editing && QA && <Field label="QA testing before use" help={hit.length ? `Your lab tests ${hit.join(', ')} before use.${who && who.can_qa_configure ? ' As QA you may receive it without testing.' : ' Only QA can receive it without testing.'}`
            : 'Not required for these types in your lab (Inventory > QA testing). Tick it to test this item before it is used.'}>
            <label className="checks"><input type="checkbox" id="f_qa" checked={qaChecked} disabled={qaLocked} onChange={(e) => { setQaTouched(true); setQaPicked(e.target.checked); }} /> Send for QA testing before use</label></Field>}
          <Field label="Solid or liquid" help="Used to calculate concentrations when the item goes into a mixture"><div className="checks" id="f_form">
            {['Solid', 'Liquid'].map((x) => <label key={x}><input type="radio" name="form" value={x} checked={v.physical_form === x} onChange={() => set('physical_form')(x)} /> {x}</label>)}
            <label><input type="radio" name="form" value="" checked={!v.physical_form} onChange={() => set('physical_form')('')} /> Not applicable</label></div></Field>
          <div className="field"><label>Analytes and concentrations</label><DataGrid grid={ag} emptyText="No analytes: click + Add row." />
            <div className="help">Pick from the Analytes list (type to search). A multi-element standard has one line per element. Leave empty for consumables, solvents and plain reagents.</div></div>
          <div className="grid2"><Field label="CAS" help="Filled in from a single analyte if left empty" className={ai('cas_number')}>{inp('cas_number')}</Field><Field label="Catalog #" className={ai('catalog_number')}>{inp('catalog_number')}</Field></div>
          <div className="grid2"><Field label="Vendor">{sel('supplier_id', L.supOpts)}</Field><Field label="Manufacturer" className={ai('manufacturer_id')}>{sel('manufacturer_id', L.mfrOpts)}</Field></div>
          <Field label="Web link" help="The item's page on the supplier's website (for reordering)">{inp('item_url', 'url', { placeholder: 'https://' })}</Field>
          <Field label="Department" help="The department whose tests use it: its low stock flags that department's waiting samples on the dashboard">{sel('department_id', L.deptOpts)}</Field>
          <Field label="Waste classification" help={'How it is disposed of (Admin > Lab setup > Waste classifications). Leave empty to use the default for its type; "classify from the SDS" is listed as needing review.'}>{sel('waste_classification_id', L.wasteOpts)}</Field>
          <div className="grid2"><Field label="Storage location">{sel('storage_location_id', L.locOpts)}</Field><Field label="Storage condition">{sel('storage_condition', opts(M.storage_conditions))}</Field></div>
        </Card>
        <Card body><h2>Quantitative</h2>
          {!request && (mixture ? <Field label="Resource ID"><input id="f_manufacturer_lot_ro" value={l.lot_code} disabled /></Field>
            : <Field label="Lot #" help="The manufacturer's lot number" className={ai('manufacturer_lot')}>{inp('manufacturer_lot')}</Field>)}
          <div className="grid3"><Field label="Concentration" help="For the item as a whole, e.g. 1.02 N acid" className={ai('concentration')}>{inp('concentration', 'number')}</Field>
            <Field label="Unit" className={ai('concentration_unit')}>{sel('concentration_unit', opts(M.conc_units))}</Field><Field label="Purity %" className={ai('purity_pct')}>{inp('purity_pct', 'number')}</Field></div>
          <div className="grid3">
            {!request && <Field label="Quantity received" req={!editing} help={received ? 'Locked after receipt: correct stock with an Adjustment' : ''}>{inp('quantity_received', 'number', { disabled: received })}</Field>}
            {request && <Field label="Quantity requested" req>{inp('requested_quantity', 'number')}</Field>}
            <Field label="Unit" req>{received ? <input value={v.unit} disabled /> : sel('unit', opts(M.units))}</Field><Field label="Containers">{inp('container_count', 'number')}</Field></div>
          {!request && <>
            <div className="grid2"><Field label={mixture ? 'Date made' : 'Received date'}>{inp('received_date', 'date')}</Field><Field label="Opened date">{inp('opened_date', 'date')}</Field></div>
            <div className="grid2"><Field label="Expiration date" className={ai('expiration_date')}>{inp('expiration_date', 'date')}</Field><Field label="Retest date" className={ai('retest_date')}>{inp('retest_date', 'date')}</Field></div>
          </>}
          <Field label="Notes"><textarea id="f_notes" rows={2} value={v.notes} onChange={onInput('notes')} /></Field>
        </Card>
      </div>
      {editing ? <Card body><h2>Supplier COA</h2><div className="help">COAs for this item are on its page: <a href={'#/inventory/lots/' + editId}>{l.lot_code}</a> (Upload Supplier COA).</div></Card>
        : <Card body className="coanew"><h2>Supplier COA</h2>
          <div className="help">Attach the supplier's Certificate of Analysis (PDF or image, up to 3.5 MB). It is kept with the item exactly as uploaded, with its fingerprint.{' '}
            {M.ai.enabled ? <><b>Read the COA</b> fills in this form from the document; check every value before saving (they are recorded as confirmed by you).</>
              : 'Reading the COA automatically is switched off in this Sandbox until IT and QA approve it (the document would be sent to an AI service); type the values from the COA.'}</div>
          <div className="coarow"><input type="file" id="f_coa" accept="application/pdf,image/png,image/jpeg,image/gif,image/webp" onChange={chooseCoa} />
            {M.ai.enabled && <Button type="button" variant="outline-secondary" disabled={!coa || reading} onClick={readTheCoa}>{reading ? 'Reading…' : 'Read the COA'}</Button>}</div>
          <div className="help">{coaMsg}</div></Card>}
    </div>
  </>;
}
