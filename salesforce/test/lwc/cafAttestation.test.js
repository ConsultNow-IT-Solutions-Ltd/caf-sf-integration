import { createElement } from 'lwc';
import CafAttestation from 'c/cafAttestation';
import attest from '@salesforce/apex/CafAttestationService.attest';
import LightningConfirm from 'lightning/confirm';

jest.mock('@salesforce/apex/CafAttestationService.attest', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('lightning/confirm', () => ({ __esModule: true, default: { open: jest.fn() } }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function mount(props = {}) {
    const el = createElement('c-caf-attestation', { is: CafAttestation });
    Object.assign(el, {
        snSysId: 'sys1',
        taskNumber: 'CAFT0001046',
        taskState: 'In Progress',
        evidenceCount: 1,
        ...props
    });
    document.body.appendChild(el);
    await flush();
    return el;
}

const RESULT = { taskNumber: 'CAFT0001046', approval: 'approved', metCriteria: 'yes', active: false };

describe('c-caf-attestation confirmation', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    // TC-UNIT-090
    it('sends nothing when the confirmation is cancelled', async () => {
        LightningConfirm.open.mockResolvedValue(false);
        const el = await mount();
        el.shadowRoot.querySelector('.btn--approve').click();
        await flush();

        expect(LightningConfirm.open).toHaveBeenCalledTimes(1);
        expect(attest).not.toHaveBeenCalled();
    });

    // TC-UNIT-091
    it('sends the decision once confirmed, naming the task and the criteria in the dialog', async () => {
        LightningConfirm.open.mockResolvedValue(true);
        attest.mockResolvedValue(RESULT);
        const el = await mount();
        el.shadowRoot.querySelector('.btn--approve').click();
        await flush();

        const dialog = LightningConfirm.open.mock.calls[0][0];
        expect(dialog.label).toBe('Approve CAFT0001046?');
        expect(dialog.message).toContain('Success criteria met');
        expect(attest).toHaveBeenCalledWith({ taskSysId: 'sys1', metCriteria: 'yes', outcome: 'approved', comments: '' });
    });

    // TC-UNIT-092
    it('asks for a reason before it asks to confirm a rejection', async () => {
        const el = await mount();
        el.shadowRoot.querySelector('.btn--reject').click();
        await flush();

        expect(LightningConfirm.open).not.toHaveBeenCalled();
        expect(attest).not.toHaveBeenCalled();
    });

    // TC-UNIT-093
    it('warns in the rejection dialog that the request goes out of compliance', async () => {
        LightningConfirm.open.mockResolvedValue(true);
        attest.mockResolvedValue({ ...RESULT, approval: 'rejected' });
        const el = await mount();
        const comments = el.shadowRoot.querySelector('.at__comments');
        comments.value = 'Backup restore not evidenced';
        comments.dispatchEvent(new CustomEvent('change'));
        await flush();

        el.shadowRoot.querySelector('.btn--reject').click();
        await flush();

        expect(LightningConfirm.open.mock.calls[0][0].message).toContain('out of compliance');
        expect(attest).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'rejected', comments: 'Backup restore not evidenced' }));
    });

    // TC-UNIT-094
    it('treats a dialog that cannot open as a no', async () => {
        LightningConfirm.open.mockRejectedValue(new Error('no container'));
        const el = await mount();
        el.shadowRoot.querySelector('.btn--approve').click();
        await flush();

        expect(attest).not.toHaveBeenCalled();
    });
});
