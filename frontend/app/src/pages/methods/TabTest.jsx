// Designer tab 1: Test and reporting. One Save, signed "Changed by" with a reason; only the changed fields are sent.
import { useState } from 'react';
import { saveHeader } from '../../api/methods.js';
import Section from '../../components/Section.jsx';
import { useToast } from '../../components/Toasts.jsx';
import { money } from '../../lib/format.js';
import { useUnsavedChanges } from '../../router/useHashRoute.js';
import { Card, Field, Pick, ROUNDING, useSigned } from './shared.jsx';
import { Button } from 'react-bootstrap';

function initial(d) {
  const v = d.version; const t = d.test;
  return { test: { test_name: t.test_name || '', department_id: t.department_id || null },
    version: { method_id: v.method_id || null, change_summary: v.change_summary || null, procedure_text: v.procedure_text || null,
      rounding_mode: v.rounding_mode, rounding_digits: Number(v.rounding_digits), nd_below_lod: !!v.nd_below_lod,
      report_per_serving: !!v.report_per_serving, report_template_id: v.report_template_id || null } };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export default function TabTest({ d, reload }) {
  const v = d.version; const t = d.test; const L = d.lists; const ed = d.editable; const e = d.entry;
  const toast = useToast(); const signed = useSigned();
  const [orig, setOrig] = useState(() => initial(d));
  const [f, setF] = useState(orig);
  const [saving, setSaving] = useState(false);
  const setT = (k, val) => setF((s) => ({ ...s, test: { ...s.test, [k]: val } }));
  const setV = (k, val) => setF((s) => ({ ...s, version: { ...s.version, [k]: val } }));
  // the form as it would be saved (trimmed text, blanks as null)
  const now = { test: { ...f.test, test_name: f.test.test_name.trim() },
    version: { ...f.version, change_summary: (f.version.change_summary || '').trim() || null, procedure_text: (f.version.procedure_text || '').trim() || null } };
  useUnsavedChanges(ed && !same(now, orig));

  const dig = Number(f.version.rounding_digits);
  const r = (x) => (f.version.rounding_mode === 'Decimal places' ? Number(x).toFixed(dig) : Number(Number(x).toPrecision(Math.max(1, dig))).toString());
  let example = '';
  try { example = `Example: 12.3456 is reported as ${r(12.3456)}; 0.0012345 as ${r(0.0012345)}.`; } catch { example = ''; }

  async function save() {
    const body = { test: {}, version: {} };
    for (const k of Object.keys(now.test)) if (!same(now.test[k], orig.test[k])) body.test[k] = now.test[k];
    for (const k of Object.keys(now.version)) if (!same(now.version[k], orig.version[k])) body.version[k] = now.version[k];
    if (!Object.keys(body.test).length && !Object.keys(body.version).length) { toast('Nothing changed.'); return; }
    setSaving(true);
    try {
      const ok = await signed(`Test and reporting: ${t.test_code} ${t.test_name}, version ${v.version_no}`, 'Changed by',
        (reason, signature) => saveHeader(v.id, { ...body, reason, signature }));
      if (ok) { setOrig(now); toast('Saved and signed.'); reload(); }
    } finally { setSaving(false); }
  }

  const dis = !ed;
  return <>
    <Section className="wdform" title="Test" help="The report-facing name and the department that does the test (its people do the steps unless a step names another department).">
      <div className="grid2">
        <Field label="Test name" req help="As shown on the catalogue, quotes and the Certificate of Analysis">
          <input id="f_name" type="text" value={f.test.test_name} disabled={dis} onChange={(x) => setT('test_name', x.target.value)} /></Field>
        <Field label="Department" req help={<>Departments are kept on Equipment &gt; Equipment types and departments; mark a group as the department on Admin &gt; Groups and permissions.</>}>
          <Pick id="f_dept" value={f.test.department_id} disabled={dis} onChange={(x) => setT('department_id', x || null)}
            options={L.departments.map((x) => ({ value: x.id, label: `${x.department_code} ${x.department_name}${x.has_people ? '' : ' (nobody in a group for it yet)'}` }))} /></Field>
      </div>
    </Section>
    <Section className="wdform" title="Method and procedure (this version)">
      <div className="grid2">
        <Field label="Method (SOP)" req help={<><a href="#/methods/sops">Methods (SOPs)</a>: add or change the lab&apos;s methods.</>}>
          <Pick id="f_method" value={f.version.method_id} disabled={dis} onChange={(x) => setV('method_id', x || null)}
            options={L.methods.filter((m) => m.status === 'Active' || m.id === v.method_id).map((m) => ({ value: m.id, label: `${m.method_name}${m.sop_code ? ' (' + m.sop_code + ')' : ''}` }))} /></Field>
        <Field label="What changed in this version" help='Shown in the version history, e.g. "Hold time added"'>
          <input id="f_change" type="text" value={f.version.change_summary || ''} disabled={dis} onChange={(x) => setV('change_summary', x.target.value)} /></Field>
      </div>
      <Field label="Procedure summary" help="Shown to the analyst; the SOP stays the controlled document.">
        <textarea id="f_proc" rows={3} value={f.version.procedure_text || ''} disabled={dis} onChange={(x) => setV('procedure_text', x.target.value)} /></Field>
    </Section>
    <Section className="wdform" title="Reporting" help="How results are rounded and reported below the limits. Each analyte can override the rounding (tab 2).">
      <div className="grid3">
        <Field label="Rounding" help="Round half up (away from zero)">
          <Pick id="f_rmode" value={f.version.rounding_mode} blank={false} disabled={dis} options={ROUNDING} onChange={(x) => setV('rounding_mode', x)} /></Field>
        <Field label="Digits" help="Default: 3 significant figures">
          <input id="f_rdig" type="number" min="0" max="10" value={Number.isNaN(dig) ? '' : f.version.rounding_digits} disabled={dis} onChange={(x) => setV('rounding_digits', Number(x.target.value))} /></Field>
        <Field label="Below the limits" help='Below the LOQ is always reported as "< LOQ" (e.g. < 0.010).'>
          <label className="cb"><input type="checkbox" id="f_nd" checked={f.version.nd_below_lod} disabled={dis} onChange={(x) => setV('nd_below_lod', x.target.checked)} /> Report &quot;ND&quot; below the LOD</label></Field>
      </div>
      <div className="grid3">
        <Field label="Per serving" help={'The COA adds a "Per serving" column: the result times the sample\'s serving size (entered on the order), e.g. 0.4 mg/kg in a 2.5 g serving = 0.001 mg.'}>
          <label className="cb"><input type="checkbox" id="f_serv" checked={f.version.report_per_serving} disabled={dis} onChange={(x) => setV('report_per_serving', x.target.checked)} /> Also report the amount per serving</label></Field>
        <Field label="Report template" help={<>The COA layout this test&apos;s results print in. Blank: the lab&apos;s default. Tests with different templates on one sample print in separate parts of the same COA. <a href="#/admin/report-templates">Report templates</a></>}>
          <Pick id="f_tpl" value={f.version.report_template_id} disabled={dis} onChange={(x) => setV('report_template_id', x || null)}
            options={(L.report_templates || []).filter((x) => x.status === 'Active' || x.id === v.report_template_id)
              .map((x) => ({ value: x.id, label: `${x.template_name} (${x.template_code})${x.id === L.default_report_template ? ', the lab\'s default' : ''}` }))} /></Field>
      </div>
      <div className="help" id="f_example">{example}</div>
    </Section>
    <Section title="Pricing and turnaround" help="Kept in the Test catalogue, outside the validated version: a price change never needs a new version.">
      {e ? <div className="wdcards"><Card label="List price">{money(e.list_price || 0)}</Card><Card label="Pricing">{e.pricing_mode}</Card>
        <Card label="Turnaround">{e.standard_tat} {String(e.tat_unit).replace(' Days', ' days').toLowerCase()}</Card><Card label="Rush schedule">{e.rush_schedule || 'None'}</Card></div>
        : <div className="alert alert-warning">Not in the catalogue yet.</div>}
      <Button variant="outline-secondary" href={`#/catalog/${t.id}`}>Open pricing and turnaround</Button>
    </Section>
    {ed && <div className="wdbar"><span className="sp" /><Button type="button" variant="primary" id="save" disabled={saving} onClick={save}>Save</Button></div>}
  </>;
}
