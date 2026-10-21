---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-14); build choices Proposed
decided: 2026-10-14
built: 2026-10-14 (migration 030, version 0.16.0)
---

# Decision - Report Templates, Lab Images and Accreditation Placeholders

**Alex, 2026-10-14 (answers to [[Proposal - Quick Design Items for the Next Slice]]):**
1. Accreditation: "create a place holder. We will hold off on that for now."
2. "We actually want to have many different report templates and assign them in the workflow designer to each test but we should default to the template you built. Later we will create more. The template should live in the admin side under sites."
3. "Don't worry about logos yet. But create place holders and a place in the lab site module to upload those types of media."
4. The look: "friendly and fun sounds best to me."
5. The name: asked whether "LabAli" is better. Claude's answer: no, it sounds the same as Lab-Ally, LLC, so it carries the same risk (Claude is not a lawyer). The name is built as one setting, LIMS3 for now.

**Alex, 15:11:** "I want the COA appended with the correct report template. If a sample has two different report templates assigned, then it uses both and the COA PDF has the tests separated across the two templates appropriately."

**As built**
- **Report templates** live under Admin > Lab setup > Report templates (beside Sites and holidays).
  - RT-001 "Standard Certificate of Analysis" is the COA built in R-1 and 028, and the default for every lab.
  - A template has a layout, a title and four switches: method line, test version, dates tested, LOQ column.
  - A template belongs to one lab or to every lab. QA and lab administrators keep their lab's templates (permission `reports.templates`); system administrators keep the every-lab ones.
  - Each lab may have its own default; otherwise the every-lab default applies. The default cannot be retired.
- **The Workflow Designer** (tab 1, Reporting) picks the template per test version; blank means the lab's default. A new version keeps its predecessor's choice. Only active templates of the test's lab or every lab can be chosen.
- **The COA in parts:** when the tests on one sample use different templates, the COA stays one document (one report ID, one version, one signature, one verification code), printed in parts:
  - one part per template, the lab's default first;
  - each part starts on a new page with its own title and "Part 1 of 2: <template name>", repeats the client and sample details, and holds only its tests (and its tests still in progress);
  - the notes, the decision rule and the signature appear once, at the end;
  - every printed cell is still read back from the PDF before issue;
  - the COA version records which templates it used.
- **Lab images** on the Sites page: slots for the Logo, the Small logo and the Accreditation mark, shown as placeholders ("No file yet") until a file is uploaded, plus any other images.
  - Lab administrators upload them (`admin.lab`): PNG, JPEG or SVG, up to 2 MB, stored unchanged with their fingerprint.
  - An image is never replaced: uploading a new one retires the old one, which stays in the history.
  - The logo prints at the top of the lab's COAs. The small logo replaces the initials in the header while working in that lab. The mark prints beside the accreditation statement.
- **Accreditation placeholders:** the Sites grid has Accreditation body, Certificate no. and Accreditation statement. The statement prints on the COA when it is filled; nothing prints when it is empty.
- **The product name** is one setting (LIMS3), used in the header, the browser tab and the sign-in page. System administrators change it on the Sites page.
- **The look:** each menu section has a colour (Intake blue, Testing green, Lab supplies amber, Pricing plum, Admin slate), every menu item an icon, and each page title carries its menu item's icon. Cards are rounder, status badges are coloured by kind, and an empty list shows an icon.

**Build choices (Proposed, for Alex to confirm)**
1. **Templates are settings, not free designs.** Only one layout ("Standard COA") exists; a template chooses its title and what is shown. A truly different layout (for example a stability summary or a nutrition panel) is code, added as a new layout later, and then any template can use it. Free-form designers are hard to validate under Part 11; a fixed set of tested layouts is easier to defend.
2. **One COA, in parts**, rather than one COA per template. A sample keeps one report ID (CFL...-R1) and one verification code, so the client and the verification page see one document. Alternative if QA prefers: separate COAs per template.
3. **Template order:** the lab's default first, then the others by code.
4. **A template belongs to a lab or every lab and never moves.** A lab's QA cannot change templates that other labs use.
5. **The images are not stored in the COA record.** The PDF carries them; the record keeps which image was used (its id), so the stored content stays small and the PDF's fingerprint covers what was printed.
6. **The accreditation scope** (marking tests outside the lab's scope, the accreditation body's rules on using its mark) waits until Alex is ready, as he asked.
7. **The logo on quotations** is not built yet (COAs only).

**Not built:** new layouts; the accreditation scope rules; a product logo; renaming (the trademark check comes first). Quotations, emails, labels and PDF footers do not yet read the product name.

Related: [[Decision - Result Finalization and the Certificate of Analysis]], [[Proposal - Quick Design Items for the Next Slice]], [[Decision - Workflow Verification]].
