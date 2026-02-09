import fs from 'fs';
import { normalizeBool, normalizeNumber, pick, setEnvIf } from './lib/utils.js';

const readStdin = async () => {
    return new Promise((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { data += chunk; });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', err => reject(err));
    });
};

const parseJson = (raw, label) => {
    try {
        return JSON.parse(raw);
    } catch (err) {
        throw new Error(`Invalid JSON in ${label}: ${err.message}`);
    }
};

const loadInput = async () => {
    if (!process.stdin.isTTY) {
        const stdin = await readStdin();
        if (stdin && stdin.trim()) return parseJson(stdin, 'stdin');
    }

    const args = process.argv.slice(2);
    if (args[0] === '--file') {
        const path = args[1];
        if (!path) throw new Error('Missing path after --file');
        const raw = fs.readFileSync(path, 'utf8');
        return parseJson(raw, path);
    }

    if (args[0]) {
        return parseJson(args[0], 'argv');
    }

    if (process.env.OPENCLAW_INPUT) {
        return parseJson(process.env.OPENCLAW_INPUT, 'OPENCLAW_INPUT');
    }

    throw new Error('No OpenClaw input found. Provide JSON via stdin, argv, --file, or OPENCLAW_INPUT.');
};

const applyInputToEnv = (input) => {
    const metadata = input.metadata || input.METADATA || {};
    const socials = input.socials || input.SOCIALS || {};
    const context = input.context || input.CONTEXT || {};
    const fees = input.fees || input.FEES || {};
    const sniperFees = input.sniperFees || input.SNIPER_FEES || {};
    const pool = input.pool || input.POOL || {};
    const rewards = input.rewards || input.REWARDS || {};

    setEnvIf('TOKEN_NAME', pick(input, ['TOKEN_NAME', 'tokenName', 'name']));
    setEnvIf('TOKEN_SYMBOL', pick(input, ['TOKEN_SYMBOL', 'tokenSymbol', 'symbol']));
    setEnvIf('TOKEN_IMAGE', pick(input, ['TOKEN_IMAGE', 'tokenImage', 'image']));
    setEnvIf('METADATA_DESCRIPTION', pick(input, ['METADATA_DESCRIPTION', 'description']) ?? metadata.description);

    setEnvIf('SOCIAL_X', pick(input, ['SOCIAL_X']) ?? socials.x);
    setEnvIf('SOCIAL_TELEGRAM', pick(input, ['SOCIAL_TELEGRAM']) ?? socials.telegram);
    setEnvIf('SOCIAL_FARCASTER', pick(input, ['SOCIAL_FARCASTER']) ?? socials.farcaster);
    setEnvIf('SOCIAL_WEBSITE', pick(input, ['SOCIAL_WEBSITE']) ?? socials.website);

    setEnvIf('CONTEXT_PLATFORM', pick(input, ['CONTEXT_PLATFORM']) ?? context.platform);
    setEnvIf('CONTEXT_MESSAGE_ID', pick(input, ['CONTEXT_MESSAGE_ID']) ?? context.messageId);

    const strictMode = pick(input, ['STRICT_MODE', 'strictMode']);
    const dryRun = pick(input, ['DRY_RUN', 'dryRun']);
    const vanity = pick(input, ['VANITY', 'vanity']);

    const strictModeEffective = normalizeBool(strictMode);
    setEnvIf('STRICT_MODE', strictModeEffective === undefined ? 'true' : String(strictModeEffective));
    setEnvIf('DRY_RUN', normalizeBool(dryRun));
    setEnvIf('VANITY', normalizeBool(vanity));

    setEnvIf('RPC_URL', pick(input, ['RPC_URL', 'rpcUrl']));
    setEnvIf('PRIVATE_KEY', pick(input, ['PRIVATE_KEY', 'privateKey']));

    setEnvIf('TOKEN_ADMIN', pick(input, ['TOKEN_ADMIN', 'tokenAdmin', 'admin']));
    setEnvIf('ADMIN_SPOOF', pick(input, ['ADMIN_SPOOF', 'adminSpoof']));
    setEnvIf('REWARD_RECIPIENT', pick(input, ['REWARD_RECIPIENT', 'rewardRecipient']));
    setEnvIf('REWARD_CREATOR', pick(input, ['REWARD_CREATOR', 'rewardCreator']));
    setEnvIf('REWARD_INTERFACE', pick(input, ['REWARD_INTERFACE', 'rewardInterface']));
    setEnvIf('REWARD_CREATOR_ADMIN', pick(input, ['REWARD_CREATOR_ADMIN', 'rewardCreatorAdmin']));
    setEnvIf('REWARD_INTERFACE_ADMIN', pick(input, ['REWARD_INTERFACE_ADMIN', 'rewardInterfaceAdmin']));

    if (Array.isArray(rewards.recipients)) {
        setEnvIf('REWARDS_JSON', JSON.stringify(rewards.recipients));
    } else if (input.REWARDS_JSON) {
        setEnvIf('REWARDS_JSON', input.REWARDS_JSON);
    }

    if (fees.type) setEnvIf('FEE_TYPE', fees.type);
    if (fees.clankerFee !== undefined) setEnvIf('FEE_CLANKER_BPS', fees.clankerFee);
    if (fees.pairedFee !== undefined) setEnvIf('FEE_PAIRED_BPS', fees.pairedFee);
    if (fees.baseFee !== undefined) setEnvIf('FEE_DYNAMIC_BASE', fees.baseFee);
    if (fees.maxFee !== undefined) setEnvIf('FEE_DYNAMIC_MAX', fees.maxFee);
    if (fees.referenceTickFilterPeriod !== undefined) setEnvIf('FEE_DYNAMIC_PERIOD', fees.referenceTickFilterPeriod);
    if (fees.resetPeriod !== undefined) setEnvIf('FEE_DYNAMIC_RESET', fees.resetPeriod);
    if (fees.resetTickFilter !== undefined) setEnvIf('FEE_DYNAMIC_FILTER', fees.resetTickFilter);
    if (fees.feeControlNumerator !== undefined) setEnvIf('FEE_DYNAMIC_CONTROL', fees.feeControlNumerator);
    if (fees.decayFilterBps !== undefined) setEnvIf('FEE_DYNAMIC_DECAY', fees.decayFilterBps);

    if (sniperFees.startingFee !== undefined) setEnvIf('SNIPER_STARTING_FEE', sniperFees.startingFee);
    if (sniperFees.endingFee !== undefined) setEnvIf('SNIPER_ENDING_FEE', sniperFees.endingFee);
    if (sniperFees.secondsToDecay !== undefined) setEnvIf('SNIPER_SECONDS_TO_DECAY', sniperFees.secondsToDecay);

    if (pool.type !== undefined) setEnvIf('POOL_TYPE', pool.type);
    if (pool.startingTick !== undefined) setEnvIf('POOL_STARTING_TICK', pool.startingTick);
    if (pool.pairedToken !== undefined) setEnvIf('POOL_PAIRED_TOKEN', pool.pairedToken);
    if (pool.positions !== undefined) {
        if (typeof pool.positions === 'string') {
            setEnvIf('POOL_POSITIONS_JSON', pool.positions);
        } else {
            setEnvIf('POOL_POSITIONS_JSON', JSON.stringify(pool.positions));
        }
    }

    const devBuy = pick(input, ['DEV_BUY_ETH_AMOUNT', 'devBuyEthAmount']) ?? (input.devBuy ? input.devBuy.ethAmount : undefined);
    if (devBuy !== undefined) setEnvIf('DEV_BUY_ETH_AMOUNT', devBuy);
};

