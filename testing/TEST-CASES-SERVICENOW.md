# CAF Compliance — Test Cases: ServiceNow

**Scope.** The ServiceNow side alone — the compliance engine and its native UI.
Everything here is executable with Salesforce switched off entirely
(`x_gskn2_caf_compli.sf.enabled = false`), and **should be**, so that a failure
here is unambiguously an engine failure.

Cases that cross the seam into Salesforce live in
[TEST-CASES-INTEGRATION.md](TEST-CASES-INTEGRATION.md).

| | |
|---|---|
| Application | CAF Compliance, scope `x_gskn2_caf_compli`, v1.0.0 |
| Instance | `dev249570.service-now.com` (dev281754 until 2026-09-04) |
| Baseline captured | 2026-08-07, direct from dev281754 metadata — not yet re-captured on dev249570 |
| Cases | 68 |

---

## How to read a case

| Field | Meaning |
|---|---|
| **Priority** | P1 blocks a release, P2 matters, P3 is polish |
| **Type** | Positive / Negative / Boundary / Regression |
| **Component** | The exact instance artefact under test, so a failure names a thing to fix |
| **Evidence** | *Provisional* — `UI+record`, `record-only`, or `UI-only`. See "Evidence policy" |
| **Verify** | The assertion against the record, independent of what the screen claimed |

**Evidence policy.** Every case that asserts a state transition carries **two**
proofs: what the screen showed, and what the record holds. A green toast proves
the form submitted, not that the business rule ran. The `Verify` line is the one
that decides pass or fail; the screenshot is what goes to the client.

The `UI` half of the `Evidence` tag is provisional — how much of the native UI
Playwright drives is still an open decision. Cases are written so that dropping
to `record-only` costs nothing but the screenshots.

**Reading the Verify lines.** All use the project's standard invocation:

```powershell
& "C:\Users\patel\...\cnit.ps1" get <table> -ProfileName caf-dev249570 -Query "<encoded>" -Fields <fields> -ExcludeRefLinks
```

Abbreviated below to `cnit get …`. `-ProfileName caf-dev249570` is never optional —
omitting it silently queries a different PDI.

---

## Test data — read before executing anything

**This app automates on write, and `cnit` has no delete verb.** Inserting a CAF
Request fires a flow that creates tasks; closing a task cascades into request
closure, business-application compliance status, and email. A test run leaves
permanent residue.

Rules for this suite:

1. **Dedicated subject.** Use one business application reserved for testing.
   `Zscalar App`, `SAP HANA` and `SAP Fiori` are demo-critical — do not use them
   as test subjects for destructive cases.
2. **Naming.** Any record created by hand carries `TEST-` in its description.
3. **Cancellation, not deletion**, is the exit route. `state=-1` deactivates a
   request and cascades to its tasks (TC-SN-018). Records still accumulate.
4. **One-shot cases** are flagged **⚠ ONE-SHOT** — they consume a record that
   cannot be reset (a closed task cannot reopen; `next_due_date` is computed once
   on close). Budget a fresh record for each re-run.
5. **Notification suppression.** Before a bulk run, confirm the instance email
   sending state, or eight active notifications will fire at real inboxes.

### Live anchors as at 2026-08-07

Useful starting states already present in the instance:

| Record | State | Why it is useful |
|---|---|---|
| `CAFT0001001` | Open, no evidence, on `RCAF0001022` | Clean start for a full task journey |
| `CAFT0001046` | In Progress | The drift-demo task; do not close it |
| `CAFT0001024`, `CAFT0001048` | In Progress | Spare In-Progress tasks |
| `CAFT0001026` | In Progress, `met_criteria=yes`, `approval=requested` | Proves the two fields move independently |
| `RCAF0001001` | No business app, no control | The permanent orphan — TC-SN-066 |
| `RCAF0001021` | Closed, `next_due_date` populated | A completed recurrence cycle to inspect |

Counts at baseline: **19 CAF Requests, 30 CAF Tasks** — verified through the UI
session on 2026-08-07. (HANDOFF §3 records 28 tasks; two more have since been
spawned by task closure. Confirm the count before a run rather than trusting
either number — TC-SN-068.)

### Two applications are named "SAP HANA"

`cmdb_ci_business_app` holds two records with that name:

| sys_id | `u_caf_compliance_status` | Requests |
|---|---|---|
| `6e816834…398` | `compliant` | 6 — this is the demo subject |
| `5470cc85…372` | `not_ini` | none |

**Filtering by name is therefore ambiguous.** Every case that touches SAP HANA
must select by `sys_id`, and a tester who filters the list by name will see two
rows and reasonably think one of them is a defect. It is data hygiene, not code
— but it belongs in the run notes.

---

## Baseline: what the instance actually contains

Captured 2026-08-07. **This differs from the design document**, which is a
2026-06-18 snapshot. Discrepancies are themselves test cases (TC-SN-060 to 065).

| Artefact | Design doc | Instance | Note |
|---|---|---|---|
| Business rules in scope | 24 | **26** | Four rules the doc does not list |
| Scheduled jobs | 2 | **3** | One inactive POC job |
| Notifications | 8 | 8 | ✔ |
| Client scripts | 7 (2 inactive) | 7 (2 inactive) | ✔ |
| UI policies | 6 | 6 | ✔ |
| Roles | 6 | 6 | ✔ |
| UI actions | 2 | 2 (1 inactive) | Inactive one points at a non-existent table |

### Field facts that drive the cases

`caf_req` — mandatory: `assigned_to`, `caf_conformance_type`,
`planned_start_date`, `planned_completion_date`.
**Dictionary read-only**: `state`, `caf_status`, `next_due_date`,
`short_description`.

`caf_tsk` — mandatory: `description`.
**Dictionary read-only**: `approval`, `planned_start_date`,
`planned_completion_date`, `short_description`. **`state` is *not* read-only** —
asymmetric with `caf_req`, and TC-SN-055 exists because of it.

Choice values, confirmed:

| Field | Values |
|---|---|
| `caf_req.state`, `caf_tsk.state` | `1` Open · `2` Work in Progress · `3` Closed Complete · `-1` Cancelled |
| `caf_req.caf_status` | `approaching_due` (default) · `in_compliance` · `out_of_compliance` · `archer_exception_approved` |
| `caf_tsk.approval` | `requested` (default) · `approved` · `rejected` · `cancelled` |
| `caf_tsk.met_criteria` | `yes` · `no` |
| `caf_req.priority` | `1` Critical · `2` High · `3` Moderate · `4` Low |

