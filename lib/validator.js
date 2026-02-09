export const validateConfig = (config) => {
    const { strictMode, highTax, devBuyEth } = config._meta;
    const { context, fees, metadata } = config;

    console.log('\n⚙️  Processing Configuration...');

    if (strictMode) console.log("🛡️  STRICT_MODE: Enabled (Enforcing Clankerworld Checklist compliance)");
    if (highTax) console.log("🏴‍☠️  DEGEN MODE: High Tax enabled (Allowing fees > 5%)");

    // Fee Validation
    if (fees.type === 'static') {
        const totalFee = fees.clankerFee + fees.pairedFee;
        if (strictMode && totalFee > 500) {
            console.warn("⚠️  STRICT_MODE: Capping fees at 5%. Disable STRICT_MODE for higher taxes.");
            fees.clankerFee = 250;
            fees.pairedFee = 250;
        } else if (totalFee > 500) {
            console.log(`🏴‍☠️  High Tax Detected (${totalFee / 100}%). Proceeding as requested.`);
        }
    } else if (fees.type === 'dynamic') {
        if (strictMode && fees.maxFee > 500) {
            fees.maxFee = 500;
        } else if (fees.maxFee > 500) {
            console.log(`🏴‍☠️  High Dynamic Max Fee Detected (${fees.maxFee / 100}%). Proceeding as requested.`);
        }
    }

    // Context & Platform Validation
    if (strictMode) {
        if (context.platform !== 'farcaster') {
            throw new Error("❌ STRICT_MODE Error: Must use farcaster platform.");
        }
        if (!context.messageId) {
            throw new Error("❌ STRICT_MODE Error: Message ID required.");
        }
    } else {
        // Validation for Indexing
        if (context.platform === 'twitter' || context.platform === 'x') {
            if (context.messageId && !context.messageId.includes('/status/')) {
                console.warn("\n⚠️  WARNING: You provided a Twitter Profile URL, not a specific Tweet.");
                console.warn("   Indexing may FAIL. Use a specific tweet URL: https://x.com/user/status/123...");
            }
        }
    }

    // Metadata Validation
    if (strictMode && metadata.description === "Deployed with Clanker SDK") {
        throw new Error("❌ STRICT_MODE Error: Custom description required.");
    }

    // Dev Buy Validation
    if (strictMode && devBuyEth <= 0) {
        throw new Error("❌ STRICT_MODE Error: Dev buy required.");
    }

    // Verification Status Check
    if (highTax || (fees.type === 'static' && (fees.clankerFee + fees.pairedFee) > 500)) {
        console.log("ℹ️  VERIFICATION: High Tax is enabled. Standard 'Blue Badge' verification requires taxes <= 5%.");
        console.log("   Your token will be INDEXED (visible) if Context is valid, but likely NOT verified.");
    }

    // Spoofing Logs (Moved from main logic to validation/logging phase)
    if (process.env.ADMIN_SPOOF) {
        console.log(`🎭  SPOOFING: Rewards redirected to ${process.env.ADMIN_SPOOF.substring(0, 10)}...`);
    }

    return config; // Return modified config (e.g. capped fees)
};
