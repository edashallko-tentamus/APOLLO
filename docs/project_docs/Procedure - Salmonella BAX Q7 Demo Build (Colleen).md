# Salmonella BAX Q7 screen with reflex confirmation: demo build procedure

For: Colleen Villanueva's demo request (email "Re: Test Demo Build", 2026-10-15). Sources: MC-12.06 rev 1 (Hygiena Real-Time Salmonella Assay, BAX Q7), MC-12.04 rev 1 (Salmonella Confirmation, FDA BAM Ch. 5), MCF-034 rev 1 (Sal Confirmation and Data Log).
Written by Claude in the cloud, 2026-10-15; updated the same evening for **LIMS3 0.21.0**, which adds the three missing features (F1 to F3 below). Nothing here is built for you; you build it by hand at CFL.

## The answer first

**You can build the whole thing in LIMS3 as it is today, as two tests:**
1. **Salmonella BAX Q7 screen** (MC-12.06).
2. **Salmonella confirmation** (MC-12.04).

The screen's **Split off Test** step, set to "On finding", orders the confirmation automatically on a presumptive positive. That is the reflex Colleen asked for, and it is already built.

**All seven of Colleen's asks are now system behaviour.** Three only half-worked in 0.20.1, so I built them as **0.21.0** (migration 039) on your go:

| # | Colleen asked for | What 0.21.0 does | Where you set it |
|---|---|---|---|
| F1 | Login by matrix drives the enrichment volume and incubation window | Each sample row shows its own product category, its accepted weight range (or "Not weighed" for swabs), its enrichment amounts (one click fills 225, 3375, 90 or 10 mL) and its incubation window (pet food 22 to 26 h, the rest 20 to 24 h). Controls can be "not weighed". | Step 9: the Weighing, Dilution and Incubation steps |
| F2 | A presumptive positive auto-notifies the customer's distribution list, with an audit trail | Completing the Split off step on a finding emails the client's **Positive alerts** contacts (new contact role; else Receives Report, else the ordering contact). The Outbox, the batch and the sample page show who was told, when, and by whose step. | Step 9: "Alert the client" on the Split off step; step 12: the role on the contacts |
| F3 | An indeterminate or signal error forces a re-run | Values marked "Not a result" are flagged "Re-run required" at the bench, can never be reported, and QC Review cannot approve until the sample (or control) is read validly in a new analytical run. | Step 9: the "Not a result" column on Analytes |

**Before you start:** Claude Code applies 039 to a copy of your data first, then to your data on your go (it adds no demo data: the role, the email template and the empty settings). Your verification gate is **off** for both labs on your data (you turned it off), so step 11 is optional.

**One SOP question changes a setting.** MC-12.06 8.5.3 says to confirm presumptives "upon request by the customer". Colleen's email says "reflex to confirmation". I have set it as **reflex**: Customer consent required = off, so the confirmation is ordered at once from the quote. The quote line is the customer's standing request. If Colleen means the SOP wording, tick "Customer consent required" instead, and the request waits on the sample page for someone to record consent.

## What you will build, in the order you build it

The order matters. Three dependencies drive it:
- The confirmation test must exist before the screen test can name it in its Split off step.
- Media lots must be qualified for both tests before the verification runs can use them.
- Verification is optional on your data (your gate is off), but the verification document is a strong thing to show Colleen.

| Order | Module | What you create |
|---|---|---|
| 0 | Admin > People and groups | Who does what (accounts) |
| 1 | Admin > Matrices | 3 product categories, 3 matrices |
| 2 | Admin > Analytes | 10 helper analytes |
| 3 | Equipment > Equipment types and departments | 5 equipment types |
| 4 | Equipment > register | 12 pieces of equipment, with their calibrations |
| 5 | Testing > Logbooks | The new equipment added to the temperature, balance and pipette logbooks |
| 6 | Inventory > Receive many | 21 lots |
| 6b | Inventory > + In-house mixture | The lysis reagent |
| 7 | Admin > Tests and workflows > Methods (SOPs) | 2 methods |
| 8 | Tests and workflows > + New test | **Salmonella confirmation** (built first) |
| 9 | Tests and workflows > + New test | **Salmonella BAX Q7 screen** |
| 10 | Inventory > each media lot > Qualify media | 9 lots, one growth promotion batch |
| 11 | Each version's Review tab | Verification (optional, recommended), then approval (confirmation, then screen) |
| 12 | Intake > Clients, Contacts | A fictional client with a distribution list |
| 13 | Pricing > Quotes | A quote with both tests, accepted |
| 14 | Intake > Lab orders | 4 samples, one per matrix, screen only |
| 15 | Testing | Screen batch, re-run, presumptive, reflex, confirmation batch |
| 16 | Testing > QC Review, then Report Finalization | Two COAs: one negative, one confirmed positive |

