---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Every Inventory Tab Exports and Uploads Excel

Each inventory tab (Inventory, Sample storage, Suppliers and manufacturers, Storage locations, Warning rules) and the Units and Unit conversions lists can be exported to an Excel (.xlsx) file and updated in bulk by uploading the edited file (or a CSV). Rows are matched on their ID; rows with an empty ID are created. Before anything is saved, the upload shows every change (old to new) and every error per row; a file with any error cannot be saved. Saving asks for one Reason for Change, runs every database rule, and is all-or-nothing: the first refused row stops the whole upload. Export of the inventory list can be limited to ticked rows. Built without extra software (the server reads and writes the Excel format itself). Requested by Alex Kiddle after reviewing slice 3. The paste-a-packing-list grid is kept as "Receive many", chosen by Alex.

See [[Ontology Principles]] and [[Grid Data Entry Standard]].
