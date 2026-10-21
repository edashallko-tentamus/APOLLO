---
type: Architecture Decision
status: Approved in principle (Alex, 2026-10-15); built 2026-10-15 (migration 037, seed 030, version 0.20.0); build choices Proposed
decided: 2026-10-15
---

# Decision - Dashboards and the Executive Dashboard D-1

Order (Alex, 2026-10-15): dashboards first, then invoicing ([[Decision - Invoicing Is Done in the LIMS]]), then S-2 ([[Decision - Stability Studies S-2 Scope]]).

**Widget library (Alex's answers to Claude's proposal)**
- A widget is a small card with a number or chart; every number opens the list behind it. Widgets show only what the person's permissions and lab allow.
- **Intake:** samples logged today and this week; samples expected but not received. **Rush is its own widget** (rush waiting for approval, rush in the lab).
- **Lab:** backlog by department and age; batches in progress; waiting for QC Review; overdue tests; **a widget for the person's own worklist**.
- **Turnaround (TAT), in three segments:**
  - **Login TAT:** sample submitted (received) to logged in.
  - **Lab TAT:** logged in to QC Review approval.
  - **QA TAT:** QC Review approval to report release (COA issued).
  - **On time** = COA issued by the due date. **Time while the client's account is on hold does not count against the TAT KPIs** (Alex).
- **Quality and sign-off:** widgets structured by task, as lists of what is waiting to be signed: QC Review, Report Finalization, OOS, logbook entries for QA, **equipment (release) and inventory (approvals)** included.
- **Supplies:** equipment due or tagged out; lots expiring or low; purchase requests waiting. **Low stock against demand:** highlights samples submitted or in the backlog pool that are at risk because a material their test needs is low.
- **Commercial:** open quotes and their value; quote win rate.
- **Stability:** pulls due this week; studies awaiting material; chamber excursions not assessed.
- **Revenue (until invoicing exists, the value of the work at quoted prices, labelled as not invoiced):**
  - a revenue counter for the month and the year;
  - work in progress (WIP) for the month: revenue in progress;
  - projected monthly revenue = revenue + WIP;
  - samples received: current month, previous month, current quarter, year to date, with the average sample value.
- **Network level:** the same revenue and sample widgets per laboratory, compared with the previous month, the quarter, the half year and the year to date.

**Dashboards**
- **Home is the dashboard.** The widgets come from the person's groups; each person arranges them by dragging and resizes them by dragging corners.
- **An executive dashboard that GMs cannot see**, so executive information is never shown by accident. **GMs have their own dashboard** for their labs.
- **Refresh:** live where possible; to be evaluated for scale.
- **Finance (Alex):** weekly, the lab reports a financial update to the forecast: Revenue, Costs and calculated EBITDA. The executive dashboard holds, per month, the numbers filled in each week, compared with the Budget Forecast and the Monthly Forecast.

**Alex's answers, 2026-10-15 (13:30)**
1. **Revenue counts when the invoice is issued.** Everything else is work in progress (WIP), broken down as **Not Started, Incomplete, Finalized and Pending Invoice**. WIP that will finish next month is not counted in the month's projection, but its value is shown beside it as the **month-end boost** (what finishing work faster would add): both are shown.
2. Only the client's account being On Hold stops the TAT clock; time on an OOS investigation counts.
3. **Low stock against demand:** an inventory item names its **department**, and a test belongs to a department; the widget shows the submitted and backlog samples of that department at risk from its low stock. Alex also suggested learning from history: items duplicated from one another and used in tests form a family. Claude's view: there is no duplication link stored today, but actual use is recorded (every lot used at a bench step names its test), so use history can refine the department link (see the build choices when written).
4. Finance numbers (budget, monthly forecast, weekly costs) are entered by system administrators and a new all-labs Finance group; weekly revenue is typed by finance from the books, with the LIMS figure beside it. EBITDA = revenue less costs, only if the costs exclude depreciation, amortization, interest and tax (to check with finance).
5. The executive dashboard is for the Executive group and system administrators; GMs have their own dashboard.
6. Lab administrators set each group's widgets; a person in several groups gets all of them and arranges and resizes their own.

**Order changed (Alex, 2026-10-15):** invoicing was built first (0.19.0, [[Decision - Invoicing I-1]]), so revenue is real: it counts when an invoice is issued.

## What was built (migration 037, version 0.20.0)

- **Home is the dashboard.** The widgets of the person's groups at the lab (Admin > Dashboard widgets, lab administrators with admin.groups; every standard group has a starting set). A widget that needs a permission (revenue, work in progress, projection: invoicing or GM; quotes) shows only to people who hold it. Each person moves widgets by dragging the title bar, resizes them by dragging the corner (2 to 12 columns, 1 to 6 rows), puts them away and brings them back, or resets; the arrangement is kept per person and per dashboard. Every number opens its page, or the list behind it (overdue tests, rush, late COAs, slowest tests, work in progress by stage, the month's due work and boost, samples by period, invoices by period, samples at risk). The page refreshes every minute while it is open.
- **Widgets (20):** My work; Intake; Rush; Backlog by department (age under 2 days, 2 to 5, over 5); Batches; Overdue and due today; Turnaround (median and average of Login, Lab and QA TAT over 30 days); On time (this month, last month, the year); Waiting to be signed (QC Review, Report Finalization, OOS, logbook entries for QA, equipment waiting for release, purchase requests, draft invoices); Lab supplies; Low stock against demand; Quotes (open, value, 90-day win rate); Stability; Billing; Revenue; Work in progress; This month's projection; Samples received; Labs side by side; Finance update. See [[Turnaround and On-Time Rule]] and [[Work in Progress Stages Rule]].
- **GM dashboard** (dashboard.gm, the General Manager group): the labs where the person is GM, together or one at a time; revenue, projection, WIP, samples, on time, turnaround, overdue, rush, quotes, and the labs side by side.
- **Executive dashboard** (dashboard.executive: the Executive group, the new all-labs Finance group, system administrators; never General Managers): every lab side by side (revenue this month, last month, quarter, half year, year to date; work in progress; samples this month, last month, year to date; average sample value; on time this month) and the finance update by month (actual revenue, costs and EBITDA from the weekly figures; Budget and Monthly Forecast EBITDA; LIMS invoiced revenue beside the books), with a chart of EBITDA against both forecasts. One lab can be picked.
- **Finance figures** (finance.enter: system administrators and the Finance group): the weekly update per lab (week ending, revenue, costs, note) and the Budget and Monthly Forecasts per lab and month, typed or pasted with fill down; audited.
- **Low stock against demand:** an inventory item names its department (the item form and lot page); the widget lists the lab's low, negative or expiring lots and counts the backlog samples of that department, or of the tests that used the same item at the bench in the last 180 days.

