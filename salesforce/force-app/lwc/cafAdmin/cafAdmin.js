import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getOverview from '@salesforce/apex/CafAdminController.getOverview';

/** Errors longer than this are cut in the table; the full text is the tooltip. */
export const ERROR_PREVIEW = 140;

/**
 * A value as display text: '' for null or undefined rather than "null".
 *
 * @param {*} v any field value
 * @returns {string}
 */
function text(v) {
    return v === null || v === undefined ? '' : String(v);
}

/**
 * A number field as a number, or null when it is missing or not numeric.
 *
 * @param {*} v any field value
 * @returns {number|null}
 */
function num(v) {
    if (v === null || v === undefined || v === '') {
        return null;
    }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * The entries of an array that are objects; [] for anything that is not an array.
 *
 * @param {*} list
 * @returns {object[]}
 */
function objects(list) {
    return (Array.isArray(list) ? list : []).filter((x) => x && typeof x === 'object');
}

/**
 * Integration administration, read-only.
 *
 * Settings live in custom metadata and controls are owned by ServiceNow, so
 * this screen shows what is in force and where to change it rather than
 * offering a second way to change either. Sync Health - the one admin action
 * that does write - stays in the strip above every screen.
 */
export default class CafAdmin extends LightningElement {
    overview;
    error;
    failuresOnly = false;
    operationFilter = '';

    wiredOverview;

    /**
     * Receives the overview. A payload that is not an object is treated as
     * an empty overview, so each section shows its own "nothing here" message.
     *
     * @param {{data?: object, error?: object}} result the wire's payload
     */
    @wire(getOverview)
    handleOverview(result) {
        this.wiredOverview = result;
        if (!result) {
            return;
        }
        if (result.data) {
            this.overview = typeof result.data === 'object' ? result.data : {};
            this.error = undefined;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    /** @returns {boolean} true until the overview or an error arrives */
    get loading() {
        return !this.overview && !this.error;
    }

    // ------------------------------------------------------------ settings

    /**
     * Every setting with a flag where what CafConfig uses is not what is
     * stored: no record, a blank value, or a value the code clamps or cannot
     * convert. A setting without a name cannot be keyed or identified and is
     * left out.
     *
     * @returns {object[]}
     */
    get settings() {
        return objects(this.overview && this.overview.settings)
            .filter((s) => text(s.name))
            .map((s) => {
                const configured = text(s.configured).trim();
                const effective = text(s.effective).trim();
                let flag = '';
                let flagClass = '';
                if (!s.hasRecord) {
                    flag = 'No record - default in use';
                    flagClass = 'pill pill--amber';
                } else if (!configured) {
                    flag = 'Blank - default in use';
                    flagClass = 'pill pill--amber';
                } else if (effective && configured !== effective) {
                    flag = 'Adjusted by CafConfig';
                    flagClass = 'pill pill--blue';
                }
                return {
                    ...s,
                    label: text(s.label) || text(s.name).replace(/_/g, ' '),
                    configuredLabel: configured || '-',
                    effective: effective || '-',
                    notes: text(s.notes),
                    flag,
                    flagClass,
                    hasFlag: !!flag
                };
            });
    }

    // ------------------------------------------------------------ controls

    /**
     * The control catalogue, each with a note on the states worth an
     * administrator's attention. A missing request count is treated as 0.
     *
     * @returns {object[]}
     */
    get controls() {
        return objects(this.overview && this.overview.controls).map((c, i) => {
            const requests = num(c.requests) || 0;
            const active = c.active === true;
            let note = '';
            if (!active && requests > 0) {
                note = 'Inactive but still has requests - they render under no column in the grid';
            } else if (active && requests === 0) {
                note = 'No requests yet - the grid shows N/A down this column';
            } else if (!c.sysId) {
                note = 'No ServiceNow sys_id - requests can only join on the name';
            }
            return {
                ...c,
                key: c.sysId || c.name || 'control-' + i,
                name: text(c.name) || '(Unnamed control)',
                snNumber: text(c.snNumber),
                active,
                requests,
                activeLabel: active ? 'Active' : 'Inactive',
                activeClass: active ? 'pill pill--green' : 'pill pill--none',
                note
            };
        });
    }

    /**
     * Logging_Enabled = false stops CafCallout writing the log. The screen
     * would then show an old, quiet log that reads as "nothing is failing".
     *
     * @returns {boolean}
     */
    get loggingOff() {
        const s = objects(this.overview && this.overview.settings).find((x) => x.name === 'Logging_Enabled');
        return !!s && text(s.effective).trim().toLowerCase() === 'false';
    }

    /** @returns {number} controls marked active */
    get activeControlCount() {
        return this.controls.filter((c) => c.active).length;
    }

    /** @returns {boolean} whether the catalogue has any rows */
    get hasControls() {
        return this.controls.length > 0;
    }

    // ---------------------------------------------------------- callout log

    /** @returns {boolean} whether this user can read CAF_Integration_Log__c */
    get logAccess() {
        return !!(this.overview && this.overview.logAccess);
    }

    /**
     * Every logged call, formatted for the table. Missing timestamps, codes,
     * latencies and errors render as blanks or dashes, never as "null".
     *
     * @returns {object[]}
     */
    get allCalls() {
        return objects(this.overview && this.overview.calls).map((c, i) => {
            const error = text(c.Error__c);
            const latency = num(c.Latency_Ms__c);
            const code = num(c.Status_Code__c);
            const calledAt = typeof c.Called_At__c === 'string' ? c.Called_At__c : '';
            return {
                ...c,
                Id: c.Id || 'call-' + i,
                ok: c.Succeeded__c === true,
                latencyMs: latency,
                when: calledAt.replace('T', ' ').slice(0, 19),
                by: c.Requested_By__r && c.Requested_By__r.Name ? c.Requested_By__r.Name : '',
                resultLabel: c.Succeeded__c === true ? 'OK' : 'Failed',
                resultClass: c.Succeeded__c === true ? 'pill pill--green' : 'pill pill--red',
                latency: latency === null ? '' : latency + ' ms',
                code: code === null ? '-' : code,
                errorShort: error.length > ERROR_PREVIEW ? error.slice(0, ERROR_PREVIEW) + '…' : error
            };
        });
    }

    /**
     * The operation dropdown: each operation in the log once, sorted, with
     * "All operations" first. Calls with no operation recorded are only
     * reachable through "All operations".
     *
     * @returns {{value: string, label: string, selected: boolean}[]}
     */
    get operationOptions() {
        const ops = [...new Set(this.allCalls.map((c) => text(c.Operation__c)).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b)
        );
        const current = ops.includes(this.operationFilter) ? this.operationFilter : '';
        return [{ value: '', label: 'All operations', selected: current === '' }].concat(
            ops.map((o) => ({ value: o, label: o, selected: current === o }))
        );
    }

    /**
     * The log rows after the operation and failures-only filters. An
     * operation a refresh no longer returns is treated as "All operations",
     * so the table never empties for a reason the dropdown cannot show.
     *
     * @returns {object[]}
     */
    get calls() {
        const op = this.activeOperation;
        return this.allCalls
            .filter((c) => !op || text(c.Operation__c) === op)
            .filter((c) => !this.failuresOnly || !c.ok);
    }

    /** @returns {string} the operation filtering the log, or '' when none is, or it is no longer logged */
    get activeOperation() {
        return this.operationOptions.some((o) => o.value === this.operationFilter) ? this.operationFilter : '';
    }

    /**
     * What to say when the table has no rows. An empty log, a log with no
     * failures and a filter that matches nothing are different answers; all
     * three used to read "No callouts logged".
     *
     * @returns {string}
     */
    get emptyLogMessage() {
        const total = this.allCalls.length;
        if (!total) {
            return 'No callouts logged.';
        }
        if (this.failuresOnly && !this.activeOperation) {
            return total === 1 ? 'The one logged call did not fail.' : 'None of the ' + total + ' logged calls failed.';
        }
        return 'No logged calls match the filter.';
    }

    /** @returns {boolean} whether the filtered log has rows */
    get hasCalls() {
        return this.calls.length > 0;
    }

    /**
     * Figures over the rows shown in the log, which is the most recent 50.
     * Calls with no recorded latency are left out of the latency figures
     * rather than counted as zero.
     *
     * @returns {object}
     */
    get callStats() {
        const calls = this.allCalls;
        const failed = calls.filter((c) => !c.ok).length;
        const timed = calls.map((c) => c.latencyMs).filter((n) => n !== null);
        const avg = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null;
        const sorted = [...timed].sort((a, b) => a - b);
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
        // Rows arrive newest first; the first with a timestamp is the latest call.
        const newest = calls.find((c) => c.when);
        return {
            total: calls.length,
            failed,
            successRate: calls.length ? Math.round(((calls.length - failed) / calls.length) * 100) + '%' : '-',
            avg: avg === null ? '-' : avg + ' ms',
            p95: p95 === null ? '-' : p95 + ' ms',
            failedClass: failed ? 'tile__value tile__value--red' : 'tile__value',
            last: newest ? newest.when.slice(0, 16) : '-'
        };
    }

    /**
     * "Failures only" toggled.
     *
     * @param {Event} event change event from the checkbox
     */
    handleFailuresOnly(event) {
        this.failuresOnly = !!(event && event.target && event.target.checked);
    }

    /**
     * Operation dropdown changed. An empty or missing value means all.
     *
     * @param {Event} event change event from the select
     */
    handleOperationFilter(event) {
        this.operationFilter = (event && event.target && event.target.value) || '';
    }

    /**
     * Re-reads the overview. Nothing to refresh before the wire has delivered;
     * a refresh that fails is shown, not thrown.
     */
    async handleRefresh() {
        if (!this.wiredOverview) {
            return;
        }
        try {
            await refreshApex(this.wiredOverview);
        } catch (err) {
            this.error = this.messageOf(err);
        }
    }

    /**
     * The message to show for an Apex or JavaScript error.
     *
     * @param {*} err an AuraHandledException payload, an Error, or anything
     * @returns {string}
     */
    messageOf(err) {
        if (!err) {
            return 'Unknown error';
        }
        if (err.body && err.body.message) {
            return err.body.message;
        }
        return err.message || String(err);
    }
}
