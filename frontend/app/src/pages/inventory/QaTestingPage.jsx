// QA testing before use (migration 040): which item types the lab tests before use (QA keeps the list, with a reason),
// and the lots waiting for, in, or failing QA testing
import { qaDefaults, saveQaDefaults } from '../../api/inventory.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { d8, Failed, InvTabs, Loading, NeedLab, qaCls, ReadGrid } from './shared.jsx';

const DEFAULT_COLS = [
  { field: 'chemical_type', title: 'Item type', type: 'readonly', width: 190 },
  { field: 'required', title: 'Tested before use', type: 'bool', width: 130, help: 'Tick for the types your lab tests before use (fill down with Ctrl+D)' },
  { field: 'note', title: 'Note (e.g. the SOP)', width: 300 },
  { field: 'waiting', title: 'Lots waiting', type: 'readonly', width: 100, align: 'right' },
  { field: 'modified_by_name', title: 'Last changed by', type: 'readonly', width: 160, format: (v, r) => `${v || ''} ${r.modified_at ? new Date(r.modified_at).toLocaleDateString() : ''}` },
];
const LOT_COLS = [
  { field: 'lot_code', title: 'ID', type: 'link', width: 100, href: (r) => '#/inventory/lots/' + r.id },
  { field: 'material', title: 'Name', type: 'readonly', width: 260 },
  { field: 'manufacturer_lot', title: 'Lot#', type: 'readonly', width: 120 },
  { field: 'chemical_types_text', title: 'Type', type: 'readonly', width: 170 },
  { field: 'received_date', title: 'Received', type: 'readonly', width: 100, format: d8 },
  { field: 'qa_status', title: 'QA testing', type: 'readonly', width: 200, cellClass: (r) => qaCls(r.qa_status) },
];
const openLot = (r) => { window.location.hash = '#/inventory/lots/' + r.id; };

export default function QaTestingPage() {
  const { site } = useSession();
  const { data: d, error, reload } = useApi((o) => qaDefaults({ fresh: true, ...o }), []);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`QA testing before use: ${site.site_code}`} audit={{ kind: 'qa_testing' }}
      subtitle={'Items of the types ticked here are quarantined when they are received: they cannot be used at the bench or in a mixture until a QA test, run on a sample carrying the lot\'s ID, releases them (for every use, or for named tests). A lot that fails is rejected for every use until a retest passes. Any item can also be sent for QA testing from its page.'} />
    <InvTabs />
    {error && !d ? <Failed error={error} /> : !d ? <Loading /> : <>
      {!d.can_edit && <div className="notice">You can view these settings. QA keeps them (inventory.qa_configure).</div>}
      <Section title="Item types tested before use" help={'Changing a type affects items received from now on. Items already received keep their status; a lot can still be sent for QA testing, or QA can waive it, from the lot\'s page.'}>
        <EditableGrid rows={d.rows} columns={DEFAULT_COLS} readOnly={!d.can_edit} what="QA testing defaults" save={saveQaDefaults} afterSave={reload} />
      </Section>
      <Section title="Lots waiting for QA testing, being tested, or rejected" help="Open a lot to send it for QA testing, retest it or dispose of it.">
        <ReadGrid rows={d.lots} columns={LOT_COLS} search emptyText="No lot is waiting for QA testing." onRowOpen={openLot} />
      </Section>
    </>}
  </>;
}
