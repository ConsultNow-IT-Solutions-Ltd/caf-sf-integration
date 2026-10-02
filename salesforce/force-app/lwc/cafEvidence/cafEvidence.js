import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getEvidence from '@salesforce/apex/CafEvidenceService.getEvidence';
import pushEvidence from '@salesforce/apex/CafEvidenceService.pushEvidence';

import SN_SYS_ID from '@salesforce/schema/CAF_Task__c.ServiceNow_Sys_Id__c';
import SN_NUMBER from '@salesforce/schema/CAF_Task__c.SN_Number__c';

const FIELDS = [SN_SYS_ID, SN_NUMBER];

/**
 * Evidence for one CAF Task.
 *
 * Works from either end. On a CAF Task record page the platform injects
 * recordId and the ServiceNow sys_id is read from the record; inside the
 * dashboard the parent already holds both and passes them in, which saves a
 * record read per task the user clicks through.
 *
 * Files are uploaded to Salesforce first and pushed to ServiceNow second,
 * one at a time. That order is deliberate: lightning-file-upload gives us
 * Salesforce Files for free - preview, download, the standard Files related
 * list - and a failed push then leaves a file the user can see and retry
 * rather than bytes that went nowhere.
 */
export default class CafEvidence extends LightningElement {
    /** Salesforce CAF_Task__c Id. Injected on a record page. */
    @api recordId;

    /**
     * ServiceNow sys_id. Passed by the dashboard; read from the record otherwise.
     *
     * A setter, because the dashboard keeps this component mounted while the
     * user moves from one task to the next and only swaps its properties.
     * Loading once on connect left the previous task's files on screen under
     * the new task's heading - in the attest panel, the approver was judging
     * the wrong evidence.
     */
    @api
    get snSysId() {
        return this._snSysId;
    }
    set snSysId(value) {
        const changed = value !== this._snSysId;
        this._snSysId = value;
        if (changed && this._connected) {
            this.clear();
            this.load();
        }
    }

    /** Display only, for the heading. */
    @api taskNumber;

    /**
     * Drop the upload control and show the lists alone.
     *
     * Set when an approver is reading the evidence rather than gathering it,
     * and when the task is closed and takes no more. Both are the same thing to
     * this component: the lists are the point, the upload is not.
     */
    @api hideUpload = false;

    salesforceFiles = [];
    serviceNowFiles = [];
    serviceNowError;
    maxBytes = 2097152;

    loading = true;
    uploading = false;
    error;

    _snSysId;
    _resolvedSysId;
    _resolvedNumber;
    _loaded = false;
    _connected = false;

    /**
     * Incremented by every load. A response is applied only if no later load
     * has started since, so a slow reply for the task the user just left
     * cannot overwrite the one they moved to.
     */
    _loadSeq = 0;

