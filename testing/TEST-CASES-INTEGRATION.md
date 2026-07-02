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

