#!/usr/bin/env node
import { deployToken } from './clanker-core.js';
import { loadConfig, loadTokenConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import 'dotenv/config';
import fs from 'fs';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const DEFAULT_TOKEN_FILE = 'token.json';

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

const printUsage = () => {
    console.log(`Usage:
  node deploy.js [options] [file.json]

Options:
  --env, -e        Load config from .env
  --spoof <addr>   Override spoof target address (0x...)
  --strict         Enable strict verification mode
  --check          Validate config only (no deploy)
  --help, -h       Show this help message

Examples:
  node deploy.js
  node deploy.js token.json
  node deploy.js --check token.json
  node deploy.js --env
  node deploy.js --spoof 0x1234...abcd`);
};

const parseArgs = (args = process.argv.slice(2)) => {
    const options = {
        file: null,
        spoof: null,
        strict: false,
        env: false,
        check: false,
        help: false
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--env' || arg === '-e') {
            options.env = true;
            continue;
        }
        if (arg === '--strict') {
            options.strict = true;
            continue;
        }
        if (arg === '--check') {
            options.check = true;
            continue;
        }
        if (arg === '--help' || arg === '-h') {
            options.help = true;
            continue;
        }
        if (arg === '--spoof') {
            const spoofValue = args[i + 1];
            if (!spoofValue || spoofValue.startsWith('-')) {
                throw new Error('--spoof requires an address value');
            }
            options.spoof = spoofValue;
            i++;
            continue;
        }
        if (arg.endsWith('.json')) {
            if (options.file) {
                throw new Error(`Multiple JSON config files provided: ${options.file}, ${arg}`);
            }
            options.file = arg;
            continue;
        }
        if (arg.startsWith('-')) {
            throw new Error(`Unknown option: ${arg}`);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }

    if (options.env && options.file) {
        throw new Error('Cannot combine --env with JSON config file input');
    }

    return options;
};

const normalizePrivateKey = (rawPrivateKey) => {
    const trimmed = String(rawPrivateKey || '').trim();
    if (!trimmed) return null;
    const normalized = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
    if (!PRIVATE_KEY_REGEX.test(normalized)) {
        throw new Error('Invalid PRIVATE_KEY format (expected 32-byte hex)');
    }
    return normalized;
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
        if (opts.help) {
            printUsage();
            return;
        }

        // 1. Env Overrides
        if (opts.spoof) {
            if (!ETH_ADDRESS_REGEX.test(opts.spoof)) {
                throw new Error('--spoof must be a valid 0x Ethereum address');
            }
            process.env.ADMIN_SPOOF = opts.spoof;
        }

        // 2. Load Configuration
        let config;
        let sourceLabel = '';

        if (opts.env) {
            sourceLabel = '.env (Legacy)';
            config = loadConfig();
        } else if (opts.file) {
            if (!fs.existsSync(opts.file)) {
                throw new Error(`Token config file not found: ${opts.file}`);
            }
            sourceLabel = opts.file;
            config = loadTokenConfig(opts.file);
        } else if (fs.existsSync(DEFAULT_TOKEN_FILE)) {
            sourceLabel = DEFAULT_TOKEN_FILE;
            config = loadTokenConfig(DEFAULT_TOKEN_FILE);
        } else {
            sourceLabel = '.env (Fallback)';
            console.log(`⚠️ No ${DEFAULT_TOKEN_FILE} found. Falling back to .env`);
            config = loadConfig();
        }
        console.log(`📄 \x1b[33mSource:\x1b[0m \x1b[1m${sourceLabel}\x1b[0m`);

        // 3. Apply Overrides (Force Patching)
        if (opts.spoof) {
            console.log(`🎭 \x1b[35mSpoofing Override:\x1b[0m ${opts.spoof}`);
            const { privateKeyToAccount } = await import('viem/accounts');

            // Re-calculate rewards for spoofing
            // We need 99.9% to us, 0.1% to spoof target
            const pk = normalizePrivateKey(process.env.PRIVATE_KEY);
            if (!pk) {
                throw new Error('--spoof requires PRIVATE_KEY in environment');
            }
            const ourWallet = privateKeyToAccount(pk).address;
            const spoofTo = opts.spoof;

            config._meta = config._meta || {};
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
            const staticFeeTotal = config?.fees?.type === 'static'
                ? (Number(config?.fees?.clankerFee || 0) + Number(config?.fees?.pairedFee || 0))
                : 0;
            const strictReason = staticFeeTotal > 500 ? 'High Fees' : 'OK';
            if (strictReason === 'High Fees') {
                console.warn('⚠️ Warning: Strict mode enabled but fees are > 5%. Badge verification will fail.');
            }
            config._meta = config._meta || {};
            config._meta.strictMode = true;
        }

        // 4. Validation
        console.log('🔍 Validating configuration...');
        config = validateConfig(config);
        printPreflight(config);

        // 5. Execution
        if (opts.check) {
            console.log('\n✅ Configuration check passed (no deploy executed).');
            return;
        }

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
