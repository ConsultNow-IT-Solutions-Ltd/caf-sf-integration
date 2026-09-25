import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { CurrentPageReference, NavigationMixin } from 'lightning/navigation';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTasks from '@salesforce/apex/CafTaskService.getTasks';
import applyChange from '@salesforce/apex/CafTaskService.applyChange';

const STATUS = {
    in_compliance:             { label: 'In compliance',      dot: 'dot dot--green' },
    approaching_due:           { label: 'Approaching due',    dot: 'dot dot--amber' },
    out_of_compliance:         { label: 'Out of compliance',  dot: 'dot dot--red' },
    archer_exception_approved: { label: 'Exception approved', dot: 'dot dot--blue' }
};

/** Statuses with nothing owed, so a past planned date on them is not overdue. */
const SETTLED = new Set(['in_compliance', 'archer_exception_approved']);

/** Grid sort orders. Name is the default and the order the ServiceNow portal uses. */
const SORTS = [
    { value: 'name', label: 'Application name' },
    { value: 'least', label: 'Least compliant first' }
];

/** Where this viewer's grid preferences are kept between visits. */
const PREFS_KEY = 'caf.dashboard.grid';

/**
 * Today as YYYY-MM-DD in the viewer's zone, the format Date fields arrive in.
 *
 * @returns {string}
 */
function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

/**
 * The screens under the CAF Dashboard tab. Compliance is the grid this
 * component has always been; the others are their own components, mounted
 * only while selected so their wires do not run behind a screen nobody is
 * looking at.
 */
const VIEWS = [
    { key: 'compliance', label: 'Compliance' },
    { key: 'approvals', label: 'Approvals' },
    { key: 'reports', label: 'Reports' },
    { key: 'admin', label: 'Admin' }
];

export default class CafDashboard extends NavigationMixin(LightningElement) {
    /** Which screen is showing; c__view in the URL selects one on arrival. */
    view = 'compliance';

    /** The page this tab is on, kept so selectView can write c__view into it. */
    pageRef;

    /** Set by an arrow key so the newly selected tab takes focus once rendered. */
    focusPending = false;

    columns = [];
    rows = [];

    /** Grid filter: application name contains this, ignoring case. */
    appSearch = '';

    /** Grid filter: hide applications whose Overall reads Compliant. */
    attentionOnly = false;

    /** Grid order: 'name' (default) or 'least'. */
    sortBy = 'name';

    /**
     * Per-control and per-status counts over every row, worked out in build()
     * alongside the pivot. Not filtered: the footer and legend describe the
     * estate, and a filter that changed them would make them disagree with
     * the Reports screen.
     */
    totals = { columns: [], status: {}, na: 0, compliantApps: 0 };

    /** Set when a cell opens the task panel, so it is scrolled to once rendered. */
    scrollPending = false;
    error;
    loading = true;
    busy = false;

    selectedSysId;
    selectedNumber;
    selectedControl;
    tasks = [];

    /** The task whose panel is open, if any. */
    activeTask;

    /** 'evidence' or 'attest' - which of the two jobs the open panel is for. */
    panelMode;

    /**
     * Evidence held in ServiceNow for the open task, relayed from cafEvidence
     * to cafAttestation. Undefined until cafEvidence has looked, which is not
     * the same as zero - the attestation buttons grey out on zero, not on
     * not-yet-known.
     */
    evidenceCount;

    wiredRequests;
    wiredControls;
    wiredTasks;

    /** Raw wire payloads, held because the grid needs both to pivot. */
    controls;
    requests;

    /**
     * /lightning/n/CAF_Dashboard?c__view=approvals opens straight onto a
     * screen, so a link in an email or a notification can land on it. An
     * unknown or missing c__view leaves the current screen as it is.
     *
     * @param {object} ref the page reference; may be undefined before it resolves
     */
    @wire(CurrentPageReference)
    handlePageReference(ref) {
        this.pageRef = ref || undefined;
        const wanted = ref && ref.state && ref.state.c__view;
        if (typeof wanted === 'string' && VIEWS.some((v) => v.key === wanted)) {
            this.view = wanted;
        }
    }

    /**
     * The tab bar's buttons, with which one is selected.
     *
     * @returns {object[]}
     */
    get views() {
        return VIEWS.map((v) => ({
            ...v,
            selected: String(v.key === this.view),
            // Roving tabindex: Tab lands on the selected screen, arrows move along.
            tabIndex: v.key === this.view ? '0' : '-1',
            className: v.key === this.view ? 'views__tab views__tab--on' : 'views__tab'
        }));
    }

