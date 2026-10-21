---
type: Capability
domain: Laboratory Operations
status: Reviewed
---

# Electronic Logbooks

## Core domain
[[Laboratory Operations]]

## Purpose
Structured, signed records of checks, readings and preparations (balance and pipette checks, temperatures, cultures, inocula, controls, sample weights), with limits judged at entry, QA review, and values that other records use: test formulas, equipment availability flags, stability excursions.

## Business objects
- [[Calculation Chain]]
- [[Electronic Logbook]]
- [[Linked Record]]
- [[Logbook Entry]]
- [[Logbook Template]]

## Related capabilities
- [[Test Method and Workflow Management]]
- [[Test Planning Assignment and Batching]]
- [[In-House Material Preparation]]
- [[Analytical Execution]]
- [[Result Management]]
- [[Technical Review and Completion]]
- [[Training Competency and Authorization]]

## Standards
- [[Ontology Principles]]
- [[Business Object Standard]]
- [[Value Ownership]]

## As built (0.18.0)
- Testing > Logbooks and QA > Logbook review (migrations 034 and 035). See [[Decision - Electronic Logbooks L-1 and L-2]].
- Decisions: [[Decision - Electronic Logbooks Are Computational]], [[Decision - Logbooks Wait for the Workflow Designer]], [[Decision - Logbook Values Feed Results Through Scanned Materials]], [[Decision - Electronic Logbooks L-1 and L-2]].
- Rules: [[Part 11 Logbook Rule]], [[Logbook Failure Flag Rule]], [[Logbook Value Approval Rule]], [[Logbook Correction Flag Rule]], [[Aliquot Weight Review Rule]], [[Report Release Blocking Rule]].
