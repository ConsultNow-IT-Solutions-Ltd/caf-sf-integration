# CAF Compliance — Test Cases: ServiceNow

**Scope.** The ServiceNow side alone — the compliance engine and its native UI.
Everything here is executable with Salesforce switched off entirely
(`x_gskn2_caf_compli.sf.enabled = false`), and **should be**, so that a failure
here is unambiguously an engine failure.

Cases that cross the seam into Salesforce live in
[TEST-CASES-INTEGRATION.md](TEST-CASES-INTEGRATION.md).

| | |
|---|---|
| Application | CAF Compliance, scope `x_gskn2_caf_compli`, v1.0.0 |
| Instance | `dev281754.service-now.com` |
| Baseline captured | 2026-08-07, direct from instance metadata |
| Cases | 68 |

---

## How to read a case

| Field | Meaning |
|---|---|
| **Priority** | P1 blocks a release, P2 matters, P3 is polish |
| **Type** | Positive / Negative / Boundary / Regression |
| **Component** | The exact instance artefact under test, so a failure names a thing to fix |
| **Evidence** | *Provisional* — `UI+record`, `record-only`, or `UI-only`. See "Evidence policy" |
| **Verify** | The assertion against the record, independent of what the screen claimed |

**Evidence policy.** Every case that asserts a state transition carries **two**
proofs: what the screen showed, and what the record holds. A green toast proves
the form submitted, not that the business rule ran. The `Verify` line is the one
that decides pass or fail; the screenshot is what goes to the client.

The `UI` half of the `Evidence` tag is provisional — how much of the native UI
Playwright drives is still an open decision. Cases are written so that dropping
to `record-only` costs nothing but the screenshots.

**Reading the Verify lines.** All use the project's standard invocation:

```powershell
& "C:\Users\patel\...\cnit.ps1" get <table> -ProfileName caf-reyan -Query "<encoded>" -Fields <fields> -ExcludeRefLinks
```

Abbreviated below to `cnit get …`. `-ProfileName caf-reyan` is never optional —
omitting it silently queries a different PDI.

---

