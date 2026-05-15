# Salesforce side — CAF Compliance POC

**Status: deployed to the DE org, 2026-08-06.**

Open it at **App Launcher (grid icon) → search "CAF Dashboard"**, or go direct to
`/lightning/n/CAF_Dashboard`.

## What is deployed

| Component | Detail |
|---|---|
| `CAF_Request__c` | 8 fields; 109 records mirrored from dev281754 |
| `CAF_Task__c` | 8 fields, lookup to `CAF_Request__c`; 179 records |
| `CafDashboardController` | Apex read model for the grid |
| `CafTaskService` | Apex — `getTasks` plus the `applyChange` callout to ServiceNow |
| `CafSyncHealth` | Apex — drift detection and single-record repair (2026-08-07) |
| `CafEvidenceService` | Apex — Salesforce Files in, evidence pushed to ServiceNow (2026-08-07) |
| `CafAttestationService` | Apex — attestation outcome out, ServiceNow's verdict back (2026-08-07) |
| `cafDashboard` | LWC — compliance grid with drill-in and actions |
| `cafSyncHealth` | LWC — sync status strip above the grid (2026-08-07) |
| `cafEvidence` | LWC — upload, and both file lists side by side (2026-08-07) |
| `cafAttestation` | LWC — criteria, comments, Approve / Reject (2026-08-07) |
| `CAF_Dashboard` | Lightning component tab |
| `CAF_Request__c` / `CAF_Task__c` tabs | object tabs; the task tab added 2026-08-07 |
| `All` list views | on both objects, with columns; task view added, request view given columns |
| Page layouts | both, with their custom fields on them |
| `ServiceNow_CAF` | legacy Named Credential, basic auth as `sf.integration` |
| `CAF_Integration` | permission set: FLS, object perms, Apex access, tab visibility |

**The Named Credential is created by hand in Setup, deliberately.** Salesforce
refuses to deploy one without a password, and the alternative — putting the
`sf.integration` password into `force-app/namedCredentials/*.xml` — would place a
live credential in a directory that gets shared with clients. Setup is where the
secret belongs. If you rebuild the org, recreate it manually: name
`ServiceNow_CAF` exactly, since the Apex references `callout:ServiceNow_CAF`.

## Actions write to ServiceNow, never locally

Clicking a dot opens that request's tasks with **Start** and **Criteria met**
buttons. Neither touches the Salesforce record. Both call
`CafTaskService.applyChange`, which PATCHes the Scripted REST API in
`x_gskn2_caf_compli`; ServiceNow applies its own rules and the inbound API pushes
the resulting state — including derived changes to the parent request — back into
Salesforce. Salesforce never edits its own mirror of a value ServiceNow owns.

**The row actions are conditional, and evidence and attestation are separate.**

| Task state | Buttons | Count |
|---|---|---|
| Open | Start · Upload evidence | 72 |
| In Progress | Upload evidence · Attest | 22 |
| Closed Complete | View evidence | 79 |
| Cancelled | View evidence | 6 |

`Start` renders only on an `Open` task and `Attest` only on an In Progress one,
because neither can succeed otherwise and being allowed to press a button that
is guaranteed to fail teaches nothing. The evidence button always renders — the
panel is the audit view as much as the action — and on a closed task it reads
**View evidence** and drops its upload control.

The old `Criteria met` button is **gone**. It set `met_criteria` to `yes` on its
own, which the attestation form now does properly as a yes/no alongside the
decision it belongs with.

Verified end to end 2026-08-06: an Apex callout set `vqd_link_2` on `CAFT0001022`,
ServiceNow logged `[SF->CAF] CAFT0001022 updated by sf.integration`, and the
reconciliation updated the Salesforce task in the same call.

Source is under [force-app/](force-app/); it deploys as-is with the Metadata API
(`package.xml` is at the root of the zip, `singlePackage=true`).

## The grid

Rows are business applications, columns are CAF Controls, each cell a
colour-coded dot. Currently **19 apps x 6 controls**, reseeded 2026-08-08 from
the three SAP/Zscalar applications it used to show — see section 13 of
[HANDOFF.md](../HANDOFF.md) and
[testing/automation/seed/data.ts](../testing/automation/seed/data.ts), which is
the source of truth for the shape of it.

