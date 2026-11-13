// Purchasing > Receive: everything ordered and not yet fully received; Receive on a line when the delivery arrives.
import { useMemo } from 'react';
import { allLines, purchasingMe } from '../../api/purchasing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import ReadGrid from '../../components/grid/ReadGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { receiveDialog } from './dialogs.jsx';
import { Failed, lineColsWithout, Loading, NeedLab, num, openRequest, PuTabs } from './shared.jsx';

const AUDIT = { kind: 'purchasing' };
const OUTSTANDING = { field: 'outstanding', title: 'Still expected', type: 'readonly', width: 100, compute: (r) => `${num(Number(r.quantity) - Number(r.received_quantity))} ${r.unit || ''}` };

export default function ReceivePage() {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const { data, error, reload } = useApi(() => (site ? Promise.all([allLines(), purchasingMe()]) : Promise.resolve(null)), [site?.id]);
  const canReceive = !!data?.[1]?.can_receive;
  const rows = useMemo(() => (data ? data[0].rows.filter((r) => ['Ordered', 'Partly received'].includes(r.status)) : []), [data]);
  const columns = useMemo(() => [
    ...(canReceive ? [{ field: '_rcv', title: '', type: 'button', width: 80, label: 'Receive',
      onClick: async (r) => { if (await receiveDialog({ dialogs, toast }, r, Number(r.quantity) - Number(r.received_quantity))) reload(); } }] : []),
    ...lineColsWithout('requested_at'), OUTSTANDING,
  ], [canReceive, dialogs, toast, reload]);
  if (!site) return <NeedLab />;
  return <>
    <PageHeader title={`Receive: ${site.site_code}`} audit={AUDIT}
      subtitle="Everything ordered and not yet fully received. Click Receive on a line when the delivery arrives; record any problem and attach the packing slip." />
    <PuTabs />
    {error && !data ? <Failed error={error} /> : !data ? <Loading />
      : <ReadGrid rows={rows} columns={columns} search emptyText="Nothing is waiting to be received." onRowOpen={openRequest} />}
  </>;
}
