import test from 'node:test';
import assert from 'node:assert/strict';

import {
    formatHealthError,
    listEnabledIpfsProviders,
    getStatusRpcCandidates,
    probeTelegramOrigin,
    probeRpcEndpoint
} from '../lib/runtime-health.js';

test('formatHealthError normalizes whitespace and fallback message', () => {
    assert.equal(formatHealthError('  bad   gateway   error '), 'bad gateway error');
    assert.equal(formatHealthError(''), 'unknown error');
});

test('listEnabledIpfsProviders returns active provider labels', () => {
    const providers = listEnabledIpfsProviders({
        kuboLocal: true,
        pinata: false,
        infura: true,
        nftStorage: true
    });
    assert.deepEqual(providers, ['Kubo Local', 'Infura (Legacy)', 'NFT.Storage Classic (Legacy)']);
});

test('getStatusRpcCandidates uses primary, fallback list, and deduplicates', () => {
    const candidates = getStatusRpcCandidates({
        primaryRpcUrl: 'https://rpc-1.example',
        fallbackRpcUrlsCsv: 'https://rpc-2.example, https://rpc-1.example, , https://rpc-3.example'
    });
    assert.deepEqual(candidates, [
        'https://rpc-1.example',
        'https://rpc-2.example',
        'https://rpc-3.example'
    ]);
});

test('getStatusRpcCandidates falls back to default when no env values exist', () => {
    const candidates = getStatusRpcCandidates({});
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0], 'https://mainnet.base.org');
});

test('probeTelegramOrigin returns healthy response metadata', async () => {
    const result = await probeTelegramOrigin('https://api.telegram.test', async () => ({
        ok: true,
        result: { username: 'clankbot' }
    }));

    assert.equal(result.origin, 'https://api.telegram.test');
    assert.equal(result.ok, true);
    assert.equal(result.username, 'clankbot');
    assert.equal(typeof result.latencyMs, 'number');
});

test('probeTelegramOrigin returns normalized error response', async () => {
    const result = await probeTelegramOrigin('https://api.telegram.test', async () => ({
        ok: false,
        description: '  gateway    timeout '
    }));

    assert.equal(result.origin, 'https://api.telegram.test');
    assert.equal(result.ok, false);
    assert.equal(result.error, 'gateway timeout');
});

test('probeRpcEndpoint returns healthy result with block number', async () => {
    const viemFactory = {
        createPublicClient: () => ({
            getBlockNumber: async () => 123456789n
        }),
        base: { id: 8453 },
        http: () => ({})
    };

    const result = await probeRpcEndpoint('https://rpc.example', viemFactory);
    assert.equal(result.ok, true);
    assert.equal(result.rpcUrl, 'https://rpc.example');
    assert.equal(result.blockNumber, '123456789');
});

test('probeRpcEndpoint returns normalized error when client fails', async () => {
    const viemFactory = {
        createPublicClient: () => ({
            getBlockNumber: async () => {
                throw new Error('  rpc   unavailable ');
            }
        }),
        base: { id: 8453 },
        http: () => ({})
    };

    const result = await probeRpcEndpoint('https://rpc.example', viemFactory);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'rpc unavailable');
});
