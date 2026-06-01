import { Page, Locator } from '@playwright/test';

/**
 * Watch mode — the run you can sit and watch.
 *
 * The suite's normal mode is headless and fast: it exists to produce verdicts.
 * That is the right default for a regression pass and the wrong one for a
 * demonstration, a walkthrough with an auditor, or the first run of a case
 * nobody trusts yet — where the question is not "did it pass" but "did it
 * really do what the case says it does".
 *
 * So this module adds three things, all of them no-ops when WATCH is off:
 *
 *   1. A heads-up display drawn into the page under test, naming the case and
 *      narrating each step as it happens. The browser is visible, so the
 *      narration has to live where the eye already is.
 *   2. `spotlight()` — ring an element and hold, before acting on it. Without
 *      it a click is a single frame and the viewer sees the aftermath, never
 *      the act.
 *   3. Pacing. `slowMo` (set in the config) paces Playwright's own actions;
 *      `pace()` paces the reading.
 *
 * The HUD is deliberately hidden for every screenshot — see `withHudHidden`.
 */

export const WATCH = process.env.WATCH === '1' || process.env.WATCH === 'true';

/** Milliseconds to hold after narrating a step, so it can be read. */
export const PACE = Number(process.env.WATCH_PACE || 900);

/**
 * Leave the HUD visible in screenshots. Off by default: an evidence image
 * should show the application, not the harness driving it.
 */
export const STAMP = process.env.WATCH_STAMP === '1';

const HUD_ID = '__caf_watch_hud';

interface StepLine {
  n: number;
  text: string;
  done: boolean;
}

interface HudState {
  caseId: string;
  title: string;
  steps: StepLine[];
  verdict: string | null;
  reason: string | null;
  hidden: boolean;
}

/**
 * HUD state lives here, in Node, not in the page.
 *
 * A ServiceNow form navigation destroys the DOM and everything injected into
 * it. Holding the state on this side means the `load` handler below can redraw
 * the whole HUD from scratch after every navigation, rather than the HUD simply
 * vanishing halfway through a case.
 */
const states = new WeakMap<Page, HudState>();
const wired = new WeakSet<Page>();

/**
 * Serialise HUD writes.
 *
 * `CaseEvidence.step()` is synchronous — 100-odd existing call sites depend on
 * that — so its HUD update is fired and not awaited. Without a queue two steps
 * in quick succession race and the display can settle on the earlier one.
 */
let queue: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): Promise<void> {
  queue = queue.then(fn).catch(() => {
    /* The HUD is decoration. It must never fail a test case. */
  });
  return queue;
}

/** Wait for every queued HUD write to land. Called before screenshotting. */
export function settle(): Promise<void> {
  return queue;
}

/**
 * Draw or redraw the HUD. Runs in the page.
 *
 * Built with createElement/textContent rather than innerHTML, and styled
 * through the CSSOM rather than style attributes, so a Content-Security-Policy
 * on the page under test cannot silently drop it.
 */
