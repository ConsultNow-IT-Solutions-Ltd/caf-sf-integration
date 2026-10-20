/**
 * CSV helpers shared by the screens that export.
 */

/**
 * One CSV cell. Quoted when it holds a separator, and defused when it starts
 * with a character a spreadsheet reads as a formula: descriptions come from
 * ServiceNow, where anyone who can edit a request can type "=HYPERLINK(...)",
 * and opening the export must not run it.
 *
 * @param {*} v any field value; null and undefined become an empty cell
 * @returns {string}
 */
export function csvCell(v) {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) {
        s = "'" + s;
    }
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Rows of values as CSV text, one line per row, CRLF between lines.
 *
 * @param {Array<Array<*>>} rows the header row first, then the data rows
 * @returns {string}
 */
export function csvText(rows) {
    return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/**
 * Today as YYYY-MM-DD in the viewer's zone, for export file names.
 *
 * @returns {string}
 */
export function todayStamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * Starts a download of the CSV through a hidden link. The link goes inside
 * `host`, an element the component renders with lwc:dom="manual", because a
 * component may only add nodes to its own manual-DOM regions.
 *
 * @param {HTMLElement} host     the manual-DOM element to put the link in
 * @param {string}      fileName the name the browser saves the file as
 * @param {string}      text     the CSV text
 * @returns {boolean} false when there was no host to attach the link to
 */
export function downloadCsv(host, fileName, text) {
    if (!host) {
        return false;
    }
    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(text);
    link.download = fileName;
    link.style.display = 'none';
    host.appendChild(link);
    link.click();
    link.remove();
    return true;
}
