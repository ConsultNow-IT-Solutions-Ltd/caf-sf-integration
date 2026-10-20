import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTaskSummary from '@salesforce/apex/CafReportsController.getTaskSummary';
import { csvCell } from 'c/cafCsv';

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
const ALL = '';

/** Shown where a request carries no business application. */
export const NO_APP = '(No application)';

/**
 * A date as YYYY-MM-DD in the viewer's zone.
 *
 * @param {Date} d
 * @returns {string}
 */
function isoOf(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * A whole-number percentage, 0 when there is nothing to divide by.
 *
 * @param {number} part
 * @param {number} whole
 * @returns {number}
 */
function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) : 0;
}

/**
 * The application a request belongs to, as a non-empty string. getRequests
 * already excludes requests without one; this keeps a row that slips through
 * from crashing a sort or vanishing from a count.
 *
 * @param {object} r a CAF_Request__c row
 * @returns {string}
 */
function appOf(r) {
    const app = r && r.Business_Application__c;
    return app === null || app === undefined || String(app).trim() === '' ? NO_APP : String(app);
}

// Kept as a named export here so existing imports from c/cafReports still work.
export { csvCell };

/**
 * Compliance reporting over the mirror. Every figure is computed from the
 * same getRequests rows the grid pivots, joined to controls the same way, so
 * the report and the grid cannot disagree about a number.
 *
 * "Compliance rate" here is requests in compliance over requests assessed -
 * the request-level view. The grid's Overall column is the application-level
 * view (compliant only when every assessed control is), and the By application
 * table uses that rule so it reads the same as the grid.
 *
 * Figures are computed once, in rebuild(), whenever the data or the filter
 * changes - not in getters, which the template calls on every render.
 */
export default class CafReports extends LightningElement {
    requests;
    controls;
    taskBuckets = [];
    error;
    taskError;

    appFilter = ALL;
    report = { kpis: [], byControl: [], byApplication: [], dueRows: [], overdue: 0, dueSoon: 0 };

    wiredRequests;
    wiredControls;
    wiredTasks;

