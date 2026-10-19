import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import LightningConfirm from 'lightning/confirm';
import attest from '@salesforce/apex/CafAttestationService.attest';

import SN_SYS_ID from '@salesforce/schema/CAF_Task__c.ServiceNow_Sys_Id__c';
import SN_NUMBER from '@salesforce/schema/CAF_Task__c.SN_Number__c';
import STATE from '@salesforce/schema/CAF_Task__c.State__c';
import APPROVAL from '@salesforce/schema/CAF_Task__c.Approval__c';

const FIELDS = [SN_SYS_ID, SN_NUMBER, STATE, APPROVAL];

/**
 * Attestation for one CAF Task.
 *
 * Two statements, recorded together: whether the success criteria were met -
 * the attester's claim - and whether the control is approved or rejected - the
 * decision. They are allowed to disagree, because an approver rejecting a task
 * whose owner claimed the criteria were met is a real outcome and the pair is
 * the audit trail.
 *
 * Sending either one closes the task. Not here: setting `approval` in
 * ServiceNow fires a business rule that closes it and sets the parent
 * request's compliance status. This component sends the outcome and displays
 * what came back.
 *
 * The evidence requirement is enforced in ServiceNow, not in this form. Where
 * a parent knows the count it is passed in and the buttons grey out early, but
 * the refusal that matters comes from the endpoint.
 */
export default class CafAttestation extends LightningElement {
    @api recordId;

    /**
     * A setter, because the dashboard keeps this component mounted while the
     * user moves between tasks. Without the reset, the previous task's outcome
     * line and half-typed comments stayed on screen against the next task.
     */
    @api
    get snSysId() {
        return this._snSysId;
    }
    set snSysId(value) {
        if (value !== this._snSysId) {
            this.metCriteria = 'yes';
            this.comments = '';
            this.outcome = undefined;
        }
        this._snSysId = value;
    }

    @api taskNumber;
    @api taskState;
    @api taskApproval;

    /** Evidence in ServiceNow, when the parent already knows. Undefined means unknown. */
    @api evidenceCount;

    metCriteria = 'yes';
    comments = '';
    busy = false;
    outcome;

    _snSysId;
    _resolvedSysId;
    _resolvedNumber;
    _resolvedState;
    _resolvedApproval;

    criteriaOptions = [
        { label: 'Success criteria met', value: 'yes' },
        { label: 'Success criteria not met', value: 'no' }
    ];

    /**
     * Only consulted when the parent did not supply the values. On the
     * dashboard it did, and it also refreshes them after an attestation, which
     * this wire would otherwise overwrite with a stale cached record.
     */
    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    wiredTask({ data }) {
        if (data && !this.snSysId) {
            this._resolvedSysId = getFieldValue(data, SN_SYS_ID);
            this._resolvedNumber = getFieldValue(data, SN_NUMBER);
            this._resolvedState = getFieldValue(data, STATE);
            this._resolvedApproval = getFieldValue(data, APPROVAL);
        }
    }

    get sysId() {
        return this.snSysId || this._resolvedSysId;
    }

    get number() {
        return this.taskNumber || this._resolvedNumber || '';
    }

    get state() {
        return this.taskState || this._resolvedState;
    }

    get approval() {
        return this.taskApproval || this._resolvedApproval;
    }

    handleCriteria(event) {
        this.metCriteria = event.detail.value;
    }

    handleComments(event) {
        this.comments = event.target.value;
        event.target.setCustomValidity('');
        event.target.reportValidity();
    }

    /** Approve pressed: confirm, then send. */
    async handleApprove() {
        if (await this.confirmDecision('approved')) {
            await this.submit('approved');
        }
    }

    /**
     * A rejection marks the request out of compliance, and the comment is the
     * only place the reason is recorded. Blank or whitespace-only is refused
     * here, on the field, rather than sent.
     */
    async handleReject() {
        if (!this.trimmedComments) {
            const field = this.template.querySelector('.at__comments');
            if (field) {
                field.setCustomValidity('Say why the control is rejected.');
                field.reportValidity();
                field.focus();
            }
            return;
        }
        if (await this.confirmDecision('rejected')) {
            await this.submit('rejected');
        }
    }

