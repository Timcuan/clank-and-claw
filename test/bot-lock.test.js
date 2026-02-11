import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createBotLock } from '../lib/bot-lock.js';

const withTempLockPath = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-bot-lock-'));
    return {
        dir,
        lockPath: path.join(dir, 'bot.lock')
    };
};

test('bot lock acquire creates lock file and release removes it', () => {
    const { dir, lockPath } = withTempLockPath();
    const lock = createBotLock(lockPath);

    try {
        lock.acquire();
        assert.equal(fs.existsSync(lockPath), true);
        lock.release();
        assert.equal(fs.existsSync(lockPath), false);
    } finally {
        lock.release();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('bot lock acquire replaces stale lock file', () => {
    const { dir, lockPath } = withTempLockPath();
    const stalePayload = {
        pid: 999999,
        startedAt: new Date().toISOString(),
        hostname: 'stale-host',
        cwd: '/tmp'
    };
    fs.writeFileSync(lockPath, JSON.stringify(stalePayload), 'utf8');

    const lock = createBotLock(lockPath);
    try {
        lock.acquire();
        const raw = fs.readFileSync(lockPath, 'utf8');
        const parsed = JSON.parse(raw);
        assert.equal(parsed.pid, process.pid);
        lock.release();
    } finally {
        lock.release();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('bot lock acquire fails when another active process holds lock', () => {
    const { dir, lockPath } = withTempLockPath();
    const activePayload = {
        pid: process.pid,
        startedAt: new Date().toISOString(),
        hostname: 'active-host',
        cwd: process.cwd()
    };
    fs.writeFileSync(lockPath, JSON.stringify(activePayload), 'utf8');

    const lock = createBotLock(lockPath);
    try {
        assert.throws(() => lock.acquire(), /Another bot instance is already running/);
        assert.equal(fs.existsSync(lockPath), true);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
