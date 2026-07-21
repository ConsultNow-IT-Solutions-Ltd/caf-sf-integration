# Run a test case in a browser you can watch

Open PowerShell and go to the automation folder first — every command below is
run from there:

```powershell
cd "C:\audit\dev281754 CAF App Reyan\testing\automation"
```

---

## Three that pass

```powershell
.\test.cmd TC-INT-020
```
```powershell
.\test.cmd TC-INT-051
```
```powershell
.\test.cmd TC-INT-036
```

Each one opens a Chromium window, logs in to Salesforce, drives the CAF
Dashboard while narrating what it is doing in the top-right of the page, and
finishes by opening a Word evidence record.

| Case | What you will watch it do |
|---|---|
| **TC-INT-020** | Opens the evidence panel on a task and checks the Salesforce and ServiceNow file columns each agree with their own platform. |
| **TC-INT-051** | Clicks a cell on the compliance grid, drills in, and checks the tasks that appear are exactly the ones ServiceNow holds. |
| **TC-INT-036** | The most clicking of the three. Walks a task through the owner's view and the approver's view and checks which actions each state offers. |

## And one that fails

```powershell
.\test.cmd TC-INT-071
```

**TC-INT-071 — Mismatch advice names the side that is short.** It opens the
evidence panel on `CAFT0001022`, which holds 1 Salesforce file against 2
ServiceNow attachments, and asks whether the warning's advice matches the
direction of the mismatch. It does not: the panel always says *"Re-upload the
missing file to send it to the system of record"*, which is right only when a
push has failed and Salesforce holds **more**. Here ServiceNow already holds the
file, so following that advice would create a third copy rather than repair
anything.

The document comes out marked **FAIL**, with the screenshot of the warning and
the ServiceNow attachment records that establish the direction independently of
the component under test.

This is a real defect, not a demonstration fixture — it was found by TC-INT-021,
which passes because its own expectation is only that the wording is informative
rather than alarming. TC-INT-071 exists to hold the defect still until the label
branches on `servicenowCount - salesforceCount`. It will start passing when that
is fixed, which is the point of it.

---

All four are read-only. They open records and read fields; they submit nothing,
and they never click Start, Approve or Reject — each of those closes a task
irreversibly.

Run several in one go if you prefer:

```powershell
.\test.cmd TC-INT-020 TC-INT-051 TC-INT-036 TC-INT-071
```

Roughly a minute each, plus about 20 seconds for the Salesforce login at the
start of each command.

---

## Watching it more slowly

```powershell
.\test.cmd TC-INT-036 --slow
```

Roughly doubles the pacing — worth it when someone is watching over your
shoulder. Other options:

| | |
|---|---|
| `--headless` | No window. The document is still produced. |
| `--no-doc` | Run it, skip the Word document. |

---

## What you get

| | |
|---|---|
| `testing\evidence-packs\TC-INT-020.docx` | The evidence record. Opens on its own when the run finishes. |
| `testing\automation\evidence\TC-INT-020\` | The screenshots it embeds. |
| `testing\automation\test-results\` | A screen recording of the run, as `video.webm`. |

The narration panel is deliberately **not** in the screenshots — it is hidden for
each capture, so an evidence image shows the application rather than the tool
driving it.

---

