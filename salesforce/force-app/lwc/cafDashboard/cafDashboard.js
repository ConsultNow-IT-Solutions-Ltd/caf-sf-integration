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
     * screen, so a link in an email or a notification can land on it.
     */
    @wire(CurrentPageReference)
    handlePageReference(ref) {
        this.pageRef = ref;
        const wanted = ref && ref.state && ref.state.c__view;
        if (wanted && VIEWS.some((v) => v.key === wanted)) {
            this.view = wanted;
        }
    }

    get views() {
        return VIEWS.map((v) => ({
            ...v,
            selected: String(v.key === this.view),
            // Roving tabindex: Tab lands on the selected screen, arrows move along.
            tabIndex: v.key === this.view ? '0' : '-1',
            className: v.key === this.view ? 'views__tab views__tab--on' : 'views__tab'
        }));
    }

    get isApprovals() {
        return this.view === 'approvals';
    }

    get isReports() {
        return this.view === 'reports';
    }

    get isAdmin() {
        return this.view === 'admin';
    }

    handleView(event) {
        this.selectView(event.currentTarget.dataset.view);
    }

    /** ARIA tabs pattern: Left/Right wrap, Home/End jump. */
    handleViewKey(event) {
        const keys = { ArrowLeft: -1, ArrowRight: 1, Home: 'first', End: 'last' };
        const move = keys[event.key];
        if (move === undefined) {
            return;
        }
        event.preventDefault();
        const i = VIEWS.findIndex((v) => v.key === this.view);
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
     * Compliance is the default and is left out of the URL.
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

    renderedCallback() {
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
     * grid's requests are stale by the time anyone switches back to it.
     */
    async handleChildChange() {
        if (this.wiredRequests) {
            await refreshApex(this.wiredRequests);
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

                if (record) {
                    assessed += 1;
                    if (status === 'in_compliance') {
                        compliant += 1;
                    }
                }

                return {
                    key: appName + '|' + control.Name,
                    isNa: !record,
                    dot: meta ? meta.dot : 'dot dot--none',
                    sysId: record ? record.ServiceNow_Sys_Id__c : null,
                    number: record ? record.SN_Number__c : '',
                    control: control.Name,
                    disabled: !record,
                    title: record
                        ? record.SN_Number__c + ' - ' + (meta ? meta.label : status || 'unknown')
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
                cells,
                overallClass,
                overallLabel
            });
        });

        rows.sort((a, b) => a.app.localeCompare(b.app));
        this.rows = rows;
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
