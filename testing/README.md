# CAF Compliance — test pack

Test cases, automated execution, and branded Word evidence records.
**Start here.** Built 2026-08-07.

| | |
|---|---|
| [TEST-CASES-SERVICENOW.md](TEST-CASES-SERVICENOW.md) | 69 cases — engine, native UI, `/caf` portal |
| [TEST-CASES-INTEGRATION.md](TEST-CASES-INTEGRATION.md) | 70 cases — everything crossing into Salesforce |
| [automation/](automation/) | Playwright harness (TypeScript) |
| [evidence-generator/](evidence-generator/) | Python + python-docx → one .docx per case |
| [evidence-packs/](evidence-packs/) | Generated Word documents (git-ignored output) |

**Salesforce side: 24 of 61 cases executed — 20 PASS, 3 FAIL, 1 BLOCKED.**
Everything that can be proved without changing either platform, including all
seven UI cases. **The remaining 37 are pending by decision, not by capability** —
each needs a write, and the harness for them is built. See "Pending" below.

---

## How it fits together

```
TEST-CASES-*.md          the definition — priority, component, steps, expected
        │
        ├──> automation/specs/*.spec.ts     executes, records what happened
        │              │
        │              └──> automation/results/cases/TC-*.json
        │
        └──> evidence-generator/            merges definition + result
                       │
                       └──> evidence-packs/TC-*.docx
```

The markdown is the single source of truth for what a case *is*; the run supplies
what happened. **Nothing is retyped between them**, so a document cannot claim an
expected result the specification does not contain.

### Two proofs per case, always

Every case that asserts a state transition records **what the screen showed** and
**what the record holds**. A green toast proves a form submitted, not that a
business rule ran — and this architecture's characteristic failure is the two
platforms disagreeing, which a single-sided check cannot see.

---

## Running one case in a browser you can watch

```powershell
cd testing/automation
.\test.cmd TC-INT-020
```

A Chromium window opens, Salesforce loads, the case drives the CAF Dashboard
narrating each step on screen, and a branded `.docx` evidence record opens when
it settles. Same specs, same assertions, same generator as the headless pass —
watch mode only changes whether anyone is watching.

Three to start with: **TC-INT-020** (both file lists side by side),
**TC-INT-051** (drill-in from the grid), **TC-INT-036** (owner and approver
views, the most clicking). `--slow` for demonstrating, `--headless` to skip the
window, `.\watch.cmd` for a whole suite.

`.\test.cmd` rather than `npm test` because Windows ships the PowerShell
execution policy at **Restricted**, and npm on Windows is a `.ps1` — so
`npm test` fails with *"npm.ps1 cannot be loaded because running scripts is
disabled on this system"*, which names npm but is the policy. `npm.cmd test`
works too.

**[automation/WATCH-MODE.md](automation/WATCH-MODE.md) is the reference** — which
of the 139 cases are executable today, the flags, and the first-run setup.

---

## Running it

**Every command below runs from `testing/automation`**, which is where
`package.json` lives. Running `npm run …` from the repo root fails with
`ENOENT: no such file or directory, open '…\package.json'` — npm looks in the
current directory and there is no root package. From elsewhere, use
`npm --prefix testing/automation run <script>`.

```powershell
cd testing/automation

# ServiceNow cases (read-only subset)
npx playwright test specs/servicenow-cases.spec.ts --project=sn

# Salesforce integration cases (read-only subset — no browser, no login)
npx playwright test specs/integration-readonly.spec.ts --project=int

# Transform / data-quality cases (read-only, no sf.integration credential needed)
npm run int:etl

# Negative-path API cases (write-shaped, every one expected to be refused)
npm run int:neg         # NOT part of `npm run int` — see Pending below

# Salesforce UI cases (7, none of them write)
npx playwright test specs/integration-ui.spec.ts --project=sf-ui

# UI harness check — proves every selector still reaches its target
npm run sf:smoke        # add sf:smoke:headed to watch it

# Word evidence pack
cd ../evidence-generator
python generate_evidence.py
```

