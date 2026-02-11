import fs from 'fs';
import os from 'os';

const isPidAlive = (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

const readLockData = (lockFilePath) => {
    try {
        const raw = fs.readFileSync(lockFilePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return parsed;
    } catch {
        return null;
    }
};

export const createBotLock = (lockFilePath) => {
    let lockFd = null;

    const createPayload = () => JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        hostname: os.hostname(),
        cwd: process.cwd()
    });

    const tryCreate = () => {
        lockFd = fs.openSync(lockFilePath, 'wx', 0o600);
        fs.writeFileSync(lockFd, createPayload(), 'utf8');
    };

    const acquire = () => {
        try {
            tryCreate();
            return;
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw new Error(`Cannot create lock file (${lockFilePath}): ${error.message}`);
            }
        }

        const existing = readLockData(lockFilePath);
        const existingPid = Number(existing?.pid);
        if (isPidAlive(existingPid)) {
            throw new Error(`Another bot instance is already running (PID ${existingPid}). Stop it first to avoid getUpdates conflict.`);
        }

        try { fs.unlinkSync(lockFilePath); } catch { }
        tryCreate();
    };

    const release = () => {
        if (lockFd !== null) {
            try { fs.closeSync(lockFd); } catch { }
            lockFd = null;
        }
        try { fs.unlinkSync(lockFilePath); } catch { }
    };

    return {
        acquire,
        release
    };
};
