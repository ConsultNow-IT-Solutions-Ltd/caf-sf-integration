import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { sfEnv, parseSfJson } from './sfjson';

/**
 * The Salesforce half of the `Verify` step.
 *
 * Every integration case has to read both sides — a case that only checks the
 * side it wrote to cannot fail in the way this architecture actually fails. This
 * is the mirror of `lib/cnit.ts`: same shape, same "return rows, record the
 * command" contract, so a spec can assert across the seam without caring which
 * CLI produced which half.
 *
 * The CLI is invoked as `node run.js`, not through `sf.cmd`. Node refuses to
 * execFileSync a .cmd on Windows without `shell: true` (EINVAL), and turning the
 * shell on would put every SOQL string through cmd.exe quoting — where a `WHERE
 * Name = 'x'` clause is one stray character away from meaning something else.
 * Going straight to the CLI's own entry script keeps arguments as an array all
 * the way down, so no query is ever re-parsed by a shell.
 */
// The global npm root is per-user, so the documented `patel` path is dead on any
// other machine. SF_RUN_JS in .env overrides it; the default follows the current
// user's own npm prefix, which is where `npm install -g @salesforce/cli` puts it.
const SF_RUN =
  process.env.SF_RUN_JS ||
  path.join(
    process.env.APPDATA || '',
    'npm', 'node_modules', '@salesforce', 'cli', 'bin', 'run.js'
  );
export const ORG = 'caf-sf';

export const OBJECTS = {
  req: 'CAF_Request__c',
  tsk: 'CAF_Task__c',
  control: 'CAF_Control_Catalog__c',
  contentVersion: 'ContentVersion',
  contentDocumentLink: 'ContentDocumentLink',
} as const;

/** Every `sf` call counts against the DE daily API budget. Specs report this. */
let apiCalls = 0;
export function sfCallsMade(): number {
  return apiCalls;
}

function sf(args: string[]): any {
  apiCalls += 1;
  if (!fs.existsSync(SF_RUN)) {
    throw new Error(
      `Salesforce CLI entry script not found at ${SF_RUN}. Set SF_RUN_JS in .env, or install it with ` +
        '`npm install -g @salesforce/cli`. The global npm root is per-user, so this path differs per machine.'
    );
  }
  let raw: string;
  try {
    raw = execFileSync(process.execPath, [SF_RUN, ...args, '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      // Colour off — see lib/sfjson.ts. Playwright sets FORCE_COLOR=1 in every
      // worker and the CLI colourises --json output too.
      env: sfEnv(),
    });
  } catch (e: any) {
    // sf exits non-zero on a query error but still writes a JSON body on stdout
    // describing it. Losing that to an exec failure would turn "field does not
    // exist" into "command failed", which is a much worse diagnostic.
    raw = e.stdout?.toString() ?? '';
    if (!raw) throw e;
  }
  return parseSfJson(raw, `sf ${args[0]} ${args[1] ?? ''}`.trim());
}

/** The exact command line a reader could paste into a shell. Goes in the evidence. */
export function soqlCommand(soql: string): string {
  return `sf data query --query "${soql}" --target-org ${ORG}`;
}

export function soql(query: string): Record<string, any>[] {
  const out = sf(['data', 'query', '--query', query, '--target-org', ORG]);
  if (out.status !== 0) {
    throw new Error(`SOQL failed: ${out.message ?? JSON.stringify(out).slice(0, 400)}\n${query}`);
  }
  // attributes is SOQL plumbing (type + record URL) and only ever adds noise to
  // an evidence table a client is going to read.
  return (out.result?.records ?? []).map((r: any) => {
    const { attributes, ...rest } = r;
    return rest;
  });
}

/** Field-level metadata: what the org says is updateable, and by what type. */
export function describe(sobject: string): any {
  const out = sf(['sobject', 'describe', '--sobject', sobject, '--target-org', ORG]);
  if (out.status !== 0) throw new Error(`describe ${sobject} failed: ${out.message}`);
  return out.result;
}

/** Org limits — DailyApiRequests is the number TC-INT-060 is about. */
export function limits(): Record<string, { max: number; remaining: number }> {
  const out = sf(['org', 'list', 'limits', '--target-org', ORG]);
  const map: Record<string, { max: number; remaining: number }> = {};
  for (const l of out.result ?? []) map[l.name] = { max: l.max, remaining: l.remaining };
  return map;
}

