/**
 * ✅ Validator v2.2 - Defensive Config Validation
 *
 * Ensures configuration is safe, compliant, and resilient to malformed input.
 */

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,46}|baf[a-zA-Z0-9]{50,})$/;
const CONTEXT_PLATFORM_SET = new Set([
    'twitter', 'x', 'farcaster', 'clanker', 'website',
    'telegram', 'discord', 'github', 'medium', 'reddit',
    'instagram', 'youtube', 'tiktok', 'linkedin'
]);
const FALLBACK_IMAGE_CID = 'bafkreib5h4mmqsgmm7at7wphdfy66oh4yfcqo6dz64olhwv3nejq5ysycm';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_STATIC_CLANKER_FEE_BPS = 300;
const DEFAULT_STATIC_PAIRED_FEE_BPS = 300;
const MAX_STATIC_TOTAL_FEE_BPS = 600;
const DEFAULT_DYNAMIC_BASE_FEE_BPS = 100;
const DEFAULT_DYNAMIC_MAX_FEE_BPS = 1000;

const isHttpUrl = (value) => {
    if (typeof value !== 'string') return false;
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
};

const isAddress = (value) => ADDRESS_REGEX.test(String(value || ''));
const isZeroAddress = (value) => String(value || '').toLowerCase() === '0x0000000000000000000000000000000000000000';
const normalizeWhitespace = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeContextPlatform = (value, fallback = 'clanker') => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return fallback;
    if (normalized === 'x') return 'twitter';
    return CONTEXT_PLATFORM_SET.has(normalized) ? normalized : fallback;
};
const generateFallbackSymbol = (name) => {
    const raw = String(name || '').trim();
    const ascii = raw
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '')
        .trim();
    if (ascii.length >= 2) return ascii;
    if (ascii.length === 1) return `${ascii}X`;
    return 'CLAW';
};
const getFallbackImageRef = () => {
    const envUrl = String(process.env.DEFAULT_IMAGE_URL || '').trim();
    if (isHttpUrl(envUrl)) return envUrl;

    const envCid = String(process.env.DEFAULT_IMAGE_CID || '').trim();
    const cid = CID_REGEX.test(envCid) ? envCid : FALLBACK_IMAGE_CID;
    return `https://gateway.pinata.cloud/ipfs/${cid}`;
};
const generateSyntheticContextId = () => (1800000000000000000n + BigInt(Date.now())).toString();
const generateSyntheticCastHash = () => `0x${Date.now().toString(16)}${Math.floor(Math.random() * 0xfffffff).toString(16)}`;
const getContextFallback = (platformHint = 'clanker') => {
    const defaultId = String(process.env.DEFAULT_CONTEXT_ID || '').trim();
    if (defaultId) {
        return {
            platform: normalizeContextPlatform(process.env.DEFAULT_CONTEXT_PLATFORM, normalizeContextPlatform(platformHint, 'clanker')),
            messageId: defaultId,
            source: 'default'
        };
    }

    const platform = normalizeContextPlatform(platformHint, 'clanker');
    if (platform === 'farcaster') {
        return {
            platform: 'farcaster',
            messageId: generateSyntheticCastHash(),
            source: 'synthetic'
        };
    }

    return {
        platform,
        messageId: generateSyntheticContextId(),
        source: 'synthetic'
    };
};
const normalizeSocialUrl = (platform, value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (isHttpUrl(raw)) return raw;

    if (raw.startsWith('@') && platform === 'x') {
        return `https://x.com/${raw.slice(1)}`;
    }

    if (/^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw)) {
        return `https://${raw}`;
    }

    if (/^(x\.com|twitter\.com|warpcast\.com|t\.me|discord\.gg|discord\.com\/invite\/|github\.com|medium\.com|reddit\.com|instagram\.com|youtube\.com|youtu\.be|tiktok\.com|linkedin\.com|www\.)/i.test(raw)) {
        return `https://${raw}`;
    }

    return raw;
};
const normalizeRewardsRecipients = (input, addFix) => {
    if (!Array.isArray(input) || input.length === 0) return [];

    const normalized = [];
    for (const [idx, item] of input.entries()) {
        if (!item || typeof item !== 'object') {
            addFix(`Dropped invalid rewards entry at index ${idx}`);
            continue;
        }

        const recipient = String(item.recipient || '').trim();
        if (!isAddress(recipient)) {
            addFix(`Dropped rewards recipient with invalid address at index ${idx}`);
            continue;
        }

        const rawBps = Number(item.bps);
        const safeBps = Number.isFinite(rawBps) ? clamp(Math.round(rawBps), 0, 10000) : 0;
        if (!Number.isFinite(rawBps)) {
            addFix(`Rewards bps at index ${idx} invalid; defaulted to 0`);
        }

        const admin = isAddress(item.admin) ? item.admin : recipient;
        if (item.admin && !isAddress(item.admin)) {
            addFix(`Rewards admin at index ${idx} invalid; defaulted to recipient`);
        }

        normalized.push({
            recipient,
            admin,
            bps: safeBps,
            token: String(item.token || 'Both')
        });
    }

    if (normalized.length === 0) return [];

    if (normalized.length === 1) {
        normalized[0].bps = 10000;
        return normalized;
    }

    const total = normalized.reduce((sum, r) => sum + Number(r.bps || 0), 0);
    if (total <= 0) {
        normalized[0].bps = 10000;
        for (let i = 1; i < normalized.length; i++) normalized[i].bps = 0;
        addFix('Rewards total bps was 0; reassigned 10000 bps to first recipient');
        return normalized;
    }

    if (total !== 10000) {
        let used = 0;
        for (const item of normalized) {
            item.bps = Math.floor((item.bps / total) * 10000);
            used += item.bps;
        }
        normalized[0].bps += (10000 - used);
        addFix(`Normalized rewards total from ${total} bps to 10000 bps`);
    }

    return normalized;
};
const normalizeBooleanWithFallback = (value, fallback = false) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    return fallback;
};
const normalizeContextMessageId = (platform, value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^\d+$/.test(raw) || /^0x[a-fA-F0-9]{8,}$/.test(raw)) return raw;

    try {
        const parsed = new URL(raw);
        const hostname = parsed.hostname.toLowerCase();
        const parts = parsed.pathname.split('/').filter(Boolean);

        if (platform === 'twitter' || hostname.includes('twitter.com') || hostname.includes('x.com')) {
            const idx = parts.indexOf('status');
            if (idx !== -1 && /^\d+$/.test(parts[idx + 1] || '')) {
                return parts[idx + 1];
            }
        }

        if (platform === 'farcaster' || hostname.includes('warpcast.com')) {
            const hash = parts.find(p => /^0x[a-fA-F0-9]{8,}$/.test(p));
            if (hash) return hash;
        }
    } catch {
        // keep raw
    }

    return raw;
};
const isImageRef = (value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const trimmed = value.trim();
    if (isHttpUrl(trimmed)) return true;
    if (trimmed.startsWith('ipfs://')) return CID_REGEX.test(trimmed.replace('ipfs://', ''));
    return CID_REGEX.test(trimmed);
};

