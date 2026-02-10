
import { POOL_POSITIONS } from 'clanker-sdk';
import { processImage, parseBoolean, parseIntSafe, parseFloatSafe, normalizeBool } from './utils.js';
import { parseFees } from './parser.js';
import fs from 'fs';
import 'dotenv/config';

/**
 * Helper: Extract Status ID from URL (Twitter/Farcaster)
 */
const extractMessageId = (input) => {
    if (!input) return undefined;
    const clean = String(input).trim();

    // Numeric ID (Twitter) or Hash (Farcaster)
    if (/^\d+$/.test(clean) || (clean.startsWith('0x') && clean.length > 10)) return clean;

    // Attempt URL Parse
    try {
        const url = new URL(clean);
        const path = url.pathname.split('/').filter(p => p.length);

        // Twitter/X: .../status/12345
        if (clean.includes('twitter.com') || clean.includes('x.com')) {
            const idx = path.indexOf('status');
            if (idx !== -1 && path[idx + 1]) return path[idx + 1]; // Return numeric ID
        }

        // Warpcast: .../0x...
        if (clean.includes('warpcast.com')) {
            const hash = path.find(p => p.startsWith('0x'));
            if (hash) return hash;
        }

        console.warn(`⚠️ Warning: No valid Post ID found in context URL: "${clean}"`);
        return undefined; // Fail safely
    } catch (e) {
        return clean; // Not a URL, return as raw ID
    }
};

const CONTEXT_PLATFORMS = new Set(['twitter', 'farcaster', 'clanker']);
const SOCIAL_PLATFORM_ALIASES = {
    twitter: 'x',
    xcom: 'x',
    web: 'website',
    url: 'website'
};

const normalizeContextPlatform = (value, fallback = 'twitter') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    return CONTEXT_PLATFORMS.has(normalized) ? normalized : fallback;
};

const normalizeSocialPlatform = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;
    return SOCIAL_PLATFORM_ALIASES[normalized] || normalized;
};

const normalizeSocialUrl = (platform, value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    if (/^https?:\/\//i.test(raw)) return raw;

    if (raw.startsWith('@') && platform === 'x') {
        return `https://x.com/${raw.slice(1)}`;
    }

    const withoutSlash = raw.replace(/^\/+/, '');
    if (/^(x\.com|twitter\.com|warpcast\.com|t\.me|discord\.gg|discord\.com\/invite\/|github\.com|medium\.com|reddit\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|www\.)/i.test(withoutSlash)) {
        return `https://${withoutSlash}`;
    }

    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(withoutSlash)) {
        return `https://${withoutSlash}`;
    }

    return raw;
};

const buildSocialMetadata = (socials) => {
    if (!socials || typeof socials !== 'object') return [];

    const entries = [];
    const dedupe = new Set();

    for (const [platformRaw, urlRaw] of Object.entries(socials)) {
        const platform = normalizeSocialPlatform(platformRaw);
        if (!platform) continue;

        const url = normalizeSocialUrl(platform, urlRaw);
        if (!url) continue;

        const key = `${platform}|${url}`;
        if (dedupe.has(key)) continue;
        dedupe.add(key);
        entries.push({ platform, url });
    }

    return entries;
};

const resolveContext = (contextInput, socialsInput, fallbackPlatform = 'twitter') => {
    const context = {
        interface: 'Clanker SDK',
        platform: normalizeContextPlatform(contextInput?.platform, fallbackPlatform),
        messageId: undefined
    };

    let messageId = extractMessageId(contextInput?.messageId || contextInput?.url);
    let source = messageId ? 'context' : 'missing';

    if (!messageId && socialsInput && typeof socialsInput === 'object') {
        const xUrl = socialsInput.x || socialsInput.twitter;
        if (xUrl) {
            const twId = extractMessageId(xUrl);
            if (twId) {
                messageId = twId;
                context.platform = 'twitter';
                source = 'social';
            }
        }

        if (!messageId && socialsInput.farcaster) {
            const fcHash = extractMessageId(socialsInput.farcaster);
            if (fcHash) {
                messageId = fcHash;
                context.platform = 'farcaster';
                source = 'social';
            }
        }
    }

    if (!messageId && process.env.DEFAULT_CONTEXT_ID) {
        messageId = process.env.DEFAULT_CONTEXT_ID;
        source = 'default';
        console.warn(`⚠️ \x1b[33mContext Auto-Fill:\x1b[0m Using Default Context ID.`);
    }

    context.messageId = messageId;
    return { context, source };
};