function paint(state: HudState): void {
  const ID = '__caf_watch_hud';
  const existing = document.getElementById(ID);

  if (state.hidden) {
    if (existing) existing.style.setProperty('display', 'none', 'important');
    return;
  }

  const host = existing || document.createElement('div');
  if (!existing) {
    host.id = ID;
    // <html>, not <body>: a Service Portal route change can replace the body.
    document.documentElement.appendChild(host);
  }

  const css = (el: HTMLElement, props: Record<string, string>) => {
    for (const k in props) el.style.setProperty(k, props[k], 'important');
  };

  css(host, {
    position: 'fixed',
    top: '14px',
    right: '14px',
    width: '390px',
    'max-height': '70vh',
    overflow: 'hidden',
    'z-index': '2147483647',
    display: 'block',
    font: '13px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif',
    color: '#e9eef7',
    background: 'rgba(13,17,26,0.95)',
    border: '1px solid rgba(130,170,230,0.32)',
    'border-radius': '12px',
    'box-shadow': '0 14px 40px rgba(0,0,0,0.5)',
    padding: '13px 15px',
    // Never intercept a click meant for the application.
    'pointer-events': 'none',
    'text-align': 'left',
  });

  host.textContent = '';

  // ---- header: recording dot, case id, verdict badge -----------------------
  const head = document.createElement('div');
  css(head, { display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '6px' });

  const dot = document.createElement('span');
  css(dot, {
    width: '9px',
    height: '9px',
    'border-radius': '50%',
    background: state.verdict ? '#7f8b9e' : '#ff4b4b',
    'box-shadow': state.verdict ? 'none' : '0 0 8px rgba(255,75,75,0.9)',
    flex: '0 0 auto',
  });
  head.appendChild(dot);

  const id = document.createElement('span');
  id.textContent = state.caseId;
  css(id, {
    'font-weight': '700',
    'letter-spacing': '0.04em',
    'font-size': '12.5px',
    color: '#ffffff',
    flex: '1 1 auto',
  });
  head.appendChild(id);

  if (state.verdict) {
    const badge = document.createElement('span');
    badge.textContent = state.verdict;
    const colour =
      state.verdict === 'PASS'
        ? { bg: 'rgba(38,166,91,0.22)', fg: '#5fe39b', bd: 'rgba(95,227,155,0.5)' }
        : state.verdict === 'FAIL'
          ? { bg: 'rgba(214,48,49,0.22)', fg: '#ff7b7b', bd: 'rgba(255,123,123,0.5)' }
          : { bg: 'rgba(230,160,30,0.2)', fg: '#f2c15c', bd: 'rgba(242,193,92,0.5)' };
    css(badge, {
      'font-size': '11px',
      'font-weight': '700',
      'letter-spacing': '0.08em',
      padding: '2px 8px',
      'border-radius': '999px',
      background: colour.bg,
      color: colour.fg,
      border: '1px solid ' + colour.bd,
      flex: '0 0 auto',
    });
    head.appendChild(badge);
  }
  host.appendChild(head);

  // ---- title ---------------------------------------------------------------
  const title = document.createElement('div');
  title.textContent = state.title;
  css(title, {
    'font-size': '12px',
    color: '#a9b6cc',
    'margin-bottom': '10px',
    'padding-bottom': '9px',
    'border-bottom': '1px solid rgba(255,255,255,0.09)',
  });
  host.appendChild(title);

  // ---- the last few steps, current one highlighted --------------------------
  const recent = state.steps.slice(-5);
  for (const s of recent) {
    const row = document.createElement('div');
    css(row, { display: 'flex', gap: '8px', 'margin-bottom': '6px', 'align-items': 'flex-start' });

    const marker = document.createElement('span');
    marker.textContent = s.done ? '✓' : String(s.n);
    css(marker, {
      flex: '0 0 auto',
      width: '18px',
      height: '18px',
      'border-radius': '50%',
      'font-size': '10.5px',
      'font-weight': '700',
      'line-height': '18px',
      'text-align': 'center',
      background: s.done ? 'rgba(95,227,155,0.16)' : 'rgba(110,160,255,0.28)',
      color: s.done ? '#5fe39b' : '#cfe0ff',
    });
    row.appendChild(marker);

    const text = document.createElement('span');
    text.textContent = s.text;
    css(text, {
      flex: '1 1 auto',
      'font-size': s.done ? '12px' : '13px',
      color: s.done ? '#8592a8' : '#f2f6ff',
      'font-weight': s.done ? '400' : '600',
    });
    row.appendChild(text);
    host.appendChild(row);
  }

  // ---- verdict reason ------------------------------------------------------
  if (state.reason) {
    const why = document.createElement('div');
    why.textContent = state.reason;
    css(why, {
      'margin-top': '9px',
      'padding-top': '9px',
      'border-top': '1px solid rgba(255,255,255,0.09)',
      'font-size': '11.5px',
      color: '#9fb0c9',
      'font-style': 'italic',
    });
    host.appendChild(why);
  }
}