    /**
     * Either decision closes the task in ServiceNow and moves the parent
     * request's status, and nothing on this side can reopen it. One click is
     * too little for that, so the decision is restated and confirmed first.
     * A dialog that cannot open (no Lightning container) counts as no.
     *
     * @param {string} decision 'approved' or 'rejected'
     * @returns {Promise<boolean>} true only when the user confirmed
     */
    async confirmDecision(decision) {
        if (this.busy || !this.canAttest) {
            return false;
        }
        const verb = decision === 'approved' ? 'Approve' : 'Reject';
        const criteria = this.metCriteria === 'yes' ? 'met' : 'not met';
        try {
            const ok = await LightningConfirm.open({
                label: verb + ' ' + (this.number || 'this task') + '?',
                message:
                    'Success criteria ' + criteria + '. ' +
                    'ServiceNow will close the task' +
                    (decision === 'rejected' ? ' and mark the request out of compliance' : '') +
                    '. This cannot be undone from Salesforce.',
                theme: decision === 'approved' ? 'success' : 'warning',
                variant: 'header'
            });
            return ok === true;
        } catch (err) {
            this.toast('Could not ask for confirmation', this.messageOf(err), 'error');
            return false;
        }
    }

    get trimmedComments() {
        return (this.comments || '').trim();
    }

    async submit(decision) {
        if (this.busy) {
            return;
        }
        this.busy = true;
        try {
            const result = await attest({
                taskSysId: this.sysId,
                metCriteria: this.metCriteria,
                outcome: decision,
                comments: this.trimmedComments
            });
            this.outcome = result;
            this.comments = '';
            this.toast(
                'Attestation recorded',
                result.taskNumber + ' is ' + result.approval +
                    (result.requestNumber
                        ? '. ' + result.requestNumber + ' is now ' +
                          this.readable(result.requestStatus) + '.'
                        : '.'),
                'success'
            );
            // The parent owns the task list and the compliance grid, both of
            // which this has just changed. Tell it rather than reaching into it.
            this.dispatchEvent(new CustomEvent('attested', {
                detail: result,
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.toast('ServiceNow refused the attestation', this.messageOf(err), 'error');
        } finally {
            this.busy = false;
        }
    }

    readable(status) {
        if (!status) {
            return 'unchanged';
        }
        return status.split('_').join(' ');
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

    // ------------------------------------------------------------- rendering

    get heading() {
        return this.number ? 'Attestation — ' + this.number : 'Attestation';
    }

    /**
     * ServiceNow requires a task to be In Progress before it can be attested,
     * so say so here rather than letting the user fill the form in and be
     * refused. State__c holds the label pushed by CAFSalesforceSync.
     */
    get notStarted() {
        return this.state === 'Open';
    }

    get alreadyClosed() {
        return this.state === 'Closed Complete' || this.state === 'Cancelled';
    }

    /**
     * Closed by the attestation just sent. On a record page nothing refreshes
     * State__c - the wire holds the cached record - so without this the form
     * stayed live and a second press went to ServiceNow to be refused with 409.
     */
    get justAttested() {
        return !!this.outcome && this.outcome.active === false;
    }

    get noEvidence() {
        return this.evidenceCount === 0;
    }

    get canAttest() {
        return !!this.sysId && !this.notStarted && !this.alreadyClosed &&
               !this.justAttested && !this.noEvidence;
    }

    get disabled() {
        return this.busy || !this.canAttest;
    }

    get blockedReason() {
        if (!this.sysId) {
            return 'This task carries no ServiceNow sys_id, so it cannot be attested.';
        }
        if (this.justAttested) {
            return this.number + ' is closed. Its outcome is recorded as ' +
                   this.outcome.approval + '.';
        }
        if (this.alreadyClosed) {
            return this.number + ' is ' + this.state.toLowerCase() +
                   '. Its outcome is already recorded' +
                   (this.approval ? ' as ' + this.approval : '') + '.';
        }
        if (this.notStarted) {
            return 'Start ' + this.number + ' before attesting it. A task moves ' +
                   'Open to In Progress to Closed, and ServiceNow enforces that order.';
        }
        if (this.noEvidence) {
            return 'Attach at least one evidence file before attesting. ' +
                   'ServiceNow counts its own copy, not the Salesforce one.';
        }
        return '';
    }

    get isBlocked() {
        return !this.canAttest;
    }

    get hasOutcome() {
        return !!this.outcome;
    }

    get outcomeClass() {
        if (!this.outcome) {
            return 'result';
        }
        return this.outcome.approval === 'approved' ? 'result result--ok' : 'result result--no';
    }

    get outcomeLabel() {
        if (!this.outcome) {
            return '';
        }
        const parts = [
            this.outcome.taskNumber + ' ' + this.outcome.approval,
            'criteria met: ' + this.outcome.metCriteria
        ];
        if (this.outcome.requestNumber) {
            parts.push(this.outcome.requestNumber + ' ' +
                       this.readable(this.outcome.requestStatus));
        }
        return parts.join(' · ');
    }
}