    acceptedFormats = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.csv', '.txt',
                       '.log', '.json', '.xml', '.doc', '.docx', '.xls', '.xlsx'];

    /**
     * Only used when the sys_id was not handed in. The dashboard already holds
     * it, and loading again off the back of this wire would spend a second
     * callout on every task the user clicks.
     */
    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    wiredTask({ data }) {
        if (data && !this.snSysId) {
            this._resolvedSysId = getFieldValue(data, SN_SYS_ID);
            this._resolvedNumber = getFieldValue(data, SN_NUMBER);
            this.load();
        }
    }

    connectedCallback() {
        this._connected = true;
        // On a record page the sys_id is not known yet; the wire loads instead.
        if (this.snSysId || !this.recordId) {
            this.load();
        }
    }

    disconnectedCallback() {
        this._connected = false;
    }

    get sysId() {
        return this.snSysId || this._resolvedSysId;
    }

    get number() {
        return this.taskNumber || this._resolvedNumber || '';
    }

    /** Forget the previous task's lists, so they are never shown under the next one. */
    clear() {
        this.salesforceFiles = [];
        this.serviceNowFiles = [];
        this.serviceNowError = undefined;
        this.error = undefined;
        this._loaded = false;
    }

    /**
     * Reload from both systems. Public so the dashboard can refresh this panel
     * after an attestation without re-rendering the component from scratch.
     */
    @api
    async load() {
        if (!this.recordId && !this.sysId) {
            this.loading = false;
            return;
        }
        const seq = ++this._loadSeq;
        this.loading = true;
        this.error = undefined;
        try {
            const view = await getEvidence({
                taskRecordId: this.recordId,
                taskSysId: this.sysId
            });
            if (seq !== this._loadSeq) {
                return;
            }
            this.salesforceFiles = view.salesforceFiles || [];
            this.serviceNowFiles = view.serviceNowFiles || [];
            this.serviceNowError = view.serviceNowError;
            this.maxBytes = view.maxBytes || this.maxBytes;
            this._loaded = true;
            this.announceCount();
        } catch (err) {
            if (seq === this._loadSeq) {
                this.error = this.messageOf(err);
            }
        } finally {
            if (seq === this._loadSeq) {
                this.loading = false;
            }
        }
    }

    /**
     * Salesforce has already stored the files by the time this fires. Push each
     * one to ServiceNow in turn rather than in parallel: every push is a
     * callout, and Apex allows a hundred per transaction but only one file's
     * worth of heap at a time.
     */
    async handleUploadFinished(event) {
        const files = event.detail.files || [];
        if (!files.length) {
            return;
        }
        if (!this.sysId) {
            this.toast('Not sent to ServiceNow',
                'This task carries no ServiceNow sys_id, so the file is stored in ' +
                'Salesforce only.', 'warning');
            await this.load();
            return;
        }

        this.uploading = true;
        const failures = [];

        for (const file of files) {
            try {
                await pushEvidence({
                    taskSysId: this.sysId,
                    contentDocumentId: file.documentId
                });
            } catch (err) {
                failures.push(this.messageOf(err));
            }
        }

        this.uploading = false;
        await this.load();

        if (failures.length) {
            this.toast('Stored in Salesforce, not in ServiceNow',
                failures.join(' '), 'error');
        } else {
            const noun = files.length === 1 ? 'file' : 'files';
            this.toast('Evidence attached',
                files.length + ' ' + noun + ' stored in Salesforce and in ServiceNow.',
                'success');
        }
    }

    /**
     * The attestation gate lives in ServiceNow and counts the ServiceNow copy,
     * so that is the count reported upward. A file sitting in Salesforce alone
     * does not unlock an attestation and must not look as though it does.
     */
    announceCount() {
        this.dispatchEvent(new CustomEvent('evidencecount', {
            detail: { sysId: this.sysId, count: this.serviceNowFiles.length },
            bubbles: true,
            composed: true
        }));
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

    /**
     * Reload pressed. Reads both lists again - for a file attached in
     * ServiceNow directly, which nothing here would otherwise notice.
     */
    handleReload() {
        if (!this.loading && !this.uploading) {
            this.load();
        }
    }

    /** @returns {boolean} no reload while a read or an upload is in flight, or with nothing to read */
    get reloadDisabled() {
        return this.loading || this.uploading || (!this.recordId && !this.sysId);
    }

    get showUpload() {
        return !this.hideUpload;
    }

    get uploadDisabled() {
        return !this.recordId || this.uploading;
    }

    /**
     * An approver looking at an empty list is being told something different
     * from an owner looking at one: there is nothing here to judge, rather than
     * nothing here yet.
     */
    get emptyServiceNowMessage() {
        return this.hideUpload
            ? 'Nothing attached in ServiceNow. There is no evidence to review.'
            : 'Nothing attached in ServiceNow. This task cannot be attested until there is.';
    }

    get subheading() {
        return this.hideUpload
            ? 'Held in Salesforce for preview and in ServiceNow as the audit copy.'
            : 'Stored in Salesforce for preview and in ServiceNow as the audit copy. ' +
              'Up to ' + this.maxLabel + ' per file.';
    }

    get hasSalesforceFiles() {
        return this.salesforceFiles.length > 0;
    }

    get hasServiceNowFiles() {
        return this.serviceNowFiles.length > 0;
    }

    get sfCount() {
        return this.salesforceFiles.length;
    }

    get snCount() {
        return this.serviceNowFiles.length;
    }

    get maxLabel() {
        return Math.round(this.maxBytes / 1048576 * 10) / 10 + ' MB';
    }

    get heading() {
        return this.number ? 'Evidence — ' + this.number : 'Evidence';
    }

    /**
     * The one state worth calling out: the two systems hold different numbers
     * of files. Not drift in the Sync Health sense - there is no value to
     * disagree about - and the gate counts the ServiceNow side.
     */
    get mismatch() {
        return this._loaded
            && !this.serviceNowError
            && this.salesforceFiles.length !== this.serviceNowFiles.length;
    }

    /**
     * The advice depends on which side is short. Salesforce holding more means
     * a push failed, and re-uploading is the repair. ServiceNow holding more
     * means the system of record already has the file - usually one attached
     * there directly - and re-uploading would only add another copy to it.
     */
    get mismatchLabel() {
        const counts = this.salesforceFiles.length + ' in Salesforce, ' +
                       this.serviceNowFiles.length + ' in ServiceNow. ';
        if (this.salesforceFiles.length > this.serviceNowFiles.length) {
            return counts + 'A file did not reach ServiceNow. Re-upload it to send ' +
                   'it to the system of record.';
        }
        return counts + 'ServiceNow, the system of record, already holds every ' +
               'file. Nothing needs uploading again.';
    }
}
