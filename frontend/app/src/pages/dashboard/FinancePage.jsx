// The finance figures: the weekly update and the forecasts per lab (one lab tab at a time), the forecasts to and
// from Excel, and the performance report.
import { useMemo, useState } from 'react';
import { downloadFile, getFinance, previewPlans, saveFinancePlans, saveFinanceWeeks } from '../../api/dashboard.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { performanceReport } from './PerformanceReport.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import { fmtv } from './WidgetBody.jsx';
import './dashboard.css';
import { Button, Card } from 'react-bootstrap';
import { Dialog } from '../../components/Modal.jsx';

const AUDIT = { kind: 'finance' };
const SUB = 'The weekly finance update for each lab and the Budget Forecast and Monthly Forecast for each month. The week\'s revenue comes from the LIMS (invoices issued that week) and cannot be typed: type the costs, and the revenue from the books if you want to compare. Paste from Excel and fill down with Ctrl+D. The executive dashboard compares them by month, with EBITDA = LIMS revenue less costs.';
// kept while the app is open, as in the current app
let financeYear = new Date().getFullYear();
let financeLab = null;
const YEARS = [0, 1, 2].map((i) => new Date().getFullYear() - 1 + i).map((y) => ({ value: String(y), label: String(y) }));
const empty = (v) => v === null || v === undefined || v === '';

const WEEK_COLS = [
  { field: 'week_ending', title: 'Week ending', type: 'date', width: 120, editable: (r, isNew) => isNew },
  { field: 'lims_revenue', title: 'Revenue (LIMS)', type: 'readonly', width: 130, format: (v) => (empty(v) ? 'after saving' : fmtv(v, 'money')) },
  { field: 'costs', title: 'Costs', type: 'money', width: 120 },
  { field: 'ebitda', title: 'EBITDA', type: 'money', width: 120, compute: (r) => (empty(r.lims_revenue) ? null : Number(r.lims_revenue) - Number(r.costs || 0)) },
  { field: 'books_revenue', title: 'Revenue (books)', type: 'money', width: 130 },
  { field: 'note', title: 'Note', width: 300 }];
const PLAN_COLS = [
  { field: 'month', title: 'Month', width: 100, editable: (r, isNew) => isNew },
  { field: 'plan', title: 'Plan', type: 'select', options: ['Budget forecast', 'Monthly forecast'], width: 150, editable: (r, isNew) => isNew },
  { field: 'revenue', title: 'Revenue', type: 'money', width: 120 }, { field: 'costs', title: 'Costs', type: 'money', width: 120 },
  { field: 'ebitda', title: 'EBITDA', type: 'money', width: 120, compute: (r) => (empty(r.revenue) ? null : Number(r.revenue || 0) - Number(r.costs || 0)) }];
const PREVIEW_COLS = [{ field: 'row', title: 'Row', type: 'readonly', width: 55 }, { field: 'site_code', title: 'Lab', type: 'readonly', width: 60 }, { field: 'month', title: 'Month', type: 'readonly', width: 80 },
  { field: 'plan', title: 'Plan', type: 'readonly', width: 140 }, { field: 'action', title: 'Action', type: 'readonly', width: 80 }, { field: 'what', title: 'Changes or errors', type: 'readonly', width: 520 }];

