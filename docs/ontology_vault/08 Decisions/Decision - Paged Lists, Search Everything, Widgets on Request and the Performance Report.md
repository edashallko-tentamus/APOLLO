---
type: Architecture Decision
status: Approved (Alex, 2026-10-21); build choices Proposed
decided: 2026-10-21
built: 2026-10-21 (version 0.35.0, no migration)
---

# Decision - Paged Lists, Search Everything, Widgets on Request and the Performance Report

Relates to [[Decision - Dashboards and the Executive Dashboard D-1]] (the widgets and finance figures) and the project doc `Measurement - Scale Test 1 (0.33.0 at network volume)` (why lists and widgets were slow).

**Context.** Scale measurement 1 (2026-10-21) found lists that load a lab's whole history and dashboards that recompute every widget every minute. Alex (2026-10-21):
- "let's work on speeding the system up with incorporating pages to each of the system lists ... limit it to the 50 most recent entries and have ongoing pages. We still want search bars where the user can type or scan the ID number and the correct page pull up."
- "For widgets lets limit the financial widgets to be refreshed on command instead of constantly refreshing."
- From the widget list Claude gave him: "make the following refreshable: Lab supplies, Stability. Let's make the live refresh every 5 minutes instead of every 1 minute. Let's add a global refresh button for each dashboard to refresh all non-live widgets."
- "On each widget say the last time it was refreshed and with the live widgets ... a static statement that says (Refreshed Every 5 Minutes). Make these messages small and decently inconspicuous."
- "a search bar at the top of all pages that allows the user to search any record, item, or ID within the system and pull up it's starting page."
- "In the finance module we should have the ability to download all data within a time frame into an excel file and I want you to come up with a meaningful GM/executive template that shows performance ... make the template digestable for a user but also make the raw data needed to generate it on a separate tab(s) with column headers that match the LIMS."

## Decision (Alex)

1. Every long list shows the 50 most recent entries, with pages. A search box on the list finds across the whole list; a typed or scanned ID opens its record.
2. Live widgets (worked out every 5 minutes while the dashboard is open): My work, Intake, Rush, Backlog by department, Batches, Overdue and due today, Waiting to be signed. Every other widget, including Lab supplies and Stability, is worked out on request.
3. Each dashboard has Refresh all for the widgets that are not live. Each widget says, small, when it was last worked out; the live ones say "Refreshed every 5 minutes".
4. A search box at the top of every page finds any record by ID or name and opens its page.
5. A performance report for a period, downloaded to Excel: a Summary a General Manager or executive can read, and the data behind it on separate tabs with the LIMS column names.

## Build choices (Proposed)

1. **50 a page, newest first**, tabs with their counts (the same filters the lists had), the tab, search and page kept in the address so Back returns to them. The audit trail (capped at 300) and logbook entries (capped at 500) are not paged; the backlog shows everything waiting.
   Default tabs show what needs work: Clients start on Current (Active and On Hold); OOS investigations on Open, which also holds a closed investigation whose client answer has not been handled.
2. **An exact ID opens at once** on Enter (ignoring case and spaces). On Lab orders a sample ID opens the sample; on Issued COAs a report ID opens its PDF.
3. **Search everything** covers samples (also client sample ID and METRC ID), lab orders (also PO number), COA report IDs and verification codes, inventory (also manufacturer's lot and CAS), equipment (also serial number), batches, clients, contacts (also e-mail), quotes and projects, stability studies, OOS investigations, invoices (only with invoicing.view or invoicing.issue), purchase requests and orders, suppliers, logbooks and entries, tests and trend charts. Lab records come from the lab being worked in; shared records (clients, contacts, suppliers, quotes) from everywhere. Up to 6 per kind. Opening a record still runs that page's own permission checks. No new permission.
4. **Widgets on request are kept by the server** per dashboard, labs, widget and person until refreshed. Kept in memory: a restart clears them (they are worked out on the next open).
5. **Who may download the report:** General Managers (their labs), the Executive and Finance groups (every lab) and system administrators. No new permission.
6. **The period** is at most two years; a period ending after today ends today, so budgets are never counted ahead of the actuals.
7. **Summary figures:**
   - Revenue (net) = invoices issued in the period less credit notes issued in the period.
   - Budget = each month's Budget forecast, counted for the days of the month inside the period.
   - Costs = the weekly costs Finance types, weeks ending in the period; EBITDA = revenue less costs, blank where no costs were typed.
   - Samples logged = client samples logged in the period (internal QA, media and training samples left out). Samples on time = of those fully reported, the share reported by the latest due date (client hold days added), as the On time (samples) widget.
   - Tests reported = first COA issued in the period; tests on time against their own due date; median days from logging to the first COA.
   - Work in progress and open OOS are as of the download, whatever the period.
   - Quality: OOS opened, confirmed, assignable cause found; retests ordered; tests reported late and their average days late; rush tests reported.
8. **Traceable:** revenue and costs on the Summary are SUMIFS formulas over the Invoices and Finance weeks tabs; the values are also written, so the file shows numbers wherever it is opened. A "How each figure is worked out" block ends the Summary.
9. **Raw tabs** (LIMS column names, frozen header, filter): Invoices, Invoice lines, Finance weeks, Finance plans, Samples, Tests, Work in progress, OOS investigations.

## Not done

- These changes avoid loading whole lists and repeating slow widgets. They do not fix the two causes found in Scale measurement 1 (one database connection; status recalculated over the whole history): Ready to invoice, Report Finalization and a widget's first load stay slow at network volume until that slice.
- Finance to confirm the figure definitions (revenue on invoice date; EBITDA from typed costs).
