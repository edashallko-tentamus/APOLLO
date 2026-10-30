package com.tentamus.lims.equipment.domain;

import static org.junit.jupiter.api.Assertions.*;

import com.tentamus.lims.core.web.RuleException;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** The equipment rules moved out of the database in migration 064 (they were checked by test_009). */
class EquipmentRulesTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 29);
    private static final String CFL = "cfl", TPS = "tps";
    private static final Equipment BALANCE = new Equipment("bal", "EQ-00001", "Balance T1", CFL, "In Service", true, 6, 30);
    private static final Equipment HPLC = new Equipment("hplc", "EQ-00002", "HPLC T1", CFL, "In Service", true, 12, 30);
    private static final Equipment SPECTRO = new Equipment("uv", "EQ-00004", "Spectro T1", CFL, "In Service", false, null, 30);
    private static final Equipment RETIRED = new Equipment("old", "EQ-00009", "Old pH meter", CFL, "Retired", false, null, 30);
    private static final Equipment.LabEntry CFL_TYPE = new Equipment.LabEntry("t1", "HPLC", CFL, "Active");
    private static final Equipment.LabEntry TPS_TYPE = new Equipment.LabEntry("t2", "HPLC", TPS, "Active");
    private static final Equipment.LabEntry CHEM = new Equipment.LabEntry("d1", "Chemistry", CFL, "Active");
    private static final Equipment.LabEntry QC = new Equipment.LabEntry("d2", "Quality control lab", TPS, "Active");

    private static String refusal(Runnable r) {
        try { r.run(); } catch (RuleException e) { return e.getMessage(); }
        return null;
    }

    private static Map<String, Object> m(Object... kv) {
        Map<String, Object> out = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) out.put((String) kv[i], kv[i + 1]);
        return out;
    }

    private static EquipmentTag tag(String reason, int records, int cals, int quals, String... workers) {
        return new EquipmentTag("tg", "TAG-000001", "hplc", reason, null, false, new EquipmentTag.Work(records, cals, quals, Set.of(workers)));
    }

    @Test
    void listsKeepCodesInCapitalsAndNeedNames() {
        assertEquals("CHEM", LabListEntry.department(null, m("department_code", " chem ", "department_name", "Chemistry")).get("department_code"));
        assertEquals("Give the department a code.", refusal(() -> LabListEntry.department(null, m("department_code", " ", "department_name", "x"))));
        assertEquals("Give the department a name.", refusal(() -> LabListEntry.department(m("department_code", "C", "department_name", "Chem"), m("department_name", ""))));
        assertEquals("Balance", LabListEntry.type(null, m("type_name", " Balance ")).get("type_name"));
        assertEquals("Give the equipment type a name.", refusal(() -> LabListEntry.type(null, m("type_name", null))));
    }

    @Test
    void theRegister() {
        Map<String, Object> ok = m("site_id", CFL, "equipment_name", " Balance T1 ", "equipment_type_id", "t1", "department_id", "d1", "serial_number", " ", "manufacturer", " Mettler ");
        Map<String, Object> out = Equipment.checked(null, ok, ok, CFL_TYPE, CHEM, null);
        assertEquals("Balance T1", out.get("equipment_name"));
        assertNull(out.get("serial_number"));
        assertEquals("Mettler", out.get("manufacturer"));
        Map<String, Object> other = m("site_id", CFL, "equipment_name", "X", "equipment_type_id", "t2", "department_id", "d1");
        assertEquals("That equipment type belongs to another lab; pick one from this lab's Equipment types list", refusal(() -> Equipment.checked(null, other, other, TPS_TYPE, CHEM, null)));
        Map<String, Object> inactive = m("site_id", CFL, "equipment_name", "X", "equipment_type_id", "t1", "department_id", "d1");
        assertEquals("That department is Inactive; pick one from this lab's Departments list",
            refusal(() -> Equipment.checked(null, inactive, inactive, CFL_TYPE, new Equipment.LabEntry("d1", "Chemistry", CFL, "Inactive"), null)));
        Map<String, Object> noDept = m("site_id", CFL, "equipment_name", "No dept", "equipment_type_id", "t1");
        assertEquals("Pick the department No dept belongs to (from this lab's Departments list)", refusal(() -> Equipment.checked(null, noDept, noDept, CFL_TYPE, null, null)));
        assertEquals("That location belongs to another lab", refusal(() -> Equipment.checked(null, ok, ok, CFL_TYPE, CHEM, TPS)));
        Map<String, Object> badInterval = m("site_id", CFL, "equipment_name", "X", "equipment_type_id", "t1", "department_id", "d1", "calibration_interval_months", 0);
        assertEquals("The calibration interval must be at least 1 month.", refusal(() -> Equipment.checked(null, badInterval, badInterval, CFL_TYPE, CHEM, null)));
        // an edit that leaves the type alone does not re-check it; retired equipment needs no department
        Map<String, Object> stored = m("id", "bal", "site_id", CFL, "equipment_name", "Balance", "equipment_type_id", "t2", "department_id", null, "admin_status", "Retired");
        assertNull(refusal(() -> Equipment.checked(Equipment.of(stored), Fields.after(stored, m("notes", "x")), m("notes", "x"), TPS_TYPE, null, null)));
    }

    @Test
    void ownersBelongToTheLabAndThereIsAtLeastOne() {
        Equipment.LabEntry cflSup = new Equipment.LabEntry("g1", "Lab Supervisor", CFL, "Active");
        assertNull(refusal(() -> new Owners(BALANCE, List.of(cflSup), List.of()).check()));
        assertEquals("Owner group \"Lab Supervisor\" is not a group of this equipment's lab",
            refusal(() -> new Owners(BALANCE, List.of(new Equipment.LabEntry("g2", "Lab Supervisor", TPS, "Active")), List.of()).check()));
        assertEquals("Group \"Old\" is Inactive", refusal(() -> new Owners(BALANCE, List.of(new Equipment.LabEntry("g3", "Old", CFL, "Inactive")), List.of()).check()));
        assertEquals("Eq TPS Supervisor is not in a group at this lab, so cannot own its equipment",
            refusal(() -> new Owners(BALANCE, List.of(), List.of(new Owners.Person("u", "Eq TPS Supervisor", true, false))).check()));
        assertEquals("EQ-00001 Balance T1 needs at least one responsible group or person (owners get its calibration and maintenance warnings)",
            refusal(() -> new Owners(BALANCE, List.of(), List.of()).check()));
        assertNull(refusal(() -> new Owners(RETIRED, List.of(), List.of()).check()));
    }

    @Test
    void calibrationStatusIsDerived() {
        assertEquals(CalibrationStatus.DEFICIENT, BALANCE.calibrationStatus(null, TODAY));
        assertEquals(CalibrationStatus.NOT_REQUIRED, SPECTRO.calibrationStatus(null, TODAY));
        assertEquals(CalibrationStatus.CONFORMS, BALANCE.calibrationStatus(new Calibration("c", "CAL-1", "Pass", TODAY.minusDays(10), TODAY.plusDays(170)), TODAY));
        assertEquals(CalibrationStatus.ALERT, BALANCE.calibrationStatus(new Calibration("c", "CAL-1", "Pass", TODAY.minusDays(10), TODAY.plusDays(20)), TODAY));
        assertEquals(CalibrationStatus.DEFICIENT, HPLC.calibrationStatus(new Calibration("c", "CAL-2", "Pass", TODAY.minusDays(400), TODAY.minusDays(35)), TODAY));
        assertEquals(CalibrationStatus.DEFICIENT, HPLC.calibrationStatus(new Calibration("c", "CAL-3", "Fail", TODAY, TODAY.plusDays(300)), TODAY));
    }

    @Test
    void recordingACalibration() {
        Map<String, Object> out = WorkRecord.checkedNew(WorkRecord.Kind.CALIBRATION, BALANCE, m("performed_date", TODAY.minusDays(10).toString()), null, null, TODAY, "ana");
        assertEquals(TODAY.minusDays(10).plusMonths(6).minusDays(1).toString(), out.get("expiration_date"));   // from the 6-month interval
        assertEquals("ana", out.get("performed_by_user_id"));                                                // the person recording it
        assertEquals("The date it was done cannot be in the future",
            refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.CALIBRATION, BALANCE, m("performed_date", TODAY.plusDays(1).toString()), null, null, TODAY, "ana")));
        assertEquals("The expiry date cannot be before the calibration date.", refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.CALIBRATION, BALANCE,
            m("performed_date", TODAY.minusDays(5).toString(), "expiration_date", TODAY.minusDays(6).toString()), null, null, TODAY, "ana")));
        assertEquals("Give the calibration expiry date (this equipment has no calibration interval set)",
            refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.CALIBRATION, SPECTRO, m("performed_date", TODAY.toString()), null, null, TODAY, "ana")));
        assertEquals("Agilent service", WorkRecord.checkedNew(WorkRecord.Kind.CALIBRATION, HPLC,
            m("performed_date", TODAY.toString(), "performed_by_vendor", "Agilent service"), null, null, TODAY, "qa2").get("performed_by_vendor"));
        assertEquals("EQ-00009 is retired", refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.QUALIFICATION, RETIRED, m("performed_date", TODAY.toString()), null, null, TODAY, "ana")));
    }

    @Test
    void workUnderATagAndOnASchedule() {
        EquipmentTag closed = new EquipmentTag("tg", "TAG-000007", "hplc", "Repair", null, true, new EquipmentTag.Work(1, 0, 0, Set.of()));
        assertEquals("Tag TAG-000007 is already closed",
            refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.EVENT, HPLC, m("performed_date", TODAY.toString(), "summary", "x"), closed, null, TODAY, "ana")));
        assertEquals("That tag belongs to other equipment",
            refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.EVENT, BALANCE, m("performed_date", TODAY.toString(), "summary", "x"), tag("Repair", 0, 0, 0), null, TODAY, "ana")));
        assertEquals("That maintenance schedule belongs to other equipment",
            refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.EVENT, HPLC, m("performed_date", TODAY.toString(), "summary", "x", "schedule_id", "s"), null, "bal", TODAY, "ana")));
        assertEquals("Describe the work done.", refusal(() -> WorkRecord.checkedNew(WorkRecord.Kind.EVENT, HPLC, m("performed_date", TODAY.toString(), "summary", " "), null, null, TODAY, "ana")));
    }

    @Test
    void correctingACalibrationIsQasAndNeverThePerformers() {
        Map<String, Object> c1 = m("performed_by_user_id", "ana", "created_by", "ana", "performed_date", TODAY.minusDays(10).toString(),
            "expiration_date", TODAY.plusDays(170).toString(), "result", "Pass", "status", "Active");
        assertEquals("Changing a calibration record's expiry, date, result or status needs the release permission (equipment.release), usually QA",
            refusal(() -> WorkRecord.checkCorrection(WorkRecord.Kind.CALIBRATION, c1, m("expiration_date", TODAY.plusDays(200).toString()), TODAY, "ana", false)));
        assertNull(refusal(() -> WorkRecord.checkCorrection(WorkRecord.Kind.CALIBRATION, c1, m("notes", "Certificate filed in binder 3"), TODAY, "ana", false)));
        assertNull(refusal(() -> WorkRecord.checkCorrection(WorkRecord.Kind.CALIBRATION, c1, m("expiration_date", TODAY.plusDays(20).toString()), TODAY, "qa", true)));
        Map<String, Object> h1 = m("performed_by_user_id", null, "created_by", "qa2", "performed_date", TODAY.minusDays(400).toString(),
            "expiration_date", TODAY.minusDays(35).toString(), "result", "Pass", "status", "Active");
        assertEquals("You did or recorded this calibration, so someone else must change it",
            refusal(() -> WorkRecord.checkCorrection(WorkRecord.Kind.CALIBRATION, h1, m("expiration_date", TODAY.plusDays(300).toString()), TODAY, "qa2", true)));
        assertNull(refusal(() -> WorkRecord.checkCorrection(WorkRecord.Kind.CALIBRATION, h1, m("expiration_date", TODAY.minusDays(35).toString()), TODAY, "qa2", false)));
    }

    @Test
    void automaticTagOuts() {
        Calibration expired = new Calibration("c", "CAL-000002", "Pass", TODAY.minusDays(400), TODAY.minusDays(35));
        AutoTag t = AutoTag.forCalibration(HPLC, expired, TODAY, false);
        assertEquals("Calibration due", t.source());
        assertEquals("Calibration CAL-000002 expired " + TODAY.minusDays(35), t.description());
        assertEquals("No calibration on record", AutoTag.forCalibration(BALANCE, null, TODAY, false).description());
        assertNull(AutoTag.forCalibration(HPLC, expired, TODAY, true));                                     // not twice
        assertNull(AutoTag.forCalibration(BALANCE, new Calibration("c", "C", "Pass", TODAY, TODAY.plusDays(100)), TODAY, false));
        assertNull(AutoTag.forCalibration(SPECTRO, null, TODAY, false));
        MaintenanceSchedule due = new MaintenanceSchedule("s", "uv", "Wavelength check", 3, "months", TODAY, true, "Active");
        AutoTag m = AutoTag.forSchedule(SPECTRO, due, TODAY, false);
        assertEquals("Maintenance due", m.source());
        assertEquals("Wavelength check due " + TODAY, m.description());
        assertNull(AutoTag.forSchedule(SPECTRO, due, TODAY, true));
        assertNull(AutoTag.forSchedule(SPECTRO, new MaintenanceSchedule("s", "uv", "x", 1, "weeks", TODAY.plusDays(1), true, "Active"), TODAY, false));
        assertNull(AutoTag.forSchedule(RETIRED, due, TODAY, false));
    }

    @Test
    void manualTagOuts() {
        assertEquals("EQ-00009 is retired", refusal(() -> EquipmentTag.checkTagOut(RETIRED, "Repair", null, null, false)));
        assertEquals("EQ-00001 is already tagged out for repair", refusal(() -> EquipmentTag.checkTagOut(BALANCE, "Repair", null, null, true)));
        assertEquals("That maintenance schedule belongs to other equipment", refusal(() -> EquipmentTag.checkTagOut(BALANCE, "Maintenance", "s", "uv", false)));
        assertNull(refusal(() -> EquipmentTag.checkTagOut(BALANCE, "Repair", null, null, false)));
    }

    @Test
    void tagInNeedsTheWorkAndAReleaseBySomeoneElse() {
        CalibrationStatus ok = CalibrationStatus.CONFORMS;
        assertEquals("Record the work done (what was done, by whom, when) before tagging EQ-00002 back in",
            refusal(() -> tag("Calibration", 0, 0, 0, "system").tagIn(HPLC, CalibrationStatus.DEFICIENT, "qa2", true)));
        assertEquals("EQ-00002 has no passing, in-date calibration: record the calibration first",
            refusal(() -> tag("Calibration", 1, 0, 0).tagIn(HPLC, CalibrationStatus.DEFICIENT, "qa2", true)));
        assertEquals("Record the passing calibration done under this tag before releasing EQ-00002",
            refusal(() -> tag("Calibration", 1, 0, 0).tagIn(HPLC, ok, "qa2", true)));
        assertEquals("Record the passing qualification (IQ/OQ/PQ) done under this tag before releasing EQ-00002",
            refusal(() -> tag("Qualification", 1, 0, 0).tagIn(HPLC, ok, "qa2", true)));
        assertEquals("Releasing equipment after calibration needs the release permission (equipment.release), usually QA",
            refusal(() -> tag("Calibration", 1, 1, 0, "ana").tagIn(HPLC, ok, "ana", false)));
        assertEquals("You tagged EQ-00002 out or did or recorded the work, so someone else must release it to service",
            refusal(() -> tag("Repair", 1, 0, 0, "qa2").tagIn(HPLC, ok, "qa2", true)));
        assertEquals("Released by", tag("Calibration", 1, 1, 0, "system", "ana").tagIn(HPLC, ok, "qa2", true));
        assertEquals("Released by", tag("Repair", 1, 0, 0, "qa2").tagIn(HPLC, ok, "qa", true));
        assertEquals("Returned to service by", tag("Maintenance", 1, 0, 0, "ana").tagIn(SPECTRO, CalibrationStatus.NOT_REQUIRED, "ana", false));
        EquipmentTag closed = new EquipmentTag("tg", "TAG-000003", "hplc", "Calibration", null, true, new EquipmentTag.Work(1, 1, 0, Set.of()));
        assertEquals("Tag TAG-000003 is closed and cannot be changed", refusal(() -> closed.tagIn(HPLC, ok, "qa", true)));
        assertEquals("The document is linked to a record of other equipment", refusal(() -> closed.assertDocumentOf("bal")));
    }

    @Test
    void schedulesMoveOnFromTheDayTheWorkWasDone() {
        MaintenanceSchedule s = new MaintenanceSchedule("s", "uv", "Wavelength check", 3, "months", TODAY, true, "Active");
        assertEquals(TODAY.plusMonths(3), s.nextDueAfter(TODAY));
        assertEquals(LocalDate.of(2027, 2, 28), new MaintenanceSchedule("s", "uv", "x", 1, "months", TODAY, true, "Active").nextDueAfter(LocalDate.of(2027, 1, 31)));
        assertEquals(TODAY.plusDays(14), new MaintenanceSchedule("s", "uv", "x", 2, "weeks", TODAY, true, "Active").nextDueAfter(TODAY));
        assertEquals(TODAY.plusYears(1), new MaintenanceSchedule("s", "uv", "x", 1, "years", TODAY, true, "Active").nextDueAfter(TODAY));
        assertEquals("The interval must be at least 1.", refusal(() -> MaintenanceSchedule.checked(m("task_name", "x", "interval_count", 0), m())));
        assertEquals("The interval unit must be days, weeks, months or years.", refusal(() -> MaintenanceSchedule.checked(m("task_name", "x", "interval_unit", "hours"), m())));
        assertEquals("Name the maintenance task.", refusal(() -> MaintenanceSchedule.checked(m("task_name", " "), m("task_name", " "))));
    }

    @Test
    void transferToAnotherLab() {
        Transfer t = new Transfer(BALANCE, TPS, "CFL", "TPS", "Moving to St. Petersburg");
        Equipment.LabEntry tpsSup = new Equipment.LabEntry("g", "Lab Supervisor", TPS, "Active");
        assertNull(refusal(() -> t.check(tpsSup, QC)));
        assertEquals("Name a group of the receiving lab to be responsible for it",
            refusal(() -> t.check(new Equipment.LabEntry("g1", "Lab Supervisor", CFL, "Active"), QC)));
        assertEquals("Pick the department of the receiving lab it will belong to", refusal(() -> t.check(tpsSup, CHEM)));
        assertEquals("Pick another lab", refusal(() -> new Transfer(BALANCE, CFL, "CFL", "CFL", null).check(tpsSup, QC)));
        assertEquals("EQ-00009 is retired", refusal(() -> new Transfer(RETIRED, TPS, "CFL", "TPS", null).check(tpsSup, QC)));
        assertEquals("Transferred to TPS: Moving to St. Petersburg", t.reason());
        assertEquals("Transferred in from CFL: qualify before use", t.tagNote());
    }
}
