import { createElement } from 'lwc';
import CafApprovals from 'c/cafApprovals';
import getQueue from '@salesforce/apex/CafApprovalsController.getQueue';
import getRecentDecisions from '@salesforce/apex/CafApprovalsController.getRecentDecisions';
import getEvidence from '@salesforce/apex/CafEvidenceService.getEvidence';
import { refreshApex } from '@salesforce/apex';

jest.mock('@salesforce/apex', () => ({ refreshApex: jest.fn(() => Promise.resolve()) }), { virtual: true });

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

    // TC-UNIT-100
    it('labels due dates today, within a week and further out', async () => {
        const el = await render([task(1, 'CRM', iso(0)), task(2, 'CRM', iso(3)), task(3, 'CRM', iso(30))]);
        const due = Array.from(queueRows(el)).map((r) => r.querySelector('td:nth-child(6) span'));

        expect(due[0].textContent).toBe(iso(0) + ' (today)');
        expect(due[0].className).toBe('due due--soon');
        expect(due[1].textContent).toBe(iso(3) + ' (3d)');
        expect(due[1].className).toBe('due due--soon');
        expect(due[2].textContent).toBe(iso(30));
        expect(due[2].className).toBe('due');
        expect(el.shadowRoot.querySelectorAll('.tile__value')[1].textContent).toBe('0');
    });

    // TC-UNIT-101
    it('lists each application once, sorted, after "All applications"', async () => {
        const el = await render([task(1, 'HR', null), task(2, 'CRM', null), task(3, 'HR', null), task(4, '', null)]);
        const options = Array.from(el.shadowRoot.querySelectorAll('select option')).map((o) => o.textContent);

        expect(options).toEqual(['All applications', 'CRM', 'HR']);
    });

    // TC-UNIT-102
    it('tells a filtered-out queue apart from an empty one', async () => {
        const el = await render([task(1, 'CRM', iso(10))]);
        const box = el.shadowRoot.querySelector('input.filters__overdue');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(queueRows(el)).toHaveLength(0);
        expect(el.shadowRoot.textContent).toContain('No tasks match the filter.');
        expect(el.shadowRoot.textContent).not.toContain('Nothing is waiting on an attestation');
    });
});