const validateInput = (input) => {
    const strictMode = normalizeBool(pick(input, ['STRICT_MODE', 'strictMode'])) ?? true;

    const tokenName = pick(input, ['TOKEN_NAME', 'tokenName', 'name']);
    const tokenSymbol = pick(input, ['TOKEN_SYMBOL', 'tokenSymbol', 'symbol']);
    const tokenImage = pick(input, ['TOKEN_IMAGE', 'tokenImage', 'image']);
    if (!tokenName || !tokenSymbol) {
        throw new Error('TOKEN_NAME and TOKEN_SYMBOL are required.');
    }
    if (!tokenImage) {
        throw new Error('TOKEN_IMAGE is required.');
    }

    if (strictMode) {
        const description = pick(input, ['METADATA_DESCRIPTION', 'description'])
            ?? (input.metadata || {}).description
            ?? (input.METADATA || {}).description;
        const contextMessageId = pick(input, ['CONTEXT_MESSAGE_ID'])
            ?? (input.context || {}).messageId
            ?? (input.CONTEXT || {}).messageId;
        const contextPlatform = pick(input, ['CONTEXT_PLATFORM'])
            ?? (input.context || {}).platform
            ?? (input.CONTEXT || {}).platform;
        const devBuy = normalizeNumber(pick(input, ['DEV_BUY_ETH_AMOUNT', 'devBuyEthAmount']))
            ?? (input.devBuy ? normalizeNumber(input.devBuy.ethAmount) : undefined);

        if (!description) throw new Error('STRICT_MODE requires METADATA_DESCRIPTION.');
        if (!contextMessageId) throw new Error('STRICT_MODE requires CONTEXT_MESSAGE_ID.');
        if ((contextPlatform || 'farcaster').toLowerCase() !== 'farcaster') {
            throw new Error('STRICT_MODE requires CONTEXT_PLATFORM="farcaster".');
        }
        if (!devBuy || devBuy <= 0) {
            throw new Error('STRICT_MODE requires DEV_BUY_ETH_AMOUNT > 0.');
        }
    }

    const pool = input.pool || input.POOL || {};
    if (pool.positions !== undefined && !Array.isArray(pool.positions)) {
        throw new Error('POOL.positions must be an array when provided.');
    }
};

const main = async () => {
    const input = await loadInput();
    validateInput(input);
    applyInputToEnv(input);
    await import('./deploy.js');
};

main().catch((err) => {
    console.error(`\n💥 OpenClaw Error: ${err.message}`);
    process.exit(1);
});
