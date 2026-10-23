import { createElement } from 'lwc';
import CafTaskTimeline, { timelineOf } from 'c/cafTaskTimeline';
import { getRecord } from 'lightning/uiRecordApi';
import getTasks from '@salesforce/apex/CafTaskService.getTasks';

jest.mock(
    '@salesforce/apex/CafTaskService.getTasks',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const NOW = new Date('2026-10-21T12:00:00Z');
const task = (n, state, due, approval) => ({
    Id: 'a01' + n,
    SN_Number__c: 'CAFT000000' + n,
    Short_Description__c: 'Task ' + n,
    State__c: state,
    Approval__c: approval,
    Planned_Completion_Date__c: due
});

const REQUEST = {
    apiName: 'CAF_Request__c',
    fields: { ServiceNow_Sys_Id__c: { value: 'req1' } }
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(tasks) {
    const el = createElement('c-caf-task-timeline', { is: CafTaskTimeline });
    el.recordId = 'a00000000000001AAA';
    document.body.appendChild(el);
    getRecord.emit(REQUEST);
    await flush();
    if (tasks) {
        getTasks.emit(tasks);
        await flush();
    }
    return el;
}

afterEach(() => {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
});

describe('timelineOf', () => {
    it('flags open tasks past due, never closed ones', () => {
        const rows = timelineOf(
            [
                task(1, 'Open', '2026-10-20T09:00:00Z'),
                task(2, 'Closed Complete', '2026-10-01T09:00:00Z', 'approved'),
                task(3, 'In Progress', '2026-11-01T09:00:00Z'),
                task(4, 'Open', null)
            ],
            NOW
        );
        expect(rows.map((r) => r.overdue)).toEqual([true, false, false, false]);
        expect(rows[0].itemClass).toContain('entry--late');
        expect(rows[1].itemClass).toContain('entry--closed');
        expect(rows[1].stateClass).toContain('badge--green');
        expect(rows[0].due).toBe('2026-10-20');
        expect(rows[3].due).toBeNull();
    });
});

describe('c-caf-task-timeline', () => {
    it('asks for the tasks of the request it is on', async () => {
        await render();
        expect(getTasks.getLastConfig()).toEqual({ requestExternalId: 'req1' });
    });

    it('lists the tasks with a summary', async () => {
        const el = await render([
            task(1, 'Closed Complete', '2026-10-01T09:00:00Z', 'approved'),
            task(2, 'Open', '2099-01-01T09:00:00Z')
        ]);
        const entries = el.shadowRoot.querySelectorAll('.entry');
        expect(entries.length).toBe(2);
        expect(el.shadowRoot.querySelector('.view__sub').textContent).toBe('2 tasks · 1 closed');
        expect(entries[0].querySelector('.link').textContent).toBe('CAFT0000001');
    });

    it('says so when there are no tasks', async () => {
        const el = await render([]);
        expect(el.shadowRoot.querySelector('.msg').textContent).toContain('not created any tasks');
    });

    it('shows the error when the tasks cannot be read', async () => {
        const el = await render();
        getTasks.error({ message: 'Insufficient access' });
        await flush();
        expect(el.shadowRoot.querySelector('.msg--error').textContent).toBe('Insufficient access');
    });
});
