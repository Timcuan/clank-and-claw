#!/usr/bin/env node
/**
 * 🤖 OpenClaw Handler v2.0
 * 
 * AI Agent integration for Clanker token deployment.
 * Accepts JSON input, outputs JSON result.
 * 
 * Usage:
 *   echo '{"name":"Test","symbol":"TST","image":"bafk..."}' | node openclaw-handler.js
 *   node openclaw-handler.js --file config.json
 *   OPENCLAW_INPUT='{"name":"Test",...}' node openclaw-handler.js
 */

import fs from 'fs';
import 'dotenv/config';
import { normalizeBool, normalizeNumber, pick, setEnvIf } from './lib/utils.js';
import { loadConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import { deployToken } from './clanker-core.js';

// ─────────────────────────────────────────
// Input Loading
// ─────────────────────────────────────────

const readStdin = async () => {
    return new Promise((resolve, reject) => {
        let data = '';
        const timeout = setTimeout(() => resolve(''), 100); // Quick timeout if no stdin
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { clearTimeout(timeout); data += chunk; });
        process.stdin.on('end', () => { clearTimeout(timeout); resolve(data); });
        process.stdin.on('error', err => { clearTimeout(timeout); reject(err); });
        if (process.stdin.isTTY) { clearTimeout(timeout); resolve(''); }
    });
};

const parseJson = (raw, label) => {
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`Invalid JSON in ${label}: ${err.message}`);
    }
};

const loadInput = async () => {
    // Priority: stdin > --file > argv > OPENCLAW_INPUT
    const stdin = await readStdin();
    if (stdin && stdin.trim()) return parseJson(stdin, 'stdin');

    const args = process.argv.slice(2);
    if (args[0] === '--file') {
        const path = args[1];
        if (!path) throw new Error('Missing path after --file');
        if (!fs.existsSync(path)) throw new Error(`File not found: ${path}`);
        const raw = fs.readFileSync(path, 'utf8');
        return parseJson(raw, path);
    }

    if (args[0] && args[0].startsWith('{')) {
        return parseJson(args[0], 'argv');
    }

    if (process.env.OPENCLAW_INPUT) {
        return parseJson(process.env.OPENCLAW_INPUT, 'OPENCLAW_INPUT');
    }

    throw new Error('No input provided. Use: stdin, --file <path>, or OPENCLAW_INPUT env var.');
};

// ─────────────────────────────────────────
// Input Mapping (flexible key names)
// ─────────────────────────────────────────

