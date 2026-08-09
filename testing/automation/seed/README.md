# seed/

**These write to the live instance. Everything else under `testing/automation`
only reads.** That is why they live in their own directory, their own Playwright
project, and carry a `.seed.ts` extension no test project matches — `npm run sn`
will never pick them up by accident.

```powershell
cd testing\automation
npx playwright test seed/generic-apps.seed.ts --project=seed
```

| File | What it does |
|---|---|
| `data.ts` | The estate: nineteen applications x six controls, and the status of every cell. The single source of truth — edit this, re-run, and the seed converges on it. |
| `generic-apps.seed.ts` | Five phases: create the CIs, repoint the original requests, create the missing ones, drive tasks and set compliance status, roll up and report. |
| `repair-numbering.seed.ts` | One-off, already run. Renumbered the seeded records out of the range the app's own data occupied, and lifted `sys_number_counter`. Kept as the record of what was done. |
| `background.ts` | Posts a server-side script to `sys.scripts.do` using the harness's admin session. |
| `probe.seed.ts` | Read-only check that the background route works at all. Run this first if something looks wrong. |

## Why a background script and not the Table API

`caf_status`, `state` and `short_description` on `caf_req` are `read_only=true`
in the dictionary, and the Table API **drops a read-only field silently** —
HTTP 200, the pre-write values echoed back, `sys_updated_on` unmoved, nothing in
any log. The documented workaround is to flip the `sys_dictionary` entry, write,
and flip it back, which leaves the app unprotected for the duration and leaves it
that way if anything fails in between.

A server-side `GlideRecord` is subject to no such restriction, so the seed writes
as ordinary application logic with every business rule and flow firing exactly as
it would for a person on a form. That is also why it is slow: 90 request inserts
each fire the task-creation flow and an async Salesforce push.

## Rules the seed has to respect

Each of these cost a debugging round; they are enforced in the scripts and
explained in the comments beside them.

- **Key on the control, not the relationship.** A control is reachable through
  three relationships, one per tier, and the pre-existing requests do not all use
  the same one.
- **Open → Closed Complete in one hop is refused** by *CAF - Task - prevent state
  change*. In Progress is a required stop.
- **The nightly job at 23:00 turns any active, overdue request red.** Anything
  meant to stay green is closed; anything meant to stay amber is dated into the
  future.
- **`environment` stays blank on the new CIs**, which keeps the nightly 23:30
  generation job from minting requests behind you.
- **Check `sys_number_counter` against the data before bulk-inserting.** It is
  the live counter; `sys_number` is only the value it was created from, and on
  this instance the two disagreed by 42 records.
