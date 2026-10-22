# Salmonella BAX Q7 demo: what was built and the demo script (Colleen, 2026-10-16)

For: Colleen Villanueva's demo request (email "Re: Test Demo Build", 2026-10-15). Sources: MC-12.06 rev 1, MC-12.04 rev 1, MCF-034 rev 1.
Written by Claude in the cloud, 2026-10-15; updated for **LIMS3 0.21.0**; **built for Alex on 2026-10-16 as demo data (0.21.1, `seed_032_salmonella_bax_demo.sql`)**, because there was no time to click through it before the 11:00 meeting.

## What is in the system

Claude Code applies the file with a restart of your app (back up first). Everything below is at CFL and fictional.

**Already there:** both tests (approved by the demo Lab Supervisor), 9 instruments with calibrations, 20 lots, the client **Prairie Pet Foods (demo)** with Dana Ortiz and Sam Whitfield on Positive alerts, and an accepted quote with both tests.

**Differences from the click-by-click procedure** (`Procedure - Salmonella BAX Q7 Demo Build (Colleen)`, which stays as the record of the design):
- The food matrix is a new "Food (ready-to-eat)", not your Snack matrix.
- No pipettes and no logbook entries: the instruments are calibrated, but they are not in LB-0001/2/3.
- No media qualification and no verification runs. Demo data loads count media as qualified, and your gate is off. Do not offer to show a verification document for these two tests.
- "Inoculate API 20E" is a Preparation step, and read_api asks for no attachment.

**Suggested demo order (about 20 minutes):**
1. **Tests and workflows > Salmonella BAX Q7 real-time PCR screen.** Workflow tab: Weighing by product category (swabs Not weighed), BPW amounts by category, the pet food window 22 to 26 h, "Not a result" on Analytes, the Split off step with "Alert the client". Then the confirmation test: MCF-034 as steps.
2. **Order DEMO-1015 (finished, from "yesterday").** Open its screen batch from the Batches list:
   - **Weigh:** each row's category and accepted range; the swabs and controls "Not weighed".
   - **Incubate enrichment:** the pet food in its own load, with its own window.
   - **BAX Q7 run:** Run 1 shows the sponge's Signal error; Run 2 shows the re-read Negative, with its own Q7 report and instrument.
   - **Reflex to confirmation:** the dog food's request, Ordered, with no consent needed.
   - **Intake > Outbox:** the "Presumptive result" emails to Dana and Sam. That is the audit trail; the Sandbox sends nothing for real.
3. **The confirmation batch** (the dog food sample's page links to it): MCF-034 page 1 and 2 as steps, and the BSA 48 h load flagged in red, then accepted by QA with a justification.
4. **Report Finalization, signed in as projmgr.** Claim DEMO-1015's four samples, preview, then issue. The dog food COA shows the screen "Presumptive positive" and the confirmation "Positive"; the helper analytes are hidden. Checked in the cloud: every release check passes.
5. **Live: DEMO-1016 (today).** Four samples, one per matrix, waiting in Testing > Backlog > Microbiology. Signed in as analyst, Autobatch, then show the Weigh tab (each sample's own range) and click "Each sample's amounts (by its matrix) for empty rows" on Add BPW. Stop there: the enrichment needs 20 hours.

**Say it before Colleen asks:** DEMO-1015's incubator times were typed into the past, but its samples are logged and its steps signed today. So "Received" and "Tested" on the COA read today's date.

**Questions for Colleen** are in the procedure doc, section "Things in the SOPs to raise with Colleen".
