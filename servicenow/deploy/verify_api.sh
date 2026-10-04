#!/bin/sh
# Exercise every inbound resource as sf.integration and check each response
# against the result column of the tables in servicenow/SETUP.md.
#
#   export SN_HOST=https://dev249570.service-now.com
#   export SF_INT_PASS='...'          # the sf.integration password
#   export CAF_TASK=<sys_id>          # a task in state Open with no attachment
#   export CAF_REQUEST=<sys_id>       # its parent request
#   ./verify_api.sh
#
# Run it against a FRESH task. The suite is deliberately single-shot: it walks
# one task Open -> In Progress -> attested, so a second run against the same
# task correctly returns 409 (outcome already recorded) on the last two attest
# cases. That is the gate working, not a regression.
#
# 08_seed_demo_data.js prints sys_ids suitable for CAF_TASK / CAF_REQUEST.

: "${SN_HOST:?set SN_HOST}"
: "${SF_INT_PASS:?set SF_INT_PASS}"
: "${CAF_TASK:?set CAF_TASK to a CAF Task sys_id}"
: "${CAF_REQUEST:?set CAF_REQUEST to a CAF Request sys_id}"

B="$SN_HOST/api/x_gskn2_caf_compli/caf"
TASK="$CAF_TASK"
REQ="$CAF_REQUEST"
BAD=deadbeefdeadbeefdeadbeefdeadbeef
pass=0; fail=0

c() { # c <expected> <label> <curl args...>
  exp="$1"; lbl="$2"; shift 2
  out=$(curl -s -w '\n@@%{http_code}' -u "sf.integration:$SF_INT_PASS" \
        -H 'Content-Type: application/json' "$@")
  code=$(printf '%s' "$out" | sed -n 's/.*@@//p' | tail -1)
  body=$(printf '%s' "$out" | sed 's/\n*@@[0-9]*$//' | head -c 220)
  if [ "$code" = "$exp" ]; then mark="PASS"; pass=$((pass+1))
  else mark="FAIL"; fail=$((fail+1)); fi
  printf '%-4s %-3s (want %-3s)  %s\n       %s\n' "$mark" "$code" "$exp" "$lbl" "$body"
}

echo "=== Sync Snapshot ==="
c 200 "GET /snapshot" "$B/snapshot"

echo "=== Update Task (allow-list) ==="
c 200 "PATCH /task allowed field (comments)" -X PATCH "$B/task/$TASK" \
  -d '{"comments":"Set from the Salesforce side."}'
c 400 "PATCH /task non-writable field (number)" -X PATCH "$B/task/$TASK" \
  -d '{"number":"CAFT9999999"}'
c 404 "PATCH /task unknown sys_id" -X PATCH "$B/task/$BAD" \
  -d '{"comments":"x"}'

echo "=== Attestation gates ==="
c 409 "POST /attest while task is Open" -X POST "$B/task/$TASK/attest" \
  -d '{"met_criteria":"yes","outcome":"approved","comments":"too early"}'
c 200 "PATCH /task state -> In Progress (2)" -X PATCH "$B/task/$TASK" \
  -d '{"state":"2"}'
c 428 "POST /attest with no attachment" -X POST "$B/task/$TASK/attest" \
  -d '{"met_criteria":"yes","outcome":"approved","comments":"no evidence yet"}'

echo "=== Evidence ==="
c 200 "GET /evidence (empty)" "$B/task/$TASK/evidence"
c 201 "POST /evidence" -X POST "$B/task/$TASK/evidence" \
  -d '{"file_name":"encryption-config.txt","content_type":"text/plain","data":"QUVTLTI1NiBhdCByZXN0IG9uIGFsbCBzdG9yZXMu"}'
c 200 "GET /evidence (one file)" "$B/task/$TASK/evidence"
c 404 "GET /evidence unknown task" "$B/task/$BAD/evidence"

echo "=== Attest, bad then valid ==="
c 400 "POST /attest bad outcome" -X POST "$B/task/$TASK/attest" \
  -d '{"met_criteria":"yes","outcome":"banana","comments":"x"}'
c 200 "POST /attest valid" -X POST "$B/task/$TASK/attest" \
  -d '{"met_criteria":"yes","outcome":"approved","comments":"Config export attached."}'

echo "=== Resync ==="
c 400 "POST /resync bad type" -X POST "$B/resync/badtype/$REQ"
c 404 "POST /resync unknown request" -X POST "$B/resync/request/$BAD"
# 200 now that the connected-app credentials are in and sf.enabled is true
# (since 2026-10-04). With sf.enabled=false a refused push must surface as 502,
# not be swallowed - run with RESYNC_EXPECT=502 to check that side.
c "${RESYNC_EXPECT:-200}" "POST /resync/request (200 pushed; 502 if sf.enabled=false)" \
  -X POST "$B/resync/request/$REQ"

echo "=== Snapshot after the writes ==="
c 200 "GET /snapshot" "$B/snapshot"

echo
echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
