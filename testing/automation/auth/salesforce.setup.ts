import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SF_LIGHTNING, SF_AUTH_STATE } from '../playwright.config';
import { sfEnv, parseSfJson } from '../lib/sfjson';

/**
 * Authenticate once against Lightning and persist the session.
 *
 * **No password is used, and none is stored in this folder.** The org is already
 * authorised to the `sf` CLI as `caf-sf`, whose refresh token lives in
 * `%USERPROFILE%\.sfdx\` encrypted with the Windows user key. `sf org open
 * --url-only` exchanges that for a single-use `frontdoor.jsp` URL, and
 * navigating to it hands the browser the same session the CLI already holds.
 *
 * That is the whole reason this setup looks different from its ServiceNow
 * counterpart. The alternative — an `SF_PASSWORD` in `.env` — would put a live
 * org credential in a client-facing directory to obtain a session the machine
 * can already prove it is entitled to. It would also break the moment the org
 * enforces MFA on interactive logins, which frontdoor is not subject to.
 *
 * The token in that URL is one-time and short-lived, so this runs once per suite
 * and every spec starts from the saved storage state. It is never logged.
 */
// The global npm root is per-user, so a hardcoded path is dead on any machine
// but the one it was written on. Resolve it the way lib/salesforce.ts already
// does — from this user's own npm prefix — with SF_RUN_JS in .env as the
// override for a non-default prefix.
const SF_RUN =
  process.env.SF_RUN_JS ||
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@salesforce', 'cli', 'bin', 'run.js');
const ORG = 'caf-sf';

test('authenticate against Salesforce Lightning', async ({ page }) => {
  expect(
    fs.existsSync(SF_RUN),
    `Salesforce CLI entry script not found at ${SF_RUN}. Install it with ` +
      '`npm install -g @salesforce/cli`, or set SF_RUN_JS in .env.'
  ).toBeTruthy();

  // sf exits non-zero on a refusal but still writes a JSON body on stdout
  // describing it. Discarding that turned every cause — expired grant, wrong
  // org, a flag the CLI would not accept — into the same "Command failed"
  // string, which is how this looked like a broken authorisation when it was
  // not. Capture stdout on the failure path and read it, the way
  // lib/salesforce.ts already does.
  let raw = '';
  let stderr = '';
  let exitCode = 0;
  try {
    raw = execFileSync(
      process.execPath,
      [SF_RUN, 'org', 'open', '--target-org', ORG, '--url-only', '--path', '/lightning/page/home', '--json'],
      {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true,
        // Colour off. Playwright sets FORCE_COLOR=1 in every worker and the CLI
        // honours it for --json too, which puts ANSI escapes immediately after
        // the opening brace and makes JSON.parse fail at "position 1".
        env: sfEnv(),
      }
    );
  } catch (e: any) {
    raw = e.stdout?.toString() ?? '';
    stderr = e.stderr?.toString() ?? '';
    exitCode = e.status ?? -1;
  }

  const parsed = parseSfJson(
    raw,
    `sf org open (exit ${exitCode}). Confirm the org is still authorised — ` +
      `"sf org display --target-org ${ORG}" should report Connected` +
      (stderr.trim() ? `\nstderr: ${stderr.slice(0, 400)}` : '')
  );

  expect(
    parsed.status,
    `sf org open refused (exit ${exitCode}): ${parsed.message ?? JSON.stringify(parsed).slice(0, 400)}`
  ).toBe(0);

  const frontdoor: string = parsed.result?.url;

  expect(frontdoor, 'sf org open returned no URL').toBeTruthy();

  await page.goto(frontdoor, { waitUntil: 'domcontentloaded' });

  // Lightning boots long after DOMContentLoaded and redirects at least once on
  // the way through frontdoor. Wait for the app shell rather than for a URL,
  // because the landing path varies with the user's default app.
  await page
    .locator('one-appnav, .slds-global-header, [data-aura-class], lightning-primitive-icon')
    .first()
    .waitFor({ state: 'attached', timeout: 90_000 });

  // frontdoor answers 200 with a login page when the token has already been
  // spent, so "we navigated successfully" is not evidence of a session. Prove
  // it by reading the identity the session resolves to.
  const onLoginPage = await page.locator('#username, #password').first().isVisible().catch(() => false);
  if (onLoginPage) {
    throw new Error(
      `Landed on the Lightning login form at ${page.url()}. The frontdoor token was rejected — it is ` +
        'single-use, so this happens if the URL was reused. Re-run the sf-setup project.'
    );
  }

  const me = await page.evaluate(async () => {
    const res = await fetch('/services/data/v67.0/chatter/users/me', {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) return { status: res.status, name: null as string | null, username: null as string | null };
    const body = await res.json();
    return { status: res.status, name: body.displayName ?? null, username: body.username ?? null };
  });

  expect(
    me.username,
    `Session did not resolve to a user (HTTP ${me.status} from the Chatter me resource at ${page.url()}).`
  ).toBeTruthy();

  fs.mkdirSync(path.dirname(SF_AUTH_STATE), { recursive: true });
  await page.context().storageState({ path: SF_AUTH_STATE });

  console.log(`[sf-auth] signed in to ${SF_LIGHTNING} as ${me.name} (${me.username}); session saved to .auth/`);
  console.log('[sf-auth] no password was used or stored — the session came from the CLI\'s existing OAuth grant.');
});
