// Purchasing > Settings: each lab decides when a General Manager must also approve a request (signed, with a reason).
import { useState } from 'react';
import { getSettings, purchasingMe, saveSettings } from '../../api/purchasing.js';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Failed, Kv, Loading, money, NeedLab, PuTabs, signed } from './shared.jsx';

const AUDIT = { kind: 'purchasing' };

export default function SettingsPage() {
  const { site } = useSession();
  const dialogs = useDialogs();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi(() => (site ? Promise.all([getSettings(), purchasingMe()]) : Promise.resolve(null)), [site?.id]);
  if (!site) return <NeedLab />;
  const [s, me] = data || [];

  const edit = async () => {
    setBusy(true);
    try {
      const v = await dialogs.form({ title: 'Second approval amount', okText: 'Next: sign', intro: 'Leave empty for no second approval.',
        fields: [{ name: 'second_approval_over', label: 'Second approval above (USD)', type: 'number', value: s.second_approval_over ?? '' }] });
      if (!v) return;
      const ok = await signed(dialogs, { what: `Second approval above ${v.second_approval_over === '' ? 'no amount' : money(v.second_approval_over)}`, meaning: 'Changed by', needReason: true },
        (reason, signature) => saveSettings(v, reason, signature));
      if (ok) { toast('Saved and signed.'); reload(); }
    } finally { setBusy(false); }
  };

  return <>
    <PageHeader title={`Purchasing settings: ${site.site_code}`} audit={AUDIT} subtitle="Each lab decides when a General Manager must also approve a request." />
    <PuTabs />
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : (
      <div className="card">
        <Kv pairs={[['Second approval above', s.second_approval_over === null || s.second_approval_over === undefined ? 'Not set: one approval is enough' : money(s.second_approval_over) + ' per request (quantity × price)'],
          ['Requests without a price', 'Need only one approval (the price is unknown)']]} />
        {me.can_settings
          ? <div className="actbar" style={{ marginTop: 12 }}><button type="button" className="btn primary" disabled={busy} onClick={edit}>Change</button></div>
          : <p className="help">Changing this needs the admin.lab permission (lab administrators).</p>}
      </div>)}
  </>;
}
