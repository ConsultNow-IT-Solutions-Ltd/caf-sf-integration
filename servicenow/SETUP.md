# ServiceNow → Salesforce push

**Status: deployed and verified on dev281754, 2026-08-06.** Nothing here is left
for you to build. This is the operating reference.

## What is live

### ServiceNow

| Record | Table | Detail |
|---|---|---|
| 6 system properties | `sys_properties` | prefix `x_gskn2_caf_compli.sf.` |
| `CAFSalesforceSync` | `sys_script_include` | api name `x_gskn2_caf_compli.CAFSalesforceSync` |
| `CAF - Push Request to Salesforce` | `sys_script` | async, insert + update, order 1000 |
| `CAF - Push Task to Salesforce` | `sys_script` | async, insert + update, order 1000 |
| `CAF Integration` | `sys_ws_definition` | base `/api/x_gskn2_caf_compli/caf` |
| Update Task / Sync Snapshot / Resync Record | `sys_ws_operation` | PATCH, GET, POST — see below |
| Upload Evidence / List Evidence / Attest Task | `sys_ws_operation` | POST, GET, POST — see below |

### Salesforce

| Component | Detail |
|---|---|
| `CAF_Request__c` | created through the UI wizard |
| `CAF_Task__c` | created over the Metadata API, 8 custom fields |
| `CAF_Integration` permission set | field-level security for `CAF_Task__c`, assigned to the integration user |

**Fields created over the API have no field-level security.** The UI wizard sets
FLS as a side effect; `createMetadata` does not. The eight `CAF_Task__c` fields
existed and were completely invisible to the API user until the `CAF_Integration`
permission set was created and assigned - a describe returned the object with no
custom fields at all rather than an error. Any field added to Salesforce by API
from here needs the same treatment.

The same blind spot costs two more things, both fixed 2026-08-07: an object
created that way gets **no list view** (the task list read as empty with 27
records in it), and fields reach **no page layout** (the record page showed only
Name and the audit fields, and every custom column in the list view carried a
lock icon and refused inline edit even though FLS granted Edit). Anything added
by API from here needs FLS, a layout entry, and - for a new object - a list view.

A **list view with no `<columns>` at all** looks identical to a missing one:
`CAF_Request__c` had its "All" view from the UI wizard, but with no columns
declared it rendered as a list of nothing but Name. Both list views now declare
their columns in [force-app/objects/](../salesforce/force-app/objects/).

And there is **no tab**, so the object never appears in the App Launcher.
`CAF_Task__c` was missing from it entirely until a `CustomTab` was deployed on
2026-08-07, with visibility granted through the `CAF_Integration` permission set
rather than left to profile defaults.

So the full checklist for anything created in Salesforce over the API:
**field-level security, page layout, list view with columns, and a tab with
visibility.** The UI wizard does all four silently; `createMetadata` does none
of them, and every one fails as an empty screen rather than an error.

Source of truth for the code is
[CAFSalesforceSync.script-include.js](CAFSalesforceSync.script-include.js) and
[CAF - Push Request to Salesforce.business-rule.js](CAF%20-%20Push%20Request%20to%20Salesforce.business-rule.js);
both were posted to the instance from those files.

## Properties

| Name | Type | Value |
|---|---|---|
| `x_gskn2_caf_compli.sf.enabled` | boolean | `true` |
| `x_gskn2_caf_compli.sf.instance_url` | string | `https://orgfarm-4938c7f768-dev-ed.develop.my.salesforce.com` |
| `x_gskn2_caf_compli.sf.client_id` | string | connected app Consumer Key |
| `x_gskn2_caf_compli.sf.client_secret` | password2 | encrypted at rest (`{{gpaes}}…`) |
| `x_gskn2_caf_compli.sf.api_version` | string | `v67.0` |
| `x_gskn2_caf_compli.sf.integration_user` | string | `sf.integration` |

**`sf.enabled` is the kill switch.** Set it to `false` and every push stops
immediately — no code change, no deactivating rules under pressure. It is the
first thing to reach for if anything misbehaves mid-demo.

## Auth

OAuth 2.0 Client Credentials, requested inline by the Script Include rather than
through an Application Registry entity. That was a deliberate trade: it keeps
every moving part in one script plus six properties, which is what made the whole
setup deployable and testable over the Table API. It differs from §3 of the
handoff document, which specifies JWT bearer — JWT remains the better production
answer and the deviation should be recorded in the TDD delta.

The token is not cached; each push costs one extra round trip. At POC volume
that is worth more in debuggability than it costs.

## Verified behaviour

```
19:30:46  [CAF->SF] RCAF0001034 pushed, HTTP 201                    (created)
19:31:36  [CAF->SF] RCAF0001034 pushed, HTTP 200                    (updated, no duplicate)
19:41:18  [CAF->SF] CAFT0001042 -> CAF_Task__c, HTTP 201            (created, parent linked)
19:41:18  [CAF->SF] CAFT0001007 -> CAF_Task__c, HTTP 201            (created, no parent)
```

