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

