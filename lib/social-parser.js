/**
 * 🔗 Social Media & Source Link Parser
 * 
 * Auto-detects platform and extracts relevant data from URLs
 */

/**
 * Detect platform and parse URL
 */
export const detectSocialPlatform = (url) => {
    if (!url || typeof url !== 'string') return null;

    const cleaned = url.trim();

    // Twitter/X
    if (cleaned.match(/(?:twitter\.com|x\.com)/i)) {
        const statusMatch = cleaned.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
        const profileMatch = cleaned.match(/(?:twitter\.com|x\.com)\/([^/?]+)/i);

        if (statusMatch) {
            return {
                platform: 'twitter',
                type: 'tweet',
                url: cleaned.replace('twitter.com', 'x.com'),
                messageId: statusMatch[1],
                username: profileMatch ? profileMatch[1] : null
            };
        }
        return {
            platform: 'twitter',
            type: 'profile',
            url: cleaned.replace('twitter.com', 'x.com')
        };
    }

    // Farcaster/Warpcast
    if (cleaned.match(/(?:warpcast\.com|farcaster)/i)) {
        const castMatch = cleaned.match(/warpcast\.com\/[^/]+\/(0x[a-fA-F0-9]+)/i);
        const profileMatch = cleaned.match(/warpcast\.com\/([^/?]+)/i);

        if (castMatch) {
            return {
                platform: 'farcaster',
                type: 'cast',
                url: cleaned,
                messageId: castMatch[1],
                username: profileMatch ? profileMatch[1] : null
            };
        }
        return {
            platform: 'farcaster',
            type: 'profile',
            url: cleaned
        };
    }

    // Telegram
    if (cleaned.match(/(?:t\.me|telegram\.me|telegram\.org)/i)) {
        const channelMatch = cleaned.match(/t\.me\/([^/?]+)/i);
        return {
            platform: 'telegram',
            type: 'channel',
            url: cleaned.replace(/telegram\.(me|org)/, 't.me'),
            channel: channelMatch ? channelMatch[1] : null
        };
    }

    // Discord
    if (cleaned.match(/discord\.(?:gg|com)/i)) {
        const inviteMatch = cleaned.match(/discord\.(?:gg|com\/invite)\/([a-zA-Z0-9]+)/i);
        return {
            platform: 'discord',
            type: 'invite',
            url: cleaned,
            invite: inviteMatch ? inviteMatch[1] : null
        };
    }

    // GitHub
    if (cleaned.match(/github\.com/i)) {
        const repoMatch = cleaned.match(/github\.com\/([^/]+)\/([^/?]+)/i);
        return {
            platform: 'github',
            type: 'repo',
            url: cleaned,
            owner: repoMatch ? repoMatch[1] : null,
            repo: repoMatch ? repoMatch[2] : null
        };
    }

    // Medium
    if (cleaned.match(/medium\.com/i)) {
        return { platform: 'medium', type: 'profile', url: cleaned };
    }

    // Reddit
    if (cleaned.match(/reddit\.com/i)) {
        const subredditMatch = cleaned.match(/reddit\.com\/r\/([^/?]+)/i);
        return {
            platform: 'reddit',
            type: 'subreddit',
            url: cleaned,
            subreddit: subredditMatch ? subredditMatch[1] : null
        };
    }

    // Instagram
    if (cleaned.match(/instagram\.com/i)) {
        const profileMatch = cleaned.match(/instagram\.com\/([^/?]+)/i);
        return {
            platform: 'instagram',
            type: 'profile',
            url: cleaned,
            username: profileMatch ? profileMatch[1] : null
        };
    }

    // YouTube
    if (cleaned.match(/youtube\.com|youtu\.be/i)) {
        const channelMatch = cleaned.match(/youtube\.com\/(?:c\/|channel\/|@)([^/?]+)/i);
        return {
            platform: 'youtube',
            type: 'channel',
            url: cleaned,
            channel: channelMatch ? channelMatch[1] : null
        };
    }

    // TikTok
    if (cleaned.match(/tiktok\.com/i)) {
        const profileMatch = cleaned.match(/tiktok\.com\/@([^/?]+)/i);
        return {
            platform: 'tiktok',
            type: 'profile',
            url: cleaned,
            username: profileMatch ? profileMatch[1] : null
        };
    }

    // LinkedIn
    if (cleaned.match(/linkedin\.com/i)) {
        return { platform: 'linkedin', type: 'profile', url: cleaned };
    }

    // Website (generic)
    if (cleaned.match(/^https?:\/\//i)) {
        // Extract domain
        try {
            const urlObj = new URL(cleaned);
            return {
                platform: 'website',
                type: 'url',
                url: cleaned,
                domain: urlObj.hostname
            };
        } catch (e) {
            return { platform: 'website', type: 'url', url: cleaned };
        }
    }

    // If starts with @ - likely username
    if (cleaned.startsWith('@')) {
        return {
            platform: 'unknown',
            type: 'username',
            username: cleaned.substring(1)
        };
    }

    return null;
};

/**
 * Parse multiple social links from text
 */
export const parseMultipleSocials = (text) => {
    if (!text || typeof text !== 'string') return [];

    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const urls = text.match(urlRegex) || [];

    const socials = [];
    for (const url of urls) {
        const parsed = detectSocialPlatform(url);
        if (parsed) socials.push(parsed);
    }

    return socials;
};

/**
 * Organize socials by platform
 */
export const organizeSocials = (socials) => {
    const organized = {
        context: null, // For deployment context (tweet or cast)
        profiles: {}   // Social media profiles
    };
    let fallbackContext = null;

    for (const social of socials) {
        // Context links (tweets, casts)
        if (social.type === 'tweet' && !organized.context) {
            organized.context = {
                platform: 'twitter',
                url: social.url,
                messageId: social.messageId
            };
        } else if (social.type === 'cast' && !organized.context) {
            organized.context = {
                platform: 'farcaster',
                url: social.url,
                messageId: social.messageId
            };
        } else if (!fallbackContext && social.url && social.platform && social.platform !== 'unknown') {
            fallbackContext = {
                platform: social.platform === 'x' ? 'twitter' : social.platform,
                url: social.url,
                messageId: social.url
            };
            if (!organized.profiles[social.platform]) {
                organized.profiles[social.platform] = social.url;
            }
        }
        // Profile links
        else {
            if (!organized.profiles[social.platform]) {
                organized.profiles[social.platform] = social.url;
            }
        }
    }

    if (!organized.context && fallbackContext) {
        organized.context = fallbackContext;
    }

    return organized;
};

/**
 * Smart social input parser
 * Accepts:
 * - Single URL
 * - Multiple URLs (space or newline separated)
 * - Mixed context + profiles
 */
export const parseSmartSocialInput = (input) => {
    if (!input || typeof input !== 'string') {
        return { context: null, socials: {} };
    }

    // Parse all socials from input
    const allSocials = parseMultipleSocials(input);

    // Organize into context + profiles
    const organized = organizeSocials(allSocials);

    return {
        context: organized.context,
        socials: organized.profiles
    };
};

/**
 * Validate context URL (must be tweet or cast)
 */
export const isValidContextUrl = (url) => {
    const parsed = detectSocialPlatform(url);
    return parsed && (parsed.type === 'tweet' || parsed.type === 'cast');
};

/**
 * Extract username from social URL
 */
export const extractUsername = (url) => {
    const parsed = detectSocialPlatform(url);
    return parsed?.username || null;
};

/**
 * Normalize URL (clean tracking params, etc.)
 */
export const normalizeUrl = (url) => {
    if (!url || typeof url !== 'string') return url;

    try {
        const urlObj = new URL(url);
        // Remove common tracking params
        const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'ref', 'fbclid'];
        paramsToRemove.forEach(param => urlObj.searchParams.delete(param));

        // Replace twitter.com with x.com
        if (urlObj.hostname === 'twitter.com') {
            urlObj.hostname = 'x.com';
        }

        return urlObj.toString();
    } catch (e) {
        return url;
    }
};

export default {
    detectSocialPlatform,
    parseMultipleSocials,
    organizeSocials,
    parseSmartSocialInput,
    isValidContextUrl,
    extractUsername,
    normalizeUrl
};
