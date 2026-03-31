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

