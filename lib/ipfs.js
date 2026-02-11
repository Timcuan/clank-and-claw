/**
 * 📤 IPFS Multi-Provider Uploader
 * 
 * Supports:
 * - Local Kubo node (no API key)
 * - Pinata (requires API key/JWT)
 * - Legacy Infura IPFS (only if explicitly enabled)
 * - Legacy NFT.Storage Classic (only if explicitly enabled)
 * 
 * Falls back automatically if one provider fails.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const TIMEOUT_MS = 60000;
const LOCAL_KUBO_TIMEOUT_MS = 8000;
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_PREFIXES = ['image/', 'application/octet-stream', 'binary/octet-stream'];
const ENABLE_NFT_STORAGE_CLASSIC = String(process.env.ENABLE_NFT_STORAGE_CLASSIC || 'false').trim().toLowerCase() === 'true';
const ENABLE_INFURA_IPFS_LEGACY = String(process.env.ENABLE_INFURA_IPFS_LEGACY || 'false').trim().toLowerCase() === 'true';
const DEFAULT_IPFS_GATEWAYS = [
    'https://gateway.pinata.cloud/ipfs/{cid}',
    'https://nftstorage.link/ipfs/{cid}',
    'https://cloudflare-ipfs.com/ipfs/{cid}',
    'https://ipfs.io/ipfs/{cid}'
];

// ═══════════════════════════════════════════
// Provider Implementations
// ═══════════════════════════════════════════

const providers = {
    /**
     * Local Kubo node (no API key).
     * Example: IPFS_KUBO_API=http://127.0.0.1:5001
     */
    kuboLocal: async (buffer, filename) => {
        const base = String(process.env.IPFS_KUBO_API || '').trim();
        if (!base) return null;

        let parsed;
        try {
            parsed = new URL(base);
        } catch {
            throw new Error('IPFS_KUBO_API is invalid URL');
        }

        const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
        const body = buildMultipart(buffer, filename, boundary);
        const basePath = normalizeKuboBasePath(parsed.pathname);
        const apiPath = `${basePath}/api/v0/add?pin=true&cid-version=1`;
        const transport = parsed.protocol === 'http:' ? http : https;

        const raw = await new Promise((resolve, reject) => {
            const req = transport.request({
                hostname: parsed.hostname,
                port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'http:' ? 80 : 443),
                path: apiPath,
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': body.length
                },
                timeout: LOCAL_KUBO_TIMEOUT_MS
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        return reject(new Error(`Kubo RPC returned HTTP ${res.statusCode}`));
                    }
                    resolve(data);
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy(new Error('Kubo RPC timeout'));
            });
            req.write(body);
            req.end();
        });

        const lines = String(raw || '').split('\n').map(s => s.trim()).filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                const parsedLine = JSON.parse(lines[i]);
                if (parsedLine?.Hash) {
                    return {
                        cid: parsedLine.Hash,
                        provider: 'kubo-local'
                    };
                }
            } catch {
                // continue scanning lines
            }
        }

        throw new Error('Kubo RPC did not return CID hash');
    },

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

const isConfigured = (name) => {
    switch (name) {
        case 'kuboLocal':
            return !!String(process.env.IPFS_KUBO_API || '').trim();
        case 'pinata':
            return !!(process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY);
        case 'infura':
            return !!process.env.INFURA_PROJECT_ID;
        case 'nftStorage':
            return !!process.env.NFT_STORAGE_TOKEN;
        default:
            return false;
    }
};

const isProviderEnabled = (name) => {
    if (name === 'kuboLocal') return true;
    if (name === 'pinata') return true;
    if (name === 'infura') return ENABLE_INFURA_IPFS_LEGACY;
    if (name === 'nftStorage') return ENABLE_NFT_STORAGE_CLASSIC;
    return false;
};

const getUploadOrder = () => ['kuboLocal', 'pinata', 'infura', 'nftStorage'];

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
    const safeFilename = sanitizeFilename(filename);
    const ext = path.extname(safeFilename).toLowerCase();
    const contentTypes = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    const header = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${safeFilename}"`,
        `Content-Type: ${contentType}`,
        '', ''
    ].join('\r\n');

    return Buffer.concat([
        Buffer.from(header),
        buffer,
        Buffer.from(`\r\n--${boundary}--\r\n`)
    ]);
};

