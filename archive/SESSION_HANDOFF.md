# CAF POC — session handoff

**Written 2026-08-06.** Read this first, then
[CAF_Salesforce_Split_Handoff.md](CAF_Salesforce_Split_Handoff.md) for the
architecture and [CLAUDE.md](CLAUDE.md) for working rules in this folder.

A working ServiceNow ↔ Salesforce round trip exists and is demonstrable. This
document is the state of it, the decisions that got there, and the traps that
cost time so they do not cost it twice.

---

## Environments

| | Detail |
|---|---|
| ServiceNow | `dev281754.service-now.com`, scoped app **CAF Compliance** `x_gskn2_caf_compli` v1.0.0 |
| Salesforce | `orgfarm-4938c7f768-dev-ed` Developer Edition, API v67.0 (Summer '26) |
| SF UI | `https://orgfarm-4938c7f768-dev-ed.develop.lightning.force.com` |
| SF API | `https://orgfarm-4938c7f768-dev-ed.develop.my.salesforce.com` |
| SF user | `admin.070b86ccf531@agentforce.com` |

**Always** query ServiceNow through the cnit profile `caf-reyan`. The machine
default profile points at a different PDI:

```powershell
& "C:\Users\patel\Documents\ServiceNow Work Project Docs\Shared\cnit-instance-tools\cnit.ps1" <cmd> -ProfileName caf-reyan
```

---

## What works today

**Outbound, ServiceNow → Salesforce.** Async business rules on `caf_req` and
`caf_tsk` call `CAFSalesforceSync`, which upserts into Salesforce on the External
Id `ServiceNow_Sys_Id__c`. Verified idempotent: a second push of every record
left the counts unchanged.

**Inbound, Salesforce → ServiceNow.** `PATCH /api/x_gskn2_caf_compli/caf/task/{sysId}`,
basic auth as `sf.integration`, allow-listing six fields and refusing the whole
call on anything else. Apex `CafTaskService.applyChange` calls it through the
`ServiceNow_CAF` named credential. Verified end to end from Apex.

**Dashboard.** LWC `cafDashboard` on the **CAF Dashboard** tab: business
applications as rows, CAF Controls as dynamic columns, colour-coded dots, plus
drill-in to a request's tasks with Start / Criteria met actions.

**Sync Health.** LWC `cafSyncHealth`, a strip above the grid that asks
ServiceNow for its own view and compares. Green with a record count when the two
agree; when they do not it lists each difference — record, field, both values —
with a Re-sync button that re-pushes from ServiceNow. Added 2026-08-07;
detail below under "Sync Health, in full".

Data mirrored: **19 requests and 27 tasks, both sides, set-for-set identical** —
compared by number over the two CLIs on 2026-08-07, not just by count.

**Salesforce CLI**, installed 2026-08-07, org authorised as alias `caf-sf`, so
the Salesforce side is now queryable from this folder the way cnit queries
ServiceNow. Usage in [CLAUDE.md](CLAUDE.md).

Detail in [servicenow/SETUP.md](servicenow/SETUP.md) and
[salesforce/README.md](salesforce/README.md); those are the operating references
and are current.

---

## Decisions that differ from the architecture document

1. **Client Credentials, not JWT bearer** (§3 specifies JWT). ServiceNow's
   `jwt_provider` table has no fields for `iss`/`sub`/`aud`, which Salesforce
   requires, so JWT needs a custom JWT API Script. Client Credentials was one
   policy change on the connected app. **JWT is still the better production
   answer** — record the deviation in the TDD delta.
   The unused JWT keypair is still at `C:\Users\patel\.caf-jwt\`.

2. **No Application Registry entity.** `CAFSalesforceSync` requests its own token
   inline. This kept every moving part in one script plus six system properties,
   which is what made the whole setup deployable and verifiable over the Table
   API.

3. **Security deferred entirely.** §4.1 on row-level security was removed from
   the architecture document at the user's instruction — POC scope, and the
   ServiceNow query business rules are not exercised in the demo. Do not
   re-propose it.

4. **Named Credential created by hand.** Salesforce will not deploy one without a
   password, and embedding the `sf.integration` password in
   `force-app/namedCredentials/*.xml` would put a live credential in a
   client-facing directory. It lives in Setup.

---

## Traps already paid for

**ServiceNow**

- `user_password` written over the Table API is stored **unhashed** and
  authentication then fails, with the field readable as plaintext as the tell.
  Set passwords in the UI.
- A `sysauto_script` inserted over the Table API never registers a `sys_trigger`,
  so it never runs. Scheduled jobs are not a route to running arbitrary script.
- `sys_script.when` — the choice *labelled* "async" has the value
  `async_always`; plain `async` is the deprecated one. `async_always` is correct.
- `gs.getProperty()` **does** decrypt a `password2` property in scoped code.
- A field with `read_only=true` in the dictionary is **silently dropped** by the
  Table API. The PUT returns HTTP 200 and the record's pre-write values, and
  `sys_updated_on` does not move — there is no error anywhere to read.
  `caf_req.short_description` is such a field. Route: flip the `sys_dictionary`
  entry to `read_only=false`, write, flip it straight back, and verify the
  restore.
- `cnit get <table> -SysId <id>` ignores `-SysId` and returns the whole table.
  Use `-Query "sys_id=<id>"`. `-SysId` works on `put`.
- A JSON body containing **non-ASCII characters** (an em dash in a script
  comment is enough) is rejected by the Table API with `HTTP 400 - Exception
  while reading request`. The body is valid JSON and the error names nothing.
  Escape everything above U+007F to `\uXXXX` and write the file as ASCII.

**Salesforce, continued**

- `number` is a **reserved identifier in Apex**. `for (String number : ...)`
  fails to compile with "Identifier name is reserved: number", which reads like
  a platform quirk and is simply a rename.
- `sf project deploy start --metadata-dir <dir>` works on this repo's
  metadata-format `force-app`, but **adding `--single-package` makes it fail
  with "No package.xml found"** even though package.xml is right there. Omit the
  flag.

**Salesforce**

- Fields created over the Metadata API get **no field-level security**. The UI
  wizard sets it as a side effect; `createMetadata` does not. Symptom: a describe
  returns the object with the custom fields simply absent, not an error. Fixed by
  the `CAF_Integration` permission set — extend it for any new field.
- The same blind spot has **two more faces**, both found 2026-08-07 and both
  fixed. An object created over the Metadata API gets **no list view**, so
  `/lightning/o/CAF_Task__c/list` falls back to "Recently Viewed" and reads as
  empty with 27 records present. And fields created that way are added to **no
  page layout**, so the record page showed only Name and the audit fields — and
  because Lightning list views take editability from the layout, every custom
  column also rendered with a **lock icon** and refused inline edit, even though
  FLS granted Edit and the describe reported `updateable=true`. If a field looks
  editable everywhere in metadata and still will not edit, check the layout.
- `ZipFile::CreateFromDirectory` writes Windows backslashes into zip entry names,
  and every component then fails with "named in package.xml, but was not found in
  zipped directory". Reads like a manifest error, is not. Build entries with
  forward slashes.
- Tooling API rejects `FullName` on `CustomObject`; SOAP `createMetadata` works.

**The integration itself**

- The echo-loop guard (skip pushes written by `sf.integration`) is necessary but
  **not sufficient**. Cascading rules run in the same transaction and are
  attributed to the same user, so derived changes were silently stranded —
  measured: a task moved to In Progress moved its parent request in ServiceNow
  while Salesforce still read Open. Fixed by reconciling explicitly at the end of
  the inbound write. Do not "simplify" that away.

---

## Closed since this document was written

**Red in the grid — was already done, 2026-08-06 22:00.** The open item below
claiming nothing is `out_of_compliance` was stale when written. Twelve requests
were set at 22:00:01-03 and all twelve pushed HTTP 200 at 22:00:12-15. Current
spread: SAP HANA 6 out of compliance, SAP Fiori 5 out / 1 compliant, Zscalar App
6 compliant. Nothing has drifted since — last record update 22:00:03, last push
22:00:15.

**`undefined` in every short description — fixed 2026-08-07.**
`cmdb_ci_business_app` has no `u_drp_last_review_date` column on this instance
(its only custom fields are `u_caf_compliance_status` and `u_emergency_tier`), so
`ba.u_drp_last_review_date` was `undefined`, and the old guard `drp_date != ''`
is *true* for `undefined` — so the with-date branch ran and concatenated the
literal string. `caf_short_desc` now tests `isValidField()` first and falls
through to `BA - Control`, which is the script's own existing fallback shape.
Source in [servicenow/caf_short_desc.script-include.js](servicenow/caf_short_desc.script-include.js).
The 18 affected requests were backfilled (`Zscalar App - Confirm Backup &
Restore Policy`); all 18 pushed HTTP 200 and no state, `active`, `caf_status` or
`next_due_date` moved.

No date token appears anywhere now. If the DRP date is wanted later, add
`u_drp_last_review_date` to `cmdb_ci_business_app` and the script picks it up
with no further change.

**24 parentless tasks — deleted both sides, 2026-08-07.** They were
flow-development debris, not source data: all 24 identical (short description
`Attach evidence`, state 1, active, no parent, no business application, no CAF
control), created 2025-01-09 in four batches of six at 14:12:02, 14:12:31,
14:17:18 and 14:41:34, each batch sitting **immediately before** a healthy batch
of six (14:18:14 → RCAF0001019-24, 14:42:14 → RCAF0001031-36) — aborted runs of
*Create CAF Tasks* from before the parent link was wired. No approvals, no
attachments, so nothing cascaded.

Salesforce went first, via
[salesforce/delete-orphan-tasks.apex](salesforce/delete-orphan-tasks.apex) in
Execute Anonymous; ServiceNow followed in the UI, since cnit has no delete verb.
Both sides then compared number-for-number: 27 tasks, 19 requests, no difference
in either direction.

**Nothing propagates a delete**, which is why each side needed doing separately —
and why the half-done state was briefly hazardous: the sync upserts on
`ServiceNow_Sys_Id__c`, so any update to a still-present ServiceNow orphan would
have recreated its Salesforce record. Worth remembering for any future cleanup.

---

## Sync Health, in full

Built 2026-08-07. Answers the question the rest of the integration could not:
are these two systems still telling the same story?

**Why it was needed.** Every push is fire-and-forget — `_push()` logs a failure
with `gs.error` and returns, so a Salesforce outage cannot roll back a
ServiceNow transaction. Correct, but it means a failed push exists only as a log
line nobody reads while the grid keeps showing a value that is no longer true.

**The pieces**

| Where | What |
|---|---|
| ServiceNow | `GET /api/x_gskn2_caf_compli/caf/snapshot` — read-only, returns number, status, state and description for every request and task |
| ServiceNow | `POST /api/x_gskn2_caf_compli/caf/resync/{type}/{sysId}` — re-pushes one record, modifies nothing in ServiceNow |
| Salesforce | `CafSyncHealth.cls` — callout, compare, report |
| Salesforce | `cafSyncHealth` LWC — the strip above the grid |

Sources: [servicenow/CAF Integration - Sync Snapshot.scripted-rest.js](servicenow/CAF%20Integration%20-%20Sync%20Snapshot.scripted-rest.js),
[servicenow/CAF Integration - Resync Record.scripted-rest.js](servicenow/CAF%20Integration%20-%20Resync%20Record.scripted-rest.js),
[salesforce/force-app/classes/CafSyncHealth.cls](salesforce/force-app/classes/CafSyncHealth.cls).

**Four drift types**, each of which has actually occurred in this project: in
ServiceNow but missing in Salesforce (failed push); in Salesforce but missing in
ServiceNow (the orphan cleanup, mid-way); same record with different values (the
echo-loop stranding); and Salesforce simply stale.

**Design decisions worth keeping**

- **Detection is automatic, repair never is.** Re-sync is a button next to a
  difference someone is looking at. Unattended repair can turn a Salesforce
  problem into a ServiceNow one.
- **Repair only ever flows ServiceNow → Salesforce.** Salesforce holds a mirror;
  a mirror that disagrees is stale by definition.
- **No `cacheable=true`.** An Apex method that makes a callout cannot be
  cacheable, so the LWC calls it imperatively. That is also what makes Re-check
  honest — it really does go and look, rather than re-reading a cache.
- **Blank equals null.** ServiceNow returns null for an empty field and
  Salesforce may hold either; treating them as different would report drift on
  every record with an empty approval, which is most of them.
- **No new custom fields**, so the metadata-API field-level-security trap does
  not apply.

**Verified end to end, not just on the happy path.** With the systems in
agreement: 46 records compared, 0 differences. Then drift was induced by editing
`Short_Description__c` on RCAF0001037 in Salesforce only — the check reported
exactly one difference naming both values, Re-sync repaired it from ServiceNow
(HTTP 200), and the follow-up check returned to 0. Editing the mirror is a safe
test precisely because ServiceNow overwrites it.

Then run again through the UI by the user, end to end, and left in sync.

### Demo script for the drift moment

Repeatable, and it touches nothing in ServiceNow — the mirror is corrupted and
then restored from the system of record.

1. `/lightning/o/CAF_Task__c/list?filterName=All`, double-click the **State**
   cell on **CAFT0001046**, change `In Progress` to `Open`, Save.
   *(`State__c` is editable on the CAF Task layout for exactly this reason; every
   other mirrored field is Readonly.)*
2. CAF Dashboard tab → **Re-check now**. The strip turns red:
   `Task CAFT0001046 | State differs | SN=In Progress | SF=Open`.
3. **Re-sync** → ServiceNow re-pushes → strip returns to green.

The narration that matters for a non-technical audience: the grid can only be
trusted if something is checking it, and this is the something. Run step 1
before the meeting if you would rather open on the red state.

---

## Open items

Rough priority for a demo:

1. **No evidence upload or attestation UI** — steps 7 onward.
2. **No Platform Events** — step 8. Every call is synchronous today.
3. **Sync Health has no schedule and no test class.** It runs when someone opens
   the dashboard or presses Re-check. A nightly scheduled comparison that
   emails or posts on drift is the obvious next step, and `CafSyncHealth` has no
   Apex test coverage — fine for a Developer Edition org, blocking for any
   deployment to production.
4. **`RCAF0001001` has no business application and no CAF control**, so the
   dashboard's `getRequests()` filters it out. Harmless, but it is the one
   request that will never appear in the grid.

---

## Credentials

| What | Where |
|---|---|
| Salesforce consumer key + secret | ServiceNow properties `x_gskn2_caf_compli.sf.*` (secret encrypted) |
| `sf.integration` password | `C:\Users\patel\.caf-jwt\sf-integration-password.txt` and the Salesforce named credential |
| Unused JWT keypair | `C:\Users\patel\.caf-jwt\caf-jwt.p12` + password file |
| cnit OAuth token | `%USERPROFILE%\.cnit\creds\caf-reyan.oauth.dpapi` |

The Salesforce client secret and the `sf.integration` password both passed
through the 2026-08-06 session transcript. Throwaway POC org, low stakes — but
rotate both if it outlives the demo, and never put either in the docs.

**Kill switch:** set `x_gskn2_caf_compli.sf.enabled` to `false` and every
outbound push stops immediately.
