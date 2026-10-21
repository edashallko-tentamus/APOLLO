---
type: Proposal
status: Answered by Alex (2026-10-14, 15:08 and 15:11); items 1 (templates, placeholders), 3 (name as a setting), 4 (image placeholders) and 5 (look) built in 0.16.0
raised: 2026-10-14 (Alex's list of 2026-10-14, 02:04)
---

# Proposal - Quick Design Items for the Next Slice

> **Answered (2026-10-14).** Alex: accreditation as a placeholder for now; many report templates, assigned per test in the Workflow Designer, defaulting to the COA as built, kept under the admin side with the sites; image placeholders and a place to upload them on the lab site; "friendly and fun". A sample whose tests use two templates gets one COA in two parts. Built in 0.16.0: see [[Decision - Report Templates, Lab Images and Accreditation Placeholders]]. The name stays LIMS3 (one setting) until a trademark check; "LabAli" sounds the same as Lab-Ally, so it carries the same risk.

Alex asked for five "quick design items" to go into the next slice: the COA format, serving size on the lab order, the LabAlly name, lab logos and a product logo, and icons for a more fun look. Below is what Claude proposes for each, and the questions that decide the build. Nothing here is built by Claude in the cloud yet.

**Already under way on the laptop (Claude Code, migration 028, 2026-10-14, "Report Finalization follow-up"; seen while checking the laptop, not yet merged):**
- serving size on the sample, and a test version can report per serving;
- each person's handwritten signature and title, printed on the COA;
- measurement uncertainty per analyte;
- the report ID as the sample ID plus R1, R2...

So item 2 is largely covered there, and item 1 below only lists what 028 does not. The standalone quoting module was built separately (see [[Decision - Standalone Quotes]]).

**Recommended order:** 3 (name) first, because 4 (logos) and every PDF and email depend on it. Then 4, 1, 2, 5.

---

## 1. Final report (COA) formatting (what 028 does not cover)

**What the COA has today (R-1):**
- the lab's name and address, the COA code and version (with "supersedes version 1 issued ...");
- client and sample blocks (client, address, contact, order, PO; sample ID, client sample ID, description, matrix, lot, dates);
- one table per test: analyte, result, unit, LOQ, specification ("Client provided specification") and conformance;
- notes, tests still in progress, the decision rule, and "relates only to the sample tested";
- "Authorized by", electronically signed, and the verification code. Plain Helvetica, no logo.

**Proposed:**
- **The lab's logo** in the header, and the accreditation statement per lab: the body and certificate number (for example "ISO/IEC 17025:2017, A2LA certificate ####.##"). A test outside the lab's scope is marked with a symbol and a footnote. ISO 17025 7.8.2.1 and the accreditation body's rules on using its mark ask for this. *Which body and certificate number for CFL and TPS?*
- **A header strip** with the dates a reader looks for first: received, testing started, reported.
- **One results table per test**, with the method reference (USP <62>, AOAC ...) under the test name, and results aligned on the decimal. Optional: hide LOQ/LOD per analyte (the designer already stores this, WD-1.2).
- **The signature block:** name, title and handwritten signature come with 028.
- **The footer:** page X of Y, the COA code and version, and the verification code on every page. A QR code to the verification page comes later.
- **Before building:** *Do you have a current COA from iLIMS, or a template, that clients are used to?* Matching it is the fastest way to a format they accept. Claude Code is also changing Result Finalization today (migration 028), so the COA layout should be changed after that lands.

## 2. Serving size on the lab order (largely built by Claude Code in 028; check against this list)

**Proposed:**
- Two fields on each sample: **serving size** (number + unit, e.g. 2 capsules, 30 g, 15 mL) and, optional, **servings per container**.
  - Entered on the order's sample grid and on the submission form.
  - Filled down and pasted like every grid.
- **A unit weight**, so results can be converted. For example, a capsule weighs 0.75 g:
  - "mg/g × g per serving = mg per serving";
  - counts convert per serving the same way (CFU/g × g per serving).
- **On the COA:** a "Per serving" column for the analytes where it makes sense (nutrients, and heavy metals, which Prop 65 and, as Claude understands it, USP <2232> assess per daily serving; to confirm with QA), chosen per analyte in the designer ("Report per serving").

**Questions for Alex:**
- Per sample, or per order (one value for all samples)? Claude recommends per sample: lots differ, and the grid's fill down makes it one action.
- Which tests or analytes report per serving?
- Is the serving size the client's declaration, so the COA says "as declared by the client"?

## 3. Rename LIMS3 to LabAlly: please check the name first

**Claude recommends not using "LabAlly" as it stands.** Lab-Ally, LLC already exists in laboratory informatics:
- It is a Columbus, Ohio company that sells an electronic lab notebook (CERF) and sample management software (eCAT, RSpace).
- It is listed on LIMSwiki and G2.

A LIMS called LabAlly would sit in the same market, and that looks like a real trademark conflict. Claude is not a lawyer, so check with Tentamus's legal team or a trademark search (USPTO) before printing it on COAs, quotes and emails.

**Built either way:**
- The name becomes one setting, the product name, kept by system administrators. The menu header, browser title, sign-in page, emails, PDF footers and labels all read it.
- A rename is then a one-line change, whatever name is chosen.

**Ideas if you want alternatives:** names that are less likely to collide (all to be checked the same way):
- "Tentamus Lab Hub";
- a Tentamus-owned name such as "TLIMS";
- an invented word.

**Question for Alex:** keep LabAlly after a trademark check, or pick another name?

**Answered (Alex, 2026-10-19): "Probata", for now.** Latin for "proven" or "tested", a pair to Tentamus ("let us try"). Claude's web searches found no lab software of that name (only Probat, coffee roasters, and Probitas, unrelated); LabTek (Thermo Fisher's Nunc Lab-Tek labware) and LabTech (crowded; also a lab job title) were rejected. Still to do before it is printed: a USPTO search and Tentamus counsel. The name is a system setting (Admin > Lab setup > Sites and holidays, product name), so changing it needs no code.