ServiceNow credentials live in `automation/.env` (git-ignored) — see
`.env.example`. The `setup` project logs in once and saves the session to
`.auth/`.

**Salesforce needs no credential in this folder.** `sf-setup` calls
`sf org open --url-only`, which exchanges the CLI's existing OAuth grant for a
single-use `frontdoor.jsp` URL; navigating to it hands the browser the session
the CLI already holds. No password is used or stored, and it is unaffected by
MFA on interactive login. The token is one-time, so `sf-setup` runs once per
suite and every spec starts from the saved `.auth/salesforce.json`.

**Documents carry no dates anywhere** — no "executed at", no step timestamps, no
dated output folder. Deliberate, at the user's instruction. Re-running the
generator overwrites the pack; `automation/results/` is the archive.

Brand assets go in `evidence-generator/assets/reyan-logo.png`. Present and
working. Without it the cover falls back to a typographic wordmark.

---

## Current state

**ServiceNow, 7 cases executed: 4 PASS, 3 FAIL.** All three failures are real
findings, not harness faults.

| Case | Result | |
|---|---|---|
| TC-SN-001 | PASS | `caf_conformance_type` references the relationship table, not the control table |
| TC-SN-006 | **FAIL** | Dictionary says `caf_tsk.state` is writable; the form reports it read-only |
| TC-SN-008 | PASS | Choice sets match, no inactive values |
| TC-SN-017 | **FAIL** | Two applications reported Compliant with four out-of-compliance controls each |
| TC-SN-059 | **FAIL** | Approval records created for 1 of 12 attestation tasks |
| TC-SN-067 | PASS | Orphan request correctly excluded from the grid |
| TC-SN-069 | PASS | Grid columns bound to the control table — Part A only; Part B is an unapproved write |

**Not executed:** every state-transition case, because they need a dedicated test
business application first (see the test-data rules in the ServiceNow file), and
the ⚠ ONE-SHOT ones consume records that cannot be reset.

### The three findings, in priority order

1. **TC-SN-017 — compliance roll-up is wrong.** `u_caf_compliance_status` reads
   `compliant` for SAP Fiori and SAP HANA while four of each application's six
   controls are `out_of_compliance`. Suspect: business rule
   `CAF - update BA when req compliant`, whose filter is
   `caf_statusCHANGESTOin_compliance` and which appears not to check siblings.
   **This falsifies HANDOFF §3**, and the Salesforce LWC is documented as
   mirroring the behaviour — so the same wrong answer is likely on both
   platforms. TC-INT-050 is written to determine which.
2. **TC-SN-059 — approval creation is inconsistent.** HANDOFF §6 says
   `sysapproval_approver` holds no CAF records; one now exists, on `CAFT0001002`,
   created by `system` (the flow). Eleven other attestation tasks have none.
3. **TC-SN-006 — dictionary and form disagree** about `caf_tsk.state`. Either
   TC-SN-026 needs rewriting, or a task cannot be started from the native form
   at all, which is an unstated workflow claim.

---

## Salesforce: what ran, 2026-08-07

**24 cases, 20 PASS / 3 FAIL / 1 BLOCKED**, across two specs. Neither writes to
either platform.

### The UI cases — `specs/integration-ui.spec.ts`, 7 of 7 PASS

Driven through Lightning, every screen assertion cross-checked against the
record underneath. Ten screenshots in the pack.

| Case | Result | |
|---|---|---|
| TC-INT-020 | PASS | Two labelled columns, each agreeing with its own platform |
| TC-INT-021 | PASS | Mismatch surfaced on `CAFT0001022` — **but see the finding below** |
| TC-INT-024 | PASS | Closed task reads *View evidence*, no upload, no Start, no Attest |
| TC-INT-036 | PASS | Row actions correct in all three states; approver's evidence copy read-only |
| TC-INT-048 | PASS | Every populated cell matches `caf_req.caf_status`; both grids captured together |
| TC-INT-051 | PASS | Drill-in lists exactly the tasks ServiceNow holds |
| TC-INT-053 | PASS | Strip at 255px, above the grid, resolved on load without Re-check |

