export const createSessionDraftBridge = ({
    sessionManager,
    configStore,
    defaultFees,
    logger = console
}) => {
    const normalizeFeeValue = (value, fallback) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) return Number(fallback);
        return Math.round(parsed);
    };

    const normalizeSocials = (value) => {
        if (!value || typeof value !== 'object') return {};
        const out = {};
        for (const [key, raw] of Object.entries(value)) {
            const text = String(raw || '').trim();
            if (!text) continue;
            out[String(key)] = text;
        }
        return out;
    };

    const cloneTokenDraft = (token) => ({
        name: token?.name ?? null,
        symbol: token?.symbol ?? null,
        image: token?.image ?? null,
        description: token?.description ?? null,
        fees: {
            clankerFee: normalizeFeeValue(token?.fees?.clankerFee, defaultFees.clankerFee),
            pairedFee: normalizeFeeValue(token?.fees?.pairedFee, defaultFees.pairedFee)
        },
        context: token?.context
            ? {
                platform: String(token.context.platform || 'website'),
                messageId: String(token.context.messageId || '')
            }
            : null,
        socials: normalizeSocials(token?.socials),
        spoofTo: token?.spoofTo ?? null
    });

    const hydrateSessionFromDraft = (session, draft) => {
        if (!draft || typeof draft !== 'object') return;
        session.token = cloneTokenDraft(draft);
        session.state = 'collecting';
    };

    const persistSessionDraft = (chatId, session) => {
        try {
            configStore.saveDraft(chatId, cloneTokenDraft(session.token));
        } catch (error) {
            logger.error('Draft save warning:', error.message);
        }
    };

    const clearSessionDraft = (chatId) => {
        try {
            configStore.clearDraft(chatId);
        } catch (error) {
            logger.error('Draft clear warning:', error.message);
        }
    };

    const getSession = (chatId) => {
        const session = sessionManager.get(chatId);
        if (!session._draftHydrated) {
            const draft = configStore.getDraft(chatId);
            if (draft) {
                hydrateSessionFromDraft(session, draft);
            }
            session._draftHydrated = true;
        }
        return session;
    };

    const resetSession = (chatId, options = {}) => {
        const clearDraft = options.clearDraft !== false;
        const session = sessionManager.reset(chatId);
        session._draftHydrated = true;
        if (clearDraft) {
            clearSessionDraft(chatId);
        }
        return session;
    };

    return {
        cloneTokenDraft,
        hydrateSessionFromDraft,
        persistSessionDraft,
        clearSessionDraft,
        getSession,
        resetSession
    };
};

export default {
    createSessionDraftBridge
};
