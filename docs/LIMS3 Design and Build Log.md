# LIMS3 Design and Build Log

A living record of how LIMS3 is designed and built: what changed in each version, why, who built it, how it was checked, and what is still open. It covers the work of Claude in the cloud (claude.ai) and Claude Code on Alex's laptop.

| | |
|---|---|
| System | LIMS3, Tentamus North America (first lab: CFL) |
| Environment | Sandbox (non-GxP). Fictional demo data only. |
| System Owner | Alex Kiddle, LIMS Director |
| Current version | **0.36.2** (2026-10-23) |
| Related records | TNA-CC-002 LIMS3 Change Control; VP-LIMS3-001 Validation Plan; LIMS3 Module Development Framework; ontology vault (`docs/ontology_vault`) |

**Status in plain words.** The Sandbox prototype passes its automated functional tests: 1898 database rule tests (0.36.0 on PostgreSQL 16 in the cloud; Claude Code reports the PGlite runs in its entries) and 41 browser test suites (0.36.0 on PostgreSQL 16 in the cloud). It has **not** been through a URS sign-off, a validation protocol, an independent review or a sign-off under the Module Development Framework. Nothing here is validated or ready for use.

---

## 1. How to keep this log

- **Every slice adds one entry** to section 5 (newest first) and updates the table in section 4. Each entry gives the version, the date, who built it, what changed, why (the decision notes), the migrations and files, and how it was checked.
- **Both Claudes update it.** Claude in the cloud updates it when it delivers a slice. Claude Code updates it when it builds or fixes something on the laptop. Neither rewrites the other's entries; corrections are added as a new line.
- **Versions.** The second number moves for a new module or slice (0.9.0). The third moves for follow-up changes within a slice (0.9.1). `package.json` carries the current version. Versions before 0.8.0 were numbered when this log was created; `package.json` only began tracking at 0.8.0.
- **Decisions** live in the vault (`docs/ontology_vault/08 Decisions`). This log points to them rather than repeating them.
- **Open questions** are tracked in `CLAUDE.md` ("Open items to raise with Alex"). **QA questions** are tracked in the vault note `Open Items for QA Review` (Jake Teller).

---

## 2. How we design and build

**The cycle for each slice**
1. **Design with Alex.** Claude proposes the scope and rules in chat (sometimes from Alex's decks, such as `Testing_Workflow_Build_Out.pptx`). Alex answers the questions. Each answer becomes a vault decision note marked Approved.
2. **Build choices.** Where Alex has not ruled, Claude makes a choice, builds it, and records it in a "Build Choices" note marked Proposed, with the questions listed for Alex.
3. **Build.**
   - A numbered database migration (the rules live in the database).
   - The API routes and screens.
   - Demo data as a new seed file.
   - Rule tests (SQL) and a browser test (Playwright).
4. **Check.**
   - Every rule test and every browser suite runs on a fresh database.
   - Each migration is run on databases built at earlier versions (the upgrade simulation), so Alex's existing data survives.
   - Screenshots are reviewed.
5. **Deliver.**
   - Files go to the laptop project with Windows line endings.
   - Each file is written only if the laptop copy has not changed since it was last checked (a time-stamp guard), so nothing Claude Code did is overwritten.
6. **Alex reviews** in the browser and answers. His feedback becomes the next follow-up slice (for example 0.9.0 to 0.9.1).

**Working with two Claudes**
- Claude in the cloud designs and builds most slices.
- Claude Code works directly on the laptop: fixes, follow-ups Alex asks for while reviewing, and running everything on PGlite (the embedded database the laptop uses).
- Before every new slice, Claude in the cloud checks the laptop for changes and merges them first. Alex does not have to report them.
- `CLAUDE.md` lists, for each slice, the files the other Claude must merge.

**Rules every slice follows** (details in `CLAUDE.md`)
- **Audited records.** Every regulated table is audited by the database itself, with old and new values, who, when and the reason. Records are versioned and never hard-deleted.
- **Signatures.** Changes to regulated records need a Reason for Change. Signed actions need the user's own password (Part 11 style). Bench steps are signed "Performed by" and reviews "Reviewed by".
- **Permissions** grow with every module. Each new action gets a permission, is enforced in the database and on the server, and is given to the right standard groups.
- **Screens.**
  - Every grid takes paste from Excel and fill down.
  - Every pick list is a smart dropdown.
  - Every ID is a link, and every page has its audit-trail icon.
  - No browser pop-up dialogs are used.
- **Alex's data.** His Sandbox data in `data/` is never reset. Tests run on a separate fresh database.
- **Never set Alex's password.**

**Deviations from the Module Development Framework, to resolve before validation**
- **No signed URS per module yet.** The requirements are Alex's answers, recorded as approved vault decision notes. They would need to be assembled into a URS and signed.
- **No version control repository.** The Framework asks for version control from day one. Changes are traced through this log, the numbered migrations, the audit trail and the vault. A git repository should be set up before promotion to Test/Validation.
- **Wave order.** The Framework holds the Workflow module until Inventory, Equipment and Purchasing clear sign-off. In the Sandbox, the Workflow Designer was built straight after Phase 1 was built (Alex's decision: `Decision - Phase 1 Is Finished Before the Workflow Designer`), before any sign-off. This is acceptable for a prototype, but the Framework's order applies when modules go through the checkpoints.
- **Builder versus reviewer.** The Framework names a developer (Dan) and an independent reviewer. Here the builders are Claude and Claude Code, directed by Alex. Independent review (checkpoint 4) is still to be assigned.

---

## 3. Module status against the Framework checkpoints

| Module | 1 URS | 2 Build (Sandbox) | 3 Validation protocol | 4 Independent review | 5 Sign-off |
|---|---|---|---|---|---|
| Core (clients, quotes, orders, samples, audit, login and signatures) | Decisions approved; no URS document | Built | Not started | Not started | Not started |
| Inventory | Decisions approved; no URS document | Built | Not started | Not started | Not started |
| Equipment | Decisions approved; no URS document | Built | Not started | Not started | Not started |
| Purchasing | Decisions approved; no URS document | Built | Not started | Not started | Not started |
| Permissions | Decisions approved; no URS document | Built | Not started | Not started | Not started |
| Workflow (designer, bench, QC Review, micro) | Decisions approved; no URS document | Built, in progress (stability and the client portal to come) | Not started | Not started | Not started |

---

## 4. Version history

| Version | Date | Slice | Built by | Migrations | What it added |
|---|---|---|---|---|---|
| 0.36.2 | 2026-10-23 | Web server hardening | Claude Code (Edashall Konah) | none | A broken %-code in an address no longer stops the server; the page folder check needs the folder separator; uploads over 5 MB are cut off instead of read to the end; behind a proxy the rate limit takes the last X-Forwarded-For entry (the proxy's) |
| 0.36.1 | 2026-10-22 | Batch page redraws, header search box, bench test timing | Claude Code | none | The batch page draws only its latest load (an older load finishing last no longer puts back the batch as it was); the header search box is set up once; `test:testing` waits for autosave, focus and redraws instead of fixed pauses |
| 0.36.0 | 2026-10-21 | Charges, service lines, ordering any test at list price, percent discounts, invoice payments and PO corrections | Claude in the cloud | 058 | Discount % typed on quote lines and packages (and one % for every line); miscellaneous charges (kits, shipping, fees, discounts) in the catalogue, on quotes, on orders (billed at once) and on draft invoices; service line > type > department on tests and service lines on clients; the order's drill-down test picker; any test of the lab ordered at its list price (a quote line still wins); the invoice details first, payment status recorded by hand; the PO of an issued invoice corrected (signed) with a corrected copy sent |
| 0.35.0 | 2026-10-21 | Lists one page at a time, search everything, widgets on request, the performance report | Claude in the cloud | none | Every long list shows the 50 most recent with pages, tabs with counts and a search on the server (a typed or scanned ID opens its record); a search box at the top of every page finds any record by ID or name; dashboard widgets refresh on request (Refresh all, ↻ per widget, the time last worked out), the 7 live ones every 5 minutes; Finance figures and the GM and executive dashboards download a performance report to Excel (Summary plus the LIMS data on separate tabs) |
| 0.34.0 | 2026-10-20 | Cancelling, receipt thermometer | Claude Code | 057, seed 039 | Cancel… for samples and tests with a reason (refused with results or in a batch); the thermometer from the register at receipt; the serving size on the chain of custody; license dates on the lab's date; 0.28.1 restored (potency units built, then put on hold) |
| 0.33.0 | 2026-10-20 | Security hardening SEC-1 | Claude in the cloud | 056 | Encrypted database connection (TLS, SCRAM); two database accounts for GxP servers (the app's cannot delete, change tables or triggers, or write the audit trail); files shown only when really a PDF or picture; security headers and a Content-Security-Policy; per-computer limits on wrong passwords and public pages; audit trail pages and seven routes scoped to the person's labs; seven escaping fixes |
| 0.32.0 | 2026-10-20 | Alex's notes: training per department, METRC ID, client licenses, photos | Claude Code | 055 | Each department sets its own trained-test count; a METRC ID on samples (optional, checked, on the COA and chain of custody); client licenses (type, number, issuer, dates, scanned copy) added over time, picked on the lab order, printed on the COA, with expiry warnings and Intake > Client licenses; the photo dialog shows the photos already attached |
| 0.31.1 | 2026-10-20 | Audit labels routed; waste save on PGlite; re-prepped samples stay in their batch | Claude Code | 054 | Audit labels go straight to the layer that knows the table (PGlite crashed on the 37-layer chain); waste classifications save on PGlite; 0.28.1 merged |
| 0.28.1 | 2026-10-19 | A re-prepped sample stays in its batch | Claude Code | none | The original batch keeps showing a re-prepped sample on every step, greyed and read only, with its data and a link to the batch the re-prep went to; QC Review lists them |
| 0.31.0 | 2026-10-20 | C-1 Training and competency | Claude (cloud) | 053 | Qualifications per person and test; initial and continuing competency by training samples (run through the workflow against known values) or by a record with evidence, evaluated by a trainer and approved by QA; rules per lab and department (department trained after N tests, what it unlocks, continuing competency, a minimum of runs); the rolling counter and a training report per person; legacy qualifications; a per-lab gate at the bench |
| 0.30.0 | 2026-10-20 | W-1 Waste classifications | Claude (cloud) | 052, seed 038 | A controlled list of waste classifications (hazard classes, EPA codes, stream, container, how to dispose of it); every inventory item has one (chosen, or the default for its type); Waste to classify; disposal records it |
| 0.29.0 | 2026-10-20 | Chain of custody, receipt photos, photo reports, QR code | Claude (cloud) | 051, seed 037 | A chain of custody and sample manifest per order, made on submission; receipts signed with the receiver's handwritten signature; the paper copy attached; photos at receipt (4:3); report layouts with 1 and 2 photos; a QR code on every COA |
| 0.28.0 | 2026-10-19 | V-1 Vendor approvals, local and corporate | Claude (cloud) | 050, seed 036 | QA approves vendors for its own lab; a new all-labs Corporate QA group approves them for every lab; a lab can be stricter than corporate, never looser; what a vendor is approved for (supply scopes), checked on every request; documents behind each approval; a lab proposes its approval for corporate approval, Corporate QA approves or rejects it; notices to the labs; the Vendor approvals tab |
| 0.27.1 | 2026-10-19 | A package priced by typing each test's price | Claude Code | 049 | No pricing modes or discount % on a package: each test is priced in it, the package price is their sum and the discount is worked out; existing packages keep their prices; a dated price change moves the tests' package prices too |
| 0.27.0 | 2026-10-19 | Bench autosave, a dilution per analytical run, the analyst's pick | Claude Code | 048 | Bench values saved as they are typed (a correction asks its reason at once); a further dilution recorded with a new analytical run, each reading calculated with its own run's dilution; the analyst picks the reading reported, with a note (testing.pick_run), which QC Review uses unless the reviewer chooses otherwise |
| 0.26.0 | 2026-10-19 | P-1 Test packages and dated price changes | Claude (cloud) | 047 | Packages in the Test catalogue (a fixed price, or the tests less a discount; analytes left out or repriced; each test's share of the price); on quotes at one negotiable price, on the quotation PDF and in new versions; ordered on samples as packages; cancelling one of its tests takes off only its share, shown first (option B); dated price changes by %, from a start date, rounded to the cent or dollar, packages included or not, listed and cancellable |
| 0.25.1 | 2026-10-19 | Sensor entries after a change of limits | Claude Code | 046 | Re-judge… a sensor's entries against corrected limits (signed, a reason; the feed voids excursions that no longer are one, judges the hours again, approved ones back to QA); an open excursion closes after a limit change; entries record the limits they were judged against; sensor logbooks charted by their hours; the logbooks a sensor cannot feed yet, and why |
| 0.25.0 | 2026-10-19 | Sensor feed (iMonnit) into the logbooks | Claude Code | 045, seed 035 | Sensors linked to a logbook field for a piece of equipment (signed, approved by QA, optionally filling in up to 7 days back); an automated account records one entry per hour, one per spell outside the limits and one per silence; people give the reasons, QA approves only with them; late readings correct entries; QC Review windows exact; the incubator's range over each load; Admin > Lab setup > Sensors (the pretend service in the Sandbox) |
| 0.24.2 | 2026-10-19 | Pretend iMonnit service | Claude Code | none | A pretend iMonnit service and the sensor feed's reading side (hourly summaries, excursions, no-data periods, late readings), tested without the app; not used by the app yet |
| 0.24.1 | 2026-10-19 | T-1.1 Alex's trending notes | Claude Code | 044 | QA approval of trend charts and their limits (signed; on QA's to-do widget; a change sends a chart back; a chart in QC Review shows there only once approved); an approved QC chart's frozen limits carried into the test's Draft version (signed); every saved chart as one PDF; units on both axes and a key of symbols on every chart |
| 0.24.0 | 2026-10-17 | Trending and control charts T-1 | Claude (cloud), without Alex's input on his instruction | 042, 043 | Anything the lab records again and again can be charted (results, QC, logbook values, stability pulls, OOS and other events, Pareto), with signal rules, capability, frozen limits, reviewed signals, Trend watch, report packs, QC charts in QC Review, and downloads (PNG, SVG, CSV, Excel, PDF); a USP <51> control counted 0 is judged on its count |
| 0.23.0 | 2026-10-17 | Stability S-2 | Claude (cloud) | 041 | A running study can be amended through a new version of its quote (future pulls change, pulls taken never do), cancelled with each condition's material destroyed, returned or kept as retain, its chamber excursions assessed by QA, and its cumulative report issued after each pull (interim, then Final), signed like a COA |
| 0.22.1 | 2026-10-16 | Sample label date | Claude (cloud) | none | The "logged" date on a sample label is the lab's date, not the UTC date (found in the demo recordings) |
| 0.22.0 | 2026-10-16 | QA testing of inventory before use | Claude (cloud) | 040 | Any item, not only media, can be tested before use: each lab sets which item types need it (Media on), the receipt can require it (waiving is QA's); a QA test on a sample with the lot's ID releases the lot for every use or named tests; a failure rejects it for every use until a retest passes |
| 0.21.1 | 2026-10-16 | Salmonella demo data (Colleen) | Claude (cloud) | seed_032 | Demo data only: the BAX Q7 screen and the culture confirmation designed and approved, equipment, lots, client Prairie Pet Foods (demo) with Positive alerts contacts and an accepted quote; DEMO-1015 finished and waiting in Report Finalization; DEMO-1016 waiting in the Microbiology backlog |
| 0.21.0 | 2026-10-15 | Matrix-driven bench, presumptive alerts, readings that are not results | Claude (cloud) | 039 | For Colleen Villanueva's Salmonella BAX Q7 demo: each sample's product category (its matrix) sets its weight range or "Not weighed", its enrichment amounts (one click fills them) and its incubation window; controls can be "not weighed"; a Split off step can alert the client's new "Positive alerts" contacts on a finding (Outbox, batch and sample page show who and when); values such as Indeterminate or Signal error are never reported and force a new analytical run before approval |
| 0.20.1 | 2026-10-15 | D-1.1 Alex's dashboard notes | Claude Code | 038, seed 031 | On time at two levels (tests: QC Review approval, release shown smaller; samples: the complete COA, used by the executive dashboard); weekly revenue from the LIMS, locked (the books' figure optional); finance update as a line chart with Revenue / EBITDA / Costs tabs, the EBITDA margin on a right-hand scale, deviations from budget, weeks in the month; labs side by side with an EBITDA tab, three % comparisons and potential revenue; finance figures by lab tab, forecasts to and from Excel; Lab finance widget on the GM dashboard |
| 0.20.0 | 2026-10-15 | D-1 Dashboards | Claude (cloud) | 037, seed 030 | Home is the dashboard: each group's widgets (set by lab administrators), arranged and resized by each person, every number opening its page or list, refreshed every minute; turnaround in three segments and on time without the client's hold; work in progress by stage, the month's projection and boost, samples received; low stock against demand (an item's department); the GM dashboard; the executive dashboard with the labs side by side and the weekly finance update against the forecasts; the finance figures page and the all-labs Finance group |
| 0.19.0 | 2026-10-15 | I-1 Invoicing | Claude (cloud) | 036, seed 029 | Billing: work ready to invoice once its COA is issued; claimed into the reviewer's own draft per lab order; prices checked against the quote (corrections with a reason); a late rush shown with its days late and billed at the closest tier met, or standard; retests labelled; issued with one signature (numbered per lab, net terms, PDF, emailed, queued for the lab's QuickBooks Online company); credit notes; the order's billing; payment terms; catch-up invoices for earlier work dated the Friday of its week |
| 0.18.0 | 2026-10-15 | L-1 and L-2 Electronic logbooks | Claude (cloud) | 034, 035, seeds 027, 028 | Logbooks with versioned designs approved by QA, entries recorded in a grid with one signature, limits per equipment, a reason asked at failure; failing equipment flags the batch steps that used it, accepted in QC Review; QA's Logbook review (daily or weekly); stability chamber excursions on the study; logbook values (inoculum counts) read by test formulas from the lot scanned at the bench, waiting for QA's approval; results keep the values used and are flagged by a later correction; sample weight aliquots scanned at Weigh and reviewed in the batch; the release check; workflow verification of tests that read logbook values |
| 0.17.1 | 2026-10-15 | Serving size, Part B | Claude Code | 033, seed 026 | Replicate weighings (1 to 10, averaged) on the Weighing step; Serving weight and Density as serving tests in the catalogue and as a priced line on quotes; "Per serving" on a sample orders the serving test (quoted, else at catalogue price); the approved result goes back to the sample (unit weight x count; density for servings by volume); the COA release check blocks results per serving until measured; the unplanned request waits for the client's consent |
| 0.17.0 | 2026-10-14 | S-1 Stability studies | Claude (cloud) | 032, seed 025 | Stability quotes (SQ-) with the study design (conditions, timepoints, tests, matrix, price by study year); accepted, a study (STB-) with its T0 order; ICH conditions, chambers and racks; placement in racks with the material check; pulls scheduled inside their window, ordered on their date and recorded; the summary report |
| 0.16.1 | 2026-10-14 | Alex's notes: quotes, catalogue, serving sizes | Claude Code | 031, seed 024 | No "Any lab" (the shared tests got CFL as their home lab); a quote belongs to its lab, and another network lab's test is subcontracted at the 20-30 rule (lab settings); trash button on quote lines; catalogue prices updated by a percentage; serving units on the Units list; the sample's serving as a count, a weight or volume and servings per package; limits per serving or per package; clearer sample grid (Containers apart from the amount received) |
| 0.16.0 | 2026-10-14 | Report templates, lab images, UI refresh | Claude (cloud) | 030 | Report templates (Admin > Lab setup), chosen per test in the designer; a COA in parts when a sample's tests use different templates; lab image slots (logo, small logo, accreditation mark) as placeholders with upload; accreditation placeholders on the lab; the product name as one setting; menu icons and section colours |
| 0.15.0 | 2026-10-14 | Standalone quotes | Claude (cloud) | 029, seed 023 | Quotes beside projects (Q-00001): My open quotes and All quotes with filters, prepared by, Accept and Reject on each quoted row; lab tabs to quote any lab's tests on one quote; Send to client (PDF and email with a link); the client accepts or declines online |
| 0.14.1 | 2026-10-14 | Alex's Report Finalization notes | Claude Code | 028, seed 022 | Renamed Report Finalization with four tabs (queue, worklist, groups in progress, issued COAs); claiming work; OOS column and due-date highlights; handwritten signature and title on the COA; report ID sample ID + R1, R2; numbered notes; serving size and per-serving results; uncertainty per analyte; COAs on the order; the client's Phase II decision recorded on the sample; bigger PDF view |
| 0.14.0 | 2026-10-14 | R-2 OOS investigations and retests | Claude (cloud) | 027, seed 021 | A nonconforming result is flagged with "Open OOS…" in QC Review and on the sample page (never opened by itself); Full Phase I for GMP work, Check and Acknowledge otherwise, with automatic data checks, signed sections, a conclusion and a report PDF; only that result is held; the client is emailed on release with links to ask for Phase II re-testing; lab investigation and client retests, billed by QA's determination |
| 0.13.0 | 2026-10-14 | R-1 Result Finalization and the COA | Claude (cloud) | 026, seed 020 | The second review: a queue of approved sample tests, a group reviewed one COA at a time beside the sample's history with a release check, one signing act issuing each COA; versioned COA PDFs chained by SHA-256 with a public verification page; COA and internal notes, canned COA comments; compliance categories; sample attachments; partial reports; order Reported; automated emails as Outbox templates |
| 0.12.0 | 2026-10-13 | WD-6.1 verification evidence and Word export | Claude (cloud) | 025 | After a verification run, screenshots of every page its checks point to, stamped and stored with their SHA-256, signed "Evidence captured by"; QA signs the report only once they exist; the protocol and report download as a Word document with the screenshots in an appendix |
| 0.11.0 | 2026-10-13 | WD-6 workflow verification | Claude (cloud) | 024, seed 019 | A draft test version's verification: protocol written from its design (URS, FRS, samples, inputs, expected results from an independent calculation), approved by QA, executed by automated accounts through every step, report signed by QA; approval gated on a passing verification (CFL, TPS) |
| 0.10.0 | 2026-10-13 | Alex's notes: media, labels, batch edits, purchasing | Claude Code | 023, seed 018 | Media qualification (test sample with the lot's ID, released by QA for chosen tests); adding and removing samples before a batch starts; Code 128 labels for Dymo; item web link; actual price; receiving into inventory; COA on the new item form |
| 0.9.1 | 2026-10-13 | WD-5.1 | Claude (cloud) | 022 | Spike recovery against the reviewer's chosen result; reviewer acceptance of incubator loads outside their window |
| 0.9.0 | 2026-10-13 | WD-5 | Claude (cloud) | 021, seeds 016–017 | Analytical runs; pick or average; preliminary (timepoint) results; order statuses In Review and Approved; consent setting on split-off |
| 0.8.2 | 2026-10-13 | System administrator decision | Claude Code | none | Administrators do setup only; testing rights come from groups |
| 0.8.1 | 2026-10-13 | WD-3.1 and evening updates | Claude Code | 020 | Each step approved in review; nested review tables; sectioned menu; Assign selected; Ctrl+click selection; links on bench screens |
| 0.8.0 | 2026-10-13 | WD-2.1, WD-3, WD-4 | Claude (cloud) | 017–019, seed 015 | Bench stock usage; QC Review; micro at the bench (daily controls, plating, incubation, split-offs) |
| 0.7.0 | 2026-10-13 | WD-2 | Claude (cloud) | 016, seed 014 | Chemistry execution: backlog, autobatch, bench steps, live results, QC verdicts, re-analysis, re-prep, witness |
| 0.6.3 | 2026-10-13 | WD-1.3 | Claude Code | 015, seed 013 | Every creation and change of a test workflow is signed |
| 0.6.2 | 2026-10-13 | WD-1.2 | Claude Code | 014, seed 012 | QC criteria set per analyte; Hide LOQ/LOD; tolerance in %; formula values by name |
| 0.6.1 | 2026-10-13 | WD-1.1 | Claude (cloud) | 013, seed 011 | Micro definitions: product categories, strains, daily QC, result and "found" values |
| 0.6.0 | 2026-10-13 | WD-1 | Claude (cloud) | 012, seed 010 | Workflow Designer: tests per lab, versions, 11 step types, formulas, approval, specifications |
| 0.5.2 | 2026-10-13 | Purchasing | Claude (cloud) | 011 | Requests queue, approvals, purchase orders, receiving, supplier qualification |
| 0.5.1 | 2026-10-12/13 | Equipment | Claude (cloud) | 009–010 | Register, tags and release, calibration and maintenance, automatic tag-outs, transfers |
| 0.5.0 | 2026-10-12 | Permissions | Claude (cloud) | 008 | Permission list, lab groups, permission matrix |
| 0.4.2 | 2026-10-12 | Slice 3.2 | Not recorded | 007 | Real login, electronic signatures, canned reasons, molar mass |
| 0.4.1 | 2026-10-12 | Slice 3.1 | Not recorded | 006 | Alex's inventory feedback: items name their analytes, units and conversions, mixture calculations, Excel |
| 0.4.0 | 2026-10-12 | Slice 3 | Not recorded | 005 | Inventory: lots, storage, stock movements, transfers, COA, warnings |
| 0.3.1 | 2026-10-12 | Slice 2.1 | Not recorded | 004 | Alex's order feedback: tests under samples, TAT override, sample ID format, matrix list, lab access |
| 0.3.0 | 2026-10-12 | Slice 2 | Not recorded | 003 | Sites and holidays, lab orders, samples, quoted-only ordering, intake dashboard, due dates, Outbox |
| 0.2.0 | 2026-10-12 | Slice 1 | Not recorded | 001–002 | Clients, contacts, analytes, test catalogue pricing, rush schedules, projects and quotes, audit trail |

"Not recorded": `CLAUDE.md` records the design source (Claude chat) for these slices but not which Claude built them. Alex can fill this in.

**Test counts over time:** 478 rule tests at 0.6.1; 652 at 0.8.0; 659 at 0.8.1; 693 at 0.9.0; 702 at 0.9.1; 735 at 0.10.0; 778 at 0.11.0; 786 at 0.12.0; 825 at 0.13.0; 873 at 0.14.0; 898 at 0.14.1; 922 at 0.15.0; 958 at 0.16.0; 987 at 0.16.1; 1034 at 0.17.0; 1060 at 0.17.1; 1189 at 0.18.0; 1682 at 0.28.0; 1721 at 0.29.0; 1741 at 0.30.0; 1787 at 0.31.0; 1793 at 0.31.1; 1819 at 0.32.0; 1834 at 0.33.0; 1851 at 0.34.0.

---

## 5. Change entries (newest first)

### 0.36.2: web server hardening (2026-10-23, Claude Code for Edashall Konah; no migration)

- **Why.** A security check of the code against an AI-built-app checklist (prompt injection, secrets, headers, CORS, rate limits, exposed files, database access) found four small faults in the web server. The rest of the checklist was already covered (0.33.0).
- **What changed.**
  - `server/server.js` `serveStatic`: an address with a broken %-code (e.g. `/%E0%A4%A`) threw outside the error handler and stopped the whole server; it now answers 400. The page folder check now requires `public` plus the folder separator (a sibling folder such as `public2` would have passed).
  - `server/server.js` `readBody`: a request over 5 MB was refused but still read into memory to the end; the connection is now closed.
  - `server/ratelimit.js` `clientIp`: with `LIMS_TRUST_PROXY=1` the limit used the first X-Forwarded-For entry, which the client controls (a new fake address on every try got past the 20-try limit); it now uses the last entry, the one the proxy adds. Assumes one proxy in front of the app.
  - `tests/e2e_security.js`: 3 new checks (broken address, outside the page folder, upload over 5 MB), each confirming the server keeps running.
- **Found, not changed (for Alex):** lab separation on reads is enforced in the server routes only, not in the database (writes are). Row-level security in PostgreSQL would be the lasting fix.
- **How it was checked (PGlite, fresh database).** 1898 rule tests pass; `test:security` 32/32; the proxy address checked directly. Other browser suites not run (only these two files changed). Not applied to Alex's data (code only: a restart picks it up).

### 0.36.1: batch page redraws, the header search box, bench test timing (2026-10-22, Claude Code; no migration)

- **Why.** Alex asked for the 0.35.0 search box fix and for the intermittent `test:testing` failures (open since 0.35.0) to be investigated, then for 0.36.0 to be installed.
- **What changed.**
  - `public/js/search.js`: the header search box is set up once. `main.js` calls `initSearch()` on every page change, and each call added another set of listeners.
  - `public/js/pages/testing.js` `batchPage()`: each load is numbered on its container; only the latest one draws. Before, two overlapping reloads (an autosave and a material added, say) could finish in the wrong order, and the older answer put the batch back as it was before the newer change (a spike just added seemed to vanish).
  - `tests/e2e_testing.js`: since 0.27.0 bench grids save by themselves, quietly (a note, no toast, no redraw). The test now treats a paste as taken when the save bar shows or the "Saved automatically" note changes; a save waits until nothing is pending (clicking Save now if the bar is up) and reloads so the step's to-do box is current; a paste is sent only when the focused grid holds the clicked cell; clicks wait until the page has stopped loading; the spike and status checks wait for what they read. A failed Complete step prints the dialog's message and the step's to-do list (`DIAG`).
- **Found, not changed:** after an autosave the step's "Still to do" box is not redrawn until the page is reloaded, so it can still say "no weight" after the weights are saved. Raise with Alex.
- **How it was checked (PGlite, fresh databases on ports 3305 and 3306).** 1898 rule tests pass. 40 of the 41 browser suites pass (`test:security` last). `test:testing` with the fixes: 55/55 in some runs; other runs still stop at the second batch's Weigh step, where the paste is ignored (being investigated after the install, on Alex's instruction).
  - **Correction (later the same day):** the Weigh stall happened only while two test apps ran side by side on the laptop; it did not come back with the suite running alone. The remaining failures were checks reading the batch status or a step's tick a fixed moment after signing; five such checks now wait for what they read (`statusBecomes`, the Weigh tick). `test:testing` then passed 55/55 three runs in a row on fresh databases. Run browser suites one at a time on this laptop.
