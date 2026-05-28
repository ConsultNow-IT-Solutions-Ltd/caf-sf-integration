import { Page, Frame, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { SN_INSTANCE, EVIDENCE_DIR, TOKEN_STATE } from '../playwright.config';

export const TABLES = {
  req: 'x_gskn2_caf_compli_caf_req',
  tsk: 'x_gskn2_caf_compli_caf_tsk',
  relationship: 'x_gskn2_caf_compli_caf_relationship',
  relationshipTasks: 'x_gskn2_caf_compli_caf_relationship_tasks',
  control: 'x_gskn2_caf_compli_caf_conformance_type',
  businessApp: 'cmdb_ci_business_app',
} as const;

/**
 * The session's user token, as required by every Table API call.
 *
 * A session cookie on its own gets HTTP 401 from /api/now/table — measured on
 * this instance with the browser fully logged in. ServiceNow additionally wants
 * `X-UserToken` (the `g_ck` value), which is what stops a bare cookie from
 * authorising API calls from anywhere. HTTP basic auth is not a way around it:
 * it also returns 401 here, so this is the only route.
 *
 * The setup project captures the token and writes it beside the storage state.
 * Reading it live from the page is the fallback, for the case where a session
 * outlives the file or a spec has re-authenticated.
 */
let cachedToken: string | null = null;

async function userToken(page: Page, forceRefresh = false): Promise<string> {
  if (cachedToken && !forceRefresh) return cachedToken;

  if (!forceRefresh && fs.existsSync(TOKEN_STATE)) {
    try {
      const t = JSON.parse(fs.readFileSync(TOKEN_STATE, 'utf8')).userToken;
      if (t) {
        cachedToken = t;
        return t;
      }
    } catch {
      /* fall through to reading it live */
    }
  }

  // g_ck is exposed on the landing page, on classic list and form pages, and on
  // the /caf portal — but not on about:blank or /blank.do, so this only works
  // once the page has navigated somewhere real.
  const live = await page
    .evaluate(() => (window as unknown as { g_ck?: string }).g_ck || null)
    .catch(() => null);

  if (!live) {
    throw new Error(
      'No X-UserToken available. Run the `setup` project first, or call this after the page ' +
        'has navigated to a ServiceNow page (about:blank and /blank.do do not expose g_ck).'
    );
  }
  cachedToken = live;
  return live;
}

/**
 * Read records through the Table API using the browser's own session.
 *
 * This is the `Verify` half of every test case: what the record holds, as
 * opposed to what the screen claimed. Reusing the page's session rather than a
 * separate credential means the assertion sees exactly what the logged-in user
 * sees, ACLs included — which is the point for the role cases.
 */
export async function tableApi(
  page: Page,
  table: string,
  params: { query?: string; fields?: string[]; limit?: number } = {}
): Promise<Record<string, string>[]> {
  const search = new URLSearchParams();
  if (params.query) search.set('sysparm_query', params.query);
  if (params.fields) search.set('sysparm_fields', params.fields.join(','));
  search.set('sysparm_limit', String(params.limit ?? 100));
  // Values, not display values — a test asserting "state is 3" must not pass
  // because the label happens to read "Closed Complete".
  search.set('sysparm_display_value', 'false');
  // Reference fields otherwise arrive as {link, value} objects rather than the
  // sys_id string, so every comparison against one silently fails on shape.
  search.set('sysparm_exclude_reference_link', 'true');

  const url = `${SN_INSTANCE}/api/now/table/${table}?${search.toString()}`;

  let res = await page.request.get(url, { headers: { 'X-UserToken': await userToken(page) } });

  // A stale token reads as 401, which is indistinguishable from "not logged in"
  // in the failure message. Refresh from the live page and try once more, so a
  // long run does not fail on an expired token and get diagnosed as an ACL bug.
  if (res.status() === 401) {
    const refreshed = await userToken(page, true).catch(() => null);
    if (refreshed) {
      res = await page.request.get(url, { headers: { 'X-UserToken': refreshed } });
    }
  }

  expect(
    res.ok(),
    `Table API ${table} returned HTTP ${res.status()} for ${params.query ?? '(no query)'}`
  ).toBeTruthy();
  const body = await res.json();
  return body.result ?? [];
}

/** Resolve a human-facing number (RCAF…, CAFT…) to the sys_id the URLs need. */
export async function sysIdForNumber(page: Page, table: string, number: string): Promise<string> {
  const rows = await tableApi(page, table, {
    query: `number=${number}`,
    fields: ['sys_id', 'number'],
    limit: 1,
  });
  expect(rows.length, `No ${table} record found with number=${number}`).toBeGreaterThan(0);
  return rows[0].sys_id;
}

/**
 * Open a record form directly, bypassing the navigation shell.
 *
 * The `<table>.do` URL renders the classic form as a top-level document, so
 * there is no `gsft_main` iframe to reach through and no Next Experience shadow
 * DOM. Fewer moving parts between the test and the field it is asserting on,
 * and a cleaner screenshot for the evidence pack — no left-hand nav eating a
 * third of the image.
 *
 * `openViaNav()` exists for the cases that genuinely need the shell.
 */
export async function openForm(page: Page, table: string, sysId: string): Promise<void> {
  await page.goto(`${SN_INSTANCE}/${table}.do?sys_id=${sysId}&sysparm_stack=no`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForFormReady(page, table);
}

/** Open a list, optionally filtered by an encoded query. */
export async function openList(page: Page, table: string, encodedQuery?: string): Promise<void> {
  const q = encodedQuery ? `?sysparm_query=${encodeURIComponent(encodedQuery)}` : '';
  await page.goto(`${SN_INSTANCE}/${table}_list.do${q}`, { waitUntil: 'domcontentloaded' });
}

/**
 * Open a record through the navigation shell, and hand back the frame the form
 * actually lives in.
 *
 * Needed only where the shell itself is under test — UI actions rendered in the
 * header, or anything asserting on the nav. Everything else should use
 * `openForm()`.
 */
export async function openViaNav(page: Page, table: string, sysId: string): Promise<Frame> {
  const target = encodeURIComponent(`${table}.do?sys_id=${sysId}`);
  await page.goto(`${SN_INSTANCE}/now/nav/ui/classic/params/target/${target}`, {
    waitUntil: 'domcontentloaded',
  });
  const frame = page.frame({ name: 'gsft_main' });
  expect(frame, 'gsft_main iframe not found inside the navigation shell').toBeTruthy();
  return frame!;
}

/**
 * Wait for a classic form to be usable rather than merely present.
 *
 * ServiceNow renders the form skeleton before client scripts and UI policies
 * have run. Asserting too early reads pre-script values and produces failures
 * that blame the wrong component — which is precisely the class of defect this
 * suite is meant to detect, so a false positive here is expensive.
 */
export async function waitForFormReady(page: Page, table: string): Promise<void> {
  await page.locator(`form[id*="${table}"], #sys_uniqueValue, .form_header, .navbar_form_title`).first()
    .waitFor({ state: 'attached', timeout: 60_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as { g_form?: { isLoading?: () => boolean } };
      return typeof w.g_form !== 'undefined' && (!w.g_form.isLoading || w.g_form.isLoading() === false);
    },
    undefined,
    { timeout: 60_000 }
  ).catch(() => {
    // g_form is absent on some views. Not fatal — the caller's own assertion
    // decides. Swallowing it here keeps the failure message about the field
    // under test rather than about a readiness probe.
  });
}

/**
 * Read a field the way the *form* sees it, through g_form.
 *
 * Deliberately distinct from `tableApi()`. Where the two disagree, that gap is
 * usually the finding — a UI policy showing one thing while the record holds
 * another is exactly what the evidence pack needs to capture.
 */
export async function formValue(page: Page, field: string): Promise<string | null> {
  return page.evaluate((f) => {
    const w = window as unknown as { g_form?: { getValue: (n: string) => string } };
    return w.g_form ? w.g_form.getValue(f) : null;
  }, field);
}

export async function isFieldReadOnly(page: Page, field: string): Promise<boolean | null> {
  return page.evaluate((f) => {
    const w = window as unknown as { g_form?: { isReadOnly?: (n: string) => boolean } };
    return w.g_form && w.g_form.isReadOnly ? w.g_form.isReadOnly(f) : null;
  }, field);
}

export async function isFieldMandatory(page: Page, field: string): Promise<boolean | null> {
  return page.evaluate((f) => {
    const w = window as unknown as { g_form?: { isMandatory?: (n: string) => boolean } };
    return w.g_form && w.g_form.isMandatory ? w.g_form.isMandatory(f) : null;
  }, field);
}

/**
 * Service Portal pages in the `caf` portal.
 *
 * `/caf` on its own is the landing page — three tiles and a KB link, no data.
 * The compliance grid the test pack cares about is `caf_apps`, and the tile
 * that reaches it is an Angular `javascript:void(0)` handler, so navigating by
 * page id is both more direct and more stable than clicking through.
 */
export const PORTAL_PAGES = {
  home: 'caf_home',
  /** The compliance grid: applications as rows, controls as columns. */
  apps: 'caf_apps',
  /** Record drill-in. Needs a record parameter; renders an access error without one. */
  ticket: 'caf_ticket',
} as const;

/** Open a page in the AngularJS Service Portal — the admin/audit view. */
export async function openPortal(
  page: Page,
  pageId: string = PORTAL_PAGES.apps,
  params: Record<string, string> = {}
): Promise<void> {
  const qs = new URLSearchParams({ id: pageId, ...params });
  await page.goto(`${SN_INSTANCE}/caf?${qs.toString()}`, { waitUntil: 'domcontentloaded' });

  // Angular bootstraps well after DOMContentLoaded, and the grid populates from
  // a second server call after that. Waiting on the rendered table rather than a
  // fixed delay keeps this honest on a slow instance.
  if (pageId === PORTAL_PAGES.apps) {
    await page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 60_000 });
  } else {
    await page.locator('.sp-page, [ng-controller], body').first().waitFor({ state: 'attached', timeout: 30_000 });
  }
}

