
import { Clanker } from 'clanker-sdk/v4';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * 🚀 Clanker Core Deployment Module v2.6.5 (Robust)
 * 
 * Handles blockchain interactions, gas estimation, and deployment execution.
 * Optimized for Base L2 with advanced log parsing for token address extraction.
 */

const FACTORY_ADDRESS = '0xe85a59c628f7d27878aceb4bf3b35733630083a9';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_REGEX = /^0x[0-9a-fA-F]{64}$/;
const RECEIPT_TIMEOUT_MS = 90_000;
const FALLBACK_RECEIPT_TIMEOUT_MS = 45_000;

const parseCsvUrls = (value) => (String(value || ''))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const uniqUrls = (items) => [...new Set(items.map(v => String(v).trim()).filter(Boolean))];

const createRpcTransport = (rpcUrl) => http(rpcUrl, {
    timeout: 20_000,
    retryCount: 3,
    retryDelay: 1000
});

const createRpcPublicClient = (rpcUrl) => createPublicClient({
    chain: base,
    transport: createRpcTransport(rpcUrl),
    pollingInterval: 1000
});

const isCandidateAddress = (value) => {
    if (!ADDRESS_REGEX.test(String(value))) return false;
    const lowered = value.toLowerCase();
    return lowered !== FACTORY_ADDRESS && lowered !== ZERO_ADDRESS;
};

const extractAddressFromTopic = (topic) => {
    if (typeof topic !== 'string' || topic.length < 40) return null;
    const candidate = `0x${topic.slice(-40)}`;
    return isCandidateAddress(candidate) ? candidate : null;
};

const extractAddressCandidatesFromData = (data) => {
    if (typeof data !== 'string' || !data.startsWith('0x')) return [];
    const hex = data.slice(2);
    if (hex.length < 64 || hex.length % 64 !== 0) return [];

    const found = [];
    for (let i = 0; i + 64 <= hex.length; i += 64) {
        const slot = hex.slice(i, i + 64);
        const candidate = `0x${slot.slice(24)}`;
        if (isCandidateAddress(candidate)) found.push(candidate);
    }
    return found;
};

const collectAddressCandidates = (logs = []) => {
    const candidates = new Map();
    const pushCandidate = (value) => {
        if (!isCandidateAddress(value)) return;
        const key = value.toLowerCase();
        if (!candidates.has(key)) candidates.set(key, value);
    };

    for (const log of logs) {
        if (Array.isArray(log.topics) && log.topics.length > 1) {
            for (const topic of log.topics.slice(1)) {
                pushCandidate(extractAddressFromTopic(topic));
            }
        }

        for (const candidate of extractAddressCandidatesFromData(log.data)) {
            pushCandidate(candidate);
        }

        pushCandidate(log.address);
    }

    return [...candidates.values()];
};

const resolveTokenAddress = async (publicClient, logs = []) => {
    const candidates = collectAddressCandidates(logs);
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
        try {
            const code = await publicClient.getBytecode({ address: candidate });
            if (code && code !== '0x') return candidate;
        } catch {
            // Continue trying other candidates
        }
    }

    return candidates[0];
};

const probeRpcUrl = async (rpcUrl) => {
    try {
        const client = createRpcPublicClient(rpcUrl);
        await client.getBlockNumber();
        return true;
    } catch {
        return false;
    }
};

const selectHealthyRpcUrl = async (rpcUrls = []) => {
    for (const rpcUrl of rpcUrls) {
        const ok = await probeRpcUrl(rpcUrl);
        if (ok) return rpcUrl;
    }
    return null;
};

const recoverReceiptFromRpcFallbacks = async (txHash, rpcUrls = [], excludeRpcUrl = null) => {
    const candidates = rpcUrls.filter(url => url && url !== excludeRpcUrl);
    if (candidates.length === 0) return null;

    const startedAt = Date.now();
    while (Date.now() - startedAt < FALLBACK_RECEIPT_TIMEOUT_MS) {
        for (const rpcUrl of candidates) {
            try {
                const client = createRpcPublicClient(rpcUrl);
                const receipt = await client.getTransactionReceipt({ hash: txHash });
                if (receipt) {
                    return { receipt, rpcUrl };
                }
            } catch {
                // Continue trying other RPC endpoints
            }
        }
        await new Promise(resolve => setTimeout(resolve, 3_000));
    }

    return null;
};

