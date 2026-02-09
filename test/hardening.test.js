import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateConfig } from '../lib/validator.js';
import { createConfigFromSession } from '../lib/config.js';
import { processImageInput } from '../lib/ipfs.js';

const baseConfig = () => ({
    name: 'Alpha Token',
    symbol: 'ALPHA',
    image: 'https://example.com/image.png',
    tokenAdmin: '0x1111111111111111111111111111111111111111',
    fees: { type: 'static', clankerFee: 250, pairedFee: 250 },
    context: { platform: 'twitter', messageId: '123456' },
    metadata: { socialMediaUrls: [{ platform: 'x', url: 'https://x.com/alpha' }], auditUrls: [] }
});

test('validateConfig normalizes symbol to uppercase', () => {
    const config = baseConfig();
    config.symbol = 'alpHa1';
    const validated = validateConfig(config);
    assert.equal(validated.symbol, 'ALPHA1');
});

test('validateConfig rejects malformed social URL', () => {
    const config = baseConfig();
    config.metadata.socialMediaUrls = [{ platform: 'x', url: 'x.com/not-valid' }];
    assert.throws(() => validateConfig(config), /Invalid URL/);
});

test('validateConfig rejects invalid rewards bps', () => {
    const config = baseConfig();
    config.rewards = {
        recipients: [
            {
                recipient: '0x1111111111111111111111111111111111111111',
                admin: '0x1111111111111111111111111111111111111111',
                bps: 12000,
                token: 'Both'
            }
        ]
    };
    assert.throws(() => validateConfig(config), /Invalid rewards bps/);
});

test('createConfigFromSession output passes validateConfig', () => {
    const sessionToken = {
        name: 'Beta',
        symbol: 'BETA',
        image: 'bafkreigh2akiscaildc3exampleexampleexampleexampleexample',
        description: 'Beta token',
        fees: { clankerFee: 200, pairedFee: 200 },
        context: { platform: 'twitter', messageId: '123' },
        socials: { x: 'https://x.com/beta' },
        spoofTo: null
    };
    const cfg = createConfigFromSession(sessionToken, '0x1111111111111111111111111111111111111111');
    const validated = validateConfig(cfg);
    assert.equal(validated.symbol, 'BETA');
    assert.equal(validated.fees.clankerFee, 200);
});

test('processImageInput rejects local file larger than 10MB', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-hardening-'));
    const largeFile = path.join(tmpDir, 'large.png');
    fs.writeFileSync(largeFile, Buffer.alloc(10 * 1024 * 1024 + 1, 0));

    try {
        const result = await processImageInput(largeFile);
        assert.equal(result.success, false);
        assert.match(String(result.error), /File too large/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('processImageInput returns gatewayUrls for existing CID and respects IPFS_GATEWAYS env', async () => {
    const prev = process.env.IPFS_GATEWAYS;
    process.env.IPFS_GATEWAYS = 'https://gw1.example/ipfs/{cid},https://gw2.example/ipfs';

    try {
        const result = await processImageInput('bafkreigh2akiscaildc3exampleexampleexampleexampleexample');
        assert.equal(result.success, true);
        assert.equal(Array.isArray(result.gatewayUrls), true);
        assert.equal(result.gatewayUrls.length, 2);
        assert.equal(result.gatewayUrls[0], 'https://gw1.example/ipfs/bafkreigh2akiscaildc3exampleexampleexampleexampleexample');
    } finally {
        if (prev === undefined) {
            delete process.env.IPFS_GATEWAYS;
        } else {
            process.env.IPFS_GATEWAYS = prev;
        }
    }
});
