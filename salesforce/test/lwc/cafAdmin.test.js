import { createElement } from 'lwc';
import CafAdmin from 'c/cafAdmin';
import getOverview from '@salesforce/apex/CafAdminController.getOverview';

jest.mock(
    '@salesforce/apex/CafAdminController.getOverview',
    () => {
        const { createApexTestWireAdapter } = require('@salesforce/sfdx-lwc-jest');
        return { default: createApexTestWireAdapter(jest.fn()) };
    },
    { virtual: true }
);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function overview(overrides = {}) {
    return {
        settings: [
            { name: 'Callout_Timeout_Ms', label: 'Callout Timeout Ms', configured: '999999', effective: '120000', hasRecord: true },
            { name: 'Evidence_Max_Bytes', label: 'Evidence Max Bytes', configured: '2097152', effective: '2097152', hasRecord: true },
            { name: 'Logging_Enabled', label: 'Logging Enabled', configured: null, effective: 'true', hasRecord: false }
        ],
        controls: [
            { name: 'Backup', snNumber: 'CTL1', sysId: 'c1', active: true, requests: 0 },
            { name: 'Retired', snNumber: 'CTL2', sysId: 'c2', active: false, requests: 4 }
        ],
        logAccess: true,
        calls: [
            { Id: 'l1', Name: 'LOG-1', Succeeded__c: true, Latency_Ms__c: 100, Status_Code__c: 200, Called_At__c: '2026-10-19T09:00:00.000Z' },
            { Id: 'l2', Name: 'LOG-2', Succeeded__c: false, Latency_Ms__c: 300, Status_Code__c: 500, Error__c: 'boom', Called_At__c: '2026-10-19T08:00:00.000Z' }
        ],
        ...overrides
    };
}

async function render(data) {
    const el = createElement('c-caf-admin', { is: CafAdmin });
    document.body.appendChild(el);
    getOverview.emit(data);
    await flush();
    return el;
}

describe('c-caf-admin', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('summarises the callout log and filters to failures', async () => {
        const el = await render(overview());
        const values = Array.from(el.shadowRoot.querySelectorAll('.tile__value')).map((t) => t.textContent);
        expect(values).toEqual(['2', '1', '50%', '200 ms', '300 ms']);

        const box = el.shadowRoot.querySelector('input[type="checkbox"]');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        const logRows = el.shadowRoot.querySelectorAll('.scroll')[0].querySelectorAll('tbody tr');
        expect(logRows).toHaveLength(1);
        expect(logRows[0].textContent).toContain('boom');
    });

    it('explains the missing permission instead of failing when the log is not readable', async () => {
        const el = await render(overview({ logAccess: false, calls: [] }));
        expect(el.shadowRoot.textContent).toContain('needs the CAF Admin permission set');
        expect(el.shadowRoot.textContent).toContain('Backup');
    });

    it('flags settings where the value in use is not the value stored', async () => {
        const el = await render(overview());
        const flags = Array.from(el.shadowRoot.querySelectorAll('.pill--amber, .pill--blue')).map((p) => p.textContent);
        expect(flags).toEqual(['Adjusted by CafConfig', 'No record - default in use']);
    });

    it('notes inactive controls that still have requests', async () => {
        const el = await render(overview());
        expect(el.shadowRoot.textContent).toContain('Inactive but still has requests');
        expect(el.shadowRoot.textContent).toContain('1 active');
    });
});
