import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue, notifyRecordUpdateAvailable } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import applyChange from '@salesforce/apex/CafTaskService.applyChange';
import canWorkTasks from '@salesforce/customPermission/CAF_Work_Tasks';
import NAME from '@salesforce/schema/CAF_Task__c.Name';
import STATE from '@salesforce/schema/CAF_Task__c.State__c';
import APPROVAL from '@salesforce/schema/CAF_Task__c.Approval__c';
import DUE from '@salesforce/schema/CAF_Task__c.Planned_Completion_Date__c';
import SYS_ID from '@salesforce/schema/CAF_Task__c.ServiceNow_Sys_Id__c';
import SHORT_DESCRIPTION from '@salesforce/schema/CAF_Task__c.Short_Description__c';

const FIELDS = [NAME, STATE, APPROVAL, DUE, SYS_ID, SHORT_DESCRIPTION];

/** The path a task walks in ServiceNow. Cancelled replaces the last step. */
const PATH = ['Open', 'In Progress', 'Closed Complete'];
const CLOSED = new Set(['Closed Complete', 'Cancelled']);
const DAY_MS = 86400000;

/**
 * Days from today to a due datetime, by calendar day in the viewer's zone.
 *
 * @param {string} due ISO datetime
 * @param {Date} [now] defaults to the current time
 * @returns {number|null} negative when past; null when there is no date
 */
export function daysUntil(due, now = new Date()) {
    if (!due || Number.isNaN(Date.parse(due))) {
        return null;
    }
    const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return Math.round((start(new Date(due)) - start(now)) / DAY_MS);
}

/**
 * Header for the CAF_Task__c record page (CAF-229): where the task is on its
 * path, when it is due, and Start for an open task.
 *
 * Read-only by design. Start goes to ServiceNow like every CAF action; the
 * inbound API pushes the new state back, and the record is reloaded from
 * that. Criteria met and the decision live in cafAttestation beside it.
 * Control instructions join once ServiceNow pushes them (CAF-233).
 */
export default class CafTaskHeader extends LightningElement {
    @api recordId;

    busy = false;

    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    record;

    get loaded() {
        return !!(this.record && this.record.data);
    }

    get error() {
        const e = this.record && this.record.error;
        return e ? (e.body && e.body.message) || e.message || 'Could not load this task.' : null;
    }

    get name() {
        return getFieldValue(this.record.data, NAME);
    }

    get description() {
        return getFieldValue(this.record.data, SHORT_DESCRIPTION);
    }

    get state() {
        return getFieldValue(this.record.data, STATE);
    }

    get approval() {
        return getFieldValue(this.record.data, APPROVAL);
    }

    /** @returns {object[]} path steps with their classes */
    get steps() {
        const state = this.state;
        const steps = state === 'Cancelled' ? ['Open', 'In Progress', 'Cancelled'] : PATH;
        const at = steps.indexOf(state);
        return steps.map((label, i) => {
            let cls = 'step';
            if (at === -1) {
                cls += ' step--todo';
            } else if (i < at) {
                cls += ' step--done';
            } else if (i === at) {
                cls += label === 'Cancelled' ? ' step--current step--cancelled' : ' step--current';
            } else {
                cls += ' step--todo';
            }
            return { label, cls, current: i === at ? 'step' : undefined };
        });
    }

    /** @returns {{text: string, cls: string}|null} the countdown, or null when nothing is owed */
    get due() {
        if (CLOSED.has(this.state)) {
            return null;
        }
        const days = daysUntil(getFieldValue(this.record.data, DUE));
        if (days === null) {
            return { text: 'No planned completion date', cls: 'due' };
        }
        if (days < 0) {
            return { text: -days + (days === -1 ? ' day' : ' days') + ' overdue', cls: 'due due--late' };
        }
        if (days === 0) {
            return { text: 'Due today', cls: 'due due--soon' };
        }
        return { text: 'Due in ' + days + (days === 1 ? ' day' : ' days'), cls: days <= 7 ? 'due due--soon' : 'due' };
    }

    get canStart() {
        return (
            canWorkTasks === true &&
            this.state === 'Open' &&
            !!getFieldValue(this.record.data, SYS_ID)
        );
    }

    async handleStart() {
        const sysId = getFieldValue(this.record.data, SYS_ID);
        if (this.busy || !sysId) {
            return;
        }
        this.busy = true;
        try {
            await applyChange({ sysId, field: 'state', value: '2' });
            this.toast('Sent to ServiceNow', 'The task is now In Progress.', 'success');
            await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
        } catch (err) {
            const message = (err && err.body && err.body.message) || (err && err.message) || String(err);
            this.toast('ServiceNow rejected the change', message, 'error');
        } finally {
            this.busy = false;
        }
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