    /**
     * Receives the request rows every figure is computed from.
     *
     * @param {{data?: object[], error?: object}} result the wire's payload
     */
    @wire(getRequests)
    handleRequests(result) {
        this.wiredRequests = result;
        if (!result) {
            return;
        }
        if (result.data) {
            this.requests = this.objectsOf(result.data);
            this.rebuild();
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    /**
     * Receives the active controls, which give the per-control bars their rows.
     *
     * @param {{data?: object[], error?: object}} result the wire's payload
     */
    @wire(getControls)
    handleControls(result) {
        this.wiredControls = result;
        if (!result) {
            return;
        }
        if (result.data) {
            this.controls = this.objectsOf(result.data);
            this.rebuild();
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    /**
     * Task counts are a side panel. If they fail the rest of the report still
     * stands, so the error is shown in that panel rather than over the page.
     *
     * @param {{data?: object[], error?: object}} result the wire's payload
     */
    @wire(getTaskSummary)
    handleTasks(result) {
        this.wiredTasks = result;
        if (!result) {
            return;
        }
        if (result.data) {
            this.taskBuckets = this.objectsOf(result.data);
            this.taskError = undefined;
        } else if (result.error) {
            this.taskBuckets = [];
            this.taskError = this.messageOf(result.error);
        }
    }

    /**
     * The array a wire delivered, with anything that is not an object removed.
     *
     * @param {*} data the wire's data
     * @returns {object[]}
     */
    objectsOf(data) {
        return (Array.isArray(data) ? data : []).filter((x) => x && typeof x === 'object');
    }

    /** @returns {boolean} true until both requests and controls have arrived */
    get loading() {
        return !this.error && (!this.requests || !this.controls);
    }

    // -------------------------------------------------------------- filter

    /**
     * The application dropdown: every application in the data, sorted, with
     * "All applications" first.
     *
     * @returns {{value: string, label: string, selected: boolean}[]}
     */
    get appOptions() {
        const apps = [...new Set((this.requests || []).map(appOf))].sort((a, b) => a.localeCompare(b));
        return [{ value: ALL, label: 'All applications', selected: this.appFilter === ALL }].concat(
            apps.map((a) => ({ value: a, label: a, selected: this.appFilter === a }))
        );
    }

    /** @returns {boolean} whether one application is selected */
    get isFiltered() {
        return this.appFilter !== ALL;
    }

    /**
     * Application dropdown changed. An empty or missing value means all.
     *
     * @param {Event} event change event from the select
     */
    handleAppFilter(event) {
        this.appFilter = (event && event.target && event.target.value) || ALL;
        this.rebuild();
    }

    /**
     * The rows every figure is computed from, after the filter.
     *
     * @returns {object[]}
     */
    get rows() {
        const all = this.requests || [];
        return this.appFilter === ALL ? all : all.filter((r) => appOf(r) === this.appFilter);
    }

    // ------------------------------------------------------------- compute

    /**
     * Recomputes every figure. Waits for both requests and controls. A filter
     * left on an application that a refresh no longer returns is cleared,
     * otherwise the page would show an empty report with no visible reason.
     */
    rebuild() {
        if (!this.requests || !this.controls) {
            return;
        }
        if (this.appFilter !== ALL && !this.requests.some((r) => appOf(r) === this.appFilter)) {
            this.appFilter = ALL;
        }
        const rows = this.rows;
        const dueRows = this.computeDue(rows);
        const overdue = dueRows.filter((r) => r.late).length;
        this.report = {
            kpis: this.computeKpis(rows),
            byControl: this.computeByControl(rows),
            byApplication: this.computeByApplication(rows),
            dueRows,
            overdue,
            dueSoon: dueRows.length - overdue
        };
    }

    /**
     * The headline tiles.
     *
     * @param {object[]} rows the filtered requests
     * @returns {object[]} one entry per tile
     */
    computeKpis(rows) {
        const count = (k) => rows.filter((r) => r.CAF_Status__c === k).length;
        const compliant = count('in_compliance');
        const apps = new Set(rows.map(appOf)).size;
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

    /**
     * One stacked bar per active control. A request joins its control on
     * sys_id and falls back to the name, as the grid does; anything that joins
     * to no active control is gathered into one extra row rather than dropped,
     * so the bars always add up to the request total. A control with no name
     * is listed by its sys_id.
     *
     * @param {object[]} rows the filtered requests
     * @returns {object[]} one bar per control
     */
    computeByControl(rows) {
        const controls = this.controls || [];
        const groups = controls.map((c, i) => ({
            key: c.ServiceNow_Sys_Id__c || c.Name || 'control-' + i,
            name: c.Name || c.ServiceNow_Sys_Id__c || '(Unnamed control)',
            rows: []
        }));
        const bySysId = new Map();
        const byName = new Map();
        groups.forEach((g, i) => {
            if (controls[i].ServiceNow_Sys_Id__c) {
                bySysId.set(controls[i].ServiceNow_Sys_Id__c, g);
            }
            if (controls[i].Name) {
                byName.set(controls[i].Name, g);
            }
        });

        const orphan = { key: '__orphan', name: 'Not in the active catalogue', rows: [] };
        rows.forEach((r) => {
            const g =
                (r.CAF_Control_Sys_Id__c && bySysId.get(r.CAF_Control_Sys_Id__c)) ||
                (r.CAF_Control__c && byName.get(r.CAF_Control__c)) ||
                orphan;
            g.rows.push(r);
        });
        if (orphan.rows.length) {
            groups.push(orphan);
        }

        return groups.map((g) => this.barFor(g.key, g.name, g.rows));
    }

    /**
     * One control's bar: a segment per status present, plus a grey one for
     * requests with no recognised status.
     *
     * @param {string}   key  unique key for the row
     * @param {string}   name the control's label
     * @param {object[]} rows the requests on that control
     * @returns {object}
     */
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

    /**
     * Per-application compliance, least compliant first: the list is for
     * deciding where to look next.
     *
     * @param {object[]} rows the filtered requests
     * @returns {object[]} one row per application
     */
    computeByApplication(rows) {
        const apps = new Map();
        rows.forEach((r) => {
            const app = appOf(r);
            if (!apps.has(app)) {
                apps.set(app, []);
            }
            apps.get(app).push(r);
        });

        const out = [];
        apps.forEach((appRows, app) => {
            const compliant = appRows.filter((r) => r.CAF_Status__c === 'in_compliance').length;
            const failing = appRows.filter((r) => r.CAF_Status__c === 'out_of_compliance').length;
            const rate = pct(compliant, appRows.length);
            const allGreen = appRows.length > 0 && compliant === appRows.length;
            out.push({
                key: app,
                app,
                assessed: appRows.length,
                compliant,
                failing,
                rate,
                rateLabel: rate + '%',
                meterStyle: 'width:' + rate + '%',
                overallLabel: allGreen ? 'Compliant' : compliant + ' of ' + appRows.length,
                overallClass: allGreen ? 'pill pill--green' : 'pill pill--amber'
            });
        });
        out.sort((a, b) => a.rate - b.rate || b.failing - a.failing || a.app.localeCompare(b.app));
        return out;
    }

    /**
     * Overdue: planned completion is in the past and the request is not in a
     * settled status. Due soon: the same, within the next 30 days. A date that
     * will not parse is left out - it cannot be placed on either list.
     *
     * @param {object[]} rows the filtered requests
     * @returns {object[]} soonest first
     */
    computeDue(rows) {
        const today = isoOf(new Date());
        const horizon = isoOf(new Date(Date.now() + UPCOMING_DAYS * DAY_MS));
        return rows
            .filter((r) => typeof r.Planned_Completion_Date__c === 'string' && r.Planned_Completion_Date__c)
            .filter((r) => !SETTLED.has(r.CAF_Status__c))
            .filter((r) => !Number.isNaN(Date.parse(r.Planned_Completion_Date__c)))
            .filter((r) => r.Planned_Completion_Date__c <= horizon)
            .map((r, i) => {
                const days = Math.round((Date.parse(r.Planned_Completion_Date__c) - Date.parse(today)) / DAY_MS);
                const late = days < 0;
                return {
                    key: r.ServiceNow_Sys_Id__c || r.Id || r.SN_Number__c || 'due-' + i,
                    number: r.SN_Number__c || '',
                    app: appOf(r),
                    control: r.CAF_Control__c || '',
                    status: STATUS_LABEL[r.CAF_Status__c] || r.CAF_Status__c || 'No status',
                    date: r.Planned_Completion_Date__c,
                    late,
                    when: late ? -days + 'd overdue' : days === 0 ? 'today' : 'in ' + days + 'd',
                    whenClass: late ? 'due due--late' : 'due due--soon'
                };
            })
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // ------------------------------------------------------------- getters

    /** @returns {object[]} headline tiles */
    get kpis() {
        return this.report.kpis;
    }

    /** @returns {object[]} the status key shown above the bars */
    get legend() {
        return STATUSES.map((s) => ({ key: s.key, label: s.label, cls: s.seg + ' seg--key' }));
    }

    /** @returns {object[]} per-control bars */
    get byControl() {
        return this.report.byControl;
    }

    /** @returns {object[]} per-application rows */
    get byApplication() {
        return this.report.byApplication;
    }

    /** @returns {object[]} overdue and due-soon requests */
    get dueRows() {
        return this.report.dueRows;
    }

    /** @returns {number} */
    get overdueCount() {
        return this.report.overdue;
    }

    /** @returns {number} */
    get dueSoonCount() {
        return this.report.dueSoon;
    }

    /** @returns {boolean} */
    get hasDueRows() {
        return this.report.dueRows.length > 0;
    }

    /**
     * Tasks by state, and attestation totals. Counted across every request,
     * filter or not: the summary is an aggregate in Apex and carries no
     * application to filter on. A bucket with no usable total counts as 0.
     *
     * @returns {{states: object[], approved: number, rejected: number}}
     */
    get taskStates() {
        const totals = new Map();
        let approved = 0;
        let rejected = 0;
        this.taskBuckets.forEach((b) => {
            const n = Number(b.total);
            const total = Number.isFinite(n) && n > 0 ? n : 0;
            const state = b.state || 'No state';
            totals.set(state, (totals.get(state) || 0) + total);
            if (b.approval === 'approved') {
                approved += total;
            } else if (b.approval === 'rejected') {
                rejected += total;
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

    /** @returns {boolean} whether any task counts arrived */
    get hasTasks() {
        return this.taskBuckets.length > 0;
    }

    // -------------------------------------------------------------- actions

    /**
     * Re-reads all three wires. One that has not delivered yet is skipped; a
     * refresh that fails is shown, not thrown.
     */
    async handleRefresh() {
        try {
            await Promise.all(
                [this.wiredRequests, this.wiredControls, this.wiredTasks].filter(Boolean).map((w) => refreshApex(w))
            );
        } catch (err) {
            this.error = this.messageOf(err);
        }
    }

    /**
     * The request rows behind the figures on screen - filtered when the page
     * is - as CSV, so a number here can be checked or taken elsewhere. Does
     * nothing before the data has loaded.
     */
    handleExport() {
        if (this.loading || !this.requests) {
            return;
        }
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
        const slug = this.isFiltered ? this.appFilter.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() : '';
        const suffix = slug ? '-' + slug : '';
        const host = this.template.querySelector('.export');
        if (!host) {
            return;
        }
        const link = document.createElement('a');
        link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
        link.download = 'caf-compliance' + suffix + '-' + isoOf(new Date()) + '.csv';
        link.style.display = 'none';
        host.appendChild(link);
        link.click();
        link.remove();
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