Allow about 3 to 4 hours of clicking, plus the verification runs.

---

## Step 0. Accounts (Admin > People and groups)

Independence rules mean you need four people besides yourself. **Set their temporary passwords yourself**; I never set passwords.

| Person | Does | Why not you |
|---|---|---|
| akiddle (you) | Steps 1 to 9 and 12 to 14 (setup, design, client, quote, order) | You are a system administrator, so setup is fine. You are not in the Microbiology group, so you cannot do the bench steps. |
| analyst | The bench work (step 15). Executes the verifications. | Already in CFL's Microbiology department group. |
| labsup | Approves both test versions | Nobody approves a version they worked on. |
| qa.reviewer | QA on the verification protocols and reports; QC Review of both batches; QA approval of the media qualification batch | Must not have done the bench work. |
| projmgr | Report Finalization | Already has a demo COA signature (seed_022). Must not have performed or reviewed the work. |

Check that Partial reports is set the way step 12 needs (off for the demo client). Nothing else is needed here.

## Step 1. Matrices and product categories (Admin > Matrices)

**Product categories grid** (second grid). Add three:
- Environmental sponge
- Environmental stick swab
- Dry pet food

"Food" already exists.

**Matrices grid.** Add three matrices, each pointing at its category:

| Matrix | Product category |
|---|---|
| Environmental sponge swab | Environmental sponge |
| Environmental stick swab | Environmental stick swab |
| Dry pet food (kibble) | Dry pet food |

For food, use your existing "Snack" matrix, which is already in category Food. If any of these names already exist, reuse them: names are unique ignoring capitals.

## Step 2. Analytes (Admin > Analytes)

**Salmonella already exists. Reuse it for both tests.** Each test sets its own result values on its Analytes tab, so the shared analyte is not changed.

Paste these 10 helper analytes. Class: Microbiological, no CAS. They carry MCF-034's page 2 and will be hidden on the COA.

```
XLD colonies
HEK colonies
BSA colonies
TSI reaction (XLD pick)
LIA reaction (XLD pick)
TSI reaction (HEK pick)
LIA reaction (HEK pick)
TSI reaction (BSA pick)
LIA reaction (BSA pick)
API 20E identification
```

## Step 3. Equipment types (Equipment > Equipment types and departments, CFL)

Add the types that are missing:
- BAX System Q7
- Thermal block
- Cooling block
- Water bath
- Homogenizer

These already exist from the seeds: Incubator, Top-loading balance, Biosafety cabinet, Pipette.

## Step 4. Equipment register (Equipment > Add many, paste)

- Department: MICRO.
- Owner: the Microbiology group.
- I used the codes on MCF-034 (MI05, MI100). Other codes are placeholders, so use the real asset IDs if you have them.

| Code | Name | Type | Calibration required |
|---|---|---|---|
| MI05 | Incubator 35 °C (enrichments, plates, slants) | Incubator | Yes |
| MI07 | Incubator 37 °C (BHI regrowth) | Incubator | Yes |
| MI100 | Water bath 42 °C (RV) | Water bath | Yes |
| Q7-01 | BAX System Q7 cycler/detector | BAX System Q7 | Yes |
| ATB-01 | Hygiena automated thermal block (37 °C / 95 °C) | Thermal block | Yes |
| CB-01 | PCR cooling block 2 to 8 °C | Cooling block | No |
| STOM-01 | Stomacher | Homogenizer | No |
| BAL-M2 | Top-loading balance, 0.01 g, 6 kg capacity | Top-loading balance | Yes |
| BSC-M1 | Biosafety cabinet, Class II | Biosafety cabinet | Yes |
| PIP-M10 | Pipette 5 to 50 µL | Pipette | Yes |
| PIP-M11 | Pipette 20 to 200 µL | Pipette | Yes |
| PIP-M12 | 8-channel pipette 5 to 50 µL | Pipette | Yes |

