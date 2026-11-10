// #/methods/tests/:id: a test and its versions; Duplicate, Copy to another lab and New version (each signed "Created by").
import { copyTest, getTest, newVersion } from '../../api/methods.js';
import Badge from '../../components/Badge.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Card, d8, dt, Loading, useSigned } from './shared.jsx';

const VERSION_COLUMNS = [
  { field: 'version_no', title: 'Version', type: 'link', width: 75, compute: (r) => 'v' + r.version_no, href: (r) => '#/methods/versions/' + r.id },
  { field: 'status', title: 'Status', type: 'readonly', width: 100 },
  { field: 'effective_from', title: 'Effective from', type: 'readonly', width: 150, format: dt },
  { field: 'approved_by_name', title: 'Approved by', type: 'readonly', width: 150 },
  { field: 'change_summary', title: 'What changed', type: 'readonly', width: 280 },
  { field: 'method_name', title: 'Method', type: 'readonly', width: 220 },
  { field: 'created_by_name', title: 'Started by', type: 'readonly', width: 140 },
];

// New version of a test (signed); opens it
export function useNewVersion() {
  const signed = useSigned(); const toast = useToast();
  return async (t, msg = 'New Draft version created and signed, as a copy of the effective one.') => {
    const x = await signed(`New version of ${t.test_code} ${t.test_name}`, 'Created by', (reason, signature) => newVersion(t.id, signature));
    if (x) { toast(msg); location.hash = '#/methods/versions/' + x.id; }
  };
}

export default function TestPage({ params: [id] }) {
  const { site } = useSession();
  const dialogs = useDialogs(); const toast = useToast(); const signed = useSigned(); const startVersion = useNewVersion();
  const { data: d, error, reload } = useApi((o) => getTest(id, o), [id]);
  if (error && !d) return <><PageHeader title="Test" /><div className="card err">{error.message}</div></>;
  if (!d) return <><PageHeader title="Test" /><Loading /></>;
  const t = d.test;
  const draft = d.versions.find((v) => v.status === 'Draft');
  const eff = d.versions.find((v) => v.status === 'Effective');

  async function copyTo(dup) {
    const v = await dialogs.form({ title: dup ? 'Duplicate as a new test' : 'Copy to another lab', okText: dup ? 'Duplicate' : 'Copy',
      intro: dup ? 'A new test in this lab with the same method, analytes and workflow: a quick template. Its version 1 is a Draft to change and approve.'
        : 'The receiving lab gets its own test with a Draft version 1 to check and approve. Departments are matched by code and equipment types by name; anything that does not match shows as a problem to fix. Prices are copied and can be changed in that lab\'s catalogue.',
      fields: [
        ...(dup ? [] : [{ name: 'site_id', label: 'Lab', type: 'select', required: true, options: d.sites.filter((s) => s.id !== t.site_id).map((s) => ({ value: s.id, label: `${s.site_code} ${s.site_name}` })) }]),
        { name: 'test_name', label: 'Name of the new test', required: true, value: dup ? t.test_name + ' (copy)' : t.test_name },
      ] });
    if (!v) return;
    const x = await signed(`${dup ? 'Duplicate' : 'Copy to another lab'} of ${t.test_code} ${t.test_name}: ${v.test_name}`, 'Created by',
      (reason, signature) => copyTest(t.id, { site_id: dup ? t.site_id : v.site_id, test_name: v.test_name, signature }));
    if (!x) return;
    toast(`${x.test_code} created with a Draft version 1 (signed).`);
    if (dup || x.site_id === site?.id) location.hash = '#/methods/versions/' + x.version_id; else reload();
  }

  const subtitle = <><a href={`#/methods/tests/${t.id}`}>{t.test_code}</a> <Badge status={t.status} /> · {t.site_code || 'Shared by all labs'}{t.department_name ? ' · ' + t.department_name : ''}
    {t.copied_from_code && <> · copied from <a href={'#/methods/tests/' + t.copied_from_test_id}>{t.copied_from_code}</a></>}</>;
  const actions = <>
    <a className="btn ghost" href="#/methods">All tests</a>{' '}
    {t.has_catalog_entry && <><a className="btn" href={`#/catalog/${t.id}`}>Pricing and turnaround</a>{' '}</>}
    {d.can_design && <><button type="button" className="btn" id="dup" onClick={() => copyTo(true)}>Duplicate</button>{' '}
      <button type="button" className="btn" id="copy" onClick={() => copyTo(false)}>Copy to another lab</button>{' '}</>}
    {draft ? <a className="btn primary" href={`#/methods/versions/${draft.id}`}>Open draft v{draft.version_no}</a>
      : d.can_design && <button type="button" className="btn primary" id="newv" onClick={() => startVersion(t)}>New version</button>}
  </>;
  return <>
    <PageHeader title={t.test_name} subtitle={subtitle} actions={actions} audit={{ kind: 'testdef', id: t.id }} />
    <div className="wdcards">
      <Card label="Effective version">{eff ? <><a href={'#/methods/versions/' + eff.id}>v{eff.version_no}</a> since {d8(eff.effective_from)}</> : 'None: cannot be ordered yet'}</Card>
      <Card label="Draft">{draft ? <a href={'#/methods/versions/' + draft.id}>v{draft.version_no}</a> : 'None'}</Card>
      <Card label="Method">{t.method_name || '—'}{t.sop_code && <> <small>{t.sop_code}</small></>}</Card>
      <Card label="Analytes / steps">{t.analyte_count} / {t.step_count}</Card>
    </div>
    <Section title="Versions" help="Every version is kept. Requested tests keep the version that was effective when they were ordered.">
      <ReadGrid rows={d.versions} columns={VERSION_COLUMNS} />
    </Section>
    {d.copies.length > 0 && <Section title="Copies and duplicates of this test">
      {d.copies.map((x, i) => <span key={x.id}>{i > 0 && <br />}<a href={'#/methods/tests/' + x.id}>{x.test_code}</a> {x.test_name} ({x.site_code || 'Shared'})</span>)}
    </Section>}
  </>;
}
