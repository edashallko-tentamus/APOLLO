// 0.36.0 (migration 058): the test picker on a lab order. Cecilia (2026-10-21): too many tests to scroll through;
// Alex: drill down Service line > Service line type > Department. Any test of this lab can be ordered: the client's
// quoted price when there is one, else the list price, without a warning (Alex). The client's quoted tests and service
// lines come first; a search box looks across everything.
//   const r = await openTestPicker(dialogs, { orderId, sampleIds, sampleLabel, tiers }); // { added, skipped } or null
import { useMemo, useState } from 'react';
import { addCatalogueTests, pickerData } from '../../api/picker.js';
import Modal from '../../components/Modal.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useApi } from '../../hooks/useApi.js';
import { money } from '../../lib/format.js';
import './picker.css';

const QUOTED = '__quoted';
const ALL = '__all';
const NONE = '__none';
const NO_TESTS = [];
const quotedP = (t) => t.quote_price !== null && t.quote_price !== undefined;

function Btn({ k, label, n, on, cls = '', onPick }) {
  return <button type="button" className={`${on ? 'on' : ''} ${cls}`.trim() || undefined} onClick={() => onPick(k)}>{label} <small>{n}</small></button>;
}

function TestPicker({ orderId, sampleIds, sampleLabel, tiers = [], onDone }) {
  const { data: d, error: loadErr } = useApi(() => pickerData(orderId), [orderId]);
  const tests = d?.tests || NO_TESTS;
  const quoted = useMemo(() => tests.filter(quotedP), [tests]);
  const [lineSet, setLine] = useState(null); // null: the default, once loaded
  const line = lineSet ?? (quoted.length ? QUOTED : (d?.lines?.find((l) => l.client_line) || {}).id || ALL);
  const [type, setType] = useState(null);
  const [dept, setDept] = useState(null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState(() => new Set());
  const [rush, setRush] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const inLineK = (k) => (t) => (k === QUOTED ? quotedP(t) : k === ALL ? true : k === NONE ? !t.line_id : t.line_id === k);
  const inLine = inLineK(line);
  const qs = q.trim().toLowerCase();
  const rows = qs ? tests.filter((t) => `${t.test_name} ${t.test_code} ${t.description || ''}`.toLowerCase().includes(qs))
    : tests.filter((t) => inLine(t) && (!type || (t.type_id || NONE) === type) && (!dept || (t.department_id || NONE) === dept));
  const lineCount = (k) => tests.filter(inLineK(k)).length;
  const lines = [...(d?.lines || [])].sort((a, b) => (b.client_line - a.client_line) || (a.sort_order - b.sort_order));
  const base = tests.filter(inLine);
  const types = new Map(); base.forEach((t) => { const k = t.type_id || NONE; if (!types.has(k)) types.set(k, { label: t.type_name || 'No type', n: 0 }); types.get(k).n++; });
  const base2 = base.filter((t) => !type || (t.type_id || NONE) === type);
  const depts = new Map(); base2.forEach((t) => { const k = t.department_id || NONE; if (!depts.has(k)) depts.set(k, { label: t.department_name || 'No department', n: 0 }); depts.get(k).n++; });

  const picked = tests.filter((t) => chosen.has(t.id));
  // rush tiers of the ticked tests' schedules (a tier applies only to the tests on its schedule)
  const scheds = new Set(picked.map((t) => t.rush_schedule_id).filter(Boolean));
  const tierList = tiers.filter((t) => scheds.has(t.schedule_id));
  const rushValue = tierList.some((t) => t.id === rush) ? rush : '';
  const rushOpts = [{ value: '', label: 'Standard turnaround' }, ...tierList.map((t) => ({ value: t.id, label: `${t.schedule_name ? t.schedule_name + ': ' : ''}${t.tier_name} (${t.rush_tat} days)` }))];

  const pickLine = (k) => { setLine(k); setType(null); setDept(null); setQ(''); };
  const toggle = (id, on) => setChosen((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  async function add() {
    if (!picked.length) return;
    setBusy(true); setError('');
    try { onDone(await addCatalogueTests(orderId, { sample_ids: sampleIds, test_ids: [...chosen], rush_tier_id: rushValue || null })); }
    catch (e) { setBusy(false); setError(e.message); }
  }

  return (
    <Modal title={`Add tests to ${sampleLabel}`} okText="Add" xwide busy={busy || !picked.length} error={error || loadErr?.message} onOk={add} onClose={() => onDone(null)}
      intro="Choose a service line, then narrow by type and department, or search. Tick the tests to add. The client's quoted tests are at their quoted price; any other test of this lab is at its list price.">
      <div className="tpk">
        <input className="tpkq" placeholder="Search every test by name or code" aria-label="Search tests" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        {!d ? <div className="loading">{loadErr ? '' : 'Loading…'}</div> : <>
          <div className="tpkcols">
            <div className="tpkcol"><h4>Service line</h4>
              {quoted.length > 0 && <Btn k={QUOTED} label="On this client's quotes" n={quoted.length} on={!qs && line === QUOTED} cls="mine" onPick={pickLine} />}
              {lines.filter((l) => lineCount(l.id)).map((l) => <Btn key={l.id} k={l.id} label={l.line_name + (l.client_line ? ' ★' : '')} n={lineCount(l.id)} on={!qs && line === l.id} cls={l.client_line ? 'mine' : ''} onPick={pickLine} />)}
              {lineCount(NONE) > 0 && <Btn k={NONE} label="Not yet sorted" n={lineCount(NONE)} on={!qs && line === NONE} onPick={pickLine} />}
              <Btn k={ALL} label="All tests" n={tests.length} on={!qs && line === ALL} onPick={pickLine} />
            </div>
            <div className="tpkcol"><h4>Type</h4>
              <Btn k="" label="Every type" n={base.length} on={!type} onPick={() => { setType(null); setDept(null); }} />
              {[...types].map(([k, v]) => <Btn key={k} k={k} label={v.label} n={v.n} on={type === k} onPick={(x) => { setType(x); setDept(null); }} />)}
            </div>
            <div className="tpkcol"><h4>Department</h4>
              <Btn k="" label="Every department" n={base2.length} on={!dept} onPick={() => setDept(null)} />
              {[...depts].map(([k, v]) => <Btn key={k} k={k} label={v.label} n={v.n} on={dept === k} onPick={setDept} />)}
            </div>
            <div className="tpkcol tpktests"><h4>{qs ? `Tests matching "${q.trim()}"` : 'Tests'} ({rows.length})</h4>
              {rows.length ? <table><tbody>{rows.map((t) => {
                const off = !!t.problem;
                return (
                  <tr key={t.id} className={off ? 'off' : undefined}>
                    <td style={{ width: 26 }}><input type="checkbox" id={'tpk_' + t.id} checked={chosen.has(t.id)} disabled={off} onChange={(e) => toggle(t.id, e.target.checked)} /></td>
                    <td><label htmlFor={'tpk_' + t.id}>{t.test_name}</label>
                      <div className="m">{t.test_code}{t.department_name ? ' · ' + t.department_name : ''}{t.standard_tat ? ` · ${t.standard_tat} ${t.tat_unit === 'Business Days' ? 'business' : 'calendar'} days` : ''}{off ? ' · ' + t.problem : ''}</div></td>
                    <td className="n">{quotedP(t) ? <><span className="tpkq2">{money(t.quote_price)}</span><div className="m">{t.project_code}</div></> : <>{money(t.list_price)}<div className="m">list price</div></>}</td>
                  </tr>);
              })}</tbody></table> : <p className="help" style={{ padding: 10 }}>No tests here.</p>}
            </div>
          </div>
          {(d.elsewhere || []).length > 0 && <p className="help">Quoted tests of another lab cannot be ordered here yet: {d.elsewhere.map((x) => `${x.test_name} (${x.site_code})`).join(', ')}. Order them at that lab.</p>}
          <div className="tpkfoot">
            <span id="tpkn">{picked.length ? `${picked.length} test${picked.length === 1 ? '' : 's'} ticked: ${picked.map((t) => t.test_name).join(', ')}` : 'Nothing ticked'}</span><span className="sp" />
            <label htmlFor="tpkr">Rush</label>
            <SmartSelect id="tpkr" value={rushValue} options={rushOpts} onChange={setRush} disabled={!tierList.length} />
          </div>
        </>}
      </div>
    </Modal>
  );
}

export function openTestPicker(dialogs, opts) {
  return dialogs.open((done) => <TestPicker {...opts} onDone={done} />);
}
