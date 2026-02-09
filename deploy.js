import { deployToken } from './clanker-core.js';
import { loadConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import 'dotenv/config';

/**
 * 🚀 CLI WRAPPER FOR CLANKER DEPLOYMENT
 * 
 * Refactored to use modular config and validation.
 */
async function main() {
    try {
        // 1. Load Configuration
        let config = loadConfig();

        // 2. Validate & Adjust Configuration
        config = validateConfig(config);

        // 3. Deploy
        const result = await deployToken(config);

        if (result.success) {
            if (result.dryRun) return;
            console.log('\n====================================');
            console.log('🎉 TOKEN DEPLOYED SUCCESSFULLY!');
            console.log(`📍 Address:  ${result.address}`);
            console.log(`🔗 Basescan: ${result.scanUrl}`);
            console.log('====================================');
        } else {
            console.error('\n❌ Deployment Failed:', result.error);
        }

    } catch (error) {
        console.error('\n💥 Critical Error:', error.message || error);
        process.exit(1);
    }
}

main();
