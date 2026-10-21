// Lab setup (migration 030): each lab's images (placeholders until uploaded), the product name, and the report
// templates (Admin > Lab setup > Report templates). The designer picks a template per test (methods.js, tab 1).
import { api, esc, pageHeader, toast, modal, askReason, hooks } from '../app.js';
import { editableGrid, section } from './common.js';

const css = document.createElement('style');
css.textContent = `
.mslots { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; }
.mslot { border: 2px dashed var(--line); border-radius: 12px; padding: 12px; display: flex; flex-direction: column; gap: 8px; min-height: 170px; }
.mslot.has { border-style: solid; border-color: var(--line); background: #fff; }
.mslot h4 { margin: 0; font-size: 13.5px; } .mslot .what { color: var(--muted); font-size: 12px; }
.mslot .pic { flex: 1; display: grid; place-items: center; background: repeating-linear-gradient(45deg, #f6f8f9, #f6f8f9 8px, #eef2f4 8px, #eef2f4 16px); border-radius: 8px; min-height: 80px; color: var(--muted); font-size: 12px; }
.mslot.has .pic { background: #fff; } .mslot .pic img { max-width: 100%; max-height: 90px; object-fit: contain; }
.mslot .acts { display: flex; gap: 6px; flex-wrap: wrap; }
`;
document.head.appendChild(css);

const KINDS = [
  ['Logo', 'Printed at the top of the lab\'s COAs.'],
  ['Small logo', 'Shown in the header beside the lab code while you work in this lab.'],
  ['Accreditation mark', 'Printed beside the accreditation statement on the COA, once the statement is filled in.'],
];

// read a chosen file as base64
function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(new Error('The file could not be read')); r.readAsDataURL(file); });
}

