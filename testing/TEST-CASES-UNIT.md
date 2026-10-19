# Offline unit tests and harness preflight

These run on any machine with Node and need no org, no instance and no
credentials. They don't replace the integration cases in
`TEST-CASES-INTEGRATION.md`. They pin the logic those cases found defects in,
so a regression shows up in seconds rather than on the next live run.

| Run | Command | Where |
|---|---|---|
| LWC unit tests | `npm install` once, then `npm run test:unit` | `salesforce/` |
| Preflight tests | `npm run preflight:test` | `testing/automation/` |
| Preflight check | `npm run preflight` (add `:probe` to call the API) | `testing/automation/` |

## LWC: `cafEvidence` (`salesforce/test/lwc/cafEvidence.test.js`)

| ID | Case | Guards |
|---|---|---|
| TC-UNIT-001 | Salesforce holds more → warning says re-upload | The repair path for a failed push still works |
| TC-UNIT-002 | ServiceNow holds more → warning does **not** say re-upload | CAF-173 / TC-INT-071. Fails against the pre-fix code (checked) |
| TC-UNIT-003 | Equal counts → no warning | No false alarm |
| TC-UNIT-004 | ServiceNow unreadable → error shown, no mismatch warning | An outage isn't reported as a count mismatch |
| TC-UNIT-005 | `evidencecount` carries the ServiceNow count | The attestation gate counts the system-of-record copy |
| TC-UNIT-006 | `hideUpload` removes the upload control and changes the empty message | Approver and closed-task view |
| TC-UNIT-007 | Reload reads both lists again | Picks up a file attached in ServiceNow directly |
| TC-UNIT-008 | Reload is disabled while a read is in flight | No overlapping reads |

TC-UNIT-001 covers the direction no live case can reach without an upload.
`HANDOVER.md` for CAF-173 lists it as a by-hand check, and this replaces that.

## LWC: `cafDashboard` roll-up (`salesforce/test/lwc/cafDashboard.test.js`)

| ID | Case | Guards |
|---|---|---|
| TC-UNIT-010 | 2 requests, both compliant, 4 controls N/A → Compliant | CAF-78 / TC-INT-050: N/A stays out of the denominator |
| TC-UNIT-011 | 2 of 6 compliant → "2 of 6", amber | CAF-175 shape: the dashboard must not echo ServiceNow's wrong "compliant" |
| TC-UNIT-012 | Approaching due and exception approved count as not compliant | Only `in_compliance` scores |
| TC-UNIT-013 | Request with no control sys_id joins on the control name | Requests pushed before `CAF_Control_Sys_Id__c` existed |
| TC-UNIT-014 | New control with no requests → app stays Compliant, column added | Adding a control isn't a scoring change |
| TC-UNIT-015 | Rows sorted by application name, ignoring case | Stable grid order |
| TC-UNIT-016 | Only one wire answered → still loading, no grid | No half-built pivot |
| TC-UNIT-017 | A wire error → error message shown | Failure is visible |

## LWC: `cafDashboard` grid filters, totals and panel (`salesforce/test/lwc/cafDashboard.test.js`)

| ID | Case | Guards |
|---|---|---|
| TC-UNIT-070 | Search narrows rows by application name; count reads "Showing 2 of 3 applications" | |
| TC-UNIT-071 | "Needs attention only" hides Compliant rows | Unassessed apps aren't flagged as needing attention |
| TC-UNIT-072 | No match → message, filter bar stays | The user can clear the filter |
| TC-UNIT-073 | Footer totals compliant/assessed per control, unchanged by the filter | Footer describes the estate, agrees with Reports |
| TC-UNIT-074 | Legend counts each status and N/A | |
| TC-UNIT-075 | Task panel takes focus on open; Escape closes it | Panel below the fold was easy to miss |
| TC-UNIT-076 | Sort: name by default, "Least compliant first" on request | Default order still matches the ServiceNow portal |
| TC-UNIT-077 | Sort and "Needs attention only" remembered for the next visit | |
| TC-UNIT-078 | Unreadable saved preferences are ignored | Bad storage never breaks the grid |
| TC-UNIT-079 | Overdue ring on past-date, unsettled cells only; selected cell highlighted; dot still the first span | Live harness reads the dot from the first span |

## LWC: `cafSyncHealth` (`salesforce/test/lwc/cafSyncHealth.test.js`)

