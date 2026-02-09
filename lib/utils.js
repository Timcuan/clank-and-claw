/**
 * Helper: robust IPFS/CID Normalizer
 */
export const processImage = (input) => {
    if (!input) return "";
    if (input.startsWith("http")) return input;
    let cleanInput = input.replace("ipfs://", "");
    const isCID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-zA-Z0-9]{50,})/.test(cleanInput);
    if (isCID) {
        return `https://gateway.pinata.cloud/ipfs/${cleanInput}`;
    }
    return input;
};

export const parseBoolean = (val) => val === 'true';

export const parseIntSafe = (val, fallback) => {
    const parsed = parseInt(val);
    return isNaN(parsed) ? fallback : parsed;
};

export const parseFloatSafe = (val, fallback) => {
    const parsed = parseFloat(val);
    return isNaN(parsed) ? fallback : parsed;
};

/**
 * Normalize boolean from various input types (for OpenClaw handler)
 */
export const normalizeBool = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1';
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