/**
 * Scrape the compliance grid into a comparable structure.
 *
 * Returns one entry per application row with its overall status and the
 * per-control dot colours, so a test can reconcile the whole grid against
 * `caf_req.caf_status` in one assertion instead of eyeballing a screenshot.
 */
export async function readComplianceGrid(page: Page): Promise<
  { application: string; overall: string; controls: string[] }[]
> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('table tbody tr'));
    return rows.map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td'));
      const text = (el: Element | undefined) => (el ? (el as HTMLElement).innerText.trim() : '');
      return {
        application: text(cells[0]),
        overall: text(cells[2]),
        // Dots are coloured elements rather than text; fall back to the cell's
        // own text so "N/A" cells still register.
        controls: cells.slice(3).map((c) => {
          const dot = c.querySelector('[class*="circle"], [class*="dot"], i, span[style*="background"]');
          if (dot) {
            const style = window.getComputedStyle(dot as Element);
            return style.backgroundColor || style.color || 'dot';
          }
          return (c as HTMLElement).innerText.trim() || 'blank';
        }),
      };
    });
  });
}

/**
 * Capture a screenshot into the evidence tree.
 *
 * Named and foldered by test case so the docx generator can find each case's
 * images without a manifest. Full-page, because a compliance grid cropped at
 * the fold proves less than it appears to.
 */
export async function evidence(page: Page, caseId: string, label: string): Promise<string> {
  const dir = path.join(EVIDENCE_DIR, caseId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = label.replace(/[^a-z0-9-_]+/gi, '-').toLowerCase();
  const file = path.join(dir, `${Date.now()}-${safe}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}
