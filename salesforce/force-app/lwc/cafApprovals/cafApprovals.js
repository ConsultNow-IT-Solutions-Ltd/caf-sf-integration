import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getQueue from '@salesforce/apex/CafApprovalsController.getQueue';
import getRecentDecisions from '@salesforce/apex/CafApprovalsController.getRecentDecisions';

const ALL = '';

/** CafApprovalsController.getQueue's LIMIT. A full page means there may be more. */
export const QUEUE_LIMIT = 500;
const DAY_MS = 86400000;

/** Today as YYYY-MM-DD in the viewer's zone, the format Date fields arrive in. */
function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function daysBetween(fromIso, toIso) {
    return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);
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

    @wire(getQueue)
    handleQueue(result) {
        this.wiredQueue = result;
        if (result.data) {
            const today = todayIso();
            this.queue = result.data.map((t) => this.decorate(t, today));
            this.error = undefined;
            this.loading = false;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
            this.loading = false;
        }
    }

    @wire(getRecentDecisions)
    handleDecisions(result) {
        this.wiredDecisions = result;
        if (result.data) {
            this.decisions = result.data.map((t) => ({
                ...this.flatten(t),
                decisionLabel: t.Approval__c === 'approved' ? 'Approved' : 'Rejected',
                decisionClass: t.Approval__c === 'approved' ? 'pill pill--green' : 'pill pill--red',
                updated: t.LastModifiedDate ? t.LastModifiedDate.slice(0, 10) : ''
            }));
            this.decisionsError = undefined;
        } else if (result.error) {
            this.decisions = [];
            this.decisionsError = this.messageOf(result.error);
        }
    }

    flatten(t) {
        const r = t.CAF_Request__r || {};
        return {
            ...t,
            app: r.Business_Application__c || '',
            control: r.CAF_Control__c || '',
            requestNumber: r.SN_Number__c || ''
        };
    }

    /**
     * Due is the task's planned completion date. A task with none is not
     * overdue - there is nothing to be late against - and sorts last, which is
     * how the Apex orders it.
     */
    decorate(t, today) {
        const row = this.flatten(t);
        const due = t.Planned_Completion_Date__c;
        let dueLabel = 'No date';
        let dueClass = 'due due--none';
        let overdue = false;

        if (due) {
            const days = daysBetween(today, due);
            overdue = days < 0;
            if (overdue) {
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
            overdue,
            dueLabel,
            dueClass,
            unlinked: !t.ServiceNow_Sys_Id__c,
            haystack: [t.SN_Number__c, t.Short_Description__c, row.app, row.control, row.requestNumber]
                .join(' ')
                .toLowerCase(),
            rowClass: 'tasks__row'
        };
    }

    get visibleQueue() {
        const needle = this.search.trim().toLowerCase();
        const activeId = this.activeTask && this.activeTask.id;
        return this.queue
            .filter((t) => this.appFilter === ALL || t.app === this.appFilter)
            .filter((t) => !needle || t.haystack.includes(needle))
            .filter((t) => !this.overdueOnly || t.overdue)
            .map((t) => ({
                ...t,
                rowClass: t.Id === activeId ? 'tasks__row tasks__row--active' : 'tasks__row'
            }));
    }

    get appOptions() {
        const apps = [...new Set(this.queue.map((t) => t.app).filter(Boolean))].sort((a, b) =>
            a.localeCompare(b)
        );
        return [{ value: ALL, label: 'All applications', selected: this.appFilter === ALL }].concat(
            apps.map((a) => ({ value: a, label: a, selected: this.appFilter === a }))
        );
    }

    get awaitingCount() {
        return this.queue.length;
    }

    get overdueCount() {
        return this.queue.filter((t) => t.overdue).length;
    }

    get approvedCount() {
        return this.decisions.filter((d) => d.Approval__c === 'approved').length;
    }

    get rejectedCount() {
        return this.decisions.filter((d) => d.Approval__c === 'rejected').length;
    }

    get hasQueue() {
        return this.visibleQueue.length > 0;
    }

    get isFiltered() {
        return this.appFilter !== ALL || this.search.trim() !== '' || this.overdueOnly;
    }

    /**
     * The Apex returns at most QUEUE_LIMIT rows, soonest due first. Saying so
     * matters: a silently truncated queue reads as "this is everything".
     */
    get queueCapped() {
        return this.queue.length >= QUEUE_LIMIT;
    }

    get queueLimit() {
        return QUEUE_LIMIT;
    }

    get hasDecisions() {
        return this.decisions.length > 0;
    }

    /** The approver judges the evidence; they do not add to it. */
    get evidenceReadOnly() {
        return true;
    }

    get hasActiveTask() {
        return !!this.activeTask;
    }

    handleAppFilter(event) {
        this.appFilter = event.target.value;
    }

    handleOverdueOnly(event) {
        this.overdueOnly = event.target.checked;
    }

    handleSearch(event) {
        this.search = event.target.value || '';
    }

    handleReview(event) {
        const { id, sysid, number, state, approval } = event.currentTarget.dataset;
        this.evidenceCount = undefined;
        this.activeTask = { id, sysId: sysid, number, state, approval };
    }

    handleCloseReview() {
        this.activeTask = undefined;
        this.evidenceCount = undefined;
    }

    handleEvidenceCount(event) {
        if (this.activeTask && event.detail.sysId === this.activeTask.sysId) {
            this.evidenceCount = event.detail.count;
        }
    }

    /**
     * The decision moved the task and, through ServiceNow's rules, possibly the
     * request. Refresh both lists here, and tell the dashboard so the grid it
     * holds is not stale when the user goes back to it.
     */
    async handleAttested() {
        await Promise.all([refreshApex(this.wiredQueue), refreshApex(this.wiredDecisions)]);
        this.dispatchEvent(new CustomEvent('cafchange', { bubbles: true, composed: true }));
    }

    async handleRefresh() {
        await Promise.all([refreshApex(this.wiredQueue), refreshApex(this.wiredDecisions)]);
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
}
