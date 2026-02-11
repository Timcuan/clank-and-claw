import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const runDeploy = (args = []) => {
    return spawnSync(process.execPath, ['deploy.js', ...args], {
        cwd: projectRoot,
        env: {
            ...process.env,
            CI: 'true',
            DRY_RUN: 'true'
        },
        encoding: 'utf8'
    });
};

test('deploy CLI shows usage with --help', () => {
    const result = runDeploy(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--spoof <addr>/);
});

test('deploy CLI fails when --spoof value is missing', () => {
    const result = runDeploy(['--spoof']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--spoof requires an address value/);
});

test('deploy CLI fails when spoof address is invalid', () => {
    const result = runDeploy(['--env', '--spoof', 'not-an-address']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--spoof must be a valid 0x Ethereum address/);
});

test('deploy CLI fails fast when JSON config file does not exist', () => {
    const result = runDeploy(['does-not-exist.json']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Token config file not found: does-not-exist\.json/);
});

test('deploy CLI --check validates token config without deployment', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clank-deploy-check-'));
    const tokenPath = path.join(tmpDir, 'token.json');
    fs.writeFileSync(tokenPath, JSON.stringify({
        name: 'Check Token',
        symbol: 'CHK',
        image: 'https://example.com/check.png',
        fees: { mode: 'static', static: { clankerFeeBps: 300, pairedFeeBps: 300 } },
        context: { url: 'https://x.com/user/status/123456789' },
        advanced: { smartValidation: true }
    }, null, 2));

    try {
        const result = runDeploy(['--check', tokenPath]);
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Configuration check passed \(no deploy executed\)/);
        assert.doesNotMatch(result.stdout, /DEPLOYMENT SUCCESSFUL|DRY RUN MODE ACTIVE/);
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
});