---

# Suite 1 — Data model and field integrity

### TC-SN-001 — `caf_conformance_type` on a request references a *relationship*, not a control

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Regression |
| **Component** | `sys_dictionary` — `caf_req.caf_conformance_type` |
| **Evidence** | record-only |

The field is labelled **"CAF control name"** and named after the control table,
but its `reference` is `x_gskn2_caf_compli_caf_relationship`. Anyone reading the
label — or the design document's ERD — writes the wrong query and gets zero rows
that look like a data problem.

**Steps**
1. Read the dictionary entry for `caf_req.caf_conformance_type`.
2. Take any request's `caf_conformance_type` value and look it up in
   `x_gskn2_caf_compli_caf_conformance_type`.
3. Look the same value up in `x_gskn2_caf_compli_caf_relationship`.

**Expected**
- `reference` = `x_gskn2_caf_compli_caf_relationship`.
- Step 2 returns **no rows**.
- Step 3 returns exactly one row, whose own `caf_conformance_type` is the real control.

**Verify** — `cnit get sys_dictionary -Query "name=x_gskn2_caf_compli_caf_req^element=caf_conformance_type"` → `reference=x_gskn2_caf_compli_caf_relationship`

**Defect if** the design document's data model is presented to a client as-is.
Raise as documentation, not code — renaming the field would break the flow.

---

### TC-SN-002 — Mandatory fields on CAF Request are enforced on insert

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | `caf_req` dictionary |
| **Evidence** | UI+record |

**Steps** — In the native form, submit a new CAF Request with each of
`assigned_to`, `caf_conformance_type`, `planned_start_date`,
`planned_completion_date` blank in turn.

**Expected** — Submission blocked, the blank field flagged, no record created.

**Verify** — `cnit get x_gskn2_caf_compli_caf_req -Query "ORDERBYDESCsys_created_on" -Limit 1` → number unchanged from before the attempt.

---

### TC-SN-003 — `description` is mandatory on CAF Task

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `caf_tsk.description` |
| **Evidence** | UI+record |

**Expected** — Insert blocked with `description` empty. Note this is the *only*
mandatory field on the task; `assigned_to` is not, so an unassigned task is legal.

---

### TC-SN-004 — Dictionary read-only fields are silently dropped by the Table API

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative / Regression |
| **Component** | Table API vs `sys_dictionary.read_only` |
| **Evidence** | record-only |

The highest-value negative test in this suite. A `PUT` setting a read-only field
returns **HTTP 200 with the pre-write values echoed back** and `sys_updated_on`
unmoved. No error is raised anywhere. Any integration written against the
apparent success is silently broken.

**Steps**
1. Note `sys_updated_on` and `short_description` on a test request.
2. `PUT` a new `short_description` over the Table API.
3. Re-read the record.

**Expected**
- HTTP 200.
- `short_description` **unchanged**.
- `sys_updated_on` **unchanged**.

**Verify** — Compare `sys_updated_on` before and after; equality is the pass condition.

**Applies to** `caf_req.state`, `caf_req.caf_status`, `caf_req.next_due_date`,
`caf_req.short_description`, `caf_tsk.approval`, `caf_tsk.short_description`,
`caf_tsk.planned_start_date`, `caf_tsk.planned_completion_date`. Run once per
field or accept a sampled subset.

---

### TC-SN-005 — Non-ASCII in a Table API JSON body is rejected with an unhelpful 400

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative / Regression |
| **Component** | Table API request parsing |
| **Evidence** | record-only |

**Steps** — `PUT` a body whose `description` contains an em dash (U+2014).

**Expected** — `HTTP 400 — Exception while reading request`. The body is valid
JSON; the error names no field. Escaping to `\u2014` succeeds.

**Why it is a test case** — it will recur every time someone pastes prose into a
payload, and the error message gives no clue.

---

### TC-SN-006 — `state` is read-only on the request but writable on the task

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | `caf_req.state` / `caf_tsk.state` |
| **Evidence** | record-only |

**Expected** — `caf_req.state.read_only = true`; `caf_tsk.state.read_only = false`.
A request's state moves only through business rules and flows; a task's state
can be set directly. Confirms the engine's intended direction of control.

**Observed 2026-08-07, and it does not match.** On the `caf_tsk` form for
`CAFT0001001` (an **Open** task), `g_form.isReadOnly('state')` returns **`true`**
even though the dictionary says `read_only=false`. Something on the form — most
likely the client script `CAF Task On Load Logic` — is locking it.

Two things follow, and both matter:

1. **`state` is writable by the API but not on the form.** Any case that expects
   to change a task's state through the native UI needs re-checking, TC-SN-026
   included.
2. If a user cannot start a task from the form, then **starting a task is only
   possible from Salesforce or the portal**, which is a workflow claim nobody has
   stated. Establish whether that is deliberate before writing it up as a defect.

This is exactly the UI-versus-record gap the two-proof evidence policy exists to
surface, and it was found by the automation spike rather than by executing a case.

---

### TC-SN-007 — Boolean fields read as `'1'`/`'0'` inside a GlideRecord

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | Server-side scripting convention |
| **Evidence** | record-only |

`gr.getValue('active')` returns `'1'` or `'0'`; the Table API's JSON renders the
same field as `"true"`. A guard written from what `cnit get` displays is wrong
inside a business rule — this already cost a live defect in the attest endpoint,
where `getValue('active') !== 'true'` was true for every task and refused every
attestation.

**Expected** — Background script confirms `'1'`, and no scoped script in the app
compares `getValue()` on a boolean to `'true'`.

---

### TC-SN-008 — Choice values match the documented set exactly

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `sys_choice` |
| **Evidence** | record-only |

**Expected** — The choice tables for `caf_req.state`, `caf_req.caf_status`,
`caf_req.priority`, `caf_tsk.state`, `caf_tsk.approval`, `caf_tsk.met_criteria`
match the baseline table above, with no `inactive=true` rows.

---

# Suite 2 — CAF Request lifecycle

### TC-SN-009 — New request defaults to Open / Approaching Due

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Dictionary defaults |
| **Evidence** | UI+record |

**Expected** — `state=1`, `caf_status=approaching_due`, `active=true`,
`number` auto-generated as `RCAF…`.

**Verify** — `cnit get x_gskn2_caf_compli_caf_req -Query "number=<new>" -Fields state,caf_status,active`

---

### TC-SN-010 — Short description is auto-composed on control selection

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Client script `CAF Request - Process name` → `caf_short_desc` GlideAjax |
| **Evidence** | UI+record |
| **⚠** | UI-driven — the field is dictionary read-only, so it can only be set this way |