**Start, Approve and Reject were read as controls and deliberately not clicked.**
Each writes through the attest endpoint and closes a task irreversibly.

**A finding TC-INT-021 passes over, and shouldn't.** The warning reads
*"1 in Salesforce, 2 in ServiceNow. Re-upload the missing file to send it to the
system of record."* `cafEvidence.mismatchLabel` is unconditional, and that advice
is correct only when Salesforce holds **more** than ServiceNow — a failed push.
Here ServiceNow holds more, so the system of record already has the file, and
following the advice creates a **third** ServiceNow attachment rather than
repairing anything. This is the only mismatch state that exists on the instance
today, so it is the one a user will actually meet. The label needs to branch on
which side is short. The case passes because its stated expectation — a warning,
worded informatively rather than alarmingly — is met.

### The record-only cases — `specs/integration-readonly.spec.ts`, 13 PASS / 3 FAIL / 1 BLOCKED

| Case | Result | |
|---|---|---|
| TC-INT-001 | PASS | 19 requests / 30 tasks, symmetric difference empty by number *and* by sys_id |
| TC-INT-006 | PASS | No Salesforce Id anywhere in ServiceNow, by field name or by value shape |
| TC-INT-008 | PASS | 30 tasks hold an empty mirrored field; zero reported as drift |
| TC-INT-017 | PASS | Inbound writes attributed to `sf.integration`; guard keys off that name |
| TC-INT-023 | PASS | 404 on an unknown task |
| TC-INT-037 | **FAIL** | One `sysapproval_approver` record exists, on `CAFT0001002` |
| TC-INT-038 | PASS | 49 records compared, zero differences |
| TC-INT-044 | **FAIL** | `Name` is mirrored, editable, and not compared by Sync Health |
| TC-INT-046 | PASS | Snapshot moves no `sys_updated_on`; payload key is `updated_on`, not `sys_updated_on` |
| TC-INT-047 | PASS | Repair only from a click; the three scheduled jobs are DE org furniture |
| TC-INT-049 | PASS | Both grids derive the same 6 columns today; the divergence is latent |
| TC-INT-050 | **FAIL** | The two platforms disagree — see below |
| TC-INT-054 | PASS | `RCAF0001001` present in both stores, drawn by neither grid |
| TC-INT-055 | BLOCKED | Both targets present; no Experience Cloud site in the org |
| TC-INT-059 | PASS | `ServiceNow_CAF` exact, no credential in source, secret is `password2` |
| TC-INT-060 | PASS | 527 of **15,000** calls used |
| TC-INT-061 | PASS | Zero unmanaged test classes, zero coverage |

### The three findings

