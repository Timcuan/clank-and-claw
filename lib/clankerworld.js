const CLANKERWORLD_API_BASE = 'https://www.clanker.world/api';
const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeAddress = (value) => String(value || '').trim().toLowerCase();

const fetchWithTimeout = async (url, { timeoutMs = 5000, fetchImpl = globalThis.fetch } = {}) => {
    if (typeof fetchImpl !== 'function') {
        throw new Error('Fetch implementation is unavailable in this runtime');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = setTimeout(() => {
        if (controller) controller.abort();
    }, timeoutMs);

    try {
        return await fetchImpl(url, {
            method: 'GET',
            headers: { accept: 'application/json' },
            signal: controller?.signal
        });
    } finally {
        clearTimeout(timeout);
    }
};

const extractTokenAddress = (token) => {
    if (!token || typeof token !== 'object') return null;

    const candidates = [
        token.contractAddress,
        token.tokenAddress,
        token.address,
        token.token_address,
        token.contract_address
    ];

    for (const candidate of candidates) {
        const value = String(candidate || '').trim();
        if (ADDRESS_REGEX.test(value)) return value;
    }

    return null;
};

const extractTokenList = (payload) => {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.tokens)) return payload.tokens;
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.results)) return payload.results;
    if (payload.token && typeof payload.token === 'object') return [payload.token];
    return [];
};

export const findTokenByAddressInPayload = (payload, address) => {
    const needle = normalizeAddress(address);
    if (!ADDRESS_REGEX.test(needle)) return null;

    const tokens = extractTokenList(payload);
    for (const token of tokens) {
        const tokenAddress = extractTokenAddress(token);
        if (tokenAddress && normalizeAddress(tokenAddress) === needle) {
            return token;
        }
    }

    return null;
};

export const fetchTokenSearchPayload = async (query, options = {}) => {
    const q = String(query || '').trim();
    if (!q) throw new Error('Token search query is required');

    const url = `${CLANKERWORLD_API_BASE}/tokens?q=${encodeURIComponent(q)}`;
    const response = await fetchWithTimeout(url, {
        timeoutMs: options.timeoutMs ?? 6000,
        fetchImpl: options.fetchImpl
    });

    if (!response.ok) {
        throw new Error(`Clankerworld API request failed (${response.status})`);
    }

    return response.json();
};

export const waitForTokenIndexing = async (address, options = {}) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) ? Number(options.timeoutMs) : 180_000;
    const intervalMs = Number.isFinite(options.intervalMs) ? Number(options.intervalMs) : 10_000;
    const startedAt = Date.now();
    let attempts = 0;
    let lastError = null;

    while (Date.now() - startedAt <= timeoutMs) {
        attempts += 1;

        try {
            const payload = await fetchTokenSearchPayload(address, {
                timeoutMs: options.requestTimeoutMs ?? 6000,
                fetchImpl: options.fetchImpl
            });
            const token = findTokenByAddressInPayload(payload, address);

            if (token) {
                return {
                    indexed: true,
                    token,
                    attempts,
                    elapsedMs: Date.now() - startedAt
                };
            }
        } catch (error) {
            lastError = error;
        }

        await delay(intervalMs);
    }

    return {
        indexed: false,
        token: null,
        attempts,
        elapsedMs: Date.now() - startedAt,
        error: lastError ? String(lastError.message || lastError) : null
    };
};

const extractTwitterUsername = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    // direct handle
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        const normalized = raw.replace(/^@/, '');
        return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : null;
    }

    try {
        const url = new URL(raw);
        if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(url.hostname)) return null;
        const first = url.pathname.split('/').filter(Boolean)[0] || '';
        const normalized = first.replace(/^@/, '');
        return /^[A-Za-z0-9_]{1,15}$/.test(normalized) ? normalized : null;
    } catch {
        return null;
    }
};

const getTwitterUsernameCandidate = (config) => {
    const contextId = extractTwitterUsername(config?.context?.id);
    if (contextId) return contextId;

    const socials = Array.isArray(config?.metadata?.socialMediaUrls) ? config.metadata.socialMediaUrls : [];
    const socialX = socials.find((entry) => {
        const platform = String(entry?.platform || '').trim().toLowerCase();
        return platform === 'x' || platform === 'twitter';
    });

    const socialUser = extractTwitterUsername(socialX?.url);
    if (socialUser) return socialUser;

    return null;
};

export const resolveTwitterNumericUserId = async (username, options = {}) => {
    const candidate = extractTwitterUsername(username);
    if (!candidate) return null;

    const url = `https://cdn.syndication.twimg.com/widgets/followbutton/info.json?screen_names=${encodeURIComponent(candidate)}`;
    const response = await fetchWithTimeout(url, {
        timeoutMs: options.timeoutMs ?? 4500,
        fetchImpl: options.fetchImpl
    });

    if (!response.ok) return null;

    let payload;
    try {
        payload = await response.json();
    } catch {
        return null;
    }

    if (!Array.isArray(payload)) return null;

    const match = payload.find((entry) => {
        const screenName = String(entry?.screen_name || '').toLowerCase();
        return screenName === candidate.toLowerCase();
    }) || payload[0];

    const id = String(match?.id_str || match?.id || '').trim();
    return /^\d+$/.test(id) ? id : null;
};

export const maybeEnrichContextId = async (config, options = {}) => {
    const platform = String(config?.context?.platform || '').trim().toLowerCase();
    if (platform !== 'twitter') {
        return { changed: false, reason: 'platform-not-twitter' };
    }

    const currentId = String(config?.context?.id || '').trim();
    if (/^\d+$/.test(currentId)) {
        return { changed: false, reason: 'already-numeric' };
    }

    const username = getTwitterUsernameCandidate(config);
    if (!username) {
        return { changed: false, reason: 'username-missing' };
    }

    try {
        const numericId = await resolveTwitterNumericUserId(username, {
            timeoutMs: options.timeoutMs ?? 4500,
            fetchImpl: options.fetchImpl
        });

        if (!numericId) {
            return { changed: false, reason: 'resolve-empty', username };
        }

        config.context.id = numericId;
        config._meta = config._meta || {};
        config._meta.contextIdSource = 'resolved-twitter-id';
        config._meta.contextIdUsername = username;

        return {
            changed: true,
            reason: 'resolved',
            username,
            id: numericId
        };
    } catch {
        return { changed: false, reason: 'resolve-failed', username };
    }
};

export default {
    findTokenByAddressInPayload,
    fetchTokenSearchPayload,
    waitForTokenIndexing,
    resolveTwitterNumericUserId,
    maybeEnrichContextId
};
