# Superseded — do not read for current state

Both files here were folded into [../HANDOFF.md](../HANDOFF.md) on 2026-08-07.
They are kept only because this folder is not under version control, so a delete
would be unrecoverable.

| File | Was |
|---|---|
| `CAF_Salesforce_Split_Handoff.md` | The architecture brief — the split, the governing rule, rejected alternatives, DE limits, build sequence |
| `SESSION_HANDOFF.md` | The build-state handoff — what worked, traps, open items |

They overlapped, disagreed in places, and neither was complete on its own. Both
contain claims that were **already stale when written** — the clearest example is
`SESSION_HANDOFF.md` listing "no red in the grid" as an open item hours after
twelve requests had been set to `out_of_compliance` and pushed successfully.

If something here looks useful and is missing from `HANDOFF.md`, confirm it
against the instance before acting on it.
