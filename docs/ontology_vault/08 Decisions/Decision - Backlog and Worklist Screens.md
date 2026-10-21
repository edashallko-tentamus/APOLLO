---
type: Architecture Decision
status: Approved
---

# Decision - Backlog and Worklist Screens

The batching module's two screens, sitting on the existing [[Test Pool]] → [[Batching Rule]] → [[Test Batch]] → [[Worklist Task]] → [[Analyst Worklist]] pipeline.

**Backlog.** Departments listed left with available-test counts ([[Test Pool]] is departmental). Selecting a department shows its pool, priority-ordered; in-flight tests display their batch and current step. Re-preps always sort to the top of their test's pool with elevated priority.

**Autobatch — per test type, not per selection.** Pulls ALL pooled tests for that [[Test]], in fill order: re-preps first, then Rush, then Standard by due date, up to the Batching Rule's Max Samples Per Batch. QC entries generate per the rule's classes and frequencies. Overflow beyond the max stays pooled for the next batch; a short pool fills light. Save creates the [[Test Batch]] and instantiates the workflow at step 1.

**Assignment.** Multi-select rows → assign-to-analyst dropdown → creates a [[Worklist Task]] on that analyst's [[Analyst Worklist]]. The dropdown flags analysts not qualified for the batch's steps — [[Step Authorization]]'s check, which depends on the deferred Training Competency and Authorization capability; flagged, not yet enforceable.

**Worklist.** Per user: active assignments with priority, batch, current step with progress, and status — Ready, In progress, or Blocked, with Hold Point waits shown alongside what they wait on. Includes non-batch task types per Analyst Worklist's existing relationships ([[Preparation Record]], [[Maintenance Work Order]]).

**Open:** priority derivation — what makes a test Rush (client flag vs due-date computation) — is display-level, not yet modeled on [[Requested Test]].

See [[Ontology Principles]].
