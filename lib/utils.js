/**
 * Helper: robust IPFS/CID Normalizer
 */
export const processImage = (input) => {
    if (!input) return "";
    const normalizedInput = String(input).trim();
    if (!normalizedInput) return "";
    if (/^https?:\/\//i.test(normalizedInput)) return normalizedInput;
    let cleanInput = normalizedInput.replace(/^ipfs:\/\//i, "");
    const isCID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-zA-Z0-9]{50,})/.test(cleanInput);
    if (isCID) {
        return `https://gateway.pinata.cloud/ipfs/${cleanInput}`;
    }
    return normalizedInput;
};

const stripWrappingQuotes = (value) => {
    const raw = String(value || '').trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1).trim();
    }
    return raw;
};

export const parseBoolean = (val) => {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val !== 0;

    const normalized = stripWrappingQuotes(val).toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off', ''].includes(normalized)) return false;
    return false;
};

export const parseIntSafe = (val, fallback) => {
    const cleaned = stripWrappingQuotes(val).replace(/,/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? fallback : parsed;
};

export const parseFloatSafe = (val, fallback) => {
    const cleaned = stripWrappingQuotes(val).replace(/,/g, '');
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? fallback : parsed;
};

/**
 * Normalize boolean from various input types (for OpenClaw handler)
 */
export const normalizeBool = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        const normalized = stripWrappingQuotes(value).toLowerCase();
        if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
        if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
    }
    return undefined;
};

/**
 * Normalize number from various input types
 */
export const normalizeNumber = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const num = Number(value);
    return Number.isNaN(num) ? undefined : num;
};

/**
 * Pick first defined value from object by key list
 */
export const pick = (obj, keys) => {
    for (const key of keys) {
        if (obj && obj[key] !== undefined) return obj[key];
    }
    return undefined;
};

/**
 * Set environment variable if value is not empty
 */
export const setEnvIf = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    process.env[key] = String(value);
};
