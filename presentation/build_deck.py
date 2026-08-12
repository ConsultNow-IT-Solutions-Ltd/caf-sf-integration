"""
CAF Compliance — business decision brief (16:9 PowerPoint).

An executive-register deck: problem, approach, what is proven, what is left,
and the decisions being asked for. The Salesforce experience is the subject, so
every screen shown is a real capture from the proof-of-concept org rather than a
mock-up, taken from testing/automation/evidence/ — the same images the test
evidence pack cites.

Reyan Technologies house style, matching testing/evidence-generator/branding.py
so the deck and the evidence records look like one body of work. Carries no
dates anywhere, following the convention set for the evidence packs.

    python crops.py && python build_deck.py
"""

from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

HERE = Path(__file__).resolve().parent
IMG = HERE / "img"
LOGO = HERE.parent / "testing" / "evidence-generator" / "assets" / "reyan-logo.png"
OUTPUT = HERE / "CAF Compliance - Business Overview.pptx"

# Reyan palette, as used in the LWCs and the evidence packs.
NAVY = RGBColor(0x00, 0x07, 0x24)
ROYAL = RGBColor(0x0A, 0x31, 0x76)
INK = RGBColor(0x1A, 0x1A, 0x1A)
MUTED = RGBColor(0x60, 0x66, 0x76)
RULE = RGBColor(0xD5, 0xD9, 0xE0)
PANEL = RGBColor(0xF6, 0xF7, 0xF9)
GREEN = RGBColor(0x0B, 0x6B, 0x3A)
MAROON = RGBColor(0xA8, 0x18, 0x45)
AMBER = RGBColor(0xB2, 0x6A, 0x00)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
COVER_SUB = RGBColor(0xA8, 0xB4, 0xCC)

FONT = "Calibri"

W, H = Inches(13.333), Inches(7.5)
MARGIN = Inches(0.85)
CONTENT_W = W - 2 * MARGIN
FOOTER_Y = Inches(6.92)

CONFIDENTIAL = "Confidential — prepared by Reyan Technologies. Not for redistribution without written consent."


# ---------------------------------------------------------------- primitives

def textbox(slide, left, top, width, height):
    tb = slide.shapes.add_textbox(left, top, width, height)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    return tf


def write(tf, text, *, size=14, color=INK, bold=False, italic=False,
         space_after=0, space_before=0, align=PP_ALIGN.LEFT, first=False,
         line=None):
    """Append a paragraph (or fill the empty first one) and return it."""
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.space_before = Pt(space_before)
    if line:
        p.line_spacing = line
    run = p.add_run()
    run.text = text
    f = run.font
    f.name, f.size, f.bold, f.italic = FONT, Pt(size), bold, italic
    f.color.rgb = color
    return p


def hanging(p, indent=Inches(0.17)):
    """Wrap the second line of a bullet under its text, not under the marker."""
    pPr = p._p.get_or_add_pPr()
    pPr.set("marL", str(int(indent)))
    pPr.set("indent", str(-int(indent)))


def rect(slide, left, top, width, height, fill, line=None, line_w=Pt(1)):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, left, top, width, height)
    shape.shadow.inherit = False
    if fill is None:
        shape.fill.background()
    else:
        shape.fill.solid()
        shape.fill.fore_color.rgb = fill
    if line is None:
        shape.line.fill.background()
    else:
        shape.line.color.rgb = line
        shape.line.width = line_w
    return shape


def slide_number(slide, left, top, width):
    """A real slide-number field, so renumbering survives reordering."""
    tf = textbox(slide, left, top, width, Inches(0.25))
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.RIGHT
    fld = etree.SubElement(p._p, qn("a:fld"))
    fld.set("id", "{B7A2E3C1-4F6D-4A9E-9C31-2D5E8F0A7B44}")
    fld.set("type", "slidenum")
    rPr = etree.SubElement(fld, qn("a:rPr"))
    rPr.set("lang", "en-GB")
    rPr.set("sz", "800")
    fill = etree.SubElement(rPr, qn("a:solidFill"))
    etree.SubElement(fill, qn("a:srgbClr")).set("val", "606676")
    etree.SubElement(rPr, qn("a:latin")).set("typeface", FONT)
    etree.SubElement(fld, qn("a:t")).text = "2"


