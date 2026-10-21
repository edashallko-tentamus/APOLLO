---
type: Standard
status: Approved
---

# Grid Data Entry Standard

Every matrix, table or grid where data is listed or entered must support fast bulk editing. A user should never have to tab through rows to update several data-entry lines.

## Required behavior
- Fill down (Ctrl+D): copies the top selected cell's value into every selected cell below it, in one or several columns at once.
- Copy and paste: rectangular ranges copy and paste within the grid and to and from Excel (tab-separated), including pasting a whole table.
- Multi-cell selection by click-drag and Shift+click.
- Pasted and filled values pass the same validation as typed values; invalid cells are highlighted, not silently dropped.
- Bulk edits to GxP records still require one Reason for Change and, where the record requires it, an electronic signature for the whole change, with one audit entry per changed record.
- Smart dropdowns (decided 2026-10-12, applies to every pick list in the system, in grids and forms): typing filters to the closest matches (exact, then starts-with, then word starts, then anywhere); the Down arrow opens the full list; arrow keys move and Enter or Tab picks, so a value can be chosen with the keyboard only. In a grid cell, typing or Enter opens the list; the arrow keys still move between cells when not editing. A pasted value must match an option, otherwise the cell turns red.
- Every ID shown in a grid or on a page (order, sample, client, contact, quote, test, analyte and so on) is a real link to that record, so it can be opened, copied and shared (decided 2026-10-12).
- Child records can be listed under their parent row in a hideable panel, for example a sample's requested tests under the sample; the panel keeps all of the behavior above.

## Applies to
Any object whose UI Requirements section links here, and any future grid. Examples: analyte prices, quoted test lines, rush tiers and quote rush terms, stability matrices and timepoint tolerances, sample login, result entry, purchase order lines, holiday calendars, role and permission matrices.

See [[Ontology Principles]] and [[21 CFR Part 11 Controls]].
