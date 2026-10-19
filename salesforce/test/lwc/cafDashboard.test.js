import { createElement } from 'lwc';
import CafDashboard from 'c/cafDashboard';
import getControls from '@salesforce/apex/CafDashboardController.getControls';
import getRequests from '@salesforce/apex/CafDashboardController.getRequests';
import check from '@salesforce/apex/CafSyncHealth.check';

jest.mock(
    '@salesforce/apex/CafDashboardController.getControls',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafDashboardController.getRequests',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafTaskService.getTasks',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafTaskService.applyChange',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
// The sync strip renders inside the dashboard and checks on connect.
jest.mock(
    '@salesforce/apex/CafSyncHealth.check',
    () => ({ default: jest.fn() }),
    { virtual: true }
);
jest.mock(
    '@salesforce/apex/CafSyncHealth.resync',
    () => ({ default: jest.fn() }),
    { virtual: true }
);

const CONTROLS = ['BCP', 'DRP', 'Backup', 'Access', 'Patching', 'Logging'].map((name, i) => ({
    Name: name,
    ServiceNow_Sys_Id__c: 'ctl' + i
}));

let seq = 0;
function request(app, controlIndex, status, overrides = {}) {
    seq += 1;
    return {
        Business_Application__c: app,
        CAF_Control_Sys_Id__c: 'ctl' + controlIndex,
        CAF_Control__c: CONTROLS[controlIndex].Name,
        CAF_Status__c: status,
        ServiceNow_Sys_Id__c: 'req' + seq,
        SN_Number__c: 'CAFR' + String(seq).padStart(7, '0'),
        ...overrides
    };
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function render(controls, requests) {
    const el = createElement('c-caf-dashboard', { is: CafDashboard });
    document.body.appendChild(el);
    getControls.emit(controls);
    getRequests.emit(requests);
    await flush();
    return el;
}

/** Overall label per application, in the order the grid renders them. */
function overall(el) {
    const rows = el.shadowRoot.querySelectorAll('tbody tr');
    return Array.from(rows).map((tr) => ({
        app: tr.querySelector('th').textContent,
        label: tr.querySelector('.grid__overall span').textContent,
        className: tr.querySelector('.grid__overall span').className,
        na: tr.querySelectorAll('.na').length
    }));
}

describe('c-caf-dashboard roll-up', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-010 - CAF-78: N/A controls stay out of the denominator
    it('reads Compliant when every control the app has a request for is compliant', async () => {
        const el = await render(CONTROLS, [
            request('Payroll', 0, 'in_compliance'),
            request('Payroll', 1, 'in_compliance')
        ]);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(row.className).toContain('pill--green');
        expect(row.na).toBe(4);
    });

    // TC-UNIT-011 - the CAF-175 shape: 2 of 6 compliant must not read Compliant
    it('reads "2 of 6" when four of six assessed controls are out of compliance', async () => {
        const statuses = ['in_compliance', 'in_compliance', 'out_of_compliance',
            'out_of_compliance', 'out_of_compliance', 'out_of_compliance'];
        const el = await render(CONTROLS, statuses.map((s, i) => request('SAP HANA', i, s)));

        const [row] = overall(el);
        expect(row.label).toBe('2 of 6');
        expect(row.className).toContain('pill--amber');
    });

    // TC-UNIT-012
    it('counts approaching-due and exception-approved as not compliant', async () => {
        const el = await render(CONTROLS, [
            request('CRM', 0, 'in_compliance'),
            request('CRM', 1, 'approaching_due'),
            request('CRM', 2, 'archer_exception_approved')
        ]);

        expect(overall(el)[0].label).toBe('1 of 3');
    });

    // TC-UNIT-013 - a request pushed before CAF_Control_Sys_Id__c existed
    it('joins a request on the control name when it has no control sys_id', async () => {
        const el = await render(CONTROLS, [
            request('Legacy', 0, 'in_compliance', { CAF_Control_Sys_Id__c: null })
        ]);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(row.na).toBe(5);
    });

    // TC-UNIT-014 - adding a control in ServiceNow is not a scoring change
    it('keeps an app Compliant when a new control with no requests is added', async () => {
        const reqs = [request('Payroll', 0, 'in_compliance')];
        const withNew = [...CONTROLS, { Name: 'Encryption', ServiceNow_Sys_Id__c: 'ctl6' }];
        const el = await render(withNew, reqs);

        const [row] = overall(el);
        expect(row.label).toBe('Compliant');
        expect(el.shadowRoot.querySelectorAll('thead th.grid__control')).toHaveLength(7);
    });

    // TC-UNIT-015
    it('sorts applications by name', async () => {
        const el = await render(CONTROLS, [
            request('Zeta', 0, 'in_compliance'),
            request('alpha', 0, 'in_compliance'),
            request('Mid', 0, 'in_compliance')
        ]);

        expect(overall(el).map((r) => r.app)).toEqual(['alpha', 'Mid', 'Zeta']);
    });

    // TC-UNIT-016 - the grid waits for both wires
    it('stays on the loading message until both wires have answered', async () => {
        const el = createElement('c-caf-dashboard', { is: CafDashboard });
        document.body.appendChild(el);
        getRequests.emit([request('Payroll', 0, 'in_compliance')]);
        await flush();

        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
        expect(el.shadowRoot.textContent).toContain('Loading compliance data');
    });

    // TC-UNIT-017
    it('shows the error when a wire fails', async () => {
        const el = createElement('c-caf-dashboard', { is: CafDashboard });
        document.body.appendChild(el);
        getControls.error({ message: 'Insufficient access' });
        await flush();

        expect(el.shadowRoot.querySelector('.caf__msg--error')).not.toBeNull();
    });
});

// The other screens mount only when selected; their wires are stubbed here so
// switching to them renders without an org.
jest.mock(
    '@salesforce/apex/CafReportsController.getTaskSummary',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

describe('c-caf-dashboard screens', () => {
    beforeEach(() => {
        check.mockResolvedValue({ differences: [] });
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('opens on Compliance with four screen tabs', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);
        const tabs = Array.from(el.shadowRoot.querySelectorAll('.views__tab'));

        expect(tabs.map((t) => t.textContent)).toEqual(['Compliance', 'Approvals', 'Reports', 'Admin']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect(el.shadowRoot.querySelector('table.grid')).not.toBeNull();
    });

    it('swaps the grid for the selected screen and back', async () => {
        const el = await render(CONTROLS, [request('Payroll', 0, 'in_compliance')]);

        el.shadowRoot.querySelector('[data-view="reports"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('table.grid')).toBeNull();
        expect(el.shadowRoot.querySelector('c-caf-reports')).not.toBeNull();

        el.shadowRoot.querySelector('[data-view="compliance"]').click();
        await flush();
        expect(el.shadowRoot.querySelector('table.grid')).not.toBeNull();
        expect(el.shadowRoot.querySelector('c-caf-reports')).toBeNull();
    });
});
