import { LightningElement, wire } from 'lwc';
import { refreshApex } from '@salesforce/apex';
import getOverview from '@salesforce/apex/CafAdminController.getOverview';

/**
 * Integration administration, read-only.
 *
 * Settings live in custom metadata and controls are owned by ServiceNow, so
 * this screen shows what is in force and where to change it rather than
 * offering a second way to change either. Sync Health - the one admin action
 * that does write - stays in the strip above every screen.
 */
export default class CafAdmin extends LightningElement {
    overview;
    error;
    failuresOnly = false;

    wiredOverview;

    @wire(getOverview)
    handleOverview(result) {
        this.wiredOverview = result;
        if (result.data) {
            this.overview = result.data;
            this.error = undefined;
        } else if (result.error) {
            this.error = this.messageOf(result.error);
        }
    }

    get loading() {
        return !this.overview && !this.error;
    }

    // ------------------------------------------------------------ settings

    /**
     * A setting is flagged when what CafConfig uses is not what is stored:
     * no record, a blank value, or a value the code clamps or cannot convert.
     */
    get settings() {
        return ((this.overview && this.overview.settings) || []).map((s) => {
            const configured = s.configured === null || s.configured === undefined ? '' : String(s.configured).trim();
            let flag = '';
            let flagClass = '';
            if (!s.hasRecord) {
                flag = 'No record - default in use';
                flagClass = 'pill pill--amber';
            } else if (!configured) {
                flag = 'Blank - default in use';
                flagClass = 'pill pill--amber';
            } else if (configured !== String(s.effective)) {
                flag = 'Adjusted by CafConfig';
                flagClass = 'pill pill--blue';
            }
            return { ...s, configuredLabel: configured || '-', flag, flagClass, hasFlag: !!flag };
        });
    }

    // ------------------------------------------------------------ controls

    get controls() {
        return ((this.overview && this.overview.controls) || []).map((c) => {
            let note = '';
            if (!c.active && c.requests > 0) {
                note = 'Inactive but still has requests - they render under no column in the grid';
            } else if (c.active && c.requests === 0) {
                note = 'No requests yet - the grid shows N/A down this column';
            } else if (!c.sysId) {
                note = 'No ServiceNow sys_id - requests can only join on the name';
            }
            return {
                ...c,
                key: c.sysId || c.name,
                activeLabel: c.active ? 'Active' : 'Inactive',
                activeClass: c.active ? 'pill pill--green' : 'pill pill--none',
                note
            };
        });
    }

    get activeControlCount() {
        return this.controls.filter((c) => c.active).length;
    }

    get hasControls() {
        return this.controls.length > 0;
    }

    // ---------------------------------------------------------- callout log

    get logAccess() {
        return !!(this.overview && this.overview.logAccess);
    }

    get allCalls() {
        return ((this.overview && this.overview.calls) || []).map((c) => ({
            ...c,
            when: c.Called_At__c ? c.Called_At__c.replace('T', ' ').slice(0, 19) : '',
            by: c.Requested_By__r ? c.Requested_By__r.Name : '',
            resultLabel: c.Succeeded__c ? 'OK' : 'Failed',
            resultClass: c.Succeeded__c ? 'pill pill--green' : 'pill pill--red',
            latency: c.Latency_Ms__c === null || c.Latency_Ms__c === undefined ? '' : c.Latency_Ms__c + ' ms',
            code: c.Status_Code__c === null || c.Status_Code__c === undefined ? '-' : c.Status_Code__c
        }));
    }

    get calls() {
        return this.failuresOnly ? this.allCalls.filter((c) => !c.Succeeded__c) : this.allCalls;
    }

    get hasCalls() {
        return this.calls.length > 0;
    }

    /** Figures over the rows shown in the log, which is the most recent 50. */
    get callStats() {
        const calls = this.allCalls;
        const failed = calls.filter((c) => !c.Succeeded__c).length;
        const timed = calls.map((c) => c.Latency_Ms__c).filter((n) => typeof n === 'number');
        const avg = timed.length ? Math.round(timed.reduce((a, b) => a + b, 0) / timed.length) : null;
        const sorted = [...timed].sort((a, b) => a - b);
        const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] : null;
        return {
            total: calls.length,
            failed,
            successRate: calls.length ? Math.round(((calls.length - failed) / calls.length) * 100) + '%' : '-',
            avg: avg === null ? '-' : avg + ' ms',
            p95: p95 === null ? '-' : p95 + ' ms',
            failedClass: failed ? 'tile__value tile__value--red' : 'tile__value'
        };
    }

    handleFailuresOnly(event) {
        this.failuresOnly = event.target.checked;
    }

    async handleRefresh() {
        if (this.wiredOverview) {
            await refreshApex(this.wiredOverview);
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
}
