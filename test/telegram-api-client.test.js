import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramApiClient } from '../lib/telegram-api-client.js';

const createRequestMock = (steps) => {
    const calls = [];
    const requestFn = (url, options, callback) => {
        calls.push({ url, options });
        const step = steps.shift() || {};
        const reqHandlers = {};

        const req = {
            on: (event, handler) => {
                reqHandlers[event] = handler;
                return req;
            },
            write: () => { },
            end: () => {
                if (step.type === 'error') {
                    setImmediate(() => reqHandlers.error?.(new Error(step.message || 'mock request error')));
                    return;
                }
                if (step.type === 'timeout') {
                    setImmediate(() => reqHandlers.timeout?.());
                    return;
                }

                const resHandlers = {};
                const res = {
                    statusCode: step.statusCode ?? 200,
                    on: (event, handler) => {
                        resHandlers[event] = handler;
                        return res;
                    }
                };

                setImmediate(() => callback(res));
                setImmediate(() => {
                    const body = step.body ?? JSON.stringify(step.json ?? { ok: true, result: {} });
                    resHandlers.data?.(body);
                    resHandlers.end?.();
                });
            },
            destroy: () => { }
        };

        return req;
    };

    return { requestFn, calls };
};

test('telegram api client retries on retryable response and rotates origin', async () => {
    const { requestFn, calls } = createRequestMock([
        { statusCode: 502, json: { ok: false, error_code: 502, description: 'bad gateway' } },
        { statusCode: 200, json: { ok: true, result: { id: 1 } } }
    ]);

    const client = createTelegramApiClient({
        botToken: '123:abc',
        apiBases: 'https://a.telegram.test,https://b.telegram.test',
        isRetryable: (result) => Number(result?.error_code) >= 500,
        requestFn,
        sleep: async () => { }
    });

    const result = await client.apiCall('getMe');
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /^https:\/\/a\.telegram\.test\/bot123:abc\/getMe$/);
    assert.match(calls[1].url, /^https:\/\/b\.telegram\.test\/bot123:abc\/getMe$/);
    assert.equal(client.getActiveOrigin(), 'https://b.telegram.test');
});

test('telegram api client stops on non-retryable error', async () => {
    const { requestFn, calls } = createRequestMock([
        { statusCode: 400, json: { ok: false, error_code: 400, description: 'bad request' } }
    ]);

    const client = createTelegramApiClient({
        botToken: '123:abc',
        apiBase: 'https://single.telegram.test',
        isRetryable: () => false,
        requestFn,
        sleep: async () => { }
    });

    const result = await client.apiCall('sendMessage', { text: 'hello' }, 5);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/single\.telegram\.test\/bot123:abc\/sendMessage$/);
});

test('telegram api client retries request-level timeout error', async () => {
    const { requestFn, calls } = createRequestMock([
        { type: 'timeout' },
        { statusCode: 200, json: { ok: true, result: { ok: 1 } } }
    ]);

    const client = createTelegramApiClient({
        botToken: '123:abc',
        apiBase: 'https://single.telegram.test',
        requestFn,
        sleep: async () => { }
    });

    const result = await client.apiCall('getUpdates', {}, 2);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
});

test('telegram api client supports custom timeout and file base override', async () => {
    const { requestFn, calls } = createRequestMock([
        { statusCode: 200, json: { ok: true, result: { username: 'bot' } } }
    ]);

    const client = createTelegramApiClient({
        botToken: '123:abc',
        apiBase: 'https://single.telegram.test',
        fileBase: 'https://file.telegram.test',
        requestFn
    });

    const result = await client.apiCallAtOrigin('https://health.telegram.test', 'getMe', {}, 12345);
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.timeout, 12345);
    assert.equal(calls[0].url, 'https://health.telegram.test/bot123:abc/getMe');
    assert.equal(
        client.buildFileUrl('https://health.telegram.test', 'photos/file_1.jpg'),
        'https://file.telegram.test/bot123:abc/photos/file_1.jpg'
    );
});
