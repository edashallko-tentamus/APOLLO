package com.tentamus.lims.methods.domain;

import com.fasterxml.jackson.databind.JsonNode;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * A test version as designed: the test, the version, its active analytes, its steps and how they connect, and each step's
 * equipment types. It reviews itself: {@link #problems()} is Java's own copy of the database's test_version_problems
 * (kept there: approve_test_version for the data loads and the workflow verification call it).
 */
public final class VersionDesign {
    /** An equipment type on a step. */
    public record Equipment(String stepId, String typeId, boolean main) {}

    private static final List<String> LIMIT_REFS = List.of("LOQ", "½ LOQ", "LOD");
    private static final Pattern UUID = Pattern.compile("^[0-9a-f-]{36}$");
    private static final BigDecimal ZERO = BigDecimal.ZERO;

    private final TestDefinition test;
    private final TestVersion version;
    private final List<VersionAnalyte> analytes;
    private final WorkflowGraph graph;
    private final List<Equipment> equipment;
    private final DesignFacts facts;

    public VersionDesign(TestDefinition test, TestVersion version, List<VersionAnalyte> analytes, WorkflowGraph graph, List<Equipment> equipment, DesignFacts facts) {
        this.test = test;
        this.version = version;
        this.analytes = analytes;
        this.graph = graph;
        this.equipment = equipment;
        this.facts = facts;
    }

    public TestDefinition test() { return test; }

    public TestVersion version() { return version; }

    public WorkflowGraph graph() { return graph; }

    public List<QcCriteria.Row> qcCriteria() { return QcCriteria.of(graph.activeSteps(), analytes, facts); }

    /** What each active step offers to formulas, by step id. */
    public Map<String, List<String>> tokenFields() {
        Map<String, List<String>> out = new HashMap<>();
        for (WorkflowStep s : graph.activeSteps()) out.put(s.id(), s.tokenFields(facts.publishedKeys()));
        return out;
    }

    private boolean onTest(String analyteId) { return analyteId != null && analytes.stream().anyMatch(a -> a.analyteId().equals(analyteId)); }

    private static String or(String s) { return s == null ? "" : s; }

    /** Errors stop approval; Warnings are to look at. */
    public List<Problem> problems() {
        List<Problem> p = new ArrayList<>(baseProblems());
        p.addAll(laterProblems());
        return p;
    }

    private List<Problem> baseProblems() {
        List<Problem> p = new ArrayList<>();
        if (test.departmentId() == null) p.add(Problem.error(null, "Choose the department that does this test (tab 1)"));
        String method = version.methodId() == null ? null : facts.methodStatus(version.methodId());
        if (version.methodId() == null) p.add(Problem.error(null, "Choose the method (SOP) this version follows (tab 1)"));
        else if (method != null && !"Active".equals(method)) p.add(Problem.error(null, "The method is Inactive; choose an active one (tab 1)"));
        if (test.departmentId() != null && !facts.departmentHasPeople(test.departmentId()))
            p.add(Problem.warning(null, "Nobody is in a group for the " + or(facts.departmentName(test.departmentId()))
                + " department yet, so nobody could do its steps (Admin > Groups: mark a group as that department)"));
        if (!facts.priced(test.id())) p.add(Problem.warning(null, "Not priced yet: it can be approved, but cannot be quoted or ordered until the catalogue has its price"));
        if (analytes.isEmpty()) p.add(Problem.error(null, "Add at least one analyte (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (("Numeric".equals(a.resultType()) || "Count".equals(a.resultType())) && a.reportingUnit() == null)
                p.add(Problem.error(null, a.analyteName() + ": a " + a.resultType().toLowerCase() + " result needs a reporting unit (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (a.qualitative() && a.resultValues().size() < 2) p.add(Problem.error(null, a.analyteName() + ": a qualitative result needs at least two result values (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (a.qualitative() && !a.resultValues().containsAll(a.foundValues()))
                p.add(Problem.error(null, a.analyteName() + ": the values that mean \"found\" must be among its result values (tab 2)"));
        List<WorkflowStep> steps = graph.activeSteps();
        if (steps.isEmpty()) { p.add(Problem.error(null, "Add the workflow steps (tab 3)")); return p; }
        long first = graph.firstSteps();
        if (first != 1) p.add(Problem.error(null, "The workflow must have exactly one first step; " + first + " steps come after nothing. Connect each step to the one before it."));
        if (steps.stream().noneMatch(s -> s.is("QC Review"))) p.add(Problem.error(null, "The workflow needs a QC Review step (where the results are reviewed and approved)"));
        if (steps.stream().filter(s -> s.is("Batching")).count() > 1) p.add(Problem.error(null, "Only one Batching step is allowed"));
        List<QcCriteria.Row> criteria = qcCriteria();
        for (WorkflowStep s : steps) stepProblems(s, p, criteria);
        return p;
    }

    private void stepProblems(WorkflowStep s, List<Problem> p, List<QcCriteria.Row> criteria) {
        String k = s.key();
        JsonNode c = s.config();
        Set<String> anc = graph.ancestors(s.id());
        if (s.is("Batching") && !anc.isEmpty()) p.add(Problem.error(k, "Batching must be the first step"));
        if (!s.is("QC Review") && !graph.hasActiveFollower(s.id())) p.add(Problem.error(k, "Nothing comes after this step: every branch must end in a QC Review"));
        if (s.departmentId() != null && !s.departmentId().equals(test.departmentId()) && !facts.departmentHasPeople(s.departmentId()))
            p.add(Problem.warning(k, "Nobody is in a group for the " + or(facts.departmentName(s.departmentId())) + " department, so nobody could do this step"));
        List<Equipment> eq = equipment.stream().filter(e -> e.stepId().equals(s.id())).toList();
        if (s.is("Weighing") || s.is("Incubation") || s.is("Data Entry") && !"false".equals(Values.textOr(c, "require_attachment").isEmpty() ? "true" : Values.text(c, "require_attachment"))
            || !eq.isEmpty()) {
            long main = eq.stream().filter(Equipment::main).count();
            if (eq.isEmpty()) p.add(Problem.error(k, "Choose the equipment type for this " + s.type().toLowerCase() + " step"));
            else if (main != 1) p.add(Problem.error(k, "Mark exactly one equipment type as the main instrument (the others are alternatives)"));
        }
        switch (s.type()) {
            case "Batching" -> batching(k, c, p, criteria);
            case "Weighing" -> weighing(k, c, p);
            case "Preparation" -> {
                Set<String> keys = new HashSet<>();
                int n = 0;
                for (JsonNode f : Values.array(c, "fields")) {
                    n++;
                    keys.add(WorkflowStep.fieldKey(Values.text(f, "label")));
                    if (WorkflowStep.fieldKey(Values.text(f, "label")).isEmpty()) p.add(Problem.error(k, "Every field needs a label"));
                    else if (!List.of("Number", "Text", "Time", "Date").contains(Values.textOr(f, "type")))
                        p.add(Problem.error(k, "Field \"" + or(Values.text(f, "label")) + "\": choose Number, Text, Time or Date"));
                }
                if (keys.size() != n) p.add(Problem.error(k, "Two fields have the same label"));
            }
            case "Plating/Inoculation" -> { if (!Values.numOk(c, "plates_per_entry", 1)) p.add(Problem.error(k, "Enter the plates per entry (1 or more)")); }
            case "Incubation" -> {
                if (!Values.numOk(c, "temp_c")) p.add(Problem.error(k, "Enter the target temperature (°C)"));
                if (!Values.numOk(c, "temp_tolerance", ZERO, false)) p.add(Problem.error(k, "The temperature tolerance must be a number"));
                if (!Values.numOk(c, "duration", 0) || !List.of("hours", "days").contains(Values.textOr(c, "duration_unit")))
                    p.add(Problem.error(k, "Enter the target duration in hours or days"));
                else if (!Values.numOk(c, "window_min", 0) || !Values.numOk(c, "window_max", 0)
                    || Values.number(c, "window_min").compareTo(Values.number(c, "duration")) > 0 || Values.number(c, "window_max").compareTo(Values.number(c, "duration")) < 0)
                    p.add(Problem.error(k, "Enter the acceptable window (shortest and longest), around the target duration"));
            }
            case "Dilution" -> dilution(k, c, p);
            case "Split off Test", "Hold Point" -> splitOrHold(s, c, anc, p);
            case "Calculation" -> calculation(k, c, anc, p);
            case "Data Entry" -> {
                if (Values.trimmed(Values.text(c, "value_label")) == null) p.add(Problem.error(k, "Name the value that is entered (e.g. Concentration in solution)"));
                for (JsonNode o : Values.array(c, "analyte_ids"))
                    if (!onTest(o.asText())) p.add(Problem.error(k, "This step lists an analyte that is not on the test"));
            }
            default -> { }
        }
    }

    private static boolean badRange(JsonNode o, String lo, String hi, BigDecimal min) {
        return !Values.numOk(o, lo, min, true) || !Values.numOk(o, hi, min, true) || Values.number(o, lo).compareTo(Values.number(o, hi)) > 0;
    }

    private void batching(String k, JsonNode c, List<Problem> p, List<QcCriteria.Row> criteria) {
        if (!Values.numOk(c, "max_samples", 1)) p.add(Problem.error(k, "Enter the maximum number of samples per batch (1 or more)"));
        for (JsonNode q : Values.array(c, "qc")) {
            String qt = or(Values.text(q, "qc_type"));
            if (!facts.qcType(Values.text(q, "qc_type"))) { p.add(Problem.error(k, "\"" + qt + "\" is not a QC type")); continue; }
            if (!List.of("Prep", "Analytical").contains(Values.textOr(q, "qc_class"))) p.add(Problem.error(k, qt + ": choose Prep or Analytical QC"));
            String freq = Values.textOr(q, "frequency");
            if (freq.equals("Every N")) { if (!Values.numOk(q, "every_n", 1)) p.add(Problem.error(k, qt + ": every how many samples?")); }
            else if (freq.equals("Once")) { if (!Values.numOk(q, "count", BigDecimal.ONE, false)) p.add(Problem.error(k, qt + ": how many per batch?")); }
            else if (!freq.equals("Daily")) p.add(Problem.error(k, qt + ": choose how often (once per batch, every N samples, or daily)"));
            String material = Values.textOr(q, "material");
            if (material.equals("Strains") && analytes.stream().noneMatch(a -> "Microbiological".equals(a.analyteClass())))
                p.add(Problem.error(k, qt + " is made from strains of the test's organisms, but the test has no microbiological analytes"));
            else if (!material.isEmpty() && !material.equals("Strains")) p.add(Problem.error(k, qt + ": \"" + material + "\" is not a material requirement"));
            for (JsonNode o : Values.array(q, "criteria")) {
                String lt = or(Values.text(o, "limit_type")), shape = facts.limitShape(Values.text(o, "limit_type"));
                if (shape == null) { p.add(Problem.error(k, qt + ": \"" + lt + "\" is not a limit type")); continue; }
                if (shape.equals("Range") && badRange(o, "min", "max", null)) p.add(Problem.error(k, qt + " " + lt + ": enter a minimum and a maximum (min not above max)"));
                else if (shape.equals("Max") && !Values.numOk(o, "max") && !LIMIT_REFS.contains(Values.textOr(o, "limit_ref")))
                    p.add(Problem.error(k, qt + " " + lt + ": enter a maximum, or LOQ, ½ LOQ or LOD"));
                for (JsonNode f : Values.array(o, "analytes")) {
                    String nm = facts.analyteName(Values.text(f, "analyte_id"));
                    if (!onTest(Values.text(f, "analyte_id")))
                        p.add(Problem.warning(k, qt + " " + lt + ": " + (nm == null ? "an analyte" : nm) + " is no longer on the test, so its limit is ignored (open the Batching step and save to tidy it)"));
                    else if ("false".equals(Values.textOr(f, "applies").isEmpty() ? "true" : Values.text(f, "applies"))) { /* not judged */ }
                    else if (shape.equals("Range") && badRange(f, "min", "max", null)) p.add(Problem.error(k, qt + " " + lt + " for " + or(nm) + ": enter a minimum and a maximum (min not above max)"));
                    else if (shape.equals("Max") && !Values.numOk(f, "max") && !LIMIT_REFS.contains(Values.textOr(f, "limit_ref")))
                        p.add(Problem.error(k, qt + " " + lt + " for " + or(nm) + ": enter a maximum, or LOQ, ½ LOQ or LOD"));
                }
                if (!Values.array(o, "analytes").isEmpty()
                    && criteria.stream().noneMatch(x -> Objects.equals(x.qcType(), Values.text(q, "qc_type")) && Objects.equals(x.limitType(), Values.text(o, "limit_type")) && x.applies()))
                    p.add(Problem.error(k, qt + " " + lt + " applies to no analyte: tick at least one, or remove the criterion"));
                for (JsonNode f : Values.array(o, "overrides")) {
                    if (!onTest(Values.text(f, "analyte_id"))) p.add(Problem.error(k, qt + " " + lt + ": an analyte exception names an analyte that is not on this test"));
                    else if (shape.equals("Range") && badRange(f, "min", "max", null))
                        p.add(Problem.error(k, qt + " " + lt + " exception for " + or(facts.analyteName(Values.text(f, "analyte_id"))) + ": enter a minimum and a maximum"));
                }
            }
        }
    }

    private void weighing(String k, JsonNode c, List<Problem> p) {
        String raw = Values.text(c, "target_mode");
        String mode = raw != null ? raw : c != null && c.has("target") ? "Single" : "None";
        if (mode.equals("Single")) {
            if (!Values.numOk(c, "target", 0) || !Values.numOk(c, "tolerance", ZERO, false)) p.add(Problem.error(k, "Enter the target weight (and tolerance)"));
            String tu = Values.text(c, "tolerance_unit"), unit = Values.text(c, "unit") == null ? "g" : Values.text(c, "unit");
            if (tu != null && !tu.equals("%") && !tu.equals(unit)) p.add(Problem.error(k, "The tolerance is in % or in " + unit + " (the weighing unit)"));
            else if ("%".equals(tu) && Values.numOk(c, "tolerance", 0) && Values.number(c, "tolerance").compareTo(BigDecimal.valueOf(100)) > 0)
                p.add(Problem.error(k, "A tolerance in % cannot be more than 100"));
        } else if ("By product category".equals(raw)) {
            List<JsonNode> cats = Values.array(c, "by_category");
            if (cats.isEmpty()) p.add(Problem.error(k, "Enter a weight range for at least one product category"));
            Set<String> notWeighed = new HashSet<>();
            for (JsonNode o : cats) if ("true".equals(Values.textOr(o, "not_weighed"))) notWeighed.add(facts.categoryName(Values.text(o, "category_id")));
            for (JsonNode o : cats) {
                String id = Values.text(o, "category_id");
                if (!facts.categoryActive(id)) p.add(Problem.error(k, "A weight range names a product category that is not on the list"));
                else if (badRange(o, "min", "max", ZERO) && !notWeighed.contains(facts.categoryName(id)))   // a category not weighed needs no range (039)
                    p.add(Problem.error(k, or(facts.categoryName(id)) + ": enter the lowest and highest weight"));
            }
            if (duplicates(cats)) p.add(Problem.error(k, "A product category appears twice"));
        } else if (!"None".equals(raw)) p.add(Problem.error(k, "Choose no target, one target, or a range per product category"));
    }

    private static boolean duplicates(List<JsonNode> cats) {
        Set<String> seen = new HashSet<>();
        for (JsonNode o : cats) if (!seen.add(String.valueOf(Values.text(o, "category_id")))) return true;
        return false;
    }

    private static boolean badAmount(JsonNode o, String amount, String diluent) {
        return !Values.numOk(o, amount, 0) || Values.number(o, amount).signum() == 0 || !Values.numOk(o, diluent, 0);
    }

    private void dilution(String k, JsonNode c, List<Problem> p) {
        List<JsonNode> cats = Values.array(c, "by_category");
        for (JsonNode o : cats) {
            String id = Values.text(o, "category_id");
            if (!facts.categoryActive(id)) p.add(Problem.error(k, "An amount names a product category that is not on the list"));
            else if (badAmount(o, "aliquot", "diluent")) p.add(Problem.error(k, or(facts.categoryName(id)) + ": enter the amounts added"));
        }
        String mode = Values.textOr(c, "mode");
        if (mode.equals("Single")) {
            if (cats.isEmpty() && badAmount(c, "aliquot", "diluent")) p.add(Problem.error(k, "Enter the default aliquot and diluent amounts (what is added, not a factor)"));
        } else if (mode.equals("Serial")) {
            if (badAmount(c, "initial_amount", "initial_diluent") || badAmount(c, "transfer_aliquot", "transfer_diluent") || !Values.numOk(c, "depth", 1))
                p.add(Problem.error(k, "Enter the initial amounts, the transfer amounts and the standard depth"));
        } else p.add(Problem.error(k, "Choose Single or Serial dilution"));
        if (!Values.numOk(c, "fields_per_entry", BigDecimal.ONE, false)) p.add(Problem.error(k, "Dilution fields per entry must be 1 or more"));
    }

    private void splitOrHold(WorkflowStep s, JsonNode c, Set<String> anc, List<Problem> p) {
        String k = s.key(), tid = Values.text(c, "test_id");
        TestDefinition tgt = tid != null && UUID.matcher(tid).matches() ? facts.test(tid) : null;
        if (tgt == null) p.add(Problem.error(k, s.is("Hold Point") ? "Choose the test this step waits for" : "Choose the test to split off"));
        else if (tgt.id().equals(test.id())) p.add(Problem.error(k, "A test cannot split off or wait for itself"));
        else if (!tgt.active()) p.add(Problem.error(k, tgt.name() + " is retired"));
        else if (tgt.siteId() != null && !tgt.siteId().equals(test.siteId())) p.add(Problem.error(k, tgt.name() + " belongs to another lab; copy it to this lab first"));
        if (!s.is("Split off Test")) return;
        String trigger = Values.textOr(c, "trigger");
        if (!trigger.equals("On finding") && !trigger.equals("Manual only")) p.add(Problem.error(k, "Choose when it is split off (on a finding, or by the analyst only)"));
        if (!trigger.equals("On finding")) return;
        JsonNode fs = c.get("finding_steps");
        if (fs == null || !fs.isArray() || fs.isEmpty()) p.add(Problem.error(k, "Choose the Data Entry step(s), before this one, whose finding splits off the test"));
        else for (JsonNode o : fs) {
            WorkflowStep ref = graph.activeByKey(o.isValueNode() ? o.asText() : o.toString());
            if (ref == null || !anc.contains(ref.id()) || !ref.is("Data Entry"))
                p.add(Problem.error(k, "\"" + (o.isValueNode() ? o.asText() : o.toString()) + "\" is not a Data Entry step that comes before this one"));
        }
        String finding = Values.textOr(c, "finding");
        if (!finding.equals("Present") && !finding.equals("Count above") || finding.equals("Count above") && !Values.numOk(c, "count_above", 0))
            p.add(Problem.error(k, "Choose the finding: something found (a value that means found), or a count above a number"));
    }

    private void calculation(String k, JsonNode c, Set<String> anc, List<Problem> p) {
        String main = Formula.of(Values.text(c, "formula")).problem();
        if (main != null) p.add(Problem.error(k, "Formula: " + main));
        List<String> extra = new ArrayList<>();
        for (JsonNode o : Values.array(c, "overrides")) {
            if (Values.text(o, "formula") != null) extra.add(Values.text(o, "formula"));
            String prob = Formula.of(Values.text(o, "formula")).problem();
            if (!onTest(Values.text(o, "analyte_id"))) p.add(Problem.error(k, "A formula exception names an analyte that is not on this test"));
            else if (prob != null) p.add(Problem.error(k, "Formula for " + or(facts.analyteName(Values.text(o, "analyte_id"))) + ": " + prob));
        }
        String all = Values.textOr(c, "formula") + " " + String.join(" ", extra);
        for (String tok : Formula.of(all).tokens()) {
            String stepKey = tok.substring(0, tok.indexOf('.')), field = tok.substring(tok.indexOf('.') + 1);
            WorkflowStep ref = graph.activeByKey(stepKey);
            if (ref == null) p.add(Problem.error(k, "{" + tok + "}: there is no step \"" + stepKey + "\""));
            else if (!anc.contains(ref.id())) p.add(Problem.error(k, "{" + tok + "}: \"" + ref.name() + "\" does not come before this step, so its value would not exist yet"));
            else {
                List<String> offers = ref.tokenFields(facts.publishedKeys());
                if (!offers.contains(field)) {
                    String list = String.join(", ", offers.stream().map(x -> "{" + ref.key() + "." + x + "}").toList());
                    p.add(Problem.error(k, "{" + tok + "}: \"" + ref.name() + "\" offers " + (list.isEmpty() ? "no values to formulas" : list)));
                }
            }
        }
    }

    /** The checks added with readings that are not results, windows per product category and client alerts (migration 039). */
    private List<Problem> laterProblems() {
        List<Problem> p = new ArrayList<>();
        for (VersionAnalyte a : analytes)
            if (!a.qualitative() && !a.invalidValues().isEmpty()) p.add(Problem.error(null, a.analyteName() + ": only a qualitative result has readings that are not results (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (a.qualitative() && !a.resultValues().containsAll(a.invalidValues()))
                p.add(Problem.error(null, a.analyteName() + ": the values that are not results must be among its result values (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (a.invalidValues().stream().anyMatch(a.foundValues()::contains))
                p.add(Problem.error(null, a.analyteName() + ": a value cannot both mean \"found\" and be \"not a result\" (tab 2)"));
        for (VersionAnalyte a : analytes)
            if (a.qualitative() && !a.invalidValues().isEmpty() && a.invalidValues().containsAll(a.resultValues()))
                p.add(Problem.error(null, a.analyteName() + ": at least one result value must be a result (not every value can be \"not a result\")"));
        for (WorkflowStep s : graph.activeSteps()) {
            JsonNode c = s.config();
            if (s.is("Incubation") && c != null && c.get("by_category") != null && c.get("by_category").isArray()) {
                List<JsonNode> cats = Values.array(c, "by_category");
                for (JsonNode o : cats) {
                    String id = Values.text(o, "category_id");
                    if (!facts.categoryActive(id)) p.add(Problem.error(s.key(), "A window names a product category that is not on the list"));
                    else if (badRange(o, "window_min", "window_max", ZERO))
                        p.add(Problem.error(s.key(), or(facts.categoryName(id)) + ": enter the shortest and longest acceptable time"));
                }
                if (duplicates(cats)) p.add(Problem.error(s.key(), "A product category appears twice in the windows"));
            }
            if (s.is("Weighing") && "By product category".equals(Values.text(c, "target_mode"))
                && Values.array(c, "by_category").stream().allMatch(o -> "true".equals(Values.textOr(o, "not_weighed"))))
                p.add(Problem.warning(s.key(), "Every product category listed is \"Not weighed\": samples of other categories are weighed with no range"));
            if (s.is("Split off Test") && "true".equals(Values.textOr(c, "notify_client"))
                && !"On finding".equals(Values.text(c, "trigger") == null ? "On finding" : Values.text(c, "trigger")))
                p.add(Problem.warning(s.key(), "The client is alerted only on a finding: set \"When\" to On finding, or the alert is never sent"));
        }
        return p;
    }

    /** The parts a copy of this version makes: analytes, then steps in order (each with its equipment types), then connections. */
    public record Copy(List<Map<String, Object>> analytes, List<StepCopy> steps, List<String[]> connections) {}

    /** A step to copy, with the equipment types (already mapped to the other lab) to put on it. */
    public record StepCopy(WorkflowStep step, String department, List<Equipment> equipment) {}

    /** How another lab's departments and equipment types match this lab's (by code, by name); null when none does. */
    public interface LabMap {
        String department(String departmentId);

        String equipmentType(String typeId);
    }

    /**
     * What copying this version's content makes: within a lab everything carries over; in another lab departments map by
     * code and equipment types by name (types with no match are left off). analyteRows are the stored rows of the analytes.
     */
    public Copy copyTo(String toVersion, boolean sameLab, LabMap map, List<Map<String, Object>> analyteRows) {
        List<Map<String, Object>> a = analyteRows.stream().map(r -> VersionAnalyte.copyRow(r, toVersion)).toList();
        List<StepCopy> steps = new ArrayList<>();
        Set<String> copied = new LinkedHashSet<>();
        List<WorkflowStep> ordered = new ArrayList<>(graph.activeSteps());
        ordered.sort((x, y) -> Integer.compare(x.sortOrder(), y.sortOrder()));
        for (WorkflowStep s : ordered) {
            List<Equipment> eq = new ArrayList<>();
            for (Equipment e : equipment) {
                if (!e.stepId().equals(s.id())) continue;
                String type = sameLab ? e.typeId() : map.equipmentType(e.typeId());
                if (type != null) eq.add(new Equipment(s.id(), type, e.main()));
            }
            steps.add(new StepCopy(s, sameLab || s.departmentId() == null ? s.departmentId() : map.department(s.departmentId()), eq));
            copied.add(s.id());
        }
        List<String[]> links = new ArrayList<>();
        for (WorkflowGraph.Dependency d : graph.activeDependencies())
            if (copied.contains(d.stepId()) && copied.contains(d.dependsOn())) links.add(new String[] {d.stepId(), d.dependsOn(), d.type()});
        return new Copy(a, steps, links);
    }
}
