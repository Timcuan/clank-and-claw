#!/usr/bin/env node
/**
 * 🤖 Clank & Claw Telegram Bot
 * 
 * Deploy tokens directly from Telegram chat.
 * 
 * Features:
 * - Send image → auto upload to IPFS
 * - Send link → auto parse for context
 * - Natural language commands
 * - Inline confirmation before deploy
 * 
 * Commands:
 *   /deploy - Start deployment wizard
 *   /quick SYMBOL "Name" 10% - Quick deploy
 *   /status - Check wallet status
 *   /help - Show help
 */

import 'dotenv/config';
import https from 'https';
import { processImageInput, isIPFSCid } from './lib/ipfs.js';
import { parseTokenCommand, parseSourceLink, parseFees } from './lib/parser.js';
import { loadConfig } from './lib/config.js';
import { validateConfig } from './lib/validator.js';
import { deployToken } from './clanker-core.js';

// ─────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_IDS = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory session storage
const sessions = new Map();

// ─────────────────────────────────────────
// Telegram API Helpers
// ─────────────────────────────────────────

const apiCall = (method, data = {}) => {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = https.request(`${API_BASE}/${method}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve(parsed);
                } catch (e) {
                    resolve({ ok: false, error: responseData });
                }
            });
        });

        req.on('error', reject);
        req.write(body);
        req.end();
    });
};

const sendMessage = (chatId, text, options = {}) => {
    return apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options
    });
};

const sendTyping = (chatId) => {
    return apiCall('sendChatAction', { chat_id: chatId, action: 'typing' });
};

const getFile = async (fileId) => {
    const result = await apiCall('getFile', { file_id: fileId });
    if (result.ok && result.result.file_path) {
        return `https://api.telegram.org/file/bot${BOT_TOKEN}/${result.result.file_path}`;
    }
    return null;
};

// ─────────────────────────────────────────
// Session Management
// ─────────────────────────────────────────

const getSession = (chatId) => {
    if (!sessions.has(chatId)) {
        sessions.set(chatId, {
            state: 'idle',
            token: {
                name: null,
                symbol: null,
                image: null,
                description: null,
                fees: null,
                context: null
            }
        });
    }
    return sessions.get(chatId);
};

const resetSession = (chatId) => {
    sessions.delete(chatId);
};

// ─────────────────────────────────────────
// Authorization
// ─────────────────────────────────────────

const isAuthorized = (chatId) => {
    if (ADMIN_CHAT_IDS.length === 0) return true; // No restriction if no admin IDs set
    return ADMIN_CHAT_IDS.includes(String(chatId));
};

// ─────────────────────────────────────────
// Command Handlers
// ─────────────────────────────────────────

const handleStart = async (chatId) => {
    await sendMessage(chatId, `
🐾 *Clank & Claw Token Deployer*

Deploy tokens on Base directly from Telegram!

*Commands:*
/deploy - Start deployment wizard
/quick SYMBOL "Name" 10% - Quick deploy
/status - Check wallet status
/help - Detailed help

*Quick Deploy Example:*
\`/quick PEPE "Pepe Token" 5%\`
Then send an image and a tweet link!
    `.trim());
};

const handleHelp = async (chatId) => {
    await sendMessage(chatId, `
📖 *Deployment Guide*

*Method 1: Wizard*
1. Type /deploy
2. Follow prompts for name, symbol, fees
3. Send token image (auto-uploads to IPFS)
4. Send tweet/cast link for indexing
5. Confirm and deploy!

*Method 2: Quick Deploy*
\`/quick SYMBOL "Name" FEES\`
Examples:
• \`/quick DOGE "Dogecoin 2.0" 10%\`
• \`/quick TEST "Test Token" 500bps\`

*Method 3: Natural Language*
Just describe your token:
_"Deploy PEPE (Pepe Token) with 5% fees"_
Then send image and link.

*Fees Format:*
• \`10%\` = 5% + 5% split
• \`5% 5%\` = explicit split
• \`500bps\` = 500 basis points
• \`250 250\` = bps split

*Images:*
Just send any image - it auto-uploads to IPFS!

*Context Links:*
Send a tweet or warpcast link for indexing:
• \`https://x.com/user/status/123\`
• \`https://warpcast.com/user/0xabc\`
    `.trim());
};

