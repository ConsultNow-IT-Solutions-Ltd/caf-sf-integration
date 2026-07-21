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

