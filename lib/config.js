
import { POOL_POSITIONS } from 'clanker-sdk';
import { processImage, parseBoolean, parseIntSafe, parseFloatSafe, normalizeBool } from './utils.js';
import { parseFees } from './parser.js';
import { detectSocialPlatform } from './social-parser.js';
import fs from 'fs';
import 'dotenv/config';

const DEFAULT_STATIC_CLANKER_FEE_BPS = 300;
const DEFAULT_STATIC_PAIRED_FEE_BPS = 300;
const DEFAULT_DYNAMIC_BASE_FEE_BPS = 100;
const DEFAULT_DYNAMIC_MAX_FEE_BPS = 1000;

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

        // Generic URL fallback for any source platform.
        return url.toString();
    } catch (e) {
        return clean; // Not a URL, return as raw ID
    }
};

const inferContextPlatformFromUrl = (input) => {
    if (!input) return null;
    const detected = detectSocialPlatform(String(input).trim());
    if (detected?.platform) return detected.platform;
    try { new URL(String(input).trim()); return 'website'; } catch { return null; }
};

const extractContextUserId = (input, platformHint = '') => {
    if (!input) return undefined;
    const raw = String(input).trim();
    if (!raw) return undefined;

    // Accept explicit ids/handles directly.
    if (!/^https?:\/\//i.test(raw)) {
        return raw.startsWith('@') ? raw.slice(1) : raw;
    }

    try {
        const url = new URL(raw);
        const parts = url.pathname.split('/').filter(Boolean);
        const host = url.hostname.toLowerCase();
        const platform = String(platformHint || '').toLowerCase();

        // X/Twitter URL pattern: /<handle>/status/<tweetId>
        if (platform === 'twitter' || host.includes('x.com') || host.includes('twitter.com')) {
            const statusIdx = parts.indexOf('status');
            if (statusIdx > 0 && parts[statusIdx - 1]) return parts[statusIdx - 1].replace(/^@/, '');
        }

        // Warpcast URL pattern commonly starts with username then cast hash.
        if (platform === 'farcaster' || host.includes('warpcast.com')) {
            if (parts[0] && !parts[0].startsWith('0x')) return parts[0].replace(/^@/, '');
        }

        // Generic fallback: first path segment as profile/author hint.
        if (parts[0] && !parts[0].startsWith('0x')) return parts[0].replace(/^@/, '');
    } catch {
        return undefined;
    }

    return undefined;
};

const SOCIAL_PLATFORM_ALIASES = {
    twitter: 'x',
    xcom: 'x',
    web: 'website',
    url: 'website'
};

const normalizeContextPlatform = (value, fallback = 'twitter') => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || fallback;
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

