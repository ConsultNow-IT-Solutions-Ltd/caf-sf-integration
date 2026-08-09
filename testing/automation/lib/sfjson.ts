/**
 * Talking to the `sf` CLI in a machine-readable way, reliably.
 *
 * Two things have to be got right every time, and both failed in ways that
 * pointed at the wrong component:
 *
 *   1. **Colour must be off.** Playwright sets `FORCE_COLOR=1` in every worker,
 *      and the CLI honours it for `--json` output as well as for human output —
 *      so the payload comes back as `{[32m"status"…`. `JSON.parse` then
 *      fails with "Expected property name or '}' at position 1", which reads
 *      like the CLI returned garbage rather than like the harness asked for
 *      coloured output.
 *   2. **The body has to be extracted, not assumed.** The CLI writes warnings
 *      and progress lines around the JSON, and it exits non-zero while still
 *      writing a perfectly good body describing the refusal.
 *
 * Everything that shells out to `sf` should use `SF_ENV` and `parseSfJson`.
 */

/**
 * Environment for a machine-readable `sf` invocation.
 *
 * `FORCE_COLOR: '0'` rather than deleting the variable: the CLI's colour
 * detection also consults the parent's TTY, and an explicit 0 settles it in
 * every case. NO_COLOR is set for the same reason and ignored when FORCE_COLOR
 * is present, which is what Node's own warning is about.
 */
export function sfEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...base, FORCE_COLOR: '0', NO_COLOR: '1', SF_DISABLE_COLOR: 'true' };
}

/** Strip ANSI SGR and cursor sequences, in case colour got through anyway. */
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Pull the JSON body out of whatever the CLI wrote.
 *
 * Takes the span from the first `{` to the last `}` rather than slicing at the
 * first brace and hoping the rest is clean — the CLI appends a plain-text
 * update notice after the body often enough to matter, and a leading warning
 * can contain a brace of its own.
 */
export function parseSfJson(raw: string, context: string): any {
  const clean = (raw || '').replace(ANSI, '');
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');

  if (start < 0 || end < start) {
    throw new Error(
      `${context}: the sf CLI returned no JSON body.\n` +
        `What it did return:\n${clean.slice(0, 900) || '(nothing)'}`
    );
  }

  try {
    return JSON.parse(clean.slice(start, end + 1));
  } catch (e: any) {
    throw new Error(
      `${context}: could not parse the sf CLI's JSON (${e.message}).\n` +
        `What it returned:\n${clean.slice(0, 900)}`
    );
  }
}
