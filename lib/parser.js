/**
 * 🔗 Parser v2.0 - Smart extraction from natural language
 */

/**
 * Parse social media URL for Clanker context
 */
export const parseSourceLink = (url) => {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();

    // Twitter/X status
    const twitterMatch = trimmed.match(/(?:twitter\.com|x\.com)\/(\w+)\/status\/(\d+)/i);
    if (twitterMatch) {
        return {
            platform: 'twitter',
            messageId: trimmed,
            username: twitterMatch[1],
            statusId: twitterMatch[2]
        };
    }

    // Farcaster/Warpcast
    const warpcastMatch = trimmed.match(/warpcast\.com\/(\w+)\/(0x[a-fA-F0-9]+)/i);
    if (warpcastMatch) {
        return {
            platform: 'farcaster',
            messageId: trimmed,
            username: warpcastMatch[1],
            castHash: warpcastMatch[2]
        };
    }

    // Generic Farcaster hash
    if (/^0x[a-fA-F0-9]{8,}$/.test(trimmed)) {
        return {
            platform: 'farcaster',
            messageId: trimmed
        };
    }

    // Twitter profile (warning)
    if (/(?:twitter\.com|x\.com)\/\w+\/?$/i.test(trimmed)) {
        return {
            platform: 'twitter',
            messageId: trimmed,
            isProfile: true,
            warning: 'Profile URL detected. Use specific tweet for better indexing.'
        };
    }

    return null;
};

/**
 * Parse fees from various formats
 * Supports: 10%, 5% 5%, 500bps, 250 250, etc.
 */
export const parseFees = (input) => {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim().toLowerCase();

    // "10%" or "10% total" or "10percent"
    const singlePercent = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:%|percent)(?:\s+\w+)?$/);
    if (singlePercent) {
        const total = parseFloat(singlePercent[1]);
        const half = Math.round((total / 2) * 100);
        return { clankerFee: half, pairedFee: half };
    }

    // "5% 5%" or "5%/5%" or "5% and 5%"
    const splitPercent = trimmed.match(/(\d+(?:\.\d+)?)\s*%\s*(?:\/|\s|,|and)\s*(\d+(?:\.\d+)?)\s*%/);
    if (splitPercent) {
        return {
            clankerFee: Math.round(parseFloat(splitPercent[1]) * 100),
            pairedFee: Math.round(parseFloat(splitPercent[2]) * 100)
        };
    }

    // "500bps" or "500 bps"
    const singleBps = trimmed.match(/^(\d+)\s*bps$/);
    if (singleBps) {
        const total = parseInt(singleBps[1]);
        return { clankerFee: Math.floor(total / 2), pairedFee: Math.ceil(total / 2) };
    }

    // "250 250" or "250/250" or "250,250"
    const splitBps = trimmed.match(/^(\d+)\s*[\/\s,]\s*(\d+)$/);
    if (splitBps) {
        return {
            clankerFee: parseInt(splitBps[1]),
            pairedFee: parseInt(splitBps[2])
        };
    }

    // Just a number
    const singleNum = trimmed.match(/^(\d+)$/);
    if (singleNum) {
        const val = parseInt(singleNum[1]);
        if (val <= 100) {
            // Treat as percentage
            const half = Math.round((val / 2) * 100);
            return { clankerFee: half, pairedFee: half };
        } else {
            // Treat as total bps
            return { clankerFee: Math.floor(val / 2), pairedFee: Math.ceil(val / 2) };
        }
    }

    return null;
};

/**
 * Extract token info from natural language
 * 
 * Examples:
 * - "Deploy PEPE (Pepe Token) 10% https://x.com/user/status/123"
 * - "/go DOGE 'Dogecoin 2' 500bps"
 * - "Launch TOKEN with 5% fees"
 */
export const parseTokenCommand = (text) => {
    const result = {
        name: null,
        symbol: null,
        fees: null,
        context: null,
        description: null,
        raw: text
    };

    if (!text || typeof text !== 'string') return result;

    // Clean up text
    const cleaned = text.replace(/^\/(?:go|quick|deploy|launch)\s*/i, '').trim();
    const lines = cleaned.split('\n').map(l => l.trim()).filter(Boolean);
    const mainLine = lines[0] || '';

    // Extract symbol (UPPERCASE 2-10 chars, avoiding common words)
    const skipWords = ['WITH', 'AND', 'THE', 'FOR', 'FROM', 'DEPLOY', 'LAUNCH', 'CREATE', 'MAKE', 'FEES'];
    const symbolMatch = mainLine.match(/\b([A-Z][A-Z0-9]{1,9})\b/g);
    if (symbolMatch) {
        for (const match of symbolMatch) {
            if (!skipWords.includes(match)) {
                result.symbol = match;
                break;
            }
        }
    }

    // Extract name from parentheses: (Token Name)
    const nameParenMatch = mainLine.match(/\(([^)]+)\)/);
    if (nameParenMatch) {
        result.name = nameParenMatch[1].trim();
    }

    // Or from quotes: "Token Name" or 'Token Name'
    if (!result.name) {
        const nameQuoteMatch = mainLine.match(/["']([^"']+)["']/);
        if (nameQuoteMatch) {
            result.name = nameQuoteMatch[1].trim();
        }
    }

    // Default name to symbol
    if (!result.name && result.symbol) {
        result.name = result.symbol;
    }

    // Extract URL (from entire text, not just first line)
    const urlMatch = text.match(/https?:\/\/[^\s]+/gi);
    if (urlMatch) {
        for (const url of urlMatch) {
            const parsed = parseSourceLink(url);
            if (parsed) {
                result.context = parsed;
                break;
            }
        }
    }

    // Extract fees
    const feeMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|bps)/i);
    if (feeMatch) {
        result.fees = parseFees(feeMatch[0]);
    }

    // Also try "with X fees" pattern
    if (!result.fees) {
        const withFeesMatch = text.match(/(?:with|fees?:?)\s*(\d+(?:\.\d+)?)\s*(?:%|bps)?/i);
        if (withFeesMatch) {
            result.fees = parseFees(withFeesMatch[1] + (text.includes('bps') ? 'bps' : '%'));
        }
    }

    // Description from extra lines
    if (lines.length > 1) {
        const descLines = lines.slice(1).filter(l => !l.match(/https?:\/\//i));
        if (descLines.length > 0) {
            result.description = descLines.join(' ');
        }
    }

    return result;
};

export default {
    parseSourceLink,
    parseFees,
    parseTokenCommand
};
