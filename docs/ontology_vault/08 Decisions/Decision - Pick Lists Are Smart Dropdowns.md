---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Pick Lists Are Smart Dropdowns

Every drop-down field in the system, in grids and in forms, is a smart dropdown: typing filters the list to the closest applicable values, and the Down arrow opens the full list so a value can be chosen with the arrow keys and Enter alone. Values that are not on the list are refused (pasted values turn the cell red). Details are in the [[Grid Data Entry Standard]]. Requested by Alex Kiddle after reviewing slice 2.

See [[Ontology Principles]].
