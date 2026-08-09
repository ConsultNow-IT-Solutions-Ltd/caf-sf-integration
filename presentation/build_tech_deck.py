"""
CAF Compliance — technical architecture brief (16:9 PowerPoint).

The engineering counterpart to build_deck.py. Where that deck argues the business
case with screenshots of the product, this one states the integration contract:
what talks to what, over which credential, in which direction, and what happens
when it fails. The audience is an architect or an engineer who has to change this
system without breaking it, so the slides carry the reasoning behind each choice
rather than only the choice.

Palette, chrome and primitives are imported from build_deck rather than copied,
so a change to the house style reaches both decks and they cannot drift apart.

    python build_tech_deck.py

Sources: HANDOFF.md (architecture, deviations, traps), the deployed Scripted REST
resources under servicenow/, and testing/README.md for the assurance figures.
Carries no dates anywhere, following the convention set for the evidence packs.
"""

from pathlib import Path

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

from build_deck import (
    AMBER, CONFIDENTIAL, CONTENT_W, COVER_SUB, FONT, GREEN, H, INK, LOGO,
    MARGIN, MAROON, MUTED, NAVY, PANEL, ROYAL, RULE, W, WHITE,
    blank, bullets, callout, chrome, hanging, rect, textbox, write,
)

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "CAF Compliance - Technical Architecture.pptx"

# Endpoint paths, field names and class names are set in a monospaced face. In a
# technical deck these are identifiers to be typed exactly, not prose, and a
# proportional font makes `vqd_link_2` and `vqd_link2` look the same from row 6.
MONO = "Consolas"


# ---------------------------------------------------------------- primitives

def mono(p, color=None):
    """Re-face an already-written paragraph as code. Returns it, for chaining."""
    for r in p.runs:
        r.font.name = MONO
        if color is not None:
            r.font.color.rgb = color
    return p


def chip(slide, left, top, width, height, text, *, fill=PANEL, border=RULE,
         color=INK, size=11, bold=False, accent=None, code=False,
         align=PP_ALIGN.CENTER):
    """A labelled box. The unit every diagram on these slides is built from."""
    rect(slide, left, top, width, height, fill, line=border, line_w=Pt(0.75))
    if accent:
        rect(slide, left, top, width, Pt(3), accent)
    tf = textbox(slide, left + Inches(0.11), top + Inches(0.1),
                 width - Inches(0.22), height - Inches(0.18))
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = write(tf, text, size=size, color=color, bold=bold, first=True,
              align=align, line=1.14)
    if code:
        mono(p)
    return p


def arrow(slide, left, top, width, height, *, down=False, fill=ROYAL):
    shape = slide.shapes.add_shape(
        MSO_SHAPE.DOWN_ARROW if down else MSO_SHAPE.RIGHT_ARROW,
        left, top, width, height)
    shape.shadow.inherit = False
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    return shape


def label(slide, left, top, width, text, *, size=9.5, color=MUTED,
          align=PP_ALIGN.CENTER, bold=False, code=False):
    tf = textbox(slide, left, top, width, Inches(0.3))
    p = write(tf, text, size=size, color=color, bold=bold, first=True,
              align=align, line=1.12)
    if code:
        mono(p)
    return p


def table(slide, top, widths, heads, rows, *, row_h=Inches(0.5), size=11):
    """
    A header bar and bordered rows.

    Each cell is either a string or a (text, colour, bold, code) tuple with the
    trailing members optional, so a status column can carry its own colour
    without the caller building a parallel structure to hold it.
    """
    rect(slide, MARGIN, top, CONTENT_W, Inches(0.4), NAVY)
    x = MARGIN
    for w, head in zip(widths, heads):
        tf = textbox(slide, x + Inches(0.14), top + Inches(0.1), w - Inches(0.2), Inches(0.3))
        write(tf, head, size=11, color=WHITE, bold=True, first=True)
        x += w

    y = top + Inches(0.4)
    for row in rows:
        rect(slide, MARGIN, y, CONTENT_W, row_h, None, line=RULE, line_w=Pt(0.75))
        x = MARGIN
        for w, cell in zip(widths, row):
            text, colour, bold, code = (cell + (INK, False, False)[len(cell) - 1:]
                                        if isinstance(cell, tuple)
                                        else (cell, INK, False, False))
            tf = textbox(slide, x + Inches(0.14), y, w - Inches(0.24), row_h)
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            p = write(tf, text, size=size, color=colour, bold=bold, first=True, line=1.14)
            if code:
                mono(p)
            x += w
        y += row_h
    return y


