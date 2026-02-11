import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { validateConfig } from '../lib/validator.js';
import { createConfigFromSession, loadConfig, loadTokenConfig } from '../lib/config.js';
import { processImageInput, getProviderStatus } from '../lib/ipfs.js';
import { parseSmartSocialInput } from '../lib/social-parser.js';
import { parseTokenCommand } from '../lib/parser.js';
import { ConfigStore } from '../lib/config-store.js';

const baseConfig = () => ({
    name: 'Alpha Token',
    symbol: 'ALPHA',
    image: 'https://example.com/image.png',
    tokenAdmin: '0x1111111111111111111111111111111111111111',
    fees: { type: 'static', clankerFee: 250, pairedFee: 250 },
    context: { platform: 'twitter', messageId: '123456' },
    metadata: { socialMediaUrls: [{ platform: 'x', url: 'https://x.com/alpha' }], auditUrls: [] }
});

test('ConfigStore persists draft and presets on disk', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-config-store-'));
    const storePath = path.join(tmpDir, 'store.json');
    const store = new ConfigStore(storePath);

    const tokenDraft = {
        name: 'Persisted Token',
        symbol: 'PST',
        image: 'bafkreigh2akiscaildc3exampleexampleexampleexampleexample',
        description: 'persist me',
        fees: { clankerFee: 300, pairedFee: 300 },
        context: { platform: 'twitter', messageId: '123' },
        socials: { x: 'https://x.com/pst' },
        spoofTo: null
    };

    try {
        store.saveDraft('1001', tokenDraft);
        store.savePreset('1001', 'default', tokenDraft);

        const draft = store.getDraft('1001');
        assert.equal(draft.name, 'Persisted Token');
        assert.equal(draft.fees.clankerFee, 300);

        const preset = store.loadPreset('1001', 'default');
        assert.equal(preset?.token?.symbol, 'PST');

        const stats = store.getStats();
        assert.equal(stats.users, 1);
        assert.equal(stats.presets, 1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ConfigStore supports case-insensitive preset lookup and deletion', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-config-store-case-'));
    const storePath = path.join(tmpDir, 'store.json');
    const store = new ConfigStore(storePath);

    try {
        store.savePreset('42', 'MyPreset', { symbol: 'MYP' });
        const loaded = store.loadPreset('42', 'mypreset');
        assert.equal(loaded?.name, 'MyPreset');

        const deleted = store.deletePreset('42', 'MYPRESET');
        assert.equal(deleted, true);
        assert.equal(store.loadPreset('42', 'mypreset'), null);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ConfigStore avoids redundant disk writes for unchanged draft', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-config-store-write-'));
    const storePath = path.join(tmpDir, 'store.json');
    const store = new ConfigStore(storePath);
    const tokenDraft = {
        name: 'No Rewrite',
        symbol: 'NRW',
        fees: { clankerFee: 300, pairedFee: 300 }
    };
    let writes = 0;
    const originalWrite = store._write.bind(store);
    store._write = () => {
        writes++;
        return originalWrite();
    };

    try {
        store.saveDraft('777', tokenDraft);
        store.saveDraft('777', tokenDraft);
        assert.equal(writes, 1);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('ConfigStore clearDraft is no-op when draft is already empty', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-config-store-clear-'));
    const storePath = path.join(tmpDir, 'store.json');
    const store = new ConfigStore(storePath);
    let writes = 0;
    const originalWrite = store._write.bind(store);
    store._write = () => {
        writes++;
        return originalWrite();
    };

    try {
        assert.equal(store.clearDraft('404'), false);
        store.saveDraft('404', { symbol: 'CLR' });
        assert.equal(store.clearDraft('404'), true);
        assert.equal(store.clearDraft('404'), false);
        assert.equal(writes, 2);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('validateConfig keeps symbol text as provided', () => {
    const config = baseConfig();
    config.symbol = 'alpHa1-_@#';
    const validated = validateConfig(config);
    assert.equal(validated.symbol, 'alpHa1-_@#');
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

test('loadConfig infers context platform from CONTEXT_MESSAGE_ID URL', () => {
    const keys = ['CONTEXT_PLATFORM', 'CONTEXT_MESSAGE_ID', 'TOKEN_IMAGE'];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

    delete process.env.CONTEXT_PLATFORM;
    process.env.CONTEXT_MESSAGE_ID = 'https://github.com/HKUDS/MoChat';
    process.env.TOKEN_IMAGE = 'https://example.com/context-url.png';

    try {
        const cfg = loadConfig();
        assert.equal(cfg.context.platform, 'github');
        assert.equal(cfg.context.messageId, 'https://github.com/HKUDS/MoChat');
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

test('validateConfig preserves custom static fees for token.json source', () => {
    const config = baseConfig();
    config.fees = { type: 'static', clankerFee: 1750, pairedFee: 2250 };
    config._meta = { smartValidation: true, allowCustomFeeRange: true, configSource: 'token-json' };
    const validated = validateConfig(config);

    assert.equal(validated.fees.clankerFee, 1750);
    assert.equal(validated.fees.pairedFee, 2250);
});

test('validateConfig preserves custom dynamic maxFee for token.json source', () => {
    const config = baseConfig();
    config.fees = { type: 'dynamic', baseFee: 100, maxFee: 1500 };
    config._meta = { smartValidation: true, allowCustomFeeRange: true, configSource: 'token-json' };
    const validated = validateConfig(config);

    assert.equal(validated.fees.baseFee, 100);
    assert.equal(validated.fees.maxFee, 1500);
});

test('validateConfig strict mode rejects static fee above 5% when smart validation is disabled', () => {
    const config = baseConfig();
    config.fees = { type: 'static', clankerFee: 300, pairedFee: 300 };
    config.context = { platform: 'farcaster', messageId: '0xabcdef12' };
    config._meta = { strictMode: true, smartValidation: false };
    assert.throws(() => validateConfig(config), /STRICT_MODE: Static total fee must be <= 500 bps/);
});

test('validateConfig strict mode auto-disables for static fee above 5% in smart mode', () => {
    const config = baseConfig();
    config.fees = { type: 'static', clankerFee: 300, pairedFee: 300 };
    config.context = { platform: 'farcaster', messageId: '0xabcdef12' };
    config._meta = { strictMode: true, smartValidation: true };
    const validated = validateConfig(config);

    assert.equal(validated._meta.strictMode, false);
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

test('loadTokenConfig auto-detects context platform from generic URL', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-context-generic-'));
    const filePath = path.join(tmpDir, 'token.json');
    const payload = {
        name: 'Generic Context Token',
        symbol: 'GCTX',
        image: 'https://example.com/gctx.png',
        fees: '6%',
        context: {
            url: 'https://github.com/HKUDS/MoChat'
        }
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg.context.platform, 'github');
        assert.equal(cfg.context.messageId, 'https://github.com/HKUDS/MoChat');
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

test('validateConfig accepts whitespace-only name/symbol and auto-fills fallback', () => {
    const config = baseConfig();
    config.name = '   ';
    config.symbol = '   ';
    const validated = validateConfig(config);

    assert.equal(validated.name.length > 0, true);
    assert.equal(validated.symbol.length > 0, true);
});

test('validateConfig does not truncate long metadata description', () => {
    const config = baseConfig();
    config.metadata.description = 'x'.repeat(6000);
    const validated = validateConfig(config);
    assert.equal(validated.metadata.description.length, 6000);
});

test('validateConfig does not auto-correct when _meta.smartValidation is false', () => {
    const config = baseConfig();
    config.image = '';
    config._meta = { smartValidation: false };
    assert.throws(() => validateConfig(config), /Token Image must be a valid HTTP\(S\) URL or IPFS CID/);
});

test('validateConfig requires explicit name/symbol when _meta.smartValidation is false', () => {
    const config = baseConfig();
    config.name = '   ';
    config.symbol = '';
    config._meta = { smartValidation: false };
    assert.throws(() => validateConfig(config), /Token symbol is required \(non-empty\)/);
});

test('validateConfig requires explicit fees for token-json when _meta.smartValidation is false', () => {
    const config = baseConfig();
    delete config.fees;
    config._meta = { smartValidation: false, configSource: 'token-json', tokenJsonHasExplicitFees: false };
    assert.throws(() => validateConfig(config), /Fees are required in token\.json/);
});

test('validateConfig normalizes twitter context URL to status ID', () => {
    const config = baseConfig();
    config.context = { platform: 'twitter', messageId: 'https://x.com/user/status/123456789' };
    const validated = validateConfig(config);
    assert.equal(validated.context.messageId, '123456789');
});

test('validateConfig accepts non-twitter/farcaster context platforms', () => {
    const config = baseConfig();
    config.context = { platform: 'github', messageId: 'https://github.com/HKUDS/MoChat' };
    config._meta = { smartValidation: false, configSource: 'token-json', tokenJsonHasExplicitFees: true };
    const validated = validateConfig(config);
    assert.equal(validated.context.platform, 'github');
    assert.equal(validated.context.messageId, 'https://github.com/HKUDS/MoChat');
});

test('parseSmartSocialInput treats generic URL as context with detected platform', () => {
    const parsed = parseSmartSocialInput('check this https://t.me/mochatdotio');
    assert.equal(parsed.context?.platform, 'telegram');
    assert.equal(parsed.context?.messageId, 'https://t.me/mochatdotio');
});

test('parseSmartSocialInput prioritizes tweet/cast over generic URLs', () => {
    const parsed = parseSmartSocialInput('site https://mochat.io post https://x.com/mochatdotio/status/2020922261352706275');
    assert.equal(parsed.context?.platform, 'twitter');
    assert.equal(parsed.context?.messageId, '2020922261352706275');
});

test('parseSmartSocialInput keeps generic social profiles when tweet/cast becomes context', () => {
    const parsed = parseSmartSocialInput('site https://mochat.io post https://x.com/mochatdotio/status/2020922261352706275');
    assert.equal(parsed.socials.website, 'https://mochat.io');
    assert.equal(parsed.context?.platform, 'twitter');
});

test('parseTokenCommand prioritizes tweet/cast over generic URLs', () => {
    const parsed = parseTokenCommand('Launch MOCHAT (MoChat) https://mochat.io https://x.com/mochatdotio/status/2020922261352706275');
    assert.equal(parsed.context?.platform, 'twitter');
    assert.equal(parsed.context?.messageId, 'https://x.com/mochatdotio/status/2020922261352706275');
});

test('parseTokenCommand parses split percent fees without halving', () => {
    const parsed = parseTokenCommand('/go MOON "Moon Token" 3% 3%');
    assert.equal(parsed.fees?.clankerFee, 300);
    assert.equal(parsed.fees?.pairedFee, 300);
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

test('processImageInput rejects non-string/non-buffer inputs', async () => {
    const result = await processImageInput({ bad: true });
    assert.equal(result.success, false);
    assert.match(String(result.error), /string URL\/path\/CID or Buffer/);
});

test('getProviderStatus reflects local Kubo and legacy provider flags correctly', () => {
    const keys = [
        'IPFS_KUBO_API',
        'PINATA_API_KEY',
        'PINATA_SECRET_KEY',
        'INFURA_PROJECT_ID',
        'INFURA_SECRET',
        'NFT_STORAGE_TOKEN',
        'ENABLE_INFURA_IPFS_LEGACY',
        'ENABLE_NFT_STORAGE_CLASSIC'
    ];
    const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

    process.env.IPFS_KUBO_API = 'http://127.0.0.1:5001';
    process.env.INFURA_PROJECT_ID = 'abc123';
    process.env.INFURA_SECRET = 'secret123';
    process.env.NFT_STORAGE_TOKEN = 'token123';
    process.env.ENABLE_INFURA_IPFS_LEGACY = 'false';
    process.env.ENABLE_NFT_STORAGE_CLASSIC = 'false';
    delete process.env.PINATA_API_KEY;
    delete process.env.PINATA_SECRET_KEY;

    try {
        const status = getProviderStatus();
        assert.equal(status.kuboLocal, true);
        assert.equal(status.pinata, false);
        assert.equal(status.infura, false);
        assert.equal(status.nftStorage, false);
        assert.equal(status.infuraLegacyConfigured, true);
        assert.equal(status.nftStorageLegacyConfigured, true);
        assert.equal(status.any, true);
    } finally {
        for (const k of keys) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
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

test('loadTokenConfig parses fees.mode static with explicit bps fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-fees-static-mode-'));
    const tokenPath = path.join(tmpDir, 'token.json');

    fs.writeFileSync(tokenPath, JSON.stringify({
        name: 'Static Mode Token',
        symbol: 'SMT',
        image: 'https://example.com/static-mode.png',
        fees: {
            mode: 'static',
            static: {
                clankerFeeBps: 1750,
                pairedFeeBps: 2250
            }
        },
        context: { platform: 'twitter', messageId: '123' }
    }));

    try {
        const cfg = loadTokenConfig(tokenPath);
        assert.equal(cfg.fees.type, 'static');
        assert.equal(cfg.fees.clankerFee, 1750);
        assert.equal(cfg.fees.pairedFee, 2250);
        assert.equal(cfg._meta.allowCustomFeeRange, true);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig parses fees.mode dynamic with default 1%-10% range', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-fees-dynamic-mode-'));
    const tokenPath = path.join(tmpDir, 'token.json');

    fs.writeFileSync(tokenPath, JSON.stringify({
        name: 'Dynamic Mode Token',
        symbol: 'DMT',
        image: 'https://example.com/dynamic-mode.png',
        fees: {
            mode: 'dynamic',
            dynamic: {}
        },
        context: { platform: 'twitter', messageId: '123' }
    }));

    try {
        const cfg = loadTokenConfig(tokenPath);
        assert.equal(cfg.fees.type, 'dynamic');
        assert.equal(cfg.fees.baseFee, 100);
        assert.equal(cfg.fees.maxFee, 1000);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig defaults to strict smartValidation=false for token.json edits', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-smart-default-'));
    const filePath = path.join(tmpDir, 'token.json');
    const payload = {
        name: 'Strict Token',
        symbol: 'STR',
        image: 'https://example.com/strict.png',
        fees: '6%'
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg._meta.smartValidation, false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig ignores smartValidation override for token.json edits', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-smart-override-'));
    const filePath = path.join(tmpDir, 'token.json');
    const payload = {
        name: 'Smart Token',
        symbol: 'SMRT',
        image: 'https://example.com/smart.png',
        fees: '6%',
        advanced: {
            smartValidation: true
        }
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg._meta.smartValidation, false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig reports line/column for invalid JSON', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-json-error-'));
    const filePath = path.join(tmpDir, 'token.json');
    fs.writeFileSync(filePath, '{\n  "name": "Broken",\n  "symbol": "BROKEN""image": "https://example.com/img.png"\n}\n');

    try {
        assert.throws(() => loadTokenConfig(filePath), /Invalid JSON in .*token\.json at line \d+, column \d+:/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig accepts relaxed JSON syntax with flat aliases', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-relaxed-'));
    const filePath = path.join(tmpDir, 'token.json');
    fs.writeFileSync(filePath, `{
  // comments are allowed
  "name": "Relaxed Token",
  "symbol": "RLX",
  "image": "https://example.com/relaxed.png",
  "description": "flat alias format",
  "fee": "6%",
  "contextUrl": "https://x.com/user/status/123456789",
  "x": "https://x.com/relaxedtoken",
}`);

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg.fees.type, 'static');
        assert.equal(cfg.fees.clankerFee, 300);
        assert.equal(cfg.fees.pairedFee, 300);
        assert.equal(cfg.context.platform, 'twitter');
        assert.equal(cfg.context.messageId, '123456789');
        assert.equal(cfg.metadata.description, 'flat alias format');
        assert.equal(cfg.metadata.socialMediaUrls.some((s) => s.platform === 'x'), true);
        assert.equal(cfg._meta.smartValidation, false);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig allows helper keys inside fees object', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-fees-help-'));
    const filePath = path.join(tmpDir, 'token.json');
    fs.writeFileSync(filePath, JSON.stringify({
        name: 'Fee Help Token',
        symbol: 'FHT',
        image: 'https://example.com/fee-help.png',
        fees: {
            mode: 'static',
            note: 'manual edit note',
            _help: 'keep custom values',
            static: {
                clankerFeeBps: 420,
                pairedFeeBps: 180
            }
        },
        context: { url: 'https://x.com/user/status/2222222222' }
    }, null, 2));

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg.fees.type, 'static');
        assert.equal(cfg.fees.clankerFee, 420);
        assert.equal(cfg.fees.pairedFee, 180);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('loadTokenConfig keeps literal string content while cleaning trailing commas', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-token-trailing-safe-'));
    const filePath = path.join(tmpDir, 'token.json');
    fs.writeFileSync(filePath, `{
  "name": "Comma Token",
  "symbol": "CMA",
  "image": "https://example.com/comma.png",
  "description": "literal ,} text should stay",
  "fee": "5%",
  "contextUrl": "https://x.com/user/status/3333333333",
}`);

    try {
        const cfg = loadTokenConfig(filePath);
        assert.equal(cfg.metadata.description, 'literal ,} text should stay');
        assert.equal(cfg.context.messageId, '3333333333');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});

test('openclaw-handler strict mode accepts context.url as context source', () => {
    const input = {
        name: 'OpenClaw Strict',
        symbol: 'OCS',
        image: 'https://example.com/oc.png',
        description: 'strict mode with context url',
        fees: {
            type: 'static',
            clankerFee: 250,
            pairedFee: 250
        },
        context: {
            platform: 'farcaster',
            url: 'https://warpcast.com/moon/0xabcdef12'
        },
        strictMode: true,
        smartValidation: false,
        devBuy: 0.01,
        dryRun: true
    };

    const result = spawnSync(process.execPath, ['openclaw-handler.js'], {
        cwd: process.cwd(),
        input: JSON.stringify(input),
        encoding: 'utf8',
        env: {
            ...process.env,
            DRY_RUN: 'true'
        }
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const output = JSON.parse(result.stdout.trim());
    assert.equal(output.success, true);
    assert.equal(output.dryRun, true);
});
