import { defineConfig } from '@playwright/test';
import path from 'path';

// Node 20.6+ / 24 built-in .env loader, so the project needs no dotenv dependency.
// Absent .env is fine — the setup project reports the missing variable itself.
try {
  (process as unknown as { loadEnvFile: (p: string) => void }).loadEnvFile(
    path.join(__dirname, '.env')
  );
} catch {
  /* no .env, or an older Node — fall through to real environment variables */
}

export const SN_INSTANCE = (process.env.SN_INSTANCE || 'https://dev281754.service-now.com').replace(/\/$/, '');
export const AUTH_STATE = path.join(__dirname, '.auth', 'servicenow.json');
// The session's user token (g_ck). Travels with AUTH_STATE and is useless
// without it — see the note in lib/servicenow.ts on why the Table API needs it.
export const TOKEN_STATE = path.join(__dirname, '.auth', 'sn-token.json');
export const EVIDENCE_DIR = path.join(__dirname, 'evidence');

// Salesforce. The Lightning host is a different origin from the API host, and
// only the Lightning one renders the LWCs.
export const SF_LIGHTNING = (
  process.env.SF_LIGHTNING || 'https://orgfarm-4938c7f768-dev-ed.develop.lightning.force.com'
).replace(/\/$/, '');
export const SF_AUTH_STATE = path.join(__dirname, '.auth', 'salesforce.json');

/**
 * Watch mode — a visible browser, paced so a person can follow it.
 *
 * One switch, read here and in lib/watch.ts, rather than a parallel set of
 * "…:headed" projects: the projects define *what* runs, and this defines
 * whether anyone is watching. Any project can therefore be watched, and a spec
 * written for watch mode still runs in the headless pass.
 *
 * Set by watch.ps1. See WATCH-MODE.md.
 */
export const WATCH = process.env.WATCH === '1' || process.env.WATCH === 'true';

/** Delay Playwright inserts before each action, so the eye can follow it. */
const SLOWMO = Number(process.env.WATCH_SLOWMO || 320);

export default defineConfig({
  testDir: __dirname,
  // ServiceNow forms are slow to settle; a tight default produces flake that
  // reads as an application defect.
  timeout: 90_000,
  expect: { timeout: 20_000 },

  // Serial by default. This suite writes to a live instance with automation on
  // every table — parallel workers would interleave state transitions and the
  // failures would be unreproducible.
  fullyParallel: false,
  workers: 1,

  // Never silently re-run: a retried test that passes hides a real flake, and
  // an evidence pack must record what actually happened the first time.
  retries: 0,
  forbidOnly: true,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],

  use: {
    baseURL: SN_INSTANCE,
    // Evidence, not debugging aids — these are the artefacts the docx generator
    // will consume, so they are kept on success as well as failure.
    screenshot: 'on',
    trace: 'retain-on-failure',
    // A watched run is also a recorded one. The video costs nothing extra to
    // make once the browser is already on screen, and it answers the one
    // question a screenshot cannot: what happened between the two frames.
    video: WATCH ? 'on' : 'off',
    // 1600×1000 is chosen for the screenshots, not for a monitor. In watch mode
    // the window has to fit on a real screen or the viewer sees a scrollbar
    // instead of the application.
    viewport: WATCH ? { width: 1440, height: 860 } : { width: 1600, height: 1000 },
    headless: !WATCH,
    launchOptions: WATCH ? { slowMo: SLOWMO } : {},
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth[\\/]servicenow\.setup\.ts/,
    },
    {
      name: 'sf-setup',
      testMatch: /auth[\\/]salesforce\.setup\.ts/,
    },
    {
      name: 'sn',
      testMatch: /specs[\\/]servicenow-.*\.spec\.ts|specs[\\/]spike-.*\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: AUTH_STATE },
    },
    // The record-only integration cases read both platforms over their CLIs and
    // call the Scripted REST API directly. No ServiceNow login, no Lightning
    // login, no browser — so this project deliberately does not depend on
    // `setup`, and a parity check costs nothing but the two CLI round trips.
    {
      name: 'int',
      testMatch: /specs[\\/]integration-readonly\.spec\.ts/,
    },
    // The transform / data-quality cases. Read-only like `int`, but kept
    // separate so a failure names the layer it belongs to: `int` asks whether
    // records arrived, `etl` asks whether what arrived still means the same
    // thing. They also cost more sf calls, which matters against the DE budget.
    {
      name: 'etl',
      testMatch: /specs[\\/]integration-etl\.spec\.ts/,
    },
    // The negative-path API cases. Its own project rather than a second
    // testMatch on `int`, because `npm run int` is the pass anyone can run on
    // any day and these carry write intent over the wire even though every one
    // of them is expected to be refused. Naming it separately means opting into
    // that risk is an explicit act, not a side effect of running the safe suite.
    {
      name: 'int-neg',
      testMatch: /specs[\\/]integration-negative\.spec\.ts/,
    },
    // The Salesforce UI cases. Separate from `int` because these need a
    // Lightning session and `int` deliberately needs no login at all — folding
    // them together would make the cheap read-only pass depend on a browser.
    {
      name: 'sf-ui',
      testMatch: /specs[\\/](integration-ui.*|probe-lightning)\.spec\.ts/,
      dependencies: ['sf-setup'],
      use: { baseURL: SF_LIGHTNING, storageState: SF_AUTH_STATE },
    },
    // Demo data seeding. Not a test project — it writes to the instance on
    // purpose, which is the opposite of what every other project here does, so
    // it lives in its own directory and its own project and is never picked up
    // by `npm run sn`. Kept inside the harness rather than beside it only
    // because it needs the same authenticated session.
    {
      name: 'seed',
      testMatch: /seed[\\/].*\.seed\.ts/,
      dependencies: ['setup'],
      use: { storageState: AUTH_STATE },
    },
  ],
});
