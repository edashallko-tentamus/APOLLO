---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Mixture Quantity and Concentration Are Calculated From Components

Every [[Inventory Lot]] is marked Solid or Liquid (defaulted from its unit). For an in-house mixture: the quantity made defaults to the total of the component amounts that can be expressed in the mixture's unit (for a liquid made in mL, the total volume of the liquid components); the person can change it, for example when made up to the mark. The concentration of each analyte is calculated: the analyte mass in each component portion (liquid components: concentration in mg/L x volume used; solid components: concentration in mg/kg x mass used) divided by the mixture's volume (liquid) or mass (solid), reported in the unit chosen per analyte. A target concentration ± tolerance % can be set per analyte; the result shows Conforms or Alert. A concentration that cannot be converted with the Units tables (for example a molar standard) is shown as "Not calculated" with the reason, never guessed. The calculation note is kept on the lot. The mixture's own chemical is not entered; its analytes come from its components. Requested by Alex Kiddle after reviewing slice 3. Built in migration 006 (`mixture_concentrations`, `prepare_mixture`).

See [[Ontology Principles]].
