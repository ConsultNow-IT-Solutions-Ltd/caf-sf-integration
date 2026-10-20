import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import check from '@salesforce/apex/CafSyncHealth.check';
import resync from '@salesforce/apex/CafSyncHealth.resync';

/**
 * Sync Health.
 *
 * Shows whether the compliance grid above it is telling the truth, by asking
 * ServiceNow for its own view and comparing.
 *
 * There is no wire adapter here on purpose: the Apex behind it makes a callout,
 * and a method that makes a callout cannot be cacheable. Every render and every
 * press of Re-check goes and looks, which is the only way the answer means
 * anything.
 */
/** How often the "checked N min ago" label is brought up to date. */
const TICK_MS = 30000;

/** A check older than this is flagged: drift since then would not show. */
export const STALE_MS = 15 * 60000;

/**
 * "just now", "1 min ago", "2 h ago" - how stale a check is, at a glance.
 *
 * @param {number} thenMs the check time, epoch ms
 * @param {number} nowMs  the current time, epoch ms
 * @returns {string} '' when either time is unusable
 */
export function ago(thenMs, nowMs) {
    if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) {
        return '';
    }
    const mins = Math.floor(Math.max(0, nowMs - thenMs) / 60000);
    if (mins < 1) {
        return 'just now';
    }
    if (mins < 60) {
        return mins + ' min ago';
    }
    return Math.floor(mins / 60) + ' h ago';
}

export default class CafSyncHealth extends LightningElement {
    report;
    error;
    loading = true;
    busy = false;

    /** The record type the drift table is narrowed to; '' for all. */
    typeFilter = '';

    /** The record being re-synced, so only its button says so. */
    resyncingSysId;

    /** Current time, moved on by a timer so the age label does not freeze. */
    now = Date.now();

    _tick;

    /** Checks on arrival, and starts the clock behind "checked N min ago". */
    connectedCallback() {
        this.run();
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._tick = setInterval(() => {
            this.now = Date.now();
        }, TICK_MS);
    }

    /** Stops the clock; a strip nobody can see has nothing to keep current. */
    disconnectedCallback() {
        if (this._tick) {
            clearInterval(this._tick);
            this._tick = undefined;
        }
    }

    /**
     * Asks ServiceNow for its view and compares. Clears the previous answer
     * first, so a failed check never leaves an old "In sync" on screen.
     */
    async run() {
        this.loading = true;
        this.error = undefined;
        try {
            const report = await check();
            this.report = report && typeof report === 'object' ? report : undefined;
            if (!this.report) {
                this.error = 'ServiceNow returned no comparison.';
            }
            this.now = Date.now();
        } catch (err) {
            this.error = this.messageOf(err);
            this.report = undefined;
        } finally {
            this.loading = false;
        }
    }

    /** Re-check now. */
    handleRecheck() {
        this.run();
    }

    /**
     * Re-pushes one record from ServiceNow, then checks again. Only the row
     * being repaired says "Re-syncing"; every Re-sync button is disabled
     * meanwhile, because a second push mid-flight would race the first.
     *
     * @param {Event} event click event from a Re-sync button
     */
    async handleResync(event) {
        const data = (event && event.currentTarget && event.currentTarget.dataset) || {};
        const { type, sysid, number } = data;
        if (!type || !sysid || this.busy) {
            return;
        }
        this.busy = true;
        this.resyncingSysId = sysid;
        try {
            await resync({ recordType: type, sysId: sysid });
            this.toast('Re-pushed to Salesforce', number + ' was sent again from ServiceNow.', 'success');
            await this.run();
        } catch (err) {
            this.toast('Re-sync failed', this.messageOf(err), 'error');
        } finally {
            this.busy = false;
            this.resyncingSysId = undefined;
        }
    }

    /**
     * Differences arrive flat from Apex. The template needs a stable key and a
     * couple of display-only flags, so they are decorated here rather than
     * shaping the Apex return around one component's markup.
     */
    get differences() {
        const list = this.report && Array.isArray(this.report.differences) ? this.report.differences : [];
        return list
            .filter((d) => d && typeof d === 'object')
            .map((d, i) => {
                const resyncing = !!d.sysId && d.sysId === this.resyncingSysId;
                return {
                    ...d,
                    key: d.recordType + '|' + d.recordNumber + '|' + d.fieldLabel + '|' + i,
                    showValues: !!d.fieldLabel,
                    resyncDisabled: this.busy || !d.canResync,
                    resyncLabel: resyncing ? 'Re-syncing\u2026' : 'Re-sync'
                };
            });
    }

