#!/usr/bin/env node
/**
 * 🤖 Clank & Claw Telegram Bot v2.5
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
import { processImageInput, isIPFSCid, getProviderStatus } from './lib/ipfs.js';
import { parseTokenCommand, parseFees } from './lib/parser.js';
import { parseSmartSocialInput } from './lib/social-parser.js';
import { loadConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import { deployToken } from './clanker-core.js';

// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
const DEFAULT_FEES = { clankerFee: 100, pairedFee: 100 }; // 2% default
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Session storage with auto-cleanup
const sessions = new Map();

// ═══════════════════════════════════════════
// TELEGRAM API - Robust Implementation
// ═══════════════════════════════════════════

const apiCall = async (method, data = {}, retries = 3) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await new Promise((resolve, reject) => {
                const body = JSON.stringify(data);
                const req = https.request(`${API_BASE}/${method}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(body)
                    },
                    timeout: 30000
                }, (res) => {
                    let responseData = '';
                    res.on('data', chunk => responseData += chunk);
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(responseData));
                        } catch (e) {
                            resolve({ ok: false, error: responseData });
                        }
                    });
                });

                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
                req.write(body);
                req.end();
            });
        } catch (error) {
            if (attempt === retries) throw error;
            await sleep(1000 * attempt);
        }
    }
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const sendMessage = async (chatId, text, options = {}) => {
    // Escape special markdown chars in user content
    const safeText = text.replace(/([_*\[\]()~`>#+=|{}.!-])/g, '\\$1');
    try {
        return await apiCall('sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            ...options
        });
    } catch (e) {
        // Fallback without markdown if it fails
        return await apiCall('sendMessage', {
            chat_id: chatId,
            text: text.replace(/[*_`\[\]]/g, ''),
            ...options
        });
    }
};

const sendTyping = (chatId) => apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { });

const getFile = async (fileId) => {
    try {
        const result = await apiCall('getFile', { file_id: fileId });
        if (result.ok && result.result.file_path) {
            return `https://api.telegram.org/file/bot${BOT_TOKEN}/${result.result.file_path}`;
        }
    } catch (e) { }
    return null;
};

const editMessage = async (chatId, messageId, text) => {
    try {
        await apiCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'Markdown'
        });
    } catch (e) { }
};

const sendButtons = async (chatId, text, buttons) => {
    return await apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: buttons.map(row =>
                row.map(btn => ({ text: btn.text, callback_data: btn.data }))
            )
        }
    });
};

// ═══════════════════════════════════════════
// SESSION MANAGEMENT - With Auto-Cleanup
// ═══════════════════════════════════════════

const createSession = () => ({
    state: 'idle',
    createdAt: Date.now(),
    token: {
        name: null,
        symbol: null,
        image: null,
        description: null,
        fees: { ...DEFAULT_FEES },
        context: null,
        admin: null,
        spoofTo: null
    },
    pendingMessageId: null
});

const getSession = (chatId) => {
    let session = sessions.get(chatId);

    // Check timeout
    if (session && (Date.now() - session.createdAt > SESSION_TIMEOUT_MS)) {
        sessions.delete(chatId);
        session = null;
    }

    if (!session) {
        session = createSession();
        sessions.set(chatId, session);
    }

    return session;
};

const resetSession = (chatId) => sessions.delete(chatId);

const isAuthorized = (chatId) => {
    if (ADMIN_CHAT_IDS.length === 0) return true;
    return ADMIN_CHAT_IDS.includes(String(chatId));
};

// ═══════════════════════════════════════════
// VALIDATION HELPERS
// ═══════════════════════════════════════════

const validatePrivateKey = () => {
    const pk = process.env.PRIVATE_KEY;
    if (!pk) return { valid: false, error: 'PRIVATE_KEY not configured' };
    if (pk.length < 64) return { valid: false, error: 'PRIVATE_KEY invalid' };
    return { valid: true };
};

const getReadyStatus = (token) => {
    const missing = [];
    if (!token.name) missing.push('name');
    if (!token.symbol) missing.push('symbol');
    if (!token.image) missing.push('image');
    if (!token.context?.messageId) missing.push('context');
    return {
        ready: missing.length === 0,
        missing,
        hasContext: !!token.context?.messageId
    };
};

// ═══════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════

const handleStart = async (chatId, username) => {
    const pkCheck = validatePrivateKey();
    const ipfsStatus = getProviderStatus();

    const statusEmoji = pkCheck.valid ? '✅' : '❌';
    const ipfsEmoji = ipfsStatus.any ? '✅' : '⚠️';

    let ipfsProviders = [];
    if (ipfsStatus.nftStorage) ipfsProviders.push('NFT.Storage');
    if (ipfsStatus.pinata) ipfsProviders.push('Pinata');
    if (ipfsStatus.infura) ipfsProviders.push('Infura');

    await sendMessage(chatId, `
🐾 *Clank & Claw Token Deployer*
━━━━━━━━━━━━━━━━━━━━━

Welcome @${username || 'agent'}! Deploy tokens on Base with ease.

*System Status:*
${statusEmoji} Wallet: ${pkCheck.valid ? 'Ready' : pkCheck.error}
${ipfsEmoji} IPFS: ${ipfsProviders.length > 0 ? ipfsProviders.join(', ') : 'Not configured'}

*Quick Commands:*
• \`/go PEPE "Pepe Token" 10%\` → Fast deploy
• \`/deploy\` → Step-by-step wizard
• \`/status\` → Wallet balance
• \`/config\` → Current settings

*Or just describe your token:*
_"Deploy TOKEN (Name) with 5% fees"_
Then send image + tweet link!
    `.trim());
};

const handleHelp = async (chatId) => {
    await sendMessage(chatId, `
📖 *Complete Guide*
━━━━━━━━━━━━━━━━━━━━━

*🚀 Fastest Method:*
\`/go SYMBOL "Name" FEES\`
Example: \`/go DOGE "Moon Doge" 10%\`

*📝 Step-by-Step:*
1. \`/deploy\` → Start wizard
2. Enter name → Enter symbol → Set fees
3. Send image (auto IPFS upload)
4. Send tweet link → Confirm → Done!

*💬 Natural Language:*
Just type: _"Launch PEPE (Pepe Token) 5%"_
Bot auto-detects name, symbol, fees!

*🎭 Spoofing Mode:*
\`/spoof 0xRecipientAddress\`
Rewards go to stealth wallet.

*💰 Fee Formats:*
\`10%\` → 5%+5% split
\`5% 5%\` → Explicit split  
\`500bps\` → 500 basis points
\`500\` → Total bps

*📸 Images:*
Send any image → Auto IPFS upload
Or paste IPFS CID: \`bafkrei...\`

*🔗 Context Links:*
\`https://x.com/user/status/123\`
\`https://warpcast.com/user/0xabc\`

*⚙️ Commands:*
\`/go\` - Fast deploy
\`/deploy\` - Wizard mode
\`/status\` - Wallet info
\`/config\` - View config
\`/spoof\` - Set stealth address
\`/cancel\` - Reset session
    `.trim());
};

const handleStatus = async (chatId) => {
    await sendTyping(chatId);

    try {
        const pkCheck = validatePrivateKey();
        if (!pkCheck.valid) {
            return await sendMessage(chatId, `❌ ${pkCheck.error}`);
        }

        const { createPublicClient, http, formatEther } = await import('viem');
        const { base } = await import('viem/chains');
        const { privateKeyToAccount } = await import('viem/accounts');

        const pk = process.env.PRIVATE_KEY;
        const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
        const client = createPublicClient({ chain: base, transport: http() });
        const balance = await client.getBalance({ address: account.address });
        const eth = parseFloat(formatEther(balance));

        const balanceEmoji = eth > 0.1 ? '🟢' : eth > 0.01 ? '🟡' : '🔴';
        const balanceWarning = eth < 0.01 ? '\n⚠️ _Low balance for deployment!_' : '';

        await sendMessage(chatId, `
💰 *Wallet Status*
━━━━━━━━━━━━━━━━━━━━━

📍 Address: \`${account.address}\`
${balanceEmoji} Balance: *${eth.toFixed(4)} ETH*
🔗 Network: Base Mainnet
${balanceWarning}
        `.trim());
    } catch (error) {
        await sendMessage(chatId, `❌ Error: ${error.message}`);
    }
};

const handleConfig = async (chatId) => {
    const session = getSession(chatId);
    const t = session.token;
    const status = getReadyStatus(t);

    await sendMessage(chatId, `
⚙️ *Current Session Config*
━━━━━━━━━━━━━━━━━━━━━

${t.name ? `✅ Name: *${t.name}*` : '⬜ Name: _not set_'}
${t.symbol ? `✅ Symbol: *${t.symbol}*` : '⬜ Symbol: _not set_'}
${t.image ? `✅ Image: \`${t.image.substring(0, 20)}...\`` : '⬜ Image: _not set_'}
${t.context ? `✅ Context: *${t.context.platform}*` : '⬜ Context: _optional_'}
💰 Fees: *${(t.fees.clankerFee + t.fees.pairedFee) / 100}%*
${t.spoofTo ? `🎭 Spoof: \`${t.spoofTo.substring(0, 10)}...\`` : ''}

${status.ready ? '✅ *Ready to deploy!* Type \`/confirm\`' : `⏳ Missing: ${status.missing.join(', ')}`}
    `.trim());
};

const handleSpoof = async (chatId, address) => {
    const session = getSession(chatId);

    if (!address || !address.startsWith('0x') || address.length !== 42) {
        return await sendMessage(chatId, `
🎭 *Spoofing Mode*
━━━━━━━━━━━━━━━━━━━━━

Redirect all rewards to a stealth wallet.

*Usage:* \`/spoof 0xYourStealthAddress\`

Current: ${session.token.spoofTo ? `\`${session.token.spoofTo}\`` : '_None_'}
        `.trim());
    }

    session.token.spoofTo = address;
    await sendMessage(chatId, `
🎭 *Stealth Mode Activated*

All rewards will be sent to:
\`${address}\`

This address will NOT appear as token admin.
    `.trim());
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

    if (!session.token.symbol) {
        return await sendMessage(chatId, `
❌ *Could not parse symbol*

*Format:* \`/go SYMBOL "Name" FEES\`
*Example:* \`/go PEPE "Pepe Token" 10%\`

Tips:
• Symbol must be UPPERCASE
• Name in quotes or parentheses
• Fees: 10%, 500bps, or 5% 5%
        `.trim());
    }

    // Use symbol as name if not provided
    if (!session.token.name) {
        session.token.name = session.token.symbol;
    }

    session.state = 'collecting';

    const totalFee = (session.token.fees.clankerFee + session.token.fees.pairedFee) / 100;

    await sendMessage(chatId, `
✅ *Token Configured*
━━━━━━━━━━━━━━━━━━━━━

📛 *${session.token.name}* (${session.token.symbol})
💰 Fees: *${totalFee}%*
${session.token.context ? `🔗 Context: ${session.token.context.platform}` : ''}
${session.token.spoofTo ? `🎭 Spoof: Active` : ''}

*Next Steps:*
${!session.token.image ? '1️⃣ Send token *image*' : ''}
${!session.token.context ? '2️⃣ Send *tweet/cast link*' : ''}
${status.ready ? '\n✅ Ready! Type \`yes\` to deploy' : ''}
    `.trim());

    if (status.ready) {
        session.state = 'confirming';
    }
};

const handleDeploy = async (chatId) => {
    const session = getSession(chatId);
    session.state = 'wizard_name';
    session.token = { ...createSession().token };
    session.createdAt = Date.now();

    await sendMessage(chatId, `
🚀 *Token Deployment Wizard*
━━━━━━━━━━━━━━━━━━━━━

*Step 1/4: Token Name*
What should the token be called?

_Example: Pepe Token_

(Type /cancel to abort)
    `.trim());
};

const handleCancel = async (chatId) => {
    resetSession(chatId);
    await sendMessage(chatId, '❌ Session cancelled. Start fresh with /go or /deploy');
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
            return await sendMessage(chatId, '❌ Cancelled.');
        }
    }

    // Check for URL first (works in any state)
    // Check for social links (works in any state)
    const { context, socials } = parseSmartSocialInput(text);

    if (context || Object.keys(socials).length > 0) {
        if (context) {
            session.token.context = context;
            await sendMessage(chatId, `✅ Context: *${context.platform}* (${context.messageId})`);
        }

        if (Object.keys(socials).length > 0) {
            session.token.socials = { ...session.token.socials, ...socials };
            const socialList = Object.entries(socials)
                .map(([p, u]) => `• ${p}: ${u}`)
                .join('\n');
            await sendMessage(chatId, `✅ Socials added:\n${socialList}`);
        }

        if (!context && Object.keys(socials).length > 0 && !session.token.context) {
            await sendMessage(chatId, `⚠️ Saved socials, but still need a *Context Link* (Tweet/Cast)!`);
        }

        return await checkAndPrompt(chatId, session);
    }

    // Check for IPFS CID
    if (isIPFSCid(text)) {
        session.token.image = text.replace('ipfs://', '');
        await sendMessage(chatId, `✅ Image CID set: \`${session.token.image.substring(0, 20)}...\``);
        return await checkAndPrompt(chatId, session);
    }

    // Wizard state machine
    switch (session.state) {
        case 'wizard_name':
            session.token.name = text.trim();
            session.state = 'wizard_symbol';
            return await sendMessage(chatId, `
✅ Name: *${session.token.name}*

*Step 2/4: Symbol*
What's the ticker? (e.g., PEPE)
            `.trim());

        case 'wizard_symbol':
            session.token.symbol = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            if (!session.token.symbol) {
                return await sendMessage(chatId, '❌ Invalid symbol. Use letters only.');
            }
            session.state = 'wizard_fees';
            return await sendMessage(chatId, `
✅ Symbol: *${session.token.symbol}*

*Step 3/4: Fees*
Enter total fee % (or /skip for 2%)

_Examples: 10%, 500bps, 5% 5%_
            `.trim());

        case 'wizard_fees':
            if (lowerText === '/skip' || lowerText === 'skip') {
                session.token.fees = { ...DEFAULT_FEES };
            } else {
                const fees = parseFees(text);
                if (!fees) {
                    return await sendMessage(chatId, '❌ Invalid. Try: `10%`, `500bps`, or `5% 5%`');
                }
                session.token.fees = fees;
            }
            session.state = 'collecting';
            return await sendMessage(chatId, `
✅ Fees: *${(session.token.fees.clankerFee + session.token.fees.pairedFee) / 100}%*

*Step 4/4: Image & Context*
Now send:
1️⃣ Token *image* (will upload to IPFS)
2️⃣ *Tweet/cast link* for indexing
            `.trim());

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

                const totalFee = (session.token.fees?.clankerFee + session.token.fees?.pairedFee) / 100 || 2;

                await sendMessage(chatId, `
🎯 *Detected:* ${session.token.symbol} "${session.token.name || session.token.symbol}"
💰 Fees: ${totalFee}%

Send image + context link to continue.
                `.trim());
                return;
            }

            // Unknown input
            return await sendMessage(chatId, `
💡 Try:
• \`/go SYMBOL "Name" 10%\` - Quick deploy
• \`/deploy\` - Step-by-step wizard
• \`/help\` - Full guide
            `.trim());

        default:
            return await checkAndPrompt(chatId, session);
    }
};

const processPhoto = async (chatId, photo, session) => {
    await sendTyping(chatId);

    // Check IPFS config
    const ipfsStatus = getProviderStatus();
    if (!ipfsStatus.any) {
        return await sendMessage(chatId, `
❌ *IPFS not configured*

Add one of these to .env:
• \`NFT_STORAGE_TOKEN=...\` (FREE at nft.storage)
• \`PINATA_API_KEY=...\` + \`PINATA_SECRET_KEY=...\`
• \`INFURA_PROJECT_ID=...\`

Or paste an existing IPFS CID.
        `.trim());
    }

    const statusMsg = await sendMessage(chatId, '📤 Uploading to IPFS...');

    // Get file URL
    const file = photo[photo.length - 1];
    const fileUrl = await getFile(file.file_id);

    if (!fileUrl) {
        return await editMessage(chatId, statusMsg?.result?.message_id, '❌ Could not download image. Try again.');
    }

    // Upload to IPFS
    const result = await processImageInput(fileUrl);

    if (!result.success) {
        return await editMessage(chatId, statusMsg?.result?.message_id, `❌ Upload failed: ${result.error}`);
    }

    session.token.image = result.cid;

    await editMessage(chatId, statusMsg?.result?.message_id, `✅ *Image uploaded!*\nCID: \`${result.cid}\``);

    // Set default fees if not set
    if (!session.token.fees) {
        session.token.fees = { ...DEFAULT_FEES };
    }

    await checkAndPrompt(chatId, session);
};

const checkAndPrompt = async (chatId, session) => {
    const status = getReadyStatus(session.token);

    if (status.ready) {
        session.state = 'confirming';
        const t = session.token;
        const totalFee = (t.fees.clankerFee + t.fees.pairedFee) / 100;

        await sendMessage(chatId, `
🚀 *READY TO DEPLOY*
━━━━━━━━━━━━━━━━━━━━━

📛 *${t.name}* (${t.symbol})
🖼️ Image: \`${t.image?.substring(0, 15)}...\`
💰 Fees: *${totalFee}%* (${t.fees.clankerFee}+${t.fees.pairedFee} bps)
🔗 Context: ${t.context?.platform || 'none'} ${t.context?.messageId ? '✓' : ''}
${t.spoofTo ? `🎭 Spoof: \`${t.spoofTo.substring(0, 10)}...\`` : ''}

Type *yes* to deploy or *no* to cancel
        `.trim());
    } else if (status.missing.length > 0) {
        const prompts = [];
        if (status.missing.includes('image')) prompts.push('📷 Send token *image*');
        if (!status.hasContext) prompts.push('🔗 Send *tweet/cast* (can include website/telegram links too)');
        if (status.missing.includes('name')) prompts.push('📝 Need token *name*');
        if (status.missing.includes('symbol')) prompts.push('🏷️ Need token *symbol*');

        if (prompts.length > 0) {
            await sendMessage(chatId, `*Next:* ${prompts.join(' or ')}`);
        }
    }
};

// ═══════════════════════════════════════════
// DEPLOYMENT EXECUTION
// ═══════════════════════════════════════════

const executeDeploy = async (chatId, session) => {
    await sendTyping(chatId);

    // Final validation
    const pkCheck = validatePrivateKey();
    if (!pkCheck.valid) {
        return await sendMessage(chatId, `❌ ${pkCheck.error}\n\nCannot deploy without wallet.`);
    }

    const t = session.token;
    const status = getReadyStatus(t);
    if (!status.ready) {
        return await sendMessage(chatId, `❌ Missing: ${status.missing.join(', ')}`);
    }

    const statusMsg = await sendMessage(chatId, '⏳ *Deploying token...*\nThis may take 30-60 seconds.');

    try {
        // Set environment for deployment
        process.env.TOKEN_NAME = t.name;
        process.env.TOKEN_SYMBOL = t.symbol;
        process.env.TOKEN_IMAGE = t.image;
        process.env.METADATA_DESCRIPTION = t.description || `${t.name} - Deployed via Clank & Claw`;
        process.env.CONTEXT_PLATFORM = t.context?.platform || 'twitter';
        process.env.CONTEXT_MESSAGE_ID = t.context?.messageId || '';
        process.env.FEE_TYPE = 'static';
        process.env.FEE_CLANKER_BPS = String(t.fees.clankerFee);
        process.env.FEE_PAIRED_BPS = String(t.fees.pairedFee);
        process.env.STRICT_MODE = 'false';
        process.env.VANITY = 'true';

        // Apply spoofing if set
        // SPOOFING LOGIC:
        // - Our wallet → REWARD_CREATOR (99.9% fees)
        // - Spoof target → REWARD_INTERFACE (0.1% fees, appears as deployer)
        if (t.spoofTo) {
            const { createPublicClient, http } = await import('viem');
            const { base } = await import('viem/chains');
            const { privateKeyToAccount } = await import('viem/accounts');

            const pk = process.env.PRIVATE_KEY;
            const ourWallet = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`).address;

            process.env.REWARD_CREATOR = ourWallet;
            process.env.REWARD_INTERFACE = t.spoofTo;
            process.env.REWARD_CREATOR_ADMIN = ourWallet;
            process.env.REWARD_INTERFACE_ADMIN = t.spoofTo;
            process.env.TOKEN_ADMIN = t.spoofTo;
        }

        // Apply socials
        if (t.socials) {
            Object.entries(t.socials).forEach(([platform, url]) => {
                const key = `SOCIAL_${platform.toUpperCase()}`;
                process.env[key] = url;
            });
        }

        // Load and validate config
        let config = loadConfig();
        config = validateConfig(config);

        // Deploy
        const result = await deployToken(config);

        if (result.success) {
            const successMsg = `
🎉 *DEPLOYED SUCCESSFULLY!*
━━━━━━━━━━━━━━━━━━━━━

📛 *${t.name}* (${t.symbol})
📍 Address: \`${result.address}\`
🔗 [View on Basescan](${result.scanUrl})

💰 TX: \`${result.txHash?.substring(0, 20)}...\`

Your token is now live on Base!
${t.spoofTo ? '\n🎭 Rewards routed to stealth address.' : ''}
            `.trim();

            await editMessage(chatId, statusMsg?.result?.message_id, successMsg);
        } else {
            const errorMsg = typeof result.error === 'string'
                ? result.error
                : JSON.stringify(result.error, null, 2);
            await editMessage(chatId, statusMsg?.result?.message_id, `❌ *Deployment Failed*\n\n\`${errorMsg}\``);
        }

    } catch (error) {
        await editMessage(chatId, statusMsg?.result?.message_id, `❌ *Error:* ${error.message}`);
    }

    resetSession(chatId);
};

// ═══════════════════════════════════════════
// UPDATE HANDLER - Main Router
// ═══════════════════════════════════════════

const handleUpdate = async (update) => {
    // Handle callback queries (button presses)
    if (update.callback_query) {
        const { id, data, message } = update.callback_query;
        const chatId = message.chat.id;
        await apiCall('answerCallbackQuery', { callback_query_id: id });

        if (data === 'confirm_deploy') {
            const session = getSession(chatId);
            session.state = 'confirming';
            return await processMessage(chatId, 'yes', session);
        }
        if (data === 'cancel_deploy') {
            return await handleCancel(chatId);
        }
        return;
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
            case '/status': return handleStatus(chatId);
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
        return processPhoto(chatId, message.photo, session);
    }

    // Handle documents (images as files)
    if (message.document?.mime_type?.startsWith('image/')) {
        const fileUrl = await getFile(message.document.file_id);
        if (fileUrl) {
            return processPhoto(chatId, [{ file_id: message.document.file_id }], session);
        }
    }
};

// ═══════════════════════════════════════════
// POLLING LOOP - Robust Implementation
// ═══════════════════════════════════════════

let lastUpdateId = 0;
let consecutiveErrors = 0;

const poll = async () => {
    try {
        const result = await apiCall('getUpdates', {
            offset: lastUpdateId + 1,
            timeout: 30,
            allowed_updates: ['message', 'callback_query']
        });

        if (result.ok && result.result?.length > 0) {
            consecutiveErrors = 0;
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
        consecutiveErrors++;
        console.error(`Poll error (${consecutiveErrors}):`, error.message);

        // Exponential backoff
        const delay = Math.min(5000 * Math.pow(2, consecutiveErrors - 1), 60000);
        await sleep(delay);
    }

    setImmediate(poll);
};

// ═══════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════

const main = async () => {
    console.log('');
    console.log('🐾 Clank & Claw Telegram Bot v2.5');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN not set');
        process.exit(1);
    }

    // Verify bot
    const me = await apiCall('getMe');
    if (!me.ok) {
        console.error('❌ Invalid bot token');
        process.exit(1);
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
    console.log('');
    console.log('🔄 Polling for updates...');
    console.log('');

    poll();
};

main().catch(console.error);
