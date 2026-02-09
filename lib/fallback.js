/**
 * 🧘 Smart Fallback Handler
 * 
 * intelligently guides the user when input is not understood
 */
export const handleFallback = async (chatId, text, session, { sendMessage, resetSession }) => {
    const lower = text.toLowerCase();

    // 1. Check for Reset Intent
    if (['reset', 'restart', 'start over', 'clear', 'stop'].some(w => lower.includes(w))) {
        resetSession(chatId);
        return await sendMessage(chatId, '🔄 Session reset. Ready for new deployment.');
    }

    // 2. Check for stuck wizard state
    if (session.state.startsWith('wizard_')) {
        const step = session.state.replace('wizard_', '');
        return await sendMessage(chatId, `
🤔 I didn't understand that for *${step}*.

• Type the value (e.g. "PEPE" or "10%")
• Or type \`/cancel\` to stop
        `.trim());
    }

    // 3. Check partial progress
    const t = session.token;
    const hasData = t.name || t.symbol || t.fees || t.image || t.context;

    if (hasData) {
        // We have some data, guide them to finish
        const missing = [];
        if (!t.name) missing.push('name');
        if (!t.symbol) missing.push('symbol');
        if (!t.image) missing.push('image');
        if (!t.context) missing.push('context link');

        return await sendMessage(chatId, `
📝 *Current Session:* ${t.symbol || 'New Token'}
        
❌ Missing: ${missing.join(', ')}

💡 *Tip:* You can send:
• Image file
• Tweet/Cast link
• "Name"
• "Symbol"
• "10%" (fees)

Or type \`/cancel\` to start over.
        `.trim());
    }

    // 4. Totally Idle - Suggest commands or natural language
    // Try to detect if they typed a token name/symbol
    const potentialSymbol = text.match(/^[A-Z0-9]{2,10}$/);
    if (potentialSymbol) {
        return await sendMessage(chatId, `
🤔 Did you mean to deploy *${potentialSymbol[0]}*?

Type: \`/go ${potentialSymbol[0]} "Name" 5%\`
Or start wizard: \`/deploy\`
        `.trim());
    }

    // Generic help
    return await sendMessage(chatId, `
👋 *I am your Deployment Agent.*

Here is how I can help:

⚡ *Fast:* \`/go PEPE "Pepe Token" 10%\`
📝 *Guided:* \`/deploy\`
🎭 *Stealth:* \`/spoof 0x...\`
❓ *Help:* \`/help\`

_Just send me a link, image, or describe your token!_
    `.trim());
};