const parseVanityValue = (value, fallback = true) => {
    const normalized = normalizeBool(value);
    return normalized === undefined ? fallback : normalized;
};

const sanitizeDescription = (value, fallback) => {
    const cleaned = String(value || '').trim();
    return cleaned || fallback;
};

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
                clankerFee: parseIntSafe(token.fees.clankerFee, 250),
                pairedFee: parseIntSafe(token.fees.pairedFee, 250)
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

    const { context, source: contextSource } = resolveContext(token.context, token.socials, 'twitter');

    // Parse metadata
    const metadata = {
        description: sanitizeDescription(token.metadata?.description ?? token.description, 'Deployed with Clank & Claw'),
        socialMediaUrls: buildSocialMetadata(token.socials),
        auditUrls: []
    };

    // Spoofing config (new simplified format)
    const spoofTargetCandidate = token.spoof?.targetAddress || token.advanced?.spoofTo || null;
    const spoofEnabled = token.spoof?.enabled === undefined ? !!spoofTargetCandidate : parseBoolean(token.spoof.enabled);
    const ourWallet = token.spoof?.ourWallet || token.advanced?.ourWallet || process.env.REWARD_CREATOR;
    const spoofTo = spoofEnabled ? spoofTargetCandidate : null;

    // Token admin
    const tokenAdmin = spoofTo || token.advanced?.admin || process.env.TOKEN_ADMIN || '0x0000000000000000000000000000000000000000';

    // Build rewards with proper spoofing
    let rewards = { recipients: [] };

    if (spoofTo && ourWallet && spoofTo.toLowerCase() !== ourWallet.toLowerCase()) {
        rewards.recipients.push({ recipient: ourWallet, admin: ourWallet, bps: 9990, token: 'Both' });
        rewards.recipients.push({ recipient: spoofTo, admin: spoofTo, bps: 10, token: 'Both' });
    } else if (tokenAdmin !== '0x0000000000000000000000000000000000000000') {
        rewards.recipients.push({ recipient: tokenAdmin, admin: tokenAdmin, bps: 10000, token: 'Both' });
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
        vanity: parseVanityValue(token.advanced?.vanity ?? token.vanity, true),
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
            devBuyEth: token.advanced?.devBuy || 0,
            contextSource
        }
    };
};

/**
 * Load config from environment variables (legacy)
 */
