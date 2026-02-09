import { POOL_POSITIONS } from 'clanker-sdk';
import { processImage, parseBoolean, parseIntSafe, parseFloatSafe } from './utils.js';
import 'dotenv/config';

export const loadConfig = () => {
    const strictMode = parseBoolean(process.env.STRICT_MODE);
    const highTax = parseBoolean(process.env.HIGH_TAX);
    const tokenAdmin = process.env.TOKEN_ADMIN || (process.env.REWARD_INTERFACE_ADMIN ? process.env.REWARD_INTERFACE_ADMIN : "0x0000000000000000000000000000000000000000");

    // Rewards Logic
    let rewardRecipient = process.env.ADMIN_SPOOF || process.env.REWARD_RECIPIENT || tokenAdmin;
    let rewards = { recipients: [] };

    if (process.env.REWARDS_JSON && process.env.REWARDS_JSON.length > 5) {
        try {
            rewards.recipients = JSON.parse(process.env.REWARDS_JSON);
        } catch (e) {
            console.error("❌ Error parsing REWARDS_JSON");
        }
    } else {
        if (process.env.REWARD_CREATOR && process.env.REWARD_INTERFACE) {
            const creatorAdmin = process.env.REWARD_CREATOR_ADMIN || tokenAdmin;
            const interfaceAdmin = process.env.REWARD_INTERFACE_ADMIN || tokenAdmin;

            rewards.recipients.push({
                recipient: process.env.REWARD_CREATOR,
                admin: creatorAdmin,
                bps: 9990,
                token: "Both"
            });
            rewards.recipients.push({
                recipient: process.env.REWARD_INTERFACE,
                admin: interfaceAdmin,
                bps: 10,
                token: "Both"
            });
        } else {
            // If explicit reward recipient logic is missing, we handle it in validator or default here
            if (rewardRecipient) {
                rewards.recipients.push({
                    recipient: rewardRecipient,
                    admin: tokenAdmin,
                    bps: 10000,
                    token: "Both"
                });
            }
        }
    }

    // Fees Logic
    let fees = {};
    const feeType = (process.env.FEE_TYPE || "static").toLowerCase();

    if (feeType === 'dynamic') {
        fees = {
            type: "dynamic",
            baseFee: parseIntSafe(process.env.FEE_DYNAMIC_BASE, 50),
            maxFee: parseIntSafe(process.env.FEE_DYNAMIC_MAX, 500),
            referenceTickFilterPeriod: parseIntSafe(process.env.FEE_DYNAMIC_PERIOD, 3600),
            resetPeriod: parseIntSafe(process.env.FEE_DYNAMIC_RESET, 86400),
            resetTickFilter: parseIntSafe(process.env.FEE_DYNAMIC_FILTER, 100),
            feeControlNumerator: parseIntSafe(process.env.FEE_DYNAMIC_CONTROL, 100000),
            decayFilterBps: parseIntSafe(process.env.FEE_DYNAMIC_DECAY, 9500),
        };
    } else {
        fees = {
            type: "static",
            clankerFee: parseIntSafe(process.env.FEE_CLANKER_BPS, 100),
            pairedFee: parseIntSafe(process.env.FEE_PAIRED_BPS, 100),
        };
    }

    // Sniper Logic
    let sniperFees = undefined;
    if (process.env.SNIPER_STARTING_FEE || process.env.SNIPER_ENDING_FEE) {
        sniperFees = {
            startingFee: parseIntSafe(process.env.SNIPER_STARTING_FEE, 666777),
            endingFee: parseIntSafe(process.env.SNIPER_ENDING_FEE, 41673),
            secondsToDecay: parseIntSafe(process.env.SNIPER_SECONDS_TO_DECAY, 15)
        };
    }

    // Metadata
    const metadata = {
        description: process.env.METADATA_DESCRIPTION || "Deployed with Clanker SDK",
        socialMediaUrls: [],
        auditUrls: [],
    };
    const addSocial = (platform, url) => { if (url && url.startsWith('http')) metadata.socialMediaUrls.push({ platform, url }); };
    addSocial('x', process.env.SOCIAL_X);
    addSocial('telegram', process.env.SOCIAL_TELEGRAM);
    addSocial('farcaster', process.env.SOCIAL_FARCASTER);
    addSocial('website', process.env.SOCIAL_WEBSITE);

    // Context
    const context = {
        interface: "Clanker SDK",
        platform: (process.env.CONTEXT_PLATFORM || "farcaster").toLowerCase(),
        messageId: process.env.CONTEXT_MESSAGE_ID || undefined,
    };

    // Pool
    const poolType = (process.env.POOL_TYPE || "Standard").trim();
    const tickSpacing = 200;
    const startingTick = Math.round(parseIntSafe(process.env.POOL_STARTING_TICK, -230400) / tickSpacing) * tickSpacing;
    let poolPositions = POOL_POSITIONS[poolType] || POOL_POSITIONS.Standard;

    if (process.env.POOL_POSITIONS_JSON) {
        try {
            const parsed = JSON.parse(process.env.POOL_POSITIONS_JSON);
            if (Array.isArray(parsed) && parsed.length > 0) poolPositions = parsed;
        } catch (e) {
            console.error("❌ Error parsing POOL_POSITIONS_JSON");
        }
    } else if (poolType === "Standard") {
        poolPositions = [{ tickLower: startingTick, tickUpper: startingTick + 110400, positionBps: 10000 }];
    }

    return {
        name: process.env.TOKEN_NAME || "My Token",
        symbol: process.env.TOKEN_SYMBOL || "TOKEN",
        tokenAdmin,
        image: processImage(process.env.TOKEN_IMAGE),
        vanity: parseBoolean(process.env.VANITY),
        metadata,
        context,
        fees,
        sniperFees,
        rewards: rewards.recipients.length > 0 ? rewards : undefined,
        pool: {
            pairedToken: process.env.POOL_PAIRED_TOKEN || "WETH",
            tickIfToken0IsClanker: startingTick,
            positions: poolPositions
        },
        devBuy: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) > 0 ? { ethAmount: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0) } : undefined,
        _meta: { // internal meta for validation usage
            strictMode,
            highTax,
            rewardRecipient,
            devBuyEth: parseFloatSafe(process.env.DEV_BUY_ETH_AMOUNT, 0)
        }
    };
};