const toBase64 = async (file) => {
  const bytes = new Uint8Array(await file.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// Upload forecasts from Excel: preview every change, then one reason saves them all
function UploadDialog({ onDone }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const n = (a) => (rows || []).filter((r) => r.action === a).length;
  const errors = n('Error'); const todo = n('Create') + n('Update');
  const shown = useMemo(() => (rows || []).filter((r) => r.action !== 'No change').map((r) => ({ ...r, id: r.row,
    what: r.errors.length ? r.errors.join(' · ') : r.was ? `Revenue ${fmtv(r.was.revenue, 'money')} → ${fmtv(r.revenue, 'money')} · Costs ${fmtv(r.was.costs, 'money')} → ${fmtv(r.costs, 'money')}` : `Revenue ${fmtv(r.revenue, 'money')} · Costs ${fmtv(r.costs, 'money')}` })), [rows]);

  async function pick(e) {
    const file = e.target.files[0]; if (!file) return;
    setError(''); setRows(null);
    try { const p = await previewPlans(file.name, await toBase64(file)); setRows(p.rows); } catch (ex) { setError(ex.message); }
  }
  async function save() {
    const reason = await dialogs.reason('the forecasts uploaded from Excel'); if (!reason) return;
    setBusy(true);
    try {
      const list = rows.filter((r) => r.action === 'Create' || r.action === 'Update').map((r) => ({ site_code: r.site_code, month: r.month, plan: r.plan, revenue: r.revenue, costs: r.costs }));
      await saveFinancePlans(list, reason);
      toast(`${list.length} forecast row${list.length === 1 ? '' : 's'} saved.`); onDone(true);
    } catch (ex) { setBusy(false); setError(ex.message + ' Nothing was saved.'); }
  }
  const canSave = rows && errors === 0 && todo > 0;
  return (
    <Dialog label="Upload forecasts from Excel" xwide onClose={() => onDone(false)}>
      <div className="modal-body">
        <h3>Upload forecasts from Excel</h3>
        <p className="intro">Download the forecasts first, change the Revenue and Costs (or add rows: Lab, Month YYYY-MM, Plan), save the file and upload it here. You see every change before anything is saved.</p>
        <div className="field"><input type="file" id="planf" accept=".xlsx,.csv" onChange={pick} /></div>
        {rows && <div className="bulksum"><span><b>{rows.length}</b> rows read</span><span className="c-new"><b>{n('Create')}</b> to add</span><span className="c-upd"><b>{n('Update')}</b> to change</span>
          <span><b>{n('No change')}</b> unchanged</span><span className={errors ? 'c-err' : undefined}><b>{errors}</b> with errors</span></div>}
        {rows && errors > 0 && <p className="bad">Fix the rows with errors in Excel and upload the file again. Nothing has been saved.</p>}
        {rows && <ReadGrid rows={shown} columns={PREVIEW_COLS} emptyText="Nothing to change: the file matches what is stored." rowClass={(r) => (r.action === 'Error' ? 'errrow' : '')} />}
        <div className="merr" role="alert">{error}</div>
        <div className="mbtns">
          <Button type="button" variant="light" onClick={() => onDone(false)}>Cancel</Button>
          <Button type="button" variant="primary" disabled={!canSave || busy} onClick={save}>{canSave ? `Save ${todo} row${todo === 1 ? '' : 's'}` : 'Save changes'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export default function FinancePage() {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const [year, setYearState] = useState(financeYear);
  const [labPick, setLabPick] = useState(financeLab);
  const { data: d, error, reload } = useApi((o) => getFinance(year, o), [year]);
  const setYear = (y) => { financeYear = Number(y); setYearState(financeYear); };
  const codes = d ? d.labs.map((l) => l.site_code) : [];
  const labCode = codes.includes(labPick) ? labPick : codes[0];
  const pickLab = (c) => { financeLab = c; setLabPick(c); };
  const lab = d?.labs.find((l) => l.site_code === labCode);
  const weeks = useMemo(() => (d ? d.weeks.filter((w) => w.site_code === labCode) : []), [d, labCode]);
  const plans = useMemo(() => (d ? d.plans.filter((p) => p.site_code === labCode) : []), [d, labCode]);
  // the backend takes whole rows: a changed row with its unchanged fields, a new one with the lab
  const full = (rows, changes) => changes.map((ch) => (ch.id ? { ...rows.find((r) => r.id === ch.id), ...ch } : { site_code: labCode, ...ch }));

  async function downloadForecasts() {
    try { await downloadFile(`/finance/plans.xlsx?year=${year}`, { siteId: site?.id, name: `Forecasts ${year}.xlsx` }); toast(`Forecasts ${year} downloaded.`); } catch (e) { toast(e.message, 'err'); }
  }
  async function upload() { if (await dialogs.open((done) => <UploadDialog onDone={done} />)) reload(); }

  const header = <PageHeader title="Finance figures" subtitle={SUB} audit={AUDIT} />;
  if (error && !d) return <>{header}<Card body className="err">{error.message}</Card></>;
  if (!d) return <>{header}<div className="loading">Loading…</div></>;
  return <>
    {header}
    <div className="dbar">Year <SmartSelect id="fy" value={String(year)} options={YEARS} onChange={setYear} /></div>
    <div className="ftabs" role="tablist">
      {d.labs.map((l) => <button key={l.site_code} type="button" role="tab" className={l.site_code === labCode ? 'on' : undefined} aria-selected={l.site_code === labCode} title={l.site_name} onClick={() => pickLab(l.site_code)}>{l.site_code}</button>)}
    </div>
    <Section title={`Weekly update: ${lab ? lab.site_name : ''}`} help="One row per week (the date the week ends). Revenue (LIMS) is worked out from the invoices and locked. Costs should exclude depreciation, amortization, interest and tax, so that revenue less costs is EBITDA: to confirm with finance.">
      <EditableGrid key={'w' + labCode} rows={weeks} columns={WEEK_COLS} allowAdd newRow={() => ({ site_code: labCode })} what="the weekly finance update"
        save={(changes, reason) => saveFinanceWeeks(full(weeks, changes), reason)} afterSave={reload} />
    </Section>
    <Section title={`Forecasts: ${lab ? lab.site_name : ''}`} help="Budget forecast (set for the year) and Monthly forecast (updated as the year goes), per month (YYYY-MM). Download them to Excel for every lab you type for, edit, and upload the file: you see every change before it is saved."
      actions={<><Button type="button" variant="outline-secondary" id="plandl" onClick={downloadForecasts}>Download Excel</Button> <Button type="button" variant="outline-secondary" id="planul" onClick={upload}>Upload Excel</Button></>}>
      <EditableGrid key={'p' + labCode} rows={plans} columns={PLAN_COLS} allowAdd newRow={() => ({ site_code: labCode, plan: 'Budget forecast' })} what="the forecasts"
        save={(changes, reason) => saveFinancePlans(full(plans, changes), reason)} afterSave={reload} />
    </Section>
    <Section title="Performance report" help="Everything for a period in one Excel file: a Summary for the General Manager or executive (headline by lab, by month, top clients, quality and timeliness), then the LIMS data behind it on separate tabs, with the LIMS column names."
      actions={<Button type="button" variant="primary" id="fdreport" onClick={() => performanceReport({ dialogs, toast, labs: d.labs, siteId: site?.id })}>Performance report (Excel)</Button>} />
  </>;
}
