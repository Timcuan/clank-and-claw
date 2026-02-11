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
import fs from 'fs';
import os from 'os';
import path from 'path';
import { processImageInput, isIPFSCid, getProviderStatus } from './lib/ipfs.js';
import { parseTokenCommand, parseFees } from './lib/parser.js';
import { parseSmartSocialInput } from './lib/social-parser.js';
import { validateConfig } from './lib/validator.js';
import { deployToken } from './clanker-core.js';
import { handleFallback } from './lib/fallback.js';
import { sessionManager, DEFAULT_SESSION_FEES } from './lib/session-manager.js';
import { createConfigFromSession } from './lib/config.js';
import { isRetryableTelegramApiResult } from './lib/telegram-network.js';

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DEFAULT_FEES = DEFAULT_SESSION_FEES;
const MARKDOWN_ERROR_TEXT = 'parse entities';
const MAX_TELEGRAM_TEXT_LENGTH = 3900;
const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const DEFAULT_TELEGRAM_ORIGIN = 'https://api.telegram.org';
const DEFAULT_RPC_URL = 'https://mainnet.base.org';
const MESSAGE_NOT_MODIFIED_TEXT = 'message is not modified';
const TELEGRAM_HEALTH_TIMEOUT_MS = 12000;
const RPC_HEALTH_TIMEOUT_MS = 10000;
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

const normalizeBaseUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
const parseCsvUrls = (value) => (String(value || ''))
    .split(',')
    .map(s => normalizeBaseUrl(s))
    .filter(Boolean);
const parseCsvValues = (value) => (String(value || ''))
    .split(',')
    .map(s => String(s || '').trim())
    .filter(Boolean);

const configuredOrigins = parseCsvUrls(process.env.TELEGRAM_API_BASES);
const fallbackOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : [normalizeBaseUrl(process.env.TELEGRAM_API_BASE) || DEFAULT_TELEGRAM_ORIGIN];
const TELEGRAM_API_ORIGINS = [...new Set(fallbackOrigins)];
const TELEGRAM_FILE_BASE = normalizeBaseUrl(process.env.TELEGRAM_FILE_BASE);
let activeTelegramOriginIndex = 0;

const buildTelegramApiUrl = (origin, method) => `${normalizeBaseUrl(origin)}/bot${BOT_TOKEN}/${method}`;
const buildTelegramFileUrl = (origin, filePath) => {
    const base = TELEGRAM_FILE_BASE || `${normalizeBaseUrl(origin)}/file`;
    return `${base}/bot${BOT_TOKEN}/${filePath}`;
};

const formatHealthError = (value) => String(value || 'unknown error').replace(/\s+/g, ' ').trim();
let botLockFd = null;
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
    releaseBotLock();
    process.exit(FATAL_CONFIG_EXIT_CODE);
};

const isPidAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const readLockData = () => {
    try {
        const raw = fs.readFileSync(BOT_LOCK_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
};

const acquireBotLock = () => {
    const payload = JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        hostname: os.hostname(),
        cwd: process.cwd()
    });

    const tryCreate = () => {
        botLockFd = fs.openSync(BOT_LOCK_FILE, 'wx', 0o600);
        fs.writeFileSync(botLockFd, payload, 'utf8');
    };

    try {
        tryCreate();
        return;
    } catch (error) {
        if (error?.code !== 'EEXIST') {
            throw new Error(`Cannot create lock file (${BOT_LOCK_FILE}): ${error.message}`);
        }
    }

    const existing = readLockData();
    const existingPid = Number(existing?.pid);
    if (isPidAlive(existingPid)) {
        throw new Error(`Another bot instance is already running (PID ${existingPid}). Stop it first to avoid getUpdates conflict.`);
    }

    try { fs.unlinkSync(BOT_LOCK_FILE); } catch { }
    tryCreate();
};

const releaseBotLock = () => {
    if (botLockFd !== null) {
        try { fs.closeSync(botLockFd); } catch { }
        botLockFd = null;
    }
    try { fs.unlinkSync(BOT_LOCK_FILE); } catch { }
};

// ═══════════════════════════════════════════
// TELEGRAM API - Robust Implementation
// ═══════════════════════════════════════════

