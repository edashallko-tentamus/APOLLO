---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Molar Mass Lives on the Analytes List

Each analyte can carry a molar mass (g/mol) and its source on the Analytes list, so molar standards (M, mmol/L) convert to mass concentration (mg/L) when they go into a mixture: mg/L = mol/L x molar mass x 1000. Only QA, Lab Supervisors and administrators can set or change it; it needs a source (for example "IUPAC standard atomic weights 2021") and an electronic signature. Normality (N) is never converted (it depends on the reaction) and shows "Not calculated" with that reason. When a certificate states the concentration as a compound (for example sodium as NaCl), the item's analyte line records "Expressed as", its formula weight and how many of the analyte are in one formula unit, and the analyte amount is converted with them. Molar mass is not put on the inventory item or the Unit conversions table, because it belongs to the substance, not to a lot or a unit. Proposed by Claude, confirmed by Alex Kiddle on 2026-10-12, who chose QA and Lab Supervisors as editors. Demo values from IUPAC standard atomic weights (abridged, 2021). Built in migration 007.

See [[Analyte]], [[Unit of Measure]], [[Decision - Mixture Quantity and Concentration Are Calculated From Components]].