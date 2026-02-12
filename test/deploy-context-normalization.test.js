import test from 'node:test';
import assert from 'node:assert/strict';

import { __internal } from '../clanker-core.js';

test('normalizeSdkContext keeps arbitrary source platform unchanged', () => {
    const input = {
        platform: 'github',
        messageId: 'https://github.com/org/repo/issues/1',
        id: 'org'
    };

    const out = __internal.normalizeSdkContext(input);
    assert.equal(out.platform, 'github');
    assert.equal(out.messageId, 'https://github.com/org/repo/issues/1');
    assert.equal(out.id, 'org');
});

test('normalizeSdkContext defaults platform to clanker when missing and messageId exists', () => {
    const out = __internal.normalizeSdkContext({ messageId: '12345' });
    assert.equal(out.platform, 'clanker');
});