const handleStatus = async (chatId) => {
    try {
        const { createPublicClient, http, formatEther } = await import('viem');
        const { base } = await import('viem/chains');
        const { privateKeyToAccount } = await import('viem/accounts');

        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
            return sendMessage(chatId, '❌ PRIVATE_KEY not configured');
        }

        const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
        const client = createPublicClient({ chain: base, transport: http() });
        const balance = await client.getBalance({ address: account.address });

        await sendMessage(chatId, `
💰 *Wallet Status*

Address: \`${account.address}\`
Balance: ${formatEther(balance)} ETH
Network: Base Mainnet
        `.trim());
    } catch (error) {
        await sendMessage(chatId, `❌ Error: ${error.message}`);
    }
};

const handleDeploy = async (chatId) => {
    const session = getSession(chatId);
    session.state = 'awaiting_name';
    session.token = { name: null, symbol: null, image: null, description: null, fees: null, context: null };

    await sendMessage(chatId, `
🚀 *Token Deployment Wizard*

Step 1/5: *Token Name*
What's the name of your token?

Example: _Pepe Token_
    `.trim());
};

const handleQuickDeploy = async (chatId, args) => {
    const parsed = parseTokenCommand(args);
    const session = getSession(chatId);

    session.token = {
        name: parsed.name,
        symbol: parsed.symbol,
        image: null,
        description: parsed.description,
        fees: parsed.fees,
        context: parsed.context
    };

    const missing = [];
    if (!session.token.symbol) missing.push('symbol');
    if (!session.token.name) missing.push('name');

    if (missing.length > 0) {
        await sendMessage(chatId, `
❌ Could not parse: ${missing.join(', ')}

*Usage:* \`/quick SYMBOL "Name" FEES\`
Example: \`/quick PEPE "Pepe Token" 10%\`
        `.trim());
        return;
    }

    session.state = 'awaiting_image';

    let statusMsg = `
✅ *Parsed Token Config*

• Name: *${session.token.name}*
• Symbol: *${session.token.symbol}*
${session.token.fees ? `• Fees: ${session.token.fees.clankerFee + session.token.fees.pairedFee} bps (${(session.token.fees.clankerFee + session.token.fees.pairedFee) / 100}%)` : '• Fees: Default (2%)'}
${session.token.context ? `• Context: ${session.token.context.platform}` : ''}

Now send me:
1. 📷 *Token image* (will upload to IPFS)
${!session.token.context ? '2. 🔗 *Tweet or Warpcast link* for indexing' : ''}
    `.trim();

    await sendMessage(chatId, statusMsg);
};

const handleCancel = async (chatId) => {
    resetSession(chatId);
    await sendMessage(chatId, '❌ Deployment cancelled.');
};

// ─────────────────────────────────────────
// Message Handlers
// ─────────────────────────────────────────

