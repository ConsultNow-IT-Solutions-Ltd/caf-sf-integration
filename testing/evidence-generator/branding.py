"""
Reyan Technologies house style for the CAF Compliance evidence packs.

Kept apart from the document logic so the palette, the confidentiality wording
and the logo can be changed without touching how a case is laid out — and so a
second client's branding is a new module rather than a fork.
"""

from pathlib import Path
from docx.shared import Pt, RGBColor, Inches

# Brand palette. Navy and royal blue are the Reyan colours already used
# throughout the LWCs, so the pack matches the product it documents.
NAVY = RGBColor(0x00, 0x07, 0x24)
ROYAL = RGBColor(0x0A, 0x31, 0x76)
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x60, 0x66, 0x76)
RULE = RGBColor(0xD5, 0xD9, 0xE0)

# Verdict colours. Deliberately not the traffic-light green/red of a marketing
# deck — these are printed and photocopied, so they need contrast at greyscale
# as well as in colour.
VERDICT_COLOURS = {
    "PASS": RGBColor(0x0B, 0x6B, 0x3A),
    "FAIL": RGBColor(0xA8, 0x18, 0x45),      # ConsultNow maroon, doubles as the fail tone
    "BLOCKED": RGBColor(0xB2, 0x6A, 0x00),
    "NOT RUN": MUTED,
}

# Hex equivalents, for the XML-level shading python-docx has no API for.
VERDICT_FILL = {
    "PASS": "E6F4EC",
    "FAIL": "FBE9EF",
    "BLOCKED": "FDF1E0",
    "NOT RUN": "EEF0F3",
}

BODY_FONT = "Calibri"
MONO_FONT = "Consolas"

SIZE_TITLE = Pt(26)
SIZE_H1 = Pt(15)
SIZE_H2 = Pt(11.5)
SIZE_BODY = Pt(10.5)
SIZE_SMALL = Pt(9)
SIZE_MONO = Pt(8)

PAGE_MARGIN = Inches(0.85)

COMPANY = "Reyan Technologies"
PRODUCT = "CAF Compliance"
DOC_KIND = "Test Evidence Record"

CONFIDENTIALITY = (
    "Confidential. Prepared by Reyan Technologies. "
    "Contains system test evidence and must not be redistributed without written consent."
)

ASSETS = Path(__file__).parent / "assets"


def logo_path():
    """
    The cover logo, if one has been supplied.

    Optional by design: the pack must render on a machine that has never had the
    brand assets dropped in, falling back to a typographic wordmark rather than
    failing to build.
    """
    for name in ("reyan-logo.png", "reyan-logo.jpg", "reyan-logo.jpeg", "logo.png"):
        candidate = ASSETS / name
        if candidate.exists():
            return candidate
    return None
