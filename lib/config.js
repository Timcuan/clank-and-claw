import { POOL_POSITIONS } from 'clanker-sdk';
import { processImage, parseBoolean, parseIntSafe, parseFloatSafe } from './utils.js';
import { parseFees } from './parser.js';
import fs from 'fs';
import 'dotenv/config';

/**
 * Load config from token.json file
 * @param {string} filePath - Path to token JSON file
 */
export const loadTokenConfig = (filePath = 'token.json') => {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Token config not found: ${filePath}`);
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const token = JSON.parse(raw);

    // Parse fees from various formats
    let fees = { type: 'static', clankerFee: 100, pairedFee: 100 };

    // Support simple string format
    if (typeof token.fees === 'string' || typeof token.fees === 'number') {
        const parsed = parseFees(String(token.fees));
        if (parsed) fees = { type: 'static', ...parsed };
    }
    // Support object format with 'total'
    else if (token.fees && typeof token.fees === 'object') {
        if (token.fees.total) {
            const parsed = parseFees(String(token.fees.total));
            if (parsed) fees = { type: 'static', ...parsed };
        } else if (token.fees.clankerFee !== undefined) {
            fees = {
                type: 'static',
                clankerFee: parseInt(token.fees.clankerFee) || 100,
                pairedFee: parseInt(token.fees.pairedFee) || 100
            };
        }
    }

    // Handle dynamic fees
    if (token.dynamicFees?.enabled) {
        fees = {
            type: 'dynamic',
            baseFee: parseIntSafe(token.dynamicFees.baseFee * 100, 50),
            maxFee: parseIntSafe(token.dynamicFees.maxFee * 100, 500),
            referenceTickFilterPeriod: parseIntSafe(token.dynamicFees.adjustmentPeriod, 3600),
            resetPeriod: parseIntSafe(token.dynamicFees.resetPeriod, 86400),
            resetTickFilter: 100,
            feeControlNumerator: 100000,
            decayFilterBps: 9500
        };
    }

    // Parse context
    let context = {
        interface: 'Clanker SDK',
        platform: 'twitter',
        messageId: undefined
    };

    if (token.context) {
        context.platform = token.context.platform || context.platform;
        context.messageId = token.context.url || token.context.messageId;
    }

    // Parse metadata
    const metadata = {
        description: token.description || 'Deployed with Clank & Claw',
        socialMediaUrls: [],
        auditUrls: []
    };

    if (token.socials) {
        if (token.socials.x) metadata.socialMediaUrls.push({ platform: 'x', url: token.socials.x });
        if (token.socials.website) metadata.socialMediaUrls.push({ platform: 'website', url: token.socials.website });
        if (token.socials.telegram) metadata.socialMediaUrls.push({ platform: 'telegram', url: token.socials.telegram });
        if (token.socials.farcaster) metadata.socialMediaUrls.push({ platform: 'farcaster', url: token.socials.farcaster });
    }

    // Spoofing config (new simplified format)
    const spoofEnabled = token.spoof?.enabled || false;
    const ourWallet = token.spoof?.ourWallet || token.advanced?.ourWallet || process.env.REWARD_CREATOR;
    const spoofTo = spoofEnabled ? (token.spoof?.targetAddress || token.advanced?.spoofTo) : null;

    // Token admin
    const tokenAdmin = spoofTo || token.advanced?.admin || process.env.TOKEN_ADMIN || '0x0000000000000000000000000000000000000000';

    // Build rewards with proper spoofing
    // SPOOFING LOGIC:
    // - REWARD_CREATOR (ourWallet) = 99.9% fees → our address
    // - REWARD_INTERFACE (spoofTo) = 0.1% fees → target spoof address (appears as deployer)
    let rewards = { recipients: [] };

    if (spoofTo && ourWallet && spoofTo.toLowerCase() !== ourWallet.toLowerCase()) {
        // Spoofing mode: 99.9% to us, 0.1% to spoof target
        rewards.recipients.push({
            recipient: ourWallet,
            admin: ourWallet,
            bps: 9990,
            token: 'Both'
        });
        rewards.recipients.push({
            recipient: spoofTo,
            admin: spoofTo,
            bps: 10,
            token: 'Both'
        });
    } else if (tokenAdmin !== '0x0000000000000000000000000000000000000000') {
        // Normal mode: 100% to token admin
        rewards.recipients.push({
            recipient: tokenAdmin,
            admin: tokenAdmin,
            bps: 10000,
            token: 'Both'
        });
    }

    // Anti-bot / Sniper fees
    let sniperFees = undefined;
    if (token.antiBot?.enabled) {
        sniperFees = {
            startingFee: parseIntSafe((token.antiBot.startingFee || 6667.77) * 100, 666777),
            endingFee: parseIntSafe((token.antiBot.endingFee || 416.73) * 100, 41673),
            secondsToDecay: parseIntSafe(token.antiBot.decaySeconds, 15)
        };
    }

    // Pool settings
    const poolType = token.pool?.type || 'Standard';
    const tickSpacing = 200;
    const startingTick = Math.round(parseIntSafe(token.pool?.startingTick, -230400) / tickSpacing) * tickSpacing;
    const poolPositions = POOL_POSITIONS[poolType] || [
        { tickLower: startingTick, tickUpper: startingTick + 110400, positionBps: 10000 }
    ];

    return {
        name: token.name || 'My Token',
        symbol: token.symbol || 'TOKEN',
        tokenAdmin,
        image: processImage(token.image),
        vanity: token.advanced?.vanity !== false,
        metadata,
        context,
        fees,
        sniperFees,
        rewards: rewards.recipients.length > 0 ? rewards : undefined,
        pool: {
            pairedToken: token.pool?.pairedToken || 'WETH',
            tickIfToken0IsClanker: startingTick,
            positions: poolPositions
        },
        devBuy: token.advanced?.devBuy > 0 ? { ethAmount: token.advanced.devBuy } : undefined,
        _meta: {
            strictMode: token.advanced?.strictMode || false,
            highTax: fees.type === 'static' ? (fees.clankerFee + fees.pairedFee > 500) : false,
            rewardRecipient: spoofTo || ourWallet || tokenAdmin,
            devBuyEth: token.advanced?.devBuy || 0
        }
    };
};

/**
 * Load config from environment variables (legacy)
 */
export const loadConfig = () => {
    const strictMode = parseBoolean(process.env.STRICT_MODE);
    const highTax = parseBoolean(process.env.HIGH_TAX);
    const tokenAdmin = process.env.TOKEN_ADMIN || process.env.REWARD_INTERFACE_ADMIN || '0x0000000000000000000000000000000000000000';

    // Rewards
    let rewardRecipient = process.env.ADMIN_SPOOF || process.env.REWARD_RECIPIENT || tokenAdmin;
    let rewards = { recipients: [] };

    if (process.env.REWARDS_JSON && process.env.REWARDS_JSON.length > 5) {
        try {
            rewards.recipients = JSON.parse(process.env.REWARDS_JSON);
        } catch (e) {
            console.error('❌ Error parsing REWARDS_JSON');
        }
    } else if (process.env.REWARD_CREATOR && process.env.REWARD_INTERFACE) {
        rewards.recipients.push({
            recipient: process.env.REWARD_CREATOR,
            admin: process.env.REWARD_CREATOR_ADMIN || tokenAdmin,
            bps: 9990,
            token: 'Both'
        });
        rewards.recipients.push({
            recipient: process.env.REWARD_INTERFACE,
            admin: process.env.REWARD_INTERFACE_ADMIN || tokenAdmin,
            bps: 10,
            token: 'Both'
        });
    } else if (rewardRecipient) {
        rewards.recipients.push({
            recipient: rewardRecipient,
            admin: tokenAdmin,
            bps: 10000,
            token: 'Both'
        });
    }

    // Fees
    let fees = {};
    const feeType = (process.env.FEE_TYPE || 'static').toLowerCase();

    if (feeType === 'dynamic') {
        fees = {
            type: 'dynamic',
            baseFee: parseIntSafe(process.env.FEE_DYNAMIC_BASE, 50),
            maxFee: parseIntSafe(process.env.FEE_DYNAMIC_MAX, 500),
            referenceTickFilterPeriod: parseIntSafe(process.env.FEE_DYNAMIC_PERIOD, 3600),
            resetPeriod: parseIntSafe(process.env.FEE_DYNAMIC_RESET, 86400),
            resetTickFilter: parseIntSafe(process.env.FEE_DYNAMIC_FILTER, 100),
            feeControlNumerator: parseIntSafe(process.env.FEE_DYNAMIC_CONTROL, 100000),
            decayFilterBps: parseIntSafe(process.env.FEE_DYNAMIC_DECAY, 9500)
        };
    } else {
        fees = {
            type: 'static',
            clankerFee: parseIntSafe(process.env.FEE_CLANKER_BPS, 100),
            pairedFee: parseIntSafe(process.env.FEE_PAIRED_BPS, 100)
        };
    }

    // Sniper
    let sniperFees = undefined;
    if (process.env.SNIPER_STARTING_FEE || process.env.SNIPER_ENDING_FEE) {
        sniperFees = {
            startingFee: parseIntSafe(process.env.SNIPER_STARTING_FEE, 666777),
            endingFee: parseIntSafe(process.env.SNIPER_ENDING_FEE, 41673),
            secondsToDecay: parseIntSafe(process.env.SNIPER_SECONDS_TO_DECAY, 15)
        };
    }

    // Metadata
    const metadata = {
        description: process.env.METADATA_DESCRIPTION || 'Deployed with Clanker SDK',
        socialMediaUrls: [],
        auditUrls: []
    };
    const addSocial = (platform, url) => {
        if (url && url.startsWith('http')) metadata.socialMediaUrls.push({ platform, url });
    };
    addSocial('x', process.env.SOCIAL_X);
    addSocial('telegram', process.env.SOCIAL_TELEGRAM);
    addSocial('farcaster', process.env.SOCIAL_FARCASTER);
    addSocial('website', process.env.SOCIAL_WEBSITE);

    // Context
    const context = {
        interface: 'Clanker SDK',
        platform: (process.env.CONTEXT_PLATFORM || 'farcaster').toLowerCase(),
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined
    };

    // Pool
    const poolType = (process.env.POOL_TYPE || 'Standard').trim();
    const tickSpacing = 200;
    const startingTick = Math.round(parseIntSafe(process.env.POOL_STARTING_TICK, -230400) / tickSpacing) * tickSpacing;
    let poolPositions = POOL_POSITIONS[poolType] || POOL_POSITIONS.Standard;

    if (process.env.POOL_POSITIONS_JSON) {
        try {
            const parsed = JSON.parse(process.env.POOL_POSITIONS_JSON);
            if (Array.isArray(parsed) && parsed.length > 0) poolPositions = parsed;
        } catch (e) {
            console.error('❌ Error parsing POOL_POSITIONS_JSON');
        }
    } else if (poolType === 'Standard') {
        poolPositions = [{ tickLower: startingTick, tickUpper: startingTick + 110400, positionBps: 10000 }];
    }

    return {
        name: process.env.TOKEN_NAME || 'My Token',
        symbol: process.env.TOKEN_SYMBOL || 'TOKEN',
        tokenAdmin,
        image: processImage(process.env.TOKEN_IMAGE),
        vanity: parseBoolean(process.env.VANITY),
        metadata,
        context,
        fees,
        sniperFees,
        rewards: rewards.recipients.length > 0 ? rewards : undefined,
        pool: {
            pairedToken: process.env.POOL_PAIRED_TOKEN || 'WETH',
            tickIfToken0IsClanker: startingTick,
            positions: poolPositions
        },
        devBuy: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) > 0
            ? { ethAmount: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) }
            : undefined,
        _meta: {
            strictMode,
            highTax,
            rewardRecipient,
            devBuyEth: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0)
        }
    };
};