export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
        rpcFallbackUrls = process.env.RPC_FALLBACK_URLS || '',
        dryRun = process.env.DRY_RUN === 'true'
    } = options;

    console.log(`\n⏳ \x1b[36mInitializing Deployment Sequence...\x1b[0m`);
    console.log(`🚀 \x1b[32mTurbo Mode:\x1b[0m Active (1s heart-beat)`);

    // 1. Dry Run Handling
    if (dryRun) {
        console.log(`\n✅ \x1b[32mDRY RUN MODE ACTIVE\x1b[0m`);
        return {
            success: true,
            dryRun: true,
            address: '0x(dry-run)',
            scanUrl: 'https://basescan.org/address/0x(dry-run)',
            deployer: '0x(dry-run-deployer)'
        };
    }

    // 2. Private Key Validation
    if (!privateKey) throw new Error('PRIVATE_KEY is missing');
    let cleanKey = privateKey.trim();
    if (!cleanKey.startsWith('0x')) cleanKey = `0x${cleanKey}`;
    if (!PRIVATE_KEY_REGEX.test(cleanKey)) throw new Error('Invalid PRIVATE_KEY format');

    try {
        const configuredRpcUrls = uniqUrls([rpcUrl, ...parseCsvUrls(rpcFallbackUrls)]);
        const selectedRpcUrl = await selectHealthyRpcUrl(configuredRpcUrls);
        if (!selectedRpcUrl) {
            throw new Error(`No healthy RPC endpoint available. Checked: ${configuredRpcUrls.join(', ')}`);
        }

        // 3. Client Initialization & Network Check
        const account = privateKeyToAccount(cleanKey);

        const publicClient = createRpcPublicClient(selectedRpcUrl);

        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: createRpcTransport(selectedRpcUrl),
            pollingInterval: 1000
        });

        // 4. Pre-Flight Checks
        const gasPrice = await publicClient.getGasPrice();
        const gasGwei = Number(gasPrice) / 1e9;
        console.log(`📍 \x1b[33mDeployer:\x1b[0m ${account.address} (Base: ${gasGwei.toFixed(4)} gwei)`);
        console.log(`🌐 \x1b[36mRPC:\x1b[0m ${selectedRpcUrl}`);

        // 5. Initialize SDK
        const clanker = new Clanker({ publicClient, wallet: walletClient });

        // 6. Execute Deployment
        console.log(`\n🚀 \x1b[36mSending transaction...\x1b[0m`);

        // Sanitize config for SDK (remove internal keys)
        const { _meta, ...sdkConfig } = config;

        const { txHash, error: deployError } = await clanker.deploy(sdkConfig);

        if (deployError) throw new Error(`Deploy Request Failed: ${deployError}`);
        if (!txHash) throw new Error('No Transaction Hash returned from SDK');

        console.log(`✅ \x1b[32mTX Sent:\x1b[0m ${txHash}`);
        console.log(`⏳ Waiting for confirmation...`);

        // 7. Transaction Monitoring (Directly via publicClient for standard receipt)
        let receipt;
        try {
            receipt = await publicClient.waitForTransactionReceipt({
                hash: txHash,
                timeout: RECEIPT_TIMEOUT_MS
            });
        } catch (waitError) {
            const recovered = await recoverReceiptFromRpcFallbacks(txHash, configuredRpcUrls, selectedRpcUrl);
            if (recovered?.receipt) {
                receipt = recovered.receipt;
                console.warn(`⚠️  Primary RPC timeout. Receipt recovered via fallback RPC: ${recovered.rpcUrl}`);
            } else {
                throw new Error(`Transaction sent but confirmation timed out. Track tx: https://basescan.org/tx/${txHash}`);
            }
        }

        if (receipt.status === 'reverted') {
            throw new Error(`Transaction Reverted! Deployment failed on-chain.`);
        }

        // 8. Address Extraction (Robust log scanning for TokenCreated event)
        let address = null;

        if (receipt.logs && receipt.logs.length > 0) {
            console.log('🔍 Scanning transaction logs for token address...');
            address = await resolveTokenAddress(publicClient, receipt.logs);
        }

        const scanUrl = address
            ? `https://basescan.org/address/${address}`
            : `https://basescan.org/tx/${txHash}`;

        console.log(`\n🎉 \x1b[32mToken Deployed Successfully!\x1b[0m`);
        if (!address) {
            console.warn('⚠️  Address extraction inconclusive. Use tx link to inspect logs.');
        }
        console.log(`📍 Address:  \x1b[36m${address || 'Not detected (check tx logs)'}\x1b[0m`);
        console.log(`🔗 Scan:     \x1b[34m${scanUrl}\x1b[0m`);

        return {
            success: true,
            dryRun: false,
            address,
            txHash,
            scanUrl,
            deployer: account.address
        };

    } catch (error) {
        const msg = error.message || String(error);
        console.error(`\n❌ \x1b[31mDEPLOYMENT ERROR:\x1b[0m ${msg}`);

        return {
            success: false,
            error: msg,
            address: null,
            txHash: null
        };
    }
}

export default { deployToken };