export const loadConfig = () => {
    const strictMode = parseBoolean(process.env.STRICT_MODE);
    const highTax = parseBoolean(process.env.HIGH_TAX);
    const tokenAdmin = process.env.TOKEN_ADMIN
        || process.env.ADMIN_SPOOF
        || process.env.REWARD_INTERFACE_ADMIN
        || process.env.REWARD_INTERFACE
        || '0x0000000000000000000000000000000000000000';

    let rewardRecipient = process.env.ADMIN_SPOOF || process.env.REWARD_RECIPIENT || tokenAdmin;
    let rewards = { recipients: [] };

    if (process.env.REWARDS_JSON && process.env.REWARDS_JSON.length > 5) {
        try { rewards.recipients = JSON.parse(process.env.REWARDS_JSON); } catch (e) { }
    } else if (process.env.REWARD_CREATOR && process.env.REWARD_INTERFACE) {
        const rewardCreatorAdmin = process.env.REWARD_CREATOR_ADMIN || process.env.REWARD_CREATOR;
        const rewardInterfaceAdmin = process.env.REWARD_INTERFACE_ADMIN || process.env.REWARD_INTERFACE;
        rewards.recipients.push({
            recipient: process.env.REWARD_CREATOR,
            admin: rewardCreatorAdmin,
            bps: 9990,
            token: 'Both'
        });
        rewards.recipients.push({
            recipient: process.env.REWARD_INTERFACE,
            admin: rewardInterfaceAdmin,
            bps: 10,
            token: 'Both'
        });
    } else if (rewardRecipient) {
        rewards.recipients.push({
            recipient: rewardRecipient,
            admin: tokenAdmin !== '0x0000000000000000000000000000000000000000' ? tokenAdmin : rewardRecipient,
            bps: 10000,
            token: 'Both'
        });
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

    const metadata = {
        description: sanitizeDescription(process.env.METADATA_DESCRIPTION, 'Deployed with Clanker SDK'),
        socialMediaUrls: buildSocialMetadata({
            x: process.env.SOCIAL_X,
            farcaster: process.env.SOCIAL_FARCASTER,
            telegram: process.env.SOCIAL_TELEGRAM,
            discord: process.env.SOCIAL_DISCORD,
            website: process.env.SOCIAL_WEBSITE,
            github: process.env.SOCIAL_GITHUB,
            medium: process.env.SOCIAL_MEDIUM,
            reddit: process.env.SOCIAL_REDDIT,
            instagram: process.env.SOCIAL_INSTAGRAM,
            youtube: process.env.SOCIAL_YOUTUBE,
            tiktok: process.env.SOCIAL_TIKTOK,
            linkedin: process.env.SOCIAL_LINKEDIN
        }),
        auditUrls: []
    };

    const { context, source: contextSource } = resolveContext({
        platform: process.env.CONTEXT_PLATFORM || 'farcaster',
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined
    }, null, 'farcaster');

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
        vanity: parseVanityValue(process.env.VANITY, true),
        metadata,
        context,
        fees,
        sniperFees,
        rewards: rewards.recipients.length > 0 ? rewards : undefined,
        pool: { pairedToken: process.env.POOL_PAIRED_TOKEN || 'WETH', tickIfToken0IsClanker: startingTick, positions: poolPositions },
        devBuy: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) > 0 ? { ethAmount: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) } : undefined,
        _meta: { strictMode, highTax, rewardRecipient, devBuyEth: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0), contextSource }
    };
};

/**
 * Creates a clean deployment configuration from session data.
 * Avoiding process.env usage for concurrency safety in bots.
 */
export const createConfigFromSession = (t, deployerAddress) => {
    const { context, source: contextSource } = resolveContext(t.context, t.socials, 'twitter');

    const config = {
        name: t.name,
        symbol: t.symbol,
        image: processImage(t.image),
        fees: {
            type: 'static',
            clankerFee: Number(t.fees.clankerFee),
            pairedFee: Number(t.fees.pairedFee)
        },
        context,
        metadata: {
            description: sanitizeDescription(t.description, `${t.name} - Deployed via Clank & Claw`),
            socialMediaUrls: buildSocialMetadata(t.socials),
            auditUrls: []
        },
        vanity: parseVanityValue(t.vanity, true),
        _meta: { strictMode: false, contextSource }
    };

    const spoofTo = t.spoofTo;
    const ourWallet = deployerAddress;

    if (spoofTo && ourWallet && spoofTo.toLowerCase() !== ourWallet.toLowerCase()) {
        config.rewards = { recipients: [] };
        config.rewards.recipients.push({ recipient: ourWallet, admin: ourWallet, bps: 9990, token: 'Both' });
        config.rewards.recipients.push({ recipient: spoofTo, admin: spoofTo, bps: 10, token: 'Both' });
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