## Build choices (Proposed, for Alex to confirm)

1. **On time is judged per test** (COA issued on or before the due date, plus the calendar days the client was On Hold between Day 0 and the report). The client's hold periods are read from its audit trail.
2. **Login TAT starts at the sample's received time** (when recorded) and ends at logging; Lab TAT ends at the last QC Review approval of the test's final results; QA TAT ends at the first COA that carried it. Shown in calendar days.
3. **WIP stages:** Not Started = not in a batch; Incomplete = in a batch; Finalized = results approved in QC Review, report not issued; Pending Invoice = report issued (or on a draft invoice), not invoiced. Valued at the price ordered plus the rush fee; non-billable retests and internal work are left out.
4. **Projection** = invoiced this month + WIP that is Pending Invoice, Finalized, overdue or due this month; the **month-end boost** = WIP due next month or later (Not Started or Incomplete).
5. **Samples received** are counted by the day logged; the average sample value is the work ordered on them.
6. **The Finance group also sees every lab's records (view only, data.view_all)**, so its members can open the app; it changes nothing but the finance figures.
7. **Layouts are a personal preference, not a record:** not in the audit trail. Group widget changes are audited with a reason.
8. **Refresh every minute**, only while the page is open and visible (not a live push; to evaluate at scale).
9. **Demo data:** fictional finance figures for CFL and TPS for the year so far, a demo GM and a demo Finance user, departments set on inventory items by type (media and strains Microbiology; chemicals Chemistry).
10. **The home tiles page** ("Things to try") is kept at #/start.

## D-1.1, Alex's notes (2026-10-15 evening; built by Claude Code, migration 038, seed 031, version 0.20.1)

**Alex's decisions**
- **Two on-time widgets.**
  - Tests: the main figure compares the QC Review completion with the test's due date. The release on a COA is a second, smaller, less prominent figure.
  - Samples: a sample is on time when its complete COA is issued by its due date (the latest of its tests'). The executive dashboard is interested in the sample level.
- **On Hold days do not count as a delay** (confirmed).
- **The week's revenue is pulled from the LIMS and locked** (option A).
  - Finance types the costs; the books' revenue stays as an optional figure, shown last.
  - EBITDA = LIMS revenue less costs.
- **Finance update:**
  - LIMS invoiced to the left and the books to the end.
  - "Weeks in" = the weeks of the month.
  - A line graph with Revenue / EBITDA / Costs tabs at the top right.
  - After seeing it: a sharper chart, the deviation from the Budget Forecast next to LIMS invoiced, Costs and EBITDA, and an EBITDA margin line on a right-hand scale.
- **Labs side by side:**
  - A % deviation between Last month and Quarter: "all three" (this month vs last month, last month vs the 3-month average, this quarter vs last quarter).
  - An EBITDA tab.
  - Potential revenue (work in progress + revenue this month) to the right of Work in progress.
- **Finance figures:**
  - Tabs by lab instead of alternating rows.
  - Forecasts downloadable and uploadable as Excel.
- **GM dashboard:** a widget like the executive line graph (revenue, costs, EBITDA) for the GM's lab.

**Build choices (Proposed)**
1. **Comparisons to the same point.** This month to date is compared with last month to the same day, and this quarter to date with last quarter to the same point, so a comparison made mid-month is fair. "3-month average" = the last three full months.
2. **EBITDA for a period** = LIMS revenue less the costs of the weeks ending in it. It is blank when no costs are typed.
3. **Approval date.** The QC Review measure uses the test's latest final approval. A stability test approved after an earlier timepoint was released can therefore show approval after release.
4. **Completed date.** A sample is completed when the last of its tests was first released. A partial COA counts only once the rest follows.
5. **Margin scale.** The margin's right scale is capped at -100 % to +100 %; a month outside it sits on the edge, and hovering shows its real figure. The year's deviations and margin compare the months with actuals against the budget of the same months.
6. **Excel upload of forecasts.** The upload shows every change and error first, then saves through the same route as the grid, with a reason. It does not use the general bulk upload (whose rows have a single key).
7. **Demo finance figures** are rescaled to each lab's LIMS revenue (seed_031), only where nobody has changed them.

**Open:** Alex asked to "put the on-time percentage" on the samples widget. It already shows this month, last month and this year; Claude Code asked which change he meant.

## Not built yet
- Department use learned from duplicated items (Alex's idea): there is no duplication link stored; actual use at the bench is used instead.
- Payments and balances from QuickBooks; costs by lab from the books automatically.
- Charts of trends over time (week by week revenue and on time) beyond the finance update.