    /** @returns {boolean} whether the Approvals screen is showing */
    get isApprovals() {
        return this.view === 'approvals';
    }

    /** @returns {boolean} whether the Reports screen is showing */
    get isReports() {
        return this.view === 'reports';
    }

    /** @returns {boolean} whether the Admin screen is showing */
    get isAdmin() {
        return this.view === 'admin';
    }

    /**
     * A tab was clicked.
     *
     * @param {Event} event click event from a tab button
     */
    handleView(event) {
        const data = event && event.currentTarget && event.currentTarget.dataset;
        if (data && data.view) {
            this.selectView(data.view);
        }
    }

    /**
     * Keyboard on the tab bar, following the ARIA tabs pattern: Left/Right
     * wrap, Home/End jump. Other keys pass through untouched.
     *
     * @param {KeyboardEvent} event keydown event from the tab bar
     */
    handleViewKey(event) {
        const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
        const move = event && keys[event.key];
        if (move === undefined) {
            return;
        }
        event.preventDefault();
        // An unrecognised current view counts as the first tab.
        const i = Math.max(0, VIEWS.findIndex((v) => v.key === this.view));
        let next;
        if (move === 'first') {
            next = 0;
        } else if (move === 'last') {
            next = VIEWS.length - 1;
        } else {
            next = (i + move + VIEWS.length) % VIEWS.length;
        }
        this.focusPending = true;
        this.selectView(VIEWS[next].key);
    }

    /**
     * Writes the screen into the URL with replace, so a refresh or a copied
     * link lands back on it without each tab click adding a history entry.
     * Compliance is the default and is left out of the URL. An unknown key,
     * or the screen already showing, does nothing.
     *
     * @param {string} key one of the VIEWS keys
     */
    selectView(key) {
        if (!VIEWS.some((v) => v.key === key) || key === this.view) {
            return;
        }
        this.view = key;
        if (this.pageRef) {
            const state = { ...(this.pageRef.state || {}) };
            if (key === 'compliance') {
                delete state.c__view;
            } else {
                state.c__view = key;
            }
            this[NavigationMixin.Navigate]({ ...this.pageRef, state }, true);
        }
    }

