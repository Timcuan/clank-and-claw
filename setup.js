#!/usr/bin/env node
/**
 * 🔧 Clank & Claw Setup Wizard
 * 
 * Interactive setup for first-time configuration.
 * Run: node setup.js
 */

import fs from 'fs';
import readline from 'readline';
import { getProviderStatus } from './lib/ipfs.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (q) => new Promise(r => rl.question(q, r));

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    dim: '\x1b[2m'
};

const log = {
    info: (m) => console.log(`${colors.cyan}ℹ${colors.reset} ${m}`),
    ok: (m) => console.log(`${colors.green}✓${colors.reset} ${m}`),
    warn: (m) => console.log(`${colors.yellow}⚠${colors.reset} ${m}`),
    error: (m) => console.log(`${colors.red}✗${colors.reset} ${m}`),
    dim: (m) => console.log(`${colors.dim}${m}${colors.reset}`)
};

console.log(`
${colors.cyan}╔═══════════════════════════════════════════╗
║    🐾 CLANK & CLAW SETUP WIZARD           ║
╚═══════════════════════════════════════════╝${colors.reset}
`);

async function main() {
    const envPath = '.env';
    let env = {};

    // Load existing .env if exists
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach(line => {
            const [key, ...val] = line.split('=');
            if (key && !key.startsWith('#')) {
                env[key.trim()] = val.join('=').trim();
            }
        });
        log.ok('.env file found');
    } else {
        log.warn('.env not found, will create new one');
    }

    // ─── WALLET ───
    console.log(`\n${colors.green}═══ 1. WALLET CONFIGURATION ═══${colors.reset}\n`);

    if (env.PRIVATE_KEY && env.PRIVATE_KEY.length > 60) {
        log.ok(`Wallet configured: ${env.PRIVATE_KEY.substring(0, 10)}...`);
        const change = await ask('Change wallet? (y/N): ');
        if (change.toLowerCase() === 'y') {
            env.PRIVATE_KEY = await ask('Private Key (0x...): ');
        }
    } else {
        log.info('Private key needed for deployment');
        log.dim('Get from: MetaMask > Account Details > Show Private Key');
        env.PRIVATE_KEY = await ask('\nPrivate Key (0x...): ');
    }

    env.RPC_URL = env.RPC_URL || 'https://mainnet.base.org';

    // ─── TELEGRAM ───
    console.log(`\n${colors.green}═══ 2. TELEGRAM BOT (Optional) ═══${colors.reset}\n`);

    if (env.TELEGRAM_BOT_TOKEN) {
        log.ok('Telegram bot configured');
    } else {
        log.info('Setup Telegram bot to deploy from chat');
        log.dim('Get token from: @BotFather on Telegram');
        const token = await ask('\nBot Token (or Enter to skip): ');
        if (token) env.TELEGRAM_BOT_TOKEN = token;
    }

    // ─── IPFS ───
    console.log(`\n${colors.green}═══ 3. IPFS PROVIDER ═══${colors.reset}\n`);
    console.log('Choose one (all are free):');
    console.log('  1. NFT.Storage (recommended) - nft.storage');
    console.log('  2. Pinata - pinata.cloud');
    console.log('  3. Infura - infura.io');
    console.log('  4. Skip (use existing CIDs only)\n');

    const hasProvider = env.NFT_STORAGE_TOKEN || (env.PINATA_API_KEY && env.PINATA_SECRET_KEY) || env.INFURA_PROJECT_ID;

    if (hasProvider) {
        log.ok('IPFS provider configured');
        const change = await ask('Change provider? (y/N): ');
        if (change.toLowerCase() !== 'y') {
            // Skip
        } else {
            await setupIPFS(env);
        }
    } else {
        await setupIPFS(env);
    }

    // ─── DEFAULTS ───
    console.log(`\n${colors.green}═══ 4. DEFAULTS ═══${colors.reset}\n`);

    env.DEFAULT_FEES = env.DEFAULT_FEES || '200';
    env.DEFAULT_PLATFORM = env.DEFAULT_PLATFORM || 'twitter';
    env.VANITY = env.VANITY || 'true';

    log.ok(`Default fees: ${parseInt(env.DEFAULT_FEES) / 100}%`);
    log.ok(`Default platform: ${env.DEFAULT_PLATFORM}`);

    // ─── SAVE ───
    console.log(`\n${colors.green}═══ SAVING CONFIGURATION ═══${colors.reset}\n`);

    const envContent = `# ══════════════════════════════════════════
# 🐾 CLANK & CLAW - System Configuration
# ══════════════════════════════════════════

# ─── WALLET ───────────────────────────────
PRIVATE_KEY=${env.PRIVATE_KEY || ''}
RPC_URL=${env.RPC_URL || 'https://mainnet.base.org'}

# ─── TELEGRAM BOT ─────────────────────────
TELEGRAM_BOT_TOKEN=${env.TELEGRAM_BOT_TOKEN || ''}
TELEGRAM_ADMIN_IDS=${env.TELEGRAM_ADMIN_IDS || ''}

# ─── IPFS PROVIDERS ───────────────────────
NFT_STORAGE_TOKEN=${env.NFT_STORAGE_TOKEN || ''}
PINATA_API_KEY=${env.PINATA_API_KEY || ''}
PINATA_SECRET_KEY=${env.PINATA_SECRET_KEY || ''}
INFURA_PROJECT_ID=${env.INFURA_PROJECT_ID || ''}
INFURA_SECRET=${env.INFURA_SECRET || ''}

# ─── DEFAULTS ─────────────────────────────
DEFAULT_FEES=${env.DEFAULT_FEES || '200'}
DEFAULT_PLATFORM=${env.DEFAULT_PLATFORM || 'twitter'}
VANITY=${env.VANITY || 'true'}
`;

    fs.writeFileSync(envPath, envContent);
    log.ok('.env saved!');

    // Create token.json if doesn't exist
    if (!fs.existsSync('token.json')) {
        fs.copyFileSync('token.example.json', 'token.json');
        log.ok('token.json created from template');
    }

    // ─── SUMMARY ───
    console.log(`
${colors.cyan}╔═══════════════════════════════════════════╗
║           ✅ SETUP COMPLETE!              ║
╚═══════════════════════════════════════════╝${colors.reset}

${colors.green}Next Steps:${colors.reset}

1. Edit token.json with your token details
2. Run deployment:
   ${colors.dim}node deploy.js${colors.reset}

3. Or start Telegram bot:
   ${colors.dim}npm run bot${colors.reset}

${colors.yellow}Files:${colors.reset}
  .env        → System config (private key, API keys)
  token.json  → Token config (name, symbol, fees, etc.)

`);

    rl.close();
}

async function setupIPFS(env) {
    const choice = await ask('Choice (1-4): ');

    switch (choice) {
        case '1':
            log.info('NFT.Storage is free with no credit card');
            log.dim('1. Go to https://nft.storage');
            log.dim('2. Sign in with GitHub/Email');
            log.dim('3. Create API Key');
            env.NFT_STORAGE_TOKEN = await ask('\nNFT.Storage Token: ');
            break;
        case '2':
            log.info('Pinata free tier: 1GB storage');
            env.PINATA_API_KEY = await ask('Pinata API Key: ');
            env.PINATA_SECRET_KEY = await ask('Pinata Secret Key: ');
            break;
        case '3':
            log.info('Infura free tier: 5GB/month');
            env.INFURA_PROJECT_ID = await ask('Infura Project ID: ');
            env.INFURA_SECRET = await ask('Infura Secret (optional): ');
            break;
        default:
            log.warn('Skipped. You can only use existing IPFS CIDs.');
    }
}

main().catch(console.error);
