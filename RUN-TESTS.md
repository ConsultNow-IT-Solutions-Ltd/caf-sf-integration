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

