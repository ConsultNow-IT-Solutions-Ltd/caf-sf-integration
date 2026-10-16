"""Deploy the CAF integration code artifacts over the Table API.

Posts the two Script Includes, the four push Business Rules and the CAF
Integration Scripted REST API - definition plus six operations - from the .js
files in servicenow/, which are the source of truth for all of them.

Basic auth is refused for the admin account on dev249570, so this drives a UI
session (login.do -> JSESSIONID + g_ck) exactly as a browser would.

IMPORTANT: records created over the Table API take their scope from the
session's current application, NOT from a sys_scope field in the payload. Run
05_choices_and_display.js ... 06_properties_and_user.js first, and make sure the
admin's apps.current_app user preference points at the CAF app, or the Script
Includes land in global with api_name=global.CAFSalesforceSync and the REST API
comes up on /api/<numeric>/caf instead of /api/x_gskn2_caf_compli/caf.

Credentials come from the environment:
    export SN_HOST=https://dev249570.service-now.com
    export SN_USER=admin
    export SN_PASS='...'
    python 09_deploy_code.py
"""
import http.cookiejar
import json
import os
import pathlib
import re
import urllib.parse
import urllib.request

HOST = os.environ["SN_HOST"]
USER = os.environ["SN_USER"]
PASS = os.environ["SN_PASS"]
SCOPE = "x_gskn2_caf_compli"
# The .js sources live in the parent directory of this script.
SRC = str(pathlib.Path(__file__).resolve().parent.parent)

GUARD = ("gs.getUserName() != gs.getProperty("
         "'x_gskn2_caf_compli.sf.integration_user', 'sf.integration')")

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
CK = None