const handleTextMessage = async (chatId, text, session) => {
    // Check for URLs first
    const parsed = parseSourceLink(text);
    if (parsed) {
        session.token.context = parsed;

        if (parsed.warning) {
            await sendMessage(chatId, `⚠️ ${parsed.warning}\n\nPlease send a specific tweet/cast URL.`);
            return;
        }

        await sendMessage(chatId, `✅ Context set: *${parsed.platform}*`);

        // Check if ready to deploy
        if (session.token.image && session.token.name && session.token.symbol) {
            return await showConfirmation(chatId, session);
        }
        return;
    }

    // Handle wizard states
    switch (session.state) {
        case 'awaiting_name':
            session.token.name = text.trim();
            session.state = 'awaiting_symbol';
            await sendMessage(chatId, `
✅ Name: *${session.token.name}*

Step 2/5: *Token Symbol*
What's the ticker symbol?

Example: _PEPE_
            `.trim());
            break;

        case 'awaiting_symbol':
            session.token.symbol = text.trim().toUpperCase();
            session.state = 'awaiting_fees';
            await sendMessage(chatId, `
✅ Symbol: *${session.token.symbol}*

Step 3/5: *Fees*
Enter total fees (or skip with /skip for default 2%)

Examples: \`10%\`, \`5% 5%\`, \`500bps\`
            `.trim());
            break;

        case 'awaiting_fees':
            if (text.toLowerCase() === '/skip') {
                session.token.fees = { clankerFee: 100, pairedFee: 100 };
            } else {
                const fees = parseFees(text);
                if (!fees) {
                    await sendMessage(chatId, '❌ Invalid fee format. Try: `10%`, `5% 5%`, or `500bps`');
                    return;
                }
                session.token.fees = fees;
            }
            session.state = 'awaiting_image';
            await sendMessage(chatId, `
✅ Fees: *${(session.token.fees.clankerFee + session.token.fees.pairedFee) / 100}%*

Step 4/5: *Token Image*
Send me an image for your token logo.
(Will be automatically uploaded to IPFS)
            `.trim());
            break;

        case 'awaiting_image':
            // Try to parse as IPFS CID
            if (isIPFSCid(text)) {
                session.token.image = text.replace('ipfs://', '');
                session.state = 'awaiting_context';
                await sendMessage(chatId, `
✅ Image CID: \`${session.token.image}\`

Step 5/5: *Context Link*
Send a tweet or warpcast link for indexing.

Example: \`https://x.com/user/status/123\`
                `.trim());
            } else {
                await sendMessage(chatId, '📷 Please send an *image file* or a valid IPFS CID.');
            }
            break;

        case 'awaiting_context':
            const contextParsed = parseSourceLink(text);
            if (!contextParsed) {
                await sendMessage(chatId, '❌ Invalid link. Send a tweet or warpcast URL.');
                return;
            }
            session.token.context = contextParsed;
            await showConfirmation(chatId, session);
            break;

        case 'awaiting_confirmation':
            const lower = text.toLowerCase();
            if (lower === 'yes' || lower === 'deploy' || lower === 'confirm' || lower === '/confirm') {
                await executeDeploy(chatId, session);
            } else if (lower === 'no' || lower === 'cancel' || lower === '/cancel') {
                resetSession(chatId);
                await sendMessage(chatId, '❌ Deployment cancelled.');
            } else {
                await sendMessage(chatId, 'Type *yes* to deploy or *no* to cancel.');
            }
            break;

        default:
            // Try natural language parsing
            const nlParsed = parseTokenCommand(text);
            if (nlParsed.symbol) {
                session.token.name = nlParsed.name;
                session.token.symbol = nlParsed.symbol;
                session.token.fees = nlParsed.fees;
                session.token.context = nlParsed.context;
                session.token.description = nlParsed.description;
                session.state = 'awaiting_image';

                await sendMessage(chatId, `
🎯 *Detected Token Config*

• Name: *${session.token.name || '(not set)'}*
• Symbol: *${session.token.symbol}*
${session.token.fees ? `• Fees: ${(session.token.fees.clankerFee + session.token.fees.pairedFee) / 100}%` : ''}
${session.token.context ? `• Context: ${session.token.context.platform}` : ''}

Now send me:
1. 📷 Token image
${!session.token.context ? '2. 🔗 Tweet/Warpcast link' : ''}
                `.trim());
            } else {
                await sendMessage(chatId, 'Use /help to see available commands.');
            }
    }
};

const handlePhoto = async (chatId, photo, session) => {
    await sendTyping(chatId);

    // Get highest resolution photo
    const file = photo[photo.length - 1];
    const fileUrl = await getFile(file.file_id);

    if (!fileUrl) {
        await sendMessage(chatId, '❌ Could not download image. Try again.');
        return;
    }

    await sendMessage(chatId, '📤 Uploading to IPFS...');

    const result = await processImageInput(fileUrl);

    if (!result.success) {
        await sendMessage(chatId, `❌ IPFS upload failed: ${result.error}`);
        return;
    }

    session.token.image = result.cid;

    if (!session.token.fees) {
        session.token.fees = { clankerFee: 100, pairedFee: 100 };
    }

    await sendMessage(chatId, `
✅ *Image uploaded to IPFS!*
CID: \`${result.cid}\`

${session.token.context ? '' : 'Now send a *tweet or warpcast link* for indexing.'}
    `.trim());

    if (session.token.name && session.token.symbol && session.token.context) {
        session.state = 'awaiting_context'; // Will trigger confirmation
        await showConfirmation(chatId, session);
    } else if (!session.token.context) {
        session.state = 'awaiting_context';
    } else if (!session.token.name) {
        session.state = 'awaiting_name';
        await sendMessage(chatId, 'What should the token be called?');
    }
};

const showConfirmation = async (chatId, session) => {
    session.state = 'awaiting_confirmation';
    const t = session.token;
    const totalFees = t.fees ? (t.fees.clankerFee + t.fees.pairedFee) : 200;

    await sendMessage(chatId, `
🚀 *Ready to Deploy!*

*Token:*
• Name: ${t.name}
• Symbol: ${t.symbol}
• Image: \`${t.image?.substring(0, 20)}...\`

*Fees:* ${totalFees / 100}% (${t.fees?.clankerFee || 100} + ${t.fees?.pairedFee || 100} bps)

*Context:*
• Platform: ${t.context?.platform || 'twitter'}
• Link: ${t.context?.messageId || 'Not set'}

Type *yes* to deploy or *no* to cancel.
    `.trim());
};

