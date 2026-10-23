// A COA whose tests use different report templates (migration 030, Alex 2026-10-14): one PDF in parts, one part per
// template (the lab's default first), each test in its own template's part with that template's title and options,
// the client and sample details repeated on each part, the signature once at the end, and every printed cell read
// back from the PDF. Works on the database directly, inside one transaction that is rolled back: two demo tests on one
// sample are made from the demo data (a copy of the Vitamin C stability test with its results), the copy reporting
// with a second template. Needs PostgreSQL and the demo data:
//   DATABASE_URL=postgres://... node tests/coa_parts.js
process.chdir(require('path').join(__dirname, '..'));
const { Database } = require('../backend/server/db');
const COA = require('../backend/server/coa');
const results = []; const check = (l, ok, x = '') => { results.push(!!ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  const D = await new Database().open({ url: process.env.DATABASE_URL });
  const q = (s, p) => (p ? D.query(s, p) : D.exec(s));
  await q('BEGIN');
  try {
    await D.query(`SELECT set_config('lims.user_id', (SELECT id::text FROM app_user WHERE username = 'akiddle'), true), set_config('lims.reason', 'COA parts test', true)`, []);
    const a = await D.one(`SELECT rt.id, rt.sample_id, rt.test_version_id, o.site_id FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id JOIN lab_order o ON o.id = sa.lab_order_id
      WHERE sa.client_sample_id = 'VC-2301' AND test_awaits_finalization(rt.id)`, []);
    const b = await D.one(`SELECT rt.id FROM requested_test rt JOIN sample sa ON sa.id = rt.sample_id WHERE sa.client_sample_id = 'VC-2302' AND test_awaits_finalization(rt.id)`, []);
    if (!a || !b) throw new Error('The demo stability lots VC-2301 and VC-2302 are not waiting in Result Finalization (fresh demo data needed)');
    // the fixture: VC-2302's test moves onto VC-2301 as a copy of the test (another name) whose version reports with a second template
    await q('SET LOCAL session_replication_role = replica');
    const nt = await D.one(`INSERT INTO test SELECT (jsonb_populate_record(null::test, to_jsonb(t) || jsonb_build_object('id', gen_random_uuid(), 'test_code', 'T-99999', 'test_name', 'Yeast and mould (fixture)'))).*
      FROM test t WHERE id = (SELECT test_id FROM test_version WHERE id = $1) RETURNING id`, [a.test_version_id]);
    const nv = await D.one(`INSERT INTO test_version SELECT (jsonb_populate_record(null::test_version, to_jsonb(v) || jsonb_build_object('id', gen_random_uuid(), 'test_id', $2::uuid))).*
      FROM test_version v WHERE id = $1 RETURNING id`, [a.test_version_id, nt.id]);
    await D.query('UPDATE requested_test SET sample_id = $1, test_version_id = $2, test_id = $3 WHERE id = $4', [a.sample_id, nv.id, nt.id, b.id]);
    await q('SET LOCAL session_replication_role = origin');
    const t2 = await D.one(`INSERT INTO report_template (template_name, layout, site_id, options) VALUES ('Micro short form (fixture)', 'Standard COA', $1,
      '{"show_method": false, "show_loq": false, "title": "MICROBIOLOGY REPORT"}') RETURNING id, template_code`, [a.site_id]);
    await q('SET LOCAL session_replication_role = replica'); // the version is Effective (locked); the fixture sets it directly
    await D.query('UPDATE test_version SET report_template_id = $1 WHERE id = $2', [t2.id, nv.id]);
    await q('SET LOCAL session_replication_role = origin');

    const me = await D.one(`SELECT id FROM app_user WHERE username = 'akiddle'`, []);
    const c = await COA.content(D, { sampleId: a.sample_id, testIds: [a.id, b.id], userId: me.id, verifyBase: 'http://lab.example' });
    const sec = c.sections || [];
    check('Two templates on one sample give two parts, the lab default first', sec.length === 2 && sec[0].template.code === 'RT-001' && sec[1].template.id === t2.id,
      JSON.stringify(sec.map((s) => s.template.code)));
    check('Each test is in its own template\'s part', sec.length === 2 && sec[0].tests.length === 1 && sec[0].tests[0] === a.id && sec[1].tests.length === 1 && sec[1].tests[0] === b.id);
    const html = COA.html(c, { preview: true });
    const p2 = html.slice(html.indexOf('Part 2 of 2'));
    check('The parts are labelled, each with its own title', /Part 1 of 2: Standard Certificate of Analysis/.test(html) && /Part 2 of 2: Micro short form \(fixture\)/.test(html)
      && /CERTIFICATE OF ANALYSIS/.test(html) && /MICROBIOLOGY REPORT/.test(html));
    check('Part 2 follows its template: no method line, no LOQ column; part 1 keeps both', !/Method: /.test(p2) && !/>LOQ</.test(p2) && /Method: /.test(html.slice(0, html.indexOf('Part 2 of 2'))));
    check('The client and sample details are on each part; the signature block once, at the end', (html.match(/VC-2301/g) || []).length >= 2 && (html.match(/Verification code/g) || []).length === 1
      && html.lastIndexOf('Verification code') > html.indexOf('Part 2 of 2'));
    const made = await COA.pdf(c, { preview: true });
    const pages = (made.buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
    check('The PDF starts each part on a new page, and every printed cell reads back', pages >= 2 && made.readBack.mismatches.length === 0 && made.readBack.cells > 10,
      `${pages} pages, ${made.readBack.cells} cells, ${made.readBack.mismatches.slice(0, 2).join('; ')}`);
  } finally {
    await q('ROLLBACK'); D.close();
  }
  const failed = results.filter((x) => !x).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
