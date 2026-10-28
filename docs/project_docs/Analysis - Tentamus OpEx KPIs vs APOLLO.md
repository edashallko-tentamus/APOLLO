# Analysis: Tentamus OpEx KPIs vs APOLLO (2026-10-28)

Source: "Definition of Operational Expressions and KPIs", Tentamus Operational Excellence Core Network, version 9 (pre-final, 2025-12-17), 140 slides. Reviewed for Alex as background for the APOLLO KPI module. **It is not a design input:** Alex asked that it not be built in directly. None of these KPIs are mandatory for APOLLO. APOLLO should be able to produce them where that helps a decision.

## What the deck defines

The deck is mostly vocabulary: product, order, sample, sub-sample and split-sample, service, method, parameter, analysis, CoA, subcontracting, and fields of business and operations. On top of that sit time-stamp "Log Points" (L-numbers) and **10 KPIs**:

| Family | KPI | Definition, in short |
|---|---|---|
| Volume | Samples received | Customer samples past L203 Parcel Receipt in the period. Excludes QC, proficiency testing, method development and validation samples, and cancelled samples. |
| Volume | Samples reported | Customer samples whose first complete CoA (L660) was sent in the period. Preliminary CoAs don't count. |
| Workload | Open samples | At a point in time: registered (L260), not cancelled, not under clarification. Includes samples with a deferred start. |
| Workload | Samples with deferred TAT start | Open samples whose "don't start analysis before" date (D303) is still in the future. |
| Workload | Lab-available open analyses | Analyses distributed to the lab (L340) and not yet approved, usually counted by method. |
| Workload | Analyses performed | Analyses approved (L555) in the period, re-analyses included. |
| Speed | TAT-50 | Median sample TAT, TAT Start (L222) to TAT End (L666), in calendar days with 2 decimals. |
| Speed | TAT-95 | 95th percentile of the same. |
| Reliability | TAT-R | % of samples reported at or before their due date (D604), compared by date and time. |
| Digital | % automated registered samples | Samples whose order arrived electronically (portal or interface), as a share of samples received. |

Key rules behind them:
- **TAT Start (L222)** is the latest of parcel receipt, clarification solved, and "don't start before". It falls back to registration only when none of those exist.
- **TAT End (L666)** is the first complete CoA sent. Later corrected versions never move it, so the deck says corrected CoAs must be monitored separately.
- **Due date (D604)**: the sample's longest service TAT is added to TAT Start, in calendar time with hours and minutes, plus non-working days. It changes only for customer-initiated reasons.

## Where APOLLO already aligns

- **Samples reported, and TAT End:** APOLLO uses the first issued COA, not preliminary results, and later versions don't move it. Same rule.
- **Lab-available open analyses** is APOLLO's backlog. **Analyses performed** is QC Review approval.
- **Open samples** is APOLLO's work in progress.
- **TAT-50:** the dashboards already show median turnaround, including a received-to-logged segment.
- **Excluding non-customer samples:** APOLLO does this structurally. Verification, QA testing of lots, training and media samples sit under internal clients and are already left out of the dashboards.

## Where APOLLO is stronger

- **Every step is time-stamped automatically** with who did it, through signatures and the audit trail. The deck asks for this as a goal. APOLLO can measure any segment (the deck's TAT[Lx–Ly]) without new capture points.
- **Due dates and on-time at test level as well as sample level.** The deck works per sample only.
- **Client holds** are not counted against the lab.
- **Quality KPIs the deck doesn't define:** OOS, QC failures, control-chart signals, COA versions and invoice corrections. The deck itself says the corrected-CoA rate should be monitored but gives no definition.
- **Money:** revenue, budget and EBITDA come from the LIMS's own invoices.

## Where the deck is ahead (gaps, if we choose to align)

1. **The clock starts at receipt (L222), not at login.** APOLLO already records the received time, so this is mostly a change of rule. It belongs with the sampling slice.
2. **A "sample under clarification" state** (L213 to L217), which pauses nothing but moves the start. APOLLO only has On Hold at client level.
3. **"Don't start analysis before" (D303)** on a sample. APOLLO covers shelf-life work through stability pulls, but not ad hoc deferrals.
4. **Due dates with a time of day.** APOLLO uses whole days.
5. **TAT-95.** It's missing but trivial to add.
6. **% automated registration.** This waits for the customer portal.
7. **Cross-company work:** group-wide product numbers, and selling-company vs performing-company TATs for subcontracting within Tentamus.

## Recommendation

Give the APOLLO KPI module these 10 KPIs as standard definitions, using the deck's names and formulas, so that APOLLO can always answer in corporate language. Keep APOLLO's own KPIs (test-level on time, quality, money) alongside them, clearly named as APOLLO's. The one change that unlocks most of the alignment is gap 1: start the clock at receipt, with clarification and "don't start before". It fits the sampling slice.

**Not reviewed:** the Log Point Overview and Standard Process Steps posters are images in the PDF. The full L-number list was not read, only the log points named in the definitions.
