// Workflow Designer, WD-1 (migration 012): the tests and workflows list, a method (SOP) added by paste, a new test
// built step by step (reporting and rounding, an analyte by paste, weighing, a preparation field, a formula tried with
// example values, QC Review), the problem list, approval by a Lab Supervisor with a signature (the analyst who built it
// cannot), approving the demo combined suitability draft, a duplicate, department groups, and a quote's
// specifications filled from the lab's suggested limits; WD-1.2 (migration 014): QC criteria per analyte, LOQ / LOD
// hidden on the report, the weighing tolerance in %, formula values picked by name; WD-1.3 (migration 015): every creation
// and change is signed (Created by without a reason, Changed by with one). Run on a freshly reset database.
const path = require('path'); const fs = require('fs');
let chromium; try { ({ chromium } = require('playwright')); } catch (_) { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright')); }
const { prepareUsers, signIn, sign, verifyVersion } = require('./auth');
const BASE = process.argv[2] || 'http://localhost:3000';
const OUT = process.argv[3] || path.join(__dirname, 'screens'); fs.mkdirSync(OUT, { recursive: true });
const results = []; const check = (l, ok, x = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + l + (x ? '  ' + x : '')); };

(async () => {
  await prepareUsers(BASE);
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 40[0-3]/.test(m.text())) errors.push(m.text()); });
  let native = 0; page.on('dialog', (d) => { native++; d.dismiss(); });
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const go = async (h) => { await page.goto(BASE + '/' + h); await page.waitForSelector('main h1'); await page.waitForTimeout(600); };
  const toasts = async () => (await page.locator('.toast').allInnerTexts()).join(' | ');
  const pick = async (selector, label) => { await page.locator(selector).selectOption({ label }); await page.locator(selector).dispatchEvent('change'); };
  const pasteAt = async (cell, text) => {
    await page.locator(cell).click();
    await page.evaluate((t) => { const dt = new DataTransfer(); dt.setData('text/plain', t); document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true })); }, text);
    await page.waitForTimeout(250);
  };
  const saveStep = async () => { await page.click('#s_save'); await sign(page); await page.waitForSelector('#se'); await page.waitForTimeout(700); };

  // ---- Analyst: the list, a method by paste, a new test
  await signIn(page, BASE, 'Analyst (demo)', '#/methods'); await page.waitForSelector('#g tbody tr');
  const listText = await page.locator('#g').innerText();
  check('Tests and workflows is in the menu; the demo tests are listed with their lab and department',
    (await page.locator('nav a[href="#/methods"]').count()) === 1 && /USP <51> Antimicrobial Effectiveness/.test(listText) && /Heavy Metals \(Pb, Cd, As, Hg\) by ICP-MS/.test(listText) && /MICRO/.test(listText));
  check('The combined USP <61>/<62> suitability test is a Draft with nothing to fix', /USP <61>\/<62> Method Suitability \(combined\)[^\n]*v1\s+None/.test(listText.replace(/\t/g, ' ')));
  await shot('90_methods_list');

  await go('#/methods/sops'); await page.waitForSelector('#g tbody tr');
  const n = await page.locator('#g tbody tr').count();
  await page.click('#g [data-add="1"]');
  await pasteAt(`#g tbody tr:nth-child(${n + 1}) td:nth-child(2)`, 'Loss on drying\tSOP-CHEM-0040\t\tGravimetric, 105 °C to constant weight');
  await page.click('#g .savebar [data-save]'); await sign(page); await page.waitForTimeout(800);
  check('A method (SOP) added by pasting a row', /MTH-\d{5}/.test(await page.locator('#g tbody tr', { hasText: 'Loss on drying' }).innerText()));

  await go('#/methods'); await page.click('#new'); await page.waitForSelector('.modal #f_test_name');
  await page.fill('.modal #f_test_name', 'Moisture by Loss on Drying (105 °C)');
  await page.locator('.modal #f_department_id').selectOption({ label: 'CHEM Chemistry' });
  await page.locator('.modal #f_method_id').selectOption({ label: 'Loss on drying (SOP-CHEM-0040)' });
  await page.click('.modal [data-ok]'); await page.waitForSelector('.sigmodal');
  check('Creating a test is signed (Created by), with no reason asked', /Created by/.test(await page.locator('.sigmodal').innerText()) && (await page.locator('.sigmodal #f_rpick').count()) === 0);
  await sign(page); await page.waitForSelector('.wdtabs'); await page.waitForTimeout(500);
  const vurl = page.url();
  check('New test: the designer opens on a Draft version 1', /Moisture by Loss on Drying \(105 °C\): version 1/.test(await page.locator('main h1').innerText()) && /Draft/.test(await page.locator('main .sub').innerText()));

  // tab 1: rounding
  await pick('#f_rmode', 'Decimal places'); await page.fill('#f_rdig', '2'); await page.locator('#f_rdig').dispatchEvent('change');
  check('Rounding example follows the choice (2 decimal places)', /12\.35/.test(await page.locator('#f_example').innerText()));
  await page.fill('#f_change', 'First version'); await page.click('#save'); await page.waitForSelector('.sigmodal');
  check('Changing a Draft is signed (Changed by) with a reason, picked from the Methods list', /Changed by/.test(await page.locator('.sigmodal').innerText())
    && /Draft being developed/.test(await page.locator('.sigmodal #f_rpick').innerText()));
  const wrongPw = await sign(page, { password: 'not-my-password-1', expectError: true });
  check('A wrong password keeps the dialog open and nothing is saved', /not correct/.test(wrongPw), wrongPw);
  await sign(page); await page.waitForTimeout(800);
  check('Test and reporting saved', /Saved/.test(await toasts()));

  // tab 2: an analyte by paste
  await go(vurl.replace(BASE + '/', '').replace(/\?.*$/, '') + '?tab=analytes'); await page.waitForSelector('#ag');
  await page.click('#ag [data-add="1"]');
  await pasteAt('#ag tbody tr:nth-child(1) td:nth-child(1)', '1\tMoisture\tNumeric\t% w/w\t0.1');
  await page.click('#ag .savebar [data-save]'); await sign(page); await page.waitForTimeout(900);
  check('Analyte added by paste with its unit and LOQ', /Moisture[\s\S]*% w\/w[\s\S]*0\.1/.test(await page.locator('#ag tbody tr').first().innerText()));

  // tab 3: steps
  const vid = vurl.match(/versions\/([\w-]+)/)[1];
  await go(`#/methods/versions/${vid}?tab=workflow`);
  await page.click('#add'); await page.waitForSelector('#se');
  await pick('#s_type', 'Weighing'); await page.fill('#s_name', 'Weigh'); await page.fill('#s_key', 'weigh');
  await pick('#c_mode', 'One target ± tolerance'); await page.fill('#c_t', '2'); await page.fill('#c_tol', '0.2');
  await page.locator('#s_eq label', { hasText: 'Analytical balance' }).locator('[data-eq]').check();
  await saveStep();
  await page.click('#add'); await page.waitForSelector('#se');
  await pick('#s_type', 'Preparation'); await page.fill('#s_name', 'Dry at 105 °C');
  check('A new step\'s key comes from its name; it follows the selected step', (await page.inputValue('#s_key')) === 'dry_at_105_c' && await page.locator('#s_deps label', { hasText: 'Weigh' }).locator('[data-dep]').isChecked());
  await page.click('#c_f [data-add="1"]');
  await pasteAt('#c_f tbody tr:nth-child(1) td:nth-child(1)', 'Dried weight (g)\tNumber');
  check('A Number field shows its formula token', /\{dry_at_105_c\.dried_weight_g\}/.test(await page.locator('#c_f').innerText()));
  await saveStep();
  await page.click('#add'); await page.waitForSelector('#se');
  await pick('#s_type', 'Calculation'); await page.fill('#s_name', 'Moisture'); await page.fill('#s_key', 'calc');
  await saveStep();   // saved first so the steps before it offer their values
  check('The formula palette offers the values of the steps before it, by name', (await page.locator('.wdtokens [data-tok="{weigh.weight}"]').count()) === 1
    && (await page.locator('.wdtokens [data-tok="{dry_at_105_c.dried_weight_g}"]').count()) === 1 && /Sample weight · Weigh/.test(await page.locator('.wdtokens').first().innerText()));
  await page.fill('#c_f', '({weigh.weight} - {dry_at_105_c.dried_weight_g}) / {weigh.weight} * 100'); await page.locator('#c_f').dispatchEvent('input');
  await pick('#c_u', '% w/w');
  await page.fill('#c_try [data-t="weigh.weight"]', '2'); await page.fill('#c_try [data-t="dry_at_105_c.dried_weight_g"]', '1.9');
  await page.click('#c_go'); await page.waitForTimeout(600);
  check('Try it: the formula calculates 5 with example values (the same engine results will use)', /= 5\b/.test(await page.locator('#c_out').innerText()), await page.locator('#c_out').innerText());
  await saveStep();
  await page.click('#add'); await page.waitForSelector('#se');
  await pick('#s_type', 'QC Review'); await page.fill('#s_name', 'QC Review');
  await saveStep();
  check('The workflow diagram shows the four steps', (await page.locator('#diag .node').count()) === 4);
  await shot('91_methods_designer');

  // tab 4: no problems; the analyst cannot approve
  await go(`#/methods/versions/${vid}?tab=review`);
  check('Review: no problems found', /No problems found/.test(await page.locator('main').innerText()));
  check('The analyst who built it has no Approve button', (await page.locator('#approve').count()) === 0 && /methods\.approve|someone else/.test(await page.locator('main .notice').innerText()));

  // ---- the workflow verification the lab requires (WD-6), then the Lab Supervisor approves (signed)
  const vout = await verifyVersion(BASE, vid);
  check('Its workflow verification runs and QA signs it (the lab requires one before approval)', /^Pass/.test(vout), vout);
  await signIn(page, BASE, 'Lab Supervisor (demo)', `#/methods/versions/${vid}?tab=review`); await page.waitForSelector('#approve');
  await page.click('#approve'); await sign(page); await page.waitForTimeout(1000);
  check('The Lab Supervisor approves with a signature: version 1 is Effective', /Effective/.test(await page.locator('main .sub').innerText()) && /approved by Lab Supervisor \(demo\)/.test(await page.locator('.wdlocked').innerText()));
  await go(`#/methods/versions/${vid}?tab=workflow`);
  check('An effective version is locked (no Add step)', (await page.locator('#add').count()) === 0);
  await go(`#/methods/versions/${vid}?tab=test`);
  check('...and its fields cannot be changed', await page.locator('#f_proc').isDisabled());

  // ---- Alex approves the combined suitability draft (he did not work on it)
  await signIn(page, BASE, 'Alex Kiddle', '#/methods?show=drafts'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'combined' }).locator('a', { hasText: 'v1' }).click(); await page.waitForSelector('.wdtabs');
  const cvid = page.url().match(/versions\/([\w-]+)/)[1];
  const cout = await verifyVersion(BASE, cvid);
  check('The combined suitability draft passes its workflow verification', /^Pass/.test(cout), cout);
  await page.reload(); await page.waitForSelector('.wdtabs');
  await page.locator('.wdtabs a', { hasText: 'Review and approve' }).click(); await page.waitForSelector('#approve');
  check('The combined draft lists who worked on it', /Worked on this version: Analyst \(demo\)/.test(await page.locator('main').innerText()));
  await page.click('#approve'); await sign(page); await page.waitForTimeout(1000);
  check('Alex approves the combined suitability test', /Effective/.test(await page.locator('main .sub').innerText()));
  await shot('92_methods_approved');

  // ---- Duplicate (analyst)
  await signIn(page, BASE, 'Analyst (demo)', '#/methods'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'by ICP-MS' }).locator('a').nth(1).click(); await page.waitForSelector('#dup');
  await page.click('#dup'); await page.waitForSelector('.modal #f_test_name');
  await page.fill('.modal #f_test_name', 'Heavy Metals in Soil by ICP-MS'); await page.click('.modal [data-ok]'); await sign(page); await page.waitForSelector('.wdtabs'); await page.waitForTimeout(500);
  await page.locator('.wdtabs a', { hasText: 'Workflow' }).click(); await page.waitForSelector('#diag .node');
  check('Duplicate: a new Draft test with the same 7-step workflow, ready to change', /Heavy Metals in Soil by ICP-MS: version 1/.test(await page.locator('main h1').innerText()) && (await page.locator('#diag .node').count()) === 7 && (await page.locator('#add').count()) === 1);

  // ---- QC criteria per analyte, LOQ / LOD hidden, weighing tolerance in % (migration 014): the demo Heavy Metals version 2 Draft
  await go('#/methods?show=drafts'); await page.waitForSelector('#g tbody tr');
  await page.locator('#g tbody tr', { hasText: 'Heavy Metals (Pb, Cd, As, Hg)' }).locator('a', { hasText: 'v2' }).click(); await page.waitForSelector('.wdtabs');
  await page.locator('.wdtabs a', { hasText: 'Analytes' }).click(); await page.waitForSelector('#ag tbody tr');
  check('Each analyte can hide its LOQ and its LOD on the report (deck slide 4)', /Hide LOQ[\s\S]*Hide LOD[\s\S]*Hide analyte/.test(await page.locator('#ag thead').innerText()));
  await page.locator('.wdtabs a', { hasText: 'Workflow' }).click(); await page.waitForSelector('#diag .node');
  await page.locator('#diag .node', { hasText: 'Batch' }).first().click(); await page.waitForSelector('.wdqc');
  const qcCard = (name) => page.locator('.wdqc').filter({ has: page.locator('.wdqchead b', { hasText: new RegExp(`^${name}$`) }) });
  check('The analyte tables start folded away; each criterion shows only its exceptions (mercury 70 to 130; ICV: all at the default)',
    !(await qcCard('Matrix Spike').locator('.wdcritg').isVisible()) && /Exceptions:\s*Mercury: 70 to 130/.test(await qcCard('Matrix Spike').locator('.wdexc').innerText())
    && /All 4 analytes use the default/.test(await qcCard('ICV').locator('.wdexc').innerText()));
  check('...and the duplicate shows mercury as not judged without opening it', /Mercury: not judged/.test(await qcCard('Matrix Spike Duplicate').locator('.wdexc').innerText()));
  await shot('94a_methods_qc_folded');
  await qcCard('Matrix Spike').locator('.wdtoggle').click(); await qcCard('Matrix Spike Duplicate').locator('.wdtoggle').click();
  const msText = await qcCard('Matrix Spike').innerText();
  check('Each QC lists every analyte with its own limit: matrix spike lead 75 to 125, mercury 70 to 130',
    (await qcCard('Matrix Spike').locator('.wdcritg tbody tr').count()) === 4 && /Lead[\s\S]*75[\s\S]*125/.test(msText) && /Mercury[\s\S]*70[\s\S]*130/.test(msText), msText.replace(/\s+/g, ' ').slice(0, 200));
  check('A QC can leave out an analyte: the matrix spike duplicate does not judge mercury', /Mercury[\s\S]*Not judged/.test(await qcCard('Matrix Spike Duplicate').innerText()));
  await qcCard('Matrix Spike').locator('input[id^="k_min_"]').fill('80'); await qcCard('Matrix Spike').locator('input[id^="k_min_"]').dispatchEvent('change');
  const ms2 = await qcCard('Matrix Spike').locator('.wdcritg').innerText();
  check('Changing the default moves the analytes on the default; mercury keeps its own limit', /Lead\s+✓\s+80\s+125/.test(ms2.replace(/\t/g, ' ')) && /Mercury\s+✓\s+70\s+130/.test(ms2.replace(/\t/g, ' '))
    && /Exceptions:\s*Mercury: 70 to 130/.test(await qcCard('Matrix Spike').locator('.wdexc').innerText()), ms2.replace(/\s+/g, ' ').slice(0, 200));
  await shot('94_methods_qc_per_analyte');
  await saveStep();
  await page.locator('.wdtabs a', { hasText: 'Review and approve' }).click(); await page.waitForSelector('#qcx tbody tr');
  const qcx = (await page.locator('#qcx').innerText()).replace(/\t/g, ' ');
  check('Review shows what each QC judges per analyte (saved): spike lead 80 to 125, mercury 70 to 130, duplicate mercury not judged',
    /Matrix Spike Recovery % Lead 80 to 125/.test(qcx) && /Matrix Spike Recovery % Mercury 70 to 130/.test(qcx) && /Matrix Spike Duplicate RPD Mercury Not judged/.test(qcx), qcx.slice(0, 160));
  check('The per-analyte version has no problems to fix', /No problems found/.test(await page.locator('main').innerText()));
  await page.locator('.wdtabs a', { hasText: 'Workflow' }).click(); await page.waitForSelector('#diag .node');
  await page.locator('#diag .node', { hasText: 'Weigh' }).first().click(); await page.waitForSelector('#c_tu');
  check('Weighing tolerance in % (deck slide 7): 0.5 g ± 10 % accepts 0.45 to 0.55 g', (await page.locator('#c_tu').inputValue()) === '%' && /0\.45 to 0\.55 g/.test(await page.locator('#c_tolx').innerText()));

  // ---- Micro definitions (migration 013): USP <62> version 2
  await go('#/methods?show=effective'); await page.locator('#g tbody tr', { hasText: 'USP <62> Specified' }).locator('a').first().click(); await page.waitForSelector('#vg');
  await page.locator('#vg a', { hasText: 'v2' }).click(); await page.waitForSelector('.wdtabs');
  await page.locator('.wdtabs a', { hasText: 'Analytes' }).click(); await page.waitForSelector('#ag tbody tr');
  check('USP <62> version 2: each organism reports ND, ND*, D*, D (D*, D mean found)', /ND, ND\*, D\*, D[\s\S]*D\*, D/.test(await page.locator('#ag tbody tr').first().innerText()));
  await page.locator('.wdtabs a', { hasText: 'Workflow' }).click(); await page.waitForSelector('#diag .node');
  await page.locator('#diag .node', { hasText: 'Weigh 10 g' }).click(); await page.waitForSelector('#c_cat');
  check('Its Weighing step sets a weight range per product category', (await page.locator('#c_mode').inputValue()) === 'By product category' && /Dietary Supplement[\s\S]*10[\s\S]*11/.test(await page.locator('#c_cat').innerText()));
  await page.locator('#diag .node', { hasText: 'Batch' }).first().click(); await page.waitForSelector('#c_qc tbody tr');
  check('Its positive control runs daily and is made from strains', /Positive Control[\s\S]*Daily[\s\S]*Strains of the test/.test(await page.locator('#c_qc').innerText()));
  await shot('93_methods_micro');

  // ---- Department groups (Alex)
  await signIn(page, BASE, 'Alex Kiddle', '#/admin/groups'); await page.waitForSelector('#gg tbody tr');
  check('Groups can stand for a department: Chemistry is CHEM, Microbiology is MICRO',
    /CHEM Chemistry/.test(await page.locator('#gg tbody tr', { hasText: 'Chemistry department' }).innerText()) && /MICRO Microbiology/.test(await page.locator('#gg tbody tr', { hasText: 'Microbiology department' }).innerText()));

  await go('#/admin/matrices'); await page.waitForSelector('#pc tbody tr');
  check('Matrices carry a product category; the categories are their own list', /Dietary Supplement/.test(await page.locator('#g tbody tr', { hasText: 'Hard or soft capsules' }).innerText()) && /Cosmetic/.test(await page.locator('#pc').innerText()));

  // ---- Specifications on a quote
  const proj = await page.evaluate(async () => (await (await fetch('/api/projects', { headers: { 'x-site-id': '' } })).json()).find((p) => p.project_name === 'Supplement release: metals and micro'));
  await go('#/quote/' + proj.latest_version_id); await page.waitForSelector('#lg tbody tr');
  const icpRow = page.locator('#lg tbody tr', { hasText: 'by ICP-MS' });
  check('A quoted test shows its limits: 1 set by the client', /1 limit\b/.test(await icpRow.innerText()));
  await icpRow.locator('button', { hasText: 'limit' }).click(); await page.waitForSelector('#sp_g tbody tr');
  await page.click('#sp_sugg'); await page.click('.modal [data-ok]'); await page.waitForTimeout(900);
  check('The lab\'s suggested limits fill the empty rows: 4 limits', /4 limits/.test(await page.locator('#lg tbody tr', { hasText: 'by ICP-MS' }).innerText()), await toasts());

  // ---- Audit
  await go(vurl.replace(BASE + '/', '')); await page.click('main h1 .auditbtn'); await page.waitForTimeout(800);
  const audit = await page.locator('.modal').innerText().catch(() => '');
  check('The test\'s audit trail shows its steps and the approval signature', /Step Weigh/.test(audit) && /Approved by/.test(audit));
  check('...and who signed each creation and change (Created by, Changed by)', /Analyst \(demo\) \(Created by\)/.test(audit) && /Analyst \(demo\) \(Changed by\)/.test(audit));
  const unsigned = await page.evaluate(async (vid2) => { const r = await fetch(`/api/methods/versions/${vid2}/header`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: { change_summary: 'x' }, reason: 'x' }) }); return (await r.json()).error || 'saved'; }, vurl.match(/versions\/([\w-]+)/)[1]);
  check('A change sent without a signature is refused by the server', /signature/i.test(unsigned), unsigned);

  check('No native browser dialogs', native === 0);
  check('No browser errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await b.close();
  const failed = results.filter((x) => !x).length;
  console.log(`\nTOTAL: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
