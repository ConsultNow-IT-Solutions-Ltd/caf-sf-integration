import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTaskSummary from '@salesforce/apex/CafReportsController.getTaskSummary';

/** Same order and colours as the grid's legend. */
const STATUSES = [
    { key: 'in_compliance', label: 'In compliance', seg: 'seg seg--green' },
    { key: 'approaching_due', label: 'Approaching due', seg: 'seg seg--amber' },
    { key: 'out_of_compliance', label: 'Out of compliance', seg: 'seg seg--red' },
    { key: 'archer_exception_approved', label: 'Exception approved', seg: 'seg seg--blue' }
];
const STATUS_LABEL = STATUSES.reduce((m, s) => ({ ...m, [s.key]: s.label }), {});

/** Settled statuses: nothing is owed on these, so they are never overdue. */
const SETTLED = new Set(['in_compliance', 'archer_exception_approved']);

const TASK_STATES = ['Open', 'In Progress', 'Closed Complete', 'Cancelled'];
const UPCOMING_DAYS = 30;
const DAY_MS = 86400000;

function isoOf(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
}

function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/**
 * Compliance reporting over the mirror. Every figure is computed from the
 * same getRequests rows the grid pivots, joined to controls the same way, so
 * the report and the grid cannot disagree about a number.
 *
 * "Compliance rate" here is requests in compliance over requests assessed -
 * the request-level view. The grid's Overall column is the application-level
 * view (compliant only when every assessed control is), and the By application
 * table below uses that rule so it reads the same as the grid.
 */
export default class CafReports extends LightningElement {
    requests;
    controls;
    taskBuckets = [];
    error;

    wiredRequests;
    wiredControls;
    wiredTasks;

