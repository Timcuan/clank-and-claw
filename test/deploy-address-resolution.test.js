import test from 'node:test';
import assert from 'node:assert/strict';

import { __internal } from '../clanker-core.js';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;
const RANDOM_TOPIC = `0x${'1'.repeat(64)}`;
const FACTORY = '0xe85a59c628f7d27878aceb4bf3b35733630083a9';
const WETH = '0x4200000000000000000000000000000000000006';
const TOKEN = '0x1111111111111111111111111111111111111111';

const mockClient = {
    getBytecode: async ({ address }) => {
        const lower = String(address).toLowerCase();
        if (lower === WETH.toLowerCase() || lower === TOKEN.toLowerCase()) return '0x1234';
        return '0x';
    },
    readContract: async ({ address, functionName }) => {
        const lower = String(address).toLowerCase();
        if (lower === WETH.toLowerCase()) {
            if (functionName === 'symbol') return 'WETH';
            if (functionName === 'name') return 'Wrapped Ether';
        }
        if (lower === TOKEN.toLowerCase()) {
            if (functionName === 'symbol') return 'CLAWINHO';
            if (functionName === 'name') return 'CLAWINHO';
        }
        throw new Error('unsupported');
    }
};

test('resolveTokenAddress prefers expected token symbol/name over WETH', async () => {
    const logs = [
        { address: WETH, topics: [TRANSFER_TOPIC, ZERO_TOPIC, RANDOM_TOPIC], data: '0x' },
        { address: TOKEN, topics: [TRANSFER_TOPIC, ZERO_TOPIC, RANDOM_TOPIC], data: '0x' }
    ];

    const address = await __internal.resolveTokenAddress(mockClient, logs, {
        symbol: 'CLAWINHO',
        name: 'CLAWINHO'
    });

    assert.equal(address, TOKEN);
});

test('collectAddressCandidates tracks log and mint-like transfer sources', () => {
    const logs = [
        { address: TOKEN, topics: [TRANSFER_TOPIC, ZERO_TOPIC, RANDOM_TOPIC], data: '0x' },
        { address: FACTORY, topics: [RANDOM_TOPIC, `0x000000000000000000000000${TOKEN.slice(2)}`], data: '0x' }
    ];

    const collected = __internal.collectAddressCandidates(logs);
    assert.equal(collected.addresses.includes(TOKEN), true);
    assert.equal(collected.fromLogAddress.has(TOKEN.toLowerCase()), true);
    assert.equal(collected.fromMintLikeTransfer.has(TOKEN.toLowerCase()), true);
    assert.equal(collected.fromFactoryEmission.has(TOKEN.toLowerCase()), true);
});