const apiCall = async (method, data = {}, retries = 3) => {
    const totalAttempts = Math.max(1, retries, TELEGRAM_API_ORIGINS.length);
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        const originIndex = (activeTelegramOriginIndex + attempt - 1) % TELEGRAM_API_ORIGINS.length;
        const apiOrigin = TELEGRAM_API_ORIGINS[originIndex];
        try {
            const result = await new Promise((resolve, reject) => {
                const body = JSON.stringify(data);
                const req = https.request(buildTelegramApiUrl(apiOrigin, method), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    },
                    agent: TELEGRAM_HTTP_AGENT,
                    timeout: 30000
                }, (res) => {
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => {
                        try {
                            const parsed = JSON.parse(responseData);
                            resolve({
                                ...parsed,
                                _httpStatus: res.statusCode,
                                _apiOrigin: apiOrigin
                            });
                        } catch (e) {
                            resolve({
                                ok: false,
                                error: responseData,
                                description: responseData,
                                error_code: res.statusCode,
                                _httpStatus: res.statusCode,
                                _apiOrigin: apiOrigin
                            });
                        }
                    });
                });

                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
                req.write(body);
                req.end();
            });

            if (result?.ok !== false) {
                activeTelegramOriginIndex = originIndex;
                return result;
            }

            if (isRetryableTelegramApiResult(result) && attempt < totalAttempts) {
                const retryAfter = Number(result?.parameters?.retry_after || 0);
                const delayMs = result?.error_code === 429
                    ? Math.max(1000, retryAfter * 1000)
                    : 1000 * attempt;
                await sleep(delayMs);
                continue;
            }

            activeTelegramOriginIndex = originIndex;
            return result;
        } catch (error) {
            if (attempt === totalAttempts) throw error;
            await sleep(1000 * attempt);
        }
    }
    throw new Error(`Telegram API call failed after ${totalAttempts} attempts`);
};

