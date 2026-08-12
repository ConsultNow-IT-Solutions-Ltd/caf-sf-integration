import { execFileSync } from 'child_process';
import fs from 'fs';
import { parseSfJson } from './sfjson';

/**
 * ServiceNow reads for the integration suite, through `cnit`.
 *
 * `lib/servicenow.ts` reads the Table API through the browser's own session,
 * which is right for the ServiceNow cases — the assertion then sees exactly what
 * the logged-in user sees, ACLs included. The integration cases want the
 * opposite: no browser at all, so a record-only case costs no Lightning login
 * and no ServiceNow login either. TEST-CASES-INTEGRATION.md also writes its
 * `Verify` steps as literal `cnit` invocations, so running them through `cnit`
 * keeps the executed command and the documented one the same string.
 *
 * -ProfileName is not optional and is deliberately not parameterised: the
 * machine-wide default profile is a different PDI that answers every query with
 * plausible rows from the wrong instance.
 */
// Overridable because the toolkit is not installed to a fixed location: it is a
// private PowerShell folder, copied wherever it landed. The documented path is
// under the `patel` profile; this machine has it at C:\audit\. A wrong path
// fails as "not recognized as a cmdlet", which reads like a broken install
// rather than a moved file, so CNIT_PS1 in .env is the supported override.
const CNIT =
  process.env.CNIT_PS1 || 'C:\\audit\\cnit-instance-tools-main\\cnit.ps1';
export const PROFILE = 'caf-reyan';

/**
 * Windows PowerShell, by absolute path where possible.
 *
 * `execFileSync('powershell.exe', …)` resolves through PATH, and a terminal
 * whose PATH has been trimmed — or a Node process started from one — gets
 * `spawnSync powershell.exe ENOENT`. That reads as "PowerShell is not
 * installed", which on Windows nobody believes and so nobody checks.
 * SystemRoot is always set, so this is the same executable without the lookup.
 */
const POWERSHELL = (() => {
  const root = process.env.SystemRoot || process.env.windir;
  if (root) {
    const abs = `${root}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    if (fs.existsSync(abs)) return abs;
  }
  return 'powershell.exe';
})();

export const TABLES = {
  req: 'x_gskn2_caf_compli_caf_req',
  tsk: 'x_gskn2_caf_compli_caf_tsk',
  relationship: 'x_gskn2_caf_compli_caf_relationship',
  control: 'x_gskn2_caf_compli_caf_conformance_type',
  businessApp: 'cmdb_ci_business_app',
  attachment: 'sys_attachment',
  dictionary: 'sys_dictionary',
  properties: 'sys_properties',
  approver: 'sysapproval_approver',
  syslog: 'syslog',
} as const;

export interface CnitOptions {
  query?: string;
  fields?: string[];
  limit?: number;
}

/** The exact command line a reader could paste into a shell. Goes in the evidence. */
export function cnitCommand(table: string, opts: CnitOptions = {}): string {
  const parts = [`cnit get ${table}`];
  if (opts.query) parts.push(`-Query "${opts.query}"`);
  if (opts.fields) parts.push(`-Fields ${opts.fields.join(',')}`);
  if (opts.limit) parts.push(`-Limit ${opts.limit}`);
  parts.push(`-ProfileName ${PROFILE}`);
  return parts.join(' ');
}

export function cnitGet(table: string, opts: CnitOptions = {}): Record<string, string>[] {
  // -ExcludeRefLinks: without it a reference field arrives as a {link, value}
  // object rather than the sys_id string, so every comparison against one fails
  // on shape and every string interpolation of one reads "[object Object]".
  // -ExecutionPolicy Bypass is not optional.
  //
  // Windows ships client machines at Restricted, so a freshly spawned
  // powershell.exe refuses to run cnit.ps1 — "cannot be loaded because running
  // scripts is disabled on this system". It is easy to miss during development
  // because a shell that already has a relaxed policy exports
  // PSExecutionPolicyPreference, and every child inherits it; the harness then
  // works for whoever built it and fails for everyone else. The bypass applies
  // to this one process and changes nothing on the machine.
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CNIT,
    'get', table, '-ProfileName', PROFILE, '-ExcludeRefLinks',
  ];
  if (opts.query) args.push('-Query', opts.query);
  if (opts.fields) args.push('-Fields', opts.fields.join(','));
  // -Limit is applied *before* any client-side sort, so a caller wanting the
  // newest N must put ^ORDERBYDESCsys_created_on in the query rather than
  // sorting the returned page.
  args.push('-Limit', String(opts.limit ?? 1000));

  const raw = execFileSync(POWERSHELL, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });

  // Extracted with parseSfJson rather than by slicing from the first '{' to the
  // end of the buffer. cnit is a PowerShell script and PowerShell writes its own
  // trailing material — a progress record flushed after the body, an update
  // notice — which the old slice swallowed into the parse and reported as
  // malformed JSON from the instance. parseSfJson takes the span to the last '}'
  // and strips ANSI first, and it names the command in the failure text.
  const parsed = parseSfJson(raw, `cnit get ${table}`);
  return parsed.result ?? [];
}

/** Read a single system property's value, or null when it is not set. */
export function property(name: string): string | null {
  const rows = cnitGet(TABLES.properties, { query: `name=${name}`, fields: ['name', 'value'] });
  return rows.length ? rows[0].value : null;
}