**Steps** — On a new request form, set `business_application`, then
`caf_conformance_type`.

**Expected** — `short_description` populates as
*business application name + DRP/planned date + control type name*, without a
form reload.

**Note** — Because `short_description` is read-only to the Table API (TC-SN-004),
this behaviour is **unreachable via API** and must be tested through the form.
One of the few genuinely UI-only cases.

---

### TC-SN-011 — Owner fields auto-populate from the business application

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Client script `CAF - pop details based on busines app` (onChange, `business_application`) |
| **Evidence** | UI+record |

**Expected** — `managed_by`, `process_control_owner` and `assigned_to` populate
from the selected business application.

**Boundary** — Select a business application with those fields empty; expect the
request fields to stay empty and `assigned_to` mandatory-flag to block submission.

---

### TC-SN-012 — Submission is blocked when the control is not populated

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | BR `CAF - prevent submit if CAF type not pop` (before insert, order 100, filter `caf_conformance_typeISEMPTY`) |
| **Evidence** | UI+record |

**Expected** — Insert aborted with an error. No request created, and therefore
no tasks created by the flow.

**Note** — This rule is **not in the design document**. See TC-SN-060.

---

### TC-SN-013 — Request moves to Work in Progress when its first task starts

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - set Actual Start date on REQ` (after update on `caf_tsk`, filter `stateCHANGESTO2`) |
| **Evidence** | UI+record |

**Steps** — Move any Open task on an Open request to In Progress.

**Expected** — Parent request `state` → `2`, `actual_start_date` populated.

**Verify** — `cnit get x_gskn2_caf_compli_caf_req -Query "number=<req>" -Fields state,actual_start_date`

---

### TC-SN-014 — Closing a request sets actual end date and computes next due date

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Request Actual End and Next due` (before update, order 1800, filter `stateCHANGESTO3`) |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** — `next_due_date` computes once |

**Expected** — `actual_completion_date` set to now; `next_due_date` computed from
the relationship's frequency. For a `frequency=365` relationship, expect
`next_due_date ≈ close date + 1 year`.

**Verify** — `cnit get x_gskn2_caf_compli_caf_req -Query "number=<req>" -Fields state,actual_completion_date,next_due_date` — then compute the interval by hand and assert it against the relationship's `frequency`.

**Reference record** — `RCAF0001021`, closed, `next_due_date=2026-01-09 14:41:21`.

---

### TC-SN-015 — Active flag clears on close

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Manage Active Flag` (before update, order 2600, filter `stateCHANGESTO3^ORstateCHANGESTO-1`) |
| **Evidence** | record-only |

**Expected** — `state=3` → `active=false`. Same for `state=-1`.

---

### TC-SN-016 — Business application flips to Out of Compliance

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - update BA on out of compliance` (after update, order 1500, filter `caf_statusCHANGESTOout_of_compliance`) |
| **Evidence** | UI+record |

**Expected** — `cmdb_ci_business_app.u_caf_compliance_status` → `out_of_compliance`,
and notification *CAF Compliance Status* fires (TC-SN-047).

---

### TC-SN-017 — Business application flips to Compliant

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - update BA when req compliant` (after update, order 1500, filter `caf_statusCHANGESTOin_compliance^ORcaf_statusCHANGESTOarcher_exception_approved`) |
| **Evidence** | UI+record |

**Critical sub-case** — the business application must go compliant **only when
every** control is compliant. Set one request to `in_compliance` while a sibling
request on the same application is `out_of_compliance`; the application must
**not** read compliant.

### 🔴 CONFIRMED DEFECT — observed 2026-08-07, no test execution required

The instance already fails this, on two of the three demo applications:

| Business application | `u_caf_compliance_status` | Its 6 requests |
|---|---|---|
| SAP Fiori (`7661e434…360`) | **`compliant`** | 4 × `out_of_compliance`, 2 × `in_compliance` |
| SAP HANA (`6e816834…398`) | **`compliant`** | 4 × `out_of_compliance`, 2 × `in_compliance` |
| Zscalar App (`41b1e834…366`) | `compliant` | 6 × `in_compliance` ✔ |

The rule's filter is `caf_statusCHANGESTOin_compliance`, which fires whenever
**any** request goes compliant. It appears to set the application compliant
without checking whether its siblings still are not.

**Consequence.** The `/caf` portal grid renders `u_caf_compliance_status`
faithfully, so it shows *SAP HANA — Compliant* beside four red control dots. The
grid is not lying; the field it reads is wrong. An executive looking at the
dashboard sees two critical applications as compliant when eight controls
between them are not — which is the exact failure a compliance product exists to
prevent.

**This also falsifies a claim in HANDOFF §3** — *"An app is compliant only when
every control is, matching the ServiceNow widget"* — and the Salesforce LWC is
documented as deliberately mirroring that behaviour, so the same wrong answer is
very likely on both platforms. Cross-reference TC-INT-050.

**Reproduce** — no setup needed; read the two records as they stand. To prove
causation, take a fourth application, set one of several requests to
`in_compliance`, and watch the application flip.

**Note** — This rule is **not in the design document**. See TC-SN-068.

---

### TC-SN-018 — Cancelling a request cancels all its tasks

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Request cancelled process` (after update, order 500, filter `stateCHANGESTO-1`) → `CAFUtil.cancelTasksOfRequest()` |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Expected** — Every child task `state=-1`, `active=false`, `approval=cancelled`.
Request `active=false`.

**Verify** — `cnit get x_gskn2_caf_compli_caf_tsk -Query "caf_request=<sysid>" -Fields number,state,active,approval` → every row cancelled, none missed.

**Boundary** — A request with an already-closed task: the closed task must stay
`state=3`, not be dragged to `-1`.

---

### TC-SN-019 — Creating a request moves a compliant application to Undergoing Update

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `HLN - set BA to pending update if compli` (after insert, order 300) |
| **Evidence** | record-only |

**Expected** — If the application's status is `compliant` or
`compliant_approved_exc`, inserting a request changes it to `undergoing_update`.
If the status is anything else (`not_ini`, `out_of_compliance`), it is untouched.

**Test subject** — `Zscalar App` is the only `compliant` application at baseline.
Use a copy, not `Zscalar App` itself; it is demo-critical.

---

