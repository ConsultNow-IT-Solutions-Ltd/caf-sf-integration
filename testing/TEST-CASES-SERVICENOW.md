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
| Instance | `dev281754.service-now.com` |
| Baseline captured | 2026-08-07, direct from instance metadata |
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
& "C:\Users\patel\...\cnit.ps1" get <table> -ProfileName caf-reyan -Query "<encoded>" -Fields <fields> -ExcludeRefLinks
```

Abbreviated below to `cnit get …`. `-ProfileName caf-reyan` is never optional —
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