def column(slide, left, top, width, heading, accent, rows, *, size=11.5,
           gap=8, height=Inches(3.0)):
    """A headed list. Used wherever two sides are being contrasted."""
    rect(slide, left, top, width, Inches(0.4), accent)
    tf = textbox(slide, left + Inches(0.2), top + Inches(0.09), width, Inches(0.3))
    write(tf, heading, size=12.5, color=WHITE, bold=True, first=True)

    tf = textbox(slide, left + Inches(0.2), top + Inches(0.56),
                 width - Inches(0.38), height)
    for i, row in enumerate(rows):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        p.line_spacing = 1.18
        hanging(p)
        r = p.add_run()
        r.text = "·  " + row
        r.font.name, r.font.size = FONT, Pt(size)
        r.font.color.rgb = INK
    return tf


# -------------------------------------------------------------------- slides

def cover(prs):
    slide = blank(prs)
    rect(slide, 0, 0, W, H, NAVY)
    rect(slide, 0, H - Inches(0.22), W, Inches(0.22), ROYAL)

    if LOGO.exists():
        slide.shapes.add_picture(str(LOGO), MARGIN, Inches(0.7), width=Inches(1.7))

    tf = textbox(slide, MARGIN, Inches(2.5), Inches(11.0), Inches(2.2))
    write(tf, "CAF Compliance", size=54, color=WHITE, bold=True, first=True)
    write(tf, "Technical architecture and the integration contract",
          size=21, color=COVER_SUB, space_before=10, line=1.2)

    rect(slide, MARGIN, Inches(4.6), Inches(2.2), Pt(3), ROYAL)

    tf = textbox(slide, MARGIN, Inches(4.92), Inches(11.0), Inches(1.1))
    write(tf, "ServiceNow scoped app  ·  Salesforce Lightning  ·  bidirectional REST",
          size=15, color=WHITE, first=True)
    write(tf, "Engineering brief — for the people who have to change it",
          size=13, color=COVER_SUB, space_before=7)

    tf = textbox(slide, MARGIN, H - Inches(0.95), Inches(11.0), Inches(0.4))
    write(tf, CONFIDENTIAL, size=9, color=COVER_SUB, first=True)


def governing_rule(prs):
    slide = blank(prs)
    top = chrome(slide, "The rule everything else follows from",
                 "One logical product, split across two platforms. The seam is the engagement layer, "
                 "not the state machine.")

    bullets(slide, [
        ("State and the system of record stay in ServiceNow.",
         "Recurrence arithmetic, next due date, overdue detection, state transitions, approvals and the "
         "security model are all state logic. Splitting state across two platforms produces split-brain: "
         "two schedulers, two truths about whether a request is closed, and an audit trail nobody trusts."),
        ("Salesforce holds a mirror, never a second opinion.",
         "It renders, it collects, it submits. Every decision that changes a record is taken by a ServiceNow "
         "business rule, and the result is pushed back to the mirror."),
        ("The engine is untouched.",
         "24 business rules, 2 script includes, 2 Flow Designer flows, 6 roles, 48+ ACLs and 2 scheduled jobs "
         "are exactly as they were. The integration adds to the app; it does not modify it."),
    ], top + Inches(0.3), size=13.5, gap=10)

    callout(slide, Inches(5.62),
            "Read every design decision in this deck against that rule. Where the integration looks more "
            "complicated than it needs to be, it is almost always because the simpler version put a piece of "
            "state on the wrong side of the seam.")


