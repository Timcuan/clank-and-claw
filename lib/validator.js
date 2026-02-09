/**
 * ✅ Validator v2.1 - Enhanced Config Validation
 * 
 * Ensures configuration is safe, compliant, and optimal before deployment.
 */

export const validateConfig = (config) => {
    const { fees, context, metadata, image, name, symbol, rewards } = config;
    const { strictMode, rewardRecipient } = config._meta || {};

    console.log('\n⚙️  Processing Configuration...');

    // 1. Basic Metadata
    if (!name || name.length < 2) throw new Error('Token Name too short');
    if (!symbol || symbol.length < 2) throw new Error('Token Symbol too short');
    if (!image) throw new Error('Token Image (IPFS CID) required');

    // 2. Fee Validation
    if (fees.type === 'static') {
        const totalFee = fees.clankerFee + fees.pairedFee;

        // Bounds check
        if (fees.clankerFee < 0 || fees.pairedFee < 0) throw new Error('Fees cannot be negative');
        if (totalFee > 9900) throw new Error('Total fees cannot exceed 99%');

        // Strict Mode / Blue Badge
        if (strictMode) {
            if (totalFee > 500) {
                console.warn("⚠️  \x1b[33mSTRICT_MODE:\x1b[0m Capping fees at 5% (was " + totalFee / 100 + "%)");
                fees.clankerFee = Math.min(fees.clankerFee, 250);
                fees.pairedFee = Math.min(fees.pairedFee, 250);
            }
        } else if (totalFee > 500) {
            console.log(`🏴‍☠️  \x1b[35mHigh Tax Detected\x1b[0m (${totalFee / 100}%). Proceeding as requested.`);
        }
    } else if (fees.type === 'dynamic') {
        if (strictMode && fees.maxFee > 500) {
            console.warn("⚠️  \x1b[33mSTRICT_MODE:\x1b[0m Capping dynamic max fee at 5%");
            fees.maxFee = 500;
        }
    }

    // 3. Spoofing Validation
    if (rewardRecipient && rewardRecipient.startsWith('0x')) {
        // Check if rewards are set up correctly for spoofing
        if (rewards && rewards.recipients.length > 1) {
            const spoofTarget = rewards.recipients.find(r => r.bps < 100);
            const mainReceiver = rewards.recipients.find(r => r.bps > 9000);

            if (spoofTarget && mainReceiver) {
                console.log(`🎭 \x1b[35mSpoofing Active:\x1b[0m Target ${spoofTarget.recipient.substring(0, 6)}... (${spoofTarget.bps / 100}%)`);
            }
        }
    }

    // 4. Context Validation
    if (strictMode) {
        if (context.platform !== 'farcaster') {
            throw new Error("STRICT_MODE: Must use Farcaster platform for Blue Badge");
        }
        if (!context.messageId) {
            throw new Error("STRICT_MODE: Valid Cast URL/Hash required");
        }
    } else {
        if (!context.messageId) {
            console.warn("⚠️  \x1b[33mWarning:\x1b[0m No Context Link provided (Token may not index correctly)");
        }
    }

    // 5. Socials Validation
    if (metadata.socialMediaUrls.length > 0) {
        const platforms = metadata.socialMediaUrls.map(s => s.platform).join(', ');
        console.log(`🌍 \x1b[36mSocials:\x1b[0m ${platforms}`);

        // Check for invalid URLs
        metadata.socialMediaUrls.forEach(s => {
            if (!s.url.startsWith('http')) {
                throw new Error(`Invalid URL for ${s.platform}: ${s.url}`);
            }
        });
    }

    // 6. Output Summary
    console.log(`ℹ️  \x1b[36mVERIFICATION:\x1b[0m ${strictMode ? 'Strict Mode (Blue Badge)' : 'Standard Mode'}`);
    if (!strictMode && (fees.clankerFee + fees.pairedFee > 500)) {
        console.log(`   Token will be INDEXED but \x1b[31mNOT verified\x1b[0m (Blue Badge requires ≤5%)`);
    }

    return config;
};

export default { validateConfig };
