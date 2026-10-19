import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getQueue from '@salesforce/apex/CafApprovalsController.getQueue';
import getRecentDecisions from '@salesforce/apex/CafApprovalsController.getRecentDecisions';

const ALL = '';

/** CafApprovalsController.getQueue's LIMIT. A full page means there may be more. */
export const QUEUE_LIMIT = 500;
const DAY_MS = 86400000;

/** How a decision is shown. Anything else is shown as ServiceNow sent it, never guessed. */
const DECISIONS = {
    approved: { label: 'Approved', cls: 'pill pill--green' },
    rejected: { label: 'Rejected', cls: 'pill pill--red' }
};

/**
 * Today as YYYY-MM-DD in the viewer's zone, the format Date fields arrive in.
 *
 * @returns {string} today's date, e.g. "2026-10-19"
 */
function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * Whole days from one ISO date to another; negative when `toIso` is earlier.
 *
 * @param {string} fromIso start date, YYYY-MM-DD
 * @param {string} toIso   end date, YYYY-MM-DD
 * @returns {number} days between them, or NaN when either will not parse
 */
function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
}

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
 * The approver's queue: every task across every request that is waiting on an
 * attestation, in one list, instead of one request at a time through the grid.
 *
 * Reviewing opens the same evidence and attestation components the grid's
 * drill-in uses, with the upload control removed - the approver judges the
 * evidence, they do not add to it. The decision goes to ServiceNow; the task
 * drops out of the queue when ServiceNow closes it and the push comes back.
 */
export default class CafApprovals extends LightningElement {
    queue = [];
    decisions = [];
    error;
    loading = true;

    appFilter = ALL;
    search = '';
    overdueOnly = false;

    /** The decisions list failing should not hide a queue that loaded. */
    decisionsError;

    activeTask;
    evidenceCount;

    wiredQueue;
    wiredDecisions;

    /**
     * Receives the In Progress tasks. Rows that are not objects are dropped
     * rather than rendered as blank lines.
     *
     * @param {{data?: object[], error?: object}} result the wire's payload
     */
    @wire(getQueue)
    handleQueue(result) {
        this.wiredQueue = result;
        if (!result) {
            return;
        }
        if (result.data) {
            const today = todayIso();
            this.queue = (Array.isArray(result.data) ? result.data : [])
                .filter((t) => t && typeof t === 'object')
                .map((t, i) => this.decorate(t, today, i));
            this.error = undefined;
            this.loading = false;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
            this.loading = false;
        }
    }

    /**
     * Receives the most recent decisions. A failure here is kept apart from
     * the queue's, so the queue still shows when only this list cannot load.
     *
     * @param {{data?: object[], error?: object}} result the wire's payload
     */
    @wire(getRecentDecisions)
    handleDecisions(result) {
        this.wiredDecisions = result;
        if (!result) {
            return;
        }
        if (result.data) {
            this.decisions = (Array.isArray(result.data) ? result.data : [])
                .filter((t) => t && typeof t === 'object')
                .map((t) => this.decorateDecision(t));
            this.decisionsError = undefined;
        } else if (result.error) {
            this.decisions = [];
            this.decisionsError = this.messageOf(result.error);
        }
    }

    /**
     * Lifts the parent request's fields onto the task row. A task whose parent
     * did not come back - deleted, or not shared with this user - still
     * renders, with those columns blank.
     *
     * @param {object} t a CAF_Task__c row with CAF_Request__r
     * @returns {object} the row plus app, control and requestNumber
     */
    flatten(t) {
        const r = t.CAF_Request__r || {};
        return {
            ...t,
            app: text(r.Business_Application__c),
            control: text(r.CAF_Control__c),
            requestNumber: text(r.SN_Number__c)
        };
    }

