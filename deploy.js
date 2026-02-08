import { deployToken } from './clanker-core.js';
import { POOL_POSITIONS } from 'clanker-sdk';
import 'dotenv/config';

/**
 * 🚀 CLI WRAPPER FOR CLANKER DEPLOYMENT
 * 
 * This script parses .env and calls clanker-core.js.
 * Easy for manual runs and CI/CD.
 */

async function main() {
    // Helper: Robust IPFS/CID Normalizer
    const processImage = (input) => {
        if (!input) return "";
        if (input.startsWith("http")) return input;
        let cleanInput = input.replace("ipfs://", "");
        const isCID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-zA-Z0-9]{50,})/.test(cleanInput);
        if (isCID) {
            return `https://gateway.pinata.cloud/ipfs/${cleanInput}`;
        }
        return input;
    };

    console.log('\n⚙️  Processing Configuration...');

    const strictMode = process.env.STRICT_MODE === 'true';
    if (strictMode) console.log("🛡️  STRICT_MODE: Enabled (Enforcing Clankerworld Checklist compliance)");

    const highTax = process.env.HIGH_TAX === 'true';
    if (highTax) console.log("🏴‍☠️  DEGEN MODE: High Tax enabled (Allowing fees > 5%)");

    // A. Admin & Recipients (Spoofing Support)
    let tokenAdmin = process.env.TOKEN_ADMIN;
    if (!tokenAdmin && process.env.REWARD_INTERFACE_ADMIN) {
        tokenAdmin = process.env.REWARD_INTERFACE_ADMIN;
    }

    // Spoofing: If ADMIN_SPOOF is set, it becomes the recipient, but tokenAdmin stays the owner.
    const rewardRecipient = process.env.ADMIN_SPOOF || process.env.REWARD_RECIPIENT || tokenAdmin;
    if (process.env.ADMIN_SPOOF) console.log(`🎭  SPOOFING: Rewards redirected to ${process.env.ADMIN_SPOOF.substring(0, 10)}...`);

    // B. Fees
    let fees = {};
    const feeType = (process.env.FEE_TYPE || "static").toLowerCase();

    if (feeType === 'dynamic') {
        fees = {
            type: "dynamic",
            baseFee: parseInt(process.env.FEE_DYNAMIC_BASE || "50"),
            maxFee: parseInt(process.env.FEE_DYNAMIC_MAX || "500"),
            referenceTickFilterPeriod: parseInt(process.env.FEE_DYNAMIC_PERIOD || "3600"),
            resetPeriod: parseInt(process.env.FEE_DYNAMIC_RESET || "86400"),
            resetTickFilter: parseInt(process.env.FEE_DYNAMIC_FILTER || "100"),
            feeControlNumerator: parseInt(process.env.FEE_DYNAMIC_CONTROL || "100000"),
            decayFilterBps: parseInt(process.env.FEE_DYNAMIC_DECAY || "9500"),
        };
        // Cap only if STRICT_MODE is on. HIGH_TAX allows up to 3000 (SDK Limit)
        if (strictMode && fees.maxFee > 500) fees.maxFee = 500;
        else if (fees.maxFee > 500 && !highTax) {
            console.warn("⚠️  WARNING: Fees > 5% without HIGH_TAX=true. Capping for safety.");
            fees.maxFee = 500;
        }
    } else {
        fees = {
            type: "static",
            clankerFee: parseInt(process.env.FEE_CLANKER_BPS || "100"),
            pairedFee: parseInt(process.env.FEE_PAIRED_BPS || "100"),
        };
        const totalFee = fees.clankerFee + fees.pairedFee;
        if (strictMode && totalFee > 500) {
            fees.clankerFee = 250;
            fees.pairedFee = 250;
        } else if (totalFee > 500 && !highTax) {
            console.warn("⚠️  WARNING: High Fees Detected without HIGH_TAX=true. Adjusting to 5% total.");
            fees.clankerFee = 250;
            fees.pairedFee = 250;
        }
    }

    // Sniper Fees
    let sniperFees = undefined;
    if (process.env.SNIPER_STARTING_FEE || process.env.SNIPER_ENDING_FEE) {
        sniperFees = {
            startingFee: parseInt(process.env.SNIPER_STARTING_FEE || "666777"),
            endingFee: parseInt(process.env.SNIPER_ENDING_FEE || "41673"),
            secondsToDecay: parseInt(process.env.SNIPER_SECONDS_TO_DECAY || "15")
        };
    }

    // C. Rewards
    let rewards = { recipients: [] };
    if (process.env.REWARDS_JSON && process.env.REWARDS_JSON.length > 5) {
        try {
            rewards.recipients = JSON.parse(process.env.REWARDS_JSON);
        } catch (e) { console.error("❌ Error parsing REWARDS_JSON"); }
    } else {
        if (process.env.REWARD_CREATOR && process.env.REWARD_INTERFACE) {
            rewards.recipients.push({ recipient: process.env.REWARD_CREATOR, bps: 9990, token: "Both" });
            rewards.recipients.push({ recipient: process.env.REWARD_INTERFACE, bps: 10, token: "Both" });
        } else {
            if (!rewardRecipient) {
                console.error("❌ Error: Missing TOKEN_ADMIN/REWARD_RECIPIENT (or REWARD_CREATOR + REWARD_INTERFACE).");
                process.exit(1);
            }
            rewards.recipients.push({ recipient: rewardRecipient, bps: 10000, token: "Both" });
        }
    }

    // D. Metadata & Context
    const metadata = {
        description: process.env.METADATA_DESCRIPTION || "Deployed with Clanker SDK",
        socialMediaUrls: [],
        auditUrls: [],
    };
    if (strictMode && metadata.description === "Deployed with Clanker SDK") {
        console.error("❌ STRICT_MODE Error: Custom description required.");
        process.exit(1);
    }

    const addSocial = (platform, url) => { if (url && url.startsWith('http')) metadata.socialMediaUrls.push({ platform, url }); };
    addSocial('x', process.env.SOCIAL_X);
    addSocial('telegram', process.env.SOCIAL_TELEGRAM);
    addSocial('farcaster', process.env.SOCIAL_FARCASTER);
    addSocial('website', process.env.SOCIAL_WEBSITE);

    const context = {
        interface: "Clanker SDK",
        platform: process.env.CONTEXT_PLATFORM || "farcaster",
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined,
    };

    if (strictMode) {
        if (context.platform.toLowerCase() !== 'farcaster') { console.error("❌ STRICT_MODE Error: Must use farcaster platform."); process.exit(1); }
        if (!context.messageId) { console.error("❌ STRICT_MODE Error: Message ID required."); process.exit(1); }
    }

    // E. Pool
    const poolType = (process.env.POOL_TYPE || "Standard").trim();
    const tickSpacing = 200;
    const startingTick = Math.round(parseInt(process.env.POOL_STARTING_TICK || "-230400") / tickSpacing) * tickSpacing;
    let poolPositions = POOL_POSITIONS[poolType] || POOL_POSITIONS.Standard;
    if (process.env.POOL_POSITIONS_JSON) {
        try {
            const parsedPositions = JSON.parse(process.env.POOL_POSITIONS_JSON);
            if (Array.isArray(parsedPositions) && parsedPositions.length > 0) {
                poolPositions = parsedPositions;
            } else {
                console.error("❌ Error: POOL_POSITIONS_JSON must be a non-empty array.");
                process.exit(1);
            }
        } catch (e) {
            console.error("❌ Error parsing POOL_POSITIONS_JSON");
            process.exit(1);
        }
    } else if (poolType === "Standard") {
        poolPositions = [{ tickLower: startingTick, tickUpper: startingTick + 110400, positionBps: 10000 }];
    }

    const config = {
        name: process.env.TOKEN_NAME || "My Token",
        symbol: process.env.TOKEN_SYMBOL || "TOKEN",
        tokenAdmin: tokenAdmin || "0x0000000000000000000000000000000000000000",
        image: processImage(process.env.TOKEN_IMAGE),
        vanity: process.env.VANITY === 'true',
        metadata,
        context,
        fees,
        sniperFees,
        rewards: rewards.recipients.length > 0 ? rewards : undefined,
        pool: { pairedToken: process.env.POOL_PAIRED_TOKEN || "WETH", tickIfToken0IsClanker: startingTick, positions: poolPositions }
    };

    const devBuyEth = parseFloat(process.env.DEV_BUY_ETH_AMOUNT || "0");
    if (devBuyEth > 0) config.devBuy = { ethAmount: devBuyEth };
    else if (strictMode) { console.error("❌ STRICT_MODE Error: Dev buy required."); process.exit(1); }

    // Final Call to Core
    const result = await deployToken(config);

    if (result.success) {
        if (result.dryRun) return;
        console.log('\n====================================');
        console.log('🎉 TOKEN DEPLOYED SUCCESSFULLY!');
        console.log(`📍 Address:  ${result.address}`);
        console.log(`🔗 Basescan: ${result.scanUrl}`);
        console.log('====================================');
    } else {
        console.error('\n❌ Deployment Failed:', result.error);
    }
}

main().catch(error => { console.error('\n💥 Critical Error:', error); process.exit(1); });
