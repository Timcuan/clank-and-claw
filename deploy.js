#!/usr/bin/env node
import { deployToken } from './clanker-core.js';
import { loadConfig, loadTokenConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import 'dotenv/config';
import fs from 'fs';

/**
 * 🚀 CLI Token Deployment
 * 
 * Usage:
 *   node deploy.js              # Use token.json
 *   node deploy.js mytoken.json # Use custom file
 *   node deploy.js --env        # Use .env only (legacy)
 */
async function main() {
    try {
        const args = process.argv.slice(2);
        let config;

        // Determine config source
        if (args.includes('--env') || args.includes('-e')) {
            // Legacy: load from .env
            console.log('📄 Loading config from .env');
            config = loadConfig();
        } else {
            // New: load from token.json (or specified file)
            const tokenFile = args.find(a => a.endsWith('.json')) || 'token.json';

            if (fs.existsSync(tokenFile)) {
                console.log(`📄 Loading config from ${tokenFile}`);
                config = loadTokenConfig(tokenFile);
            } else if (fs.existsSync('token.json')) {
                console.log('📄 Loading config from token.json');
                config = loadTokenConfig('token.json');
            } else {
                // Fallback to .env
                console.log('📄 Loading config from .env (no token.json found)');
                config = loadConfig();
            }
        }

        // Validate
        config = validateConfig(config);

        // Deploy
        const result = await deployToken(config);

        if (result.success) {
            if (result.dryRun) return;
            console.log('\n════════════════════════════════════');
            console.log('🎉 TOKEN DEPLOYED SUCCESSFULLY!');
            console.log(`📍 Address:  ${result.address}`);
            console.log(`🔗 Basescan: ${result.scanUrl}`);
            console.log('════════════════════════════════════');
        } else {
            console.error('\n❌ Deployment Failed:', result.error);
            process.exit(1);
        }

    } catch (error) {
        console.error('\n💥 Error:', error.message || error);
        process.exit(1);
    }
}

main();
