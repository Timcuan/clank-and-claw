#!/usr/bin/env node
import { deployToken } from './clanker-core.js';
import { loadConfig, loadTokenConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import { maybeEnrichContextId, waitForTokenIndexing } from './lib/clankerworld.js';
import 'dotenv/config';
import fs from 'fs';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const PRIVATE_KEY_REGEX = /^0x[a-fA-F0-9]{64}$/;
const DEFAULT_TOKEN_FILE = 'token.json';
const DEFAULT_INDEX_TIMEOUT_SECONDS = 180;
const DEFAULT_INDEX_POLL_SECONDS = 10;

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
  --index-timeout <sec>  Wait time for clanker.world indexing check (default: 180)
  --no-index-wait  Skip post-deploy clanker.world indexing check
  --require-index  Fail command if token is not indexed within timeout
  --no-resolve-context-id  Skip best-effort context.id enrichment for Twitter
  --help, -h       Show this help message

Examples:
  node deploy.js
  node deploy.js token.json
  node deploy.js --check token.json
  node deploy.js --env
  node deploy.js --require-index --index-timeout 300
  node deploy.js --spoof 0x1234...abcd`);
};

const parseBooleanEnv = (value, fallback) => {
    const raw = String(value ?? '').trim().toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    return fallback;
};

const parsePositiveInt = (value, fallback) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const parsed = Math.floor(n);
    return parsed > 0 ? parsed : fallback;
};

const parseArgs = (args = process.argv.slice(2)) => {
    const options = {
        file: null,
        spoof: null,
        strict: false,
        env: false,
        check: false,
        help: false,
        indexWait: parseBooleanEnv(process.env.CLANKER_INDEX_WAIT, true),
        requireIndex: parseBooleanEnv(process.env.CLANKER_REQUIRE_INDEX, false),
        resolveContextId: parseBooleanEnv(process.env.RESOLVE_CONTEXT_ID, true),
        indexTimeoutSeconds: parsePositiveInt(process.env.CLANKER_INDEX_WAIT_SECONDS, DEFAULT_INDEX_TIMEOUT_SECONDS)
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
        if (arg === '--no-index-wait') {
            options.indexWait = false;
            continue;
        }
        if (arg === '--require-index') {
            options.requireIndex = true;
            continue;
        }
        if (arg === '--no-resolve-context-id') {
            options.resolveContextId = false;
            continue;
        }
        if (arg === '--index-timeout') {
            const timeoutValue = args[i + 1];
            if (!timeoutValue || timeoutValue.startsWith('-')) {
                throw new Error('--index-timeout requires a positive integer value (seconds)');
            }
            const parsed = parsePositiveInt(timeoutValue, NaN);
            if (!Number.isFinite(parsed)) {
                throw new Error('--index-timeout must be a positive integer (seconds)');
            }
            options.indexTimeoutSeconds = parsed;
            i++;
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
    const contextUserId = String(config?.context?.id || '').trim();
    const autoFixes = Array.isArray(config?._meta?.autoFixes) ? config._meta.autoFixes : [];

    console.log('🧪 Preflight Checks');
    console.log(`   Vanity: ${config?.vanity ? 'enabled' : 'disabled'}`);
    console.log(`   Context: ${contextStatus} (source: ${contextSource})`);
    console.log(`   Context User ID: ${contextUserId || 'missing'}`);
    console.log(`   Socials: ${socialCount}`);
    console.log(`   Metadata desc length: ${String(config?.metadata?.description || '').length}`);
    console.log(`   Spoof split: ${hasSpoofSplit ? 'enabled' : 'disabled'}`);
    console.log(`   Smart fixes: ${autoFixes.length}`);
    if (autoFixes.length > 0) {
        const sample = autoFixes.slice(0, 3).join(' | ');
        console.log(`   Smart fix sample: ${sample}`);
    }

    const socialContextPlatform = new Set(['twitter', 'farcaster']);
    if (socialContextPlatform.has(String(config?.context?.platform || '').toLowerCase()) && !contextUserId) {
        console.log('   Index risk: social context user id is missing (set context.id/contextUserId).');
    }
    if (hasSpoofSplit && socialContextPlatform.has(String(config?.context?.platform || '').toLowerCase())) {
        console.log('   Index risk: spoof split can break Clankerworld context matching.');
    }
};

const printIndexingTroubleshooting = (config) => {
    const platform = String(config?.context?.platform || '').toLowerCase();
    const contextId = String(config?.context?.id || '').trim();
    const hasSpoofSplit = Array.isArray(config?.rewards?.recipients) && config.rewards.recipients.length > 1;

    console.log('   Troubleshooting hints:');
    if ((platform === 'twitter' || platform === 'farcaster') && !contextId) {
        console.log('   - Set context.id/contextUserId to the exact social account id used in context link.');
    }
    if (hasSpoofSplit && (platform === 'twitter' || platform === 'farcaster')) {
        console.log('   - Disable spoof split when using social context to avoid provenance mismatch.');
    }
    if (config?.fees?.type === 'dynamic' && Number(config?.fees?.maxFee) > 500) {
        console.log('   - Keep dynamic maxFee <= 500 bps for compatibility, unless you intentionally override.');
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

        // 4. Best-effort context.id enrichment (Twitter)
        if (opts.resolveContextId && !process.env.CI) {
            const enrich = await maybeEnrichContextId(config);
            if (enrich.changed) {
                if (enrich.username) {
                    console.log(`🧭 Context ID auto-filled from @${enrich.username} -> ${enrich.id}`);
                } else {
                    console.log(`🧭 Context ID auto-filled (${enrich.reason}) -> ${enrich.id}`);
                }
            } else if (enrich.reason === 'resolve-empty' || enrich.reason === 'resolve-failed') {
                console.log('ℹ️  Context ID enrichment skipped (Twitter resolver unavailable or no match).');
            }
        }

        // 5. Validation
        console.log('🔍 Validating configuration...');
        config = validateConfig(config);
        printPreflight(config);

        // 6. Execution
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

        // 7. Result
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

            if (result.address && opts.indexWait) {
                console.log(`\n🔎 Checking clanker.world indexing (timeout: ${opts.indexTimeoutSeconds}s)...`);
                const indexState = await waitForTokenIndexing(result.address, {
                    timeoutMs: opts.indexTimeoutSeconds * 1000,
                    intervalMs: DEFAULT_INDEX_POLL_SECONDS * 1000
                });

                if (indexState.indexed) {
                    console.log(`✅ Indexed on clanker.world after ${Math.max(1, Math.round(indexState.elapsedMs / 1000))}s (${indexState.attempts} check(s)).`);
                    const warningTags = Array.isArray(indexState.token?.warnings) ? indexState.token.warnings.length : 0;
                    if (warningTags > 0) {
                        console.log(`ℹ️  Token has ${warningTags} warning tag(s) on clanker.world.`);
                    }
                } else {
                    console.warn('⚠️  Token not found on clanker.world within wait window.');
                    console.warn(`⚠️  Search URL: https://www.clanker.world/tokens?q=${result.address}`);
                    if (indexState.error) {
                        console.warn(`⚠️  Index probe error: ${indexState.error}`);
                    }
                    printIndexingTroubleshooting(config);
                    if (opts.requireIndex) {
                        throw new Error('Deploy completed on-chain but clanker.world indexing was not confirmed in time');
                    }
                }
            }
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
