package com.tentamus.lims.purchasing.domain;

/**
 * A notice to a lab about a vendor (a corporate block, a decided proposal): written by the approvals themselves and
 * only ever acknowledged, once. Replaces vendor_notice_rules (except its permission check), the trigger
 * vendor_qualification_notices and acknowledge_vendor_notices (migration 065).
 */
public final class VendorNotice {
    private VendorNotice() {}

    /** A corporate suspension or rejection, told to every lab with how many of its open requests it stops. */
    public static String corporateBlock(VendorQualification q, String supplierName, String justification, long openRequests) {
        return "Corporate QA " + ("Suspended".equals(q.approvalStatus()) ? "suspended " : "rejected ") + supplierName + " for every lab (" + q.code() + ")"
            + (Val.blank(justification) ? "" : ": " + justification.strip()) + "."
            + (openRequests > 0 ? " " + openRequests + " open request" + (openRequests == 1 ? " is" : "s are") + " stopped until it is approved again." : "");
    }

    /** Does recording this approval tell the labs? A corporate decision that is not an approval does. */
    public static boolean tellsLabs(VendorQualification q) { return q.corporate() && !q.approved(); }

    /** A notice is acknowledged once: one already acknowledged is left as it is. */
    public static boolean unread(Object acknowledgedAt) { return acknowledgedAt == null; }
}
