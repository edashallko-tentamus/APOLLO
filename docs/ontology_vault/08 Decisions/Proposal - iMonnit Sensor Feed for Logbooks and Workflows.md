---
type: Proposal
status: Built in the Sandbox on the pretend service (0.25.0, 2026-10-19); build choices Proposed; the real connection waits for the production server
decided: 2026-10-19 (Alex: hourly summaries plus readings outside the limits)
---

# Proposal - iMonnit Sensor Feed for Logbooks and Workflows

Alex, 2026-10-19: "Do you think we could connect to the iMonnit system to retrieve humidity and temperature data to populate logbooks and or test workflow steps?" Then: "Hourly with your suggestion. Go ahead and take a look at their API and craft a design. We aren't able to do this yet but let's mock up a design to be applied when we move to a production server."

## The idea in one line

A connector on the LIMS server reads each Monnit sensor's readings from iMonnit, and an automated account records them in the equipment's logbook. Each record is either **one entry per hour** (minimum, maximum, average, number of readings) or **one excursion entry per spell outside the limits**, holding every reading in that spell. The logbook rules already built do the rest: limits, failure reasons, QA review, QC Review flags, stability excursions and trend charts. iMonnit keeps every raw reading as it does today.

## What Monnit offers (checked 2026-10-19)

Confirmed from Monnit's public pages:
- **A REST API and a data webhook.** Both need an **iMonnit Premiere or Enterprise licence** (monnit.com/support/api). Premiere is the hosted service; Enterprise is the same software installed on our own Windows server.
- **REST calls** have the form `https://www.imonnit.com/{json|xml}/<Method>/...` with an access token. The method names seen include `SensorList`, `SensorGet`, `SensorGetExtended`, `SensorGetCalibration` and `GetDatumNameList`.
- **Data webhook.** iMonnit sends each gateway's batch of sensor messages as JSON to one address (one push per account). It retries a failed message after 2, 15 and 60 minutes, and suspends the push after 100 failures in a row.
- **Each sensor message** carries `sensorID`, `sensorName`, `dataMessageGUID` (unique), `messageDate`, `rawData`, `dataType` (e.g. TemperatureData), `dataValue`, `plotValues`, `plotLabels` (e.g. Fahrenheit), `batteryLevel`, `signalStrength` and `state`. In Monnit's example the raw value is in °C and the plot value is converted to the account's display unit.

Not confirmed (the method reference and the API key pages need an iMonnit sign-in):
- how API keys are made, and whether a key can be read-only;
- the call that returns a sensor's readings between two dates (expected: `SensorDataMessages`), and the longest range per call;
- the time zone of `messageDate`;
- how a humidity and temperature sensor reports both values in one message;
- call limits;
- how the webhook can prove it comes from Monnit (a secret header or similar).

**To get:** someone with an iMonnit Premiere account (or the 45-day trial) opens API > Rest API and shares the method pages, or Monnit support sends them.

## How the readings come in

- **Pull (recommended).** Every 10 minutes the server asks iMonnit for each linked sensor's readings since the last one it holds. This only needs the server to reach imonnit.com, so nothing has to be opened to the internet. The job runs like the hourly equipment tag-out job (`routes.startJobs`).
- **Webhook (optional, later).** Readings arrive within a minute, but the LIMS must have a public HTTPS address and a way to check the sender. If used, the pull still runs once an hour to fill any gaps.
- **Duplicates:** `dataMessageGUID` is unique, so a reading received twice is stored once.
- **Units:** the value is taken as stored by the sensor (`rawData`, °C for temperature, % RH for humidity) and converted with the Units tables. The display setting in iMonnit is never relied on.
- **Time:** stored in UTC. Hours are the lab's local hours (its time zone, as for due dates).

## What the logbook gets

For each sensor linked to a logbook field (for example EQ-00008 Reagent refrigerator 1, Temperature):

1. **Hourly entry** (one per sensor per hour). It holds the minimum, maximum and average, the number of readings, and the first and last reading times. It is judged on its minimum and maximum against the equipment's logbook limits. An hour with no readings outside the limits passes.
2. **Excursion entry**, one per spell outside the limits. It opens on the first reading outside them, holds every reading in the spell with its time, the peak value and the duration, and closes on the first reading back inside. It fails, and **a person gives the reason** (what happened, what was done), as for a failure typed in by hand. An hour that overlaps an excursion is marked "see LBE-…".
3. **No-data entry.** If a sensor sends nothing for longer than its gap limit (default 3 missed check-ins, e.g. 30 minutes), a "No data" entry records the period. It fails like an excursion: an unmonitored period needs a reason too (moved, battery, gateway down).