/**
 * Apex code coverage, per class.
 *
 * TC-INT-061 asserts this is zero on the three service classes. Run through the
 * Tooling API rather than `apex run test`, because with no test classes in the
 * org a test run has nothing to execute and reports no coverage rows at all —
 * which is indistinguishable from "the query failed".
 */
function tooling(query: string): Record<string, any>[] {
  const out = sf(['data', 'query', '--query', query, '--use-tooling-api', '--target-org', ORG]);
  if (out.status !== 0) {
    throw new Error(`Tooling query failed: ${out.message ?? ''}\n${query}`);
  }
  return (out.result?.records ?? []).map((r: any) => {
    const { attributes, ...rest } = r;
    return rest;
  });
}

export function apexClasses(): Record<string, any>[] {
  return tooling(
    'SELECT Name, NamespacePrefix, ApiVersion, LengthWithoutComments FROM ApexClass ORDER BY NamespacePrefix, Name'
  );
}

/**
 * Test classes belonging to this org, not to something installed in it.
 *
 * Two filters matter and both were learned the hard way. NamespacePrefix must
 * be null: the Developer Edition org ships `devedapp` classes including two
 * named *Test, which have nothing to do with this project. And matching on the
 * name alone is not enough in either direction — `CafAttestationService`
 * contains the substring "test", so the naive LIKE '%Test%' claims the service
 * class under test is its own test class.
 */
export function apexTestClasses(): Record<string, any>[] {
  return tooling(
    'SELECT Name, NamespacePrefix, SymbolTable FROM ApexClass WHERE NamespacePrefix = null ORDER BY Name'
  ).filter((c) => {
    const modifiers: string[] = c.SymbolTable?.tableDeclaration?.modifiers ?? [];
    return modifiers.some((m) => /istest/i.test(m));
  });
}

export function codeCoverage(): Record<string, any>[] {
  return tooling(
    'SELECT ApexClassOrTrigger.Name, NumLinesCovered, NumLinesUncovered FROM ApexCodeCoverageAggregate'
  );
}

/**
 * Run anonymous Apex and hand back what it printed.
 *
 * The point of this is to exercise the *real* class — CafSyncHealth.check(),
 * CafDashboardController.getRequests() — rather than a TypeScript
 * reimplementation of what they are believed to do. A suite that reimplements
 * the component under test can only ever confirm its own assumptions, and the
 * roll-up cases are exactly where that would go wrong.
 *
 * Output travels through a marked System.debug line rather than the raw log:
 * the log is full of platform noise and the marker makes extraction exact.
 */
const MARK = 'CAFTEST::';

export function runApex(body: string): { logs: string; emitted: string[]; success: boolean } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caf-apex-'));
  const file = path.join(dir, 'run.apex');
  // Written with fs, not PowerShell: Set-Content -Encoding utf8 adds a BOM in
  // 5.1 and `sf apex run` then fails with "Invalid identifier" on the first
  // token, which reads as a syntax error in the script rather than an encoding
  // problem in the file.
  fs.writeFileSync(file, body, { encoding: 'utf8' });
  try {
    const out = sf(['apex', 'run', '--file', file, '--target-org', ORG]);
    const logs: string = out.result?.logs ?? '';
    const emitted = logs
      .split(/\r?\n/)
      .filter((l) => l.includes(MARK))
      .map((l) => l.slice(l.indexOf(MARK) + MARK.length).trim());
    return { logs, emitted, success: out.result?.success !== false && out.status === 0 };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export const APEX_MARK = MARK;

/** Named credentials, for TC-INT-059. The name is load-bearing in Apex. */
export function namedCredentials(): Record<string, any>[] {
  const out = sf([
    'data',
    'query',
    '--query',
    'SELECT DeveloperName, Endpoint, PrincipalType FROM NamedCredential ORDER BY DeveloperName',
    '--use-tooling-api',
    '--target-org',
    ORG,
  ]);
  return (out.result?.records ?? []).map((r: any) => {
    const { attributes, ...rest } = r;
    return rest;
  });
}
