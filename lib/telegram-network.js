/**
 * Telegram API error classification helpers.
 * Keep this module pure so it can be tested independently.
 */

const TELEGRAM_MARKDOWN_ERROR_TEXT = 'parse entities';
const TELEGRAM_MESSAGE_NOT_MODIFIED_TEXT = 'message is not modified';

const getStatusCode = (result) => Number(result?.error_code || result?._httpStatus || 0);
const getDescription = (result) => String(result?.description || result?.error || '').trim().toLowerCase();

const FORBIDDEN_PERMANENT_FRAGMENTS = [
    'bot was blocked by the user',
    'user is deactivated',
    'bot is not a member',
    'bot was kicked'
];

export const isLikelyPermanentTelegram4xx = (result) => {
    const code = getStatusCode(result);
    if (code < 400 || code >= 500 || code === 429) return false;

    const desc = getDescription(result);
    if (!desc) return false;

    if (desc.startsWith('bad request')) return true;
    if (desc.startsWith('unauthorized')) return true;

    if (desc.startsWith('forbidden')) {
        return FORBIDDEN_PERMANENT_FRAGMENTS.some(fragment => desc.includes(fragment));
    }

    if (desc.includes(TELEGRAM_MARKDOWN_ERROR_TEXT)) return true;
    if (desc.includes('chat not found')) return true;
    if (desc.includes(TELEGRAM_MESSAGE_NOT_MODIFIED_TEXT)) return true;

    return false;
};

export const isRetryableTelegramApiResult = (result) => {
    if (!result || result.ok !== false) return false;

    const code = getStatusCode(result);
    if (code === 429) return true;
    if (code >= 500) return true;
    if ([408, 409, 425].includes(code)) return true;

    if (code >= 400 && code < 500 && !isLikelyPermanentTelegram4xx(result)) {
        return true;
    }

    const desc = getDescription(result);
    const transientSignals = ['timeout', 'temporar', 'gateway', 'upstream', 'connection reset', 'econn', 'socket hang up'];
    return transientSignals.some(signal => desc.includes(signal));
};

export default {
    isLikelyPermanentTelegram4xx,
    isRetryableTelegramApiResult
};
