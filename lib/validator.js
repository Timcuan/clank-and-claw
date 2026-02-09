/**
 * ✅ Validator v2.2 - Defensive Config Validation
 *
 * Ensures configuration is safe, compliant, and resilient to malformed input.
 */

const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,46}|baf[a-zA-Z0-9]{50,})$/;

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

    const meta = config._meta || {};
    const strictMode = !!meta.strictMode;
    const rewardRecipient = meta.rewardRecipient;

    config.name = String(config.name || '').trim();
    config.symbol = String(config.symbol || '').trim();
    config.image = String(config.image || '').trim();

    config.fees = (config.fees && typeof config.fees === 'object')
        ? config.fees
        : { type: 'static', clankerFee: 250, pairedFee: 250 };

    config.context = (config.context && typeof config.context === 'object') ? config.context : {};
    config.metadata = (config.metadata && typeof config.metadata === 'object') ? config.metadata : {};
    if (!Array.isArray(config.metadata.socialMediaUrls)) config.metadata.socialMediaUrls = [];
    if (!Array.isArray(config.metadata.auditUrls)) config.metadata.auditUrls = [];

    const recipients = Array.isArray(config.rewards?.recipients) ? config.rewards.recipients : [];

    console.log('\n⚙️  Processing Configuration...');

    // 1. Basic Metadata
    if (config.name.length < 2) throw new Error('Token Name too short');
    if (config.name.length > 64) throw new Error('Token Name too long (max 64)');
    config.symbol = config.symbol.toUpperCase();
    if (config.symbol.length < 2) throw new Error('Token Symbol too short');
    if (config.symbol.length > 15) throw new Error('Token Symbol too long (max 15)');
    if (!/^[A-Z0-9]+$/.test(config.symbol)) throw new Error('Token Symbol must be alphanumeric uppercase');
    if (!isImageRef(config.image)) throw new Error('Token Image must be a valid HTTP(S) URL or IPFS CID');

    // 2. Fee Validation
    if (config.fees.type === 'static') {
        const clankerFee = Number(config.fees.clankerFee);
        const pairedFee = Number(config.fees.pairedFee);
        if (!Number.isFinite(clankerFee) || !Number.isFinite(pairedFee)) {
            throw new Error('Static fees must be numeric');
        }

        config.fees.clankerFee = Math.round(clankerFee);
        config.fees.pairedFee = Math.round(pairedFee);

        const totalFee = config.fees.clankerFee + config.fees.pairedFee;
        if (config.fees.clankerFee < 0 || config.fees.pairedFee < 0) {
            throw new Error('Fees cannot be negative');
        }

        if (totalFee > 500) {
            console.warn(`⚠️  \x1b[33mLIMIT REACHED:\x1b[0m Fees capped at 5% (was ${totalFee / 100}%). Clanker protocol limit exceeded.`);
            config.fees.clankerFee = 250;
            config.fees.pairedFee = 250;
        }
    } else if (config.fees.type === 'dynamic') {
        const maxFee = Number(config.fees.maxFee);
        if (config.fees.maxFee !== undefined && !Number.isFinite(maxFee)) {
            throw new Error('Dynamic maxFee must be numeric');
        }
        if (Number.isFinite(maxFee)) {
            config.fees.maxFee = Math.round(maxFee);
        }
        if (strictMode && Number.isFinite(config.fees.maxFee) && config.fees.maxFee > 500) {
            console.warn("⚠️  \x1b[33mSTRICT_MODE:\x1b[0m Capping dynamic max fee at 5%");
            config.fees.maxFee = 500;
        }
    } else {
        throw new Error(`Unsupported fee type: ${config.fees.type}`);
    }

    // 3.5 Admin and Rewards Validation
    if (config.tokenAdmin && !isAddress(config.tokenAdmin)) {
        throw new Error(`Invalid tokenAdmin address: ${config.tokenAdmin}`);
    }

    recipients.forEach((r, idx) => {
        if (!r || typeof r !== 'object') {
            throw new Error(`Invalid rewards recipient at index ${idx}`);
        }
        if (!isAddress(r.recipient)) {
            throw new Error(`Invalid rewards recipient address at index ${idx}: ${r.recipient}`);
        }
        if (r.admin && !isAddress(r.admin)) {
            throw new Error(`Invalid rewards admin address at index ${idx}: ${r.admin}`);
        }
        const bps = Number(r.bps);
        if (!Number.isFinite(bps) || bps < 0 || bps > 10000) {
            throw new Error(`Invalid rewards bps at index ${idx}: ${r.bps}`);
        }
    });

    if (recipients.length > 0) {
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
    const platform = String(config.context.platform || '').toLowerCase();
    if (config.context.messageId !== undefined && config.context.messageId !== null) {
        config.context.messageId = String(config.context.messageId).trim();
    }
    const messageId = config.context.messageId;
    if (strictMode) {
        if (platform !== 'farcaster') {
            throw new Error('STRICT_MODE: Must use Farcaster platform for Blue Badge');
        }
        if (!messageId) {
            throw new Error('STRICT_MODE: Valid Cast URL/Hash required');
        }
    } else if (!messageId) {
        console.warn('⚠️  \x1b[33mWarning:\x1b[0m No Context Link provided (Token may not index correctly)');
    }

    // 5. Socials Validation
    if (config.metadata.socialMediaUrls.length > 0) {
        const validSocials = config.metadata.socialMediaUrls.filter(item => item && typeof item === 'object');
        const platforms = validSocials.map(s => s.platform).filter(Boolean).join(', ');
        if (platforms) console.log(`🌍 \x1b[36mSocials:\x1b[0m ${platforms}`);

        validSocials.forEach(s => {
            if (!isHttpUrl(s.url)) {
                throw new Error(`Invalid URL for ${s.platform || 'unknown'}: ${s.url}`);
            }
        });
    }

    if (typeof rewardRecipient === 'string' && !isAddress(rewardRecipient) && !isZeroAddress(rewardRecipient)) {
        console.warn(`⚠️  \x1b[33mWarning:\x1b[0m _meta.rewardRecipient is not a valid address: ${rewardRecipient}`);
    }

    // 6. Output Summary
    console.log(`ℹ️  \x1b[36mVERIFICATION:\x1b[0m ${strictMode ? 'Strict Mode (Blue Badge)' : 'Standard Mode'}`);
    if (!strictMode && config.fees.type === 'static' && (config.fees.clankerFee + config.fees.pairedFee > 500)) {
        console.log('   Token will be INDEXED but \x1b[31mNOT verified\x1b[0m (Blue Badge requires ≤5%)');
    }

    return config;
};

export default { validateConfig };