def context(prs):
    slide = blank(prs)
    chrome(slide, "What talks to what",
           "Two platforms, two credentials, two directions — and no shared database between them.")

    panel_w, panel_top, panel_h = Inches(4.55), Inches(2.05), Inches(3.62)
    right_x = W - MARGIN - panel_w

    for left, heading, accent, rows in (
        (MARGIN, "ServiceNow  ·  x_gskn2_caf_compli", NAVY, [
            ("caf_req  ·  caf_tsk", True),
            ("caf_conformance_type  ·  caf_relationship", True),
            ("24 business rules  ·  2 flows", False),
            ("CAFSalesforceSync (script include)", True),
            ("Scripted REST API — 6 resources", False),
        ]),
        (right_x, "Salesforce  ·  Lightning", ROYAL, [
            ("CAF_Request__c  ·  CAF_Task__c", True),
            ("CAF_Control_Catalog__c", True),
            ("CafTaskService  ·  CafSyncHealth", True),
            ("CafEvidenceService  ·  CafAttestationService", True),
            ("cafDashboard  ·  cafSyncHealth  ·  cafEvidence", True),
        ]),
    ):
        rect(slide, left, panel_top, panel_w, panel_h, None, line=RULE, line_w=Pt(0.75))
        rect(slide, left, panel_top, panel_w, Inches(0.4), accent)
        tf = textbox(slide, left + Inches(0.18), panel_top + Inches(0.09), panel_w, Inches(0.3))
        write(tf, heading, size=12, color=WHITE, bold=True, first=True)

        y = panel_top + Inches(0.58)
        for text, code in rows:
            chip(slide, left + Inches(0.18), y, panel_w - Inches(0.36), Inches(0.5),
                 text, size=10.5, code=code)
            y += Inches(0.6)

    mid_x = MARGIN + panel_w
    mid_w = right_x - mid_x

    label(slide, mid_x, Inches(2.62), mid_w, "Outbound  ·  ServiceNow → Salesforce",
          size=10, color=NAVY, bold=True)
    arrow(slide, mid_x + Inches(0.18), Inches(2.92), mid_w - Inches(0.36), Inches(0.3))
    label(slide, mid_x, Inches(3.28), mid_w,
          "async business rules → OAuth client credentials → upsert on External Id", size=8.5)

    label(slide, mid_x, Inches(4.12), mid_w, "Inbound  ·  Salesforce → ServiceNow",
          size=10, color=ROYAL, bold=True)
    arrow(slide, mid_x + Inches(0.18), Inches(4.42), mid_w - Inches(0.36), Inches(0.3),
          fill=NAVY).rotation = 180
    label(slide, mid_x, Inches(4.78), mid_w,
          "Apex → named credential, basic auth as sf.integration → Scripted REST", size=8.5)

    callout(slide, Inches(5.94),
            "Nothing is shared, replicated at the database level, or read through. Every crossing is an "
            "explicit HTTP call with its own credential, which is what makes each direction separately "
            "testable and separately disableable.", height=Inches(0.82))


def correlation(prs):
    slide = blank(prs)
    top = chrome(slide, "Correlation, and why replay is safe",
                 "The ServiceNow sys_id is the only join key, and it travels in one direction only.")

    bullets(slide, [
        ("Every write is an upsert on an External Id.",
         "The ServiceNow sys_id is stored in ServiceNow_Sys_Id__c on each Salesforce object, and every push "
         "upserts against it. A push that fails can simply be sent again — there is no create-or-update "
         "decision to get wrong, and no duplicate to clean up."),
        ("No Salesforce Id is ever stored in ServiceNow.",
         "Correlation is one-directional, which is what makes a Salesforce org rebuild survivable: reload the "
         "objects, re-push, and the mirror reassembles itself. The reverse would strand every ServiceNow "
         "record against Ids that no longer exist."),
        ("The control name is not a join key.",
         "CAF_Request__c.CAF_Control__c holds the name as it stood at the last push, so renaming a control "
         "strands the old label on every mirrored request. CAF_Control_Sys_Id__c was added for this; the grid "
         "joins on it and falls back to the name only for records pushed before the field existed."),
    ], top + Inches(0.3), size=13, gap=10)

    callout(slide, Inches(5.86),
            "Idempotency here is a property of the key, not of retry logic. That is deliberate — retry logic "
            "is a thing that can be wrong, and an External Id cannot.", accent=GREEN)