const isHttpUrl = (value) => {
    if (!value) return false;
    try {
        const parsed = new URL(String(value).trim());
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
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
    const contextUrlCandidate = contextInput?.url || (isHttpUrl(contextInput?.messageId) ? contextInput?.messageId : '');
    const explicitPlatform = normalizeContextPlatform(contextInput?.platform, fallbackPlatform);
    const urlInferredPlatform = inferContextPlatformFromUrl(contextUrlCandidate);
    const context = {
        interface: 'Clanker SDK',
        platform: explicitPlatform,
        messageId: undefined,
        id: undefined
    };

    const messageIdFromUrl = extractMessageId(contextUrlCandidate);
    const messageIdFromField = extractMessageId(contextInput?.messageId);

    let messageId = undefined;
    let source = 'missing';

    if (messageIdFromUrl) {
        messageId = messageIdFromUrl;
        source = 'context-url';
    } else if (messageIdFromField) {
        messageId = messageIdFromField;
        source = 'context';
    }

    if (urlInferredPlatform && (!contextInput?.platform || urlInferredPlatform !== explicitPlatform)) {
        context.platform = urlInferredPlatform;
    }

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

    if (!context.platform) {
        context.platform = normalizeContextPlatform(undefined, 'clanker');
    }

    let userId = extractContextUserId(contextInput?.id ?? contextInput?.userId, context.platform)
        || extractContextUserId(contextUrlCandidate, context.platform);

    if (!userId && socialsInput && typeof socialsInput === 'object') {
        if (context.platform === 'twitter') {
            userId = extractContextUserId(socialsInput.x || socialsInput.twitter, 'twitter');
        } else if (context.platform === 'farcaster') {
            userId = extractContextUserId(socialsInput.farcaster, 'farcaster');
        }
    }

    context.messageId = messageId;
    context.id = userId;
    return { context, source };
};

const parseVanityValue = (value, fallback = true) => {
    const normalized = normalizeBool(value);
    return normalized === undefined ? fallback : normalized;
};

const stripJsonComments = (input) => {
    let out = '';
    let inString = false;
    let inLineComment = false;
    let inBlockComment = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];
        const next = input[i + 1];

        if (inLineComment) {
            if (ch === '\n') {
                inLineComment = false;
                out += '\n';
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i++;
                continue;
            }
            if (ch === '\n') out += '\n';
            continue;
        }

        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }

        if (ch === '/' && next === '/') {
            inLineComment = true;
            i++;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i++;
            continue;
        }

        out += ch;
    }

    return out;
};

const removeTrailingCommas = (input) => {
    let out = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < input.length; i++) {
        const ch = input[i];

        if (inString) {
            out += ch;
            if (escaped) {
                escaped = false;
            } else if (ch === '\\') {
                escaped = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }

        if (ch === '"') {
            inString = true;
            out += ch;
            continue;
        }

        if (ch === ',') {
            let j = i + 1;
            while (j < input.length && /\s/.test(input[j])) j++;
            const next = input[j];
            if (next === '}' || next === ']') {
                continue;
            }
        }

        out += ch;
    }

    return out;
};

const sanitizeRelaxedJson = (raw) => {
    const noBom = String(raw || '').replace(/^\uFEFF/, '');
    const normalizedQuotes = noBom
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
    return removeTrailingCommas(stripJsonComments(normalizedQuotes));
};

const positionToLineCol = (raw, position) => {
    const safePos = Math.max(0, Math.min(Number(position) || 0, raw.length));
    let line = 1;
    let column = 1;
    for (let i = 0; i < safePos; i++) {
        if (raw[i] === '\n') {
            line++;
            column = 1;
        } else {
            column++;
        }
    }
    return { line, column };
};

const parseTokenJsonOrThrow = (raw, filePath) => {
    try {
        return JSON.parse(raw);
    } catch (error) {
        const relaxed = sanitizeRelaxedJson(raw);
        try {
            return JSON.parse(relaxed);
        } catch {
            const message = String(error?.message || 'Unknown JSON parse error');
            const match = message.match(/position\s+(\d+)/i);
            if (!match) {
                throw new Error(`Invalid JSON in ${filePath}: ${message}`);
            }

            const position = Number(match[1]);
            const { line, column } = positionToLineCol(raw, position);
            throw new Error(`Invalid JSON in ${filePath} at line ${line}, column ${column}: ${message}`);
        }
    }
};

const sanitizeDescription = (value, fallback) => {
    const cleaned = String(value || '').trim();
    return cleaned || fallback;
};

const toBpsFromPercent = (value, fallbackBps) => {
    const num = Number(value);
    return Number.isFinite(num) ? Math.round(num * 100) : fallbackBps;
};

const resolveFeeBps = ({ bpsValue, percentValue, fallbackBps }) => {
    const bps = Number(bpsValue);
    if (Number.isFinite(bps)) return Math.round(bps);
    return toBpsFromPercent(percentValue, fallbackBps);
};

