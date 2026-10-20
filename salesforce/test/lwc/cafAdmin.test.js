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

    // TC-UNIT-050
    it('summarises the callout log and filters to failures', async () => {
        const el = await render(overview());
        const values = Array.from(el.shadowRoot.querySelectorAll('.tile__value')).map((t) => t.textContent);
        expect(values).toEqual(['2', '1', '50%', '200 ms', '300 ms', '2026-10-19 09:00']);

        const box = el.shadowRoot.querySelector('input[type="checkbox"]');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        const logRows = el.shadowRoot.querySelectorAll('.scroll')[0].querySelectorAll('tbody tr');
        expect(logRows).toHaveLength(1);
        expect(logRows[0].textContent).toContain('boom');
    });

    // TC-UNIT-051
    it('explains the missing permission instead of failing when the log is not readable', async () => {
        const el = await render(overview({ logAccess: false, calls: [] }));
        expect(el.shadowRoot.textContent).toContain('needs the CAF Admin permission set');
        expect(el.shadowRoot.textContent).toContain('Backup');
    });

    // TC-UNIT-052
    it('flags settings where the value in use is not the value stored', async () => {
        const el = await render(overview());
        const flags = Array.from(el.shadowRoot.querySelectorAll('.pill--amber, .pill--blue')).map((p) => p.textContent);
        expect(flags).toEqual(['Adjusted by CafConfig', 'No record - default in use']);
    });

    // TC-UNIT-053
    it('notes inactive controls that still have requests', async () => {
        const el = await render(overview());
        expect(el.shadowRoot.textContent).toContain('Inactive but still has requests');
        expect(el.shadowRoot.textContent).toContain('1 active');
    });

    // TC-UNIT-054
    it('warns that the log has stopped when Logging_Enabled is false', async () => {
        const data = overview();
        data.settings = data.settings.map((s) =>
            s.name === 'Logging_Enabled' ? { ...s, configured: 'false', effective: 'false', hasRecord: true } : s
        );
        const el = await render(data);
        expect(el.shadowRoot.querySelector('.logging-off')).not.toBeNull();

        const on = await render(overview());
        expect(on.shadowRoot.querySelector('.logging-off')).toBeNull();
    });

    // TC-UNIT-055
    it('cuts long errors in the table and keeps the full text as the tooltip', async () => {
        const long = 'x'.repeat(400);
        const data = overview();
        data.calls[1] = { ...data.calls[1], Error__c: long };
        const el = await render(data);

        const cell = el.shadowRoot.querySelector('td.err[title]');
        expect(cell.title).toBe(long);
        expect(cell.textContent.length).toBe(141);
    });

    // TC-UNIT-056
    it('shows when the newest logged call was made', async () => {
        const el = await render(overview());
        expect(el.shadowRoot.textContent).toContain('2026-10-19 09:00');
    });
});

describe('c-caf-admin with missing or bad data', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-068
    it('renders nulls as blanks or dashes, never as "null"', async () => {
        const el = await render({
            settings: [{ name: 'Logging_Enabled', label: null, configured: null, effective: null, hasRecord: true }, null],
            controls: [{ name: null, snNumber: null, sysId: null, active: null, requests: null }],
            logAccess: true,
            calls: [{ Id: null, Succeeded__c: null, Latency_Ms__c: null, Status_Code__c: null, Called_At__c: null, Error__c: null }]
        });
        const body = el.shadowRoot.textContent;

        expect(body).not.toMatch(/\bnull\b/);
        expect(body).not.toContain('undefined');
        expect(body).toContain('(Unnamed control)');
        expect(body).toContain('Logging Enabled');
    });

    // TC-UNIT-069
    it('treats a payload without lists as an empty screen', async () => {
        const el = await render({ logAccess: true });
        expect(el.shadowRoot.textContent).toContain('No controls have been pushed from ServiceNow');
        expect(el.shadowRoot.textContent).toContain('No callouts logged');
        expect(el.shadowRoot.querySelector('.msg--error')).toBeNull();
    });
});