def outbound(prs):
    slide = blank(prs)
    chrome(slide, "Outbound — ServiceNow to Salesforce",
           "Async business rules call one script include, which requests its own token and upserts.")

    table(slide, Inches(2.12),
          [Inches(3.5), Inches(1.5), Inches(1.5), Inches(5.133)],
          ["Business rule", "When", "Fires on", "Effect in Salesforce"],
          [
              [("CAF - Push Request to Salesforce", INK, True, True), "async", "insert, update",
               "upsert CAF_Request__c"],
              [("CAF - Push Task to Salesforce", INK, True, True), "async", "insert, update",
               "upsert CAF_Task__c"],
              [("CAF - Push Control to Salesforce", INK, True, True), "async", "insert, update",
               "upsert CAF_Control_Catalog__c"],
              [("CAF - Retire Control in Salesforce", INK, True, True),
               ("after", MAROON, True, False), ("delete", MAROON, True, False),
               ("same upsert with Active__c = false", MAROON, False, False)],
          ], row_h=Inches(0.52))

    bullets(slide, [
        ("The retire rule is synchronous on purpose — the one departure from the pattern.",
         "An async rule runs after the transaction commits, by which point the record is gone and the sys_id "
         "it needs as the upsert key is exactly what is no longer there. An after-delete rule still holds the "
         "deleted values. The usual objection — a slow Salesforce hanging the save — is weak here: deleting a "
         "control is a rare admin action, and the push never throws."),
        ("Client Credentials, not JWT bearer.",
         "ServiceNow's jwt_provider table has no fields for iss, sub or aud, which Salesforce requires, so JWT "
         "needs a custom JWT API Script. JWT remains the better production answer and is recorded as a "
         "deviation, not as a decision."),
    ], Inches(4.62), size=12.5, gap=9)


def echo_loop(prs):
    slide = blank(prs)
    chrome(slide, "The echo-loop guard, and why it is not enough on its own",
           "The hardest-won fix in this integration. It looks removable and is not.")

    col_w = (CONTENT_W - Inches(0.4)) / 2
    right = MARGIN + col_w + Inches(0.4)

    column(slide, MARGIN, Inches(2.04), col_w, "The guard alone — measured failure", MAROON, [
        "Outbound rules skip anything sf.integration wrote, which stops a Salesforce update bouncing back.",
        "But cascading rules run in the same transaction and carry the same user, so they are skipped too.",
        "A task moved to In Progress moved its parent request in ServiceNow while Salesforce still read Open.",
        "No push was logged for either record. Silent, and invisible to both user interfaces.",
    ], size=11.5, gap=9, height=Inches(2.5))

    column(slide, right, Inches(2.04), col_w, "The fix — reconcile explicitly", GREEN, [
        "Each inbound resource ends by pushing exactly two records: the task, and its parent request.",
        "Triggered by the request rather than by a record change, so no loop can form from it.",
        "Bounded and deliberate: two upserts, not a relaxed guard that would re-open the loop.",
        "Derived changes therefore reach the mirror even though the guard skipped them.",
    ], size=11.5, gap=9, height=Inches(2.5))

    callout(slide, Inches(5.02),
            "Do not simplify this away. The reconcile reads like redundant work next to the guard, and removing "
            "it reintroduces a failure that no test notices unless it compares both platforms — which is why "
            "the test pack asserts on both sides of every state transition.",
            height=Inches(0.9), accent=MAROON)

    # Two lines at this size need ~0.5in of copy plus the panel's own padding.
    # A 0.6in box renders the second line over the footer rule.
    callout(slide, Inches(6.02),
            "The reconcile pushes the attested task and its parent — not a sibling task a flow spawns during "
            "the same transaction. That gap is known and untested.", height=Inches(0.76), accent=AMBER)


