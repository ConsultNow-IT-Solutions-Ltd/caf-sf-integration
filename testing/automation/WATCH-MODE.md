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

## Running a whole suite instead

```powershell
.\watch.cmd                 # the seven Salesforce UI cases, watched
.\watch.cmd -Suite sn       # the ServiceNow cases
.\watch.cmd -Pace 1500 -SlowMo 600
```

`watch.ps1` finishes by building a single self-contained HTML record of that run
(`results/evidence-report.html`) rather than one document per case — better for
scanning a pass, where the `.docx` is better for filing one case. It covers only
the cases the run executed: `results/cases` is an archive, and reporting on all
of it would issue documents for cases that were never run.

---

## How it is wired

| | |
|---|---|
| `test.cmd` / `watch.cmd` | Launchers that work under a Restricted execution policy. |
| `run-case.mjs` | The runner behind `.\test.cmd <ID>`. Resolves the id to the spec that defines it and the project that can authenticate for it, runs it, then calls the Word generator. |
| `lib/watch.ts` | The narration panel, `spotlight()`, pacing, and hiding the panel for screenshots. Every function is a no-op when `WATCH` is unset. |
| `lib/evidence.ts` | `bindWatchPage(page)` in a `beforeEach` is all a spec needs — the steps it already records are what gets narrated. |
| `playwright.config.ts` | `WATCH` turns off headless, adds `slowMo`, records video, and drops the viewport to 1440×860 so the window fits a real screen. |
| `../evidence-generator/generate_evidence.py` | `--only TC-INT-020 --no-summary` builds one document instead of the whole pack. |

A spec written for watch mode still runs headless, and passing there is what
proves the narration is decoration rather than load-bearing.

---

## Before the first run on a new machine

```powershell
# Node must be on PATH — it is installed per-user and a shell opened before the
# install will not have it. watch.ps1 rebuilds PATH from the registry itself;
# test.cmd relies on the shell you are already in, so open a new one if node is
# "not recognized".
npx.cmd playwright install chromium
python -m pip install python-docx
node "$env:APPDATA\npm\node_modules\@salesforce\cli\bin\run.js" org display --target-org caf-sf
```

The last one must report **Connected**. Salesforce needs no password in this
folder: `sf-setup` exchanges the CLI's existing OAuth grant for a single-use
`frontdoor.jsp` URL, so the browser gets the session the CLI already holds. That
runs once per command and takes about 20 seconds.

ServiceNow credentials for the `sn` suite live in `.env` (git-ignored).

**Python does not need to be on PATH.** `run-case.mjs` probes `python`, `py` and
`python3`, rejects anything that answers without a version — which is how the
Microsoft Store alias stub behaves — and then looks in the standard per-user
install locations. `set PYTHON=C:\path\to\python.exe` overrides all of it.

---

## Two errors that name the wrong thing

Both were hit on this machine, both look like a broken install, and neither is.

### `npm.ps1 cannot be loaded because running scripts is disabled`

The PowerShell execution policy, not npm. Use `.\test.cmd` — see above.

### `cnit.ps1 cannot be loaded because running scripts is disabled`

The same policy, one level deeper: `lib/cnit.ts` spawns `powershell.exe -File
cnit.ps1` for the ServiceNow half of every integration case, and that child
process falls back to the machine policy.

Fixed by passing `-ExecutionPolicy Bypass` on that invocation — scoped to the
one process, changing nothing on the machine.

**Worth knowing why it survived testing.** A shell whose policy has already been
relaxed exports `PSExecutionPolicyPreference`, and every child process inherits
it — including `powershell.exe -File`. So the harness works for whoever built it
and fails for everyone else, and no amount of re-running it in the wrong shell
will show the fault. To test this class of problem honestly:

```powershell
Remove-Item Env:\PSExecutionPolicyPreference -ErrorAction SilentlyContinue
```

### `SyntaxError: Expected property name or '}' in JSON at position 1`

**The `sf` CLI colourised its own `--json` output.** Playwright sets
`FORCE_COLOR=1` in every worker, the CLI honours it for machine-readable output
as well as human output, and the ANSI escape lands immediately after the opening
brace — hence "position 1".

Fixed in [lib/sfjson.ts](lib/sfjson.ts), which every `sf` invocation now goes
through: colour is forced off, the JSON body is extracted from the first `{` to
the last `}` rather than sliced at the first brace and hoped for, and a parse
failure reports what the CLI actually returned instead of only that parsing
failed.

### `Python was not found` / `'py' is not recognized`

A shell opened before Python was installed. Python is per-user, so the session
holds a PATH that predates it, leaving only the Microsoft Store alias — which
exists, runs, and does nothing but advertise the Store. Handled: see above.
Opening a new terminal also fixes it.

---

## Things worth not rediscovering

- **The panel is redrawn from Node, not kept in the page.** A Lightning route
  change destroys everything injected into the document; the state lives in
  `lib/watch.ts` and a `load` handler repaints it. Without that the narration
  disappears halfway through a case and looks like a crash.
- **It is built with `createElement` and the CSSOM**, never `innerHTML` or style
  attributes, so a Content-Security-Policy on the page under test cannot
  silently drop it.
- **`pointer-events: none`** — the panel sits over the top-right of the
  application and must never intercept a click meant for it.
- **Grep is anchored on a trailing space** (`TC-INT-020 `), so `TC-INT-02`
  cannot quietly pull in TC-INT-020 through 029.
- **The `sf` CLI can exit non-zero and still be right.** It writes a JSON body
  on stdout describing what happened; `auth/salesforce.setup.ts` reads that
  rather than trusting the exit code, because discarding it turned every cause
  into the same "Command failed" string.
- **Never let the CLI colourise `--json`.** `lib/sfjson.ts` forces
  `FORCE_COLOR=0` on every invocation and strips ANSI anyway. Playwright sets
  `FORCE_COLOR=1` for its own reporter and it reaches every child process.
- **`powershell.exe` is resolved by absolute path** in `lib/cnit.ts`, from
  `%SystemRoot%`. Looking it up on PATH gives `spawnSync powershell.exe ENOENT`
  in a trimmed shell, which reads as "PowerShell is not installed" — a claim
  nobody believes and therefore nobody checks.
