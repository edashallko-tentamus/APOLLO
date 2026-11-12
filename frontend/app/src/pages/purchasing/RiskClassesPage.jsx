// Purchasing > Risk classes and scopes: how often vendors are re-approved (shared classes kept by Corporate QA, the lab's
// own by QA) and the supply scopes a vendor can be approved for (Corporate QA). Both saves are signed.
import { useCallback, useMemo } from 'react';
import { listRiskClasses, listScopes, purchasingMe, saveRiskClasses, saveScopes } from '../../api/purchasing.js';
import EditableGrid from '../../components/EditableGrid.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Section from '../../components/Section.jsx';
import { useApi } from '../../hooks/useApi.js';
import { useSession } from '../../session/SessionProvider.jsx';
import { Failed, Loading, mutedInactive, NeedLab, PuTabs } from './shared.jsx';

const AUDIT = { kind: 'riskclasses' };
const TYPES = ['Consumable', 'Solvent', 'Reagent', 'Media', 'Reference Standard', 'Microbiological Strain'];
const classSign = (rs) => ({ meaning: 'Changed by', action: `Supplier risk classes: ${rs.length} change(s)` });
const scopeSign = (rs) => ({ meaning: 'Changed by', action: `Supply scopes: ${rs.length} change(s)` });
const newScope = () => ({ status: 'Active', sort_order: 20, line_types: 'Service', chemical_types: '' });
const SCOPE_COLS = [
  { field: 'scope_name', title: 'Scope', required: true, width: 190 }, { field: 'description', title: 'Description', width: 260 },
  { field: 'line_types', title: 'Requests of kind', width: 170, help: 'Inventory item, Equipment, Service, Other (comma-separated)' },
  { field: 'chemical_types', title: 'Item types', width: 200, help: `Inventory items of these types fall under it (one scope per type): ${TYPES.join(', ')}` },
  { field: 'default_for', title: 'Default for', type: 'select', options: ['', 'Equipment', 'Service', 'Other'], width: 105 },
  { field: 'used', title: 'Approvals', type: 'readonly', width: 80 }, { field: 'sort_order', title: 'Order', type: 'int', width: 60 },
  { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85 }];
const strip = (r, ...fields) => { const o = { ...r }; fields.forEach((f) => delete o[f]); return o; };

export default function RiskClassesPage() {
  const { site } = useSession();
  const { data, error, reload } = useApi(() => (site ? Promise.all([listRiskClasses(), purchasingMe(), listScopes({ fresh: true })]) : Promise.resolve(null)), [site?.id]);
  const me = data?.[1] || {};
  const canLab = !!me.can_qualify; const canShared = !!me.can_qualify_corporate;
  const code = site?.site_code;

  const classRows = useMemo(() => (data ? data[0].map((r) => ({ ...r, scope: r.site_id ? code : 'All labs' })) : []), [data, code]);
  const scopeRows = useMemo(() => (data ? data[2].map((x) => ({ ...x, chemical_types: (x.chemical_types || []).join(', '), line_types: (x.line_types || []).join(', ') })) : []), [data]);
  const classCols = useMemo(() => {
    const ed = (r, isNew) => isNew || (r.site_id ? canLab : canShared);
    return [
      { field: 'class_name', title: 'Class', required: true, width: 120, editable: ed },
      { field: 'requal_months', title: 'Re-qualify every (months)', type: 'int', min: 1, required: true, width: 150, editable: ed },
      { field: 'description', title: 'Description', width: 330, editable: ed },
      { field: 'scope', title: 'For', type: 'readonly', width: 80, compute: (r) => (r.site_id ? r.site_code || code : r.id ? 'All labs' : r.shared ? 'All labs' : code) },
      { field: 'used', title: 'Used', type: 'readonly', width: 60 },
      ...(canShared ? [{ field: 'shared', title: 'All labs (new)', type: 'bool', width: 95, editable: (r, isNew) => isNew && canLab, help: 'A new class for every lab (corporate approvals use these)' }] : []),
      { field: 'sort_order', title: 'Order', type: 'int', width: 60, editable: ed },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 85, editable: ed }];
  }, [canLab, canShared, code]);
  const newClass = useCallback(() => ({ status: 'Active', requal_months: 24, sort_order: 10, scope: code, shared: !canLab && canShared }), [code, canLab, canShared]);
  const saveClasses = useCallback((rs, reason, signature) => saveRiskClasses(rs.map((r) => strip(r, 'scope', 'used')), reason, signature), []);
  const saveScopeRows = useCallback((rs, reason, signature) => saveScopes(rs.map((r) => strip(r, 'used')), reason, signature), []);

  if (!site) return <NeedLab />;
  return <>
    <PageHeader title="Risk classes and supply scopes" audit={AUDIT}
      subtitle={`How often vendors are re-approved, and what they can be approved for. The shared classes apply to every lab and to corporate approvals (kept by Corporate QA); ${site.site_code} can add its own (for example a Class IV re-approved every 5 years) for its own approvals.`} />
    <PuTabs />
    {error && !data ? <Failed error={error} /> : !data ? <Loading /> : <>
      {!(canLab || canShared) && <div className="alert alert-warning">QA (purchasing.qualify) keeps this lab's classes; Corporate QA the shared ones and the supply scopes.</div>}
      <Section title="Risk classes">
        <EditableGrid rows={classRows} columns={classCols} allowAdd={canLab || canShared} readOnly={!(canLab || canShared)} what="risk classes"
          newRow={newClass} rowClass={mutedInactive} sign={classSign} save={saveClasses} afterSave={reload} />
      </Section>
      <Section title="Supply scopes" help="What a vendor can be approved for. Inventory items fall under the scope of their item type; equipment, services and other purchases under the scope chosen on the request (or the default). Kept by Corporate QA.">
        <EditableGrid rows={scopeRows} columns={SCOPE_COLS} allowAdd={canShared} readOnly={!canShared} what="supply scopes"
          newRow={newScope} rowClass={mutedInactive} sign={scopeSign} save={saveScopeRows} afterSave={reload} />
      </Section>
    </>}
  </>;
}
