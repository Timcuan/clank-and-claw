import test from 'node:test';
import assert from 'node:assert/strict';

import {
    findTokenByAddressInPayload,
    maybeEnrichContextId,
    waitForTokenIndexing
} from '../lib/clankerworld.js';

const ADDRESS = '0x1111111111111111111111111111111111111111';

test('findTokenByAddressInPayload supports array and object payload shapes', () => {
    const payloadA = [{ contractAddress: ADDRESS, symbol: 'A' }];
    const payloadB = { tokens: [{ tokenAddress: ADDRESS, symbol: 'B' }] };

    const foundA = findTokenByAddressInPayload(payloadA, ADDRESS);
    const foundB = findTokenByAddressInPayload(payloadB, ADDRESS);

    assert.equal(foundA?.symbol, 'A');
    assert.equal(foundB?.symbol, 'B');
});

test('waitForTokenIndexing polls until address appears', async () => {
    let calls = 0;
    const mockFetch = async () => {
        calls += 1;
        if (calls < 2) {
            return {
                ok: true,
                json: async () => ({ tokens: [] })
            };
        }

        return {
            ok: true,
            json: async () => ({
                tokens: [{ contractAddress: ADDRESS, symbol: 'OK' }]
            })
        };
    };

    const result = await waitForTokenIndexing(ADDRESS, {
        timeoutMs: 100,
        intervalMs: 1,
        requestTimeoutMs: 50,
        fetchImpl: mockFetch
    });

    assert.equal(result.indexed, true);
    assert.equal(result.token?.symbol, 'OK');
    assert.equal(calls >= 2, true);
});

test('maybeEnrichContextId resolves numeric id from twitter username', async () => {
    const config = {
        context: {
            platform: 'twitter',
            id: 'jack'
        },
        metadata: {
            socialMediaUrls: [{ platform: 'x', url: 'https://x.com/jack' }]
        },
        _meta: {}
    };

    const mockFetch = async () => ({
        ok: true,
        json: async () => ([{ screen_name: 'jack', id_str: '12' }])
    });

    const result = await maybeEnrichContextId(config, { fetchImpl: mockFetch, timeoutMs: 50 });
    assert.equal(result.changed, true);
    assert.equal(config.context.id, '12');
    assert.equal(config._meta.contextIdSource, 'resolved-twitter-id');
});
