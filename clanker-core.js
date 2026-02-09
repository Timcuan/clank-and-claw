
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

export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
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
    if (cleanKey.length !== 66) throw new Error('Invalid PRIVATE_KEY length');

    try {
        // 3. Client Initialization & Network Check
        const account = privateKeyToAccount(cleanKey);

        const publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl, {
                timeout: 20_000,
                retryCount: 3,
                retryDelay: 1000
            }),
            pollingInterval: 1000
        });

        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(rpcUrl, {
                timeout: 20_000,
                retryCount: 3,
                retryDelay: 1000
            }),
            pollingInterval: 1000
        });

        // 4. Pre-Flight Checks
        const gasPrice = await publicClient.getGasPrice();
        const gasGwei = Number(gasPrice) / 1e9;
        console.log(`📍 \x1b[33mDeployer:\x1b[0m ${account.address} (Base: ${gasGwei.toFixed(4)} gwei)`);

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
        const receipt = await publicClient.waitForTransactionReceipt({
            hash: txHash,
            timeout: 60_000
        });

        if (receipt.status === 'reverted') {
            throw new Error(`Transaction Reverted! Deployment failed on-chain.`);
        }

        // 8. Address Extraction (Robust log scanning for TokenCreated event)
        let address = null;

        if (receipt.logs && receipt.logs.length > 0) {
            console.log('🔍 Scanning transaction logs for token address...');

            for (const log of receipt.logs) {
                // Topic[1] typically contains the token address if indexed
                if (log.topics && log.topics.length >= 2) {
                    const potential = `0x${log.topics[1].slice(-40)}`;
                    // Skip the factory address
                    if (potential.toLowerCase() !== '0xe85a59c628f7d27878aceb4bf3b35733630083a9'.toLowerCase()) {
                        address = potential;
                        break;
                    }
                }
            }

            // Fallback for non-indexed logs (check data field)
            if (!address) {
                for (const log of receipt.logs) {
                    if (log.data && log.data.length >= 66) {
                        const potential = `0x${log.data.slice(26, 66)}`;
                        if (potential.toLowerCase() !== '0xe85a59c628f7d27878aceb4bf3b35733630083a9'.toLowerCase()) {
                            address = potential;
                            break;
                        }
                    }
                }
            }
        }

        if (!address || address.length < 40) {
            console.warn('⚠️  Address extraction inconclusive. Checking first log emitter.');
            address = (receipt.logs && receipt.logs[0]) ? receipt.logs[0].address : 'Check Explorer';
        }

        const scanUrl = `https://basescan.org/address/${address}`;

        console.log(`\n🎉 \x1b[32mToken Deployed Successfully!\x1b[0m`);
        console.log(`📍 Address:  \x1b[36m${address}\x1b[0m`);
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
