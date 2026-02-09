/**
 * 📤 IPFS Uploader v2.0 - Robust Pinata Integration
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

const MAX_RETRIES = 3;
const TIMEOUT_MS = 60000;

/**
 * Upload to Pinata IPFS with retry logic
 */
export const uploadToIPFS = async (input, options = {}) => {
    const {
        pinataApiKey = process.env.PINATA_API_KEY,
        pinataSecretKey = process.env.PINATA_SECRET_KEY,
        filename = 'token-image.png'
    } = options;

    if (!pinataApiKey || !pinataSecretKey) {
        return { success: false, error: 'PINATA_API_KEY and PINATA_SECRET_KEY required in .env' };
    }

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            let fileBuffer;
            let finalFilename = filename;

            // Handle input types
            if (Buffer.isBuffer(input)) {
                fileBuffer = input;
            } else if (typeof input === 'string') {
                if (input.startsWith('http://') || input.startsWith('https://')) {
                    const downloaded = await downloadFile(input);
                    fileBuffer = downloaded.buffer;
                    finalFilename = downloaded.filename || filename;
                } else if (fs.existsSync(input)) {
                    fileBuffer = fs.readFileSync(input);
                    finalFilename = path.basename(input);
                } else {
                    return { success: false, error: 'Invalid input: not a URL or file path' };
                }
            } else {
                return { success: false, error: 'Input must be Buffer, URL, or file path' };
            }

            // Validate file size (max 10MB for tokens)
            if (fileBuffer.length > 10 * 1024 * 1024) {
                return { success: false, error: 'Image too large (max 10MB)' };
            }

            // Upload to Pinata
            const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
            const body = buildMultipartBody(fileBuffer, finalFilename, boundary);

            const response = await new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: 'api.pinata.cloud',
                    path: '/pinning/pinFileToIPFS',
                    method: 'POST',
                    headers: {
                        'Content-Type': `multipart/form-data; boundary=${boundary}`,
                        'Content-Length': body.length,
                        'pinata_api_key': pinataApiKey,
                        'pinata_secret_api_key': pinataSecretKey
                    },
                    timeout: TIMEOUT_MS
                }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => {
                        try {
                            resolve({ status: res.statusCode, data: JSON.parse(data) });
                        } catch (e) {
                            resolve({ status: res.statusCode, data, parseError: true });
                        }
                    });
                });

                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Upload timeout')); });
                req.write(body);
                req.end();
            });

            if (response.status === 200 && response.data.IpfsHash) {
                const cid = response.data.IpfsHash;
                return {
                    success: true,
                    cid,
                    url: `https://gateway.pinata.cloud/ipfs/${cid}`,
                    ipfsUri: `ipfs://${cid}`,
                    size: fileBuffer.length
                };
            }

            // Rate limit - wait and retry
            if (response.status === 429) {
                await sleep(2000 * attempt);
                continue;
            }

            return {
                success: false,
                error: response.data?.error?.message || response.data?.message || `HTTP ${response.status}`,
                details: response.data
            };

        } catch (error) {
            if (attempt === MAX_RETRIES) {
                return { success: false, error: error.message };
            }
            await sleep(1000 * attempt);
        }
    }

    return { success: false, error: 'Max retries exceeded' };
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Download file from URL with redirect support
 */
const downloadFile = (url, maxRedirects = 5) => {
    return new Promise((resolve, reject) => {
        if (maxRedirects <= 0) {
            return reject(new Error('Too many redirects'));
        }

        const protocol = url.startsWith('https') ? https : http;

        const req = protocol.get(url, { timeout: 30000 }, (res) => {
            // Handle redirects
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (redirectUrl.startsWith('/')) {
                    const urlObj = new URL(url);
                    redirectUrl = `${urlObj.protocol}//${urlObj.host}${redirectUrl}`;
                }
                return downloadFile(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);

                // Extract filename
                let filename = 'image.png';
                const cd = res.headers['content-disposition'];
                if (cd) {
                    const match = cd.match(/filename[*]?=['"]?([^'"\s;]+)/i);
                    if (match) filename = match[1];
                } else {
                    try {
                        const urlPath = new URL(url).pathname;
                        const baseName = path.basename(urlPath);
                        if (baseName && baseName.includes('.')) filename = baseName;
                    } catch (e) { }
                }

                resolve({ buffer, filename });
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
    });
};

/**
 * Build multipart form body
 */
const buildMultipartBody = (fileBuffer, filename, boundary) => {
    // Detect content type from extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    const header = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        `Content-Type: ${contentType}`,
        '',
        ''
    ].join('\r\n');

    const footer = `\r\n--${boundary}--\r\n`;

    return Buffer.concat([
        Buffer.from(header),
        fileBuffer,
        Buffer.from(footer)
    ]);
};

/**
 * Check if string is IPFS CID
 */
export const isIPFSCid = (str) => {
    if (!str || typeof str !== 'string') return false;
    const cleaned = str.replace('ipfs://', '').trim();
    // CIDv0 (Qm...) or CIDv1 (baf...)
    return /^(Qm[1-9A-HJ-NP-Za-km-z]{44,46}|baf[a-zA-Z2-7]{50,})$/.test(cleaned);
};

/**
 * Process image: upload if URL/file, validate if CID
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

    // HTTP URL - download and upload
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
        const result = await uploadToIPFS(cleaned, options);
        if (result.success) result.source = 'uploaded';
        return result;
    }

    // File path
    if (fs.existsSync(cleaned)) {
        const result = await uploadToIPFS(cleaned, options);
        if (result.success) result.source = 'uploaded';
        return result;
    }

    return { success: false, error: 'Invalid image: provide URL, file path, or IPFS CID' };
};

export default {
    uploadToIPFS,
    isIPFSCid,
    processImageInput
};
