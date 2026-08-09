import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import check from '@salesforce/apex/CafSyncHealth.check';
import resync from '@salesforce/apex/CafSyncHealth.resync';

/**
 * Sync Health.
 *
 * Shows whether the compliance grid above it is telling the truth, by asking
 * ServiceNow for its own view and comparing.
 *
 * There is no wire adapter here on purpose: the Apex behind it makes a callout,
 * and a method that makes a callout cannot be cacheable. Every render and every
 * press of Re-check goes and looks, which is the only way the answer means
 * anything.
 */
export default class CafSyncHealth extends LightningElement {
    report;
    error;
    loading = true;
    busy = false;

    connectedCallback() {
        this.run();
    }

    async run() {
        this.loading = true;
        this.error = undefined;
        try {
            this.report = await check();
        } catch (err) {
            this.error = this.messageOf(err);
            this.report = undefined;
        } finally {
            this.loading = false;
        }
    }

    handleRecheck() {
        this.run();
    }

    async handleResync(event) {
        const { type, sysid, number } = event.currentTarget.dataset;
        this.busy = true;
        try {
            await resync({ recordType: type, sysId: sysid });
            this.toast('Re-pushed to Salesforce', number + ' was sent again from ServiceNow.', 'success');
            await this.run();
        } catch (err) {
            this.toast('Re-sync failed', this.messageOf(err), 'error');
        } finally {
            this.busy = false;
        }
    }

    /**
     * Differences arrive flat from Apex. The template needs a stable key and a
     * couple of display-only flags, so they are decorated here rather than
     * shaping the Apex return around one component's markup.
     */
    get differences() {
        if (!this.report || !this.report.differences) {
            return [];
        }
        return this.report.differences.map((d, i) => ({
            ...d,
            key: d.recordType + '|' + d.recordNumber + '|' + d.fieldLabel + '|' + i,
            showValues: !!d.fieldLabel,
            resyncDisabled: this.busy || !d.canResync
        }));
    }

    get hasReport() {
        return !!this.report && !this.error;
    }

    get inSync() {
        return this.hasReport && this.report.inSync;
    }

    get hasDrift() {
        return this.hasReport && !this.report.inSync;
    }

    get statusDot() {
        return this.inSync ? 'dot dot--green' : 'dot dot--red';
    }

    get headline() {
        if (!this.hasReport) {
            return '';
        }
        if (this.report.inSync) {
            return 'In sync';
        }
        const n = this.report.differences.length;
        return n === 1 ? '1 difference found' : n + ' differences found';
    }

    get summary() {
        if (!this.hasReport) {
            return '';
        }
        const r = this.report;
        // Controls are appended rather than assumed: an older ServiceNow snapshot
        // resource returns no controls array, and the class then leaves snControls
        // null rather than zero. Printing "· 0 controls" in that case would claim
        // the catalogue was checked and found empty, when it was not checked.
        const parts = [
            `${r.comparedCount} records verified`,
            `${r.snRequests} requests`,
            `${r.snTasks} tasks`,
        ];
        if (r.snControls !== null && r.snControls !== undefined) {
            parts.push(`${r.snControls} controls`);
        }
        return parts.join(' · ');
    }

    get checkedAtLabel() {
        if (!this.hasReport) {
            return '';
        }
        return new Date(this.report.checkedAt).toLocaleTimeString();
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
}
