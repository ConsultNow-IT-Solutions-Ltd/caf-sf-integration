import { LightningElement, wire } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';
import { refreshApex } from '@salesforce/apex';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTaskFigures from '@salesforce/apex/CafHomeController.getTaskFigures';

/**
 * Per-application compliance from the grid's rows, by the grid's rule: an
 * application is compliant when every control it has a request for is
 * in_compliance, and controls with no request are left out (they show N/A,
 * not red). Only requests whose control is an active catalogue column count,
 * as only those have a cell. Kept in step with cafDashboard.build by hand -
 * change both or neither.
 *
 * @param {object[]} requests CafDashboardController.getRequests rows
 * @param {object[]} controls CafDashboardController.getControls rows
 * @returns {{applications: number, compliant: number, outOfCompliance: number}}
 */
export function applicationFigures(requests, controls) {
    const columns = new Set();
    (controls || []).forEach((c) => {
        if (c.ServiceNow_Sys_Id__c) {
            columns.add(c.ServiceNow_Sys_Id__c);
        }
        columns.add('name:' + c.Name);
    });

    const apps = new Map();
    (requests || []).forEach((r) => {
        const key = r.CAF_Control_Sys_Id__c && columns.has(r.CAF_Control_Sys_Id__c)
            ? r.CAF_Control_Sys_Id__c
            : 'name:' + r.CAF_Control__c;
        if (!columns.has(key)) {
            return;
        }
        if (!apps.has(r.Business_Application__c)) {
            apps.set(r.Business_Application__c, new Map());
        }
        // Last row wins per cell, as in the grid.
        apps.get(r.Business_Application__c).set(key, r.CAF_Status__c);
    });

    let compliant = 0;
    let outOfCompliance = 0;
    apps.forEach((cells) => {
        const statuses = Array.from(cells.values());
        if (statuses.length && statuses.every((s) => s === 'in_compliance')) {
            compliant += 1;
        }
        if (statuses.includes('out_of_compliance')) {
            outOfCompliance += 1;
        }
    });
    return { applications: apps.size, compliant, outOfCompliance };
}

/**
 * CAF Home (CAF-224): five headline figures, each a way into the screen that
 * explains it. Application figures come from the grid's own rows; task
 * figures from CafHomeController.
 */
export default class CafHome extends NavigationMixin(LightningElement) {
    requests;
    controls;
    tasks;
    error;
    taskError;

    wiredRequests;
    wiredControls;
    wiredTasks;

    @wire(getRequests)
    handleRequests(result) {
        this.wiredRequests = result;
        if (result && result.data) {
            this.requests = result.data;
        } else if (result && result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    @wire(getControls)
    handleControls(result) {
        this.wiredControls = result;
        if (result && result.data) {
            this.controls = result.data;
        } else if (result && result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    /**
     * Task tiles are separate: if they fail, the application tiles still
     * stand, and the task tiles say why they are blank.
     */
    @wire(getTaskFigures)
    handleTasks(result) {
        this.wiredTasks = result;
        if (result && result.data) {
            this.tasks = result.data;
            this.taskError = undefined;
        } else if (result && result.error) {
            this.taskError = this.messageOf(result.error);
        }
    }

    get loading() {
        return !this.error && (!this.requests || !this.controls);
    }

    /** @returns {object[]} the tiles in display order */
    get tiles() {
        const apps = applicationFigures(this.requests, this.controls);
        const t = this.tasks || {};
        const taskValue = (n) => (this.taskError ? '-' : this.tasks ? String(n || 0) : '…');
        return [
            {
                key: 'compliant',
                value: apps.compliant + ' of ' + apps.applications,
                label: 'Compliant applications',
                cls: 'tile__value tile__value--green',
                hint: 'Open the compliance grid'
            },
            {
                key: 'out',
                value: String(apps.outOfCompliance),
                label: 'Applications out of compliance',
                cls: 'tile__value' + (apps.outOfCompliance ? ' tile__value--red' : ''),
                hint: 'Open the compliance grid'
            },
            {
                key: 'open',
                value: taskValue(t.open),
                label: 'Open tasks',
                cls: 'tile__value',
                hint: 'All tasks'
            },
            {
                key: 'overdue',
                value: taskValue(t.overdue),
                label: 'Overdue tasks',
                cls: 'tile__value' + (t.overdue ? ' tile__value--red' : ''),
                hint: 'Tasks past their planned completion'
            },
            {
                key: 'awaiting',
                value: taskValue(t.awaitingAttestation),
                label: 'Awaiting attestation',
                cls: 'tile__value' + (t.awaitingAttestation ? ' tile__value--amber' : ''),
                hint: 'Open the Approvals screen'
            }
        ];
    }

    handleTile(event) {
        const key = event.currentTarget.dataset.key;
        const dashboard = (state) => ({
            type: 'standard__navItemPage',
            attributes: { apiName: 'CAF_Dashboard' },
            state: state || {}
        });
        const taskList = (filterName) => ({
            type: 'standard__objectPage',
            attributes: { objectApiName: 'CAF_Task__c', actionName: 'list' },
            state: { filterName }
        });
        const targets = {
            compliant: dashboard(),
            out: dashboard(),
            open: taskList('All'),
            overdue: taskList('Overdue'),
            awaiting: dashboard({ c__view: 'approvals' })
        };
        if (targets[key]) {
            this[NavigationMixin.Navigate](targets[key]);
        }
    }

    handleRefresh() {
        this.error = undefined;
        this.taskError = undefined;
        return Promise.all(
            [this.wiredRequests, this.wiredControls, this.wiredTasks]
                .filter(Boolean)
                .map((w) => refreshApex(w))
        );
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
