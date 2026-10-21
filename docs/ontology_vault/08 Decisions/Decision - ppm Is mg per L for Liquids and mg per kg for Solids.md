---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - ppm Is mg per L for Liquids and mg per kg for Solids

For calculations, ppm converts to mg/L for liquids and to mg/kg for solids (likewise ppb to µg/L or µg/kg, ppt to ng/L). The liquid conversion assumes a dilute water-based solution with a density of 1 g/mL; that assumption is stored on the conversion and printed beside every concentration calculated with it. These are lines in the [[Decision - Units and Unit Conversions Are Controlled Tables|Unit conversions table]] marked "Liquid" or "Solid", so QA can change them. Chosen by Alex Kiddle, 2026-10-12.

See [[Ontology Principles]].
