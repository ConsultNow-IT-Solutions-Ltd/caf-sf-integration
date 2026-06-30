# Watch mode — run a case in a browser you can see

```powershell
cd "C:\audit\dev281754 CAF App Reyan\testing\automation"
.\test.cmd TC-INT-020
```

A Chromium window opens, Salesforce loads, the case drives the CAF Dashboard
while narrating each step into the corner of the page, and when it settles a
branded `.docx` evidence record opens in Word.

Nothing here is a second implementation of the test pack. `.\test.cmd` is a way
*in* to the cases that already exist in
[TEST-CASES-INTEGRATION.md](../TEST-CASES-INTEGRATION.md) and
[TEST-CASES-SERVICENOW.md](../TEST-CASES-SERVICENOW.md) — same specs, same
assertions, same evidence format, same Word generator. The only thing watch mode
changes is whether anyone is watching.

---

## Three commands to start with

All three are Salesforce Lightning cases, all read-only, all currently passing.

| | |
|---|---|
| `.\test.cmd TC-INT-020` | **Both lists are shown side by side.** Opens the evidence panel on a task and confirms the Salesforce and ServiceNow file columns each agree with their own platform. |
| `.\test.cmd TC-INT-051` | **Drill-in shows the request's tasks.** Clicks a cell on the compliance grid and checks the tasks that appear are exactly the ones ServiceNow holds. |
| `.\test.cmd TC-INT-036` | **Evidence and attestation are separate panels for separate people.** The most clicking of the three — walks a task through the owner's view and the approver's view and checks which actions each state offers. |

Run several at once if they live in the same spec file:

```powershell
.\test.cmd TC-INT-051 TC-INT-036
```

### Flags

| | |
|---|---|
| `--slow` | Roughly double the pacing. For demonstrating to somebody. |
| `--headless` | No window. The document is still produced. |
| `--no-doc` | Run it, skip the `.docx`. |

### Three ways to launch, and why there are three

| | |
|---|---|
| `.\test.cmd TC-INT-020` | Works whatever your PowerShell execution policy is. **Use this one.** |
| `npm.cmd test TC-INT-020` | The same thing through npm, skipping npm's PowerShell shim. |
| `npm test TC-INT-020` | Only works if `Get-ExecutionPolicy` is not `Restricted`. |

Windows ships client machines with the execution policy at **Restricted**, and
npm on Windows is `npm.ps1` — so `npm test` fails with *"npm : File
C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is
disabled on this system"*. That message names npm, which makes it read like a
broken Node install; it is the policy. Nothing in this folder needs the policy
changed. If you would rather change it anyway, this needs no administrator:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

## What you get

| | |
|---|---|
| `../evidence-packs/TC-INT-020.docx` | The evidence record. Opens automatically. |
| `evidence/TC-INT-020/*.png` | The screenshots it embeds. |
| `test-results/**/video.webm` | A recording of the run — watch mode only. |
| `results/cases/TC-INT-020.json` | What the case recorded. The archive; everything above is derived from it. |

**The narration panel is not in the screenshots.** It is hidden for each capture
and restored afterwards, because an evidence image should show the application
and not the harness driving it. `WATCH_STAMP=1` overrides that for a slide or a
recording.

---

## Which cases can be run this way

48 of the 139 specified cases are written as executable specs. `.\test.cmd` with
an id that is not one of them lists the ones that are, rather than reporting
"0 tests matched" — which reads like a pass.

The Salesforce UI ones are **TC-INT-020, 021, 024, 036, 048, 051, 053**.
TC-INT-048 also opens a second window for the ServiceNow portal, so it is the
one case here that shows both platforms at once.

**The negative-path cases are refused.** TC-INT-013/014/015/029/032–035 send
write-shaped requests — every one is *expected* to be refused by the platform,
but they are still writes over the wire, and that sits behind the write rule in
[CLAUDE.md](../../CLAUDE.md). `--i-accept-write-intent` exists for once that
decision is taken.

---