**Every reading behind an hourly entry is kept with the entry** (about 12 per hour at a 5-minute check-in), so the summary can always be recalculated. That is roughly 10 MB a year per sensor. If Alex prefers to keep only the summary, iMonnit remains the source of the raw readings.

**Late readings.** A gateway that was offline can send stored readings later. An hour is held open for 2 hours, then closed. A reading that arrives after that corrects the entry with the reason "late readings from the sensor" (audited, as any correction). If the entry was already used, it flags the results, as logbook corrections do today.

**Who records:** a new automated account, `sensor.feed`, built like the verification accounts. It cannot sign in, holds no group, and its only right is recording entries for linked sensors. Its entries carry the signature method "Automated sensor feed".

**QA review stays as it is.** QA approves each day's entries for the logbook in one signed action. Excursions and no-data periods are listed first, with their reasons.

## Where it is used

- **Logbooks:** the temperature log (LB-0003) and any humidity log (rooms, balances, media storage) fill themselves. A hand-typed reading is still allowed, for example when a sensor is out for calibration.
- **QC Review:** an incubator load's whole period, from time in to time out, is checked against the sensor's hourly entries and excursions. Any excursion or gap inside it is flagged on the batch, as failed equipment checks are today (`batch_equipment_flags`). This catches what a start and end reading cannot.
- **Workflow steps (designer option):** a step field can take its value from a sensor, either:
  - the incubator's average and range over a load (Incubation), or
  - the room's humidity when a weighing was done (Weighing, for hygroscopic materials).

  The value is filled in for the analyst, shown with its source (sensor, time), and cannot be typed over.
- **Stability:** chamber excursions reach QA's excursion assessment as soon as they happen, with the readings attached.
- **Trending:** TC-0001 and any humidity chart fill themselves from the hourly entries.
- **Equipment page:** each linked sensor's last reading, battery and signal. A low battery (under 20 %) or weak signal shows on the Lab Supervisor's dashboard.

## What will be added (when built)

- **Permissions:**
  - `sensors.configure` (QA, Lab Supervisor) links sensors to equipment and logbook fields. Each link is signed and approved by QA, like a logbook design.
  - Only system administrators set the connection itself (address, status).
- **The key:** kept in the production server's secret store (an environment setting), **never** in the database or the code. The screen only shows whether it is connected, the last successful read, and the last error.
- **Tables:**
  - `sensor_connection` (per lab or per account: provider iMonnit, cloud or Enterprise address, status, last read, last error);
  - `sensor_link` (iMonnit sensor ID and name, equipment, logbook and field per measured value, unit, gap limit, valid from and to; signed);
  - `sensor_reading` (each reading received, kept with its hour entry; never changed);
  - `sensor_sync_log` (each read: time, readings received, errors).
- **Logbook setting:** "Filled by a sensor feed" on a logbook, with the hourly and excursion entry kinds.
- **Server:** `server/connectors/imonnit.js` (calls iMonnit, maps messages) and a job in `routes.startJobs`. A built-in **mock iMonnit service** serves known readings for tests and validation, so the whole feed can be built and tested in the Sandbox without a licence.
- **Tests:**
  - Rule tests: hour summaries, excursion spells, gaps, late readings, duplicates, permissions.
  - A browser suite against the mock: linking a sensor, an hour recorded, an excursion with its reason, QA's daily approval, an incubator load flagged in QC Review.

## Validation notes (for QA)

- The connector is part of the LIMS. It is validated with the mock service: known readings in, expected entries out (OQ).
- iMonnit is a supplier system. Monnit is qualified as a supplier in Purchasing, and iMonnit's own controls are assessed: access, audit trail, data retention, Part 11 claims.
- Each sensor is a measuring instrument. Its calibration (certificate, due date) is recorded on its equipment record, and an out-of-calibration sensor stops feeding entries as accepted readings (they are recorded and flagged).
- An unmonitored period is always visible (no-data entries); it is never silently filled.

## Needed before building

1. An iMonnit **Premiere or Enterprise** licence for the sensors to be linked (API access requires it).
2. The REST method reference (behind the iMonnit sign-in) to confirm the open points above.
3. IT:
   - the production server reaching imonnit.com (or our Enterprise server);
   - where the key is kept;
   - for the webhook, a public HTTPS address.
