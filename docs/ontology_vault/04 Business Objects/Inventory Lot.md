---
type: Business Object
domain: Inventory and Laboratory Resources
capability: Inventory Status and Availability
object_classification: Execution Object
status: Reviewed
---

# Inventory Lot

## Definition
Specific received or prepared inventory lot — chemical, reagent, media, reference standard, microbiological strain, consumable, or in-house mixture — entered on one common screen with independent quantity, status, dates, and traceability. Chemical Type determines which fields apply and what the lot may be used for; it does not determine what the lot may be mixed with.

## Ownership
- **Core domain:** [[Inventory and Laboratory Resources]]
- **Capability:** [[Inventory Status and Availability]]
- **Object classification:** [[Execution Object]]
- **Value model:** [[Value Ownership]]

## User Values
- Name (the item's own name; the [[Chemical]] list was retired 2026-10-12, see [[Decision - Chemical List Retired, Inventory Items Name Their Analytes]])
- CAS number (check digit validated; filled in from a single analyte when left empty)
- Analytes (one or more [[Analyte]]s with concentration and unit; required for Reference Standard and Microbiological Strain; calculated for in-house mixtures, with optional target ± tolerance %)
- Solid or liquid (defaults from the unit; drives concentration calculations)
- Chemical Type (multi-select: Consumable, In-house mixture, Solvent, Reagent, Media, Reference Standard, Microbiological Strain)
- Manufacturer lot (manual entry; replaced by an auto-generated Resource ID when Chemical Type includes In-house mixture)
- Received quantity (not applicable when Chemical Type is Consumable only)
- Unit (from the controlled [[Unit of Measure]] table; conversions from the Unit conversions table, see [[Decision - Units and Unit Conversions Are Controlled Tables]])
- Purity/Potency (not applicable when Chemical Type is Consumable only; sourced from the attached Supplier COA when one exists, rather than entered independently)
- Concentration
- Expiration date (manual entry; derived as the earliest expiration among source components when Chemical Type includes In-house mixture)
- Retest date
- Storage condition (should match the assigned Storage Location's Supported Condition — see [[Decision - Storage Location and Supplier Defined]])
- Component Lots (only shown when Chemical Type includes In-house mixture — the source Reagent/Media/Reference Standard/Microbiological Strain Inventory Lots used to build this lot)

## Derived Values
- Purchase Status (Approved, Ordered, Received — only populated for lots originating from a Supply Purchase Order Line; blank for In-house mixtures and directly-logged items, which are usable immediately). The record exists from Approved onward as an unfinished item; most physical fields (Manufacturer lot, Expiration date, Purity/Potency) stay blank until Purchase Status reaches Received via the Receive action.
- COA on File (true when a [[Supplier COA]] is attached)
- Resource ID (system-generated, replaces Manufacturer lot for In-house mixtures)
- Quantity On Hand
- Expiration Status
- Use Eligibility (false while Purchase Status is Approved or Ordered — an unfinished item cannot be used by the lab until Received)
- Days Until Expiration
- Negative Inventory Status
- Analyte-Eligible (true only when Chemical Type includes Reference Standard or Microbiological Strain — the only types that may be represented as the reported analyte of a test result)

## System Values
- Record UUID
- Created date
- Created by
- Last modified date
- Last modified by
- Record version
- Audit trail reference

## Relationships
- **belongs to a** [[Department]] (D-1, migration 037: the department whose tests use it; its low stock flags that department's waiting samples)
- **instance of** [[Inventory Item]]
- **created by** [[Inventory Receipt]]
- **created by** [[Preparation Record]] (when Chemical Type includes In-house mixture)
- **received via** [[Received Item]] (the Receive action — transitions Purchase Status from Ordered to Received)
- **has** [[Supplier COA]] (optional)
- **composed of** [[Inventory Lot]] (multiple — component lots, when Chemical Type includes In-house mixture)
- **stored at** [[Storage Location]]
- **has** [[Inventory Status]]
- **has** [[Availability Status]]
- **has** [[Waste Profile]]
- **used by** [[Analysis]]
- **consumed by** [[Inventory Transaction]]
- **consumed by** [[Material Usage Record]]
- **may become** [[Negative Inventory]]
- **fulfills** [[Test Material Requirement]]
- **requests reorder via** [[Supply Purchase Order Line]] (Reorder action, available on expired or negative lots — and any lot — from both the top screen and the item detail screen)
- **belongs to** [[Laboratory Site]] (see [[Decision - Inventory Belongs to a Lab and Transfers Are Re-Logged]])
- **may be transferred from** another [[Inventory Lot]] at a different lab (proposed link for traceability)
- **may be made by** [[Logbook Entry]] (an inoculum)
- **may carry values published by** [[Logbook Entry]]

## As built (0.18.0, logbooks, migrations 034 and 035)
- **A logbook can make the lot.** An inoculum entry (for example the USP <61>/<62> challenge inoculum) creates its lot, named after the organism and the culture it came from ("Challenge inoculum: Staphylococcus aureus (from INV-000028)"), carrying the culture's organisms, with an expiry at the end of the entry's validity.
- **Published values.** A logbook entry about the lot can publish values (CFU per mL, CFU added, a culture's passage). Test formulas read them from the lot scanned at a step, for the analytes the lot names. See [[Logbook Value Approval Rule]].
- **Validity.** A lot whose logbook entry is past its validity window is refused at the bench. When a lot has several usable entries, the approved one is used, otherwise the analyst chooses.
- The lot page lists the logbook entries about it and the values they publish.
- See [[Decision - Electronic Logbooks L-1 and L-2]].

## Governing Rules
- Governed by [[Ontology Principles]]
- See [[Decision - Chemical Inventory Unified Under Inventory Lot]]
- See [[Decision - Purchase Status Lives on Inventory Lot]]
- Governed by [[Supplier Qualification Blocking Rule]]
- Evaluated by [[Threshold Rule]] instances for Quantity On Hand (percentage, Alert at 20% of received quantity, Deficient below zero) and Expiration Status (days-until-expiration, Alert at 2 months, Deficient once expired)
- Governed by [[GMP Record Change Control Rule]] (Permission + Electronic Signature required to create; same Permission + fresh signature + Reason for Change required to modify after creation)

## Related Workflows
- See related capability and relationships
- Built in the LIMS3 Sandbox, slice 3 (migration 005); build choices in [[Decision - Inventory Slice Build Choices]]
- Reworked in slice 3.1 (migration 006): [[Decision - Inventory List and Item Pages Follow Alex's Mock-ups]], [[Decision - Mixture Quantity and Concentration Are Calculated From Components]], [[Decision - Every Inventory Tab Exports and Uploads Excel]]

## AI Questions
- What is the current status of this Inventory Lot?
- What Chemical Type(s) does this lot carry, and is it analyte-eligible?
- What is blocking or affecting this Inventory Lot?
- Which related records explain this Inventory Lot?

## Compliance
- [[Audit Trail]]
- [[Record Version]]
- [[Role]]
- [[Permission]]

## Connected Workflow Maps
- [[In-House Material Preparation Workflow]]
- [[Inventory Receiving and Use Workflow]]
- [[Negative Inventory Reconciliation Workflow]]
- [[Waste Disposal Decision Workflow]]
- Governed or affected by [[Auto-Batching Rule]]
- Governed or affected by [[Expired Inventory Blocking Rule]]
- Governed or affected by [[Negative Inventory Rule]]
- Governed or affected by [[Resource Consumption Negative Flag Rule]]