Counts held steady across a second push of every record - 3 requests, 2 tasks -
so upsert-by-External-Id works end to end from inside ServiceNow, not just from
a laptop.

**Parent linking is by External Id, not by Salesforce Id.** A task sends

```json
"CAF_Request__r": { "ServiceNow_Sys_Id__c": "<parent sys_id>" }
```

which resolves the lookup inside the same upsert. There is therefore no ordering
dependency between the request and task pushes, and no Salesforce Id ever has to
be written back into ServiceNow. `CAFT0001042` linked to `RCAF0001033` this way.

**Parentless tasks are real.** `CAFT0001007` has an empty `caf_request`, so the
payload omits the relationship entirely rather than sending an empty one, which
Salesforce would reject.

## Checking it

ServiceNow side — **System Logs → All**, or:

```javascript
var gr = new GlideRecord('syslog');
gr.addQuery('message', 'CONTAINS', '[CAF->SF]');
gr.orderByDesc('sys_created_on');
gr.setLimit(20);
gr.query();
while (gr.next()) { gs.info(gr.getValue('sys_created_on') + '  ' + gr.getValue('message')); }
```

Salesforce side — the **CAF Requests** tab.

## Inbound: Salesforce → ServiceNow

`PATCH /api/x_gskn2_caf_compli/caf/task/{sysId}`, basic auth as `sf.integration`.
Script in [CAF Integration - Update Task.scripted-rest.js](CAF%20Integration%20-%20Update%20Task.scripted-rest.js).

Salesforce may write six fields and nothing else: `state`, `met_criteria`,
`approval`, `comments`, `vqd_link`, `vqd_link_2`. Anything else fails the whole
call with 400 rather than applying the writable subset — a caller that believes
it set `met_criteria` and did not is worse than an error. Everything driving the
state machine (`number`, `active`, actual dates, `business_application`) stays
unwritable from Salesforce, which is §2's governing rule enforced at the boundary.

| Case | Result |
|---|---|
| allowed field | 200, field applied |
| `number` (not in allow-list) | 400 `Fields not writable from Salesforce: number` |
| unknown sys_id | 404 `CAF Task not found` |

## Drift detection: two more resources on the same API

Added 2026-08-07, same base URI and same `sf.integration` auth.

**`GET /api/x_gskn2_caf_compli/caf/snapshot`** — returns number, sys_id, status,
state, description and `sys_updated_on` for every request and task, so Salesforce
can compare its mirror against ServiceNow's own view. Read-only by construction:
no GlideRecord in it is ever updated, so the endpoint cannot cause the drift it
detects. Script in
[CAF Integration - Sync Snapshot.scripted-rest.js](CAF%20Integration%20-%20Sync%20Snapshot.scripted-rest.js).

**`POST /api/x_gskn2_caf_compli/caf/resync/{type}/{sysId}`** — `type` is
`request` or `task`. Re-pushes that one record through `CAFSalesforceSync` and
reports the result; modifies nothing in ServiceNow. A failed push returns 502
rather than being swallowed, because the whole reason this endpoint exists is
that a silent failure already happened once. Script in
[CAF Integration - Resync Record.scripted-rest.js](CAF%20Integration%20-%20Resync%20Record.scripted-rest.js).

The state integer is mapped to the same labels `CAFSalesforceSync` pushes — Open,
In Progress, Closed Complete, Cancelled. If those two lists ever drift apart the
comparison reports a difference on every record, which is loud enough to notice
immediately.

| Case | Result |
|---|---|
| `GET /snapshot` | 200, `{request_count, task_count, requests[], tasks[]}` |
| `POST /resync/request/{good sys_id}` | 200 `{number, ok: true, status: "200"}` |
| `POST /resync/badtype/{sys_id}` | 400 `type must be "request" or "task"` |
| `POST /resync/request/{unknown}` | 404 `No request with sys_id ...` |
| push fails downstream | 502, with the underlying status and message |

Verified 2026-08-07 from Salesforce: 46 records compared, 0 differences; then
drift induced on RCAF0001037 in Salesforce only, detected as exactly one
difference, repaired by `resync` (`{"number":"RCAF0001037","ok":true,"status":"200"}`),
and confirmed back to 0.

## Evidence and attestation: three more resources on the same API

Added 2026-08-07, same base URI and same `sf.integration` auth. Full rationale is
in section 6 of the handoff document; this is the operating reference.

**`POST /api/x_gskn2_caf_compli/caf/task/{sysId}/evidence`** — body
`{file_name, content_type, data}` where `data` is base64. Writes a
`sys_attachment` against the task with `GlideSysAttachment().writeBase64()`,
which does work in scoped code. Caps a file at 2 MB, checked from the encoded
length before decoding. Returns the stored row's size rather than echoing the
request. Script in
[CAF Integration - Upload Evidence.scripted-rest.js](CAF%20Integration%20-%20Upload%20Evidence.scripted-rest.js).

