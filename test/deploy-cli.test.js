import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
