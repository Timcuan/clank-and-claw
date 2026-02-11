const DEFAULT_MAX_TEXT_LENGTH = 3900;
const DEFAULT_MARKDOWN_ERROR_TEXT = 'parse entities';
const DEFAULT_MESSAGE_NOT_MODIFIED_TEXT = 'message is not modified';

export const stripMarkdown = (text) => String(text || '').replace(/[*_`\[\]]/g, '');

export const truncateForTelegram = (text, maxLength = DEFAULT_MAX_TEXT_LENGTH) => {
    const value = String(text || '');
    if (value.length <= maxLength) return value;
    const overflow = value.length - maxLength;
    return `${value.slice(0, maxLength - 40)}\n\n[truncated ${overflow} chars]`;
};

const isMarkdownParseError = (result, marker = DEFAULT_MARKDOWN_ERROR_TEXT) => {
    if (!result || result.ok !== false) return false;
    const desc = String(result.description || result.error || '').toLowerCase();
    return desc.includes(marker);
};

const isMessageNotModified = (result, marker = DEFAULT_MESSAGE_NOT_MODIFIED_TEXT) => {
    if (!result || result.ok !== false) return false;
    const desc = String(result.description || result.error || '').toLowerCase();
    return desc.includes(marker);
};

export const createTelegramMessenger = ({
    apiCall,
    buildFileUrl,
    getActiveOrigin,
    logger = console,
    maxTextLength = DEFAULT_MAX_TEXT_LENGTH,
    markdownErrorText = DEFAULT_MARKDOWN_ERROR_TEXT,
    messageNotModifiedText = DEFAULT_MESSAGE_NOT_MODIFIED_TEXT
}) => {
    const sendMessage = async (chatId, text, options = {}) => {
        const safeText = truncateForTelegram(text, maxTextLength);
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
            if (!isMarkdownParseError(result, markdownErrorText)) {
                logger.warn(`Telegram sendMessage failed: ${result?.description || 'unknown error'}`);
                return result;
            }
        } catch (e) {
            logger.warn(`Telegram sendMessage request error: ${e.message}`);
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
            logger.error(`Telegram sendMessage fallback failed: ${e.message}`);
            return { ok: false, error: e.message, description: e.message };
        }
    };

    const sendTyping = (chatId) => apiCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => { });

    const getFile = async (fileId) => {
        try {
            const result = await apiCall('getFile', { file_id: fileId });
            if (result.ok && result.result.file_path) {
                return buildFileUrl(result._apiOrigin || getActiveOrigin(), result.result.file_path);
            }
        } catch {
            // Ignore lookup failure and return null.
        }
        return null;
    };

    const editMessage = async (chatId, messageId, text) => {
        const safeText = truncateForTelegram(text, maxTextLength);
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
            if (isMessageNotModified(result, messageNotModifiedText)) {
                return { ...result, ok: true };
            }
            if (!isMarkdownParseError(result, markdownErrorText)) {
                logger.warn(`Telegram editMessageText failed: ${result?.description || 'unknown error'}`);
            }
        } catch (e) {
            logger.warn(`Telegram editMessageText request error: ${e.message}`);
        }

        try {
            const plainEdit = await apiCall('editMessageText', {
                chat_id: chatId,
                message_id: messageId,
                text: stripMarkdown(safeText)
            });

            if (plainEdit?.ok === false) {
                if (isMessageNotModified(plainEdit, messageNotModifiedText)) {
                    return { ...plainEdit, ok: true };
                }
                return await sendMessage(chatId, safeText);
            }

            return plainEdit;
        } catch (e) {
            logger.warn(`Telegram plain editMessageText failed: ${e.message}`);
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
            text: truncateForTelegram(text, maxTextLength),
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
            reply_markup: keyboard
        };

        try {
            const result = await apiCall('sendMessage', markdownPayload);
            if (result?.ok !== false) {
                return result;
            }
            if (!isMarkdownParseError(result, markdownErrorText)) {
                logger.warn(`Telegram sendButtons failed: ${result?.description || 'unknown error'}`);
                return result;
            }
        } catch (e) {
            logger.warn(`Telegram sendButtons request error: ${e.message}`);
        }

        return await apiCall('sendMessage', {
            chat_id: chatId,
            text: truncateForTelegram(stripMarkdown(text), maxTextLength),
            disable_web_page_preview: true,
            reply_markup: keyboard
        });
    };

    return {
        sendMessage,
        sendTyping,
        getFile,
        editMessage,
        sendButtons
    };
};

export default {
    createTelegramMessenger,
    stripMarkdown,
    truncateForTelegram
};