const executeDeploy = async (chatId, session) => {
    await sendTyping(chatId);
    await sendMessage(chatId, '⏳ Deploying token...');

    try {
        const t = session.token;

        // Set environment variables for deployment
        process.env.TOKEN_NAME = t.name;
        process.env.TOKEN_SYMBOL = t.symbol;
        process.env.TOKEN_IMAGE = t.image;
        process.env.METADATA_DESCRIPTION = t.description || `${t.name} - Deployed via Clank & Claw`;
        process.env.CONTEXT_PLATFORM = t.context?.platform || 'twitter';
        process.env.CONTEXT_MESSAGE_ID = t.context?.messageId || '';
        process.env.FEE_TYPE = 'static';
        process.env.FEE_CLANKER_BPS = String(t.fees?.clankerFee || 100);
        process.env.FEE_PAIRED_BPS = String(t.fees?.pairedFee || 100);
        process.env.STRICT_MODE = 'false';
        process.env.VANITY = 'true';

        let config = loadConfig();
        config = validateConfig(config);

        const result = await deployToken(config);

        if (result.success) {
            await sendMessage(chatId, `
🎉 *Token Deployed Successfully!*

📍 *Address:* \`${result.address}\`
🔗 *Basescan:* [View on Basescan](${result.scanUrl})
💰 *TX:* \`${result.txHash}\`

Your token is now live on Base!
            `.trim());
        } else {
            await sendMessage(chatId, `❌ *Deployment Failed*\n\n\`${JSON.stringify(result.error)}\``);
        }

    } catch (error) {
        await sendMessage(chatId, `❌ *Error:* ${error.message}`);
    }

    resetSession(chatId);
};

// ─────────────────────────────────────────
// Update Handler
// ─────────────────────────────────────────

const handleUpdate = async (update) => {
    const message = update.message;
    if (!message) return;

    const chatId = message.chat.id;

    // Authorization check
    if (!isAuthorized(chatId)) {
        await sendMessage(chatId, '⛔ Unauthorized. Contact admin to get access.');
        return;
    }

    const session = getSession(chatId);

    // Handle commands
    if (message.text) {
        const text = message.text.trim();

        if (text.startsWith('/start')) return handleStart(chatId);
        if (text.startsWith('/help')) return handleHelp(chatId);
        if (text.startsWith('/status')) return handleStatus(chatId);
        if (text.startsWith('/deploy')) return handleDeploy(chatId);
        if (text.startsWith('/cancel')) return handleCancel(chatId);
        if (text.startsWith('/confirm')) {
            session.state = 'awaiting_confirmation';
            return handleTextMessage(chatId, 'yes', session);
        }
        if (text.startsWith('/quick')) {
            const args = text.replace(/^\/quick\s*/i, '');
            return handleQuickDeploy(chatId, args);
        }

        return handleTextMessage(chatId, text, session);
    }

    // Handle photos
    if (message.photo) {
        return handlePhoto(chatId, message.photo, session);
    }

    // Handle documents (images sent as files)
    if (message.document && message.document.mime_type?.startsWith('image/')) {
        const fileUrl = await getFile(message.document.file_id);
        if (fileUrl) {
            // Treat as photo
            return handlePhoto(chatId, [{ file_id: message.document.file_id }], session);
        }
    }
};

// ─────────────────────────────────────────
// Polling Loop
// ─────────────────────────────────────────

let lastUpdateId = 0;

const poll = async () => {
    try {
        const result = await apiCall('getUpdates', {
            offset: lastUpdateId + 1,
            timeout: 30,
            allowed_updates: ['message']
        });

        if (result.ok && result.result.length > 0) {
            for (const update of result.result) {
                lastUpdateId = update.update_id;
                try {
                    await handleUpdate(update);
                } catch (error) {
                    console.error('Update error:', error);
                }
            }
        }
    } catch (error) {
        console.error('Poll error:', error.message);
        await new Promise(r => setTimeout(r, 5000));
    }

    // Continue polling
    setImmediate(poll);
};

// ─────────────────────────────────────────
// Startup
// ─────────────────────────────────────────

const main = async () => {
    if (!BOT_TOKEN) {
        console.error('❌ TELEGRAM_BOT_TOKEN not set in .env');
        process.exit(1);
    }

    console.log('🤖 Clank & Claw Telegram Bot starting...');

    // Verify bot token
    const me = await apiCall('getMe');
    if (!me.ok) {
        console.error('❌ Invalid bot token');
        process.exit(1);
    }

    console.log(`✅ Bot: @${me.result.username}`);
    console.log(`📍 Admin IDs: ${ADMIN_CHAT_IDS.length > 0 ? ADMIN_CHAT_IDS.join(', ') : 'All users allowed'}`);
    console.log('🔄 Polling for updates...\n');

    poll();
};

main().catch(console.error);
