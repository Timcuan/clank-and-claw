/**
 * ✅ Validator v2.0 - Config validation with detailed feedback
 */

export const validateConfig = (config) => {
    const { fees, context, metadata } = config;
    const { strictMode, devBuyEth } = config._meta || {};

    console.log('\n⚙️  Processing Configuration...');

    // ─────────────────────────────────────────
    // Fee Validation
    // ─────────────────────────────────────────

    if (fees.type === 'static') {
        const totalFee = fees.clankerFee + fees.pairedFee;

        // Validate bounds
        if (fees.clankerFee < 0 || fees.pairedFee < 0) {
            throw new Error('Fees cannot be negative');
        }
        if (totalFee > 9900) {
            throw new Error('Total fees cannot exceed 99%');
        }

        if (strictMode && totalFee > 500) {
            console.warn("⚠️  STRICT_MODE: Capping fees at 5%");
            fees.clankerFee = 250;
            fees.pairedFee = 250;
        } else if (totalFee > 500) {
            console.log(`🏴‍☠️  High Tax Detected (${totalFee / 100}%). Proceeding as requested.`);
        }
    } else if (fees.type === 'dynamic') {
        if (strictMode && fees.maxFee > 500) {
            fees.maxFee = 500;
        } else if (fees.maxFee > 500) {
            console.log(`🏴‍☠️  High Dynamic Fee (${fees.maxFee / 100}% max). Proceeding.`);
        }
    }

    // ─────────────────────────────────────────
    // Context Validation
    // ─────────────────────────────────────────

    if (strictMode) {
        if (context.platform !== 'farcaster') {
            throw new Error("STRICT_MODE: Must use farcaster platform");
        }
        if (!context.messageId) {
            throw new Error("STRICT_MODE: Cast URL/hash required");
        }
    } else {
        // Helpful warnings for indexing
        if (context.platform === 'twitter' || context.platform === 'x') {
            if (context.messageId && !context.messageId.includes('/status/')) {
                console.warn("\n⚠️  WARNING: Twitter Profile URL detected (not a tweet)");
                console.warn("   Indexing may FAIL. Use: https://x.com/user/status/123...");
            }
        }

        if (!context.messageId) {
            console.warn("\n⚠️  WARNING: No context link provided");
            console.warn("   Token will deploy but may not be indexed on Clankerworld");
        }
    }

    // ─────────────────────────────────────────
    // Metadata Validation
    // ─────────────────────────────────────────

    if (strictMode) {
        if (!metadata.description || metadata.description === "Deployed with Clanker SDK") {
            throw new Error("STRICT_MODE: Custom description required");
        }
        if (!metadata.socialMediaUrls || metadata.socialMediaUrls.length === 0) {
            console.warn("⚠️  STRICT_MODE: Adding social links improves verification");
        }
    }

    // ─────────────────────────────────────────
    // Dev Buy Validation
    // ─────────────────────────────────────────

    if (strictMode && devBuyEth <= 0) {
        throw new Error("STRICT_MODE: Dev buy required (set DEV_BUY_ETH_AMOUNT)");
    }

    // ─────────────────────────────────────────
    // Verification Status Feedback
    // ─────────────────────────────────────────

    const totalFee = fees.type === 'static'
        ? fees.clankerFee + fees.pairedFee
        : fees.maxFee || 0;

    if (totalFee > 500) {
        console.log("ℹ️  VERIFICATION: High Tax mode active");
        console.log("   Token will be INDEXED but NOT verified (Blue Badge requires ≤5%)");
    }

    // ─────────────────────────────────────────
    // Spoofing Feedback
    // ─────────────────────────────────────────

    if (process.env.ADMIN_SPOOF) {
        console.log(`🎭  SPOOFING: Rewards → ${process.env.ADMIN_SPOOF.substring(0, 10)}...`);
    }

    return config;
};

/**
 * Quick validation for bot use
 */
export const quickValidate = (token) => {
    const errors = [];
    const warnings = [];

    if (!token.name) errors.push('name');
    if (!token.symbol) errors.push('symbol');
    if (!token.image) errors.push('image');

    if (token.symbol && token.symbol.length > 10) {
        warnings.push('Symbol too long (max 10 chars)');
    }

    if (token.fees) {
        const total = token.fees.clankerFee + token.fees.pairedFee;
        if (total > 9900) errors.push('fees > 99%');
        if (total > 3000) warnings.push(`Very high fees (${total / 100}%)`);
    }

    if (!token.context?.messageId) {
        warnings.push('No context link (may affect indexing)');
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
};

export default { validateConfig, quickValidate };