    /**
     * After render: focus the selected tab following an arrow-key change, and
     * bring a newly opened task panel into view and focus, so Escape reaches it.
     */
    renderedCallback() {
        if (this.scrollPending) {
            this.scrollPending = false;
            const panel = this.template.querySelector('section.panel');
            if (panel) {
                if (typeof panel.scrollIntoView === 'function') {
                    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                panel.focus({ preventScroll: true });
            }
        }
        if (this.focusPending) {
            this.focusPending = false;
            const tab = this.template.querySelector('.views__tab--on');
            if (tab) {
                tab.focus();
            }
        }
    }

    /**
     * An attestation on the Approvals screen moves a request's status, so the
     * grid's requests are stale by the time anyone switches back to it. A
     * failed refresh is reported as a toast: the screen the user is on is
     * still correct, only the grid behind it is out of date.
     */
    async handleChildChange() {
        if (!this.wiredRequests) {
            return;
        }
        try {
            await refreshApex(this.wiredRequests);
        } catch (err) {
            this.toast('Could not refresh the compliance grid', this.messageOf(err), 'warning');
        }
    }

    @wire(getControls)
    handleControls(result) {
        this.wiredControls = result;
        if (result.data) {
            this.controls = result.data;
            this.rebuild();
        } else if (result.error) {
            this.error = this.messageOf(result.error);
            this.loading = false;
        }
    }

    @wire(getRequests)
    handleRequests(result) {
        this.wiredRequests = result;
        if (result.data) {
            this.requests = result.data;
            this.rebuild();
        } else if (result.error) {
            this.error = this.messageOf(result.error);
            this.loading = false;
        }
    }

    /**
     * Two wires resolve independently and in no guaranteed order, so the pivot
     * waits for both rather than rendering a half-built grid on whichever
     * arrives first.
     */
    rebuild() {
        if (!this.controls || !this.requests) {
            return;
        }
        this.build(this.controls, this.requests);
        this.loading = false;
    }

    @wire(getTasks, { requestExternalId: '$selectedSysId' })
    handleTasks(result) {
        this.wiredTasks = result;
        if (result.data) {
            // A task that closed while its panel was open should not leave a
            // stale state behind it: refresh what the attestation form reads.
            if (this.activeTask) {
                const current = result.data.find(
                    (t) => t.ServiceNow_Sys_Id__c === this.activeTask.sysId
                );
                if (current) {
                    this.activeTask = {
                        ...this.activeTask,
                        state: current.State__c,
                        approval: current.Approval__c
                    };
                }
            }

            this.tasks = result.data.map((t) => this.decorate(t));
        }
    }

    /**
     * Which actions a task can actually take, decided here rather than left to
     * ServiceNow to refuse.
     *
     * Evidence and attestation are separate buttons because they are separate
     * jobs done by separate people: whoever owns the application gathers the
     * evidence, and someone else judges it. One button covering both would
     * imply one person does both, which is the opposite of what an attestation
     * is for.
     *
     * Start is hidden once it cannot succeed - on a task that is not Open it is
     * a guaranteed error, and there is nothing to learn from being allowed to
     * press it. Attest is hidden unless the task is In Progress, which is what
     * the endpoint requires. Both are hidden on a task with no ServiceNow
     * sys_id, because there is nothing to address the change to.
     *
     * The evidence button is never hidden, only relabelled. Reading the
     * evidence behind a closed task is the audit view, and it is wanted
     * precisely when the task can no longer be attested; the panel drops its
     * upload control in that case rather than disappearing.
     */
    decorate(task) {
        const state = task.State__c;
        const open = state === 'Open';
        const inProgress = state === 'In Progress';
        const active = open || inProgress;
        const linked = !!task.ServiceNow_Sys_Id__c;

        return {
            ...task,
            canStart: linked && open,
            canAttest: linked && inProgress,
            evidenceLabel: active ? 'Upload evidence' : 'View evidence',
            rowClass: this.rowClassFor(task.ServiceNow_Sys_Id__c)
        };
    }

    rowClassFor(sysId) {
        return this.activeTask && this.activeTask.sysId === sysId
            ? 'tasks__row tasks__row--active'
            : 'tasks__row';
    }

    /**
     * The highlight was worked out only when the tasks wire delivered, so
     * opening or closing a panel never moved it. Recompute it whenever the
     * active task changes.
     */
    markActiveRow() {
        this.tasks = this.tasks.map((t) => ({
            ...t,
            rowClass: this.rowClassFor(t.ServiceNow_Sys_Id__c)
        }));
    }

    /**
     * Pivot requests into apps (rows) x controls (columns).
     *
     * Columns come from the control catalogue, not from the requests. That is
     * what the ServiceNow portal widget does - it queries the control table for
     * active controls and renders a column for each, showing N/A wherever an
     * application has no request for that control. Deriving columns from the
     * requests instead meant a newly created control had no column at all here
     * until somebody generated a request against it, so the two grids showed
     * different numbers of columns for the same data.
     *
     * Cells join on the control's sys_id, falling back to its name. The name is
     * a snapshot written at push time, so a control renamed in ServiceNow leaves
     * the old label stranded on requests already mirrored here - joining on it
     * alone would drop those requests out of the grid entirely. The fallback
     * covers requests pushed before CAF_Control_Sys_Id__c existed.
     */
    build(controls, records) {
        const apps = new Map();

        records.forEach((r) => {
            if (!apps.has(r.Business_Application__c)) {
                apps.set(r.Business_Application__c, {});
            }
            const key = r.CAF_Control_Sys_Id__c || 'name:' + r.CAF_Control__c;
            apps.get(r.Business_Application__c)[key] = r;
        });

        this.columns = controls.map((c) => ({
            key: c.ServiceNow_Sys_Id__c || c.Name,
            label: c.Name
        }));

        const today = todayIso();
        const rows = [];
        apps.forEach((byControl, appName) => {
            let compliant = 0;
            let assessed = 0;

            const cells = controls.map((control) => {
                const record =
                    byControl[control.ServiceNow_Sys_Id__c] ||
                    byControl['name:' + control.Name];
                const status = record ? record.CAF_Status__c : null;
                const meta = STATUS[status];
                const due = record && typeof record.Planned_Completion_Date__c === 'string'
                    ? record.Planned_Completion_Date__c
                    : '';
                // ISO dates compare as strings. Settled statuses owe nothing.
                const overdue = !!due && due < today && !SETTLED.has(status);

                if (record) {
                    assessed += 1;
                    if (status === 'in_compliance') {
                        compliant += 1;
                    }
                }

                return {
                    key: appName + '|' + control.Name,
                    status: record ? status : null,
                    isNa: !record,
                    dot: meta ? meta.dot : 'dot dot--none',
                    sysId: record ? record.ServiceNow_Sys_Id__c : null,
                    number: record ? record.SN_Number__c : '',
                    control: control.Name,
                    disabled: !record,
                    overdue,
                    title: record
                        ? record.SN_Number__c + ' - ' + (meta ? meta.label : status || 'unknown') +
                          (due ? ' - due ' + due : '') + (overdue ? ' (overdue)' : '')
                        : control.Name + ' - not assessed for this application'
                };
            });

            // An app is compliant only when every control it has actually been
            // assessed against is. Controls with no request render N/A and stay
            // out of the denominator: counting them would mean adding a control
            // in ServiceNow silently marks every application non-compliant,
            // which is a scoring change disguised as a display change.
            const allGreen = assessed > 0 && compliant === assessed;

            let overallClass = 'pill pill--amber';
            let overallLabel = compliant + ' of ' + assessed;

            if (assessed === 0) {
                overallClass = 'pill pill--none';
                overallLabel = 'Not assessed';
            } else if (allGreen) {
                overallClass = 'pill pill--green';
                overallLabel = 'Compliant';
            }

            rows.push({
                key: appName,
                app: appName,
                assessed,
                rate: assessed ? compliant / assessed : null,
                cells,
                overallClass,
                overallLabel,
                compliant: allGreen,
                // An unassessed application has nothing to fix yet, so it is
                // not "needing attention" - it is waiting for a request.
                needsAttention: assessed > 0 && !allGreen
            });
        });

        rows.sort((a, b) => String(a.app).localeCompare(String(b.app)));
        this.rows = rows;
        this.totals = this.computeTotals(controls, rows);
    }

    /**
     * Footer and legend figures over every row: for each control, how many
     * of the applications assessed against it are in compliance; and how many
     * cells carry each status.
     *
     * @param {object[]} controls the active controls, in column order
     * @param {object[]} rows     the pivoted rows from build()
     * @returns {{columns: object[], status: object, na: number, compliantApps: number}}
     */
    computeTotals(controls, rows) {
        const status = {};
        let na = 0;
        const columns = controls.map((control, i) => {
            let assessed = 0;
            let compliant = 0;
            rows.forEach((row) => {
                const cell = row.cells[i];
                if (!cell || cell.isNa) {
                    return;
                }
                assessed += 1;
                if (cell.status === 'in_compliance') {
                    compliant += 1;
                }
            });
            return {
                key: 'total|' + (control.ServiceNow_Sys_Id__c || control.Name || i),
                label: assessed ? compliant + '/' + assessed : '-',
                title: assessed
                    ? compliant + ' of ' + assessed + ' assessed applications in compliance for ' + control.Name
                    : 'No application assessed for ' + control.Name
            };
        });
        rows.forEach((row) =>
            row.cells.forEach((cell) => {
                if (cell.isNa) {
                    na += 1;
                } else if (cell.status) {
                    status[cell.status] = (status[cell.status] || 0) + 1;
                }
            })
        );
        return { columns, status, na, compliantApps: rows.filter((r) => r.compliant).length };
    }

    /**
     * Rows after the grid's own filters. Neither filter touches the data or
     * the footer, only which rows are drawn.
     *
     * @returns {object[]}
     */
    get visibleRows() {
        const needle = (this.appSearch || '').trim().toLowerCase();
        const rows = this.rows.filter(
            (r) =>
                (!needle || String(r.app).toLowerCase().includes(needle)) &&
                (!this.attentionOnly || r.needsAttention)
        );
        if (this.sortBy === 'least') {
            // Lowest share compliant first; unassessed applications last, as
            // they have nothing to fix yet. Name breaks ties.
            rows.sort((a, b) => {
                const ra = a.rate === null ? 2 : a.rate;
                const rb = b.rate === null ? 2 : b.rate;
                return ra - rb || String(a.app).localeCompare(String(b.app));
            });
        }
        // Cell classes depend on the selection, which changes without a rebuild.
        return rows.map((r) => ({
            ...r,
            cells: r.cells.map((c) => ({ ...c, cls: this.cellClassFor(c) }))
        }));
    }

    /**
     * The cell button's classes: an overdue ring where the planned date has
     * passed, and a highlight on the cell whose tasks are open below. Both are
     * classes, not extra elements, so the dot stays the first span in the
     * button for anything that reads the grid.
     *
     * @param {object} cell a cell from build()
     * @returns {string}
     */
    cellClassFor(cell) {
        let cls = 'cellbtn';
        if (cell.overdue) {
            cls += ' cellbtn--overdue';
        }
        if (cell.sysId && cell.sysId === this.selectedSysId) {
            cls += ' cellbtn--selected';
        }
        return cls;
    }

    /** @returns {object[]} the sort dropdown's options */
    get sortOptions() {
        return SORTS.map((s) => ({ ...s, selected: s.value === this.sortBy }));
    }

    /** @returns {number} assessed cells past their planned date and not settled */
    get overdueCount() {
        return this.rows.reduce((n, r) => n + r.cells.filter((c) => c.overdue).length, 0);
    }

    /**
     * Sort changed. Only the two known orders are accepted.
     *
     * @param {Event} event change event from the select
     */
    handleSort(event) {
        const value = event && event.target && event.target.value;
        this.sortBy = SORTS.some((s) => s.value === value) ? value : 'name';
        this.savePrefs();
    }

    /**
     * Restores this viewer's sort and "Needs attention only" from the last
     * visit. Browser storage can be absent or blocked; then the defaults stand.
     */
    loadPrefs() {
        try {
            const raw = window.localStorage && window.localStorage.getItem(PREFS_KEY);
            if (!raw) {
                return;
            }
            const prefs = JSON.parse(raw);
            if (prefs && SORTS.some((s) => s.value === prefs.sortBy)) {
                this.sortBy = prefs.sortBy;
            }
            if (prefs && typeof prefs.attentionOnly === 'boolean') {
                this.attentionOnly = prefs.attentionOnly;
            }
        } catch (e) {
            // Unreadable or blocked storage: keep the defaults.
        }
    }

    /** Remembers the sort and "Needs attention only". The search is not kept. */
    savePrefs() {
        try {
            if (window.localStorage) {
                window.localStorage.setItem(
                    PREFS_KEY,
                    JSON.stringify({ sortBy: this.sortBy, attentionOnly: this.attentionOnly })
                );
            }
        } catch (e) {
            // Blocked storage only costs the preference, never the grid.
        }
    }

    /** Restores saved grid preferences before the first render. */
    connectedCallback() {
        this.loadPrefs();
    }

    /**
     * One line under the panel heading: how many tasks the request has, by
     * state, so the shape of the work is visible before reading the table.
     *
     * @returns {string} e.g. "3 tasks · 1 Open · 2 Closed Complete"
     */
    get taskSummary() {
        const tasks = this.tasks || [];
        if (!tasks.length) {
            return '';
        }
        const byState = new Map();
        tasks.forEach((t) => {
            const state = (t && t.State__c) || 'No state';
            byState.set(state, (byState.get(state) || 0) + 1);
        });
        const parts = [tasks.length + (tasks.length === 1 ? ' task' : ' tasks')];
        byState.forEach((n, state) => parts.push(n + ' ' + state));
        return parts.join(' \u00b7 ');
    }

    /** @returns {boolean} whether any row survives the grid filters */
    get hasVisibleRows() {
        return this.visibleRows.length > 0;
    }

    /** @returns {string} e.g. "Showing 4 of 19 applications" */
    get rowCountLabel() {
        const shown = this.visibleRows.length;
        const all = this.rows.length;
        const noun = all === 1 ? 'application' : 'applications';
        return shown === all ? all + ' ' + noun : 'Showing ' + shown + ' of ' + all + ' ' + noun;
    }

    /** @returns {object[]} one footer cell per control column */
    get columnTotals() {
        return this.totals.columns;
    }

    /** @returns {string} applications fully compliant, over all applications */
    get overallTotalLabel() {
        return this.totals.compliantApps + '/' + this.rows.length;
    }

    /** @returns {object[]} the legend, each status with its cell count */
    get legendItems() {
        return Object.keys(STATUS).map((key) => ({
            key,
            label: STATUS[key].label,
            dot: STATUS[key].dot,
            count: this.totals.status[key] || 0
        }));
    }

    /** @returns {number} cells with no request behind them */
    get naCount() {
        return this.totals.na;
    }

    /**
     * Grid search typed in.
     *
     * @param {Event} event input event from the search box
     */
    handleAppSearch(event) {
        this.appSearch = (event && event.target && event.target.value) || '';
    }

    /**
     * "Needs attention only" toggled.
     *
     * @param {Event} event change event from the checkbox
     */
    handleAttentionOnly(event) {
        this.attentionOnly = !!(event && event.target && event.target.checked);
        this.savePrefs();
    }

    /**
     * Escape inside the task panel closes the open task first, then the
     * panel itself - one layer per press, the way a dialog stack unwinds.
     *
     * @param {KeyboardEvent} event keydown event from the panel
     */
    handlePanelKey(event) {
        if (!event || event.key !== 'Escape') {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.activeTask) {
            this.handleCloseTask();
        } else {
            this.handleClose();
        }
    }

    /**
     * Moving to another request closes the task panel. The panel belongs to a
     * task of the previous request, and left open it sat under the new
     * request's task list as though it were one of them.
     */
    handleCellClick(event) {
        const { sysid, number, control } = event.currentTarget.dataset;
        if (!sysid) {
            return;
        }
        if (sysid !== this.selectedSysId) {
            this.handleCloseTask();
        }
        this.selectedSysId = sysid;
        this.selectedNumber = number;
        this.selectedControl = control;
        // On a long grid the panel opens below the fold; without this a click
        // appears to do nothing.
        this.scrollPending = true;
    }

    handleClose() {
        this.selectedSysId = undefined;
        this.selectedNumber = undefined;
        this.tasks = [];
        this.handleCloseTask();
    }

    handleOpenTask(event) {
        const { id, sysid, number, state, approval, mode } = event.currentTarget.dataset;
        this.evidenceCount = undefined;
        this.panelMode = mode;
        this.activeTask = { id, sysId: sysid, number, state, approval };
        this.markActiveRow();
    }

    handleCloseTask() {
        this.activeTask = undefined;
        this.panelMode = undefined;
        this.evidenceCount = undefined;
        this.markActiveRow();
    }

    /**
     * cafEvidence reports what ServiceNow holds; cafAttestation needs it to
     * know whether the gate is satisfied. The two are siblings, so the count
     * travels through here rather than between them.
     */
    handleEvidenceCount(event) {
        if (this.activeTask && event.detail.sysId === this.activeTask.sysId) {
            this.evidenceCount = event.detail.count;
        }
    }

    /**
     * An attestation closes the task and moves the parent request's compliance
     * status, so both wires are stale. The panel stays open: the outcome is
     * displayed in it, and closing it would take the confirmation away with it.
     */
    async handleAttested() {
        await Promise.all([refreshApex(this.wiredTasks), refreshApex(this.wiredRequests)]);
    }

    /**
     * Every action goes to ServiceNow and comes back. Nothing is written to the
     * local CAF_Task__c record: ServiceNow applies its own rules, then the
     * inbound API pushes the resulting state — including any derived change to
     * the parent request — back into Salesforce.
     */
    async handleAction(event) {
        const { sysid, field, value } = event.currentTarget.dataset;
        if (this.busy || !sysid) {
            return;
        }
        this.busy = true;
        try {
            await applyChange({ sysId: sysid, field: field, value: value });
            this.toast('Sent to ServiceNow', 'ServiceNow applied the change and returned the new state.', 'success');
            await Promise.all([refreshApex(this.wiredTasks), refreshApex(this.wiredRequests)]);
        } catch (err) {
            this.toast('ServiceNow rejected the change', this.messageOf(err), 'error');
        } finally {
            this.busy = false;
        }
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

    get hasRows() {
        return this.rows.length > 0;
    }

    get hasSelection() {
        return !!this.selectedSysId;
    }

    get hasTasks() {
        return this.tasks.length > 0;
    }

    get hasActiveTask() {
        return !!this.activeTask;
    }

    get isAttestPanel() {
        return this.panelMode === 'attest';
    }

    /**
     * The approver sees the evidence but does not add to it, and a closed task
     * takes no new evidence at all. Either way the same component renders with
     * its upload control removed rather than a second read-only component
     * existing to say the same things.
     */
    get evidenceReadOnly() {
        if (this.isAttestPanel) {
            return true;
        }
        const state = this.activeTask && this.activeTask.state;
        return state !== 'Open' && state !== 'In Progress';
    }

    get panelHeading() {
        if (!this.activeTask) {
            return '';
        }
        return this.isAttestPanel
            ? 'Attest ' + this.activeTask.number
            : 'Evidence for ' + this.activeTask.number;
    }
}
