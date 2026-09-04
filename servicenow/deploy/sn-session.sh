#!/bin/sh
# Session helpers for driving a ServiceNow instance from the shell.
#
# Basic auth is refused for the admin account on dev249570 (401, with the web
# login working and the password correct), so everything here goes through a
# login.do session: a JSESSIONID cookie plus the g_ck user token scraped from a
# UI page and sent as X-UserToken. Ordinary accounts such as sf.integration
# authenticate over basic auth normally - it is the admin account that is
# refused, so the inbound integration is unaffected by this.
#
# Credentials come from the environment; nothing here is committed with a
# password in it:
#
#   export SN_HOST=https://dev249570.service-now.com
#   export SN_USER=admin
#   export SN_PASS='...'
#   . ./sn-session.sh && sn_login
#
# Then:
#   sn_bg   <script.js>              run server-side JS in the global scope
#   sn_bgs  <script.js> <scope_id>   run server-side JS inside an app scope
#   sn_api  GET /api/now/table/...   call the REST API as the session user

: "${SN_HOST:?set SN_HOST}"
: "${SN_USER:?set SN_USER}"
: "${SN_PASS:?set SN_PASS}"

SN_JAR="${SN_JAR:-./.sn-cookies}"
SN_CK_FILE="${SN_CK_FILE:-./.sn-token}"

sn_login() {
    rm -f "$SN_JAR"
    curl -s -c "$SN_JAR" "$SN_HOST/login.do" -o /tmp/sn_l1.html
    tok=$(grep -o 'sysparm_ck[^>]*value="[^"]*"' /tmp/sn_l1.html \
          | sed 's/.*value="//;s/"//' | head -1)
    curl -s -b "$SN_JAR" -c "$SN_JAR" -L -o /dev/null -X POST "$SN_HOST/login.do" \
        --data-urlencode "user_name=$SN_USER" \
        --data-urlencode "user_password=$SN_PASS" \
        --data-urlencode "sys_action=sysverb_login" \
        --data-urlencode "sysparm_ck=$tok"
    curl -s -b "$SN_JAR" -c "$SN_JAR" "$SN_HOST/sys_properties_list.do" -o /tmp/sn_ui.html
    grep -o "g_ck *= *'[^']*'" /tmp/sn_ui.html | head -1 \
        | sed "s/.*'\(.*\)'/\1/" > "$SN_CK_FILE"
    n=$(tr -d '\n' < "$SN_CK_FILE" | wc -c)
    if [ "$n" -lt 10 ]; then echo "login FAILED (no g_ck)" >&2; return 1; fi
    echo "logged in to $SN_HOST as $SN_USER"
}

# Strip the Scripts-Background HTML response down to readable output.
_sn_detag() {
    sed -e 's/<br[^>]*>/\n/gI' -e 's/<[^>]*>//g' \
        -e 's/&gt;/>/g' -e 's/&lt;/</g' -e 's/&quot;/"/g' \
        -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g' \
    | grep -v '^[[:space:]]*$'
}

# sn_bg <script.js> - runs in the global scope. gs.print works here.
sn_bg() {
    curl -s -b "$SN_JAR" -X POST "$SN_HOST/sys.scripts.do" \
        --data-urlencode "script@$1" \
        --data-urlencode "sysparm_ck=$(cat "$SN_CK_FILE")" \
        --data-urlencode "runscript=Run Script" \
        --data-urlencode "quota_managed_transaction=on" | _sn_detag
}

# sn_bgs <script.js> <scope_sys_id> - runs inside an application scope.
#
# Needed for anything that reads or writes the scoped CAF tables: a global
# script is refused by the table's cross-scope access policy. Note that gs.print
# is not available in a scoped script - use gs.info instead.
sn_bgs() {
    curl -s -b "$SN_JAR" -X POST "$SN_HOST/sys.scripts.do" \
        --data-urlencode "script@$1" \
        --data-urlencode "sysparm_ck=$(cat "$SN_CK_FILE")" \
        --data-urlencode "runscript=Run Script" \
        --data-urlencode "quota_managed_transaction=on" \
        --data-urlencode "sys_scope=$2" | _sn_detag
}

# sn_api METHOD /path [json-body]
sn_api() {
    if [ -n "$3" ]; then
        curl -s -b "$SN_JAR" -H "X-UserToken: $(cat "$SN_CK_FILE")" \
            -X "$1" "$SN_HOST$2" -H 'Content-Type: application/json' \
            -H 'Accept: application/json' --data-binary "$3"
    else
        curl -s -b "$SN_JAR" -H "X-UserToken: $(cat "$SN_CK_FILE")" \
            -X "$1" "$SN_HOST$2" -H 'Accept: application/json'
    fi
}

# The app's scope sys_id, for sn_bgs.
sn_scope_id() {
    sn_api GET "/api/now/table/sys_app?sysparm_query=scope%3Dx_gskn2_caf_compli&sysparm_fields=sys_id&sysparm_limit=1" \
    | sed -n 's/.*"sys_id":"\([0-9a-f]*\)".*/\1/p'
}
