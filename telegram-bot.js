#!/usr/bin/env node
/**
 * 🤖 Clank & Claw Telegram Bot v2.7.0
 * 
 * Agentic Token Deployment Machine
 * 
 * Features:
 * - 📷 Image → auto IPFS upload
 * - 🔗 Link → auto parse context
 * - 💬 Natural language understanding
 * - 🎭 Stealth/Spoofing modes
 * - 🛡️ Hardened error handling
 * - ⚡ Streamlined UX flow
 */

import 'dotenv/config';
import https from 'https';
import os from 'os';
import path from 'path';
import { processImageInput, isIPFSCid, getProviderStatus } from './lib/ipfs.js';
import { parseTokenCommand, parseFees } from './lib/parser.js';
import { parseSmartSocialInput } from './lib/social-parser.js';
import {
    formatHealthError,
    listEnabledIpfsProviders,
    getStatusRpcCandidates,
    probeTelegramOrigin,
    probeRpcEndpoint
} from './lib/runtime-health.js';
import {
    UI_ACTIONS,
    PROFILE_INPUT_STATES,
    canAcceptImageInput,
    getReadyStatus,
    getSettingsButtons,
    getFallbackButtons,
    getProfileButtons,
    renderFieldValue,
    formatSessionPanel
} from './lib/bot-panel-ui.js';
import { createSessionDraftBridge } from './lib/bot-session.js';
import { createTelegramMessenger } from './lib/telegram-messenger.js';
import { validateConfig } from './lib/validator.js';
import { deployToken } from './clanker-core.js';
import { handleFallback } from './lib/fallback.js';
import { createBotLock } from './lib/bot-lock.js';
import { createTelegramApiClient } from './lib/telegram-api-client.js';
import { sessionManager, DEFAULT_SESSION_FEES } from './lib/session-manager.js';
import { createConfigFromSession } from './lib/config.js';
import { isRetryableTelegramApiResult } from './lib/telegram-network.js';
import { configStore } from './lib/config-store.js';

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const normalizeAdminCandidate = (value) => String(value || '').trim();
const isPlaceholderAdminValue = (value) => {
    const normalized = normalizeAdminCandidate(value).toUpperCase();
    if (!normalized) return false;
    if (normalized === '123456789') return true;
    return (
        normalized.includes('REPLACE')
        || normalized.includes('YOUR')
        || normalized.includes('<')
        || normalized.includes('>')
    );
};
const parseAdminAllowlist = (rawValue) => {
    const rawItems = String(rawValue || '')
        .split(/[,\n;]+/g)
        .map(normalizeAdminCandidate)
        .filter(Boolean);
    const ids = [];
    let placeholderCount = 0;
    for (const item of rawItems) {
        if (isPlaceholderAdminValue(item)) {
            placeholderCount++;
            continue;
        }
        ids.push(item);
    }
    return {
        ids: [...new Set(ids)],
        placeholderCount
    };
};

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const parsedAdmins = parseAdminAllowlist(process.env.TELEGRAM_ADMIN_IDS);
const ADMIN_CHAT_IDS = parsedAdmins.ids;
const SKIPPED_ADMIN_PLACEHOLDERS = parsedAdmins.placeholderCount;
const DEFAULT_FEES = DEFAULT_SESSION_FEES;
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const TELEGRAM_HEALTH_TIMEOUT_MS = 12000;
const FATAL_CONFIG_EXIT_CODE = 2;
const TELEGRAM_CONFLICT_BACKOFF_MS = Math.max(5000, Number(process.env.TELEGRAM_CONFLICT_BACKOFF_MS || 30000));
const TELEGRAM_MAX_CONFLICT_BACKOFF_MS = Math.max(TELEGRAM_CONFLICT_BACKOFF_MS, Number(process.env.TELEGRAM_MAX_CONFLICT_BACKOFF_MS || 300000));
const TELEGRAM_MAX_CONFLICT_ERRORS = Math.max(1, Number(process.env.TELEGRAM_MAX_CONFLICT_ERRORS || 20));
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const TOKEN_FINGERPRINT = String(process.env.TELEGRAM_BOT_TOKEN || '')
    .slice(0, 16)
    .replace(/[^a-zA-Z0-9_-]/g, '_') || 'bot';
const BOT_LOCK_FILE = String(
    process.env.BOT_LOCK_FILE
    || path.join(os.tmpdir(), `clank-and-claw-${TOKEN_FINGERPRINT}.lock`)
).trim();
const SPOOF_DISABLE_KEYWORDS = new Set(['off', 'disable', 'none', 'clear', 'reset']);
const TELEGRAM_HTTP_AGENT = new https.Agent({
    keepAlive: true,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000
});

const telegramApi = createTelegramApiClient({
    botToken: BOT_TOKEN,
    apiBases: process.env.TELEGRAM_API_BASES,
    apiBase: process.env.TELEGRAM_API_BASE,
    fileBase: process.env.TELEGRAM_FILE_BASE,
    agent: TELEGRAM_HTTP_AGENT,
    isRetryable: isRetryableTelegramApiResult
});
const botLock = createBotLock(BOT_LOCK_FILE);
const TELEGRAM_API_ORIGINS = telegramApi.getOrigins();
const TELEGRAM_FILE_BASE = telegramApi.getFileBase();
const isPermanentStartupError = (message) => {
    const text = String(message || '').toLowerCase();
    return (
        text.includes('telegram_bot_token not set')
        || text.includes('invalid bot token')
        || text.includes('another bot instance is already running')
        || text.includes('unauthorized')
    );
};

const fatalPollingExit = (reason) => {
    console.error(`❌ Fatal polling error: ${reason}`);
    botLock.release();
    process.exit(FATAL_CONFIG_EXIT_CODE);
};

// ═══════════════════════════════════════════
// TELEGRAM API - Robust Implementation
// ═══════════════════════════════════════════