const applyInputToEnv = (input) => {
    const socials = input.socials || input.SOCIALS || {};
    const context = input.context || input.CONTEXT || {};
    const fees = input.fees || input.FEES || {};
    const staticFees = (fees.static && typeof fees.static === 'object') ? fees.static : fees;
    const dynamicFees = (fees.dynamic && typeof fees.dynamic === 'object') ? fees.dynamic : fees;
    const feeMode = String(fees.type ?? fees.mode ?? '').trim().toLowerCase();
    const sniperFees = input.sniperFees || input.SNIPER_FEES || {};
    const pool = input.pool || input.POOL || {};
    const spoof = input.spoof || input.SPOOF || {};
    const clearEnvKeys = (keys) => keys.forEach((key) => delete process.env[key]);

    // Core Identity
    setEnvIf('TOKEN_NAME', pick(input, ['name', 'TOKEN_NAME', 'tokenName']));
    setEnvIf('TOKEN_SYMBOL', pick(input, ['symbol', 'TOKEN_SYMBOL', 'tokenSymbol']));
    setEnvIf('TOKEN_IMAGE', pick(input, ['image', 'TOKEN_IMAGE', 'tokenImage']));
    setEnvIf('METADATA_DESCRIPTION', pick(input, ['description', 'METADATA_DESCRIPTION']));

    // Admin
    // OpenClaw payload should be deterministic: clear spoof/rewards env residue first,
    // then repopulate only if explicitly provided in input.
    clearEnvKeys(['ADMIN_SPOOF', 'REWARD_CREATOR', 'REWARD_INTERFACE', 'REWARD_CREATOR_ADMIN', 'REWARD_INTERFACE_ADMIN', 'REWARD_RECIPIENT', 'REWARDS_JSON']);

    const explicitSpoofFlag = normalizeBool(spoof.enabled);
    const hasSpoofValues = !!(
        pick(input, ['adminSpoof', 'ADMIN_SPOOF', 'rewardCreator', 'REWARD_CREATOR', 'rewardInterface', 'REWARD_INTERFACE', 'rewardCreatorAdmin', 'REWARD_CREATOR_ADMIN', 'rewardInterfaceAdmin', 'REWARD_INTERFACE_ADMIN'])
        || spoof.ourWallet
        || spoof.targetAddress
    );
    const spoofDisabled = explicitSpoofFlag === false;

    if (spoofDisabled) {
        clearEnvKeys(['ADMIN_SPOOF', 'REWARD_CREATOR', 'REWARD_INTERFACE', 'REWARD_CREATOR_ADMIN', 'REWARD_INTERFACE_ADMIN']);
    }

    setEnvIf('TOKEN_ADMIN', pick(input, ['admin', 'TOKEN_ADMIN', 'tokenAdmin']));
    if (hasSpoofValues && !spoofDisabled) {
        setEnvIf('REWARD_CREATOR', pick(input, ['rewardCreator', 'REWARD_CREATOR']) ?? spoof.ourWallet);
        setEnvIf('REWARD_INTERFACE', pick(input, ['rewardInterface', 'REWARD_INTERFACE']) ?? spoof.targetAddress);
        setEnvIf('REWARD_CREATOR_ADMIN', pick(input, ['rewardCreatorAdmin', 'REWARD_CREATOR_ADMIN']) ?? spoof.ourWallet);
        setEnvIf('REWARD_INTERFACE_ADMIN', pick(input, ['rewardInterfaceAdmin', 'REWARD_INTERFACE_ADMIN']) ?? spoof.targetAddress);
        setEnvIf('ADMIN_SPOOF', pick(input, ['adminSpoof', 'ADMIN_SPOOF']) ?? (spoof.enabled ? spoof.targetAddress : undefined));
    }

    // Socials
    setEnvIf('SOCIAL_X', pick(input, ['SOCIAL_X']) ?? socials.x);
    setEnvIf('SOCIAL_TELEGRAM', pick(input, ['SOCIAL_TELEGRAM']) ?? socials.telegram);
    setEnvIf('SOCIAL_FARCASTER', pick(input, ['SOCIAL_FARCASTER']) ?? socials.farcaster);
    setEnvIf('SOCIAL_WEBSITE', pick(input, ['SOCIAL_WEBSITE']) ?? socials.website);

    // Context
    setEnvIf('CONTEXT_PLATFORM', pick(input, ['CONTEXT_PLATFORM']) ?? context.platform);
    setEnvIf('CONTEXT_MESSAGE_ID', pick(input, ['CONTEXT_MESSAGE_ID']) ?? context.messageId ?? context.url);

    // Flags
    const strictMode = normalizeBool(pick(input, ['strictMode', 'STRICT_MODE']));
    const dryRun = normalizeBool(pick(input, ['dryRun', 'DRY_RUN']));
    const vanity = normalizeBool(pick(input, ['vanity', 'VANITY']));
    const requireContext = normalizeBool(pick(input, ['requireContext', 'REQUIRE_CONTEXT']));
    const smartValidation = normalizeBool(pick(input, ['smartValidation', 'SMART_VALIDATION']));

    setEnvIf('STRICT_MODE', strictMode === undefined ? 'false' : String(strictMode));
    setEnvIf('DRY_RUN', dryRun);
    setEnvIf('VANITY', vanity === undefined ? 'true' : String(vanity));
    setEnvIf('REQUIRE_CONTEXT', requireContext === undefined ? 'true' : String(requireContext));
    setEnvIf('SMART_VALIDATION', smartValidation === undefined ? 'true' : String(smartValidation));

    // Credentials
    setEnvIf('RPC_URL', pick(input, ['rpcUrl', 'RPC_URL']));
    setEnvIf('RPC_FALLBACK_URLS', pick(input, ['rpcFallbackUrls', 'RPC_FALLBACK_URLS']));
    setEnvIf('PRIVATE_KEY', pick(input, ['privateKey', 'PRIVATE_KEY']));

    // Fees
    if (feeMode) setEnvIf('FEE_TYPE', feeMode);
    if (staticFees.clankerFee !== undefined) setEnvIf('FEE_CLANKER_BPS', staticFees.clankerFee);
    if (staticFees.clankerFeeBps !== undefined) setEnvIf('FEE_CLANKER_BPS', staticFees.clankerFeeBps);
    if (staticFees.pairedFee !== undefined) setEnvIf('FEE_PAIRED_BPS', staticFees.pairedFee);
    if (staticFees.pairedFeeBps !== undefined) setEnvIf('FEE_PAIRED_BPS', staticFees.pairedFeeBps);

    if (dynamicFees.baseFee !== undefined) setEnvIf('FEE_DYNAMIC_BASE', dynamicFees.baseFee);
    if (dynamicFees.baseFeeBps !== undefined) setEnvIf('FEE_DYNAMIC_BASE', dynamicFees.baseFeeBps);
    if (dynamicFees.maxFee !== undefined) setEnvIf('FEE_DYNAMIC_MAX', dynamicFees.maxFee);
    if (dynamicFees.maxFeeBps !== undefined) setEnvIf('FEE_DYNAMIC_MAX', dynamicFees.maxFeeBps);
    if (dynamicFees.adjustmentPeriod !== undefined) setEnvIf('FEE_DYNAMIC_PERIOD', dynamicFees.adjustmentPeriod);
    if (dynamicFees.referenceTickFilterPeriod !== undefined) setEnvIf('FEE_DYNAMIC_PERIOD', dynamicFees.referenceTickFilterPeriod);
    if (dynamicFees.resetPeriod !== undefined) setEnvIf('FEE_DYNAMIC_RESET', dynamicFees.resetPeriod);
    if (dynamicFees.resetTickFilter !== undefined) setEnvIf('FEE_DYNAMIC_FILTER', dynamicFees.resetTickFilter);
    if (dynamicFees.feeControlNumerator !== undefined) setEnvIf('FEE_DYNAMIC_CONTROL', dynamicFees.feeControlNumerator);
    if (dynamicFees.decayFilterBps !== undefined) setEnvIf('FEE_DYNAMIC_DECAY', dynamicFees.decayFilterBps);

    // Sniper
    if (sniperFees.startingFee !== undefined) setEnvIf('SNIPER_STARTING_FEE', sniperFees.startingFee);
    if (sniperFees.endingFee !== undefined) setEnvIf('SNIPER_ENDING_FEE', sniperFees.endingFee);
    if (sniperFees.secondsToDecay !== undefined) setEnvIf('SNIPER_SECONDS_TO_DECAY', sniperFees.secondsToDecay);

    // Pool
    if (pool.type !== undefined) setEnvIf('POOL_TYPE', pool.type);
    if (pool.startingTick !== undefined) setEnvIf('POOL_STARTING_TICK', pool.startingTick);
    if (pool.pairedToken !== undefined) setEnvIf('POOL_PAIRED_TOKEN', pool.pairedToken);
    if (pool.positions !== undefined) {
        setEnvIf('POOL_POSITIONS_JSON', typeof pool.positions === 'string' ? pool.positions : JSON.stringify(pool.positions));
    }

    // Dev Buy
    const devBuy = pick(input, ['devBuy', 'DEV_BUY_ETH_AMOUNT', 'devBuyEthAmount']);
    if (devBuy !== undefined) setEnvIf('DEV_BUY_ETH_AMOUNT', devBuy);
};

