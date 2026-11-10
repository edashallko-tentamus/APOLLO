// The product name (one system setting): shown in the header, the browser tab and the sign-in page.
//   <ProductNameCard sysAdmin={bool} />  (used by Admin > Sites and holidays)
import { getPublicSettings, saveSettings } from '../../api/labsetup.js';
import Section from '../../components/Section.jsx';
import { useDialogs } from '../../components/dialogs/DialogProvider.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { useApi } from '../../hooks/useApi.js';

export default function ProductNameCard({ sysAdmin }) {
  const dialogs = useDialogs();
  const toast = useToast();
  const { data: s, error, reload } = useApi(getPublicSettings, []);

  async function change() {
    const v = await dialogs.form({ title: 'Product name',
      fields: [{ name: 'product_name', label: 'Name', value: s.product_name || 'LIMS3', required: true, help: 'Check the name is free to use (trademark) before changing it.' }] });
    if (!v) return;
    const reason = await dialogs.reason('the product name'); if (reason === null) return;
    try { await saveSettings({ product_name: v.product_name, reason }); toast('Name changed: reload the page to see it everywhere.'); reload(); } catch (e) { toast(e.message, 'err'); }
  }

  return (
    <Section title="Product name" help="The system's name in the header, the browser tab and the sign-in page. One setting, so a rename is one change. System administrators change it."
      actions={sysAdmin && s && <button type="button" className="btn" onClick={change}>Change…</button>}>
      {error ? <div className="err">{error.message}</div> : !s ? <div className="loading">Loading…</div> : <div className="pname">{s.product_name || 'LIMS3'}</div>}
    </Section>
  );
}
