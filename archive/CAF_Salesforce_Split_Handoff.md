# CAF Compliance — ServiceNow / Salesforce Split Architecture
## Project Handoff & Context Brief

**Purpose of this document:** bring a fresh Claude session up to speed on an in-flight design decision. Read this first before proposing architecture.

---

## 1. What already exists

**CAF Compliance** is a live ServiceNow scoped application.

| Property | Value |
|---|---|
| Scope | `x_gskn2_caf_compli` |
| Version | 1.0.0 |
| Platform | ServiceNow |
| Status | Built, documented, approaching go-live |

It manages recurring compliance of critical business applications against defined controls (backup & restore policy, DR plan, RTO/RPO, HA plan, etc.).

### Core tables

| Table | Suffix | Role |
|---|---|---|
| CAF Controls | `caf_conformance_type` | Control definitions |
| CAF Controls Relationships | `caf_relationship` | Maps control → tier + crown-jewels, sets cadence and relative dates |
| CAF Relationship Tasks | `caf_relationship_tasks` | Reusable task templates |
| CAF Request | `caf_req` | A compliance cycle instance for one app + one control |
| CAF Task | `caf_tsk` | Unit of work within a request; carries evidence + attestation |

Business applications live in `cmdb_ci_business_app` (tier, crown-jewels, owners, overall compliance status).

### Existing component inventory

- 24 business rules (20 active) — includes recurrence/`next_due_date` calculation, state guards, active-flag management, and **query business rules enforcing row-level security**
- 2 script includes — `CAFUtil` (`generateCAFRequests`, `cancelActiveRequests`, `cancelTasksOfRequest`, `getCAFControls`, `getAppCount`) and `caf_short_desc` (GlideAjax)
- 2 Flow Designer flows — *Create CAF Tasks* (on request insert), *Close Request When All Tasks Close*
- 6 roles, 48+ ACLs
- 2 scheduled jobs — new request generation (23:30 UTC), overdue status check (23:00 UTC)
- 8 email notifications, 2 registered events
- Service Portal `/caf` — AngularJS **CAF Apps List** widget: business apps as rows, CAF Controls rendered as **dynamic columns**, colour-coded status dot per control plus an overall conformance column. An app is overall-compliant only when every control is compliant.

Existing documentation (already produced, kept in the project): Technical Design Document (Reyan Technologies branding), Business Requirement Document (ConsultNow IT branding), 79 Jira user stories.

---

## 2. The decision

**Make CAF Compliance a genuinely distributed application: one logical product, functionality split across ServiceNow and Salesforce.**

The chosen seam is **engagement layer in Salesforce, compliance engine in ServiceNow.**

### The governing rule

**State machine and system of record stay in ServiceNow.** The recurrence maths, `next_due_date`, overdue detection, state transitions, approvals and the security model are all state logic. Splitting state across two platforms produces split-brain: two schedulers, two truths about whether a request is closed, reconciliation jobs, and an audit trail nobody trusts.

The split therefore runs along a seam where ServiceNow owns state and Salesforce owns things that state does not depend on.

### Who owns what

| ServiceNow (`x_gskn2_caf_compli`) | Salesforce |
|---|---|
| Controls, relationships, task templates | Business-facing UI (LWC on Experience Cloud) |
| Request and task records — system of record | App-owner portfolio view |
| Recurrence, `next_due_date`, renewal | Drill-in to request / task detail |
| Scheduled jobs, overdue detection | Task completion + evidence upload (Salesforce Files) |
| Approvals engine and attestation outcome | Attestation submission UI |
| Roles, ACLs, query BR row-level security | Notifications/alerts to business users in-context |
| Admin + audit dashboard (keep existing widget) | The CAF dashboard reimagined as an LWC |

The AngularJS Service Portal widget is **not decommissioned** — it stays as the admin/audit view. The LWC is the business-user equivalent.

### Why this split is justified

1. **Licensing.** Every app owner, business owner and delegate approver touching CAF today needs a ServiceNow fulfiller licence. In a Salesforce-centric org those same people already hold Salesforce licences. Moving engagement to Salesforce removes ServiceNow seats.
2. **Adoption.** The BRD already lists low portal adoption as a risk. "I'm not logging into ServiceNow for this" disappears when the work surfaces where users already spend the day.
3. **Engine untouched.** Zero change to the 24 business rules, the two flows, the recurrence logic or the security model. Low delivery risk.

---

## 3. Integration design

| Direction | Mechanism | Notes |
|---|---|---|
| SN → SF | Outbound REST from a Script Include in `x_gskn2_caf_compli`; OAuth 2.0 JWT bearer via connection alias | Use the Salesforce Composite API to batch a request plus its tasks in one call. IntegrationHub Salesforce spoke if licensed |
| SF → SN | Apex callout to a **Scripted REST API** in the CAF scope, over Named Credential + External Credential | Carries task updates, `met_criteria`, attestation outcome |
| Async / decoupling | Platform Events on the Salesforce side; business rule + event queue on the ServiceNow side | Stops a Salesforce outage blocking the scheduled jobs |

### Correlation and idempotency

- Store the ServiceNow `sys_id` in an **External Id** field on the Salesforce custom object.
- Store the Salesforce record Id in a new field on `caf_req` and `caf_tsk`.
- Every write is an **upsert by External Id** → replay-on-failure is safe.

### Salesforce-side setup required

- Connected App (OAuth 2.0, JWT bearer flow) for SN → SF
- Self-signed certificate (Setup → Certificate and Key Management) for the JWT flow
- Named Credential + External Credential for SF → SN Apex callouts
- External Id fields on all mirrored custom objects
- Experience Cloud site for the app-owner portal