const sanitizeFilename = (filename) => {
    const cleaned = String(filename || 'image.png').trim().replace(/[/\\?%*:|"<>]/g, '_');
    return cleaned.length > 0 ? cleaned : 'image.png';
};

const normalizeKuboBasePath = (pathname) => {
    const raw = String(pathname || '').trim();
    if (!raw || raw === '/') return '';
    const withoutTrailing = raw.replace(/\/+$/, '');
    if (withoutTrailing === '/api/v0') return '';
    if (withoutTrailing.endsWith('/api/v0')) {
        return withoutTrailing.slice(0, -('/api/v0'.length));
    }
    return withoutTrailing;
};

const isAllowedContentType = (contentType) => {
    if (!contentType) return true;
    const normalized = String(contentType).toLowerCase();
    return ALLOWED_MIME_PREFIXES.some(prefix => normalized.startsWith(prefix));
};

const parseGatewayTemplates = () => {
    const custom = String(process.env.IPFS_GATEWAYS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    return custom.length > 0 ? custom : DEFAULT_IPFS_GATEWAYS;
};

const buildGatewayUrls = (cid) => {
    const templates = parseGatewayTemplates();
    const urls = templates.map(template => {
        if (template.includes('{cid}')) return template.replaceAll('{cid}', cid);
        if (template.endsWith('/')) return `${template}${cid}`;
        return `${template}/${cid}`;
    });
    return [...new Set(urls)];
};

const downloadFile = (url, maxRedirects = 5) => {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

        if (!/^https?:\/\//i.test(url)) {
            return reject(new Error('Only HTTP/HTTPS URLs are allowed'));
        }

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

            const contentType = String(res.headers['content-type'] || '').split(';')[0].trim();
            if (!isAllowedContentType(contentType)) {
                return reject(new Error(`Unsupported content type: ${contentType}`));
            }

            const contentLength = Number(res.headers['content-length'] || 0);
            if (Number.isFinite(contentLength) && contentLength > MAX_SIZE) {
                return reject(new Error(`File too large (${(contentLength / 1024 / 1024).toFixed(1)}MB, max 10MB)`));
            }

            const chunks = [];
            let totalBytes = 0;
            res.on('error', reject);
            res.on('data', c => {
                totalBytes += c.length;
                if (totalBytes > MAX_SIZE) {
                    res.destroy(new Error(`File too large (max 10MB)`));
                    return;
                }
                chunks.push(c);
            });
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

                resolve({ buffer, filename: sanitizeFilename(filename) });
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
    let buffer, filename = sanitizeFilename(options.filename || 'image.png');

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
            const stats = fs.statSync(input);
            if (stats.size > MAX_SIZE) {
                return { success: false, error: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB, max 10MB)` };
            }
            buffer = fs.readFileSync(input);
            filename = sanitizeFilename(path.basename(input));
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
    const configured = getUploadOrder().filter(isConfigured);
    const usable = configured.filter(isProviderEnabled);

    if (configured.length === 0) {
        return {
            success: false,
            error: 'No IPFS provider configured. Set IPFS_KUBO_API (no API key) or PINATA_API_KEY + PINATA_SECRET_KEY. Legacy providers require explicit enable flags.'
        };
    }

    if (usable.length === 0) {
        return {
            success: false,
            error: 'Only legacy IPFS providers are configured. Set PINATA keys, or explicitly enable legacy mode: ENABLE_INFURA_IPFS_LEGACY=true / ENABLE_NFT_STORAGE_CLASSIC=true'
        };
    }

    const providerErrors = [];

    // Try each provider in stable order
    for (const name of usable) {
        try {
            const result = await providers[name](buffer, filename);
            if (result) {
                return {
                    success: true,
                    cid: result.cid,
                    provider: result.provider,
                    url: buildGatewayUrls(result.cid)[0],
                    gatewayUrls: buildGatewayUrls(result.cid),
                    nftStorageUrl: `https://nftstorage.link/ipfs/${result.cid}`,
                    ipfsUri: `ipfs://${result.cid}`,
                    size: buffer.length
                };
            }
        } catch (error) {
            console.warn(`IPFS ${name} failed:`, error.message);
            providerErrors.push(`${name}: ${error.message}`);
        }
    }

    return { success: false, error: 'All IPFS providers failed', details: providerErrors };
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

    if (Buffer.isBuffer(input)) {
        const result = await uploadToIPFS(input, options);
        if (result.success) result.source = 'uploaded';
        return result;
    }

    if (typeof input !== 'string') {
        return { success: false, error: 'Image input must be string URL/path/CID or Buffer' };
    }

    const cleaned = input.trim();
    if (!cleaned) return { success: false, error: 'No image provided' };

    // Already IPFS CID
    if (isIPFSCid(cleaned)) {
        const cid = cleaned.replace('ipfs://', '');
        return {
            success: true,
            cid,
            url: buildGatewayUrls(cid)[0],
            gatewayUrls: buildGatewayUrls(cid),
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
    const kuboLocalConfigured = !!String(process.env.IPFS_KUBO_API || '').trim();
    const nftStorageConfigured = !!process.env.NFT_STORAGE_TOKEN;
    const pinataConfigured = !!(process.env.PINATA_API_KEY && process.env.PINATA_SECRET_KEY);
    const infuraConfigured = !!process.env.INFURA_PROJECT_ID;
    const nftStorageUsable = nftStorageConfigured && ENABLE_NFT_STORAGE_CLASSIC;
    const infuraUsable = infuraConfigured && ENABLE_INFURA_IPFS_LEGACY;

    return {
        kuboLocal: kuboLocalConfigured,
        nftStorage: nftStorageUsable,
        pinata: pinataConfigured,
        infura: infuraUsable,
        nftStorageLegacyConfigured: nftStorageConfigured,
        infuraLegacyConfigured: !!process.env.INFURA_PROJECT_ID,
        any: !!(kuboLocalConfigured || pinataConfigured || nftStorageUsable || infuraUsable)
    };
};

export default { uploadToIPFS, isIPFSCid, processImageInput, getProviderStatus };
