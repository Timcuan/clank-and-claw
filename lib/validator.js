/**
 * ✅ Validator v2.2 - Defensive Config Validation
 *
 * Ensures configuration is safe, compliant, and resilient to malformed input.
 */

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,46}|baf[a-zA-Z0-9]{50,})$/;
const CONTEXT_PLATFORM_SET = new Set(['twitter', 'farcaster', 'clanker']);
const MAX_DESCRIPTION_LENGTH = 1000;
const FALLBACK_IMAGE_CID = 'bafkreib5h4mmqsgmm7at7wphdfy66oh4yfcqo6dz64olhwv3nejq5ysycm';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const DEFAULT_STATIC_CLANKER_FEE_BPS = 300;
const DEFAULT_STATIC_PAIRED_FEE_BPS = 300;
const MAX_STATIC_TOTAL_FEE_BPS = 600;

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
const normalizeSymbolCandidate = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeContextPlatform = (value, fallback = 'twitter') => {
    const normalized = String(value || '').trim().toLowerCase();
    return CONTEXT_PLATFORM_SET.has(normalized) ? normalized : fallback;
};
const generateFallbackSymbol = (name) => {
    const fromName = normalizeSymbolCandidate(name).slice(0, 15);
    if (fromName.length >= 2) return fromName;
    if (fromName.length === 1) return `${fromName}X`;
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
const getContextFallback = (platformHint = 'twitter') => {
    const defaultId = String(process.env.DEFAULT_CONTEXT_ID || '').trim();
    if (defaultId) {
        return {
            platform: normalizeContextPlatform(process.env.DEFAULT_CONTEXT_PLATFORM, normalizeContextPlatform(platformHint, 'twitter')),
            messageId: defaultId,
            source: 'default'
        };
    }

    const platform = normalizeContextPlatform(platformHint, 'twitter');
    if (platform === 'farcaster') {
        return {
            platform: 'farcaster',
            messageId: generateSyntheticCastHash(),
            source: 'synthetic'
        };
    }

    return {
        platform: 'twitter',
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
    const smartMode = String(process.env.SMART_VALIDATION || 'true').trim().toLowerCase() !== 'false';
    const rewardRecipient = meta.rewardRecipient;
    if (!Array.isArray(meta.autoFixes)) meta.autoFixes = [];
    const addFix = (message) => {
        meta.autoFixes.push(message);
        console.warn(`🛠️  \x1b[33mSmart Fix:\x1b[0m ${message}`);
    };

    config.name = normalizeWhitespace(config.name);
    config.symbol = normalizeWhitespace(config.symbol);
    config.image = String(config.image || '').trim();

    config.fees = (config.fees && typeof config.fees === 'object')
        ? config.fees
        : {
            type: 'static',
            clankerFee: DEFAULT_STATIC_CLANKER_FEE_BPS,
            pairedFee: DEFAULT_STATIC_PAIRED_FEE_BPS
        };

    config.context = (config.context && typeof config.context === 'object') ? config.context : {};
    config.metadata = (config.metadata && typeof config.metadata === 'object') ? config.metadata : {};
    if (!Array.isArray(config.metadata.socialMediaUrls)) config.metadata.socialMediaUrls = [];
    if (!Array.isArray(config.metadata.auditUrls)) config.metadata.auditUrls = [];
    config.vanity = normalizeBooleanWithFallback(config.vanity, true);
    config.metadata.description = String(config.metadata.description || '').trim() || 'Deployed with Clanker SDK';
    if (config.metadata.description.length > MAX_DESCRIPTION_LENGTH) {
        console.warn(`⚠️  \x1b[33mWarning:\x1b[0m Metadata description too long, truncating to ${MAX_DESCRIPTION_LENGTH} chars`);
        config.metadata.description = config.metadata.description.slice(0, MAX_DESCRIPTION_LENGTH);
    }

    console.log('\n⚙️  Processing Configuration...');

    // 1. Basic Metadata
    config.symbol = normalizeSymbolCandidate(config.symbol);
    if (!config.symbol) {
        config.symbol = generateFallbackSymbol(config.name);
        addFix(`Generated token symbol fallback: ${config.symbol}`);
    }
    if (config.symbol.length < 2) {
        config.symbol = `${config.symbol}X`.slice(0, 15);
        addFix(`Token symbol too short; expanded to ${config.symbol}`);
    }
    if (config.symbol.length > 15) {
        config.symbol = config.symbol.slice(0, 15);
        addFix('Token symbol too long; truncated to 15 chars');
    }
    if (!/^[A-Z0-9]+$/.test(config.symbol)) {
        if (!smartMode) throw new Error('Token Symbol must be alphanumeric uppercase');
        config.symbol = generateFallbackSymbol(config.name);
        addFix(`Token symbol normalized to ${config.symbol}`);
    }

    if (config.name.length < 2) {
        config.name = normalizeWhitespace(`${config.name || config.symbol} Token`);
        addFix(`Generated token name fallback: ${config.name}`);
    }
    if (config.name.length > 64) {
        config.name = config.name.slice(0, 64).trim();
        addFix('Token name too long; truncated to 64 chars');
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
        if (totalFee > MAX_STATIC_TOTAL_FEE_BPS) {
            console.warn(`⚠️  \x1b[33mLIMIT REACHED:\x1b[0m Fees capped at 6% (was ${totalFee / 100}%). Clanker protocol-safe max exceeded.`);
            config.fees.clankerFee = DEFAULT_STATIC_CLANKER_FEE_BPS;
            config.fees.pairedFee = DEFAULT_STATIC_PAIRED_FEE_BPS;
            addFix(`Total fee ${totalFee} bps exceeded protocol cap; reset to ${MAX_STATIC_TOTAL_FEE_BPS} bps total`);
        }
    } else if (config.fees.type === 'dynamic') {
        const maxFee = Number(config.fees.maxFee);
        if (config.fees.maxFee !== undefined && !Number.isFinite(maxFee) && !smartMode) {
            throw new Error('Dynamic maxFee must be numeric');
        }
        if (Number.isFinite(maxFee)) {
            config.fees.maxFee = Math.round(maxFee);
        } else if (!Number.isFinite(maxFee)) {
            config.fees.maxFee = 500;
            addFix('Dynamic maxFee invalid; defaulted to 500 bps');
        }
        if (Number(config.fees.maxFee) > 500) {
            console.warn("⚠️  \x1b[33mLIMIT REACHED:\x1b[0m Dynamic max fee capped at 5%");
            config.fees.maxFee = 500;
            addFix('Dynamic max fee capped to 500 bps');
        }
        if (strictMode && Number.isFinite(config.fees.maxFee) && config.fees.maxFee > 500) {
            console.warn("⚠️  \x1b[33mSTRICT_MODE:\x1b[0m Capping dynamic max fee at 5%");
            config.fees.maxFee = 500;
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
    let platform = String(config.context.platform || 'twitter').toLowerCase().trim();
    if (!CONTEXT_PLATFORM_SET.has(platform)) {
        if (!smartMode) throw new Error(`Unsupported context platform: ${config.context.platform}`);
        platform = 'twitter';
        addFix('Unsupported context platform; fallback to twitter');
    }

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
        if (requireContext || smartMode) {
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
