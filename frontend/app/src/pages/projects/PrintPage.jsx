// #/print/<version id>: the printable quote (client-facing). The page wears body.printing while open, as in the current app.
import { useEffect } from 'react';
import { getVersion, versionPackages } from '../../api/projects.js';

import { useApi } from '../../hooks/useApi.js';
import { money, pct } from '../../lib/format.js';
import { Button, Card } from 'react-bootstrap';

const days = (n, unit) => `${n} ${unit === 'Business Days' ? 'business' : 'calendar'} days`;
const rushPays = (r) => (r.surcharge_type === 'Flat' ? money(r.surcharge_value * (1 - r.discount_pct / 100)) : (r.surcharge_value * (1 - r.discount_pct / 100)).toFixed(1) + '% of price');

export default function PrintPage({ params }) {
  const vid = params[0];
  const { data, error } = useApi(() => Promise.all([getVersion(vid, { fresh: true }), versionPackages(vid, { fresh: true }).catch(() => ({ rows: [] }))]), [vid]);
  useEffect(() => { document.body.classList.add('printing'); return () => document.body.classList.remove('printing'); }, []);
  if (error) return <Card body className="err">{error.message}</Card>;
  if (!data) return <div className="loading">Loading…</div>;

  const [d, pk] = data;
  const v = d.version; const lines = d.lines; const pks = pk.rows || [];
  const total = lines.reduce((s, l) => s + (l.line_total || 0), 0) + pks.reduce((s, p) => s + Number(p.package_price) * p.quantity, 0);
  const listTotal = lines.reduce((s, l) => s + l.list_price * l.quantity, 0) + pks.reduce((s, p) => s + Number(p.list_price) * p.quantity, 0);
  const scheds = [...new Set(d.rush.map((r) => r.schedule_name))];

  return <>
    <div className="noprint printbar"><Button variant="light" href={`#/quote/${vid}`}>Back to quote</Button> <Button type="button" variant="primary" onClick={() => window.print()}>Print or save as PDF</Button>
      {['Draft', 'Submitted for Quote'].includes(v.status) && <span className="help">Draft: prices are not final until the quote is issued.</span>}</div>
    <div className="quote">
      <div className="qhead"><div><div className="qlogo">Tentamus North America</div><div className="help">Laboratory testing services · LIMS3 Sandbox (demo)</div></div>
        <div className="qmeta"><h1>Quotation</h1><div>{v.project_code} · version {v.version_no}</div><div>Status: {v.status}</div>
          <div>Issued: {v.quoted_at ? new Date(v.quoted_at).toLocaleDateString() : 'Not yet issued'}</div><div>Valid until: {v.valid_until || '—'}</div></div></div>
      <div className="qto"><b>Prepared for</b><div>{v.client_legal_name}</div><div>{v.billing_address || ''}</div>
        <div className="qproj"><b>Project:</b> {v.project_name}{v.purpose ? ' · ' + v.purpose : ''}</div></div>
      <table className="qt"><thead><tr><th>Test</th><th className="num">Qty</th><th className="num">List price</th><th className="num">Your price</th><th className="num">Discount</th><th className="num">Line total</th><th>Standard TAT</th><th>Rush schedule</th></tr></thead>
        <tbody>
          {pks.map((p) => <tr key={'p' + p.id}><td><b>Package: {p.package_name}</b><div className="help">{p.tests.map((t) => t.test_name).join(', ')}</div></td>
            <td className="num">{p.quantity}</td><td className="num">{money(p.list_price)}</td><td className="num">{money(p.package_price)}</td>
            <td className="num">{money(p.list_price - p.package_price)}</td><td className="num">{money(p.package_price * p.quantity)}</td><td /><td /></tr>)}
          {lines.map((l) => <tr key={l.line_id}><td><b>{l.test_name}</b>{l.pricing_mode === 'Analyte Selection' && <div className="help">{l.analytes_included} of {l.analytes_total} analytes</div>}{l.special_instructions && <div className="help">{l.special_instructions}</div>}</td>
            <td className="num">{l.quantity}</td><td className="num">{money(l.list_price)}</td><td className="num">{money(l.final_price)}</td>
            <td className="num">{l.final_price === null ? '' : <>{money(l.discount_amount)}<div className="help">{pct(l.discount_pct)}</div></>}</td>
            <td className="num">{money(l.line_total)}</td><td>{days(l.standard_tat, l.tat_unit)}</td><td>{l.rush_schedule || '—'}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={5} className="num">List value {money(listTotal)} · You save {money(listTotal - total)}</td><td className="num"><b>{money(total)}</b></td><td colSpan={2} /></tr></tfoot></table>
      {scheds.length > 0 && <>
        <h2>Rush options</h2><p className="help">Standard TAT is the maximum. Rush tiers below are available for the tests listed with that schedule; the surcharge applies to your price for each test.</p>
        {scheds.map((s) => <table key={s} className="qt small"><thead><tr><th colSpan={5}>{s}</th></tr><tr><th>Tier</th><th>Turnaround</th><th className="num">Surcharge</th><th className="num">Your rush discount</th><th className="num">You pay</th></tr></thead><tbody>
          {d.rush.filter((r) => r.schedule_name === s).map((r, i) => <tr key={i}><td>{r.tier_name}</td><td>{days(r.rush_tat, r.tat_unit)}</td>
            <td className="num">{r.surcharge_type === 'Flat' ? money(r.surcharge_value) : r.surcharge_value + '% of price'}</td><td className="num">{Number(r.discount_pct) ? Number(r.discount_pct) + '%' : '—'}</td>
            <td className="num">{rushPays(r)}</td></tr>)}</tbody></table>)}
      </>}
      <div className="qterms"><b>Terms.</b> Prices are per sample in USD. Testing may only be ordered against an accepted quotation. Turnaround starts on the day samples are logged (Day 0); samples logged after a test&apos;s cutoff time start the next working day.</div>
    </div>
  </>;
}