```
APP                   HA  Backup  DR  RTO  Enc  TestB     Overall
Customer CRM           O    O      O   O    O    O        Compliant
Document Management    O    O      O   ~    O    O        5 of 6
Employee Helpdesk      X    ~      X   O    O    ~        2 of 6
Intranet Portal       N/A   ~     N/A  O   N/A   ~        1 of 3
Vendor Management      E    O      O   ~    O    O        4 of 6
Zoho Email             X    X      ~   X    ~    X        0 of 6
...                                                       (19 rows)
```

`O` compliant · `~` approaching due · `X` out of compliance · `E` exception
approved · `N/A` never assessed.

**There is no app list in the code.** A row is a distinct
`Business_Application__c` across the mirrored requests, so the way to change what
this shows is to change what ServiceNow holds and let the push carry it over.

**Columns come from the data, not from a list in the code.** Adding a CAF Control
in ServiceNow adds a column here with no code change — that is the defining
behaviour of the AngularJS widget this replaces, and the reason the Apex
controller returns flat rows and lets the client pivot. Pivoting in Apex would
mean inventing a column contract the client then has to trust.

**An app is compliant only when every control is**, matching the ServiceNow
widget. Softening that here would make the two views disagree about the same
data, which is worse than either being wrong alone.

## Sync Health

The strip above the grid asks ServiceNow for its own view of every request and
task and compares it with what Salesforce holds. Green with a record count when
they agree; when they do not it names each difference — record, field, both
values — with a **Re-sync** button that re-pushes that one record.

It exists because every push in this integration is fire-and-forget: a failed
push is logged in ServiceNow and nothing else happens, so without this the grid
can show a value that stopped being true and nobody would know.

Two rules built into it. **Repair is never automatic** — Re-sync is a button next
to a difference someone is looking at, because unattended repair can turn a
Salesforce problem into a ServiceNow one. And **repair only flows ServiceNow →
Salesforce**, because Salesforce holds a mirror and a mirror that disagrees is
stale by definition.

`CafSyncHealth.check()` is deliberately **not** `cacheable=true` — Apex that
makes a callout cannot be — so the LWC calls it imperatively. That is what makes
Re-check honest: it goes and looks rather than re-reading a cache.

Verified 2026-08-07 in both directions: 46 records compared with 0 differences;
then `Short_Description__c` on RCAF0001037 was edited in Salesforce only, the
check reported exactly that one difference, Re-sync repaired it from ServiceNow,
and the next check returned to 0.

## Evidence and attestation

**Two buttons and two panels, because they are two jobs done by two people.**
Whoever owns the application gathers the evidence; someone else judges it. One
button covering both would imply one person does both, which is the opposite of
what an attestation is for.

- **Upload evidence** opens `cafEvidence` alone, with its upload control.
- **Attest** opens `cafEvidence` in read-only mode beside `cafAttestation`. The
  approver has to *see* the evidence to attest to it and must not be adding to
  it, so the same component renders with `hide-upload` rather than a second
  read-only component existing to say the same things.

Both are also `lightning__RecordPage` components: drop them on the `CAF_Task__c`
record page in App Builder and the standard record page becomes an attestation
surface too. Both carry the `lightningCommunity__Page` target for the Experience
Cloud site that has not been built yet.

**Uploading puts the file in two places.** `lightning-file-upload` stores it as a
`ContentVersion` against the task, which is what gives preview, download and the
Files related list; then `CafEvidenceService.pushEvidence` sends it to ServiceNow
as a `sys_attachment`, one file per Apex transaction. The panel shows both lists
next to each other and warns when the counts differ, because **only the
ServiceNow copy unlocks an attestation** — that gate is enforced in ServiceNow,
not here. Cap is 2 MB per file: Apex holds the Blob and its base64 expansion in
the same 6 MB heap.

Attesting sets `met_criteria`, `comments` and `approval` in ServiceNow and stops
there. Setting `approval` *is* the transition — an existing business rule closes
the task and moves the parent request's compliance status. Salesforce writes
none of that; it arrives on the usual push.

Note that **closing the last task on a request does not close the request** — the
flow creates the next task in the chain instead. Attesting `CAFT0001022`
*"Attach evidence"* produced `CAFT0001001` *"IT Application Owner Attestation"*,
which is now sitting Open on `RCAF0001022` with no evidence: a ready-made
starting point for demonstrating the whole feature.

