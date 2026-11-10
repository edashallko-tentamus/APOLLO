// #/methods: Tests and workflows (the Workflow Designer's list), and the New test dialog (signed "Created by").
import { useEffect, useMemo, useRef } from 'react';
import { createTest, listTests, newTestOptions } from '../../api/methods.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { ListTabs, Loading, NeedLab, useSigned } from './shared.jsx';

const FILTERS = { all: ['All', () => true], effective: ['Effective', (r) => r.effective_version], drafts: ['Drafts', (r) => r.draft_version], lab: ['This lab only', (r) => !!r.site_id] };
const testHref = (r) => '#/methods/tests/' + r.id;
const COLUMNS = [
  { field: 'test_code', title: 'Code', type: 'link', width: 85, href: testHref },
  { field: 'test_name', title: 'Test', type: 'link', width: 300, href: testHref },
  { field: 'site_code', title: 'Lab', type: 'readonly', width: 70, format: (v) => v || 'Shared' },
  { field: 'department_code', title: 'Dept.', type: 'readonly', width: 70 },
  { field: 'method_name', title: 'Method', type: 'readonly', width: 230, format: (v, r) => (v ? `${v}${r.sop_code ? ' (' + r.sop_code + ')' : ''}` : '') },
  { field: 'effective_version', title: 'Effective', type: 'link', width: 80, compute: (r) => (r.effective_version ? 'v' + r.effective_version : ''), href: (r) => (r.effective_version_id ? '#/methods/versions/' + r.effective_version_id : null) },
  { field: 'draft_version', title: 'Draft', type: 'link', width: 70, compute: (r) => (r.draft_version ? 'v' + r.draft_version : ''), href: (r) => (r.draft_version_id ? '#/methods/versions/' + r.draft_version_id : null) },
  { field: 'draft_problems', title: 'To fix', type: 'readonly', width: 70, help: 'Problems the database finds in the draft (it cannot be approved until they are fixed)',
    format: (v, r) => (r.draft_version ? (Number(v) ? String(v) : 'None') : ''), cellClass: (r) => (r.draft_version && Number(r.draft_problems) ? 'flag' : '') },
  { field: 'analyte_count', title: 'Analytes', type: 'readonly', width: 75 },
  { field: 'step_count', title: 'Steps', type: 'readonly', width: 60 },
];
const AUDIT = { kind: 'methods' };
const SUB = 'Test Workflow Designer. Each test belongs to a lab and a department; its scientific content (method, analytes, workflow) is versioned and becomes effective only when approved. Tests made before the designer are shared by all labs.';

// The New test dialog, then its signature; opens the new Draft
export function useNewTest() {
  const dialogs = useDialogs(); const toast = useToast(); const signed = useSigned();
  return async () => {
    let o;
    try { o = await newTestOptions(); } catch (e) { toast(e.message, 'err'); return; }
    const v = await dialogs.form({ title: 'New test', okText: 'Create draft', intro: 'The test belongs to this lab. Version 1 starts as a Draft: add its analytes and workflow, then someone who did not work on it approves it.',
      fields: [
        { name: 'test_name', label: 'Test name (as it appears on the catalogue, quote and Certificate of Analysis)', required: true },
        { name: 'department_id', label: 'Department', type: 'select', options: o.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}` })) },
        { name: 'method_id', label: 'Method (SOP)', type: 'select', options: o.methods.map((x) => ({ value: x.id, label: `${x.method_name}${x.sop_code ? ' (' + x.sop_code + ')' : ''}` })), help: 'Add methods on the Methods (SOPs) tab.' },
      ] });
    if (!v) return;
    const row = { ...v, department_id: v.department_id || null, method_id: v.method_id || null };
    const t = await signed(`New test: ${v.test_name}`, 'Created by', (reason, signature) => createTest(row, signature));
    if (t) { toast('Test created and signed: version 1 is a Draft.'); location.hash = '#/methods/versions/' + t.version_id; }
  };
}

export default function TestsListPage({ query }) {
  const { site } = useSession();
  const q = new URLSearchParams(query);
  const { data: d, error } = useApi((o) => (site ? listTests(o) : Promise.resolve(null)), [site?.id]);
  const newTest = useNewTest();
  const f = FILTERS[q.get('show')] ? q.get('show') : 'all';
  const rows = useMemo(() => (d ? d.rows.filter(FILTERS[f][1]) : []), [d, f]);
  const asked = useRef(false);
  useEffect(() => { if (d?.can_design && q.get('new') === '1' && !asked.current) { asked.current = true; newTest(); } }); // eslint-disable-line react-hooks/exhaustive-deps
  const header = <PageHeader title="Tests and workflows" subtitle={SUB} audit={AUDIT}
    actions={d?.can_design && <button type="button" className="btn primary" id="new" onClick={newTest}>+ New test</button>} />;
  if (!site) return <NeedLab />;
  if (error && !d) return <>{header}<div className="card err">{error.message}</div></>;
  if (!d) return <>{header}<Loading /></>;
  return <>
    {header}
    <ListTabs cur="#/methods" />
    <div className="wdbar">{Object.entries(FILTERS).map(([k, [l, fn]]) => (
      <a key={k} className={`btn ${k === f ? 'primary' : ''}`} href={`#/methods?show=${k}`}>{l} <small>{d.rows.filter(fn).length}</small></a>))}</div>
    <ReadGrid rows={rows} columns={COLUMNS} search filter={q.get('find') || ''} emptyText="No tests yet."
      onRowOpen={(r) => { location.hash = testHref(r); }} />
  </>;
}