def picture(slide, name, top, width=CONTENT_W, left=MARGIN):
    """Place a screenshot at a given width, hairline-bordered."""
    pic = slide.shapes.add_picture(str(IMG / f"{name}.png"), left, top, width=width)
    pic.line.color.rgb = RULE
    pic.line.width = Pt(0.75)
    return pic


# ------------------------------------------------------------------ chrome

def chrome(slide, title, lede=None):
    """Standard content-slide furniture: title, accent rule, footer."""
    tf = textbox(slide, MARGIN, Inches(0.62), CONTENT_W, Inches(0.6))
    write(tf, title, size=27, color=NAVY, bold=True, first=True)

    rect(slide, MARGIN, Inches(1.24), Inches(1.5), Pt(3), ROYAL)

    top = Inches(1.48)
    if lede:
        tf = textbox(slide, MARGIN, top, CONTENT_W, Inches(0.4))
        write(tf, lede, size=13.5, color=MUTED, first=True, line=1.25)
        top = Inches(1.48) + Inches(0.26) * (1 + len(lede) // 135)

    tf = textbox(slide, MARGIN, FOOTER_Y, CONTENT_W - Inches(0.5), Inches(0.25))
    write(tf, CONFIDENTIAL, size=8, color=MUTED, first=True)
    slide_number(slide, W - MARGIN - Inches(0.5), FOOTER_Y, Inches(0.5))

    return top


def blank(prs):
    return prs.slides.add_slide(prs.slide_layouts[6])


def caption(slide, text, top):
    tf = textbox(slide, MARGIN, top, CONTENT_W, Inches(0.4))
    write(tf, text, size=10, color=MUTED, italic=True, first=True, line=1.2)


def bullets(slide, items, top, width=CONTENT_W, left=MARGIN, size=14, gap=11):
    """Lead-in bold phrase, then the sentence, one paragraph per item."""
    tf = textbox(slide, left, top, width, H - top - Inches(1.0))
    for i, (lead, body) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        p.line_spacing = 1.22
        r = p.add_run()
        r.text = lead + "  "
        r.font.name, r.font.size, r.font.bold = FONT, Pt(size), True
        r.font.color.rgb = ROYAL
        r = p.add_run()
        r.text = body
        r.font.name, r.font.size = FONT, Pt(size)
        r.font.color.rgb = INK
    return tf


def callout(slide, top, text, height=Inches(0.78), accent=ROYAL):
    rect(slide, MARGIN, top, CONTENT_W, height, PANEL)
    rect(slide, MARGIN, top, Pt(3.5), height, accent)
    tf = textbox(slide, MARGIN + Inches(0.28), top + Inches(0.14),
                 CONTENT_W - Inches(0.5), height - Inches(0.2))
    write(tf, text, size=13.5, color=NAVY, bold=True, first=True, line=1.24)


# ------------------------------------------------------------------- slides

def cover(prs):
    slide = blank(prs)
    rect(slide, 0, 0, W, H, NAVY)
    rect(slide, 0, H - Inches(0.22), W, Inches(0.22), ROYAL)

    if LOGO.exists():
        slide.shapes.add_picture(str(LOGO), MARGIN, Inches(0.7), width=Inches(1.7))

    tf = textbox(slide, MARGIN, Inches(2.55), Inches(10.6), Inches(2.2))
    write(tf, "CAF Compliance", size=54, color=WHITE, bold=True, first=True)
    write(tf, "Compliance attestation, delivered where the business already works",
          size=21, color=COVER_SUB, space_before=10, line=1.2)

    rect(slide, MARGIN, Inches(4.62), Inches(2.2), Pt(3), ROYAL)

    tf = textbox(slide, MARGIN, Inches(4.95), Inches(10.6), Inches(1.1))
    write(tf, "Salesforce engagement layer  ·  ServiceNow compliance engine",
          size=15, color=WHITE, first=True)
    write(tf, "Proof of concept — decision brief", size=13, color=COVER_SUB,
          space_before=7)

    tf = textbox(slide, MARGIN, H - Inches(0.95), Inches(10.6), Inches(0.4))
    write(tf, CONFIDENTIAL, size=9, color=COVER_SUB, first=True)


def problem(prs):
    slide = blank(prs)
    top = chrome(prs and slide, "The engine works. The engagement doesn't.",
                 "CAF governs recurring compliance of critical business applications — backup and restore, "
                 "disaster recovery, RTO and RPO, high availability.")

    bullets(slide, [
        ("The control framework is sound.",
         "Controls, recurrence, overdue detection, approvals and the audit trail all run today in ServiceNow. "
         "Nothing about that needs to change."),
        ("The cost scales with participation, not with work.",
         "Every application owner and delegate approver who touches CAF needs a ServiceNow fulfiller licence — "
         "so the more people we ask to attest, the more it costs to let them."),
        ("Adoption is the named risk.",
         "Low portal adoption is already on the risk register. “I'm not logging into ServiceNow for this” "
         "is the whole problem in one sentence, and no amount of engine work fixes it."),
    ], top + Inches(0.34))

    callout(slide, Inches(4.78),
            "Compliance fails at the last mile — not because the rules are wrong, "
            "but because the people who must attest to them don't live in the tool that asks.")


def decision(prs):
    slide = blank(prs)
    chrome(slide, "One product. Two platforms. One system of record.")

    callout(slide, Inches(1.52),
            "The state machine and the system of record stay in ServiceNow. "
            "Salesforce holds a mirror, never a second opinion.")

    col_w = (CONTENT_W - Inches(0.4)) / 2
    right = MARGIN + col_w + Inches(0.4)
    head_y, body_y = Inches(2.66), Inches(3.22)

    for left, heading, rows, accent in (
        (MARGIN, "ServiceNow owns", [
            "Controls, relationships, task templates",
            "Request and task records — the system of record",
            "Recurrence, next due date, renewal",
            "Scheduled jobs and overdue detection",
            "Approvals engine and attestation outcome",
            "Roles, ACLs, row-level security",
        ], NAVY),
        (right, "Salesforce owns", [
            "The business-facing user interface",
            "Application-owner portfolio view",
            "Drill-in to request and task detail",
            "Evidence upload, held in Salesforce Files",
            "Attestation submission",
            "The CAF dashboard, as a Lightning component",
        ], ROYAL),
    ):
        rect(slide, left, head_y, col_w, Inches(0.42), accent)
        tf = textbox(slide, left + Inches(0.22), head_y + Inches(0.1), col_w, Inches(0.3))
        write(tf, heading, size=13.5, color=WHITE, bold=True, first=True)

        tf = textbox(slide, left + Inches(0.22), body_y, col_w - Inches(0.4), Inches(2.6))
        for i, row in enumerate(rows):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(8)
            hanging(p)
            r = p.add_run()
            r.text = "·  " + row
            r.font.name, r.font.size = FONT, Pt(12.5)
            r.font.color.rgb = INK

    callout(slide, Inches(5.86),
            "Zero change to the 24 business rules, the recurrence logic or the security model. "
            "The engine is untouched, so delivery risk stays low.", accent=GREEN)


def dashboard(prs):
    slide = blank(prs)
    chrome(slide, "What an application owner sees",
           "The CAF dashboard, inside Salesforce. Applications down the side, controls across the top — "
           "and the controls are drawn from the data, not from a fixed list.")

    picture(slide, "hero-dashboard", Inches(2.18))
    caption(slide, "Live capture from the proof-of-concept org. Each dot is one control on one application; "
                   "the Overall column is the verdict the business cares about. An application reads Compliant "
                   "only when every one of its controls does.", Inches(6.42))


def drill(prs):
    slide = blank(prs)
    chrome(slide, "From portfolio to the task in two clicks",
           "Selecting a dot opens the request behind it and the tasks that make it up.")

    picture(slide, "drill-in", Inches(2.18))

    bullets(slide, [
        ("Every action is a ServiceNow action.",
         "Salesforce sends the change, ServiceNow runs its own rules, and the resulting state comes back. "
         "The business user never sees the seam."),
        ("The available actions follow the state.",
         "An open task offers Start and Upload evidence; one in progress offers Attest; a closed one offers "
         "only its evidence — which is exactly what an audit asks for."),
    ], Inches(4.36))


def evidence(prs):
    slide = blank(prs)
    chrome(slide, "Evidence is gathered by the owner",
           "Upload the proof against the task it belongs to, without leaving Salesforce.")

    picture(slide, "evidence-owner", Inches(2.12))

    bullets(slide, [
        ("Two copies, deliberately.",
         "Salesforce keeps the file so it previews and downloads natively; ServiceNow keeps the copy an "
         "auditor is entitled to. Both are listed side by side, so a failed transfer is visible rather than assumed."),
    ], Inches(5.06))


def attestation(prs):
    slide = blank(prs)
    chrome(slide, "Evidence is judged by someone else",
           "The approver sees the evidence read-only beside the attestation — enough to judge it, "
           "with no ability to add to it.")

    # Narrower than content width, and centred: this panel is two columns of
    # unequal height, so at full width it runs past the caption. Scaling to fit
    # the space above the caption keeps the whole panel rather than cropping the
    # Reject note off the bottom of the taller column.
    attest_w = Inches(10.3)
    picture(slide, "attest-approver", Inches(2.16), width=attest_w, left=(W - attest_w) // 2)
    caption(slide, "Gathering evidence and attesting to it are separate panels because they are separate jobs. "
                   "An attestation with no evidence behind it is refused outright.", Inches(6.24))


def trust(prs):
    slide = blank(prs)
    top = chrome(slide, "A mirror is only useful if something checks it",
                 "Sync Health compares every mirrored record against ServiceNow and reports the difference.")

    picture(slide, "sync-strip", Inches(2.16))

    bullets(slide, [
        ("It really goes and looks.",
         "The check is a live call to ServiceNow on every run, not a cached figure — so a green strip is "
         "evidence, not decoration."),
        ("Detection is automatic; repair never is.",
         "Drift is surfaced next to a Re-sync button that a person presses. Unattended repair can turn a "
         "Salesforce problem into a ServiceNow one."),
        ("Repair only ever flows one way.",
         "ServiceNow overwrites Salesforce. A mirror that disagrees with the system of record is stale by "
         "definition, so there is nothing to negotiate."),
    ], Inches(3.16))


def assurance_method(prs):
    slide = blank(prs)
    chrome(slide, "How we know it works",
           "A written test pack, executed by an automated harness against both live platforms.")

    stats = [
        ("130", "test cases specified", NAVY),
        ("31", "executed to date", ROYAL),
        ("49", "records verified in sync", GREEN),
        # Six cases failed, but two pairs of them are the same defect seen from
        # each platform — so the tile counts cases and slide 11 counts defects.
        ("6", "failing cases, 4 distinct defects", MAROON),
    ]
    box_w = (CONTENT_W - Inches(0.45)) / 4
    for i, (figure, label, colour) in enumerate(stats):
        left = MARGIN + i * (box_w + Inches(0.15))
        rect(slide, left, Inches(2.12), box_w, Inches(1.24), PANEL)
        rect(slide, left, Inches(2.12), box_w, Pt(3.5), colour)
        tf = textbox(slide, left + Inches(0.2), Inches(2.36), box_w - Inches(0.3), Inches(0.6))
        write(tf, figure, size=32, color=colour, bold=True, first=True)
        tf = textbox(slide, left + Inches(0.2), Inches(2.94), box_w - Inches(0.3), Inches(0.4))
        write(tf, label, size=11, color=MUTED, first=True, line=1.1)

    bullets(slide, [
        ("Two proofs for every case.",
         "Each case records what the screen showed and what the underlying record holds. A green confirmation "
         "message proves a form submitted, not that the rule behind it ran — and this architecture's "
         "characteristic failure is the two platforms quietly disagreeing, which a one-sided check cannot see."),
        ("Nothing is retyped between specification and result.",
         "The evidence documents are generated from the test definitions and the recorded run, so a document "
         "cannot claim an expected result the specification does not contain."),
        ("The 99 unexecuted cases are held by decision, not by capability.",
         "The harness covers all of them. Each one writes to a live platform, and those runs are being held "
         "for sign-off — several consume records that cannot be reset."),
    ], Inches(3.72), gap=9, size=13.5)


def assurance_results(prs):
    slide = blank(prs)
    chrome(slide, "What has been run, and what it returned",
           "Every case below was executed against the live proof-of-concept environment.")

    rows = [
        ("Salesforce user interface", "7", "7 pass", "Dashboard, drill-in, evidence and attestation panels, sync strip", GREEN),
        ("Integration, record level", "17", "13 pass · 3 fail · 1 blocked", "Mirror integrity, idempotency, echo-loop guard, API budget", AMBER),
        ("ServiceNow engine and portal", "7", "4 pass · 3 fail", "Data model, choice sets, compliance roll-up, approvals", AMBER),
    ]

    table_top = Inches(2.28)
    widths = [Inches(3.0), Inches(1.0), Inches(2.55), Inches(4.98)]
    heads = ["Area", "Cases", "Result", "What it covered"]

    rect(slide, MARGIN, table_top, CONTENT_W, Inches(0.42), NAVY)
    x = MARGIN
    for w, head in zip(widths, heads):
        tf = textbox(slide, x + Inches(0.16), table_top + Inches(0.11), w - Inches(0.2), Inches(0.3))
        write(tf, head, size=12, color=WHITE, bold=True, first=True)
        x += w

    y = table_top + Inches(0.42)
    for area, count, result, covers, colour in rows:
        rect(slide, MARGIN, y, CONTENT_W, Inches(0.62), None, line=RULE, line_w=Pt(0.75))
        x = MARGIN
        for w, text, size, bold, col in (
            (widths[0], area, 12.5, True, INK),
            (widths[1], count, 12.5, False, INK),
            (widths[2], result, 12.5, True, colour),
            (widths[3], covers, 11.5, False, MUTED),
        ):
            tf = textbox(slide, x + Inches(0.16), y + Inches(0.19), w - Inches(0.24), Inches(0.4))
            write(tf, text, size=size, color=col, bold=bold, first=True)
            x += w
        y += Inches(0.62)

    bullets(slide, [
        ("The six failures are one small set of defects, seen from both sides.",
         "None is a fault in the test harness, and none blocks the demonstration. The material one is on "
         "the next slide."),
        ("Start, Approve and Reject were read as controls and deliberately not clicked.",
         "Each closes a task irreversibly in the system of record."),
    ], Inches(4.86), gap=10, size=13)


def finding(prs):
    slide = blank(prs)
    chrome(slide, "The finding that matters",
           "The two platforms disagree about which applications are compliant — and Salesforce is the one "
           "that has it right.")

    tf = textbox(slide, MARGIN, Inches(2.24), CONTENT_W, Inches(0.3))
    write(tf, "ServiceNow — reads Compliant for both", size=12, color=MAROON, bold=True, first=True)
    picture(slide, "sn-grid-pair", Inches(2.54))

    tf = textbox(slide, MARGIN, Inches(4.46), CONTENT_W, Inches(0.3))
    write(tf, "Salesforce — reads 2 of 6 for both", size=12, color=GREEN, bold=True, first=True)
    picture(slide, "sf-grid-pair", Inches(4.76))

    callout(slide, Inches(5.92),
            "Same two applications, same control results — four of six out of compliance each. Salesforce "
            "computes the roll-up and is arithmetically right; the ServiceNow field is set by a rule that "
            "never checks sibling controls. One rule to fix, and the mirror needs no change.",
            height=Inches(0.86), accent=MAROON)


def status(prs):
    slide = blank(prs)
    chrome(slide, "Where this stands")

    col_w = (CONTENT_W - Inches(0.4)) / 2
    right = MARGIN + col_w + Inches(0.4)

    for left, heading, rows, accent in (
        (MARGIN, "Proven and working", [
            "Compliance dashboard in Salesforce, live against ServiceNow data",
            "19 requests and 30 tasks mirrored, verified record by record",
            "Evidence upload, stored on both platforms",
            "Attestation end to end — approve, close, update compliance status",
            "Sync Health: drift detected, repaired, and confirmed clean",
        ], GREEN),
        (right, "Not yet built", [
            "The licence-free access surface — the point of the whole business case",
            "Automated test coverage on the Salesforce service classes",
            "A named approver on the record, rather than whoever pressed the button",
            "Queued delivery, so a ServiceNow outage doesn't surface to the user",
            "Production security model — deliberately out of scope for the proof of concept",
        ], AMBER),
    ):
        rect(slide, left, Inches(1.62), col_w, Inches(0.42), accent)
        tf = textbox(slide, left + Inches(0.22), Inches(1.72), col_w, Inches(0.3))
        write(tf, heading, size=13.5, color=WHITE, bold=True, first=True)

        tf = textbox(slide, left + Inches(0.22), Inches(2.24), col_w - Inches(0.4), Inches(3.4))
        for i, row in enumerate(rows):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(11)
            p.line_spacing = 1.18
            hanging(p)
            r = p.add_run()
            r.text = "·  " + row
            r.font.name, r.font.size = FONT, Pt(12.5)
            r.font.color.rgb = INK

    callout(slide, Inches(5.34),
            "The engagement layer is demonstrably real. What remains is the access surface that converts it "
            "into the licence saving, and the hardening any move toward production would require.")


def ask(prs):
    slide = blank(prs)
    chrome(slide, "What we're asking for")

    items = [
        ("Fix the compliance roll-up rule.",
         "One ServiceNow business rule. It makes both grids agree and removes the only defect a business "
         "user would actually notice."),
        ("Decide on the licence-free access surface.",
         "Confirm the available Experience Cloud licence count, then approve building the site. Until this "
         "exists, the adoption and licensing argument is demonstrated but not delivered."),
        ("Release the remaining test cases to run.",
         "99 specified cases are held pending approval to write to the live environment. The harness is built; "
         "what is needed is sign-off."),
        ("Fund the production-readiness work.",
         "Automated test coverage, queued delivery, a named approver on the record, and the security model "
         "that was deliberately deferred."),
    ]

    y = Inches(1.66)
    for i, (lead, body) in enumerate(items, start=1):
        # Step by how tall this item actually is, so a two-line body doesn't
        # leave the next number floating in a gap of its own making.
        step = Inches(1.02) if len(body) < 105 else Inches(1.26)
        rect(slide, MARGIN, y, Inches(0.44), Inches(0.44), ROYAL)
        tf = textbox(slide, MARGIN, y + Inches(0.1), Inches(0.44), Inches(0.3))
        write(tf, str(i), size=14, color=WHITE, bold=True, align=PP_ALIGN.CENTER, first=True)

        tf = textbox(slide, MARGIN + Inches(0.68), y + Inches(0.02),
                     CONTENT_W - Inches(0.68), Inches(1.0))
        write(tf, lead, size=15, color=NAVY, bold=True, first=True)
        write(tf, body, size=12.5, color=INK, space_before=3, line=1.2)
        y += step

    tf = textbox(slide, MARGIN, Inches(6.3), CONTENT_W, Inches(0.35))
    write(tf, "The compliance engine does not change. Everything above is delivery around it.",
          size=13, color=ROYAL, bold=True, italic=True, first=True)


# --------------------------------------------------------------------- build

def main():
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H

    for builder in (cover, problem, decision, dashboard, drill, evidence,
                    attestation, trust, assurance_method, assurance_results,
                    finding, status, ask):
        builder(prs)

    prs.save(OUTPUT)
    print(f"{len(prs.slides.__iter__.__self__._sldIdLst)} slides -> {OUTPUT}")


if __name__ == "__main__":
    main()
