# LIMS3 Sandbox

A working Sandbox of LIMS3 with fictional demo data. Slice 1: clients and contacts, the analyte table, the test catalogue with pricing and turnaround, rush fee schedules, projects and quotes, and the audit trail. Slice 2: sites and holidays, lab orders, samples, the intake dashboard (rush approvals), due dates, and the email Outbox. Slice 3: Inventory (lots of every kind of material, stock movements, in-house mixtures, purchase requests and receiving, transfers between labs, Supplier COAs, sample storage and retained quantity, warning rules).

## Start it (Windows, Claude desktop app)

1. Unzip this folder somewhere you keep work files, for example `Documents\lims3-sandbox`.
2. Open the Claude desktop app and click the **Code** tab.
3. Choose **Local**, click **Select folder**, and pick the unzipped folder.
4. Select the Opus model, then paste this message:

   > Read CLAUDE.md. Set up and start the app, run the tests, and open it in the browser pane for me.

Claude installs what is needed (one embedded database package), runs the checks, and shows you the app.

## Using it

- Pick who you are in **Working as** (top right). Every change is recorded under that name.
- Grids work like Excel: drag to select, **Ctrl+D** fills down, **Ctrl+C / Ctrl+V** copy and paste (including from Excel), type or press Enter to edit.
- Saving a change to a regulated record asks for a **Reason for Change**. You can see every change on the **Audit trail** page.
- To start over with fresh demo data, ask Claude to "reset the sandbox database".

To ask for changes, describe what you want in plain words in the Code tab, for example "on the quote screen, show the discount column next to the list price" or "a client on hold should still be able to receive quotes".

## Updating from the first slice

Claude in the Code tab may have fixed things on your laptop during the first setup (for example in `server/db.js`), so do not just overwrite the old folder.

1. Unzip this version into a **new** folder next to the old one, for example `Documents\lims3-sandbox-v2`.
2. In the Code tab, open the **old** folder and paste:

   > A new version of this project is in ..\lims3-sandbox-v2. Read its CLAUDE.md. Bring its changes into this folder, but keep any fixes you made here for this computer. Keep my data folder. Then run npm test and the browser tests, restart the app, and show me the Lab orders page.

New tables and demo data are added to your existing Sandbox database automatically.

## Reading Supplier COAs with AI (optional, off by default)

When a Supplier COA is uploaded on a lot, the app can ask Claude to read it and propose the values (manufacturer lot, expiry, purity, concentration). A person checks every value beside the document and confirms before anything is saved; the proposal is kept in the audit record. It needs an Anthropic API key, and IT/QA approval because the document is sent to Anthropic to be read. To switch it on, ask Claude in the Code tab: "turn on AI COA reading with my API key" and paste the key when asked (it is stored only on this computer, never in the project files). Without a key, the same screen is used to type the values beside the document.
