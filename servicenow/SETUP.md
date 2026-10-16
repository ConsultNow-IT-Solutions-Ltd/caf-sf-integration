# ServiceNow → Salesforce push

**Status: redeployed and verified on dev249570, 2026-09-04.** The integration
layer below is live and tested end to end. The compliance engine it sits on is
**not** — see [What is missing](#what-is-missing). This is the operating
reference.

> **The instance moved.** This document described dev281754 until 2026-09-04.
> That PDI was reclaimed and reassigned: the hostname still serves a login page,
> but the old admin password returns *invalid/expired*, so nothing could be
> exported from it. The app was rebuilt from scratch on **dev249570** using the
> scripts in [deploy/](deploy/) — the tables from the data model in the
> technical design document, the integration layer from the `.js` files here.
>
> **Basic auth is refused for the `admin` account** on dev249570, with a correct
> password and a working web login (401, `WWW-Authenticate: Basic`). Drive the
> Table API as admin over a `login.do` session plus `X-UserToken` instead; see
> [deploy/sn-session.sh](deploy/sn-session.sh). This does **not** affect the
> integration: `sf.integration` authenticates over basic auth normally, which is
> what every inbound resource below uses.

## What is live

### ServiceNow

| Record | Table | Detail |
|---|---|---|
| `CAF Compliance` | `sys_app` | scope `x_gskn2_caf_compli`, 1.0.0, Helsinki ES5 |
| 6 `caf_*` roles | `sys_user_role` | admin, engineer, three tier owners, read-only |
| 5 CAF tables, 65 fields | `sys_db_object` | auto-number `CAFC` / `RCAF` / `CAFT` |
| `CAF Compliance` menu | `sys_app_application` | 5 modules — see [Navigation](#navigation) |
| 6 system properties | `sys_properties` | prefix `x_gskn2_caf_compli.sf.` |
| `CAFSalesforceSync` | `sys_script_include` | api name `x_gskn2_caf_compli.CAFSalesforceSync` |
| `caf_short_desc` | `sys_script_include` | client callable, package private |
| `CAF - Push Request to Salesforce` | `sys_script` | async, insert + update, order 1000 |
| `CAF - Push Task to Salesforce` | `sys_script` | async, insert + update, order 1000 |
| `CAF - Push Control to Salesforce` | `sys_script` | async, insert + update, order 1000 |
| `CAF - Retire Control in Salesforce` | `sys_script` | after delete, order 1000 |
| `CAF Integration` | `sys_ws_definition` | base `/api/x_gskn2_caf_compli/caf` |
| Update Task / Sync Snapshot / Resync Record | `sys_ws_operation` | PATCH, GET, POST — see below |
| Upload Evidence / List Evidence / Attest Task | `sys_ws_operation` | POST, GET, POST — see below |

All four push rules carry the echo-loop guard in their **Condition** field.

**`CAF - Push Task to Salesforce` has no source file in this repo.** The other
three push rules do. It is documented here and at line 809 of the technical
design document, and `CAFSalesforceSync.pushTask` exists, but the rule body
itself was reconstructed from `CAF - Push Request to Salesforce`, which it
mirrors exactly apart from the method it calls. Worth reading before relying on
it.

### Navigation

Application menu **CAF Compliance**, visible to `itil`, `caf_admin`,
`caf_read_only_all`, the three tier-owner roles and `caf_engineer`.

| Order | Module | Table | Roles |
|---|---|---|---|
| 10 | CAF Requests | `caf_req` | — |
| 20 | CAF Tasks | `caf_tsk` | — |
| 30 | CAF Controls Relationship | `caf_relationship` | `caf_admin` |
| 35 | CAF Controls | `caf_conformance_type` | `caf_admin` |
| 40 | Critical Business Applications | `cmdb_ci_business_app` | — |

**A table with no module cannot be reached in the UI at all** — it does not
appear in the navigator, and there is no other route to it. The tables existed
for some hours on dev249570 with no menu and read as simply absent. This is the
same blind spot recorded below for Salesforce, where an object created over the
Metadata API gets no tab and never appears in the App Launcher; it costs the
same thing on both platforms and fails the same silent way.

The technical design document lists two further modules, **Portal ➚** (`/caf`)
and a **Performance Analytics dashboard**. Neither target exists on dev249570 —
there is no `sp_portal` record with suffix `caf` — so both were left out rather
than deployed as dead links. They belong with the missing engine.

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

| Name | Type | Value on dev249570 |
|---|---|---|
| `x_gskn2_caf_compli.sf.enabled` | boolean | **`false`** — see below |
| `x_gskn2_caf_compli.sf.instance_url` | string | `https://orgfarm-4938c7f768-dev-ed.develop.my.salesforce.com` |
| `x_gskn2_caf_compli.sf.client_id` | string | **empty** — connected app Consumer Key |
| `x_gskn2_caf_compli.sf.client_secret` | password2 | **empty** — encrypts at rest (`{{gpaes}}…`) once set |
| `x_gskn2_caf_compli.sf.api_version` | string | `v67.0` |
| `x_gskn2_caf_compli.sf.integration_user` | string | `sf.integration` |

**Outbound push is off, and cannot be turned on as things stand.** The connected
app's Consumer Key and Secret did not survive the move — see
[Known gaps](#known-gaps), where the secret is recorded as having only ever
existed in a session transcript. Until both are filled in, enabling `sf.enabled`
would buy nothing but a log full of auth failures, so it ships `false`.

To bring outbound back up: set `client_id` and `client_secret` from the
Salesforce connected app, set `sf.enabled` to `true`, then
`POST /resync/request/{sys_id}` and expect `200` where it currently gives `502`.

**`sf.enabled` is the kill switch.** Set it to `false` and every push stops
immediately — no code change, no deactivating rules under pressure. It is the
first thing to reach for if anything misbehaves mid-demo.

Everything **inbound** — the six resources under
`/api/x_gskn2_caf_compli/caf` — is unaffected by this and works today.

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

### On dev249570, 2026-09-04 — inbound

All six resources exercised as `sf.integration` against a freshly seeded task,
one case per row of the result tables below; all 17 matched. Re-runnable with
[deploy/verify_api.sh](deploy/verify_api.sh).

```
[SF->CAF] CAFT0001001 updated by sf.integration: {"comments":"Set from the Salesforce side."}
[SF->CAF] CAFT0001001 updated by sf.integration: {"state":"2"}
[SF->CAF] evidence attached to CAFT0001001: encryption-config.txt (30 bytes) by sf.integration
[SF->CAF] CAFT0001001 attested approved (met_criteria=yes) by sf.integration;
          task state 2, RCAF0001001 status in_compliance
```

Two things to read off that. **No `[CAF->SF]` line appears anywhere against it** —
every one of those writes was made by `sf.integration` and none produced an
outbound push, which is the echo-loop guard working. And the attested task
finished at `state 2`, still active, because the rule that closes it is part of
the [missing engine](#what-is-missing).

Outbound could not be verified: `sf.enabled` is `false` and the connected-app
credentials are gone. `POST /resync/request/{id}` correctly returns **502**
`Sync disabled`, which is the "a failed push must surface" contract holding.

### On dev281754, 2026-08-06 — outbound

Kept as the record of outbound working when it had credentials. The instance
itself is gone.

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

**A background script can do it, though**, which is how dev249570 was set up
without touching the UI — the trap is `setValue`, not scripting as such:

```javascript
var u = new GlideRecord('sys_user');
u.get(sysId);
u.setDisplayValue('user_password', pwd);   // setValue stores it raw; this hashes it
u.update();
```

`setDisplayValue` routes through the password hasher; `setValue` is what writes
the plaintext. Verified by authenticating as `sf.integration` over basic auth
immediately afterwards. See
[deploy/06_properties_and_user.js](deploy/06_properties_and_user.js), which
takes the password from a temporary system property so it never sits in the
script file.

## What is missing

The rebuild on dev249570 restored the data model and the integration layer.
**It did not restore the compliance engine**, because no source for it survives
anywhere in this repo — the technical design document describes these as
one-line summaries, which is a specification, not an implementation:

| | Count | Consequence |
|---|---|---|
| Business rules on the CAF tables | 24 | Nothing derives state. A request does not close when its tasks close; `active` is not managed; `next_due_date` is never calculated |
| Flows | 2 | `CAF - Create CAF Tasks` and `CAF - Close Request When All Tasks Close` — tasks are not generated from templates, requests do not close |
| Client scripts / UI policies | 7 / 6 | Forms do not auto-populate from the business application, and read-only-by-state is not enforced in the UI |
| ACLs | 48+ | **Table-level access only.** The tier-owner and own-records-only model documented in §Security is not enforced |
| Notifications / events / scheduled jobs | 8 / 2 / 2 | No email, and no recurring request generation |
| Service Portal + PA dashboard | — | The two navigation modules that point at them were left out |

The most visible symptom: `POST /attest` sets `approval` and returns 200, and
the task then stays `state=2, active=true`. That is correct behaviour for the
endpoint — "setting `approval` is the whole act" — but the rule that acts on it,
`CAF - success criteria not met`, does not exist here, so nothing closes.

Recovering this needs either an update set from an instance that still has the
app, or a rebuild from §Business Logic of the technical design document.

## Known gaps

- **Requests are outbound-only.** There is no inbound resource for `caf_req`,
  deliberately — request state is derived from its tasks by the existing flows.
- **No Apex test coverage** on any of the classes that call these resources.
- **Secrets.** The Salesforce client secret did **not** survive the move to
  dev249570 — it only ever existed in a session transcript, so outbound push is
  off until someone re-reads it from the connected app. The `sf.integration`
  password was regenerated during the rebuild and lives outside the repo; the
  old `C:\Users\patel\.caf-jwt\` path belongs to the retired instance and is
  gone. Rotate both if the org outlives the demo.
- **No ACLs**, per the table above. Anyone with a CAF role sees every record.
  Fine for a POC, wrong for anything else.