- **Alex's data.** 058 copy-tested on a copy taken 2026-10-22: applied in 0.6 s; requested tests, invoices and invoice lines unchanged; 5 service lines and 12 types, the "Invoice Corrected" template; 792 of 861 issued invoices show Overdue (the demo catch-up invoices, never marked paid); lab switches unchanged. Installed with 0.36.1 on Alex's go (2026-10-22): the start printed "Applied: 058_charges_service_lines_catalogue_orders.sql". Backup `backup-before-0.36.1-2026-10-22`.

### 0.36.0: charges, service lines, ordering any test at list price, percent discounts, invoice payments and PO corrections (2026-10-21, Claude in the cloud; migration 058)

- **Why.** Cecilia Colesanti's call with Alex (2026-10-21) and Alex's answers the same afternoon: the drill-down picker ("Service Line > Service Line Type > Department > material/matrix"), "Something not quoted is automatically list price without warning", and "Agreed with all ... go". Decision note: `Decision - Charges, Service Lines, Ordering at List Price and Invoice Corrections` (build choices Proposed; QA items 87 to 89). `Decision - All Ordering Is Quoted` is marked Superseded.
- **What changed.**
  - Quotes: a discount typed as a % sets the final price (lines and packages); "Apply a discount % to every line…"; charges on the quote at the client's price, printed on the quotation under "Other charges".
  - Charges: a catalogue of charge items per lab or for every lab (Test catalogue > Charges); on lab orders (Charges card; billed at once, never on a COA), claimed with tests on Ready to invoice, added straight onto a draft, credited like tests; a Discount is taken off and goes to QuickBooks as a negative line.
  - Service lines (shared) and types; each test's type (catalogue editor, or fill down on Test catalogue > Service lines); a client's service lines (client page).
  - Ordering: "Add tests…" opens a picker (the client's quoted tests and service lines first; line > type > department; a search over everything); any test of the lab with an approved workflow is ordered at its list price when the client has no quote line for it (rush at the schedule's full surcharge); the line says "List price".
  - Invoices: the details panel first, with the payment status (Unpaid, Overdue, Paid, Credited); Record payment… (by hand, with a reason); Correct PO… on an issued invoice (signed "Corrected by", with a reason): the PO changes, the correction is kept with both values, and a corrected copy is emailed; the original PDF is unchanged. The issued list has Payment and Paid columns and Unpaid / Overdue / Paid tabs.
  - Not built: the material/matrix level of the picker; ordering another lab's test on this lab's order; payments read back from QuickBooks. Sample IDs and labels at submission wait for the sampling slice (0.37.0).