describe('c-caf-approvals review panel', () => {
    // Held pending so cafEvidence never announces a count of its own; every
    // count these tests see is one they sent.
    beforeEach(() => {
        getEvidence.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        getEvidence.mockImplementation(() => Promise.resolve({ salesforce: [], serviceNow: [] }));
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const reviewButton = (el, n) => el.shadowRoot.querySelector('button[data-number="CAFT000000' + n + '"]');

    // TC-UNIT-103
    it('highlights the row under review and Done closes the panel', async () => {
        const el = await render([task(1, 'CRM', null), task(2, 'CRM', null)]);
        reviewButton(el, 2).click();
        await flush();

        expect(el.shadowRoot.querySelector('.review__title').textContent).toBe('Attest CAFT0000002');
        expect(queueRows(el)[0].className).toBe('tasks__row');
        expect(queueRows(el)[1].className).toBe('tasks__row tasks__row--active');

        el.shadowRoot.querySelector('.review__head button').click();
        await flush();

        expect(el.shadowRoot.querySelector('section.review')).toBeNull();
        expect(el.shadowRoot.querySelector('.tasks__row--active')).toBeNull();
    });

    // TC-UNIT-104
    it('passes the evidence count to attestation only for the task under review', async () => {
        const el = await render([task(1, 'CRM', null)]);
        reviewButton(el, 1).click();
        await flush();

        const evidence = el.shadowRoot.querySelector('c-caf-evidence');
        const attestation = () => el.shadowRoot.querySelector('c-caf-attestation');

        evidence.dispatchEvent(new CustomEvent('evidencecount', { detail: { sysId: 'sys-other', count: 4 } }));
        await flush();
        expect(attestation().evidenceCount).toBeUndefined();

        evidence.dispatchEvent(new CustomEvent('evidencecount', { detail: { sysId: 'sys1', count: 2 } }));
        await flush();
        expect(attestation().evidenceCount).toBe(2);

        evidence.dispatchEvent(new CustomEvent('evidencecount', { detail: { sysId: 'sys1', count: '2' } }));
        await flush();
        expect(attestation().evidenceCount).toBeUndefined();
    });

    // TC-UNIT-105
    it('starts the next review with no evidence count carried over', async () => {
        const el = await render([task(1, 'CRM', null), task(2, 'CRM', null)]);
        reviewButton(el, 1).click();
        await flush();
        el.shadowRoot
            .querySelector('c-caf-evidence')
            .dispatchEvent(new CustomEvent('evidencecount', { detail: { sysId: 'sys1', count: 3 } }));
        await flush();
        expect(el.shadowRoot.querySelector('c-caf-attestation').evidenceCount).toBe(3);

        reviewButton(el, 2).click();
        await flush();

        const attestation = el.shadowRoot.querySelector('c-caf-attestation');
        expect(attestation.snSysId).toBe('sys2');
        expect(attestation.evidenceCount).toBeUndefined();
    });
});

describe('c-caf-approvals refresh', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        refreshApex.mockImplementation(() => Promise.resolve());
        jest.clearAllMocks();
    });

    // TC-UNIT-106
    it('Refresh re-reads both the queue and the recent decisions', async () => {
        const el = await render([task(1, 'CRM', null)]);
        el.shadowRoot.querySelector('.view__head button').click();
        await flush();

        expect(refreshApex).toHaveBeenCalledTimes(2);
        const refreshed = refreshApex.mock.calls.map(([w]) => w.data);
        expect(refreshed).toContainEqual([task(1, 'CRM', null)]);
        expect(refreshed).toContainEqual([]);
    });

    // TC-UNIT-107
    it('a decision refreshes the lists and tells the dashboard', async () => {
        const el = await render([task(1, 'CRM', null)]);
        const onChange = jest.fn();
        document.body.addEventListener('cafchange', onChange);
        el.shadowRoot.querySelector('table.queue button').click();
        await flush();

        el.shadowRoot.querySelector('c-caf-attestation').dispatchEvent(new CustomEvent('attested'));
        await flush();

        expect(refreshApex).toHaveBeenCalledTimes(2);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange.mock.calls[0][0].composed).toBe(true);
        document.body.removeEventListener('cafchange', onChange);
    });

    // TC-UNIT-108
    it('shows a failed refresh instead of throwing it', async () => {
        refreshApex.mockImplementation(() => Promise.reject({ body: { message: 'Session expired' } }));
        const el = await render([task(1, 'CRM', null)]);
        el.shadowRoot.querySelector('.view__head button').click();
        await flush();

        expect(el.shadowRoot.querySelector('.msg--error').textContent).toBe('Session expired');
        expect(el.shadowRoot.querySelector('table.queue')).toBeNull();
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

describe('c-caf-approvals filters and tiles', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const search = async (el, value) => {
        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = value;
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
    };

    // TC-UNIT-109
    it('shows the loading message until the queue arrives', async () => {
        const el = createElement('c-caf-approvals', { is: CafApprovals });
        document.body.appendChild(el);
        await flush();
        expect(el.shadowRoot.querySelector('.msg').textContent).toContain('Loading the approval queue');
        expect(el.shadowRoot.querySelector('.filters')).toBeNull();

        getQueue.emit([task(1, 'CRM', null)]);
        await flush();
        expect(el.shadowRoot.textContent).not.toContain('Loading the approval queue');
        expect(queueRows(el)).toHaveLength(1);
    });

    // TC-UNIT-110
    it('searches without regard to case or surrounding spaces, across request and control', async () => {
        const el = await render([
            task(1, 'CRM', null),
            task(2, 'CRM', null, { CAF_Request__r: { SN_Number__c: 'RCAF0000002', Business_Application__c: 'CRM', CAF_Control__c: 'Patching' } })
        ]);

        await search(el, '  rcaf0000001  ');
        expect(queueRows(el)).toHaveLength(1);
        expect(queueRows(el)[0].textContent).toContain('CAFT0000001');

        await search(el, 'PATCH');
        expect(queueRows(el)).toHaveLength(1);
        expect(queueRows(el)[0].textContent).toContain('CAFT0000002');

        await search(el, '   ');
        expect(queueRows(el)).toHaveLength(2);
    });

    // TC-UNIT-111
    it('applies the application and overdue filters together, and All applications undoes the first', async () => {
        const el = await render([task(1, 'CRM', iso(-2)), task(2, 'CRM', iso(6)), task(3, 'HR', iso(-1))]);
        const select = el.shadowRoot.querySelector('select');
        select.value = 'CRM';
        select.dispatchEvent(new CustomEvent('change'));
        const box = el.shadowRoot.querySelector('input.filters__overdue');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(queueRows(el)).toHaveLength(1);
        expect(queueRows(el)[0].textContent).toContain('CAFT0000001');

        select.value = '';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(Array.from(queueRows(el)).map((r) => r.querySelector('td').textContent)).toEqual([
            'CAFT0000001',
            'CAFT0000003'
        ]);
    });

    // TC-UNIT-112
    it('counts approvals and rejections only, and shows the date part of the update time', async () => {
        const el = await render([], [
            task(1, 'CRM', null, { Approval__c: 'approved', LastModifiedDate: '2026-10-01T10:00:00.000Z' }),
            task(2, 'CRM', null, { Approval__c: 'approved', LastModifiedDate: '2026-10-02T10:00:00.000Z' }),
            task(3, 'CRM', null, { Approval__c: 'rejected', LastModifiedDate: '2026-10-03T10:00:00.000Z' }),
            task(4, 'CRM', null, { Approval__c: 'cancelled', LastModifiedDate: '2026-10-04T10:00:00.000Z' })
        ]);

        const values = Array.from(el.shadowRoot.querySelectorAll('.tile__value')).map((t) => t.textContent);
        expect(values[2]).toBe('2');
        expect(values[3]).toBe('1');
        const firstRow = el.shadowRoot.querySelector('table.tasks:not(.queue) tbody tr');
        expect(firstRow.lastElementChild.textContent).toBe('2026-10-01');
    });

    // TC-UNIT-113
    it('shows a queue that fails to load as an error, with no filters or table', async () => {
        const el = createElement('c-caf-approvals', { is: CafApprovals });
        document.body.appendChild(el);
        getQueue.error({ message: 'Insufficient access to CAF_Task__c' });
        getRecentDecisions.emit([]);
        await flush();

        expect(el.shadowRoot.querySelector('.msg--error').textContent).toBe('Insufficient access to CAF_Task__c');
        expect(el.shadowRoot.querySelector('.filters')).toBeNull();
        expect(el.shadowRoot.querySelector('table.queue')).toBeNull();
        expect(el.shadowRoot.textContent).not.toContain('Loading the approval queue');
    });
});

describe('c-caf-approvals review panel inputs', () => {
    beforeEach(() => {
        getEvidence.mockImplementation(() => new Promise(() => {}));
    });

    afterEach(() => {
        getEvidence.mockImplementation(() => Promise.resolve({ salesforce: [], serviceNow: [] }));
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const reviewButton = (el, n) => el.shadowRoot.querySelector('button[data-number="CAFT000000' + n + '"]');

    // TC-UNIT-114
    it('gives both panels the record, sys_id, state and approval of the task under review', async () => {
        const el = await render([task(1, 'CRM', null, { State__c: 'In Progress', Approval__c: 'requested' })]);
        reviewButton(el, 1).click();
        await flush();

        const evidence = el.shadowRoot.querySelector('c-caf-evidence');
        const attestation = el.shadowRoot.querySelector('c-caf-attestation');
        expect(evidence.recordId).toBe('a01');
        expect(evidence.snSysId).toBe('sys1');
        expect(evidence.taskNumber).toBe('CAFT0000001');
        expect(attestation.recordId).toBe('a01');
        expect(attestation.snSysId).toBe('sys1');
        expect(attestation.taskState).toBe('In Progress');
        expect(attestation.taskApproval).toBe('requested');
    });

    // TC-UNIT-115
    it('keeps the review open when a filter hides its row, and highlights it again when the filter clears', async () => {
        const el = await render([task(1, 'CRM', null), task(2, 'HR', null)]);
        reviewButton(el, 2).click();
        await flush();

        const select = el.shadowRoot.querySelector('select');
        select.value = 'CRM';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(queueRows(el)).toHaveLength(1);
        expect(el.shadowRoot.querySelector('.tasks__row--active')).toBeNull();
        expect(el.shadowRoot.querySelector('.review__title').textContent).toBe('Attest CAFT0000002');

        select.value = '';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(queueRows(el)[1].className).toBe('tasks__row tasks__row--active');
    });

    // TC-UNIT-116
    it('keeps the review open on the same task through a refresh', async () => {
        const el = await render([task(1, 'CRM', null)]);
        reviewButton(el, 1).click();
        await flush();

        el.shadowRoot.querySelector('.view__head button').click();
        await flush();

        expect(refreshApex).toHaveBeenCalledTimes(2);
        expect(el.shadowRoot.querySelector('.review__title').textContent).toBe('Attest CAFT0000001');
        expect(el.shadowRoot.querySelector('c-caf-attestation').snSysId).toBe('sys1');
    });

    // TC-UNIT-117
    it('renders rows with no Id, sys_id or number each once, with Review disabled', async () => {
        const blank = { Short_Description__c: 'No identifiers', CAF_Request__r: { Business_Application__c: 'CRM' } };
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        const el = await render([{ ...blank }, { ...blank }]);

        expect(queueRows(el)).toHaveLength(2);
        expect(consoleError.mock.calls.join(' ')).not.toMatch(/key/i);
        consoleError.mockRestore();
        const buttons = el.shadowRoot.querySelectorAll('table.queue button');
        expect(Array.from(buttons).map((b) => b.disabled)).toEqual([true, true]);

        buttons[0].click();
        await flush();
        expect(el.shadowRoot.querySelector('section.review')).toBeNull();
    });
});

describe('c-caf-approvals clear filters', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const clearButton = (el) => el.shadowRoot.querySelector('button.filters__clear');

    // TC-UNIT-120
    it('Clear filters resets the application, search and overdue filters together', async () => {
        const el = await render([task(1, 'CRM', iso(-1)), task(2, 'HR', iso(-1)), task(3, 'HR', null)]);
        const select = el.shadowRoot.querySelector('select');
        select.value = 'HR';
        select.dispatchEvent(new CustomEvent('change'));
        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = 'zzz';
        input.dispatchEvent(new CustomEvent('input'));
        const box = el.shadowRoot.querySelector('input.filters__overdue');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();
        expect(el.shadowRoot.textContent).toContain('No tasks match the filter.');

        clearButton(el).click();
        await flush();

        expect(queueRows(el)).toHaveLength(3);
        expect(el.shadowRoot.querySelector('select').value).toBe('');
        expect(el.shadowRoot.querySelector('input[type="search"]').value).toBe('');
        expect(el.shadowRoot.querySelector('input.filters__overdue').checked).toBe(false);
        expect(clearButton(el)).toBeNull();
    });

    // TC-UNIT-121
    it('shows Clear filters only while a filter is narrowing the queue', async () => {
        const el = await render([task(1, 'CRM', null)]);
        expect(clearButton(el)).toBeNull();

        const input = el.shadowRoot.querySelector('input[type="search"]');
        input.value = '   ';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(clearButton(el)).toBeNull();

        input.value = 'CAFT';
        input.dispatchEvent(new CustomEvent('input'));
        await flush();
        expect(clearButton(el)).not.toBeNull();
    });
});

describe('c-caf-approvals export', () => {
    let downloads;
    beforeEach(() => {
        downloads = [];
        jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            downloads.push({ name: this.download, text: decodeURIComponent(this.href.split(',').slice(1).join(',')) });
        });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    const exportButton = (el) => el.shadowRoot.querySelector('button.btn--export');

    // TC-UNIT-122
    it('exports only the queue rows the filters leave on screen', async () => {
        const el = await render([
            task(1, 'CRM', iso(-2), { Met_Criteria__c: 'Yes' }),
            task(2, 'HR', iso(5)),
            task(3, 'HR', null)
        ]);
        const select = el.shadowRoot.querySelector('select');
        select.value = 'HR';
        select.dispatchEvent(new CustomEvent('change'));
        await flush();

        exportButton(el).click();
        await flush();

        expect(downloads).toHaveLength(1);
        expect(downloads[0].name).toMatch(/^caf-approvals-\d{4}-\d{2}-\d{2}\.csv$/);
        const lines = downloads[0].text.split('\r\n');
        expect(lines[0]).toBe('Task,Application,Control,Request,Description,Planned completion,Overdue,Criteria met');
        expect(lines).toHaveLength(3);
        expect(lines[1]).toBe('CAFT0000002,HR,Backup,RCAF0000002,Attach evidence 2,' + iso(5) + ',No,');
        expect(lines[2]).toBe('CAFT0000003,HR,Backup,RCAF0000003,Attach evidence 3,,No,');
    });

    // TC-UNIT-123
    it('defuses formulas in the export, and cannot export an empty queue', async () => {
        const el = await render([task(1, 'CRM', iso(-1), { Short_Description__c: '=HYPERLINK("http://x","y")' })]);
        exportButton(el).click();
        await flush();
        expect(downloads[0].text.split('\r\n')[1]).toBe(
            'CAFT0000001,CRM,Backup,RCAF0000001,"\'=HYPERLINK(""http://x"",""y"")",' + iso(-1) + ',Yes,'
        );

        const empty = await render([]);
        expect(exportButton(empty).disabled).toBe(true);
    });
});
