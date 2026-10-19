import { createElement } from 'lwc';
import CafApprovals from 'c/cafApprovals';
import getQueue from '@salesforce/apex/CafApprovalsController.getQueue';
import getRecentDecisions from '@salesforce/apex/CafApprovalsController.getRecentDecisions';

jest.mock(
    '@salesforce/apex/CafApprovalsController.getQueue',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafApprovalsController.getRecentDecisions',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
// The review panel mounts these; nothing here opens it, but the imports resolve.
jest.mock('@salesforce/apex/CafEvidenceService.getEvidence', () => ({ default: jest.fn(() => Promise.resolve({ salesforce: [], serviceNow: [] })) }), { virtual: true });
jest.mock('@salesforce/apex/CafEvidenceService.pushEvidence', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/CafAttestationService.attest', () => ({ default: jest.fn() }), { virtual: true });

function iso(offsetDays) {
    const d = new Date(Date.now() + offsetDays * 86400000);
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function task(n, app, due, overrides = {}) {
    return {
        Id: 'a0' + n,
        SN_Number__c: 'CAFT000000' + n,
        Short_Description__c: 'Attach evidence ' + n,
        State__c: 'In Progress',
        ServiceNow_Sys_Id__c: 'sys' + n,
        Planned_Completion_Date__c: due,
        CAF_Request__r: { SN_Number__c: 'RCAF000000' + n, Business_Application__c: app, CAF_Control__c: 'Backup' },
        ...overrides
    };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(queue, decisions = []) {
    const el = createElement('c-caf-approvals', { is: CafApprovals });
    document.body.appendChild(el);
    getQueue.emit(queue);
    getRecentDecisions.emit(decisions);
    await flush();
    return el;
}

const queueRows = (el) => el.shadowRoot.querySelectorAll('table.queue tbody tr');

describe('c-caf-approvals', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('counts the queue and flags tasks past their due date', async () => {
        const el = await render([task(1, 'CRM', iso(-3)), task(2, 'CRM', iso(5)), task(3, 'HR', null)]);

        const values = Array.from(el.shadowRoot.querySelectorAll('.tile__value')).map((t) => t.textContent);
        expect(values[0]).toBe('3');
        expect(values[1]).toBe('1');
        expect(el.shadowRoot.querySelector('.due--late').textContent).toContain('3d overdue');
        expect(el.shadowRoot.querySelector('.due--none').textContent).toBe('No date');
    });

    it('filters the queue by application and by search text', async () => {
        const el = await render([task(1, 'CRM', null), task(2, 'HR', null), task(3, 'HR', null)]);
        expect(queueRows(el)).toHaveLength(3);

        const select = el.shadowRoot.querySelector('select');
        select.value = 'HR';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(queueRows(el)).toHaveLength(2);

        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = 'CAFT0000003';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(queueRows(el)).toHaveLength(1);
    });

    it('cannot review a task with no ServiceNow sys_id', async () => {
        const el = await render([task(1, 'CRM', null, { ServiceNow_Sys_Id__c: null })]);
        expect(el.shadowRoot.querySelector('table.queue button').disabled).toBe(true);
    });

    it('opens the review panel read-only for evidence', async () => {
        const el = await render([task(1, 'CRM', null)]);
        el.shadowRoot.querySelector('table.queue button').click();
        await flush();

        const evidence = el.shadowRoot.querySelector('c-caf-evidence');
        expect(evidence).not.toBeNull();
        expect(evidence.hideUpload).toBe(true);
        expect(el.shadowRoot.querySelector('c-caf-attestation').taskNumber).toBe('CAFT0000001');
    });

    it('labels recent decisions', async () => {
        const el = await render([], [
            task(7, 'CRM', null, { Approval__c: 'approved', LastModifiedDate: '2026-10-01T10:00:00.000Z' }),
            task(8, 'CRM', null, { Approval__c: 'rejected', LastModifiedDate: '2026-10-02T10:00:00.000Z' })
        ]);

        const pills = Array.from(el.shadowRoot.querySelectorAll('.pill')).map((p) => p.textContent);
        expect(pills).toEqual(['Approved', 'Rejected']);
        expect(el.shadowRoot.textContent).toContain('Nothing is waiting on an attestation');
    });
});
