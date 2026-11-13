// Admin > Dashboard widgets: the widgets each group sees on Home at this lab (tick, fill down, save with a reason).
import { useMemo } from 'react';
import { getWidgetsAdmin, saveWidgetsAdmin } from '../../api/dashboard.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { Card } from 'react-bootstrap';

const AUDIT = { kind: 'dashboard_widgets' };
const SUB = 'The widgets each group sees on Home at this lab. A person in several groups gets all of their widgets, then arranges and resizes their own. Widgets that need a permission (revenue, quotes) show only to people who hold it. Tick or untick, fill down with Ctrl+D, then save with a reason.';
const save = (changes, reason) => saveWidgetsAdmin(changes.flatMap((ch) => Object.keys(ch).filter((k) => k.startsWith('g_'))
  .map((k) => ({ group_id: k.slice(2), widget_code: ch.id, on: !!ch[k] }))), reason);

export default function WidgetsAdminPage() {
  const { data: d, error, reload } = useApi((o) => getWidgetsAdmin(o), []);
  const rows = useMemo(() => {
    if (!d) return [];
    const on = new Set(d.on.map((x) => `${x.group_id}|${x.widget_code}`));
    return d.widgets.map((w) => {
      const r = { id: w.code, title: w.title, category: w.category, description: w.description };
      for (const g of d.groups) r['g_' + g.id] = on.has(`${g.id}|${w.code}`);
      return r;
    });
  }, [d]);
  const columns = useMemo(() => (d ? [
    { field: 'title', title: 'Widget', type: 'readonly', width: 200 }, { field: 'category', title: 'Area', type: 'readonly', width: 100 },
    ...d.groups.map((g) => ({ field: 'g_' + g.id, title: g.site_id ? g.group_name : `${g.group_name} (all labs)`, type: 'bool', width: 105 })),
    { field: 'description', title: 'What it shows', type: 'readonly', width: 420 }] : []), [d]);

  return <>
    <PageHeader title="Dashboard widgets" subtitle={SUB} audit={AUDIT} />
    {error && !d ? <Card body className="err">{error.message}</Card> : !d ? <div className="loading">Loading…</div> : <>
      {!d.can_edit && <Card body className="warn">Changing a group&apos;s widgets needs admin.groups in this lab.</Card>}
      <Card body>
        <EditableGrid rows={rows} columns={columns} readOnly={!d.can_edit} what="the groups' dashboard widgets" save={save} afterSave={reload} />
      </Card>
    </>}
  </>;
}
