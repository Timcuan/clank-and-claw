/**
 * 📤 IPFS Multi-Provider Uploader
 * 
 * Supports:
 * - Pinata (pinata.cloud) - Requires API key
 * - NFT.Storage (nft.storage) - FREE, no credit card needed
 * - Infura (infura.io) - Free tier available
 * - Filebase - S3-compatible
 * 
 * Falls back automatically if one provider fails.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const TIMEOUT_MS = 60000;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

// ═══════════════════════════════════════════
// Provider Implementations
// ═══════════════════════════════════════════

const providers = {
    /**
     * NFT.Storage - FREE, no credit card needed
     * Get token at: https://nft.storage
     */
    nftStorage: async (buffer, filename) => {
        const token = process.env.NFT_STORAGE_TOKEN;
        if (!token) return null;

        const response = await httpRequest({
            hostname: 'api.nft.storage',
            path: '/upload',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/octet-stream',
                'Content-Length': buffer.length
            },
            body: buffer
        });

        if (response.ok && response.value?.cid) {
            return {
                cid: response.value.cid,
                provider: 'nft.storage'
            };
        }
        return null;
    },

    /**
     * Pinata - Popular choice, requires API key
     * Get keys at: https://pinata.cloud
     */
    pinata: async (buffer, filename) => {
        const apiKey = process.env.PINATA_API_KEY;
        const secretKey = process.env.PINATA_SECRET_KEY;
        if (!apiKey || !secretKey) return null;

        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const body = buildMultipart(buffer, filename, boundary);

        const response = await httpRequest({
            hostname: 'api.pinata.cloud',
            path: '/pinning/pinFileToIPFS',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                'pinata_api_key': apiKey,
                'pinata_secret_api_key': secretKey
            },
            body
        });

        if (response.IpfsHash) {
            return {
                cid: response.IpfsHash,
                provider: 'pinata'
            };
        }
        return null;
    },

    /**
     * Infura IPFS - Reliable, free tier available
     * Get credentials at: https://infura.io
     */
    infura: async (buffer, filename) => {
        const projectId = process.env.INFURA_PROJECT_ID;
        const secret = process.env.INFURA_SECRET;
        if (!projectId) return null;

        const auth = secret
            ? Buffer.from(`${projectId}:${secret}`).toString('base64')
            : Buffer.from(projectId).toString('base64');

        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const body = buildMultipart(buffer, filename, boundary);

        const response = await httpRequest({
            hostname: 'ipfs.infura.io',
            port: 5001,
            path: '/api/v0/add',
            method: 'POST',
            headers: {
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
                'Content-Length': body.length,
                'Authorization': `Basic ${auth}`
            },
            body
        });

        if (response.Hash) {
            return {
                cid: response.Hash,
                provider: 'infura'
            };
        }
        return null;
    }
};

// ═══════════════════════════════════════════
// HTTP Utilities
// ═══════════════════════════════════════════

const httpRequest = (options) => {
    return new Promise((resolve, reject) => {
        const { body, ...reqOptions } = options;
        reqOptions.timeout = TIMEOUT_MS;

        const protocol = options.port === 5001 ? https : https;
        const req = protocol.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve({ raw: data, status: res.statusCode });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

        if (body) req.write(body);
        req.end();
    });
};

const buildMultipart = (buffer, filename, boundary) => {
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    const header = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        `Content-Type: ${contentType}`,
        '', ''
    ].join('\r\n');

    return Buffer.concat([
        Buffer.from(header),
        buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
};

const downloadFile = (url, maxRedirects = 5) => {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url, { timeout: 30000 }, (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    const u = new URL(url);
                    redirectUrl = `${u.protocol}//${u.host}${redirectUrl}`;
                }
                return downloadFile(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                let filename = 'image.png';

                const cd = res.headers['content-disposition'];
                if (cd) {
                    const m = cd.match(/filename[*]?=['"]?([^'"\s;]+)/i);
                    if (m) filename = m[1];
                } else {
                    try {
                        const p = new URL(url).pathname;
                        const b = path.basename(p);
                        if (b.includes('.')) filename = b;
                    } catch (e) { }
                }

                resolve({ buffer, filename });
            });
        }).on('error', reject);
    });
};