## 4. Logos for the labs, and the product logo

**Proposed:**
- **Each lab gets a logo** (PNG or SVG), uploaded on Admin > Sites and holidays. System administrators upload it.
  - It is stored unchanged with its fingerprint, like every document.
  - It appears on that lab's COAs, quotations (the lab doing most of the work, or Tentamus North America for a multi-lab quote), labels (optional) and the app header when you work in that lab.
- **The product logo** is drawn as a simple SVG mark plus the name. Claude will draft three options once the name is settled, so the logo is not made twice.
- **Question:** do the labs already have logo files (Tentamus brand guidelines)? If so, send them and Claude will use them rather than draw new ones.

## 5. Icons and a more fun look

**Proposed:**
- **Icons:**
  - Each menu item gets an icon, with a colour per section: Intake blue, Testing green, Lab supplies amber, Pricing violet, Admin grey.
  - Buttons get icons too: Add, Send, Sign, Print, Export.
  - The icons come from an open icon set (Lucide, ISC licence) copied in as inline SVG. No new install, so the zero-dependency rule holds.
- **Colour:**
  - Status chips get colours everywhere: Draft grey, Quoted amber, Accepted green, Rejected red, In Testing blue.
  - Each page has a coloured title icon.
  - Empty lists get a friendly line and an illustration-style icon instead of "No rows yet".
- **Tone:** rounded corners, slightly larger headings, softer card shadows. Alex asked for "more fun", so his own app should feel lively. It stays sober enough for auditors; the PDFs clients receive stay formal.
- **How:** Claude makes a clickable mockup of two directions (A: "clean and friendly", light with coloured accents; B: "bold", deeper colours and a dark sidebar). Alex picks one, and it is applied across every page in one slice.
- **Question:** any colours that must or must not be used (Tentamus brand colours)?

---

**Open questions for Alex (collected):**
1. Accreditation body and certificate numbers for CFL and TPS?
2. An existing COA template to match?
3. Serving size: does 028 cover it (per sample; per serving on the COA), and should the COA say "as declared by the client"?
4. LabAlly after a trademark check, or another name?
5. Existing logo files and brand colours?
6. UI direction A or B (after the mockup)?

See [[Decision - Result Finalization and the Certificate of Analysis]], [[Open Items for QA Review]].