4. The list of sensors and the equipment each one sits in.
5. QA:
   - the gap limit;
   - the 2-hour grace for late readings;
   - whether every reading is kept with the hourly entry;
   - the items in Validation notes.

## Choices (Proposed, for Alex)

- Pull every 10 minutes; webhook only later.
- One hourly entry per sensor, plus one entry per excursion spell and per no-data period.
- Each hour is held open for 2 hours, then closed; later readings correct it.
- The readings behind each hour are kept with the entry.
- The automated account records; people give reasons; QA approves daily.
- A sensor value in a workflow step cannot be typed over.

## Built so far (0.24.2, 2026-10-19)

The pretend iMonnit service (`server/connectors/imonnit_mock.js`) and the reading side (`server/connectors/imonnit.js`), tested by `npm run test:imonnit` (23 checks) with no app or database. Nothing in the app uses them yet.

- **The scenario covered:** a fridge door left open (one excursion, 10:20 to 10:50, peak 9.4 °C); an incubator sensor silent for 50 minutes (a no-data period) and for 15 minutes (not one); humidity at 63 % in the second 01:00 hour of the night daylight saving time ends (two 01:00 hours, 25 hours that day); a gateway offline for 2.5 hours whose readings arrive later (the closed 02:00 hour corrected, 03:00 and 04:00 added late, the no-data period filled); a message received twice; a wrong key; "too many requests"; calls limited to 24 hours.
- **Design finding:** late readings carry their own earlier times, so each read must take the last 24 hours again (reading back 2 hours misses them). If Monnit offers a call by time received or by message number, that is better: ask when the method reference is available.
- **Unit choice confirmed in the code:** the value comes from the sensor's own reading (°C, % RH), never iMonnit's display unit (°F in the example).

## Built (0.25.0, 2026-10-19, migration 045; Alex: "go")

The feed into the logbooks, on the pretend service; applied to Alex's Sandbox with the connection off.

- **What matches the design:** hourly entries, excursion and no-data entries; the automated account `sensor.feed` signing "Automated sensor feed"; links signed and approved by QA; readings kept unchanged; late readings correcting entries (and voiding a silence they fill); QC Review windows exactly the excursion or silence; incubator loads showing the sensor's range; the equipment page's sensors.
- **Changed from the design:**
  - the hourly entries are worked out in the database (`sensor_feed_refresh`), not in the server, so the rule lives with the other logbook rules; the server only reads iMonnit;
  - QA can let a new link fill in up to 7 days of the sensor's earlier readings (Alex did not ask; Claude Code's choice, useful when a running sensor is first connected);
  - the readings are kept in their own table (`sensor_reading`, never changed), not inside each hourly entry.
- **Not built yet:** the designer option for a step value taken from a sensor (e.g. the room's humidity at weighing); the webhook; the real iMonnit message format (assumed until Monnit's method reference is seen).
- **Build choices (Proposed):** QA approves links (`logbook.review`); `sensors.configure` for Lab Supervisor and QA; a silence over 30 minutes by default (per link, 10 minutes to 24 hours); 72 hours looked at and 48 changed on each read; an hour fails when any reading is outside the limits and takes its reason from its excursion; the pretend connection is on only in fresh test databases.

## Limits that were wrong (0.25.1, 2026-10-19, migration 046)

From Alex's first test (limits typed as 10 to 30 for an incubator at 34 °C). An entry is judged against the limits in force when it is recorded, and records them; correcting the limits never changes past entries by itself (as for entries typed by hand). When the limits were wrong, someone with sensors.configure asks for the sensor's entries to be **re-judged** against the corrected limits (signed, with a reason); the feed voids the excursions that no longer are one and judges the hours again (approved ones go back to QA), each change carrying the reason and who asked. After any limit change, an open excursion ends at the first reading inside the new limits, so it does not flag QC Review without end. Build choice (Proposed): re-judging is sensors.configure's (Lab Supervisor, QA), not QA's alone.

## Related

- [[Decision - Electronic Logbooks L-1 and L-2]]
- [[Decision - Logbook Values Feed Results Through Scanned Materials]]
- [[Decision - Trending and Control Charts T-1]]
- [[Decision - Stability Studies S-2]]
- [[Decision - Workflow Verification]] (automated accounts)