// ═══════════════════════════════════════════
// Main Functions
// ═══════════════════════════════════════════

/**
 * Upload to IPFS using available providers (auto-fallback)
 */
export const uploadToIPFS = async (input, options = {}) => {
    let buffer, filename = options.filename || 'image.png';

    // Handle input types
    if (Buffer.isBuffer(input)) {
        buffer = input;
    } else if (typeof input === 'string') {
        if (input.startsWith('http://') || input.startsWith('https://')) {
            try {
                const dl = await downloadFile(input);
                buffer = dl.buffer;
                filename = dl.filename;
            } catch (e) {
                return { success: false, error: `Download failed: ${e.message}` };
            }
        } else if (fs.existsSync(input)) {
            buffer = fs.readFileSync(input);
            filename = path.basename(input);
        } else {
            return { success: false, error: 'Invalid input' };
        }
    } else {
        return { success: false, error: 'Input must be Buffer, URL, or path' };
    }

    // Validate size
    if (buffer.length > MAX_SIZE) {
        return { success: false, error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)}MB, max 10MB)` };
    }

    // Check which providers are configured
    const configured = [];
    if (process.env.NFT_STORAGE_TOKEN) configured.push('nftStorage');
    if (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) configured.push('pinata');
    if (process.env.INFURA_PROJECT_ID) configured.push('infura');

    if (configured.length === 0) {
        return {
            success: false,
            error: 'No IPFS provider configured. Add NFT_STORAGE_TOKEN (free), PINATA keys, or INFURA_PROJECT_ID to .env'
        };
    }

    // Try each provider
    for (const name of configured) {
        try {
            const result = await providers[name](buffer, filename);
            if (result) {
                return {
                    success: true,
                    cid: result.cid,
                    provider: result.provider,
                    url: `https://gateway.pinata.cloud/ipfs/${result.cid}`,
                    nftStorageUrl: `https://nftstorage.link/ipfs/${result.cid}`,
                    ipfsUri: `ipfs://${result.cid}`,
                    size: buffer.length
                };
            }
        } catch (error) {
            console.warn(`IPFS ${name} failed:`, error.message);
        }
    }

    return { success: false, error: 'All IPFS providers failed' };
};

/**
 * Check if string is IPFS CID
 */
export const isIPFSCid = (str) => {
    if (!str || typeof str !== 'string') return false;
    const cleaned = str.replace('ipfs://', '').trim();
    return /^(Qm[1-9A-HJ-NP-Za-km-z]{44,46}|baf[a-zA-Z2-7]{50,})$/.test(cleaned);
};

/**
 * Process image input: upload if URL/file, validate if CID
 */
export const processImageInput = async (input, options = {}) => {
    if (!input) return { success: false, error: 'No image provided' };

    const cleaned = input.trim();

    // Already IPFS CID
    if (isIPFSCid(cleaned)) {
        const cid = cleaned.replace('ipfs://', '');
        return {
            success: true,
            cid,
            url: `https://gateway.pinata.cloud/ipfs/${cid}`,
            source: 'existing'
        };
    }

    // Upload
    const result = await uploadToIPFS(cleaned, options);
    if (result.success) result.source = 'uploaded';
    return result;
};

/**
 * Get available providers status
 */
export const getProviderStatus = () => {
    return {
        nftStorage: !!process.env.NFT_STORAGE_TOKEN,
        pinata: !!(process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY),
        infura: !!process.env.INFURA_PROJECT_ID,
        any: !!(process.env.NFT_STORAGE_TOKEN || (process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY) || process.env.INFURA_PROJECT_ID)
    };
};

export default { uploadToIPFS, isIPFSCid, processImageInput, getProviderStatus };