const apiCall = (method, data = {}, retries = 3) => telegramApi.apiCall(method, data, retries);
const apiCallAtOrigin = (origin, method, data = {}) => (
    telegramApi.apiCallAtOrigin(origin, method, data, TELEGRAM_HEALTH_TIMEOUT_MS)
);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const normalizePrivateKey = () => {
    const raw = String(process.env.PRIVATE_KEY || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) return null;
    return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const isEthereumAddress = (value) => ETH_ADDRESS_REGEX.test(String(value || '').trim());

const createHealthyStatusClient = async () => {
    const { createPublicClient, http } = await import('viem');
    const { base } = await import('viem/chains');
    const rpcCandidates = getStatusRpcCandidates({
        primaryRpcUrl: process.env.RPC_URL,
        fallbackRpcUrlsCsv: process.env.RPC_FALLBACK_URLS
    });
    let lastError = null;

    for (const rpcUrl of rpcCandidates) {
        try {
            const client = createPublicClient({
                chain: base,
                transport: http(rpcUrl, {
                    timeout: 10000,
                    retryCount: 1,
                    retryDelay: 500
                })
            });
            await client.getBlockNumber();
            return { client, rpcUrl };
        } catch (error) {
            lastError = error;
        }
    }

    const detail = lastError?.message ? `: ${lastError.message}` : '';
    throw new Error(`No healthy RPC endpoint available (${rpcCandidates.join(', ')})${detail}`);
};

const messenger = createTelegramMessenger({
    apiCall,
    buildFileUrl: (origin, filePath) => telegramApi.buildFileUrl(origin, filePath),
    getActiveOrigin: () => telegramApi.getActiveOrigin(),
    logger: console
});
const { sendMessage, sendTyping, getFile, editMessage, sendButtons } = messenger;

// ═══════════════════════════════════════════
// SESSION MANAGEMENT - With Auto-Cleanup
// ═══════════════════════════════════════════

const sessionDraftBridge = createSessionDraftBridge({
    sessionManager,
    configStore,
    defaultFees: DEFAULT_FEES,
    logger: console
});
const {
    cloneTokenDraft,
    hydrateSessionFromDraft,
    persistSessionDraft,
    getSession,
    resetSession
} = sessionDraftBridge;

const isAuthorized = (chatId, userId) => {
    if (ADMIN_CHAT_IDS.length === 0) return true;
    const candidates = [chatId, userId]
        .filter(v => v !== undefined && v !== null)
        .map(v => String(v));
    return candidates.some(id => ADMIN_CHAT_IDS.includes(id));
};

// ═══════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════

const validatePrivateKey = () => {
    const raw = String(process.env.PRIVATE_KEY || '').trim();
    if (!raw) return { valid: false, error: 'PRIVATE_KEY not configured' };
    const pk = normalizePrivateKey();
    if (!pk) return { valid: false, error: 'PRIVATE_KEY invalid' };
    return { valid: true };
};

const deleteTelegramMessage = async (chatId, messageId) => {
    if (!chatId || !messageId) return;
    try {
        await apiCall('deleteMessage', {
            chat_id: chatId,
            message_id: messageId
        });
    } catch {
        // Ignore if bot cannot delete user messages in current chat type/permissions.
    }
};

const handleUnexpectedImageInput = async (chatId, messageId, session) => {
    await deleteTelegramMessage(chatId, messageId);
    await sendMessage(chatId, 'Image ignored. Use `/a` -> `Settings` -> `Image` before uploading.');
    if (session) {
        await showControlPanel(chatId, session, '*Session Panel*');
    }
};

const sendWizardImagePrompt = async (chatId) => {
    return await sendButtons(chatId, `
Step 3.5/4: Token Image
Send image as photo, image URL, or IPFS CID.
If no image, choose Skip Image.
    `.trim(), [
        [{ text: 'Skip Image', data: UI_ACTIONS.WIZ_SKIP_IMAGE }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
    ]);
};

const sendWizardContextPrompt = async (chatId) => {
    return await sendButtons(chatId, `
Step 4/4: Context Link
Send source link for indexing quality.
If no context, choose Skip Context.
    `.trim(), [
        [{ text: 'Skip Context', data: UI_ACTIONS.WIZ_SKIP_CONTEXT }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
    ]);
};

const applySessionFallbacks = (session) => {
    const draft = createConfigFromSession(session.token, ZERO_ADDRESS);
    const validated = validateConfig(draft);

    session.token.name = validated.name;
    session.token.symbol = validated.symbol;
    session.token.image = validated.image;
    session.token.context = validated.context;
    if (validated.metadata?.description && !String(session.token.description || '').trim()) {
        session.token.description = validated.metadata.description;
    }
    if (validated.fees?.type === 'static') {
        session.token.fees = {
            clankerFee: Number(validated.fees.clankerFee),
            pairedFee: Number(validated.fees.pairedFee)
        };
    }
};

const showControlPanel = async (chatId, session, title) => {
    persistSessionDraft(chatId, session);
    const panel = formatSessionPanel(session, title);
    return await sendButtons(chatId, panel.text, panel.buttons);
};

const showSettingsPanel = async (chatId, session, title = '*Settings Panel*') => {
    persistSessionDraft(chatId, session);
    const t = session.token;
    const feePercent = ((Number(t?.fees?.clankerFee || 0) + Number(t?.fees?.pairedFee || 0)) / 100).toFixed(2);
    return await sendButtons(chatId, `
${title}
━━━━━━━━━━━━━━━━━━━━━
Configure token fields using buttons below.

Name: ${renderFieldValue(t.name, 'Not set')}
Symbol: ${renderFieldValue(t.symbol, 'Not set')}
Fees: ${feePercent}%
Context: ${t.context?.messageId ? 'Set' : 'Not set'}
Image: ${t.image ? 'Set' : 'Not set'}
Spoof: ${t.spoofTo ? 'On' : 'Off'}
    `.trim(), getSettingsButtons(t));
};

const showFallbackPanel = async (chatId, session) => {
    persistSessionDraft(chatId, session);
    return await sendButtons(chatId, `
*Fallback Tools*
━━━━━━━━━━━━━━━━━━━━━
Use these actions to auto-heal or clean the current config.
    `.trim(), getFallbackButtons());
};

const showProfilesPanel = async (chatId, session, title = '*Config Profiles*') => {
    persistSessionDraft(chatId, session);

    const presets = configStore.listPresets(chatId);
    const lines = presets.length === 0
        ? ['No presets saved.']
        : presets.slice(0, 20).map((item, idx) => `${idx + 1}. ${item.name}`);

    return await sendButtons(chatId, `
${title}
━━━━━━━━━━━━━━━━━━━━━
Saved presets (${presets.length}):
${lines.join('\n')}

Tip: draft for current chat is auto-saved.
    `.trim(), getProfileButtons());
};

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

const handleStart = async (chatId, username) => {
    const pkCheck = validatePrivateKey();
    const providers = getProviderStatus();
    const session = getSession(chatId);

    // Status Logic
    const walletStatus = pkCheck.valid ? 'Active' : 'Missing Key';
    const storageStatus = providers.any ? 'Active' : 'Limited';

    await sendMessage(chatId, `
*Clank & Claw v2.7.0*
━━━━━━━━━━━━━━━━━━━━━━━━

*Operator:* @${username || 'Agent'}
*Wallet:* ${walletStatus}
*Storage:* ${storageStatus}

*Deployment Controls*
• */a* - Open action panel
• */deploy* - Start guided wizard
• */go* <SYMBOL> "<NAME>" <FEES> - Quick setup
• */spoof* <ADDRESS> - Set spoof target
• */profiles* - Manage saved config presets

Use */a* for button-first workflow.
Image uploads are accepted only from */a* -> *Settings* -> *Image*.
IPFS upload priority: *Local Kubo* -> Pinata -> legacy providers.

_Ready for instructions._
    `.trim());

    await showControlPanel(chatId, session, '*Control Panel*');
};

const handleHelp = async (chatId) => {
    await sendMessage(chatId, `
*Quick Guide*
━━━━━━━━━━━━━━━━━━━━━

1. Open */a*.
2. Use *Settings* to set name, symbol, fees, context, image.
3. Use *Deploy* and confirm.

*Commands*
\`/a\` open action panel
\`/deploy\` guided wizard
\`/go SYMBOL "Name" FEES\` quick setup
\`/spoof 0x...\` enable spoof
\`/spoof off\` disable spoof
\`/profiles\` saved presets
\`/status\` wallet status
\`/health\` system health
\`/cancel\` reset session
    `.trim());

    const session = getSession(chatId);
    await showControlPanel(chatId, session, '*Control Panel*');
};

const handleStatus = async (chatId) => {
    await sendTyping(chatId);

    try {
        const pkCheck = validatePrivateKey();
        if (!pkCheck.valid) {
            return await sendMessage(chatId, `❌ ${pkCheck.error}`);
        }

        const { formatEther } = await import('viem');
        const { privateKeyToAccount } = await import('viem/accounts');

        const cleanKey = normalizePrivateKey();
        if (!cleanKey) {
            return await sendMessage(chatId, '❌ PRIVATE_KEY invalid');
        }

        const { client, rpcUrl } = await createHealthyStatusClient();
        const account = privateKeyToAccount(cleanKey);
        const balance = await client.getBalance({ address: account.address });
        const eth = parseFloat(formatEther(balance));

        const balanceLevel = eth > 0.1 ? 'Healthy' : eth > 0.01 ? 'Low' : 'Critical';
        const balanceWarning = eth < 0.01 ? '\nWarning: low balance for deployment.' : '';

        await sendMessage(chatId, `
*Wallet Status*
━━━━━━━━━━━━━━━━━━━━━

Address: \`${account.address}\`
Balance: *${eth.toFixed(4)} ETH* (${balanceLevel})
Network: Base Mainnet
RPC: \`${rpcUrl}\`
${balanceWarning}
        `.trim());
    } catch (error) {
        await sendMessage(chatId, `❌ Error: ${error.message}`);
    }
};

const handleHealth = async (chatId) => {
    await sendTyping(chatId);

    const progress = await sendMessage(chatId, 'Running health check...\nChecking Telegram API, RPC, wallet, and IPFS.');

    try {
        const pkCheck = validatePrivateKey();
        const ipfsStatus = getProviderStatus();
        const rpcCandidates = getStatusRpcCandidates({
            primaryRpcUrl: process.env.RPC_URL,
            fallbackRpcUrlsCsv: process.env.RPC_FALLBACK_URLS
        });

        const [{ createPublicClient, http }, { base }] = await Promise.all([
            import('viem'),
            import('viem/chains')
        ]);

        const viemFactory = { createPublicClient, http, base };

        const [telegramChecks, rpcChecks] = await Promise.all([
            Promise.all(TELEGRAM_API_ORIGINS.map(origin => probeTelegramOrigin(origin, apiCallAtOrigin))),
            Promise.all(rpcCandidates.map(rpcUrl => probeRpcEndpoint(rpcUrl, viemFactory)))
        ]);

        const activeTelegramOrigin = telegramApi.getActiveOrigin();
        const healthyRpc = rpcChecks.find(item => item.ok);
        const ipfsProviders = listEnabledIpfsProviders(ipfsStatus);
        const storeStats = configStore.getStats();

        const telegramLines = telegramChecks.map(item => item.ok
            ? `• ✅ \`${item.origin}\` (${item.latencyMs}ms)`
            : `• ❌ \`${item.origin}\` (${item.latencyMs}ms) _${item.error}_`);

        const rpcLines = rpcChecks.map(item => item.ok
            ? `• ✅ \`${item.rpcUrl}\` (${item.latencyMs}ms, block ${item.blockNumber})`
            : `• ❌ \`${item.rpcUrl}\` (${item.latencyMs}ms) _${item.error}_`);

        const summary = [
            `Wallet: ${pkCheck.valid ? 'Ready' : pkCheck.error}`,
            `IPFS: ${ipfsStatus.any ? ipfsProviders.join(', ') : 'Not configured'}`,
            `Active Telegram Origin: \`${activeTelegramOrigin}\``,
            `Preferred RPC: ${healthyRpc ? `\`${healthyRpc.rpcUrl}\`` : '_No healthy RPC_'}`,
            `Session Cache: ${sessionManager.count()} active chat(s)`,
            `Config DB: ${storeStats.users} chat(s), ${storeStats.presets} preset(s)`
        ].join('\n');

        const resultMessage = `
*System Health*
━━━━━━━━━━━━━━━━━━━━━

${summary}

*Telegram Origins*
${telegramLines.join('\n')}

*RPC Endpoints*
${rpcLines.join('\n')}
        `.trim();

        await editMessage(chatId, progress?.result?.message_id, resultMessage);
    } catch (error) {
        await editMessage(chatId, progress?.result?.message_id, `❌ *Health check failed:* ${formatHealthError(error.message)}`);
    }
};

const handleConfig = async (chatId) => {
    const session = getSession(chatId);
    await showControlPanel(chatId, session, '*Current Session*');
};

const handleProfiles = async (chatId) => {
    const session = getSession(chatId);
    await showProfilesPanel(chatId, session);
};

const handleSavePreset = async (chatId, nameInput) => {
    const session = getSession(chatId);
    const name = String(nameInput || '').trim();
    if (!name) {
        return await sendMessage(chatId, 'Preset name is required. Example: `/save default`');
    }

    try {
        const saved = configStore.savePreset(chatId, name, cloneTokenDraft(session.token));
        persistSessionDraft(chatId, session);
        return await sendMessage(chatId, `Preset saved: *${saved.name}*`);
    } catch (error) {
        return await sendMessage(chatId, `Failed to save preset: ${error.message}`);
    }
};

const handleLoadPreset = async (chatId, nameInput, options = {}) => {
    const session = getSession(chatId);
    const showPanel = options.showPanel !== false;
    const name = String(nameInput || '').trim();
    if (!name) {
        return await sendMessage(chatId, 'Preset name is required. Example: `/load default`');
    }

    const preset = configStore.loadPreset(chatId, name);
    if (!preset) {
        return await sendMessage(chatId, `Preset not found: *${name}*`);
    }

    hydrateSessionFromDraft(session, preset.token);
    session.state = 'collecting';
    persistSessionDraft(chatId, session);
    await sendMessage(chatId, `Preset loaded: *${preset.name}*`);
    if (showPanel) {
        return await showControlPanel(chatId, session, '*Current Session*');
    }
};

const handleDeletePreset = async (chatId, nameInput) => {
    const name = String(nameInput || '').trim();
    if (!name) {
        return await sendMessage(chatId, 'Preset name is required. Example: `/deletepreset default`');
    }

    const deleted = configStore.deletePreset(chatId, name);
    if (!deleted) {
        return await sendMessage(chatId, `Preset not found: *${name}*`);
    }
    return await sendMessage(chatId, `Preset deleted: *${name}*`);
};

const handleSpoof = async (chatId, address) => {
    const session = getSession(chatId);
    const target = String(address || '').trim();

    if (!target || SPOOF_DISABLE_KEYWORDS.has(target.toLowerCase())) {
        if (!session.token.spoofTo) {
            return await sendMessage(chatId, 'Spoof is already disabled.');
        }

        session.token.spoofTo = null;
        persistSessionDraft(chatId, session);
        return await sendMessage(chatId, 'Spoof disabled. Rewards now route to the deployer wallet.');
    }

    if (!isEthereumAddress(target)) {
        return await sendMessage(chatId, `
*Spoof Mode*
━━━━━━━━━━━━━━━━━━━━━
Usage: \`/spoof 0xYourStealthAddress\`
Disable: \`/spoof off\`
Current: ${session.token.spoofTo ? `\`${session.token.spoofTo}\`` : '_None_'}
        `.trim());
    }

    session.token.spoofTo = target;
    persistSessionDraft(chatId, session);
    await sendMessage(chatId, `Spoof enabled: \`${target}\``);
};

const handleGo = async (chatId, args) => {
    const session = getSession(chatId);
    session.createdAt = Date.now(); // Refresh timeout

    // Parse everything from argsi
    const parsed = parseTokenCommand(args);

    // Merge with existing session
    if (parsed.symbol) session.token.symbol = parsed.symbol;
    if (parsed.name) session.token.name = parsed.name;
    if (parsed.fees) session.token.fees = parsed.fees;
    if (parsed.context) session.token.context = parsed.context;
    if (parsed.description) session.token.description = parsed.description;

    // Set default fees if not specified
    if (!session.token.fees) {
        session.token.fees = { ...DEFAULT_FEES };
    }

    if (!session.token.symbol && !session.token.name && String(args || '').trim()) {
        session.token.name = String(args || '');
    }

    // Use symbol as name if not provided
    if (!session.token.name && session.token.symbol) {
        session.token.name = session.token.symbol;
    }

    const status = getReadyStatus(session.token);

    session.state = 'collecting';
    persistSessionDraft(chatId, session);

    const totalFee = (
        Number(session.token?.fees?.clankerFee || 0)
        + Number(session.token?.fees?.pairedFee || 0)
    ) / 100;
    const displayName = renderFieldValue(session.token.name);
    const displaySymbol = renderFieldValue(session.token.symbol);

    await sendMessage(chatId, `
*Token Configured*
━━━━━━━━━━━━━━━━━━━━━

${displayName} (${displaySymbol})
Fees: *${totalFee}%*
${session.token.context ? `Context: ${session.token.context.platform}` : ''}
${session.token.spoofTo ? `Spoof: Active` : ''}

*Next Steps:*
${!session.token.image ? '1. (Optional) Set token *image* in *Settings*.' : ''}
${!session.token.context ? '2. (Recommended) Set *source link* context in *Settings*.' : ''}
${status.ready ? '\nReady to deploy. Use the *Deploy* button.' : ''}
    `.trim());

    await showControlPanel(chatId, session, '*Current Session*');

    if (status.ready) {
        session.state = 'confirming';
    }
};

const handleDeploy = async (chatId) => {
    const session = resetSession(chatId);
    session.state = 'wizard_name';
    session.createdAt = Date.now();

    await sendButtons(chatId, `
*Token Deployment Wizard*
━━━━━━━━━━━━━━━━━━━━━

*Step 1/4: Token Name*
What should the token be called?

_Example: Pepe Token_

    `.trim(), [
        [{ text: 'Cancel', data: UI_ACTIONS.CANCEL }]
    ]);
};

const handleCancel = async (chatId) => {
    resetSession(chatId);
    const session = getSession(chatId);
    await sendMessage(chatId, 'Session cancelled. Start fresh with /go, /deploy, or /a.');
    await showControlPanel(chatId, session, '*Control Panel*');
};

const handleMenuAction = async (chatId, data) => {
    const session = getSession(chatId);
    const status = getReadyStatus(session.token);

    switch (data) {
        case UI_ACTIONS.MENU:
            return await showControlPanel(chatId, session, '*Control Panel*');

        case UI_ACTIONS.SETTINGS:
            return await showSettingsPanel(chatId, session);

        case UI_ACTIONS.FALLBACK:
            return await showFallbackPanel(chatId, session);

        case UI_ACTIONS.PROFILES:
            return await showProfilesPanel(chatId, session);

        case UI_ACTIONS.WIZARD:
            return await handleDeploy(chatId);

        case UI_ACTIONS.SET_NAME:
            session.state = 'menu_name';
            return await sendButtons(chatId, 'Send token *name* (any text).', [
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.SET_SYMBOL:
            session.state = 'menu_symbol';
            return await sendButtons(chatId, 'Send token *symbol* (any text, can be empty/spaces).', [
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.SET_FEES:
            session.state = 'menu_fees';
            return await sendButtons(chatId, `
*Set Fees*
Choose preset or send custom fee text:
\`6%\`, \`600bps\`, or \`3% 3%\`
            `.trim(), [
                [{ text: 'Use 6% (3%+3%)', data: UI_ACTIONS.FEE_PRESET_6 }, { text: 'Use 5% (2.5%+2.5%)', data: UI_ACTIONS.FEE_PRESET_5 }],
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.FEE_PRESET_6:
            session.token.fees = { ...DEFAULT_FEES };
            session.state = 'collecting';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, 'Fees set to *6.00%* (3% + 3%).');
            return await showSettingsPanel(chatId, session);

        case UI_ACTIONS.FEE_PRESET_5:
            session.token.fees = { clankerFee: 250, pairedFee: 250 };
            session.state = 'collecting';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, 'Fees set to *5.00%* (2.5% + 2.5%).');
            return await showSettingsPanel(chatId, session);

        case UI_ACTIONS.SET_CONTEXT:
            session.state = 'menu_context';
            return await sendButtons(chatId, 'Send source link for context (X/Farcaster/GitHub/Website/etc).', [
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.SET_IMAGE:
            session.state = 'menu_image';
            return await sendButtons(chatId, 'Send image as photo, image URL, or IPFS CID.', [
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.SET_SPOOF:
            session.state = 'menu_spoof';
            return await sendButtons(chatId, 'Send spoof address (`0x...`) or `off` to disable.', [
                [{ text: 'Back', data: UI_ACTIONS.SETTINGS }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.PROFILE_SAVE:
            session.state = 'menu_profile_save';
            return await sendButtons(chatId, 'Send preset name to save current config.', [
                [{ text: 'Back', data: UI_ACTIONS.PROFILES }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.PROFILE_LOAD:
            session.state = 'menu_profile_load';
            return await sendButtons(chatId, 'Send preset name to load.', [
                [{ text: 'Back', data: UI_ACTIONS.PROFILES }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.PROFILE_DELETE:
            session.state = 'menu_profile_delete';
            return await sendButtons(chatId, 'Send preset name to delete.', [
                [{ text: 'Back', data: UI_ACTIONS.PROFILES }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case UI_ACTIONS.FB_AUTOFILL:
            try {
                applySessionFallbacks(session);
                await sendMessage(chatId, 'Fallback auto-fill applied to current config.');
            } catch (e) {
                await sendMessage(chatId, `Fallback failed: ${e.message}`);
            }
            return await showFallbackPanel(chatId, session);

        case UI_ACTIONS.FB_CLEAR_IMAGE:
            session.token.image = null;
            session.state = 'collecting';
            await sendMessage(chatId, 'Image cleared.');
            return await showFallbackPanel(chatId, session);

        case UI_ACTIONS.FB_CLEAR_CONTEXT:
            session.token.context = null;
            session.state = 'collecting';
            await sendMessage(chatId, 'Context cleared.');
            return await showFallbackPanel(chatId, session);

        case UI_ACTIONS.FB_CLEAR_SOCIALS:
            session.token.socials = {};
            session.state = 'collecting';
            await sendMessage(chatId, 'Social links cleared.');
            return await showFallbackPanel(chatId, session);

        case UI_ACTIONS.WIZ_FEE_6:
            if (session.state !== 'wizard_fees') {
                return await showControlPanel(chatId, session, '*Control Panel*');
            }
            session.token.fees = { ...DEFAULT_FEES };
            session.state = 'wizard_image';
            return await sendWizardImagePrompt(chatId);

        case UI_ACTIONS.WIZ_FEE_5:
            if (session.state !== 'wizard_fees') {
                return await showControlPanel(chatId, session, '*Control Panel*');
            }
            session.token.fees = { clankerFee: 250, pairedFee: 250 };
            session.state = 'wizard_image';
            return await sendWizardImagePrompt(chatId);

        case UI_ACTIONS.WIZ_SKIP_IMAGE:
            if (session.state !== 'wizard_image') {
                return await showControlPanel(chatId, session, '*Control Panel*');
            }
            session.state = 'wizard_context';
            return await sendWizardContextPrompt(chatId);

        case UI_ACTIONS.WIZ_SKIP_CONTEXT:
            if (session.state !== 'wizard_context') {
                return await showControlPanel(chatId, session, '*Control Panel*');
            }
            session.state = 'collecting';
            return await checkAndPrompt(chatId, session);

        case UI_ACTIONS.STATUS:
            return await handleStatus(chatId);

        case UI_ACTIONS.HEALTH:
            return await handleHealth(chatId);

        case UI_ACTIONS.HELP:
            return await handleHelp(chatId);

        case UI_ACTIONS.CANCEL:
            return await handleCancel(chatId);

        case UI_ACTIONS.DEPLOY:
            if (!status.ready) {
                await sendMessage(chatId, 'Token config is not ready yet. Complete fields first.');
                return await showControlPanel(chatId, session, '*Current Session*');
            }
            const deployName = renderFieldValue(session.token.name);
            const deploySymbol = renderFieldValue(session.token.symbol);
            session.state = 'confirming';
            return await sendButtons(chatId, `
*Confirm Deployment*
━━━━━━━━━━━━━━━━━━━━━
Token: ${deployName} (${deploySymbol})
Fees: *${((session.token.fees.clankerFee + session.token.fees.pairedFee) / 100).toFixed(2)}%*

Proceed to deploy now?
            `.trim(), [
                [{ text: 'Confirm Deploy', data: 'confirm_deploy' }, { text: 'Cancel', data: 'cancel_deploy' }],
                [{ text: 'Main Panel', data: UI_ACTIONS.MENU }]
            ]);

        default:
            return await sendMessage(chatId, 'Unknown action. Type /a to reopen panel.');
    }
};

// ═══════════════════════════════════════════
// MESSAGE PROCESSING - Smart Router
// ═══════════════════════════════════════════

const processMessage = async (chatId, text, session) => {
    const lowerText = text.toLowerCase().trim();

    // Quick confirmations
    if (session.state === 'confirming') {
        if (['yes', 'y', 'deploy', 'go', 'confirm', '/confirm'].includes(lowerText)) {
            return await executeDeploy(chatId, session);
        }
        if (['no', 'n', 'cancel', '/cancel'].includes(lowerText)) {
            resetSession(chatId);
            const freshSession = getSession(chatId);
            await sendMessage(chatId, 'Cancelled.');
            return await showControlPanel(chatId, freshSession, '*Control Panel*');
        }
    }

    // Targeted panel input states (button-driven flow)
    if (session.state === 'menu_name') {
        session.token.name = String(text || '');
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, `Name set: ${renderFieldValue(session.token.name, '`(empty)`')}`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_symbol') {
        session.token.symbol = String(text || '');
        if (!session.token.name) session.token.name = session.token.symbol;
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, `Symbol set: ${renderFieldValue(session.token.symbol, '`(empty)`')}`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_fees') {
        const fees = parseFees(text);
        if (!fees) return await sendMessage(chatId, 'Invalid fee format. Try `6%`, `600bps`, or `3% 3%`.');
        session.token.fees = fees;
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, `Fees set: *${((fees.clankerFee + fees.pairedFee) / 100).toFixed(2)}%*`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_context') {
        const { context, socials } = parseSmartSocialInput(text);
        if (!context) return await sendMessage(chatId, 'Context link not detected. Send a valid URL.');
        session.token.context = context;
        if (Object.keys(socials).length > 0) {
            session.token.socials = { ...session.token.socials, ...socials };
        }
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, `Context set: *${context.platform}* (${context.messageId})`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_image') {
        const trimmed = text.trim();
        if (isIPFSCid(trimmed)) {
            session.token.image = trimmed.replace('ipfs://', '');
        } else if (/^https?:\/\//i.test(trimmed)) {
            session.token.image = trimmed;
        } else {
            return await sendMessage(chatId, 'Send image as photo, HTTPS URL, or IPFS CID.');
        }
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, 'Image reference updated.');
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_spoof') {
        const target = text.trim();
        if (SPOOF_DISABLE_KEYWORDS.has(target.toLowerCase())) {
            session.token.spoofTo = null;
            session.state = 'collecting';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, 'Spoof disabled.');
            return await showSettingsPanel(chatId, session);
        }
        if (!isEthereumAddress(target)) {
            return await sendMessage(chatId, 'Invalid address. Send `0x...` or `off`.');
        }
        session.token.spoofTo = target;
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        await sendMessage(chatId, `Spoof target set: \`${target}\``);
        return await showSettingsPanel(chatId, session);
    }

    if (PROFILE_INPUT_STATES.has(String(session.state || ''))) {
        const presetName = String(text || '').trim();
        if (!presetName) {
            return await sendMessage(chatId, 'Preset name cannot be empty.');
        }

        if (session.state === 'menu_profile_save') {
            await handleSavePreset(chatId, presetName);
            session.state = 'collecting';
            return await showProfilesPanel(chatId, session);
        }

        if (session.state === 'menu_profile_load') {
            await handleLoadPreset(chatId, presetName, { showPanel: false });
            session.state = 'collecting';
            return await showProfilesPanel(chatId, session);
        }

        if (session.state === 'menu_profile_delete') {
            await handleDeletePreset(chatId, presetName);
            session.state = 'collecting';
            return await showProfilesPanel(chatId, session);
        }
    }

    if (session.state === 'wizard_image') {
        if (lowerText === '/skip' || lowerText === 'skip') {
            session.state = 'wizard_context';
            persistSessionDraft(chatId, session);
            return await sendWizardContextPrompt(chatId);
        }

        const trimmed = text.trim();
        if (isIPFSCid(trimmed)) {
            session.token.image = trimmed.replace('ipfs://', '');
            session.state = 'wizard_context';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, 'Image set.');
            return await sendWizardContextPrompt(chatId);
        }
        if (/^https?:\/\//i.test(trimmed)) {
            session.token.image = trimmed;
            session.state = 'wizard_context';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, 'Image URL set.');
            return await sendWizardContextPrompt(chatId);
        }

        return await sendMessage(chatId, 'Send image as photo, HTTPS URL, or IPFS CID. Use /skip to continue.');
    }

    if (session.state === 'wizard_context' && (lowerText === '/skip' || lowerText === 'skip')) {
        session.state = 'collecting';
        persistSessionDraft(chatId, session);
        return await checkAndPrompt(chatId, session);
    }

    // Check for URL first (works in any state)
    // Check for social links (works in any state)
    const { context, socials } = parseSmartSocialInput(text);

    if (context || Object.keys(socials).length > 0) {
            if (context) {
                session.token.context = context;
                await sendMessage(chatId, `Context set: *${context.platform}* (${context.messageId})`);
            }

        if (Object.keys(socials).length > 0) {
            session.token.socials = { ...session.token.socials, ...socials };
                const socialList = Object.entries(socials)
                    .map(([p, u]) => `• ${p}: ${u}`)
                    .join('\n');
                await sendMessage(chatId, `Social links updated:\n${socialList}`);
            }

        if (!context && Object.keys(socials).length > 0 && !session.token.context) {
            await sendMessage(chatId, `⚠️ Saved socials, but still need a *Context Link* (any source URL).`);
        }

        persistSessionDraft(chatId, session);
        return await checkAndPrompt(chatId, session);
    }

    // Reject CID outside image-input states to keep image flow explicit.
    if (isIPFSCid(text)) {
        return await sendMessage(chatId, 'Image/CID input is allowed only after choosing `Settings` -> `Image` from `/a`.');
    }

    if (session.state === 'wizard_context') {
        return await sendButtons(chatId, 'Send a valid source link, or choose Skip Context.', [
            [{ text: 'Skip Context', data: UI_ACTIONS.WIZ_SKIP_CONTEXT }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
        ]);
    }

    // Wizard state machine
    switch (session.state) {
        case 'wizard_name':
            session.token.name = String(text || '');
            session.state = 'wizard_symbol';
            persistSessionDraft(chatId, session);
            return await sendButtons(chatId, `
Name: ${renderFieldValue(session.token.name, '`(empty)`')}

*Step 2/4: Symbol*
What's the ticker? (e.g., PEPE)
            `.trim(), [
                [{ text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case 'wizard_symbol':
            session.token.symbol = String(text || '');
            session.state = 'wizard_fees';
            persistSessionDraft(chatId, session);
            return await sendButtons(chatId, `
Symbol: ${renderFieldValue(session.token.symbol, '`(empty)`')}

*Step 3/4: Fees*
Choose preset fees, or send custom fee text.

_Examples: 6%, 600bps, 3% 3%_
            `.trim(), [
                [{ text: 'Use 6%', data: UI_ACTIONS.WIZ_FEE_6 }, { text: 'Use 5%', data: UI_ACTIONS.WIZ_FEE_5 }],
                [{ text: 'Cancel', data: UI_ACTIONS.CANCEL }]
            ]);

        case 'wizard_fees':
            if (lowerText === '/skip' || lowerText === 'skip') {
                session.token.fees = { ...DEFAULT_FEES };
            } else {
                const fees = parseFees(text);
                if (!fees) {
                    return await sendMessage(chatId, 'Invalid format. Try: `6%`, `600bps`, or `3% 3%`');
                }
                session.token.fees = fees;
            }
            session.state = 'wizard_image';
            persistSessionDraft(chatId, session);
            await sendMessage(chatId, `Fees: *${(session.token.fees.clankerFee + session.token.fees.pairedFee) / 100}%*`);
            return await sendWizardImagePrompt(chatId);

        case 'collecting':
        case 'idle':
            // Try natural language parsing
            const nlParsed = parseTokenCommand(text);
            if (nlParsed.symbol) {
                if (nlParsed.symbol) session.token.symbol = nlParsed.symbol;
                if (nlParsed.name) session.token.name = nlParsed.name;
                if (nlParsed.fees) session.token.fees = nlParsed.fees;
                if (nlParsed.context) session.token.context = nlParsed.context;

                session.state = 'collecting';
                persistSessionDraft(chatId, session);

                const totalFee = (session.token.fees?.clankerFee + session.token.fees?.pairedFee) / 100 || 6;

                await sendMessage(chatId, `
*Detected:* ${session.token.symbol} "${session.token.name || session.token.symbol}"
Fees: ${totalFee}%

Continue in *Settings*, or deploy from the panel.
                `.trim());
                return;
            }

            // Unknown input -> Smart Fallback
            await handleFallback(chatId, text, session, {
                sendMessage,
                resetSession
            });
            persistSessionDraft(chatId, session);
            return await showControlPanel(chatId, session, '*Control Panel*');

        default:
            return await checkAndPrompt(chatId, session);
    }
};

const processPhoto = async (chatId, photo, session, preResolvedFileUrl = null) => {
    await sendTyping(chatId);

    // Check IPFS config
    const ipfsStatus = getProviderStatus();
    if (!ipfsStatus.any) {
        return await sendMessage(chatId, `
*IPFS Not Configured*

Add one of these to .env:
• \`IPFS_KUBO_API=http://127.0.0.1:5001\` (no API key, own node)
• \`PINATA_API_KEY=...\` + \`PINATA_SECRET_KEY=...\` (recommended)
• Legacy only: \`INFURA_PROJECT_ID\` + \`INFURA_SECRET\` + \`ENABLE_INFURA_IPFS_LEGACY=true\`
• Legacy only: \`NFT_STORAGE_TOKEN\` + \`ENABLE_NFT_STORAGE_CLASSIC=true\`

Or paste an existing IPFS CID.
        `.trim());
    }

    const statusMsg = await sendMessage(chatId, 'Uploading to IPFS...');

    // Get file URL
    const file = photo?.[photo.length - 1];
    if (!file?.file_id) {
        return await editMessage(chatId, statusMsg?.result?.message_id, 'Invalid image payload. Try sending the image again.');
    }
    const fileUrl = preResolvedFileUrl || await getFile(file.file_id);

    if (!fileUrl) {
        return await editMessage(chatId, statusMsg?.result?.message_id, 'Could not download image. Try again.');
    }

    // Upload to IPFS
    let result;
    try {
        result = await processImageInput(fileUrl);
    } catch (error) {
        return await editMessage(chatId, statusMsg?.result?.message_id, `Upload error: ${error.message}`);
    }

    if (!result.success) {
        return await editMessage(chatId, statusMsg?.result?.message_id, `Upload failed: ${result.error}`);
    }

    session.token.image = result.cid;
    const previousState = session.state;
    if (session.state === 'menu_image') {
        session.state = 'collecting';
    } else if (session.state === 'wizard_image') {
        session.state = 'wizard_context';
    }
    persistSessionDraft(chatId, session);

    await editMessage(chatId, statusMsg?.result?.message_id, `*Image uploaded*\nCID: \`${result.cid}\``);

    // Set default fees if not set
    if (!session.token.fees) {
        session.token.fees = { ...DEFAULT_FEES };
    }

    if (previousState === 'wizard_image') {
        return await sendWizardContextPrompt(chatId);
    }

    if (previousState === 'menu_image') {
        return await showSettingsPanel(chatId, session);
    }

    await checkAndPrompt(chatId, session);
};

const checkAndPrompt = async (chatId, session) => {
    persistSessionDraft(chatId, session);
    const status = getReadyStatus(session.token);

    if (status.ready) {
        session.state = 'confirming';
        const t = session.token;
        const displaySymbol = renderFieldValue(t.symbol, 'AUTO');
        const displayName = renderFieldValue(t.name, `${displaySymbol} Token`);
        const totalFee = (t.fees.clankerFee + t.fees.pairedFee) / 100;
        const socialCount = Object.keys(t.socials || {}).length;
        const contexts = t.socials ? Object.keys(t.socials).map(k => k.charAt(0).toUpperCase() + k.slice(1)).join(', ') : 'None';

        await sendButtons(chatId, `
*Deployment Dashboard*
━━━━━━━━━━━━━━━━━━━━━━━━

*Token Information*
• *Name:* ${displayName}
• *Symbol:* ${displaySymbol}
• *Fees:* ${totalFee}% (${t.fees.clankerFee}/${t.fees.pairedFee} bps)

*Deployment Context*
• *Platform:* ${t.context?.platform ? t.context.platform.toUpperCase() : 'None'} (${t.context?.messageId ? 'set' : 'not set'})
• *Socials:* ${socialCount > 0 ? `${socialCount} added (${contexts})` : 'None'}

*Settings*
• *Image:* ${status.hasImage ? 'Set' : 'Auto fallback'}
${t.spoofTo ? `• *Spoofing:* Active\n  Target: \`${t.spoofTo}\`` : '• *Spoofing:* Inactive'}

Type *"/confirm"* or *"yes"* to deploy.
Type *"/cancel"* to abort.
        `.trim(), [
            [{ text: 'Confirm Deploy', data: 'confirm_deploy' }, { text: 'Cancel', data: 'cancel_deploy' }],
            [{ text: 'Settings', data: UI_ACTIONS.SETTINGS }, { text: 'Main Panel', data: UI_ACTIONS.MENU }]
        ]);
    } else if (status.missing.length > 0) {
        const requiredPrompts = [];
        if (status.missing.includes('name')) requiredPrompts.push('set token *name*');
        if (status.missing.includes('symbol')) requiredPrompts.push('set token *symbol*');
        if (status.missing.includes('fees')) requiredPrompts.push('set valid *fees*');

        const prompts = [];
        if (!status.hasImage) prompts.push('(Optional) set token *image*');
        if (!status.hasContext) prompts.push('(Recommended) set *source link* context');

        if (requiredPrompts.length > 0) {
            await sendMessage(chatId, `*Required:* ${requiredPrompts.join(' and ')}`);
        }
        if (prompts.length > 0) {
            await sendMessage(chatId, `*Next:* ${prompts.join(' or ')}`);
        }
        await showControlPanel(chatId, session, '*Current Session*');
    }
};

// ═══════════════════════════════════════════
// DEPLOYMENT EXECUTION
// ═══════════════════════════════════════════

const executeDeploy = async (chatId, session) => {
    if (session.isDeploying) return;
    session.isDeploying = true;

    await sendTyping(chatId);

    // Final validation
    const pkCheck = validatePrivateKey();
    if (!pkCheck.valid) {
        session.isDeploying = false;
        return await sendMessage(chatId, `❌ ${pkCheck.error}\n\nCannot deploy without wallet.`);
    }

    const t = session.token;
    const status = getReadyStatus(t);
    if (!status.ready) {
        session.isDeploying = false;
        return await sendMessage(chatId, `❌ Missing: ${status.missing.join(', ')}`);
    }

    const statusMsg = await sendMessage(chatId, '🚀 *Launching...*\nTurbo-confirmation active.');

    try {
        // Get Deployer Address for Config
        const { privateKeyToAccount } = await import('viem/accounts');
        const cleanKey = normalizePrivateKey();
        if (!cleanKey) {
            throw new Error('PRIVATE_KEY invalid');
        }
        const account = privateKeyToAccount(cleanKey);

        // Build Config WITHOUT process.env side-effects
        // This ensures thread safety for concurrent deployments
        let config = createConfigFromSession(t, account.address);
        config = validateConfig(config);

        console.log(`🚀 Bot Deploy Request: ${t.name} (${t.symbol}) from ChatID: ${chatId}`);

        // Deploy
        const result = await deployToken(config);

        if (result.success) {
            const addressDisplay = result.address || 'Not detected (check tx link)';
            const txDisplay = result.txHash ? `${result.txHash.substring(0, 20)}...` : 'N/A';
            const scanLabel = result.address ? 'View on Basescan' : 'View TX on Basescan';
            const successMsg = `
🎉 *DEPLOYED SUCCESSFULLY!*
━━━━━━━━━━━━━━━━━━━━━━━━

📛 *${t.name}* (${t.symbol})
📍 Address: \`${addressDisplay}\`
🔗 [${scanLabel}](${result.scanUrl})

💰 TX: \`${txDisplay}\`

Your token is now live on Base!
${t.spoofTo ? '\n\n🎭 Rewards routed to stealth address.' : ''}
            `.trim();

            await editMessage(chatId, statusMsg?.result?.message_id, successMsg);
        } else {
            const errorMsg = typeof result.error === 'string'
                ? result.error
                : JSON.stringify(result.error, null, 2);
            await editMessage(chatId, statusMsg?.result?.message_id, `❌ *Deployment Failed*\n\n\`${errorMsg}\``);
        }

    } catch (error) {
        console.error('ExecuteDeploy Error:', error);
        await editMessage(chatId, statusMsg?.result?.message_id, `❌ *Error:* ${error.message}`);
    } finally {
        try {
            configStore.savePreset(chatId, 'last-used', cloneTokenDraft(session.token));
        } catch (error) {
            console.error('Preset autosave warning:', error.message);
        }
        // Always reset session after attempt
        const freshSession = resetSession(chatId);
        try {
            await showControlPanel(chatId, freshSession, '*Ready for Next Deployment*');
        } catch (e) {
            // Ignore panel send error after deployment attempt
        }
    }
};

// ═══════════════════════════════════════════
// UPDATE HANDLER - Main Router
// ═══════════════════════════════════════════

const handleUpdate = async (update) => {
    // Handle callback queries (button presses)
    if (update.callback_query) {
        const { id, data, message, from } = update.callback_query;
        await apiCall('answerCallbackQuery', { callback_query_id: id }).catch(() => { });
        const chatId = message?.chat?.id;
        const userId = from?.id;
        if (!chatId) return;
        if (!isAuthorized(chatId, userId)) {
            const details = [
                `User ID: \`${userId || 'unknown'}\``,
                `Chat ID: \`${chatId}\``
            ].join('\n');
            return await sendMessage(chatId, `⛔ Unauthorized.\n\n${details}\n\nAsk admin to add your ID in \`TELEGRAM_ADMIN_IDS\`.`);
        }

        if (data === 'confirm_deploy') {
            const session = getSession(chatId);
            session.state = 'confirming';
            return await processMessage(chatId, 'yes', session);
        }
        if (data === 'cancel_deploy') {
            return await handleCancel(chatId);
        }

        if (Object.values(UI_ACTIONS).includes(data)) {
            return await handleMenuAction(chatId, data);
        }
        return await sendMessage(chatId, 'Unknown button action. Type /a.');
    }

    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;
    const userId = message.from?.id;
    const username = message.from?.username;

    // Authorization check
    if (!isAuthorized(chatId, userId)) {
        const details = [
            `User ID: \`${userId || 'unknown'}\``,
            `Chat ID: \`${chatId}\``
        ].join('\n');
        return await sendMessage(chatId, `⛔ Unauthorized.\n\n${details}\n\nAsk admin to add your ID in \`TELEGRAM_ADMIN_IDS\`.`);
    }

    const session = getSession(chatId);

    // Handle text commands
    if (message.text) {
        const text = message.text.trim();
        const cmd = text.split(' ')[0].toLowerCase();
        const args = text.substring(cmd.length).trim();

        // Command routing
        switch (cmd) {
            case '/start': return handleStart(chatId, username);
            case '/help': return handleHelp(chatId);
            case '/a':
            case '/menu':
            case '/panel':
                return showControlPanel(chatId, session, '*Control Panel*');
            case '/status': return handleStatus(chatId);
            case '/health': return handleHealth(chatId);
            case '/config': return handleConfig(chatId);
            case '/profiles': return handleProfiles(chatId);
            case '/save':
            case '/savepreset':
                return handleSavePreset(chatId, args);
            case '/load':
                return handleLoadPreset(chatId, args);
            case '/deletepreset':
            case '/delpreset':
                return handleDeletePreset(chatId, args);
            case '/deploy': return handleDeploy(chatId);
            case '/cancel': return handleCancel(chatId);
            case '/spoof': return handleSpoof(chatId, args);
            case '/go':
            case '/quick':
            case '/launch':
                return handleGo(chatId, args);
            case '/confirm':
            case '/yes':
                session.state = 'confirming';
                return processMessage(chatId, 'yes', session);
        }

        return processMessage(chatId, text, session);
    }

    // Handle photos
    if (message.photo) {
        if (!canAcceptImageInput(session)) {
            return await handleUnexpectedImageInput(chatId, message.message_id, session);
        }
        return processPhoto(chatId, message.photo, session);
    }

    // Handle documents (images as files)
    const isImageDocument = !!message.document && (
        message.document?.mime_type?.startsWith('image/')
        || /\.(png|jpe?g|gif|webp|svg)$/i.test(String(message.document?.file_name || ''))
    );
    if (isImageDocument) {
        if (!canAcceptImageInput(session)) {
            return await handleUnexpectedImageInput(chatId, message.message_id, session);
        }
        const fileUrl = await getFile(message.document.file_id);
        if (fileUrl) {
            return processPhoto(chatId, [{ file_id: message.document.file_id }], session, fileUrl);
        }
        return sendMessage(chatId, '❌ Could not download image file from Telegram. Try sending as photo.');
    }
};

// ═══════════════════════════════════════════
// POLLING LOOP - Robust Implementation
// ═══════════════════════════════════════════

let lastUpdateId = 0;
let consecutiveErrors = 0;
let consecutiveConflicts = 0;

const isGetUpdatesConflictError = (message) => {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('terminated by other getupdates request');
};

const isGetUpdatesAuthError = (message) => {
    const normalized = String(message || '').toLowerCase();
    return normalized.includes('unauthorized')
        || normalized.includes('invalid bot token')
        || normalized.includes('not found');
};

const poll = async () => {
    try {
        const result = await apiCall('getUpdates', {
            offset: lastUpdateId + 1,
            timeout: 30,
            allowed_updates: ['message', 'callback_query']
        });

        if (!result?.ok) {
            throw new Error(result?.description || 'getUpdates failed');
        }

        consecutiveErrors = 0;
        consecutiveConflicts = 0;
        if (result.result?.length > 0) {
            for (const update of result.result) {
                lastUpdateId = update.update_id;
                try {
                    await handleUpdate(update);
                } catch (error) {
                    console.error('Handler error:', error.message);
                }
            }
        }
    } catch (error) {
        if (isGetUpdatesConflictError(error?.message)) {
            consecutiveConflicts++;
            const delay = Math.min(
                TELEGRAM_CONFLICT_BACKOFF_MS * Math.max(1, consecutiveConflicts),
                TELEGRAM_MAX_CONFLICT_BACKOFF_MS
            );
            console.error(`Poll conflict (${consecutiveConflicts}): ${error.message}`);
            if (consecutiveConflicts === 1 || consecutiveConflicts % 5 === 0) {
                console.error('⚠️ Another bot instance is polling with the same token. Keep only one active instance.');
            }
            if (consecutiveConflicts >= TELEGRAM_MAX_CONFLICT_ERRORS) {
                return fatalPollingExit(`conflict persisted ${consecutiveConflicts} times`);
            }
            await sleep(delay);
        } else if (isGetUpdatesAuthError(error?.message)) {
            return fatalPollingExit(error.message);
        } else {
            consecutiveErrors++;
            console.error(`Poll error (${consecutiveErrors}):`, error.message);

            // Exponential backoff
            const delay = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 60000);
            await sleep(delay);
        }
    }

    setImmediate(poll);
};

// ═══════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════

const main = async () => {
    console.log('');
    console.log('🐾 Clank & Claw Telegram Bot v2.7.0');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN not set');
        process.exit(FATAL_CONFIG_EXIT_CODE);
    }

    botLock.acquire();
    console.log(`🔒 Instance lock: ${BOT_LOCK_FILE}`);

    // Verify bot
    const me = await apiCall('getMe');
    if (!me.ok) {
        console.error(`❌ Invalid bot token (${me.description || 'unknown error'})`);
        botLock.release();
        process.exit(FATAL_CONFIG_EXIT_CODE);
    }

    const webhookInfo = await apiCall('getWebhookInfo', {}, 1).catch(() => ({ ok: false }));
    if (webhookInfo?.ok && webhookInfo?.result?.url) {
        console.log(`ℹ️ Webhook detected (${webhookInfo.result.url}). Clearing webhook for polling mode...`);
        await apiCall('deleteWebhook', { drop_pending_updates: false }, 2);
    }

    // Status checks
    const pkCheck = validatePrivateKey();
    const ipfsStatus = getProviderStatus();
    const storeStats = configStore.getStats();

    const ipfsProviders = listEnabledIpfsProviders(ipfsStatus);

    console.log(`✅ Bot: @${me.result.username}`);
    console.log(`${pkCheck.valid ? '✅' : '❌'} Wallet: ${pkCheck.valid ? 'Ready' : pkCheck.error}`);
    console.log(`${ipfsStatus.any ? '✅' : '⚠️'} IPFS: ${ipfsProviders.length > 0 ? ipfsProviders.join(', ') : 'Not configured'}`);
    console.log(`📍 Admins: ${ADMIN_CHAT_IDS.length > 0 ? ADMIN_CHAT_IDS.join(', ') : 'All allowed'}`);
    if (SKIPPED_ADMIN_PLACEHOLDERS > 0) {
        console.log(`⚠️ Ignored ${SKIPPED_ADMIN_PLACEHOLDERS} placeholder admin ID(s) from TELEGRAM_ADMIN_IDS`);
    }
    console.log(`💾 Config DB: ${storeStats.path} (${storeStats.users} chats, ${storeStats.presets} presets)`);
    console.log(`🌐 Telegram API: ${TELEGRAM_API_ORIGINS.join(' | ')}`);
    if (TELEGRAM_FILE_BASE) {
        console.log(`🌐 Telegram File Base: ${TELEGRAM_FILE_BASE}`);
    }
    console.log('');
    console.log('🔄 Polling for updates...');
    console.log('');

    poll();
};

// ═══════════════════════════════════════════
// GLOBAL ERROR SAFETY
// ═══════════════════════════════════════════

process.on('uncaughtException', (err) => {
    console.error('🔥 CRITICAL: Uncaught Exception:', err);
    // In production managed by PM2, a restart might be better, 
    // but for standalone stability, we log and keep alive if possible.
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('⚠️ Unhandled Rejection:', reason);
});

const shutdown = (signal) => {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    try {
        TELEGRAM_HTTP_AGENT.destroy();
    } catch (e) {
        // Ignore shutdown cleanup errors
    }
    botLock.release();
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start Main
main().catch(err => {
    console.error('❌ Fatal Startup Error:', err);
    botLock.release();
    const code = isPermanentStartupError(err?.message) ? FATAL_CONFIG_EXIT_CODE : 1;
    process.exit(code);
});