Nothing is pushed to Salesforce after a write here. An attachment maps to no
mirrored field on `CAF_Task__c`, so there is no drift for a push to correct.

**`GET /api/x_gskn2_caf_compli/caf/task/{sysId}/evidence`** — the attachments
ServiceNow actually holds. Read-only by construction. Script in
[CAF Integration - List Evidence.scripted-rest.js](CAF%20Integration%20-%20List%20Evidence.scripted-rest.js).

**`POST /api/x_gskn2_caf_compli/caf/task/{sysId}/attest`** — body
`{met_criteria, outcome, comments}`. Checks, in order: task exists, task is
active, task is In Progress, the outcome is not already recorded, and **at least
one attachment exists**. Then sets `met_criteria`, `comments` and `approval`, and
stops. Setting `approval` is the whole act — the active business rule
`CAF - success criteria not met` closes the task and sets the parent request's
`caf_status`. Reconciles afterwards exactly as Update Task does. Script in
[CAF Integration - Attest Task.scripted-rest.js](CAF%20Integration%20-%20Attest%20Task.scripted-rest.js).

| Case | Result |
|---|---|
| `GET /evidence` | 200 `{task, count, files[]}` |
| `GET /evidence/{unknown}` | 404 `CAF Task not found` |
| `POST /evidence`, valid | 201 with the stored `sys_id` and `size_bytes` |
| `POST /evidence` over 2 MB | 413 |
| `POST /attest` on an Open task | 409 `must be In Progress before it can be attested` |
| `POST /attest` with no attachment | 428 `Attach at least one evidence file` |
| `POST /attest`, bad `outcome` | 400 |
| `POST /attest`, valid | 200 with task state, active flag, and the parent's new status |

**The gate is here and only here.** The business rule
`CAF - attachment mandatory for def tasks` does the same check and stays
inactive; activating it would make every portal close fail, since none of the
existing tasks has an attachment.

Verified 2026-08-07 through the deployed Apex over the named credential:
`CAFT0001022` uploaded, attested approved, closed; `RCAF0001022` moved to
`in_compliance`; both sides re-read independently and agreed. Closing that task
made the flow create a follow-on task, `CAFT0001001` *IT Application Owner
Attestation* — the request itself did **not** close.

### The echo-loop guard, demonstrated

Same record, same field, two writers:

```
19:51:41  [SF->CAF] CAFT0001007 updated by sf.integration   -> no outbound push
19:52:44  [CAF->SF] CAFT0001007 -> CAF_Task__c, HTTP 200    <- same field, written by admin
```

The Salesforce-originated write produced no push back; the admin write did. That
is watch-out 4 closed, and it depends entirely on the inbound API authenticating
as `sf.integration`. Run it as any other account and the guard is inert.

### The guard alone strands derived changes — measured, then fixed

The guard suppresses pushes for anything `sf.integration` writes. That is right
for the record Salesforce just wrote and wrong for everything ServiceNow derives
from it, because the cascading rules run inside the same transaction and are
attributed to the same user.

Measured on `CAFT0001048` before the fix — moved to In Progress through the
inbound API:

| | ServiceNow | Salesforce |
|---|---|---|
| `RCAF0001039` state | In Progress, `actual_start_date` set | **Open**, untouched |

No push was logged for the task or the parent. A user acting in Salesforce would
have seen stale data the instant they acted.

The fix is an explicit reconciliation at the end of the inbound write: push the
task and its parent request directly, rather than loosening the guard. That keeps
it deliberate and bounded — exactly two upserts, triggered by the request rather
than by a record change, so no loop can form from it. Re-measured on
`CAFT0001022`:

```
BEFORE: RCAF0001022 State__c=Open          19:56:37
inbound PATCH state=2
AFTER:  RCAF0001022 State__c=In Progress   20:14:23
```

The cost is two synchronous callouts inside the inbound request. Acceptable at
POC volume; at real volume this is where the handoff document's event queue
belongs.

### Setting the integration user's password

Not doable over the Table API: writing `user_password` stores the raw string
unhashed and authentication then fails, with the field readable as plaintext as
the tell. Creating a `sysauto_script` to do it in script does not help either —
a job inserted over the Table API never registers a `sys_trigger` and so never
runs. Use **User Administration → Users → Set Password** in the UI.

## Known gaps

- **Requests are outbound-only.** There is no inbound resource for `caf_req`,
  deliberately — request state is derived from its tasks by the existing flows.
- **No Apex test coverage** on any of the classes that call these resources.
- **Secrets.** The Salesforce client secret and the `sf.integration` password
  both exist outside the instance — the former in this session's transcript, the
  latter in `C:\Users\patel\.caf-jwt\`. Throwaway POC, so low stakes, but rotate
  both if the org outlives the demo.
