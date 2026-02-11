import test from 'node:test';
import assert from 'node:assert/strict';

import { createSessionDraftBridge } from '../lib/bot-session.js';

const createSessionManagerMock = () => {
    const sessions = new Map();
    const makeSession = () => ({
        token: {
            name: null,
            symbol: null,
            image: null,
            description: null,
            fees: { clankerFee: 300, pairedFee: 300 },
            context: null,
            socials: {},
            spoofTo: null
        },
        state: 'collecting'
    });

    return {
        get(chatId) {
            const key = String(chatId);
            if (!sessions.has(key)) sessions.set(key, makeSession());
            return sessions.get(key);
        },
        reset(chatId) {
            const key = String(chatId);
            const fresh = makeSession();
            sessions.set(key, fresh);
            return fresh;
        }
    };
};

test('session bridge hydrates draft once and persists normalized data', () => {
    const saved = [];
    const store = {
        getDraft: () => ({
            name: 'Draft Name',
            symbol: 'DRFT',
            fees: { clankerFee: '111', pairedFee: '222' },
            context: { platform: 'twitter', messageId: '123' },
            socials: { x: 'https://x.com/test' }
        }),
        saveDraft: (chatId, draft) => saved.push({ chatId, draft }),
        clearDraft: () => { }
    };
    const bridge = createSessionDraftBridge({
        sessionManager: createSessionManagerMock(),
        configStore: store,
        defaultFees: { clankerFee: 300, pairedFee: 300 },
        logger: { error: () => { } }
    });

    const first = bridge.getSession('1');
    assert.equal(first.state, 'collecting');
    assert.equal(first.token.name, 'Draft Name');
    assert.equal(first.token.fees.clankerFee, 111);
    assert.equal(first.token.fees.pairedFee, 222);

    bridge.persistSessionDraft('1', first);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].draft.fees.clankerFee, 111);
    assert.equal(saved[0].draft.context.platform, 'twitter');
});

test('session bridge reset clears draft by default and can skip clear', () => {
    let clearCount = 0;
    const store = {
        getDraft: () => null,
        saveDraft: () => { },
        clearDraft: () => { clearCount++; }
    };
    const bridge = createSessionDraftBridge({
        sessionManager: createSessionManagerMock(),
        configStore: store,
        defaultFees: { clankerFee: 300, pairedFee: 300 },
        logger: { error: () => { } }
    });

    bridge.resetSession('1');
    assert.equal(clearCount, 1);

    bridge.resetSession('1', { clearDraft: false });
    assert.equal(clearCount, 1);
});

test('session bridge normalizes invalid fee values and socials', () => {
    const store = {
        getDraft: () => null,
        saveDraft: () => { },
        clearDraft: () => { }
    };
    const bridge = createSessionDraftBridge({
        sessionManager: createSessionManagerMock(),
        configStore: store,
        defaultFees: { clankerFee: 300, pairedFee: 300 },
        logger: { error: () => { } }
    });

    const cloned = bridge.cloneTokenDraft({
        fees: { clankerFee: 'abc', pairedFee: -2 },
        socials: { x: ' https://x.com/a ', empty: '   ' }
    });

    assert.equal(cloned.fees.clankerFee, 300);
    assert.equal(cloned.fees.pairedFee, 300);
    assert.deepEqual(cloned.socials, { x: 'https://x.com/a' });
});
