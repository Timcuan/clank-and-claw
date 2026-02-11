import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramMessenger, stripMarkdown, truncateForTelegram } from '../lib/telegram-messenger.js';

test('stripMarkdown removes telegram markdown markers', () => {
    assert.equal(stripMarkdown('*Hello* `_world_` [x]'), 'Hello world x');
});

test('truncateForTelegram limits long messages and appends truncation note', () => {
    const input = 'a'.repeat(120);
    const output = truncateForTelegram(input, 60);
    assert.match(output, /\[truncated 60 chars\]$/);
    assert.equal(output.length <= 100, true);
});

test('sendMessage falls back to plain text on markdown parse error', async () => {
    const calls = [];
    const apiCall = async (method, data) => {
        calls.push({ method, data });
        if (calls.length === 1) {
            return { ok: false, description: 'Bad Request: parse entities' };
        }
        return { ok: true, result: { message_id: 7 } };
    };

    const messenger = createTelegramMessenger({
        apiCall,
        buildFileUrl: () => '',
        getActiveOrigin: () => 'https://api.telegram.test',
        logger: { warn: () => { }, error: () => { } }
    });

    const result = await messenger.sendMessage(123, '*Hello* world');
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'sendMessage');
    assert.equal(calls[0].data.parse_mode, 'Markdown');
    assert.equal(calls[1].method, 'sendMessage');
    assert.equal(calls[1].data.parse_mode, undefined);
    assert.equal(calls[1].data.text, 'Hello world');
});

test('editMessage treats message-not-modified as success', async () => {
    const apiCall = async () => ({
        ok: false,
        description: 'Bad Request: message is not modified'
    });

    const messenger = createTelegramMessenger({
        apiCall,
        buildFileUrl: () => '',
        getActiveOrigin: () => 'https://api.telegram.test',
        logger: { warn: () => { }, error: () => { } }
    });

    const result = await messenger.editMessage(123, 55, 'text');
    assert.equal(result.ok, true);
});

test('sendButtons falls back to plain text on markdown parse error', async () => {
    const calls = [];
    const apiCall = async (method, data) => {
        calls.push({ method, data });
        if (calls.length === 1) {
            return { ok: false, description: 'parse entities issue' };
        }
        return { ok: true };
    };

    const messenger = createTelegramMessenger({
        apiCall,
        buildFileUrl: () => '',
        getActiveOrigin: () => 'https://api.telegram.test',
        logger: { warn: () => { }, error: () => { } }
    });

    const result = await messenger.sendButtons(123, '*Deploy* now', [[{ text: 'Go', data: 'go' }]]);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].data.parse_mode, undefined);
    assert.equal(calls[1].data.text, 'Deploy now');
});

test('getFile returns resolved file URL using response origin', async () => {
    const messenger = createTelegramMessenger({
        apiCall: async () => ({
            ok: true,
            _apiOrigin: 'https://origin.telegram.test',
            result: { file_path: 'photos/file.jpg' }
        }),
        buildFileUrl: (origin, filePath) => `${origin}/file/bot/${filePath}`,
        getActiveOrigin: () => 'https://active.telegram.test',
        logger: { warn: () => { }, error: () => { } }
    });

    const result = await messenger.getFile('abc');
    assert.equal(result, 'https://origin.telegram.test/file/bot/photos/file.jpg');
});