const apiCallAtOrigin = async (origin, method, data = {}) => {
    return await new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = https.request(buildTelegramApiUrl(origin, method), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            agent: TELEGRAM_HTTP_AGENT,
            timeout: TELEGRAM_HEALTH_TIMEOUT_MS
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({
                        ...parsed,
                        _httpStatus: res.statusCode,
                        _apiOrigin: origin
                    });
                } catch (e) {
                    resolve({
                        ok: false,
                        error: responseData,
                        description: responseData,
                        error_code: res.statusCode,
                        _httpStatus: res.statusCode,
                        _apiOrigin: origin
                    });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(body);
        req.end();
    });
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const stripMarkdown = (text) => String(text || '').replace(/[*_`\[\]]/g, '');
const truncateForTelegram = (text) => {
    const value = String(text || '');
    if (value.length <= MAX_TELEGRAM_TEXT_LENGTH) return value;
    const overflow = value.length - MAX_TELEGRAM_TEXT_LENGTH;
    return `${value.slice(0, MAX_TELEGRAM_TEXT_LENGTH - 40)}\n\n[truncated ${overflow} chars]`;
};

const isMarkdownParseError = (result) => {
    if (!result || result.ok !== false) return false;
    const desc = String(result.description || result.error || '').toLowerCase();
    return desc.includes(MARKDOWN_ERROR_TEXT);
};

const isMessageNotModified = (result) => {
    if (!result || result.ok !== false) return false;
    const desc = String(result.description || result.error || '').toLowerCase();
    return desc.includes(MESSAGE_NOT_MODIFIED_TEXT);
};

const normalizePrivateKey = () => {
    const raw = String(process.env.PRIVATE_KEY || '').trim();
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) return null;
    return raw.startsWith('0x') ? raw : `0x${raw}`;
};

const isEthereumAddress = (value) => ETH_ADDRESS_REGEX.test(String(value || '').trim());

const getStatusRpcCandidates = () => {
    const configuredPrimary = String(process.env.RPC_URL || '').trim();
    const candidates = [
        configuredPrimary || DEFAULT_RPC_URL,
        ...parseCsvValues(process.env.RPC_FALLBACK_URLS)
    ].filter(Boolean);
    return [...new Set(candidates)];
};

const probeTelegramOrigin = async (origin) => {
    const startedAt = Date.now();
    try {
        const result = await apiCallAtOrigin(origin, 'getMe');
        const latencyMs = Date.now() - startedAt;
        if (result?.ok) {
            return { origin, ok: true, latencyMs, username: result?.result?.username || null };
        }
        return {
            origin,
            ok: false,
            latencyMs,
            error: formatHealthError(result?.description || result?.error || `HTTP ${result?._httpStatus || 'unknown'}`)
        };
    } catch (error) {
        return {
            origin,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: formatHealthError(error?.message)
        };
    }
};

const probeRpcEndpoint = async (rpcUrl, viemFactory) => {
    const startedAt = Date.now();
    try {
        const client = viemFactory.createPublicClient({
            chain: viemFactory.base,
            transport: viemFactory.http(rpcUrl, {
                timeout: RPC_HEALTH_TIMEOUT_MS,
                retryCount: 0
            })
        });
        const blockNumber = await client.getBlockNumber();
        return {
            rpcUrl,
            ok: true,
            latencyMs: Date.now() - startedAt,
            blockNumber: blockNumber.toString()
        };
    } catch (error) {
        return {
            rpcUrl,
            ok: false,
            latencyMs: Date.now() - startedAt,
            error: formatHealthError(error?.message)
        };
    }
};

const createHealthyStatusClient = async () => {
    const { createPublicClient, http } = await import('viem');
    const { base } = await import('viem/chains');
    const rpcCandidates = getStatusRpcCandidates();
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

const sendMessage = async (chatId, text, options = {}) => {
    const safeText = truncateForTelegram(text);
    const markdownPayload = {
        chat_id: chatId,
        text: safeText,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        ...options
    };

    try {
        const result = await apiCall('sendMessage', markdownPayload);
        if (result?.ok !== false) {
            return result;
        }
        if (!isMarkdownParseError(result)) {
            console.warn(`Telegram sendMessage failed: ${result?.description || 'unknown error'}`);
            return result;
        }
    } catch (e) {
        console.warn(`Telegram sendMessage request error: ${e.message}`);
    }

    const plainPayload = {
        chat_id: chatId,
        text: stripMarkdown(safeText),
        disable_web_page_preview: true,
        ...options
    };
    delete plainPayload.parse_mode;

    try {
        return await apiCall('sendMessage', plainPayload);
    } catch (e) {
        console.error(`Telegram sendMessage fallback failed: ${e.message}`);
        return { ok: false, error: e.message, description: e.message };
    }
};

const sendTyping = (chatId) => apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { });

const getFile = async (fileId) => {
    try {
        const result = await apiCall('getFile', { file_id: fileId });
        if (result.ok && result.result.file_path) {
            return buildTelegramFileUrl(result._apiOrigin || TELEGRAM_API_ORIGINS[activeTelegramOriginIndex], result.result.file_path);
        }
    } catch (e) { }
    return null;
};

const editMessage = async (chatId, messageId, text) => {
    const safeText = truncateForTelegram(text);
    if (!messageId) {
        return await sendMessage(chatId, safeText);
    }

    try {
        const result = await apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: safeText,
            parse_mode: 'Markdown'
        });
        if (result?.ok !== false) {
            return result;
        }
        if (isMessageNotModified(result)) {
            return { ...result, ok: true };
        }
        if (!isMarkdownParseError(result)) {
            console.warn(`Telegram editMessageText failed: ${result?.description || 'unknown error'}`);
        }
    } catch (e) {
        console.warn(`Telegram editMessageText request error: ${e.message}`);
    }

    try {
        const plainEdit = await apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: stripMarkdown(safeText)
        });

        if (plainEdit?.ok === false) {
            if (isMessageNotModified(plainEdit)) {
                return { ...plainEdit, ok: true };
            }
            return await sendMessage(chatId, safeText);
        }

        return plainEdit;
    } catch (e) {
        console.warn(`Telegram plain editMessageText failed: ${e.message}`);
        return await sendMessage(chatId, safeText);
    }
};

const sendButtons = async (chatId, text, buttons) => {
    const keyboard = {
        inline_keyboard: buttons.map(row =>
            row.map(btn => ({ text: btn.text, callback_data: btn.data }))
        )
    };

    const markdownPayload = {
        chat_id: chatId,
        text: truncateForTelegram(text),
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: keyboard
    };

    try {
        const result = await apiCall('sendMessage', markdownPayload);
        if (result?.ok !== false) {
            return result;
        }
        if (!isMarkdownParseError(result)) {
            console.warn(`Telegram sendButtons failed: ${result?.description || 'unknown error'}`);
            return result;
        }
    } catch (e) {
        console.warn(`Telegram sendButtons request error: ${e.message}`);
    }

    return await apiCall('sendMessage', {
        chat_id: chatId,
        text: truncateForTelegram(stripMarkdown(text)),
        disable_web_page_preview: true,
        reply_markup: keyboard
    });
};

// ═══════════════════════════════════════════
// SESSION MANAGEMENT - With Auto-Cleanup
// ═══════════════════════════════════════════

const getSession = (chatId) => sessionManager.get(chatId);
const resetSession = (chatId) => sessionManager.reset(chatId);

const isAuthorized = (chatId) => {
    if (ADMIN_CHAT_IDS.length === 0) return true;
    return ADMIN_CHAT_IDS.includes(String(chatId));
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

const getReadyStatus = (token) => {
    const missing = [];
    return {
        ready: missing.length === 0,
        missing,
        hasContext: !!token.context?.messageId,
        hasImage: !!token.image
    };
};

const UI_ACTIONS = {
    MENU: 'm_menu',
    WIZARD: 'm_wizard',
    SETTINGS: 'm_settings',
    FALLBACK: 'm_fallback',
    SET_NAME: 'm_name',
    SET_SYMBOL: 'm_symbol',
    SET_FEES: 'm_fees',
    FEE_PRESET_6: 'm_fee_6',
    FEE_PRESET_5: 'm_fee_5',
    SET_CONTEXT: 'm_context',
    SET_IMAGE: 'm_image',
    SET_SPOOF: 'm_spoof',
    STATUS: 'm_status',
    HEALTH: 'm_health',
    DEPLOY: 'm_deploy',
    CANCEL: 'm_cancel',
    HELP: 'm_help',
    WIZ_FEE_6: 'w_fee_6',
    WIZ_FEE_5: 'w_fee_5',
    WIZ_SKIP_IMAGE: 'w_skip_img',
    WIZ_SKIP_CONTEXT: 'w_skip_ctx',
    FB_AUTOFILL: 'fb_autofill',
    FB_CLEAR_IMAGE: 'fb_clear_img',
    FB_CLEAR_CONTEXT: 'fb_clear_ctx',
    FB_CLEAR_SOCIALS: 'fb_clear_socials'
};

const IMAGE_INPUT_STATES = new Set(['menu_image', 'wizard_image']);

const canAcceptImageInput = (session) => IMAGE_INPUT_STATES.has(String(session?.state || ''));

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

const getPanelButtons = (token, ready) => {
    const deployLabel = ready ? 'Deploy' : 'Validate';

    return [
        [{ text: deployLabel, data: UI_ACTIONS.DEPLOY }, { text: 'Wizard', data: UI_ACTIONS.WIZARD }],
        [{ text: 'Settings', data: UI_ACTIONS.SETTINGS }, { text: 'Status', data: UI_ACTIONS.STATUS }],
        [{ text: 'Health', data: UI_ACTIONS.HEALTH }, { text: 'Cancel', data: UI_ACTIONS.CANCEL }]
    ];
};

const getSettingsButtons = (token) => {
    const spoofLabel = token?.spoofTo ? 'Spoof: On' : 'Spoof: Off';
    return [
        [{ text: 'Name', data: UI_ACTIONS.SET_NAME }, { text: 'Symbol', data: UI_ACTIONS.SET_SYMBOL }],
        [{ text: 'Fees', data: UI_ACTIONS.SET_FEES }, { text: 'Context', data: UI_ACTIONS.SET_CONTEXT }],
        [{ text: 'Image', data: UI_ACTIONS.SET_IMAGE }, { text: spoofLabel, data: UI_ACTIONS.SET_SPOOF }],
        [{ text: 'Fallback', data: UI_ACTIONS.FALLBACK }, { text: 'Main Panel', data: UI_ACTIONS.MENU }]
    ];
};

const getFallbackButtons = () => [
    [{ text: 'Auto-fill Missing', data: UI_ACTIONS.FB_AUTOFILL }, { text: 'Clear Image', data: UI_ACTIONS.FB_CLEAR_IMAGE }],
    [{ text: 'Clear Context', data: UI_ACTIONS.FB_CLEAR_CONTEXT }, { text: 'Clear Socials', data: UI_ACTIONS.FB_CLEAR_SOCIALS }],
    [{ text: 'Reset Session', data: UI_ACTIONS.CANCEL }, { text: 'Settings', data: UI_ACTIONS.SETTINGS }]
];

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

const renderFieldValue = (value, notSet = '_not set_') => {
    if (value === undefined || value === null) return notSet;
    const raw = String(value);
    if (raw.length === 0) return '`(empty)`';
    if (!raw.trim()) return '`(spaces)`';
    return raw;
};

const formatSessionPanel = (session, title = '*Session Panel*') => {
    const t = session.token;
    const status = getReadyStatus(t);
    const totalFee = Number(t?.fees?.clankerFee || 0) + Number(t?.fees?.pairedFee || 0);
    const imageStatus = t.image ? 'Set' : 'Not set';
    const contextStatus = t.context?.messageId
        ? `${String(t.context.platform || 'unknown').toUpperCase()}`
        : 'Not set';
    const socialCount = Object.keys(t.socials || {}).length;
    const spoofStatus = t.spoofTo ? `ON (${t.spoofTo.slice(0, 8)}...)` : 'OFF';

    return {
        text: `
${title}
━━━━━━━━━━━━━━━━━━━━━
*Name:* ${renderFieldValue(t.name)}
*Symbol:* ${renderFieldValue(t.symbol)}
*Fees:* ${(totalFee / 100).toFixed(2)}% (${t?.fees?.clankerFee || 0}/${t?.fees?.pairedFee || 0} bps)
*Context:* ${contextStatus}
*Image:* ${imageStatus}
*Socials:* ${socialCount}
*Spoof:* ${spoofStatus}

${status.ready ? 'Ready to deploy' : 'Configure fields using buttons below'}
`.trim(),
        buttons: getPanelButtons(t, status.ready)
    };
};

const showControlPanel = async (chatId, session, title) => {
    const panel = formatSessionPanel(session, title);
    return await sendButtons(chatId, panel.text, panel.buttons);
};

const showSettingsPanel = async (chatId, session, title = '*Settings Panel*') => {
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
    return await sendButtons(chatId, `
*Fallback Tools*
━━━━━━━━━━━━━━━━━━━━━
Use these actions to auto-heal or clean the current config.
    `.trim(), getFallbackButtons());
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

Use */a* for button-first workflow.
Image uploads are accepted only from */a* -> *Settings* -> *Image*.

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
        const rpcCandidates = getStatusRpcCandidates();

        const [{ createPublicClient, http }, { base }] = await Promise.all([
            import('viem'),
            import('viem/chains')
        ]);

        const viemFactory = { createPublicClient, http, base };

        const [telegramChecks, rpcChecks] = await Promise.all([
            Promise.all(TELEGRAM_API_ORIGINS.map(origin => probeTelegramOrigin(origin))),
            Promise.all(rpcCandidates.map(rpcUrl => probeRpcEndpoint(rpcUrl, viemFactory)))
        ]);

        const activeTelegramOrigin = TELEGRAM_API_ORIGINS[activeTelegramOriginIndex] || TELEGRAM_API_ORIGINS[0];
        const healthyRpc = rpcChecks.find(item => item.ok);
        const ipfsProviders = [];
        if (ipfsStatus.nftStorage) ipfsProviders.push('NFT.Storage');
        if (ipfsStatus.pinata) ipfsProviders.push('Pinata');
        if (ipfsStatus.infura) ipfsProviders.push('Infura');

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
            `Session Cache: ${sessionManager.count()} active chat(s)`
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

const handleSpoof = async (chatId, address) => {
    const session = getSession(chatId);
    const target = String(address || '').trim();

    if (!target || SPOOF_DISABLE_KEYWORDS.has(target.toLowerCase())) {
        if (!session.token.spoofTo) {
            return await sendMessage(chatId, 'Spoof is already disabled.');
        }

        session.token.spoofTo = null;
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

    const status = getReadyStatus(session.token);

    if (!session.token.symbol && !session.token.name && String(args || '').trim()) {
        session.token.name = String(args || '');
    }

    // Use symbol as name if not provided
    if (!session.token.name && session.token.symbol) {
        session.token.name = session.token.symbol;
    }

    session.state = 'collecting';

    const totalFee = (session.token.fees.clankerFee + session.token.fees.pairedFee) / 100;
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
            await sendMessage(chatId, 'Fees set to *6.00%* (3% + 3%).');
            return await showSettingsPanel(chatId, session);

        case UI_ACTIONS.FEE_PRESET_5:
            session.token.fees = { clankerFee: 250, pairedFee: 250 };
            session.state = 'collecting';
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
        await sendMessage(chatId, `Name set: ${renderFieldValue(session.token.name, '`(empty)`')}`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_symbol') {
        session.token.symbol = String(text || '');
        if (!session.token.name) session.token.name = session.token.symbol;
        session.state = 'collecting';
        await sendMessage(chatId, `Symbol set: ${renderFieldValue(session.token.symbol, '`(empty)`')}`);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_fees') {
        const fees = parseFees(text);
        if (!fees) return await sendMessage(chatId, 'Invalid fee format. Try `6%`, `600bps`, or `3% 3%`.');
        session.token.fees = fees;
        session.state = 'collecting';
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
        await sendMessage(chatId, 'Image reference updated.');
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'menu_spoof') {
        const target = text.trim();
        if (SPOOF_DISABLE_KEYWORDS.has(target.toLowerCase())) {
            session.token.spoofTo = null;
            session.state = 'collecting';
            await sendMessage(chatId, 'Spoof disabled.');
            return await showSettingsPanel(chatId, session);
        }
        if (!isEthereumAddress(target)) {
            return await sendMessage(chatId, 'Invalid address. Send `0x...` or `off`.');
        }
        session.token.spoofTo = target;
        session.state = 'collecting';
        await sendMessage(chatId, `Spoof target set: \`${target}\``);
        return await showSettingsPanel(chatId, session);
    }

    if (session.state === 'wizard_image') {
        if (lowerText === '/skip' || lowerText === 'skip') {
            session.state = 'wizard_context';
            return await sendWizardContextPrompt(chatId);
        }

        const trimmed = text.trim();
        if (isIPFSCid(trimmed)) {
            session.token.image = trimmed.replace('ipfs://', '');
            session.state = 'wizard_context';
            await sendMessage(chatId, 'Image set.');
            return await sendWizardContextPrompt(chatId);
        }
        if (/^https?:\/\//i.test(trimmed)) {
            session.token.image = trimmed;
            session.state = 'wizard_context';
            await sendMessage(chatId, 'Image URL set.');
            return await sendWizardContextPrompt(chatId);
        }

        return await sendMessage(chatId, 'Send image as photo, HTTPS URL, or IPFS CID. Use /skip to continue.');
    }

    if (session.state === 'wizard_context' && (lowerText === '/skip' || lowerText === 'skip')) {
        session.state = 'collecting';
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
• \`NFT_STORAGE_TOKEN=...\` (FREE at nft.storage)
• \`PINATA_API_KEY=...\` + \`PINATA_SECRET_KEY=...\`
• \`INFURA_PROJECT_ID=...\`

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
        const prompts = [];
        if (!status.hasImage) prompts.push('(Optional) set token *image*');
        if (!status.hasContext) prompts.push('(Recommended) set *source link* context');

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
        const { id, data, message } = update.callback_query;
        await apiCall('answerCallbackQuery', { callback_query_id: id }).catch(() => { });
        const chatId = message?.chat?.id;
        if (!chatId) return;

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
    const username = message.from?.username;

    // Authorization check
    if (!isAuthorized(chatId)) {
        return await sendMessage(chatId, `⛔ Unauthorized.\n\nYour ID: \`${chatId}\`\nAsk admin to add you.`);
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

    acquireBotLock();
    console.log(`🔒 Instance lock: ${BOT_LOCK_FILE}`);

    // Verify bot
    const me = await apiCall('getMe');
    if (!me.ok) {
        console.error(`❌ Invalid bot token (${me.description || 'unknown error'})`);
        releaseBotLock();
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

    let ipfsProviders = [];
    if (ipfsStatus.nftStorage) ipfsProviders.push('NFT.Storage');
    if (ipfsStatus.pinata) ipfsProviders.push('Pinata');
    if (ipfsStatus.infura) ipfsProviders.push('Infura');

    console.log(`✅ Bot: @${me.result.username}`);
    console.log(`${pkCheck.valid ? '✅' : '❌'} Wallet: ${pkCheck.valid ? 'Ready' : pkCheck.error}`);
    console.log(`${ipfsStatus.any ? '✅' : '⚠️'} IPFS: ${ipfsProviders.length > 0 ? ipfsProviders.join(', ') : 'Not configured'}`);
    console.log(`📍 Admins: ${ADMIN_CHAT_IDS.length > 0 ? ADMIN_CHAT_IDS.join(', ') : 'All allowed'}`);
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
    releaseBotLock();
    process.exit(0);
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start Main
main().catch(err => {
    console.error('❌ Fatal Startup Error:', err);
    releaseBotLock();
    const code = isPermanentStartupError(err?.message) ? FATAL_CONFIG_EXIT_CODE : 1;
    process.exit(code);
});
