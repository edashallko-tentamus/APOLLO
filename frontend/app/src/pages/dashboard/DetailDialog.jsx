// The list behind a dashboard number: the rows the backend gives, as a read-only grid; a link closes it.
import { useEffect, useMemo, useRef } from 'react';
import ReadGrid from '../../components/grid/ReadGrid.jsx';

const d8 = (v) => { if (!v) return ''; const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString([], { dateStyle: 'medium' }) : String(v); };
const TITLES = { sample_code: 'Sample', client_sample_id: 'Client sample ID', order_code: 'Order', client_name: 'Client', test_name: 'Test', due_date: 'Due', reported_on: 'Reported',
  days_late: 'Days late', hold_days: 'Days on hold', login_days: 'Login TAT (d)', lab_days: 'Lab TAT (d)', qa_days: 'QA TAT (d)', on_time: 'On time', invoice_number: 'Number',
  invoice_date: 'Date', kind: 'Kind', total: 'Total', catchup: 'Catch-up', value: 'Value', wip_state: 'Stage', rush: 'Rush', logged_at: 'Logged', submitted_at: 'Submitted',
  lot_code: 'Lot', item_name: 'Item' };
const HREF = { sample_code: (r) => r.sample_id && '#/samples/' + r.sample_id, order_code: (r) => r.lab_order_id && '#/orders/' + r.lab_order_id, invoice_number: (r) => '#/billing/invoices/' + r.id };

export default function DetailDialog({ d, onClose }) {
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector('button')?.focus(); }, []);
  const columns = useMemo(() => {
    const keys = d.rows.length ? Object.keys(d.rows[0]).filter((c) => !(c === 'id' || c.endsWith('_id'))) : [];
    return keys.map((c) => {
      const money = ['value', 'total'].includes(c);
      return { field: c, title: TITLES[c] || c.replace(/_/g, ' '), width: c === 'test_name' || c === 'client_name' ? 200 : 120,
        type: HREF[c] ? 'link' : money ? 'money' : 'readonly', href: HREF[c],
        format: HREF[c] || money ? undefined : (v) => (typeof v === 'boolean' ? (v ? 'Yes' : 'No') : /date|_on$/.test(c) ? d8(v) : /_at$/.test(c) && v ? new Date(v).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : v ?? '') };
    });
  }, [d]);
  return (
    <div className="ddet" onClick={(e) => { if (e.target === e.currentTarget || e.target.closest('a[href^="#/"]')) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div ref={box} className="box" role="dialog" aria-label={d.title}>
        <h3><span>{d.title} <small className="help">{d.rows.length} row{d.rows.length === 1 ? '' : 's'}</small></span><button type="button" className="btn" onClick={onClose}>Close</button></h3>
        <ReadGrid rows={d.rows} columns={columns} search emptyText="Nothing here." />
      </div>
    </div>
  );
}