def inbound(prs):
    slide = blank(prs)
    chrome(slide, "Inbound — the API surface",
           "Six resources, one credential, and an allow-list that refuses the whole call rather than part of it.")

    table(slide, Inches(2.0),
          [Inches(4.9), Inches(1.15), Inches(5.583)],
          ["Resource", "Method", "Contract"],
          [
              [("/caf/snapshot", INK, True, True), "GET",
               "Read-only comparison feed — number, status, state, description, updated_on"],
              [("/caf/resync/{type}/{sysId}", INK, True, True), "POST",
               "Re-push one record. Changes nothing in ServiceNow"],
              [("/caf/task/{sysId}", INK, True, True), "PATCH",
               "Six allow-listed fields. Any other field fails the whole call with 400"],
              [("/caf/task/{sysId}/evidence", INK, True, True), "POST",
               "base64 in, sys_attachment out. 2 MB ceiling"],
              [("/caf/task/{sysId}/evidence", INK, True, True), "GET",
               "What ServiceNow actually holds. Read-only"],
              [("/caf/task/{sysId}/attest", INK, True, True), "POST",
               "The gate, then the outcome. 400 / 404 / 409 / 428"],
          ], row_h=Inches(0.46), size=11)

    tf = textbox(slide, MARGIN, Inches(5.12), CONTENT_W, Inches(0.3))
    p = write(tf, "WRITABLE = ['state', 'met_criteria', 'approval', 'comments', 'vqd_link', 'vqd_link_2']",
              size=11.5, color=ROYAL, bold=True, first=True)
    mono(p)

    bullets(slide, [
        ("An allow-list, not a deny-list.",
         "The interesting fields on a CAF Task are system-managed — number, active, actual dates, business "
         "application — and letting an external system set them would corrupt the state machine."),
        ("The whole call is refused, never the writable subset.",
         "A caller that believes it set met_criteria and did not is worse than an error."),
    ], Inches(5.58), size=12.5, gap=8)


def attestation(prs):
    slide = blank(prs)
    chrome(slide, "What an attestation actually does",
           "The endpoint writes three fields. Everything after that is the engine that already existed.")

    steps = [
        ("POST /attest\nmet_criteria, outcome,\ncomments", ROYAL, True),
        ("Endpoint writes\nthree fields\nand nothing else", NAVY, False),
        ("Business rule\n“success criteria not met”\ncloses the task", NAVY, False),
        ("Parent request\ncaf_status set in or\nout of compliance", NAVY, False),
        ("Flow spawns the\nnext task in the\ntemplate chain", AMBER, False),
    ]
    chip_w, gap = Inches(2.0), Inches(0.41)
    y = Inches(2.22)
    x = MARGIN
    for i, (text, accent, code) in enumerate(steps):
        chip(slide, x, y, chip_w, Inches(1.16), text, size=10, accent=accent, code=code)
        if i < len(steps) - 1:
            arrow(slide, x + chip_w + Inches(0.06), y + Inches(0.43), gap - Inches(0.12), Inches(0.3))
        x += chip_w + gap

    bullets(slide, [
        ("The transition was not rebuilt, and must not be.",
         "Setting approval is the whole act. The active rule closes the task and moves the parent's compliance "
         "status; implementing that in the endpoint would put a second copy of the transition beside the one "
         "the AngularJS portal already runs."),
        ("Closing a task does not close its request.",
         "Measured: the flow creates the next task in the chain instead. The request closes only once that "
         "second task is attested too — which is why the feature works per task rather than per request."),
        ("approval = 'requested' is the default, not a submitted state.",
         "Most tasks read requested with nobody having submitted anything, and sysapproval_approver holds "
         "effectively no CAF records. The act is requested → approved or rejected; there is no submit step to "
         "model, and no named approver on the record."),
    ], Inches(3.72), size=12.5, gap=9)

    callout(slide, Inches(5.86),
            "Every step after the first is code that already existed. The integration's entire contribution to "
            "an attestation is three field writes and two explicit pushes — which is why adding it changed no "
            "business rule and no flow.", height=Inches(0.84), accent=GREEN)


