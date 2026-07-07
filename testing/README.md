# CAF Compliance — test pack

Test cases, automated execution, and branded Word evidence records.
**Start here.** Built 2026-08-07.

| | |
|---|---|
| [TEST-CASES-SERVICENOW.md](TEST-CASES-SERVICENOW.md) | 69 cases — engine, native UI, `/caf` portal |
| [TEST-CASES-INTEGRATION.md](TEST-CASES-INTEGRATION.md) | 70 cases — everything crossing into Salesforce |
| [automation/](automation/) | Playwright harness (TypeScript) |
| [evidence-generator/](evidence-generator/) | Python + python-docx → one .docx per case |
| [evidence-packs/](evidence-packs/) | Generated Word documents (git-ignored output) |

**Salesforce side: 24 of 61 cases executed — 20 PASS, 3 FAIL, 1 BLOCKED.**
Everything that can be proved without changing either platform, including all
seven UI cases. **The remaining 37 are pending by decision, not by capability** —
each needs a write, and the harness for them is built. See "Pending" below.

---

## How it fits together

```
TEST-CASES-*.md          the definition — priority, component, steps, expected
        │
        ├──> automation/specs/*.spec.ts     executes, records what happened
        │              │
        │              └──> automation/results/cases/TC-*.json
        │
        └──> evidence-generator/            merges definition + result
                       │
                       └──> evidence-packs/TC-*.docx
```

The markdown is the single source of truth for what a case *is*; the run supplies
what happened. **Nothing is retyped between them**, so a document cannot claim an
expected result the specification does not contain.

### Two proofs per case, always

Every case that asserts a state transition records **what the screen showed** and
**what the record holds**. A green toast proves a form submitted, not that a
business rule ran — and this architecture's characteristic failure is the two
platforms disagreeing, which a single-sided check cannot see.

---

## Running one case in a browser you can watch

```powershell
cd testing/automation
.\test.cmd TC-INT-020
```

A Chromium window opens, Salesforce loads, the case drives the CAF Dashboard
narrating each step on screen, and a branded `.docx` evidence record opens when
it settles. Same specs, same assertions, same generator as the headless pass —
watch mode only changes whether anyone is watching.

Three to start with: **TC-INT-020** (both file lists side by side),
**TC-INT-051** (drill-in from the grid), **TC-INT-036** (owner and approver
views, the most clicking). `--slow` for demonstrating, `--headless` to skip the
window, `.\watch.cmd` for a whole suite.

`.\test.cmd` rather than `npm test` because Windows ships the PowerShell
execution policy at **Restricted**, and npm on Windows is a `.ps1` — so
`npm test` fails with *"npm.ps1 cannot be loaded because running scripts is
disabled on this system"*, which names npm but is the policy. `npm.cmd test`
works too.

**[automation/WATCH-MODE.md](automation/WATCH-MODE.md) is the reference** — which
of the 139 cases are executable today, the flags, and the first-run setup.

---