const parseStaticFeesConfig = (input = {}) => ({
    type: 'static',
    clankerFee: resolveFeeBps({
        bpsValue: input.clankerFeeBps ?? input.clankerFee,
        percentValue: input.clankerFeePercent,
        fallbackBps: DEFAULT_STATIC_CLANKER_FEE_BPS
    }),
    pairedFee: resolveFeeBps({
        bpsValue: input.pairedFeeBps ?? input.pairedFee,
        percentValue: input.pairedFeePercent,
        fallbackBps: DEFAULT_STATIC_PAIRED_FEE_BPS
    })
});

const parseDynamicFeesConfig = (input = {}) => ({
    type: 'dynamic',
    baseFee: resolveFeeBps({
        bpsValue: input.baseFeeBps ?? input.baseFee,
        percentValue: input.baseFeePercent,
        fallbackBps: DEFAULT_DYNAMIC_BASE_FEE_BPS
    }),
    maxFee: resolveFeeBps({
        bpsValue: input.maxFeeBps ?? input.maxFee,
        percentValue: input.maxFeePercent,
        fallbackBps: DEFAULT_DYNAMIC_MAX_FEE_BPS
    }),
    referenceTickFilterPeriod: parseIntSafe(input.adjustmentPeriod ?? input.referenceTickFilterPeriod, 3600),
    resetPeriod: parseIntSafe(input.resetPeriod, 86400),
    resetTickFilter: parseIntSafe(input.resetTickFilter, 100),
    feeControlNumerator: parseIntSafe(input.feeControlNumerator, 100000),
    decayFilterBps: parseIntSafe(input.decayFilterBps, 9500)
});

const parseTokenFees = (token) => {
    let fees = {
        type: 'static',
        clankerFee: DEFAULT_STATIC_CLANKER_FEE_BPS,
        pairedFee: DEFAULT_STATIC_PAIRED_FEE_BPS
    };

    const rawFees = token?.fees ?? token?.fee;
    let explicitMode = '';

    if (typeof rawFees === 'string' || typeof rawFees === 'number') {
        const parsed = parseFees(String(rawFees));
        if (!parsed) {
            throw new Error('Invalid fee format in token.json. Use "6%", "600bps", or set fees.mode with static/dynamic values.');
        }
        fees = { type: 'static', ...parsed };
        return fees;
    }

    if (rawFees && typeof rawFees === 'object') {
        explicitMode = String(rawFees.mode || rawFees.type || '').trim().toLowerCase();

        if (explicitMode === 'dynamic') {
            const dynamicInput = (rawFees.dynamic && typeof rawFees.dynamic === 'object') ? rawFees.dynamic : rawFees;
            return parseDynamicFeesConfig(dynamicInput);
        }

        if (explicitMode === 'static') {
            const staticInput = (rawFees.static && typeof rawFees.static === 'object') ? rawFees.static : rawFees;
            return parseStaticFeesConfig(staticInput);
        }

        if (rawFees.total !== undefined) {
            const parsed = parseFees(String(rawFees.total));
            if (!parsed) {
                throw new Error('Invalid fees.total format in token.json. Use examples like "6%" or "600bps".');
            }
            return { type: 'static', ...parsed };
        }

        if (
            rawFees.clankerFee !== undefined
            || rawFees.pairedFee !== undefined
            || rawFees.clankerFeeBps !== undefined
            || rawFees.pairedFeeBps !== undefined
            || rawFees.clankerFeePercent !== undefined
            || rawFees.pairedFeePercent !== undefined
        ) {
            return parseStaticFeesConfig(rawFees);
        }

        if (
            rawFees.baseFee !== undefined
            || rawFees.maxFee !== undefined
            || rawFees.baseFeeBps !== undefined
            || rawFees.maxFeeBps !== undefined
            || rawFees.baseFeePercent !== undefined
            || rawFees.maxFeePercent !== undefined
        ) {
            return parseDynamicFeesConfig(rawFees);
        }

        const meaningfulKeys = Object.keys(rawFees).filter((key) => {
            const normalized = String(key || '').trim().toLowerCase();
            if (!normalized) return false;
            if (normalized.startsWith('_')) return false;
            if (['comment', 'comments', 'note', 'notes', 'help'].includes(normalized)) return false;
            return true;
        });
        if (meaningfulKeys.length > 0) {
            throw new Error('Invalid fees object in token.json. Use fees.mode = "static" or "dynamic" with matching fields.');
        }
    }

    // Legacy compatibility: token.dynamicFees block.
    if (token?.dynamicFees?.enabled && explicitMode !== 'static') {
        return parseDynamicFeesConfig({
            baseFeePercent: token.dynamicFees.baseFee,
            maxFeePercent: token.dynamicFees.maxFee,
            adjustmentPeriod: token.dynamicFees.adjustmentPeriod,
            resetPeriod: token.dynamicFees.resetPeriod
        });
    }

    return fees;
};