def evidence(prs):
    slide = blank(prs)
    top = chrome(slide, "Evidence — two copies, on purpose",
                 "One file, stored on both platforms, reconciled by neither.")

    col_w = (CONTENT_W - Inches(0.4)) / 2
    right = MARGIN + col_w + Inches(0.4)

    column(slide, MARGIN, Inches(2.04), col_w, "Salesforce keeps the ContentVersion", ROYAL, [
        "Preview, download and the standard Files related list work with no round trip.",
        "Linked through ContentDocumentLink — not FirstPublishLocationId, which returns nothing for a "
        "file uploaded by lightning-file-upload.",
    ], size=11.5, gap=9, height=Inches(1.5))

    column(slide, right, Inches(2.04), col_w, "ServiceNow keeps the sys_attachment", NAVY, [
        "The copy an auditor is entitled to, written by GlideSysAttachment().writeBase64().",
        "The only copy the attestation gate counts. A file visible in Salesforce with no ServiceNow "
        "attachment behind it is still refused.",
    ], size=11.5, gap=9, height=Inches(1.5))

    bullets(slide, [
        ("They are not reconciled, and should not be.",
         "Unlike a mirrored field there is no value to disagree about. Both lists are shown side by side, so a "
         "failed push is visible rather than inferred, and a count mismatch raises a warning in the panel."),
        ("The gate lives in the endpoint, not in the business rule.",
         "CAF - attachment mandatory for def tasks implements the same check and is deliberately inactive: "
         "activating it would change closure behaviour for the portal and for admins, and every pre-existing "
         "task has no attachment. The gate binds callers of this endpoint and nobody else."),
        ("2 MB per file, and one file per transaction.",
         "Apex holds the Blob and its base64 expansion in the same 6 MB heap and caps a callout body at 6 MB. "
         "Apex also cannot call out after DML in the same transaction, so uploading and pushing are two "
         "transactions by necessity, not by choice."),
    ], Inches(3.96), size=12.5, gap=9)


def catalogue(prs):
    slide = blank(prs)
    top = chrome(slide, "The control catalogue, and what a delete means",
                 "Columns come from the control table, not from the requests — and a deleted control has to "
                 "stop being a column.")

    bullets(slide, [
        ("The two grids once derived their columns differently.",
         "ServiceNow read the control table; Salesforce read the distinct control names present on mirrored "
         "requests. A control with no requests therefore had a column on one platform and none on the other. "
         "The fix was to mirror the catalogue itself."),
        ("A control with no request against it shows N/A, and stays out of the denominator.",
         "An application is compliant only when every control it has actually been assessed against is. "
         "Counting N/A would mean adding a control in ServiceNow silently marks every application "
         "non-compliant — a scoring change disguised as a display change."),
        ("Deletes propagate for controls, and for nothing else.",
         "An orphaned control is a visible column, not a stray row, so the retire rule mirrors a delete as "
         "Active__c = false and the column disappears. Requests and tasks propagate no delete in either "
         "direction and should not start to: a control is reference data, a request carries compliance "
         "history, and a delete cannot be undone by a re-sync."),
    ], top + Inches(0.3), size=12.5, gap=10)

    callout(slide, Inches(5.72),
            "Mid-cleanup is the hazardous state. Because the sync upserts on External Id, updating a "
            "not-yet-deleted ServiceNow record recreates its Salesforce twin — so a half-finished tidy-up can "
            "undo itself.", height=Inches(0.82), accent=AMBER)