    /**
     * Labels one recent decision. A value other than approved or rejected is
     * shown as received instead of being folded into one of the two.
     *
     * @param {object} t a CAF_Task__c row
     * @returns {object} the row with decision label, pill class and date
     */
    decorateDecision(t) {
        const known = DECISIONS[t.Approval__c];
        const modified = typeof t.LastModifiedDate === 'string' ? t.LastModifiedDate : '';
        return {
            ...this.flatten(t),
            decisionLabel: known ? known.label : text(t.Approval__c) || 'Unknown',
            decisionClass: known ? known.cls : 'pill pill--none',
            updated: modified.slice(0, 10)
        };
    }

    /**
     * Works out the due label and whether the task is late. Due is the task's
     * planned completion date. A task with none is not overdue - there is
     * nothing to be late against - and sorts last, which is how the Apex
     * orders it. A date that will not parse is shown as invalid, not as on
     * time.
     *
     * @param {object} t     a CAF_Task__c row
     * @param {string} today today as YYYY-MM-DD
     * @param {number} index the row position, the key of last resort
     * @returns {object} the display row for the queue
     */
    decorate(t, today, index = 0) {
        const row = this.flatten(t);
        const due = text(t.Planned_Completion_Date__c);
        let dueLabel = 'No date';
        let dueClass = 'due due--none';
        let overdue = false;

        if (due) {
            const days = daysBetween(today, due);
            if (Number.isNaN(days)) {
                dueLabel = due + ' (invalid date)';
                dueClass = 'due due--none';
            } else if (days < 0) {
                overdue = true;
                dueLabel = due + ' (' + -days + 'd overdue)';
                dueClass = 'due due--late';
            } else if (days <= 7) {
                dueLabel = due + (days === 0 ? ' (today)' : ' (' + days + 'd)');
                dueClass = 'due due--soon';
            } else {
                dueLabel = due;
                dueClass = 'due';
            }
        }

        return {
            ...row,
            // The key LWC iterates on: never undefined, even on a malformed row.
            Id: t.Id || t.ServiceNow_Sys_Id__c || t.SN_Number__c || 'row-' + index,
            overdue,
            dueLabel,
            dueClass,
            unlinked: !t.ServiceNow_Sys_Id__c,
            // Blank fields are left out, so searching for "undefined" finds nothing.
            haystack: [t.SN_Number__c, t.Short_Description__c, row.app, row.control, row.requestNumber]
                .filter((v) => v !== null && v !== undefined && v !== '')
                .join(' ')
                .toLowerCase(),
            rowClass: 'tasks__row'
        };
    }

    /**
     * The queue after the application, search and overdue filters, with the
     * row under review highlighted.
     *
     * @returns {object[]}
     */
    get visibleQueue() {
        const needle = text(this.search).trim().toLowerCase();
        const activeId = this.activeTask && this.activeTask.id;
        return this.queue
            .filter((t) => this.appFilter === ALL || t.app === this.appFilter)
            .filter((t) => !needle || t.haystack.includes(needle))
            .filter((t) => !this.overdueOnly || t.overdue)
            .map((t) => ({
                ...t,
                rowClass: activeId && t.Id === activeId ? 'tasks__row tasks__row--active' : 'tasks__row'
            }));
    }

    /**
     * The application dropdown: every application in the queue, sorted, with
     * "All applications" first.
     *
     * @returns {{value: string, label: string, selected: boolean}[]}
     */
    get appOptions() {
        const apps = [...new Set(this.queue.map((t) => t.app).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b)
        );
        return [{ value: ALL, label: 'All applications', selected: this.appFilter === ALL }].concat(
            apps.map((a) => ({ value: a, label: a, selected: this.appFilter === a }))
        );
    }

    /** @returns {number} tasks waiting on a decision, before any filter */
    get awaitingCount() {
        return this.queue.length;
    }

    /** @returns {number} queued tasks past their planned completion date */
    get overdueCount() {
        return this.queue.filter((t) => t.overdue).length;
    }

    /** @returns {number} approvals among the recent decisions */
    get approvedCount() {
        return this.decisions.filter((d) => d.Approval__c === 'approved').length;
    }

