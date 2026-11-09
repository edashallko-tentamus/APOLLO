package com.tentamus.lims.methods.domain;

import com.tentamus.lims.core.web.RuleException;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * How a version's steps connect: each step comes after the steps it depends on (a graph: parallel branches allowed, never
 * a loop). Replaces the database trigger workflow_step_dependency_rules, the check that a step never depends on itself
 * and the cascade that removes a removed step's connections and equipment (workflow_step_cascade); step_ancestors stays
 * in the database for the bench.
 */
public final class WorkflowGraph {
    /** One connection: step comes after dependsOn. */
    public record Dependency(String id, String stepId, String dependsOn, String type, boolean active) {
        public static Dependency of(Map<String, Object> row) {
            return new Dependency(Values.str(row.get("id")), Values.str(row.get("step_id")), Values.str(row.get("depends_on_step_id")),
                Values.str(row.get("dependency_type")), "Active".equals(Values.str(row.get("status"))));
        }
    }

    private final Map<String, WorkflowStep> steps = new LinkedHashMap<>();
    private final List<Dependency> deps = new ArrayList<>();

    /** Every step of the version (removed ones too: their connections still count) and every connection. */
    public WorkflowGraph(List<WorkflowStep> allSteps, List<Dependency> allDeps) {
        for (WorkflowStep s : allSteps) steps.put(s.id(), s);
        deps.addAll(allDeps);
    }

    public WorkflowStep step(String id) { return steps.get(id); }

    public List<WorkflowStep> activeSteps() {
        return steps.values().stream().filter(WorkflowStep::active)
            .sorted((a, b) -> a.sortOrder() != b.sortOrder() ? Integer.compare(a.sortOrder(), b.sortOrder()) : a.key().compareTo(b.key())).toList();
    }

    public WorkflowStep activeByKey(String key) {
        for (WorkflowStep s : steps.values()) if (s.active() && s.key().equals(key)) return s;
        return null;
    }

    public List<Dependency> activeDependencies() { return deps.stream().filter(Dependency::active).toList(); }

    /** The steps that come before a step (through every active connection). */
    public Set<String> ancestors(String stepId) {
        Set<String> seen = new LinkedHashSet<>();
        Deque<String> todo = new ArrayDeque<>(List.of(stepId));
        while (!todo.isEmpty()) {
            String s = todo.pop();
            for (Dependency d : deps) if (d.active() && d.stepId().equals(s) && seen.add(d.dependsOn())) todo.push(d.dependsOn());
        }
        return seen;
    }

    /** Whether an active step comes directly after this one. */
    public boolean hasActiveFollower(String stepId) {
        for (Dependency d : deps)
            if (d.active() && d.dependsOn().equals(stepId) && steps.get(d.stepId()) != null && steps.get(d.stepId()).active()) return true;
        return false;
    }

    /** Active steps that come after nothing (a workflow has exactly one). */
    public long firstSteps() {
        return activeSteps().stream().filter(s -> deps.stream().noneMatch(d -> d.active() && d.stepId().equals(s.id()))).count();
    }

    public Dependency active(String stepId, String dependsOn) {
        for (Dependency d : deps) if (d.active() && d.stepId().equals(stepId) && d.dependsOn().equals(dependsOn)) return d;
        return null;
    }

    public List<Dependency> activeOf(String stepId) {
        return deps.stream().filter(d -> d.active() && d.stepId().equals(stepId)).toList();
    }

    /** Checks a new connection (step comes after dependsOn) before it is made. */
    public void assertCanConnect(String stepId, String dependsOn) {
        WorkflowStep a = steps.get(stepId), b = steps.get(dependsOn);
        if (a == null || b == null) throw RuleException.database("A step can only depend on a step of the same test version");
        if (Objects.equals(stepId, dependsOn)) throw RuleException.withCode("A step cannot come after itself.", "23514");
        if (!a.active() || !b.active()) throw RuleException.database("Both steps must be active");
        if (ancestors(dependsOn).contains(stepId))
            throw RuleException.database("That would make a loop: \"" + b.name() + "\" already comes after \"" + a.name() + "\"");
    }

    /** Records a new connection (after the check). */
    public void connect(String id, String stepId, String dependsOn, String type) { deps.add(new Dependency(id, stepId, dependsOn, type, true)); }

    /** Removes a connection. */
    public void disconnect(String depId) {
        deps.replaceAll(d -> d.id() != null && d.id().equals(depId) ? new Dependency(d.id(), d.stepId(), d.dependsOn(), d.type(), false) : d);
    }

    /** A step added to the graph. */
    public void add(WorkflowStep s) { steps.put(s.id(), s); }

    /** Removing a step removes its connections both ways (the ids to set Inactive). */
    public List<String> remove(String stepId) {
        List<String> gone = new ArrayList<>();
        for (Dependency d : deps) if (d.active() && (d.stepId().equals(stepId) || d.dependsOn().equals(stepId))) gone.add(d.id());
        gone.forEach(this::disconnect);
        WorkflowStep s = steps.get(stepId);
        if (s != null) steps.put(stepId, new WorkflowStep(s.id(), s.versionId(), s.key(), s.name(), s.type(), s.sortOrder(), s.departmentId(), s.config(), "Inactive"));
        return gone;
    }
}