const mergeSocialInputs = (token) => {
    const nested = (token?.socials && typeof token.socials === 'object') ? token.socials : {};
    return {
        ...nested,
        x: nested.x ?? nested.twitter ?? token?.x ?? token?.twitter,
        farcaster: nested.farcaster ?? token?.farcaster,
        telegram: nested.telegram ?? token?.telegram,
        discord: nested.discord ?? token?.discord,
        website: nested.website ?? token?.website,
        github: nested.github ?? token?.github,
        medium: nested.medium ?? token?.medium,
        reddit: nested.reddit ?? token?.reddit,
        instagram: nested.instagram ?? token?.instagram,
        youtube: nested.youtube ?? token?.youtube,
        tiktok: nested.tiktok ?? token?.tiktok,
        linkedin: nested.linkedin ?? token?.linkedin
    };
};

const buildContextInput = (token) => {
    const nested = (token?.context && typeof token.context === 'object') ? { ...token.context } : {};
    if (!nested.url && token?.contextUrl) nested.url = token.contextUrl;
    if (!nested.platform && token?.contextPlatform) nested.platform = token.contextPlatform;
    if (!nested.messageId && token?.contextMessageId) nested.messageId = token.contextMessageId;
    if (!nested.messageId && token?.contextId) nested.messageId = token.contextId;
    if (!nested.id && token?.contextUserId) nested.id = token.contextUserId;
    if (!nested.id && token?.contextProfileId) nested.id = token.contextProfileId;
    return nested;
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
    const token = parseTokenJsonOrThrow(raw, filePath);
    const smartValidation = false;
    const allowCustomFeeRange = parseBoolean(token?.advanced?.allowCustomFeeRange) ?? false;
    const tokenJsonHasExplicitFees = (
        token?.fees !== undefined
        || token?.fee !== undefined
        || (token?.dynamicFees && token.dynamicFees.enabled === true)
    );

    const fees = parseTokenFees(token);
    const socialsInput = mergeSocialInputs(token);
    const contextInput = buildContextInput(token);

    const { context, source: contextSource } = resolveContext(contextInput, socialsInput, 'twitter');

    // Parse metadata
    const metadata = {
        description: sanitizeDescription(token.metadata?.description ?? token.description, 'Deployed with Clank & Claw'),
        socialMediaUrls: buildSocialMetadata(socialsInput),
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
        name: String(token.name ?? ''),
        symbol: String(token.symbol ?? ''),
        tokenAdmin,
        image: processImage(token.image ?? ''),
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
            configSource: 'token-json',
            allowCustomFeeRange,
            tokenJsonHasExplicitFees,
            strictMode: token.advanced?.strictMode || false,
            smartValidation: smartValidation === undefined ? false : smartValidation,
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
            clankerFee: parseIntSafe(process.env.FEE_CLANKER_BPS, DEFAULT_STATIC_CLANKER_FEE_BPS),
            pairedFee: parseIntSafe(process.env.FEE_PAIRED_BPS, DEFAULT_STATIC_PAIRED_FEE_BPS)
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
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined,
        id: process.env.CONTEXT_USER_ID || undefined
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