    /**
     * The type dropdown: each record type among the differences once, sorted,
     * with "All types" first. A filter on a type a re-check no longer returns
     * falls back to "All types".
     *
     * @returns {{value: string, label: string, selected: boolean}[]}
     */
    get typeOptions() {
        const types = [...new Set(this.differences.map((d) => d.recordType || 'record'))].sort((a, b) =>
            a.localeCompare(b)
        );
        const current = types.includes(this.typeFilter) ? this.typeFilter : '';
        return [{ value: '', label: 'All types', selected: current === '' }].concat(
            types.map((t) => ({ value: t, label: t, selected: current === t }))
        );
    }

    /** @returns {boolean} whether the differences span more than one record type */
    get hasSeveralTypes() {
        return this.typeOptions.length > 2;
    }

    /**
     * The differences shown in the table, after the type filter. The headline
     * and breakdown still count every difference.
     *
     * @returns {object[]}
     */
    get visibleDifferences() {
        const current = this.typeOptions.find((o) => o.selected).value;
        return current ? this.differences.filter((d) => (d.recordType || 'record') === current) : this.differences;
    }

    /**
     * Type dropdown changed. An empty or missing value means all.
     *
     * @param {Event} event change event from the select
     */
    handleTypeFilter(event) {
        this.typeFilter = (event && event.target && event.target.value) || '';
    }

    /**
     * The differences counted by record type, e.g. "2 request · 1 task", so
     * the scale of the drift is readable before the table.
     *
     * @returns {string} '' when in sync or nothing listed
     */
    get breakdown() {
        const list = this.differences;
        if (!list.length) {
            return '';
        }
        const byType = new Map();
        list.forEach((d) => {
            const type = d.recordType || 'record';
            byType.set(type, (byType.get(type) || 0) + 1);
        });
        return [...byType.entries()].map(([type, n]) => n + ' ' + type).join(' \u00b7 ');
    }

    get hasReport() {
        return !!this.report && !this.error;
    }

    get inSync() {
        return this.hasReport && this.report.inSync;
    }

    get hasDrift() {
        return this.hasReport && !this.report.inSync;
    }

    get statusDot() {
        return this.inSync ? 'dot dot--green' : 'dot dot--red';
    }

    get headline() {
        if (!this.hasReport) {
            return '';
        }
        if (this.report.inSync) {
            return 'In sync';
        }
        // Out of sync with no list is still out of sync; count what arrived.
        const n = this.differences.length;
        if (n === 0) {
            return 'Out of sync';
        }
        return n === 1 ? '1 difference found' : n + ' differences found';
    }

    get summary() {
        if (!this.hasReport) {
            return '';
        }
        const r = this.report;
        // Controls are appended rather than assumed: an older ServiceNow snapshot
        // resource returns no controls array, and the class then leaves snControls
        // null rather than zero. Printing "· 0 controls" in that case would claim
        // the catalogue was checked and found empty, when it was not checked.
        const n = (v) => (v === null || v === undefined ? '?' : v);
        const parts = [
            `${n(r.comparedCount)} records verified`,
            `${n(r.snRequests)} requests`,
            `${n(r.snTasks)} tasks`,
        ];
        if (r.snControls !== null && r.snControls !== undefined) {
            parts.push(`${r.snControls} controls`);
        }
        return parts.join(' · ');
    }

    /**
     * "checked 10:42:01 · 3 min ago". A missing or unparseable checkedAt
     * shows nothing rather than "Invalid Date".
     *
     * @returns {string}
     */
    get checkedAtLabel() {
        if (!this.hasReport || !this.report.checkedAt) {
            return '';
        }
        const at = new Date(this.report.checkedAt);
        const ms = at.getTime();
        if (Number.isNaN(ms)) {
            return '';
        }
        const age = ago(ms, this.now);
        return at.toLocaleTimeString() + (age ? ' \u00b7 ' + age : '');
    }

    /**
     * Whether the check on screen is old enough that it may no longer be the
     * truth. Moves with the same clock as the age label.
     *
     * @returns {boolean} false when there is no usable check time
     */
    get stale() {
        if (!this.hasReport || !this.report.checkedAt) {
            return false;
        }
        const ms = new Date(this.report.checkedAt).getTime();
        return Number.isFinite(ms) && this.now - ms >= STALE_MS;
    }

    /** @returns {string} the age label's class, amber when the check is stale */
    get whenClass() {
        return this.stale ? 'sync__when sync__when--stale' : 'sync__when';
    }

    messageOf(err) {
        if (!err) {
            return 'Unknown error';
        }
        if (err.body && err.body.message) {
            return err.body.message;
        }
        return err.message || String(err);
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
