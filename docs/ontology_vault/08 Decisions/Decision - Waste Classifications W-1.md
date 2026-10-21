---
type: Architecture Decision
status: Approved (Alex, 2026-10-20); build choices Proposed
decided: 2026-10-20
built: 2026-10-20 (migration 052, seed 038, version 0.30.0)
---

# Decision - Waste Classifications W-1

First slice of [[Waste Classification and Disposal]]: [[Hazard Classification]] and the [[Waste Profile]] of each [[Inventory Lot]] (as a waste classification), with the [[Waste Stream]] named on it. Containers, accumulation records, pickups and manifests ([[Waste Container]], [[Waste Accumulation Record]], [[Waste Disposal Request]], [[Waste Manifest]]) are not built.

**Alex (2026-10-20):** "Add a waste classification table to admin side and tie it in to the inventory module for each item."

## What was built

- **Admin > Lab setup > Waste classifications:** each classification has a code (WC-001), name, hazard classes (Ignitable, Corrosive, Reactive, Toxic, Oxidizer, Peroxide former, Water-reactive, Heavy metal, Halogenated, Biohazardous, Sharps, Pharmaceutical, Universal waste, Non-hazardous), EPA waste codes, the waste stream, the container, how to dispose of it, what to keep it away from, the item types it is the default for, and Needs review. Paste from Excel and fill down; a reason for changes; audited.
- **Shared and the lab's own:** a starter list of 12 for every lab (system administrators keep it); each lab adds its own (inventory.lists: Lab Supervisor, QA, General Manager). One default per item type per lab; the lab's own default comes before the shared one.
- **Every item has one:** chosen on the item form, else the default for its type (Media and strains: biohazardous; solvents: non-halogenated flammable solvents; consumables: non-hazardous solid waste; reagents, reference standards and mixtures: "classify from the SDS", marked Needs review). A transferred item takes the receiving lab's default. A retired classification cannot be chosen.
- **Inventory:** the lot page's "Waste and disposal" card; the Dispose signature names what the item is disposed of as, and the disposal records the classification; a Waste column and a "Waste to classify" filter on the list.

## Build choices (Proposed)

1. No new permission (inventory.lists, like suppliers, storage locations and warning rules).
2. The starter list uses US federal (RCRA) codes; each lab's EHS contact confirms them and adds state codes.
3. Defaults by item type; reagents, standards and mixtures start on "classify from the SDS" until someone chooses from the SDS.
4. The lot label does not print the classification yet.
5. Items disposed of or cancelled before 052 are left without one.
