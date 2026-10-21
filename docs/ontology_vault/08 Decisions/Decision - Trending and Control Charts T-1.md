---
type: Architecture Decision
status: Proposed (built by Claude without Alex's input, on his instruction, 2026-10-17); every choice below is open
decided: 2026-10-17
built: 2026-10-17 (migrations 042 and 043, seed 034, version 0.24.0)
---

# Decision - Trending and Control Charts T-1

Alex, 2026-10-17: "build a control charting module without my input and I'll see how it looks. Main features that are needed: anything with commonality as data or records can be control charted. Charts are downloadable. Some charts, like analyte charts, can be applied (maybe?). Be creative and think of what else could be in this module for trending... OOS etc." Everything here is Claude's design. Nothing is confirmed.

## The idea in one line

A trend chart is a **read-only view** of records the lab already keeps (approved results, approved QC, logbook entries, stability pulls, OOS investigations, re-preparations, failed checks). It never changes a record. What the LIMS keeps are the **saved chart definitions**, their **frozen limits**, and **people's reviews of the signals** they raise. That keeps the module out of the GxP data path while still giving it an audit trail.

## What can be charted (six sources)

| Source | One point is | Chart | Limits drawn |
|---|---|---|---|
| Results | a final result of one test and analyte (filters: client, matrix, product) | Individuals and moving range | the usual specification (most common one) |
| QC checks | a QC check of an approved batch (QC type, acceptance limit type, analyte) | Individuals and moving range | the QC acceptance limits |
| Logbooks | a number in a logbook entry (temperature, balance error, CFU/mL), all equipment together or each one | Individuals and moving range | the logbook's limits |
| Stability | a pull result, by months on stability, per condition | Regression with a one-sided 95 % bound | the specification; shelf life where the bound meets it |
| Events over time | a week or month: OOS opened, OOS rate, OOS confirmed, re-preparations, re-analyses, failed equipment checks, chamber excursions, lots rejected by QA testing, on-time reporting, turnaround days | c chart (counts), p chart (rates), individuals (days) | none |
| Pareto | categories: OOS by test, OOS by outcome, re-preparations by test, failed checks by equipment, by logbook | bars with the cumulative % and the 80 % line | none |

"Each" expands a chart into panels: each analyte of a test, each QC check of a test's batching step, each piece of equipment on a logbook. One saved chart then covers, say, every fridge and chamber on the temperature log.

## The statistics

- Individuals: centre line the mean; sigma from the average moving range / 1.128; limits ± 3 sigma; moving range chart with its upper limit 3.267 × MR̄.
- c chart: limits c̄ ± 3√c̄. p chart: p̄ ± 3√(p̄(1−p̄)/n) per period. Lower limits stop at 0.
- **Signals** (Western Electric): R1 a point beyond 3 sigma; R2 2 of 3 beyond 2 sigma on one side; R3 4 of 5 beyond 1 sigma on one side; R4 8 in a row on one side; R5 6 in a row rising or falling (5 steps); LIM outside the specification or acceptance limits. Each chart chooses its rules. On c and p charts whose lower limit is 0, a run below the centre line is not a signal (months with no events are not a pattern).
- **Capability** against the specification or limits: Cp, Cpk (within sigma) and Ppk (overall SD); under 20 points they are marked "indicative only".
- **Stability**: least squares per condition (T0 joins every condition), the one-sided 95 % confidence bound of the mean, and the time it reaches the specification (the ICH Q1E approach), looked at up to twice the longest time measured.

## What a person does with it

- **Trend watch** (Testing > Trending): every watched chart as a tile with a sparkline, its latest point, and the signals nobody has reviewed. Charts with signals to review come first.
- **Build a chart**: pick a source and what to chart, draw it, download it, copy a link to it, or save it (trending.manage).
- **A saved chart** (TC-0001...): its panels with Individuals, Moving range, Histogram and capability, and Data views. Each signal can be **reviewed**: an outcome (Investigated: no action; Action taken; Linked to an OOS or deviation; Expected, known cause) and what was found. One current review per signal.
- **Frozen limits**: the centre line and sigma are calculated from a baseline period (at least 20 points for individuals, 6 periods for counts) and kept, so new points are judged against a stable baseline rather than limits that move with every point. Who froze them and when are recorded; a frozen chart cannot be changed to chart something else until the limits are recalculated (reason asked).
- **Applied to QC Review** (Alex's "applied (maybe?)"): a QC chart can be shown in QC Review of its test's batches. The batch's own QC points are ringed in blue and a signal at this batch is flagged before the reviewer approves it.
- **Report packs**: OOS trends; Lab performance; Equipment and environment; Every watched chart (a monthly trend review in one PDF).
- **Downloads**: PNG, SVG, CSV, Excel and PDF for every chart; PDF for each report pack. The PDF is built by the server from the definition (with the signals and their reviews), never from a picture sent by the browser.

## Who may do what

- `trending.view`: see, build and download charts. Analyst, Lab Supervisor, QA, General Manager, Project Manager.
- `trending.manage`: save and change charts, freeze limits, show a chart in QC Review, review signals. Lab Supervisor, QA.

## Build choices (Proposed)

1. Charts read approved data only: final results, approved batches, entries that are not voided. Workflow verification orders and batches and media QA-test results are left out.
2. The default period is the last 12 months; QC charts take the latest 150 approved batches.
3. Sigma for individuals is the within sigma (moving range), the textbook choice; capability shows both within (Cpk) and overall (Ppk).
4. The specification drawn on a results chart is the most common one among the points (clients' specifications differ).
5. A signal review is not signed (it is kept in the audit trail with a reason). It is a monitoring record, not a decision about a result.
6. Seed 034 makes eight demo charts at each lab with the demo logbooks: temperatures (each piece of equipment), the balance check error, the USP <51> inoculum count, Vitamin C results, ICP-MS LCS recovery (in QC Review), OOS per month, failed checks per month, failed checks by equipment.
7. The demo has no approved batches with QC yet, so QC charts start empty and fill as batches are approved.

## Also in 0.24.0: a control counted 0 (migration 042)

Alex's fix of 2026-10-15 ([[Decision - Stability Studies S-2 Scope]]), built: a control is judged on its calculated value when there is one; when the calculation is undefined only because a count it uses is 0 (the log of zero), the control does not hold the Calculation step open, and an Absence control passes (a Presence control fails) on its count of 0. Samples are unchanged: a sample's undefined result still waits. **USP <51> version 2's verification now passes** (it failed on the negative controls).

## Questions for Alex

- Is this the shape you wanted? What is missing, and what should go?
- Should reviewing a signal be signed (21 CFR Part 11 signature) or stay a reasoned audit-trail entry?
- Should a signal at a batch block QC Review approval, or only be shown (built: shown)?
- Who should see trend charts: is the Project Manager right, and the Account Manager wrong?

## Questions for QA (Jake Teller)

- Western Electric rules R1 to R5 by default for every chart, or R1 only for some sources (fewer false alarms)?
- Is a monthly "every watched chart" PDF with reviewed signals acceptable evidence of trend review for ISO/IEC 17025 7.7.1 and 21 CFR 211.180(e)?
- Frozen limits: who may freeze them (built: Lab Supervisor, QA), and does a frozen baseline need a second person?

Related: [[Open Items for QA Review]], [[Decision - Electronic Logbooks L-1 and L-2]], [[Decision - OOS Investigation Build Choices]], [[Decision - Stability Studies S-2]].
