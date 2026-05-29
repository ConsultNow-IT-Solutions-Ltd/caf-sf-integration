import { Page } from '@playwright/test';
import fs from 'fs';
import { SN_INSTANCE, TOKEN_STATE } from '../playwright.config';

/**
 * Run a server-side script through Scripts - Background.
 *
 * This exists because three of the fields this seed has to set —
 * `caf_status`, `state` and `short_description` on `caf_req` — are
 * `read_only=true` in the dictionary, and the Table API drops a read-only field
 * silently: HTTP 200, the pre-write values echoed back, `sys_updated_on`
 * unmoved, no error anywhere. The documented alternative is to flip the
 * `sys_dictionary` entry, write, and flip it back, which mutates instance
 * metadata for the duration and leaves the app unprotected if anything fails in
 * between. A GlideRecord `setValue` server-side is subject to no such rule, so
 * the whole seed runs as ordinary application logic with every business rule
 * and flow firing exactly as it would for a person on a form.
 *
 * The session comes from the same storage state the test pack uses. `sysparm_ck`
 * is the CSRF token — the POST is rejected without it, which is the same
 * defence that makes the Table API demand `X-UserToken`.
 */
export async function runBackgroundScript(page: Page, script: string): Promise<string> {
  const ck = JSON.parse(fs.readFileSync(TOKEN_STATE, 'utf8')).userToken as string;

  const res = await page.request.post(`${SN_INSTANCE}/sys.scripts.do`, {
    form: {
      script,
      sysparm_ck: ck,
      runscript: 'Run script',
      // Without this the script runs outside the transaction quota manager and a
      // long loop is killed at the default limit with no output at all.
      quota_managed_transaction: 'on',
    },
    timeout: 300_000,
  });

  const html = await res.text();

  if (!res.ok()) {
    throw new Error(`sys.scripts.do returned HTTP ${res.status()}:\n${html.slice(0, 2000)}`);
  }

  // The response is a full page; the script's own output is everything the
  // platform wrote between the header and the trailing form. Stripping tags is
  // enough — nothing here needs the markup, and the alternative is parsing a
  // page whose shape changes between releases.
  const plain = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .join('\n');

  // Keep only what this script printed.
  //
  // The page also replays whatever the instance has recently written to its own
  // invalid-query log, complete with Java stack traces from entirely unrelated
  // sessions. Left in, that noise is indistinguishable from output — a caller
  // checking the result for the word "exception" fails on somebody else's.
  const lines = plain.split('\n');
  const printed = lines
    .filter((l) => l.includes('*** Script:'))
    .map((l) => l.slice(l.indexOf('*** Script:') + '*** Script:'.length).trim());

  // "Script completed" is only written on a clean run: a compile error or an
  // uncaught exception replaces it with the error text, so its absence is the
  // signal, and it survives the noise filter above because it is on the header
  // line.
  const completed = /Script completed/i.test(plain);
  if (!completed) {
    throw new Error(
      'The background script did not complete. Page said:\n' +
        lines.filter((l) => !/^\s*(com\.glide|java\.|jdk\.|sun\.)/.test(l)).slice(0, 40).join('\n')
    );
  }

  return printed.join('\n');
}
