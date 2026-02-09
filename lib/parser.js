/**
 * 🔗 Link Parser - Extract context from social media URLs
 */

/**
 * Parse a URL and extract platform + messageId for Clanker context
 * @param {string} url - Social media URL
 * @returns {{ platform: string, messageId: string } | null}
 */
export const parseSourceLink = (url) => {
    if (!url || typeof url !== 'string') return null;

    const trimmed = url.trim();

    // Twitter/X
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

    // If URL contains twitter or x.com but no status (profile URL)
    if (/(?:twitter\.com|x\.com)\/\w+\/?$/i.test(trimmed)) {
        return {
            platform: 'twitter',
            messageId: trimmed,
            isProfile: true,
            warning: 'This is a profile URL, not a specific tweet. Indexing may fail.'
        };
    }

    return null;
};

/**
 * Parse fees from text input
 * Examples: "10%", "5% 5%", "500bps", "100 100"
 * @param {string} input
 * @returns {{ clankerFee: number, pairedFee: number } | null}
 */
export const parseFees = (input) => {
    if (!input || typeof input !== 'string') return null;

    const trimmed = input.trim().toLowerCase();

    // Handle percentage format: "10%" or "10% total" -> 5% + 5%
    const singlePercent = trimmed.match(/^(\d+(?:\.\d+)?)\s*%(?:\s+\w+)?$/);
    if (singlePercent) {
        const total = parseFloat(singlePercent[1]);
        const half = Math.round((total / 2) * 100);
        return { clankerFee: half, pairedFee: half };
    }

    // Handle split percentage: "5% 5%" or "5%/5%"
    const splitPercent = trimmed.match(/(\d+(?:\.\d+)?)\s*%\s*[\/\s,]\s*(\d+(?:\.\d+)?)\s*%/);
    if (splitPercent) {
        return {
            clankerFee: Math.round(parseFloat(splitPercent[1]) * 100),
            pairedFee: Math.round(parseFloat(splitPercent[2]) * 100)
        };
    }

    // Handle bps format: "500bps" or "500 bps"
    const singleBps = trimmed.match(/^(\d+)\s*bps$/);
    if (singleBps) {
        const total = parseInt(singleBps[1]);
        return { clankerFee: Math.floor(total / 2), pairedFee: Math.ceil(total / 2) };
    }

    // Handle raw bps split: "250 250" or "250/250"
    const splitBps = trimmed.match(/^(\d+)\s*[\/\s,]\s*(\d+)$/);
    if (splitBps) {
        return {
            clankerFee: parseInt(splitBps[1]),
            pairedFee: parseInt(splitBps[2])
        };
    }

    // Handle single number (assume bps)
    const singleNum = trimmed.match(/^(\d+)$/);
    if (singleNum) {
        const val = parseInt(singleNum[1]);
        if (val <= 100) {
            // Assume percentage
            const half = Math.round((val / 2) * 100);
            return { clankerFee: half, pairedFee: half };
        } else {
            // Assume bps
            return { clankerFee: Math.floor(val / 2), pairedFee: Math.ceil(val / 2) };
        }
    }

    return null;
};

/**
 * Parse token command from natural language
 * Example: "Deploy PEPE (Pepe Token) 10% https://x.com/user/status/123"
 * @param {string} text
 * @returns {object}
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

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0] || '';

    // Try to extract symbol (UPPERCASE word, usually 3-6 chars)
    const symbolMatch = firstLine.match(/\b([A-Z]{2,10})\b/);
    if (symbolMatch) {
        result.symbol = symbolMatch[1];
    }

    // Try to extract name in parentheses: (Token Name)
    const nameParenMatch = firstLine.match(/\(([^)]+)\)/);
    if (nameParenMatch) {
        result.name = nameParenMatch[1].trim();
    }

    // Try to extract name in quotes: "Token Name"
    const nameQuoteMatch = firstLine.match(/["']([^"']+)["']/);
    if (nameQuoteMatch && !result.name) {
        result.name = nameQuoteMatch[1].trim();
    }

    // If no name found, use symbol as name
    if (!result.name && result.symbol) {
        result.name = result.symbol;
    }

    // Extract URL
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

    // Extract fees (look for percentage or bps)
    const feeMatch = text.match(/(\d+(?:\.\d+)?)\s*%|\b(\d+)\s*bps\b|\bfees?\s*[:=]?\s*(\d+)/i);
    if (feeMatch) {
        const feeStr = feeMatch[0];
        result.fees = parseFees(feeStr);
    }

    // Description from remaining lines
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
