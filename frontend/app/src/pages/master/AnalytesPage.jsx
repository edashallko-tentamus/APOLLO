// Analytes: static master table, independent of Inventory. Molar mass is kept by QA, Lab Supervisors and administrators,
// with a source and an electronic signature.
import { useMemo } from 'react';
import { listAnalytes, saveAnalytes } from '../../api/master.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useMeta } from '../../hooks/useMeta.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Card } from 'react-bootstrap';

const AUDIT = { kind: 'analytes' };
const newRow = () => ({ status: 'Active', analyte_class: 'Chemical', synonyms: [] });
const sign = (rows) => (rows.some((r) => (r.id ? 'molar_mass' in r || 'molar_mass_source' in r : r.molar_mass != null || r.molar_mass_source))
  ? { meaning: 'Changed by', action: `Analyte molar mass: ${rows.length} row(s)` } : null);

export default function AnalytesPage({ query }) {
  const { can } = useSession();
  const meta = useMeta();
  const canMolar = can('master.molar_mass');
  const { data, error, reload } = useApi(listAnalytes, []);
  const columns = useMemo(() => [
    { field: 'analyte_code', title: 'Code', type: 'link', width: 95, href: (r) => (r.analyte_code ? '#/analytes?find=' + encodeURIComponent(r.analyte_code) : null) },
    { field: 'analyte_name', title: 'Analyte name', required: true, width: 200 },
    { field: 'report_name', title: 'Report name (CoA)', width: 200, help: 'Defaults to the analyte name if left blank' },
    { field: 'analyte_class', title: 'Class', type: 'select', options: meta?.enums.analyte_class || [], width: 140 },
    { field: 'cas_number', title: 'CAS number', width: 120, help: 'Chemical analytes only; check digit is validated' },
    { field: 'synonyms', title: 'Synonyms', type: 'array', width: 160 },
    { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Retired'], width: 90 },
    { field: 'molar_mass', title: 'Molar mass (g/mol)', type: 'number', min: 0, width: 120, editable: () => canMolar, help: canMolar ? 'Needs a source; saved with your electronic signature' : 'Maintained by QA and Lab Supervisors' },
    { field: 'molar_mass_source', title: 'Molar mass source', width: 220, editable: () => canMolar, help: 'e.g. IUPAC standard atomic weights 2021, or the supplier certificate' },
  ], [meta, canMolar]);

  return <>
    <PageHeader title="Analytes" audit={AUDIT} subtitle={`Static master table, independent of Inventory. Report Name prints on the Certificate of Analysis. Molar mass converts molar standards (M, mol/L) to mg/L in mixtures; ${canMolar ? 'changing it asks for its source and your electronic signature' : 'QA and Lab Supervisors maintain it'}.`} />
    {error ? <Card body className="err">{error.message}</Card> : !data ? <div className="loading">Loading…</div> : (
      <EditableGrid rows={data} columns={columns} allowAdd search filter={new URLSearchParams(query).get('find') || ''} what="analyte master data"
        newRow={newRow} sign={sign} save={saveAnalytes} afterSave={reload} />
    )}
  </>;
}