describe('c-caf-admin callout log filters', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    function call(n, operation, ok, overrides = {}) {
        return {
            Id: 'l' + n,
            Name: 'LOG-' + n,
            Operation__c: operation,
            Succeeded__c: ok,
            Latency_Ms__c: 100,
            Status_Code__c: ok ? 200 : 500,
            Called_At__c: '2026-10-19T09:0' + n + ':00.000Z',
            ...overrides
        };
    }

    const logRows = (el) => el.shadowRoot.querySelectorAll('.scroll')[0].querySelectorAll('tbody tr');
    const pick = async (el, value) => {
        const select = el.shadowRoot.querySelector('select.filters__operation');
        select.value = value;
        select.dispatchEvent(new CustomEvent('change'));
        await flush();
    };

    // TC-UNIT-124
    it('lists each operation once and narrows the log to the one chosen, leaving the tiles on the whole log', async () => {
        const el = await render(
            overview({
                calls: [call(1, 'attest', true), call(2, 'getEvidence', false), call(3, 'attest', false), call(4, null, true)]
            })
        );
        const options = Array.from(el.shadowRoot.querySelectorAll('select.filters__operation option')).map((o) => o.textContent);
        expect(options).toEqual(['All operations', 'attest', 'getEvidence']);

        await pick(el, 'attest');
        expect(Array.from(logRows(el)).map((r) => r.querySelector('td').textContent)).toEqual(['LOG-1', 'LOG-3']);
        expect(el.shadowRoot.querySelector('.tile__value').textContent).toBe('4');

        await pick(el, '');
        expect(logRows(el)).toHaveLength(4);
    });

    // TC-UNIT-125
    it('shows the whole log when a refresh no longer returns the chosen operation', async () => {
        const el = await render(overview({ calls: [call(1, 'attest', true), call(2, 'getEvidence', true)] }));
        await pick(el, 'attest');
        expect(logRows(el)).toHaveLength(1);

        getOverview.emit(overview({ calls: [call(2, 'getEvidence', true)] }));
        await flush();
        expect(logRows(el)).toHaveLength(1);
        expect(logRows(el)[0].textContent).toContain('LOG-2');
        expect(el.shadowRoot.querySelector('select.filters__operation').value).toBe('');
    });

    // TC-UNIT-126
    it('combines the operation filter with Failures only', async () => {
        const el = await render(overview({ calls: [call(1, 'attest', true), call(2, 'getEvidence', false), call(3, 'attest', false)] }));
        await pick(el, 'attest');
        const box = el.shadowRoot.querySelector('input[type="checkbox"]');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();

        expect(logRows(el)).toHaveLength(1);
        expect(logRows(el)[0].textContent).toContain('LOG-3');
    });
});

describe('c-caf-admin empty callout log', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    const ok = (n, operation) => ({ Id: 'l' + n, Name: 'LOG-' + n, Operation__c: operation, Succeeded__c: true });
    const message = (el) => el.shadowRoot.querySelector('.log-empty').textContent;
    const failuresOnly = async (el) => {
        const box = el.shadowRoot.querySelector('input[type="checkbox"]');
        box.checked = true;
        box.dispatchEvent(new CustomEvent('change'));
        await flush();
    };

    // TC-UNIT-127
    it('says no call failed, rather than that nothing was logged, when Failures only empties the table', async () => {
        const el = await render(overview({ calls: [ok(1, 'attest'), ok(2, 'attest')] }));
        await failuresOnly(el);
        expect(message(el)).toBe('None of the 2 logged calls failed.');

        const one = await render(overview({ calls: [ok(1, 'attest')] }));
        await failuresOnly(one);
        expect(message(one)).toBe('The one logged call did not fail.');
    });

    // TC-UNIT-128
    it('tells a filter that matches nothing apart from an empty log', async () => {
        const el = await render(overview({ calls: [ok(1, 'attest'), ok(2, 'getEvidence')] }));
        const select = el.shadowRoot.querySelector('select.filters__operation');
        select.value = 'attest';
        select.dispatchEvent(new CustomEvent('change'));
        await failuresOnly(el);
        expect(message(el)).toBe('No logged calls match the filter.');

        const empty = await render(overview({ calls: [] }));
        expect(message(empty)).toBe('No callouts logged.');
    });
});
