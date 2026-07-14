# CAF Compliance — Test Cases: ServiceNow + Salesforce

**Scope.** Everything that crosses the seam. The engine and system of record stay
in ServiceNow; Salesforce holds a **mirror and an engagement layer**, never a
second opinion. Most cases here are therefore of one shape: *make something
happen on one side, prove both sides agree afterwards.*

ServiceNow-only cases live in
[TEST-CASES-SERVICENOW.md](TEST-CASES-SERVICENOW.md), and should be run and
passing **first** — an engine failure surfacing here would be diagnosed as an
integration failure and cost a day.

| | |
|---|---|
| ServiceNow | `dev281754.service-now.com`, scope `x_gskn2_caf_compli` |
| Salesforce | `orgfarm-4938c7f768-dev-ed`, API v67.0 (Summer '26) |
| Correlation | External Id `ServiceNow_Sys_Id__c`, upsert-by-External-Id |
| Baseline captured | 2026-08-07 |
| Cases | 61 |

Case format, evidence policy and the `Verify` convention are defined in the
[ServiceNow file](TEST-CASES-SERVICENOW.md#how-to-read-a-case). One addition
here: **`Verify` always reads both sides**, using `cnit` for ServiceNow and `sf`
for Salesforce, because a case that only checks the side it wrote to cannot fail
in the way this architecture actually fails.

```powershell
& "C:\Users\patel\AppData\Roaming\npm\sf.cmd" data query --query "SELECT ..." --target-org caf-sf
```

Abbreviated below to `sf data query …`.

---

## Test data and budget — read before executing anything

**Developer Edition allows ~5,000 API calls per 24 hours**, counting requests
*inbound to Salesforce*, so only ServiceNow → Salesforce pushes and your own `sf`
tooling draw on it. One full end-to-end demo run costs roughly **45 calls**.

A full pass of this suite is a few hundred calls — comfortable, but `sf` deploys,
Workbench and Data Loader spend from the same budget, so **do not run this suite
on a heavy build day**. Check *Setup → System Overview → API Requests, Last 24
Hours* before starting and record the figure in the run summary.

**Storage.** Single-digit MB of data and modest file storage. Keep evidence
attachments small; the suite uploads files repeatedly.

**Deletes propagate in neither direction**, and cleanup is actively hazardous:
because the sync upserts on External Id, *updating* a not-yet-deleted ServiceNow
record **recreates** its Salesforce twin. Mid-cleanup is the worst state to be
in. Plan to leave orphans rather than half-remove them.

**Kill switch.** `x_gskn2_caf_compli.sf.enabled = false` stops every outbound
push immediately. Suite 8 uses it deliberately; confirm it is back to `true`
before any other suite.

### Live anchors as at 2026-08-07

| Record | State | Use |
|---|---|---|
| `CAFT0001001` | Open, no evidence, on `RCAF0001022` | The intended full-journey starting point |
| `CAFT0001046` | In Progress | The drift-demo task — TC-INT-021 corrupts and restores it |
| `CAFT0001022` | Closed, approved | Carries 1 Salesforce file against 2 ServiceNow attachments — TC-INT-036 |
| `RCAF0001037` | Out of compliance | Previously used to induce `Short_Description__c` drift |
| `RCAF0001001` | No app, no control | Filtered out of both grids — TC-INT-045 |

Baseline: **19 requests, 30 tasks**, expected identical set-for-set on both
sides. (HANDOFF §3 records 19 and 28; two tasks have since been spawned. Verify
rather than trusting either figure — TC-INT-001.)

---

## The integration contract

**Outbound, ServiceNow → Salesforce.** Async business rules
`CAF - Push Request to Salesforce` and `CAF - Push Task to Salesforce` (both
`when=async_always`, order 1000) call `CAFSalesforceSync`, which upserts on
`ServiceNow_Sys_Id__c`.

**Inbound, Salesforce → ServiceNow.** Basic auth as `sf.integration`, through
the `ServiceNow_CAF` named credential.

| Method | Path | Purpose |
|---|---|---|
| `PATCH` | `/api/x_gskn2_caf_compli/caf/task/{sysId}` | Generic task update, six-field allow-list |
| `POST` | `…/caf/task/{sysId}/evidence` | Base64 in, `sys_attachment` out |
| `GET` | `…/caf/task/{sysId}/evidence` | What ServiceNow actually holds |
| `POST` | `…/caf/task/{sysId}/attest` | The evidence gate, then the outcome |
| `GET` | `…/caf/snapshot` | Read-only comparison feed |
| `POST` | `…/caf/resync/{type}/{sysId}` | Re-push one record |

**Inbound allow-list**, exactly six fields:
`state`, `met_criteria`, `approval`, `comments`, `vqd_link`, `vqd_link_2`.
Anything else **fails the whole call** rather than applying the writable subset.

**The echo-loop guard, and why it is not sufficient alone.** Outbound rules skip
writes made by `sf.integration`. Cascading rules run in the same transaction and
are attributed to the same user, so they are skipped too — which strands derived
changes. Both inbound resources therefore **reconcile explicitly**: exactly two
upserts (the task and its parent request), triggered by the request rather than
by a record change, so no loop can form. TC-INT-016 exists to stop anyone
"simplifying" that away.

**Pushes are fire-and-forget.** `_push()` logs with `gs.error` and returns, so a
Salesforce outage cannot roll back a ServiceNow transaction. A failed push
therefore exists only as a log line — which is why Sync Health exists, and why
Suite 5 matters more than its size suggests.

---

# Suite 1 — Outbound push (ServiceNow → Salesforce)

### TC-INT-001 — Full mirror parity by record, not by count

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `CAFSalesforceSync`, both push business rules |
| **Evidence** | record-only |

The suite's baseline case. **Counts matching is not parity** — two sets of 30 can
differ by two records each way and still count 30.

**Steps**
1. `cnit get x_gskn2_caf_compli_caf_req -Fields number,sys_id` and the same for `caf_tsk`.
2. `sf data query --query "SELECT Name, ServiceNow_Sys_Id__c FROM CAF_Request__c"` and the same for `CAF_Task__c`.
3. Compare as **sets of numbers**, and separately as sets of `sys_id`.

**Expected** — Set-for-set identical in both directions. Zero in ServiceNow only,
zero in Salesforce only.

**Verify** — Record both counts *and* the symmetric difference. A pass requires
the difference to be empty.

---

### TC-INT-002 — A new request appears in Salesforce

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Push Request to Salesforce` (`async_always`, order 1000) |
| **Evidence** | UI+record |

**Expected** — Within seconds of insert, a `CAF_Request__c` exists with
`ServiceNow_Sys_Id__c` = the ServiceNow `sys_id`, and mirrored number, status,
state and description.

**Timing note** — the rule is **async**, so the push happens after the
transaction commits. A poll-with-timeout is required; asserting immediately will
produce flaky failures that look like integration defects. Record the observed
latency in the evidence — it is a number the client will ask for.

---

### TC-INT-003 — A new task appears in Salesforce

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | BR `CAF - Push Task to Salesforce` |
| **Evidence** | UI+record |

**Expected** — As TC-INT-002, plus the `CAF_Task__c` correctly parented to its
`CAF_Request__c`.

---

### TC-INT-004 — Tasks created by the flow are pushed too

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Flow `CAF - Create CAF Tasks` → push rule |
| **Evidence** | record-only |
| **⚠** | **ONE-SHOT** |

Tasks born inside a flow are not written by a user action. Confirm the async push
still fires for them.

**Expected** — Every task the flow creates appears in Salesforce.

---

### TC-INT-005 — Push is idempotent

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Upsert on `ServiceNow_Sys_Id__c` |
| **Evidence** | record-only |

**Steps** — Re-push every record (via resync, or by touching each record), then
recount.

**Expected** — Counts **unchanged**. No duplicates. This is the property that
makes replay-on-failure safe, and it has been verified once before — the case
exists to keep it true.

---

### TC-INT-006 — No Salesforce Id is ever stored in ServiceNow

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | Correlation design |
| **Evidence** | record-only |

**Expected** — No field on `caf_req` or `caf_tsk` holds a Salesforce Id. The
correlation is one-directional by design, which is what makes a Salesforce org
rebuild survivable.

---

### TC-INT-007 — A field change propagates

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Push on update |
| **Evidence** | UI+record |

**Steps** — Change `description` on a request in ServiceNow.

**Expected** — The Salesforce mirror reflects it, and `sys_updated_on` /
`LastModifiedDate` move on both sides.

**Boundary** — Change a field that is **not** mirrored. Expect no Salesforce
update at all and no drift reported by Sync Health.

---

### TC-INT-008 — Blank and null are treated as equal

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Boundary |
| **Component** | `CafSyncHealth` comparison |
| **Evidence** | record-only |

ServiceNow returns null for an empty field; Salesforce may hold null or empty
string. Treating them as different would report drift on **every record with an
empty approval**, which is most of them.

**Steps** — Clear a mirrored optional field in ServiceNow, push, run a Sync
Health check.

**Expected** — Zero differences reported. This is the single most likely source
of false-positive drift.

---

### TC-INT-009 — Push failures do not roll back the ServiceNow transaction

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | `_push()` fire-and-forget |
| **Evidence** | record-only |

**Steps** — Break the outbound path (kill switch off, or an invalid credential),
then update a request in ServiceNow.

**Expected**
- The ServiceNow update **succeeds and persists**.
- `gs.error` logs the failure.
- Salesforce is now stale, and **nothing in the UI says so** until Sync Health
  runs.

**Verify** — `cnit get syslog -Query "sourceLIKECAF^ORDERBYDESCsys_created_on" -Limit 10`

**This is the architecture working as designed**, not a defect — a Salesforce
outage must not roll back a compliance record. Write it up as such, and use it as
the setup for TC-INT-018.

---

### TC-INT-010 — Kill switch stops all outbound push

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Property `x_gskn2_caf_compli.sf.enabled` |
| **Evidence** | record-only |

**Steps** — Set `false`, make three changes in ServiceNow, set `true`, make one more.

**Expected** — The three changes do not reach Salesforce; the fourth does. The
three remain stale until a resync — the switch does not queue.

**⚠ Restore the property to `true` before any other suite.** A forgotten kill
switch makes every later case fail in a way that looks like a broken integration.

---

# Suite 2 — Inbound update (Salesforce → ServiceNow)

### TC-INT-011 — A task update round-trips

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `PATCH /caf/task/{sysId}`, Apex `CafTaskService.applyChange` |
| **Evidence** | UI+record |

**Steps** — Move an Open task to In Progress from Salesforce.

**Expected** — ServiceNow task `state=2`, `actual_start_date` set; parent request
`state=2`; **and Salesforce reflects both**, via the explicit reconcile.

**Verify** — Both sides, all four values.

---

### TC-INT-012 — The allow-list accepts exactly six fields

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `WRITABLE = ['state','met_criteria','approval','comments','vqd_link','vqd_link_2']` |
| **Evidence** | record-only |

**Expected** — Each of the six applies successfully, alone and in combination.

---

### TC-INT-013 — A non-allow-listed field fails the whole call

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | Same |
| **Evidence** | record-only |

**Steps** — `PATCH` with `{"state": "2", "number": "HACKED"}`.

**Expected**
- `HTTP 400`, body `Fields not writable from Salesforce: number`.
- **`state` is not applied either.** The endpoint refuses the whole call rather
  than silently applying the writable subset — a caller that thinks it set
  `met_criteria` and did not would be worse than an error.

**Verify** — Re-read the task; **nothing** changed, `sys_updated_on` unmoved.

**Sub-cases** — `active`, `business_application`, `actual_start_date`,
`caf_request`, `sys_id`. Each must be refused.

---

### TC-INT-014 — Unknown sys_id returns 404

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 404`, `CAF Task not found: <sysId>`.

---

### TC-INT-015 — Empty body returns 400

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 400`, `Empty request body`.

---

### TC-INT-016 — Derived changes reconcile back to Salesforce

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Regression |
| **Component** | The explicit two-upsert reconcile at the end of each inbound resource |
| **Evidence** | UI+record |

**The case that protects the hardest-won fix in this integration.** The echo-loop
guard skips anything `sf.integration` writes — including changes ServiceNow
*derived* inside the same transaction, because they carry the same user. Without
the explicit reconcile, a task moved to In Progress from Salesforce moves its
parent request in ServiceNow while **Salesforce still reads Open, with no push
logged for either record.**

**Steps** — From Salesforce, start a task whose parent request is `state=1`.

**Expected**
- ServiceNow: task `state=2`, parent request `state=2`.
- Salesforce: **both** updated.
- Log shows `[SF->CAF]` then two `[CAF->SF]` lines within about a second.

**Verify** — `cnit get syslog -Query "messageLIKECAF^ORDERBYDESCsys_created_on" -Limit 10` → the three lines in order.

**Regression note for the report** — this cannot be "simplified" into the echo
guard. If a future change removes the explicit push, this case is the one that
catches it, and the failure is silent otherwise.

---

### TC-INT-017 — The inbound user is `sf.integration` and only `sf.integration`

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Regression |
| **Component** | Named credential `ServiceNow_CAF` |
| **Evidence** | record-only |

**Expected** — Every inbound write shows `sys_updated_by = sf.integration`.

**Why P1** — the echo-loop guard keys off this user. Run the API as any other
account and **the guard silently does nothing**, producing a loop that spends the
DE API budget with no error anywhere.

**Verify** — `cnit get x_gskn2_caf_compli_caf_tsk -Query "sys_updated_by=sf.integration^ORDERBYDESCsys_updated_on" -Fields number,sys_updated_by,sys_updated_on -Limit 5`

---

### TC-INT-018 — A ServiceNow outage surfaces as a failed action, not a queue

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | Synchronous Apex callout |
| **Evidence** | UI+record |

**Steps** — Make ServiceNow unreachable (invalid named-credential endpoint), then
act from the Salesforce UI.

**Expected** — The LWC surfaces an error. **Nothing is queued and nothing
retries.** Salesforce's own record is unchanged, so the two sides stay
consistent — a worse outcome would be Salesforce committing locally.

**Known gap** — this is HANDOFF open item 4: no Platform Events. Report as a
documented limitation, not a defect.

---

# Suite 3 — Evidence

### TC-INT-019 — Upload lands on both sides

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `CafEvidenceService.pushEvidence`, `POST /caf/task/{sysId}/evidence` |
| **Evidence** | UI+record |

**Steps** — Upload a small text file against a CAF Task in Salesforce.

**Expected**
- Salesforce: a `ContentVersion` linked to the task, visible in the standard Files related list.
- ServiceNow: a `sys_attachment` on `x_gskn2_caf_compli_caf_tsk` with matching name and byte count.
- `HTTP 201` from the ServiceNow resource.

**Verify** — `cnit get sys_attachment -Query "table_name=x_gskn2_caf_compli_caf_tsk^table_sys_id=<sysid>" -Fields file_name,size_bytes` and `sf data query --query "SELECT Title, ContentSize FROM ContentVersion WHERE ..."`

**Two copies on purpose.** Salesforce's copy makes preview and download work with
no round trip; ServiceNow's is the copy an auditor is entitled to and **the only
one the attestation gate counts**. They are not reconciled and should not be.

---

### TC-INT-020 — Both lists are shown side by side

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `cafEvidence` LWC |
| **Evidence** | UI-only |

**Expected** — The panel lists Salesforce files and ServiceNow attachments
separately, so a failed push is **visible rather than inferred**.

---

### TC-INT-021 — A count mismatch raises a warning

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `cafEvidence` mismatch check |
| **Evidence** | UI+record |

**Ready-made subject** — `CAFT0001022` carries **1 Salesforce file against 2
ServiceNow attachments**, because of a stray `backup-restore-test.txt` left by a
direct-HTTP smoke test.

**Expected** — The panel shows the warning. Verify it reads as informative rather
than alarming; two copies of evidence is not a compliance failure.

---

### TC-INT-022 — File size ceiling is enforced on both sides

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Boundary |
| **Component** | `CafEvidenceService` and the ServiceNow resource, 2 MB |
| **Evidence** | UI+record |

**Boundary set** — just under 2 MB (accept), exactly 2 MB (record the behaviour),
just over (reject with a clear message).

**Why 2 MB** — Apex holds the Blob and its base64 expansion in the same 6 MB heap
and caps a callout body at 6 MB. The ceiling is a property of the **largest
single file**, not of how many were dropped at once, because files push one per
Apex transaction. Test that too: five 1 MB files must all succeed.

---

### TC-INT-023 — Evidence list on an unknown task returns 404

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Negative |
| **Component** | `GET /caf/task/{sysId}/evidence` |
| **Evidence** | record-only |

**Expected** — `HTTP 404`. Previously verified.

---

### TC-INT-024 — A closed task shows its evidence and takes no more

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `cafEvidence` with `hide-upload` |
| **Evidence** | UI-only |

**Expected** — Row action reads **View evidence**; no upload control. The same
component serves both modes through one flag, and a closed task's evidence is
exactly what an audit wants to see.

---

### TC-INT-025 — Upload and push are separate transactions

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Regression |
| **Component** | Apex DML-then-callout restriction |
| **Evidence** | record-only |

**Expected** — Through the LWC this works, because `lightning-file-upload`
finishes and the push is a separate Apex call. A **single anonymous-Apex script**
doing both fails with *"uncommitted work pending"*. Confirm the LWC path is the
only one used.

---

### TC-INT-026 — Special characters and non-ASCII filenames survive

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Boundary |
| **Evidence** | record-only |

**Expected** — Filenames with spaces, ampersands and accented characters store
identically on both sides. Given a JSON body with non-ASCII characters is
rejected with an opaque `HTTP 400` elsewhere in this app, this is worth an
explicit case.

---

# Suite 4 — Attestation

### TC-INT-027 — Approved attestation, full round trip

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `POST /caf/task/{sysId}/attest`, BR `CAF - success criteria not met` |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**The flagship case.** `CAFT0001001` is left in the org as the intended starting
point: Open, no evidence, on `RCAF0001022`.

**Steps** — Start the task, upload evidence, attest *criteria met = yes,
approved*.

**Expected**
- ServiceNow task: `state=3`, `active=false`, `approval=approved`, `met_criteria=yes`.
- Parent request: `caf_status=in_compliance`.
- Salesforce: all four task fields and the request status agree.
- Log: `[SF->CAF]` attestation line, then `[CAF->SF]` for task and request within about a second.

**Verify both sides independently** — read Salesforce over `sf` and ServiceNow
over `cnit`, not the endpoint's own response body. The endpoint re-reads after
the update precisely so its response is honest, but a test that trusts the thing
under test proves nothing.

**Critical assertion** — the **request does not close**; closing the task spawns
the next one in the chain. See TC-INT-031.

---

### TC-INT-028 — Rejected attestation

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Expected** — Task closed, `approval=rejected`, parent request
`caf_status=out_of_compliance`, business application follows, Salesforce agrees.

**Note the asymmetry** — rejection still closes the task; there is no remediation
loop. Flag for business confirmation.

---

### TC-INT-029 — The evidence gate

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | `sys_attachment` check in the attest resource |
| **Evidence** | UI+record |

**Steps** — Attest an In Progress task with **no** evidence.

**Expected** — `HTTP 428`, `Attach at least one evidence file to <number> before
attesting.` Nothing written; `approval` still `requested`.

**Where the gate lives, and why** — the business rule
`CAF - attachment mandatory for def tasks` implements the same check and is
**deliberately inactive**. Activating it would change closure behaviour for the
`/caf` portal and for admins, and all pre-existing tasks have no attachment, so
every portal close would start failing. The gate binds every caller of this
endpoint and nobody else.

**Corollary case** — close the same evidence-free task through the **ServiceNow
portal**. It succeeds. That asymmetry is intended; record it in the report so
nobody discovers it in front of a client.

---

### TC-INT-030 — Gate counts ServiceNow attachments, not Salesforce files

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Evidence** | record-only |

**Steps** — Contrive a task with a Salesforce `ContentVersion` but **no**
ServiceNow `sys_attachment` — by uploading with the kill switch on, or by
breaking the push mid-flight.

**Expected** — Attestation still **refused with 428**, even though the Salesforce
UI shows a file.

**Why this is the sharpest case in the suite** — it is the exact scenario where a
user sees their evidence on screen and is told there is none. Confirm the error
message is comprehensible in that situation; if it is not, that is a real
usability finding.

---

### TC-INT-031 — Closing a task spawns the next, and both sides see it

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | Flow `CAF - Close Request When All Tasks Close` + push |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

Measured on `RCAF0001022`:

```
attest approved  →  CAFT0001022 Closed Complete, active=false
                 →  RCAF0001022 caf_status = in_compliance
                 →  flow creates CAFT0001001 "IT Application Owner Attestation", Open
                 →  RCAF0001022 itself stays state=2, active=true
```

**Expected** — The newly spawned task appears **in Salesforce too**.

**The subtle risk** — the new task is created by a flow, *inside the transaction
attributed to `sf.integration`*, so the echo-loop guard may skip its push. The
explicit reconcile pushes the attested task and its parent — **not the sibling
the flow just created.** Confirm empirically whether the new task reaches
Salesforce, and if it does not, this is a genuine drift-producing defect that
Sync Health would report as "in ServiceNow, missing in Salesforce".

**Verify** — Immediately after the attestation, count tasks for that request on
both sides. They must match.

---

### TC-INT-032 — Attesting a task that is not In Progress

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 409`, `<number> must be In Progress before it can be
attested. Start the task first.`

**Why the check is in the endpoint** — `CAF - Task - prevent state change`
enforces the Open→Closed prohibition for a direct state write, but it evaluates
*before* the approval rule sets `state=3`, so it would not catch this route.

---

### TC-INT-033 — Attesting an inactive task

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 409`, `<number> is no longer active; its outcome is already
recorded.`

**Regression value** — this check reads `active` through a helper accepting both
`'1'` and `'true'`, because `getValue()` on a boolean returns the stored `'1'`
while the Table API's JSON says `"true"`. The first version compared against
`'true'` alone and **refused every attestation on the instance**. Assert against
a real task, not a mock.

---

### TC-INT-034 — Re-attesting with the same outcome

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 409`, `<number> is already approved.`

**Ordering note** — the active check runs first, so on a closed task the message
is the *inactive* one, not this one. Test this branch on a task that is still
active with `approval` already set — which TC-SN-033 shows is reachable.

---

### TC-INT-035 — Invalid outcome and met_criteria values

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — `HTTP 400`, validated **before** the record is even loaded.

| Body | Response |
|---|---|
| `outcome: "maybe"` | 400, `outcome must be "approved" or "rejected"` |
| `met_criteria: "probably"` | 400, `met_criteria must be "yes" or "no"` |
| `outcome` missing | 400 |
| `met_criteria` missing | 400 |
| empty body | 400, `Empty request body` |

**Note** — `met_criteria` is **mandatory** at this endpoint, though it is
optional on the record itself (TC-SN-033). The endpoint is stricter than the
table, deliberately.

---

### TC-INT-036 — Evidence and attestation are separate panels for separate people

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `cafEvidence`, `cafAttestation` LWCs |
| **Evidence** | UI-only |

**Expected**
- **Upload evidence** opens `cafEvidence` alone, writable.
- **Attest** opens `cafEvidence` **read-only** beside `cafAttestation` — an
  approver must see the evidence and must not be adding to it.

Row actions by state:

| State | Actions |
|---|---|
| Open | Start, Upload evidence |
| In Progress | Upload evidence, Attest |
| Closed | View evidence only |

**Regression** — there must be **no standalone "Criteria met" button**. It used
to set `met_criteria` on its own; the attestation form now carries it as a
yes/no alongside the decision.

---

### TC-INT-037 — There is no named approver

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Evidence** | record-only |

**Expected** — After an attestation, `sysapproval_approver` still holds **no CAF
records**, and no approver identity is stored anywhere on the task beyond
`sys_updated_by = sf.integration`.

**Finding for the report** — whoever presses the button in Salesforce is the
approver, and the audit trail does not record who that was. This is HANDOFF open
item 2, considered and deferred. For a compliance product it is the single
weakest point in the evidence chain and should be stated plainly, not buried.

---

# Suite 5 — Sync Health and drift

Four drift types, **each of which has actually occurred on this project**. That
is what makes this suite worth its length.

### TC-INT-038 — Clean state reports zero differences

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `GET /caf/snapshot`, `CafSyncHealth.cls`, `cafSyncHealth` LWC |
| **Evidence** | UI+record |

**Expected** — Green strip, all records compared, zero differences. Record the
number compared; it must equal requests + tasks (49 at baseline).

---

### TC-INT-039 — Drift type 1: value differs

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |

The documented repeatable demo, and it **touches nothing in ServiceNow**:

1. `/lightning/o/CAF_Task__c/list?filterName=All`, double-click the **State**
   cell on `CAFT0001046`, change `In Progress` to `Open`, Save.
2. CAF Dashboard tab → **Re-check now**.
3. Expect red:
   `Task CAFT0001046 | State differs | SN=In Progress | SF=Open`.

**Expected** — Exactly one difference, naming both values and the field.

**Note** — `State__c` is editable on the CAF Task layout **for exactly this
reason**; every other mirrored field is Readonly. TC-INT-044 asserts that.

---

### TC-INT-040 — Re-sync repairs from the system of record

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `POST /caf/resync/{type}/{sysId}` |
| **Evidence** | UI+record |

**Steps** — From the red strip in TC-INT-039, press **Re-sync**, then **Re-check**.

**Expected** — `HTTP 200`, ServiceNow re-pushes, strip returns green.

**Critical assertion** — **ServiceNow is unchanged.** Re-sync modifies nothing on
the system-of-record side. Verify `sys_updated_on` on the ServiceNow task is
unmoved. Repair flows one way only; a mirror that disagrees is stale by
definition.

---

### TC-INT-041 — Drift type 2: in ServiceNow, missing in Salesforce

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |

**Steps** — Kill switch off, create a request in ServiceNow, kill switch on,
re-check.

**Expected** — Reported as missing in Salesforce. Re-sync creates it.

**⚠** Leaves a permanent extra record on both sides.

---

### TC-INT-042 — Drift type 3: in Salesforce, missing in ServiceNow

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Evidence** | UI+record |

**Steps** — Create a `CAF_Task__c` directly in Salesforce with a fabricated
`ServiceNow_Sys_Id__c`.

**Expected** — Reported as an orphan.

**Expected, and important** — **Re-sync cannot repair it.** Repair only ever
flows ServiceNow → Salesforce, so an orphan can only be deleted in Salesforce.
Confirm the UI does not offer a repair that cannot work.

**⚠ ONE-SHOT and requires manual cleanup** via `sf data delete record`, which
needs explicit user confirmation.

---

### TC-INT-043 — Drift type 4: Salesforce simply stale

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Evidence** | record-only |

**Steps** — Kill switch off, change a mirrored field in ServiceNow, kill switch
on, re-check.

**Expected** — Reported as a value difference; re-sync repairs it. Distinct from
TC-INT-039 in that ServiceNow moved, not Salesforce.

---

### TC-INT-044 — Only `State__c` is editable in the Salesforce mirror

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | CAF Task page layout |
| **Evidence** | UI-only |

**Expected** — Every mirrored field except `State__c` is Readonly on the layout.
`State__c` is editable solely to make the drift demo possible.

**Watch for the layout trap** — a field missing from the page layout shows a
**lock icon** and refuses inline edit in a list view *even when FLS grants Edit
and describe reports `updateable=true`*. Distinguish "deliberately Readonly" from
"accidentally absent from the layout"; they look identical to a user.

---

### TC-INT-045 — Re-check is honest

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | Imperative Apex, no `cacheable=true` |
| **Evidence** | UI+record |

**Steps** — Induce drift, re-check, repair **outside** the UI, re-check again
without reloading the page.

**Expected** — The second check reflects reality. An Apex method making a callout
cannot be cacheable, which is what makes Re-check really go and look. Assert the
ServiceNow log shows a fresh snapshot request per press.

---

### TC-INT-046 — Snapshot is read-only

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | `GET /caf/snapshot` |
| **Evidence** | record-only |

**Expected** — Returns number, status, state, description and `sys_updated_on`
for every request and task, and **modifies nothing**. Verify no `sys_updated_on`
anywhere in the scope moves as a result of a snapshot call.

---

### TC-INT-047 — Drift detection is automatic, repair never is

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | Design invariant |
| **Evidence** | UI-only |

**Expected** — No code path repairs without a human pressing Re-sync next to a
named difference. Unattended repair can turn a Salesforce problem into a
ServiceNow one.

**Also assert the gap** — Sync Health has **no schedule**. It runs when someone
opens the dashboard or presses Re-check. Report as a known limitation (HANDOFF
open item 5).

---

# Suite 6 — Salesforce dashboard

### TC-INT-048 — Grid matches the ServiceNow portal exactly

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `cafDashboard` LWC |
| **Evidence** | UI+record |

**The parity case.** Capture this screenshot in the same session as
[TC-SN-065](TEST-CASES-SERVICENOW.md) so the two grids sit side by side in the
evidence pack.

**Expected** — Same applications, same controls, same colour per cell. Baseline:
SAP HANA 6 out of compliance, SAP Fiori 4 out / 2 compliant, Zscalar App 6
compliant.

---

### TC-INT-049 — Columns are derived from data, not hard-coded

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Evidence** | UI+record |
| **⚠** | **ONE-SHOT** |

**Steps** — Introduce a request against a control not currently represented.

**Expected** — A new column appears with no code change.

**Boundary** — A control with no requests at all must **not** produce an empty
column.

**The two dashboards derive columns from different sources, and it shows.**
Confirmed from the ServiceNow widget source on 2026-08-07:

| | Column source | A control with no requests |
|---|---|---|
| ServiceNow `/caf` | `caf_conformance_type` where `active=true`, ordered by name | **Gets a column**, cells read `N/A` |
| Salesforce LWC | the `CAF_Request__c` data it holds — no control object is mirrored | **No column at all** |

So adding a control in ServiceNow produces a column there immediately and
**nothing in Salesforce** until a request exists for it. The grids legitimately
disagree about their column set, and **Sync Health will not report it** — no
mirrored record disagrees, because the control table is not mirrored.

Run this case together with [TC-SN-069](TEST-CASES-SERVICENOW.md) and capture
both grids in the same pack. Anyone comparing the two screenshots without this
note will raise the difference as a defect.

---

### TC-INT-050 — Compliant only when every control is compliant

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |

**Expected** — Matches the ServiceNow widget exactly. Softening this on either
side makes the two views disagree about identical data — which is the failure the
whole architecture is built to avoid.

**🔴 Run this early — the ServiceNow side is already wrong.** Confirmed on
2026-08-07: `cmdb_ci_business_app.u_caf_compliance_status` reads `compliant` for
both SAP Fiori and SAP HANA while four of each application's six controls are
`out_of_compliance`. See the confirmed defect under
[TC-SN-017](TEST-CASES-SERVICENOW.md).

The question this case must answer is **which of two failures is happening**:

| If the LWC shows | Then |
|---|---|
| Compliant, same as ServiceNow | The mirror is faithful and the defect is single-sourced in the business rule. Fix once, both surfaces correct. |
| Non-compliant, unlike ServiceNow | The LWC computes its own roll-up from the controls. It is giving the *right* answer, ServiceNow the wrong one — and the two platforms visibly disagree about the same data, which is the split-brain the architecture was designed to prevent. |

The second outcome is worse and less obvious. Capture both grids side by side in
the evidence pack regardless of which occurs.

---

### TC-INT-051 — Drill-in shows the request's tasks

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |

**Expected** — Clicking a cell lists that request's tasks with state-appropriate
row actions (TC-INT-036), and the task set matches ServiceNow exactly.

---

### TC-INT-052 — Start action from the dashboard

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Evidence** | UI+record |

**Expected** — Open → In Progress, propagating to ServiceNow and reconciling the
parent request back (TC-INT-016).

---

### TC-INT-053 — Sync Health strip sits above the grid

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Evidence** | UI-only |

**Expected** — `cafSyncHealth` renders above `cafDashboard`, runs on load, and
its state is legible at a glance. The grid can only be trusted if something is
checking it — this is the something, and it must be visible without scrolling.

---

### TC-INT-054 — The orphan request appears in neither grid

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Negative |
| **Evidence** | UI+record |

`RCAF0001001` has no business application and no control, so `getRequests()`
filters it out on both sides.

**Expected** — Absent from both grids, present in both tables. Assert **both**
sides filter identically; a filter applied on one side only is drift that Sync
Health would not catch, because the record is present in both stores.

---

### TC-INT-055 — LWCs are droppable on an Experience Cloud page

| | |
|---|---|
| **Priority** | P3 |
| **Type** | Positive |
| **Evidence** | UI-only |

**Expected** — `cafEvidence` and `cafAttestation` carry the
`lightningCommunity__Page` target and appear in the palette.

**Blocked** — there is no Experience Cloud site, and the org's Experience licence
count is unverified. Mark **blocked**, not failed. This is HANDOFF open item 1
and the remainder of the licensing argument for the whole split.

---

# Suite 7 — Deletion and orphans

### TC-INT-056 — Deleting in ServiceNow leaves a Salesforce orphan

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Evidence** | record-only |
| **⚠** | **ONE-SHOT, requires UI deletion** |

**Expected** — The Salesforce record survives. No push or reconcile clears it.
Sync Health reports it as drift type 3, which **cannot be repaired** by re-sync.

---

### TC-INT-057 — Deleting in Salesforce leaves ServiceNow untouched

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Evidence** | record-only |

**Expected** — ServiceNow unaffected. Sync Health reports drift type 1, which
re-sync **can** repair — recreating the Salesforce record.

---

### TC-INT-058 — Updating a pending-delete record recreates its twin

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Evidence** | record-only |

**The trap that makes cleanup hazardous.** Delete a record in Salesforce,
intending to delete it in ServiceNow next. Before doing so, update it in
ServiceNow — for any reason, including a scheduled job touching it overnight.

**Expected** — The upsert-on-External-Id **recreates** the Salesforce record.
The cleanup silently undoes itself.

**Report as an operational hazard**, with the mitigation: kill switch off before
any cleanup, ServiceNow side first, kill switch on after.

---

# Suite 8 — Configuration, auth and limits

### TC-INT-059 — Named credential and Client Credentials auth

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `ServiceNow_CAF` named credential; ServiceNow `x_gskn2_caf_compli.sf.*` properties |
| **Evidence** | record-only |

**Expected** — Outbound obtains a token via Client Credentials; inbound
authenticates as `sf.integration`.

**Configuration assertions**
- The named credential is called **`ServiceNow_CAF` exactly** — Apex references
  `callout:ServiceNow_CAF` and a rename breaks every callout.
- It is **created by hand and not in source**, deliberately: Salesforce will not
  deploy one without a password, and that password must not sit in a
  client-facing directory. Confirm no credential has leaked into
  `force-app/namedCredentials/`.
- The client secret property is encrypted (`password2`).

**Deviation to record** — Client Credentials rather than JWT bearer, because
ServiceNow's `jwt_provider` table has no `iss`/`sub`/`aud` fields. JWT remains
the better production answer; the deviation belongs in the TDD delta.

---

### TC-INT-060 — API budget consumption per journey

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Boundary |
| **Evidence** | record-only |

**Steps** — Record *Setup → System Overview → API Requests, Last 24 Hours*
before and after one full end-to-end journey.

**Expected** — Roughly **45 calls**, about 1% of the ~5,000 daily budget.

**Also measure** the whole suite, and record it. It is the number that determines
whether this suite can run more than once a day alongside development, and
nobody currently knows it.

**Watch for** — an unguarded echo loop or a retry storm against a broken
endpoint. Either would show as an unexplained jump; that jump is the alarm.

---

### TC-INT-061 — No Apex test coverage exists

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Regression |
| **Component** | `CafSyncHealth`, `CafEvidenceService`, `CafAttestationService` |
| **Evidence** | record-only |

**Steps** — `sf apex run test --target-org caf-sf --code-coverage`.

**Expected** — Coverage on these three classes is **zero**.

**Report as a gate, not a defect.** Fine for a Developer Edition org, **blocking
for any move toward production** — Salesforce requires 75% org-wide coverage to
deploy to production, so this is not a quality preference but a hard deployment
blocker. It belongs in the test summary as a release risk. HANDOFF open item 5.

---

# Suite 9 — Transform and data quality

The outbound push is an ETL: extract by GlideRecord, transform in
`buildPayload` / `buildTaskPayload` / `buildControlPayload`, load by upsert on
`ServiceNow_Sys_Id__c`. Suite 1 asserts that records *arrive*. This suite asserts
that what arrives still **means the same thing** — which is a different property,
and the one a transform layer breaks.

**Every case here reads both platforms and writes to neither**, so the whole
suite is re-runnable on any day. It needs no `sf.integration` credential: cnit
and the `sf` CLI are sufficient.

**Why these are not already covered by Sync Health.** `CafSyncHealth` compares
`caf_status`, `state` and `short_description` on requests, and `state`,
`approval`, `met_criteria` and `short_description` on tasks. It therefore never
compares the planned completion date, the business application, or the control
join — and it reconciles requests and tasks only, so the control catalogue is
checked by nothing at all.

---

### TC-INT-062 — The control catalogue is reconciled by nothing

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `CAF_Control_Catalog__c`, `CafSyncHealth.check()` |
| **Evidence** | record-only |

**Steps** — Compare active `caf_conformance_type` records against
`CAF_Control_Catalog__c` by `sys_id`, in both directions.

**Expected** — Set-for-set identical, and every mirrored row carries
`Active__c = true`.

**The point of the case** — Sync Health reports "N records verified" counting
requests and tasks. A catalogue drift is invisible to it, and a catalogue row is
a **visible column** on the dashboard, so it is the drift with the most obvious
user-facing consequence.

---

### TC-INT-063 — The External Id is unique and always populated

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | Upsert on `ServiceNow_Sys_Id__c` |
| **Evidence** | record-only |

**Expected** — On each of the three objects: no duplicate
`ServiceNow_Sys_Id__c`, and none blank.

**Why it is worth asserting even though upsert guarantees it** — the guarantee
holds only for rows the upsert created. A row created any other way — by hand, by
Data Loader, by a half-finished cleanup — breaks the correlation silently, and
every later push then updates the wrong one of the pair.

---

### TC-INT-064 — Truncation headroom, and the drift it would cause

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | `_truncate(short_description, 255)`, `_truncate(name, 80)` |
| **Evidence** | record-only |

**Steps** — Measure the longest `short_description` on `caf_req` and `caf_tsk`,
and the longest control `name`, against the limits the transform applies.

**Expected** — No source value exceeds its limit today, so no data is being lost.

**The consequence if one ever does** — Sync Health compares the **raw**
ServiceNow `short_description` against the **truncated** Salesforce copy. A
record over 255 characters would therefore report as drift **permanently**, and
Re-sync could never clear it: the re-push truncates to exactly the same value
that is already there. Report the headroom as a number, not as a pass — this case
is an early warning, and it stops being one the day it fails.

---

### TC-INT-065 — Date conversion fidelity

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Positive |
| **Component** | `_toIso()`, `Planned_Completion_Date__c` |
| **Evidence** | record-only |

**Steps** — For every mirrored request and task, compare
`Planned_Completion_Date__c` against `_toIso(planned_completion_date)` — a
literal `' '` → `'T'` replacement with `Z` appended, asserting the source is UTC.

**Expected** — Every populated date matches. Every empty source is empty in the
mirror, not epoch and not today.

**Two things to record** — whether the Salesforce field is `date` or `datetime`
(a `date` silently drops the time, which can move a due date by a day either side
of midnight UTC), and whether any source value fails to match
`yyyy-MM-dd HH:mm:ss`. `_toIso` does no validation, so a value in any other shape
is passed to Salesforce malformed.

**Not compared by Sync Health**, so any drift here is invisible today.

---

### TC-INT-066 — The state code-to-label mapping is total

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `_stateLabel()` |
| **Evidence** | record-only |

**Steps** — Collect every distinct `state` on `caf_req` and `caf_tsk` and check
each against the mapped set: `1` Open, `2` In Progress, `3` Closed Complete,
`-1` Cancelled.

**Expected** — No unmapped value in use, and no mirrored `State__c` holding a
bare numeric string.

**Why it matters** — the `default` branch returns the raw value rather than
failing. Adding a choice in ServiceNow therefore does not break the push; it
quietly publishes `"4"` into a label field, where it reaches the dashboard as a
column value nobody can read.

---

### TC-INT-067 — Denormalised business application is still current

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `getDisplayValue('business_application')` |
| **Evidence** | record-only |

**Steps** — For every mirrored request, compare `Business_Application__c` against
the display value the reference resolves to **now**.

**Expected** — Every one matches.

**Same defect class as the control name**, which has already been observed here:
the display value is a snapshot taken at push time, so renaming a business
application strands the old label on every request already mirrored. Sync Health
does not compare this field, so nothing would report it.

---

### TC-INT-068 — The control join resolves, and the name agrees

| | |
|---|---|
| **Priority** | P1 |
| **Type** | Negative |
| **Component** | `_control()`, `CAF_Control_Sys_Id__c`, `CAF_Control__c` |
| **Evidence** | record-only |

**Steps** — For every mirrored request, resolve `CAF_Control_Sys_Id__c` against
the control table and compare `CAF_Control__c` against that control's current
name.

**Expected** — Every sys_id resolves to a live control; every name agrees.

**Two failure shapes, and they are different** — a sys_id that resolves nowhere
means the request points at a deleted control and the grid cannot place it in a
column. A sys_id that resolves to a *different* name means the label is stale and
the column heading disagrees with the request behind it. The first is a broken
join; the second is the snapshot problem `CAF_Control_Sys_Id__c` exists to solve,
still visible on any record pushed before that field was added.

---

### TC-INT-069 — The boolean cast survives the round trip

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Positive |
| **Component** | `Active__c: gr.getValue('active') === '1'` |
| **Evidence** | record-only |

**Expected** — For every control, `Active__c` equals the ServiceNow `active`
flag.

**Regression value** — `getValue()` on a boolean returns `'1'`, while the Table
API's JSON says `"true"`. A check written from what a `cnit get` shows would
compare against the wrong form. The same confusion, in the attest endpoint,
refused every attestation on the instance — so the case asserts against real
records rather than a fixture.

---

### TC-INT-070 — Parent references resolve

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `CAF_Request__r` linked by External Id |
| **Evidence** | record-only |

**Steps** — For every mirrored task, check that its parent resolves in Salesforce
and that the parent it names is the same request ServiceNow records.

**Expected** — Every task with a parent in ServiceNow has the same parent in
Salesforce; every task without one has none in either place.

**Note** — linking by External Id rather than by Salesforce Id removes any
ordering dependency between the two pushes, so a task can be pushed before its
request. That is a strength, but it means a mistyped or stale parent key fails
silently as an unlinked task rather than as a rejected write. `CAFT0001007` has
an empty `caf_request` in ServiceNow and is the expected legitimate case.

---

# Suite 10 — Regressions raised by earlier runs

Cases written *after* a run found something, to hold the defect still until it is
fixed. Each names the case that surfaced it. They are expected to fail until the
code changes, which is the point — a defect with no failing test is a defect that
comes back.

---

### TC-INT-071 — Mismatch advice names the side that is short

| | |
|---|---|
| **Priority** | P2 |
| **Type** | Negative |
| **Component** | `cafEvidence.mismatchLabel` |
| **Evidence** | UI+record |
| **Raised by** | TC-INT-021, which passes on the wording being informative and records this separately |

**Ready-made subject** — `CAFT0001022` carries **1 Salesforce file against 2
ServiceNow attachments**, so ServiceNow — the system of record — holds *more*.

**Steps** — Open the evidence panel on the task, read the mismatch warning, and
determine which platform the advice tells the user to act on.

**Expected** — The advice matches the direction of the mismatch:

| Which side is short | Correct advice |
|---|---|
| ServiceNow has fewer | Re-upload, so the system of record gets the file |
| Salesforce has fewer | Nothing to re-upload — the system of record already holds it. Say so, or offer Re-sync |

**Known to fail today.** `mismatchLabel` is unconditional and always says
*"Re-upload the missing file to send it to the system of record"*. On this
instance the shortfall runs the other way, so following that advice creates a
**third** ServiceNow attachment rather than repairing anything — and this is the
only mismatch state on the instance, so it is the one a user will actually meet.

**Fix** — branch the label on `servicenowCount - salesforceCount`. The case
passes once the advice is direction-correct; it does not prescribe the wording.

---

