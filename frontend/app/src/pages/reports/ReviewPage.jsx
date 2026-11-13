// The review of a group of COAs, one at a time (#/reports/review): the sample's history on the left, the PDF in the
// middle, the release check and notes on the right; then one signing act that issues each COA ready.
import { useEffect, useMemo, useReducer, useState } from 'react';
import { addNote, attachmentUrl, coaPdfUrl, finalize, previewCoa, previewPdfUrl, removeNote } from '../../api/reports.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SmartSelect from '../../components/SmartSelect.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { dt, review } from './shared.jsx';
import { Button, Card } from 'react-bootstrap';

const noteLast = { kind: '', on: '' }; // the note's Kind and On keep the last choice (Alex: several notes on one analyte)
const KIND_OPTS = [{ value: 'COA', label: 'On the COA (the client sees it)' }, { value: 'Internal', label: 'Internal (never printed)' }];
const BACK = <Button variant="light" href="#/reports/finalization">Back to the queue</Button>;

function Kv({ pairs }) {
  return <dl>{pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => <Pair key={k} k={k} v={v} />)}</dl>;
}
const Pair = ({ k, v }) => <><dt>{k}</dt><dd>{v}</dd></>;
const noteOn = (n, full) => (n.analyte ? ' · ' + (full ? `${n.test_name} ${n.analyte}` : n.analyte) : n.test_name ? ' · ' + n.test_name : '');