export const validateConfig = (config) => {
    if (!config || typeof config !== 'object') {
        throw new Error('Invalid configuration object');
    }

    if (!config._meta || typeof config._meta !== 'object') config._meta = {};
    const meta = config._meta;
    let strictMode = !!meta.strictMode;
    const metaSmartMode = typeof meta.smartValidation === 'boolean' ? meta.smartValidation : undefined;
    const smartMode = metaSmartMode !== undefined
        ? metaSmartMode
        : (String(process.env.SMART_VALIDATION || 'true').trim().toLowerCase() !== 'false');
    const strictTokenJsonMode = meta.configSource === 'token-json' && !smartMode;
    const allowCustomFeeRange = meta.allowCustomFeeRange === true || meta.configSource === 'token-json';
    const rewardRecipient = meta.rewardRecipient;
    if (!Array.isArray(meta.autoFixes)) meta.autoFixes = [];
    const addFix = (message) => {
        meta.autoFixes.push(message);
        console.warn(`🛠️  \x1b[33mSmart Fix:\x1b[0m ${message}`);
    };

    config.name = String(config.name ?? '');
    config.symbol = String(config.symbol ?? '');
    config.image = String(config.image || '').trim();

    if (!config.fees || typeof config.fees !== 'object') {
        if (strictTokenJsonMode) {
            throw new Error('Fees are required in token.json (set fees.mode and fee values)');
        }
        config.fees = {
            type: 'static',
            clankerFee: DEFAULT_STATIC_CLANKER_FEE_BPS,
            pairedFee: DEFAULT_STATIC_PAIRED_FEE_BPS
        };
    }

    if (strictTokenJsonMode && meta.tokenJsonHasExplicitFees !== true) {
        throw new Error('Fees are required in token.json (set fees.mode and fee values)');
    }

    config.context = (config.context && typeof config.context === 'object') ? config.context : {};
    config.metadata = (config.metadata && typeof config.metadata === 'object') ? config.metadata : {};
    if (!Array.isArray(config.metadata.socialMediaUrls)) config.metadata.socialMediaUrls = [];
    if (!Array.isArray(config.metadata.auditUrls)) config.metadata.auditUrls = [];
    config.vanity = normalizeBooleanWithFallback(config.vanity, true);
    config.metadata.description = String(config.metadata.description || '').trim() || 'Deployed with Clanker SDK';

    console.log('\n⚙️  Processing Configuration...');

    // 1. Basic Metadata
    config.symbol = String(config.symbol ?? '');
    if (!config.symbol.trim()) {
        if (!smartMode) throw new Error('Token symbol is required (non-empty)');
        config.symbol = generateFallbackSymbol(config.name);
        addFix(`Generated token symbol fallback: ${config.symbol}`);
    }

    if (!String(config.name || '').trim()) {
        if (!smartMode) throw new Error('Token name is required (non-empty)');
        config.name = normalizeWhitespace(`${config.symbol} Token`);
        addFix(`Generated token name fallback: ${config.name}`);
    }

    if (!isImageRef(config.image)) {
        if (!smartMode) throw new Error('Token Image must be a valid HTTP(S) URL or IPFS CID');
        config.image = getFallbackImageRef();
        addFix(`Image missing/invalid; fallback image applied (${config.image})`);
    }

    // 2. Fee Validation
    config.fees.type = String(config.fees.type || 'static').toLowerCase();
    if (config.fees.type === 'static') {
        const clankerFee = Number(config.fees.clankerFee);
        const pairedFee = Number(config.fees.pairedFee);
        if (!Number.isFinite(clankerFee) || !Number.isFinite(pairedFee)) {
            if (!smartMode) throw new Error('Static fees must be numeric');
            config.fees.clankerFee = DEFAULT_STATIC_CLANKER_FEE_BPS;
            config.fees.pairedFee = DEFAULT_STATIC_PAIRED_FEE_BPS;
            addFix('Invalid static fees detected; reset to 3% + 3%');
        } else {
            config.fees.clankerFee = Math.round(clankerFee);
            config.fees.pairedFee = Math.round(pairedFee);
        }

        if (config.fees.clankerFee < 0 || config.fees.pairedFee < 0) {
            if (!smartMode) throw new Error('Fees cannot be negative');
            config.fees.clankerFee = Math.max(0, config.fees.clankerFee);
            config.fees.pairedFee = Math.max(0, config.fees.pairedFee);
            addFix('Negative fees detected; clamped to 0 minimum');
        }

        const totalFee = config.fees.clankerFee + config.fees.pairedFee;
        if (!allowCustomFeeRange && totalFee > MAX_STATIC_TOTAL_FEE_BPS) {
            console.warn(`⚠️  \x1b[33mLIMIT REACHED:\x1b[0m Fees capped at 6% (was ${totalFee / 100}%). Clanker protocol-safe max exceeded.`);
            config.fees.clankerFee = DEFAULT_STATIC_CLANKER_FEE_BPS;
            config.fees.pairedFee = DEFAULT_STATIC_PAIRED_FEE_BPS;
            addFix(`Total fee ${totalFee} bps exceeded protocol cap; reset to ${MAX_STATIC_TOTAL_FEE_BPS} bps total`);
        }

        const strictStaticTotal = Number(config.fees.clankerFee) + Number(config.fees.pairedFee);
        if (strictMode && strictStaticTotal > 500) {
            if (!smartMode) throw new Error('STRICT_MODE: Static total fee must be <= 500 bps');
            strictMode = false;
            config._meta.strictMode = false;
            addFix('Strict mode auto-disabled: static total fee exceeds 5%');
        }
    } else if (config.fees.type === 'dynamic') {
        const baseFee = Number(config.fees.baseFee);
        const maxFee = Number(config.fees.maxFee);
        if (config.fees.baseFee !== undefined && !Number.isFinite(baseFee) && !smartMode) {
            throw new Error('Dynamic baseFee must be numeric');
        }
        if (config.fees.maxFee !== undefined && !Number.isFinite(maxFee) && !smartMode) {
            throw new Error('Dynamic maxFee must be numeric');
        }
        if (Number.isFinite(baseFee)) {
            config.fees.baseFee = Math.round(baseFee);
        } else if (!Number.isFinite(baseFee)) {
            config.fees.baseFee = DEFAULT_DYNAMIC_BASE_FEE_BPS;
            addFix(`Dynamic baseFee invalid; defaulted to ${DEFAULT_DYNAMIC_BASE_FEE_BPS} bps`);
        }
        if (Number.isFinite(maxFee)) {
            config.fees.maxFee = Math.round(maxFee);
        } else if (!Number.isFinite(maxFee)) {
            config.fees.maxFee = DEFAULT_DYNAMIC_MAX_FEE_BPS;
            addFix(`Dynamic maxFee invalid; defaulted to ${DEFAULT_DYNAMIC_MAX_FEE_BPS} bps`);
        }
        if (config.fees.baseFee < 0 || config.fees.maxFee < 0) {
            if (!smartMode) throw new Error('Dynamic fees cannot be negative');
            config.fees.baseFee = Math.max(0, Number(config.fees.baseFee || 0));
            config.fees.maxFee = Math.max(0, Number(config.fees.maxFee || 0));
            addFix('Negative dynamic fees detected; clamped to 0 minimum');
        }
        if (config.fees.baseFee > config.fees.maxFee) {
            if (!smartMode) throw new Error('Dynamic baseFee cannot exceed maxFee');
            config.fees.baseFee = config.fees.maxFee;
            addFix('Dynamic baseFee exceeded maxFee; aligned baseFee to maxFee');
        }
        if (!allowCustomFeeRange && Number(config.fees.maxFee) > 500) {
            console.warn("⚠️  \x1b[33mLIMIT REACHED:\x1b[0m Dynamic max fee capped at 5%");
            config.fees.maxFee = 500;
            addFix('Dynamic max fee capped to 500 bps');
        }
        if (strictMode && Number.isFinite(config.fees.maxFee) && config.fees.maxFee > 500) {
            if (!smartMode) throw new Error('STRICT_MODE: Dynamic max fee must be <= 500 bps');
            strictMode = false;
            config._meta.strictMode = false;
            addFix('Strict mode auto-disabled: dynamic max fee exceeds 5%');
        }
    } else {
        if (!smartMode) throw new Error(`Unsupported fee type: ${config.fees.type}`);
        config.fees = {
            type: 'static',
            clankerFee: DEFAULT_STATIC_CLANKER_FEE_BPS,
            pairedFee: DEFAULT_STATIC_PAIRED_FEE_BPS
        };
        addFix('Unsupported fee type detected; reset to static 3% + 3%');
    }

    // 3.5 Admin and Rewards Validation
    if (config.tokenAdmin && !isAddress(config.tokenAdmin)) {
        if (!smartMode) throw new Error(`Invalid tokenAdmin address: ${config.tokenAdmin}`);
        config.tokenAdmin = ZERO_ADDRESS;
        addFix('Invalid tokenAdmin address replaced with zero-address');
    }

    const rawRecipients = Array.isArray(config.rewards?.recipients) ? config.rewards.recipients : [];
    const recipients = normalizeRewardsRecipients(rawRecipients, addFix);
    if (recipients.length === 0) {
        delete config.rewards;
    } else {
        config.rewards = { recipients };
        const totalBps = recipients.reduce((sum, r) => sum + Number(r.bps || 0), 0);
        if (Math.round(totalBps) !== 10000) {
            console.warn(`⚠️  \x1b[33mWarning:\x1b[0m Rewards total is ${totalBps} bps (expected 10000)`);
        }
    }

    // 3. Spoofing Validation
    if (typeof rewardRecipient === 'string' && rewardRecipient.startsWith('0x') && recipients.length > 1) {
        const spoofTarget = recipients.find(r => Number(r?.bps) < 100);
        const mainReceiver = recipients.find(r => Number(r?.bps) > 9000);
        if (spoofTarget && mainReceiver && typeof spoofTarget.recipient === 'string') {
            console.log(`🎭 \x1b[35mSpoofing Active:\x1b[0m Target ${spoofTarget.recipient.substring(0, 6)}... (${Number(spoofTarget.bps) / 100}%)`);
        }
    }

    // 4. Context Validation
    const requireContext = String(process.env.REQUIRE_CONTEXT || '').trim().toLowerCase() === 'true';
    let platform = normalizeContextPlatform(config.context.platform, 'clanker');

    let messageId = normalizeContextMessageId(platform, config.context.messageId);

    if (strictMode) {
        if (platform !== 'farcaster') {
            if (!smartMode) throw new Error('STRICT_MODE: Must use Farcaster platform for Blue Badge');
            strictMode = false;
            config._meta.strictMode = false;
            addFix('Strict mode auto-disabled: requires Farcaster context');
        }
        if (strictMode && !messageId) {
            if (!smartMode) throw new Error('STRICT_MODE: Valid Cast URL/Hash required');
            strictMode = false;
            config._meta.strictMode = false;
            addFix('Strict mode auto-disabled: missing Farcaster messageId');
        }
    }

    if (!messageId) {
        if (!smartMode && requireContext) {
            throw new Error('Context is required. Set context.url or context.messageId in token.json');
        }
        if (smartMode) {
            const fallbackContext = getContextFallback(platform);
            platform = fallbackContext.platform;
            messageId = fallbackContext.messageId;
            config._meta.contextSource = fallbackContext.source;
            addFix(`Context missing; applied ${fallbackContext.source} context fallback (${platform}:${messageId})`);
        }
    }

    config.context.platform = platform;
    config.context.messageId = messageId;

    if (!messageId) {
        console.warn('⚠️  \x1b[33mWarning:\x1b[0m No Context Link provided (Token may not index correctly)');
    }
    if (meta.contextSource === 'default') {
        console.warn('⚠️  \x1b[33mWarning:\x1b[0m Context sourced from DEFAULT_CONTEXT_ID fallback');
    }

    // 5. Socials Validation
    if (config.metadata.socialMediaUrls.length > 0) {
        const validSocials = config.metadata.socialMediaUrls.filter(item => item && typeof item === 'object');
        const dedupe = new Set();
        config.metadata.socialMediaUrls = validSocials
            .map(s => ({ platform: String(s.platform || '').trim().toLowerCase(), url: String(s.url || '').trim() }))
            .filter(s => {
                if (!s.platform || !s.url) return false;
                s.url = normalizeSocialUrl(s.platform, s.url);
                const key = `${s.platform}|${s.url}`;
                if (dedupe.has(key)) return false;
                dedupe.add(key);
                return true;
            });
        const socialList = config.metadata.socialMediaUrls;
        const platforms = socialList.map(s => s.platform).filter(Boolean).join(', ');
        if (platforms) console.log(`🌍 \x1b[36mSocials:\x1b[0m ${platforms}`);

        socialList.forEach(s => {
            if (!isHttpUrl(s.url)) {
                if (!smartMode) {
                    throw new Error(`Invalid URL for ${s.platform || 'unknown'}: ${s.url}`);
                }
                addFix(`Dropped invalid social URL for ${s.platform}: ${s.url}`);
            }
        });
        config.metadata.socialMediaUrls = socialList.filter(s => isHttpUrl(s.url));
    }

    if (typeof rewardRecipient === 'string' && !isAddress(rewardRecipient) && !isZeroAddress(rewardRecipient)) {
        console.warn(`⚠️  \x1b[33mWarning:\x1b[0m _meta.rewardRecipient is not a valid address: ${rewardRecipient}`);
    }

    // 6. Output Summary
    if (meta.autoFixes.length > 0) {
        console.log(`🧠 \x1b[36mSmart Logic:\x1b[0m Applied ${meta.autoFixes.length} auto-fix(es)`);
    }
    console.log(`ℹ️  \x1b[36mVERIFICATION:\x1b[0m ${strictMode ? 'Strict Mode (Blue Badge)' : 'Standard Mode'}`);
    if (!strictMode && config.fees.type === 'static' && (config.fees.clankerFee + config.fees.pairedFee > 500)) {
        console.log('   Token will be INDEXED but \x1b[31mNOT verified\x1b[0m (Blue Badge requires ≤5%)');
    }

    return config;
};

export default { validateConfig };