| ID | Case | Guards |
|---|---|---|
| TC-UNIT-080 | Out of sync with a null differences list reads "Out of sync" | It threw on `.length` |
| TC-UNIT-081 | Missing counts show "?", never "null" | Doesn't claim a count it didn't get |
| TC-UNIT-082 | Empty reply is "Could not check", not "In sync" | |
| TC-UNIT-083 | Only the pressed row reads "Re-syncing…"; every Re-sync disabled until it finishes; re-checks after | No racing pushes |
| TC-UNIT-084 | "checked … · N min ago"; unparseable time omitted | A stale check is visible |
| TC-UNIT-085 | Differences counted by record type above the table | |

## LWC: `cafAttestation` (`salesforce/test/lwc/cafAttestation.test.js`)

| ID | Case | Guards |
|---|---|---|
| TC-UNIT-090 | Cancelling the confirmation sends nothing | Approve/Reject close the task irreversibly |
| TC-UNIT-091 | Confirmed Approve sends once; dialog names the task and the criteria | |
| TC-UNIT-092 | Reject with no comment asks for a reason before any dialog | |
| TC-UNIT-093 | Reject dialog warns the request goes out of compliance | |
| TC-UNIT-094 | A dialog that can't open counts as no | Fails safe |
| TC-UNIT-095 | Comment counter "n / 4000", amber past 90%; field capped at 4000 | |
| TC-UNIT-096 | Never sends more than 4000 characters | Belt and braces if the field lets more through |

## LWC: `cafDashboard` screen tabs (`salesforce/test/lwc/cafDashboard.test.js`)

| ID | Case | Why |
|---|---|---|
| TC-UNIT-020 | Opens on Compliance, four tabs, grid shown | The grid stays the default screen |
| TC-UNIT-021 | Switching to Reports unmounts the grid, and switching back restores it | Screens mount only while selected |
| TC-UNIT-022 | `c__view=admin` opens on Admin | Deep links from email or notifications |
| TC-UNIT-023 | Unknown `c__view` is ignored | A bad link doesn't blank the page |
| TC-UNIT-024 | A tab click writes `c__view` with replace, and Compliance drops it | Refresh keeps the screen, Back isn't flooded |
| TC-UNIT-025 | Left/Right wrap, Home/End jump, focus follows, roving tabindex | ARIA tabs keyboard pattern |

## LWC: `cafApprovals` (`salesforce/test/lwc/cafApprovals.test.js`)

| ID | Case | Why |
|---|---|---|
| TC-UNIT-030 | Awaiting and past-due tiles count correctly; no date reads "No date", not overdue | Nothing to be late against |
| TC-UNIT-031 | Application filter and search narrow the queue | |
| TC-UNIT-032 | Review is disabled on a task with no ServiceNow sys_id | Nothing to send the decision to |
| TC-UNIT-033 | Review opens evidence with `hideUpload` true, and attestation for the same task | Approver judges evidence, doesn't add to it |
| TC-UNIT-034 | Recent decisions labelled Approved / Rejected | |
| TC-UNIT-035 | Overdue only shows only past-due tasks | |
| TC-UNIT-036 | A queue at the 500-row Apex limit says so | A cut-off queue mustn't read as complete |
| TC-UNIT-037 | Decisions list failing leaves the queue on screen with its own error | One failure doesn't hide the other list |

## LWC: `cafReports` (`salesforce/test/lwc/cafReports.test.js`)

| ID | Case | Why |
|---|---|---|
| TC-UNIT-040 | Waits for both requests and controls | No half-built report |
| TC-UNIT-041 | Headline tiles computed from the request rows | |
| TC-UNIT-042 | One bar per control; requests on no active control go in an extra row | Bars add up to the total |
| TC-UNIT-043 | Applications least compliant first, Overall uses the grid's rule | Report and grid agree |
| TC-UNIT-044 | Overdue and due-in-30-days, settled statuses left out | |
| TC-UNIT-045 | Tasks totalled by state, attestations counted | |
| TC-UNIT-046 | Application filter scopes every figure | |
| TC-UNIT-047 | CSV cells starting `=`, `+`, `-` or `@` are defused; separators quoted | CSV formula injection: descriptions come from ServiceNow |
| TC-UNIT-048 | Export carries only the filtered rows, with the application in the file name | |
| TC-UNIT-049 | Task-summary failure shown in its panel; rest of report stays | |

