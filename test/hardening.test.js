import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateConfig } from '../lib/validator.js';
import { createConfigFromSession, loadConfig, loadTokenConfig } from '../lib/config.js';
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

test('validateConfig auto-normalizes malformed social URL', () => {
    const config = baseConfig();
    config.metadata.socialMediaUrls = [{ platform: 'x', url: 'x.com/not-valid' }];
    const validated = validateConfig(config);
    assert.equal(validated.metadata.socialMediaUrls.length, 1);
    assert.equal(validated.metadata.socialMediaUrls[0].url, 'https://x.com/not-valid');
});

test('validateConfig auto-heals invalid rewards bps', () => {
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
    const validated = validateConfig(config);
    assert.equal(validated.rewards.recipients.length, 1);
    assert.equal(validated.rewards.recipients[0].bps, 10000);
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

test('createConfigFromSession applies spoof split rewards and spoof tokenAdmin', () => {
    const deployer = '0x1111111111111111111111111111111111111111';
    const spoof = '0x2222222222222222222222222222222222222222';
    const sessionToken = {
        name: 'Gamma',
        symbol: 'GAMMA',
        image: 'bafkreigh2akiscaildc3exampleexampleexampleexampleexample',
        description: 'Gamma token',
        fees: { clankerFee: 200, pairedFee: 200 },
        context: { platform: 'twitter', messageId: '123' },
        socials: { x: 'https://x.com/gamma' },
        spoofTo: spoof
    };

    const cfg = createConfigFromSession(sessionToken, deployer);
    const validated = validateConfig(cfg);

    assert.equal(validated.tokenAdmin, spoof);
    assert.equal(Array.isArray(validated.rewards?.recipients), true);
    assert.equal(validated.rewards.recipients.length, 2);
    assert.equal(validated.rewards.recipients[0].recipient, deployer);
    assert.equal(validated.rewards.recipients[0].bps, 9990);
    assert.equal(validated.rewards.recipients[1].recipient, spoof);
    assert.equal(validated.rewards.recipients[1].bps, 10);
});

test('createConfigFromSession disables spoof split when spoof target equals deployer', () => {
    const deployer = '0x1111111111111111111111111111111111111111';
    const sessionToken = {
        name: 'Delta',
        symbol: 'DELTA',
        image: 'bafkreigh2akiscaildc3exampleexampleexampleexampleexample',
        description: 'Delta token',
        fees: { clankerFee: 200, pairedFee: 200 },
        context: { platform: 'twitter', messageId: '123' },
        socials: { x: 'https://x.com/delta' },
        spoofTo: deployer
    };

    const cfg = createConfigFromSession(sessionToken, deployer);
    const validated = validateConfig(cfg);

    assert.equal(validated.tokenAdmin, deployer);
    assert.equal(validated.rewards, undefined);
});

test('loadConfig maps reward admin env for spoof split mode', () => {
    const keys = [
        'TOKEN_NAME',
        'TOKEN_SYMBOL',
        'TOKEN_IMAGE',
        'REWARD_CREATOR',
        'REWARD_INTERFACE',
        'REWARD_CREATOR_ADMIN',
        'REWARD_INTERFACE_ADMIN',
        'TOKEN_ADMIN',
        'ADMIN_SPOOF',
        'REWARD_RECIPIENT',
        'REWARDS_JSON',
        'CONTEXT_MESSAGE_ID',
        'CONTEXT_PLATFORM'
    ];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

    process.env.TOKEN_NAME = 'Spoof Env Token';
    process.env.TOKEN_SYMBOL = 'SEV';
    process.env.TOKEN_IMAGE = 'https://example.com/spoof.png';
    process.env.REWARD_CREATOR = '0x1111111111111111111111111111111111111111';
    process.env.REWARD_INTERFACE = '0x2222222222222222222222222222222222222222';
    process.env.REWARD_CREATOR_ADMIN = '0x3333333333333333333333333333333333333333';
    process.env.REWARD_INTERFACE_ADMIN = '0x4444444444444444444444444444444444444444';
    process.env.CONTEXT_PLATFORM = 'twitter';
    process.env.CONTEXT_MESSAGE_ID = '12345';
    delete process.env.TOKEN_ADMIN;
    delete process.env.ADMIN_SPOOF;
    delete process.env.REWARD_RECIPIENT;
    delete process.env.REWARDS_JSON;

    try {
        const cfg = loadConfig();
        assert.equal(cfg.tokenAdmin, '0x4444444444444444444444444444444444444444');
        assert.equal(cfg.rewards.recipients.length, 2);
        assert.equal(cfg.rewards.recipients[0].admin, '0x3333333333333333333333333333333333333333');
        assert.equal(cfg.rewards.recipients[1].admin, '0x4444444444444444444444444444444444444444');
    } finally {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
    }
});

test('loadConfig parses quoted VANITY env as true', () => {
    const keys = ['VANITY', 'TOKEN_IMAGE'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

    process.env.VANITY = '"true"';
    process.env.TOKEN_IMAGE = 'https://example.com/image.png';

    try {
        const cfg = loadConfig();
        assert.equal(cfg.vanity, true);
    } finally {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
    }
});

test('loadConfig defaults static fees to 300 + 300 bps when env fees are missing', () => {
    const keys = ['FEE_TYPE', 'FEE_CLANKER_BPS', 'FEE_PAIRED_BPS', 'TOKEN_IMAGE'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

    process.env.FEE_TYPE = 'static';
    process.env.TOKEN_IMAGE = 'https://example.com/default-fees.png';
    delete process.env.FEE_CLANKER_BPS;
    delete process.env.FEE_PAIRED_BPS;

    try {
        const cfg = loadConfig();
        assert.equal(cfg.fees.type, 'static');
        assert.equal(cfg.fees.clankerFee, 300);
        assert.equal(cfg.fees.pairedFee, 300);
    } finally {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
    }
});

test('validateConfig caps static fees above 6% back to default 3% + 3%', () => {
    const config = baseConfig();
    config.fees = { type: 'static', clankerFee: 700, pairedFee: 700 };
    const validated = validateConfig(config);

    assert.equal(validated.fees.clankerFee, 300);
    assert.equal(validated.fees.pairedFee, 300);
});

test('loadTokenConfig prefers context URL ID when messageId mismatches', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-context-'));
    const filePath = path.join(tmpDir, 'token.json');
    const payload = {
        name: 'Ctx Token',
        symbol: 'CTX',
        image: 'https://example.com/ctx.png',
        fees: '5%',
        context: {
            platform: 'twitter',
            messageId: '1850000000000000000',
            url: 'https://x.com/mochatdotio/status/2020922261352706275?s=20'
        }
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg.context.messageId, '2020922261352706275');
        assert.equal(cfg._meta.contextSource, 'context-url');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('createConfigFromSession normalizes social URLs for metadata', () => {
    const sessionToken = {
        name: 'Norma',
        symbol: 'NORMA',
        image: 'bafkreigh2akiscaildc3exampleexampleexampleexampleexample',
        description: 'Normal token',
        fees: { clankerFee: 200, pairedFee: 200 },
        context: { platform: 'twitter', messageId: '123' },
        socials: {
            x: '@normatoken',
            website: 'norma.example',
            telegram: 't.me/normatoken'
        },
        spoofTo: null
    };

    const cfg = createConfigFromSession(sessionToken, '0x1111111111111111111111111111111111111111');
    const urls = cfg.metadata.socialMediaUrls.map((s) => s.url);

    assert.equal(urls.includes('https://x.com/normatoken'), true);
    assert.equal(urls.includes('https://norma.example'), true);
    assert.equal(urls.includes('https://t.me/normatoken'), true);
});

test('validateConfig auto-fills context when REQUIRE_CONTEXT enabled', () => {
    const prev = process.env.REQUIRE_CONTEXT;
    process.env.REQUIRE_CONTEXT = 'true';
    const config = baseConfig();
    config.context = { platform: 'twitter', messageId: '' };

    try {
        const validated = validateConfig(config);
        assert.equal(Boolean(validated.context.messageId), true);
        assert.match(String(validated.context.messageId), /^\d+$/);
    } finally {
        if (prev === undefined) {
            delete process.env.REQUIRE_CONTEXT;
        } else {
            process.env.REQUIRE_CONTEXT = prev;
        }
    }
});

test('validateConfig auto-fills missing name/symbol/image in smart mode', () => {
    const config = baseConfig();
    config.name = '';
    config.symbol = '';
    config.image = '';
    const validated = validateConfig(config);

    assert.equal(validated.name.length >= 2, true);
    assert.equal(validated.symbol.length >= 2, true);
    assert.equal(/^https?:\/\//.test(validated.image), true);
});

test('validateConfig normalizes twitter context URL to status ID', () => {
    const config = baseConfig();
    config.context = { platform: 'twitter', messageId: 'https://x.com/user/status/123456789' };
    const validated = validateConfig(config);
    assert.equal(validated.context.messageId, '123456789');
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

test('loadTokenConfig supports legacy advanced spoof target without explicit spoof.enabled', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-legacy-'));
    const tokenPath = path.join(tmpDir, 'token.json');
    const ourWallet = '0x1111111111111111111111111111111111111111';
    const spoofTarget = '0x2222222222222222222222222222222222222222';
    const prevRewardCreator = process.env.REWARD_CREATOR;
    process.env.REWARD_CREATOR = ourWallet;

    fs.writeFileSync(tokenPath, JSON.stringify({
        name: 'Legacy Spoof',
        symbol: 'LSP',
        image: 'https://example.com/legacy.png',
        fees: '5%',
        description: 'legacy',
        context: { platform: 'twitter', messageId: '123' },
        advanced: {
            spoofTo: spoofTarget
        }
    }));

    try {
        const cfg = loadTokenConfig(tokenPath);
        assert.equal(cfg.tokenAdmin, spoofTarget);
        assert.equal(cfg.rewards?.recipients?.length, 2);
        assert.equal(cfg.rewards.recipients[0].recipient, ourWallet);
        assert.equal(cfg.rewards.recipients[1].recipient, spoofTarget);
    } finally {
        if (prevRewardCreator === undefined) delete process.env.REWARD_CREATOR;
        else process.env.REWARD_CREATOR = prevRewardCreator;
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig accepts top-level vanity and metadata.description', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-vanity-'));
    const tokenPath = path.join(tmpDir, 'token.json');

    fs.writeFileSync(tokenPath, JSON.stringify({
        name: 'Vanity Token',
        symbol: 'VNT',
        image: 'https://example.com/vanity.png',
        fees: '5%',
        vanity: false,
        metadata: { description: 'metadata desc wins' },
        context: { platform: 'twitter', messageId: '123' }
    }));

    try {
        const cfg = loadTokenConfig(tokenPath);
        assert.equal(cfg.vanity, false);
        assert.equal(cfg.metadata.description, 'metadata desc wins');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
