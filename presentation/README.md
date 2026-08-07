# Decks

Two, for two audiences. Both 16:9, both Reyan Technologies branding.

| | |
|---|---|
| **CAF Compliance - Business Overview.pptx** | 13-slide executive decision brief. Built 2026-08-07. |
| **CAF Compliance - Technical Architecture.pptx** | 14-slide engineering brief — the integration contract. Built 2026-08-08. |
| **CAF Compliance - Plain English Summary.pptx** | 7 slides, no jargon, for an audience that works with neither system. Built 2026-08-08. |

```powershell
pip install python-pptx Pillow     # once
python crops.py                    # screenshots -> img/
python build_deck.py               # img/ + content -> the business deck
python build_tech_deck.py          # content only -> the technical deck
python build_layman_deck.py        # content only -> the plain-English deck
```

`build_tech_deck.py` **imports its palette, chrome and primitives from
`build_deck.py`** rather than copying them, so a change to the house style
reaches both decks and they cannot drift apart. It is also why `build_deck.py`
must keep its `if __name__ == "__main__"` guard — without it, importing would
rebuild the business deck as a side effect.

## Where the screenshots come from

Every screen in the deck is a real capture from the proof-of-concept org, taken
from [../testing/automation/evidence/](../testing/automation/evidence/) — the
same images the test evidence pack cites, so a screen in the deck and a screen
in an evidence record are the same pixels. `crops.py` names a region of each
capture and trims any uniform border left over; nothing is composited or
retouched.

The two grids on the findings slide are **contiguous** regions of their
captures, cropped to the same two applications. No row is edited out, so the
pair can be checked back against the full screenshots.

## Structure — plain-English deck

Prose comes from
[CAF Compliance - Plain English Summary.md](CAF%20Compliance%20-%20Plain%20English%20Summary.md),
so the document and the deck cannot drift into saying different things. Bigger
type and fewer words than either other deck: it is meant to be talked over, not
read.

| | |
|---|---|
| 1–2 | Cover, and what the product is actually for |
| 3 | Why it needed doing — the rules worked, the last step did not |
| 4 | The record office and the front desk, and the rule that binds them |
| 5–6 | Why the copy is checked; who provides evidence and who judges it |
| 7 | What is built, what is left, and what was deliberately not touched |

## Structure — technical deck

No screenshots. The diagrams are drawn from shapes, so there is nothing to
re-crop when the UI moves, and every figure traces to HANDOFF.md or to a
deployed resource under `../servicenow/`.

| | |
|---|---|
| 1–2 | Cover, and the governing rule the rest follows from |
| 3–5 | What talks to what, correlation by External Id, the outbound path |
| 6 | The echo-loop guard and the explicit reconcile — the load-bearing slide |
| 7–8 | The inbound API surface, and what an attestation actually does |
| 9–10 | Evidence stored twice on purpose; the control catalogue and deletes |
| 11–12 | Sync Health; failure modes and operating limits |
| 13–14 | Traps already paid for, and what a production move would require |

## Structure — business deck

| | |
|---|---|
| 1 | Cover |
| 2–3 | The problem, and the split-architecture decision |
| 4–7 | The Salesforce experience — dashboard, drill-in, evidence, attestation |
| 8 | Sync Health — why the mirror can be trusted |
| 9–11 | Assurance — method, results, and the one material finding |
| 12–13 | Where it stands, and what is being asked for |

## Conventions

- **No dates anywhere**, matching the convention set for the evidence packs.
- Slide numbers are a real PowerPoint field, so reordering renumbers correctly.
- Palette and confidentiality wording match
  [../testing/evidence-generator/branding.py](../testing/evidence-generator/branding.py),
  so the deck and the evidence records read as one body of work.

## Figures, and where each is sourced

Change these in `build_deck.py` if a fresh pass moves them.

| Figure | Source |
|---|---|
| 130 cases, 31 executed | [../testing/README.md](../testing/README.md) |
| 7 / 17 / 7 case split and results | same, "What ran" sections |
| 49 records verified, 19 requests, 30 tasks | Sync Health strip in the capture |
| 6 findings | 3 integration + 3 ServiceNow, the same defects from both sides |

The roll-up finding on slide 11 is TC-SN-017 / TC-INT-050.
