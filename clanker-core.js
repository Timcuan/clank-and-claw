
import { Clanker } from 'clanker-sdk/v4';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * 🚀 Clanker Core Deployment Module v3.1 (Robust)
 * 
 * Handles blockchain interactions, gas estimation, and deployment execution.
 * Includes network verification and detailed error reporting.
 */

export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
        dryRun = process.env.DRY_RUN === 'true'
    } = options;

    console.log(`\n⏳ \x1b[36mInitializing Deployment Sequence...\x1b[0m`);

    // 1. Dry Run Handling
    if (dryRun) {
        console.log(`\n✅ \x1b[32mDRY RUN MODE ACTIVE\x1b[0m`);
        console.log(`   Config: "${config.name}" (${config.symbol})`);

        let feeStr = 'Unknown';
        if (config.fees) {
            feeStr = `${(Number(config.fees.clankerFee) + Number(config.fees.pairedFee)) / 100}%`;
        }
        console.log(`   Fees: ${feeStr}`);

        return {
            success: true,
            dryRun: true,
            address: '0x(dry-run-address)',
            scanUrl: 'https://basescan.org/address/0x(dry-run)',
            deployer: '0x(dry-run-deployer)'
        };
    }

    // 2. Private Key Validation
    if (!privateKey) throw new Error('PRIVATE_KEY is missing');
    let cleanKey = privateKey.trim();
    if (!cleanKey.startsWith('0x')) cleanKey = `0x${cleanKey}`;
    if (cleanKey.length !== 66) throw new Error('Invalid PRIVATE_KEY length (must be 64 chars + 0x)');

    try {
        // 3. Client Initialization & Network Check
        const account = privateKeyToAccount(cleanKey);

        const publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl, { timeout: 60_000, retryCount: 5, retryDelay: 2000 })
        });

        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(rpcUrl, { timeout: 60_000, retryCount: 5, retryDelay: 2000 })
        });

        // Network ID Check
        const chainId = await publicClient.getChainId();
        if (chainId !== 8453) {
            throw new Error(`Connected to wrong chain ID: ${chainId}. Expected 8453 (Base Mainnet).`);
        }

        // 4. Pre-Flight Checks (Balance & Gas)
        const [balance, gasPrice] = await Promise.all([
            publicClient.getBalance({ address: account.address }),
            publicClient.getGasPrice()
        ]);

        const costEstimate = BigInt(0.005 * 1e18); // ~0.005 ETH buffer

        if (balance < costEstimate) {
            const eth = Number(balance) / 1e18;
            throw new Error(`Insufficient Balance: ${eth.toFixed(4)} ETH (Need ~0.005 ETH)`);
        }

        // Gas Warning
        const gasGwei = Number(gasPrice) / 1e9;
        if (gasGwei > 2.0) {
            console.warn(`⚠️ \x1b[33mHigh Gas Warning:\x1b[0m ${gasGwei.toFixed(4)} gwei. Deployment might be expensive.`);
        }

        console.log(`📍 \x1b[33mDeployer:\x1b[0m ${account.address} (Base: ${gasGwei.toFixed(4)} gwei)`);

        // 5. Initialize SDK
        const clanker = new Clanker({ publicClient, wallet: walletClient });

        // 6. Execute Deployment
        console.log(`\n🚀 \x1b[36mSending transaction...\x1b[0m`);
        const { txHash, waitForTransaction, error: deployError } = await clanker.deploy(config);

        if (deployError) throw new Error(`Deploy Request Failed: ${deployError}`);
        if (!txHash) throw new Error('No Transaction Hash returned from SDK');

        console.log(`✅ \x1b[32mTX Sent:\x1b[0m ${txHash}`);
        console.log(`⏳ Waiting for confirmation...`);

        // 7. Transaction Monitoring
        const receipt = await waitForTransaction();

        // SDK usually returns { address, error, success } wrapper or similar
        // Let's handle both wrapper and raw receipt case defensively
        let address = receipt.address || receipt.contractAddress;
        let isError = receipt.error || (receipt.status && receipt.status === 'reverted');

        if (isError) {
            throw new Error(`Transaction Failed: ${receipt.error || 'Reverted on-chain'}`);
        }

        if (!address) {
            console.warn('⚠️ \x1b[33mWarning:\x1b[0m Contract Address not returned by SDK. Check Explorer.');
            address = 'Check Explorer';
        }

        const scanUrl = `https://basescan.org/address/${address}`;

        console.log(`\n🎉 \x1b[32mToken Deployed Successfully!\x1b[0m`);
        console.log(`📍 Address:  \x1b[36m${address}\x1b[0m`);
        console.log(`🔗 Scan:     \x1b[34m${scanUrl}\x1b[0m`);

        return {
            success: true,
            dryRun: false,
            address: address,
            txHash,
            scanUrl,
            deployer: account.address
        };

    } catch (error) {
        let msg = error.message || String(error);

        // Semantic Error Parsing
        if (msg.includes('insufficient funds')) msg = 'Insufficient ETH for gas';
        else if (msg.includes('nonce')) msg = 'Nonce Mismatch (Try resetting wallet/retry)';
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
