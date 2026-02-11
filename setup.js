#!/usr/bin/env node
/**
 * 🔧 Clank & Claw Setup Wizard
 * 
 * Interactive setup for first-time configuration.
 * Run: node setup.js
 */

import fs from 'fs';
import readline from 'readline';
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

const isTruthy = (value) => ['true', '1', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const isPlaceholderTelegramToken = (token) => {
    const cleaned = String(token || '').trim();
    if (!cleaned) return false;
    return cleaned.includes('REPLACE_ME') || cleaned.includes('YOUR_') || cleaned === '123456789:REPLACE_ME';
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
    console.log(`\n${colors.green}═══ 2. TELEGRAM BOT SETUP ═══${colors.reset}\n`);
    log.info('Telegram bot is required for chat deployment flow');
    log.dim('Get token from: @BotFather on Telegram');

    const currentToken = String(env.TELEGRAM_BOT_TOKEN || '').trim();
    if (currentToken && !isPlaceholderTelegramToken(currentToken)) {
        log.ok('Telegram bot token configured');
        const change = await ask('Change bot token? (y/N): ');
        if (change.toLowerCase() === 'y') {
            env.TELEGRAM_BOT_TOKEN = await ask('Bot Token (123456789:ABC...): ');
        }
    } else {
        if (currentToken && isPlaceholderTelegramToken(currentToken)) {
            log.warn('Current TELEGRAM_BOT_TOKEN is still placeholder.');
        }
        env.TELEGRAM_BOT_TOKEN = await ask('\nBot Token (123456789:ABC...): ');
    }

    // ─── IPFS ───
    console.log(`\n${colors.green}═══ 3. IPFS UPLOAD BACKEND ═══${colors.reset}\n`);
    console.log('Runtime upload priority: Local Kubo -> Pinata -> Legacy providers');
    console.log('Choose primary setup:');
    console.log('  1. Local Kubo node (recommended, no API key)');
    console.log('  2. Pinata (API key + secret)');
    console.log('  3. Legacy Infura IPFS (requires legacy enable)');
    console.log('  4. Legacy NFT.Storage Classic (requires legacy enable)');
    console.log('  5. Skip (use existing config)\n');

    const hasProvider = hasAnyConfiguredUploader(env);

    if (hasProvider) {
        log.ok('IPFS upload backend already configured');
        const change = await ask('Change provider? (y/N): ');
        if (change.toLowerCase() !== 'y') {
            // Skip
        } else {
            await setupIPFS(env);
        }
    } else {
        await setupIPFS(env);
    }

    // ─── OPTIONAL DEFAULTS ───
    console.log(`\n${colors.green}═══ 4. OPTIONAL DEFAULTS ═══${colors.reset}\n`);

    env.DEFAULT_CONTEXT_ID = env.DEFAULT_CONTEXT_ID || '';
    env.DEFAULT_IMAGE_URL = env.DEFAULT_IMAGE_URL || '';
    env.VANITY = env.VANITY || 'true';
    env.REQUIRE_CONTEXT = env.REQUIRE_CONTEXT || 'true';
    env.SMART_VALIDATION = env.SMART_VALIDATION || 'true';

    log.ok(`Vanity mode (env/legacy): ${env.VANITY}`);
    log.ok(`Require context for deploy: ${env.REQUIRE_CONTEXT}`);
    log.ok(`Smart validation auto-heal: ${env.SMART_VALIDATION}`);
    if (env.DEFAULT_CONTEXT_ID) {
        log.ok(`Default context ID: ${env.DEFAULT_CONTEXT_ID}`);
    } else {
        log.info('Default context ID not set (optional)');
    }

    // ─── SAVE ───
    console.log(`\n${colors.green}═══ SAVING CONFIGURATION ═══${colors.reset}\n`);

    const envContent = `# ══════════════════════════════════════════
# 🐾 CLANK & CLAW - System Configuration
# ══════════════════════════════════════════

# ─── WALLET ───────────────────────────────
PRIVATE_KEY=${env.PRIVATE_KEY || ''}
RPC_URL=${env.RPC_URL || 'https://mainnet.base.org'}
RPC_FALLBACK_URLS=${env.RPC_FALLBACK_URLS || ''}

# ─── TELEGRAM BOT ─────────────────────────
TELEGRAM_BOT_TOKEN=${env.TELEGRAM_BOT_TOKEN || ''}
TELEGRAM_ADMIN_IDS=${env.TELEGRAM_ADMIN_IDS || ''}
TELEGRAM_API_BASES=${env.TELEGRAM_API_BASES || 'https://api.telegram.org'}
TELEGRAM_FILE_BASE=${env.TELEGRAM_FILE_BASE || ''}

# ─── IPFS UPLOAD (local-first) ────────────
IPFS_KUBO_API=${env.IPFS_KUBO_API || 'http://127.0.0.1:5001'}
PINATA_API_KEY=${env.PINATA_API_KEY || ''}
PINATA_SECRET_KEY=${env.PINATA_SECRET_KEY || ''}
INFURA_PROJECT_ID=${env.INFURA_PROJECT_ID || ''}
INFURA_SECRET=${env.INFURA_SECRET || ''}
ENABLE_INFURA_IPFS_LEGACY=${env.ENABLE_INFURA_IPFS_LEGACY || 'false'}
NFT_STORAGE_TOKEN=${env.NFT_STORAGE_TOKEN || ''}
ENABLE_NFT_STORAGE_CLASSIC=${env.ENABLE_NFT_STORAGE_CLASSIC || 'false'}
IPFS_GATEWAYS=${env.IPFS_GATEWAYS || ''}

# ─── OPTIONAL DEFAULTS ────────────────────
DEFAULT_CONTEXT_ID=${env.DEFAULT_CONTEXT_ID || ''}
DEFAULT_IMAGE_URL=${env.DEFAULT_IMAGE_URL || ''}
VANITY=${env.VANITY || 'true'}
REQUIRE_CONTEXT=${env.REQUIRE_CONTEXT || 'true'}
SMART_VALIDATION=${env.SMART_VALIDATION || 'true'}
CONFIG_STORE_PATH=${env.CONFIG_STORE_PATH || './data/bot-config-store.json'}
`;

    const managedKeys = new Set([
        'PRIVATE_KEY',
        'RPC_URL',
        'RPC_FALLBACK_URLS',
        'TELEGRAM_BOT_TOKEN',
        'TELEGRAM_ADMIN_IDS',
        'TELEGRAM_API_BASES',
        'TELEGRAM_FILE_BASE',
        'IPFS_KUBO_API',
        'PINATA_API_KEY',
        'PINATA_SECRET_KEY',
        'INFURA_PROJECT_ID',
        'INFURA_SECRET',
        'ENABLE_INFURA_IPFS_LEGACY',
        'NFT_STORAGE_TOKEN',
        'ENABLE_NFT_STORAGE_CLASSIC',
        'IPFS_GATEWAYS',
        'DEFAULT_CONTEXT_ID',
        'DEFAULT_IMAGE_URL',
        'VANITY',
        'REQUIRE_CONTEXT',
        'SMART_VALIDATION',
        'CONFIG_STORE_PATH'
    ]);
    const extras = Object.entries(env)
        .filter(([key]) => key && !managedKeys.has(key))
        .sort(([a], [b]) => a.localeCompare(b));
    const extrasBlock = extras.length > 0
        ? `\n# ─── CUSTOM / PRESERVED KEYS ─────────────\n${extras.map(([k, v]) => `${k}=${v || ''}`).join('\n')}\n`
        : '\n';

    fs.writeFileSync(envPath, envContent + extrasBlock);
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
   ${colors.dim}npm run start${colors.reset}

${colors.yellow}Files:${colors.reset}
  .env        → System config (private key, API keys)
  token.json  → Token config (name, symbol, fees, etc.)

`);

    rl.close();
}

async function setupIPFS(env) {
    const choice = await ask('Choice (1-5): ');

    switch (choice) {
        case '1':
            log.info('Local Kubo node selected (recommended)');
            env.IPFS_KUBO_API = await ask('IPFS_KUBO_API [http://127.0.0.1:5001]: ');
            if (!String(env.IPFS_KUBO_API || '').trim()) {
                env.IPFS_KUBO_API = 'http://127.0.0.1:5001';
            }
            env.ENABLE_INFURA_IPFS_LEGACY = 'false';
            env.ENABLE_NFT_STORAGE_CLASSIC = 'false';
            break;
        case '2':
            log.info('Pinata selected');
            env.PINATA_API_KEY = await ask('Pinata API Key: ');
            env.PINATA_SECRET_KEY = await ask('Pinata Secret Key: ');
            env.ENABLE_INFURA_IPFS_LEGACY = 'false';
            env.ENABLE_NFT_STORAGE_CLASSIC = 'false';
            break;
        case '3':
            log.warn('Legacy Infura mode selected');
            env.INFURA_PROJECT_ID = await ask('Infura Project ID: ');
            env.INFURA_SECRET = await ask('Infura Secret (optional): ');
            env.ENABLE_INFURA_IPFS_LEGACY = 'true';
            break;
        case '4':
            log.warn('Legacy NFT.Storage classic mode selected');
            env.NFT_STORAGE_TOKEN = await ask('NFT.Storage Token: ');
            env.ENABLE_NFT_STORAGE_CLASSIC = 'true';
            break;
        case '5':
            log.warn('Skipped. Existing IPFS configuration preserved.');
            break;
        default:
            log.warn('Unknown choice. Existing IPFS configuration preserved.');
    }
}

function hasAnyConfiguredUploader(env) {
    const hasKubo = !!String(env.IPFS_KUBO_API || '').trim();
    const hasPinata = !!(String(env.PINATA_API_KEY || '').trim() && String(env.PINATA_SECRET_KEY || '').trim());
    const hasInfura = !!String(env.INFURA_PROJECT_ID || '').trim() && isTruthy(env.ENABLE_INFURA_IPFS_LEGACY);
    const hasNftStorage = !!String(env.NFT_STORAGE_TOKEN || '').trim() && isTruthy(env.ENABLE_NFT_STORAGE_CLASSIC);
    return hasKubo || hasPinata || hasInfura || hasNftStorage;
}

main().catch(console.error);