1. **TC-INT-050 — the two platforms disagree, which is the worse of the two
   outcomes the case anticipated.** `u_caf_compliance_status` reads `compliant`
   for SAP Fiori and SAP HANA; the LWC renders **2 of 6** for both, because
   `cafDashboard.build()` computes its own roll-up from the mirrored
   `CAF_Status__c` values and never reads `u_caf_compliance_status`. The LWC is
   arithmetically right and ServiceNow is wrong, so this is one defect
   (TC-SN-017's business rule) surfacing as a visible contradiction rather than
   a faithfully mirrored error. **Fix the ServiceNow rule; the mirror needs no
   change.**

   Confirmed on screen when the UI harness was smoke-tested: the grid renders
   SAP Fiori and SAP HANA as amber **2 of 6**, Zscalar App as green
   **Compliant** — while the Sync Health strip immediately above reads
   *"In sync · 49 records verified"*. Both statements are true, which is what
   makes this hard to spot: no mirrored field disagrees, so Sync Health has
   nothing to report, and the contradiction lives between the grid and a field
   the grid never reads.

   A second, independent observation from the same case: `allGreen` compares
   against `controls.length`, the column count for the *whole grid*, not the
   number of controls that application has a request for. An application with
   fewer requests than there are columns can therefore never read Compliant.

2. **TC-INT-044 — `Name` is an editable mirrored field.**
   `CAFSalesforceSync.buildTaskPayload()` sets `Name` to the ServiceNow number on
   every push, the CAF Task layout leaves it editable, and `CafSyncHealth`
   compares Status, State, Approval, Criteria met and Description — never `Name`.
   Drift introduced by editing it is invisible until the next push overwrites it.
   Either make it Readonly or add it to the comparison. `State__c` is correctly
   the only *intentionally* editable one.

3. **TC-INT-037 — one approval record exists.** Same finding as TC-SN-059, now
   confirmed from the integration side: `CAFT0001002`, created by `system`.
   HANDOFF §6 says there are none. The finding the case exists to make is
   unaffected — no CAF approval record names a human approver, and the audit
   trail still records only `sf.integration`.

Two documentation corrections also came out of the pass, neither a defect:
the daily API budget is **15,000**, not the ~5,000 stated in HANDOFF §1 and both
case files; and the snapshot payload names its timestamp `updated_on`, while
HANDOFF §5 and TC-INT-046 both call it `sys_updated_on`. Nothing reads it today.

## Suite 9 — transform and data quality (ETL), 2026-08-08

**9 cases, 8 PASS / 1 FAIL.** `npm run int:etl` — reads both platforms, writes to
neither, needs no `sf.integration` credential, so it is re-runnable on any day.

The outbound push is an ETL, and suite 1 only asserts that records *arrive*.
These assert that what arrived still **means the same thing**: truncation
headroom, date conversion, the state code-to-label mapping, the denormalised
business application and control labels, the boolean cast, External Id
uniqueness, and parent and control join integrity.

**Re-run after the fix below: 9 of 9 PASS.**

### TC-INT-062 FAIL, then fixed — an orphan control column, and the retire rule's first real test

**Found on the first run, by the only check on this build that could have found
it.** Sync Health reconciles requests and tasks only, so nothing else looks at
the control catalogue.

`CAF_Control_Catalog__c` holds **Breath BR**, `Active__c = true`, against a
control that **does not exist in ServiceNow at all** — not inactive, absent. The
dashboard therefore renders a column of N/A for a control nobody can see.

syslog settles what happened, and it is not what HANDOFF section 6a assumed:

| Time | Event |
|---|---|
| 15:10:14 | Control inserted, pushed — `CNFTYPE0001004 -> CAF_Control_Catalog__c, HTTP 201` |
| 15:10:47 | Control deleted. *CAF - Retire Control in Salesforce* **fired**, and logged `[CAF->SF] token request failed, HTTP 0` at error level |
| — | No upsert followed. `Active__c` stayed `true` |

**The rule works; the push under it did not.** `_push` returns early when
`getToken()` yields null, and a failed push is fire-and-forget by design — so the
error went to the log and the orphan column appeared anyway. That is the exact
outcome the retire rule was built to prevent, and it is the third orphan control
on this build after "Renweal" and "Renewal".

Two things worth drawing out:

- **The synchronous retire rule is the most exposed caller of `getToken()`.** It
  runs inside the delete transaction, so a transport blip there has no retry and
  no queue behind it. The token succeeded 33 seconds earlier on the insert.
- **It cannot be repaired from ServiceNow.** Re-firing the rule needs the record,
  and the record is gone. The repair was a direct Salesforce write —
  `Active__c = false`, which is what the rule would have done.

### What was changed so it cannot recur silently

The credential was never at fault: a probe 16 minutes later returned `HTTP 200`,
so the token failure was transient. Three changes, all live and verified:

| Change | Where |
|---|---|
| Retry once on a token failure, and once on a transport-level (`status 0`) upsert failure. A 4xx is a rejection and is not retried | `CAFSalesforceSync._push` |
| Snapshot returns every control, so the catalogue is comparable at all | `CAF Integration - Sync Snapshot` |
| `/caf/resync` accepts `control` | `CAF Integration - Resync Record` |
| Sync Health reconciles the catalogue and reports an **active** orphan | `CafSyncHealth.compareControls` |
| The strip counts controls in its summary | `cafSyncHealth.js` |

**Verified by inducing the defect**, not by assuming: flipping the retired row
back to `Active__c = true` produced exactly one difference — *"Active in
Salesforce, deleted in ServiceNow"*, `canResync = false` — and flipping it back
returned the report to green. Sync Health now compares **56** records: 19
requests, 31 tasks, 6 controls.

Two details in that comparison are load-bearing. It keys on `sys_id`, because
control **numbers are not unique** on this instance — `CNFTYPE0001004` and
`CNFTYPE0001005` each name two different controls. And a *retired* orphan is
deliberately not a difference: `Active__c = false` with no ServiceNow counterpart
is the mirrored-delete design working, and reporting it would flag correct
behaviour as a defect.

*Related and still true: "Renewal" shows `Active__c = false`, so the retire rule
has also been observed working end to end.*

### The other eight

All PASS. Worth keeping the numbers, because several are early warnings rather
than assertions that can only ever be true:

- **TC-INT-064** — longest `short_description` is well inside the 255 the
  transform truncates at, and the longest control name inside 80. If one ever
  exceeds it, Sync Health compares the raw source against the truncated copy and
  reports drift **permanently** — Re-sync re-truncates to the identical value, so
  it can never clear.
- **TC-INT-065** — every mirrored date matches `_toIso(source)`, and every source
  matches the `yyyy-MM-dd HH:mm:ss` shape `_toIso` assumes without validating.
- **TC-INT-066** — every state in use maps to a label. `_stateLabel`'s default
  branch passes unmapped values through, so a new choice would publish a bare
  number into a label field rather than failing.
- **TC-INT-067 / 068** — no stale denormalised business application or control
  label, and every control join resolves. Both are snapshot-at-push-time values
  that Sync Health never compares.

## Pending

**37 cases. Every one of them writes.** Nothing here is blocked on tooling or on
knowledge — the harness covers all three groups, including the write verbs in
`lib/cafapi.ts`, which are written and unused. What each needs is a decision.

**Negative-path API cases (8) — written; executed 2026-08-08, all 8 BLOCKED.**
Not a result: the run never reached the endpoints. `GET /caf/snapshot` answered
**401 "User is not authenticated"** for every case, because the
`SF_INTEGRATION_PASSWORD` supplied was wrong. Re-run once the correct one is in
`.env`. Three things that run established, and are worth not rediscovering:

- **The integration itself is healthy.** An Apex probe through the
  `ServiceNow_CAF` named credential — `NamedUser`, protocol `Password`, username
  `sf.integration` — returned **200** against the same endpoint. The 401 was the
  test harness's credential, not the platform's.
- **Basic auth is restricted on this instance**, enforced from
  **2026-08-07 11:32:14**: `glide.authenticate.basic_auth.restriction.enforce`
  and `.active` are true and `allowed_roles` is `snc_basic_auth_api_access`,
  which only *Telemetry Sync User* holds. **This is why admin basic auth returns
  401** — the behaviour HANDOFF section 8 records without a cause.
  `sf.integration` is exempt via `allow_wsao=true` (it is
  `web_service_access_only`), which is why the named credential is unaffected.
  Any *new* integration user will need that role or the WSAO flag.
- **A 401 is indistinguishable from a working refusal at the status-code level**,
  so the spec now checks reachability once and records BLOCKED rather than
  letting eight cases report FAIL for one cause. A case that could not run has
  not failed.

TC-INT-013/014/015,
TC-INT-032/033/034/035, and the refusal half of TC-INT-029. Every one is
*expected to be refused*, so none writes anything, and each re-reads the record
afterwards to prove `sys_updated_on` is unmoved. They send write-shaped HTTP
though, so they sit behind the write rule in [CLAUDE.md](../CLAUDE.md).
TC-INT-013 is fourth on the pack's own priority list.

The specs now exist as `specs/integration-negative.spec.ts` on its own
`int-neg` project, so `npm run int` stays the pass anyone can run on any day and
opting into these is an explicit act. **Executing them still needs the user's
confirmation.** Four points worth knowing before that run:

- **Fixtures are discovered, not pinned.** Each case queries for a task in the
  state it needs, because closing one spawns the next and a pinned `sys_id`
  would eventually address a task in the wrong state and pass for the wrong
  reason. Where no suitable task exists the case records **BLOCKED** rather than
  writing one into existence.
- **TC-INT-034 is expected to block.** It needs an active, In Progress task
  already carrying an outcome; every attestation on this instance closes the
  task, so the state is reachable only by setting `approval` directly.
- **TC-INT-013 sends a canary first.** The documented body pairs `state` with a
  refused field, so a broken whole-call refusal would start a task and move its
  parent request. The canary pairs `comments` with the refused field instead:
  same branch, and the damage on failure is a stray comment. The six documented
  sub-cases only run once the canary is refused cleanly.
- **"Empty body" is not `{}`.** TC-INT-015 sends no body at all. An empty object
  is truthy, so it passes the resource's emptiness check, reaches `gr.update()`
  and fires the two reconcile upserts — a no-op write rather than a refusal.

**Reversible writes (12).** TC-INT-002/003/005/007/009/010/011/012,
TC-INT-039/040/043, TC-INT-052. These change state and change it back — the
drift demo on `CAFT0001046` is the documented repeatable one.
TC-INT-009/010/041/043 need the kill switch off and back to `true`.

**One-shot (17).** TC-INT-004/027/028/031/041/042/049B and the write halves of
the evidence and attestation cases. These consume records that cannot be reset —
including the flagship journey on `CAFT0001001`, and TC-INT-031, still the case
most likely to find something genuinely unknown.

### Harness as it now stands — complete

| | |
|---|---|
| `lib/cnit.ts` | ServiceNow reads without a browser, `-ExcludeRefLinks` always on |
| `lib/salesforce.ts` | SOQL, describe, org limits, Tooling API, anonymous Apex |
| `lib/cafapi.ts` | The inbound Scripted REST API as `sf.integration`; write verbs written and unused |
| `lib/lightning.ts` | The Lightning UI — grid, Sync Health strip, drill-in, task actions, evidence panel |
| `auth/salesforce.setup.ts` | Passwordless login via the CLI's OAuth grant |

Four Playwright projects: `sn` (ServiceNow UI), `int` (no login at all),
`sf-setup`, `sf-ui`. `npm run sf:smoke` exercises every Lightning selector
read-only and fails loudly if a template rename breaks one — run it before a UI
pass so a real case never fails for a harness reason.

**Nothing is left to build.** The remaining 44 cases need the decisions above,
not more tooling.

#### Four things about Lightning worth not rediscovering

- **The LWCs render into *native* shadow roots.** Playwright's CSS engine
  pierces them, so `page.locator('table.grid')` works. Raw DOM traversal inside
  `evaluate()` does **not** — `host.querySelector()` returns null for everything
  in the shadow root, and the scrape reports an empty grid, which reads as "the
  LWC has no data" rather than "the scrape looked in the wrong place". Every
  `evaluate()` in `lib/lightning.ts` starts from `shadowRoot ?? el`.
- **`hasTasks` is false on first render**, so the drill-in panel always shows
  *"No tasks mirrored for this request yet"* before the `@wire` resolves.
  Racing the task table against that paragraph always resolves to the
  paragraph. Wait for the table alone and let the wait expire — an expiry is
  then a real empty result.
- **Both `cafDashboard` and `cafSyncHealth` contain a `table`**, and the former
  contains the latter. Scope every selector to its component root or a
  confident assertion passes against the wrong table.
- **`cafEvidence`'s heading is a prop and renders instantly; both file lists
  arrive later** — Salesforce Files from a wire, ServiceNow attachments from a
  callout. Waiting on the heading is not waiting on the panel: it reported 0 and
  0 for a task holding 1 Salesforce file and 2 ServiceNow attachments, which
  reads as *the integration lost the evidence* rather than *the scrape was
  early*. Wait for `Reading evidence…` to clear.

  A related trap on the verification side: query task files through
  **`ContentDocumentLink`**, not `FirstPublishLocationId`. A file uploaded by
  `lightning-file-upload` is *linked* to the record and its publish location is
  not necessarily that record, so the wrong query returns zero — and agrees with
  a broken scrape.

### Constraints that shape the work

- **Developer Edition allows 15,000 API calls per 24 hours** — measured from the
  org on 2026-08-07, correcting the ~5,000 stated elsewhere in this pack. One
  end-to-end journey costs ~45; the whole read-only pass costs about 40. `sf`
  deploys and Workbench draw on the same budget, so do not run a full pass on a
  heavy build day. `sf org list limits --target-org caf-sf` gives the figure.
- **Kill switch:** `x_gskn2_caf_compli.sf.enabled = false` stops all outbound
  push. Several drift cases use it deliberately. **Confirm it is back to `true`
  before anything else.** Verified `true` on 2026-08-07.
- **Deletes propagate in neither direction**, and mid-cleanup is hazardous:
  updating a not-yet-deleted ServiceNow record recreates its Salesforce twin
  (TC-INT-058).
- **No Apex test coverage** on the three service classes — fine for DE, blocking
  for production, since Salesforce requires 75% to deploy.

### Highest-value integration cases, if time is short

**TC-INT-016** (the explicit reconcile — silent failure, hardest-won fix),
**TC-INT-027** (flagship attestation journey), **TC-INT-030** (evidence visible
in Salesforce but the gate refuses), **TC-INT-013** (allow-list refuses the whole
call), **TC-INT-031**.

~~TC-INT-050~~ is **done** — the LWC contradicts ServiceNow rather than
repeating its defect. See the findings above.

**TC-INT-031 is most likely to find something genuinely unknown.** Closing a task
spawns the next one via a flow, inside the transaction attributed to
`sf.integration` — which the echo-loop guard skips. The explicit reconcile pushes
the attested task and its parent, **not the sibling the flow just created.** So
flow-spawned tasks may never reach Salesforce. Not checked.

---

## Harness facts worth not rediscovering

- **The Table API needs `X-UserToken`.** Session cookie alone returns 401, and
  **HTTP basic auth also returns 401** on this instance even with valid
  credentials. The token is `window.g_ck`, captured at setup and cached. It is
  present on the landing page, classic list and form pages, and `/caf` — but not
  on `about:blank` or `/blank.do`.
- **Playwright restarts its worker after a failed test**, resetting module state.
  Evidence is therefore written one JSON file per case, never accumulated in
  memory — the first design silently lost every case before the first failure.
- **`^OR` binds only to the condition immediately before it.** `name=a^element=x^ORname=b^element=x`
  does not mean what it reads as; use `nameINa,b^element=x`.
- **Forms render standalone** at `<table>.do?sys_id=…` — no `gsft_main` iframe,
  cleaner screenshots. The nav-shell path does not work on this instance.
- **`g_form` is reachable** from the top-level document, so read-only, mandatory
  and UI-policy state can be asserted directly and compared against the record.
- **The `/caf` grid is at `?id=caf_apps`.** Plain `/caf` is a landing page with
  three tiles; the *View Apps* tile is an Angular `javascript:void(0)` handler
  that cannot be clicked through reliably.
- **The generator skips documents open in Word** rather than aborting the build,
  and names them at the end.
- Playwright config is **serial, one worker, zero retries** — this suite writes to
  a live instance with automation on every table, and a retry that passes on the
  second attempt hides a real flake.

## Data hazards

- **`cnit` has no delete verb.** Cancellation (`state=-1`) is the exit route;
  records still accumulate.
- **Two business applications are named "SAP HANA"** — one with data
  (`6e816834…398`), one `not_ini` (`5470cc85…372`). Select by `sys_id`.
- **`RCAF0001001`** has no business application and no control, so it never
  appears in either grid. Expected — do not raise it.
- Baseline as at 2026-08-07: **19 requests, 30 tasks, 6 active controls, 62 rows
  in the portal grid.** Verify rather than trusting these before a formal pass.
