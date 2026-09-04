# Rebuilding the CAF app on a bare instance

These scripts stood the application up on **dev249570** on 2026-09-04, after the
previous instance (dev281754) was reclaimed. Run in order against an empty PDI
they produce the scope, the roles, the data model, the properties, the
integration user, the navigation, and the whole integration layer.

**What they do not produce is the compliance engine.** The 24 business rules, the
2 flows, the 7 client scripts, the 6 UI policies, the 48+ ACLs, the 8
notifications and the Service Portal exist in the technical design document only
as one-line descriptions - no source for them survives in this repo. See
"What is missing" in [../SETUP.md](../SETUP.md).

## Before you start

```sh
export SN_HOST=https://dev249570.service-now.com
export SN_USER=admin
export SN_PASS='...'
. ./sn-session.sh && sn_login
```

`sn-session.sh` explains why this goes through a `login.do` session rather than
basic auth, and gives you `sn_bg`, `sn_bgs` and `sn_api`.

## Order

| | Script | How | What it makes |
|---|---|---|---|
| 1 | `01_app.js` | `sn_bg` | `x_gskn2_caf_compli` scope, "CAF Compliance" 1.0.0 |
| 2 | `02_roles.js` | `sn_bg` | JS level to Helsinki ES5; the 6 `caf_*` roles |
| 3 | `03_tables.js` | `sn_bg` | the 5 tables, auto-number `CAFC`/`RCAF`/`CAFT` |
| 4 | `04_fields.js` | `sn_bg` | 65 fields, plus `u_caf_compliance_status` on the CMDB business app |
| 5 | `05_choices_and_display.js` | `sn_bg` | `u_emergency_tier`, 51 choices, display fields |
| 6 | `06_properties_and_user.js` | `sn_bg` | the 6 `sf.*` properties, the `sf.integration` user and its roles |
| 7 | `07_navigation.js` | `sn_bg` | the **CAF Compliance** menu and its 5 modules |
| 8 | `09_deploy_code.py` | `python` | 2 Script Includes, 4 Business Rules, the Scripted REST API |
| 9 | `08_seed_demo_data.js` | `sn_bgs <scope_id>` | one control, relationship, request and two tasks |
| 10 | `verify_api.sh` | `sh` | exercises all six inbound resources |

Steps 1-7 are `sn_bg` (global scope). Step 9 is `sn_bgs` and needs the scope
sys_id from `sn_scope_id` - a global script is refused against the scoped CAF
tables by the cross-scope access policy, and inside a scope `gs.print` is
unavailable, which is why that one file uses `gs.info`.

Every script is idempotent: each checks for its records before creating them, so
a re-run reports what already exists rather than duplicating it.

## Two traps that cost real time

**Scope is taken from the session, not from your payload.** Records created over
the Table API ignore a `sys_scope` field and inherit the session's current
application. First time round this put both Script Includes in global with
`api_name=global.CAFSalesforceSync`, and put the REST API on
`/api/2190943/caf` instead of `/api/x_gskn2_caf_compli/caf` - so every business
rule calling `x_gskn2_caf_compli.CAFSalesforceSync` would have failed at
runtime. `06_properties_and_user.js` sets the admin's `apps.current_app`
preference, which is what fixes it; run it before `09_deploy_code.py`. Records
created by `sn_bg` with an explicit `sys_scope` are not affected.

**Tables alone are invisible.** Creating the tables gets you nothing in the
navigator - there is no application menu until `07_navigation.js` makes one, and
the tables simply cannot be reached in the UI before that. This is the same
blind spot [../SETUP.md](../SETUP.md) records on the Salesforce side, where an
object created over the Metadata API gets no tab and never appears in the App
Launcher.

## Checking it

```sh
export SF_INT_PASS='...'
export CAF_TASK=<sys_id>      # printed by 08_seed_demo_data.js
export CAF_REQUEST=<sys_id>
./verify_api.sh
```

17 cases, one per row of the result tables in [../SETUP.md](../SETUP.md). Run it
against a freshly seeded task - it walks that one task Open -> In Progress ->
attested, so a second run correctly returns 409 on the final two cases.
