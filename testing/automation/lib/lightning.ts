import { Page, Locator, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { SF_LIGHTNING, EVIDENCE_DIR } from '../playwright.config';

/**
 * Driving the Salesforce UI.
 *
 * Lightning renders LWCs into **native** shadow roots here, and that cuts two
 * ways which are easy to conflate:
 *
 *   - Playwright's CSS engine pierces shadow boundaries, so
 *     `page.locator('table.grid')` reaches inside `c-caf-dashboard` unaided.
 *   - Raw DOM traversal inside `evaluate()` does **not**. `host.querySelector()`
 *     returns null for everything in the host's shadow root, so a scrape written
 *     against the host silently reports an empty grid — which reads as "the LWC
 *     rendered no data" rather than "the scrape looked in the wrong place".
 *
 * Every `evaluate()` below therefore starts from `shadowRoot ?? el`. And every
 * selector is scoped to its component root rather than to the page, because
 * `cafDashboard` contains `cafSyncHealth` and both contain a `table` — scoping
 * to the page gives a passing assertion against the wrong one.
 *
 * The selectors mirror the templates in force-app/lwc/*. Where a class name is
 * load-bearing it is named in a comment, because renaming it in the template
 * would break these silently rather than loudly.
 */

export const TABS = {
  dashboard: '/lightning/n/CAF_Dashboard',
  taskList: '/lightning/o/CAF_Task__c/list?filterName=All',
  requestList: '/lightning/o/CAF_Request__c/list?filterName=All',
} as const;

export function taskRecordUrl(recordId: string): string {
  return `/lightning/r/CAF_Task__c/${recordId}/view`;
}

/**
 * Wait for Lightning to have finished booting *and* for the component to have
 * finished its first server round trip.
 *
 * Both matter. The app shell appears long before the LWC has data, and
 * `cafDashboard` renders a "Loading compliance data…" paragraph in the interim —
 * asserting then reads an empty grid and reports it as missing data.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page
    .locator('one-appnav, .slds-global-header, [data-aura-class]')
    .first()
    .waitFor({ state: 'attached', timeout: 90_000 });
}

/** The CAF Dashboard tab, with the grid populated. */
export async function openDashboard(page: Page): Promise<void> {
  await page.goto(`${SF_LIGHTNING}${TABS.dashboard}`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await dashboard(page)
    .locator('table.grid tbody tr')
    .first()
    .waitFor({ state: 'visible', timeout: 90_000 });
}

/** Component roots. Every other selector in a spec should hang off one of these. */
export function dashboard(page: Page): Locator {
  return page.locator('c-caf-dashboard');
}
export function syncHealth(page: Page): Locator {
  return page.locator('c-caf-sync-health');
}
export function evidencePanel(page: Page): Locator {
  return page.locator('c-caf-evidence');
}
export function attestationPanel(page: Page): Locator {
  return page.locator('c-caf-attestation');
}

export interface GridRow {
  application: string;
  /**
   * One entry per control column, in column order.
   *
   * A control an application has no request for renders N/A rather than a dot,
   * and carries `isNa` with an empty `dot` and `number`. It is still an entry:
   * the row has to stay the same length as the column list or nothing can be
   * compared by position, and N/A is a real state of the grid rather than an
   * absence — it is what the ServiceNow widget shows too.
   */
  cells: { control: string; dot: string; number: string; disabled: boolean; isNa: boolean }[];
  /** The Overall pill's text — "Compliant" or "n of m". */
  overall: string;
  /** green | amber, from the pill's class. */
  overallColour: string;
}

/**
 * Read the compliance grid into a structure that can be compared with the
 * ServiceNow portal grid record for record.
 *
 * The dot colour is taken from the class name rather than the computed
 * background: the class is what the component decided, the pixel is what the
 * stylesheet did with it, and the case is about the decision.
 */
export async function readGrid(page: Page): Promise<{ columns: string[]; rows: GridRow[] }> {
  return dashboard(page).evaluate((host: Element) => {
    const root: ParentNode = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot ?? host;
    const q = (sel: string, from: ParentNode = root) => [...from.querySelectorAll(sel)];
    const text = (el: Element | null | undefined) => (el ? (el as HTMLElement).innerText.trim() : '');
    const shade = (cls: string) => (cls.match(/(?:dot|pill)--(\w+)/) ?? [, ''])[1] ?? '';

    const columns = q('table.grid thead th.grid__control').map((th) => text(th));

    const rows = q('table.grid tbody tr').map((tr) => {
      // Walk the cells, not the buttons. An N/A cell has no button in it, so
      // collecting buttons silently shortened the row and every comparison by
      // column position landed one control to the left of the one it named.
      const cells = q('td.grid__cell', tr);
      const pill = tr.querySelector('td.grid__overall span');
      return {
        application: text(tr.querySelector('th.grid__app')),
        cells: cells.map((td, i) => {
          const b = td.querySelector('button.cellbtn') as HTMLButtonElement | null;
          return {
            control: b?.getAttribute('data-control') ?? columns[i] ?? '',
            dot: b ? shade(b.querySelector('span')?.className ?? '') : '',
            number: b?.getAttribute('data-number') ?? '',
            disabled: b ? b.disabled : true,
            isNa: !b,
          };
        }),
        overall: text(pill),
        overallColour: shade(pill?.className ?? ''),
      };
    });

    return { columns, rows };
  });
}

/** The Sync Health strip, as a reader sees it. */
export async function readSyncHealth(page: Page): Promise<{
  headline: string;
  colour: string;
  summary: string;
  differences: { record: string; type: string; kind: string; servicenow: string; salesforce: string; canResync: boolean }[];
}> {
  const root = syncHealth(page);
  await root.locator('.sync__headline').waitFor({ state: 'visible', timeout: 90_000 });
  // The strip runs its callout on load; "Checking ServiceNow…" is the interim
  // headline and asserting on it would record the spinner as the result.
  await expect(root.locator('.sync__headline')).not.toHaveText(/Checking ServiceNow/, { timeout: 90_000 });

  return root.evaluate((host: Element) => {
    const el: ParentNode = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot ?? host;
    const text = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '';
    const dotClass = (el.querySelector('.sync__state span[class*="dot"]') as HTMLElement | null)?.className ?? '';
    return {
      headline: text('.sync__headline'),
      colour: (dotClass.match(/dot--(\w+)/) ?? [, ''])[1] ?? '',
      summary: text('.sync__summary') || text('.sync__error'),
      differences: [...el.querySelectorAll('table.drift tbody tr')].map((tr) => {
        const td = [...tr.querySelectorAll('td')].map((c) => (c as HTMLElement).innerText.trim());
        return {
          record: td[0] ?? '',
          type: td[1] ?? '',
          kind: td[2] ?? '',
          servicenow: td[3] ?? '',
          salesforce: td[4] ?? '',
          canResync: !(tr.querySelector('td button.act') as HTMLButtonElement | null)?.disabled,
        };
      }),
    };
  });
}

/** Press Re-check now and wait for the strip to settle again. */
export async function recheck(page: Page): Promise<void> {
  await syncHealth(page).locator('button.sync__btn').click();
  await expect(syncHealth(page).locator('.sync__headline')).not.toHaveText(/Checking ServiceNow/, {
    timeout: 90_000,
  });
}

/**
 * Drill into a grid cell.
 *
 * Selecting by request number rather than by row/column index: the column set
 * is derived from data and will change the moment a control gains its first
 * request, and an index-based selector would then silently open a different
 * request.
 */
export async function openRequest(page: Page, requestNumber: string): Promise<void> {
  const cell = dashboard(page).locator(`table.grid button.cellbtn[data-number="${requestNumber}"]`);
  await expect(cell, `No grid cell for request ${requestNumber}`).toHaveCount(1);
  await cell.click();
  const panel = dashboard(page).locator('section.panel');
  await panel.waitFor({ state: 'visible', timeout: 60_000 });

  // The panel opens as soon as selectedSysId is set; the task list arrives on a
  // separate @wire round trip afterwards. Reading between the two gives an empty
  // list that is indistinguishable from a request genuinely having no mirrored
  // tasks — measured, and it reported zero tasks for a request that has one.
  //
  // Racing the table against the "No tasks mirrored" paragraph does not fix it:
  // `hasTasks` is false on first render, so that paragraph is *always* on screen
  // first and the race always resolves to it. Wait for the table on its own and
  // let the wait expire — an expiry then genuinely means the request has no
  // mirrored tasks, which is what TC-INT-051 needs to be able to distinguish.
  await panel
    .locator('table.tasks tbody tr')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {
      /* no tasks for this request — the caller's readTasks() reports the empty list */
    });
}

export interface TaskRow {
  number: string;
  description: string;
  state: string;
  approval: string;
  metCriteria: string;
  /** Button labels in the Actions column, in render order. */
  actions: string[];
}

/** The drill-in task list, including which row actions each state offers. */
export async function readTasks(page: Page): Promise<TaskRow[]> {
  return dashboard(page).evaluate((host: Element) => {
    const root: ParentNode = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot ?? host;
    return [...root.querySelectorAll('table.tasks tbody tr')].map((tr) => {
      const td = [...tr.querySelectorAll('td')].map((c) => (c as HTMLElement).innerText.trim());
      return {
        number: td[0] ?? '',
        description: td[1] ?? '',
        state: td[2] ?? '',
        approval: td[3] ?? '',
        metCriteria: td[4] ?? '',
        actions: [...tr.querySelectorAll('td.tasks__actions button')].map((b) =>
          (b as HTMLElement).innerText.trim()
        ),
      };
    });
  });
}

/**
 * Open a task's panel by the action a reader would click.
 *
 * `mode` maps to the component's own data-mode: 'evidence' opens cafEvidence
 * alone and writable; 'attest' opens it read-only beside cafAttestation. The
 * distinction is the subject of TC-INT-036, so it is expressed here rather than
 * left to a spec to reconstruct from button text.
 */
export async function openTaskPanel(
  page: Page,
  taskNumber: string,
  mode: 'evidence' | 'attest'
): Promise<void> {
  const button = dashboard(page).locator(
    `table.tasks button[data-number="${taskNumber}"][data-mode="${mode}"]`
  );
  await expect(button, `No "${mode}" action on task ${taskNumber}`).toHaveCount(1);
  await button.click();
  await dashboard(page).locator('section.attest').waitFor({ state: 'visible', timeout: 60_000 });
}

export interface EvidencePanelView {
  heading: string;
  subheading: string;
  /** Whether the panel offers an upload control — the `hide-upload` flag's effect. */
  uploadVisible: boolean;
  /** The count badge beside each column heading, as rendered. */
  salesforceCount: string;
  servicenowCount: string;
  salesforceFiles: string[];
  servicenowAttachments: string[];
  /** The mismatch warning, empty when the two counts agree. */
  warning: string;
  error: string;
  bodyText: string;
}

/**
 * What the evidence panel shows, and whether it will take an upload.
 *
 * The two file lists are read from their own `section.ev__col` in template
 * order — Salesforce first, ServiceNow second. Matching on the heading text
 * would be more readable and would also be wrong: "Salesforce Files" and
 * "ServiceNow attachments" both contain words that match the other's pattern
 * once case is ignored, which is how the first version of this returned the
 * same list twice.
 */
export async function readEvidencePanel(page: Page): Promise<EvidencePanelView> {
  const root = evidencePanel(page).first();
  await root.waitFor({ state: 'visible', timeout: 60_000 });

  // The heading is a prop and renders immediately; both file lists arrive from
  // a later round trip — Salesforce Files from a wire, ServiceNow attachments
  // from a callout. Waiting on the heading is therefore not waiting on the
  // panel: it reported 0 and 0 for a task holding 1 Salesforce file and 2
  // ServiceNow attachments, which reads as "the integration lost the evidence"
  // rather than "the scrape was early". Wait for the loading line to clear.
  await expect(root.locator('.ev')).not.toContainText('Reading evidence', { timeout: 90_000 });

  return root.evaluate((host: Element) => {
    const el: ParentNode = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot ?? host;
    const text = (sel: string, from: ParentNode = el) =>
      (from.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '';

    const cols = [...el.querySelectorAll('div.ev__cols section.ev__col')];
    const filesIn = (col: Element | undefined) =>
      col ? [...col.querySelectorAll('ul.files li.files__row')].map((li) => (li as HTMLElement).innerText.trim()) : [];
    const countIn = (col: Element | undefined) => (col ? text('.ev__count', col) : '');

    return {
      heading: text('.ev__title'),
      subheading: text('.ev__sub'),
      uploadVisible: !!el.querySelector('.ev__upload lightning-file-upload'),
      salesforceCount: countIn(cols[0]),
      servicenowCount: countIn(cols[1]),
      salesforceFiles: filesIn(cols[0]),
      servicenowAttachments: filesIn(cols[1]),
      warning: text('.ev__msg--warn'),
      error: text('.ev__msg--error'),
      // innerText of the shadow root's own children: a ShadowRoot has no
      // innerText, and its host's textContent is the *light* DOM, which for
      // these components is empty.
      bodyText: [...(el as ShadowRoot).children]
        .map((c) => (c as HTMLElement).innerText)
        .join('\n')
        .trim(),
    };
  });
}

export interface AttestationPanelView {
  heading: string;
  blockedReason: string;
  /** The criteria radio group's options, as offered. */
  criteriaOptions: string[];
  /** Decision buttons, and whether the evidence gate has greyed them out. */
  approveEnabled: boolean;
  rejectEnabled: boolean;
  /** Everything the panel says, for the "is this comprehensible?" judgement. */
  bodyText: string;
}

/**
 * Read the attestation panel without submitting anything.
 *
 * Nothing here clicks Approve or Reject. Those write to ServiceNow through the
 * attest endpoint and close a task irreversibly, which is a different class of
 * case entirely — the UI cases only ask what the panel offers and to whom.
 */
export async function readAttestationPanel(page: Page): Promise<AttestationPanelView> {
  const root = attestationPanel(page).first();
  await root.waitFor({ state: 'visible', timeout: 60_000 });
  return root.evaluate((host: Element) => {
    const el: ParentNode = (host as Element & { shadowRoot?: ShadowRoot }).shadowRoot ?? host;
    const text = (sel: string) => (el.querySelector(sel) as HTMLElement | null)?.innerText.trim() ?? '';
    const btn = (sel: string) => el.querySelector(sel) as HTMLButtonElement | null;
    return {
      heading: text('.at__title'),
      blockedReason: text('.at__blocked'),
      criteriaOptions: [...el.querySelectorAll('.at__criteria input[type="radio"]')].map(
        (i) => (i as HTMLInputElement).value
      ),
      approveEnabled: !!btn('.btn--approve') && !btn('.btn--approve')!.disabled,
      rejectEnabled: !!btn('.btn--reject') && !btn('.btn--reject')!.disabled,
      bodyText: [...(el as ShadowRoot).children]
        .map((c) => (c as HTMLElement).innerText)
        .join('\n')
        .trim(),
    };
  });
}

/**
 * Where things sit on the page, in CSS pixels.
 *
 * TC-INT-053 is a claim about layout, not about data — the Sync Health strip
 * must be visible without scrolling, because a grid can only be trusted if
 * something is checking it. DOM order alone would not settle that; a component
 * can be first in the markup and pushed below the fold.
 */
export async function layoutOf(
  page: Page,
  selector: string
): Promise<{ top: number; height: number; visible: boolean } | null> {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) return null;
  const viewport = page.viewportSize();
  return {
    top: Math.round(box.y),
    height: Math.round(box.height),
    visible: !!viewport && box.y >= 0 && box.y < viewport.height,
  };
}

/**
 * Screenshot into the evidence tree.
 *
 * Same layout and naming as the ServiceNow side, so the generator finds a
 * case's images by folder without a manifest and a pack can put the two grids
 * side by side.
 */
export async function shot(page: Page, caseId: string, label: string): Promise<string> {
  const dir = path.join(EVIDENCE_DIR, caseId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = label.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const file = path.join(dir, `${safe}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

// ---------------------------------------------------------------------------
// The screens beside the grid: Approvals, Reports, Admin (cafDashboard's tab bar)
// ---------------------------------------------------------------------------

/** The four screens, by the `data-view` key on their tab and `c__view` in the URL. */
export const SCREENS = {
  compliance: 'table.grid',
  approvals: 'c-caf-approvals',
  reports: 'c-caf-reports',
  admin: 'c-caf-admin',
} as const;
export type ScreenKey = keyof typeof SCREENS;

/**
 * Open the dashboard straight onto one screen through `?c__view=`, and wait
 * for that screen's first round trip - each renders a "Loading…" paragraph
 * before its data arrives, and asserting then reads an empty screen.
 */
export async function openScreen(page: Page, view: ScreenKey): Promise<Locator> {
  const query = view === 'compliance' ? '' : `?c__view=${view}`;
  await page.goto(`${SF_LIGHTNING}${TABS.dashboard}${query}`, { waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  const root = dashboard(page).locator(SCREENS[view]).first();
  await root.waitFor({ state: 'visible', timeout: 90_000 });
  if (view !== 'compliance') {
    // `.view` is the root of each screen's template; `.msg` is its loading line.
    await expect(root.locator('.msg').filter({ hasText: /Loading/ })).toHaveCount(0, { timeout: 90_000 });
  }
  return root;
}

/** The tab bar as rendered: label, data-view key, and which one is selected. */
export async function readScreenTabs(page: Page): Promise<{ label: string; key: string; selected: boolean }[]> {
  const tabs = dashboard(page).locator('nav.views .views__tab'); // class names: cafDashboard.html
  const n = await tabs.count();
  const out: { label: string; key: string; selected: boolean }[] = [];
  for (let i = 0; i < n; i++) {
    const t = tabs.nth(i);
    out.push({
      label: (await t.innerText()).trim(),
      key: (await t.getAttribute('data-view')) ?? '',
      selected: (await t.getAttribute('aria-selected')) === 'true',
    });
  }
  return out;
}

/** Stat tiles on a screen, label -> value. Class names: cafTheme.css. */
export async function readTiles(root: Locator): Promise<Record<string, string>> {
  const tiles = root.locator('.tiles .tile');
  const n = await tiles.count();
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    const label = (await tiles.nth(i).locator('.tile__label').innerText()).trim();
    const value = (await tiles.nth(i).locator('span').first().innerText()).trim();
    out[label] = value;
  }
  return out;
}
