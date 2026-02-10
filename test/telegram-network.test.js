import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isLikelyPermanentTelegram4xx,
    isRetryableTelegramApiResult
} from '../lib/telegram-network.js';

test('isLikelyPermanentTelegram4xx marks Telegram bad request as permanent', () => {
    const result = {
        ok: false,
        error_code: 400,
        description: 'Bad Request: chat not found'
    };
    assert.equal(isLikelyPermanentTelegram4xx(result), true);
    assert.equal(isRetryableTelegramApiResult(result), false);
});

test('isLikelyPermanentTelegram4xx marks user-blocked forbidden as permanent', () => {
    const result = {
        ok: false,
        error_code: 403,
        description: 'Forbidden: bot was blocked by the user'
    };
    assert.equal(isLikelyPermanentTelegram4xx(result), true);
    assert.equal(isRetryableTelegramApiResult(result), false);
});

test('generic gateway 403 remains retryable for origin failover', () => {
    const result = {
        ok: false,
        _httpStatus: 403,
        description: 'Forbidden'
    };
    assert.equal(isLikelyPermanentTelegram4xx(result), false);
    assert.equal(isRetryableTelegramApiResult(result), true);
});

test('gateway 404 remains retryable for origin failover', () => {
    const result = {
        ok: false,
        _httpStatus: 404,
        description: '<html>gateway not found</html>'
    };
    assert.equal(isLikelyPermanentTelegram4xx(result), false);
    assert.equal(isRetryableTelegramApiResult(result), true);
});

test('429 and 5xx are retryable', () => {
    const floodControl = {
        ok: false,
        error_code: 429,
        description: 'Too Many Requests'
    };
    const serverError = {
        ok: false,
        error_code: 502,
        description: 'Bad Gateway'
    };
    assert.equal(isRetryableTelegramApiResult(floodControl), true);
    assert.equal(isRetryableTelegramApiResult(serverError), true);
});
