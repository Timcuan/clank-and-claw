
import { Clanker } from 'clanker-sdk/v4';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * 🚀 Clanker Core Deployment Module v2.5
 * 
 * Handles blockchain interactions, gas estimation, and deployment execution.
 * Includes improved error handling and feedback.
 */

export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
        dryRun = process.env.DRY_RUN === 'true'
    } = options;

    console.log(`\n⏳ \x1b[36mInitializing Deployment Sequence...\x1b[0m`);

    // 1. Dry Run Check
    if (dryRun) {
        console.log(`\n✅ \x1b[32mDRY RUN MODE ACTIVE\x1b[0m`);
        console.log(`   Configuration for "${config.name}" (${config.symbol}) is valid.`);
        console.log(`   Spoofing: ${config._meta?.rewardRecipient ? 'Active' : 'Inactive'}`);
        return {
            success: true,
            dryRun: true,
            config,
            address: '0x(dry-run-address)',
            scanUrl: 'https://basescan.org/address/0x(dry-run)',
            deployer: '0x(dry-run-deployer)'
        };
    }

    // 2. Credential Validation
    if (!privateKey) throw new Error('PRIVATE_KEY is missing');

    let cleanKey = privateKey.trim();
    if (!cleanKey.startsWith('0x')) cleanKey = `0x${cleanKey}`;

    if (cleanKey.length !== 66) throw new Error('Invalid PRIVATE_KEY length (must be 64 chars + 0x)');

    try {
        // 3. Network Connection
        const account = privateKeyToAccount(cleanKey);

        const publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl, {
                timeout: 60000,
                retryCount: 3
            })
        });

        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(rpcUrl, {
                timeout: 60000,
                retryCount: 3
            })
        });

        // 4. Pre-Flight Checks
        const balance = await publicClient.getBalance({ address: account.address });
        const costEstimate = BigInt(0.005 * 1e18); // Conservative estimate

        if (balance < costEstimate) {
            const eth = Number(balance) / 1e18;
            throw new Error(`Insufficient Balance: ${eth.toFixed(4)} ETH (Need ~0.005 ETH)`);
        }

        console.log(`📍 \x1b[33mDeployer:\x1b[0m ${account.address}`);
        console.log(`💰 \x1b[33mBalance:\x1b[0m  ${(Number(balance) / 1e18).toFixed(4)} ETH`);

        // 5. Initialize SDK
        const clanker = new Clanker({ publicClient, wallet: walletClient });

        // 6. Execute Deployment
        console.log(`\n🚀 \x1b[36mSending transaction...\x1b[0m`);
        const { txHash, waitForTransaction, error: deployError } = await clanker.deploy(config);

        if (deployError) throw new Error(`Deploy Request Failed: ${deployError}`);
        if (!txHash) throw new Error('No Transaction Hash returned');

        console.log(`✅ \x1b[32mTX Sent:\x1b[0m ${txHash}`);
        console.log(`⏳ Waiting for confirmation...`);

        // 7. Wait for Receipt
        const receipt = await waitForTransaction();

        if (receipt.error) throw new Error(`Transaction Reverted: ${receipt.error}`);
        if (!receipt.address) throw new Error('No Contract Address in receipt');

        const scanUrl = `https://basescan.org/address/${receipt.address}`;

        console.log(`\n🎉 \x1b[32mToken Deployed Successfully!\x1b[0m`);

        return {
            success: true,
            dryRun: false,
            address: receipt.address,
            txHash,
            scanUrl,
            deployer: account.address
        };

    } catch (error) {
        let msg = error.message || String(error);

        // Friendly Error Parsing
        if (msg.includes('insufficient funds')) msg = 'Insufficient ETH for gas';
        else if (msg.includes('User rejected')) msg = 'User rejected transaction';

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
