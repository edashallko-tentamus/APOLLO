// #/methods/versions/:id: the designer for one version: 1 Test and reporting, 2 Analytes, 3 Workflow (diagram and step
// editor), 4 Review and approve. Drafts change freely (every change signed); a version becomes Effective only by signed
// approval from someone who did not work on it, once the database finds no problems.
import { getVersion } from '../../api/methods.js';
import Badge from '../../components/Badge.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { dt, Loading } from './shared.jsx';
import TabAnalytes from './TabAnalytes.jsx';
import TabReview from './TabReview.jsx';
import TabTest from './TabTest.jsx';
import TabWorkflow from './TabWorkflow.jsx';
import { useNewVersion } from './TestPage.jsx';
import { Button, Card, Nav } from 'react-bootstrap';

const TABS = [['test', '1 Test and reporting'], ['analytes', '2 Analytes'], ['workflow', '3 Workflow'], ['review', '4 Review and approve']];

export default function DesignerPage({ params: [vid], query }) {
  const q = new URLSearchParams(query);
  const { data, error, reload } = useApi((o) => getVersion(vid, o), [vid]);
  const startVersion = useNewVersion();
  if (error && !data) return <><PageHeader title="Test version" /><Card body className="err">{error.message}</Card></>;
  if (!data) return <><PageHeader title="Test version" /><Loading /></>;
  const v = data.version; const t = data.test;
  const d = { ...data, editable: v.status === 'Draft' && data.can_design };
  const tab = TABS.some(([k]) => k === q.get('tab')) ? q.get('tab') : 'test';
  const errors = d.problems.filter((p) => p.severity === 'Error');

  const subtitle = <><a href={'#/methods/tests/' + t.id}>{t.test_code}</a> <Badge status={v.status} /> · {t.site_code || 'Shared by all labs'}{t.department_name ? ' · ' + t.department_name : ''}
    {' · Versions: '}{d.versions.map((x) => <span key={x.id}>{x.id === v.id ? <b>v{x.version_no}</b> : <a href={'#/methods/versions/' + x.id}>v{x.version_no}</a>}{' '}</span>)}</>;
  const actions = <>
    <Button variant="light" href={`#/methods/tests/${t.id}`}>Test page</Button>
    {v.status !== 'Draft' && d.can_design && !t.draft_version && <> <Button type="button" variant="outline-secondary" id="newv" onClick={() => startVersion(t, 'New Draft version created and signed.')}>New version</Button></>}
    {t.draft_version_id && t.draft_version_id !== v.id && <> <Button variant="outline-secondary" href={`#/methods/versions/${t.draft_version_id}`}>Open draft v{t.draft_version}</Button></>}
  </>;
  const Tab = { test: TabTest, analytes: TabAnalytes, workflow: TabWorkflow, review: TabReview }[tab];
  return <>
    <PageHeader title={`${t.test_name}: version ${v.version_no}`} subtitle={subtitle} actions={actions} audit={{ kind: 'testdef', id: t.id }} />
    <Nav variant="pills" className="wdtabs">{TABS.map(([k, l]) => <Nav.Link active={k === tab} key={k} href={`#/methods/versions/${vid}?tab=${k}`}>{l}
      {k === 'review' && v.status === 'Draft' && errors.length> 0 && <> <small>{errors.length}</small></>}</Nav.Link>)}</Nav>
    {v.status === 'Draft'
      ? !d.can_design && <div className="wdlocked">Read only: changing a draft needs methods.design in this lab.</div>
      : <div className="wdlocked">Version {v.version_no} is <b>{v.status}</b>{v.approved_by_name ? `, approved by ${v.approved_by_name} on ${dt(v.approved_at)}` : ''}. It cannot be changed{d.can_design ? ': start a new version to make changes' : ''}.</div>}
    <Tab d={d} reload={reload} query={q} />
  </>;
}
