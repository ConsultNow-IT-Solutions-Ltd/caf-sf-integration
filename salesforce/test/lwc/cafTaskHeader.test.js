import { createElement } from 'lwc';
import CafTaskHeader, { daysUntil } from 'c/cafTaskHeader';
import { getRecord } from 'lightning/uiRecordApi';
import applyChange from '@salesforce/apex/CafTaskService.applyChange';

jest.mock(
    '@salesforce/apex/CafTaskService.applyChange',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

// The transformer reads a custom permission once, at import, so one value per
// file. A user without CAF_Work_Tasks is refused on the server (CafAccessTest).
jest.mock('@salesforce/customPermission/CAF_Work_Tasks', () => ({ default: true }), { virtual: true });

const DAY_MS = 86400000;
const isoIn = (days) => new Date(Date.now() + days * DAY_MS).toISOString();

const task = (state, due, sysId = 'abc') => ({
    apiName: 'CAF_Task__c',
    id: 'a01000000000001AAA',
    fields: {
        Name: { value: 'CAFT0001001' },
        State__c: { value: state },
        Approval__c: { value: 'requested' },
        Planned_Completion_Date__c: { value: due },
        ServiceNow_Sys_Id__c: { value: sysId },
        Short_Description__c: { value: 'Evidence the backup policy' }
    }
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(record) {
    const el = createElement('c-caf-task-header', { is: CafTaskHeader });
    el.recordId = 'a01000000000001AAA';
    document.body.appendChild(el);
    getRecord.emit(record);
    await flush();
    return el;
}

const text = (el, sel) => {
    const n = el.shadowRoot.querySelector(sel);
    return n ? n.textContent : null;
};

afterEach(() => {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
});

describe('daysUntil', () => {
    it('counts calendar days and goes negative when past', () => {
        const now = new Date(2026, 9, 21, 23, 0);
        expect(daysUntil(new Date(2026, 9, 22, 1, 0).toISOString(), now)).toBe(1);
        expect(daysUntil(new Date(2026, 9, 19, 12, 0).toISOString(), now)).toBe(-2);
        expect(daysUntil(null, now)).toBeNull();
        expect(daysUntil('not a date', now)).toBeNull();
    });
});

describe('c-caf-task-header', () => {
    it('marks the current step and the ones before it', async () => {
        const el = await render(task('In Progress', isoIn(10)));
        const steps = Array.from(el.shadowRoot.querySelectorAll('.step'));
        expect(steps.map((s) => s.textContent)).toEqual(['Open', 'In Progress', 'Closed Complete']);
        expect(steps[0].className).toContain('step--done');
        expect(steps[1].className).toContain('step--current');
        expect(steps[1].getAttribute('aria-current')).toBe('step');
        expect(steps[2].className).toContain('step--todo');
    });

    it('ends the path with Cancelled for a cancelled task, and owes nothing', async () => {
        const el = await render(task('Cancelled', isoIn(-3)));
        const steps = Array.from(el.shadowRoot.querySelectorAll('.step'));
        expect(steps[2].textContent).toBe('Cancelled');
        expect(steps[2].className).toContain('step--cancelled');
        expect(el.shadowRoot.querySelector('.due')).toBeNull();
    });

    it('counts down, and flags overdue', async () => {
        let el = await render(task('Open', isoIn(3)));
        expect(text(el, '.due')).toBe('Due in 3 days');
        document.body.removeChild(el);

        el = await render(task('Open', isoIn(-2)));
        expect(text(el, '.due--late')).toBe('2 days overdue');
    });

    it('offers Start only on an open task with a sys_id', async () => {
        let el = await render(task('Open', isoIn(3)));
        expect(el.shadowRoot.querySelector('.btn')).not.toBeNull();
        document.body.removeChild(el);

        el = await render(task('In Progress', isoIn(3)));
        expect(el.shadowRoot.querySelector('.btn')).toBeNull();
        document.body.removeChild(el);

        el = await render(task('Open', isoIn(3), null));
        expect(el.shadowRoot.querySelector('.btn')).toBeNull();
    });

    it('Start sends state 2 to ServiceNow', async () => {
        applyChange.mockResolvedValue('{}');
        const el = await render(task('Open', isoIn(3)));
        el.shadowRoot.querySelector('.btn').click();
        await flush();
        expect(applyChange).toHaveBeenCalledWith({ sysId: 'abc', field: 'state', value: '2' });
    });

    it('shows the load error', async () => {
        const el = createElement('c-caf-task-header', { is: CafTaskHeader });
        el.recordId = 'a01000000000001AAA';
        document.body.appendChild(el);
        getRecord.error({ message: 'Insufficient access' });
        await flush();
        expect(text(el, '.msg--error')).toBe('Insufficient access');
    });
});
