// The Certificate of Analysis (R-1, migration 026): what a version shows (built from the record), the PDF (made by the
// server in headless Chromium from an HTML page), and the release check run before it is signed.
//  - content(): the version's content from the database: the lab, client, sample, the tests finalized now and before
//    (their approved final results, specification and conformance), the tests still in the lab, the notes, the
//    version line and the verification code. The database checks this content against the record when it is signed.
//  - pdf(): renders the content and reads every value back from the rendered page before printing it (release check 1:
//    what the PDF shows is the record). The PDF's SHA-256 is its fingerprint.
//  - checks(): the release check. Block stops the release; Warning needs a reason; Info is shown.
'use strict';
const crypto = require('crypto');
const V = require('./verification');
const QR = require('./qr');

const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (d, tz) => (d ? new Date(d).toLocaleDateString('en-US', { timeZone: tz || 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtDateTime = (d, tz) => (d ? new Date(d).toLocaleString('en-US', { timeZone: tz || 'America/Los_Angeles', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '');
const numText = (v) => (v === null || v === undefined ? null : String(Number(v)));
function specText(r) {
  if (r.spec_text) return r.spec_text;
  const parts = [];
  if (r.spec_min !== null && r.spec_min !== undefined) parts.push('≥ ' + numText(r.spec_min));
  if (r.spec_max !== null && r.spec_max !== undefined) parts.push('≤ ' + numText(r.spec_max));
  return parts.length ? parts.join(' and ') + (r.spec_unit ? ' ' + r.spec_unit : '') : '';
}
// 12 characters in three groups, no easily confused letters
function newVerifyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(12);
  let s = ''; for (let i = 0; i < 12; i += 1) s += A[b[i] % A.length];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
const DECISION_RULE = 'Conformance is stated against the specification provided by the client, by simple acceptance: the reported result is compared with the limit; measurement uncertainty is not taken into account.';

// ------------------------------------------------------------------ content
async function content(db, { sampleId, testIds, userId, verifyBase, verifyCode }) {
  const s = await db.one(`SELECT s.*, o.order_code, o.po_number, o.notes AS order_notes, o.site_id, o.client_id, o.ordering_contact_id, o.submission_channel::text AS channel,
      COALESCE(c.display_name, c.legal_name) AS client_name, c.client_code, c.site_address, c.billing_address, c.account_status::text AS account_status, c.allow_partial_reports,
      c.is_gmp_client, si.site_name, si.site_code, si.address AS site_address_lab, si.time_zone, ct.first_name || ' ' || ct.last_name AS contact_name, ct.email AS contact_email,
      sample_is_gmp(s.id) AS is_gmp
    FROM sample s JOIN lab_order o ON o.id = s.lab_order_id JOIN client c ON c.id = o.client_id JOIN lab_site si ON si.id = o.site_id
    LEFT JOIN contact ct ON ct.id = o.ordering_contact_id WHERE s.id = $1`, [sampleId]);
  if (!s) throw new Error('Sample not found');
  const coa = await db.one('SELECT * FROM coa WHERE sample_id = $1', [sampleId]);
  const prev = coa ? await db.one('SELECT version_no, issued_at, sha256, verify_code FROM coa_version WHERE coa_id = $1 ORDER BY version_no DESC LIMIT 1', [coa.id]) : null;
  // the signer's handwritten signature and title (migration 028): printed on the COA under the signature line
  const me = await db.one(`SELECT u.full_name, u.title, u.is_automated, f.mime_type AS sig_type, encode(f.content, 'base64') AS sig_b64
    FROM app_user u LEFT JOIN document_file f ON f.id = u.signature_document_id WHERE u.id = $1`, [userId]);
  const now = (await db.one('SELECT clock_timestamp() AS t')).t;
  const tests = await db.rows(`SELECT rt.id, rt.test_id, t.test_code, t.test_name, tv.version_no, tv.report_per_serving, t.serving_role, serving_problem(rt.id) AS serving_problem, test_report_template(rt.id) AS template_id, m.method_name, m.sop_code, rt.status::text AS status,
        test_is_finalized(rt.id) AS finalized, test_awaits_finalization(rt.id) AS awaits
      FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN test_version tv ON tv.id = rt.test_version_id LEFT JOIN method m ON m.id = tv.method_id
     WHERE rt.sample_id = $1 AND rt.status <> 'Cancelled' AND NOT test_is_replaced(rt.id) ORDER BY t.test_name`, [sampleId]);
  const chosen = new Set(testIds);
  for (const t of tests) {
    if (chosen.has(t.id) && !t.awaits) throw new Error(`${t.test_name} on ${s.sample_code} does not wait for finalization`);
  }
  const notes = await db.rows(`SELECT n.id, n.kind, n.note_text, n.requested_test_id, n.analyte_id FROM coa_note n WHERE n.sample_id = $1 AND n.status = 'Active' ORDER BY n.created_at`, [sampleId]);
  const resultIds = [];
  const out = { coa_code: coa ? coa.coa_code : 'COA-' + s.sample_code, version_no: prev ? prev.version_no + 1 : 1, verify_code: verifyCode || newVerifyCode() };
  // the report ID the client sees: the sample ID followed by R and the version (Alex, 2026-10-14)
  out.report_id = `${s.sample_code}-R${out.version_no}`;
  out.verify_url = `${verifyBase || ''}/verify.html?c=${out.verify_code}`;
  out.supersedes = prev ? { version_no: prev.version_no, issued_at: prev.issued_at, sha256: prev.sha256 } : null;
  // the lab's accreditation statement and images (migration 030); the images go to the PDF but not into the stored
  // content (a property that is not enumerable is left out when the content is saved)
  const lab = await db.one(`SELECT accreditation_body, accreditation_certificate, accreditation_statement FROM lab_site WHERE id = $1`, [s.site_id]);
  const media = await db.rows(`SELECT m.kind, m.document_id, f.mime_type, encode(f.content, 'base64') AS b64 FROM site_media m JOIN document_file f ON f.id = m.document_id
    WHERE m.site_id = $1 AND m.status = 'Active' AND m.kind IN ('Logo','Accreditation mark')`, [s.site_id]);
  const img = (k) => media.find((m) => m.kind === k);
  out.lab = { name: s.site_name, code: s.site_code, address: s.site_address_lab || '', accreditation: lab && lab.accreditation_statement ? lab.accreditation_statement : '',
    logo_id: img('Logo') ? img('Logo').document_id : null, mark_id: img('Accreditation mark') ? img('Accreditation mark').document_id : null };
  Object.defineProperty(out, 'media', { enumerable: false, value: {
    logo: img('Logo') ? `data:${img('Logo').mime_type};base64,${img('Logo').b64}` : null,
    mark: img('Accreditation mark') ? `data:${img('Accreditation mark').mime_type};base64,${img('Accreditation mark').b64}` : null } });
  out.client = { name: s.client_name, code: s.client_code, address: s.site_address || s.billing_address || '', contact: s.contact_name || '' };
  // the client's license the order names (0.32.0, migration 055), e.g. "Cannabis distributor C11-0000123 (California DCC)"
  const lic = await db.one(`SELECT l.license_type, l.license_number, l.issuing_authority, l.expires_on FROM lab_order o JOIN client_license l ON l.id = o.client_license_id WHERE o.order_code = $1`, [s.order_code]);
  out.order = { order_code: s.order_code, po_number: s.po_number || '', license: lic ? `${lic.license_type} ${lic.license_number}${lic.issuing_authority ? ` (${lic.issuing_authority})` : ''}` : '' };
  out.sample = { id: s.id, sample_code: s.sample_code, client_sample_id: s.client_sample_id || '', description: s.description || '', matrix: s.matrix || '', product: s.product || '',
    lot: s.lot || '', batch: s.batch || '', compliance_category: s.compliance_category || '', condition: s.condition || '', metrc_id: s.metrc_id || '',
    received: s.received_at || s.logged_at, logged: s.logged_at, temperature: s.receipt_temperature,
    // e.g. "2 capsules (1.2 g)"; the weight is what per-serving amounts use (migration 031)
    serving: s.serving_size !== null && s.serving_size !== undefined
      ? ((s.serving_count ? `${numText(s.serving_count)} ${s.serving_count_unit || ''} (${numText(s.serving_size)} ${s.serving_unit || ''}${s.unit_weight_result_id ? ', measured' : ''})` : `${numText(s.serving_size)} ${s.serving_unit || ''}${s.unit_weight_result_id ? ' (measured)' : ''}`).trim()
        + (s.density_result_id ? `; density ${numText(s.density)} ${s.density_unit || ''} (measured)` : '')) : '',
    servings_per_package: s.servings_per_package !== null && s.servings_per_package !== undefined ? numText(s.servings_per_package) : '' };
  out.tests = []; out.pending = [];
  for (const t of tests) {
    if (!(chosen.has(t.id) || t.finalized)) { out.pending.push({ requested_test_id: t.id, test_name: t.test_name, test_code: t.test_code, template_id: t.template_id }); continue; }
    const rows = await db.rows(`SELECT tr.id, tr.analyte_id, COALESCE(a.report_name, a.analyte_name) AS analyte, tr.result_key, tr.reported, tr.value_num::text AS value_num, tr.value_text,
        tr.unit, tr.spec_min::text AS spec_min, tr.spec_max::text AS spec_max, tr.spec_text, tr.spec_unit, tr.conformance, tr.approved_at,
        tva.loq::text AS loq, tva.lod::text AS lod, tva.hide_loq, tva.hide_lod, tva.hide_on_report, tva.sort_order, tva.rounding_mode, tva.rounding_digits,
        tva.uncertainty::text AS uncertainty, tva.uncertainty_kind, tva.report_uncertainty,
        (SELECT ws.step_name FROM workflow_step ws WHERE ws.test_version_id = b.test_version_id AND ws.step_key = tr.result_key AND ws.status = 'Active' LIMIT 1) AS result_name,
        (SELECT sp.source::text FROM specification sp WHERE sp.requested_test_id = tr.requested_test_id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active' LIMIT 1) AS spec_source,
        (SELECT sp.basis FROM specification sp WHERE sp.requested_test_id = tr.requested_test_id AND sp.analyte_id = tr.analyte_id AND sp.status = 'Active' LIMIT 1) AS spec_basis
      FROM test_result tr JOIN analyte a ON a.id = tr.analyte_id JOIN test_batch b ON b.id = tr.batch_id
      LEFT JOIN test_version_analyte tva ON tva.test_version_id = b.test_version_id AND tva.analyte_id = tr.analyte_id AND tva.status = 'Active'
     WHERE tr.requested_test_id = $1 AND tr.status = 'Active' AND tr.stage = 'Final'
     ORDER BY tva.sort_order NULLS LAST, (tr.result_key IS NULL), tr.result_key`, [t.id]);
    const dates = await db.one(`SELECT min(r.completed_at) AS first, max(r.completed_at) AS last FROM batch_entry e JOIN step_run r ON r.batch_id = e.batch_id
      JOIN test_batch b ON b.id = e.batch_id WHERE e.requested_test_id = $1 AND b.status <> 'Cancelled' AND r.completed_at IS NOT NULL`, [t.id]);
    const staged = rows.some((r) => r.result_key);
    // per serving when the test reports so or the sample asks for it (033); a serving test's own result is not per serving
    const perServing = (t.report_per_serving || s.report_per_serving) && !t.serving_role && s.serving_size !== null && s.serving_size !== undefined;
    const results = [];
    for (const r of rows.filter((x) => !x.hide_on_report)) {
      resultIds.push(r.id);
      const reported = r.reported ?? r.value_text ?? '';
      const plain = /^-?\d*\.?\d+$/.test(String(reported).trim());
      // measurement uncertainty (migration 028): ± in the result's unit, or a % of it, to the reported decimals
      let unc = '';
      if (r.report_uncertainty && r.uncertainty !== null && plain) {
        const u = r.uncertainty_kind === '%' ? Math.abs(Number(r.value_num ?? reported)) * Number(r.uncertainty) / 100 : Number(r.uncertainty);
        const dec = (String(reported).split('.')[1] || '').length;
        unc = '± ' + (dec ? u.toFixed(dec) : String(Number(u.toPrecision(2))));
      }
      // the amount per serving (migration 028): the result times the sample's serving size, worked out from the unit
      // also for a limit per serving or per package (migration 031): the amount it is compared with. Worked out from the
      // reported value (as the conformance is), 3 significant figures; per package = per serving x servings per package
      let serving = ''; let pkg = ''; let basisText = null;
      const basis = r.spec_basis && r.spec_basis !== 'As reported' ? r.spec_basis : null;
      if ((perServing || basis) && !r.result_key && s.serving_size !== null && s.serving_size !== undefined) {
        const lt = /^<\s*/.test(String(reported)); const base = lt ? String(reported).replace(/^<\s*/, '') : plain ? (basis ? reported : (r.value_num ?? reported)) : null;
        if (base !== null && /^-?\d*\.?\d+$/.test(String(base).trim())) {
          // through the measured density when the serving is a volume and the result per weight (033)
          const p = await db.one('SELECT value::text AS value, unit FROM sample_per_serving($1::numeric, $2, $3)', [String(base), r.unit, s.id]);
          if (p && p.value !== null) {
            const u = p.unit.replace(/ per serving$/, ''); const v = Number(Number(p.value).toPrecision(3));
            serving = `${lt ? '< ' : ''}${v} ${u}`;
            const pv = s.servings_per_package ? Number((Number(p.value) * Number(s.servings_per_package)).toPrecision(3)) : null;
            if (pv !== null) pkg = `${lt ? '< ' : ''}${pv} ${u}`;
            const bv = basis === 'Per package' ? pv : basis ? v : null;   // what the limit is compared with
            if (bv !== null) basisText = { text: `${lt ? '< ' : ''}${bv}`, unit: u };
          }
        }
      }
      results.push({ id: r.id, analyte_id: r.analyte_id, analyte: r.analyte, label: r.result_name || '', final_label: !r.result_key && staged ? 'Final result' : '', reported, value_num: r.value_num, value_text: r.value_text,
        unit: r.unit || '', spec: specText(r), spec_min: r.spec_min, spec_max: r.spec_max, spec_text: r.spec_text, spec_unit: r.spec_unit, spec_source: r.spec_source || '',
        conformance: r.conformance, loq: r.hide_loq || r.result_key ? null : r.loq, approved_at: r.approved_at, rounding_mode: r.rounding_mode, rounding_digits: r.rounding_digits, lod: r.lod,
        uncertainty: unc, per_serving: serving, per_package: basis === 'Per package' ? pkg : '', spec_basis: basis || '',
        basis_value: basisText ? basisText.text : null, basis_unit: basisText ? basisText.unit : null, note_ids: notes.filter((n) => n.kind === 'COA' && n.requested_test_id === t.id && n.analyte_id === r.analyte_id).map((n) => n.id) });
    }
    // results hidden on the report are still covered by the finalization
    for (const r of rows) if (r.hide_on_report) resultIds.push(r.id);
    out.tests.push({ requested_test_id: t.id, template_id: t.template_id, test_name: t.test_name, test_code: t.test_code, version_no: t.version_no, method: t.method_name ? `${t.method_name}${t.sop_code ? ' (' + t.sop_code + ')' : ''}` : '',
      finalized_now: chosen.has(t.id), tested_from: dates && dates.first, tested_to: dates && dates.last, results, per_serving: perServing || results.some((x) => x.per_serving && x.spec_basis),
      per_package: results.some((x) => x.per_package),
      note_ids: notes.filter((n) => n.kind === 'COA' && n.requested_test_id === t.id && !n.analyte_id).map((n) => n.id) });
    // what still holds its per-serving results (for the release check only: not part of the stored content)
    Object.defineProperty(out.tests[out.tests.length - 1], 'serving_problem', { enumerable: false, value: t.serving_problem || null });
  }
  // one part per report template, each test in its own template's part (Alex, 2026-10-14)
  const tids = [...new Set([...out.tests.map((t) => t.template_id), ...out.pending.map((p) => p.template_id)].filter(Boolean))];
  const tpls = tids.length ? await db.rows(`SELECT id, template_code, template_name, layout, options FROM report_template WHERE id = ANY($1::uuid[])`, [tids]) : [];
  const dflt = await db.one('SELECT default_report_template($1) AS id', [s.site_id]);
  const order = [...tids].sort((a, b) => (a === dflt.id ? -1 : b === dflt.id ? 1 : 0));
  out.sections = order.map((id) => { const x = tpls.find((y) => y.id === id) || {};
    return { template: { id, code: x.template_code, name: x.template_name, layout: x.layout, options: x.options || {} },
      tests: out.tests.filter((t) => t.template_id === id).map((t) => t.requested_test_id), pending: out.pending.filter((p) => p.template_id === id).map((p) => p.requested_test_id) }; });
  // the sample's report photos (0.29.0, migration 051): only when a part's layout prints them. Which photos is part of the
  // stored content; the images go to the PDF but not into the content (not enumerable)
  const needPhotos = Math.max(0, ...out.sections.map((x) => (x.template.layout === 'COA with 2 photos' ? 2 : x.template.layout === 'COA with 1 photo' ? 1 : 0)));
  out.photos = []; const photoData = {};
  if (needPhotos) {
    const ph = await db.rows(`SELECT p.id, p.report_slot, p.document_id, p.caption, p.taken_at, p.width_px, p.height_px, f.sha256, f.mime_type, encode(f.content, 'base64') AS b64
      FROM sample_photo p JOIN document_file f ON f.id = p.document_id WHERE p.sample_id = $1 AND p.status = 'Active' AND p.report_slot IS NOT NULL AND p.report_slot <= $2 ORDER BY p.report_slot`, [s.id, needPhotos]);
    for (const p of ph) { out.photos.push({ slot: p.report_slot, photo_id: p.id, document_id: p.document_id, sha256: p.sha256, caption: p.caption || '', taken_at: p.taken_at }); photoData[p.report_slot] = `data:${p.mime_type};base64,${p.b64}`; }
  }
  Object.defineProperty(out, 'photo_data', { enumerable: false, value: photoData });
  out.result_ids = resultIds.sort();
  out.pending_count = out.pending.length;
  out.is_final = out.pending_count === 0;
  // every COA note is in the Notes section, numbered; a note on a test or a result is marked there with its number
  // (Alex, 2026-10-14). Notes on results hidden from the report, or on tests not on this version, still print, named.
  const shown = new Map();
  for (const t of out.tests) {
    for (const id of t.note_ids) shown.set(id, { on: t.test_name });
    for (const r of t.results) for (const id of r.note_ids) shown.set(id, { on: `${r.analyte}${r.label ? ' (' + r.label + ')' : ''}, ${t.test_name}` });
  }
  const testName = (rt) => (tests.find((x) => x.id === rt) || {}).test_name || '';
  out.notes = notes.filter((n) => n.kind === 'COA').map((n, i) => ({ n: i + 1, id: n.id, text: n.note_text,
    on: shown.has(n.id) ? shown.get(n.id).on : n.requested_test_id ? testName(n.requested_test_id) : '' }));
  const num = new Map(out.notes.map((x) => [x.id, x.n]));
  for (const t of out.tests) { t.notes = t.note_ids.map((id) => num.get(id)); for (const r of t.results) { r.notes = r.note_ids.map((id) => num.get(id)); delete r.note_ids; } delete t.note_ids; }
  out.internal_notes = notes.filter((n) => n.kind === 'Internal').map((n) => n.note_text);
  out.decision_rule = out.tests.some((t) => t.results.some((r) => r.spec)) ? DECISION_RULE : '';
  out.authorized = { by: me.full_name, title: me.title || '', at: now,
    signature: me.sig_b64 ? `data:${me.sig_type};base64,${me.sig_b64}` : null, has_signature: !!me.sig_b64 && !!me.title };
  out.time_zone = s.time_zone;
  out.client_on_hold = s.account_status === 'On Hold';
  out.allow_partial = s.allow_partial_reports;
  out.is_gmp = s.is_gmp;
  return out;
}

// ------------------------------------------------------------------ the page that becomes the PDF
function html(c, { preview = false } = {}) {
  const tz = c.time_zone;
  // the parts (one per report template); content made before migration 030 has none: one part with everything
  const parts = (c.sections && c.sections.length ? c.sections : [{ template: { options: {} }, tests: c.tests.map((t) => t.requested_test_id), pending: c.pending.map((p) => p.requested_test_id) }])
    .map((sec) => ({ opt: { show_method: true, show_test_version: true, show_tested_dates: true, show_loq: true, ...(sec.template.options || {}) }, template: sec.template,
      tests: c.tests.filter((t) => sec.tests.includes(t.requested_test_id)), pending: c.pending.filter((x) => (sec.pending || []).includes(x.requested_test_id)) }));
  const kv = (pairs) => pairs.filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v, key]) => `<tr><th>${esc(k)}</th><td${key ? ` data-check="${key}"` : ''}>${esc(v)}</td></tr>`).join('');
  // a note's number, marked where it applies; the note itself is in the Notes section (Alex, 2026-10-14)
  const marks = (ns) => ((ns || []).length ? ` <sup class="mk">${ns.map((n) => `[${n}]`).join('')}</sup>` : '');
  const reportId = c.report_id || c.coa_code;
  const testBlock = (t, part) => { const o = part.opt; const hasLoq = o.show_loq && part.tests.some((x) => x.results.some((r) => r.loq)); const hasSpec = part.tests.some((x) => x.results.some((r) => r.spec));
    const hasUnc = t.results.some((r) => r.uncertainty); const hasServ = t.per_serving; const hasPkg = t.per_package; return `<section class="test">
      <h3>${esc(t.test_name)}${marks(t.notes)}</h3>
      <div class="meta">${esc([o.show_method && t.method ? 'Method: ' + t.method : '', o.show_test_version ? `Test version ${t.version_no}` : '', o.show_tested_dates && t.tested_from ? `Tested ${fmtDate(t.tested_from, tz)}${t.tested_to && fmtDate(t.tested_to, tz) !== fmtDate(t.tested_from, tz) ? ' to ' + fmtDate(t.tested_to, tz) : ''}` : ''].filter(Boolean).join(' · '))}</div>
      <table class="res"><thead><tr><th>Analyte</th><th class="r">Result</th>${hasUnc ? '<th>Uncertainty</th>' : ''}<th>Unit</th>${hasServ ? `<th class="r">Per serving (${esc(c.sample.serving)})</th>` : ''}${hasPkg ? '<th class="r">Per package</th>' : ''}${hasLoq ? '<th class="r">LOQ</th>' : ''}${hasSpec ? '<th>Specification</th><th>Conformance</th>' : ''}</tr></thead><tbody>
      ${t.results.map((r) => `<tr><td>${esc(r.analyte)}${marks(r.notes)}${r.label || r.final_label ? `<div class="sub">${esc(r.label || r.final_label)}</div>` : ''}</td>
        <td class="r b" data-check="r:${r.id}:reported">${esc(r.reported)}</td>${hasUnc ? `<td>${esc(r.uncertainty || '')}</td>` : ''}<td data-check="r:${r.id}:unit">${esc(r.unit)}</td>
        ${hasServ ? `<td class="r">${esc(r.per_serving || '')}</td>` : ''}${hasPkg ? `<td class="r">${esc(r.per_package || '')}</td>` : ''}
        ${hasLoq ? `<td class="r">${esc(r.loq ?? '')}</td>` : ''}
        ${hasSpec ? `<td><span data-check="r:${r.id}:spec">${esc(r.spec)}</span>${r.spec && /^Client/.test(r.spec_source) ? '<div class="sub">Client provided specification</div>' : ''}</td><td data-check="r:${r.id}:conf">${esc(r.spec ? r.conformance : '')}</td>` : ''}</tr>`).join('')}
      </tbody></table>
    </section>`; };
  // photo layouts (0.29.0): one photo, or two side by side, 4:3, under the client and sample details
  const photoBlock = (part) => { const n = part.template.layout === 'COA with 2 photos' ? 2 : part.template.layout === 'COA with 1 photo' ? 1 : 0; if (!n) return '';
    const slots = [1, 2].slice(0, n).map((k) => { const p = (c.photos || []).find((x) => x.slot === k); const src = c.photo_data && c.photo_data[k];
      return `<figure class="ph ph${n}">${src ? `<img src="${src}" alt="Sample photo ${k}">` : `<div class="noph">Photo ${k} not on file</div>`}<figcaption>${esc(p && p.caption ? p.caption : `Sample as received${n > 1 ? ` (${k} of ${n})` : ''}`)}</figcaption></figure>`; });
    return `<div class="photos photos${n}">${slots.join('')}</div>`; };
  // the QR code of the verification link, beside it (0.29.0)
  let qr = ''; try { qr = QR.svg(c.verify_url, { px: 2, label: 'QR code: verify this certificate' }); } catch (_) { qr = ''; }
  // older versions stored their notes as plain text
  const noteRows = (c.notes || []).map((n, i) => (typeof n === 'string' ? { n: i + 1, text: n, on: '' } : n));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(reportId)} (version ${c.version_no})</title><style>
    @page { size: Letter; margin: 0.6in 0.6in 0.75in; }
    body { font: 10pt/1.35 "Helvetica Neue", Arial, sans-serif; color: #1d2329; margin: 0; }
    .top { display: flex; justify-content: space-between; border-bottom: 2.5px solid #1f3a2c; padding-bottom: 10px; }
    .lab { font-size: 15pt; font-weight: 700; color: #1f3a2c; } .labaddr { color: #5c6773; font-size: 9pt; white-space: pre-line; }
    .title { text-align: right; } .title .t { font-size: 14pt; font-weight: 700; letter-spacing: .3px; } .title .v { font-size: 9pt; color: #5c6773; margin-top: 3px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 12px 0 6px; }
    .grid h4 { margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .5px; color: #5c6773; }
    table.kv { border-collapse: collapse; width: 100%; } table.kv th { text-align: left; font-weight: 600; color: #5c6773; width: 38%; padding: 1.5px 6px 1.5px 0; vertical-align: top; font-size: 9pt; }
    table.kv td { padding: 1.5px 0; font-size: 9pt; }
    h3 { font-size: 11pt; margin: 14px 0 2px; color: #1f3a2c; } .meta { font-size: 8.5pt; color: #5c6773; margin-bottom: 5px; }
    table.res { width: 100%; border-collapse: collapse; } table.res th { background: #eef2f0; text-align: left; font-size: 8.5pt; padding: 5px 6px; border-bottom: 1px solid #c9d3cf; }
    table.res td { padding: 5px 6px; border-bottom: 1px solid #e3e8e6; vertical-align: top; } .r { text-align: right; } .b { font-weight: 700; }
    .sub { font-size: 8pt; color: #5c6773; } .note { font-size: 8.5pt; font-style: italic; color: #333; margin-top: 3px; }
    .pending { margin-top: 12px; } .pending td { color: #5c6773; }
    .notes, .rule { margin-top: 12px; font-size: 9pt; } .rule { color: #333; }
    .sign { margin-top: 18px; border-top: 1px solid #c9d3cf; padding-top: 8px; display: flex; justify-content: space-between; font-size: 9pt; }
    .verify { font-size: 8.5pt; color: #5c6773; text-align: right; } .code { font: 600 10pt ui-monospace, Menlo, Consolas, monospace; color: #1d2329; letter-spacing: .5px; }
    section.test { break-inside: avoid; }
    sup.mk { font-size: 7pt; color: #1f3a2c; font-weight: 700; }
    .notes table { border-collapse: collapse; width: 100%; margin-top: 3px; } .notes td { padding: 2px 6px 2px 0; vertical-align: top; font-size: 9pt; } .notes td.n { width: 26px; font-weight: 700; } .notes .on { color: #5c6773; }
    .sigblock { break-inside: avoid; } .sigimg { height: 46px; max-width: 220px; object-fit: contain; display: block; margin-bottom: 2px; }
    .labblock { display: flex; gap: 12px; align-items: flex-start; } img.logo { max-height: 54px; max-width: 160px; object-fit: contain; }
    .accr { font-size: 8.5pt; color: #1f3a2c; margin-top: 4px; display: flex; gap: 6px; align-items: center; } img.mark { height: 28px; object-fit: contain; }
    .part.next { break-before: page; }
    .sigline { border-top: 1px solid #1d2329; width: 240px; padding-top: 3px; } .sigline .nm { font-weight: 700; }
    .photos { display: flex; gap: 0.25in; margin: 4px 0 8px; break-inside: avoid; } figure.ph { margin: 0; } figure.ph1 { width: 3.4in; } figure.ph2 { width: 3.05in; }
    figure.ph img, .noph { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; display: block; border: 1px solid #c9d3cf; border-radius: 2px; }
    .noph { display: flex; align-items: center; justify-content: center; color: #9a2b2b; background: #f6f1f1; }
    figure.ph figcaption { font-size: 8pt; color: #5c6773; margin-top: 2px; }
    .verifybox { display: flex; gap: 8px; align-items: flex-start; } .verifybox svg { flex: none; }
  </style></head><body>
  ${parts.map((part, pi) => { const dc = (k) => (pi === 0 ? ` data-check="${k}"` : ''); const kv1 = (pairs) => (pi === 0 ? kv(pairs) : kv(pairs.map(([a, b]) => [a, b])));
    return `<div class="part${pi ? ' next' : ''}">
  <div class="top"><div class="labblock">${c.media && c.media.logo ? `<img class="logo" src="${c.media.logo}" alt="${esc(c.lab.name)}">` : ''}<div><div class="lab">${esc(c.lab.name)}</div><div class="labaddr">${esc(c.lab.address)}</div>
      ${c.lab.accreditation ? `<div class="accr">${c.media && c.media.mark ? `<img class="mark" src="${c.media.mark}" alt="Accreditation mark">` : ''}${esc(c.lab.accreditation)}</div>` : ''}</div></div>
    <div class="title"><div class="t">${esc(part.opt.title || 'CERTIFICATE OF ANALYSIS')}</div><div class="v">Report <span${dc('h:report_id')}>${esc(reportId)}</span> · Version <span${dc('h:version_no')}>${c.version_no}</span>${c.supersedes ? `, supersedes version ${c.supersedes.version_no} issued ${esc(fmtDate(c.supersedes.issued_at, tz))}` : ''}</div>
    <div class="v">Issued ${esc(fmtDate(c.authorized.at, tz))}</div>${parts.length > 1 ? `<div class="v">Part ${pi + 1} of ${parts.length}${part.template.name ? ': ' + esc(part.template.name) : ''}</div>` : ''}</div></div>
  <div class="grid">
    <div><h4>Client</h4><table class="kv">${kv1([['Client', c.client.name], ['Address', c.client.address], ['Contact', c.client.contact], ['Order', c.order.order_code, 'h:order_code'], ['PO', c.order.po_number], ['License', c.order.license || '']])}</table></div>
    <div><h4>Sample</h4><table class="kv">${kv1([['Sample ID', c.sample.sample_code, 'h:sample_code'], ['Client sample ID', c.sample.client_sample_id, 'h:client_sample_id'], ['Description', c.sample.description],
      ['Matrix', c.sample.matrix], ['Product', c.sample.product], ['Lot', c.sample.lot, 'h:lot'], ['Batch', c.sample.batch], ['METRC ID', c.sample.metrc_id || ''], ['Category', c.sample.compliance_category],
      ['Serving size', c.sample.serving || ''], ['Received', fmtDate(c.sample.received, tz)], ['Condition', c.sample.condition]])}</table></div>
  </div>
  ${photoBlock(part)}
  ${part.tests.map((t) => testBlock(t, part)).join('')}
  ${part.pending.length ? `<section class="pending"><h3>Tests in progress</h3><table class="res"><tbody>${part.pending.map((x) => `<tr><td>${esc(x.test_name)}</td><td class="r">In progress</td></tr>`).join('')}</tbody></table></section>` : ''}
  </div>`; }).join('')}
  ${noteRows.length ? `<div class="notes"><b>Notes</b><table>${noteRows.map((n) => `<tr><td class="n">[${n.n}]</td><td>${n.on ? `<span class="on">${esc(n.on)}:</span> ` : ''}${esc(n.text)}</td></tr>`).join('')}</table></div>` : ''}
  <div class="rule">${c.decision_rule ? esc(c.decision_rule) + ' ' : ''}The results relate only to the sample tested, as received. This certificate may not be reproduced except in full without the laboratory's written approval.</div>
  <div class="sign sigblock"><div>Authorized by
      ${c.authorized.signature ? `<img class="sigimg" src="${c.authorized.signature}" alt="Signature of ${esc(c.authorized.by)}">` : '<div style="height:46px"></div>'}
      <div class="sigline"><span class="nm" data-check="h:authorized_by">${esc(c.authorized.by)}</span>${c.authorized.title ? `<br>${esc(c.authorized.title)}` : ''}<br>Signed ${esc(fmtDateTime(c.authorized.at, tz))} (electronic signature)</div></div>
    <div class="verifybox"><div class="verify">Verify this certificate at ${esc(c.verify_url)}<br>Verification code <span class="code" data-check="h:verify_code">${esc(c.verify_code)}</span><br>or scan the QR code</div>${qr}</div></div>
  ${preview ? '' : ''}
  </body></html>`;
}

// The values each data-check cell must show
function expectedCells(c) {
  const m = { 'h:report_id': c.report_id || c.coa_code, 'h:version_no': String(c.version_no), 'h:order_code': c.order.order_code, 'h:sample_code': c.sample.sample_code,
    'h:client_sample_id': c.sample.client_sample_id, 'h:lot': c.sample.lot, 'h:authorized_by': c.authorized.by, 'h:verify_code': c.verify_code };
  for (const k of Object.keys(m)) if (m[k] === '' || m[k] === null || m[k] === undefined) delete m[k];
  // the specification columns appear in a part when any of its tests has a specification
  const secs = c.sections && c.sections.length ? c.sections : [{ tests: c.tests.map((t) => t.requested_test_id) }];
  const partOf = (t) => secs.find((x) => x.tests.includes(t.requested_test_id)) || secs[0];
  for (const t of c.tests) {
    const hasSpec = c.tests.filter((x) => partOf(x) === partOf(t)).some((x) => x.results.some((r) => r.spec));
    for (const r of t.results) {
      m[`r:${r.id}:reported`] = r.reported; m[`r:${r.id}:unit`] = r.unit;
      if (hasSpec) { m[`r:${r.id}:spec`] = r.spec; m[`r:${r.id}:conf`] = r.spec ? r.conformance : ''; }
    }
  }
  return m;
}

// ------------------------------------------------------------------ the PDF (one browser, kept a minute between uses)
let browserP = null; let idle = null;
async function browser() {
  if (!browserP) {
    const { loadPlaywright } = require('./evidence');
    browserP = loadPlaywright().chromium.launch({ handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false }).catch((e) => { browserP = null; throw e; });
  }
  clearTimeout(idle);
  idle = setTimeout(async () => { const b = browserP; browserP = null; if (b) (await b).close().catch(() => {}); }, 60000);
  return browserP;
}
async function pdf(c, { preview = false } = {}) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html(c, { preview }), { waitUntil: 'load' });
    const seen = await page.$$eval('[data-check]', (els) => els.map((e) => [e.getAttribute('data-check'), e.textContent.trim()]));
    const exp = expectedCells(c); const got = new Map(seen);
    const mismatches = [];
    for (const [k, v] of Object.entries(exp)) {
      if (!got.has(k)) mismatches.push(`${k}: not on the PDF`);
      else if (got.get(k) !== String(v).trim()) mismatches.push(`${k}: the PDF shows "${got.get(k)}", the record "${v}"`);
    }
    const foot = `<div style="font:7.5pt Helvetica,Arial,sans-serif;color:#5c6773;width:100%;padding:0 0.6in;display:flex;justify-content:space-between">
      <span>Report ${esc(c.report_id || c.coa_code)} · Version ${c.version_no} · Verification code ${esc(c.verify_code)}${preview ? ' · PREVIEW, NOT ISSUED' : ''}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const buf = await page.pdf({ format: 'Letter', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot,
      margin: { top: '0.6in', bottom: '0.75in', left: '0.6in', right: '0.6in' } });
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    return { buf, sha256, readBack: { cells: Object.keys(exp).length, mismatches } };
  } finally { await page.close().catch(() => {}); }
}

// ------------------------------------------------------------------ the release check
const check = (code, title, level, detail = '') => ({ code, title, level, detail });
async function checks(db, c, { userId, readBack }) {
  const out = [];
  const ids = c.tests.filter((t) => t.finalized_now).map((t) => t.requested_test_id);
  const now = c.tests.filter((t) => t.finalized_now);
  // 1. the PDF shows the record
  if (readBack) {
    out.push(readBack.mismatches.length ? check('values', 'Values on the PDF match the record', 'Block', readBack.mismatches.slice(0, 5).join('; '))
      : check('values', 'Values on the PDF match the record', 'Pass', `${readBack.cells} values read back from the rendered COA`));
  }
  // 2. specification integrity: as on the test now, same units, not changed after the result was approved
  const specProblems = []; const specChanged = []; const unitWarn = [];
  for (const t of now) {
    for (const r of t.results) {
      const sp = await db.one(`SELECT min_value::text AS min, max_value::text AS max, text_value, unit, modified_at FROM specification
        WHERE requested_test_id = $1 AND analyte_id = $2 AND status = 'Active' LIMIT 1`, [t.requested_test_id, r.analyte_id]);
      const same = (a, b) => (a === null || a === undefined ? null : Number(a)) === (b === null || b === undefined ? null : Number(b));
      if (!r.label) { // the final result carries the comparison
        if (sp && !(same(sp.min, r.spec_min) && same(sp.max, r.spec_max) && (sp.text_value || null) === (r.spec_text || null))) specProblems.push(`${t.test_name} ${r.analyte}`);
        if (!sp && (r.spec_min !== null || r.spec_max !== null || r.spec_text)) specProblems.push(`${t.test_name} ${r.analyte} (the specification was removed)`);
        if (sp && sp.unit && r.unit && sp.unit !== r.unit) unitWarn.push(`${r.analyte}: specification in ${sp.unit}, result in ${r.unit}`);
      }
      const ch = await db.one(`SELECT max(a.changed_at) AS at FROM audit_log a JOIN specification sp ON sp.id = a.record_id
        WHERE a.table_name = 'specification' AND sp.requested_test_id = $1 AND sp.analyte_id = $2 AND a.changed_at > $3`, [t.requested_test_id, r.analyte_id, r.approved_at]);
      if (ch && ch.at && !r.label) specChanged.push(`${t.test_name} ${r.analyte}`);
    }
  }
  out.push(specProblems.length ? check('spec', 'Specification as on the ordered test', 'Block', `The stored result was compared with a different specification: ${specProblems.join(', ')}`)
    : specChanged.length ? check('spec', 'Specification as on the ordered test', 'Block', `The specification was changed after the result was approved: ${specChanged.join(', ')}. Return the batch to QC Review to compare again.`)
      : check('spec', 'Specification as on the ordered test', 'Pass', 'Each result was compared with the specification on its test, unchanged since'));
  if (unitWarn.length) out.push(check('units', 'Specification and result units', 'Warning', unitWarn.join('; ')));
  // 3. reported value and conformance worked out again, independently of the database
  const confBad = []; const roundBad = [];
  for (const t of now) {
    for (const r of t.results) {
      if (r.value_num !== null && r.value_num !== undefined && r.rounding_mode !== undefined) {
        const ver = await db.one(`SELECT tv.rounding_mode, tv.rounding_digits, tv.nd_below_lod FROM requested_test rt JOIN test_version tv ON tv.id = rt.test_version_id WHERE rt.id = $1`, [t.requested_test_id]);
        try {
          const rep = V.reportValue(V.Q.of(r.value_num), { loq: r.loq ?? null, lod: r.lod ?? null, rounding_mode: r.rounding_mode, rounding_digits: r.rounding_digits }, ver);
          const repText = rep && typeof rep === 'object' ? rep.toString() : rep;
          if (repText !== null && String(repText) !== String(r.reported)) roundBad.push(`${r.analyte}${r.label ? ' (' + r.label + ')' : ''}: reported ${r.reported}, worked out ${repText}`);
        } catch (_) { /* not a number the oracle reads: compared below on conformance only */ }
      }
      if (r.label) continue;
      const spec = r.spec_min === null && r.spec_max === null && !r.spec_text ? null : { min: r.spec_min, max: r.spec_max };
      // a limit per serving or per package (031): compared with the amount printed in that column, in the limit's unit
      const basisUnit = r.spec_basis && r.spec_unit ? r.spec_unit.replace(/ per (serving|package)$/, '') : null;
      const conf = r.spec_basis ? (r.basis_value !== null && basisUnit === r.basis_unit ? V.conformance(spec, { found_values: [] }, r.basis_value, null) : r.basis_value === null ? 'Not compared' : r.conformance)
        : spec && r.spec_unit && r.unit && r.spec_unit !== r.unit ? r.conformance : V.conformance(spec, { found_values: [] }, r.reported, r.value_text);
      if (spec && spec.min === null && spec.max === null) continue; // a text limit: judged in QC Review
      if (conf !== r.conformance && !(conf === 'No specification' && r.conformance === 'No specification')) confBad.push(`${r.analyte}: stored ${r.conformance}, worked out ${conf}`);
    }
  }
  out.push(confBad.length ? check('conformance', 'Conformance worked out again', 'Block', confBad.join('; '))
    : check('conformance', 'Conformance worked out again', 'Pass', 'Every result\'s conformance agrees with a second, independent comparison'));
  if (roundBad.length) out.push(check('rounding', 'Reported value worked out again', 'Block', roundBad.join('; ')));
  // 4. history: far from the same project's (or client's) earlier finalized results for the same test and analyte
  const hist = [];
  for (const t of now) {
    for (const r of t.results) {
      if (r.label || r.value_num === null || r.value_num === undefined || Number(r.value_num) <= 0) continue;
      const prior = await db.rows(`WITH me AS (SELECT rt.test_id, q.project_version_id, pv.project_id, o.client_id FROM requested_test rt
             LEFT JOIN quoted_test_configuration q ON q.id = rt.quoted_line_id LEFT JOIN project_version pv ON pv.id = q.project_version_id
             JOIN sample s ON s.id = rt.sample_id JOIN lab_order o ON o.id = s.lab_order_id WHERE rt.id = $1)
        SELECT tr.value_num::float8 AS v, (pv2.project_id = me.project_id) AS same_project
          FROM me, test_result tr JOIN requested_test rt2 ON rt2.id = tr.requested_test_id JOIN sample s2 ON s2.id = rt2.sample_id JOIN lab_order o2 ON o2.id = s2.lab_order_id
          LEFT JOIN quoted_test_configuration q2 ON q2.id = rt2.quoted_line_id LEFT JOIN project_version pv2 ON pv2.id = q2.project_version_id
         WHERE rt2.test_id = me.test_id AND o2.client_id = me.client_id AND rt2.id <> $1 AND tr.analyte_id = $2 AND tr.status = 'Active' AND tr.stage = 'Final'
           AND tr.result_key IS NULL AND tr.value_num > 0 AND test_is_finalized(rt2.id)
         ORDER BY tr.approved_at DESC LIMIT 50`, [t.requested_test_id, r.analyte_id]);
      const proj = prior.filter((p) => p.same_project); const set = proj.length >= 3 ? proj : prior;
      if (set.length < 3) continue;
      const vals = set.map((p) => p.v).sort((a, b) => a - b); const med = vals[Math.floor(vals.length / 2)];
      const ratio = Number(r.value_num) / med;
      if (ratio >= 5 || ratio <= 0.2) {
        hist.push(`${r.analyte} ${r.reported} ${r.unit} is ${ratio >= 1 ? ratio.toFixed(1) + ' times' : (1 / ratio).toFixed(1) + ' times less than'} the median (${med} ${r.unit}) of ${set.length} earlier results ${set === proj ? 'on this project' : 'for this client'}`);
      }
    }
  }
  out.push(hist.length ? check('history', 'Results against this client\'s history', 'Warning', hist.join('; ') + '. Check units and decimal places.')
    : check('history', 'Results against this client\'s history', 'Pass', 'No result is far (5 times) from the project\'s or client\'s earlier results, where there are at least 3'));
  // 4b. the photos a photo layout prints (0.29.0)
  const needP = Math.max(0, ...(c.sections || []).map((x) => (x.template.layout === 'COA with 2 photos' ? 2 : x.template.layout === 'COA with 1 photo' ? 1 : 0)));
  if (needP) {
    const have = (c.photos || []).map((p) => p.slot);
    const miss = [1, 2].slice(0, needP).filter((k) => !have.includes(k));
    out.push(miss.length ? check('photos', 'Photos the report layout prints', 'Block', `The report layout needs ${needP === 1 ? 'a photo' : 'two photos'} of the sample: mark ${miss.map((k) => `"Report photo ${k}"`).join(' and ')} on the sample's photos (sample page, Photos).`)
      : check('photos', 'Photos the report layout prints', 'Pass', `${needP === 1 ? 'The sample\'s report photo is' : 'Both report photos are'} on file`));
  }
  // 5. identity: sample details changed after logging
  const idc = await db.rows(`SELECT a.changed_at, a.changed_fields, u.full_name, a.reason FROM audit_log a JOIN app_user u ON u.id = a.changed_by
    WHERE a.table_name = 'sample' AND a.record_id = $1 AND a.action = 'UPDATE' AND a.changed_at > (SELECT logged_at FROM sample WHERE id = $1) ORDER BY a.changed_at`, [c.sample.id]);
  const idFields = ['client_sample_id', 'description', 'matrix', 'product', 'lot', 'batch', 'compliance_category', 'metrc_id'];
  const idChanges = [];
  for (const a of idc) {
    for (const f of Object.keys(a.changed_fields || {})) if (idFields.includes(f)) idChanges.push(`${f.replace(/_/g, ' ')} "${a.changed_fields[f].old ?? ''}" to "${a.changed_fields[f].new ?? ''}" by ${a.full_name}${a.reason ? ' (' + a.reason + ')' : ''}`);
  }
  out.push(idChanges.length ? check('identity', 'Sample details since logging', 'Warning', idChanges.join('; '))
    : check('identity', 'Sample details since logging', 'Pass', 'Sample ID, client ID, description, lot and category unchanged since the sample was logged'));
  if (!c.sample.compliance_category) out.push(check('category', 'Compliance category', 'Warning', 'The sample has no compliance category (from the submission form)'));
  // 6. completeness
  out.push(check('complete', 'Tests on the sample', c.pending.length ? 'Info' : 'Pass', c.pending.length
    ? `${c.pending.length} test${c.pending.length > 1 ? 's' : ''} still in the lab (${c.pending.map((p) => p.test_name).join(', ')}): ${c.allow_partial ? 'listed as in progress on this version' : 'the client takes no partial reports, so the COA is issued when the last test is finalized'}`
    : 'Every test ordered on the sample is on this COA: it is the final version'));
  // 7. holds
  // OOS (R-2): an open investigation holds the result; an out-of-specification result needs a concluded one
  const oosBlocks = []; const oosConfirmed = []; const oosLinks = [];
  for (const t of now) {
    const p = await db.one('SELECT oos_release_problem($1) AS p', [t.requested_test_id]);
    if (p && p.p) {
      oosBlocks.push(`${t.test_name}: ${p.p}`);
      // a link to the investigation (or to the sample page, where "Open OOS..." is, when none is open yet)
      const x = await db.one(`SELECT id, oos_code FROM oos_investigation WHERE requested_test_id = $1 AND status <> 'Cancelled' ORDER BY opened_at DESC LIMIT 1`, [t.requested_test_id]);
      oosLinks.push(x ? { text: `Open ${x.oos_code}`, href: '#/oos/' + x.id } : { text: `Open the sample (to open the OOS)`, href: '#/samples/' + c.sample.id });
    }
    for (const x of await db.rows(`SELECT x.oos_code, a.analyte_name, x.reported, x.unit, x.client_notified_at FROM oos_investigation x JOIN analyte a ON a.id = x.analyte_id
        JOIN test_result tr ON tr.id = x.test_result_id WHERE x.requested_test_id = $1 AND x.status = 'Closed' AND x.conclusion = 'OOS confirmed' AND tr.status = 'Active'`, [t.requested_test_id])) {
      oosConfirmed.push(`${x.oos_code}: ${x.analyte_name} ${x.reported}${x.unit ? ' ' + x.unit : ''}${x.client_notified_at ? '' : ' (the client is emailed the OOS and the Phase II re-testing options when this COA is issued)'}`);
    }
  }
  // logbook values behind the results (migration 035): every entry approved, no correction flag open
  const lbBlocks = [];
  for (const t of now) {
    const p = await db.one('SELECT logbook_release_problem($1) AS p', [t.requested_test_id]);
    if (p && p.p) lbBlocks.push(`${t.test_name}: ${p.p}`);
  }
  if (lbBlocks.length) out.push(check('logbook', 'Logbook entries behind the results', 'Block', lbBlocks.join('; ')));
  if (c.client_on_hold) out.push(check('hold', 'Client hold', 'Block', 'The client is On Hold: reports cannot be released'));
  if (oosBlocks.length) out.push({ ...check('oos', 'Out of specification', 'Block', oosBlocks.join('; ')), links: oosLinks });
  else if (oosConfirmed.length) {
    out.push(check('oos', 'Out of specification (confirmed)', 'Info', `Released as out of specification after the investigation: ${oosConfirmed.join('; ')}`));
  }
  // the OOS loop (migration 028): a COA carrying a confirmed OOS is not the final one until the client's Phase II decision
  const p2 = await db.one('SELECT oos_awaiting_phase2($1) AS w', [c.sample.id]);
  if (p2 && p2.w) out.push(check('phase2', 'Client\'s Phase II decision', 'Info', 'This COA carries a confirmed OOS: it is not the final COA until the client\'s Phase II decision is recorded on the sample (re-test ordered, or no re-test). The final COA follows.'));
  // handwritten signature (migration 028) and serving size
  if (!c.authorized.has_signature) out.push(check('signature', 'Your handwritten signature', 'Block', 'You have no handwritten signature and title on file: a lab administrator adds them (Admin > People and groups). The COA prints them under the signature line.'));
  const servingTests = c.tests.filter((t) => t.finalized_now);
  // (031's Warning for a test reporting per serving with no serving size is now part of the Block below: 033)
  // Alex (2026-10-14): nothing per serving is released before the serving weight or density is measured, approved and
  // used. serving_problem() (migration 033) says what is missing; the request for the test is on the sample page.
  const servingHeld = c.tests.filter((t) => t.finalized_now && t.serving_problem).map((t) => `${t.test_name}: ${t.serving_problem}`);
  if (servingHeld.length) out.push({ ...check('serving_measured', 'Serving weight or density measured', 'Block', `Results per serving cannot be released yet. ${servingHeld.join('; ')}.`),
    links: [{ text: 'Open the sample (order or request the serving test)', href: '#/samples/' + c.sample.id }] });
  // limits per serving or per package need the sample's serving weight (and the servings per package): 031
  const basisMissing = servingTests.filter((t) => !t.serving_problem).flatMap((t) => t.results.filter((r) => r.spec_basis && r.basis_value === null).map((r) => `${r.analyte} (${r.spec_basis.toLowerCase()})`));
  if (basisMissing.length) out.push(check('serving_limit', 'Limits per serving or package', 'Warning', `Not compared: ${basisMissing.join(', ')}. The sample needs its serving weight${basisMissing.some((x) => /package/.test(x)) ? ' and servings per package' : ''} on the order page.`));
  if (!c.client_on_hold && !oosBlocks.length && !oosConfirmed.length) out.push(check('hold', 'Holds', 'Pass', 'No client hold and no out-of-specification result'));
  // 8. independence
  const did = await db.rows(`SELECT DISTINCT t.test_name FROM requested_test rt JOIN test t ON t.id = rt.test_id JOIN batch_entry e ON e.requested_test_id = rt.id
      JOIN test_batch b ON b.id = e.batch_id JOIN step_run r ON r.batch_id = b.id
     WHERE rt.id = ANY($1::uuid[]) AND b.status <> 'Cancelled' AND (r.performed_by = $2 OR r.witness_id = $2 OR b.reviewed_by = $2)`, [ids, userId]);
  out.push(did.length ? check('independence', 'Someone else\'s work', 'Block', `You performed, witnessed or reviewed ${did.map((x) => x.test_name).join(', ')}`)
    : check('independence', 'Someone else\'s work', 'Pass', 'You did not perform, witness or review this work'));
  // 9. dates
  const dt = await db.one(`SELECT bool_or(r.completed_at < s.logged_at) AS before_login, bool_or(r.completed_at > clock_timestamp()) AS future
      FROM requested_test rt JOIN sample s ON s.id = rt.sample_id JOIN batch_entry e ON e.requested_test_id = rt.id JOIN step_run r ON r.batch_id = e.batch_id
     WHERE rt.id = ANY($1::uuid[]) AND r.completed_at IS NOT NULL`, [ids]);
  out.push(dt && (dt.before_login || dt.future) ? check('dates', 'Dates', 'Block', dt.before_login ? 'Work recorded before the sample was logged' : 'Work dated in the future')
    : check('dates', 'Dates', 'Pass', 'The work is dated after the sample was logged and before now'));
  // 10. the difference from the last version the client received
  if (c.supersedes) {
    const last = await db.one(`SELECT v.content FROM coa_version v JOIN coa c ON c.id = v.coa_id WHERE c.sample_id = $1 ORDER BY v.version_no DESC LIMIT 1`, [c.sample.id]);
    const old = new Map(); for (const t of (last.content.tests || [])) for (const r of t.results) old.set(`${t.test_name}|${r.analyte}|${r.label}`, r);
    const changed = []; const added = [];
    for (const t of c.tests) for (const r of t.results) {
      const o = old.get(`${t.test_name}|${r.analyte}|${r.label}`);
      if (!o) added.push(`${t.test_name} ${r.analyte}${r.label ? ' (' + r.label + ')' : ''}`);
      else if (o.reported !== r.reported || o.unit !== r.unit || o.spec !== r.spec || o.conformance !== r.conformance) changed.push(`${r.analyte}${r.label ? ' (' + r.label + ')' : ''}: ${o.reported} ${o.unit} to ${r.reported} ${r.unit}`);
    }
    const noteChange = JSON.stringify(last.content.notes || []) !== JSON.stringify(c.notes || []);
    if (changed.length) out.push(check('changes', `Changes from version ${c.supersedes.version_no}`, 'Warning', `A result the client already received changes: ${changed.join('; ')}`));
    out.push(check('added', `New since version ${c.supersedes.version_no}`, 'Info', [added.length ? 'Added: ' + added.join(', ') : 'No new results', noteChange ? 'the notes changed' : ''].filter(Boolean).join('; ')));
  }
  if (c.is_gmp) out.push(check('gmp', 'GMP work', 'Info', 'Finalized by the quality team (reports.finalize_gmp)'));
  return out;
}

// Any page of ours as a PDF (the OOS investigation report), with a footer line and page numbers
async function htmlToPdf(page_html, footerText, { landscape = false } = {}) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(page_html, { waitUntil: 'load' });
    const foot = `<div style="font:7.5pt Helvetica,Arial,sans-serif;color:#5c6773;width:100%;padding:0 0.6in;display:flex;justify-content:space-between"><span>${esc(footerText)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;
    const buf = await page.pdf({ format: 'Letter', landscape, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: foot,
      margin: { top: '0.6in', bottom: '0.75in', left: '0.6in', right: '0.6in' } });
    return { buf, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
  } finally { await page.close().catch(() => {}); }
}

module.exports = { content, html, pdf, checks, newVerifyCode, expectedCells, DECISION_RULE, htmlToPdf, esc, fmtDate, fmtDateTime };
