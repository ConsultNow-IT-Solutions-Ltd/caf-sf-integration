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

    // TC-UNIT-030
    it('counts the queue and flags tasks past their due date', async () => {
        const el = await render([task(1, 'CRM', iso(-3)), task(2, 'CRM', iso(5)), task(3, 'HR', null)]);

        const values = Array.from(el.shadowRoot.querySelectorAll('.tile__value')).map((t) => t.textContent);
        expect(values[0]).toBe('3');
        expect(values[1]).toBe('1');
        expect(el.shadowRoot.querySelector('.due--late').textContent).toContain('3d overdue');
        expect(el.shadowRoot.querySelector('.due--none').textContent).toBe('No date');
    });

    // TC-UNIT-031
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

    // TC-UNIT-032
    it('cannot review a task with no ServiceNow sys_id', async () => {
        const el = await render([task(1, 'CRM', null, { ServiceNow_Sys_Id__c: null })]);
        expect(el.shadowRoot.querySelector('table.queue button').disabled).toBe(true);
    });

    // TC-UNIT-033
    it('opens the review panel read-only for evidence', async () => {
        const el = await render([task(1, 'CRM', null)]);
        el.shadowRoot.querySelector('table.queue button').click();
        await flush();

        const evidence = el.shadowRoot.querySelector('c-caf-evidence');
        expect(evidence).not.toBeNull();
        expect(evidence.hideUpload).toBe(true);
        expect(el.shadowRoot.querySelector('c-caf-attestation').taskNumber).toBe('CAFT0000001');
    });

    // TC-UNIT-034
    it('labels recent decisions', async () => {
        const el = await render([], [
            task(7, 'CRM', null, { Approval__c: 'approved', LastModifiedDate: '2026-10-01T10:00:00.000Z' }),
            task(8, 'CRM', null, { Approval__c: 'rejected', LastModifiedDate: '2026-10-02T10:00:00.000Z' })
        ]);

        const pills = Array.from(el.shadowRoot.querySelectorAll('.pill')).map((p) => p.textContent);
        expect(pills).toEqual(['Approved', 'Rejected']);
        expect(el.shadowRoot.textContent).toContain('Nothing is waiting on an attestation');
    });

    // TC-UNIT-035
    it('narrows the queue to overdue tasks', async () => {
        const el = await render([task(1, 'CRM', iso(-1)), task(2, 'CRM', iso(4)), task(3, 'CRM', null)]);
        const box = el.shadowRoot.querySelector('input.filters__overdue');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(queueRows(el)).toHaveLength(1);
        expect(queueRows(el)[0].textContent).toContain('CAFT0000001');
    });

    // TC-UNIT-036
    it('says so when the queue is at the Apex row limit', async () => {
        const many = Array.from({ length: 500 }, (_, i) => task(i + 10, 'CRM', null));
        const el = await render(many);
        expect(el.shadowRoot.querySelector('.msg--warn').textContent).toContain('first 500 tasks');

        const few = await render([task(1, 'CRM', null)]);
        expect(few.shadowRoot.querySelector('.msg--warn')).toBeNull();
    });

    // TC-UNIT-037
    it('keeps the queue when only the decisions list fails', async () => {
        const el = createElement('c-caf-approvals', { is: CafApprovals });
        document.body.appendChild(el);
        getQueue.emit([task(1, 'CRM', null)]);
        getRecentDecisions.error({ message: 'Insufficient access' });
        await flush();

        expect(queueRows(el)).toHaveLength(1);
        expect(el.shadowRoot.querySelector('.msg--error').textContent).toContain('Recent decisions could not be loaded');
    });
});

describe('c-caf-approvals with missing or bad data', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-060
    it('drops null rows and renders a task whose parent request is missing', async () => {
        const orphan = task(1, 'CRM', null);
        delete orphan.CAF_Request__r;
        const el = await render([null, orphan, undefined]);

        expect(queueRows(el)).toHaveLength(1);
        expect(queueRows(el)[0].textContent).not.toContain('undefined');
        expect(queueRows(el)[0].textContent).not.toContain('null');
    });

    // TC-UNIT-061
    it('flags an unparseable due date instead of treating it as on time', async () => {
        const el = await render([task(1, 'CRM', 'not-a-date')]);
        expect(el.shadowRoot.querySelector('.due').textContent).toContain('invalid date');
        expect(el.shadowRoot.querySelectorAll('.tile__value')[1].textContent).toBe('0');
    });

    // TC-UNIT-062
    it('does not match "undefined" against blank fields', async () => {
        const el = await render([task(1, 'CRM', null, { Short_Description__c: null })]);
        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = 'undefined';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();

        expect(queueRows(el)).toHaveLength(0);
    });

    // TC-UNIT-063
    it('shows an unknown approval value as received rather than as Rejected', async () => {
        const el = await render([], [task(9, 'CRM', null, { Approval__c: 'not requested', LastModifiedDate: null })]);
        const pill = el.shadowRoot.querySelector('.pill');
        expect(pill.textContent).toBe('not requested');
        expect(pill.className).toContain('pill--none');
    });
});