## LWC: `cafAdmin` (`salesforce/test/lwc/cafAdmin.test.js`)

| ID | Case | Why |
|---|---|---|
| TC-UNIT-050 | Log tiles (count, failed, success rate, average, p95, last call) and failures-only filter | |
| TC-UNIT-051 | No log access shows the CAF Admin message, rest of screen loads | CAF_Integration alone can't read the log |
| TC-UNIT-052 | Settings flagged when the value in use isn't the stored value | Clamped, blank and missing settings are visible |
| TC-UNIT-053 | Inactive control with requests gets a note; heading counts active | |
| TC-UNIT-054 | `Logging_Enabled = false` shows a warning that the log has stopped | A quiet log mustn't read as "nothing failing" |
| TC-UNIT-055 | Long errors cut to 140 characters, full text in the tooltip | |
| TC-UNIT-056 | Newest call time shown | |

## LWC: missing or bad data on the new screens

| ID | Screen | Case | Why |
|---|---|---|---|
| TC-UNIT-060 | Approvals | Null rows dropped; a task with no parent request renders with blank columns, no "null"/"undefined" | A deleted or unshared parent mustn't hide the task |
| TC-UNIT-061 | Approvals | Unparseable due date shows "(invalid date)" and isn't counted overdue or on time | NaN mustn't read as "not late" |
| TC-UNIT-062 | Approvals | Searching "undefined" matches nothing on a blank description | Blank fields stay out of the search text |
| TC-UNIT-063 | Approvals | An approval value other than approved/rejected is shown as received | It was being labelled Rejected |
| TC-UNIT-064 | Reports | Request with no application is counted under "(No application)"; null rows dropped | No crash on sort, no silent drop |
| TC-UNIT-065 | Reports | Task bucket with a null total counts as 0; null buckets dropped | No NaN in the task panel |
| TC-UNIT-066 | Reports | Unparseable planned date is left off the due list | Can't be placed as overdue or upcoming |
| TC-UNIT-067 | Reports | A filter on an application a refresh no longer returns is cleared | An empty report with no visible reason |
| TC-UNIT-068 | Admin | Null setting, control and log fields render as blanks or dashes, never "null" | |
| TC-UNIT-069 | Admin | Overview with no lists shows each section's empty message, not an error | |

Apex: `CafApprovalsControllerTest`, `CafReportsControllerTest` and
`CafAdminControllerTest` cover the queue filter and order, recent decisions,
task aggregation, settings with effective values, control request counts
(sys_id and name joins), log access with and without `CAF_Admin`, and refusal
for a user with no CAF access. They run in the org, not here.

## Harness preflight (`testing/automation/preflight.test.mjs`)

`preflight.mjs` checks `.env` and the files it points at before a run. With
`--probe` it also calls `GET /caf/snapshot` as `sf.integration`. It exists
because of CAF-188: a wrong password turned a whole negative run into BLOCKED,
and that only came to light after the run.

| ID | Case |
|---|---|
| TC-PRE-001 | A complete configuration passes with no errors or warnings |
| TC-PRE-002 | An unquoted `#` in a `.env` value is an error naming the line and key (Node cuts the value off there) |
| TC-PRE-003 | Quoted `#` values and comment lines aren't flagged |
| TC-PRE-004 | `SN_INSTANCE` must be an https host with no path. A non-`service-now.com` host is a warning |
| TC-PRE-005 | A password file named in `.env` but missing is an error. The built-in default path missing is only a warning |
| TC-PRE-006 | An empty password file is an error |
| TC-PRE-007 | `SF_INTEGRATION_PASSWORD` wins over the file, and no output ever contains it |
| TC-PRE-008 | A missing UI login is a warning (only the browser suites need it) |
| TC-PRE-009 | A probe 401 is reported as a credential problem, 403 as a role problem |

## Not covered here

- `cafAttestation` is tested for its confirmation step only. Its blocked-state
  messages (not started, closed, no evidence) are still checked live only.
- Apex has none in this branch. Those are in CAF-235 / CAF-236.
- The ServiceNow business rule behind CAF-175 isn't in the repo, so it can't be
  unit-tested here. TC-SN-017 and TC-INT-050 keep checking it live.
