import { request, APIRequestContext } from '@playwright/test';
import fs from 'fs';
import { SN_INSTANCE } from '../playwright.config';

/**
 * The inbound Scripted REST API, called the way Salesforce calls it.
 *
 * Apex reaches these resources through the `ServiceNow_CAF` named credential,
 * which authenticates as `sf.integration` over basic auth. The echo-loop guard
 * keys off that user: outbound pushes skip anything `sf.integration` wrote. So a
 * test that calls these endpoints as `admin` would exercise a *different* code
 * path from the one in production — the guard would not fire, and the case would
 * pass while the real integration looped. Hence the same credential, read from
 * the same file the named credential was configured from.
 *
 * The password is read at call time and never logged. It is also in a session
 * transcript from 2026-08-06 and due for rotation (HANDOFF open item 6).
 */
// The documented location is under the `patel` profile and does not exist on
// every machine this pack is run from — and the file is deliberately outside the
// repo, so it cannot simply be committed. Both overrides read from .env, which
// is gitignored: SF_INTEGRATION_PASSWORD_FILE to point at the file wherever it
// landed, or SF_INTEGRATION_PASSWORD to supply it directly.
//
// Admin is not a fallback. Basic auth as admin returns 401 on this instance
// (measured), and even if it did not, the echo-loop guard keys off this user
// name — a suite run as admin would exercise a different path from production.
const PASSWORD_FILE =
  process.env.SF_INTEGRATION_PASSWORD_FILE ||
  'C:\\Users\\patel\\.caf-jwt\\sf-integration-password.txt';
const USER = 'sf.integration';
const BASE = '/api/x_gskn2_caf_compli/caf';

export interface CafResponse {
  status: number;
  body: any;
  /** The body as text, for the cases whose expectation is a literal message. */
  text: string;
  /** Milliseconds on the wire — TC-INT-002 wants the observed latency recorded. */
  ms: number;
}

let ctx: APIRequestContext | null = null;

async function context(): Promise<APIRequestContext> {
  if (ctx) return ctx;
  const password = (
    process.env.SF_INTEGRATION_PASSWORD ||
    (fs.existsSync(PASSWORD_FILE) ? fs.readFileSync(PASSWORD_FILE, 'utf8') : '')
  ).trim();
  if (!password) {
    throw new Error(
      `No sf.integration password. Set SF_INTEGRATION_PASSWORD or SF_INTEGRATION_PASSWORD_FILE in .env, ` +
        `or place the file at ${PASSWORD_FILE}. The inbound cases authenticate as that user because the ` +
        'echo-loop guard keys off it; running them as admin would test the wrong path.'
    );
  }
  ctx = await request.newContext({
    baseURL: SN_INSTANCE,
    extraHTTPHeaders: {
      Authorization: 'Basic ' + Buffer.from(`${USER}:${password}`).toString('base64'),
      Accept: 'application/json',
    },
    ignoreHTTPSErrors: true,
    timeout: 120_000,
  });
  return ctx;
}

export async function disposeCafApi(): Promise<void> {
  if (ctx) {
    await ctx.dispose();
    ctx = null;
  }
}

async function call(
  method: 'get' | 'post' | 'patch',
  path: string,
  body?: unknown
): Promise<CafResponse> {
  const c = await context();
  const started = Date.now();
  const res = await c[method](`${BASE}${path}`, {
    ...(body === undefined ? {} : { data: body }),
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    failOnStatusCode: false,
  });
  const ms = Date.now() - started;
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* an error page or an empty body — `text` is the evidence in that case */
  }
  // Scripted REST wraps whatever the resource returns in `result`. Unwrapping
  // here means a spec asserts on the resource's own shape rather than on the
  // platform's envelope, which is the mistake that cost a debugging round in
  // CafSyncHealth.
  const unwrapped =
    parsed && typeof parsed === 'object' && 'result' in parsed && Object.keys(parsed).length === 1
      ? parsed.result
      : parsed;
  return { status: res.status(), body: unwrapped, text, ms };
}

// ------------------------------------------------------------------ read-only

/**
 * The error text, whichever shape it arrived in.
 *
 * A resource returns `{ error: 'some message' }`; the platform itself returns
 * `{ error: { message, detail }, status: 'failure' }` for a 401 or a 403, and
 * the unwrap above leaves that alone because it is not a single-key `result`.
 * Reading `.error` blindly then yields "[object Object]" — measured, and it
 * turned a whole suite's worth of legible failures into noise, which is the
 * expensive kind of bug in an evidence pack.
 */
export function errorMessage(res: CafResponse): string {
  const e = res.body?.error;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    return [e.message, e.detail].filter(Boolean).join(' — ') || JSON.stringify(e);
  }
  return res.text;
}

/** `GET /caf/snapshot` — the comparison feed. Modifies nothing. */
export function snapshot(): Promise<CafResponse> {
  return call('get', '/snapshot');
}

/** `GET /caf/task/{sysId}/evidence` — what ServiceNow actually holds. */
export function listEvidence(sysId: string): Promise<CafResponse> {
  return call('get', `/task/${sysId}/evidence`);
}

// ---------------------------------------------------------------- write-shaped
//
// These carry write intent even where the expected outcome is a refusal. The
// negative cases (TC-INT-013/014/015/032/033/034/035) exist precisely to prove
// nothing is written, and each one re-reads the record afterwards to show
// sys_updated_on unmoved.

export function patchTask(sysId: string, body: unknown): Promise<CafResponse> {
  return call('patch', `/task/${sysId}`, body);
}

export function attest(sysId: string, body: unknown): Promise<CafResponse> {
  return call('post', `/task/${sysId}/attest`, body);
}

export function uploadEvidence(sysId: string, body: unknown): Promise<CafResponse> {
  return call('post', `/task/${sysId}/evidence`, body);
}

export function resync(type: 'request' | 'task', sysId: string): Promise<CafResponse> {
  return call('post', `/resync/${type}/${sysId}`, {});
}
