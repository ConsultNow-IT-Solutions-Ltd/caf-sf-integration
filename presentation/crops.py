"""
Screenshot preparation for the CAF Compliance business deck.

The raw Playwright captures are full-page shots with a lot of background below
the fold, and a business slide wants the panel, not the page. Each entry below
is a named region of a captured screen; `trim()` then removes any uniform
border left over, so a crop box that is slightly generous self-corrects rather
than leaving a grey band down one side.

Two capture widths are in play, because the harness viewport changed between
passes: the dashboard and portal-grid captures are 1600px wide, the four
task-panel captures are 1425px. Boxes are therefore per-capture and are not
interchangeable between the two sets.

Sources are the UI evidence from testing/automation/evidence/ — the same
captures the test pack cites, so a screen in the deck and a screen in the
evidence record are the same pixels.
"""

from pathlib import Path
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / "testing" / "automation" / "evidence"
OUT = Path(__file__).resolve().parent / "img"

# name -> (source relative to EVIDENCE, crop box or None for the whole page)
REGIONS = {
    # Hero: the dashboard as a business user meets it, Salesforce chrome kept
    # deliberately so the audience can see which platform they are looking at.
    "hero-dashboard": ("TC-INT-053/02-dashboard-with-sync-strip.png", (0, 0, 1600, 578)),

    # The sync strip on its own, for the assurance story.
    "sync-strip": ("TC-INT-053/02-dashboard-with-sync-strip.png", (33, 252, 1570, 330)),

    # The two grids cropped to the same two applications for the findings slide.
    # Both are contiguous regions of their capture — no row is composited out —
    # so the pair can be checked back against the full screenshots it came from.
    "sf-grid-pair": ("TC-INT-053/02-dashboard-with-sync-strip.png", (33, 345, 1570, 481)),
    "sn-grid-pair": ("TC-INT-048/02-servicenow-portal-grid.png", (240, 348, 1362, 515)),

    # The four task-panel captures below are from the 1425px-wide pass. Each
    # page carries the compliance grid above the panel and a sticky Salesforce
    # nav strip across it, so the box starts below both and frames the panel
    # only — the section heading down to its closing note.

    # Drill-in: a request's tasks with the actions available in each state.
    "drill-in": ("TC-INT-051/01-drill-in-task-list.png", (30, 1275, 1400, 1520)),

    # Owner's view — upload evidence, both copies listed.
    "evidence-owner": ("TC-INT-036/03-evidence-panel-owner-view.png", (30, 1482, 1400, 1800)),

    # Approver's view — evidence read-only beside the attestation form.
    "attest-approver": ("TC-INT-036/04-attest-panel-approver-view.png", (30, 1482, 1420, 2010)),

    # Two copies of every file, side by side.
    "evidence-both": ("TC-INT-020/01-evidence-both-lists.png", (40, 1592, 1400, 1870)),

    # ServiceNow's own portal grid — the admin/audit view, and the finding.
    "sn-portal-grid": ("TC-INT-048/02-servicenow-portal-grid.png", (240, 348, 1362, 592)),
}


def trim(im, tol=6):
    """Drop any uniform border, using the top-left pixel as the background."""
    bg = Image.new(im.mode, im.size, im.getpixel((0, 0)))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda p: 255 if p > tol else 0)
    box = diff.getbbox()
    return im.crop(box) if box else im


def build():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (src, box) in REGIONS.items():
        im = Image.open(EVIDENCE / src).convert("RGB")
        if box:
            im = im.crop(box)
        im = trim(im)
        path = OUT / f"{name}.png"
        im.save(path)
        print(f"{name:18} {im.size[0]:>5} x {im.size[1]:<5}  <- {src}")


if __name__ == "__main__":
    build()