def raw(url, data=None, headers=None, method=None):
    req = urllib.request.Request(url, data=data, method=method)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with opener.open(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def login():
    global CK
    page = raw(f"{HOST}/login.do")
    m = re.search(r'sysparm_ck[^>]*value="([^"]*)"', page)
    body = urllib.parse.urlencode({
        "user_name": USER, "user_password": PASS,
        "sys_action": "sysverb_login", "sysparm_ck": m.group(1) if m else "",
    }).encode()
    raw(f"{HOST}/login.do", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    ui = raw(f"{HOST}/sys_properties_list.do")
    m = re.search(r"g_ck\s*=\s*'([^']*)'", ui)
    if not m:
        raise SystemExit("login failed - no g_ck")
    CK = m.group(1)
    print(f"logged in, g_ck len={len(CK)}")


def api(method, path, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    txt = raw(f"{HOST}{path}", data=data, method=method, headers={
        "X-UserToken": CK, "Accept": "application/json",
        "Content-Type": "application/json",
    })
    return json.loads(txt) if txt.strip() else {}


def find(table, query, fields="sys_id,name"):
    q = urllib.parse.quote(query, safe="")
    r = api("GET", f"/api/now/table/{table}?sysparm_query={q}"
                   f"&sysparm_fields={fields}&sysparm_limit=1")
    res = r.get("result") or []
    return res[0] if res else None


def upsert(table, query, payload, label):
    hit = find(table, query)
    if hit:
        api("PUT", f"/api/now/table/{table}/{hit['sys_id']}", payload)
        print(f"  UPDATED {label} -> {hit['sys_id']}")
        return hit["sys_id"]
    r = api("POST", f"/api/now/table/{table}", payload)
    res = r.get("result")
    if not res:
        print(f"  FAILED  {label}: {json.dumps(r)[:300]}")
        return None
    print(f"  CREATED {label} -> {res['sys_id']}")
    return res["sys_id"]


def src(fn):
    with open(os.path.join(SRC, fn), encoding="utf-8") as f:
        return f.read()


login()

app = find("sys_app", f"scope={SCOPE}")
if not app:
    raise SystemExit("scoped app not found")
APP = app["sys_id"]
print(f"app scope sys_id = {APP}\n")

# ---------------------------------------------------------------- includes
print("Script Includes")
upsert("sys_script_include", "name=CAFSalesforceSync", {
    "name": "CAFSalesforceSync",
    "script": src("CAFSalesforceSync.script-include.js"),
    "description": "Outbound push of CAF Requests, Tasks and Controls into Salesforce, "
                   "upserting on the External Id field ServiceNow_Sys_Id__c.",
    "client_callable": "false",
    "access": "package_private",
    "active": "true",
    "sys_scope": APP,
}, "CAFSalesforceSync")

upsert("sys_script_include", "name=caf_short_desc", {
    "name": "caf_short_desc",
    "script": src("caf_short_desc.script-include.js"),
    "description": "GlideAjax helper that builds the CAF Request short description.",
    "client_callable": "true",
    "access": "package_private",
    "active": "true",
    "sys_scope": APP,
}, "caf_short_desc")

# ----------------------------------------------------------- business rules
print("\nBusiness Rules")
T = "x_gskn2_caf_compli_"
rules = [
    # name, table, when, insert, update, delete, source file
    ("CAF - Push Request to Salesforce", T + "caf_req", "async_always",
     True, True, False, "CAF - Push Request to Salesforce.business-rule.js"),
    ("CAF - Push Control to Salesforce", T + "caf_conformance_type", "async_always",
     True, True, False, "CAF - Push Control to Salesforce.business-rule.js"),
    ("CAF - Retire Control in Salesforce", T + "caf_conformance_type", "after",
     False, False, True, "CAF - Retire Control in Salesforce.business-rule.js"),
]
for name, table, when, ins, upd, dele, fn in rules:
    upsert("sys_script", f"name={name}^collection={table}", {
        "name": name,
        "collection": table,
        "when": when,
        "order": "1000",
        "active": "true",
        "action_insert": str(ins).lower(),
        "action_update": str(upd).lower(),
        "action_delete": str(dele).lower(),
        "action_query": "false",
        "condition": GUARD,
        "script": src(fn),
        "sys_scope": APP,
    }, name)

# The Push Task rule is documented in servicenow/SETUP.md and TDD line 809 but
# has no source file in the repo. Body reconstructed from the Push Request rule,
# which it mirrors exactly apart from the method called.
push_task_script = src("CAF - Push Request to Salesforce.business-rule.js") \
    .replace("CAF - Push Request to Salesforce", "CAF - Push Task to Salesforce") \
    .replace("CAF Request [x_gskn2_caf_compli_caf_req]",
             "CAF Task [x_gskn2_caf_compli_caf_tsk]") \
    .replace("pushRequest(current)", "pushTask(current)") \
    .replace("roll back a legitimate CAF Request.",
             "roll back a legitimate CAF Task.")
assert "pushTask(current)" in push_task_script
upsert("sys_script",
       f"name=CAF - Push Task to Salesforce^collection={T}caf_tsk", {
           "name": "CAF - Push Task to Salesforce",
           "collection": T + "caf_tsk",
           "when": "async_always",
           "order": "1000",
           "active": "true",
           "action_insert": "true",
           "action_update": "true",
           "action_delete": "false",
           "action_query": "false",
           "condition": GUARD,
           "script": push_task_script,
           "sys_scope": APP,
       }, "CAF - Push Task to Salesforce (reconstructed)")

# -------------------------------------------------------- scripted REST API
print("\nScripted REST API")
ws = upsert("sys_ws_definition", "service_id=caf", {
    "name": "CAF Integration",
    "service_id": "caf",
    "short_description": "Inbound Salesforce -> ServiceNow resources for the CAF integration.",
    "active": "true",
    "enforce_acl": "",
    "sys_scope": APP,
}, "CAF Integration (definition)")

ops = [
    # name, method, relative_path, source file
    ("Update Task",     "PATCH", "/task/{sysId}",
     "CAF Integration - Update Task.scripted-rest.js"),
    ("Sync Snapshot",   "GET",   "/snapshot",
     "CAF Integration - Sync Snapshot.scripted-rest.js"),
    ("Resync Record",   "POST",  "/resync/{type}/{sysId}",
     "CAF Integration - Resync Record.scripted-rest.js"),
    ("Upload Evidence", "POST",  "/task/{sysId}/evidence",
     "CAF Integration - Upload Evidence.scripted-rest.js"),
    ("List Evidence",   "GET",   "/task/{sysId}/evidence",
     "CAF Integration - List Evidence.scripted-rest.js"),
    ("Attest Task",     "POST",  "/task/{sysId}/attest",
     "CAF Integration - Attest Task.scripted-rest.js"),
]
for name, method, path, fn in ops:
    upsert("sys_ws_operation",
           f"web_service_definition={ws}^relative_path={path}^http_method={method}", {
               "name": name,
               "web_service_definition": ws,
               "http_method": method,
               "relative_path": path,
               "operation_script": src(fn),
               "active": "true",
               "requires_authentication": "true",
               "requires_acl_authorization": "false",
               "produces": "application/json",
               "consumes": "application/json",
               "sys_scope": APP,
           }, f"{method} {path}  ({name})")

print("\ndone")