    /** @returns {number} rejections among the recent decisions */
    get rejectedCount() {
        return this.decisions.filter((d) => d.Approval__c === 'rejected').length;
    }

    /** @returns {boolean} whether any row survives the filters */
    get hasQueue() {
        return this.visibleQueue.length > 0;
    }

    /** @returns {boolean} whether any filter is narrowing the queue */
    get isFiltered() {
        return this.appFilter !== ALL || text(this.search).trim() !== '' || this.overdueOnly;
    }

    /**
     * The Apex returns at most QUEUE_LIMIT rows, soonest due first. Saying so
     * matters: a silently truncated queue reads as "this is everything".
     *
     * @returns {boolean}
     */
    get queueCapped() {
        return this.queue.length >= QUEUE_LIMIT;
    }

    /** @returns {number} the row limit, for the template's warning */
    get queueLimit() {
        return QUEUE_LIMIT;
    }

    /** @returns {boolean} whether the recent-decisions table has rows */
    get hasDecisions() {
        return this.decisions.length > 0;
    }

    /**
     * The approver judges the evidence; they do not add to it.
     *
     * @returns {boolean} always true
     */
    get evidenceReadOnly() {
        return true;
    }

    /** @returns {boolean} whether the review panel is open */
    get hasActiveTask() {
        return !!this.activeTask;
    }

    /**
     * Application dropdown changed. An empty or missing value means all.
     *
     * @param {Event} event change event from the select
     */
    handleAppFilter(event) {
        this.appFilter = (event && event.target && event.target.value) || ALL;
    }

    /**
     * "Overdue only" toggled.
     *
     * @param {Event} event change event from the checkbox
     */
    handleOverdueOnly(event) {
        this.overdueOnly = !!(event && event.target && event.target.checked);
    }

    /**
     * Search box typed in.
     *
     * @param {Event} event input event from the search box
     */
    handleSearch(event) {
        this.search = text(event && event.target && event.target.value);
    }

    /**
     * Opens the review panel for the task on the clicked row. A row with no
     * record Id or no ServiceNow sys_id has nothing the panels can load or
     * send a decision to, so it opens nothing.
     *
     * @param {Event} event click event from a Review button
     */
    handleReview(event) {
        const data = (event && event.currentTarget && event.currentTarget.dataset) || {};
        const { id, sysid, number, state, approval } = data;
        if (!id || !sysid) {
            return;
        }
        this.evidenceCount = undefined;
        this.activeTask = { id, sysId: sysid, number: number || '', state, approval };
    }

    /** Closes the review panel. */
    handleCloseReview() {
        this.activeTask = undefined;
        this.evidenceCount = undefined;
    }

    /**
     * Relays cafEvidence's ServiceNow count to cafAttestation, which gates the
     * decision on it. A count for a task other than the open one is ignored -
     * it is a late reply for a panel already closed.
     *
     * @param {CustomEvent} event evidencecount event, detail {sysId, count}
     */
    handleEvidenceCount(event) {
        const detail = event && event.detail;
        if (!detail || !this.activeTask || detail.sysId !== this.activeTask.sysId) {
            return;
        }
        this.evidenceCount = typeof detail.count === 'number' ? detail.count : undefined;
    }

    /**
     * The decision moved the task and, through ServiceNow's rules, possibly the
     * request. Refresh both lists here, and tell the dashboard so the grid it
     * holds is not stale when the user goes back to it.
     */
    async handleAttested() {
        await this.refreshAll();
        this.dispatchEvent(new CustomEvent('cafchange', { bubbles: true, composed: true }));
    }

    /** Refresh button. */
    async handleRefresh() {
        await this.refreshAll();
    }

    /**
     * Re-reads both lists. A wire that has not delivered yet has nothing to
     * refresh and is skipped; a refresh that fails is shown, not thrown.
     */
    async refreshAll() {
        try {
            await Promise.all(
                [this.wiredQueue, this.wiredDecisions].filter(Boolean).map((w) => refreshApex(w))
            );
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