**Then record a current calibration on every piece marked Yes.** A piece with calibration required and no calibration is "Deficient", and the bench refuses it.

**Check the balance capacity.** The pet food portion is 375 g plus 3375 mL of BPW, so the vessel weighs about 3.8 kg. A 0.01 g top-loader that tops out at 2 kg will not do it. That is a real lab question worth asking Colleen.

Pipettes are registered for the pipette logbook only. I did not put them on steps: MCF-034 does not record them, and it would add a pick per step.

## Step 5. Logbooks (Testing > Logbooks)

**Temperatures (LB-0003), Equipment covered tab.** Add these units with their own limits:

| Unit | Limits |
|---|---|
| MI05 | 34.0 to 36.0 °C (MC-12.06 says 35 ± 1 °C; MC-12.04 says 35 ± 2 °C; use the tighter one) |
| MI07 | 35.0 to 39.0 °C |
| MI100 | 41.8 to 42.2 °C |
| ATB-01 | Check the 37 °C and 95 °C settings |
| CB-01 | 2 to 8 °C |

**Other logbooks:**
- Balance checks (LB-0001): add BAL-M2.
- Pipettes (LB-0002): add PIP-M10, PIP-M11 and PIP-M12.

**Record today's checks by paste.**

This is how "the technician is responsible for verifying that equipment is suitable" (MCF-034's note) stops being a manual job:
- The bench refuses equipment that is tagged out or out of calibration.
- A failing temperature check flags every batch that used that unit in QC Review.

## Step 6. Inventory (Inventory > Receive many, paste; signed "Received by")

Storage condition values must match the list exactly: `Refrigerated (2-8 °C)`, `Ambient (15-25 °C)`, `Ultra-low (-80 °C)`. Lot numbers and expiries below are placeholders.

| Name | Type | Solid or liquid | Analyte | Lot # | Qty | Unit | Storage |
|---|---|---|---|---|---|---|---|
| Buffered peptone water (BPW) | Media | Liquid | | BPW-2610A | 20 | L | Ambient |
| Brain heart infusion broth (BHI) | Media | Liquid | | BHI-2610A | 500 | mL | Refrigerated |
| Rappaport-Vassiliadis (RV) medium, 10 mL tubes | Media | Liquid | | RV-2610A | 50 | your "each" unit | Refrigerated |
| Hektoen enteric (HEK) agar plates | Media | Solid | | HEK-2610A | 50 | each | Refrigerated |
| XLD agar plates | Media | Solid | | XLD-2610A | 50 | each | Refrigerated |
| Bismuth sulfite agar (BSA) plates | Media | Solid | | BSA-2610A | 50 | each | Refrigerated |
| Triple sugar iron (TSI) agar slants | Media | Solid | | TSI-2610A | 100 | each | Refrigerated |
| Lysine iron agar (LIA) slants | Media | Solid | | LIA-2610A | 100 | each | Refrigerated |
| MacConkey agar plates | Media | Solid | | MAC-2610A | 50 | each | Refrigerated |
| 0.85% NaCl, 5 mL tubes | Reagent | Liquid | | NACL-2610A | 50 | each | Ambient |
| API 20E strips | Reagent | Solid | | API-2610A | 25 | each | Refrigerated |
| TDA reagent | Reagent | Liquid | | TDA-2610A | 1 | each | Refrigerated |
| James reagent | Reagent | Liquid | | JAM-2610A | 1 | each | Refrigerated |
| VP 1 reagent | Reagent | Liquid | | VP1-2610A | 1 | each | Refrigerated |
| VP 2 reagent | Reagent | Liquid | | VP2-2610A | 1 | each | Refrigerated |
| BAX Salmonella RT PCR tablets (KIT2006) | Reagent | Solid | | your kit lot | 96 | each | Refrigerated |
| BAX lysis buffer (KIT2006) | Reagent | Liquid | | your kit lot | 12 | mL | Refrigerated |
| BAX protease (KIT2006) | Reagent | Liquid | | your kit lot | 150 | µL | Refrigerated |
| Salmonella enterica ser. Typhimurium ATCC 14028 | Microbiological Strain | Liquid | Salmonella | your lot | 1 | each | Ultra-low |

Notes on the list:
- **Supplier and catalogue number.** Use Hygiena for the BAX lots (catalogue KIT2006, per the SOP). Use bioMérieux for API 20E. Anything else is optional.
- **The positive control strain is my assumption.** ATCC 14028 is a common Salmonella control, but ask Colleen which strain AFL actually uses.
- **The strain must name the Salmonella analyte.** The Batching step's "positive control from strains" only accepts a strain lot whose analyte is one of the test's.
- **Optional items.** TSB is only for the egg protocol, so I left it out. Bleach and DNA AWAY can be added as Consumables if you want them on the list; no step uses them.

### 6b. The lysis reagent (Inventory > + In-house mixture)

- Name: "BAX lysis reagent".
- Components: 150 µL of BAX protease and 12 mL of BAX lysis buffer (MC-12.06 8.2.3, which gives 12.5 µL per mL).
- Expiry: today plus 14 days ("up to two weeks").
- Storage: Refrigerated.

The system will not let the expiry run past either component's expiry. MC-12.06 needs exactly this rule, and today it is a note in the SOP.

## Step 7. Methods (Admin > Tests and workflows > Methods (SOPs), paste)

| Method | SOP code |
|---|---|
| Hygiena Real-Time Salmonella Assay (BAX Q7) | MC-12.06 rev 1 |
| Salmonella Confirmation (FDA BAM Ch. 5) | MC-12.04 rev 1 |

The SOP files have no upload screen yet (a known gap). Put the revision in the code.

## Step 8. Test 1 of 2: Salmonella confirmation (build this first)

**Tab 1, Test and reporting:**
- Name: Salmonella confirmation (FDA BAM Ch. 5).
- Department: Microbiology.
- Method: MC-12.04.
- Report template: the lab default.

**Pricing and TAT (placeholders):**
- Base Price Only, $95.
- Standard TAT 5 business days.

**Procedure text:** paste MC-12.04 section 7 in one paragraph.

**Tab 2, Analytes:**

| Analyte | Result type | Result values | Found values | Hide on report |
|---|---|---|---|---|
| Salmonella | Qualitative | Negative, Positive | Positive | No |
| XLD colonies, HEK colonies, BSA colonies | Text | | | Yes |
| The six TSI and LIA reactions | Text | | | Yes |
| API 20E identification | Text | | | Yes |

- **Put "Negative" first.** The verification run uses the first value that is not "found" as its typical result.
- **I chose Text for the reactions on purpose.** It lets the analyst type MCF-034's own shorthand (for example K/A +/+). A pick list would need a value for every slant, butt, H2S and gas combination.
- **Specification:** leave it empty for the demo. With a "Negative" limit, the confirmed positive becomes an OOS. It would be held for an R-2 investigation, and that is a different demo.

**Tab 3, Workflow.** The steps run in a straight line, each after the one above.

| Key | Step name | Type | Settings | Equipment type |
|---|---|---|---|---|
| batch | Batch | Batching | Max samples 20. QC: Positive Control, Prep, frequency "Once" (per batch), material Strains, criterion Presence (applies to Salmonella only; untick the helpers). | |
| rv | Transfer to RV broth | Plating/Inoculation | Expected media "RV medium (0.1 mL enrichment into 10 mL)"; plates per entry 1 | |
| inc_rv | Incubate RV | Incubation | 42 °C ± 0.2; 24 hours; window 22 to 26 | Water bath |
| streak | Streak HEK, XLD and BSA | Plating/Inoculation | Expected media "HEK, XLD and BSA agar"; plates per entry 3 | |
| inc_plates | Incubate selective agars | Incubation | 35 °C ± 2; 24 hours; window 22 to 26 | Incubator |
| read_plates | Read selective agars | Data Entry | Value label "Typical, Atypical or None"; attachment not required; analytes: the 3 colony helpers | |
| pick | Pick to TSI, LIA and MacConkey | Plating/Inoculation | Expected media "TSI and LIA slants, MacConkey (purity)"; plates per entry 13 (6 colonies x 2 tubes, plus 1 MAC) | |
| inc_tsi | Incubate TSI, LIA and MacConkey | Incubation | 35 °C ± 2; 24 hours; window 22 to 26 | Incubator |
| read_tsi | Read TSI and LIA | Data Entry | Value label "Slant/butt and H2S/gas, e.g. K/A +/+"; attachment not required; analytes: the 6 TSI and LIA helpers | |
| api | Inoculate API 20E | Plating/Inoculation | Expected media "API 20E strip, 0.85% NaCl suspension"; plates per entry 1 | |
| inc_api | Incubate API 20E | Incubation | 36 °C ± 2; 21 hours; window 18 to 24 | Incubator |
| read_api | Read API 20E and confirm | Data Entry | Value label "API profile and ID; Salmonella Positive or Negative"; attachment required (strip photo or apiweb printout); analytes: API 20E identification and Salmonella | |
| review | QC Review | QC Review | | |

Notes on the design:
- **The BSA 48-hour read (MC-12.04 7.2.2).** Workflows have no conditional steps. When BSA needs the second day, the analyst records a second incubator load for that sample with a note. The reviewer then accepts it in QC Review ("Incubator loads outside their target", built in WD-5.1). That is honest GxP: the exception is recorded and accepted, not hidden.
- **API incubation.** The SOP says "follow the manufacturer". I used 36 ± 2 °C for 18 to 24 h, which I believe is bioMérieux's instruction (about 85% sure). Check the package insert.
- **The API reagents.** On the bench, the analyst records TDA, James, VP 1 and VP 2 as materials of the read_api step, purpose Reagent. Each lot's expiry is checked automatically.

Tab 4, Review: no Errors. **Do not approve yet** (step 11).

## Step 9. Test 2 of 2: Salmonella BAX Q7 screen

**Tab 1, Test and reporting:**
- Name: Salmonella BAX Q7 real-time PCR screen.
- Department: Microbiology.
- Method: MC-12.06.
- Report template: the lab default.

**Pricing and TAT (placeholders):**
- Base Price Only, $45.
- Standard TAT 2 business days.

**Tab 2, Analytes:**

| Analyte | Result type | Result values | Found values | Hide on report |
|---|---|---|---|---|
| Salmonella | Qualitative | Negative, Presumptive positive, Indeterminate, Signal error (in this order) | Presumptive positive | No |

**Not a result** (the new column, F3): `Indeterminate, Signal error`. No specification.

**Tab 3, Workflow (a straight line):**

| Key | Step name | Type | Settings | Equipment type |
|---|---|---|---|---|
| batch | Batch (one rack per shift) | Batching | Max samples 94. QC: Positive Control (Prep, Once, Strains, Presence) and Negative Control (Prep, Once, Absence). | |
| weigh | Weigh test portion | Weighing | Target "By product category": Food 24.5 to 25.5 g; Dry pet food 367.5 to 382.5 g (25 ± 0.5 g and 375 ± 7.5 g, MC-12.06 7.1.5 and 7.4.5); Environmental sponge and Environmental stick swab ticked **Not weighed**. Tick **Prep QC (controls) are not weighed**. | Top-loading balance |
| enrich | Add BPW (1 in 10) | Dilution | Single. Default 25 + 225. By category: Food 25 + 225; Dry pet food 375 + 3375; Environmental sponge 1 + 90; Environmental stick swab 1 + 10. Fields per entry 1. Expected diluent BPW. | Homogenizer |
| inc_enrich | Incubate enrichment | Incubation | 35 °C ± 1; 22 hours; window **20 to 24**. Window per product category: **Dry pet food 22 to 26** (MC-12.06 7.4.7). | Incubator |
| bhi | Regrow in BHI | Preparation | Procedure "MC-12.06 8.1.5: 10 µL enrichment into 500 µL pre-warmed BHI" | Biosafety cabinet |
| inc_bhi | Incubate BHI | Incubation | 37 °C ± 2; 3 hours; window 3 to 3.5 (the SOP gives no tolerance: ask Colleen) | Incubator |
| lysis | Lysis | Preparation | Procedure "MC-12.06 8.2: 200 µL lysis reagent + 5 µL BHI culture; 37 °C 20 min, 95 °C 10 min, 2 to 8 °C at least 5 min (ATB Gram-negative program)" | Thermal block, Cooling block |
| hydrate | Hydrate PCR tablets | Preparation | Fields: "Time into cooling block" (Time), "Time loaded into Q7" (Time). Procedure "30 µL lysate per tube; load after 10 to 30 min". | Cooling block |
| bax | BAX Q7 run | Data Entry | Value label "BAX result"; **attachment required** (the Q7 run report); analyte Salmonella | BAX System Q7 |
| split | Reflex to confirmation | Split off Test | Test: Salmonella confirmation; trigger **On finding**; finding steps: **bax**; Customer consent required: **off**; **Alert the client: ticked** | |
| review | QC Review | QC Review | | |

What each part delivers:
- **Login by matrix (F1).** The sample's matrix gives its product category (step 1). At the bench each row shows the category, the accepted range or "Not weighed", the expected enrichment amounts and the incubation window. A load holding food and pet food together is judged against the window they share (22 to 24 h), so load pet food on its own when it needs 26 h.
- **"Per shift" QC.** One set of controls per batch, with one batch per rack per shift. Nothing stops two racks in a shift; the analyst simply makes two batches.
- **Re-run on Indeterminate or Signal error (F3).** The row shows "Re-run required". Right-click it: "Read the selected rows again in a new analytical run" (signed, with a reason). It re-reads from the lysate (MC-12.06 8.5.2: repeat from 8.3). "If it recurs, repeat lysis": record Run 3 with the note "re-lysed". The bad reading stays on record but can never be reported.
- **The reflex and the alert (F2).** On a "Presumptive positive", completing the split step orders the confirmation on that sample from the client's accepted quote and emails the client's Positive alerts contacts at once. Controls never trigger either.

## Step 10. Qualify the media (Inventory > each media lot > Qualify media…)

**This is the step most likely to trip you up.** Since 0.10.0, every new Media lot needs qualifying before the bench will accept it. Your 9 new media lots are BPW, BHI, RV, HEK, XLD, BSA, TSI, LIA and MAC.

1. On each media lot, add two rows: for the test **Salmonella BAX Q7 screen** and for **Salmonella confirmation**. Both rows use the qualification test "Media Growth Promotion (USP <61>/<62>)".
2. This makes 9 qualification samples, each named after its lot ID. **Batch all 9 together** (the maximum is 10).
3. The analyst records Growth for each organism.
4. QA approves the batch. All 9 lots are then released for both tests.

Two limits to know:
- **The growth promotion test uses the USP organisms, not a Salmonella panel.** For the demo, say "here is media qualification; your lab's own growth promotion panel goes in this test".
- **Drafts may not be offered.** I believe the Qualify dialog lists draft tests (about 80% sure). If it does not, do this step after step 11's approvals, and do the verification after it.

## Step 11. Verify and approve (each version's Review tab)

Do the confirmation first, then the screen. For each version:

| Who | Action |
|---|---|
| analyst or you | Write the verification protocol |
| qa.reviewer | Approve the protocol |
| analyst | Execute |
| (automatic) | Evidence is captured in the background; wait for it |
| qa.reviewer | Sign the report |
| labsup | Approve the version |

What I expect from the runs (about 75% sure):
- **The confirmation should Pass.** The run picks equipment of each type, and qualified lots and the strain.
- **The screen should Pass.** My browser test built the same screen design (with all three new settings) and its verification passed.

If a run comes back "Pass with exceptions", QA justifies each untested requirement in the report. If it is a Fail, send me the report.

**Worth the time if you have it.** The verification document (URS, FRS, expected against actual, screenshots) is one of the strongest things you can show a lab director.

## Step 12. Client and distribution list (Intake > Clients, Contacts)

**Client:**
- Name: fictional "Prairie Pet Foods (demo)".
- Payment terms: as they are.
- **Partial reports off**, so the positive sample's COA waits for the confirmation instead of issuing "Presumptive positive" on its own.

**Contacts (fictional, example.com addresses):**

| Contact | Roles |
|---|---|
| Dana Ortiz, QA Manager | Primary, Receives Report, Quality, **Positive alerts** |
| Sam Whitfield, Plant Manager | Quality, **Positive alerts** |
| Orders desk | Ordering, Billing |

## Step 13. Quote (Pricing > Quotes > + New quote)

1. Add both tests from the CFL tab.
2. Send to client (the PDF goes to the Outbox).
3. **Accept…**, recording Dana as the contact.

The confirmation line is what lets the reflex order itself. It also bills only when it happens.

## Step 14. Order and login (Intake > Lab orders > + New order)

PO: DEMO-1016. Paste four samples, then add **only the screen test** to all four (the confirmation must not be ordered at login):

| Client sample ID | Matrix | Planned demo result |
|---|---|---|
| Granola bar, lot 2610-A | Snack (Food) | Negative |
| Sponge swab, Line 3 drain | Environmental sponge swab | Run 1: Signal error. Run 2: Negative. |
| Stick swab, filler nozzle | Environmental stick swab | Negative |
| Dry dog food, lot 26-288 | Dry pet food (kibble) | Presumptive positive, then confirmed Positive |

Submit, then log the samples in.

## Step 15. The bench (as analyst)

### The screen batch

1. **Testing > Backlog > Microbiology: Autobatch.** You get the 4 samples plus the positive and negative controls.
2. **Batching.** Record the ATCC 14028 lot on the positive control. Sign.
3. **Weigh.**
   - Scan or paste 25.12 g (granola) and 375.40 g (pet food). The swabs and controls show "Not weighed".
   - Show a flag: type 390 for the pet food first. It shows "Outside the range" against its own 367.5 to 382.5 g. Then correct it (a reason is asked).
   - Record BAL-M2.
4. **Add BPW.**
   - Click **Each sample's amounts (by its matrix) for empty rows**: granola 25 + 225, pet food 375 + 3375, sponge 1 + 90, stick 1 + 10. Save.
   - Record the BPW lot and STOM-01.
5. **Incubate enrichment.** Two loads into MI05: the food, swabs and controls (about 22 h), and the pet food on its own (about 25 h). The Window column shows 20 to 24 h and 22 to 26 h (Dry pet food); neither load is flagged. That is Colleen's "login by matrix drives the incubation window".
6. **BHI and Incubate BHI.**
   - Record the BHI lot.
   - Record an MI07 load of 3 h 05 min.
7. **Lysis.** Record the lysis reagent lot (the system checks its 14-day expiry), ATB-01 and CB-01.
8. **Hydrate.** Record the PCR tablet lot and the two times.
9. **BAX Q7 run.**

   | Entry | Run 1 |
   |---|---|
   | Positive control | Presumptive positive |
   | Negative control | Negative |
   | Granola | Negative |
   | Sponge | **Signal error** |
   | Stick | Negative |
   | Pet food | **Presumptive positive** |

   - Attach the Q7 report and record Q7-01. The sponge shows **Re-run required**.
   - Right-click the sponge: "Read the selected rows again in a new analytical run". In Run 2, enter Negative, attach its report and record Q7-01.
   - Optional: complete the run first and show QC Review refusing to approve ("Signal error is not a result: read it again"), then do the re-run.
10. **Reflex to confirmation.** Complete the step. The confirmation is ordered on the pet food sample, and you can see it on the sample page under split-off requests.
    - The "Presumptive result" emails to Dana and Sam are in the Outbox (Intake > Outbox), with the time and who completed the step. The split tab and the pet food's sample page show "Client alerted".
    - The Sandbox never sends email for real: say so. The Outbox row is the audit trail.

### The confirmation batch

The pet food sample and one positive control.

1. **RV.** Record the RV lot, then an MI100 load (24 h).
2. **Streak.** Record the HEK, XLD and BSA lots, then an MI05 load (24 h).
3. **Read selective agars.** XLD Typical, HEK Typical, BSA Atypical.
4. **Show the BSA rule.** Add a second load for BSA with the note "No typical colonies at 24 h; re-incubated to 48 h per MC-12.04 7.2.2".
5. **Pick.** Record the TSI, LIA and MAC lots, then an MI05 load.
6. **Read TSI and LIA.** Paste a row: TSI "K/A +/+", LIA "K/K +/-" for each section.
7. **API.**
   - Record the API strip and NaCl lots, then a load.
   - At read_api, record TDA, James, VP 1 and VP 2.
   - Enter the profile you read with "Salmonella spp.", and Salmonella **Positive**.
   - Attach a photo.

## Step 16. Review and the two COAs

1. **QC Review of the screen batch (qa.reviewer).**
   - Approve each step.
   - The sponge's Run 2 Negative is chosen by itself: the Signal error is not a candidate. QC Review lists it under "Readings that are not results".
   - Controls: Pass. Approve the batch with one signature.
2. **QC Review of the confirmation batch.**
   - Accept the BSA load with a justification.
   - Accept the positive control.
   - Approve.
3. **Report Finalization (projmgr).**
   - Claim the samples.
   - Preview: the granola COA reads Salmonella Negative (one negative COA).
   - The pet food COA carries both tests: the screen "Presumptive positive" and the confirmation "Positive". The helper analytes are hidden.
   - Finalize with one signature. The PDFs and the "COA Issued" emails are in the Outbox.

**Also worth showing:**
- the sample page's audit trail;
- an equipment page (MI100's logbook checks);
- a lot page (where the RV lot was used);
- the order's Billing card, where the confirmation shows only on the positive.

## MCF-034, field by field: where it lives now

| MCF-034 field | In LIMS3 |
|---|---|
| Sample numbers, date, tech initials | The batch's samples; every step signed "Performed by" with the date and time |
| RV / HEK / XLD / BSA / TSI / LIA / MacConkey / API / TDA / James / VP1 / VP2 lot and expiry | Lots recorded on each step. Expiry comes from the lot record, and expired or unqualified lots are refused. |
| Incubation time in, out, tech | Incubator loads (time in, time out, who). Out-of-window loads are flagged and must be accepted by the reviewer. |
| Water bath MI100 or ___, incubator MI05 or ___ | The unit picked from the equipment type. It must be available and calibrated, and failing logbook checks flag the batch. |
| "Verify equipment is suitable" note | Enforced by the system instead of by the technician |
| Page 2: TSI and LIA slant/butt, H2S/gas per media section | read_tsi, six values per sample, kept with the result and hidden on the COA |
| API final ID | read_api, plus the attached strip photo |

## Things in the SOPs to raise with Colleen (found while mapping them)

1. **BHI is missing from MC-12.06's materials list.** Section 8.1.5 uses BHI, but section 4.0 does not list it.
2. **Typo in MC-12.04.** Section 4.4 says "Bismuth sulfate agar". The medium is bismuth sulfite agar.
3. **A broken sentence in MC-12.04.** Sections 7.1.3 and 7.1.4 split one instruction across two numbers ("transfer 3 mm (10 µL)" / "onto 1 plate each").
4. **Reflex or confirm on request?** MC-12.06 8.5.3 says "upon request by the customer". This decides the consent setting.
5. **Control acceptance criteria.** MC-12.06 9.1 and MC-12.04 8.1 give no acceptance criteria for the controls. I assumed positive control "Presumptive positive" / "Positive" and negative control "Negative".
6. **The BHI step has no tolerance.** It says 37 °C for 3 hours, with no time or temperature tolerance.
7. **Two temperatures for the same incubator.** MC-12.06 says 35 ± 1 °C and MC-12.04 says 35 ± 2 °C. MI05 serves both, so the logbook limit uses ± 1.
8. **Which control strain does AFL use?** I assumed ATCC 14028.

## Later, not for Friday (gaps a production build would need)

- **Ending a sample early.** "No suspect colonies, report Negative, skip TSI/LIA/API." Today every step runs for every sample in the batch.
- **"Re-lyse" as its own re-run choice**, instead of a note on Run 3.
- **Hold-time checks.** Enrichment up to 4 h at room temperature, and PCR tubes 10 to 30 min before loading, are recorded but not enforced.
- **The test portion on the COA**, for example "Negative in 25 g" or "Negative per sponge".
- **Reading the Q7 export directly**, instead of typing and attaching it.

## Confidence flags

- **Partial reports (about 90% sure).** Turning them off holds a sample's COA until all of its tests are finalized, not the whole order's.
- **Several media lots on one step (about 85% sure).** I expect a Plating/Inoculation step to take several media lots per sample (HEK, XLD and BSA on one step). If it only takes one, split "Streak" into three steps.
- **Time stamps for a Friday demo.** The system refuses future times, but not past ones, so a one-night build means typing times in and out from earlier. Tell Colleen the times were typed for the demo. Better still, run one load live and let the "outside window" flag show.