---

## 4. Watch-outs (raise these early, don't discover them late)

1. **User identity mapping** between platforms (SSO/SCIM, or a mapping table). Unglamorous, blocks everything else. Do it first.
2. **Keep human attestation.** Even where evidence collection is automated, "machine collects, human attests" is the defensible governance line.
3. **Don't build a polling loop.** Developer Edition API limits (see below) and good design both argue for event-driven pushes.
4. **Suppress the echo loop before the first round-trip works.** Upsert-by-External-Id gives idempotency, not loop prevention. Left unguarded: Salesforce updates a task → Scripted REST API writes `caf_tsk` → business rule fires → outbound push → Salesforce upsert → Salesforce logic fires again. Guard the outbound business rule on the integration user (skip when `sys_updated_by` is the integration account), and do it when the outbound rule is first written rather than after. This is the one failure mode that scales without bound — it is what would actually exhaust the Developer Edition API budget, and it generates records live while you are presenting.

---

## 5. Environments

Both are provisioned and available.

- **ServiceNow PDI** — existing CAF app installed (or installable from update set).
- **Salesforce Developer Edition org** — free, no fixed expiry while in use, but Salesforce deactivates long-dormant orgs so log in periodically.

### DE limits that constrain this build

- **~5,000 API calls per 24 hours.** Fine for demo-scale sync; fatal for polling. The cap counts requests *inbound* to Salesforce, so only the SN → SF pushes draw on it — SF → SN Apex callouts do not.

  Sized against the intended demo (1 business application, 5 CAF requests): the instance currently carries 22 active relationships and 24 active task templates, at **one template per relationship**, so 5 requests generate roughly 5 tasks — not 25. Creating them costs ~5 calls if the Composite API batches each request with its tasks; driving 5 tasks through In Progress → approval → approved → closed costs ~20 more, and the cascading updates onto the parent requests (actual start, state, close, `next_due_date`) ~20 again. **Call it ~45 calls for one full end-to-end run — about 1% of the daily budget, so roughly a hundred rehearsals a day.**

  At that scale, per-record push coalescing is not worth building. The realistic consumers are an unguarded echo loop (watch-out 4), a retry storm against a broken endpoint, and — on a heavy build day, more than the demo itself — dev tooling: sfdx/VS Code deploys, Workbench and Data Loader all count against the same budget. **Setup → System Overview** shows "API Requests, Last 24 Hours"; worth a glance before presenting.
- Small data storage (single-digit MB) and modest file storage — keep demo evidence attachments small.
- Only a couple of full Salesforce licences. **Verify how many Experience/Community licences the DE org actually provisions before building the portal around Experience Cloud** — this is the limit most likely to bite, and the published figures have shifted over time. Check Salesforce's current edition-limits documentation directly rather than blog posts.
- DE orgs cannot be used commercially — fine for prototype and client demo; real deployment goes to the client's own org or a partner/ISV org.

---

## 6. Suggested build sequence

1. Identity mapping between SN and SF users — decide the approach, stand it up.
2. Salesforce data model: custom objects mirroring `caf_req` and `caf_tsk`, with External Id fields.
3. Connected App + certificate + JWT flow; prove SN → SF auth with a single record push.
4. Script Include in `x_gskn2_caf_compli` for outbound push; business rule or flow action to trigger it on request/task insert and update. **Build the echo-loop guard (watch-out 4) into this rule now, not later.**
5. Scripted REST API in the CAF scope for inbound; Named Credential + Apex callout on the SF side; prove a task update round-trips.
6. LWC dashboard — rebuild the dynamic-column, colour-coded-dot table from the AngularJS widget.
7. Experience Cloud site, task detail + evidence upload + attestation submission.
8. Platform Events to replace any synchronous coupling that proves fragile.

---

## 7. Explicitly rejected — do not re-propose

These were considered and ruled out. If a future session suggests them, it has lost the thread.

- **Salesforce as a compliance subject.** Treating Salesforce as just another business application / asset to be attested against CAF controls. Not what this project is.
- **Rebranding CAF** (e.g. Critical Application Framework → Control Assurance Framework) to generalise the app across asset types. Interesting, but a different project.
- **Automated evidence collection from Salesforce APIs** (backup job status, MFA settings, permission-set review, etc.) as CAF controls. Same reason as above.
- **Evidence + attestation lifecycle in Salesforce** (Files/ContentDocument, native Approval Process, e-signature) as the seam. Viable alternative seam, not the chosen one.
- **Split by domain** — remediation plans, exception cases and exec reporting as Salesforce Cases. Viable alternative seam, not the chosen one.
- **Salesforce Connect / external objects** for read-through instead of replication. Needs an OData 4.0 endpoint that ServiceNow doesn't expose natively; hand-rolling it isn't worth the effort. Replicate instead.

---

## 8. Working context

- Developer/architect working across ServiceNow (JavaScript, AngularJS for Service Portal) and now Salesforce (Apex, LWC).
- Deliverables are client-facing and require professional polish — branded cover pages, headers/footers, confidentiality notices, auto-updating page numbers.
- Brand assets available: **Reyan Technologies** (navy `#000724`, royal blue `#0A3176`), **ConsultNow IT** (maroon `#A81845`, green `#005116`).
- Existing docs to extend rather than duplicate: TDD (Reyan branding), BRD (ConsultNow IT branding).
- Likely near-term documentation needs: split-architecture diagram, TDD delta section covering the integration contract, and possibly a BRD addendum.