    @wire(getRequests)
    handleRequests(result) {
        this.wiredRequests = result;
        if (result.data) {
            this.requests = result.data;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    @wire(getControls)
    handleControls(result) {
        this.wiredControls = result;
        if (result.data) {
            this.controls = result.data;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    @wire(getTaskSummary)
    handleTasks(result) {
        this.wiredTasks = result;
        if (result.data) {
            this.taskBuckets = result.data;
        }
    }

    get loading() {
        return !this.error && (!this.requests || !this.controls);
    }

    get ready() {
        return !this.loading && !this.error;
    }

    get rows() {
        return this.requests || [];
    }

    // ------------------------------------------------------------ headline

    get kpis() {
        const rows = this.rows;
        const count = (k) => rows.filter((r) => r.CAF_Status__c === k).length;
        const compliant = count('in_compliance');
        const apps = new Set(rows.map((r) => r.Business_Application__c)).size;
        return [
            { key: 'requests', value: rows.length, label: 'Requests assessed', cls: 'tile__value' },
            { key: 'apps', value: apps, label: 'Business applications', cls: 'tile__value' },
            {
                key: 'rate',
                value: pct(compliant, rows.length) + '%',
                label: 'Requests in compliance',
                cls: 'tile__value tile__value--green'
            },
            { key: 'out', value: count('out_of_compliance'), label: 'Out of compliance', cls: 'tile__value tile__value--red' },
            { key: 'due', value: count('approaching_due'), label: 'Approaching due', cls: 'tile__value tile__value--amber' },
            { key: 'exc', value: count('archer_exception_approved'), label: 'Exceptions approved', cls: 'tile__value' }
        ];
    }

    get legend() {
        return STATUSES.map((s) => ({ key: s.key, label: s.label, cls: s.seg + ' seg--key' }));
    }

    // ---------------------------------------------------------- by control

    /**
     * One stacked bar per active control. A request joins its control on
     * sys_id and falls back to the name, as the grid does; anything that joins
     * to no active control is gathered into one extra row rather than dropped,
     * so the bars always add up to the request total.
     */
    get byControl() {
        const controls = this.controls || [];
        const groups = controls.map((c) => ({ key: c.ServiceNow_Sys_Id__c || c.Name, name: c.Name, rows: [] }));
        const bySysId = new Map();
        const byName = new Map();
        groups.forEach((g, i) => {
            if (controls[i].ServiceNow_Sys_Id__c) {
                bySysId.set(controls[i].ServiceNow_Sys_Id__c, g);
            }
            byName.set(controls[i].Name, g);
        });

        const orphan = { key: '__orphan', name: 'Not in the active catalogue', rows: [] };
        this.rows.forEach((r) => {
            const g = bySysId.get(r.CAF_Control_Sys_Id__c) || byName.get(r.CAF_Control__c) || orphan;
            g.rows.push(r);
        });
        if (orphan.rows.length) {
            groups.push(orphan);
        }

        return groups.map((g) => this.barFor(g.key, g.name, g.rows));
    }

    barFor(key, name, rows) {
        const total = rows.length;
        const counts = STATUSES.map((s) => rows.filter((r) => r.CAF_Status__c === s.key).length);
        const other = total - counts.reduce((a, b) => a + b, 0);
        const segments = STATUSES.map((s, i) => ({
            key: key + s.key,
            n: counts[i],
            cls: s.seg,
            style: 'flex-grow:' + counts[i],
            title: name + ': ' + counts[i] + ' ' + s.label.toLowerCase()
        })).filter((s) => s.n > 0);
        if (other > 0) {
            segments.push({
                key: key + 'other',
                n: other,
                cls: 'seg seg--none',
                style: 'flex-grow:' + other,
                title: name + ': ' + other + ' with no status'
            });
        }
        return {
            key,
            name,
            total,
            compliant: counts[0],
            rate: pct(counts[0], total) + '%',
            out: counts[2],
            segments,
            empty: total === 0
        };
    }

    // ------------------------------------------------------ by application

    /** Least compliant first: the list is for deciding where to look next. */
    get byApplication() {
        const apps = new Map();
        this.rows.forEach((r) => {
            if (!apps.has(r.Business_Application__c)) {
                apps.set(r.Business_Application__c, []);
            }
            apps.get(r.Business_Application__c).push(r);
        });

        const out = [];
        apps.forEach((rows, app) => {
            const compliant = rows.filter((r) => r.CAF_Status__c === 'in_compliance').length;
            const failing = rows.filter((r) => r.CAF_Status__c === 'out_of_compliance').length;
            const rate = pct(compliant, rows.length);
            const allGreen = compliant === rows.length;
            out.push({
                key: app,
                app,
                assessed: rows.length,
                compliant,
                failing,
                rate,
                rateLabel: rate + '%',
                meterStyle: 'width:' + rate + '%',
                overallLabel: allGreen ? 'Compliant' : compliant + ' of ' + rows.length,
                overallClass: allGreen ? 'pill pill--green' : 'pill pill--amber'
            });
        });
        out.sort((a, b) => a.rate - b.rate || b.failing - a.failing || a.app.localeCompare(b.app));
        return out;
    }

    // ------------------------------------------------------------ due dates

    /**
     * Overdue: planned completion is in the past and the request is not in a
     * settled status. Due soon: the same, within the next 30 days.
     */
    get dueRows() {
        const today = isoOf(new Date());
        const horizon = isoOf(new Date(Date.now() + UPCOMING_DAYS * DAY_MS));
        return this.rows
            .filter((r) => r.Planned_Completion_Date__c && !SETTLED.has(r.CAF_Status__c))
            .filter((r) => r.Planned_Completion_Date__c <= horizon)
            .map((r) => {
                const days = Math.round((Date.parse(r.Planned_Completion_Date__c) - Date.parse(today)) / DAY_MS);
                const late = days < 0;
                return {
                    key: r.ServiceNow_Sys_Id__c || r.Id,
                    number: r.SN_Number__c,
                    app: r.Business_Application__c,
                    control: r.CAF_Control__c,
                    status: STATUS_LABEL[r.CAF_Status__c] || r.CAF_Status__c || 'No status',
                    date: r.Planned_Completion_Date__c,
                    late,
                    when: late ? -days + 'd overdue' : days === 0 ? 'today' : 'in ' + days + 'd',
                    whenClass: late ? 'due due--late' : 'due due--soon'
                };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    get overdueCount() {
        return this.dueRows.filter((r) => r.late).length;
    }

    get dueSoonCount() {
        return this.dueRows.length - this.overdueCount;
    }

    get hasDueRows() {
        return this.dueRows.length > 0;
    }

    // --------------------------------------------------------------- tasks

    get taskStates() {
        const totals = new Map();
        let approved = 0;
        let rejected = 0;
        this.taskBuckets.forEach((b) => {
            const state = b.state || 'No state';
            totals.set(state, (totals.get(state) || 0) + b.total);
            if (b.approval === 'approved') {
                approved += b.total;
            } else if (b.approval === 'rejected') {
                rejected += b.total;
            }
        });

        const order = TASK_STATES.concat([...totals.keys()].filter((s) => !TASK_STATES.includes(s)));
        const max = Math.max(1, ...totals.values());
        const states = order
            .filter((s) => totals.has(s))
            .map((s) => ({
                key: s,
                label: s,
                n: totals.get(s),
                barStyle: 'width:' + Math.max(2, Math.round((totals.get(s) / max) * 100)) + '%'
            }));
        return { states, approved, rejected };
    }

    get hasTasks() {
        return this.taskStates.states.length > 0;
    }

    // -------------------------------------------------------------- actions

    async handleRefresh() {
        await Promise.all(
            [this.wiredRequests, this.wiredControls, this.wiredTasks].filter(Boolean).map((w) => refreshApex(w))
        );
    }

    /**
     * The request rows behind every figure on the page, as CSV, so a number
     * on this screen can be checked or taken elsewhere.
     */
    handleExport() {
        const header = ['Request', 'Business application', 'Control', 'CAF status', 'State', 'Planned completion', 'Description'];
        const lines = [header.map(csvCell).join(',')].concat(
            this.rows.map((r) =>
                [
                    r.SN_Number__c,
                    r.Business_Application__c,
                    r.CAF_Control__c,
                    STATUS_LABEL[r.CAF_Status__c] || r.CAF_Status__c,
                    r.State__c,
                    r.Planned_Completion_Date__c,
                    r.Short_Description__c
                ]
                    .map(csvCell)
                    .join(',')
            )
        );
        const link = document.createElement('a');
        link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
        link.download = 'caf-compliance-' + isoOf(new Date()) + '.csv';
        link.style.display = 'none';
        this.template.querySelector('.export').appendChild(link);
        link.click();
        link.remove();
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