// ─────────────────────────────────────────
// Validation
// ─────────────────────────────────────────

const validateInput = (input) => {
    const smartMode = normalizeBool(pick(input, ['smartValidation', 'SMART_VALIDATION']))
        ?? (String(process.env.SMART_VALIDATION || 'true').trim().toLowerCase() !== 'false');
    const fallbackImage = String(process.env.DEFAULT_IMAGE_URL || '').trim()
        || 'https://gateway.pinata.cloud/ipfs/bafkreib5h4mmqsgmm7at7wphdfy66oh4yfcqo6dz64olhwv3nejq5ysycm';
    const deriveSymbol = (value) => {
        const normalized = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (normalized.length >= 2) return normalized.slice(0, 15);
        if (normalized.length === 1) return `${normalized}X`;
        return 'CLAW';
    };

    const name = pick(input, ['name', 'TOKEN_NAME', 'tokenName']);
    const symbol = pick(input, ['symbol', 'TOKEN_SYMBOL', 'tokenSymbol']);
    const image = pick(input, ['image', 'TOKEN_IMAGE', 'tokenImage']);

    if (!name && !symbol) {
        if (!smartMode) throw new Error('Missing required field: name or symbol');
        input.name = 'Clank Token';
        input.symbol = 'CLAW';
    } else {
        if (!name) input.name = String(symbol).trim();
        if (!symbol) input.symbol = deriveSymbol(name);
    }
    if (!image && smartMode) input.image = fallbackImage;
    if (!image && !smartMode) throw new Error('Missing required field: image');

    const strictMode = normalizeBool(pick(input, ['strictMode', 'STRICT_MODE'])) ?? false;

    if (strictMode) {
        const description = pick(input, ['description', 'METADATA_DESCRIPTION']);
        const context = input.context || input.CONTEXT || {};
        const messageId = pick(input, ['CONTEXT_MESSAGE_ID', 'CONTEXT_URL']) ?? context.messageId ?? context.url;
        const platform = (pick(input, ['CONTEXT_PLATFORM']) ?? context.platform ?? 'farcaster').toLowerCase();
        const devBuy = normalizeNumber(pick(input, ['devBuy', 'DEV_BUY_ETH_AMOUNT']));

        const strictMissing = (!description || !messageId || platform !== 'farcaster' || !devBuy || devBuy <= 0);
        if (strictMissing && smartMode) {
            input.strictMode = false;
            input.STRICT_MODE = 'false';
        } else if (strictMissing) {
            if (!description) throw new Error('STRICT_MODE requires: description');
            if (!messageId) throw new Error('STRICT_MODE requires: context.messageId');
            if (platform !== 'farcaster') throw new Error('STRICT_MODE requires: context.platform = "farcaster"');
            if (!devBuy || devBuy <= 0) throw new Error('STRICT_MODE requires: devBuy > 0');
        }
    }
};

