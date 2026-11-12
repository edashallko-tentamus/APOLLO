// A logbook (#/logbooks/:id): tabs Entries, Record entries (a grid signed once), Design (versions approved by QA),
// Equipment covered (limits per unit).
import { useMemo } from 'react';
import { getLogbook } from '../../api/logbooks.js';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { fmtN } from './calc.js';
import DesignTab from './DesignTab.jsx';
import EntriesTab from './EntriesTab.jsx';
import EquipmentTab from './EquipmentTab.jsx';
import RecordTab from './RecordTab.jsx';
import './logbooks.css';
import { Card } from 'react-bootstrap';

const ABOUT = { Equipment: 'a piece of equipment', Lot: 'an inventory lot', Sample: 'a sample', None: 'nothing in particular (one per day, week...)' };

export default function LogbookPage({ params: [id], query }) {
  const q = new URLSearchParams(query);
  const filt = { from: q.get('from') || '', to: q.get('to') || '', equipment: q.get('equipment') || '', status: q.get('status') || '' };
  const { data: d, error, reload } = useApi((o) => getLogbook(id, filt, o), [id, filt.from, filt.to, filt.equipment, filt.status]);
  const eff = useMemo(() => (d ? d.fields.filter((f) => f.version_id === d.effective_id) : []), [d]);
  const draftF = useMemo(() => (d ? d.fields.filter((f) => f.version_id === d.draft_id) : []), [d]);
  if (error && !d) return <><PageHeader title="Logbook" /><Card body className="err">{error.message}</Card></>;
  if (!d) return <><PageHeader title="Logbook" /><div className="loading">Loading…</div></>;

  const l = d.logbook;
  const tab = q.get('tab') || (d.effective_id ? 'entries' : 'design');
  const dueN = d.due.filter((x) => x.due).length;
  const tabs = [
    ['entries', 'Entries', `${d.entries.length}${d.entries.length >= 500 ? '+' : ''}`],
    ...(d.can_record && d.effective_id && l.status === 'Active' ? [['record', 'Record entries', dueN ? `${dueN} due` : '']] : []),
    ['design', 'Design', `${d.effective_id ? 'v' + l.effective_version : 'not approved'}${d.draft_id ? ', draft' : ''}`],
    ...(l.subject === 'Equipment' ? [['equipment', 'Equipment covered', String(d.equipment.length)]] : []),
  ];
  const sub = `${l.kind} logbook about ${ABOUT[l.subject] || l.subject}. Entries ${l.entry_frequency === 'As needed' ? 'as needed' : 'due ' + l.entry_frequency.toLowerCase()}; QA approves them ${l.review_route === 'Batch' ? 'in the batch that uses them' : l.review_frequency.toLowerCase()}; entries are ${l.signing === 'Signature' ? 'signed' : 'recorded without a signature'}.${l.validity_hours ? ` An entry can be used for ${fmtN(l.validity_hours)} h.` : ''}${l.creates_lot ? ' Each entry makes an inventory lot.' : ''}`;

  return <>
    <PageHeader title={`${l.logbook_code} ${l.logbook_name}`} subtitle={sub} audit={{ kind: 'logbook', id: l.id }} />
    <div className="tabs">{tabs.map(([k, t, n]) => (
      <a key={k} className={`tab ${k === tab ? 'on' : ''}`} href={`#/logbooks/${l.id}?tab=${k}`}>{t}{n && <> <small>{n}</small></>}</a>
    ))}</div>
    {tab === 'record' ? <RecordTab d={d} l={l} fields={eff} reload={reload} />
      : tab === 'design' ? <DesignTab key={d.draft_id || d.effective_id || 'none'} d={d} l={l} eff={eff} draftF={draftF} reload={reload} />
        : tab === 'equipment' ? <EquipmentTab d={d} l={l} fields={d.draft_id ? draftF : eff} reload={reload} />
          : <EntriesTab d={d} l={l} filt={filt} />}
  </>;
}
