#!/usr/bin/env node
import { deployToken } from './clanker-core.js';
import { loadConfig, loadTokenConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import 'dotenv/config';
import fs from 'fs';

/**
 * 🚀 CLI Token Deployment Agent
 * 
 * Powerful CLI for automated or manual deployments.
 * 
 * Usage:
 *   node deploy.js              # Auto-detect token.json
 *   node deploy.js --spoof 0x123...  # Override spoof target
 *   node deploy.js --strict     # Enable strict mode
 *   node deploy.js <file.json>  # Use specific config
 */

const parseArgs = () => {
    const args = process.argv.slice(2);
    const options = {
        file: null,
        spoof: null,
        strict: false,
        env: false
    };

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--env' || args[i] === '-e') options.env = true;
        else if (args[i] === '--strict') options.strict = true;
        else if (args[i] === '--spoof') options.spoof = args[++i];
        else if (args[i].endsWith('.json')) options.file = args[i];
    }
    return options;
};

const printPreflight = (config) => {
    const socialCount = Array.isArray(config?.metadata?.socialMediaUrls) ? config.metadata.socialMediaUrls.length : 0;
    const hasSpoofSplit = Array.isArray(config?.rewards?.recipients) && config.rewards.recipients.length > 1;
    const contextSource = config?._meta?.contextSource || 'unknown';
    const contextStatus = config?.context?.messageId ? `${config.context.platform}:${config.context.messageId}` : 'missing';
    const autoFixes = Array.isArray(config?._meta?.autoFixes) ? config._meta.autoFixes : [];

    console.log('🧪 Preflight Checks');
    console.log(`   Vanity: ${config?.vanity ? 'enabled' : 'disabled'}`);
    console.log(`   Context: ${contextStatus} (source: ${contextSource})`);
    console.log(`   Socials: ${socialCount}`);
    console.log(`   Metadata desc length: ${String(config?.metadata?.description || '').length}`);
    console.log(`   Spoof split: ${hasSpoofSplit ? 'enabled' : 'disabled'}`);
    console.log(`   Smart fixes: ${autoFixes.length}`);
    if (autoFixes.length > 0) {
        const sample = autoFixes.slice(0, 3).join(' | ');
        console.log(`   Smart fix sample: ${sample}`);
    }
};

async function main() {
    console.log('\n🤖 \x1b[36mClank & Claw Deployment Agent\x1b[0m');
    console.log('════════════════════════════════════');

    try {
        const opts = parseArgs();

        // 1. Env Overrides
        if (opts.spoof) {
            process.env.ADMIN_SPOOF = opts.spoof;
        }

        // 2. Load Configuration
        let config;
        let sourceLabel = '';

        if (opts.env) {
            sourceLabel = '.env (Legacy)';
            config = loadConfig();
        } else {
            const fileToLoad = opts.file || (fs.existsSync('token.json') ? 'token.json' : null);

            if (fileToLoad && fs.existsSync(fileToLoad)) {
                sourceLabel = fileToLoad;
                config = loadTokenConfig(fileToLoad);
            } else {
                sourceLabel = '.env (Fallback)';
                console.log('⚠️ No token.json found. Falling back to .env');
                config = loadConfig();
            }
        }
        console.log(`📄 \x1b[33mSource:\x1b[0m \x1b[1m${sourceLabel}\x1b[0m`);

        // 3. Apply Overrides (Force Patching)
        if (opts.spoof) {
            console.log(`🎭 \x1b[35mSpoofing Override:\x1b[0m ${opts.spoof}`);
            const { privateKeyToAccount } = await import('viem/accounts');

            // Re-calculate rewards for spoofing
            // We need 99.9% to us, 0.1% to spoof target
            const pk = process.env.PRIVATE_KEY;
            const ourWallet = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`).address;
            const spoofTo = opts.spoof;

            config._meta.rewardRecipient = spoofTo;
            config.tokenAdmin = spoofTo; // Make them admin so they appear as deployer

            config.rewards = { recipients: [] };
            config.rewards.recipients.push({
                recipient: ourWallet,
                admin: ourWallet,
                bps: 9990,
                token: 'Both'
            });
            config.rewards.recipients.push({
                recipient: spoofTo,
                admin: spoofTo,
                bps: 10,
                token: 'Both'
            });
        }

        if (opts.strict) {
            console.log('🛡️ \x1b[32mStrict Mode:\x1b[0m Enabled (Blue Badge Verify)');
            const strictReason = config.fees.clankerFee + config.fees.pairedFee > 500 ? 'High Fees' : 'OK';
            if (strictReason === 'High Fees') {
                console.warn('⚠️ Warning: Strict mode enabled but fees are > 5%. Badge verification will fail.');
            }
            config._meta.strictMode = true;
        }

        // 4. Validation
        console.log('🔍 Validating configuration...');
        config = validateConfig(config);
        printPreflight(config);

        // 5. Execution
        console.log(`\n🚀 \x1b[36mDeploying ${config.name} (${config.symbol})...\x1b[0m`);

        // Safety check
        if (!process.env.DRY_RUN && !process.env.CI) {
            await new Promise(r => setTimeout(r, 2000));
        }

        const result = await deployToken(config);

        // 6. Result
        if (result.success) {
            if (result.dryRun) {
                console.log('\n✅ \x1b[32mDRY RUN COMPLETE (No Gas Spent)\x1b[0m');
                return;
            }

            const addressDisplay = result.address || 'Not detected (check tx logs)';
            console.log('\n════════════════════════════════════');
            console.log('🎉 \x1b[32mDEPLOYMENT SUCCESSFUL\x1b[0m');
            console.log(`📍 Address:  \x1b[36m${addressDisplay}\x1b[0m`);
            console.log(`🔗 Scan:     \x1b[34m${result.scanUrl}\x1b[0m`);
            console.log('════════════════════════════════════');
        } else {
            throw new Error(result.error || 'Unknown deployment error');
        }

    } catch (error) {
        console.error('\n❌ \x1b[31mDEPLOYMENT FAILED\x1b[0m');
        console.error(`Error: ${error.message}`);
        process.exit(1);
    }
}

main();