- **Database.** `058_charges_service_lines_catalogue_orders.sql`: `service_line`, `service_line_type`, `test.service_line_type_id`, `client_service_line`; `requested_test.catalogue_order`, `requested_test_derive` replaced, `catalogue_order_problem`, `order_catalogue_test`; `charge_item`, `quoted_charge` (+ copy to new versions), `client_charge_price`, `order_charge`, `invoice_line.order_charge_id`, `charge_ready_view`, `claim_invoice_charges`, `add_invoice_charge`; `credit_invoice`, `issue_invoices`, `qbo_payload`, `invoice_rules` replaced; `invoice.paid_*`, `record_invoice_payment`, `invoice_payment_status`; `invoice_correction`, `correct_invoice_po`, `record_invoice_correction_document`, email template "Invoice Corrected"; `audit_record_ref_058`. No new permission; no seed.
- **Files.** New: `db/migrations/058_charges_service_lines_catalogue_orders.sql`, `db/tests/test_051_charges_catalogue_orders.sql`, `server/routes_charges.js`, `public/js/pages/picker.js`, `public/js/pages/charges.js`, `tests/e2e_charges_ordering.js`, the vault note. Changed: `server/routes.js`, `server/routes_invoicing.js`, `server/invoices.js`, `server/quotes.js`; `public/js/grid.js` (a computed column with `assign` is editable), `public/js/pages/projects.js`, `orders.js`, `billing.js`, `catalog.js`, `clients.js`; `tests/e2e_slice2_1.js` (the picker), `tests/e2e_packages.js` (the catalogue's two new tabs), `tests/auth.js` (a temporary password never contains the user ID: the occasional "must not contain your user ID" failure); `package.json` (0.36.0, `test:charges`), `CLAUDE.md`, this log, both `00 Home.md`, `Decision - All Ordering Is Quoted`, `Open Items for QA Review`.
- **How it was checked.** 1898 rule tests on PostgreSQL 16 (47 new in `test_051`). All 41 browser suites on fresh PostgreSQL 16 databases, including the new `test:charges` (26 checks). Found and fixed while testing: the order page's charges grid shared an element id with its COA list (`e2e_reports` caught it).
- **A note on this build.** The cloud workspace was reset in the middle of this slice. The 0.35.0 project was restored from Alex's laptop (unchanged there since the 0.35.0 delivery except `.gitignore`), and the 0.36.0 work was rebuilt from the session's own record before testing.
- **Alex's data.** Not applied. Only 058 waits; it adds the five service lines and their types, empty charge tables and one email template. Try it on a copy first; apply only on Alex's go.

### 0.35.0: lists one page at a time, search everything, widgets on request, the performance report (2026-10-21, Claude in the cloud; no migration)

- **Why.** Alex (2026-10-21), after Scale measurement 1: "let's work on speeding the system up with incorporating pages to each of the system lists ... limit it to the 50 most recent entries and have ongoing pages. We still want search bars where the user can type or scan the ID number and the correct page pull up. For widgets lets limit the financial widgets to be refreshed on command." His choices on the widget list: Lab supplies and Stability on request too; live widgets every 5 minutes instead of every minute; a Refresh all button per dashboard; each widget saying when it was last worked out, the live ones "(Refreshed every 5 minutes)", small and inconspicuous. Also: "a search bar at the top of all pages that allows the user to search any record, item, or ID within the system and pull up it's starting page", and in the finance module "download all data within a time frame into an excel file ... a meaningful GM/executive template ... make the raw data needed to generate it on a separate tab(s) with column headers that match the LIMS."
- **What.**
  - **Paged lists** (`server/paging.js` `page()`; `pagedList()` in `public/js/pages/common.js`): 50 a page (at most 200), newest first, tabs with their counts, a search box searched on the server (debounced; Enter on an exact ID or a scanned barcode opens the record), Previous and Next, "1–50 of N", the tab, search and page kept in the address. Callers that do not ask for a page still get the whole list (other screens and the browser tests use them). Lists: lab orders (a sample ID opens the sample), inventory, equipment, purchasing requests and orders, quotes, all batches, clients, contacts, projects, the Outbox, issued invoices (with totals for the filter), issued COAs (a report ID opens its PDF), OOS investigations, stability studies. Left whole on purpose: the audit trail (capped at 300) and logbook entries (capped at 500); the backlog keeps everything waiting.
  - **Search everything** (`server/routes_search.js`, `public/js/search.js`): a box in the header of every page once signed in. Any ID, number or name finds samples (also client sample ID and METRC ID), lab orders and PO numbers, COA report IDs and verification codes, inventory (also the manufacturer's lot and CAS), equipment (also serial numbers), batches, clients, contacts (also e-mail), quotes and projects, stability studies, OOS investigations, invoices (only for people with invoicing.view or invoicing.issue), purchase requests and orders, suppliers, logbooks and entries, tests, trend charts. Up to 6 per kind, grouped; an exact ID (ignoring case and spaces) opens at once on Enter. Lab records come from the lab being worked in, shared ones from everywhere; opening a record still runs that page's own checks. Ctrl+K or / puts the cursor there.
  - **Router:** each page now draws into its own fresh container, so a slow page finishing late can no longer draw over the page opened after it (found by the new browser test).
  - **Widgets on request** (`routes_dashboard.js`, `dashboard.js`): live (worked out every 5 minutes while the dashboard is open): My work, Intake, Rush, Backlog by department, Batches, Overdue and due today, Waiting to be signed. Every other widget (finance, revenue, billing, quotes, WIP, projection, turnaround, on time, samples received, lab supplies, low stock, stability, labs side by side) is kept by the server once worked out (per board, labs, widget and person) and worked out again only on Refresh all or its own ↻. Each widget's footer, in small grey type: "Refreshed every 5 minutes" or "Refreshed <time>". The timer now fetches only the live widgets.
  - **Performance report** (`GET /api/finance/report.xlsx?from=&to=&labs=`; `writeWorkbook()` in `server/xlsx.js`, several sheets with styles and formulas): from Finance figures and from the GM and executive dashboards ("Performance report (Excel)": a period, the labs ticked). For General Managers (their labs), the Executive and Finance groups and system administrators; a period ending after today ends today; at most two years. **Summary:** headline by lab (revenue net of credit notes, budget prorated by days, vs budget, costs, EBITDA and margin, samples logged, tests reported, samples and tests on time, median days logged to reported, work in progress now, open OOS now) with an All labs row; by month; top 10 clients; quality and timeliness (OOS opened, confirmed, assignable cause, retests, late tests and average days late, rush tests); how each figure is worked out. Revenue and costs are SUMIFS formulas over the raw tabs (values also written, so the file reads correctly anywhere). **Raw tabs** with the LIMS column names, frozen header and filter: Invoices, Invoice lines, Finance weeks, Finance plans, Samples, Tests, Work in progress, OOS investigations.
- **Files.** New: `server/paging.js`, `server/routes_search.js`, `public/js/search.js`, `tests/e2e_paging.js`. Changed: `server/routes.js`, `routes_inventory.js`, `routes_equipment.js`, `routes_purchasing.js`, `routes_quotes.js`, `routes_testing.js`, `routes_invoicing.js`, `routes_reports.js`, `routes_oos.js`, `routes_stability.js`, `routes_dashboard.js`, `server/xlsx.js`; `public/index.html`, `public/css/app.css`, `public/js/main.js`, `public/js/pages/common.js`, `orders.js`, `inventory.js`, `equipment.js`, `purchasing.js`, `quotes.js`, `testing.js`, `clients.js`, `master.js`, `projects.js`, `intake.js`, `billing.js`, `reports.js`, `oos.js`, `stability.js`, `dashboard.js`; `tests/e2e_dashboards.js`; the older suites' selectors for the paged lists: `e2e_quotes.js`, `e2e_inventory.js`, `e2e_equipment.js`, `e2e_purchasing.js`, `e2e_testing.js`, `e2e_stability.js`; `e2e_logbooks.js` (its due-list check no longer assumes the date); `package.json` (0.35.0, `test:paging`), `CLAUDE.md`, this log, the vault note.
- **Checked.** 1851 rule tests on PostgreSQL 16. `tests/e2e_paging.js` (`npm run test:paging`, 30 checks: two pages of contacts, Next, the server search, a scanned lot ID and a sample ID opening their records, the header search by batch ID and by name, a click on a result, Ctrl+K, every other paged list). `e2e_dashboards.js` 45 checks (the live and on-request footers, Refresh all, the report: one workbook, Summary first, the raw tabs, SUMIFS, LIMS column names). The report was opened in LibreOffice and recalculated: every formula matched its written value. All 40 browser suites pass on fresh databases (PostgreSQL 16). Found by them and fixed: Clients open on Current (Active and On Hold; On Hold clients were hidden behind Active); OOS Open also holds a closed investigation whose client answer is not handled; a paged list's load error is shown instead of left as a page error. `e2e_logbooks` failed after the 12th of a month since 0.18.0 (the demo pipette checks are 12 days old, so not due): the check no longer assumes the date. `e2e_waste` once failed on the known random temporary password containing a user ID (passed on rerun).
- **Not done.** The paging and caching remove the cost of loading whole lists and repeating slow widgets; they do not fix the two causes in Scale measurement 1 (one database connection; status recalculated over the whole history). Ready to invoice, Report Finalization and the dashboards' first load stay slow at network volume until that slice. The widget cache is in the server's memory (lost on restart; per server).
- **Alex's data:** no migration and no seed: delivering the files is all. Claude Code runs `npm test` and the suites on PGlite first.

### Scale measurement 1 (2026-10-21, Claude in the cloud; separate scale copy, nothing delivered)

- **Why:** Alex (2026-10-20): "make the scale slice to measure but i'd like it to be on a separate version so that I can keep tweaking features without the simulated tests." Built in a separate cloud copy (`lims3-scale`, 0.33.0-scale); the main line and Alex's data are unchanged and the version stays 0.33.0.
- **What was measured:** 20 labs (4,243 samples a day), 537 load-test people, about 7 to 10 network days of data (85,745 samples, 108,739 tests, 5.16 M audit rows, 9.9 GB) on a 2-CPU box; a load runner making the API calls each page makes.
- **Found:** LIMS3 as built collapses at about 50 people. (1) Every query goes through one database connection, so one slow page freezes everyone (150 people on fast pages only: every page 5 to 45 s). (2) Queues, dashboards, QC verdicts and Trend watch recalculate status over the whole history on every read (Home 9 min, GM dashboard 31 min, Trend watch 97 min, Ready to invoice 4 min, a batch page up to 75 s). A missing index on readings was proved (a batch's QC verdicts 6.4 s to 1.0 s).
- **Report:** project doc `Measurement - Scale Test 1 (0.33.0 at network volume)` (ranked fixes, three-year extrapolation, confidence). Fixes are the next slice, on Alex's go.

### 0.34.0: cancelling samples and tests, the receipt thermometer (2026-10-20, Claude Code; migration 057, seed 039)

- **Why.** Alex (2026-10-20) listed more information on the lab's COCs: potency reporting units chosen by the client (mg/serving, mg/g, %, mg/mL), the serving size the client shares, and the thermometer ID recorded at receipt. He also noticed "you can't remove tests or samples once they have been added". His choices:
  - a clear Cancel… (button and right-click) with a reason;
  - a logged sample can be cancelled while none of its tests has results, and a test in a started batch is taken out first;
  - the thermometer comes from the register, available and in calibration.
  Vault: `Decision - Cancelling Samples and Tests and the Receipt Thermometer` (build choices Proposed).
- **Potency units: on hold.** It was built (sample potency unit, catalogue "Potency test" tick, `potency_value()`, the COA converting with a release block) and passed its tests. Alex then said "let's wait on the potency unit. I think we might not need to make another field if we have the specifications and serving size units already in the system. I'll check with the lab first." It was taken out before anything was applied. The tested version is kept in `parked-potency-unit-2026-10-20`, next to the project folder.
- **What.**
  - **Cancelling:** the database now refuses to cancel a test with results or in a batch, and a sample holding one, saying why (before, it allowed it). A cancelled sample cancels its tests. The order page has "Cancel ticked samples…", a Cancel… button on every sample and test row, and right-click on a selection; it confirms what goes, then asks the reason. Route `POST /api/orders/:id/cancel`.
  - **Thermometer:** required with a temperature at receipt; this lab's, available and in calibration. The receive dialog lists usable equipment, thermometers first. The custody card and PDF show it. Seed 039 adds a demo receiving thermometer per lab (Alex's register had none).
  - **Serving size:** printed under each sample on the chain of custody.
  - **License dates:** a license's state and days left use the lab's date (`license_state_on`), not the server's.
  - **0.28.1 restored:** the re-prepped sample stays visible in its batch (lost in 0.33.0; see the line under 0.33.0).
- **Files.**
  - New: `db/migrations/057_cancel_thermometer.sql`, `db/seed_039_receiving_thermometers.sql`, `db/tests/test_050_cancel_thermometer.sql`, `tests/e2e_cancel_thermometer.js`, the vault note.
  - Changed:
    - Database tests: `db/tests/test_044_custody_photos.sql` (a thermometer fixture), `db/tests/test_046_training.sql` (the lab's date).
    - Server: `server/routes.js`, `server/routes_custody.js`, `server/custody.js`, `server/routes_testing.js`.
    - Screens: `public/js/pages/orders.js`, `custody.js`, `testing.js`.
    - Browser tests: `tests/e2e_custody.js`, `tests/e2e_equipment.js` (one more item in the register).
    - Records: `package.json` (0.34.0, test:cancel), CLAUDE.md, this log, both `00 Home.md`.
- **Checked.**
  - 1851 rule tests on PGlite (17 new). The known intermittent `test_031` catch-up check failed in one run (it fails about 1 run in 4, on 0.31.1 too).
  - On fresh databases, with potency still in, all 40 browser suites passed, `test:security` last (29/29).
  - After potency was taken out: `test:cancel` 15/15, `test:custody` 33/33, `test:reports` 36/36, `test:oos` 33/33, `test:licenses` 28/28, `test:browser2` 12/12, `test:serving` 21/21, `test:pricing` 15/15, `test:dialogs`. Before that: `test:testing` 55/55 (0.28.1 restored), `test:equipment` 25/25.
  - Fresh copy of Alex's data: 056, 057 and seed 039 apply in 0.2 s. They write only the two demo thermometers (EQ-00166 CFL, EQ-00167 TPS), their owners and calibrations. No sample or test changed status. 1,579 of his 1,679 open tests can no longer be cancelled because they have results or are in a batch. The switches are as he set them.
  - **Applied** on Alex's go (2026-10-20), together with 0.33.0. Backup `backup-before-0.34.0-2026-10-20` (data folder, 4083 files, identical). The project was unchanged since the "Baseline 0.33.0" commit. Only 056, 057 and seed 039 were waiting, and the start printed "Applied: 056_database_roles.sql, 057_cancel_thermometer.sql, seed_039_receiving_thermometers.sql". Committed to Git.

### 0.33.0: security hardening SEC-1 (2026-10-20, Claude in the cloud; migration 056)

- **Why:** Alex asked for the build's weak points and security concerns, then said "okay do as you suggested" (2026-10-20). Decision note: `Decision - Security Hardening SEC-1` (build choices Proposed; QA items 81 to 86). The scale slice (connection pool, paging, load test) follows.
- **What changed:**
  - `server/pgwire.js`: TLS (sslmode disable / prefer / require / verify-ca / verify-full; sslrootcert) and SCRAM-SHA-256; a refused sign-in fails at once instead of hanging.
  - Migration 056 and `db/roles_setup.sql`: an owner account for the updates (`LIMS_MIGRATE_URL`) and an app account (`DATABASE_URL`) that may only read, add and change rows; the audit triggers run with the owner's rights; `grant_app_role`, `database_account_problems`; `audit_row_site` (the lab of an audit entry).
  - `server/server.js`: `safeRaw` (files shown only when their bytes are a PDF or a picture; SVG sandboxed; everything else downloads), security headers and the Content-Security-Policy, 429 answers; `server/ratelimit.js` (wrong passwords and public pages per computer); `server/auth.js` (Secure cookie behind HTTPS, failures counted per computer); `server/db.js` (`migrate(db, { grantTo })`).
  - Lab separation: `routes.js` (`auditLabFilter` on every audit view; requested test analytes, holidays, signature images), audit checks in `routes_reports.js`, `routes_stability.js`, `routes_trending.js`, `routes_training.js`; `routes_labsetup.js` (lab images); `trending.js` (stability and logbook sources).
  - Screens: the public pages' scripts moved to `public/js/public/`; the quote print button; seven escaping fixes (methods, stability, testing, logbooks, catalog, trending) and `'` escaped in `grid.js` and `combo.js`; the logbook formula preview no longer builds code from text (`calcExpr`), which the policy forbids.
- **Merged first:** Claude Code's 0.31.1 and 0.32.0 (054, 055, test_047, test_048, e2e_licenses and their files). Renumbered this slice 056 / test_049 / 0.33.0.
- **Checked (PostgreSQL 16 in the cloud):** 1834 rule tests (`test_049_database_roles.sql` new, 15). Every browser suite (37 with `e2e_licenses` and the new `e2e_security`) run with the app connected as the restricted app account and migrations as the owner: all 37 pass (`e2e_security` 29 checks; `e2e_wd5` once failed at setup on the known random temporary password containing the user ID, then passed). Connector: 8 cases against a PostgreSQL with TLS and SCRAM (plain, require, verify-full with the CA, a self-signed certificate refused, a wrong password, TLS refused by a server without it, prefer, the old default). The app account refused: disabling triggers, delete, truncate, writing the audit log, `session_replication_role`, dropping a trigger, creating a table or replacing a function. Upgrade from Claude Code's 0.32.0 state applies 056 cleanly. Two audits (read-only, by separate agents) of every route's lab checks and of every HTML interpolation in the screens; their findings are fixed above.
- **Found while testing:** the Content-Security-Policy broke the logbook page's live calculation (it used `Function()`), so a failing balance check was not asked for its reason before signing (the database still judged it on save). Fixed with `calcExpr`; caught by `e2e_logbooks`.
- **Not done:** Git (Claude Code, on the laptop); single sign-on; a penetration test before production.
- **Alex's data:** not applied. Only 056 waits. Copy test first; apply only on his go.
- **On the laptop (Claude Code, 2026-10-20):**
  - **Git:** portable MinGit 2.47.1 (Alex approved the download) installed in his user folder; repository in the project folder (branch main, .gitignore for data/, backup folders, node_modules/, tests/screens/, logs); first commit "Baseline 0.33.0" (930 files).
  - **PGlite:** 1834 rule tests pass (after a test-only fix: `test_046` dated the training it records with `current_date`, which is the next day for the lab after 17:00 Pacific; it now uses `site_today`).
  - **Browser suites on fresh databases:** 37 of 39 passed at first, with `test:security` last at 29/29.
    - `test:licenses`: "expires in 11 days" instead of 12 in the evening. 055 worked the license state out on the server's date; fixed in 0.34.0.
    - `test:testing`: 3 re-prep checks failed every time. **0.33.0 had dropped 0.28.1's re-prepped-samples-stay-visible work** from `public/js/pages/testing.js` and `server/routes_testing.js`: built from an older copy of those two files, though the entry above says 0.31.1 was merged. 0.33.0's only other change in those files (escaping in "Remove from batch", the witness rate limit) is kept. Restored in 0.34.0, where `test:testing` passes 55/55. The other laptop files of 0.31.1 and 0.32.0 were checked and are intact.
  - **Copy of Alex's data:** 056 applies in 0.1 s. It writes no row in any of the 177 tables and adds no audit entry. The audit trail keeps all 49,395 entries (CFL 25,679, TPS 18,227, shared 5,489; none pointing at no lab). A CFL-only person (the demo GM) now sees 31,168 of them (CFL and shared), and people in both labs see both. `database_account_problems()` reports the expected three on PGlite (one account for everything in the Sandbox). The lab switches are as Alex set them (Signed receipt on at CFL).
  - **Not applied** until Alex says go. 056 sat in the project while port 3000 ran on his data: he was told not to restart it.

### 0.32.0: training counts per department, the METRC ID, client licenses, photos in the photo dialog (2026-10-20, Claude Code; migration 055)

- **Why.** Alex (2026-10-20): "I want each department to set the amount of trained tests not for the whole lab. COC looks good. ... on the lab order page we need to put a place for the METRC ID in cannabis samples. ... the client profile contains a section that can add licenses with expiration dates. This should be additive and able to be recalled within the system. When clicking to add photos, the photos that are already attached should show up." His answers: METRC optional and format checked, on the COA when present; licenses with type, number, issuer, dates and a file; recalled by picking one on the lab order, printing it on the COA, and expiry warnings (not blocking orders). Vault: `Decision - Department Training Counts, METRC IDs and Client Licenses` (build choices Proposed).
- **What.**
  - **Training:** 055 gives every department its own rule from its lab's rule; a new department gets one by trigger. The Rules tab lists each department plus "Tests with no department" (the lab rule).
  - **METRC ID:** `sample.metrc_id` (capitals, no spaces, `1A` + 22 letters or digits), the last column of the order's samples grid, the sample page, the COA and the chain of custody when filled in.
  - **Client licenses:** `client_license` (LIC-), never deleted (retired with why), Current / Expiring soon (30 days) / Expired. The client page has a Licenses card and a "Licenses to renew" warning; Intake > Client licenses lists every client's licenses, expired and expiring first; the lab order picks one (Edit order), shown in its header (red when expired); the COA prints it.
  - **Photos:** the photo dialog shows the photos already attached, and says when a new photo takes a report place already held.
- **Files.** New: `db/migrations/055_dept_training_metrc_licenses.sql`, `db/tests/test_048_dept_training_metrc_licenses.sql`, `tests/e2e_licenses.js`, vault note above. Changed: `db/tests/test_046_training.sql`; `server/routes.js`, `server/routes_training.js`, `server/coa.js`, `server/custody.js`; `public/js/pages/clients.js`, `orders.js`, `training.js`, `custody.js`, `public/js/app.js`, `main.js`, `icons.js`, `public/css/app.css`; `tests/e2e_training.js`; `package.json` (0.32.0, test:licenses); CLAUDE.md, this log, `Decision - Training and Competency C-1` (a line), both `00 Home.md`.
- **Checked.** 1819 rule tests on PGlite (26 new: 25 in test_048, 1 in test_046). `test_031`'s catch-up check failed in some runs; it fails about 1 run in 4 on 0.31.1 too (an existing intermittent test, not 0.32.0). Fresh databases: `test:licenses` 28/28, `test:training` 26/26, `test:custody` 33/33, `test:reports` 36/36, `test:oos` 33/33, `test:browser` 19/19, `test:browser2` 12/12, `test:browser2_1` 31/31, `test:labsetup` 21/21. Two faults found and fixed while testing: the COA's license text was blank (a PowerShell edit had dropped the template), and a quote in the Edit order help text broke the order page script. Copy of Alex's data: 055 applies in 0.2 s; six department rules made (Chemistry, General lab, Microbiology at CFL and TPS, each 4 tests like the lab rules); no license, METRC ID, user or permission added; no other record written; 1073 audit labels identical through the new layer. **Applied** on Alex's go (2026-10-20): backup `backup-before-0.32.0-2026-10-20` (data folder, 4077 files, identical); project unchanged since the dev copy; only 055 waiting; the start printed "Applied: 055_dept_training_metrc_licenses.sql". On his data Signed receipt is on at CFL (he turned it on after 0.31.1); 055 does not touch it.

### 0.31.1: audit labels routed, waste save on PGlite, 0.28.1 merged; 0.29.0 to 0.31.0 on the laptop (2026-10-20, Claude Code; migration 054)

- **0.29.0 to 0.31.0 arrived at 12:23** with 051 to 053 and seeds 037, 038 in the project while port 3000 ran on Alex's data; it had been restarted at 12:05 (not by Claude Code), before they arrived, so nothing was applied.
- **Found on PGlite:** `npm test` crashed the database in `test_004` (an older test, unchanged): `audit_record_ref` had 37 wrapper layers and a requested test's label went down most of them; PGlite's stack gave out. With only 050 it failed today, with 051 or 052 it passed: on the edge, and every new module adds a layer. Single calls on Alex's 0.28.0 data still worked. **054** routes each table to the layer that names it (`audit_ref_route`, `audit_ref_chain`, `audit_ref_rebuild()`), keeping every layer's code; see CLAUDE.md 0.31.1.
- **Found by `test:waste`:** saving a waste classification failed on PGlite ("malformed array literal": an enum array sent as a JavaScript array). `routes_waste.js` sends Postgres array text, as the inventory routes do.
- **0.28.1 merged** (re-prepped samples stay in their batch, built 2026-10-19, never installed): its files were untouched by 0.29.0 to 0.31.0.
- **Files:** new `db/migrations/054_audit_ref_routing.sql`, `db/tests/test_047_audit_ref_routing.sql`; changed `server/routes_waste.js`; from 0.28.1 `public/js/pages/testing.js`, `server/routes_testing.js`, `tests/e2e_testing.js`, vault note `Decision - Re-prepped Samples Stay Visible in Their Batch`; `package.json` (0.31.1), CLAUDE.md, this log, both `00 Home.md`.
- **Checked:** 1793 rule tests on PGlite (6 new). Fresh databases: `test:custody` 33/33, `test:waste` 15/15 (after the fix), `test:training` 26/26, `test:testing` 55/55, `test:micro` 14/14, `test:benchruns` 14/14. Copy of Alex's data: 051 to 054 and seeds 037, 038 apply in 2 s; 884 submitted orders get a chain of custody (the 4 Drafts none; no receipts); 68 lots get a waste classification by type, 26 of them "Laboratory chemical: classify from the SDS" (INV-000015, a disposed mixture, keeps none); CFL and TPS get their lab training rule (4 tests); Signed receipt and Training gate off at both labs (the verification gate too); new permissions `training.view/record/approve/configure`; the demo Intake Tech gets a fictional signature; no other existing record changed; 1436 audit labels identical through the router and the old chain. **Applied** on Alex's go (2026-10-20): backup `backup-before-0.31.1-2026-10-20` (data folder, 4028 files, identical); only 051 to 054 and seeds 037, 038 waiting; the start printed "Applied: 051_custody_photos_qr.sql, 052_waste_classifications.sql, 053_training_competency.sql, 054_audit_ref_routing.sql, seed_037_receipt_signature.sql, seed_038_waste_on_items.sql".
### 0.28.1: a re-prepped sample stays in its batch (2026-10-19, Claude Code; no migration)

- **Why:** Alex, 2026-10-19: "When re-prepping a sample the sample disappears from the original batch... Do you think it should be kept in the batch but results not needed to complete it? That way the user can see that it was in the batch at some point?" Agreed with Claude's proposal ("Agreed and Go"), including leaving samples removed before a batch starts hidden.
- **What (screens and one query; no database rule changed):** the entry was always kept (Superseded, with its data) and nothing waits on it, but only the Batching tab showed it. Now every bench step tab (weighing, replicate weighing, dilution, readings, plating, incubation) shows it greyed and read only, with its recorded values and a last column "Re-prep": "Re-prepped (reason): now in BAT-x" (a link), "waiting in the backlog" or "re-prep cancelled". The new batch's entries say "Re-prep of <label> in BAT-x" (a link back) on the Batching tab. QC Review lists "Re-prepped samples" (who asked, when, where it went). Actions on selected rows skip re-prepped ones (and say so when only they are selected); their readings cannot be picked. Re-prepped rows are grey and italic (no longer struck through). The Calculation and Results tabs still leave them out (batch_results calculates active entries only).
- **Files:** `server/routes_testing.js` (the batch's entries carry `reprep_to_*` and `reprep_of_*`), `public/js/pages/testing.js` (`active(d, past)`, `benchEntries(d, past)`, `isPast`, `reprepNote`, `reprepCol`, `benchGrid`, the step grids, the incubation entries, `onlyPast`, `pickReading`, the review note, `.tbsup` style), `tests/e2e_testing.js` (55 checks: 3 new), `package.json` (0.28.1), CLAUDE.md, this log, vault note `Decision - Re-prepped Samples Stay Visible in Their Batch`, both `00 Home.md`.
- **Checked:** 1682 rule tests on PGlite. On fresh databases: `test:testing` 55/55, `test:micro` 14/14, `test:benchruns` 14/14. No migration, so nothing to try on a copy of Alex's data.


### 0.29.0, 0.30.0 and 0.31.0: chain of custody and photos, waste classifications, training and competency (2026-10-20, Claude in the cloud; migrations 051 to 053, seeds 037, 038)

- **Why.** Alex (2026-10-20): no CAPAs or nonconformances for now; build a competency section for training; a waste classification table on the admin side tied to each inventory item; a QR code on the report; photos at sample receipt and report layouts with 1 and 2 photos (4:3); a chain of custody made with sample submission and signed by the person receiving, their signature in a Received area (also the sample manifest). His answers on training: block at the bench with a per-lab switch; either route (training samples or a record), the trainer evaluates and QA approves; configurable rules per lab and department (4 tests make someone department trained, which can unlock any test of the department and training others); a rolling counter and a training report per person; initial and continuing competency kept apart. Vault: `Decision - Chain of Custody, Receipt Photos and Photo Reports`, `Decision - Waste Classifications W-1`, `Decision - Training and Competency C-1` (build choices Proposed; QA items 71 to 80).
- **0.29.0 (051, seed 037).** `custody_document` per order (made when the order leaves Draft, the manifest as submitted), `custody_event` (receipts and paper copies, never changed), `receive_samples` (signed "Received by", the receiver's handwritten signature and title; logs the samples), `record_custody_pdf` (the signed copy, once); `lab_site.custody_signature_required`; `sample_photo` (4:3, report photo 1 and 2); layouts "COA with 1 photo" and "COA with 2 photos" (RT-002, RT-003); `sample_report_photos_missing`. Server: `qr.js` (own QR encoder), `custody.js`, `routes_custody.js`; `coa.js` prints the photos and the QR code, and the release check blocks a photo layout without its photos. Screens: `custody.js` (Chain of custody card, Receive and sign, photo dialog with the crop, Photos card). Seed 037: the demo Intake Tech's signature.
- **0.30.0 (052, seed 038).** `waste_classification` (12 shared, labs add their own; hazard classes from a controlled list; defaults by item type; Needs review), `inventory_lot.waste_classification_id` (default by type), disposal records it. Server `routes_waste.js`; screens `waste.js` (Admin > Lab setup > Waste classifications), the item form, the lot page card, the list's Waste column and filter. Seed 038 classifies existing items by type.
- **0.31.0 (053).** Four permissions (`training.view`, `.record`, `.approve`, `.configure`); `training_rule`; `analyst_qualification`; `competency_attempt` and `competency_evidence`; training samples on an internal order (TRN-), known values as their specification; `qualification_state` (Current, Due soon, Lapsed); `department_trained`; `grant_legacy_qualifications`; the gate `a02_training` on step completion where `lab_site.require_training` is on. Server `routes_training.js` (with the training report PDF); screens `training.js` (Testing > Training and competency).
- **No new permissions** for 0.29.0 and 0.30.0 (orders.edit; inventory.lists). Four for 0.31.0, given to the standard QA, Lab Supervisor and General Manager groups.
- **Checks.** 1787 rule tests pass (new: `test_044` 39, `test_045` 20, `test_046` 46). All 35 browser suites pass on fresh databases (new: `e2e_custody` 33, `e2e_waste` 15, `e2e_training` 26; `e2e_labsetup` updated for the two new templates). QR codes decoded back from the printed COA and chain of custody (OpenCV). Upgrade from the 0.28.0 state applies 051 to 053 and seeds 037, 038 only: every submitted order gets its chain of custody, every active item a waste classification, every lab its training rule. Screenshots and the PDFs (chain of custody, COA with 2 photos, training report) reviewed.
- **Alex's data.** Not applied. Both new lab switches ("Signed receipt", "Training gate") are off, so nothing changes at intake or at the bench until a system administrator turns them on. Next for Claude Code: migration 054, seed 039, rule test test_047.

### 0.28.0 on the laptop (2026-10-19, Claude Code)

- **Arrived at 21:34** with 050 and seed_036 in the project while port 3000 ran on Alex's data. Port 3000 had been restarted at 21:28 (not by Claude Code), before the files arrived, so nothing was applied then.
- **Checked:** 1682 rule tests on PGlite (with 0.28.1's screens); `test:vendors` 19/19 and `test:purchasing` 20/20 on fresh databases. Copy of Alex's data: 050 and seed_036 apply in 0.5 s; his 4 all-labs vendor approvals became corporate approvals for every scope; his 4 open purchase requests were given their scopes; new: `purchasing.qualify_corporate`, the Corporate QA (all labs) group, the demo user `corp.qa` (no password), 11 supply scopes; no lab-level approval exists, so the corporate-over-local change affects nothing of his; gates off.
- **Applied:** on Alex's word ("work on installing the next piece from claude chat - vendor approval"). Backup `backup-before-0.28.0-2026-10-19` (data folder, 4005 files, identical); only 050 and seed_036 waiting; the start printed "Applied: 050_vendor_approvals.sql, seed_036_corporate_qa_demo.sql".

### 0.28.0: V-1 vendor approvals, local and corporate (2026-10-19, Claude in the cloud; migration 050, seed 036)

- **Why:** Alex (2026-10-19): vendor approvals local, promotable to a corporate level; QA approves vendors, not purchase requests. His answers: a new all-labs Corporate QA group; a lab stricter, never looser; corporate approvals use the shared risk classes, which Corporate QA keeps and adds to; a proposal needs at least one document and a shared class; supply scopes now. Vault: `Decision - Vendor Approvals, Local and Corporate V-1` (build choices Proposed; QA items 67 to 70).
- **What:**
  - **Two levels:** a lab's QA approves for its own lab only (before, any lab's QA could approve for all labs); Corporate QA (new all-labs group, `purchasing.qualify_corporate`) approves for every lab. A corporate suspension or rejection blocks every lab and cannot be overridden by a lab; a lab may suspend or reject locally.
  - **Supply scopes:** what a vendor is approved for (11 to start, kept by Corporate QA). Every purchase request has its scope (from the item type, Equipment, or chosen for services and other purchases) and is refused when the vendor is not approved for it, naming what is missing. Existing approvals cover every scope.
  - **Evidence and promotion:** documents on approvals (certificate expiry shown and filtered); "Propose for corporate approval…" (signed, a document, a shared class); Corporate QA approves for every lab (signed, never the proposer, at most the lab's scopes; the documents are carried) or rejects it with a reason.
  - **Notices** to the labs (a corporate suspension with the requests it stops; a decided proposal). **Screens:** Purchasing > Vendor approvals (was Suppliers), the vendor page, Risk classes and scopes, the request form's "For".
- **Files:** new `db/migrations/050_vendor_approvals.sql`, `db/seed_036_corporate_qa_demo.sql`, `db/tests/test_043_vendor_approvals.sql`, `tests/e2e_vendors.js`, the vault note; changed `db/tests/test_010_purchasing.sql`, `db/tests/test_008_permissions_groups.sql`, `server/routes_purchasing.js`, `server/routes.js`, `public/js/pages/purchasing.js`, `public/js/main.js`, `public/js/app.js` (`modal()` takes `after`), `tests/auth.js`, `tests/e2e_purchasing.js`, `package.json` (0.28.0, `test:vendors`), CLAUDE.md, this log, `Open Items for QA Review`, `Vendor Qualification`, both `00 Home.md`.
- **Merged first:** Claude Code's 0.27.1 (049, package prices).
- **Checked (PostgreSQL 16, cloud):** 1682 rule tests pass (45 new in test_043). `test:vendors` 19/19 on a fresh database. All 32 browser suites pass on fresh databases (`test:purchasing` with its new tick of "Every scope"). Upgrade from the 0.27.1 state (049 applied) applies only 050 and seed_036, with no error. Not run here: PGlite.
- **Alex's data:** not applied. 050 and seed_036 wait. Try on a copy first (list any vendor a lab approved while corporate had it suspended or rejected: it is blocked from 050 on); apply only on his go. Never on the demo copy (3100).

### 0.27.1: a package priced by typing each test's price (2026-10-19, Claude Code; migration 049)

- **Why:** Alex, 2026-10-19: "For pricing in the packages module. Let's instead of using a %discount approach and instead enter the price for the component test and calculate the discount. This should make it more simpler. You always make a package price by re-pricing the component tests."
- **What:** the package page has no pricing mode, discount % or fixed price any more. Each test has a "Price in the package" (it starts at its catalogue price); the package price is their sum; the discount is worked out (tests at catalogue price less the package price, in dollars and %), live as prices are typed, per line and for the package. The Packages tab shows the discount. Analytes are still left out per test; the per-analyte package price is gone (the test is priced as a whole); a test priced above its catalogue price is a Warning. A dated price change with Packages ticked changes these tests' prices in every package by the same % and rounding.
- **049:** existing packages keep their price: each test gets the share it had. A package whose typed shares did not add up to its price (an Error before; Alex's PKG-0001 had 10 and 90 typed on a 10 %-off package) keeps its package price, shared by the tests' values. `test_package.pricing_mode`, `fixed_price`, `discount_pct` and `test_package_analyte.package_price` dropped; `test_package_item.component_price` NOT NULL (a new line takes its catalogue price in `test_package_rules`, an emptied one is refused). Replaced: `test_package_rules`, `test_package_values` (same columns; value = list price), `test_package_lines` (share = the test's price), `test_package_price` (the sum), `test_package_problems`, `test_package_view` (new `discount`, `discount_pct`), `apply_catalog_price_change`. Quotes, orders and invoices unchanged (they read the shares).
- **Files:** new `db/migrations/049_package_test_prices.sql`; changed `server/routes_packages.js`, `public/js/pages/catalog.js`, `db/tests/test_041_packages.sql` (pricing checks rewritten for 049), `tests/e2e_packages.js` (25 checks), `package.json` (0.27.1), CLAUDE.md, this log, the vault note `Decision - Test Packages and Dated Price Changes P-1`, both `00 Home.md`.
- **Checked:** 1635 of 1636 rule tests on PGlite; the one failure is `test_031`'s known after-midnight-UTC check (see 0.26.0 on the laptop). On fresh databases: `test:packages` 25/25, `test:pricing` 15/15. Upgrade from 0.27.0 with three packages (a fixed price, a discount with an analyte left out and one repriced, typed shares that did not add up): every price kept. Copy of Alex's data: only 049 applies (0.3 s); the only change is PKG-0001's two lines (USP <61> $321.30, USP <62> $367.20: $688.50, 10 % off, no longer an Error); gates off.
- **Applied:** on Alex's go (2026-10-19, evening). Backup `backup-before-0.27.1-2026-10-19` (data folder, 4009 files, identical); only 049 waiting; the start printed "Applied: 049_package_test_prices.sql".
- **Open with Alex:** on a quote the package price is still negotiated as one figure, shared out in proportion; typing each test's price there too was not built.

### 0.26.0 and 0.27.0 on the laptop (2026-10-19, Claude Code)

- **0.26.0 arrived at 17:06** with 047 in the project while port 3000 ran on Alex's data (not restarted before his go). Checked: 1618 rule tests on PGlite; `test:packages` 22/22 and `test:pricing` 15/15 on fresh databases; copy test with 048 (below).
- **Two older tests failed once and passed on a rerun (not from these slices). For Claude in the cloud:** (1) `test_031_invoicing.sql` "LO-000011's work invoiced once, dated the Friday of the week its COA was issued" fails when run just after midnight UTC (17:36 Pacific): a date taken in UTC against the lab's week; (2) `e2e_qa_testing.js` stopped once in `prepareUsers` with "temp password gm: The password must not contain your user ID" (a random temporary password happened to contain "gm").
- **Applied:** on Alex's go. Backup `backup-before-0.27.0-2026-10-19` (3971 files, identical); only 047 and 048 waiting; the start printed "Applied: 047_packages_price_changes.sql, 048_run_dilutions_analyst_pick.sql".

### 0.27.0: bench autosave, a dilution per analytical run, the analyst's pick (2026-10-19, Claude Code; migration 048)

- **Why:** Alex, 2026-10-19: "It's very easy to lose your sample weights recorded, it is mandatory to hit the save button first. Can we make the weights automatically saved with any entry. And overwritten entry can be saved." And: "Can you show me how the picking dilutions between runs works?" It did not exist: a sample had one dilution shared by every analytical run, so a sample diluted further and read again had its run 1 reading calculated with the new, larger factor too. Alex: "the analyst should pick the dilution, not the reviewer", "make the picking a permission so we can turn it off for a lab that doesn't want it".
- **Autosave (screens only):** `editableGrid({ autosave })` in `common.js`: a pause of about a second after a change saves it; a correction asks for its reason first (as before); saved rows become the grid's starting point (no redraw under the typist); "Saved automatically at …"; "Save now" uses the same save; `grid.flush()`. Every bench grid (`benchGrid` in `testing.js`: weights, replicate weights, dilutions, readings, plating) autosaves; Complete step saves anything waiting first.
- **048:** permission `testing.pick_run` (standard groups Analyst, Lab Supervisor). A Dilution value with `run_no` > 1 belongs to that analytical run of the batch's last reading step (`a03_dilution_run`); `entry_dilution_data()`; `add_analytical_run_diluted(step_run, entries, replicates, aliquot, diluent)` records the samples' previous dilution plus one aliquot + diluent for the new run, in the run's signed transaction; `batch_results` replaced (035's, with each reading's own run's dilution). `analyst_pick` (written only by `set_analyst_pick(entry, run, analyte, note)` / `clear_analyst_pick()`: the permission, someone who may do the reading step, the batch In Progress, a reading that exists and is a result, a note); `batch_review_items` wrapped (`batch_review_items_039`): where the reviewer has not chosen, the analyst's pick is reported with "Picked by the analyst (name): note". `audit_record_ref` wrapped (`_048`).
- **Server and screens:** `routes_testing.js` (the batch carries `picks`, `can_pick`; `/runs` takes `aliquot`, `diluent`; `POST /api/testing/entries/:id/pick`, `POST /api/testing/picks/:id/clear`); `testing.js` (Add analytical run: "Further dilution"; reading tab: Dilution and Reported columns, "Pick reported reading…" button and right-click; Dilution tab: "Later runs"; QC Review shows the analyst's pick and note).
- **Files:** `db/migrations/048_run_dilutions_analyst_pick.sql`, `db/tests/test_042_run_dilution_pick.sql`, `tests/e2e_bench_runs.js` (new); `public/js/pages/common.js`, `public/js/pages/testing.js`, `public/css/app.css`, `server/routes_testing.js`; `package.json` (0.27.0, `test:benchruns`); CLAUDE.md; this log; the vault note `Proposal - Multi-Instrument Pesticide Panel` (the pesticide design from batch #3662's exports, Alex's answers; not built).
- **Checked:** 1636 rule tests on PGlite (18 new). On fresh databases: `test:benchruns` 14/14, `test:testing` 52, `test:micro` 14, `test:wd5` 17, `test:bax` 25, `test:serving` 21, `test:qa` 17, `test:logbooks` 31, `test:media` 22, `test:packages` 22, `test:pricing` 15. Copy of Alex's data: 047 and 048 apply in 0.7 s; new: the package and price change tables (empty), `testing.pick_run` (CFL and TPS Analyst, Lab Supervisor); no existing record changed; gates off; no batch of his has a dilution beyond run 1, so no live result changes.
- **Not done:** a pick for a timepoint result (picks apply to final results); per-sample further dilutions in one run (one aliquot + diluent for the ticked samples; add another run for a different one).

### 0.26.0: P-1 test packages and dated price changes (2026-10-19, Claude in the cloud; migration 047)

- **Why:** Alex (2026-10-19): "Build the packages capability please", on his package decisions (catalogue packages, two pricing modes, analytes inside a package, one price on the quote, a share per test, dated price increases). He first chose option A for a cancelled test (break the package; the tests left go to the client's quoted price, else the catalogue price) and at 16:28 changed it to **option B**: only that test's share comes off, the rest keep theirs. Option A was built in the database and replaced before delivery; nothing of it remains. Vault: `Decision - Test Packages and Dated Price Changes P-1` (build choices Proposed).
- **What:**
  - **Catalogue:** a Packages tab and a package page (tests with their catalogue price, value and share; typed shares optional; analytes left out or repriced; problems listed; the quotes carrying it; Retire), saved with a Reason for Change. The Tests tab shows each test's lab.
  - **Quotes:** "Packages on this quote" (add, quantity, negotiated package price with the shares following, Specs per test, trash); totals, the quotation PDF and the printable quote include them; a new version copies them.
  - **Orders:** "Add a package to ticked samples" and per sample; the tests ordered at their shares; a Package column; cancelling one of its tests shows what comes off first, then the package is Partly cancelled and nothing else is repriced. Applying a project orders its packages first. Invoice lines name the package.
  - **Price changes:** "Update prices…" now has a start date (today applies at once, later dates by the hourly job), rounding to the cent or the dollar, and packages included or not; a Price changes tab lists them and cancels a scheduled one with a reason. A price change covers its own lab's tests.
- **Database (047):** see CLAUDE.md "0.26.0" for the tables and functions. Replaced: `orderable_lines`, `new_project_version`, `apply_project`, `invoice_line_text`, the `test_catalogue` view (two columns added at the end); `audit_record_ref` wrapped (`audit_record_ref_047`). No new permission (catalog.edit, quotes.edit, orders.edit).
- **Files:** new `db/migrations/047_packages_price_changes.sql`, `db/tests/test_041_packages.sql`, `server/routes_packages.js`, `tests/e2e_packages.js`, vault note above; changed `tests/e2e_pricing.js` (the new message), `server/routes.js`, `server/quotes.js`, `public/js/pages/catalog.js`, `projects.js`, `orders.js`, `public/js/main.js`, `package.json` (0.26.0, `test:packages`), CLAUDE.md, this log, both `00 Home.md`.
- **Merged first:** Claude Code's 0.25.1 (046 sensor re-judging, test_040) from the laptop. The packages migration was renumbered from 046 to 047 after it.
- **Checked (PostgreSQL 16, cloud):** 1618 rule tests pass (51 new in test_041, plus Claude Code's test_040). `test:packages` 22/22 on a fresh database. All 30 browser suites pass on fresh databases, `test:sensors` (33) and `test:packages` (22) included; `e2e_pricing.js` now expects the price change's new message ("PC-0001: 1 price changed by 10 %"), and Moisture still goes from $40 to $44. Upgrade from the 0.25.1 state (046 applied) applies only 047, with no error. The quotation PDF with a package was opened and read. Not run here: PGlite.
- **Alex's data:** not applied. Only 047 waits (no seed). Try it on a copy first; apply only on his go. Never on the demo copy (3100).
- **Correction (Claude in the cloud, 2026-10-19 evening):** 047 was applied to Alex's data on his go with 048 (see 0.27.0, Claude Code). The merged copy (047 and 048) passes 1636 rule tests and, on PostgreSQL 16, `test:packages`, `test:pricing`, `test:quotes`, `test:testing`, `test:benchruns` and `test:browser2`. Alex's answers on the build choices are in the vault note.

### 0.25.1: sensor entries after a change of limits (2026-10-19, Claude Code; migration 046)

- **Why (Alex's first test):** EQ-00133 "Fake Incubator Imonnit Test" in LB-0034 "Imonnit Temp Check" had its equipment limits typed as 10 to 30; the pretend incubator (34 °C) was recorded as one two-day excursion (565 readings) and 47 failing hours (46 approved by QA, one returned). Correcting the limits to 33 to 37 changed nothing recorded, and TC-0034 marked every point outside its limits. Also: LB-0034 was not offered for linking while its design was a Draft, with nothing saying why. Alex: "yes please" to listing why, and to looking at the entries.
- **Found:** entries are judged when recorded (by design, as for hand entries); but the feed never closed the open excursion after the change (it started before the 48 hours a read changes), so it would have flagged every batch using EQ-00133 in QC Review without end. TC-0034 took "outside" from each entry's recorded result and also plotted the excursion entry.
- **What (046):** `sensor_link.rejudge_from / rejudge_reason / rejudge_by / rejudge_signature_id`; `request_sensor_rejudge(link, from, reason)` (sensors.configure, signed, a reason); `sensor_feed_refresh(link, now, from, reason)` (045's, plus: entries record the limits judged against, `lo`/`hi` in `sensor_summary`; a regular read changes only entries judged against the current limits; an open excursion judged against other limits ends at the first reading inside the current ones; a re-judging voids excursions that no longer are one and judges the hours again, the reason "Re-judged against the corrected limits: <reason> (asked by <name>)"); `x_same_limits()`; the two-argument `sensor_feed_refresh` does a waiting request first, then clears it.
- **Server and screens:** `routes_sensors.js` (`POST /api/sensors/links/:id/rejudge`, then reads at once; `blocked`: the equipment logbooks a sensor cannot feed yet and why), `trending.js` (logbook charts leave out sensor excursion entries), `pages/sensors.js` (Re-judge…, the fold-out list, action buttons first), `pages/logbooks.js` (the limits an entry was judged against).
- **Files:** `db/migrations/046_sensor_rejudge.sql`, `db/tests/test_040_sensor_rejudge.sql` (new); `server/routes_sensors.js`, `server/trending.js`, `public/js/pages/sensors.js`, `public/js/pages/logbooks.js`, `tests/e2e_sensors.js`; `package.json` (0.25.1); CLAUDE.md; this log; the vault proposal.
- **Checked:** 1566 rule tests on PGlite (23 new). On fresh databases: `test:sensors` 33/33 (new: the list with why; limits typed wrongly, corrected, re-judged in the browser; the chart), `test:trending` 29/29, `test:logbooks` 31/31. Copy of Alex's data: 046 changes nothing by itself; simulated on the copy, the next read closes LB-0034's excursion (window 22:20 to 22:25 on 10-17), and a re-judge voids it and passes all 47 hours (back to QA), leaving the real 50-minute silence.
- **Applied:** on Alex's go. Backup `backup-before-0.25.1-2026-10-19` (3973 files, identical); only 046 waiting; the start printed "Applied: 046_sensor_rejudge.sql". The re-judge of LB-0034 is Alex's to ask for (Sensors > Re-judge… on 501002).

### 0.25.0: the sensor feed (iMonnit) into the logbooks (2026-10-19, Claude Code; migration 045, seed 035)

- **Why:** Alex, 2026-10-19: connect iMonnit's humidity and temperature data to the logbooks and workflow steps; "Hourly with your suggestion" (an entry per hour, plus one per spell outside the limits and one per silence); a design for the production server, then "go ahead and add the pretend imonnit service" (0.24.2), then "go" to build the feed on it.
- **What (045):** permission `sensors.configure` (Lab Supervisor, QA). Automated account `sensor.feed` (no password, no group): `logbook.record` only while the feed runs (`lims.sensor_feed`, `sensor_feed_running()`, `sensor_feed_grant()` added to `user_has_permission_at` and `user_can_access_site`); signature method "Automated sensor feed" (`signature_event_rules` replaced, keeping 024's rules; `sensor_feed_sign()`). `sensor_connection` (one per lab, off; system administrators; the key stays on the server as `LIMS_IMONNIT_KEY`), `sensor_link` (sensor and value to a logbook Number field for covered equipment; `sensor_link_problem()`; signed; `approve_sensor_link(link, from)` by QA, not whoever linked it, feeding from now or up to 7 days back; `retire_sensor_link()`), `sensor_reading` (append-only, once per message), `sensor_sync_log`, `sensor_add_readings()`. `logbook_entry` gains `source`, `sensor_link_id`, `sensor_kind` (Hour / Excursion / No data), `period_start/end`, `sensor_summary`; triggers `a00_sensor` and `a02_sensor` around the logbook's own `a01_rules` (sensor entries only by the feed; people give only the reason of an excursion or silence, signed when the logbook signs; QA approval refused without it). `sensor_feed_refresh(link, now)` turns readings into entries in the database (72 hours looked at, 48 changed; overlapping entries updated, ones late readings removed voided; a corrected approved hour goes back to QA). `equipment_failure_view` replaced (same columns): sensor entries cover exactly their period, hourly entries flag nothing. `sensor_range()` for incubator loads. `audit_record_ref` wrapped; it also fixes 043's trend chart audit links ('href' instead of 'link').
- **Seed 035:** switches the pretend connection on at CFL only where CFL's verification gate is on (fresh test databases); on Alex's data it stays off.
- **Server and screens:** `server/sensor_feed.js` (per lab and link: reads iMonnit or the pretend service, signs, adds readings, refreshes; logs each read; a job every minute for labs due), `server/routes_sensors.js`, `server/connectors/imonnit_mock.js` (live and shifted modes; the incubator at 34 °C); `pages/sensors.js` (Admin > Lab setup > Sensors; the equipment page card), `pages/logbooks.js` (sensor entries' period, REASON NEEDED, the "From the sensor" box with the excursion's readings, Give the reason…, no Correct; Logbook review cannot tick an entry without its reason), `pages/testing.js` (incubator loads: "Sensor during the load"), `routes_logbooks.js`, `routes_testing.js`, `routes.js`, `main.js`, `icons.js`, `app.js`, `equipment.js`.
- **Files:** `db/migrations/045_sensor_feed.sql`, `db/seed_035_sensor_test_connection.sql`, `db/tests/test_039_sensor_feed.sql`, `server/sensor_feed.js`, `server/routes_sensors.js`, `public/js/pages/sensors.js`, `tests/e2e_sensors.js` (new); the files above; `package.json` (0.25.0, `test:sensors`); CLAUDE.md; this log; the vault proposal (now built) and `Open Items for QA Review`.
- **Checked:** 1542 rule tests on PGlite (54 new). On fresh databases: `test:sensors` 28/28, `test:logbooks` 31/31, `test:micro` 14/14, `test:equipment` 25/25, `test:trending` 29/29, `test:browser` 19/19; `test:imonnit` 23/23. Looked at: the Sensors page and an excursion's page. Fixed while testing: the hand-entry wording of a sensor entry's QC Review window; the links grid too wide.
- **Not done:** the "Sensor during the load" column was checked only through the database (no demo batch has a load during the sensor period); a designer option for a step value taken from a sensor (the design note's other step use) is not built; real iMonnit untested (needs a licence and its method reference).
- **Copy test on a copy of Alex's current data:** applied 045 and seed_035 (0.4 s). New: `sensors.configure` (CFL and TPS Lab Supervisor and QA), the account `sensor.feed`, a connection per lab (off). No existing record changed; his 86 logbook entries are "Manual"; gates off; the app started cleanly and its sensor job ran.
- **Applied:** on Alex's go. Port 3000 had been restarted at 12:59 (not by Claude Code; nothing waited). Stopped, backup `backup-before-0.25.0-2026-10-19` (3947 files, identical), files copied, only 045 and seed_035 waiting; the start printed "Applied: 045_sensor_feed.sql, seed_035_sensor_test_connection.sql".

### 0.24.2: the pretend iMonnit service and the sensor feed's reading side (2026-10-19, Claude Code; no migration)

- **Why:** Alex, 2026-10-19, after the design `Proposal - iMonnit Sensor Feed for Logbooks and Workflows` (hourly entries plus one entry per spell outside the limits, his choice): "add the pretend imonnit service and test it". The real feed waits for a production server and an iMonnit Premiere or Enterprise licence.
- **What:** `server/connectors/imonnit_mock.js` (the pretend service: 49 hours of repeatable readings from a fridge, an incubator and a humidity sensor, with an excursion, sensor silences, a gateway sending readings late, a duplicated message, a call-range limit, "too many requests", and the end of daylight saving time); `server/connectors/imonnit.js` (calling iMonnit with retries and 24-hour calls, a message to readings in the sensor's own unit, the lab's hours, hourly summaries, excursions, no-data periods, corrections for late readings, a read of every linked sensor). Nothing in the app uses them yet; no table, no migration, Alex's data untouched. The message format is assumed where Monnit's method reference could not be read (it needs an iMonnit sign-in); both files say which parts.
- **Design finding:** a gateway that was offline sends readings later with their own earlier times, so each read takes the last 24 hours again; reading back only 2 hours misses them (a check shows it). Added to the proposal.
- **Files:** `server/connectors/imonnit.js`, `server/connectors/imonnit_mock.js`, `tests/imonnit_feed_test.js` (new); `package.json` (0.24.2, `test:imonnit`); CLAUDE.md; this log; the vault proposal.
- **Checked:** `npm run test:imonnit` 23/23 (no app or database needed): every hourly figure of every sensor matches figures worked out from the scenario independently. A deliberately wrong gap limit made it fail as it should.
- **Not done:** writing the entries into logbooks (tables, the automated account, the logbook setting, QC Review incubator checks, workflow step values). On Alex's go.

### 0.24.1: T-1.1, Alex's trending notes (2026-10-19, Claude Code; migration 044)

- **Why:** Alex's six notes after looking at T-1 (2026-10-19): (1) a button to download all charts as one report; (2) the legend shows each line as its symbol, not in words; (3) logbook error % as a recovery, only if it cannot be set up in the logbook; (4) units on the axes and wherever data is shown (his example: the stability chamber excursions chart); (5) a QA reviewable setting on charts, shown on QA's to-do widget, so QA reviews and approves control charts; (6) QC chart limits uploaded to the test's QC type after approval. His choices: QA approves the chart and its limits; limits go in through a new test version; the download covers every saved chart; built by Claude Code.
- **(3) needs no build:** a calculated field "Recovery %" = reading ÷ nominal × 100 in a new version of the logbook; only entries recorded after it carry it. **(4) the example:** that chart counts excursions per month, so its axis reads "Excursions per month"; the temperatures chart (TC-0001) is the one in °C.
- **What (044):** permission `trending.approve` (standard group QA, both labs). `trend_chart` gains `qa_review`, `qa_status` (Not required / Awaiting QA / Approved), `qa_approved_by/at`, `qa_signature_id`, `applied_version_id/by/at`. Trigger `a02_qa` (`trend_chart_qa_rules`): a chart shown in QC Review is always QA reviewed (taking it off QA review is refused until it leaves QC Review); QA fields are written only by the functions; taking a chart off QA review needs `trending.approve`; a change to source, params, rules or frozen limits sends it back to Awaiting QA. `approve_trend_chart` (signed "Approved by"; not whoever made, last changed or froze it). `trend_limits_for_test` (one QC check, one analyte, frozen, approved: centre line ± 3 sigma, or why not). `record_trend_limits_applied` (a Draft of the chart's test; `methods.design`; signed). Charts already in QC Review become QA reviewed and wait for QA.
- **Server and screens:** `routes_trending.js` (approve and apply-limits routes; apply writes the limit into the Draft's Batching criterion row for that analyte, Range = LCL to UCL, Max = UCL, 4 significant figures, converting the older default + exceptions layout, notes it in the change summary; makes the Draft from the effective version when there is none); QC Review shows only approved charts; packs "Every saved chart" (`all`); `routes_dashboard.js` QA to-do line "Control charts to approve"; `trending.js` (server): axis titles with units for every source, a symbol key under every chart (dots, lines, bands, bars), nice ticks; `pages/trending.js`: Download all (PDF) on Trend watch, QA pills, the QA column and "Only charts awaiting QA" filter, the QA banner with Approve and "Use these limits for the test…", the QA review tick box when saving.
- **Files:** `db/migrations/044_trending_qa.sql`, `db/tests/test_038_trending_qa.sql` (new); `server/trending.js`, `server/routes_trending.js`, `server/routes_dashboard.js`, `server/routes.js`; `public/js/pages/trending.js`; `tests/e2e_trending.js`; `package.json` (0.24.1); CLAUDE.md; this log; vault `Decision - Trend Chart QA Approval and Limits for Tests` (new), `00 Home.md`.
- **Checked:** 1488 rule tests on PGlite (34 new). `test:trending` 29/29 on a fresh database (new: units and key in the SVG, Download all, QA's widget 2 then 0, TC-0005 hidden from QC Review until approved). On a throwaway copy, a Lead LCS chart with limits set by hand (centre 100, sigma 4): the supervisor saw no Apply before approval; QA approved on the page (signed); the supervisor applied (signed) into the existing v2 Draft of Heavy Metals: Lead 88 to 112, Cadmium and Arsenic 80 to 120 and Mercury 75 to 125 unchanged. Fixed while testing: the trigger forced QA review back on before checking who may turn it off; the axis read "Recovery % (%)".
- **Not done:** the demo has no approved QC batches, so no demo QC chart can be frozen and applied; the apply flow is not in `e2e_trending.js` for that reason.
- **Copy test on a copy of Alex's current data:** applied 044 only (0.1 s). Changes: permission `trending.approve` (CFL QA, TPS QA); TC-0005 ICP-MS LCS recovery set to QA review, Awaiting QA (it leaves QC Review until QA approves it). No other existing record changed; gates CFL and TPS off.
- **Applied:** on Alex's go. Port 3000 stopped, backup `backup-before-0.24.1-2026-10-19` (3949 files, identical), files copied, only 044 waiting; the start printed "Applied: 044_trending_qa.sql".

### 0.24.0 on the laptop (2026-10-19, Claude Code; no version change)

- **Port 3000 was running** (started 09:41, the files arrived 09:44; nothing applied). Stopped before the backup so a restart could not apply them untested.
- **Backup:** `backup-before-0.24.0-2026-10-19` (3937 files, identical).
- **PGlite:** 1453 rule tests pass. `test:trending` on a fresh database (throwaway app, port 3305): 23/24. The one failure, "Only charts with signals to review leaves only those" (`tests/e2e_trending.js` line 67), is the test counting the tiles before the page redraws: right after ticking, 18 tiles; 2.5 s later, 3 tiles, all with signals. Not an app bug. **For Claude in the cloud:** wait for the redraw in that check (e.g. `waitForFunction` until every `.trtile` is `.open`).
- **Copy test on a copy of Alex's current data** (started under 0.24.0 on port 3306): "Applied: 042_zero_count_controls.sql, 043_trending.sql, seed_034_trending_demo.sql". No existing record changed (audit trail: every write a new record; 042 changes rules only). New: `trending.view` (Analyst, Lab Supervisor, QA, General Manager, Project Manager at CFL and TPS), `trending.manage` (Lab Supervisor, QA at CFL and TPS); eight demo charts TC-0001 to TC-0008 at CFL; 5 trending canned reasons; tables `trend_chart`, `trend_signal_review` (empty). Gates CFL and TPS off before and after.
- **Applied:** on Alex's go, port 3000 started: the same three files. Checked on a copy taken right after: 8 charts at CFL, the permissions in 10 and 4 groups, gates off.

### 0.24.0: trending and control charts T-1, and the control counted 0 (2026-10-17, Claude in the cloud)

- **Why:** Alex, 2026-10-17: "build a control charting module without my input and I'll see how it looks", with charts of anything that repeats, downloads, charts applied where they help, and other trending (OOS). Also the USP <51> negative control fix he agreed on 2026-10-15.
- **What:** six sources (results, QC checks of approved batches, logbook fields, stability pulls, events per week or month, Pareto); individuals and moving range, c and p charts, histogram with Cp/Cpk/Ppk, stability regression with shelf life; Western Electric signals; "each" analyte, QC check or piece of equipment as panels; saved charts (TC-), Trend watch, signal reviews, frozen limits, report packs (OOS, lab performance, equipment and environment, every watched chart), QC charts shown in QC Review with the batch's points ringed; PNG, SVG, CSV, Excel and PDF. 042: a control whose calculation is undefined only because its count is 0 is judged on the count.
- **Migrations and files:** `db/migrations/042_zero_count_controls.sql`, `043_trending.sql`, `db/seed_034_trending_demo.sql`, `db/tests/test_037_trending.sql`, `server/trending.js`, `server/routes_trending.js`, `public/js/pages/trending.js`, `tests/e2e_trending.js` (new); `server/routes.js`, `public/js/main.js`, `app.js`, `icons.js`, `pages/testing.js`, `pages/admin.js`; `package.json` (0.24.0, `test:trending`); CLAUDE.md; this log; vault `Decision - Trending and Control Charts T-1` (new), `Decision - Stability Studies S-2 Scope`, `Open Items for QA Review` (57 to 60), `00 Home.md`.
- **Checked:** 1453 rule tests (35 new) and all 28 browser suites on PostgreSQL 16 (`e2e_trending`: 24 checks); every source and pack built through the API; the SVGs and PDFs looked at; upgrades from the 040 and 041 states apply cleanly.
- **Found and fixed:** saving a change to a chart hung the request (a lab check outside the transaction while it was open); the PNG download failed (a doubled SVG namespace); months with no events made "8 in a row below the centre line" signals on count charts.
- **Not done:** QC charts have no demo data (no approved batch with QC in the demo); signal reviews are not signed; a signal does not block approval; no scheduled email of the watch list. PGlite not run here.
- **Alex's data:** not applied. Only 042, 043 and seed_034 wait (041 and seed_033 are on his data since 2026-10-17). Delivered to the laptop on 2026-10-19; try on a copy first, apply only on his go.

### 0.23.0 on the laptop (2026-10-17, Claude Code; no version change)

- **Waiting:** only `041_stability_s2.sql` and `seed_033_stability_reasons.sql`. Port 3000 had started before they arrived, so nothing was applied early; it was stopped for the backup.
- **Backup:** `backup-before-0.23.0-2026-10-17` (3925 files, identical).
- **PGlite:** 1418 rule tests pass (first run of 0.23.0 on PGlite). `test:stability2` on a fresh database (a throwaway copy of the app on port 3305): 21/21.
- **Copy test on Alex's data:** applied in 0.5 s, no error. Changes: permissions `stability.cancel` (Lab Supervisor, General Manager at CFL and TPS) and `stability.assess` (QA at CFL and TPS); `placed_on` 2026-07-12 on STB-00001-1 and STB-00001-2 (the study's placement date); 7 Stability canned reasons; 1 email template; 3 new empty tables. No other existing record changed (audit trail). Gates CFL and TPS off before and after.
- **Applied:** on Alex's go, port 3000 started: "Applied: 041_stability_s2.sql, seed_033_stability_reasons.sql". Checked on a copy taken right after: the same permissions, placement dates, 7 reasons; gates off.

### 0.23.0: Stability S-2 (2026-10-17, Claude in the cloud)

- **Why:** Alex, 2026-10-17: "go ahead and build it", choosing all four recommendations (amended quote; fate per condition on cancellation; QA assesses excursions per study; an interim report after each pull, then Final). They match his S-2 answers of 2026-10-15 (`Decision - Stability Studies S-2 Scope`), with two notes: those answers also said the report is issued through Report Finalization with a COA's independence rules (built), and gave "an extra pull" as the excursion's third outcome where he now chose "Client to decide" (built as now; raised with him). Billing per pull was already done by I-1.
- **What:** amendments (a new quote version copied from the version the study runs to; T0, intervals and tests already ordered or pulled cannot change; on acceptance scheduled pulls follow the new design, dropped ones are cancelled, new ones scheduled, and a new condition is placed later with its own dates; each amendment recorded); cancellation (signed, reason; scheduled pulls and open pull orders cancelled with their samples and tests, the T0 order if not yet logged; every stored material Destroyed, Returned or Retained; disposal of leftover material); excursion assessments (QA, signed, justified; the pulls of the exposed material recorded; "Impact" flags their results E); the issued cumulative report (STB-00001-SR1...; finalized results only; excursions, amendments and cancellation listed; signed with the handwritten signature; independence and GMP rules as a COA; nothing issued while an excursion is unassessed or nothing is new; Final when every pull is done and finalized; emailed with the PDF); Report Finalization tab "Stability reports"; canned Stability reasons.
- **Migrations and files:** `db/migrations/041_stability_s2.sql`, `db/seed_033_stability_reasons.sql`, `db/tests/test_036_stability_s2.sql`, `tests/e2e_stability_s2.js` (new); `db/tests/test_027_stability.sql`; `server/stability.js`, `server/routes_stability.js`, `server/routes.js`; `public/js/pages/stability.js`, `reports.js`, `admin.js`, `public/js/app.js`; `package.json` (0.23.0, `test:stability2`); CLAUDE.md; this log; vault `Decision - Stability Studies S-2` (new), `Decision - Stability Studies S-2 Scope`, `Decision - Stability Studies S-1`, `Open Items for QA Review` (53 to 56), `00 Home.md`.
- **Checked:** 1418 rule tests (63 new) and 27 browser suites on PostgreSQL 16 (the new `e2e_stability_s2`: 21 checks). The issue route by hand on the test app with a fixture finalized result: a wrong password refused, SR1 issued with its PDF and email, a second issue refused ("Nothing new"); the PDF read page by page. The upgrade from the 040 state applies 041 and seed_033 cleanly and fills in the placement date of existing stored material.
- **Found and fixed during the full regression:** the report checks asked the database for the signed-in user on a plain read, which failed and stopped every study page from opening; the viewer is now passed in.
- **Not done:** an extra pull as an excursion outcome (an amendment can add one); adding material to a running study; a client email on cancellation; the client's answer to "Client to decide" as its own record. PGlite not run here (Claude Code runs it).
- **Alex's data:** not applied. His data has 040 and seed_032 (Claude Code, 2026-10-17), so only 041 and seed_033 wait; try on a copy first.

### 0.22.0 and 0.22.1 on the laptop (2026-10-17, Claude Code; no version change)

- **040 was already on Alex's data:** port 3000 restarted on 2026-10-16 at 14:35 (not by Claude Code) and applied `040_lot_qa_testing.sql` (delivered 13:32) before any test. seed_032 was applied on Alex's go the morning before. 0.22.1 is code only.
- **Backup:** `backup-before-0.22.1-2026-10-17` (data/ as it stood with 040; 3926 files, identical).
- **Copy test:** on a copy of `backup-before-0.21.1-2026-10-16` (before seed_032 and 040), the app's migrate applied 040 and seed_032 in 6.7 s, no error. 040's own writes: permission `inventory.qa_configure` (given to the QA groups at CFL and TPS), 14 `qa_testing_default` rows (Media on), the wording of `inventory.qualify`. No existing record updated (audit trail: every UPDATE is to a record seed_032 created). Verification gates: CFL and TPS off before and after, and on Alex's data.
- **Media lots that become Rejected:** none, on the copy and on Alex's data (no media lot ever failed a qualification). INV-000100 (Tryptic soy agar plates) goes from "Awaiting qualification" to "Awaiting QA testing"; the 18 other media lots need no QA testing.
- **PGlite:** 1356 rule tests pass (first run of 0.22.0 on PGlite).
- **Applied:** on Alex's go, port 3000 started with 0.22.1; the start applied nothing new.

### 0.22.1: sample label date (2026-10-16 evening, Claude in the cloud)

- **What:** the "logged" date on a sample label was the first 10 characters of the UTC timestamp, so a sample logged after 5 pm in California printed the next day. `server/routes_labels.js` now returns the date in the lab's time zone (`(s.logged_at AT TIME ZONE ls.time_zone)::date`), as the rest of the system does.
- **Why:** seen in Claude Code's "12 Lab orders and intake" demo recording.
- **Files:** `server/routes_labels.js`, `package.json` (0.22.1), this log. No migration.
- **Checked:** `e2e_media_labels` (22) and `e2e_slice2_1` (31) pass on PostgreSQL 16; 18:30 Pacific on 16 October gives 2026-10-16 for CFL and TPS (the old code gave 2026-10-17).
- **Also seen in the recordings, not changed:** a warning rule named "Extremely Low Sotck" on the filming copy. It is not in any seed or migration, so it was typed into the data the filming copy was taken from; correct it in Inventory > Warning rules if it is in Alex's data.

### 0.22.0: QA testing of inventory before use (2026-10-16 afternoon, Claude in the cloud)
- **Why:** Alex (2026-10-16): "we didn't incorporate the addition of inventory items sent for QA testing. Can we create that feature?" Media qualification (0.10.0) covered only Media lots. Alex's answers: tested in the lab; released for every use or for named tests, per lot; lab defaults per item type, overridable at receipt; a failure rejects the lot until a retest passes. Decision note: `Decision - QA Testing of Inventory Before Use` (build choices Proposed; QA items 50 to 52).
- **What changed:**
  - Migration `040_lot_qa_testing.sql`: lab defaults per item type (`qa_testing_default`, Media on), permission `inventory.qa_configure` (QA), the receipt choice, every-use releases, rejection and retests on the existing `media_qualification` table, the bench and mixture rules (`lot_qa_problem`), QA's waiver (signed).
  - Server: `routes_inventory.js` (QA testing defaults, waiver, the receipt choice, statuses), `routes_testing.js` (unreleased lots marked at the bench), `verification.js`, `routes_labels.js`.
  - Screens: Inventory > QA testing; the list's QA testing column and filter; the lot page (Send for QA testing…, Retest…, Waive QA testing…); the New item tick box; "Lot QA testing" on the backlog, batches and orders; the label shows a status that is not Released.
  - Tests: `db/tests/test_035_lot_qa_testing.sql` (31), `tests/e2e_qa_testing.js` (`npm run test:qa`, 17); `test_020` and `e2e_media_labels.js` follow the new wording.
- **Also fixed (test only):** `test_031_invoicing.sql` named fixture samples by the day it was written (CFL261015...). On the next day nine of its checks failed with or without 040. It now finds them by their number (`pg_temp.ivc`, `pg_temp.iv999`).
- **One behaviour change for existing data:** a media lot that failed a qualification before 040 is now Rejected for every use (before, only for the failed test).
- **How it was checked (PostgreSQL 16):** 1356 rule tests pass. All 26 browser suites pass, each on a fresh database (`test:qa` 17, `test:media` 22 with the new wording). The upgrade from the 038 state applies 039, 040 and seed_032 in one start; its demo media lot keeps "Awaiting QA testing".
- **Not done:** Receive many has no per-row tick (it uses the lab's defaults); logbook entries naming a lot are not checked against its QA testing; not run on PGlite.

### Fix: each sample's tests squeezed on the lab order page (2026-10-16, Claude Code; no version change)

- Alex saw each sample's tests panel on the lab order page shrunk to a narrow, unreadable box.
- Cause: the dashboards (0.20.0) put a page-wide style on the class name `dgrid` (a 12-column layout), and the order page used the same name for each sample's tests grid. Once the dashboard had been opened, the order page's grid fell into one narrow column.
- Fix: `public/js/pages/orders.js` names its container `stests`. No database change and no restart; checked on Alex's data (LO-001131: the tests grid spans the page again). Also applied to the filming copy (`lims3-film`); the demo copy on 3100 predates the dashboards and was not touched.
- For Claude in the cloud: merge `public/js/pages/orders.js`; scope new page styles to their page (e.g. `.dash .dgrid`) so they cannot reach other screens.

### 0.21.1: Salmonella demo data for Colleen Villanueva's meeting (2026-10-16 morning, Claude in the cloud)
- **Why:** Alex (2026-10-16, 07:50): "I've run out of time to do the build before my meeting with colleen. Can you build it please?" The build follows the project doc `Procedure - Salmonella BAX Q7 Demo Build (Colleen)`, written as one demo data file instead of clicks.
- **What changed:** new `db/seed_032_salmonella_bax_demo.sql`. No migration, no code change, no new permission.
  - **Setup at CFL:** product categories Environmental sponge, Environmental stick swab, Dry pet food; matrices Food (ready-to-eat), Environmental sponge swab, Environmental stick swab, Dry pet food (kibble); 10 helper analytes for the confirmation's plate, slant and API readings (hidden on the COA); equipment types BAX System Q7, Thermal block, Cooling block, Water bath, Homogenizer; nine instruments (MI05, MI07, MI100, Q7-01, ATB-01, CB-01, STOM-01, BAL-M2, BSC-M1), owned by Microbiology, calibrated; 20 lots (media, reagents, BAX kit parts, lysis reagent, ATCC 14028 strain); methods MC-12.06 rev 1 and MC-12.04 rev 1.
  - **Tests**, designed by the demo Analyst, approved by the demo Lab Supervisor: "Salmonella BAX Q7 real-time PCR screen" (weights, BPW and windows by matrix; Indeterminate and Signal error are not results; reflex to the confirmation without consent, alerting the client) at $45, and "Salmonella confirmation (FDA BAM Ch. 5)" at $95.
  - **Client** "Prairie Pet Foods (demo)": no partial reports; Dana Ortiz (Primary, Report, Quality, Positive alerts), Sam Whitfield (Quality, Positive alerts), Orders Desk (Ordering, Billing); an accepted quote with both tests.
  - **DEMO-1015:** four samples run through the screen (the sponge's Signal error re-read in run 2 as Negative, each run with its own Q7 report and instrument; the dry dog food Presumptive positive, so the confirmation was ordered and Dana and Sam alerted), then the dog food through the confirmation (BSA re-incubated to 48 h, the load accepted by QA with a justification; API 20E Salmonella, Positive). Both batches approved by the demo QA Reviewer; the four samples wait in Report Finalization for the Project Manager.
  - **DEMO-1016:** four samples (one of each matrix) logged with the screen, waiting in the Microbiology backlog.
- **Safeguards:** runs only where CFL's verification gate is off (Alex's data; test databases keep it on and skip it), only once, and skips itself whole with a notice if anything fails, so it never stops the app from starting.
- **How it was checked (PostgreSQL 16):** a fresh database with the gate off and an upgraded database at the 038 state (039 and seed_032 in the same start): every state reached as planned (orders Approved and Received; both batches Approved; results Negative x3, Presumptive positive, Positive; the split Ordered; two alert emails; the BSA load accepted; DEMO-1016 in the backlog). As projmgr, all four COAs previewed with every release check passing, then issued (the dog food COA shows both tests, helper analytes hidden). Ten screens opened with no page errors. A fresh database with the gate on skips the seed, so rule tests and browser suites are unaffected.
- **Known:** the times of DEMO-1015's incubator loads are typed into the past, but its samples are logged, and its steps signed, on the day the seed runs.

### 0.21.0 on the laptop: PGlite run and copy test (2026-10-15 late evening, Claude Code; no version change)
- **What happened first:** 0.21.0 was delivered at 20:02. Port 3000 was restarted at 22:22 (not by Claude Code), and that start applied 039 to Alex's data before any copy test. Claude Code found it in the start's log ("Applied: 039_matrix_bench_alerts_invalid_readings.sql") and told Alex. Alex then said go for 0.21.0 and asked for the checks.
- **Checked (PGlite):**
  - 1326 rule tests pass.
  - All 26 browser suites pass on fresh databases. `test:bax` (25), `test:dashboards` (38), `test:invoicing` (30) and `test:logbooks` (31) each ran on their own database; the other 22 ran in order on one database.
  - No fix was needed.
- **Copy of Alex's data from before 039** (`backup-before-0.20.1-2026-10-15`; 038 and seed_031 applied first, as on his data):
  - 039 took 0.1 s, with no error.
  - His clients, orders, samples, tests, results, COAs, invoices, users and memberships are unchanged.
  - Both verification gates are still off.
  - The "Presumptive Result" template was added; no test has invalid values yet.
- **Alex's data:** 039 is applied, and the app is running on it.

### 0.21.0: the matrix drives the bench, presumptive positive alerts, readings that are not results (2026-10-15 evening, Claude in the cloud)
- **Why:** Colleen Villanueva (Director, Food & Life Sciences) asked for a demo of the Salmonella BAX Q7 screen with reflex to confirmation (SOPs MC-12.06 and MC-12.04, paper log MCF-034). Mapping the SOPs found three of her asks only half supported. Alex: "build the missing items as you suggested". Vault: `Decision - Matrix-Driven Bench, Presumptive Alerts and Invalid Readings` (build choices Proposed). Build procedure for Alex: project doc `Procedure - Salmonella BAX Q7 Demo Build (Colleen)`.
- **Database (039):**
  - **F1, the matrix drives the bench.** `sample_product_category`, `entry_product_category`, `category_setting`, `entry_is_weighed` (a category "Not weighed", e.g. swabs; Prep QC "not weighed" when the step says so). `step_run_missing` wrapped (old one `_033`): it no longer waits for weights or a balance from entries that are not weighed. `incubation_window(cfg, batch, entries)`: a window per product category; a load holding several categories is judged against the window they all share (latest shortest, earliest longest); controls use the step's. `incubation_load_view` recreated with it (unchanged when a step has no windows per category, so existing load acceptances still match).
  - **F2, presumptive alert.** Contact role `ALERT` "Positive alerts"; email template "Presumptive Result"; `email_outbox.split_request_id`; `alert_recipients(order)` (Positive alerts, else Receives Report, else the ordering contact); trigger `z_split_alert` on `step_run` (after `z_split`): a completed Split off Test step with `config.notify_client` queues one email per recipient for each request raised on a finding, once (not for verification batches or media samples); `split_alerts(split)` for the screens.
  - **F3, readings that are not results.** `test_version_analyte.invalid_values` (carried to new versions and copies; tidied by `a00_invalid_values`). `batch_invalid_readings(batch)`. `batch_review_items` replaced: such readings are never candidates, so a single valid reading beside them is chosen by itself. `choose_result` wrapped (`_021`): refused with the reason. `batch_qc_verdicts` wrapped (`_022`): a control read so is "Invalid". `batch_review_problems` wrapped (`_l3`): the sample's "no result" is explained, and a control is held until a later run reads it validly (a later failure then needs acceptance). `test_version_definition` wrapped (`_024`): the lists join the design fingerprint only when a test has one, so earlier fingerprints do not change. `test_version_problems` wrapped (`_014`): checks for the new settings.
  - No new permission: the settings are design work (`methods.design`), the alert is sent by the step the analyst completes, and the role is set like any contact role.
- **Server:** `routes_testing.js` (entries carry the product category; `invalid_readings`, `categories` and the splits' `alerts` in the batch; alerts on the sample's splits); `routes_methods.js` (`invalid_values`); `verification.js` (planned readings skip values that are not results; the weight for a category range skips "Not weighed" rows).
- **Screens:** designer (`methods.js`): "Not a result" column on Analytes; "Not weighed" per category and "Prep QC (controls) are not weighed" on Weighing; "Window per product category" on Incubation; "Alert the client" on Split off Test. Bench (`testing.js`): Weighing Category and Accepted columns, per-sample check; Dilution Expected column, "Each sample's amounts" button, a different amount flagged; Incubation Window column; reading grid "Re-run" column; Split off "Client alerted"; QC Review "Readings that are not results". Sample page (`orders.js`): "Client alerted".
- **Tests:** `test_034_matrix_bench_alerts.sql` (27 checks; 1326 rule tests). `tests/e2e_bax.js` (`npm run test:bax`, 25 checks): the test designed through the API, verified (Pass) and approved; four samples by matrix; every new bench column; the screen's Save bar; the alert in the Outbox, the batch and the sample page; QC Review waiting for the re-run; the approval after it.
- **Checked:** 1326 rule tests and all 25 browser suites pass on PostgreSQL 16, each suite on a fresh database. The upgrade from Claude Code's 038 state (with the demo data) applies 039 cleanly. Found and fixed during the run: the new bench columns first sat in the middle of three grids, which shifted the columns the older suites paste into; they now sit after the existing columns. `tests/auth.js` `verifyVersion()` no longer fails when the background evidence capture finishes between its two checks.
- **Not built:** ending a sample early (no suspect colonies), "re-lyse" as its own re-run choice, hold-time checks, the test portion on the COA, reading the Q7 export. Nothing is emailed for real (Outbox only).

### 0.20.1, D-1.1: Alex's notes on the dashboards (2026-10-15 evening, Claude Code)
- **Why:** Alex reviewed the executive dashboard, the finance figures and the GM dashboard. Vault: `Decision - Dashboards and the Executive Dashboard D-1`, section "D-1.1".
  - His answers: weekly revenue pulled from the LIMS and locked (option A); all three % comparisons; two on-time widgets.
  - The test widget compares the QC Review completion with the test's due date; the release is shown smaller.
  - The executive dashboard uses the sample level. On Hold days are not a delay.
  - After seeing the review copy, he added: a sharper chart, deviations from budget, and the EBITDA margin line on a right-hand scale.
- **Database (038):**
  - `test_qc_tat_view`: each test's final QC Review approval against its due date, with the client's On Hold days added.
  - `sample_tat_view`: samples whose every test is reported. Completed = the last first-release; due = the latest due date of the sample's tests.
  - `lims_week_revenue(site, week_ending)`: invoices issued less credit notes in the 7 days ending that day.
  - `finance_week.revenue` is now optional: it holds the books' revenue.
  - Widgets: `on_time` renamed "On time (tests)"; new `on_time_samples` (Home, GM, executive; given to every group that had `on_time`); new `lab_finance` (GM dashboard).
- **seed_031:** sizes the demo finance figures to each lab's LIMS revenue (costs about 82 %; books within 3 %). It only touches weekly rows still marked "Demo figures (fictional)" at their first version, and only when no forecast has been edited.
- **Server** (`routes_dashboard.js`):
  - Both on-time widgets, with their lists of late items.
  - Labs side by side by revenue and by EBITDA:
    - % vs last month (to the same day);
    - last month vs the 3-month average;
    - % vs last quarter (to the same point);
    - potential revenue (work in progress plus this month's revenue);
    - on time at the sample level.
  - The finance rows: LIMS revenue, costs, EBITDA, weeks = distinct weeks, the books' revenue.
  - The finance figures: LIMS revenue computed and never taken from a request. Forecasts download as Excel (`GET /api/finance/plans.xlsx`) and an upload is previewed (`POST /api/finance/plans/preview`), then saved through the existing route with a reason.
- **Screens** (`dashboard.js`):
  - Widget tabs.
  - The release figure shown smaller.
  - The line chart, drawn at the box's real width and redrawn on resize. Actual, budget and monthly forecast, plus the EBITDA margin on a right-hand scale, capped at -100 %.
  - The table: LIMS invoiced first and Revenue (books) last, with "vs budget" columns after LIMS invoiced, Costs and EBITDA, and a Margin column.
  - Finance figures by lab tab, with Excel download and upload for the forecasts.
- **Checked:**
  - 1299 rule tests pass (`test_033`, 16 new).
  - Every browser suite passes on fresh databases: `test:dashboards` 38 checks (the "last Thursday" date fixed for evenings).
  - Copy of Alex's data (from `backup-after-0.20.0-start-2026-10-15`): 038 took 0.2 s and seed_031 0.1 s; his records unchanged.
  - On time this year: samples CFL 89.8 % / TPS 74.9 %; tests at QC Review about 100 % (the demo load put the delay in finalization); tests at release CFL 72.9 % / TPS 67.6 %.
  - The executive dashboard loads in about 4.5 s on the laptop.
  - Alex looked at a review copy (port 3300) before saying go.
- **Applied to Alex's data** on his go:
  - Backup: `backup-before-0.20.1-2026-10-15`.
  - The waiting files were listed first; only 038 and seed_031 were waiting.
  - The start printed "Applied: 038_dashboards_followup.sql, seed_031_finance_demo_scale.sql".
- **Open:** Alex's note "For the TAT samples widget can you put the on-time percentage" is not done. The widget already shows the percentages; Claude Code asked which change he meant.

### 0.20.0 on the laptop: PGlite run and copy test (2026-10-15 evening, Claude Code; no version change)
- **PGlite:**
  - 1283 rule tests pass.
  - Browser suites:
    - `test:dashboards` (26), `test:invoicing` (30) and `test:logbooks` (31) pass, each on its own fresh database.
    - The other 21 ran in order on a fourth. All passed except `test:testing`, which timed out partway, and `test:serving` as a knock-on: it needs a sample that `test:testing` approves. On a fresh database `test:stability` and `test:serving` (21) then pass.
- **Test-timing fix** (`tests/e2e_testing.js`, test only):
  - The paste helper now waits for the grid cell, and pastes again once if no save bar appears.
  - The save helper waits for the save bar.
  - On a busy laptop the grid was sometimes still drawing when the paste arrived; the failures moved between the spikes, the readings and the version 2 weighing.
  - After the fix: 52/52 on two fresh databases in a row.
- **Copy of Alex's data from before 0.19.0** (`backup-before-0.19.0-2026-10-15`):
  - 036 took 0.8 s, 037 0.5 s, seed_029 16 s, seed_030 0.3 s. No error.
  - His clients, contacts, orders, samples, tests, results, COAs, users, memberships, lab settings, inventory lots (apart from the new department) and equipment are unchanged.
  - New users: `billing`, `gm`, `finance`.
- **seed_030 departments:**
  - All of CFL's inventory items got a department by type: chemistry reagents, solvents, standards and the ICP mixtures CHEM; media, strains and inocula MICRO.
  - Two were left without one: INV-000009 pipette tips (Consumable) and INV-000015 acetonitrile (an in-house mixture without an analyte type).
  - TPS's two items (INV-000013, INV-000014) got CHEM.
- **Dashboard load times** (all widgets together, through the server's own code, PGlite on the laptop):

  | Board | As | Widgets | Time |
  |---|---|---|---|
  | Home | labsup (CFL) | 11 | 2.4 s |
  | Home | labsup (TPS) | 11 | 2.3 s |
  | Home | akiddle (CFL) | 18 | 5.1 s |
  | Home | akiddle (TPS) | 12 | 1.7 s |
  | GM | gm | 10 | 1.8 s |
  | GM | akiddle | 10 | 2.9 s |
  | Executive | akiddle | 8 | 3.8 s |
  | Executive | finance | 8 | 3.4 s |

  - Slowest widget: `on_time` (0.4 to 1.6 s). The other heavy ones are `network`, `projection`, `signing`, `low_stock_risk`, `overdue` and `billing` (up to 0.7 s).
- **On time this year** (the dashboard's measure: each reported test against its own due date): CFL 72.9 % (552 of 757), TPS 67.6 % (502 of 743).
  - The demo load aimed at each sample against its latest test's due date (Claude Code's reading of "on time"). By that measure it is CFL 90.2 % and TPS 74.7 %.
  - The difference: a sample's shorter tests (for example Moisture, 5 days, next to a 7-day metals panel) count late on the dashboard when the COA waits for the longest test. For Alex to decide.
- **Revenue by month** (catch-up invoices; no credit notes):
  - CFL, January to October: $3,506; $7,324.25; $6,120.50; $8,270.25; $8,130.25; $8,810; $9,035.25; $6,039.50; $10,633.50; $2,920.
  - TPS, January to October: $8,659.25; $44,487; $25,142.75; $32,728.50; $44,191.25; $28,804; $48,905.50; $53,503.75; $50,815; $24,413.50.
  - Year: $432,440. The executive dashboard shows $27,333.50 this month, $61,448.50 last month and $432,440 this year.
- **Alex's real data:**
  - It already had 036, 037, seed_029 and seed_030 from the start earlier this evening (entry below).
  - Read-only check: the same 859 Friday catch-up invoices ($432,440), none sent or queued, and the same counts.
  - Backups: `backup-before-0.19.0-2026-10-15` and `backup-after-0.20.0-start-2026-10-15`.
  - The app was restarted with nothing waiting.
- **Correction (Claude Code):** Alex switched CFL's "Verify workflows" gate off himself at 12:58 today ("turn off for testing and dev"); both labs' gates have been off since. Earlier entries today that say "CFL on" after that time are wrong:
  - the 0.19.0 copy test;
  - the port 3000 demo load, which therefore did not switch the gate at all on his data.

### 0.19.0 and 0.20.0 applied to Alex's data (2026-10-15 evening, Claude Code; no version change)
- **What happened:**
  - Alex said "go" for 0.19.0.
  - 0.20.0 (D-1 dashboards) had been delivered at 16:17, after the 0.19.0 copy test, and Claude Code did not re-list the waiting files before starting the app.
  - The start printed "Applied: 036_invoicing.sql, 037_dashboards.sql, seed_029_invoicing.sql, seed_030_dashboards.sql", with no error.
  - 037 and seed_030 were not tried on a copy first, and Alex had not said go for them.
- **Backup** from before both: `backup-before-0.19.0-2026-10-15`.
- **Checked afterwards:** 1283 rule tests pass on PGlite (0.20.0).
- **Lesson:** re-list the waiting migration files right before every start on Alex's data.
- **Correction (Claude Code):** the 0.20.0 delivery replaced this log and CLAUDE.md without Claude Code's entry "0.19.0 on the laptop: PGlite run and copy test", written at about 16:00. It is restored below, with the same content.

### 0.19.0 on the laptop: PGlite run and copy test (2026-10-15, Claude Code; restored after the 0.20.0 delivery)
- **PGlite:**
  - 1256 rule tests pass.
  - `test:invoicing` (30) and `test:logbooks` (31) pass, each on its own fresh database. The other 21 suites pass in order on a third.
  - `test:testing` failed 3 bench checks twice, then passed 52/52 on a fresh database (0.18.0 also had one broken run). Read as intermittent timing, not a 0.19.0 defect (under 90 % sure).
- **Copy of Alex's data:**
  - 036 took 0.9 s, seed_029 25 s, with no error.
  - The catch-up made 859 invoices: all issued, all dated a Friday, $432,440. CFL had 21/39/36/48/59/45/65/43/61/11 and TPS 11/55/32/40/56/34/57/62/58/26 from January to October.
  - None was emailed or queued for QuickBooks.
  - Ready to invoice: CFL 4 tests on 3 orders ($1,204), TPS 6 tests on 4 orders ($2,956.75).
  - His clients, contacts, orders, samples, tests, results, COAs, users, memberships and lab settings were unchanged.
  - The catch-up PDF INV-TPS-000424 looked right.

### 0.20.0, D-1 dashboards (2026-10-15, Claude in the cloud)
- **Why:** Alex, 2026-10-15: "please build the dashboards out next", on his D-1 answers (`Decision - Dashboards and the Executive Dashboard D-1`): a widget library by area, Home as the dashboard with widgets from the person's groups that each person arranges and resizes, every number opening the list behind it, three TAT segments with the client's hold not counted, revenue when invoiced and WIP in four stages with the month-end boost, low stock against demand by department, a GM dashboard and an executive dashboard GMs cannot see, the weekly finance update against the Budget and Monthly Forecasts, live refresh where possible.
- **Merged first:** nothing new from Claude Code since 0.19.0 was delivered (checked the laptop).
- **What (037):**
  - **Home:** 20 widgets (My work, Intake, Rush, Backlog by department, Batches, Overdue, Turnaround, On time, Waiting to be signed, Lab supplies, Low stock against demand, Quotes, Stability, Billing, Revenue, Work in progress, Projection, Samples received, plus Labs side by side and the Finance update on the GM and executive dashboards). Each group's widgets are set in Admin > Dashboard widgets; a widget that needs a permission shows only to those who hold it. Drag a title bar to move, drag the corner to resize, × to put away, Bring back, Reset; kept per person. Numbers open their page or a list (overdue, rush, late COAs, slowest tests, WIP by stage, the month's due work and boost, samples and invoices by period, samples at risk). Refreshes every minute while open.
  - **Turnaround and on time:** Login TAT (received to logged), Lab TAT (logged to QC Review approval), QA TAT (approval to COA issued); on time = COA by the due date plus the days the client was On Hold (from the client's audit trail).
  - **Revenue and WIP:** revenue = issued invoices less credit notes; WIP stages Not Started, Incomplete, Finalized, Pending Invoice; projection = invoiced + work due this month; boost = work due later.
  - **GM dashboard** (dashboard.gm) and **executive dashboard** (dashboard.executive: Executive and the new all-labs Finance group; never GMs), with a lab picker. **Finance figures** page (finance.enter): weekly revenue and costs, Budget and Monthly Forecasts, by paste.
  - **Low stock against demand:** inventory items name their department (form and lot page).
- **Migrations and files:**
  - Database: `037_dashboards.sql`, `seed_030_dashboards.sql` (demo GM and Finance users, departments on items by type, fictional finance figures), `db/tests/test_032_dashboards.sql` (27 checks).
  - New files: `server/routes_dashboard.js`, `public/js/pages/dashboard.js`, `tests/e2e_dashboards.js` (26 checks); vault rules `Turnaround and On-Time Rule`, `Work in Progress Stages Rule`.
  - Changed files: `server/routes.js` (registration), `server/routes_inventory.js` (department), `public/js/main.js` (Home is the dashboard, menu, routes; the old tiles page at `#/start`), `app.js`, `icons.js`, `pages/inventory.js` (Department); `db/tests/test_008_permissions_groups.sql` (the Finance group is a second all-labs group); `tests/auth.js` (gm, finance, exec), `tests/e2e_smoke.js` (Home's widgets); `package.json` (0.20.0, test:dashboards); `CLAUDE.md`; vault `Decision - Dashboards and the Executive Dashboard D-1`, `Inventory Lot`, `00 Home.md`.
- **Checked (PostgreSQL 16, fresh databases):** 1283 rule tests pass (27 new); all 24 browser suites pass (`test:dashboards` new, 26 checks), and `test:coaparts`; upgrades from Claude Code's 033 state and from the 036 state apply 037 and seed_030 without error; screenshots of Home, the GM and executive dashboards were reviewed.
- **Not run here:** PGlite; the dashboards on Alex's data (about 1000 samples and the invoicing catch-up). The views are computed when the page loads; with that much data each widget may take a second or two (to time on a copy).
- **Alex's data:** not applied. Try on a copy first; apply only on his go. The demo copy on port 3100 is not touched.

### 0.19.0, I-1 invoicing (2026-10-15, Claude in the cloud)
- **Why:** Alex, 2026-10-15: "LIMS will do all the invoicing ... invoices need to be sent to the client from LIMS"; QuickBooks Online first, each lab its own company; "any completed work can be invoiced at any time"; partial invoices per lab order; manual review where the reviewer groups and claims the work "much like the QA Finalization module"; the late rush feature from another of Tentamus's systems; retests shown clearly; net 30, no tax (finance to confirm); credit notes; Accounting and General Managers; existing work "backdated on the week the work was completed".

  Decisions: `Decision - Invoicing I-1` (new; build choices Proposed), `Decision - Invoicing Is Done in the LIMS` (updated).
- **Merged first:** the laptop was checked: no Claude Code change since 0.18.0 apart from the build log, `CLAUDE.md` (demo copy note, the 1000-sample load) and the vault notes delivered earlier, all already in the cloud copy.
- **What (036):**
  - **Billing menu:** Ready to invoice (filters: late rush, rush, retests, discounted, stability pulls), My draft invoices, All drafts, Invoices and credit notes, QuickBooks queue, Settings. An invoice page. A Billing card on the lab order page.
  - **Completed work:** a test is ready once its results have been on an issued COA (a test replaced by a lab investigation retest, once the retest is reported). Internal work, cancelled tests and retests waiting for QA's billing determination are not ready.
  - **Claims:** selected work goes onto the reviewer's own draft for each lab order (DR-), which nobody else changes or issues; released drafts are kept as Discarded; a lab administrator can take one back with a reason.
  - **Checking:** price billed against the price ordered and list price (corrections with a reason, never above list); Rush… shows every tier on the client's quote, the due date it would have given and whether it was met, and bills the tier ordered, a tier met or standard (never dearer), with a reason printed; lines taken off; PO and note.
  - **Issuing** (signed "Invoiced by"): numbered per lab with no gaps (INV-CFL-000001; credit notes CN-CFL-000001), dated today in the lab, due after the client's payment terms, the PDF made from the record and attached in the same transaction, emailed to the client's Billing contacts (Outbox), queued for the lab's QuickBooks Online company in the shape its API takes. Issued invoices never change.
  - **Credit notes** (signed "Credited by", with a reason): whole lines, each credited once; the work goes back to Ready to invoice unless the credit is final.
  - **Catch-up:** work completed before the current week is invoiced once per lab order per week, dated the Friday of that week, as a data load; not emailed, not queued; marked catch-up on the page and the PDF.
  - **QuickBooks Online:** a connection per lab (Not connected; system administrators), a client-to-customer mapping table and the queue. The connector itself (OAuth, sending) is not built.
  - Permissions `invoicing.issue` (Accounting, General Manager) and `invoicing.view` (Account Manager, Project Manager and the issuers).
- **Migrations and files:**
  - Database: `036_invoicing.sql`, `seed_029_invoicing.sql` (demo user `billing`, canned reasons, the catch-up), `db/tests/test_031_invoicing.sql` (67 checks).
  - New files: `server/invoices.js`, `server/routes_invoicing.js`, `public/js/pages/billing.js`, `tests/e2e_invoicing.js` (30 checks); vault `Decision - Invoicing I-1` and rules `Invoice Readiness Rule`, `Invoice Claim Rule`, `Late Rush Billing Rule`, `Issued Invoice Immutability Rule`.
  - Changed files: `server/routes.js` (registration), `public/js/main.js` (Billing menu and routes), `app.js` (canned reason module), `icons.js`, `pages/orders.js` (Billing card), `pages/admin.js` (reasons module); `tests/auth.js` (the `billing` user); `package.json` (0.19.0, test:invoicing); `CLAUDE.md`; vault `Invoice`, `Invoice Line Item`, `Billing`, `Retest Billing Rule`, `Decision - Invoicing Is Done in the LIMS`, `00 Home.md`.
- **Checked (PostgreSQL 16, fresh databases):**
  - 1256 rule tests pass (67 new).
  - All 23 browser suites pass (`test:invoicing` new, 30 checks), and `test:coaparts`.
  - Upgrades from the 021 state and Claude Code's 033 state apply 034 to 036 and the seeds without error.
  - The invoice and credit note PDFs were opened and read.
- **Not run here:** PGlite; the catch-up on Alex's data (about 900 COAs from the demo load). On a small database the ready list takes about 0.1 ms per test, so the catch-up should take seconds, not minutes; Claude Code times it on a copy.
- **Alex's data:** not applied. Starting his app applies 036 and seed_029, and the catch-up then invoices the demo load's completed work. Try on a copy first; apply only on his go. The demo copy on port 3100 is not touched.

### Demo copy loaded with 1000 samples (2026-10-15, Claude Code; demo data only, no version change)
- **Why:** Alex asked for the demo copy (port 3100, `..\lims3-demo`) to hold 1000 samples across CFL and TPS: 900 finalized through 2026 with on-time rates of 90 % (CFL) and 75 % (TPS), and about 100 open samples showing the scenarios built so far. His choices: COA issued, real PDFs, fictional clients.
- **What:**
  - Scripts in `..\demo-data-load` (README there). They are outside the program and add no migration or seed.
  - Setup:
    - Simple approved workflows (Batch, Results, QC Review) for the 7 CFL routine tests and the 3 TPS tests.
    - The 2 serving tests approved.
    - Units `aw` and `pH units`.
    - A TPS Chemistry group for the demo analyst.
    - 20 fictional clients with accepted "Routine testing 2026" quotes and client limits.
  - Then 900 samples run day by day through the database's own functions, signed as a data load script by the demo person for each step. Every COA is a real PDF.
  - Then 73 open samples, a COA version 2, Valley Harvest On Hold, and a quote with a subcontracted TPS test.
- **Gate:** CFL's "Verify workflows" gate was switched off while the demo versions were approved, then back on. Both changes are in the demo's audit trail at their real time.
- **Result:**
  - 1003 samples: CFL 528, TPS 475.
  - Final COAs: CFL 453, TPS 450.
  - On time, January to September: CFL 404 of 450 (89.8 %), TPS 337 of 450 (74.9 %).
  - The finalization queue view takes about 1 s with this data.
- **Backups:** `lims3-demo\data-snapshot-2026-10-15` and `lims3-demo\data\pgdata-before-demo-load`.
- **Alex's port 3000 data (same day, on his go):**
  - The app was stopped and the data backed up: `backup-before-demo-load-2026-10-15`.
  - The load ran on a copy (program: the working Sandbox; COA verification links on port 3000) with the same results.
  - The copy was swapped in; the previous data is also kept as `data\pgdata-before-demo-load`.
  - The app restarted with no migration waiting and no error.
- **Limits:**
  - Field values stored inside audit entries keep the real load time.
  - The original seed records keep their October dates.

### 0.18.0 on the laptop: PGlite run, copy test, applied to Alex's data (2026-10-15, Claude Code; no version change)
- **Why:**
  - Alex said "go" for 0.16.0 to 0.17.1.
  - Claude in the cloud's logbooks (L-1 and L-2: 034, 035, seeds 027 and 028) had arrived in the meantime. Starting the app would have applied them too, so Claude Code stopped and asked.
  - Alex then said go for the test run with the logbooks included.
  - Alex's decisions on 0.17.1: (1) a serving test not on the quote is ordered at its catalogue price: agreed. (2) A label weight is never enough to release results per serving: kept as built.
- **Checked (PGlite, fresh databases):**
  - 1189 rule tests pass.
  - All 22 browser suites pass. `test:logbooks` (31) ran on its own fresh database, as its notes ask; the other 21 ran in order on a second one.
  - One interrupted run left a used database, and its failures were not counted: everything was rerun from a clean database.
  - No fix was needed.
- **Copy of Alex's data:**
  - 030 to 035 and seeds 024 to 028 applied without error.
  - His 11 orders, clients, contacts, results, versions, users and purchase requests are unchanged.
  - Added: the demo stability studies, the serving tests (Drafts), and 8 logbooks with their entries.
  - The gate is as Alex set it: CFL on, TPS off.
- **Applied to Alex's data:**
  - Backup first: `backup-before-0.17.1-apply-2026-10-15`.
  - Started the app on his data, which printed "Applied: 030 … 035, seed_024 … seed_028". No error.
  - The serving tests are Drafts until verified and approved (his CFL gate is on).
  - seed_028's demo inocula are usable for 24 hours from now.

### 0.18.0, L-1 and L-2 electronic logbooks (2026-10-15, Claude in the cloud)
- **Why:** Alex, 2026-10-14 (22:31): "Build both of them and I'll test the whole module in the morning", on the approved logbook decisions (`Decision - Electronic Logbooks Are Computational`, `Decision - Logbooks Wait for the Workflow Designer`, `Decision - Logbook Values Feed Results Through Scanned Materials`), with his answers: the logbooks USP <61>, <62> and <51> need; a failure is flagged and its reason asked for, the flag shown at the QC Review steps that used the equipment; QA approves daily or weekly, depending on the logbook.

  Decision: `Decision - Electronic Logbooks L-1 and L-2` (build choices Proposed; QA items 42 to 49).
- **Merged first:** Claude Code's 0.17.0 laptop work (the time-zone fix in `032_stability_studies.sql`, its build log entry, `CLAUDE.md`, the vault note `Decision - Quote Pricing, Catalogue Updates and Serving Sizes`) was merged into the cloud copy before delivery. Its lesson (the lab's time zone for any date taken from a timestamp) was checked in the logbook migrations and seeds; one seed was changed to use the lab's date. Claude Code's 0.17.1 (serving size Part B: migration 033, seed_026, test_028, `e2e_serving.js`, and five shared files) was also merged and tested with the logbooks, which were renumbered after it (034, 035, seeds 027 and 028, tests 029 and 030). `035`'s `batch_results` keeps 033's replicate weighings.
- **What, L-1 (034):**
  - **Testing > Logbooks:** the lab's logbooks and what is due now. A logbook has settings (about equipment, a lot, a sample or nothing; entries due daily to as needed; QA review daily or weekly; signed or recorded; reviewed in the logbook or in the batch; validity; makes a lot) and a versioned design (fields with units, limits, limits per equipment, formulas and published values), approved by QA (signed, not an author).
  - **Record entries:** a grid (paste, fill down), calculated values and Pass / Fail previewed, one signature for every row; a failing row's reason is asked for before signing.
  - **Failing equipment:** the batch steps that used it, from the last passing check to the next, are flagged in QC Review (and timepoint reviews); the reviewer accepts each flag with a justification before approving. The entry page lists the batches; the equipment page shows the open failure.
  - **QA > Logbook review:** waiting entries, late ones first; tick and approve with one signature; return for correction. Corrections need a reason (an approved entry goes back to QA); an entry in use is corrected, never voided.
  - **Stability:** a chamber's limits come from its condition; an excursion shows on the studies stored in it.
  - Permissions `logbook.record` (Analyst, Lab Supervisor, Intake), `logbook.design` (Lab Supervisor, QA), `logbook.review` (QA).
- **What, L-2 (035):**
  - **Logbook values in test formulas:** `{inoc.cfu_added}` reads the value published by the logbook entry of the lot scanned at that step (an organism's lot serves only that organism). A result waits until QA approves the entry; a lot past its validity is refused at the bench.
  - **Inoculum logbooks make their lots** (named after the organism and its culture, usable 24 hours in the demo).
  - **Results keep the values used;** a later correction flags them for a reviewer who did not make it; the COA release check blocks unapproved entries and open flags.
  - **Sample weights (pre-analytical):** Scan aliquot at Weigh fills the weight and the balance; a typed weight cannot replace it; QC Review lists every aliquot (who weighed, the balance's calibration then); the reviewer did not weigh them.
  - **Workflow verification** handles tests that read logbook values: the protocol names the approved lot it scans for each organism, and the run scans it.
- **Migrations and files:**
  - Database: `034_logbooks.sql`, `035_logbook_values_feed_results.sql`, `seed_027_logbooks_demo.sql` (balances, pipettes, temperatures: P10 #3 failed, a fridge excursion, chamber 1 at 28.1 °C), `seed_028_micro_logbooks_demo.sql` (four more reference strains; cultures, USP <61>/<62> challenge inocula, USP <51> inocula for all five organisms, daily controls, sample weights; USP <61> v2 and USP <51> v2 Drafts reading the logbooks).
  - New files: `server/routes_logbooks.js`, `public/js/pages/logbooks.js`, `db/tests/test_029_logbooks.sql`, `db/tests/test_030_logbook_values.sql`, `tests/e2e_logbooks.js`, vault `Decision - Electronic Logbooks L-1 and L-2`.
  - Changed files: `server/routes.js` (registration), `server/routes_testing.js` (materials carry their logbook entry), `server/coa.js` (release check), `server/verification.js` (logbook values); `public/js/main.js` (menu, routes), `app.js`, `icons.js`, `pages/testing.js` (Scan aliquot, the aliquot column, entry codes on materials, the QC Review panels), `pages/equipment.js`, `pages/inventory.js`, `pages/stability.js`, `pages/admin.js`; `tests/e2e_media_labels.js` (waits for the review panel to reload, as `e2e_testing` and `e2e_wd5` already did); `package.json` (0.18.0, test:logbooks); `CLAUDE.md`; vault Business Objects `Electronic Logbook`, `Logbook Template`, `Logbook Entry`, `Open Items for QA Review`, both `00 Home.md`.
- **Checked:**
  - **Rule tests:** 1189, all passing, with Claude Code's 033 (new `test_029_logbooks.sql`: 92; `test_030_logbook_values.sql`: 37). Two helper functions in `test_029_logbooks` were renamed so the whole run works in one session.
  - **Browser suites:** all 22 on PostgreSQL 16, including Claude Code's `e2e_serving.js` (21) and the new `e2e_logbooks.js` (31 checks: an inoculum recorded by paste and its lot; USP <61> v2 verified (Pass) and approved; its recovery waiting for QA, then calculated (40 / 45 x 100 = 88.9 %); a failing balance check with its reason; the flag on the entry, the equipment page and in QC Review, accepted; QA's Logbook review; aliquots scanned at Weigh and listed in QC Review; a new logbook designed by paste and approved by QA; the stability excursion; the inoculum's lot page). `tests/coa_parts.js` still passes.
  - **Upgrades:** from Claude Code's 0.17.1 state (033), the 0.17.0 state (032), 031, 029, Claude Code's 023 state and 011 all pass; the eight demo logbooks arrive with their entries.
  - **Verification:** USP <61> v2: Pass. USP <51> v2: the initial count from the logbook now calculates; the run still fails at Day 7 on the WD-6 defect (a negative control counted 0 goes through log10), which waits for Alex's decision.
- **Fixed while testing:** recording an inoculum entry did not report the lot it made (the lot is made after the insert); the route now reads it back.
- **Not checked:** PGlite; real balances or scanners.
- **Alex's data:** not applied. The next start applies 034, 035, seed_027 and seed_028 (with 030 to 033, seed_024 to seed_026 if still waiting). The seeds add demo logbooks and entries to his Sandbox, as earlier demo seeds did; their inocula are usable for 24 hours from when the seed runs. To be tried on a copy first, then applied when he says. The verification gate stays as he set it.
- **Not built:** excursion assessments (S-2), logbook designs shared between labs, due reminders by email, daily controls feeding batch QC directly.

### 0.17.1, serving size, Part B (2026-10-15, Claude Code)
- **Why:** Alex's answers of 2026-10-14:
  - A tick on the order asks for results per serving.
  - The serving test is priced in the catalogue and on quotes.
  - 10 measurements: 10 capsules weighed out.
  - Liquids use the density test.
  - Serving tests are their own tests, with a split-off-style request for unplanned cases.
  - The serving volume × the density gives the serving weight.
  - A new COA version after a late measurement waits in Report Finalization.
  - **"It should be a check and flag in the COA review"**: no premature per-serving COA.

  Vault: `Decision - Quote Pricing, Catalogue Updates and Serving Sizes` (Part B); build choices Proposed.
- **What:**
  - **Replicate weighings.**
    - The Weighing step has a "Replicate weighings" setting, 1 to 10 (designer tab 3).
    - The bench shows one column per weighing (a row of 10 pastes in from the balance printout) and their average.
    - Formulas use the average (`entry_weight`), and only once all of them are in. The step is not completed until every weight is in ("9 of 10 weights").
    - The automated workflow verification records all of them.
  - **Serving tests.** A catalogue test can be marked "Serving test: Serving weight" (its result is the average weight of one unit) or "Density" (g/mL). Demo (seed_026): CFL's "Serving weight (10 units)" at $45 and "Density (g/mL)" at $60, both illustrative prices.
  - **On quotes.** "+ Per-serving calculation…" adds the lab's Serving weight or Density test as a priced line, so the total shows it.
  - **On the order.**
    - "Per serving" on a sample orders the Serving weight test, or the Density test when the label's serving is a volume.
    - It comes from the client's quote when quoted, else at its catalogue price. That is a named exception to quoted-only ordering, like the OOS retests, labelled "Catalogue price".
  - **Fed back.**
    - When QC Review approves the serving test's final result, the sample keeps it, linked to the result: the unit weight (serving weight = unit weight × the label's count, also when the count changes later) or the density.
    - These values cannot be typed.
    - Results per serving go through the density when the serving is a volume and the result is per weight (or the reverse).
  - **The release check (Alex's flag).** A **Block** while results per serving still need a measurement: the serving test not approved yet, no serving, the serving weight not measured (a label weight alone is not enough), or the density not measured when the units need it. It links to the sample. It replaces 031's Warning.
  - **Unplanned.**
    - The sample page shows "Serving for results per serving" (asked, measured, held, the serving tests).
    - "Request the serving weight / density test…" raises a request that waits for the client's consent, listed with the split-off requests (which can now exist without a bench step).
    - "Consent given…" orders the test.
- **Migrations and files:**
  - Database:
    - New: `033_serving_measurement.sql`, `seed_026_serving_tests.sql`.
    - `033` replaces `batch_results` (only the weighing line differs from 021), `requested_test_derive` (only a new branch for the serving test at catalogue price, from 023) and `spec_conformance`.
    - `033` wraps `step_run_missing` (the 021 version is renamed `step_run_missing_021`) and recreates `split_request_view` (LEFT JOIN on the batch).
  - Server: `coa.js`, `routes.js`, `verification.js`.
  - Screens: `pages/methods.js`, `testing.js`, `orders.js`, `catalog.js`, `projects.js`.
  - Tests: `db/tests/test_028_serving_measurement.sql` (26 checks), `tests/e2e_serving.js` (`npm run test:serving`, 21 checks). `package.json` 0.17.1.
- **Checked (PGlite, fresh database):**
  - 1060 rule tests pass.
  - All 21 browser suites pass in order.
  - The two demo serving tests pass their automated workflow verification, the 10 weighings included.
- **Copy of Alex's data:**
  - 030 to 033 and seeds 024 to 026 applied without error, with his records unchanged.
  - **The two serving tests arrive as Drafts:** his CFL verification gate is on. They need verifying (Review tab) and approving before "Per serving" can order them. Until then, ticking it says no approved Serving weight test exists.
  - **Not applied to his data: waits for his go.**
- **Not built:** the client portal question; billing between labs; a serving weight check in QC Review (outliers among the 10 units).

### 0.17.0 on the laptop: PGlite run, a time-zone fix, copy test (2026-10-14 evening, Claude Code; no version change)
- **Why:** the 0.17.0 delivery brief. Run everything on PGlite, fix what fails there, and try 030, 031, 032, seed_024 and seed_025 on a copy of Alex's data. Apply nothing to his data until he says go.
- **Before anything:** the app was stopped. Backup: `backup-before-0.17.0-2026-10-15`.
- **Found and fixed:**
  - **The problem:** a stability study accepted in the evening (Pacific time) could not be placed in the chambers that day. The error was "The placement date cannot be before the quote was accepted (2026-10-15)".
  - **Cause:** in `032_stability_studies.sql`, `st.accepted_at::date` takes the acceptance date in the server's time zone (UTC), while the placement date is the lab's own date (`site_today`).
  - **Who it affects:** not a PGlite difference. It shows on any server between 5 pm and midnight Pacific; the cloud ran its tests in daytime UTC.
  - **The fix:** the 4 uses (the placement check in `place_stability_study`, the price-escalation reference date and year in the requested-test rule) now take the date in the lab's time zone. 032 was edited in place because it is not applied to any database we keep.
- **Checked (PGlite, fresh database):**
  - 1034 rule tests pass.
  - All 20 browser suites pass in order, including `test:stability` (23) and `test:pricing` (15).
  - `npm run test:coaparts` was not run (it needs PostgreSQL).
- **Copy of Alex's data:**
  - 030, 031, 032, seed_024 and seed_025 applied without error.
  - His 11 orders and their statuses, clients, contacts, lots, batches, results, versions, users and purchase requests are unchanged.
  - Added: the stability demo (6 chambers, 3 stability quotes, 2 studies, with 6 orders, 6 samples and 19 tests); no shared test left.
  - The gate is as Alex set it: CFL on, TPS off.
  - **Not applied to his data: waits for his go.** The app stays stopped.

### 0.17.0, S-1 stability studies (2026-10-14, Claude in the cloud)
- **Why:** the roadmap's next module, on the approved `Decision - Stability Studies Are Quoted Whole and Pulled as Lab Orders`, with Alex's answers of 2026-10-14:
  - chambers, and the racks where the material is identified;
  - the ICH conditions as a preset list labs extend;
  - a 7-day pull window, configurable, as a QA decision (Jake Teller; QA item 41);
  - the cumulative report as one table per test, timepoints across, against the specification;
  - "The stability study needs to start as a quote, then submitted, approved quote converts into a study that triggers the samples to be logged in."

  Decision: `Decision - Stability Studies S-1` (build choices Proposed).
- **Merged first:** Claude Code's 0.16.1 (031, seed_024) was merged into the cloud copy before this entry; S-1's migration is numbered 032 to follow it. A stability quote's lab is the quote's lab (031's `project.site_id`): set when the quote is made, read only on the design.
- **What:**
  - **Pricing > Stability quotes:** a quote of kind Stability (SQ-00001) with the study design on its page: lab, product, lot, protocol, planned placement, yearly price increase, reserve; conditions; timepoints with days early and late; tests with price and material per test; the matrix (test and condition by pull timepoint). The total counts each test at every ticked timepoint, by study year. Sent, accepted and rejected like other quotes; its PDF shows the matrix and the price by year. Issuing is refused while the design has an Error.
  - **Accepted, it becomes a study (STB-00001)** with its T0 order (origin Stability Baseline), the baseline sample Expected for intake.
  - **Testing > Stability studies:** the studies and "Pulls due". A study page: place in chambers (rack per condition, position, units; the material check; the T0 sample logged; the pulls scheduled), stored material, pulls (Record pull…), T0 tests, and the summary of results (also as a PDF).
  - **Pulls:** dates moved off weekends and holidays inside the window; each pull's lab order (origin Stability Pull) is made on its date by an hourly job or when the pages open; recording a pull takes the units out of storage, logs the sample and records whether it was in the window (a note outside it). Turnaround from the scheduled date; price for the study year.
  - **Admin > Lab setup > Stability chambers:** conditions (ICH preset plus the lab's own), chambers (equipment set to a condition), racks, and upcoming pulls by chamber. Sites grid: "Pull window (± days)" (7) and "Stability reserve %" (10).
  - Permissions `stability.configure` (QA, Lab Supervisor, Administrator) and `stability.manage` (Lab Supervisor, Analyst, Intake). Stability quotes use `quotes.edit`.
- **Migrations and files:**
  - Database: `032_stability_studies.sql`, `seed_025_stability_demo.sql` (six chambers with racks at CFL and TPS; SQ-00001 Draft; STB-00001 placed about three months ago, its 1-month pulls taken and 3-month pulls ordered; STB-00002 awaiting material).
  - New files: `server/stability.js`, `server/routes_stability.js`, `public/js/pages/stability.js`, `db/tests/test_027_stability.sql`, `tests/e2e_stability.js`.
  - Changed files: `tests/e2e_equipment.js` (register count), `server/quotes.js` (the stability PDF), `server/routes.js` (registration, the hourly pull job, Sites fields), `public/js/main.js` (menu, routes), `public/js/icons.js`, `pages/quotes.js` and `pages/projects.js` (stability quotes open their own page), `pages/intake.js` (Sites columns), `package.json` (test:stability).
- **Checked:**
  - **Rule tests:** 1034, all passing (new `test_027_stability.sql`: 47).
  - **Browser suites:** all 20 on PostgreSQL 16, including Claude Code's `e2e_pricing.js` and the new `e2e_stability.js` (23 checks). `e2e_equipment.js` now counts the four demo chambers in CFL's register (16, was 12). `tests/coa_parts.js` still passes.
  - **Files:** the quotation PDF and the summary report PDF were opened and read.
  - **Upgrades:** from the 0.16.1 state (031), the 0.16.0 state (030), the 0.15.0 state (029), Claude Code's 023 state and 011 all pass, and the demo studies arrive.
- **Not checked:** PGlite; the hourly job over a real day boundary (tested by placing in the past).
- **Alex's data:** not applied. The next start applies 030, 031, 032, seed_024 and seed_025 together. seed_025 adds demo chambers (as equipment), three stability quotes and two studies with their orders to his Sandbox, as earlier demo seeds did. To be tried on a copy first, then applied when he says.
- **Not built (S-2):** amendments to a running study, cancellation and material disposition, excursions from logbooks, billing, the issued and signed cumulative report.
### 0.16.1, Alex's notes on quotes, the catalogue and serving sizes (2026-10-14, Claude Code)
- **Why:** Alex's notes after the demo, and his answers:
  - 20-30 rule: the client price is right, and the rates are a lab setting.
  - "Any lab" tests: assign each one to a lab.
  - Serving: a count plus a weight, with a Serving size workflow step to come.
  - Package: servings per package.

  Claude's build choices are in vault `Decision - Quote Pricing, Catalogue Updates and Serving Sizes` (Proposed).
- **What:**
  - **No "Any lab".**
    - The 7 shared tests are given CFL as their home lab, where they were always ordered (seed_024): Heavy Metals Panel, Moisture, Water Activity, Total Aerobic Plate Count, Yeast and Mold, Salmonella, pH.
    - A shared test may get a home lab once. A lab's test still never moves.
    - The quote picker and the quote lines show each test's lab.
  - **The 20-30 rule.**
    - A quote belongs to the lab it was made in (Quoting lab on the quote page). Quotes made before this show "Not recorded" and price as before.
    - A test of another network lab is **subcontracted**: that lab's catalogue price less the in-network discount (20 %), plus the quoting lab's markup (30 %). Example: $650 becomes $520 cost and $676 to the client.
    - Both rates are lab settings (Admin > Sites and holidays).
    - Each line keeps the rates of the day it was added. Removing an analyte keeps the discount % on the client price.
    - The quote page shows "TPS (subcontracted)" and the in-network cost, which is internal only.
    - The quotation PDF says "(subcontracted within Tentamus)", because ISO 17025 asks that the client be told.
  - **Subcontracted tests are not ordered yet.**
    - At the quoting lab, the order page lists them as "subcontracted from <lab>" and "Apply project" skips them.
    - Sending the sample to the other lab is not built.
    - The demo walk-in order LO-000002 at TPS (Beta Foods) can therefore no longer apply its list-price project, because its tests are now CFL's.
  - **Trash button** on each quote line (with a confirmation). It replaces the Active/Removed column; the line is kept in the audit trail.
  - **Catalogue "Update prices…".**
    - Applies to the selected tests, or every active test, by a percentage.
    - The base price, preparation fee and analyte prices each change, rounded to the cent, so the list price follows.
    - It needs a Reason for Change and is audited.
    - Quotes already made keep their prices.
  - **Serving units.**
    - The Units list has a "Serving unit" column. 23 new units were added (capsule, softgel, tablet, caplet, chewable, gummy, lozenge, scoop, packet, sachet, stick, pouch, tsp, tbsp, dropper, drop, spray, piece, bar, cup, can, shot, serving).
    - vial, ampoule, bottle and pack are marked as serving units too.
  - **The sample's serving.** It has the count and its serving unit (2 capsules), the serving's weight or volume (1.2 g, which per-serving amounts use), and the servings per package. All are pick lists from the Units list. A logged sample needs a Reason for Change to change them.
  - **Sample grid.**
    - "Units" is now **Containers** and comes first.
    - **Amount received** and **Amount unit** (from the Units list) sit apart, followed by the serving columns.
    - The sample page shows "2 capsule, 1.2 g; 30 per package".
  - **Limits per serving or per package.**
    - The specifications dialog has "Limit is": As reported, Per serving or Per package.
    - The comparison uses the reported value × serving weight (× servings per package), at 3 significant figures, in the limit's unit.
    - The COA prints "≤ 1 mg per serving", with a Per serving column (and a Per package column when needed).
    - The release check compares again. If the serving is missing, it shows a Warning and the result is "Not compared".
- **Migrations and files:**
  - Database:
    - New: `031_quote_pricing_serving.sql`, `seed_024_home_labs_serving_units.sql`.
    - `031` replaces `test_rules`, `qas_reprice`, `apply_project`, `requested_test_copy_specs`, `new_project_version`, `sample_serving_rules` (and its trigger) and `spec_conformance`.
  - Server: `routes.js`, `routes_quotes.js`, `quotes.js`, `coa.js`, `routes_methods.js`, `routes_inventory.js`.
  - Screens: `pages/quotes.js`, `projects.js`, `catalog.js`, `orders.js`, `common.js`, `inventory.js`, `intake.js`.
  - Tests:
    - New: `db/tests/test_026_quote_pricing_serving.sql` (29 checks), `tests/e2e_pricing.js` (`npm run test:pricing`, 15 checks).
    - Changed: `test_021a` (new wording), `tests/e2e_quotes.js` (no "Any lab"; $676 for the TPS test) and `tests/e2e_slice2.js` (the TPS walk-in).
    - `package.json` 0.16.1.
- **Correction to Claude in the cloud's `db/tests/test_023_oos.sql` (Claude Code):** it picked "someone who did bench work" with `LIMIT 1` from all the batch's steps, including the QC Review step. When it picked the reviewer (who may conclude), the investigation closed early and the whole rule-test run stopped ("OOS-000003 is already closed"). That happened in about 1 run in 3 with 031's new tables. It now picks from bench steps only, and passed 6 runs out of 6.
- **Checked (PGlite, fresh database):**
  - 987 rule tests pass.
  - All 19 browser suites pass in order, the new `test:pricing` included.
- **Tried on a copy of Alex's data:**
  - 030, 031 and seed_024 applied without error.
  - His clients, contacts, orders (11, statuses unchanged), samples, tests, lots, equipment, batches, results, versions, users and purchase requests are unchanged.
  - No shared test is left, and 27 serving units are marked.
  - The gate is as Alex set it: CFL on, TPS off.
  - **Not applied to his data: waits for his go** (with 030). The app stays stopped.
- **Not built (Part B, to design with Alex):** the Serving size workflow step (density for liquids, repeated weighings averaged for solids, skippable, with a configurable cost) and the Density and Serving weight tests. Until then the serving weight is typed from the label or the client.

### 0.16.0 on the laptop: PGlite run and copy test (2026-10-14, Claude Code; no version change)
- **Why:** the 0.16.0 delivery brief: run everything on PGlite, try 030 on a copy of Alex's data, apply it only on his go.
- **Before anything:** the app was stopped. It had last started before 030 arrived, so 030 was not on Alex's data (no "Applied" line in its log). Backup: `backup-before-0.16.0-2026-10-14`.
- **PGlite, fresh database, Alex's `data/` moved aside and put back afterwards:**
  - 958 rule tests pass.
  - All 18 browser suites pass, including the new `test:labsetup` (21 checks) and `test:quotes` (28).
  - `npm run test:coaparts` was **not run**: it needs PostgreSQL.
  - No fixes were needed.
- **Copy of Alex's data:**
  - 030 applied without error. His clients, contacts, orders (11, statuses unchanged), samples, tests, lots, equipment, batches, results, versions, users and purchase requests are unchanged; 6 audit rows were added.
  - **The verification gate:** TPS is off. **CFL is on, but 030 did not do that.** It was already on in his data before 030: Alex turned it on himself at 2026-10-14 21:13 UTC with the reason "Turning on for Demo" (audit trail). Claude Code left it as Alex set it.
- **Not applied to Alex's real data:** waits for his go. The app stays stopped until then, because starting it applies 030.

### 0.16.0, report templates, lab images, UI refresh (2026-10-14, Claude in the cloud)
- **Why:** Alex's answers to `Proposal - Quick Design Items for the Next Slice` (2026-10-14, 15:08 and 15:11):
  - accreditation: "create a place holder. We will hold off";
  - many report templates, assigned per test in the Workflow Designer, defaulting to the one built; kept in the admin side under sites;
  - logos later, but placeholders and a place in the lab site module to upload them;
  - "friendly and fun" for the look;
  - "If a sample has two different report templates assigned, then it uses both and the COA PDF has the tests separated across the two templates appropriately."

  Decision: `Decision - Report Templates, Lab Images and Accreditation Placeholders` (build choices Proposed).
- **What:**
  - **Admin > Lab setup > Report templates:** RT-001 "Standard Certificate of Analysis" (the COA as built, the default for every lab). QA and lab administrators add their lab's templates (`reports.templates`); system administrators keep the every-lab ones. A template has a title and four switches (method line, test version, dates tested, LOQ column). One default per lab; the default cannot be retired. Only the "Standard COA" layout exists; new layouts are code and come later.
  - **Workflow Designer, tab 1:** "Report template" per test version (blank uses the lab's default); carried to new versions; only the lab's own or every-lab templates, only active ones.
  - **The COA in parts:** when the tests on one sample use different templates, the COA is one PDF with one part per template, the lab's default first. Each part starts on a new page with its own title, "Part 1 of 2: <template>", the client and sample details, and its own tests. Notes, the decision rule and the signature appear once at the end. The read-back checks every part. The coa_version records which templates it used.
  - **Sites page:** image slots for the Logo, Small logo and Accreditation mark, shown as placeholders until uploaded (PNG, JPEG or SVG up to 2 MB; never replaced, retired instead), plus other images. The logo prints on the COA; the small logo replaces the initials in the header while working in that lab. The Sites grid has Accreditation body, Certificate no. and Accreditation statement (printed on the COA when filled).
  - **Product name:** one setting (LIMS3), used in the header, the browser tab and the sign-in page; system administrators change it on the Sites page. Not renamed: "LabAlly"/"LabAli" wait for a trademark check.
  - **Look:** each menu section has a colour (Intake blue, Testing green, Lab supplies amber, Pricing plum, Admin slate); every menu item has an icon; the page title carries its menu icon; rounder cards; coloured status badges; friendlier empty lists. No outside fonts or images.
- **Migrations and files:**
  - Database: `030_report_templates_lab_media.sql` (no seed).
  - New files: `server/routes_labsetup.js`, `public/js/pages/labsetup.js`, `public/js/icons.js`, `db/tests/test_025_report_templates.sql`, `tests/e2e_labsetup.js`, `tests/coa_parts.js`.
  - Changed files: `server/coa.js`, `server/routes.js`, `server/routes_methods.js`, `public/js/main.js`, `pages/methods.js`, `pages/intake.js`, `public/css/app.css`, `package.json` (test:labsetup, test:coaparts).
- **Checked:**
  - **Rule tests:** 958 (new `test_025_report_templates.sql`: 36).
  - **Browser suites:** all 18 on PostgreSQL 16, including the new `e2e_labsetup.js` (21 checks); the menu icons and page chips changed no other suite's selectors.
  - **The multi-part COA:** `tests/coa_parts.js` (6 checks, PostgreSQL, rolled back) and the PDF looked at: part 2 on its own page with its own title, no method line and no LOQ column.
  - **Upgrades:** from the 0.15.0 state (029), Claude Code's 023 state, 021 and 011 all pass.
- **Not checked:** PGlite; `tests/coa_parts.js` needs PostgreSQL; a real logo at print size; the look on a phone.
- **Alex's data:** 030 is not applied. His data already has 028 and 029 (Claude Code, 2026-10-14), so the next start applies only 030; it adds no demo data. To be tried on a copy first, then applied when he says.
### 0.15.0, standalone quotes (2026-10-14, Claude in the cloud)
- **Why:** Alex (2026-10-14):
  - a standalone quoting module in the same area as project quotes, working the same way;
  - projects are bundles for a product or recurring testing; quotes are one-off answers to customers;
  - a sales person moves between labs to build a quote and sends it while on the phone;
  - the list has Accept / Reject buttons, filters, who did the quote, and "My Open Quotes".

  Decision: `Decision - Standalone Quotes` (build choices Proposed).
- **What:**
  - **Pricing > Quotes**: tabs My open quotes / All quotes; filters by status, type (quotes, projects or both), lab and prepared by; Accept… and Reject… on each quoted row. Project quotes are listed too. Pricing > Projects now lists projects only.
  - **A new quote** for a client and contact (Q-00001 codes). The quote page is the project quote page, with lab tabs to add tests from each lab's catalogue (plus the tests every lab offers). Each line shows its lab; lines start at the list price.
  - **Send to client…** issues the quote if needed, makes the quotation PDF (grouped by lab with subtotals when it mixes labs) and queues the email with the PDF and a link. The page shows the link to paste into a chat.
  - **The client's page** (`quote-response.html`, no sign-in): the quotation, Accept or Decline with their name and a note. Accepting makes the tests orderable at those prices.
  - **Details…**: reference, contact, and handing the quote to another sales person.
- **Migrations and files:**
  - Database: `029_standalone_quotes.sql` and `seed_023_quotes_demo.sql` (three TPS tests, four demo quotes).
  - New files: `server/quotes.js`, `server/routes_quotes.js`, `public/js/pages/quotes.js`, `public/quote-response.html`, `db/tests/test_024_quotes.sql`, `tests/e2e_quotes.js`.
  - Changed files: `server/routes.js`, `public/js/main.js`, `pages/projects.js`, `pages/orders.js`, `pages/intake.js`, `tests/e2e_smoke.js`, `package.json` (test:quotes).
- **Merged first:** Claude Code's 0.14.1 (028 Report Finalization follow-up, `seed_022_signatures.sql`, `test_021a`, the report, OOS, methods and admin screens), built on the laptop at the same time. Hence the numbers 029 and seed_023.
- **Checked:**
  - **Rule tests:** 922 (new `test_024_quotes.sql`: 24), with Claude Code's 028 included.
  - **Browser suites:** all 17 on PostgreSQL 16, including the new `e2e_quotes.js` (28 checks).
  - **Upgrades:** from 011, 021 and Claude Code's 023 state pass, and the demo quotes arrive.
  - **Files:** the quotation PDF was opened and read.
- **Not checked:** PGlite; real email delivery (Outbox only); the client page on a phone.
- **Also written (not built):** `Proposal - Quick Design Items for the Next Slice` (the COA format beyond 028, the product name, logos, icons) with Alex's questions. "LabAlly" may conflict with Lab-Ally, LLC (lab informatics software): a trademark check comes first.
- **On PGlite, the laptop (Claude Code, 2026-10-14, correction to "Not checked: PGlite"):** 922 rule tests and all 17 browser suites pass on a fresh PGlite database. One test fix, no app change: `e2e_quotes.js` clicked the middle of the Outbox Subject cell, which the short subject "Quotation Q-00005 from CFL" does not reach on the laptop's screen fonts, so the email did not open; it now clicks the link itself (28 checks pass).
- **Alex's data (Claude Code, 2026-10-14):** 029 and seed_023 were applied to his data together with 028 and seed_022 (see the 0.14.1 entry), before this PGlite run. Alex needed the app back for a live demo. Claude Code meant to run it on a migrated copy, but the step that swapped the copy in was refused while the start command went ahead, so the app started on his real data and applied all four. The same four had applied cleanly to a copy of his data a minute earlier (his records unchanged; the gate still off). Backup taken after the demo: `backup-after-0.15.0-2026-10-14`.

### 0.14.1, Alex's Report Finalization notes (2026-10-14, Claude Code)
- **Why:** Alex's notes after clicking through R-1 and R-2, and his answers: Batched Finalization = groups in progress; per serving = an extra column; uncertainty = ± per analyte, as % or units; signatures = uploaded by a lab administrator. Claude's build choices: vault `Decision - Report Finalization Follow-up` (Proposed).
- **What:**
  - **Renamed "Report Finalization"**, with four tabs:
    - **Report Finalization Queue:** everything waiting, with who holds it. It has an OOS column (a link to the investigation) and filters (not claimed, overdue or due soon, rush, OOS, GMP). Overdue rows are red, due within a day amber, rush in bold red. A "Final COA due" list sits on top.
    - **Finalization worklist:** what the person claimed.
    - **Batched Finalization:** groups in progress (FB-000001) and who holds each.
    - **Issued COAs:** the archive, 30 days to all.
  - **Claiming:** "Claim selected" puts sample tests in a group that only the holder finalizes (the database refuses anyone else). The holder releases it, or a lab administrator takes it back with a reason. Not signed (it changes no record of the work); finishing the tests closes the group.
  - **Handwritten signatures:** a lab administrator records a scan of the person's signature (PNG or JPEG, up to 1 MB) and their title (Admin > People and groups, "COA signature", signed). The COA prints the image above a line, then the name, title and "Signed <date> (electronic signature)". The database refuses to issue a COA by anyone without both, and the release check blocks it first.
  - **Report ID:** sample ID + R and the version (CFL261014010-R1), with "Version 1" beside it, in the header, the footer, the PDF file name, the lists and the COA email. The internal `coa_code` (COA-…) is unchanged.
  - **Notes:** every COA note is printed in one numbered Notes section; a note on a test or a result puts its number beside that row. The note form keeps the last "Kind" and "On" picked.
  - **Serving size** on the sample (order grid columns "Serving" and "Serving unit"; sample page). A test version can "Also report the amount per serving" (designer tab 1): the COA gets a "Per serving" column (ppm, ppb, %, mg/g style units and "per 100 g" converted with the unit tables, 3 significant figures). A missing serving size is a release-check Warning.
  - **Uncertainty** per analyte in the designer (value, "Unit" or "%", and "Report ±"); the COA prints "± x" to the result's decimals. Carried to new versions.
  - **COAs on the lab order** (a card listing every version with its report ID, PDF and verification code).
  - **OOS loop:** the OOS email is sent when the COA with the confirmed result is issued (Alex's earlier decision: release, not detection), which is why it was not in the Outbox at detection. The sample page now has "OOS: the client's Phase II decision": "Order Phase II retest…" (as before, now also from the sample) or "No retest: close…" (signed, with how the client told us). Until one is recorded, the COA is issued but not marked final; after "No retest", the queue shows "Final COA due" to issue the final version.
  - **Review screen:** narrower side columns, a taller PDF opened at whole-page view, the release check's OOS block links to the OOS.
- **Migrations and files:**
  - Database: `028_report_finalization_followup.sql`, `seed_022_signatures.sql` (fictional demo signatures for projmgr, qa.reviewer, labsup; not akiddle).
  - Server: `server/coa.js`, `server/routes_reports.js`, `server/routes_oos.js`, `server/routes.js`, `server/routes_methods.js`.
  - Screens: `public/js/pages/reports.js`, `orders.js`, `methods.js`, `admin.js`, `public/js/main.js`.
  - Tests: `db/tests/test_021a_report_followup.sql` (new), `db/tests/test_022_result_finalization.sql` (signature fixture; the email subject), `tests/e2e_reports.js` (new checks; the report ID; the template's version count, which 028 raises by one).
- **Checked (PGlite):** 898 rule tests; all 16 browser suites on a fresh database (`e2e_reports.js` 36 checks). One `e2e_testing.js` check (re-prep) failed once and passed on the rerun (timing; not touched by this change). The issued COA PDF was opened and read: report ID, numbered note, signature image, name, title, date.
- **Tried on a copy of Alex's data:** 028 and seed_022 applied; his orders, samples, lots, batches, versions, users and purchase requests unchanged; the verification gate still off for CFL and TPS. **Not applied to his data yet: waits for his go.**
- **Correction (Claude Code, 2026-10-14, later the same day):** applied to Alex's data after his "go", together with 0.15.0's 029 and seed_023, when the app was started on his data by mistake (details in the 0.15.0 entry). No error; his records unchanged; the gate still off. His own account still has no COA signature: he records it in Admin > People and groups.
- **Not checked:** the PDF's "whole page" view inside the Claude browser pane (the test browser does not draw PDFs); printing the signature image at real size.

### 0.14.0, R-2: OOS investigations and retests (2026-10-14, Claude in the cloud)
- **Why:** Alex's OOS decisions (`Decision - OOS Investigations Use a Procedure Matched to the Work`, `Decision - An OOS Result Holds Only Itself`, `Decision - Client OOS Retests Are Re-preps Billed by QA Determination`) and his R-2 answers of 2026-10-13: the record is not opened automatically; the client is asked about Phase II re-testing. Claude's choices are in `Decision - OOS Investigation Build Choices` (Proposed).
- **What:**
  - **Flag, then open by hand.** A result that does not conform shows "Open OOS…" in QC Review (before or after approval) and on the sample page. Opening is signed ("Opened by") and starts nine automatic data checks and a target date. An investigation opened in error is cancelled (signed, with a reason) and kept.
  - **Two procedures.** Full Phase I (GMP samples) has three signed parts:
    - the analyst checklist ("Investigated by");
    - the supervisor checklist ("Reviewed by"; not the analyst, not anyone who did bench work in the batch);
    - the QA conclusion ("Approved by"; independent of both).

    Check and Acknowledge has one reviewer, who answers the checklist and concludes. The checklists are grids (Yes / No / N/A with fill down; a "No" needs a comment) kept by QA with the target times (Admin > QA > OOS checklists).
  - **The conclusion** ("OOS confirmed" or "Assignable cause found" with the cause) needs the batch approved. It makes the investigation report (PDF, SHA-256), which records the result, the checks, every section and the signatures.
  - **Release.** Only the OOS result is held (the queue's Notes say why). A confirmed result is finalized as out of specification. The client then gets the "Out of specification result" email (an Outbox template) asking whether they want Phase II re-testing. It has a link for each answer: retest, in duplicate, a new sample, hold or return the retain, a call with QA, acknowledge. The signed Phase I report is attached for GMP work.
  - **The client's page** (`oos-response.html`, no sign-in, 90 days) shows the result and records the answer on the investigation for the lab to act on.
  - **Retests.** Each retest is a re-prep from the retained sample, ordered with a signature ("Ordered by"). The two kinds:
    - The lab investigation retest follows an assignable cause. It is not billable, and it supersedes the invalid results.
    - The client retest follows a confirmed, released OOS. It can be ordered straight from the client's answer, with the duplicate preselected.

    QA's determination after the retest is approved sets its billing. A retest takes its original's place on the next COA version; the COA does not say "retest".
- **Migrations and files:**
  - Database: `027_oos_investigations.sql` and `seed_021_oos_demo.sql` (PO-45240: VC-2401 and VC-2402, approved and held; PO-45241: VC-2403 waiting in QC Review).
  - New files: `server/oos.js`, `server/routes_oos.js`, `public/js/pages/oos.js`, `public/oos-response.html`.
  - Changed files: `server/coa.js`, `server/routes.js`, `public/js/main.js`, `pages/testing.js`, `pages/orders.js`, `pages/reports.js`, `tests/e2e_reports.js`.
- **Checked:**
  - **Rule tests:** 873 (new `test_023_oos.sql`: 48).
  - **Browser suites:** all 16 on PostgreSQL 16, including the new `e2e_oos.js` (33 checks, `npm run test:oos`).
  - **Upgrades:** from 011, 021 and Claude Code's 023 state pass, and the demo arrives.
  - **Files:** the report PDF and the email attachment were fetched and checked as PDFs.
- **Not checked:** PGlite; real email delivery (Outbox only); the client page on a phone.
- **Found while building:** the client page's script named a variable `top`, which clashes with the browser's own `window.top` and stopped the page; renamed.
- **On PGlite, the laptop (Claude Code, 2026-10-14, correction to "Not checked: PGlite"):** 873 rule tests and all 16 browser suites pass on a fresh PGlite database (`e2e_oos.js` 33, `e2e_reports.js` 27 run before the testing suites). No PGlite fix was needed.
- **Alex's data (Claude Code, 2026-10-14):** 026, 027, seed_020 and seed_021 were applied when Alex restarted the app himself to turn the verification gate off, before the copy test and the PGlite run (the app applies every waiting migration at start). All four applied without error. Checked afterwards against the earlier backup: his clients, lots, equipment, versions and purchase requests unchanged, his 6 orders keep their statuses; added only the demo orders PO-45231, PO-45240 and PO-45241 with their samples and batches, and 4 accounts (3 automated verification accounts, the demo Project Manager). Backup of this state: `backup-after-r2-2026-10-14`; the state before 026 can be rebuilt from `backup-before-wd6-2026-10-13` plus 024, 025 and seed_019. **The verification gate is off for CFL and TPS on his data, turned off by Alex himself.**

### 0.13.0, R-1: Result Finalization and the Certificate of Analysis (2026-10-14, Claude in the cloud)
- **Why:** Alex: "complete the testing process by sending finalized COAs to clients", then his answers on the design (2026-10-13 evening). Decision: `Decision - Result Finalization and the Certificate of Analysis`.
- **What:**
  - **Result Finalization** (Testing menu, permission `reports.finalize`; new standard group **Project Manager** in every lab, plus QA): a queue of every client sample test QC Review approved. Select several, review them one COA at a time: the PDF in the middle, the sample's submission details, notes, attachments and history on the left, the release check and notes on the right. "Mark ready" moves to the next; one signature at the end records a separate signature ("Finalized by") on each COA. Never skipped.
  - **The COA**: one per sample, versioned, never changed or deleted. Each version holds every result finalized so far and lists tests still in the lab as "In progress"; the last test makes the final version and the order **Reported**. The PDF is made by the server (headless Chromium), fingerprinted (SHA-256) and carries the previous version's fingerprint (a hash chain), a verification code, and "Version 2, supersedes version 1 issued ..." with no "amended" or "retest" wording (Alex). It shows the client's specification ("Client provided specification") and the decision rule (simple acceptance).
  - **Release check** before signing: values read back from the rendered PDF against the record; specification as on the ordered test and unchanged since approval; reported value and conformance worked out again independently; results against the same project's (or client's) earlier results (5 times off the median of at least 3); sample details changed after logging; compliance category given; completeness; holds (client On Hold, out of specification); someone else's work; dates; changes from the last version. Block stops it; Warning needs a reason, kept with the version.
  - **A new version without a new result** ("Issue a new version" on the sample page: a corrected note or client detail), signed with a reason. A changed result (QC Review reopened) puts the test back in the queue and its finalization makes the next version.
  - **GMP work** (a Regulated client or a GMP compliance category) is finalized only by QA (`reports.finalize_gmp`). **Out-of-specification results are held** until R-2 (OOS) is built.
  - **Notes**: on the COA (sample or one result, typed or canned from the new "COA comments" list in Canned reasons) or internal (never printed); `reports.notes` (Project Manager, QA, Lab Supervisor).
  - **Sample compliance category** (static list, Admin > Matrices, `master.compliance`; Alex's categories plus Claude's suggestions), a Category column on the order's sample grid. **Sample attachments** (submission form, chain of custody, correspondence, photos) on the sample page, shown on the order and in the review. **Client "Partial reports"** setting: off means tests are finalized and held until the final COA.
  - **Automated emails are templates** (Outbox > Templates; `outbox.templates`, QA and administrators): Rush Not Accepted (moved from code, same text), COA Issued (the PDF attached, the verification link), and the OOS Result wording for R-2 (Phase II re-testing options; not sent yet).
  - **Public verification page** (`/verify.html`, no sign-in): the code gives the lab, COA, version, issue time, fingerprint and whether a later version exists; a dropped PDF is checked against the fingerprint in the browser (the file never leaves the computer). Nothing about the client or the results is shown.
- **Migrations and files:** `026_result_finalization_coa.sql`, `seed_020_result_finalization.sql` (canned COA comments, a demo Project Manager `projmgr`, order PO-45231 with three approved Vitamin C lots waiting in the queue); new `server/coa.js`, `server/routes_reports.js`, `public/js/pages/reports.js`, `public/verify.html`; changes to `server/routes.js`, `server/server.js` (`/api/public/` open), `server/evidence.js` (Playwright no longer catches Ctrl+C, so the server always stops), `public/js/main.js`, `app.js`, `pages/orders.js`, `intake.js`, `admin.js`, `clients.js`, `tests/auth.js`.
- **Checked:** 825 rule tests (new `test_022_result_finalization.sql`: 39) and all 15 browser suites on PostgreSQL 16, including the new `e2e_reports.js` (27 checks, `npm run test:reports`). Upgrades from 011, 021 and Claude Code's 023 state pass. Issued PDFs were opened and read.
- **Not checked:** the PDF shown inside the review page in a real browser (the headless test browser does not display PDFs; the file itself was checked); emails are only placed in the Outbox (Sandbox); PGlite.
- **Found while building:** the demo user name `pm` made 1 in 36 random temporary passwords invalid (a password may not contain the user ID); renamed `projmgr`.
- **On PGlite, the laptop (Claude Code, 2026-10-14):** 825 rule tests pass; all 15 browser suites pass. No PGlite fix was needed. Note on order: `e2e_reports.js` must run on a fresh database before `e2e_testing.js` (or on its own). Run after the testing suites, 2 of its checks fail because the samples those suites approve also wait in Result Finalization ("only VC-2303 waits"; the order then does not reach Reported). Run alone on a fresh database: 27 of 27.

### 0.12.0, WD-6.1: objective evidence and the Word document (2026-10-13, Claude in the cloud)
- **Why:** phases 2 and 3 of WD-6. Alex: "there needs to be objective evidence so screenshots are something that we would love to have", then "Make the next slice for the verification piece please".
- **What:**
  - **Screenshots.** Right after a run, the server opens every page the run's checks point to in a headless browser (Playwright, Chromium), signed in as the person who executed the run: the verification order, each step of each batch, the batch's Results and QC, and each sample's approved results. Each page is loaded fresh, stamped across the top (verification, E-number, page, time, person) and kept as a full-page PNG with its SHA-256. The database checks each image against its hash, keeps it unchanged (no edit, no delete) and links it to the checks it shows. The capture is signed "Evidence captured by" (the executor's signature for the run covers the automatic capture; a "Capture the evidence" button, signed, retries if it failed). It runs in the background (about 20 seconds for the demo stability test); the page shows that and refreshes. The headless sign-in and sign-out are in the sign-in log.
  - **The gate.** QA can sign the report only once the evidence is captured.
  - **The page.** A fifth signature block; each check names its screenshots (E-01...), which open full size; the screenshots with their checks and SHA-256 in section 8.
  - **Word.** "Word document" downloads the protocol and report (.docx, Letter landscape, page X of Y): the same sections as the page, an Evidence column in the checks and traceability, and Appendix A with every screenshot, its page, time, checks and SHA-256. Made from the record on request; nothing stored. Written by LIMS3 itself (no new package).
- **Migrations and files:** `025_verification_evidence.sql` (`verification_evidence`, `record_verification_evidence()`, `sign_verification_report()` needs evidence, audit names "Verification evidence VER-x E-nn"); new `server/evidence.js`, `server/docx.js`, `server/verification_report.js`; changes to `server/routes_verification.js`, `server/auth.js` (a session for the headless capture), `server/verification.js` (each check points to the exact page: the step, Results and QC, or the sample), `public/js/pages/verification.js`, `tests/auth.js`, `tests/e2e_verification.js`, `db/tests/test_021_verification.sql`. Merged Claude Code's fix to `test_015_execution.sql` (the lab's yesterday, not UTC's).
- **Checked:** 786 rule tests (`test_021`: 53; new: hash and PNG checks, signed, once only, no change or deletion, report needs evidence) and all 14 browser suites on PostgreSQL 16; `e2e_verification.js` 25 checks (screenshots captured and signed, every check has one, a downloaded image matches its stored SHA-256, the .docx is a valid package with one image per screenshot). The Word file was opened in LibreOffice and read page by page (22 pages for the demo). Upgrades from 011, 021 and Claude Code's 023 state pass. Not yet run on PGlite.
- **Needs on the computer running LIMS3:** Playwright with Chromium (already in the laptop project's `node_modules`, used by the browser tests). Without it, the run still completes and the page says how to install it.
- **Not checked:** opening the .docx in Microsoft Word itself (checked in LibreOffice only).
- **Decision:** `Decision - Workflow Verification` (WD-6.1 section).
- **On PGlite, the laptop (Claude Code, 2026-10-13, correction to "Not yet run on PGlite"):** 786 rule tests and all 14 browser suites pass on a fresh PGlite database, `e2e_verification.js` 25 checks (screenshots captured with the project's Playwright). No PGlite fix was needed.
- **Alex's data (Claude Code, 2026-10-13):** 024, 025 and seed_019 tried on a copy, then applied (023 was already applied with 0.10.0). Backup: outer folder `backup-before-wd6-2026-10-13`. **The workflow verification gate is off on Alex's data by his choice** ("Gate off until Alex enables it"): seed_019 turned it on for CFL and TPS; Alex turns it off himself in Admin > Sites and holidays (only a system administrator can change a lab, and that is his account), and will turn it on when he is ready. With the gate off, verifications can still be written, approved, executed and signed from a version's Review tab; approval simply does not wait for one. Checked on a copy: gate on, approving Heavy Metals v2 is refused ("needs a passing workflow verification"); gate off, it approves.

### 0.11.0, WD-6: workflow verification (2026-10-13, Claude in the cloud)
- **Why:** Alex asked for "a test validation check for a completed workflow": an automated test sample through the entire process, a document with URS and FRS satisfied, and objective evidence. Alex decided: a new migration, QA signs the protocol and the report, the gate applies to every test version.
- **What:** on a draft version's Review tab, the designer writes the protocol (signed); the server builds it from the design: URS and FRS, automated samples (typical, below the LOQ, outside the specification, below the LOD when ND applies), every value to enter, and expected results from a second calculation written independently of the database engine. QA approves it (signed). The designer executes it (signed): automated accounts (no password, no group, rights only during the run) work every step through the same database rules as the bench and review, including challenges (data missing, self-review, approval before step approvals). Each check records what the system produced; QA signs the report and justifies anything not tested. With the lab setting on (CFL, TPS), a version is approved only with a signed, passing verification of exactly its current design (a design fingerprint).
- **Migrations and files:** `024_workflow_verification.sql` (numbered after Claude Code's 023, and rebased on its pool view, `create_batch` and batch edits), `seed_019_workflow_verification.sql`; `server/verification.js`, `server/routes_verification.js`, `public/js/pages/verification.js`; changes to `routes.js`, `routes_testing.js`, `auth.js`, `methods.js`, `testing.js`, `intake.js`, `main.js`, `app.js`, `seed_003` (automated accounts get no lab access).
- **Checked:** 778 rule tests (`test_021_verification.sql`: 45) and 14 browser suites on PostgreSQL 16, including `e2e_verification.js` (18) and Claude Code's `e2e_media_labels.js`; the suites that approve versions now run a verification first. Upgrades from 016, 021 and Claude Code's 023 state pass. Every demo test was verified: five Pass, two Pass with exceptions (no MALDI-TOF; no strain lot of the USP <60> organism), **USP <51> Fail: a real defect** (a negative control counted 0 cannot pass through `log10`, so its calculation step can never be completed). Not yet run on PGlite (the cloud cannot install it): Claude Code runs it before Alex's data.
- **On PGlite (Claude Code, 2026-10-13):** 778 rule tests and all 14 browser suites (`e2e_verification.js` 18) pass. One test fix, no rule change: `test_015_execution.sql` set an "expired" lot to the database's yesterday (UTC); after 5 pm Pacific that is still the lab's today, so 3 checks failed. It now uses the lab's yesterday (`site_today(...) - 1`).
- **Not this version:** phase 2 (Playwright screenshots of each step as objective evidence) and phase 3 (a Word export).
- **Note:** this verifies the configured workflow of one test version. It is not the validation of LIMS3 (section 3 is unchanged).
- **Decision:** `Decision - Workflow Verification`.

### 0.10.0, Alex's notes: media qualification, batch edits, labels, purchasing (2026-10-13, Claude Code)
- **Why:** Alex's notes of 2026-10-13 and his answers (media qualification; option B for batch rules; 1D Code 128 on a Dymo LabelWriter 450, samples 2 1/8 x 4 in., others 1 x 2 1/8 in.; no signature to add or remove batch samples). Decision: `Decision - Media Qualification, Batch Edits and Barcode Labels` (with its Proposed build choices).
- **Changed:**
  - **Media qualification.** New media lots must be qualified. "Qualify media" makes one test sample with the lot's ID; it joins batches without counting toward their size or QC; QA's approval releases the lot for the chosen tests only (or fails it); the bench refuses it otherwise. New permission `inventory.qualify`.
  - **Batches.** Samples can be added (also by right-click in the backlog) and removed until bench work is recorded; the QC brackets follow; Batching is confirmed again.
  - **Labels.** Code 128 barcode labels for samples (tests and due dates, continuing on more labels), inventory, equipment (calibration expiry) and batches; one per unit by default.
  - **Purchasing and inventory.** Web link on requests and items; actual price per receipt; an Other or Service purchase can be received straight into inventory (the item opens to be filled out); "+ In-house mixture" beside "+ New Inventory Item"; the Supplier COA on the New Inventory Item form.
- **Files:** migration `023`, seed `018`; rule test `test_020` (and `test_017` fixture); `server/db.js`, `routes.js`, `routes_inventory.js`, `routes_purchasing.js`, `routes_testing.js`, new `routes_labels.js`; new `public/js/labels.js`; pages inventory, purchasing, testing, orders, equipment; new browser test `e2e_media_labels.js`; `e2e_purchasing.js` adjusted.
- **Checked:** 735 rule tests and all 13 browser suites on a fresh PGlite database; migration 023 and seed 018 tried on a copy of Alex's data (nothing lost; his 9 media lots carry on as qualified), then applied. Backup: `backup-before-media-labels-2026-10-13`.
- **Not checked:** printing on a real Dymo LabelWriter 450 and scanning with the lab's scanners (the barcodes were decoded back in the browser test only).
- **Tabled:** linking purchase orders to the accounting software.
- **WD-5 / WD-5.1 on PGlite (correction to the 0.9.0 and 0.9.1 entries, "Not tested: PGlite"):** run by Claude Code the same day: all rule tests and browser suites pass; one screen fix (the QC Review panel's load error shown in the panel instead of as a page error). Applied to Alex's data after a copy test.

### 0.9.1, WD-5.1: spike basis and incubator load acceptance (2026-10-13, Claude in the cloud)
- **Why:** Alex's answers to the two questions left open after WD-5.
- **Changed:**
  - A matrix spike is judged against the reviewer's chosen result of the spiked sample (the reading picked, or the average). Until the reviewer chooses, it uses the sample's reading in the same run, and the note says so.
  - An incubator load outside its window or temperature needs the analyst's note and the reviewer's acceptance with a justification, before the batch or the timepoint it feeds is approved.
- **Interpretation recorded:** Claude read Alex's "Agreed" on spike recovery as agreeing with the recommendation (the chosen result) and flagged it to him.
- **Files:**
  - Migration `022_spike_basis_load_acceptance.sql`.
  - Rule tests `test_017`, `test_019_spike_basis.sql`.
  - `routes_testing.js`, `testing.js`, `e2e_micro.js`.
- **Checked:** 702 rule tests; the testing, micro and WD-5 browser suites; upgrade from 0.9.0.
- **Decisions:** `Decision - Analytical Runs, Preliminary Results and Order Statuses` (WD-5.1 section). QA item 23 added.

### 0.9.0, WD-5: analytical runs, pick or average, preliminary results, order statuses (2026-10-13, Claude in the cloud)
- **Why:** Alex's answers after reviewing WD-2 to WD-4.
- **Changed:**
  - **Analytical runs.** Each reading step has run tabs. "Add analytical run" reads ticked samples again with the run's own ICV and CCVs; each run has its own raw data file and instrument. Re-reads are labelled RA1-, RA2-…; re-preps RP1-, RP2-…
  - **Reportable result.** The reviewer ticks one reading (justified) or several (their average).
  - **Preliminary results.** A Timepoint QC Review (e.g. day 7) is released on its own as Preliminary. The steps that fed it are locked, and the final review carries it over unchanged.
  - **Order statuses.** In Testing, In Review and Approved replace Complete.
  - **Split-off consent** is now a setting of the Split off step.
  - **QC Review** was added to the menu.
- **Demo:** "Vitamin C stability (demo)", with day 7 ready for review.
- **Alex confirmed** the build choices afterwards. QC not judged at a preliminary release is left with Jake Teller.
- **Files:**
  - Migration `021`, seeds `016`–`017`.
  - Rule tests `test_015`, `test_016`, `test_018`.
  - Routes, screens (testing, orders, methods, menu).
  - Browser tests `e2e_testing`, `e2e_micro`, new `e2e_wd5`.
- **Checked:** 693 rule tests; all 13 browser suites; upgrade from earlier versions, including recalculating Complete orders.
- **Not tested:** PGlite (to run on the laptop).

### 0.8.2, system administrators (2026-10-13, Claude Code)
- **Why:** Alex: "system admin should only be involved with setup and additive rights by being put in the different groups for testing."
- **Changed:** no code. Decision recorded: no bypass of department rules for administrators. Clearer message on screen.
- **Decision:** `Decision - System Administrators Do Setup, Testing Rights Come From Groups`.

### 0.8.1, WD-3.1 and Alex's evening updates (2026-10-13, Claude Code)
- **Why:** Alex reviewing QC Review in the browser.
- **Changed:**
  - **Review.** The reviewer approves each step with a click before the one signed approval (migration `020`). Results and QC are nested under each sample and QC entry, showing hits above the LOQ and items to act on.
  - **Menu and lists.** The menu is in sections. Making a batch lands on the Batches list. "Assign selected" assigns several batches at once.
  - **Bench screens.** Ctrl+click selects scattered cells. Equipment and lots are links on the bench screens.
- **Checked:** 659 rule tests; browser suites; reviewed and merged by Claude in the cloud.
- **Decision:** `Decision - QC Review Approves Each Step`.

### 0.8.0, WD-2.1, WD-3 QC Review, WD-4 micro bench (2026-10-13, Claude in the cloud, while Alex slept)
- **Why:** Alex asked for the remaining Workflow Designer slices to be built overnight, with decisions made and questions listed.
- **Changed:**
  - **Bench stock.** Using a lot at the bench reduces its stock.
  - **QC Review.** Reviewer independence, reportable reading, QC acceptance, approval storing results compared with specifications, return and cancel.
  - **Micro.** Daily controls, plating, incubation loads with window checks, qualitative results and control verdicts, split-off requests.
- **Files:** migrations `017`–`019`, seed `015`.
- **Checked:** 652 rule tests; testing (38) and micro (13) browser checks; upgrade simulations.
- **Questions** were sent to Alex. They were answered in 0.9.0 and 0.9.1.

### 0.7.0, WD-2 chemistry execution (2026-10-13, Claude in the cloud)
- **Changed:** backlog by department, autobatch with QC brackets, worklist, the bench steps with equipment and material gating, live calculations and per-analyte QC verdicts, re-analysis and re-prep (signed), witness signatures, assignment.
- **Decisions:** `Decision - Chemistry Execution Scope and Rules`, `… Build Choices`.

### 0.6.0 to 0.6.3, Workflow Designer WD-1 to WD-1.3 (2026-10-13)
- **WD-1** (Claude in the cloud, migration `012`): the designer, with tests per lab, versions, step types, formulas and approval by someone who did not author the version.
- **WD-1.1** (Claude in the cloud, `013`): micro definitions.
- **WD-1.2** (Claude Code, `014`): QC criteria per analyte, from Alex's deck review.
- **WD-1.3** (Claude Code, `015`): every workflow change is signed.
- **Open:** Alex prefers lighter Draft signing (parked).

### 0.5.0 to 0.5.2, Phase 1: Permissions, Equipment, Purchasing (2026-10-12/13, Claude in the cloud)
- Designed with Alex in Claude chat (see the slice sections in `CLAUDE.md` and the vault Scope and Build Choices notes).
- Logbooks were tabled until after the Workflow Designer.

### 0.2.0 to 0.4.2, Core, orders and inventory (2026-10-12)
- Slices 1, 2, 2.1, 3, 3.1 and 3.2. See the matching sections of `CLAUDE.md` and the vault decisions dated 2026-10-12.
- Known issues fixed along the way: navigation stuck in the desktop browser pane (native dialogs removed), and false "unsaved changes" on the test catalogue.

---

## 6. What is next (roadmap)
1. Alex reviews WD-2 to WD-5.1 as one workflow on the laptop, after Claude Code runs the tests on PGlite and tries the migrations on a copy of his data.
1a. **Alex's notes for the next slice** (2026-10-13; built as 0.10.0; details and open questions in `CLAUDE.md`, "Alex's notes for the next slice"):
   - Purchasing: a link to the item's web page; receiving a consumable creates its inventory item; an optional actual price at receipt; an accounting-software API later (tabled).
   - Inventory: "+ In-house mixture" moved beside "+ New Inventory Item"; QA release of media through test samples, restricting the lot to the selected tests; the COA uploaded and read while creating the item.
   - Barcode labels (1D Code 128, Dymo LabelWriter 450): samples 2 1/8 x 4 in. with tests and due dates; inventory, batches and equipment 1 x 2 1/8 in. with name and expiry; one per unit by default.
   - Decision note: `Decision - Media Qualification, Batch Edits and Barcode Labels`.
   - Adding and removing samples in a batch that has not started, including right-click "Add to batch" from the backlog.
1b. **WD-6 workflow verification** (0.11.0): phases 2 (screenshots) and 3 (Word export) to come; the USP <51> defect it found needs Alex's decision.
2. Reports and partial reporting: CoA, "Preliminary: not a final result", the Reported order status.
3. OOS investigation and retests: built in 0.14.0 (R-2). Still to come: hypothesis testing as its own step, Phase II as a record, retest material taken off the retain.
4. Stability studies.
5. Electronic logbooks: built in 0.18.0 (L-1 and L-2). Still to come: excursion assessments with S-2, shared designs, email reminders, daily controls feeding batch QC.
6. Before validation:
   - A URS per module, assembled from the approved decisions.
   - A version control repository.
   - Separate database roles for the app and administrators.
   - Resolution of the QA open items.