// ─────────────────────────────────────────
// Main Execution
// ─────────────────────────────────────────

const outputJson = (data) => {
    console.log(JSON.stringify(data, null, 2));
};

const main = async () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const logs = [];
    let capturing = false;

    const restoreConsole = () => {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        capturing = false;
    };

    try {
        const input = await loadInput();
        validateInput(input);
        applyInputToEnv(input);

        // Capture console output from deployment internals
        console.log = (...args) => logs.push({ level: 'info', message: args.join(' ') });
        console.warn = (...args) => logs.push({ level: 'warn', message: args.join(' ') });
        console.error = (...args) => logs.push({ level: 'error', message: args.join(' ') });
        capturing = true;

        // Run deployment
        let config = loadConfig();
        config = validateConfig(config);
        const result = await deployToken(config);

        restoreConsole();

        // Output JSON result
        outputJson({
            success: result.success,
            dryRun: result.dryRun || false,
            address: result.address || null,
            txHash: result.txHash || null,
            scanUrl: result.scanUrl || null,
            error: result.error || null,
            logs: logs
        });

        process.exit(result.success ? 0 : 1);

    } catch (err) {
        if (capturing) restoreConsole();
        outputJson({
            success: false,
            error: err.message,
            logs
        });
        process.exit(1);
    }
};

main();