export async function mediaCard(host, site, reload) {
  const d = await api(`/sites/${site.id}/media`);
  const cur = (k) => d.rows.find((m) => m.kind === k && m.status === 'Active');
  const others = d.rows.filter((m) => m.kind === 'Other' && m.status === 'Active');
  host.innerHTML = `${section(`Images: ${site.site_code}`, `The lab's logo and marks. Until a file is uploaded the slot stays a placeholder and nothing is printed. PNG, JPEG or SVG, up to 2 MB. ${d.can_edit ? '' : 'The lab\'s administrators upload them (admin.lab).'}`,
    d.can_edit ? '<button class="btn" id="m_other">+ Other image</button>' : '')}
    <div class="mslots">${KINDS.map(([k, what]) => { const m = cur(k); return `<div class="mslot ${m ? 'has' : ''}" data-kind="${esc(k)}"><h4>${esc(k)}</h4><div class="what">${esc(what)}</div>
      <div class="pic">${m ? `<img src="/api/sites/media/${m.id}/file" alt="${esc(k)} of ${esc(site.site_code)}">` : 'No file yet'}</div>
      ${m ? `<div class="what">${esc(m.file_name)} · ${esc(m.uploaded_by)}</div>` : ''}
      ${d.can_edit ? `<div class="acts"><button class="mini" data-up="${esc(k)}">${m ? 'Replace…' : 'Upload…'}</button>${m ? `<button class="mini" data-retire="${m.id}">Remove</button>` : ''}</div>` : ''}</div>`; }).join('')}
      ${others.map((m) => `<div class="mslot has"><h4>${esc(m.title || 'Other image')}</h4><div class="pic"><img src="/api/sites/media/${m.id}/file" alt="${esc(m.title || '')}"></div>
        ${d.can_edit ? `<div class="acts"><button class="mini" data-retire="${m.id}">Remove</button></div>` : ''}</div>`).join('')}</div>`;
  const upload = async (kind) => {
    const v = await modal({ title: `${kind}: ${site.site_code}`, okText: 'Upload', intro: 'Choose the image. It is stored unchanged with its fingerprint; a replaced image is kept in the history.',
      html: '<div class="field"><label for="f_file">Image</label><input type="file" id="f_file" accept="image/png,image/jpeg,image/svg+xml"></div>',
      fields: kind === 'Other' ? [{ name: 'title', label: 'What it is', required: true }] : [], collect: (m) => ({ file: m.querySelector('#f_file').files[0] }) });
    if (!v) return;
    if (!v.file) { toast('Choose an image file.', 'err'); return; }
    const reason = await askReason(`the ${kind.toLowerCase()} of ${site.site_code}`); if (reason === null) return;
    try {
      await api(`/sites/${site.id}/media`, { method: 'POST', body: { kind, title: v.title || null, file_name: v.file.name, mime_type: v.file.type, b64: await readFile(v.file), reason } });
      toast(`${kind} uploaded.`); hooks.refreshLabLogo?.(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  host.querySelectorAll('[data-up]').forEach((b) => { b.onclick = () => upload(b.dataset.up); });
  const ob = host.querySelector('#m_other'); if (ob) ob.onclick = () => upload('Other');
  host.querySelectorAll('[data-retire]').forEach((b) => { b.onclick = async () => {
    const reason = await askReason('removing this image'); if (reason === null) return;
    try { await api(`/sites/media/${b.dataset.retire}/retire`, { method: 'POST', body: { reason } }); toast('Image removed.'); hooks.refreshLabLogo?.(); reload(); } catch (e) { toast(e.message, 'err'); }
  }; });
}

export async function productNameCard(host, sysAdmin) {
  const s = await api('/public/settings');
  host.innerHTML = `${section('Product name', 'The system\'s name in the header, the browser tab and the sign-in page. One setting, so a rename is one change. System administrators change it.',
    sysAdmin ? '<button class="btn" id="pn_edit">Change…</button>' : '')}<div class="pname">${esc(s.product_name || 'LIMS3')}</div>`;
  const b = host.querySelector('#pn_edit');
  if (b) b.onclick = async () => {
    const v = await modal({ title: 'Product name', fields: [{ name: 'product_name', label: 'Name', value: s.product_name || 'LIMS3', required: true, help: 'Check the name is free to use (trademark) before changing it.' }] });
    if (!v) return;
    const reason = await askReason('the product name'); if (reason === null) return;
    try { await api('/settings', { method: 'POST', body: { product_name: v.product_name, reason } }); toast('Name changed: reload the page to see it everywhere.'); productNameCard(host, sysAdmin); } catch (e) { toast(e.message, 'err'); }
  };
}

// ---------------------------------------------------------------- Admin > Lab setup > Report templates
export async function reportTemplates(main) {
  const d = await api('/report-templates');
  const canAny = d.sysadmin || Object.values(d.can).some(Boolean);
  const mayEdit = (r) => (r.site_id ? d.can[r.site_id] : d.sysadmin);
  const yes = (v) => v === true || v === 'true';
  const rows = d.rows.map((r) => ({ ...r, lab: r.site_id || '', show_method: r.options.show_method !== false, show_test_version: r.options.show_test_version !== false,
    show_tested_dates: r.options.show_tested_dates !== false, show_loq: r.options.show_loq !== false, title: r.options.title || 'CERTIFICATE OF ANALYSIS' }));
  main.innerHTML = pageHeader('Report templates', 'The layouts COAs are printed in. Each test picks its template in the Workflow Designer (tab 1, Reporting); a test without one uses its lab\'s default. When the tests on one sample use different templates, the COA is one PDF in parts, each test in its own template\'s part. Layouts: "Standard COA", and "COA with 1 photo" or "COA with 2 photos" (the sample\'s photos marked Report photo 1 and 2 at receipt, 4:3, under its details). Every COA carries a QR code of its verification link.',
    '', { kind: 'report_templates' })
    + `<div class="card">${section('Templates', `${canAny ? 'QA and lab administrators keep their lab\'s templates (reports.templates); templates for every lab are kept by system administrators.' : 'QA and lab administrators keep these (reports.templates).'} The default is the one tests use when they name none.`)}<div id="tg"></div></div>`;
  const labOpts = [{ value: '', label: 'Every lab' }, ...d.labs.map((l) => ({ value: l.id, label: l.site_code }))];
  editableGrid({ el: main.querySelector('#tg'), rows, allowAdd: canAny, readOnly: !canAny, what: 'the report templates',
    newRow: () => ({ status: 'Active', layout: 'Standard COA', lab: d.labs.find((l) => d.can[l.id])?.id || '', is_default: false, show_method: true, show_test_version: true, show_tested_dates: true, show_loq: true, title: 'CERTIFICATE OF ANALYSIS' }),
    rowClass: (r) => (r.status === 'Inactive' ? 'mutedrow' : ''),
    columns: [
      { field: 'template_code', title: 'Code', type: 'readonly', width: 75 },
      { field: 'template_name', title: 'Template', width: 240, required: true, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'lab', title: 'Lab', type: 'select', options: labOpts, width: 100, editable: (r, isNew) => isNew },
      { field: 'layout', title: 'Layout', type: 'select', options: d.layouts, width: 130, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'is_default', title: 'Default', type: 'bool', width: 70, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'title', title: 'Title on the report', width: 210, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'show_method', title: 'Method', type: 'bool', width: 70, editable: (r, isNew) => isNew || mayEdit(r), help: 'Print each test\'s method and SOP' },
      { field: 'show_test_version', title: 'Version', type: 'bool', width: 70, editable: (r, isNew) => isNew || mayEdit(r), help: 'Print the test version number' },
      { field: 'show_tested_dates', title: 'Dates tested', type: 'bool', width: 95, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'show_loq', title: 'LOQ column', type: 'bool', width: 90, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'description', title: 'Description', width: 260, editable: (r, isNew) => isNew || mayEdit(r) },
      { field: 'used_by', title: 'Test versions', type: 'readonly', width: 95 },
      { field: 'status', title: 'Status', type: 'select', options: ['Active', 'Inactive'], width: 90, editable: (r, isNew) => isNew || mayEdit(r) },
    ],
    save: (changed, reason) => api('/report-templates', { method: 'POST', body: { reason, rows: changed.map((r) => {
      const full = { ...rows.find((x) => x.id === r.id), ...r };
      const out = { id: r.id, template_name: full.template_name, description: full.description, layout: full.layout, is_default: yes(full.is_default), status: full.status,
        options: { show_method: yes(full.show_method), show_test_version: yes(full.show_test_version), show_tested_dates: yes(full.show_tested_dates), show_loq: yes(full.show_loq), title: full.title || 'CERTIFICATE OF ANALYSIS' } };
      if (!r.id) out.site_id = full.lab || null;
      return out; }) } }),
    afterSave: () => reportTemplates(main) });
}

