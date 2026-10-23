import { createElement } from 'lwc';
import CafHome, { applicationFigures } from 'c/cafHome';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getTaskFigures from '@salesforce/apex/CafHomeController.getTaskFigures';

jest.mock(
    '@salesforce/apex/CafDashboardController.getRequests',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafDashboardController.getControls',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafHomeController.getTaskFigures',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const CONTROLS = [
    { Name: 'Backup', ServiceNow_Sys_Id__c: 'c0' },
    { Name: 'DRP', ServiceNow_Sys_Id__c: 'c1' }
];

const request = (app, sysId, status, name) => ({
    Business_Application__c: app,
    CAF_Control_Sys_Id__c: sysId,
    CAF_Control__c: name || 'x',
    CAF_Status__c: status
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function render(requests, tasks) {
    const el = createElement('c-caf-home', { is: CafHome });
    document.body.appendChild(el);
    getControls.emit(CONTROLS);
    getRequests.emit(requests);
    if (tasks) {
        getTaskFigures.emit(tasks);
    }
    await flush();
    return el;
}

const value = (el, key) =>
    el.shadowRoot.querySelector('[data-key="' + key + '"] span').textContent;

afterEach(() => {
    while (document.body.firstChild) {
        document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
});

describe('applicationFigures', () => {
    it('counts an app compliant only when every assessed control is', () => {
        const f = applicationFigures(
            [
                request('A', 'c0', 'in_compliance'),
                request('A', 'c1', 'in_compliance'),
                request('B', 'c0', 'in_compliance'),
                request('B', 'c1', 'approaching_due'),
                request('C', 'c0', 'out_of_compliance')
            ],
            CONTROLS
        );
        expect(f).toEqual({ applications: 3, compliant: 1, outOfCompliance: 1 });
    });

    it('leaves out requests for controls that are not columns', () => {
        const f = applicationFigures([request('A', 'retired', 'out_of_compliance', 'Retired')], CONTROLS);
        expect(f.applications).toBe(0);
        expect(f.outOfCompliance).toBe(0);
    });

    it('falls back to the control name when the sys_id is missing', () => {
        const f = applicationFigures([request('A', null, 'in_compliance', 'DRP')], CONTROLS);
        expect(f.compliant).toBe(1);
    });
});

describe('c-caf-home', () => {
    it('shows application and task figures', async () => {
        const el = await render(
            [request('A', 'c0', 'in_compliance'), request('B', 'c0', 'out_of_compliance')],
            { open: 7, overdue: 2, awaitingAttestation: 3 }
        );
        expect(value(el, 'compliant')).toBe('1 of 2');
        expect(value(el, 'out')).toBe('1');
        expect(value(el, 'open')).toBe('7');
        expect(value(el, 'overdue')).toBe('2');
        expect(value(el, 'awaiting')).toBe('3');
    });

    it('keeps the application tiles when the task figures fail', async () => {
        const el = await render([request('A', 'c0', 'in_compliance')]);
        getTaskFigures.error({ message: 'No access to CAF_Task__c' });
        await flush();
        expect(value(el, 'compliant')).toBe('1 of 1');
        expect(value(el, 'open')).toBe('-');
        expect(el.shadowRoot.querySelector('.msg--error').textContent).toContain('No access');
    });

    it('shows the error instead of tiles when the grid rows fail', async () => {
        const el = createElement('c-caf-home', { is: CafHome });
        document.body.appendChild(el);
        getRequests.error({ message: 'Insufficient access' });
        await flush();
        expect(el.shadowRoot.querySelector('.tiles')).toBeNull();
        expect(el.shadowRoot.querySelector('.msg--error').textContent).toBe('Insufficient access');
    });
});