async function draw(page: Page): Promise<void> {
  const state = states.get(page);
  if (!state) return;
  if (page.isClosed()) return;
  await page.evaluate(paint, state).catch(() => {
    /* mid-navigation, or a page that has gone away — the next draw fixes it */
  });
}

/**
 * Begin narrating a case on this page.
 *
 * Safe to call repeatedly; the second call for the same case is ignored so a
 * spec can bind opportunistically without tracking whether it already has.
 */
export function attach(page: Page, caseId: string, title: string): void {
  if (!WATCH) return;

  const current = states.get(page);
  if (current && current.caseId === caseId) return;

  states.set(page, { caseId, title, steps: [], verdict: null, reason: null, hidden: false });

  if (!wired.has(page)) {
    wired.add(page);
    // Every navigation wipes the injected node. Redraw from the state held here.
    page.on('load', () => {
      enqueue(() => draw(page));
    });
  }

  enqueue(() => draw(page));
}

/** Narrate a step. Marks the previous one complete. */
export function narrate(page: Page, n: number, text: string): void {
  if (!WATCH) return;
  const state = states.get(page);
  if (!state) return;
  for (const s of state.steps) s.done = true;
  state.steps.push({ n, text, done: false });
  enqueue(() => draw(page));
}

/** Show the verdict on screen and hold, so the run ends on a readable frame. */
export async function verdict(page: Page, v: string, reason?: string): Promise<void> {
  if (!WATCH) return;
  const state = states.get(page);
  if (!state) return;
  for (const s of state.steps) s.done = true;
  state.verdict = v;
  state.reason = reason ?? null;
  await enqueue(() => draw(page));
  // Hold on the verdict. Without this the browser closes on the same frame the
  // result appears, and the one thing the viewer came to see is the one thing
  // they miss.
  await pace(Number(process.env.WATCH_HOLD || PACE * 3));
}

/** Hold for the viewer. Zero-cost when WATCH is off. */
export async function pace(ms: number = PACE): Promise<void> {
  if (!WATCH) return;
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Ring an element and hold before acting on it.
 *
 * The ring is applied with `!important` because the pages under test —
 * ServiceNow classic forms especially — carry outline rules of their own that
 * would otherwise win.
 */
export async function spotlight(target: Locator, ms: number = PACE): Promise<void> {
  if (!WATCH) return;
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 5_000 });
    await target.evaluate((el: HTMLElement) => {
      el.style.setProperty('outline', '3px solid #ff9432', 'important');
      el.style.setProperty('outline-offset', '2px', 'important');
      el.style.setProperty('box-shadow', '0 0 0 7px rgba(255,148,50,0.25)', 'important');
      el.style.setProperty('transition', 'none', 'important');
    });
    await pace(ms);
    await target.evaluate((el: HTMLElement) => {
      el.style.removeProperty('outline');
      el.style.removeProperty('outline-offset');
      el.style.removeProperty('box-shadow');
      el.style.removeProperty('transition');
    });
  } catch {
    /* The element moved or the page navigated. Never fail a case on decoration. */
  }
}

/**
 * Spotlight, then click.
 *
 * The one wrapper worth having: it makes the act visible without the spec
 * having to remember two calls, and it degrades to a plain click when WATCH is
 * off, so a spec written for watch mode still runs in the headless pass.
 */
export async function click(target: Locator, holdMs: number = PACE): Promise<void> {
  await spotlight(target, holdMs);
  await target.click();
}

/**
 * Run `fn` with the HUD hidden.
 *
 * An evidence screenshot must show the application under test and nothing else.
 * A harness banner in the corner of a client-facing image invites exactly the
 * question the pack exists to avoid — whether the tool influenced the result.
 * WATCH_STAMP=1 overrides this for a screen recording or a slide.
 */
export async function withHudHidden<T>(page: Page, fn: () => Promise<T>): Promise<T> {
  if (!WATCH || STAMP) return fn();
  const state = states.get(page);
  if (!state) return fn();

  state.hidden = true;
  await enqueue(() => draw(page));
  try {
    return await fn();
  } finally {
    state.hidden = false;
    await enqueue(() => draw(page));
  }
}