def sync_health(prs):
    slide = blank(prs)
    chrome(slide, "Sync Health — the component that answers “is the mirror still true?”",
           "Detection is automatic. Repair never is.")

    kinds = [
        ("In ServiceNow,\nmissing in Salesforce", "a failed push", MAROON),
        ("In Salesforce,\nmissing in ServiceNow", "an orphan, mid-cleanup", MAROON),
        ("Same record,\ndifferent values", "the echo-loop stranding", AMBER),
        ("Salesforce\nsimply stale", "a push that never fired", AMBER),
    ]
    box_w = (CONTENT_W - Inches(0.45)) / 4
    for i, (title, gloss, colour) in enumerate(kinds):
        left = MARGIN + i * (box_w + Inches(0.15))
        rect(slide, left, Inches(2.08), box_w, Inches(1.18), PANEL)
        rect(slide, left, Inches(2.08), box_w, Pt(3.5), colour)
        tf = textbox(slide, left + Inches(0.18), Inches(2.32), box_w - Inches(0.3), Inches(0.6))
        write(tf, title, size=11.5, color=NAVY, bold=True, first=True, line=1.16)
        tf = textbox(slide, left + Inches(0.18), Inches(2.9), box_w - Inches(0.3), Inches(0.3))
        write(tf, gloss, size=10, color=MUTED, italic=True, first=True)

    label(slide, MARGIN, Inches(3.42), CONTENT_W,
          "Each of the four has actually occurred on this build.", size=10.5, color=MUTED,
          align=PP_ALIGN.LEFT)

    bullets(slide, [
        ("Repair only ever flows ServiceNow → Salesforce.",
         "A mirror that disagrees with the system of record is stale by definition, so there is nothing to "
         "negotiate. Unattended repair could turn a Salesforce problem into a ServiceNow one, so Re-sync is a "
         "button next to a difference someone is looking at."),
        ("No cacheable=true, deliberately.",
         "An Apex method that makes a callout cannot be cacheable, so the component calls it imperatively — "
         "which is also what makes Re-check honest. It really does go and look."),
        ("Blank equals null.",
         "ServiceNow returns null for an empty field and Salesforce may hold either. Treating them as "
         "different would report drift on every record with an empty approval, which is most of them."),
        ("It compares number, status, state, approval, criteria and description — not Name.",
         "Name is mirrored and editable, so drift introduced by editing it is invisible until the next push "
         "overwrites it. Either make it read-only or add it to the comparison."),
    ], Inches(3.86), size=12, gap=7)


def failure_modes(prs):
    slide = blank(prs)
    chrome(slide, "Failure modes and operating limits",
           "What breaks, how it presents, and what it costs.")

    table(slide, Inches(2.0),
          [Inches(3.3), Inches(4.1), Inches(4.233)],
          ["Condition", "How it presents", "What to do"],
          [
              ["A push fails",
               ("Nothing. Fire-and-forget — gs.error and return", MAROON, False, False),
               "syslog, filtered on the object name. Sync Health is the safety net"],
              ["ServiceNow is down",
               "A failed action in the Salesforce UI",
               "Nothing is queued. Every call is synchronous — Platform Events are not built"],
              ["A record is deleted",
               "An orphan on the other side, indefinitely",
               "Delete it there too. Controls are the exception and retire automatically"],
              ["Outbound must be stopped",
               ("Set sf.enabled = false — the kill switch", INK, True, True),
               "All pushes stop immediately. Confirm it is back to true afterwards"],
              ["API budget",
               "15,000 inbound calls per 24 hours",
               "One end-to-end journey costs ~45. sf deploys draw on the same budget"],
          ], row_h=Inches(0.54), size=11)

    callout(slide, Inches(5.28),
            "A push is fire-and-forget because a Salesforce outage must not roll back the ServiceNow "
            "transaction that triggered it. That is the right trade — but it means a failed push exists only "
            "as a log line nobody reads, which is the entire reason Sync Health exists.",
            height=Inches(0.86))


