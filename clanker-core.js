import { Clanker } from 'clanker-sdk/v4';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * Core function to deploy a Clanker token.
 * Can be imported and used by other scripts or AI agents (e.g. OpenClaw).
 */
export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
        dryRun = process.env.DRY_RUN === 'true'
    } = options;

    console.log(`\n⏳ Deploying "${config.name}" (${config.symbol})...`);

    if (dryRun) {
        console.log('\n✅ DRY RUN: Configuration valid. Skipping deployment.');
        return { success: true, dryRun: true, config };
    }

    if (!privateKey) {
        throw new Error('PRIVATE_KEY is required for deployment.');
    }

    // Initialize Clients
    const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
    const publicClient = createPublicClient({ chain: base, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ account, chain: base, transport: http(rpcUrl) });
    const clanker = new Clanker({ publicClient, wallet: walletClient });

    try {
        const { txHash, waitForTransaction, error } = await clanker.deploy(config);

        if (error) {
            return { success: false, error };
        }

        console.log(`✅ Transaction Hash: ${txHash}`);
        console.log('⏳ Waiting for block confirmation...');

        const result = await waitForTransaction();

        if (result.error) {
            return { success: false, error: result.error };
        }

        const { address } = result;

        return {
            success: true,
            address,
            txHash,
            scanUrl: `https://basescan.org/address/${address}`
        };
    } catch (err) {
        return { success: false, error: err.message || err };
    }
}