### TC-SN-020 — Archer exception closes a request as an approved exception

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `CAF - Archer Exception` (before update, order 1600, filter `stateCHANGESTO3^archer_exception_approved=true`) |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Steps** — Set `archer_exception_approved=true`, enter an
`archer_finding_number` (`FND-XXXX` format), close the request.

**Expected** — `caf_status` → `archer_exception_approved` ("Archer Finding
Raised"), and the business application follows via TC-SN-017's rule, which
includes that status in its filter.

**Note** — This rule is **not in the design document**. See TC-SN-060.

---

### TC-SN-021 — Archer fields appear only when the exception flag is set

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | UI Policy `Archer field` (`archer_exception_approved=true`) |
| **Evidence** | UI-only |

**Expected** — `archer_finding_number` hidden when the flag is false, shown when
true, and hidden again when the flag is cleared without a reload.

---

### TC-SN-022 — Archer display propagates to child tasks

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | UI Policy `Archer logic` on `caf_tsk` (`caf_request.archer_exception_approved=true`) |
| **Evidence** | UI-only |

**Expected** — Task form reflects the parent request's Archer flag. A dot-walked
UI policy condition — worth confirming it evaluates at all, as these frequently
do not.

---

### TC-SN-023 — Request read-only behaviour by state and role

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Client script `CAF Request On Load` |
| **Evidence** | UI-only |

**Expected** — Fields become read-only according to state and the current user's
role. Run once per role in Suite 8 rather than repeating the case.

---

### TC-SN-024 — Priority is free-form and unvalidated

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Boundary |
| **Component** | `caf_req.priority` (integer with choices 1–4) |
| **Evidence** | record-only |

**Expected, unresolved** — Writing `priority=9` over the Table API. No rule
validates it. Document the actual behaviour; if it stores, that is a low finding
worth raising rather than a failure.

---

# Suite 3 — CAF Task lifecycle

### TC-SN-025 — Task inherits the business application from its parent

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `set business app` (before insert, order 10) |
| **Evidence** | record-only |

**Expected** — A task inserted with `business_application` empty is populated
from `caf_request.business_application` before it lands.

**Boundary** — Insert a task against `RCAF0001001`, which **has no business
application**. Expect the field to stay empty and no script error. This is the
orphan case the dashboard filters out — see TC-SN-066.

---

### TC-SN-026 — A task cannot jump from Open straight to Closed

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | BR `CAF - Task - prevent state change` (before update, order 100, filter `stateCHANGESFROM1`) |
| **Evidence** | UI+record |

**Steps** — On an Open task, set `state=3` and save.

**Expected** — Update aborted, task remains `state=1`, `active=true`.

**Verify** — `cnit get x_gskn2_caf_compli_caf_tsk -Query "number=<task>" -Fields state,active` → `state=1`

**Sub-case** — `1 → -1` (cancel). The filter is `stateCHANGESFROM1`, i.e. **any**
change out of Open, so confirm whether cancelling an Open task is also blocked.
If it is, cancelling a request containing Open tasks (TC-SN-018) may partially
fail — a genuine interaction worth chasing.

---

### TC-SN-027 — Actual start date sets itself when a task starts

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `CAF - set Actual Start date on task` (before update, order 2400, filter `stateCHANGESTO2^actual_start_dateISEMPTY`) |
| **Evidence** | record-only |

**Expected** — `actual_start_date` = now on the first move to In Progress.

**Boundary** — The filter includes `actual_start_date` **is empty**, so a task
returned to In Progress a second time must **keep its original** start date.
Test that explicitly; it is the only thing the guard does.

---

### TC-SN-028 — Actual completion date sets itself on close

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `CAF - set Actual End date on task` (before update, order 2400, filter `stateCHANGESTO3`) |
| **Evidence** | record-only |
| **⚠** | **ONE-SHOT** |

**Note** — Shares order 2400 with TC-SN-027's rule. Ordering between them is
undefined; both filters are mutually exclusive so it does not matter today, but
record it as a fragility.

---

### TC-SN-029 — Active flag clears on task close and cancel

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Manage Active Flag Task` (before update, order 2600, filter `stateCHANGESTO3^ORstateCHANGESTO-1`) |
| **Evidence** | record-only |

**Expected** — `state=3` → `active=false`. `state=-1` → `active=false` **and**
`approval=cancelled`.

---

### TC-SN-030 — Approval approved closes the task and marks the request compliant

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - success criteria not met` (before update, order 2100, filter `approvalVALCHANGES^active=true`) |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**The single most important case in this file.** This rule *is* the attestation
transition — the Salesforce attest endpoint deliberately writes three fields and
lets this rule do everything else. If it misbehaves, both platforms misbehave.

**Precondition** — A task in `state=2`, `active=true`, `approval=requested`.

**Steps** — Set `approval=approved`.

**Expected**
- Task → `state=3`, `active=false`.
- Parent request → `caf_status=in_compliance`.

**Verify** — `cnit get x_gskn2_caf_compli_caf_tsk -Query "number=<task>" -Fields state,active,approval,met_criteria` and `cnit get x_gskn2_caf_compli_caf_req -Query "number=<req>" -Fields state,caf_status,active`

**Critical assertion** — the **request does not close**. Expect `state=2`,
`active=true`. See TC-SN-035.

---

### TC-SN-031 — Approval rejected closes the task and marks the request out of compliance

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Same rule, `rejected` branch |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Expected** — Task closed; parent request `caf_status=out_of_compliance`; the
business application follows via TC-SN-016.

**Note the asymmetry** — rejection still **closes** the task. There is no
remediation loop; a rejected control does not reopen for another attempt. Worth
confirming with the business that this is intended, not a defect.

---

### TC-SN-032 — The approval rule does not fire on an inactive task

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | Same rule, `active=true` clause of the filter |
| **Evidence** | record-only |

**Expected** — Changing `approval` on an already-closed task changes nothing
else. No second transition, no request status move.

---

### TC-SN-033 — `met_criteria` and `approval` move independently

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | `caf_tsk.met_criteria`, `caf_tsk.approval` |
| **Evidence** | record-only |

Baseline proves both directions already exist: `CAFT0001026` has
`met_criteria=yes` with `approval=requested`; `CAFT0001027` has
`approval=approved` with `met_criteria` **empty**.

**Expected** — Setting `met_criteria` alone triggers no transition. A task can
close approved with no `met_criteria` recorded at all.

**Finding to raise** — an approved attestation with a blank `met_criteria` is a
weak audit trail. It is reachable through the native UI even though the
Salesforce attestation form always writes both.

---

### TC-SN-034 — Task closure is blocked while the parent control's request is active

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | BR `CAF - Parent CAF control clos validation` (before update, order 110, filter `stateCHANGESTO3`) |
| **Evidence** | UI+record |

**Expected** — Closure aborted with a message naming the blocking parent.

**Note** — Order 110 places this **before** the approval rule at 2100, so it
gates the attestation path too. Confirm that a Salesforce attestation against a
task in this condition surfaces the abort rather than reporting success —
cross-reference INT-ATT in the integration file.

---

### TC-SN-035 — Closing a task spawns the next task in the template chain

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Flow `CAF - Close Request When All Tasks Close` |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**This contradicts the flow's own name** and a reasonable reading of the design
document. Measured behaviour on `RCAF0001022`:

```
attest approved  →  CAFT0001022 Closed Complete, active=false
                 →  RCAF0001022 caf_status = in_compliance
                 →  flow creates CAFT0001001 "IT Application Owner Attestation", Open
                 →  RCAF0001022 itself stays state=2, active=true
```

**Expected** — Closing the *"Attach evidence"* task creates an
*"IT Application Owner Attestation"* task. The request closes only when that
second task is also closed.

**Verify** — Task count for the request before and after:
`cnit get x_gskn2_caf_compli_caf_tsk -Query "caf_request=<sysid>" -Fields number,short_description,state` → one additional row.

---

### TC-SN-036 — The request closes when the last task in the chain closes

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Flow `CAF - Close Request When All Tasks Close` |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Expected** — With zero active tasks remaining and no further template in the
chain, request → `state=3`, `active=false`, and TC-SN-014's rule fires to compute
`next_due_date`.

**Reference** — `RCAF0001031`–`RCAF0001036` are all in this end state, each with
a closed *"Attach evidence"* and a closed *"IT Application Owner Attestation"*.

---

### TC-SN-037 — Cancelling a task cancels its approval records

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | BR `CAF - cancel approvals` (after update, order 500, filter `stateCHANGESTO-1`) |
| **Evidence** | record-only |

**Expected, and expected to be vacuous** — `sysapproval_approver` holds **no CAF
records at all** on this instance, so this rule has nothing to act on. Assert the
rule runs without error, and record that its effect is untestable until approval
routing exists (HANDOFF open item 2).

---

### TC-SN-038 — `met_criteria` becomes mandatory when closing a task with success criteria

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | UI Policy `CAF - Task - met criteria mandatory` (`state=3^success_criteriaISNOTEMPTY`) |
| **Evidence** | UI-only |

**Expected** — With `success_criteria` populated, setting `state=3` on the form
makes `met_criteria` mandatory and blocks save until answered.

**Important** — This is a **UI policy, not a business rule**. It does not bind
the Table API or the Salesforce endpoint. TC-SN-033 is the proof; note the gap
rather than treating it as a bug.

---

### TC-SN-039 — Success criteria field is hidden when empty

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | UI Policy `CAF - success criteria visiblity` |
| **Evidence** | UI-only |

---

### TC-SN-040 — A closed task's form is entirely read-only

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | UI Policy `CAF - things to do on closed complete` (`state=3`) |
| **Evidence** | UI-only |

**Expected** — Every field read-only. Cross-check against TC-SN-032: the API can
still write to a closed task even though the form cannot.

---

### TC-SN-041 — Task on-load field visibility and the hidden Cancelled state

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | Client script `CAF Task On Load Logic` |
| **Evidence** | UI-only |

**Expected** — Cancelled is removed from the state choice list on the form, and
field visibility follows state. Confirm Cancelled is still reachable by other
routes (TC-SN-018) — hiding a choice is not removing a state.

---

### TC-SN-042 — VQD link URL validation is inactive

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Regression |
| **Component** | Client script `Validate URL` (inactive) |
| **Evidence** | record-only |

**Expected** — Confirmed inactive; any string saves to `vqd_link`. There are two
such fields, `vqd_link` and `vqd_link_2`, neither validated. Documentation
finding, not a defect, unless the business expects validation.

---

# Suite 4 — Relationships and task templates

### TC-SN-043 — Duplicate relationships are rejected

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | BR `CAF - uniqness check` (before insert/update, order 50, filter `caf_conformance_typeVALCHANGES^ORcrown_jewelsVALCHANGES^ORtierVALCHANGES`) |
| **Evidence** | UI+record |

**Expected** — Inserting a second relationship with the same
control + tier + crown-jewels triple is aborted.

**Boundary** — The baseline contains **two inactive relationships**
(Tier 2 / High Availability, both crown-jewel values). Confirm whether an
inactive duplicate blocks a new active one. The filter does not mention `active`,
which suggests it does — and if so, an inactive relationship permanently blocks
its own replacement. Worth chasing.

---

### TC-SN-044 — Relative start date derives from frequency

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Client script `CAF- Pop relative start - frequency` (onChange, `frequency`) |
| **Evidence** | UI-only |

**Expected** — Selecting `365` sets `relative_start_date` to the 1-year marker
(`1971-01-01`); the baseline's one `frequency=other` row carries `1972-01-01`.

---

### TC-SN-045 — Relative start date is read-only unless frequency is Other

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | UI Policy `Relative start date based on Frequency` (`frequency!=other`) |
| **Evidence** | UI-only |

---

### TC-SN-046 — Relationship task templates drive task creation

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Flow `CAF - Create CAF Tasks`, table `caf_relationship_tasks` |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Steps** — Insert a request against a relationship with known templates.

**Expected** — One task per matching template, each carrying the template's
`short_description`, `description`, `success_criteria` and planned dates.

**Verify** — Compare the created tasks field-for-field against
`cnit get x_gskn2_caf_compli_caf_relationship_tasks -Query "caf_relationship=<sysid>"`

**Boundary** — A relationship with **no** templates. Expect a request with zero
tasks and no flow error, and confirm what the dashboard then shows.

---

# Suite 5 — Business application and compliance roll-up

### TC-SN-047 — Initiate CAF Process is offered only on an uninitiated application

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | UI Action `Initiate CAF Process` on `cmdb_ci_business_app`, condition `u_caf_compliance_status == 'not_ini'` |
| **Evidence** | UI+record |

**Expected** — Button visible when status is `not_ini`; absent for every other
status. Clicking it calls `CAFUtil.generateCAFRequests()` and creates one request
per matching relationship, each of which then fires the task-creation flow.

**Verify** — Request count for the application before and after, and each new
request's `caf_conformance_type` maps to a distinct relationship matching the
application's tier and crown-jewels values.

**Scale warning** — On a Tier 0 crown-jewel application this creates **six
requests** and their tasks in one click. Use a low-tier test application first.

---

### TC-SN-048 — Compliance status change notifies

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Notification `CAF Compliance Status` on `cmdb_ci_business_app`, condition `u_caf_compliance_statusVALCHANGES` |
| **Evidence** | UI+record |

**Expected** — Email queued, subject
`${name} CAF Compliance Status has changed to ${u_caf_compliance_status}`.

**Verify** — `cnit get sys_email -Query "subjectLIKECAF Compliance Status^ORDERBYDESCsys_created_on" -Limit 5`

---

### TC-SN-049 — Crown jewels designation notifies

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | Notification `CAF Crown Jewels`, condition `u_crown_jewels=Yes^u_crown_jewelsVALCHANGES` |
| **Evidence** | record-only |

**Boundary** — Changing crown jewels **to No** must not notify; the condition
requires the new value to be `Yes`.

---

### TC-SN-050 — Cancelling all requests for an application

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `CAFUtil.cancelActiveRequests(BusAppSysId)` |
| **Evidence** | record-only |
| **⚠** | **ONE-SHOT** |

**Expected** — Every active request for the application cancelled, each
cascading to its tasks via TC-SN-018. Already-closed requests untouched.

---

# Suite 6 — Scheduled jobs

### TC-SN-051 — Recurring request generation

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Scheduled job `CAF - Create new CAF requests`, daily 23:30 |
| **Evidence** | record-only |
| **⚠** | **ONE-SHOT** per subject record |

**Steps** — Set a closed request's `next_due_date` to today, run the job from
*Scheduled Jobs → Execute Now*.

**Expected** — A new request generated for the same application and relationship,
`state=1`, `caf_status=approaching_due`, and the task-creation flow fires.

**Boundary** — Run the job **twice** in succession. The second run must not
duplicate. This is the highest-consequence idempotency question in the engine —
a non-idempotent nightly job silently doubles the workload every night.

---

### TC-SN-052 — Overdue detection

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Scheduled job `CAF - Update CAF request status if overdue`, daily 23:00 |
| **Evidence** | record-only |

**Steps** — Set an active request's `planned_completion_date` to yesterday, run
the job.

**Expected** — `caf_status` → `out_of_compliance`, cascading to the business
application via TC-SN-016.

**Boundary set**
- `planned_completion_date` = today → must **not** flip.
- `planned_completion_date` = tomorrow → must not flip.
- An already-closed request that is overdue → must not flip.
- An already `out_of_compliance` request → no second notification.

**Note the ordering.** Overdue runs at 23:00, generation at 23:30. A request
generated tonight is evaluated for overdue **tomorrow** night, not tonight.
Confirm that is intended.

---

### TC-SN-053 — The inactive POC job stays inactive

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Regression |
| **Component** | `CAF POC - set integration password` (inactive, run_type `once`) |
| **Evidence** | record-only |

**Expected** — `active=false`. This job sets an integration password; it must
never run again. The design document does not list it — see TC-SN-060.

---

### TC-SN-054 — A job inserted over the Table API never registers a trigger

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Regression |
| **Component** | `sysauto_script` / `sys_trigger` |
| **Evidence** | record-only |

**Expected** — A `sysauto_script` created over the Table API has **no**
corresponding `sys_trigger` row and never fires. Environment-level knowledge that
protects anyone automating job creation; assert it once and record it.

---

# Suite 7 — Notifications and events

### TC-SN-055 — New request notification

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `CAF New Request Created`, event `x_gskn2_caf_compli.CAF_new_Request` |
| **Evidence** | record-only |

**Expected** — Subject `CAF Request - ${number} created for "${business_application}"`,
recipient resolved from the request.

**Boundary** — A request with **no** business application (`RCAF0001001`'s shape)
renders an empty substitution in the subject. Confirm the mail still sends and
record how it reads.

---

### TC-SN-056 — Request state change notification

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `CAF State changed`, condition `stateVALCHANGES^ORcaf_statusVALCHANGES` |
| **Evidence** | record-only |

**Volume warning** — The condition fires on **either** field. A single
attestation moves `caf_status` on the request and may move `state` too, so
confirm whether one attestation produces one mail or two.

---

### TC-SN-057 — Task state change notification has a suspicious condition

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `CAF - Task State changed`, condition `stateCHANGESFROM3` |
| **Evidence** | record-only |

`CHANGESFROM3` means **moving out of Closed Complete** — reopening a task. Given
the subject line is the generic *"State for CAF Task ${number} state has been
changed to ${state}"*, the intent was almost certainly `stateVALCHANGES`.

**Expected as configured** — No mail on `1→2` or `2→3`. Mail only on `3→`anything.

**Raise as a probable defect** if the business expects notification on ordinary
task progress. Confirm the intent before calling it either way.

---

### TC-SN-058 — Task assignment notification

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `CAF - Task ASSIGNED to changed`, condition `assigned_toVALCHANGES` |
| **Evidence** | record-only |

**Boundary** — Clearing `assigned_to` is also a value change. Confirm whether an
unassignment sends a mail addressed to nobody.

---

### TC-SN-059 — Approval records are created consistently for attestation tasks

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | `CAF - Approval Requested`; flow *CAF - Close Request When All Tasks Close* |
| **Evidence** | record-only |

**Rewritten 2026-08-07 — the original premise was false.** This case previously
asserted the notification could *never* fire, on the basis of HANDOFF §6:
*"`sysapproval_approver` holds no CAF records at all."*

**Expected** — Every *"IT Application Owner Attestation"* task the flow creates
is treated identically: either they all get a `sysapproval_approver` record with
a named approver, or none do. Whatever the rule is, it is applied uniformly.

### 🔴 CONFIRMED DEFECT — observed 2026-08-07

Approval records **do** now exist, and they are created inconsistently:

- `sysapproval_approver` holds **1** record for a CAF Task — on `CAFT0001002`,
  approver **Sabrina Deppert**, created by `system`.
- **12** attestation tasks exist. Eleven have no approval record at all.
- Three were spawned by the flow on 2026-08-07 — `CAFT0001001` (13:46:51),
  `CAFT0001002` (13:56:11), `CAFT0001003` (14:09:26). Only the middle one got an
  approver.

The creator is `system`, i.e. the **flow**, not the business rule
`CAF - Approval Task`, which remains inactive. Something in the flow creates
approvals on some passes and not others.

**Consequence** — notification *CAF - Approval Requested* fires for a minority of
attestations and stays silent for the rest, with no visible reason. An approver
is emailed sometimes and not others.

**Investigate** — establish what distinguishes `CAFT0001002`. Until that is
known, neither "approvals work" nor "approvals are not implemented" can be
stated honestly, and both have appeared in project documentation.

**Still true, and the larger issue** — attestation uses the `approval` field
alone, so for the eleven tasks without a record **there is no named approver**:
whoever presses the button is the approver, and the audit trail does not record
who. HANDOFF open item 2.

---

### TC-SN-060 — Request creation reminder

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | `CAF New Request Created -reminder`, event `x_gskn2_caf_compli.caf.req.creation.remi` |
| **Evidence** | record-only |

**Expected** — Fires on its own registered event. Establish **what fires that
event** — it is one of only two registered events and nothing obvious triggers
it. If nothing does, this is a second dead notification.

---

# Suite 8 — Security model

Row-level security was removed from the architecture at the user's instruction
(HANDOFF §7.3, POC scope). These cases therefore **characterise** the query
business rules rather than certifying them, and the suite should not be presented
as a security sign-off.

### TC-SN-061 — Request query filter restricts by ownership

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `CAF - query BR - filter records` (before query, order 100) |
| **Evidence** | UI+record |

**Steps** — Impersonate a user holding only `caf_tier_2_owner` and list CAF
Requests.

**Expected** — Only requests for that user's business applications are visible.
`caf_admin` and the tier-owner roles bypass per the rule's own logic.

---

### TC-SN-062 — Task query filter includes delegate approvers

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | BR `CAF - Task - query BR - filter records` |
| **Evidence** | UI+record |

**Expected** — Same restriction as TC-SN-061 plus visibility for delegate
approvers.

---

### TC-SN-063 — Role matrix

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | 6 roles, ~48 ACLs |
| **Evidence** | UI+record |

One case, six impersonations, one matrix. For each of `caf_admin`,
`caf_engineer`, `caf_tier_0_owner`, `caf_tier_1_owner`, `caf_tier_2_owner`,
`caf_read_only_all`, record create / read / write / delete against `caf_req`,
`caf_tsk`, `caf_relationship`, `caf_relationship_tasks`, `caf_conformance_type`.

**Expected highlights**
- `caf_read_only_all` — read everywhere, write nowhere.
- `caf_engineer` — read all, write **only** records assigned to them.
- `caf_admin` — full CRUD.

**Note** — Every ACL in the scope has `admin_overrides=true`, so testing as an
admin proves nothing. Impersonation is mandatory for this suite.

**Note** — There are **two inactive ACLs**, one write on `caf_req` and one write
on `caf_tsk`. Identify them and confirm the deactivation was deliberate; an
inactive write ACL usually widens access rather than narrowing it.

---

### TC-SN-064 — Field-level ACLs on number, active and assigned_to

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Component** | `caf_req.number`, `caf_req.active`, `caf_req.assigned_to`, and the `caf_tsk` equivalents |
| **Evidence** | UI-only |

**Expected** — `number` and `active` are not writable by a non-admin;
`assigned_to` carries its own rule.

---

# Suite 9 — Service Portal (`/caf`)

The AngularJS widget is the admin/audit view and is **not decommissioned**. It
remains the reference the Salesforce dashboard must agree with.

### TC-SN-065 — Portal grid matches the underlying records

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `/caf` Service Portal widget |
| **Evidence** | UI+record |

**URL** — `/caf?id=caf_apps`. **Not** `/caf`, which is the portal landing page:
three tiles and a KB link, no data. The *View Apps* tile that reaches the grid is
an Angular `javascript:void(0)` handler, so navigate by page id rather than
clicking through. Portal pages are `caf_home`, `caf_apps` and `caf_ticket`
(drill-in, needs a record parameter — it renders an access error without one).

**Expected** — Applications as rows, controls as columns, colour-coded status
dots. **62 rows** at baseline. Every dot matches the corresponding request's
`caf_status`.

**Verify** — Reconcile the full grid against
`cnit get x_gskn2_caf_compli_caf_req -Fields number,business_application,caf_conformance_type,caf_status`.

**Corrected baseline, 2026-08-07** — HANDOFF §3 records *"SAP HANA 6 out of
compliance, SAP Fiori 4 out / 2 compliant, Zscalar App 6 compliant"*. The
instance actually holds:

| Application | Controls |
|---|---|
| SAP HANA | 4 out of compliance, 2 compliant |
| SAP Fiori | 4 out of compliance, 2 compliant |
| Zscalar App | 6 compliant |

Both SAP applications have moved since that note was written. Use these figures,
and re-derive rather than trusting either set before a formal pass.

**This is the parity baseline** for the Salesforce dashboard. Capture it in the
same run as the integration suite's dashboard case so the two screenshots are
comparable.

---

### TC-SN-066 — An application is compliant only when every control is

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `/caf` widget roll-up logic |
| **Evidence** | UI+record |

**Expected** — One out-of-compliance control makes the whole application
non-compliant.

**🔴 Currently fails.** SAP Fiori and SAP HANA each read **Compliant** in the
Overall Conformance Status column while showing four red control dots. The grid
is rendering `cmdb_ci_business_app.u_caf_compliance_status` correctly; that field
is wrong. See the confirmed defect under TC-SN-017 — fix it there, not here.

**Why it matters** — the Salesforce LWC deliberately mirrors this. Softening it
on either side makes the two views disagree about identical data; getting it
wrong on the ServiceNow side propagates the wrong answer to both.

---

### TC-SN-067 — The orphan request never appears

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Negative |
| **Component** | `getRequests()` filter |
| **Evidence** | UI+record |

`RCAF0001001` has neither a business application nor a control, so it is filtered
out of the grid.

**Expected** — Absent from the portal, absent from the Salesforce dashboard,
present in the table. Harmless, but a tester who counts rows will find 19 records
and 18 in the grid, and should find this documented rather than raise it.

**Do not confuse** with the *task* `CAFT0001001`, a live attestation task on
`RCAF0001022`.

---

### TC-SN-069 — A new CAF control appears as a new column, with no code change

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Widget `hln-caf-apps-list` server script |
| **Evidence** | UI+record |
| **⚠** | **Part B is a WRITE and leaves a permanent column** — see below |

The dynamic-column claim, tested at its source. The grid must not carry a
hard-coded control list; adding a control to the data must add a column.

**The mechanism, confirmed from the widget source 2026-08-07:**

```js
var cafTypeGR = new GlideRecord('x_gskn2_caf_compli_caf_conformance_type');
cafTypeGR.addQuery('active', true);
cafTypeGR.orderBy('name');          // columns are alphabetical, not sequenced
...
data.cafTypesArr = cafTypesArr;     // one column per active control
```

Columns are **every active row in `caf_conformance_type`, ordered by name**. The
widget still contains the commented-out `sys_choice` query it replaced, which is
direct evidence the dynamic behaviour was a deliberate migration rather than a
happy accident.

#### Part A — the binding, read-only and safe to re-run

**Steps**
1. Read every active control from `caf_conformance_type`, ordered by name.
2. Open `/caf?id=caf_apps` and read the grid's control column headers.
3. Compare as ordered lists.

**Expected**
- The column headers equal the active control names **exactly**, in the same
  alphabetical order.
- The filter panel above the grid also carries one dropdown per control, from
  the same array.
- Baseline: **6 controls, 6 columns.**

**Verify** — `cnit get x_gskn2_caf_compli_caf_conformance_type -Query "active=true^ORDERBYname" -Fields name`

This alone establishes the binding. Part B proves causation.

#### Part B — add a control and watch the column appear ⚠

**⚠ This is a write, and `cnit` has no delete verb.** A control inserted here
becomes a permanent seventh column on the demo grid until it is deactivated in
the UI. Get explicit approval, and prefer `active=false` as the cleanup rather
than deletion.

**Steps**
1. Capture the grid — 6 columns.
2. Insert a control named **`TEST-ZZ Confirm Encryption at Rest`**, `active=true`.
3. Reload `/caf?id=caf_apps` with no deployment, no cache clear, no code change.
4. Capture the grid again.
5. Set the control `active=false` and reload.

**Expected**
- After step 3 the grid shows **7** columns, the new one among them.
- After step 5 it returns to **6**. Deactivating removes a column, which is the
  same mechanism running in reverse and worth capturing in the same pack.

**Expected cell content** — and this is the part worth reading the source for.
The new control has no requests, so `getLatestCAFstatus`,
`getCAFLastComplianceDetails` and `getCAFNextDueDetails` all return empty. The
widget then applies:

```js
if (overall_status != 'Not initiated' && all three empty) showNA = true;
```

So the new column reads **`N/A`** for every application whose CAF process has
been initiated, and **blank** for every application still `Not initiated`. Both
are correct; a tester expecting one uniform value will raise a false defect.

**Naming boundary, from the source** — results are keyed by control *name*
(`businessAppObj[ele.value] = cafDetailsObj`), not by sys_id. Two controls
sharing a name would collide into one column, and a name carrying characters the
Angular binding cannot use as a key may render an empty column. Worth one
deliberate probe given `cmdb_ci_business_app` already contains two records named
"SAP HANA".

**The `TEST-ZZ` prefix is deliberate** — alphabetical ordering puts the new
column last, so the screenshot before and after differs only by an appended
column. Name it `Confirm Encryption…` instead and it lands mid-grid, every
column shifts, and the two captures are far harder to compare.

#### Cross-platform divergence — read this before comparing dashboards

**The two grids derive their columns from different sources.** ServiceNow reads
the control table, so a control with no requests still gets a column. Salesforce
has no mirrored control object at all — the LWC derives columns from the request
data it holds, so a control with no requests produces **no column there**.

A newly added control therefore appears immediately in ServiceNow as an `N/A`
column and is **absent from Salesforce** until a request exists for it. That is
not drift and Sync Health will not report it, because no mirrored record
disagrees. See TC-INT-049.

---

# Suite 10 — Documentation accuracy

The design document is generated from instance metadata dated 2026-06-18. These
cases audit it, because a client-facing document that misdescribes the build is a
deliverable defect.

### TC-SN-068 — Design document reconciliation

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | [Technical design doc with diagram V1.md](../Technical%20design%20doc%20with%20diagram%20V1.md) |
| **Evidence** | record-only |

Confirmed discrepancies as at 2026-08-07, each to be re-checked at execution
time and raised as a documentation finding:

| # | Discrepancy |
|---|---|
| 1 | Doc says **24** business rules; the scope holds **26** |
| 2 | `CAF - prevent submit if CAF type not pop` — **active**, absent from the doc |
| 3 | `CAF - update BA when req compliant` — **active**, absent from the doc |
| 4 | `CAF - Archer Exception` — **active**, absent from the doc |
| 5 | `CAF on state change Update cmdb_Ci` — inactive, absent from the doc |
| 6 | Doc says **2** scheduled jobs; there are **3** (one inactive) |
| 7 | Doc lists BR names that differ from the instance, e.g. *"CAF - attachment mandatory"* vs `CAF - attachment mandatory for def tasks`, *"CAF - uniqueness check"* vs `CAF - uniqness check` |
| 8 | `caf_req.caf_conformance_type` is documented as the control but references `caf_relationship` (TC-SN-001) |
| 9 | UI Action `Risk Assessment` targets table `x_gskn2_caf_compli_caf_request` — **which does not exist**; the real table is `..._caf_req`. Inactive, so harmless, but it is an orphan |
| 10 | Doc describes approval routing via `sysapproval_approver`; no such records exist (TC-SN-059) |
| 11 | Notification `CAF - Task State changed` fires on `stateCHANGESFROM3`, not on ordinary progress (TC-SN-057) |
| 12 | HANDOFF §3 records 28 tasks; the instance holds **30** |

**Expected** — Each item confirmed or refuted against the instance at run time,
and the design document annotated. Item 9 is worth deleting outright.

---

## Coverage summary

| Suite | Cases | P1 |
|---|---|---|
| 1 Data model and field integrity | 8 | 2 |
| 2 CAF Request lifecycle | 16 | 7 |
| 3 CAF Task lifecycle | 18 | 7 |
| 4 Relationships and templates | 4 | 2 |
| 5 Business application roll-up | 4 | 1 |
| 6 Scheduled jobs | 4 | 2 |
| 7 Notifications and events | 6 | 0 |
| 8 Security model | 4 | 0 |
| 9 Service Portal | 3 | 2 |
| 10 Documentation accuracy | 1 | 0 |
| **Total** | **68** | **23** |

**Not covered here, deliberately**
- Anything crossing into Salesforce — [TEST-CASES-INTEGRATION.md](TEST-CASES-INTEGRATION.md).
- Performance and volume. The instance holds 19 requests; nothing here says how
  the portal behaves at 10,000.
- Row-level security certification — characterised only, per HANDOFF §7.3.
- Upgrade and clone behaviour.
