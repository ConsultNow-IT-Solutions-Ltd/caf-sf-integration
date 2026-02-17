# CAF POC — session handoff

**Written 2026-08-06.** Read this first, then
[CAF_Salesforce_Split_Handoff.md](CAF_Salesforce_Split_Handoff.md) for the
architecture and [CLAUDE.md](CLAUDE.md) for working rules in this folder.

A working ServiceNow ↔ Salesforce round trip exists and is demonstrable. This
document is the state of it, the decisions that got there, and the traps that
cost time so they do not cost it twice.

---

## Environments

| | Detail |
|---|---|
| ServiceNow | `dev281754.service-now.com`, scoped app **CAF Compliance** `x_gskn2_caf_compli` v1.0.0 |
| Salesforce | `orgfarm-4938c7f768-dev-ed` Developer Edition, API v67.0 (Summer '26) |
| SF UI | `https://orgfarm-4938c7f768-dev-ed.develop.lightning.force.com` |
| SF API | `https://orgfarm-4938c7f768-dev-ed.develop.my.salesforce.com` |
| SF user | `admin.070b86ccf531@agentforce.com` |

**Always** query ServiceNow through the cnit profile `caf-reyan`. The machine
default profile points at a different PDI:

```powershell
& "C:\Users\patel\Documents\ServiceNow Work Project Docs\Shared\cnit-instance-tools\cnit.ps1" <cmd> -ProfileName caf-reyan
```

---

## What works today

**Outbound, ServiceNow → Salesforce.** Async business rules on `caf_req` and
`caf_tsk` call `CAFSalesforceSync`, which upserts into Salesforce on the External
Id `ServiceNow_Sys_Id__c`. Verified idempotent: a second push of every record
left the counts unchanged.

**Inbound, Salesforce → ServiceNow.** `PATCH /api/x_gskn2_caf_compli/caf/task/{sysId}`,
basic auth as `sf.integration`, allow-listing six fields and refusing the whole
call on anything else. Apex `CafTaskService.applyChange` calls it through the
`ServiceNow_CAF` named credential. Verified end to end from Apex.

**Dashboard.** LWC `cafDashboard` on the **CAF Dashboard** tab: business
applications as rows, CAF Controls as dynamic columns, colour-coded dots, plus
drill-in to a request's tasks with Start / Criteria met actions.

**Sync Health.** LWC `cafSyncHealth`, a strip above the grid that asks
ServiceNow for its own view and compares. Green with a record count when the two
agree; when they do not it lists each difference — record, field, both values —
with a Re-sync button that re-pushes from ServiceNow. Added 2026-08-07;
detail below under "Sync Health, in full".

Data mirrored: **19 requests and 27 tasks, both sides, set-for-set identical** —
compared by number over the two CLIs on 2026-08-07, not just by count.

**Salesforce CLI**, installed 2026-08-07, org authorised as alias `caf-sf`, so
the Salesforce side is now queryable from this folder the way cnit queries
ServiceNow. Usage in [CLAUDE.md](CLAUDE.md).

Detail in [servicenow/SETUP.md](servicenow/SETUP.md) and
[salesforce/README.md](salesforce/README.md); those are the operating references
and are current.

---

