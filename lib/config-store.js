/**
 * Persistent chat config store (single-instance local JSON DB).
 *
 * Rationale:
 * - No external dependency required for VPS bootstrap.
 * - Atomic file writes for crash-safe persistence.
 * - Supports per-chat draft + named presets.
 */

import fs from 'fs';
import path from 'path';

const DEFAULT_FEES = {
    clankerFee: 300,
    pairedFee: 300
};

const normalizeTextOrNull = (value) => {
    if (value === undefined || value === null) return null;
    return String(value);
};

const normalizeFees = (value) => {
    const clankerFee = Number(value?.clankerFee);
    const pairedFee = Number(value?.pairedFee);
    return {
        clankerFee: Number.isFinite(clankerFee) ? clankerFee : DEFAULT_FEES.clankerFee,
        pairedFee: Number.isFinite(pairedFee) ? pairedFee : DEFAULT_FEES.pairedFee
    };
};

const normalizeContext = (value) => {
    if (!value || typeof value !== 'object') return null;
    const platform = normalizeTextOrNull(value.platform);
    const messageId = normalizeTextOrNull(value.messageId);
    if (!platform && !messageId) return null;
    return {
        platform: platform || 'website',
        messageId: messageId || ''
    };
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

const normalizeTokenDraft = (value) => {
    const token = value && typeof value === 'object' ? value : {};
    return {
        name: normalizeTextOrNull(token.name),
        symbol: normalizeTextOrNull(token.symbol),
        image: normalizeTextOrNull(token.image),
        description: normalizeTextOrNull(token.description),
        fees: normalizeFees(token.fees),
        context: normalizeContext(token.context),
        socials: normalizeSocials(token.socials),
        spoofTo: normalizeTextOrNull(token.spoofTo)
    };
};

const normalizePresetName = (value) => String(value || '').trim();

const nowIso = () => new Date().toISOString();
const isSameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export class ConfigStore {
    constructor(storePath = process.env.CONFIG_STORE_PATH || path.join(process.cwd(), 'data', 'bot-config-store.json')) {
        this.storePath = path.resolve(storePath);
        this._loaded = false;
        this._store = { version: 1, users: {} };
    }

    _ensureLoaded() {
        if (this._loaded) return;
        this._loaded = true;

        try {
            if (!fs.existsSync(this.storePath)) return;
            const raw = fs.readFileSync(this.storePath, 'utf8');
            if (!raw.trim()) return;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return;
            if (!parsed.users || typeof parsed.users !== 'object') return;
            this._store = {
                version: 1,
                users: parsed.users
            };
        } catch (error) {
            console.warn('ConfigStore load warning:', error.message);
            this._store = { version: 1, users: {} };
        }
    }

    _write() {
        const dir = path.dirname(this.storePath);
        fs.mkdirSync(dir, { recursive: true });

        const tmpPath = `${this.storePath}.${process.pid}.tmp`;
        const payload = JSON.stringify(this._store, null, 2);
        fs.writeFileSync(tmpPath, payload, { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(tmpPath, this.storePath);
    }

    _getUser(chatId, create = false) {
        this._ensureLoaded();
        const id = String(chatId);
        if (!this._store.users[id]) {
            if (!create) return null;
            this._store.users[id] = {
                updatedAt: nowIso(),
                draft: null,
                presets: {}
            };
        }
        return this._store.users[id];
    }

    getDraft(chatId) {
        const user = this._getUser(chatId, false);
        if (!user?.draft) return null;
        return normalizeTokenDraft(user.draft);
    }

    saveDraft(chatId, token) {
        const user = this._getUser(chatId, true);
        const normalizedDraft = normalizeTokenDraft(token);
        if (isSameJson(user.draft, normalizedDraft)) {
            return user.draft;
        }
        user.draft = normalizedDraft;
        user.updatedAt = nowIso();
        this._write();
        return user.draft;
    }

    clearDraft(chatId) {
        const user = this._getUser(chatId, false);
        if (!user) return false;
        if (!user.draft) return false;
        user.draft = null;
        user.updatedAt = nowIso();
        this._write();
        return true;
    }

    listPresets(chatId) {
        const user = this._getUser(chatId, false);
        if (!user?.presets || typeof user.presets !== 'object') return [];

        return Object.entries(user.presets)
            .map(([name, value]) => ({
                name,
                updatedAt: String(value?.updatedAt || '')
            }))
            .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    }

    _findPresetKey(user, inputName) {
        const normalized = normalizePresetName(inputName);
        if (!normalized) return null;
        if (user.presets[normalized]) return normalized;

        const lower = normalized.toLowerCase();
        for (const key of Object.keys(user.presets)) {
            if (String(key).toLowerCase() === lower) return key;
        }
        return null;
    }

    savePreset(chatId, name, token) {
        const presetName = normalizePresetName(name);
        if (!presetName) {
            throw new Error('Preset name cannot be empty');
        }

        const user = this._getUser(chatId, true);
        user.presets[presetName] = {
            token: normalizeTokenDraft(token),
            updatedAt: nowIso()
        };
        user.updatedAt = nowIso();
        this._write();
        return { name: presetName };
    }

    loadPreset(chatId, name) {
        const user = this._getUser(chatId, false);
        if (!user) return null;
        const key = this._findPresetKey(user, name);
        if (!key) return null;
        const value = user.presets[key];
        return {
            name: key,
            token: normalizeTokenDraft(value?.token)
        };
    }

    deletePreset(chatId, name) {
        const user = this._getUser(chatId, false);
        if (!user) return false;
        const key = this._findPresetKey(user, name);
        if (!key) return false;
        delete user.presets[key];
        user.updatedAt = nowIso();
        this._write();
        return true;
    }

    getStats() {
        this._ensureLoaded();
        let presetCount = 0;
        for (const user of Object.values(this._store.users)) {
            presetCount += Object.keys(user?.presets || {}).length;
        }
        return {
            path: this.storePath,
            users: Object.keys(this._store.users).length,
            presets: presetCount
        };
    }
}

export const configStore = new ConfigStore();

export default {
    ConfigStore,
    configStore
};