export default function ReviewPage() {
  const session = review.session;
  const [, bump] = useReducer((x) => x + 1, 0);
  const toast = useToast();
  const dialogs = useDialogs();
  const empty = !session || !session.items.length;
  useEffect(() => { if (empty) window.location.hash = '#/reports/finalization'; }, [empty]);
  const it = empty ? null : session.items[session.i];
  const { data: d, error, reload } = useApi(() => (it ? previewCoa(it.sample_id, it.tests) : Promise.resolve(null)), [it]);
  useEffect(() => { if (d && it) { session.data[it.sample_id] = d; bump(); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps -- once per answer

  if (empty) return null;
  const heading = `Report Finalization: COA ${session.i + 1} of ${session.items.length}`;
  if (!d || d.context.sample.id !== it.sample_id) { // useApi keeps the last answer while the next COA is made
    return <>
      <PageHeader title={heading} subtitle={`${it.sample_code}${it.client_sample_id ? ' (' + it.client_sample_id + ')' : ''} · ${it.test_names.join(', ')}`}
        actions={BACK} audit={{ kind: 'sample', id: it.sample_id }} />
      <Card body>{error ? error.message : 'Making the COA…'}</Card>
    </>;
  }
  const go = (k) => { session.i = k; bump(); };
  return <ReviewBody key={it.sample_id} session={session} it={it} d={d} heading={heading} go={go} bump={bump} reload={reload} toast={toast} dialogs={dialogs} />;
}

function ReviewBody({ session, it, d, heading, go, bump, reload, toast, dialogs }) {
  const { site } = useSession();
  const siteId = site?.id;
  const c = d.content; const x = d.context; const s = x.sample;
  const acks = session.acks[it.sample_id] || (session.acks[it.sample_id] = {});
  const blocks = d.checks.filter((k) => k.level === 'Block');
  const ready = !!session.ready[it.sample_id];
  const nReady = session.items.filter((y) => session.ready[y.sample_id]).length;
  const [busy, setBusy] = useState(false);

  // the note form
  const onOptions = useMemo(() => [{ value: '', label: 'The sample' },
    ...c.tests.map((t) => ({ value: `${t.requested_test_id}|`, label: t.test_name })),
    ...c.tests.flatMap((t) => t.results.map((r) => ({ value: `${t.requested_test_id}|${r.analyte_id}`, label: `${t.test_name}: ${r.analyte}${r.label ? ' (' + r.label + ')' : ''}` })))], [c]);
  const cannedOpts = useMemo(() => [{ value: '', label: '' }, ...d.canned.map((q) => ({ value: q.id, label: q.reason_text }))], [d]);
  const [kind, setKind] = useState(() => (KIND_OPTS.some((o) => o.value === noteLast.kind) ? noteLast.kind : 'COA'));
  const [on, setOn] = useState(() => (onOptions.some((o) => o.value === noteLast.on) ? noteLast.on : ''));
  const [canned, setCanned] = useState('');
  const [text, setText] = useState('');

  function markReady() {
    if (ready) { delete session.ready[it.sample_id]; bump(); return; }
    const missing = d.checks.filter((k) => k.level === 'Warning' && !String(acks[k.code] || '').trim());
    if (missing.length) { toast(`Give a reason to release despite: ${missing.map((k) => k.title).join(', ')}`, 'err'); return; }
    session.ready[it.sample_id] = true;
    const nxt = session.items.findIndex((y, k) => k > session.i && !session.ready[y.sample_id]);
    if (nxt >= 0) go(nxt); else bump();
  }
  async function add() {
    const [rt, an] = (on || '|').split('|');
    const body = { sample_id: s.id, kind, requested_test_id: rt || null, analyte_id: an || null, reason_code_id: canned || null, note_text: text };
    if (!body.reason_code_id && !body.note_text.trim()) { toast('Choose a canned comment or type the note.', 'err'); return; }
    setBusy(true);
    try { await addNote(body); toast('Note added; the COA is made again.'); delete session.ready[it.sample_id]; setText(''); setCanned(''); reload(); }
    catch (e) { toast(e.message, 'err'); } finally { setBusy(false); }
  }
  async function remove(n) {
    const reason = await dialogs.reason('removing this note'); if (reason === null) return;
    try { await removeNote(n.id, reason); delete session.ready[it.sample_id]; reload(); } catch (e) { toast(e.message, 'err'); }
  }
  async function signAll() {
    const items = session.items.filter((y) => session.ready[y.sample_id]);
    if (!items.length) return;
    const reissue = items.some((y) => !y.tests.length);
    const out = await dialogs.sign({
      what: `Finalize and issue ${items.length} COA${items.length > 1 ? 's' : ''}: ${items.map((y) => y.sample_code).join(', ')}. One signature applies to each COA separately.${reissue ? ' A new version without a new result needs the reason (e.g. a corrected client detail).' : ''}`,
      meaning: 'Finalized by', needReason: reissue,
      submit: ({ signature, reason }) => finalize({ signature, reason, items: items.map((y) => ({ sample_id: y.sample_id, tests: y.tests, acks: session.acks[y.sample_id] || {} })) }) });
    if (!out) return;
    const issued = out.issued.filter((y) => !y.held); const held = out.issued.filter((y) => y.held);
    toast(`${out.group}: ${issued.length} COA${issued.length === 1 ? '' : 's'} issued and placed in the Outbox${held.length ? `; ${held.length} finalized and held for the final COA (no partial reports)` : ''}.`);
    session.items = session.items.filter((y) => !session.ready[y.sample_id]); session.ready = {}; session.i = 0;
    if (session.items.length) bump(); else window.location.hash = '#/reports/finalization';
  }

  const subtitle = <>
    <a href={'#/samples/' + s.id}>{s.sample_code}</a>{s.client_sample_id ? ` (${s.client_sample_id})` : ''} · <a href={'#/clients/' + s.client_id}>{s.client_name}</a>
    {` · Report ${c.report_id || c.coa_code} · version ${c.version_no}${c.is_final ? ' (final)' : ''} `}{c.is_gmp && <Badge status="GMP" />}
  </>;
  const changed = (a) => Object.keys(a.changed_fields || {}).filter((f) => !['record_version', 'modified_at', 'modified_by'].includes(f)).join(', ') || 'changed';
  const testNotes = x.tests.filter((t) => t.special_instructions);

  return <>
    <PageHeader title={heading} subtitle={subtitle} actions={BACK} audit={{ kind: 'sample', id: s.id }} />
    <div className="fzchips">{session.items.map((y, k) => {
      const dd = session.data[y.sample_id]; const bl = dd && dd.checks.some((q) => q.level === 'Block');
      return <button key={y.sample_id} type="button" onClick={() => go(k)} className={[k === session.i ? 'on' : '', session.ready[y.sample_id] ? 'ready' : '', bl ? 'blocked' : ''].join(' ')}>
        {session.ready[y.sample_id] ? '✓ ' : ''}{y.sample_code}</button>;
    })}</div>
    <div className="fz">
      <div className="hist">
        <Card body><h2>Submission</h2><Kv pairs={[['Order', <a href={'#/orders/' + s.order_id}>{s.order_code}</a>], ['PO', s.po_number], ['Channel', s.channel],
          ['Received', dt(s.received_at || s.logged_at)], ['Logged', `${dt(s.logged_at)}${s.logged_by_name ? ' by ' + s.logged_by_name : ''}`], ['Category', s.compliance_category || 'Not given'],
          ['Condition', s.condition], ['Temperature', s.receipt_temperature === null ? '' : s.receipt_temperature + ' °C'], ['Lot', s.lot], ['Description', s.description],
          ['Client', <>{s.client_name}{s.account_status !== 'Active' && <> <Badge status={s.account_status} /></>}</>], ['Partial reports', s.allow_partial_reports ? 'Yes' : 'No: one COA at the end']]} /></Card>
        <Card body><h2>Notes and comments</h2>
          {s.order_notes && <p className="help"><b>Order:</b> {s.order_notes}</p>}
          {testNotes.map((t) => <p key={t.requested_test_id || t.test_name} className="help"><b>{t.test_name}:</b> {t.special_instructions}</p>)}
          {x.notes.length ? x.notes.map((n) => <div key={n.id} className="note"><span className="k">{n.kind === 'Internal' ? 'Internal' : 'On the COA'}{noteOn(n, true)} · {n.by_name}</span><br />{n.note_text}</div>)
            : (!s.order_notes && !testNotes.length && <p className="help">None.</p>)}</Card>
        <Card body><h2>Attachments</h2>{x.attachments.length
          ? <ul>{x.attachments.map((a) => <li key={a.id}><a href={attachmentUrl(a.id, siteId)} target="_blank" rel="noopener noreferrer">{a.label || a.file_name}</a> <span className="help">{a.kind}{a.sample_id ? '' : ', whole order'}</span></li>)}</ul>
          : <p className="help">No attachments.</p>}</Card>
        <Card body><h2>History</h2><ul>
          {x.batches.map((b) => <li key={'b' + b.id}><a href={'#/testing/batches/' + b.id}>{b.batch_code}</a> {b.test_name} ({b.status})</li>)}
          {x.changes.map((a, k) => <li key={'c' + k}>{dt(a.changed_at)} {a.full_name}: {changed(a)}{a.reason ? ` (${a.reason})` : ''}</li>)}
          {x.versions.map((v) => <li key={'v' + v.id}><a href={coaPdfUrl(v.id, siteId)} target="_blank" rel="noopener noreferrer">{v.report_id || v.coa_code} (version {v.version_no})</a> issued {dt(v.issued_at)} by {v.issued_by_name}</li>)}
        </ul></Card>
      </div>
      <div>{d.token ? <>
        <iframe className="pdf" title="COA preview" src={`${previewPdfUrl(d.token)}#navpanes=0&view=Fit`} />
        <p className="help"><a href={previewPdfUrl(d.token)} target="_blank" rel="noopener noreferrer" id="openpdf">Open the PDF in a new tab</a>. The issued PDF is made again when you sign (same content; &quot;Preview, not issued&quot; leaves the footer).</p>
      </> : <Card body className="err">The PDF could not be made: see the release check.</Card>}</div>
      <div className="side">
        <Card body id="checks"><h2>Release check</h2>
          {d.checks.map((k) => <div key={k.code} className={`chk ${k.level}`} data-code={k.code}><span className="lv">{k.level}</span><b>{k.title}</b>{k.detail}
            {(k.links || []).map((l, j) => <a key={j} className="lk" href={l.href}>{l.text}</a>)}
            {k.level === 'Warning' && <textarea rows={2} data-ack={k.code} placeholder="Why it can be released despite this (required)" defaultValue={acks[k.code] || ''}
              onChange={(e) => { acks[k.code] = e.target.value; }} />}
          </div>)}
        </Card>
        <Card body><h2>Add a note</h2>{d.can_notes ? <>
          <div className="field"><label htmlFor="nk">Kind</label><SmartSelect id="nk" value={kind} options={KIND_OPTS} onChange={(v) => { noteLast.kind = v; setKind(v); }} /></div>
          <div className="field"><label htmlFor="nt">On</label><SmartSelect id="nt" value={on} options={onOptions} onChange={(v) => { noteLast.on = v; setOn(v); }} /></div>
          <div className="field"><label htmlFor="nc">Canned comment</label><SmartSelect id="nc" value={canned} options={cannedOpts} onChange={setCanned} /></div>
          <div className="field"><label htmlFor="nx">Or type it</label><textarea id="nx" rows={2} value={text} onChange={(e) => setText(e.target.value)} /></div>
          <Button type="button" variant="outline-secondary" disabled={busy} onClick={add}>Add the note</Button>
          {x.notes.length > 0 && <><h3 style={{ margin: '12px 0 4px', fontSize: 13 }}>On this sample</h3>
            {x.notes.map((n) => <div key={n.id} className="note"><Button type="button" variant="light" title="Remove the note" onClick={() => remove(n)}>×</Button>
              <span className="k">{n.kind === 'Internal' ? 'Internal' : 'On the COA'}{noteOn(n, false)}</span><br />{n.note_text}</div>)}</>}
        </> : <p className="help">You need reports.notes to add notes.</p>}</Card>
      </div>
    </div>
    <div className="fzbar">
      <Button type="button" variant="outline-secondary" disabled={!session.i} onClick={() => go(session.i - 1)}>Previous</Button>
      <Button type="button" variant={ready ? 'outline-secondary' : 'primary'} disabled={blocks.length > 0} onClick={markReady}>{ready ? 'Ready ✓ (undo)' : 'Mark ready and go to the next'}</Button>
      <Button type="button" variant="outline-secondary" disabled={session.i >= session.items.length - 1} onClick={() => go(session.i + 1)}>Next</Button>
      <span className="help">{nReady} of {session.items.length} ready{blocks.length ? ' · this COA is blocked: see the release check' : ''}</span>
      <span style={{ flex: 1 }} />
      <Button type="button" variant="primary" disabled={!nReady} onClick={signAll}>Sign and issue {nReady} COA{nReady === 1 ? '' : 's'}</Button>
    </div>
  </>;
}
