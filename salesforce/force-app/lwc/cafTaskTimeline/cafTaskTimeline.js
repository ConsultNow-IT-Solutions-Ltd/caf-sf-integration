import { LightningElement, api, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import getTasks from '@salesforce/apex/CafTaskService.getTasks';
import REQUEST_SYS_ID from '@salesforce/schema/CAF_Request__c.ServiceNow_Sys_Id__c';

const CLOSED = new Set(['Closed Complete', 'Cancelled']);
const STATE_CLASS = {
    Open: 'badge',
    'In Progress': 'badge badge--blue',
    'Closed Complete': 'badge badge--green',
    Cancelled: 'badge badge--grey'
};

/**
 * Tasks as timeline entries, in ServiceNow number order: what each is, where it
 * stands and whether it is late. Open tasks past their planned completion are
 * overdue; closed ones never are.
 *
 * @param {object[]} tasks CafTaskService.getTasks rows
 * @param {Date} [now] defaults to the current time
 * @returns {object[]}
 */
export function timelineOf(tasks, now = new Date()) {
    return (tasks || []).map((t) => {
        const closed = CLOSED.has(t.State__c);
        const due = t.Planned_Completion_Date__c ? new Date(t.Planned_Completion_Date__c) : null;
        const overdue = !closed && !!due && !Number.isNaN(due.getTime()) && due < now;
        return {
            id: t.Id,
            number: t.SN_Number__c,
            description: t.Short_Description__c,
            state: t.State__c || 'Unknown',
            stateClass: STATE_CLASS[t.State__c] || 'badge',
            approval: t.Approval__c,
            due: due && !Number.isNaN(due.getTime()) ? due.toISOString().slice(0, 10) : null,
            overdue,
            itemClass: 'entry' + (closed ? ' entry--closed' : overdue ? ' entry--late' : '')
        };
    });
}

/**
 * The task timeline on the CAF_Request__c record page (CAF-230). Reads the
 * request's tasks through the same method as the dashboard drill-in; each
 * entry opens the task's own record page (CAF-229).
 */
export default class CafTaskTimeline extends NavigationMixin(LightningElement) {
    @api recordId;

    tasks;
    error;

    @wire(getRecord, { recordId: '$recordId', fields: [REQUEST_SYS_ID] })
    request;

    /** Undefined until the request loads, which holds the task wire back. */
    get requestSysId() {
        return this.request && this.request.data ? getFieldValue(this.request.data, REQUEST_SYS_ID) : undefined;
    }

    @wire(getTasks, { requestExternalId: '$requestSysId' })
    handleTasks(result) {
        if (result && result.data) {
            this.tasks = timelineOf(result.data);
            this.error = undefined;
        } else if (result && result.error) {
            const e = result.error;
            this.error = (e.body && e.body.message) || e.message || 'Could not load the tasks.';
        }
    }

    get loading() {
        return !this.error && !this.tasks;
    }

    get empty() {
        return !!this.tasks && this.tasks.length === 0;
    }

    get summary() {
        const list = this.tasks || [];
        const closed = list.filter((t) => CLOSED.has(t.state)).length;
        const overdue = list.filter((t) => t.overdue).length;
        return list.length + (list.length === 1 ? ' task' : ' tasks') + ' · ' + closed + ' closed' +
            (overdue ? ' · ' + overdue + ' overdue' : '');
    }

    handleOpen(event) {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: event.currentTarget.dataset.id, actionName: 'view' }
        });
    }
}
