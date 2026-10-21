---
type: Architecture Decision
status: Approved
---

# Decision - Threshold Rule Extended With Units and Target Tolerance, Kept Separate From Specification

[[Threshold Rule]] gains a Units field and a fourth Threshold Type — Target ± Tolerance % — a nominal Target Value with a symmetric percentage band, in Units. This is in addition to the previously defined Percentage of Base, Absolute Max-Min, and Days Until/Since types.

This mode is what control charting needs — trending an [[Analyte Result]] or quality control value against a target with a warning zone before it is actually out of range. No Control Charting capability or object exists in this vault yet, despite being one of the three original goals stated at the start of this project; this decision lays the groundwork for it but does not build it. [[Threshold Rule]] now evaluates against Analyte Result for this purpose and may optionally be referenced by [[Specification]] for its warning-zone math.

Deliberately not merged: [[Specification Evaluation]] remains the sole authoritative pass/fail (in-spec / out-of-spec) determination for a reportable result. Threshold Rule informs trending and monitoring; it does not gate what can be reported on a Certificate of Analysis. Coupling regulated pass/fail logic to the same configurable engine used for inventory reorder alerts was judged too risky to the integrity of reported results.

See [[Ontology Principles]].
