import { Clanker } from 'clanker-sdk/v4';
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

/**
 * 🚀 Core Token Deployment
 * 
 * Robust deployment with proper error handling and status updates.
 */
export async function deployToken(config, options = {}) {
    const {
        privateKey = process.env.PRIVATE_KEY,
        rpcUrl = process.env.RPC_URL || 'https://mainnet.base.org',
        dryRun = process.env.DRY_RUN === 'true'
    } = options;

    console.log(`\n⏳ Deploying "${config.name}" (${config.symbol})...`);

    // Dry run mode
    if (dryRun) {
        console.log('\n✅ DRY RUN: Configuration valid. Skipping deployment.');
        return {
            success: true,
            dryRun: true,
            config,
            address: null,
            txHash: null
        };
    }

    // Validate private key
    if (!privateKey) {
        throw new Error('PRIVATE_KEY is required for deployment');
    }

    const cleanKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;

    if (cleanKey.length !== 66) {
        throw new Error('Invalid PRIVATE_KEY format');
    }

    try {
        // Initialize clients
        const account = privateKeyToAccount(cleanKey);
        const publicClient = createPublicClient({
            chain: base,
            transport: http(rpcUrl, { timeout: 60000 })
        });
        const walletClient = createWalletClient({
            account,
            chain: base,
            transport: http(rpcUrl, { timeout: 60000 })
        });

        // Check balance
        const balance = await publicClient.getBalance({ address: account.address });
        const minBalance = BigInt(0.005 * 1e18); // 0.005 ETH minimum

        if (balance < minBalance) {
            const eth = Number(balance) / 1e18;
            throw new Error(`Insufficient balance: ${eth.toFixed(4)} ETH (need at least 0.005 ETH for gas)`);
        }

        console.log(`📍 Deployer: ${account.address}`);
        console.log(`💰 Balance: ${(Number(balance) / 1e18).toFixed(4)} ETH`);

        // Initialize Clanker
        const clanker = new Clanker({ publicClient, wallet: walletClient });

        // Deploy
        const { txHash, waitForTransaction, error: deployError } = await clanker.deploy(config);

        if (deployError) {
            console.error('❌ Deploy error:', deployError);
            return {
                success: false,
                error: deployError,
                address: null,
                txHash: null
            };
        }

        console.log(`✅ TX Hash: ${txHash}`);
        console.log('⏳ Waiting for confirmation...');

        // Wait for transaction
        const result = await waitForTransaction();

        if (result.error) {
            console.error('❌ Transaction error:', result.error);
            return {
                success: false,
                error: result.error,
                txHash,
                address: null
            };
        }

        const { address } = result;
        const scanUrl = `https://basescan.org/address/${address}`;

        console.log(`\n🎉 Token deployed!`);
        console.log(`📍 Address: ${address}`);
        console.log(`🔗 ${scanUrl}`);

        return {
            success: true,
            dryRun: false,
            address,
            txHash,
            scanUrl,
            deployer: account.address
        };

    } catch (error) {
        // Parse common errors
        let errorMessage = error.message || String(error);

        if (errorMessage.includes('insufficient funds')) {
            errorMessage = 'Insufficient ETH for gas fees';
        } else if (errorMessage.includes('nonce')) {
            errorMessage = 'Nonce error - try again in a moment';
        } else if (errorMessage.includes('replacement')) {
            errorMessage = 'Transaction pending - wait or increase gas';
        } else if (errorMessage.includes('rejected')) {
            errorMessage = 'Transaction rejected by network';
        }

        console.error(`\n❌ Deployment failed: ${errorMessage}`);

        return {
            success: false,
            error: errorMessage,
            address: null,
            txHash: null
        };
    }
}

export default { deployToken };
