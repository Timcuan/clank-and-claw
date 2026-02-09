/**
 * 📤 IPFS Uploader - Upload images to IPFS via Pinata
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';

/**
 * Upload file to Pinata IPFS
 * @param {Buffer|string} input - File buffer, file path, or URL
 * @param {object} options
 * @returns {Promise<{ success: boolean, cid?: string, url?: string, error?: string }>}
 */
export const uploadToIPFS = async (input, options = {}) => {
    const {
        pinataApiKey = process.env.PINATA_API_KEY,
        pinataSecretKey = process.env.PINATA_SECRET_KEY,
        filename = 'token-image.png'
    } = options;

    if (!pinataApiKey || !pinataSecretKey) {
        return { success: false, error: 'PINATA_API_KEY and PINATA_SECRET_KEY required' };
    }

    try {
        let fileBuffer;
        let finalFilename = filename;

        // Handle different input types
        if (Buffer.isBuffer(input)) {
            fileBuffer = input;
        } else if (typeof input === 'string') {
            if (input.startsWith('http://') || input.startsWith('https://')) {
                // Download from URL
                const downloaded = await downloadFile(input);
                fileBuffer = downloaded.buffer;
                finalFilename = downloaded.filename || filename;
            } else if (fs.existsSync(input)) {
                // Read from file path
                fileBuffer = fs.readFileSync(input);
                finalFilename = path.basename(input);
            } else {
                return { success: false, error: 'Invalid input: not a valid URL or file path' };
            }
        } else {
            return { success: false, error: 'Input must be Buffer, URL, or file path' };
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
                }
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
            req.write(body);
            req.end();
        });

        if (response.status === 200 && response.data.IpfsHash) {
            const cid = response.data.IpfsHash;
            return {
                success: true,
                cid,
                url: `https://gateway.pinata.cloud/ipfs/${cid}`,
                ipfsUri: `ipfs://${cid}`
            };
        } else {
            return {
                success: false,
                error: response.data.error?.message || response.data.message || 'Upload failed',
                details: response.data
            };
        }

    } catch (error) {
        return { success: false, error: error.message };
    }
};

/**
 * Download file from URL
 */
const downloadFile = (url) => {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;

        const handleResponse = (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadFile(res.headers.location).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode}`));
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const contentDisposition = res.headers['content-disposition'];
                let filename = null;

                if (contentDisposition) {
                    const match = contentDisposition.match(/filename[*]?=['"]?([^'"\s;]+)/i);
                    if (match) filename = match[1];
                }

                if (!filename) {
                    const urlPath = new URL(url).pathname;
                    filename = path.basename(urlPath) || 'image.png';
                }

                resolve({ buffer, filename });
            });
        };

        protocol.get(url, handleResponse).on('error', reject);
    });
};

/**
 * Build multipart form body
 */
const buildMultipartBody = (fileBuffer, filename, boundary) => {
    const header = [
        `--${boundary}`,
        `Content-Disposition: form-data; name="file"; filename="${filename}"`,
        'Content-Type: application/octet-stream',
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
 * Check if a string is already an IPFS CID
 */
export const isIPFSCid = (str) => {
    if (!str || typeof str !== 'string') return false;
    const cleaned = str.replace('ipfs://', '');
    return /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-zA-Z0-9]{50,})/.test(cleaned);
};

/**
 * Process image input: if URL, upload to IPFS; if already CID, return as-is
 */
export const processImageInput = async (input, options = {}) => {
    if (!input) return { success: false, error: 'No image provided' };

    // Already IPFS CID
    if (isIPFSCid(input)) {
        const cid = input.replace('ipfs://', '');
        return {
            success: true,
            cid,
            url: `https://gateway.pinata.cloud/ipfs/${cid}`,
            source: 'existing'
        };
    }

    // HTTP URL - download and upload to IPFS
    if (input.startsWith('http://') || input.startsWith('https://')) {
        const result = await uploadToIPFS(input, options);
        if (result.success) {
            result.source = 'uploaded';
        }
        return result;
    }

    // File path
    if (fs.existsSync(input)) {
        const result = await uploadToIPFS(input, options);
        if (result.success) {
            result.source = 'uploaded';
        }
        return result;
    }

    return { success: false, error: 'Invalid image input' };
};

export default {
    uploadToIPFS,
    isIPFSCid,
    processImageInput
};
