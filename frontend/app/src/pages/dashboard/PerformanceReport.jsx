// The performance report (0.35.0): a period, the labs, then the Excel file (Summary plus the raw data tabs).
// Used by the GM and executive dashboards and the finance figures page.
import { useState } from 'react';
import { downloadFile } from '../../api/dashboard.js';
import Modal from '../../components/Modal.jsx';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ReportDialog({ labs, onDone }) {
  const t = new Date();
  const several = labs.length > 1;
  const [from, setFrom] = useState(ymd(new Date(t.getFullYear(), 0, 1)));
  const [to, setTo] = useState(ymd(t));
  const [ticked, setTicked] = useState(() => new Set(labs.map((l) => l.site_code)));
  const [error, setError] = useState('');
  const ok = () => {
    if (!from || !to) return setError('From and To are required.');
    if (from > to) return setError('From must be on or before To.');
    if (several && !ticked.size) return setError('Tick at least one lab.');
    onDone({ from, to, labs: several ? [...ticked] : null });
  };
  const tick = (code, on) => setTicked((s) => { const n = new Set(s); if (on) n.add(code); else n.delete(code); return n; });
  return (
    <Modal title="Performance report (Excel)" okText="Download" error={error} onOk={ok} onClose={() => onDone(null)}
      intro="Choose the period. The file has a Summary (headline by lab, by month, top clients, quality and timeliness) and the data behind it on separate tabs, with the LIMS column names.">
      <div className="field"><label htmlFor="f_from">From <span className="req">*</span></label><input id="f_from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
      <div className="field"><label htmlFor="f_to">To <span className="req">*</span></label><input id="f_to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      {several && <div className="field"><label>Labs</label><div className="rlabs">
        {labs.map((l) => <label key={l.site_code} className="cb"><input type="checkbox" checked={ticked.has(l.site_code)} onChange={(e) => tick(l.site_code, e.target.checked)} /> {l.site_code}: {l.site_name}</label>)}
      </div></div>}
    </Modal>
  );
}

export async function performanceReport({ dialogs, toast, labs, siteId }) {
  const v = await dialogs.open((done) => <ReportDialog labs={labs} onDone={done} />);
  if (!v) return;
  const qs = new URLSearchParams({ from: v.from, to: v.to }); if (v.labs) qs.set('labs', v.labs.join(','));
  toast('Making the report…');
  try {
    await downloadFile('/finance/report.xlsx?' + qs, { siteId, name: `Performance ${v.from} to ${v.to}.xlsx` });
    toast('Performance report downloaded.');
  } catch (e) { toast(e.message, 'err'); }
}
