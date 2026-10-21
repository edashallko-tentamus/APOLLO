---
type: Architecture Decision
status: Approved
decided: 2026-10-12
---

# Decision - Excel Upload to the Inventory List Is QA or Administrator Only

Uploading an Excel file to the main inventory list (which can change many lots at once) is allowed only for QA and administrators, and the upload is signed (Uploaded by) with a Reason for Change after the preview of every change and error. Other people can still export the list; the Upload button is hidden for them and the server refuses their upload. Uploads to the other inventory lists stay with the people who maintain those lists, and are also signed. Requested by Alex Kiddle on 2026-10-12 as a GxP risk. Built in `server/routes_inventory.js` and `public/js/bulkio.js`.

See [[Decision - Every Inventory Tab Exports and Uploads Excel]], [[Decision - Inventory Changes Are Electronically Signed]].