def traps(prs):
    slide = blank(prs)
    chrome(slide, "Traps already paid for",
           "Each of these cost a debugging round. All of them fail silently or name the wrong cause.")

    col_w = (CONTENT_W - Inches(0.4)) / 2
    right = MARGIN + col_w + Inches(0.4)

    column(slide, MARGIN, Inches(2.0), col_w, "ServiceNow", NAVY, [
        "getValue() on a boolean returns '1', not 'true' — the Table API's JSON says otherwise, and a check "
        "written from what a read shows refused every attestation.",
        "A read-only dictionary field is silently dropped by the Table API: HTTP 200, values echoed back, "
        "nothing written.",
        "Writing a field its existing value is a no-op and fires no business rule — indistinguishable at a "
        "glance from the above.",
        "Scripted REST wraps every response in result. Parsing the top level yields a one-key map and a null "
        "for every field.",
        "Non-ASCII in a JSON body is rejected with a 400 that names nothing.",
        "Server-side JS is Helsinki ES5 — no let, const, arrow functions or template literals. These fail at "
        "runtime, not at save time.",
    ], size=10.5, gap=7, height=Inches(4.0))

    column(slide, right, Inches(2.0), col_w, "Salesforce", ROYAL, [
        "Metadata-API-created objects need field-level security, a page layout entry, a list view with "
        "columns, and a tab — all four done by hand, each failing as an empty screen rather than an error.",
        "number is a reserved identifier in Apex. A class field named number will not compile.",
        "Apex cannot call out after DML in the same transaction.",
        "A lightningCommunity__Page targetConfig cannot contain property tags.",
        "The LWCs render into native shadow roots: Playwright's CSS engine pierces them, raw DOM traversal "
        "inside evaluate() does not.",
        "Basic auth to ServiceNow is restricted on this instance — sf.integration is exempt only because it "
        "is web-service-access-only. A new integration user will need the role.",
    ], size=10.5, gap=7, height=Inches(4.0))

    callout(slide, Inches(5.72),
            "The pattern is consistent enough to plan around: the platform returns success and does nothing. "
            "Almost none of these surfaces as an error, so the cost lands as debugging time rather than as a "
            "failed deploy — which is why they are written down rather than rediscovered.",
            height=Inches(0.86), accent=AMBER)


def open_items(prs):
    slide = blank(prs)
    chrome(slide, "What a production move would require")

    items = [
        ("Test coverage on the Apex service classes.",
         "CafSyncHealth, CafEvidenceService and CafAttestationService have none. Salesforce requires 75% to "
         "deploy, so this is not a quality preference — it is a hard gate."),
        ("Queued delivery.",
         "Every call is synchronous, so a ServiceNow outage surfaces as a failed action rather than being "
         "retried. Platform Events are the designed answer and are not built."),
        ("JWT bearer, replacing Client Credentials.",
         "Recorded as a deviation rather than a decision. It needs a custom JWT API Script on the ServiceNow "
         "side; the keypair already exists and is unused."),
        ("A named approver, and the security model.",
         "Attestation uses the approval field alone, so whoever presses the button is the approver. "
         "Row-level security was deliberately deferred for the proof of concept."),
    ]

    y = Inches(1.62)
    for i, (lead, body) in enumerate(items, start=1):
        step = Inches(1.08) if len(body) < 105 else Inches(1.3)
        rect(slide, MARGIN, y, Inches(0.44), Inches(0.44), ROYAL)
        tf = textbox(slide, MARGIN, y + Inches(0.09), Inches(0.44), Inches(0.3))
        write(tf, str(i), size=14, color=WHITE, bold=True, align=PP_ALIGN.CENTER, first=True)

        tf = textbox(slide, MARGIN + Inches(0.68), y + Inches(0.02),
                     CONTENT_W - Inches(0.68), Inches(1.0))
        write(tf, lead, size=15, color=NAVY, bold=True, first=True)
        write(tf, body, size=12.5, color=INK, space_before=3, line=1.2)
        y += step

    callout(slide, Inches(6.02),
            "None of these is engine work. The compliance engine is unchanged and stays unchanged — "
            "everything above is delivery around it.", height=Inches(0.62), accent=GREEN)


# --------------------------------------------------------------------- build

def main():
    prs = Presentation()
    prs.slide_width, prs.slide_height = W, H

    for builder in (cover, governing_rule, context, correlation, outbound,
                    echo_loop, inbound, attestation, evidence, catalogue,
                    sync_health, failure_modes, traps, open_items):
        builder(prs)

    prs.save(OUTPUT)
    print(f"{len(prs.slides.__iter__.__self__._sldIdLst)} slides -> {OUTPUT}")


if __name__ == "__main__":
    main()
